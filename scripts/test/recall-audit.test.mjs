// What the Mind remembers, checked against the record.
//
// The reply is prose in the Mind's own voice, HTML-wrapped by the platform, and it may quote any
// of the identifiers it was given — or none. The audit has to find agreement whichever it
// chose, and must not mistake a date for a film id.
//
//   node --test scripts/test/recall-audit.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRecall, recallRequest, RECALL_SUBJECT } from '../../src/lib/recallAudit.js';

const films = [
  { filmId: 'a1b2c3d4', logline: 'A bored ape robs the Louvre at dawn', takeIds: ['take-9f21ab04'], cids: ['bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'] },
  { filmId: '0f0e0d0c', logline: 'The penguin who would not fly', takeIds: ['take-11aa22bb'], cids: [] },
];

test('recall by film id, take id and CID all count, and HTML wrapping is stripped', () => {
  const reply =
    '<p>From memory:</p><ul><li>Film a1b2c3d4 — "A bored ape robs the Louvre at dawn", take-9f21ab04, ' +
    'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi</li></ul>';
  const audit = auditRecall(reply, films);
  assert.equal(audit.recalledCount, 1);
  assert.equal(audit.recordCount, 2);
  assert.deepEqual(audit.rows[0].matchedBy, ['film id', 'take id', 'ipfs cid', 'logline']);
  assert.equal(audit.rows[1].recalled, false);
  assert.equal(audit.agrees, false);
  assert.deepEqual(audit.unknown, []);
});

test('a Mind that names the film rather than its hash is still credited', () => {
  const audit = auditRecall('<p>I made the one about the penguin who would not fly.</p>', films);
  assert.equal(audit.rows[1].recalled, true);
  assert.deepEqual(audit.rows[1].matchedBy, ['logline']);
});

test('an id the record does not have is surfaced, a date is not', () => {
  const audit = auditRecall('On 20260827 I delivered take-deadbeef and film 7e7e7e7e.', films);
  assert.deepEqual(audit.unknown.sort(), ['7e7e7e7e', 'take-deadbeef']);
  assert.equal(audit.unknown.includes('20260827'), false);
});

test('hex runs inside a CID do not masquerade as film ids', () => {
  const audit = auditRecall('ipfs://bafybeib00cafe12345aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [
    { filmId: 'b00cafe1', logline: null, takeIds: [], cids: [] },
  ]);
  assert.equal(audit.rows[0].recalled, false);
  assert.equal(audit.unknown.some((id) => id.length === 8), false);
});

test('an honest blank agrees with an empty record', () => {
  const audit = auditRecall('<p>I have no record of any films produced here yet.</p>', []);
  assert.equal(audit.claimedNothing, true);
  assert.equal(audit.agrees, true);
});

test('the question names the fields the digest gave the Mind', () => {
  const question = recallRequest();
  for (const field of ['film id', 'take id', 'logline', 'ipfs://']) assert.ok(question.includes(field), field);
  assert.equal(RECALL_SUBJECT, 'Filmography recall check');
});
