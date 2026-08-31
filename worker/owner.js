// The owner API — everything the website owner's private area reads, all behind requireOwner.
//
// Adam's shape for this, and the reason the list route returns no message text: "The owner
// area is the surface that lets my steward notice PATTERNS in support that I won't surface on
// my own … Per-ticket content is the wrong granularity; aggregates with click-into-full is the
// right one." So: stats and a list of states by default, the thread one deliberate click
// deeper, and never a draft, never PII beyond the email that routes the reply.

import { mindsClient, chatAlias } from './minds.js';
import { requireOwner } from './owner-auth.js';
import { deriveLivenessState } from './mind-chat.js';
import { classifyRow, timeToFirstActionMs } from '../src/lib/support-markers.js';
import { KEYS, SLA, loadTicket, loadDerived, logEmail } from './support.js';
import { syncTicket } from './support-sync.js';
import { overview } from './analytics.js';
import { isMailerConfigured } from './email.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const HOUR = 3_600_000;
const NOTE_MAX = 4000;
const MIN_TICKETS_FOR_COST_BAND = 5;
export const MIND_SNAPSHOT_KEY = 'owner:mind-snapshot';

// ─────────────────────────────────────────────────────────────────────────── the list

const listRow = (key, now) => {
  const meta = key.metadata ?? {};
  const ticketId = key.name.split(':').pop();
  const receivedMs = meta.receivedAt ? new Date(meta.receivedAt).getTime() : null;
  const escalatedMs = meta.escalatedAt ? new Date(meta.escalatedAt).getTime() : null;
  const open = meta.status !== 'resolved';
  return {
    ticketId,
    ...meta,
    ageMs: receivedMs ? now - receivedMs : null,
    escalatedAgeMs: escalatedMs ? now - escalatedMs : null,
    open,
    slaBreached: open && slaBreach(meta, now),
  };
};

/** Which SLA a ticket is currently breaching, or null. Only open tickets breach. */
export function slaBreach(meta, now = Date.now()) {
  const received = meta.receivedAt ? new Date(meta.receivedAt).getTime() : null;
  if (!received || meta.status === 'resolved') return null;
  if (meta.status === 'escalated' && meta.escalatedAt && now - new Date(meta.escalatedAt).getTime() > SLA.escalationH * HOUR) return 'escalation';
  if (!meta.seenAt && now - received > SLA.seenWithinH * HOUR) return 'seen';
  if (!meta.repliedAt && !['escalated', 'resolved'].includes(meta.status) && now - received > SLA.repliedWithinH * HOUR) return 'replied';
  return null;
}

/** GET /api/owner/support?status=&cursor= — one list() over the index, rows from metadata. */
export async function handleOwnerSupportList(request, env) {
  if (!(await requireOwner(request, env))) return json({ error: 'unauthorized' }, 401);
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const cursor = searchParams.get('cursor') || undefined;
  const page = await env.MIND_CONNECTIONS.list({ prefix: KEYS.INDEX_PREFIX, limit: 100, cursor });
  const now = Date.now();
  let rows = page.keys.map((key) => listRow(key, now));
  if (status === 'open') rows = rows.filter((row) => row.open);
  else if (status) rows = rows.filter((row) => row.status === status);
  return json({ tickets: rows, cursor: page.list_complete ? null : page.cursor });
}

// ─────────────────────────────────────────────────────────────────────────── the stats

const BUCKETS = [
  { label: '<1h', maxH: 1 },
  { label: '1–4h', maxH: 4 },
  { label: '4–8h', maxH: 8 },
  { label: '>8h', maxH: Infinity },
];

/** Pure: Adam's aggregates over a set of index rows. */
export function supportStats(rows, { now = Date.now(), cognition30d = null } = {}) {
  const since = (days) => rows.filter((row) => row.receivedAt && now - new Date(row.receivedAt).getTime() < days * 86_400_000);
  const byState = {};
  for (const row of rows) byState[row.status] = (byState[row.status] ?? 0) + 1;

  const window = (days) => {
    const set = since(days);
    const firstAction = set.map((row) => timeToFirstActionMs(row)).filter((ms) => ms != null);
    const histogram = BUCKETS.map((bucket) => ({ label: bucket.label, count: 0 }));
    for (const ms of firstAction) {
      const index = BUCKETS.findIndex((bucket) => ms / HOUR < bucket.maxH);
      histogram[index === -1 ? BUCKETS.length - 1 : index].count += 1;
    }
    const escalated = set.filter((row) => row.escalatedAt).length;
    const resolved = set.filter((row) => row.resolvedAt).length;
    const reopened = set.filter((row) => (row.reopenCount ?? 0) > 0).length;
    return {
      tickets: set.length,
      seen: firstAction.length,
      medianFirstActionMs: firstAction.length ? [...firstAction].sort((a, b) => a - b)[Math.floor(firstAction.length / 2)] : null,
      histogram,
      escalated,
      escalationRate: set.length ? escalated / set.length : 0,
      resolved,
      reopened,
      reopenRate: resolved ? reopened / resolved : 0,
      humanRequested: set.filter((row) => row.humanRequested).length,
      unmarked: set.filter((row) => (row.unmarked ?? 0) > 0).length,
    };
  };

  const open = rows.filter((row) => row.status !== 'resolved');
  const breaches = open.map((row) => slaBreach(row, now)).filter(Boolean);
  const last30 = window(30);

  // Adam: "Show cost as a band ('most tickets cost 6–12 credits'), not a precise number."
  //
  // The only cognition figure the API gives is the Mind's TOTAL — everything it does, not just
  // support — so this is an upper bound, and with a handful of tickets it is not even that:
  // one ticket against a month of Producer work reads as "1594–3721 credits". Nothing is shown
  // until there are enough tickets for the division to mean something.
  let costBand = null;
  if (cognition30d != null && last30.tickets >= MIN_TICKETS_FOR_COST_BAND) {
    const perTicket = cognition30d / last30.tickets;
    costBand = {
      low: Math.floor(perTicket * 0.6),
      high: Math.ceil(perTicket * 1.4),
      basis: `all cognition ÷ ${last30.tickets} tickets, last 30 days — an upper bound, since cognition covers everything the Mind does`,
    };
  }

  return {
    open: open.length,
    byState,
    breaches: { total: breaches.length, seen: breaches.filter((b) => b === 'seen').length, replied: breaches.filter((b) => b === 'replied').length, escalation: breaches.filter((b) => b === 'escalation').length },
    last7: window(7),
    last30,
    costBand,
    sla: SLA,
  };
}

/** GET /api/owner/support-stats */
export async function handleOwnerSupportStats(request, env) {
  if (!(await requireOwner(request, env))) return json({ error: 'unauthorized' }, 401);
  const rows = [];
  let cursor;
  do {
    const page = await env.MIND_CONNECTIONS.list({ prefix: KEYS.INDEX_PREFIX, limit: 1000, cursor });
    rows.push(...page.keys.map((key) => listRow(key, Date.now())));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && rows.length < 5000);
  const snapshot = await env.MIND_CONNECTIONS.get(MIND_SNAPSHOT_KEY, 'json').catch(() => null);
  return json(supportStats(rows, { cognition30d: snapshot?.cognition30d ?? null }));
}

// ─────────────────────────────────────────────────────────────────────── one ticket, open

/** GET /api/owner/support/<id> — the explicit click-into-full: record, fresh state, thread, emails. */
export async function handleOwnerSupportGet(request, env, ticketId) {
  if (!(await requireOwner(request, env))) return json({ error: 'unauthorized' }, 401);
  const ticket = await loadTicket(env, ticketId);
  if (!ticket) return json({ error: 'not_found' }, 404);

  // Refresh on open rather than showing the cron's last 5-minute-old view. Failures fall
  // back to the stored snapshot; the owner still sees the ticket.
  let derived = await syncTicket(env, ticketId).catch(() => null);
  derived ??= await loadDerived(env, ticketId);

  const client = mindsClient(env);
  const history = client ? await client.getHistory(ticket.alias, { limit: 100 }).catch(() => []) : [];
  const thread = [...history]
    .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0))
    .flatMap((row) => {
      const entry = classifyRow(row, ticketId);
      if (entry.role !== 'marker') {
        return [{ fingerprint: row.fingerprint, createdAt: row.createdAt, role: entry.role, marker: null, reason: entry.reason ?? null, text: entry.text }];
      }
      // One message, several markers: one thread entry per marker, plus the preamble as the
      // Mind's own aside so nothing he wrote is hidden from the owner.
      const entries = entry.markers.map((marker, index) => ({
        fingerprint: index === 0 ? row.fingerprint : `${row.fingerprint}:${index}`,
        createdAt: row.createdAt,
        role: 'marker',
        marker: { kind: marker.kind, at: marker.at },
        reason: null,
        text: marker.body,
      }));
      if (entry.preamble) {
        entries.unshift({ fingerprint: `${row.fingerprint}:preamble`, createdAt: row.createdAt, role: 'aside', marker: null, reason: null, text: entry.preamble });
      }
      return entries;
    });

  const emails = await env.MIND_CONNECTIONS.list({ prefix: KEYS.emailLogPrefix(ticketId), limit: 50 }).catch(() => ({ keys: [] }));
  const emailLog = (
    await Promise.all(emails.keys.map((key) => env.MIND_CONNECTIONS.get(key.name, 'json').catch(() => null)))
  ).filter(Boolean);

  const { ownerNotifyEmail: _omit, ...record } = ticket;
  return json({ ticket: record, derived, thread, emailLog, mailer: isMailerConfigured(env) ? 'configured' : 'unconfigured' });
}

/** POST /api/owner/support/<id>/note { note } — the steward's comment, in the thread, marked as theirs. */
export async function handleOwnerSupportNote(request, env, ticketId) {
  if (!(await requireOwner(request, env))) return json({ error: 'unauthorized' }, 401);
  const ticket = await loadTicket(env, ticketId);
  if (!ticket) return json({ error: 'not_found' }, 404);
  const body = await request.json().catch(() => ({}));
  const note = String(body.note ?? '').trim().slice(0, NOTE_MAX);
  if (!note) return json({ error: 'note_required' }, 400);
  const client = mindsClient(env);
  if (!client) return json({ error: 'not_configured' }, 500);
  await client.sendMessage({ alias: ticket.alias, messageText: `[steward-note] ${note}` });
  await logEmail(env, ticketId, { kind: 'steward-note', status: 'posted', preview: note.slice(0, 120) });
  return json({ ok: true });
}

// ────────────────────────────────────────────────────────────────────── overview and Mind

/** GET /api/owner/overview */
export async function handleOwnerOverview(request, env) {
  if (!(await requireOwner(request, env))) return json({ error: 'unauthorized' }, 401);
  return json(await overview(env));
}

/**
 * Everything the Mind panel shows, fetched in one place so the nightly cron can cache it and
 * the page never blocks on five API calls. Each read is individually defended.
 */
export async function buildMindSnapshot(env, { client = mindsClient(env), now = new Date() } = {}) {
  const mindId = env.SUPPORT_MIND_ID;
  if (!client || !mindId) return { mindId: mindId ?? null, error: 'not_configured', builtAt: now.toISOString() };
  const startTime = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [mind, balance, usage, byTool, skills, producerHistory] = await Promise.all([
    client.getMind(mindId).catch(() => null),
    client.getCognitionBalance(mindId).catch(() => null),
    client.getCognitionUsage(mindId, { interval: '1d', startTime, endTime: now.toISOString() }).catch(() => null),
    client.getCognitionUsageByTool(mindId, { interval: 'day', startTime, endTime: now.toISOString() }).catch(() => null),
    client.listEquippedSkills(mindId).catch(() => []),
    client.getHistory(chatAlias(mindId), { limit: 30 }).catch(() => []),
  ]);
  const series = (usage?.items ?? []).map((item) => ({ bucket: item.bucket, value: Number(item.value) || 0 }));
  return {
    mindId,
    name: mind?.name ?? null,
    email: mind?.email ?? null,
    isEnabled: mind?.isEnabled ?? null,
    cognitionBalance: balance?.cognition ?? null,
    cognition30d: series.reduce((sum, item) => sum + item.value, 0),
    usageSeries: series,
    byTool: (byTool?.summary ?? []).map((row) => ({ tool: row.tool, callCount: row.callCount, creditsUsed: row.creditsUsed })),
    skills: (skills ?? []).map((skill) => ({ skillId: skill.skillId, name: skill.name ?? null, source: skill.source ?? null })),
    producerLiveness: deriveLivenessState(producerHistory),
    builtAt: now.toISOString(),
  };
}

export async function refreshMindSnapshot(env, deps) {
  const snapshot = await buildMindSnapshot(env, deps);
  await env.MIND_CONNECTIONS.put(MIND_SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: 3 * 86_400 });
  return snapshot;
}

/** GET /api/owner/mind — the cached snapshot, built live if the cron has not run yet. */
export async function handleOwnerMind(request, env) {
  if (!(await requireOwner(request, env))) return json({ error: 'unauthorized' }, 401);
  const cached = await env.MIND_CONNECTIONS.get(MIND_SNAPSHOT_KEY, 'json').catch(() => null);
  if (cached && !new URL(request.url).searchParams.has('refresh')) return json(cached);
  return json(await refreshMindSnapshot(env));
}
