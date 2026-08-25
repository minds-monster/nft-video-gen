// Email structure for the Producer Inbox, encoded inside `messageText`.
//
// The Hello Minds transport has no subject field — `SendMessageBody` is
// `{ alias, messageText, ... }` and nothing else (see the client lib's index.d.ts).
// `MessageRecord.subject` exists on the READ side but the platform never populates it.
// So the whole of email's structure has to live in the message body as a header
// convention that both sides agree to, exactly like the `[seen <ISO>]` acknowledgment
// that already works this way.
//
// The convention is Adam's own, committed to in the connect-mind-brainstorm thread:
//
//   Subject: <line>
//   [Subject-Source: auto]
//
//   <body>
//
// with `Subject: RE: <original>` for replies. This module owns parsing it, formatting
// it, and deriving threads from a flat conversation history. Kept runtime-agnostic (no
// DOM, no `env`) because worker/mind-chat.js imports it too — the same arrangement as
// src/lib/text.js.

import { messageToText } from './text.js';

// A `[seen ...]` row is an acknowledgment, not a reply. Single definition, imported by
// both worker/mind-chat.js and the Inbox — it used to be copy-pasted into both, and two
// copies of a regex that has to agree is a bug waiting for someone to edit one of them.
//
// Always tested against messageToText(), never the raw field: Hello Minds wraps replies
// in HTML (`<p>[seen ...] On it.</p>`), which defeats a prefix anchored at the start.
export const SEEN_ACK_PREFIX = /^\s*\[seen\b/i;

// The briefing marker. Adam's commitment is "context in, conversation out, with a hard
// separator": a `[briefing]`-prefixed message is context he absorbs and never replies to.
// Our half of that bargain is never rendering one as a message from the visitor, which is
// exactly the bug this convention exists to kill.
export const BRIEFING_PREFIX = /^\s*\[briefing\b/i;

// Briefings sent before the marker existed. Every already-connected Mind has one of these
// sitting in its history, and it has to stay filtered out too. Matches the string the
// `briefed:` flag self-repair in worker/mind-chat.js already keys on, deliberately.
export const LEGACY_BRIEFING_MARKER = 'Producer briefing';

// Adam's ask: pin the emergency convention now, because "emergency conventions designed
// under pressure look like emergency conventions designed under pressure."
const ATTENTION_TAG = /^\s*(?:\[attention\]|⚠️?)\s*/i;

// A bracketed tag at the very start of a message, used by the site's own automated
// digests — [Storyboarder], [Previs Supervisor], [Post-mortem], [Auto-forwarded ...].
// Deliberately generic rather than an enumerated list, so a digest added later still gets
// system chrome instead of silently impersonating the Mind's own voice.
const SYSTEM_TAG = /^\s*\[([A-Za-z][\w' -]{2,40}?)\]\s*/;

const SUBJECT_LINE = /^subject:\s*(.*)$/i;
const SUBJECT_SOURCE_LINE = /^subject-source:\s*(auto|visitor|mind)\s*$/i;

// Leading RE: chains, at any depth and any casing. Adam: "If the chain has gone 5 deep,
// 'RE: RE: RE: RE: RE: <original>' is noise. Display 'RE: <original>' regardless of depth.
// The site handles the parsing; I never have to think about how many RE:'s I'm writing."
const RE_CHAIN = /^(?:\s*re\s*:\s*)+/i;

// Adam's length budget: long enough to describe, short enough that the inbox list never
// truncates — "truncation makes subjects indistinguishable from each other."
export const SUBJECT_MAX = 60;

// The ceiling on what we will believe is a subject line rather than a paragraph that
// happens to open with the word "Subject". Generous against SUBJECT_MAX because a Mind
// running slightly long should still thread correctly, not fail open.
const SUBJECT_PARSE_MAX = 120;

/**
 * Does this look like an actual subject line, or a sentence that starts with "Subject"?
 *
 * Adam's rule, and the reason this leans the way it does: "False positives are worse than
 * false negatives, because the visitor can rename a thread but can't easily merge two."
 * So anything ambiguous fails open — it becomes a reply to the open thread rather than a
 * new thread with a mangled title.
 *
 * We cannot use "is the next line blank" as the signal, tempting as it is: messageToText
 * turns `<p>Subject: X</p><p>body</p>` into "Subject: X\nbody", a single newline, so the
 * blank line is gone by the time we see it for every HTML-wrapped Mind reply.
 */
function looksLikeSubject(candidate) {
  if (!candidate) return false;
  if (candidate.length > SUBJECT_PARSE_MAX) return false;
  // An internal sentence break means we are looking at prose, not a title.
  if (/[.!?]\s+\S/.test(candidate)) return false;
  return true;
}

/** Strip a leading RE: chain, returning the bare subject and whether one was present. */
function stripReChain(subject) {
  const stripped = subject.replace(RE_CHAIN, '').trim();
  return { subject: stripped, isReply: stripped !== subject.trim() };
}

/**
 * The key two subjects must share to land in the same thread. Case- and
 * whitespace-insensitive, and blind to both the RE: chain and the [attention] tag — an
 * urgent reply still belongs to the thread it answers.
 */
export function threadKey(subject) {
  if (!subject) return null;
  return stripReChain(subject)
    .subject.replace(ATTENTION_TAG, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/**
 * Parse one message into its mail shape.
 *
 * Accepts the raw `messageText` straight off the wire and normalizes internally, so no
 * caller can forget the messageToText() step and silently break on HTML-wrapped replies.
 *
 * Returns `{ kind, subject, subjectSource, isReply, urgent, systemTag, body }` where
 * `kind` is one of:
 *   'briefing' — context for the Mind; never rendered
 *   'ack'      — a `[seen ...]` marker; a status, not a message
 *   'system'   — an automated site digest; its own chrome, never the Mind's voice
 *   'mail'     — everything else, with or without a subject header
 */
export function parseMail(rawText) {
  const text = messageToText(rawText).trim();

  if (BRIEFING_PREFIX.test(text) || text.includes(LEGACY_BRIEFING_MARKER)) {
    return { kind: 'briefing', subject: null, subjectSource: null, isReply: false, urgent: false, systemTag: null, body: text };
  }
  if (SEEN_ACK_PREFIX.test(text)) {
    return { kind: 'ack', subject: null, subjectSource: null, isReply: false, urgent: false, systemTag: null, body: text };
  }

  const lines = text.split('\n');
  const header = lines[0]?.match(SUBJECT_LINE);
  let subject = null;
  let subjectSource = null;
  let isReply = false;
  let urgent = false;
  let body = text;

  if (header && looksLikeSubject(header[1].trim())) {
    let consumed = 1;
    const sourceMatch = lines[1]?.match(SUBJECT_SOURCE_LINE);
    if (sourceMatch) {
      subjectSource = sourceMatch[1].toLowerCase();
      consumed = 2;
    }
    const raw = header[1].trim();
    ({ subject, isReply } = stripReChain(raw));
    urgent = ATTENTION_TAG.test(subject);
    subject = subject.replace(ATTENTION_TAG, '').trim();
    body = lines.slice(consumed).join('\n').trim();

    // A header with nothing under it is not a mail — it is a one-line message that
    // happens to begin with "Subject:". Fail open, per the rule above.
    if (!body) {
      return { kind: 'mail', subject: null, subjectSource: null, isReply: true, urgent: false, systemTag: null, body: text };
    }
  }

  // Only look for a system tag on messages that did not carry a subject header — a Mind
  // writing "Subject: [attention] ..." is urgent mail, not a site digest.
  if (!subject) {
    const tag = text.match(SYSTEM_TAG);
    if (tag) {
      return {
        kind: 'system',
        subject: tag[1],
        subjectSource: null,
        isReply: false,
        urgent: /attention/i.test(tag[1]),
        systemTag: tag[1],
        body: text.replace(SYSTEM_TAG, '').trim(),
      };
    }
    // No header at all. Fail open: this threads into the newest open conversation rather
    // than starting one, which is what keeps every message already sitting in every
    // existing conversation rendering sensibly after this ships.
    return { kind: 'mail', subject: null, subjectSource: null, isReply: true, urgent: false, systemTag: null, body: text };
  }

  return { kind: 'mail', subject, subjectSource, isReply, urgent, systemTag: null, body };
}

/**
 * Build the outgoing `messageText` for a mail. The header always leads, so the Mind's
 * own parser (and ours, on the way back) sees it first.
 *
 * `subjectSource: 'auto'` is what tells the Mind the visitor did not write this subject —
 * we generated it from their body because they left the field blank. Adam keeps titling
 * authority: he is free to re-title in his reply, and the thread takes his subject.
 */
export function formatMail({ subject, body, reply = false, subjectSource = null }) {
  const clean = String(subject ?? '').replace(RE_CHAIN, '').trim().slice(0, SUBJECT_MAX);
  const line = reply && clean ? `RE: ${clean}` : clean;
  const header = [
    line ? `Subject: ${line}` : null,
    subjectSource ? `Subject-Source: ${subjectSource}` : null,
  ].filter(Boolean);
  if (!header.length) return String(body ?? '').trim();
  return `${header.join('\n')}\n\n${String(body ?? '').trim()}`;
}

/**
 * Fold a flat conversation history into threads.
 *
 * Replaces the old `buildItems`, which paired each visitor message with the next Mind
 * reply and had no notion of a subject at all. Pure derivation over the same history the
 * poll already returns — no new storage, and it works retroactively on conversations that
 * predate the convention, because headerless messages fail open into the newest thread.
 *
 * Returns threads newest-activity-first, each `{ key, subject, urgent, messages[],
 * lastAt, seenAck, mindReplied }`. Briefings are dropped entirely; acks attach as thread
 * status rather than becoming rows of their own.
 */
export function buildThreads(messages) {
  const chronological = [...(messages ?? [])]
    .filter((msg) => msg?.createdAt)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const threads = [];
  const byKey = new Map();
  let newest = null;

  const open = (mail, msg, kind = 'mail') => {
    const key = threadKey(mail.subject) ?? `untitled-${msg.fingerprint}`;
    const thread = {
      key: kind === 'system' ? `system-${msg.fingerprint}` : key,
      kind,
      subject: mail.subject,
      urgent: mail.urgent,
      messages: [],
      seenAck: null,
      lastAt: msg.createdAt,
    };
    threads.push(thread);
    if (kind !== 'system') byKey.set(key, thread);
    return thread;
  };

  for (const msg of chronological) {
    const mail = parseMail(msg.messageText);
    if (mail.kind === 'briefing') continue;

    if (mail.kind === 'ack') {
      // An acknowledgment is a status on whatever is currently open, never a row.
      if (newest) newest.seenAck = msg;
      continue;
    }

    // A site digest is its own standalone notice. Deliberately does NOT become `newest`:
    // a [Storyboarder] digest landing mid-conversation must not capture the Mind's next
    // headerless reply into itself.
    if (mail.kind === 'system') {
      open(mail, msg, 'system').messages.push({ ...msg, mail });
      continue;
    }

    let thread;
    if (mail.subject && !mail.isReply && newest && !newest.subject) {
      // The naming act. Adam's chosen shape for a visitor who writes with no subject is
      // "receive bare, title in my reply" — so a fresh subject arriving while an untitled
      // thread is open is him NAMING that thread, not starting a rival one. Without this
      // the visitor is left staring at an "Untitled" row sitting next to the titled reply
      // that was meant to be its answer.
      thread = newest;
    } else if (mail.subject && !mail.isReply) {
      // Otherwise a fresh subject always opens a thread, even if the title repeats an old
      // one — reusing a subject to mean "same conversation" is the reply's job.
      thread = open(mail, msg);
    } else if (mail.subject) {
      thread = byKey.get(threadKey(mail.subject)) ?? open(mail, msg);
    } else {
      // Headerless, including every message written before this convention existed, and
      // every bare visitor message. Adam's default: thread into the most recent active
      // conversation rather than surprising anyone with a new one.
      thread = newest ?? open(mail, msg);
    }

    thread.messages.push({ ...msg, mail });
    thread.lastAt = msg.createdAt;
    // A substantive message supersedes any pending acknowledgment: "seen" only means
    // anything while nothing has actually been said since.
    thread.seenAck = null;
    if (mail.urgent) thread.urgent = true;
    // A thread that started life untitled takes the first real subject it is given —
    // usually the Mind's reply, which is exactly how a bare visitor message gets a name.
    if (!thread.subject && mail.subject) {
      thread.subject = mail.subject;
      byKey.set(threadKey(mail.subject), thread);
    }
    newest = thread;
  }

  // Adam's three-state read model, derived from the thread's tail rather than tracked as
  // a sticky flag — "replied" has to stop being true the moment the visitor writes again,
  // otherwise the pill lies about who is waiting on whom.
  for (const thread of threads) {
    const last = thread.messages[thread.messages.length - 1];
    if (thread.seenAck) thread.state = 'processing';
    else if (last && last.senderType !== 1) thread.state = 'replied';
    else thread.state = 'awaiting';
  }

  return threads.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
}
