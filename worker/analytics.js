// The analytics foundation: what happened on the site, counted honestly, without tracking
// anyone.
//
// WHY ANALYTICS ENGINE, NOT KV COUNTERS. The first draft kept `metrics:<day>:<name>` counts
// in KV. KV reads are edge-cached for up to 60 seconds and a key takes about one write a
// second, so under any real traffic every colo keeps reading a stale N and writing N+1 —
// page views collapse to roughly one increment per colo per minute. Workers Analytics Engine
// is built for exactly this write shape: `writeDataPoint` is not a subrequest, does not wait,
// and never contends. The trade is retention (~90 days) and a query API that lives outside
// the Worker's own bindings — so the nightly cron rolls each day up into ONE KV key
// (`metrics:rollup:<day>`, single writer, no contention, 400-day TTL) and the owner overview
// reads those.
//
// WHAT IS NEVER STORED: a raw guestId, an IP, or anything that joins one day's visitor to
// the next. The AE index is an HMAC of the guestId under the signing secret AND the day, so
// uniques are countable within a day and unlinkable across days.
//
// Bindings: `analytics_engine_datasets` → `env.ANALYTICS` (wrangler.jsonc). Absent under a
// bare `wrangler dev` or in tests, where record() is a warned no-op rather than a crash.
// Reads need CF_ACCOUNT_ID + CF_ANALYTICS_TOKEN (an API token with Account Analytics Read).

const encoder = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

// Names the browser may send. A closed list — anything else is a 400, not a new metric.
export const CLIENT_EVENTS = Object.freeze(['page_view', 'connect_init', 'checkout_started', 'storyboard_started', 'support_opened']);

// Names only the Worker records, from the handlers that KNOW the thing happened.
export const SERVER_EVENTS = Object.freeze([
  'connect_approved',
  'budget_set',
  'budget_topup',
  'film_shot',
  'support_submitted',
  'support_followup',
  'support_human_requested',
  'support_resolved',
  'subscribe',
]);

export const ALL_EVENTS = Object.freeze([...CLIENT_EVENTS, ...SERVER_EVENTS]);

export const dayOf = (date = new Date()) => new Date(date).toISOString().slice(0, 10);

const DATASET_DEFAULT = 'minds_monster_events';
export const datasetName = (env) => env.ANALYTICS_DATASET || DATASET_DEFAULT;

let warnedMissingBinding = false;

/**
 * Record one event. Synchronous from the caller's point of view — nothing to await, nothing
 * that can fail the request. `guestHash` must already be hashed (see guestHashFor).
 */
export function record(env, name, { page = '', guestHash = '', mindId = null, value = 1 } = {}) {
  if (!ALL_EVENTS.includes(name)) {
    console.warn(`analytics: refusing unknown event "${name}"`);
    return false;
  }
  const dataset = env?.ANALYTICS;
  if (!dataset?.writeDataPoint) {
    if (!warnedMissingBinding) {
      console.warn('analytics: ANALYTICS binding absent — events are not being recorded');
      warnedMissingBinding = true;
    }
    return false;
  }
  try {
    dataset.writeDataPoint({
      blobs: [name, String(page).slice(0, 200), mindId ? String(mindId).slice(0, 8) : ''],
      doubles: [Number(value) || 1],
      indexes: [String(guestHash).slice(0, 64)],
    });
    return true;
  } catch (error) {
    console.warn('analytics: writeDataPoint failed:', error?.message ?? error);
    return false;
  }
}

/** HMAC(secret + day, guestId) — countable within the day, unlinkable across days. */
export async function guestHashFor(env, guestId, day = dayOf()) {
  if (!guestId) return '';
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${env.SESSION_SIGNING_SECRET ?? 'unsigned'}:${day}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(String(guestId)))).slice(0, 32);
}

/** POST /api/analytics/event { name, page, guestId } — sendBeacon from the SPA. */
export async function handleAnalyticsEvent(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? '');
  if (!CLIENT_EVENTS.includes(name)) {
    return new Response(JSON.stringify({ error: 'unknown_event' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const guestHash = await guestHashFor(env, String(body.guestId ?? '').slice(0, 64));
  record(env, name, { page: String(body.page ?? ''), guestHash });
  return new Response(null, { status: 204 });
}

// ───────────────────────────────────────────────────────────────────────── the read path

const sqlTime = (date) => new Date(date).toISOString().slice(0, 19).replace('T', ' ');

export const isAnalyticsReadable = (env) => Boolean(env.CF_ACCOUNT_ID && env.CF_ANALYTICS_TOKEN);

/** Run one SQL statement against the Analytics Engine SQL API. Returns `data` rows. */
export async function queryAnalytics(env, sql, { fetchImpl = fetch } = {}) {
  if (!isAnalyticsReadable(env)) throw new Error('analytics_not_readable');
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}` },
    body: sql,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`analytics_sql_${response.status}: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text);
  return parsed?.data ?? [];
}

/**
 * Counts per event name over a window, plus page_view uniques. `_sample_interval` weights
 * every row so sampled data still sums to the real count. Uniques are counted client-side
 * from a GROUP BY on the hashed index — AE's SQL has no COUNT(DISTINCT), and at this site's
 * scale a few thousand rows is nothing.
 */
export async function countsForWindow(env, from, to, deps) {
  const dataset = datasetName(env);
  const where = `timestamp >= toDateTime('${sqlTime(from)}') AND timestamp < toDateTime('${sqlTime(to)}')`;
  const counts = await queryAnalytics(
    env,
    `SELECT blob1 AS name, SUM(_sample_interval * double1) AS total FROM ${dataset} WHERE ${where} GROUP BY name`,
    deps,
  );
  const visitors = await queryAnalytics(
    env,
    `SELECT index1 AS visitor FROM ${dataset} WHERE ${where} AND blob1 = 'page_view' AND index1 != '' GROUP BY visitor LIMIT 10000`,
    deps,
  );
  const byName = {};
  for (const row of counts) byName[row.name] = Math.round(Number(row.total) || 0);
  return { counts: byName, uniques: visitors.length };
}

export const rollupKey = (day) => `metrics:rollup:${day}`;
const ROLLUP_TTL_SEC = 400 * 24 * 60 * 60;

/** The nightly job: one KV key per day, written once, kept 400 days. */
export async function rollupDay(env, day, deps) {
  const from = `${day}T00:00:00Z`;
  const to = new Date(new Date(from).getTime() + 86_400_000).toISOString();
  const { counts, uniques } = await countsForWindow(env, from, to, deps);
  const rollup = { day, counts, uniques, rolledUpAt: new Date().toISOString() };
  await env.MIND_CONNECTIONS.put(rollupKey(day), JSON.stringify(rollup), { expirationTtl: ROLLUP_TTL_SEC });
  return rollup;
}

const emptyDay = (day) => ({ day, counts: {}, uniques: 0, missing: true });

/** Pure: fold a run of day records into the tiles the overview shows. */
export function summarize(days) {
  const totals = {};
  let uniques = 0;
  for (const record of days) {
    for (const [name, count] of Object.entries(record.counts ?? {})) totals[name] = (totals[name] ?? 0) + count;
    uniques += record.uniques ?? 0;
  }
  for (const name of ALL_EVENTS) totals[name] ??= 0;
  return { ...totals, uniques };
}

/** Count keys under a prefix — the lifetime seeds from records the site already keeps. */
export async function countKeys(env, prefix, { maxPages = 5 } = {}) {
  let total = 0;
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const listed = await env.MIND_CONNECTIONS.list({ prefix, limit: 1000, cursor });
    total += listed.keys.length;
    if (listed.list_complete) break;
    cursor = listed.cursor;
  }
  return total;
}

/**
 * The overview: today live from AE (zeros if unreadable), the last 30 days from rollups
 * (missing days are zeros, flagged), and lifetime totals from the records that already exist.
 */
export async function overview(env, { now = new Date(), deps } = {}) {
  const today = dayOf(now);
  const days = [];
  for (let back = 30; back >= 1; back -= 1) {
    const day = dayOf(new Date(now.getTime() - back * 86_400_000));
    const stored = await env.MIND_CONNECTIONS.get(rollupKey(day), 'json').catch(() => null);
    days.push(stored ?? emptyDay(day));
  }

  let live = emptyDay(today);
  let liveError = null;
  if (isAnalyticsReadable(env)) {
    try {
      const { counts, uniques } = await countsForWindow(env, `${today}T00:00:00Z`, now.toISOString(), deps);
      live = { day: today, counts, uniques, live: true };
    } catch (error) {
      liveError = error?.message ?? String(error);
    }
  } else {
    liveError = 'analytics_not_readable';
  }

  const [connectedMinds, budgets, films, subscribers, tickets] = await Promise.all([
    countKeys(env, 'connects:').catch(() => 0),
    countKeys(env, 'budget:').catch(() => 0),
    countKeys(env, 'productions:').catch(() => 0),
    countKeys(env, 'subscriber:').catch(() => 0),
    countKeys(env, 'support:ticket:').catch(() => 0),
  ]);

  const all = [...days, live];
  return {
    today: summarize([live]),
    last7: summarize(all.slice(-7)),
    last30: summarize(all),
    days: all,
    lifetime: { connectedMinds, budgets, films, subscribers, tickets },
    liveError,
    readable: isAnalyticsReadable(env),
    recording: Boolean(env.ANALYTICS?.writeDataPoint),
  };
}
