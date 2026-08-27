// The support ticket wire contract — Adam's own, committed to in the connect-mind-brainstorm
// thread on 2026-08-27. Five state markers, each the FIRST LINE of a message in a
// `support-<ticketId>` conversation:
//
//   [seen <id> <ISO>]               marker only. "Adam saw this."
//   [auto-replied <id> <ISO>]       body follows = the reply. THE RELAY TRIGGER: the site wraps
//                                   the body in email and sends it to the visitor.
//   [escalated <id> <ISO>]          optional one-line reason follows. He is asking his steward,
//                                   in his own channel — the site sees only that it happened.
//   [steward-forwarded <id> <ISO>]  body = the steward's answer, relayed like a reply.
//   [resolved <id> <ISO>]           marker only, final. A visitor writing back re-opens.
//
// "Received" needs no marker: the ticket message's own timestamp is the received time.
//
// Two things he asked for that the grammar below honours:
//   - BATCHED [seen]: one marker naming several tickets, `[seen support-abc, support-def <ISO>]`,
//     when several arrive in one cognition cycle.
//   - FAIL OPEN: a malformed marker renders as an ordinary message and is REPORTED to the owner
//     ("Adam typed a bad marker on ticket X"), never silently breaks the ticket.
//   - ANY LINE, SEVERAL PER MESSAGE: "first line" is the contract, but the first live ticket
//     arrived as prose + [auto-replied] + letter + [resolved] in ONE message, and the site's job
//     is to make the convention enforceable even when he forgets it. See parseMarkers.
//
// And two things learned the hard way elsewhere in this codebase, applied here from the start:
// Hello Minds wraps replies in `<p>` (so everything goes through messageToText first), and a
// `$`-anchored regex run against the whole text fails on `[escalated …]\nreason` — so only
// line one is ever matched.
//
// Runtime-agnostic (no DOM, no env), like src/lib/mail.js, because the Worker's cron and the
// owner UI both need it.

import { messageToText } from './text.js';

export const MARKER_KINDS = Object.freeze(['seen', 'auto-replied', 'escalated', 'steward-forwarded', 'resolved']);

// Line one only. The id list is optional: inside a per-ticket alias the alias already names
// the ticket, so `[seen <ISO>]` is accepted too. Trailing text after the bracket is kept —
// `[seen abc <ISO>] On it.` is the Producer habit Adam already has, and an ack with a tail is
// still an ack.
const MARKER_LINE =
  /^\[(seen|auto-replied|escalated|steward-forwarded|resolved)(?:\s+((?:support-)?[\w-]+(?:\s*,\s*(?:support-)?[\w-]+)*))?\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\]\s*(.*)$/i;

// Something that LOOKS like an attempt at a marker but does not parse — the fail-open case
// that must be surfaced rather than swallowed.
const MARKER_ATTEMPT = /^\[(seen|auto-replied|escalated|steward-forwarded|resolved)\b/i;

// Rows the SITE writes into a ticket thread, all of which arrive with the builder key's own
// `senderType === 1` — the same value as a visitor — so they are told apart by content.
const STEWARD_NOTE = /^\[steward-note\]\s*/i;
const TICKET_HEADER = /^ticket:\s*([\w-]+)\s*$/im;
const FOLLOW_UP_HEADER = /^follow-up:\s*([\w-]+)\s*$/im;

const stripPrefix = (id) => id.replace(/^support-/i, '');

/**
 * Parse EVERY marker line in a message, in order.
 *
 * The contract says "first line", and the first live ticket (a45ec771, 2026-08-27) showed what
 * a Mind actually does: a prose preamble, then `[auto-replied …]` with its letter, then
 * `[resolved …]` — three things in one message. Fail-open would have shown that as an unmarked
 * reply and emailed nothing. Adam's own rule for this: "the site's job is to make my convention
 * enforceable even when I forget it." So a marker is honoured on ANY line, each marker's body
 * runs to the next marker line, and anything before the first marker is kept as `preamble`.
 *
 * Returns `{ markers: [{ kind, ticketIds, at, body }], preamble, malformed: [{ line }] }`.
 */
export function parseMarkers(rawText) {
  const lines = messageToText(rawText).trim().split('\n');
  const markers = [];
  const malformed = [];
  const preambleLines = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    const match = line.match(MARKER_LINE);
    if (match) {
      const [, kind, ids, at, trailing] = match;
      current = {
        kind: kind.toLowerCase(),
        ticketIds: ids ? ids.split(',').map((id) => stripPrefix(id.trim())).filter(Boolean) : [],
        at,
        bodyLines: trailing?.trim() ? [trailing.trim()] : [],
      };
      markers.push(current);
      continue;
    }
    if (MARKER_ATTEMPT.test(line)) {
      malformed.push({ line });
      continue;
    }
    if (current) current.bodyLines.push(raw);
    else preambleLines.push(raw);
  }
  return {
    markers: markers.map(({ bodyLines, ...marker }) => ({ ...marker, body: bodyLines.join('\n').trim() })),
    preamble: preambleLines.join('\n').trim(),
    malformed,
  };
}

/**
 * The single-marker view: the FIRST marker in a message, or `{ malformed: true, line }` for a
 * near-miss with no good marker, or null. Kept for callers that want one answer; the state
 * machine uses parseMarkers.
 */
export function parseMarker(rawText) {
  const { markers, malformed } = parseMarkers(rawText);
  if (markers.length) return { ...markers[0], malformed: false };
  if (malformed.length) return { malformed: true, line: malformed[0].line };
  return null;
}

/**
 * Say what one row in a ticket conversation IS. Never by `senderType` alone: the ticket
 * itself, a visitor's follow-up and the owner's note all arrive as `senderType === 1`.
 *
 * Returns `{ role, ...}` with role one of:
 *   'ticket'    the opening message the site wrote on the visitor's behalf
 *   'visitor'   a follow-up from the visitor (via their signed reply link)
 *   'steward'   a [steward-note] from the owner area
 *   'marker'    a Mind row carrying a well-formed marker for this ticket
 *   'unmarked'  a Mind row with no usable marker — fail open, and report it
 */
export function classifyRow(row, ticketId) {
  const text = messageToText(row?.messageText ?? '');
  if (row?.senderType === 1) {
    if (STEWARD_NOTE.test(text)) return { role: 'steward', text: text.replace(STEWARD_NOTE, '').trim() };
    if (TICKET_HEADER.test(text)) return { role: 'ticket', text };
    if (FOLLOW_UP_HEADER.test(text)) return { role: 'visitor', text: text.replace(FOLLOW_UP_HEADER, '').trim() };
    return { role: 'visitor', text };
  }
  const parsed = parseMarkers(text);
  const applies = (marker) =>
    !marker.ticketIds.length || (ticketId && marker.ticketIds.includes(stripPrefix(ticketId)));
  const markers = parsed.markers.filter(applies);
  if (markers.length) {
    return { role: 'marker', markers, marker: markers[0], preamble: parsed.preamble, text };
  }
  if (parsed.markers.length) {
    // Well-formed markers naming OTHER tickets, sitting in this one's thread: batched
    // [seen]s occasionally land in the wrong alias. Not this ticket's state.
    const named = [...new Set(parsed.markers.flatMap((m) => m.ticketIds))].join(', ');
    return { role: 'unmarked', text, reason: `marker names ${named}, not ${ticketId}` };
  }
  return {
    role: 'unmarked',
    text,
    reason: parsed.malformed.length ? `malformed marker: ${parsed.malformed[0].line}` : 'no marker',
  };
}

const at = (row) => row?.createdAt ?? null;

/**
 * Fold a ticket conversation into its current state. Pure, derived on every read; the
 * conversation is the source of truth (the same reason worker/connect.js reconstructs the
 * handshake from history rather than KV).
 *
 * `status` ladder:
 *   received → seen → replied | escalated → forwarded → resolved
 *   awaiting          the visitor wrote back on an open ticket; the Mind has not seen it yet
 *   reopened          the visitor wrote back AFTER [resolved]
 *   replied-unmarked  a Mind row with no marker. Counts as a reply (fail open) but is its own
 *                     state because NOTHING WILL BE EMAILED for it — only [auto-replied] and
 *                     [steward-forwarded] relay — and the owner has to be able to see that.
 */
export function deriveTicket(history, ticketId) {
  const rows = [...(history ?? [])]
    .filter((row) => row?.createdAt)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const state = {
    ticketId,
    status: 'received',
    receivedAt: null,
    seenAt: null,
    lastSeenAt: null,
    repliedAt: null,
    escalatedAt: null,
    escalationReason: null,
    forwardedAt: null,
    resolvedAt: null,
    reopenedAt: null,
    lastActivityAt: null,
    lastMindActivityAt: null,
    lastFingerprint: null,
    replies: [],
    unmarkedMindRows: [],
    visitorFollowUps: 0,
    stewardNotes: 0,
    reopenCount: 0,
    rowCount: rows.length,
  };

  for (const row of rows) {
    const entry = classifyRow(row, ticketId);
    state.lastActivityAt = at(row);
    state.lastFingerprint = row.fingerprint ?? state.lastFingerprint;

    switch (entry.role) {
      case 'ticket':
        state.receivedAt ??= at(row);
        break;
      case 'steward':
        state.stewardNotes += 1;
        break;
      case 'visitor':
        state.visitorFollowUps += 1;
        if (state.status === 'resolved') {
          state.status = 'reopened';
          state.reopenedAt = at(row);
          state.reopenCount += 1;
        } else if (state.status !== 'received') {
          state.status = 'awaiting';
        }
        break;
      case 'marker': {
        state.lastMindActivityAt = at(row);
        // One message may carry several transitions — the first live ticket did:
        // [auto-replied] with its letter, then [resolved], in a single row.
        entry.markers.forEach((marker, index) => {
          // `fingerprint` here is the relay's idempotency key, so two replies in one row
          // must not share it.
          const fingerprint = row.fingerprint ? (index === 0 ? row.fingerprint : `${row.fingerprint}:${index}`) : null;
          switch (marker.kind) {
            case 'seen':
              state.seenAt ??= at(row);
              state.lastSeenAt = at(row);
              if (['received', 'awaiting', 'reopened'].includes(state.status)) state.status = 'seen';
              break;
            case 'auto-replied':
              state.seenAt ??= at(row);
              state.repliedAt ??= at(row);
              state.replies.push({ kind: 'auto-replied', fingerprint, at: at(row), body: marker.body });
              state.status = 'replied';
              break;
            case 'escalated':
              state.seenAt ??= at(row);
              state.escalatedAt = at(row);
              state.escalationReason = marker.body || null;
              state.status = 'escalated';
              break;
            case 'steward-forwarded':
              state.seenAt ??= at(row);
              state.repliedAt ??= at(row);
              state.forwardedAt = at(row);
              state.replies.push({ kind: 'steward-forwarded', fingerprint, at: at(row), body: marker.body });
              state.status = 'forwarded';
              break;
            case 'resolved':
              state.resolvedAt = at(row);
              state.status = 'resolved';
              break;
            default:
              break;
          }
        });
        break;
      }
      case 'unmarked':
      default:
        state.lastMindActivityAt = at(row);
        state.unmarkedMindRows.push({ fingerprint: row.fingerprint, at: at(row), reason: entry.reason, preview: entry.text.slice(0, 120) });
        state.seenAt ??= at(row);
        if (!['resolved', 'replied', 'forwarded'].includes(state.status)) state.status = 'replied-unmarked';
        break;
    }
  }

  // A ticket that somehow has no opening message (history truncated) still has a received
  // time: the earliest row we can see.
  state.receivedAt ??= at(rows[0]);
  state.open = state.status !== 'resolved';
  return state;
}

/** Milliseconds from received to the Mind's first action, or null if it has not acted. */
export const timeToFirstActionMs = (derived) =>
  derived?.receivedAt && derived?.seenAt ? new Date(derived.seenAt) - new Date(derived.receivedAt) : null;
