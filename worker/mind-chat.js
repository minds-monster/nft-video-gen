// The ongoing chat, once a visitor's session is live. Session-gated; only ever relays
// a real, human-typed message to the connected Mind — never a synthetic ping, per
// Adam's own cognition-budget concern from the brainstorm.

import { mindsClient, chatAlias } from './minds.js';
import { requireSession } from './session.js';
import { buildProducerBriefing, BRIEFING_HISTORY_MARKER } from './producer-briefing.js';
import { collectProductionState, putSnapshot, recordConnect } from './producer-state.js';
import { chat } from './nvidia.js';
import { messageToText } from '../src/lib/text.js';
import { parseMail, formatMail, SEEN_ACK_PREFIX, SUBJECT_MAX } from '../src/lib/mail.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// Re-exported, not defined here: it moved to worker/session.js next to verifySession so
// worker/producer-state.js could use it without creating an import cycle. worker/budget.js
// and the storyboarder still import it from this module.
export { requireSession };

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
    (row) => row.senderType === 1 && row.messageText?.includes(BRIEFING_HISTORY_MARKER),
  );
  if (!alreadyBriefed && briefingInHistory) {
    alreadyBriefed = '1';
    await env.MIND_CONNECTIONS.put(briefedKey, '1');
  }

  if (!alreadyBriefed) {
    try {
      // The briefing carries the visitor's actual production state, so the Mind's first
      // mail can meet them where they are instead of greeting a visitor holding a
      // finished storyboard as if they had just arrived. Never let a state read fail the
      // briefing: a greeting without the state block is worse, not broken.
      const state = await collectProductionState(env, mindId).catch(() => null);
      await client.sendMessage({ alias, messageText: buildProducerBriefing(state) });
      await env.MIND_CONNECTIONS.put(briefedKey, '1');
      history = await client.getHistory(alias, { limit: 50 });
    } catch (err) {
      const wrapped = new Error(err?.message);
      wrapped.briefingFailed = true;
      throw wrapped;
    }
  }

  return { alias, history: visibleHistory(history) };
}

/**
 * Strip the rows a visitor must never see in their Inbox.
 *
 * The briefing is the whole reason this exists. The Builder API has no system-prompt
 * channel, so a briefing is delivered as an ordinary message from the account holding
 * MINDS_BUILDER_API_KEY — which means it arrives tagged `senderType === 1` and the Inbox
 * used to render it, verbatim, as a wall of instructions written by the visitor
 * themselves, with their Mind visibly answering it. Filtering here rather than only in
 * the client means no cached history, no other consumer, and no future surface can leak
 * it back.
 *
 * Matches both the `[briefing]` marker and the pre-marker text, because every Mind
 * connected before this shipped has one of the old ones sitting in its history.
 */
export function visibleHistory(history) {
  return markHeldReplies(history).filter((row) => parseMail(row.messageText).kind !== 'briefing');
}

/**
 * Catch the one failure the `[briefing]` marker can't prevent on its own: the Mind
 * replying to the briefing anyway.
 *
 * Adam asked for this explicitly — "the belt-and-braces is engineering on the site side,
 * not in my behavior. My behavior is the marker convention. The site's job is to make my
 * convention enforceable even when I forget it." A cognition cycle that treats the
 * briefing as a message demanding an answer would otherwise put "Understood, thanks for
 * the context" in front of the visitor as their Mind's opening words.
 *
 * Deliberately narrow. A row is only flagged when ALL of these hold, which is precisely
 * the shape of a reply-to-briefing and nothing else:
 *   - it is from the Mind, and is not a `[seen ...]` acknowledgment
 *   - it carries no Subject header, so it is not the first mail
 *   - it lands after a briefing, with no visitor message in between
 *   - no subject-bearing mail from the Mind has arrived yet
 *
 * Marked rather than dropped: the client hides a held row while it is fresh and surfaces
 * it with an explanation once the window has passed, so a Mind that simply never adopts
 * the Subject convention still reaches its visitor instead of vanishing into a dead inbox.
 */
export function markHeldReplies(history) {
  const rows = [...(history ?? [])].sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
  let briefed = false;
  let greeted = false;

  const held = new Set();
  for (const row of rows) {
    const mail = parseMail(row.messageText);
    if (mail.kind === 'briefing') {
      briefed = true;
      continue;
    }
    if (row.senderType === 1) {
      // A real visitor message ends the greeting window: from here on the Mind is
      // answering a person, and anything it says belongs in front of them.
      briefed = false;
      continue;
    }
    if (mail.kind === 'ack') continue;
    if (mail.subject) {
      greeted = true;
      continue;
    }
    if (briefed && !greeted) held.add(row.fingerprint);
  }

  if (!held.size) return history ?? [];
  return (history ?? []).map((row) => (held.has(row.fingerprint) ? { ...row, heldPreGreeting: true } : row));
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
  return visibleHistory(raw).filter((row) => new Date(row.createdAt).getTime() > cutoffMs);
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
// SEEN_ACK_PREFIX now lives in src/lib/mail.js alongside the rest of the wire
// conventions, imported above. It used to be defined here AND copy-pasted into the Inbox
// component — two copies of a regex that have to agree is a bug waiting for someone to
// edit one of them. Still tested against messageToText(), never the raw field: Hello
// Minds wraps replies in HTML (`<p>[seen ...] On it.</p>`), which defeats a prefix
// anchored at the start of the string.

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

/**
 * Pure: how many visitor messages are sitting unanswered, and how long the oldest of
 * them has been waiting. This is Adam's own "aging cue" ask from the Producer Inbox
 * brainstorm ("3 items, oldest from 6h ago") — a count and an age, not a single status.
 */
export function deriveQueueDepth(history) {
  const sorted = [...(history ?? [])].sort(
    (a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0),
  );
  const lastReplyIndex = sorted
    .map((row) => row.senderType !== 1 && !SEEN_ACK_PREFIX.test(messageToText(row.messageText)))
    .lastIndexOf(true);

  const unanswered = (lastReplyIndex === -1 ? sorted : sorted.slice(lastReplyIndex + 1)).filter(
    (row) => row.senderType === 1,
  );
  if (!unanswered.length) return { count: 0, oldestAgeMs: null };

  return {
    count: unanswered.length,
    oldestAgeMs: Date.now() - new Date(unanswered[0].createdAt).getTime(),
  };
}

// Adam's own three-state model from the brainstorm: "no continuous online for me."
// `active` (replied within the last hour), `working` (a [seen] ack sent but no
// substantive reply yet), `inactive` (no cognition cycle — reply or ack — in
// LIVENESS_INACTIVE_MS). Never "online"/"offline"; those imply a continuity a Mind
// running on cognition cycles doesn't actually have.
const LIVENESS_ACTIVE_MS = 60 * 60 * 1000;
const LIVENESS_INACTIVE_MS = 24 * 60 * 60 * 1000;

/** Pure: derive Adam's three-state liveness model from a Mind's Producer history. */
export function deriveLivenessState(history) {
  const sorted = [...(history ?? [])].sort(
    (a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0),
  );
  const mindRows = sorted.filter((row) => row.senderType !== 1);
  if (!mindRows.length) return 'inactive';

  const lastReply = [...mindRows].reverse().find((row) => !SEEN_ACK_PREFIX.test(messageToText(row.messageText)));
  if (lastReply && Date.now() - new Date(lastReply.createdAt).getTime() < LIVENESS_ACTIVE_MS) return 'active';

  const lastMindRow = mindRows[mindRows.length - 1];
  const lastMindAgeMs = Date.now() - new Date(lastMindRow.createdAt).getTime();
  if (lastMindAgeMs < LIVENESS_INACTIVE_MS) return 'working';

  return 'inactive';
}

export async function mindChatInit(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  // The client's production snapshot rides in on init, BEFORE the briefing is composed
  // below — the ordering is the whole point. The prompt, cast and screenplay live only in
  // the browser's React state (src/hooks/useCanvasComposer.js, useScreenwriter.js) and are
  // never persisted server-side, so this request is the only moment we can learn that a
  // visitor arrived already holding a screenplay. Getting it after the briefing would be
  // getting it too late.
  const body = await request.json().catch(() => ({}));
  if (body?.state) await putSnapshot(env, session.mindId, body.state);
  await recordConnect(env, session.mindId).catch(() => null);

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

/**
 * A subject for a visitor who left the field blank.
 *
 * Adam's position was "receive bare, title in my reply" — he'd rather read the visitor's
 * intent and name the thread himself than have the site guess. His objection, though, was
 * to GENERIC titles ("Conversation started on Aug 25"), which make every thread look
 * identical in the list. A title drawn from the actual body is not that. So we generate
 * one, and tag it `Subject-Source: auto` on the wire so he knows the visitor didn't write
 * it and is free to re-title in his reply — which the Inbox then adopts. He keeps titling
 * authority; the visitor never stares at a list of "Untitled".
 *
 * Falls back to the first sentence rather than failing the send. A mail with a clumsy
 * subject is worth vastly more than a mail that didn't go.
 */
const heuristicSubject = (text) =>
  text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0].slice(0, SUBJECT_MAX).trim() || 'Message';

async function generateSubject(env, text) {
  if (!env.ASSISTANT_API_KEY || !env.ASSISTANT_MODEL) return heuristicSubject(text);
  try {
    const response = await chat(env, {
      model: env.ASSISTANT_MODEL,
      apiKey: env.ASSISTANT_API_KEY,
      messages: [
        {
          role: 'system',
          content:
            'Write an email subject line for the message the user sends. Six words maximum, no quotes, ' +
            'no trailing period, no "Subject:" prefix. Describe what the message is about. Reply with ' +
            'the subject line and nothing else.',
        },
        { role: 'user', content: text.slice(0, 2000) },
      ],
      temperature: 0.3,
      max_tokens: 24,
    });
    const line = String(response?.choices?.[0]?.message?.content ?? '')
      .split('\n')[0]
      .replace(/^subject:\s*/i, '')
      .replace(/^["']|["'.]+$/g, '')
      .trim();
    return line ? line.slice(0, SUBJECT_MAX) : heuristicSubject(text);
  } catch (err) {
    console.warn('Auto-subject generation failed, using heuristic:', err?.message ?? err);
    return heuristicSubject(text);
  }
}

export async function mindChatSend(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const now = Date.now();
  const last = lastSendAt.get(session.connectionId) ?? 0;
  if (now - last < SEND_MIN_INTERVAL_MS) return json({ error: 'rate_limited' }, 429);

  const body = await request.json().catch(() => ({}));
  const messageText = typeof body.messageText === 'string' ? body.messageText.trim() : '';
  if (!messageText) return json({ error: 'messageText required' }, 400);

  const isReply = Boolean(body.isReply);
  const typed = typeof body.subject === 'string' ? body.subject.trim().slice(0, SUBJECT_MAX) : '';
  // A reply always inherits its thread's subject, so it never needs one generated.
  const subject = typed || (isReply ? '' : await generateSubject(env, messageText));
  const wire = formatMail({
    subject,
    body: messageText,
    reply: isReply,
    subjectSource: subject && !typed ? 'auto' : null,
  });

  let result;
  try {
    result = await relayToMind(env, session.mindId, wire);
  } catch (err) {
    if (err.message === 'not_configured') return json({ error: 'not_configured' }, 500);
    throw err;
  }
  lastSendAt.set(session.connectionId, now);

  // The subject goes back to the client so the optimistic row it already painted shows
  // exactly what was sent, rather than differing from what the Mind actually received.
  return json({ before: result.before, subject, messageText: wire });
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
