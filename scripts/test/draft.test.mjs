// The Worker's copy of the visitor's draft: clamped on the way in, keyed by the Mind, and
// announced to the Mind exactly once per screenplay.
//
//   node --test scripts/test/draft.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_CAST,
  MAX_PROMPT,
  handleDraftDelete,
  handleDraftGet,
  handleDraftPut,
  normalizeDraft,
} from '../../worker/draft.js';
import { SCREENPLAY_TAG, lastScreenplayDigestAt } from '../../worker/filmography.js';
import { chatAlias } from '../../worker/minds.js';
import { filmIdFor } from '../../worker/film-id.js';
import { SESSION_KINDS, signSession } from '../../worker/session.js';
import { collectProductionState, renderStateBlock } from '../../worker/producer-state.js';
import { parseMail } from '../../src/lib/mail.js';
import { makeEnv } from './mock-kv.mjs';

const MIND = 'fb12453e-f36b-1410-8466-00039ce7df11';
const ADDRESS = `0x${'a'.repeat(40)}`;
const KEY = `eth-mainnet:${ADDRESS}:42`;
const soon = () => Date.now() + 60_000;
const mindToken = (env, mindId = MIND) => signSession(env, { kind: 'mind', mindId, exp: soon() });

const spec = { logline: 'A bored ape robs the Louvre at dawn', beats: ['Arrive.', 'Rob.', 'Leave.'], duration: 6 };
const draftBody = (over = {}) => ({
  v: 1,
  prompt: 'A heist at dawn, told from the ape’s point of view.',
  primaryKey: KEY,
  cast: [
    {
      key: KEY,
      origin: 'curated',
      nft: { name: 'Ape #42', tokenId: '42', image: { cachedUrl: 'https://cdn/ape.png', pngUrl: 'javascript:alert(1)' } },
      collection: { chain: 'eth-mainnet', address: ADDRESS, name: 'BAYC', brand: { slug: 'yuga', name: 'Yuga', sector: 'Art', accent: '#fff' } },
    },
  ],
  stage: 'treatment',
  spec,
  caps: { maxBeats: 3, maxReferences: 4 },
  writtenCast: [{ key: KEY, name: 'Ape #42', collectionName: 'BAYC', dossier: { medium: 'still' } }],
  ...over,
});

const call = (env, method, { body, token, ctx } = {}) => {
  const handler = { GET: handleDraftGet, PUT: handleDraftPut, DELETE: handleDraftDelete }[method];
  return handler(
    new Request('https://minds.monster/api/draft', {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    ctx,
  );
};

test.beforeEach(() => lastScreenplayDigestAt.clear());

test('normalizeDraft clamps what it keeps and refuses what it cannot', () => {
  const draft = normalizeDraft(
    draftBody({
      prompt: 'p'.repeat(MAX_PROMPT + 500),
      cast: [
        ...Array.from({ length: MAX_CAST + 2 }, (_, i) => ({ key: `eth-mainnet:${ADDRESS}:${i}`, nft: { name: `#${i}` } })),
        { key: 'not a key', nft: {} },
      ],
      primaryKey: 'eth-mainnet:0xnothere:1',
    }),
  );
  assert.equal(draft.prompt.length, MAX_PROMPT);
  assert.equal(draft.cast.length, MAX_CAST);
  assert.equal(draft.primaryKey, null, 'a primary that is not in the cast is dropped');
  assert.equal(draft.filmId, filmIdFor(spec));
  assert.equal(draft.stage, 'treatment');
  assert.equal(draft.writtenCast, null, 'a written cast for pieces no longer in the cast is dropped');

  const one = normalizeDraft(draftBody());
  assert.equal(one.cast[0].nft.image.cachedUrl, 'https://cdn/ape.png');
  assert.equal(one.cast[0].nft.image.pngUrl, undefined, 'only http(s) and ipfs URLs survive');
  assert.equal(one.cast[0].collection.brand.accent, '#fff');
  assert.equal(one.writtenCast[0].dossier.medium, 'still');
  assert.deepEqual(one.caps, { maxBeats: 3, maxReferences: 4 });

  assert.equal(normalizeDraft(draftBody({ spec: { logline: 'x', beats: Array(40).fill('b') } })).spec, null, 'too many beats is no spec');
  assert.equal(normalizeDraft({ prompt: '   ', cast: [] }), null, 'nothing to keep is null');
  assert.equal(normalizeDraft('nope'), null);
});

test('only a Mind session may read or write a draft', async () => {
  const env = makeEnv();
  assert.equal((await call(env, 'GET')).status, 401);
  const owner = await signSession(env, { kind: SESSION_KINDS.owner, owner: true, exp: soon() });
  assert.equal((await call(env, 'GET', { token: owner })).status, 401);
  assert.equal((await call(env, 'PUT', { token: owner, body: { draft: draftBody() } })).status, 401);
});

test('PUT, GET and DELETE round-trip under the Mind’s key', async () => {
  const env = makeEnv();
  const token = await mindToken(env);

  assert.equal((await call(env, 'GET', { token })).status, 200);
  assert.equal((await (await call(env, 'GET', { token })).json()).draft, null);

  const put = await call(env, 'PUT', { token, body: { draft: draftBody() } });
  assert.equal(put.status, 200);
  const receipt = await put.json();
  assert.equal(receipt.filmId, filmIdFor(spec));
  assert.ok(env.MIND_CONNECTIONS.store.has(`draft:${MIND}`));

  const { draft } = await (await call(env, 'GET', { token })).json();
  assert.equal(draft.prompt, draftBody().prompt);
  assert.deepEqual(draft.spec, spec);
  assert.equal(draft.savedAt, receipt.savedAt);

  assert.equal((await call(env, 'PUT', { token, body: { draft: { prompt: '', cast: [] } } })).status, 400);

  assert.equal((await call(env, 'DELETE', { token })).status, 200);
  assert.equal((await (await call(env, 'GET', { token })).json()).draft, null);
});

test('the Mind is told about a screenplay once per film, in its own conversation', async () => {
  const env = makeEnv();
  const token = await mindToken(env);
  const minds = env.__mindsClient;

  const first = await (await call(env, 'PUT', { token, body: { draft: draftBody() } })).json();
  assert.equal(first.announced, true);
  assert.equal(minds.sent.length, 1);
  assert.equal(minds.sent[0].alias, chatAlias(MIND));
  const text = minds.sent[0].messageText;
  assert.ok(text.startsWith(SCREENPLAY_TAG));
  assert.ok(text.includes(`Film: "${spec.logline}" (film ${filmIdFor(spec)})`));
  assert.ok(text.includes('Screenplay: 3 beats, about 6s.'));
  assert.ok(text.includes('Cast: Ape #42.'));
  assert.ok(text.includes('Prompt, in the visitor\'s words: "A heist at dawn'));
  assert.equal(parseMail(text).kind, 'system', 'renders as a notice, never as the Mind speaking');

  // The same screenplay saved again — a prompt edit after the treatment, a reload — is not news.
  const again = await (await call(env, 'PUT', { token, body: { draft: draftBody({ prompt: 'edited' }) } })).json();
  assert.equal(again.announced, false);
  assert.equal(minds.sent.length, 1);

  // A rewrite is a new film id, and the Mind hears about it.
  lastScreenplayDigestAt.clear();
  const rewritten = { ...spec, beats: ['Arrive.', 'Rob everything.', 'Leave.'] };
  await call(env, 'PUT', { token, body: { draft: draftBody({ spec: rewritten }) } });
  assert.equal(minds.sent.length, 2);
  assert.ok(minds.sent[1].messageText.includes(`(film ${filmIdFor(rewritten)})`));

  // And a burst inside the minute is held to one message per Mind.
  const again2 = { ...spec, beats: ['A', 'B', 'C'] };
  await call(env, 'PUT', { token, body: { draft: draftBody({ spec: again2 }) } });
  assert.equal(minds.sent.length, 2);
});

test('with a request context the announcement is deferred through waitUntil', async () => {
  const env = makeEnv();
  const token = await mindToken(env);
  const deferred = [];
  const receipt = await (await call(env, 'PUT', { token, body: { draft: draftBody() }, ctx: { waitUntil: (p) => deferred.push(p) } })).json();
  assert.equal(receipt.announced, true);
  assert.equal(deferred.length, 1);
  await Promise.all(deferred);
  assert.equal(env.__mindsClient.sent.length, 1);
});

test('the Producer’s context knows there is a screenplay in progress', async () => {
  const env = makeEnv();
  const token = await mindToken(env);
  await call(env, 'PUT', { token, body: { draft: draftBody() } });

  const state = await collectProductionState(env, MIND);
  assert.equal(state.hasScreenplay, true);
  assert.equal(state.draft.logline, spec.logline);
  assert.equal(state.draft.beatCount, 3);
  assert.deepEqual(state.draft.castNames, ['Ape #42']);

  const block = renderStateBlock(state);
  assert.ok(block.includes('Screenplay: written, 3 beats.'));
  assert.ok(block.includes(`Screenplay in progress: "${spec.logline}" (film ${filmIdFor(spec)}), 3 beats, cast: Ape #42`));
  assert.ok(block.includes('Your [Screenplay] message in this conversation is your record of it.'));
});
