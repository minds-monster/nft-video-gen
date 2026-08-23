// The ongoing chat, once a visitor's session is live. Session-gated; only ever relays
// a real, human-typed message to the connected Mind — never a synthetic ping, per
// Adam's own cognition-budget concern from the brainstorm.

import { mindsClient, chatAlias } from './minds.js';
import { verifySession } from './session.js';
import { PRODUCER_BRIEFING } from './producer-briefing.js';
import { messageToText } from '../src/lib/text.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function requireSession(request, env) {
  const auth = request.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  return verifySession(env, token);
}

/**
 * Ensure a Mind's persistent Producer conversation exists and has been briefed, and
 * return its current history. Exported so `worker/assistant.js` can get the same
 * "is this Mind actually onboarded" guarantee without duplicating the briefed-flag
 * dance below.
 */
export async function ensureProducerReady(env, mindId) {
  const client = mindsClient(env);
  if (!client) throw new Error('not_configured');

  const alias = chatAlias(mindId);
  await client.ensureConversation(alias, mindId);
  let history = await client.getHistory(alias, { limit: 50 });

  // First time this Mind has ever connected as a Producer — brief it automatically so
  // every connected Mind gets real context, not just ones sophisticated enough to have
  // equipped a Skill. Tracked via a dedicated per-Mind flag, not "is history empty" —
  // that heuristic silently breaks the moment a Mind has *any* prior contact on this
  // alias for any reason (every Mind used for dev/testing already does), permanently
  // blocking the briefing for it. The flag has no TTL: this is a permanent "have we
  // ever briefed this Mind" record, not an expiring one.
  const briefedKey = `briefed:${mindId}`;
  let alreadyBriefed = await env.MIND_CONNECTIONS.get(briefedKey);
  // The KV flag can be slow to replicate; the conversation history is authoritative.
  // If a previous briefing is already in the thread, treat this Mind as briefed and
  // repair the flag so the next init doesn't re-send.
  const briefingInHistory = history.some(
    (row) => row.senderType === 1 && row.messageText?.includes('Producer briefing'),
  );
  if (!alreadyBriefed && briefingInHistory) {
    alreadyBriefed = '1';
    await env.MIND_CONNECTIONS.put(briefedKey, '1');
  }

  if (!alreadyBriefed) {
    try {
      await client.sendMessage({ alias, messageText: PRODUCER_BRIEFING });
      await env.MIND_CONNECTIONS.put(briefedKey, '1');
      history = await client.getHistory(alias, { limit: 50 });
    } catch (err) {
      const wrapped = new Error(err?.message);
      wrapped.briefingFailed = true;
      throw wrapped;
    }
  }

  return { alias, history };
}

/**
 * Recent history on a Mind's Producer conversation, filtered to rows created after
 * `afterMs`. Exported so `worker/assistant.js` can pull the same "what's actually
 * happened with this Mind" context it needs for oversight/status, via the same
 * timestamp-based filtering `mindChatPoll` already relies on below.
 */
export async function fetchMindActivity(env, mindId, { limit = 50, afterMs = 0 } = {}) {
  const client = mindsClient(env);
  if (!client) throw new Error('not_configured');

  const alias = chatAlias(mindId);
  const raw = await client.getHistory(alias, { limit });
  // Small buffer for clock skew between this Worker and the platform's own timestamps.
  const cutoffMs = afterMs - 2000;
  return raw.filter((row) => new Date(row.createdAt).getTime() > cutoffMs);
}

/**
 * Send a message into a Mind's Producer conversation. No rate limiting here — callers
 * (mindChatSend below, and the assistant's send_to_mind tool) each own their own limit,
 * since they have different rate budgets.
 */
export async function relayToMind(env, mindId, messageText) {
  const client = mindsClient(env);
  if (!client) throw new Error('not_configured');

  const alias = chatAlias(mindId);
  await client.ensureConversation(alias, mindId);
  // A timestamp, not a fingerprint: getHistory's `after` fingerprint filter is silently
  // ignored by the platform — confirmed empirically (a call with `after` set to a recent
  // message's fingerprint still returned the entire conversation from the start). Filtering
  // by createdAt ourselves, in fetchMindActivity above, is what actually works.
  const before = Date.now();
  await client.sendMessage({ alias, messageText });
  return { before };
}

// Hello Minds exposes no read-receipt concept. Adam's own proposal (see the brainstorm
// thread linked from the assistant plan) is a behavior commitment rather than new
// infrastructure: a connected Mind's first action on a new visitor message is to send a
// one-line `[seen <ISO timestamp>] ...` acknowledgment before it starts actual work.
// This is intentionally Mind-agnostic — any connected Mind that adopts the same
// one-line convention gets the same "seen" signal, not just Adam's.
//
// Tested against messageToText(row.messageText), never the raw field — Hello Minds
// wraps replies in HTML (`<p>[seen ...] On it.</p>`), which would otherwise defeat a
// prefix anchored at the start of the string.
const SEEN_ACK_PREFIX = /^\s*\[seen\b/i;

/**
 * Pure: given a Mind's Producer history, say whether it has ever been messaged, has
 * acknowledged seeing the visitor's last message, or has actually replied. Three
 * signals, matching the states a `[seen ...]` ack makes possible — see SEEN_ACK_PREFIX.
 */
export function deriveMindStatus(history) {
  const sorted = [...(history ?? [])].sort(
    (a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0),
  );
  if (!sorted.length) return { mindStatus: 'no_activity_yet', lastActivityAgeMs: null };

  const lastVisitorIndex = sorted.map((row) => row.senderType).lastIndexOf(1);
  const mindRowsSince = (lastVisitorIndex === -1 ? sorted : sorted.slice(lastVisitorIndex + 1)).filter(
    (row) => row.senderType !== 1,
  );

  const substantiveReply = mindRowsSince.find(
    (row) => !SEEN_ACK_PREFIX.test(messageToText(row.messageText)),
  );
  if (substantiveReply) {
    return {
      mindStatus: 'mind_replied',
      lastActivityAgeMs: Date.now() - new Date(substantiveReply.createdAt).getTime(),
    };
  }

  const seenAck = mindRowsSince.find((row) => SEEN_ACK_PREFIX.test(messageToText(row.messageText)));
  if (seenAck) {
    return { mindStatus: 'mind_seen', lastActivityAgeMs: Date.now() - new Date(seenAck.createdAt).getTime() };
  }

  if (lastVisitorIndex === -1) {
    // No visitor message at all yet on this alias — fall back to "who spoke last."
    const last = sorted[sorted.length - 1];
    return {
      mindStatus: last.senderType === 1 ? 'waiting_on_mind' : 'mind_replied',
      lastActivityAgeMs: Date.now() - new Date(last.createdAt).getTime(),
    };
  }

  return {
    mindStatus: 'waiting_on_mind',
    lastActivityAgeMs: Date.now() - new Date(sorted[lastVisitorIndex].createdAt).getTime(),
  };
}

export async function mindChatInit(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  try {
    const { history } = await ensureProducerReady(env, session.mindId);
    return json({ history });
  } catch (err) {
    if (err.message === 'not_configured') return json({ error: 'not_configured' }, 500);
    if (err.briefingFailed) return json({ error: 'briefing_failed', detail: err.message }, 500);
    throw err;
  }
}

// A visitor's own send rate, separate from the connect-time rate limit — protects the
// Mind from a flood of rapid messages just as much as the initial handshake does.
const SEND_MIN_INTERVAL_MS = 3_000;
const lastSendAt = new Map();

export async function mindChatSend(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const now = Date.now();
  const last = lastSendAt.get(session.connectionId) ?? 0;
  if (now - last < SEND_MIN_INTERVAL_MS) return json({ error: 'rate_limited' }, 429);

  const body = await request.json().catch(() => ({}));
  const messageText = typeof body.messageText === 'string' ? body.messageText.trim() : '';
  if (!messageText) return json({ error: 'messageText required' }, 400);

  let result;
  try {
    result = await relayToMind(env, session.mindId, messageText);
  } catch (err) {
    if (err.message === 'not_configured') return json({ error: 'not_configured' }, 500);
    throw err;
  }
  lastSendAt.set(session.connectionId, now);

  return json({ before: result.before });
}

export async function mindChatPoll(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { searchParams } = new URL(request.url);
  const afterMs = Number(searchParams.get('after')) || 0;

  let history;
  try {
    history = await fetchMindActivity(env, session.mindId, { limit: 50, afterMs });
  } catch (err) {
    if (err.message === 'not_configured') return json({ error: 'not_configured' }, 500);
    throw err;
  }
  return json({ history });
}
