// The pin step: the film to IPFS, the screenplay beside it, and one message to the Mind naming
// both. The screenplay pin is cosmetic by design — a failure there must not delay the digest.
//
//   node --test scripts/test/director-pin.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { appendTake, handleDirectorQueue, loadProduction, rememberTake, screenplayDocument } from '../../worker/director-job.js';
import { chatAlias } from '../../worker/minds.js';
import { FakeMindsClient, MockKV } from './mock-kv.mjs';

class MockQueue {
  sent = [];
  async send(body, options) { this.sent.push({ body, options }); }
}
class MockR2 {
  objects = new Map();
  async put(key, bytes) { this.objects.set(key, bytes); }
  async get(key) {
    const bytes = this.objects.get(key);
    return bytes ? { arrayBuffer: async () => bytes.buffer } : null;
  }
}

const FILM = 'a1b2c3d4';
const TAKE = 'take-9f21ab04';
const ADDRESS = `0x${'a'.repeat(40)}`;
const KEY = `eth-mainnet:${ADDRESS}:42`;
const spec = { logline: 'A bored ape robs the Louvre at dawn', beats: ['Arrive.', 'Rob.', 'Leave.'] };
const castRefs = [{ key: KEY, chain: 'eth-mainnet', address: ADDRESS, tokenId: '42', name: 'Ape #42', collection: 'BAYC', image: 'https://cdn/ape.png' }];

const makeEnv = () => ({
  MIND_CONNECTIONS: new MockKV(),
  DIRECTOR_JOBS: new MockQueue(),
  RENDERS: new MockR2(),
  PINATA_JWT: 'pinata-test',
  SESSION_SIGNING_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  __mindsClient: new FakeMindsClient(),
});

/** A finished take on the durable record, with its bytes in R2. */
const seed = async (env, mindId) => {
  const r2Key = `director/${mindId}/${FILM}/${TAKE}/video.mp4`;
  await env.RENDERS.put(r2Key, new Uint8Array([0, 1, 2, 3]));
  await appendTake(env, mindId, FILM, {
    takeId: TAKE, kind: 'take', status: 'ready', r2Key, sha256: 'ab'.repeat(32), costUsd: 0.55, settledAt: Date.now(),
    params: { duration: 6, resolution: '768P' },
  });
  return r2Key;
};

/** Pinata, answering each upload in turn with a CID or a 500. Records what was uploaded. */
const stubPinata = (answers) => {
  const uploads = [];
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).includes('uploads.pinata.cloud'));
    const file = init.body.get('file');
    uploads.push({ name: init.body.get('name'), type: file.type, text: await file.text(), keyvalues: JSON.parse(init.body.get('keyvalues')) });
    const next = answers.shift();
    if (!next) return new Response('boom', { status: 500 });
    return new Response(JSON.stringify({ data: { cid: next } }), { status: 200 });
  };
  return uploads;
};

const deliver = (env, body) => {
  const acked = [];
  const retried = [];
  const batch = { queue: 'director-jobs', messages: [{ body, attempts: 1, ack: () => acked.push(body), retry: (o) => retried.push(o) }] };
  return handleDirectorQueue(batch, env).then(() => ({ acked, retried }));
};

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('the film and the screenplay are pinned, and the Mind is given both addresses', async () => {
  const env = makeEnv();
  const mindId = 'mind-pin-both';
  await seed(env, mindId);
  const uploads = stubPinata(['bafyfilmcid', 'bafyscreenplaycid']);

  const { jobId } = await rememberTake(env, mindId, { filmId: FILM, takeId: TAKE, spec, prompt: 'A heist at dawn.', castRefs });
  const { acked, retried } = await deliver(env, { mindId, jobId, step: 'pin' });
  assert.equal(acked.length, 1);
  assert.equal(retried.length, 0);

  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].type, 'video/mp4');
  assert.equal(uploads[1].type, 'application/json');
  assert.ok(uploads[1].name.endsWith(`/${TAKE}.screenplay.json`));
  assert.equal(uploads[1].keyvalues.kind, 'screenplay');
  const doc = JSON.parse(uploads[1].text);
  assert.equal(doc.prompt, 'A heist at dawn.');
  assert.deepEqual(doc.spec, spec);
  assert.deepEqual(doc.cast, castRefs);
  assert.equal(doc.film.cid, 'bafyfilmcid', 'the screenplay record points at the film it was shot as');
  assert.equal(doc.mindId, undefined, 'no Mind id in a public document');

  const take = (await loadProduction(env, mindId, FILM)).takes[0];
  assert.equal(take.ipfs.cid, 'bafyfilmcid');
  assert.equal(take.ipfs.screenplayCid, 'bafyscreenplaycid');
  assert.ok(take.digestedAt);

  const { sent } = env.__mindsClient;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].alias, chatAlias(mindId));
  assert.ok(sent[0].messageText.includes('Permanent record: ipfs://bafyfilmcid'));
  assert.ok(sent[0].messageText.includes('Screenplay record: ipfs://bafyscreenplaycid'));
  assert.ok(sent[0].messageText.includes('Prompt, in the visitor\'s words: "A heist at dawn."'));
  assert.ok(sent[0].messageText.includes('Cast: Ape #42.'));
});

test('a screenplay that will not pin is cosmetic: the Mind is still told, with the film’s address', async () => {
  const env = makeEnv();
  const mindId = 'mind-pin-half';
  await seed(env, mindId);
  stubPinata(['bafyfilmonly']);

  const { jobId } = await rememberTake(env, mindId, { filmId: FILM, takeId: TAKE, spec, prompt: 'x', castRefs });
  const { acked, retried } = await deliver(env, { mindId, jobId, step: 'pin' });
  assert.equal(acked.length, 1);
  assert.equal(retried.length, 0, 'never retried — the film pin took and the digest went');

  const take = (await loadProduction(env, mindId, FILM)).takes[0];
  assert.equal(take.ipfs.cid, 'bafyfilmonly');
  assert.equal(take.ipfs.screenplayCid, undefined);

  const { sent } = env.__mindsClient;
  assert.equal(sent.length, 1);
  assert.ok(sent[0].messageText.includes('ipfs://bafyfilmonly'));
  assert.equal(sent[0].messageText.includes('Screenplay record'), false);
});

test('a take pinned before the screenplay existed gains the screenplay without re-pinning the film', async () => {
  const env = makeEnv();
  const mindId = 'mind-pin-later';
  const r2Key = await seed(env, mindId);
  await appendTake(env, mindId, FILM, {
    takeId: TAKE, kind: 'take', status: 'ready', r2Key, costUsd: 0.55, settledAt: Date.now(), params: { duration: 6, resolution: '768P' },
    ipfs: { cid: 'bafyalready', provider: 'pinata', pinnedAt: 1, gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafyalready' },
  });
  const uploads = stubPinata(['bafyscreenplaylate']);

  const { jobId, pinned } = await rememberTake(env, mindId, { filmId: FILM, takeId: TAKE, spec, castRefs });
  assert.equal(pinned, true);
  await deliver(env, { mindId, jobId, step: 'pin' });

  assert.equal(uploads.length, 1, 'only the screenplay went up');
  assert.equal(uploads[0].type, 'application/json');
  const take = (await loadProduction(env, mindId, FILM)).takes[0];
  assert.equal(take.ipfs.cid, 'bafyalready');
  assert.equal(take.ipfs.screenplayCid, 'bafyscreenplaylate');
});

test('screenplayDocument is the public shape: film, take, prompt, spec, cast, and the film’s CID', () => {
  const doc = screenplayDocument(
    { mindId: 'secret', filmId: FILM, prompt: 'p', spec, castRefs, take: { takeId: TAKE, sha256: 'ff', ipfs: { cid: 'bafyx' } } },
    { now: Date.UTC(2026, 7, 28) },
  );
  assert.deepEqual(Object.keys(doc), ['version', 'filmId', 'takeId', 'prompt', 'spec', 'cast', 'film', 'createdAt']);
  assert.deepEqual(doc.film, { cid: 'bafyx', sha256: 'ff' });
  assert.equal(doc.createdAt, '2026-08-28T00:00:00.000Z');
});
