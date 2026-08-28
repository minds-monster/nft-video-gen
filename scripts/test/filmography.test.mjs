// The Mind's own record of a finished take.
//
// The shape is a contract with the Mind: one fact per line, ids and addresses it can quote back,
// and a leading [Filmography] tag so the Inbox renders it as a system notice rather than as the
// Mind's own voice. The audit in src/lib/recallAudit.js reads the same identifiers back.
//
//   node --test scripts/test/filmography.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { filmographyDigest, FILMOGRAPHY_TAG } from '../../worker/filmography.js';
import { parseMail } from '../../src/lib/mail.js';
import { auditRecall } from '../../src/lib/recallAudit.js';

const record = {
  mindId: 'fb12453e-f36b-1410-8466-00039ce7df11',
  filmId: 'a1b2c3d4',
  spec: { logline: 'A bored ape robs the Louvre at dawn', beats: ['one', 'two', 'three'] },
  castNames: ['Bored Ape #1234', 'Pudgy Penguin #9'],
  params: { duration: 6, resolution: '768P' },
  take: {
    takeId: 'take-9f21ab04',
    kind: 'take',
    costUsd: 0.55,
    settledAt: Date.UTC(2026, 7, 27, 14, 2),
    r2Key: 'director/fb12453e-f36b-1410-8466-00039ce7df11/a1b2c3d4/take-9f21ab04/video.mp4',
    sha256: 'ab'.repeat(32),
    ipfs: { cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' },
  },
};

test('every field the Mind asked for is on its own line', () => {
  const text = filmographyDigest(record, { watchUrl: 'https://minds.monster/api/director/media?key=k&token=t' });
  const lines = text.split('\n');
  assert.ok(lines[0].startsWith(FILMOGRAPHY_TAG));
  assert.ok(lines.some((l) => l === 'Film: "A bored ape robs the Louvre at dawn" (film a1b2c3d4)'));
  assert.ok(lines.some((l) => l.startsWith('Take take-9f21ab04 — 6s 768P, $0.55, delivered 2026-08-27T14:02')));
  assert.ok(lines.includes('Screenplay: 3 beats.'));
  assert.ok(lines.includes('Cast: Bored Ape #1234, Pudgy Penguin #9.'));
  assert.ok(lines.includes('Watch (link valid 7 days): https://minds.monster/api/director/media?key=k&token=t'));
  assert.ok(lines.some((l) => l.startsWith('Permanent record: ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi — https://gateway')));
  assert.ok(lines.includes(`File SHA-256: ${'ab'.repeat(32)}`));
});

test('it renders as a system notice, never as the Mind speaking', () => {
  assert.equal(parseMail(filmographyDigest(record)).kind, 'system');
});

test('absent facts are absent lines, not "unknown"', () => {
  const bare = filmographyDigest({ ...record, spec: null, castNames: [], take: { ...record.take, ipfs: null, sha256: null } });
  assert.ok(bare.includes('Film: a1b2c3d4'));
  assert.equal(bare.includes('Cast:'), false);
  assert.equal(bare.includes('Permanent record'), false);
  assert.equal(bare.includes('SHA-256'), false);
  assert.equal(bare.includes('unknown'), false);
});

test('a Mind that quotes the digest back verbatim is fully recalled', () => {
  const text = filmographyDigest(record);
  const audit = auditRecall(`<p>${text.replace(/\n/g, '<br>')}</p>`, [
    { filmId: 'a1b2c3d4', logline: record.spec.logline, takeIds: ['take-9f21ab04'], cids: [record.take.ipfs.cid] },
  ]);
  assert.equal(audit.agrees, true);
});

// ─────────────────────────────────────────────────────── the screenplay, beside the film

import { screenplayDigest, SCREENPLAY_TAG } from '../../worker/filmography.js';

const SCREENPLAY_CID = 'bafkreiabcdefghijklmnopqrstuvwxyz234567abcdefghijklmnop';

test('the prompt and the screenplay record get lines of their own, when there are any', () => {
  const text = filmographyDigest({
    ...record,
    prompt: '  A heist at dawn,\n told from the ape’s point of view.  ',
    take: { ...record.take, ipfs: { ...record.take.ipfs, screenplayCid: SCREENPLAY_CID, screenplayGatewayUrl: `https://gateway.pinata.cloud/ipfs/${SCREENPLAY_CID}` } },
  });
  const lines = text.split('\n');
  assert.ok(lines.includes('Prompt, in the visitor\'s words: "A heist at dawn, told from the ape’s point of view."'));
  assert.ok(lines.some((l) => l.startsWith(`Screenplay record: ipfs://${SCREENPLAY_CID} — https://gateway`)));
  assert.ok(text.endsWith('and the screenplay record beside it.'));

  const without = filmographyDigest(record);
  assert.equal(without.includes('Prompt'), false);
  assert.equal(without.includes('Screenplay record'), false);
  assert.ok(without.endsWith('permanent ipfs:// address.'));
});

test('a Mind that quotes only the screenplay record is still credited with the film', () => {
  const audit = auditRecall(`<p>I wrote one: ipfs://${SCREENPLAY_CID}</p>`, [
    { filmId: 'a1b2c3d4', logline: record.spec.logline, takeIds: ['take-9f21ab04'], cids: [record.take.ipfs.cid, SCREENPLAY_CID] },
  ]);
  assert.equal(audit.rows[0].recalled, true);
  assert.deepEqual(audit.rows[0].matchedBy, ['ipfs cid']);
  assert.equal(audit.agrees, true);
});

test('the screenplay digest is a system notice with the film’s identity on its own line', () => {
  const text = screenplayDigest({ filmId: 'a1b2c3d4', spec: record.spec, prompt: 'Rob the Louvre.', castNames: ['Bored Ape #1234'] });
  const lines = text.split('\n');
  assert.ok(lines[0].startsWith(SCREENPLAY_TAG));
  assert.ok(lines.includes('Film: "A bored ape robs the Louvre at dawn" (film a1b2c3d4)'));
  assert.ok(lines.includes('Screenplay: 3 beats.'));
  assert.ok(lines.includes('Cast: Bored Ape #1234.'));
  assert.ok(lines.includes('Prompt, in the visitor\'s words: "Rob the Louvre."'));
  assert.equal(parseMail(text).kind, 'system');
  assert.equal(text.includes('paid'), true, 'says plainly that nothing has been spent');

  const bare = screenplayDigest({ filmId: 'a1b2c3d4', spec: { logline: 'x', beats: [] } });
  assert.equal(bare.includes('Cast:'), false);
  assert.equal(bare.includes('Prompt'), false);
});

// ───────────────────────────────────────────────────────────────────── screen tests

import { screenTestDigest, SCREEN_TEST_TAG } from '../../worker/filmography.js';

const testRecord = {
  ...record,
  direction: 'The letters are rubber that inflates and fuses into one mass which folds into a brain.',
  take: {
    ...record.take,
    takeId: 'test-c21c9186',
    kind: 'screen-test',
    costUsd: 0.48,
    question: 'In beat 2, does the change physically happen to the thing on screen?',
    answers: { held: 'It physically became the other thing', failed: 'The second thing faded in over it', unclear: 'Cannot tell' },
    verdict: { answer: 'held', by: 'visitor', note: 'the middle letters folded into brain tissue in place — no fade' },
  },
};

test('a judged screen test is remembered with its question, its answer in the film\'s words, and what the visitor saw', () => {
  const text = screenTestDigest(testRecord, { watchUrl: 'https://minds.monster/api/director/media?key=k&token=t' });
  assert.ok(text.startsWith(`${SCREEN_TEST_TAG} A screen test has been answered`));
  assert.match(text, /^Test test-c21c9186 — 6s 768P, \$0\.48/m);
  assert.match(text, /^Question: In beat 2, does the change physically happen/m);
  assert.match(text, /^Rehearsed: "The letters are rubber/m);
  assert.match(text, /^Answer: It physically became the other thing \(held, judged by the visitor\)\./m);
  assert.match(text, /^What the visitor saw, in their words: "the middle letters folded into brain tissue in place — no fade"/m);
  assert.match(text, /^Permanent record: ipfs:\/\/bafy/m);
  assert.match(text, /quote the question, the answer, the visitor's words and the test id/);
  assert.equal(parseMail(text).kind, 'system', 'a system notice, never the Mind speaking');
});

test('an unanswered screen test says so, rather than inventing an answer', () => {
  const text = screenTestDigest({ ...testRecord, take: { ...testRecord.take, verdict: null } });
  assert.ok(text.startsWith(`${SCREEN_TEST_TAG} A screen test has been delivered`));
  assert.match(text, /^Answer: not yet given\.$/m);
  assert.doesNotMatch(text, /What the visitor saw/);
});
