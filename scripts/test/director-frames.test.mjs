// Frame sampling, and the failure it is designed to make impossible.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is the one this project has already paid for. From
// scripts/hero-prompts.mjs, about a post-mortem that stood as fact for weeks:
//
//   "the old `select='not(mod(n,round(max(1,t))))'` filter, whose interval GROWS WITH t, crushed
//    every sample into the opening second … Both are FALSE, and together they cost this project
//    its architecture."
//
// A four-beat shot read as a static tableau, the architecture was rebuilt around a conclusion
// that was backwards, and nothing about the sheet looked wrong. So the assertion that matters
// below is not that sampling works — it is that the interval CANNOT grow with t, at any duration.
//
// The second thing guarded here is the degradation. Frame extraction depends on a per-zone
// Cloudflare toggle that is currently OFF for minds.monster, so "no frames" is the ordinary path
// today and must cost nothing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFrames, framesAvailable, sampleTimes, frameToDataUri } from '../../worker/frames.js';

class MockKV {
  store = new Map();
  async get(key, type = 'text') {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key, value) { this.store.set(key, value); }
}
const makeEnv = () => ({ MIND_CONNECTIONS: new MockKV() });

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });

// ------------------------------------------------------------------------------- sampling

test('the interval never grows with t — the bug that inverted a conclusion', () => {
  for (const duration of [4, 6, 10, 15]) {
    const times = sampleTimes(duration);
    const gaps = times.slice(1).map((value, index) => value - times[index]);
    const first = gaps[0];
    for (const gap of gaps) {
      // Rounding to 2dp moves a gap by at most 0.02s. A GROWING interval is the failure: the old
      // filter's last gap was many times its first.
      assert.ok(Math.abs(gap - first) < 0.05, `${duration}s: gap ${gap} drifted from ${first}`);
    }
  }
});

test('sampling covers the clip rather than clumping at the start', () => {
  // The precise symptom of the original bug: every sample inside the opening second.
  const times = sampleTimes(15);
  assert.ok(times.at(-1) > 14, 'the end of the clip has to be looked at');
  assert.ok(times.filter((t) => t < 1).length <= 1, 'no clumping at the head');
});

test('sampling stays inside the clip and off both ends', () => {
  for (const duration of [4, 6, 15]) {
    const times = sampleTimes(duration);
    assert.ok(times[0] > 0, 'frame zero is a fade, not evidence');
    assert.ok(times.at(-1) < duration, 'past the end is not a frame');
  }
});

test('a short clip still yields the asked-for number of distinct samples', () => {
  const times = sampleTimes(4, 8);
  assert.equal(times.length, 8);
  assert.equal(new Set(times).size, 8, 'eight of the same frame is one frame and a bigger bill');
});

// ------------------------------------------------------------- the capability, and its absence

test('an unavailable zone is reported, not thrown, and says what would fix it', async () => {
  const env = makeEnv();
  globalThis.fetch = async () => new Response('not found', { status: 404 });
  const result = await extractFrames(env, { sourceUrl: 'https://x/v.mp4', origin: 'https://x', durationSeconds: 4 });
  assert.equal(result.available, false);
  assert.deepEqual(result.frames, []);
  assert.match(result.why, /per-zone toggle/);
});

test('the capability is probed once and then cached', async () => {
  const env = makeEnv();
  let probes = 0;
  globalThis.fetch = async () => { probes += 1; return new Response('nope', { status: 404 }); };
  await framesAvailable(env, { origin: 'https://x', sourceUrl: 'https://x/v.mp4' });
  await framesAvailable(env, { origin: 'https://x', sourceUrl: 'https://x/v.mp4' });
  assert.equal(probes, 1, 'a probe per render is a request per render against a rate-limited edge');
});

test('a 200 that is not an image does not count as available', async () => {
  // A zone with the feature off can still answer 200 with an HTML error page. Checking the status
  // alone would report frames that are actually markup.
  const env = makeEnv();
  globalThis.fetch = async () => new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  assert.equal(await framesAvailable(env, { origin: 'https://x', sourceUrl: 'https://x/v.mp4' }), false);
});

test('a transport failure degrades to unavailable rather than failing the render', async () => {
  const env = makeEnv();
  globalThis.fetch = async () => { throw new TypeError('network down'); };
  const result = await extractFrames(env, { sourceUrl: 'https://x/v.mp4', origin: 'https://x', durationSeconds: 6 });
  assert.equal(result.available, false);
});

// ---------------------------------------------------------------------------- the happy path

test('an available zone returns one frame per requested timestamp, each carrying its own time', async () => {
  const env = makeEnv();
  globalThis.fetch = async () => jpeg();
  const result = await extractFrames(env, { sourceUrl: 'https://x/v.mp4', origin: 'https://x', durationSeconds: 6, count: 5 });
  assert.equal(result.available, true);
  assert.equal(result.frames.length, 5);
  // The timestamp travelling WITH the picture is what makes a question about ordering answerable.
  assert.deepEqual(result.frames.map((f) => f.atSeconds), sampleTimes(6, 5));
});

test('the requested time is in the URL, so sampling is stated rather than derived', async () => {
  const env = makeEnv();
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return jpeg(); };
  await extractFrames(env, { sourceUrl: 'https://x/v.mp4', origin: 'https://x', durationSeconds: 4, count: 3 });
  // No filter expression whose behaviour has to be reasoned about — this is the structural fix.
  for (const url of urls.slice(1)) assert.match(url, /mode=frame,time=[\d.]+s/);
});

test('a missing frame is dropped and COUNTED, never silently replaced', async () => {
  // Five of eight is different evidence from eight of eight, and a judge that cannot tell will
  // answer as though it could.
  const env = makeEnv();
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) return jpeg();          // the capability probe
    return call % 2 === 0 ? jpeg() : new Response('', { status: 500 });
  };
  const result = await extractFrames(env, { sourceUrl: 'https://x/v.mp4', origin: 'https://x', durationSeconds: 6, count: 6 });
  assert.equal(result.requested, 6);
  assert.ok(result.frames.length < 6);
  assert.equal(result.frames.length + result.missed.length, 6, 'every requested sample is accounted for');
});

test('frameToDataUri produces what the vision model takes', () => {
  const uri = frameToDataUri(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer);
  assert.match(uri, /^data:image\/jpeg;base64,/);
});
