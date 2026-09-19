// src/lib/precast.js — casting a piece when it is added, once, and sharing the result with launch.
//
// THE FAILURE IT EXISTS FOR: the site cast only on launch and wrote the screenplay seconds later,
// so a moving piece's film frames — chosen on a queue in minutes — could never reach its first
// film (staging, 2026-09-18). And the failure it must not cause: a launch arriving mid-pre-cast
// starting a SECOND cold cast of the same piece.

import test from 'node:test';
import assert from 'node:assert/strict';

import { precast, precastable, takePrecast } from '../../src/lib/precast.js';

const sse = (dossier) =>
  new Response(`event: phase\ndata: {"phase":"looking"}\n\nevent: result\ndata: ${JSON.stringify(dossier)}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

const entry = (key, extra = {}) => ({ key, nft: { tokenId: '1', contract: { address: '0xabc' } }, ...extra });

// Casting calls, and the owner's records of them (POST /api/records/cast), counted apart.
const recordingFetch = (respond) => {
  const seen = { casts: 0, reports: [] };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/api/records/cast')) {
      seen.reports.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    }
    seen.casts += 1;
    return respond();
  };
  return seen;
};

test('a piece is cast once, and the launch gets the same promise instead of casting again', async () => {
  const seen = recordingFetch(() => sse({ subject: 'a colossal reptilian creature' }));
  const first = precast(entry('eth-mainnet:0xabc:1'));
  const second = precast(entry('eth-mainnet:0xabc:1'));
  assert.equal(first, second);
  assert.equal(takePrecast('eth-mainnet:0xabc:1'), first);
  assert.equal((await first).subject, 'a colossal reptilian creature');
  assert.equal(seen.casts, 1);
  assert.equal(seen.reports.length, 1, 'one cast, one record of it');
  assert.equal(seen.reports[0].asset.key, 'eth-mainnet:0xabc:1');
});

// The pre-cast passes no onEvent, so before castPiece listened for itself, the `paid` phase —
// the only place the x402 transaction hashes are ever announced — went nowhere.
test('x402 payments announced during a pre-cast reach the owner’s records', async () => {
  const hashA = `0x${'a'.repeat(64)}`;
  const hashB = `0x${'b'.repeat(64)}`;
  const seen = recordingFetch(
    () =>
      new Response(
        `event: phase\ndata: {"phase":"paid","message":"${hashA},https://basescan.org/tx/${hashB}"}\n\nevent: result\ndata: {"subject":"x"}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  await precast(entry('eth-mainnet:0xabc:5'));
  assert.deepEqual(seen.reports[0].txHashes, [hashA, `https://basescan.org/tx/${hashB}`]);
});

test('placeholder pieces and pieces without an NFT are never pre-cast', () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  assert.equal(precast(entry('eth-mainnet:0xabc:2', { isMock: true })), null);
  assert.equal(precast({ key: 'eth-mainnet:0xabc:3' }), null);
  assert.equal(takePrecast('eth-mainnet:0xabc:2'), null);
});

test('a failed pre-cast does not stick — the launch casts it again', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'nvidia 503' }), { status: 503 });
  const failed = precast(entry('eth-mainnet:0xabc:4'));
  await assert.rejects(failed);
  assert.equal(takePrecast('eth-mainnet:0xabc:4'), null);
});

// Every cast is paid. A restored draft's pieces were pre-cast on each page load — the owner's
// own pages included — and charged their creators and owners again every time (2026-09-19).
test('pieces a draft restored are left for the launch; pieces added this visit are pre-cast', () => {
  const restored = entry('eth-mainnet:0x4f18:25');
  const added = entry('eth-mainnet:0xbeb1:938');
  const skip = new Set([restored.key]);
  assert.deepEqual(precastable([restored, added], skip).map((e) => e.key), [added.key]);
  assert.deepEqual(precastable([restored], skip), [], 'a reload of a saved draft casts nothing');
  assert.deepEqual(precastable([restored, added]).map((e) => e.key), [restored.key, added.key], 'no draft, nothing skipped');
  assert.deepEqual(precastable(null, skip), []);
});

test('the cast report names the piece’s collection from the canvas entry', async () => {
  const seen = recordingFetch(() => sse({ subject: 'x' }));
  await precast(entry('eth-mainnet:0xabc:6', { collection: { name: 'HUXLEY Robots' } }));
  assert.equal(seen.reports[0].asset.collectionName, 'HUXLEY Robots');
});
