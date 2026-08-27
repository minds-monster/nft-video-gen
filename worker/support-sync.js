// The watcher. Workers have no background timer, and the site has to NOTICE an
// `[auto-replied]` marker to send the visitor their email — so a Cron Trigger (wrangler.jsonc
// `triggers.crons`, every 5 minutes) walks the open tickets, re-derives each one's state from
// its conversation, and relays anything not yet relayed.
//
// Three properties, each the answer to a specific way this could go wrong:
//
//   1. IDEMPOTENT PER REPLY. A `support:emailed:<id>:<fingerprint>` marker is written after
//      each send (the same shape as worker/stripe.js's `stripe_processed:`), so a reply is
//      emailed once even if two runs overlap. Send-then-mark is at-least-once, and that is the
//      right side to err on: a duplicate email is a nuisance, a missing one is a broken promise.
//   2. BOUNDED. A run has a wall-clock budget well inside the 5-minute cadence and catches per
//      ticket, so it stops rather than overlaps the next run. ~150 open tickets fit under the
//      1000-subrequest ceiling; that is the scale limit, and it is stated rather than hidden.
//   3. CHEAP WHEN NOTHING CHANGED. `getLatestHistoryFingerprint` is one call; a ticket whose
//      fingerprint matches the last sync is skipped without fetching its history.
//
// `support:derived:<id>` has exactly one writer — this file — so it never races the request
// path, which only ever writes the immutable ticket record and the open/visitor keys.

import { mindsClient } from './minds.js';
import { deriveTicket } from '../src/lib/support-markers.js';
import { sendEmail, isMailerConfigured } from './email.js';
import { KEYS, loadTicket, loadDerived, writeIndex, replyEmail, deliver } from './support.js';
import { record } from './analytics.js';

const HISTORY_LIMIT = 100;

/**
 * The newest row's fingerprint, in one tiny request. NOT the client library's
 * `getLatestHistoryFingerprint`: /histories returns newest-first and that helper takes the LAST
 * row of the page — the OLDEST message — so it never changes after the first row exists. Found
 * live on 2026-08-27: Adam's [seen] and reply sat in the thread while the derived state stayed
 * "received", because the skip check below compared two constants.
 */
const newestFingerprint = async (client, alias) => {
  const [row] = await client.getHistory(alias, { limit: 1 }).catch(() => []);
  return row?.fingerprint;
};

/**
 * Re-derive one ticket and relay any unrelayed reply. Returns the fresh derived state.
 * Exported so the owner's ticket view can refresh on demand rather than wait for the cron.
 */
export async function syncTicket(env, ticketId, { client = mindsClient(env), send = sendEmail, force = false } = {}) {
  if (!client) throw new Error('not_configured');
  const store = env.MIND_CONNECTIONS;
  const ticket = await loadTicket(env, ticketId);
  if (!ticket) {
    // An open marker with no ticket behind it is an orphan from a half-failed submit.
    await store.delete(KEYS.open(ticketId)).catch(() => null);
    return null;
  }

  const previous = await loadDerived(env, ticketId);
  if (!force && previous?.lastFingerprint) {
    const latest = await newestFingerprint(client, ticket.alias);
    if (latest && latest === previous.lastFingerprint) return previous;
  }

  const history = await client.getHistory(ticket.alias, { limit: HISTORY_LIMIT });
  const derived = { ...deriveTicket(history, ticketId), syncedAt: new Date().toISOString() };
  // Stored from the same ordering newestFingerprint() reads (/histories is newest-first), never
  // from the row with the latest createdAt — under clock skew those can differ, and a mismatch
  // would refetch every ticket every run.
  derived.lastFingerprint = history[0]?.fingerprint ?? derived.lastFingerprint;

  await store.put(KEYS.derived(ticketId), JSON.stringify(derived));
  await writeIndex(env, ticket, derived);

  const mailerReady = isMailerConfigured(env);
  for (const reply of derived.replies) {
    if (!reply.fingerprint) continue;
    const markerKey = KEYS.emailed(ticketId, reply.fingerprint);
    const marker = await store.get(markerKey).catch(() => null);
    // 'unconfigured' is a marker that says "logged, not sent" — it stops the log filling
    // with the same warning every 5 minutes, and is retried the moment a key is configured.
    if (marker === 'sent' || (marker === 'unconfigured' && !mailerReady)) continue;
    const result = await deliver(env, ticketId, `reply:${reply.kind}`, await replyEmail(env, ticket, reply), { send });
    if (result.status === 'sent') await store.put(markerKey, 'sent');
    else if (result.status === 'unconfigured') await store.put(markerKey, 'unconfigured');
    // 'failed' leaves no marker: the next run tries again, and the failure is in the log.
  }

  if (derived.status === 'resolved') {
    await store.delete(KEYS.open(ticketId));
    if (previous?.status !== 'resolved') record(env, 'support_resolved', { mindId: ticket.mindId });
  } else if (previous?.status === 'resolved') {
    // Reopened by a visitor follow-up: back on the work list.
    await store.put(KEYS.open(ticketId), '1');
  }

  return derived;
}

/** Everything on the open list, within a time budget. Returns a summary for the cron log. */
export async function syncOpenTickets(env, { budgetMs = 180_000, now = () => Date.now(), ...deps } = {}) {
  const startedAt = now();
  const summary = { scanned: 0, synced: 0, skipped: 0, errors: [], stoppedEarly: false };
  const store = env.MIND_CONNECTIONS;

  let cursor;
  do {
    const page = await store.list({ prefix: KEYS.OPEN_PREFIX, limit: 200, cursor });
    for (const key of page.keys) {
      if (now() - startedAt > budgetMs) {
        summary.stoppedEarly = true;
        return summary;
      }
      const ticketId = key.name.slice(KEYS.OPEN_PREFIX.length);
      summary.scanned += 1;
      try {
        const before = await loadDerived(env, ticketId);
        const after = await syncTicket(env, ticketId, deps);
        if (after && after.syncedAt !== before?.syncedAt) summary.synced += 1;
        else summary.skipped += 1;
      } catch (error) {
        summary.errors.push({ ticketId, error: error?.message ?? String(error) });
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return summary;
}
