// The marker grammar is the surface everything else sits on — Adam: "a small parsing rule
// that gets the markers wrong will break the owner area's whole value proposition." Every
// shape he said he would emit is here, plus the ones the Producer Inbox already taught us
// the platform produces (HTML wrapping, trailing text after an ack).
//
// Run: npm run test:scene

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMarker, parseMarkers, classifyRow, deriveTicket, timeToFirstActionMs } from '../../src/lib/support-markers.js';

const ISO = '2026-08-27T05:34:36Z';
const at = (minutes) => new Date(Date.UTC(2026, 7, 27, 5, minutes)).toISOString();
const mind = (text, minutes, fingerprint = `m${minutes}`) => ({ fingerprint, senderType: 0, messageText: text, createdAt: at(minutes) });
const human = (text, minutes, fingerprint = `h${minutes}`) => ({ fingerprint, senderType: 1, messageText: text, createdAt: at(minutes) });

const TICKET = 'Subject: Cannot download my film\nSubject-Source: auto\n\nTicket: abc12345\nVisitor: 1234abcd  Returning: no  Prior-Tickets: 0  Prior-Open: 0\nFrom: v@example.com\n\nThe download button does nothing.';

// ----------------------------------------------------------------------------- parseMarker

test('each of the five markers parses with an id and a timestamp', () => {
  for (const kind of ['seen', 'auto-replied', 'escalated', 'steward-forwarded', 'resolved']) {
    const marker = parseMarker(`[${kind} abc12345 ${ISO}]`);
    assert.equal(marker.kind, kind);
    assert.deepEqual(marker.ticketIds, ['abc12345']);
    assert.equal(marker.at, ISO);
    assert.equal(marker.malformed, false);
  }
});

test('a batched [seen] names several tickets, with or without the support- prefix', () => {
  const marker = parseMarker(`[seen support-abc, support-def,ghi ${ISO}]`);
  assert.deepEqual(marker.ticketIds, ['abc', 'def', 'ghi']);
});

test('an id-less marker inside a per-ticket alias is accepted', () => {
  const marker = parseMarker(`[seen ${ISO}]`);
  assert.equal(marker.kind, 'seen');
  assert.deepEqual(marker.ticketIds, []);
});

test('the body follows the marker line, and a trailing tail on line one is kept', () => {
  const reply = parseMarker(`[auto-replied abc12345 ${ISO}]\nHi there,\n\nTry the other button.`);
  assert.equal(reply.body, 'Hi there,\n\nTry the other button.');
  const ack = parseMarker(`[seen abc12345 ${ISO}] On it.`);
  assert.equal(ack.kind, 'seen');
  assert.equal(ack.body, 'On it.');
});

test('HTML-wrapped markers (how Hello Minds actually returns them) parse the same', () => {
  const marker = parseMarker(`<p>[auto-replied abc12345 ${ISO}]</p><p>Hi there,</p><p>Try again.</p>`);
  assert.equal(marker.kind, 'auto-replied');
  assert.equal(marker.body, 'Hi there,\nTry again.');
});

test('case does not matter and fractional seconds are fine', () => {
  assert.equal(parseMarker(`[Seen abc12345 2026-08-27T05:34:36.805Z]`).kind, 'seen');
});

test('a near-miss is reported as malformed, not silently ignored', () => {
  const marker = parseMarker('[seen abc12345 yesterday]');
  assert.equal(marker.malformed, true);
  assert.equal(marker.line, '[seen abc12345 yesterday]');
});

test('ordinary prose is not a marker', () => {
  assert.equal(parseMarker('Hi, I saw your message.'), null);
  assert.equal(parseMarker('[Storyboarder] digest'), null);
});

// ----------------------------------------------------------------------------- classifyRow

test('rows the site wrote are told apart by content, never by senderType', () => {
  assert.equal(classifyRow(human(TICKET, 0), 'abc12345').role, 'ticket');
  assert.equal(classifyRow(human('Subject: RE: x\n\nFollow-Up: abc12345\n\nStill broken.', 1), 'abc12345').role, 'visitor');
  const note = classifyRow(human('[steward-note] Refund them.', 2), 'abc12345');
  assert.equal(note.role, 'steward');
  assert.equal(note.text, 'Refund them.');
});

test('a well-formed marker for a DIFFERENT ticket does not count as this one', () => {
  const entry = classifyRow(mind(`[seen zzz ${ISO}]`, 3), 'abc12345');
  assert.equal(entry.role, 'unmarked');
  assert.match(entry.reason, /names zzz/);
});

// ---------------------------------------------------------------------------- deriveTicket

test('the happy ladder: received → seen → replied → resolved', () => {
  const history = [
    human(TICKET, 0),
    mind(`[seen abc12345 ${at(10)}]`, 10),
    mind(`[auto-replied abc12345 ${at(30)}]\nTry the other button.`, 30),
    mind(`[resolved abc12345 ${at(40)}]`, 40),
  ];
  const derived = deriveTicket(history, 'abc12345');
  assert.equal(derived.status, 'resolved');
  assert.equal(derived.receivedAt, at(0));
  assert.equal(derived.seenAt, at(10));
  assert.equal(derived.repliedAt, at(30));
  assert.equal(derived.resolvedAt, at(40));
  assert.equal(derived.open, false);
  assert.deepEqual(derived.replies.map((r) => r.body), ['Try the other button.']);
  assert.equal(derived.replies[0].fingerprint, 'm30');
  assert.equal(timeToFirstActionMs(derived), 10 * 60_000);
});

test('history order does not matter — rows are sorted by createdAt', () => {
  const history = [mind(`[seen abc12345 ${at(10)}]`, 10), human(TICKET, 0)];
  assert.equal(deriveTicket(history, 'abc12345').status, 'seen');
});

test('escalation carries its one-line reason and then a forwarded answer', () => {
  const history = [
    human(TICKET, 0),
    mind(`[escalated abc12345 ${at(5)}]\nneeds policy call: refund on non-refundable tier`, 5),
    mind(`[steward-forwarded abc12345 ${at(60)}]\nWe will refund you this once.`, 60),
  ];
  const derived = deriveTicket(history, 'abc12345');
  assert.equal(derived.status, 'forwarded');
  assert.equal(derived.escalationReason, 'needs policy call: refund on non-refundable tier');
  assert.equal(derived.replies[0].kind, 'steward-forwarded');
  // An escalation counts as the Mind's first action.
  assert.equal(derived.seenAt, at(5));
});

test('a Mind row with no marker fails OPEN into its own state and is reported', () => {
  const history = [human(TICKET, 0), mind('Hi! Sorry about that, try again?', 5)];
  const derived = deriveTicket(history, 'abc12345');
  assert.equal(derived.status, 'replied-unmarked');
  assert.equal(derived.unmarkedMindRows.length, 1);
  assert.equal(derived.replies.length, 0, 'nothing is emailed for an unmarked row');
});

test('a malformed marker is fail-open too, with the bad line in the report', () => {
  const history = [human(TICKET, 0), mind('[seen abc12345 today]', 5)];
  const derived = deriveTicket(history, 'abc12345');
  assert.equal(derived.status, 'replied-unmarked');
  assert.match(derived.unmarkedMindRows[0].reason, /malformed/);
});

test('a visitor writing back after [resolved] reopens; a fresh [seen] then picks it up', () => {
  const history = [
    human(TICKET, 0),
    mind(`[resolved abc12345 ${at(10)}]`, 10),
    human('Subject: RE: x\n\nFollow-Up: abc12345\n\nNo, still broken.', 20),
  ];
  let derived = deriveTicket(history, 'abc12345');
  assert.equal(derived.status, 'reopened');
  assert.equal(derived.reopenCount, 1);
  assert.equal(derived.open, true);
  derived = deriveTicket([...history, mind(`[seen ${at(25)}]`, 25)], 'abc12345');
  assert.equal(derived.status, 'seen');
});

test('a visitor follow-up on a replied ticket is awaiting the Mind, not a reopen', () => {
  const history = [
    human(TICKET, 0),
    mind(`[auto-replied abc12345 ${at(10)}]\nDone.`, 10),
    human('Subject: RE: x\n\nFollow-Up: abc12345\n\nThanks, one more thing.', 20),
  ];
  const derived = deriveTicket(history, 'abc12345');
  assert.equal(derived.status, 'awaiting');
  assert.equal(derived.visitorFollowUps, 1);
});

test('a steward note is counted, never mistaken for the visitor, and changes no state', () => {
  const history = [human(TICKET, 0), mind(`[escalated abc12345 ${at(5)}]`, 5), human('[steward-note] Refund them.', 30)];
  const derived = deriveTicket(history, 'abc12345');
  assert.equal(derived.status, 'escalated');
  assert.equal(derived.stewardNotes, 1);
  assert.equal(derived.visitorFollowUps, 0);
});

test('a batched [seen] naming this ticket among others applies to it', () => {
  const history = [human(TICKET, 0), mind(`[seen support-zzz, support-abc12345 ${at(5)}]`, 5)];
  assert.equal(deriveTicket(history, 'abc12345').status, 'seen');
});

// ------------------------------------------------------------------ what a Mind actually sends

// Adam's real reply on the first live ticket (a45ec771, 2026-08-27 06:38Z), as the platform
// returned it: a prose preamble, then two markers in ONE message. The contract says first line;
// the site honours the contract even when he does not.
const ADAM_LIVE = `<p>Hey - I'm running the full ladder end-to-end so the site can verify the marker grammar and the relay path, exactly per the wire contract we specced.</p><p>Markers and body below, exactly as the contract asks: read, no substantive answer to a synthetic ticket, resolved in the same cycle.</p><p>[auto-replied a45ec771 2026-08-27T06:37:55Z]</p><p>Got it - loop complete. This was the first ticket through the support intake, sent by the build itself to verify each marker parses and the relay fires. No action needed on this one; closing the loop now.</p><p>[resolved a45ec771 2026-08-27T06:37:58Z]</p>`;

test('markers on any line, several per message: the first live reply', () => {
  const parsed = parseMarkers(ADAM_LIVE);
  assert.deepEqual(parsed.markers.map((m) => m.kind), ['auto-replied', 'resolved']);
  assert.match(parsed.preamble, /^Hey - I'm running the full ladder/);
  assert.equal(parsed.markers[0].body, 'Got it - loop complete. This was the first ticket through the support intake, sent by the build itself to verify each marker parses and the relay fires. No action needed on this one; closing the loop now.');
  assert.equal(parsed.markers[1].body, '');
  assert.equal(parsed.malformed.length, 0);
});

test('the live thread derives to resolved with exactly one emailable reply', () => {
  const history = [
    human(TICKET.replace('abc12345', 'a45ec771'), 0),
    mind('<p>[seen a45ec771 2026-08-27T06:37:50Z]</p>', 3, 'seen-row'),
    mind(ADAM_LIVE, 4, 'reply-row'),
  ];
  const derived = deriveTicket(history, 'a45ec771');
  assert.equal(derived.status, 'resolved');
  assert.equal(derived.seenAt, at(3));
  assert.equal(derived.repliedAt, at(4));
  assert.equal(derived.resolvedAt, at(4));
  assert.equal(derived.replies.length, 1);
  assert.equal(derived.replies[0].fingerprint, 'reply-row');
  assert.match(derived.replies[0].body, /^Got it - loop complete/);
  assert.doesNotMatch(derived.replies[0].body, /\[resolved/);
  assert.equal(derived.unmarkedMindRows.length, 0);
});

test('two replies in one message get distinct relay keys', () => {
  const text = `[auto-replied abc12345 ${ISO}]\nFirst.\n[steward-forwarded abc12345 ${ISO}]\nSecond.`;
  const derived = deriveTicket([human(TICKET, 0), mind(text, 5, 'row')], 'abc12345');
  assert.deepEqual(derived.replies.map((r) => [r.fingerprint, r.body]), [['row', 'First.'], ['row:1', 'Second.']]);
  assert.equal(derived.status, 'forwarded');
});
