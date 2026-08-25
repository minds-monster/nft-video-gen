// The mail convention, checked on the shapes that actually come off the wire.
//
// Two of these cases are the whole reason the module exists. The first is the
// HTML-wrapped header: Hello Minds returns `<p>Subject: X</p><p>body</p>`, and every
// prefix convention this project has written has had to learn the same lesson — parse
// messageToText(), never the raw field. The second is the fail-open rule. Adam's own
// framing: "false positives are worse than false negatives, because the visitor can
// rename a thread but can't easily merge two." A paragraph that happens to open with the
// word "Subject" must NOT become a new thread with a mangled title.
//
// The threading tests cover the migration case too — every message sitting in every
// existing Producer conversation predates this convention and carries no header at all.
// If those stop rendering, the redesign has eaten the history of every connected Mind.
//
//   node --test scripts/test/mail.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMail, formatMail, buildThreads, threadKey, SUBJECT_MAX } from '../../src/lib/mail.js';

const at = (iso) => new Date(iso).toISOString();
let seq = 0;
const msg = (senderType, messageText, createdAt) => ({
  fingerprint: `fp-${++seq}`,
  senderType,
  messageText,
  createdAt: at(createdAt),
});

test('parses a plain subject header', () => {
  const mail = parseMail('Subject: Neon night palette\n\nCan we push the neon harder?');
  assert.equal(mail.kind, 'mail');
  assert.equal(mail.subject, 'Neon night palette');
  assert.equal(mail.isReply, false);
  assert.equal(mail.body, 'Can we push the neon harder?');
});

test('parses an HTML-wrapped header — the single newline case', () => {
  // messageToText collapses `</p><p>` to ONE newline, so there is no blank line left to
  // key off. Anything that required one would fail on every real Mind reply.
  const mail = parseMail('<p>Subject: Neon night palette</p><p>Can we push the neon harder?</p>');
  assert.equal(mail.subject, 'Neon night palette');
  assert.equal(mail.body, 'Can we push the neon harder?');
});

test('RE: is case-insensitive and collapses at any depth', () => {
  for (const raw of ['RE: hello', 'Re: hello', 're: hello', 'RE: RE: RE: RE: RE: hello']) {
    const mail = parseMail(`Subject: ${raw}\n\nbody`);
    assert.equal(mail.subject, 'hello', raw);
    assert.equal(mail.isReply, true, raw);
  }
});

test('threadKey ignores casing, RE: chains and the attention tag', () => {
  const key = threadKey('the astronaut jacket');
  assert.equal(threadKey('RE:  The Astronaut Jacket '), key);
  assert.equal(threadKey('RE: RE: [attention] the astronaut jacket'), key);
});

test('fails open on prose that begins with the word Subject', () => {
  const mail = parseMail('Subject matter aside. We should talk about the jacket before anything else happens here.');
  assert.equal(mail.subject, null);
  assert.equal(mail.isReply, true, 'must thread into the open conversation, not open a new one');
});

test('fails open on an over-long subject line', () => {
  const mail = parseMail(`Subject: ${'x'.repeat(200)}\n\nbody`);
  assert.equal(mail.subject, null);
});

test('fails open on a header with no body under it', () => {
  const mail = parseMail('Subject: just this one line');
  assert.equal(mail.subject, null);
});

test('reads Subject-Source, which is how the Mind knows the visitor did not write it', () => {
  const mail = parseMail('Subject: Neon night palette\nSubject-Source: auto\n\nbody');
  assert.equal(mail.subject, 'Neon night palette');
  assert.equal(mail.subjectSource, 'auto');
  assert.equal(mail.body, 'body');
});

test('classifies acks, briefings and the legacy briefing', () => {
  assert.equal(parseMail('<p>[seen 2026-08-25T10:15:00Z] On it.</p>').kind, 'ack');
  assert.equal(parseMail('[briefing]\nminds.monster — Producer briefing\n\n...').kind, 'briefing');
  assert.equal(parseMail('minds.monster — Producer briefing\n\nYou are the Producer...').kind, 'briefing');
});

test('classifies site digests as system, not as the Mind speaking', () => {
  for (const tag of ['Storyboarder', 'Previs Supervisor', 'Post-mortem']) {
    const mail = parseMail(`[${tag}] 5 shots blocked, $0.31 spent.`);
    assert.equal(mail.kind, 'system', tag);
    assert.equal(mail.systemTag, tag);
  }
});

test('flags the attention convention without letting it break threading', () => {
  const mail = parseMail('Subject: [attention] budget nearly exhausted\n\nbody');
  assert.equal(mail.urgent, true);
  assert.equal(mail.subject, 'budget nearly exhausted');
});

test('formatMail round-trips through parseMail', () => {
  const wire = formatMail({ subject: 'Neon night palette', body: 'body', reply: true, subjectSource: 'auto' });
  assert.match(wire, /^Subject: RE: Neon night palette\nSubject-Source: auto\n\nbody$/);
  const mail = parseMail(wire);
  assert.equal(mail.subject, 'Neon night palette');
  assert.equal(mail.isReply, true);
  assert.equal(mail.subjectSource, 'auto');
});

test('formatMail never doubles a RE: and holds the subject budget', () => {
  assert.match(formatMail({ subject: 'RE: hello', body: 'b', reply: true }), /^Subject: RE: hello\n/);
  const long = formatMail({ subject: 'y'.repeat(200), body: 'b' });
  assert.equal(long.split('\n')[0].length, 'Subject: '.length + SUBJECT_MAX);
});

test('threads a subject with its replies, newest activity first', () => {
  const threads = buildThreads([
    msg(1, formatMail({ subject: 'The astronaut jacket', body: 'what do you think?' }), '2026-08-25T10:00:00Z'),
    msg(0, '<p>[seen 2026-08-25T10:01:00Z] On it.</p>', '2026-08-25T10:01:00Z'),
    msg(0, formatMail({ subject: 'The astronaut jacket', body: 'I like it.', reply: true }), '2026-08-25T10:05:00Z'),
  ]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].subject, 'The astronaut jacket');
  assert.equal(threads[0].messages.length, 2, 'the ack is a status, never a row');
  assert.equal(threads[0].state, 'replied');
  assert.equal(threads[0].seenAck, null, 'a real reply supersedes the ack');
});

test('three-state model: awaiting → processing → replied', () => {
  const sent = msg(1, formatMail({ subject: 'Lens choice', body: 'thoughts?' }), '2026-08-25T10:00:00Z');
  assert.equal(buildThreads([sent])[0].state, 'awaiting');

  const ack = msg(0, '[seen 2026-08-25T10:01:00Z] On it.', '2026-08-25T10:01:00Z');
  assert.equal(buildThreads([sent, ack])[0].state, 'processing');

  const reply = msg(0, formatMail({ subject: 'Lens choice', body: '35mm.', reply: true }), '2026-08-25T10:04:00Z');
  assert.equal(buildThreads([sent, ack, reply])[0].state, 'replied');
});

test('"replied" stops being true the moment the visitor writes again', () => {
  const threads = buildThreads([
    msg(1, formatMail({ subject: 'Lens choice', body: 'thoughts?' }), '2026-08-25T10:00:00Z'),
    msg(0, formatMail({ subject: 'Lens choice', body: '35mm.', reply: true }), '2026-08-25T10:04:00Z'),
    msg(1, formatMail({ subject: 'Lens choice', body: 'and the grade?', reply: true }), '2026-08-25T10:06:00Z'),
  ]);
  assert.equal(threads[0].state, 'awaiting');
});

test('headerless history still renders — the migration case', () => {
  // Every message in every Producer conversation today looks exactly like this.
  const threads = buildThreads([
    msg(1, 'hello, are you there?', '2026-08-25T10:00:00Z'),
    msg(0, '<p>Yes — here.</p>', '2026-08-25T10:03:00Z'),
    msg(1, 'great', '2026-08-25T10:04:00Z'),
  ]);
  assert.equal(threads.length, 1, 'bare messages thread together rather than each opening a thread');
  assert.equal(threads[0].messages.length, 3);
});

test('a bare visitor message takes the subject the Mind gives it', () => {
  const threads = buildThreads([
    msg(1, 'the jacket looks wrong', '2026-08-25T10:00:00Z'),
    msg(0, formatMail({ subject: 'The astronaut jacket', body: 'agreed — here is why.' }), '2026-08-25T10:05:00Z'),
  ]);
  assert.equal(threads.length, 1, "the Mind's reply names the thread rather than starting a new one");
  assert.equal(threads[0].subject, 'The astronaut jacket');
});

test('the briefing never becomes a thread', () => {
  const threads = buildThreads([
    msg(1, '[briefing]\nminds.monster — Producer briefing\n\nYou are the Producer...', '2026-08-25T10:00:00Z'),
    msg(0, formatMail({ subject: "We're in the movie business now", body: 'Connected.' }), '2026-08-25T10:02:00Z'),
  ]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].subject, "We're in the movie business now");
});

test('a site digest does not capture the next headerless reply', () => {
  const threads = buildThreads([
    msg(1, formatMail({ subject: 'Lens choice', body: 'thoughts?' }), '2026-08-25T10:00:00Z'),
    msg(0, '[Storyboarder] 5 shots blocked.', '2026-08-25T10:01:00Z'),
    msg(0, 'Sorry — 35mm, as discussed.', '2026-08-25T10:02:00Z'),
  ]);
  const lens = threads.find((t) => t.subject === 'Lens choice');
  const digest = threads.find((t) => t.kind === 'system');
  assert.equal(digest.messages.length, 1);
  assert.equal(lens.messages.length, 2, 'the headerless reply belongs to the conversation, not the digest');
});
