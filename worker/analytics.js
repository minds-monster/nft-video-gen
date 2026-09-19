// The analytics foundation: what happened on the site, counted honestly.
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
// COUNTS AND AMOUNTS ARE DIFFERENT COLUMNS. `double1` is the event's amount (dollars for a
// top-up, a delivered film's spend); the COUNT is `SUM(_sample_interval)` and never reads it.
// Until 2026-09-19 the rollup summed double1 as the count, so "Top-ups" showed dollars and
// "Films delivered" showed spend. Rollups written before that carry no `version` and are
// rewritten by healRollups from the raw events, which AE keeps for ~90 days.
//
// VISITORS ARE TRACEABLE ACROSS DAYS, by the owner's choice (2026-09-19). The AE index is an
// HMAC of the guestId under the signing secret — stable, so a returning visitor is the same
// index tomorrow, and 7- and 30-day uniques are real distinct counts rather than a sum of daily
// ones. Still never stored: the raw guestId or an IP. Events before that date were indexed
// under a per-day salt, so a visitor from then counts once per day they came; that ages out of
// the 30-day window by 2026-10-19.
//
// Bindings: `analytics_engine_datasets` → `env.ANALYTICS` (wrangler.jsonc). Absent under a
// bare `wrangler dev` or in tests, where record() is a warned no-op rather than a crash.
// Reads need CF_ACCOUNT_ID + CF_ANALYTICS_TOKEN (an API token with Account Analytics Read).

const encoder = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

// Names the browser may send. A closed list — anything else is a 400, not a new metric.
export const CLIENT_EVENTS = Object.freeze(['page_view', 'connect_init', 'support_opened']);

// Names only the Worker records, from the handlers that KNOW the thing happened.
// `checkout_started` and `storyboard_started` were client events that nothing ever sent; the
// Worker records them where the Stripe session and the storyboard job are actually created.
export const SERVER_EVENTS = Object.freeze([
  'connect_approved',
  'checkout_started',
  'storyboard_started',
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

// Events whose value is money (USD) and worth summing. Every other event's value is a
// placeholder 1, and `budget_set`'s is a per-render ceiling, which means nothing added up.
export const AMOUNT_EVENTS = Object.freeze(['checkout_started', 'budget_topup', 'film_shot']);

// Bumped when a rollup's shape or arithmetic changes; healRollups rewrites anything older.
export const ROLLUP_VERSION = 2;

export const dayOf = (date = new Date()) => new Date(date).toISOString().slice(0, 10);

const DATASET_DEFAULT = 'minds_monster_events';
export const datasetName = (env) => env.ANALYTICS_DATASET || DATASET_DEFAULT;

let warnedMissingBinding = false;

/**
 * Record one event. Synchronous from the caller's point of view — nothing to await, nothing
 * that can fail the request. `guestHash` must already be hashed (see guestHashFor). `value`
 * is the event's amount; 0 is a real amount (a film delivered for nothing) and is kept.
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
  const amount = Number(value);
  try {
    dataset.writeDataPoint({
      blobs: [name, String(page).slice(0, 200), mindId ? String(mindId).slice(0, 8) : ''],
      doubles: [Number.isFinite(amount) ? amount : 1],
      indexes: [String(guestHash).slice(0, 64)],
    });
    return true;
  } catch (error) {
    console.warn('analytics: writeDataPoint failed:', error?.message ?? error);
    return false;
  }
}

/** HMAC(secret, guestId) — the same visitor on every day, never the raw id. */
export async function guestHashFor(env, guestId) {
  if (!guestId) return '';
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${env.SESSION_SIGNING_SECRET ?? 'unsigned'}:visitor`),
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

const windowClause = (from, to) => `timestamp >= toDateTime('${sqlTime(from)}') AND timestamp < toDateTime('${sqlTime(to)}')`;
const cents = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Distinct page_view visitors in a window. Counted client-side from a GROUP BY on the hashed
 * index — AE's SQL has no COUNT(DISTINCT), and at this site's scale a few thousand rows is
 * nothing.
 */
export async function uniquesForWindow(env, from, to, deps) {
  const visitors = await queryAnalytics(
    env,
    `SELECT index1 AS visitor FROM ${datasetName(env)} WHERE ${windowClause(from, to)} AND blob1 = 'page_view' AND index1 != '' GROUP BY visitor LIMIT 10000`,
    deps,
  );
  return visitors.length;
}

/**
 * Counts and amounts per event name over a window, plus page_view uniques.
 * `_sample_interval` weights every row so sampled data still sums to the real figures.
 */
export async function countsForWindow(env, from, to, deps) {
  const rows = await queryAnalytics(
    env,
    `SELECT blob1 AS name, SUM(_sample_interval) AS events, SUM(_sample_interval * double1) AS amount FROM ${datasetName(env)} WHERE ${windowClause(from, to)} GROUP BY name`,
    deps,
  );
  const counts = {};
  const amounts = {};
  for (const row of rows) {
    counts[row.name] = Math.round(Number(row.events) || 0);
    if (AMOUNT_EVENTS.includes(row.name)) amounts[row.name] = cents(row.amount);
  }
  return { counts, amounts, uniques: await uniquesForWindow(env, from, to, deps) };
}

export const rollupKey = (day) => `metrics:rollup:${day}`;
const ROLLUP_TTL_SEC = 400 * 24 * 60 * 60;

/** The nightly job: one KV key per day, written once, kept 400 days. */
export async function rollupDay(env, day, deps) {
  const from = `${day}T00:00:00Z`;
  const to = new Date(new Date(from).getTime() + 86_400_000).toISOString();
  const { counts, amounts, uniques } = await countsForWindow(env, from, to, deps);
  const rollup = { day, version: ROLLUP_VERSION, counts, amounts, uniques, rolledUpAt: new Date().toISOString() };
  await env.MIND_CONNECTIONS.put(rollupKey(day), JSON.stringify(rollup), { expirationTtl: ROLLUP_TTL_SEC });
  return rollup;
}

// Two SQL queries per day, so 15 days is 30 subrequests — inside even the free plan's 50.
export const HEAL_MAX_DAYS = 15;

/**
 * Roll up every day in the last `window` days whose rollup is missing or older than
 * ROLLUP_VERSION, newest first, at most `max` per call. The nightly job used to roll up only
 * yesterday, so a night the cron did not run was a hole forever even though AE still held the
 * events. Run nightly, a 30-day window is whole again within two nights of any outage.
 */
export async function healRollups(env, { now = new Date(), window = 30, max = HEAL_MAX_DAYS, deps } = {}) {
  const healed = [];
  const failed = [];
  let remaining = 0;
  for (let back = 1; back <= window; back += 1) {
    const day = dayOf(new Date(now.getTime() - back * 86_400_000));
    const stored = await env.MIND_CONNECTIONS.get(rollupKey(day), 'json').catch(() => null);
    if (stored?.version >= ROLLUP_VERSION) continue;
    if (healed.length + failed.length >= max) {
      remaining += 1;
      continue;
    }
    try {
      await rollupDay(env, day, deps);
      healed.push(day);
    } catch (error) {
      failed.push({ day, error: error?.message ?? String(error) });
    }
  }
  return { healed, failed, remaining };
}

const emptyDay = (day) => ({ day, counts: {}, amounts: {}, uniques: 0, missing: true });

/**
 * Pure: fold a run of day records into the tiles the overview shows. `uniques` here is a SUM
 * of daily uniques — a visitor who came on three days counts three times — so overview()
 * replaces it with a distinct count over the window whenever AE is readable.
 */
export function summarize(days) {
  const totals = {};
  const amounts = {};
  let uniques = 0;
  for (const record of days) {
    for (const [name, count] of Object.entries(record.counts ?? {})) totals[name] = (totals[name] ?? 0) + count;
    for (const [name, amount] of Object.entries(record.amounts ?? {})) amounts[name] = cents((amounts[name] ?? 0) + amount);
    uniques += record.uniques ?? 0;
  }
  for (const name of ALL_EVENTS) totals[name] ??= 0;
  for (const name of AMOUNT_EVENTS) amounts[name] ??= 0;
  return { ...totals, uniques, amounts };
}

/** The key names under a prefix, without it — the lifetime seeds from records the site keeps. */
export async function listIds(env, prefix, { maxPages = 5 } = {}) {
  const ids = [];
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const listed = await env.MIND_CONNECTIONS.list({ prefix, limit: 1000, cursor });
    for (const key of listed.keys) ids.push(key.name.slice(prefix.length));
    if (listed.list_complete) break;
    cursor = listed.cursor;
  }
  return ids;
}

export const countKeys = async (env, prefix, options) => (await listIds(env, prefix, options)).length;

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
    days.push(stored ? { ...stored, stale: !(stored.version >= ROLLUP_VERSION) } : emptyDay(day));
  }

  let live = emptyDay(today);
  let liveError = null;
  let windowUniques = null;
  if (isAnalyticsReadable(env)) {
    try {
      const { counts, amounts, uniques } = await countsForWindow(env, `${today}T00:00:00Z`, now.toISOString(), deps);
      live = { day: today, counts, amounts, uniques, live: true };
      const since = (back) => `${dayOf(new Date(now.getTime() - back * 86_400_000))}T00:00:00Z`;
      const [last7, last30] = await Promise.all([
        uniquesForWindow(env, since(6), now.toISOString(), deps),
        uniquesForWindow(env, since(30), now.toISOString(), deps),
      ]);
      windowUniques = { last7, last30 };
    } catch (error) {
      liveError = error?.message ?? String(error);
    }
  } else {
    liveError = 'analytics_not_readable';
  }

  // `production:<mindId>:<filmId>` is one envelope per film; `productions:<mindId>` (which this
  // used to count, as "films") is one index per MIND. The prefixes do not overlap.
  //
  // `budget:<id>` is keyed by a mindId OR, for a checkout made before connecting, a guestId
  // that is deleted when the Mind claims it. Every connected Mind has a `connects:` key
  // (recordConnect runs on every init), so an id not among them is an unclaimed guest top-up.
  const [connectedIds, budgetIds, films, subscribers, tickets] = await Promise.all([
    listIds(env, 'connects:').catch(() => []),
    listIds(env, 'budget:').catch(() => []),
    countKeys(env, 'production:').catch(() => 0),
    countKeys(env, 'subscriber:').catch(() => 0),
    countKeys(env, 'support:ticket:').catch(() => 0),
  ]);
  const connected = new Set(connectedIds);
  const mindBudgets = budgetIds.filter((id) => connected.has(id)).length;

  const all = [...days, live];
  const last7 = summarize(all.slice(-7));
  const last30 = summarize(all);
  if (windowUniques) {
    last7.uniques = windowUniques.last7;
    last30.uniques = windowUniques.last30;
  }
  return {
    today: summarize([live]),
    last7,
    last30,
    uniquesDistinct: Boolean(windowUniques),
    days: all,
    lifetime: {
      connectedMinds: connectedIds.length,
      budgets: mindBudgets,
      guestBudgets: budgetIds.length - mindBudgets,
      films,
      subscribers,
      tickets,
    },
    liveError,
    readable: isAnalyticsReadable(env),
    recording: Boolean(env.ANALYTICS?.writeDataPoint),
  };
}
