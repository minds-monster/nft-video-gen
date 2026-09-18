// worker/casting-director.js resolveCastingStills — the art Alchemy did not index, read from the
// token's own metadata.
//
// THE CASE: an unrevealed Robinhood-chain token (2026-09-18) came back with every Alchemy image
// field null. The Director refused it as having "no still MiniMax will accept", when its tokenURI
// named a legal 1254x1254 PNG.

import test from 'node:test';
import assert from 'node:assert/strict';

import { castingStills, resolveCastingStills } from '../../worker/casting-director.js';
import { forCastingWire } from '../../src/services/swarm.js';

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('Alchemy media wins, and the metadata is never fetched', async () => {
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  const stills = await resolveCastingStills({ image: { pngUrl: 'https://a/p.png' }, tokenUri: 'ipfs://bafkx' });
  assert.deepEqual(stills, ['https://a/p.png']);
});

test('with no media, the image comes from the tokenURI JSON, through a gateway that serves it', async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return String(url).startsWith('https://gateway.pinata.cloud/')
      ? new Response('{"name":"Unrevealed RH GPU","image":"ipfs://bafyart"}', { status: 200, headers: { 'content-type': 'text/plain' } })
      : new Response('<html>blocked</html>', { status: 403 });
  };
  const stills = await resolveCastingStills({ tokenId: '1247', tokenUri: 'ipfs://bafkmeta-1', image: { pngUrl: null } });
  assert.deepEqual(stills, ['https://ipfs.io/ipfs/bafyart']);
  assert.equal(asked[0], 'https://gateway.pinata.cloud/ipfs/bafkmeta-1');
});

test('a gateway error page is not mistaken for metadata', async () => {
  globalThis.fetch = async () => new Response('<html>blocked</html>', { status: 200 });
  assert.deepEqual(await resolveCastingStills({ tokenUri: 'ipfs://bafkmeta-2' }), []);
});

test('on-chain JSON in a data: URI is read without any fetch', async () => {
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  const json = btoa(JSON.stringify({ image: 'https://art.example/1.png' }));
  assert.deepEqual(await resolveCastingStills({ tokenUri: `data:application/json;base64,${json}` }), ['https://art.example/1.png']);
});

test('OpenSea-shaped raw metadata counts as media', () => {
  assert.deepEqual(castingStills({ raw: { metadata: { image_url: 'https://i.seadn.io/x.png' } } }), ['https://i.seadn.io/x.png']);
});

test('the wire the browser sends keeps tokenUri, so the Worker can fall back to it', () => {
  const { nft } = forCastingWire({ key: 'k', nft: { tokenId: '1', tokenUri: 'ipfs://bafkmeta', image: {} } });
  assert.equal(nft.tokenUri, 'ipfs://bafkmeta');
});
