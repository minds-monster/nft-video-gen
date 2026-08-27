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
