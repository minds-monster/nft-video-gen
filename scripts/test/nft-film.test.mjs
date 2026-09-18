// A token's film: every place it might play from, and the first one that is actually a film.
//
// THE FAILURE THESE EXIST TO PREVENT (measured 2026-09-18, scripts/probe-frames.mjs): 26 of 61
// films in the registry have a metadata URL on ipfs.io, which now answers every server fetch with
// a bot challenge — while Alchemy held a working copy under `animation` that nothing read. And
// the opposite case: for 10 films that copy is a 120-byte partial-upload stub served as HTTP 206,
// and the metadata's own URL is the one that works. Neither source alone is enough.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveNftMedia, resolveNftVideo, resolveNftVideoCandidates } from '../../src/lib/nftMedia.js';
import { findFilm } from '../../worker/artwork.js';

const nft = ({ animation, animationUrl, image } = {}) => ({
  image: image ?? { contentType: 'image/png', cachedUrl: 'https://cdn/still.png' },
  animation,
  raw: { metadata: animationUrl ? { animation_url: animationUrl } : {} },
});

// ────────────────────────────────────────────────────────────── resolveNftVideoCandidates

test("Alchemy's mirror leads, and the metadata URL follows as its fallback", () => {
  const candidates = resolveNftVideoCandidates(
    nft({
      animation: { cachedUrl: 'https://mirror/x_animation', contentType: 'video/mp4', originalUrl: 'https://pinata/ipfs/Qm/10.mp4' },
      animationUrl: 'ipfs://Qm/10.mp4',
    }),
  );
  assert.deepEqual(candidates, ['https://mirror/x_animation', 'https://ipfs.io/ipfs/Qm/10.mp4', 'https://pinata/ipfs/Qm/10.mp4']);
});

test('a token with no animation object behaves exactly as before', () => {
  assert.deepEqual(resolveNftVideoCandidates(nft({ animationUrl: 'https://arweave/abc' })), ['https://arweave/abc']);
  assert.equal(resolveNftVideo(nft()), null);
});

test('a mirror of something that is not a video is not a film', () => {
  for (const contentType of ['text/html', 'image/gif', 'model/gltf-binary', 'application/json']) {
    const candidates = resolveNftVideoCandidates(nft({ animation: { cachedUrl: 'https://mirror/y', contentType } }));
    assert.deepEqual(candidates, [], contentType);
  }
});

test('an untyped mirror of a recognisably non-video URL is dropped too', () => {
  // Gucci #10's mirror really does arrive with contentType null — so null alone cannot mean "no".
  const kept = resolveNftVideoCandidates(nft({ animation: { cachedUrl: 'https://mirror/g', contentType: null }, animationUrl: 'ipfs://Qm/10.mp4' }));
  assert.equal(kept[0], 'https://mirror/g');
  const dropped = resolveNftVideoCandidates(nft({ animation: { cachedUrl: 'https://mirror/h', contentType: null }, animationUrl: 'https://x/piece.html' }));
  assert.deepEqual(dropped, []);
});

test('a film sitting in the image slot is still found, after the mirror', () => {
  const candidates = resolveNftVideoCandidates(
    nft({ image: { contentType: 'video/mp4', originalUrl: 'ipfs://Qm/a.mp4', cachedUrl: 'https://cdn/a' } }),
  );
  assert.deepEqual(candidates, ['https://ipfs.io/ipfs/Qm/a.mp4', 'https://cdn/a']);
});

test('resolveNftMedia carries the whole list, and `video` stays the first of it', () => {
  const media = resolveNftMedia(nft({ animation: { cachedUrl: 'https://mirror/m', contentType: 'video/mp4' }, animationUrl: 'https://arweave/m' }));
  assert.equal(media.video, 'https://mirror/m');
  assert.deepEqual(media.videos, ['https://mirror/m', 'https://arweave/m']);
});

// ──────────────────────────────────────────────────────────────────────────── findFilm

const mp4 = () => new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
const webm = () => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
const text = (s) => new TextEncoder().encode(s);

const serve = (table) => {
  globalThis.fetch = async (url) => {
    const entry = table[String(url)];
    if (!entry) return new Response('nope', { status: 404 });
    return new Response(entry.bytes, { status: entry.status ?? 206 });
  };
};
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("Alchemy's 206 partial-upload stub is not a film — the next candidate is", async () => {
  serve({
    'https://mirror/stub': { bytes: text('{"keyName":"x_animation","partialUpload":true,"bytes":41889416}') },
    'https://opensea/film.mp4': { bytes: mp4() },
  });
  assert.equal(await findFilm(['https://mirror/stub', 'https://opensea/film.mp4']), 'https://opensea/film.mp4');
});

test('an HTML page served as 206 is not a film either', async () => {
  serve({ 'https://brand/a.gif': { bytes: text('<!doctype html><title>oops</title>') }, 'https://b/v.webm': { bytes: webm() } });
  assert.equal(await findFilm(['https://brand/a.gif', 'https://b/v.webm']), 'https://b/v.webm');
});

test('a challenged ipfs.io URL walks the gateways, and null means none of them served a film', async () => {
  serve({ 'https://ipfs.io/ipfs/Qm/x.mp4': { status: 403, bytes: text('Just a moment...') } });
  assert.equal(await findFilm(['https://ipfs.io/ipfs/Qm/x.mp4']), null);
  serve({ 'https://dweb.link/ipfs/Qm/x.mp4': { status: 200, bytes: mp4() } });
  assert.equal(await findFilm(['https://ipfs.io/ipfs/Qm/x.mp4']), 'https://dweb.link/ipfs/Qm/x.mp4');
});
