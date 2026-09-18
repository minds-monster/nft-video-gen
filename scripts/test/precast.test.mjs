// src/lib/precast.js — casting a piece when it is added, once, and sharing the result with launch.
//
// THE FAILURE IT EXISTS FOR: the site cast only on launch and wrote the screenplay seconds later,
// so a moving piece's film frames — chosen on a queue in minutes — could never reach its first
// film (staging, 2026-09-18). And the failure it must not cause: a launch arriving mid-pre-cast
// starting a SECOND cold cast of the same piece.

import test from 'node:test';
import assert from 'node:assert/strict';

import { precast, takePrecast } from '../../src/lib/precast.js';

const sse = (dossier) =>
  new Response(`event: phase\ndata: {"phase":"looking"}\n\nevent: result\ndata: ${JSON.stringify(dossier)}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

const entry = (key, extra = {}) => ({ key, nft: { tokenId: '1', contract: { address: '0xabc' } }, ...extra });

test('a piece is cast once, and the launch gets the same promise instead of casting again', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return sse({ subject: 'a colossal reptilian creature' }); };
  const first = precast(entry('eth-mainnet:0xabc:1'));
  const second = precast(entry('eth-mainnet:0xabc:1'));
  assert.equal(first, second);
  assert.equal(takePrecast('eth-mainnet:0xabc:1'), first);
  assert.equal((await first).subject, 'a colossal reptilian creature');
  assert.equal(calls, 1);
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
