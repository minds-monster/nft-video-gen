// worker/film-frames.js — from a token's film URLs to stored, legal H3 references.
//
// Every external party is doubled here: the film host, Cloudflare's frame extraction, the still's
// host, NVIDIA, KV and R2. What is under test is the pipeline's own judgement — which film it
// believes, how long it reads the film to be, what it stores, what it refuses, and which outcomes
// it records forever versus retries.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MockKV } from './mock-kv.mjs';
import {
  CANDIDATE_FRAMES,
  computeFilmFrames,
  filmFramesKey,
  frameR2Key,
  frameRefKey,
  mp4Duration,
  parseRefKey,
  readFrameDataUri,
  refKeysForPlan,
  requestFilmFrames,
  screenTestRefKeys,
  webmDuration,
} from '../../worker/film-frames.js';

// ───────────────────────────────────────────────────────────────────────────── fixtures

/** An ISO-BMFF head: ftyp, then moov > mvhd with the given timescale and duration. */
const mp4Head = ({ timescale = 1000, duration = 17_770, version = 0 } = {}) => {
  const bytes = new Uint8Array(200);
  const view = new DataView(bytes.buffer);
  bytes.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]); // ....ftypmp42
  const at = 60;
  bytes.set([0x6d, 0x76, 0x68, 0x64], at); // 'mvhd'
  bytes[at + 4] = version;
  if (version === 1) {
    view.setUint32(at + 24, timescale);
    view.setBigUint64(at + 28, BigInt(duration));
  } else {
    view.setUint32(at + 16, timescale);
    view.setUint32(at + 20, duration);
  }
  return bytes;
};

/** A minimal JPEG whose SOF0 declares these dimensions — all measureImage reads. */
const jpeg = (width, height) => {
  const bytes = new Uint8Array(24);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255]);
  return bytes;
};

const png = () => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, 1080);
  new DataView(bytes.buffer).setUint32(20, 1080);
  return bytes;
};

/** KV that remembers the options each key was written with, so TTLs can be asserted. */
class RecordingKV extends MockKV {
  options = new Map();
  async put(key, value, options = {}) {
    this.options.set(key, options);
    return super.put(key, value, options);
  }
}

class MockR2 {
  objects = new Map();
  async put(key, bytes, { httpMetadata, customMetadata } = {}) {
    this.objects.set(key, { bytes: new Uint8Array(bytes), httpMetadata, customMetadata });
  }
  async get(key) {
    const object = this.objects.get(key);
    return object ? { ...object, arrayBuffer: async () => object.bytes.buffer } : null;
  }
}

const KEY = 'eth-mainnet:0x4f18cba70fc9976398e3481a101c83e1e98fdf7c:5';
const FILM = 'https://nft2-cdn.alchemy.com/eth-mainnet/abc_animation';
const STUB = 'https://nft2-cdn.alchemy.com/eth-mainnet/stub_animation';
const STILL = 'https://res.cloudinary.com/alchemyapi/still.png';
const ORIGIN = 'https://minds.monster';

const envWith = () => ({
  SITE_ORIGIN: ORIGIN,
  NVIDIA_API_KEY: 'k',
  NVIDIA_BASE_URL: 'https://nvidia.test/v1',
  CASTING_MODEL: 'omni',
  DOSSIERS: new RecordingKV(),
  STORYBOARD_IMAGES: new MockR2(),
});

/**
 * The model's reply. It keeps 1, 3, 5 and 7; frame 5 is cropped. With `stranger`, frame 3 is a
 * different subject — which makes the whole film a reel, however the model classified it.
 */
const pickReply = ({ stranger = false } = {}) => ({
  pieceMarkers: ['sculpted hand', 'matte skin'],
  frames: Array.from({ length: CANDIDATE_FRAMES }, (_, i) => ({
    frame: i + 1,
    subject: stranger && i + 1 === 3 ? 'a different figure' : 'the sculpted hand',
    looks: `state ${i + 1}`,
    sameAsPiece: !(stranger && i + 1 === 3),
    usable: i + 1 !== 5,
    keep: [1, 3, 5, 7].includes(i + 1),
    shows: `state ${i + 1}`,
  })),
  filmKind: 'transformation',
  why: 'the states',
});

/**
 * The network, doubled. `edge` answers Cloudflare's frame extraction; the film host answers by
 * Range, as nft2-cdn does: a 64-byte probe, a 256KB head carrying mvhd.
 */
const serve = ({ edge = () => new Response(jpeg(1280, 1280), { status: 200, headers: { 'content-type': 'image/jpeg' } }), reply = pickReply() } = {}) => {
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href === STUB) return new Response(new TextEncoder().encode('{"keyName":"stub","partialUpload":true}'), { status: 206 });
    if (href === FILM) return new Response(mp4Head(), { status: 206 });
    if (href === STILL) return new Response(png(), { status: 200, headers: { 'content-type': 'image/png' } });
    if (href.startsWith(`${ORIGIN}/cdn-cgi/media/`)) return edge(href);
    if (href.startsWith('https://nvidia.test/')) {
      return new Response(
        JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'emit_frames', arguments: JSON.stringify(reply) } }] } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('nope', { status: 404 });
  };
  return calls;
};
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

// ───────────────────────────────────────────────────────────────────────── a film's length

test("a film's length is read from its mvhd box, in both box versions", () => {
  assert.equal(mp4Duration(mp4Head({ timescale: 1000, duration: 17_770 })), 17.77);
  assert.equal(mp4Duration(mp4Head({ timescale: 600, duration: 3750, version: 1 })), 6.25);
  assert.equal(mp4Duration(new Uint8Array(100)), null);
});

test('an implausible length is refused rather than trusted', () => {
  assert.equal(mp4Duration(mp4Head({ timescale: 1, duration: 999_999 })), null);
  assert.equal(mp4Duration(mp4Head({ timescale: 1000, duration: 0 })), null);
});

test('a WebM length is Duration × TimecodeScale', () => {
  const bytes = new Uint8Array(40);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  bytes.set([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40], 8); // TimecodeScale = 1,000,000
  bytes.set([0x44, 0x89, 0x88], 20);
  new DataView(bytes.buffer).setFloat64(23, 12_500); // 12,500 ticks of 1ms
  assert.equal(webmDuration(bytes), 12.5);
});

// ───────────────────────────────────────────────────────────────────── reference routing

test('a frame reference names the stored image by time, and round-trips', () => {
  const ref = frameRefKey(KEY, 7.17);
  assert.equal(ref, `${KEY}@7.17s`);
  assert.deepEqual(parseRefKey(ref), { key: KEY, atSeconds: 7.17 });
  assert.deepEqual(parseRefKey(KEY), { key: KEY, atSeconds: null });
});

test("a plan's frame slots resolve through the stored record; a frame that is gone falls back to the still", async () => {
  const env = envWith();
  await env.DOSSIERS.put(filmFramesKey(KEY), JSON.stringify({ status: 'ready', frames: [{ n: 1, atSeconds: 0.3 }, { n: 2, atSeconds: 7.17 }] }));
  const refs = await refKeysForPlan(env, [{ key: KEY }, { key: KEY, frame: 2 }, { key: KEY, frame: 9 }, { key: 'other:0x1:1' }]);
  assert.deepEqual(refs, [KEY, `${KEY}@7.17s`, KEY, 'other:0x1:1']);
});

test('a stored frame reads back as a JPEG data URI, and a missing one as null', async () => {
  const env = envWith();
  await env.STORYBOARD_IMAGES.put(frameR2Key(KEY, 0.3), jpeg(1280, 1280), { httpMetadata: { contentType: 'image/jpeg' } });
  assert.match(await readFrameDataUri(env, KEY, 0.3), /^data:image\/jpeg;base64,/);
  assert.equal(await readFrameDataUri(env, KEY, 9.9), null);
});

// ──────────────────────────────────────────────────────────────────────────── the queue

test('frames are asked for once: a pending request or an existing record stops a second', async () => {
  const sent = [];
  const env = { ...envWith(), FILM_FRAMES_JOBS: { send: async (body) => sent.push(body) } };
  assert.deepEqual(await requestFilmFrames(env, { key: KEY, stills: [STILL], films: [] }), { queued: false, reason: 'no film' });
  assert.deepEqual(await requestFilmFrames(env, { key: KEY, stills: [STILL], films: [FILM] }), { queued: true });
  assert.equal((await requestFilmFrames(env, { key: KEY, stills: [STILL], films: [FILM] })).reason, 'pending');
  await env.DOSSIERS.put(filmFramesKey(KEY), JSON.stringify({ status: 'ready' }));
  await env.DOSSIERS.delete(`filmframes:pending:${KEY}`);
  assert.equal((await requestFilmFrames(env, { key: KEY, stills: [STILL], films: [FILM] })).reason, 'already recorded');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { key: KEY, stills: [STILL], films: [FILM] });
});

// ───────────────────────────────────────────────────────────────────────── the pipeline

test('a transformation: every kept state is stored in time order, the unusable one is not', async () => {
  const env = envWith();
  const calls = serve();
  const record = await computeFilmFrames(env, { key: KEY, stills: [STILL], films: [STUB, FILM] });

  assert.equal(record.status, 'ready');
  assert.equal(record.film, FILM, 'the partial-mirror stub is skipped for the next candidate');
  assert.equal(record.duration, 17.77);
  assert.equal(record.filmKind, 'transformation');
  assert.match(record.binding, /moments .* in order/);
  // Kept 1, 3, 5, 7 — 5 is cropped — so three are stored, renumbered 1-3 for the Screenwriter.
  assert.deepEqual(record.frames.map((frame) => frame.n), [1, 2, 3]);
  const times = record.frames.map((frame) => frame.atSeconds);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'in time order');
  for (const frame of record.frames) {
    const stored = env.STORYBOARD_IMAGES.objects.get(frame.r2Key);
    assert.ok(stored, `frame at ${frame.atSeconds}s stored`);
    assert.equal(stored.customMetadata.sourceUrl, FILM, 'provenance travels with the image');
  }
  // Candidates at the pick width, kept frames at the reference width — never the other way round.
  assert.equal(calls.filter((url) => url.includes('width=512/')).length, CANDIDATE_FRAMES);
  assert.equal(calls.filter((url) => url.includes('width=1280/')).length, 3);
  assert.deepEqual(env.DOSSIERS.options.get(filmFramesKey(KEY)), {}, 'a ready record is permanent');
  assert.equal(await env.DOSSIERS.get(`filmframes:pending:${KEY}`), null, 'the pending marker is cleared');
});

test('a stranger in one frame makes the film a reel: that frame is never stored, and the rest are capped', async () => {
  const env = envWith();
  serve({ reply: pickReply({ stranger: true }) });
  const record = await computeFilmFrames(env, { key: KEY, stills: [STILL], films: [FILM] });
  assert.equal(record.filmKind, 'reel', 'overruled from "transformation"');
  assert.match(record.binding, /ONE subject/);
  assert.ok(record.overruled.some((line) => /treated as a reel/.test(line)));
  assert.ok(record.overruled.some((line) => /frame 3 kept but judged a different subject/.test(line)));
  const strangerTime = record.verdicts.find((verdict) => verdict.frame === 3).atSeconds;
  assert.ok(!record.frames.some((frame) => frame.atSeconds === strangerTime), 'the stranger is not stored');
  assert.ok([...env.STORYBOARD_IMAGES.objects.keys()].every((key) => !key.endsWith(`/${strangerTime}.jpg`)));
});

test('a film that exists but the edge refuses is recorded, and retried after a day', async () => {
  const env = envWith();
  serve({ edge: () => new Response('MEDIA_TRANSFORMATION_ERROR 9401: Transformation origin is not in allowed origins list', { status: 403 }) });
  const record = await computeFilmFrames(env, { key: KEY, stills: [STILL], films: [FILM] });
  assert.equal(record.status, 'edge-refused');
  assert.match(record.detail, /allowed origins/);
  assert.equal(env.DOSSIERS.options.get(filmFramesKey(KEY)).expirationTtl, 86_400);
});

test('a film the edge refuses gives way to the next real film, instead of recording a refusal', async () => {
  // Godzilla on staging, 2026-09-18: an S3 original first (outside the allowed origins), then
  // Alchemy's copy on nft2-cdn (inside them).
  const S3 = 'https://tv-inventory.s3.eu-west-2.amazonaws.com/gz.mp4';
  const env = envWith();
  const calls = serve({
    edge: (href) =>
      href.endsWith(`/${S3}`)
        ? new Response('MEDIA_TRANSFORMATION_ERROR 9401: Transformation origin is not in allowed origins list', { status: 403 })
        : new Response(jpeg(1280, 1280), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
  });
  const film = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url) === S3 ? new Response(mp4Head(), { status: 206 }) : film(url, init));
  const record = await computeFilmFrames(env, { key: KEY, stills: [STILL], films: [S3, FILM] });
  assert.equal(record.status, 'ready');
  assert.equal(record.film, FILM);
  assert.ok(calls.some((url) => url.endsWith(`/${S3}`)), 'the S3 original was tried first');
});

test('no candidate that is actually a film is recorded, and re-checked after a week — not forever', async () => {
  const env = envWith();
  serve();
  const record = await computeFilmFrames(env, { key: KEY, stills: [STILL], films: [STUB] });
  assert.equal(record.status, 'no-film');
  assert.equal(env.DOSSIERS.options.get(filmFramesKey(KEY)).expirationTtl, 7 * 86_400);
});

test('a kept frame that fails H3\'s floors is skipped, not stored', async () => {
  const env = envWith();
  serve({
    edge: (href) =>
      new Response(href.includes('width=1280/') ? jpeg(1280, 200) : jpeg(512, 512), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
  });
  const record = await computeFilmFrames(env, { key: KEY, stills: [STILL], films: [FILM] });
  assert.equal(record.status, 'none-kept');
  assert.equal(record.frames.length, 0);
  assert.ok(record.skipped.every((line) => /200|256|aspect/.test(line)));
  assert.equal(env.STORYBOARD_IMAGES.objects.size, 0);
});

// ─────────────────────────────────────────────────────────────────────────── screen tests

test('a rehearsal sends the take\'s own references — every slot, frames included, in order', async () => {
  const env = envWith();
  await env.DOSSIERS.put(filmFramesKey(KEY), JSON.stringify({ status: 'ready', frames: [{ n: 1, atSeconds: 4.82 }, { n: 2, atSeconds: 22.88 }] }));
  const spec = { referencePlan: [{ key: KEY, frame: 1 }, { key: 'ape:0x1:1' }, { key: KEY, frame: 2 }] };
  const refs = await screenTestRefKeys(env, spec, { focus: 'rehearsal', refKeys: [KEY, 'ape:0x1:1'] });
  assert.deepEqual(refs, [`${KEY}@4.82s`, 'ape:0x1:1', `${KEY}@22.88s`]);
});

test('an identity test sends the piece\'s FIRST slot as the take sends it — here, a frame', async () => {
  const env = envWith();
  await env.DOSSIERS.put(filmFramesKey(KEY), JSON.stringify({ status: 'ready', frames: [{ n: 1, atSeconds: 4.82 }] }));
  const spec = { referencePlan: [{ key: KEY, frame: 1 }, { key: KEY }] };
  assert.deepEqual(await screenTestRefKeys(env, spec, { focus: 'identity', refKeys: [KEY] }), [`${KEY}@4.82s`]);
  assert.deepEqual(await screenTestRefKeys(env, { referencePlan: [{ key: KEY }] }, { focus: 'identity', refKeys: [KEY] }), [KEY]);
});
