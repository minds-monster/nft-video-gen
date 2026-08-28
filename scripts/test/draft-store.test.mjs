// The browser's draft snapshot: what it keeps of an NFT, what it drops under pressure, and what
// it refuses to read back. Pure functions from src/lib/draftStore.js; the localStorage half is
// exercised through a stub on globalThis.
//
//   node --test scripts/test/draft-store.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DRAFT_KEY,
  DRAFT_VERSION,
  MAX_BYTES,
  buildDraft,
  clearLocalDraft,
  draftToHookState,
  flushDraft,
  isEmptyDraft,
  parseDraft,
  readLocalDraft,
  serializeDraft,
  setDraft,
} from '../../src/lib/draftStore.js';

const fatNft = {
  contract: { address: '0xabc', deployer: 'someone', openSeaMetadata: { floorPrice: 1 } },
  tokenId: '42',
  name: 'Ape #42',
  description: 'A bored ape.',
  image: { cachedUrl: 'https://cdn/ape.png', pngUrl: 'https://cdn/ape-png.png', originalUrl: 'ipfs://Qm/ape', thumbnailUrl: 'https://cdn/t.png', contentType: 'image/png', size: 1234 },
  raw: { metadata: { image: 'ipfs://Qm/ape', attributes: [{ trait_type: 'Fur', value: 'Gold' }], extra: 'x'.repeat(5000) } },
  tokenUri: 'https://somewhere/huge',
  timeLastUpdated: '2026-01-01',
  acquiredAt: {},
};
const collection = { chain: 'eth-mainnet', address: '0xabc', name: 'BAYC', artRatio: 1, brand: { slug: 'yuga', name: 'Yuga', sector: 'Art', accent: '#fff', collections: [{ big: 'list' }] } };
const cast = [{ key: 'eth-mainnet:0xabc:42', nft: fatNft, collection, origin: 'curated', isMock: false }];
const spec = { logline: 'An ape robs the Louvre', beats: ['one', 'two'], duration: 6 };

test('buildDraft keeps the wire subset of an NFT and the slim collection, nothing else', () => {
  const draft = buildDraft({ prompt: 'heist', cast, primaryKey: cast[0].key, stage: 'treatment', spec });
  assert.equal(draft.v, DRAFT_VERSION);
  assert.equal(draft.filmId.length, 8);
  const [entry] = draft.cast;
  assert.equal(entry.nft.tokenUri, undefined);
  assert.equal(entry.nft.contract.deployer, undefined);
  assert.equal(entry.nft.raw.metadata.extra, undefined);
  assert.equal(entry.nft.image.cachedUrl, 'https://cdn/ape.png');
  assert.deepEqual(entry.nft.raw.metadata.attributes, [{ trait_type: 'Fur', value: 'Gold' }]);
  assert.equal(entry.collection.brand.collections, undefined);
  assert.equal(entry.collection.brand.accent, '#fff');
  assert.equal(entry.collection.artRatio, 1);
  assert.equal(draft.stage, 'treatment');
});

test('an in-flight run is saved as compose, and treatment needs a spec', () => {
  assert.equal(buildDraft({ prompt: 'x', cast, stage: 'writing', spec }).stage, 'compose');
  assert.equal(buildDraft({ prompt: 'x', cast, stage: 'treatment', spec: null }).stage, 'compose');
  assert.equal(buildDraft({ prompt: '   ', cast: [], spec: null }), null);
});

test('parseDraft refuses other versions and other shapes', () => {
  const good = buildDraft({ prompt: 'x', cast });
  assert.ok(parseDraft(JSON.stringify(good)));
  assert.equal(parseDraft(JSON.stringify({ ...good, v: 99 })), null);
  assert.equal(parseDraft(JSON.stringify({ ...good, cast: [{ nokey: true }] })), null);
  assert.equal(parseDraft(JSON.stringify({ ...good, spec: { logline: 'no beats' } })), null);
  assert.equal(parseDraft('not json'), null);
  assert.equal(parseDraft(null), null);
});

test('serializeDraft drops dossiers before anything else when the draft will not fit', () => {
  const dossier = { text: 'd'.repeat(MAX_BYTES) };
  const draft = buildDraft({ prompt: 'x', cast, spec, writtenCast: [{ key: cast[0].key, dossier, name: 'Ape #42', collectionName: 'BAYC' }] });
  const text = serializeDraft(draft);
  assert.ok(text.length <= MAX_BYTES);
  const parsed = JSON.parse(text);
  assert.equal(parsed.writtenCast[0].dossier, null);
  assert.equal(parsed.writtenCast[0].name, 'Ape #42');
  assert.equal(parsed.cast[0].nft.image.cachedUrl, 'https://cdn/ape.png', 'the cast survives intact');
  assert.deepEqual(parsed.spec, spec, 'the screenplay is never what gets trimmed');
});

test('draftToHookState re-joins the treatment cast with its artwork by key', () => {
  const draft = buildDraft({ prompt: 'x', cast, spec, writtenCast: [{ key: cast[0].key, dossier: { medium: 'still' }, name: 'Ape #42', collectionName: 'BAYC' }] });
  const state = draftToHookState(draft);
  assert.equal(state.composer.prompt, 'x');
  assert.equal(state.screenwriter.writtenCast[0].nft.image.cachedUrl, 'https://cdn/ape.png');
  assert.equal(state.screenwriter.writtenCast[0].collection.name, 'BAYC');
  assert.equal(state.screenwriter.writtenCast[0].dossier.medium, 'still');
  assert.deepEqual(state.screenwriter.spec, spec);
});

test('the registry writes to localStorage on flush and reads back the same draft', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  try {
    const draft = buildDraft({ prompt: 'heist', cast, spec });
    setDraft(draft);
    assert.equal(store.has(DRAFT_KEY), false, 'the write is debounced');
    flushDraft();
    assert.ok(store.has(DRAFT_KEY));
    assert.equal(readLocalDraft().prompt, 'heist');
    assert.equal(isEmptyDraft(readLocalDraft()), false);
    clearLocalDraft();
    assert.equal(readLocalDraft(), null);
  } finally {
    delete globalThis.localStorage;
  }
});
