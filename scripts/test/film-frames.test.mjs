// worker/film-frames.js — the guards that sit ABOVE the model's frame choice.
//
// THE FAILURE THESE EXIST TO PREVENT, measured 2026-09-18 (scripts/probe-frame-pick.mjs): asked
// holistically, the model called the adidas Into the Metaverse promo reel — four different
// characters — a "transformation", and kept another holder's ape as "a distinct outfit state".
// Rendered, that is an NFT the visitor does not own in their film. So the model's per-frame
// verdicts overrule its own conclusion, in code, and these tests hold that line.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANDIDATE_FRAMES,
  MAX_KEPT_FRAMES,
  MAX_REEL_FRAMES,
  framePickRequest,
  validateFramePick,
} from '../../worker/film-frames.js';

const verdict = (frame, { same = true, usable = true, keep = false, shows = '' } = {}) => ({
  frame,
  subject: same ? 'the ape in the lime tracksuit' : 'a different ape in a black hoodie',
  looks: 'front view',
  sameAsPiece: same,
  usable,
  keep,
  shows,
});

test('a frame the model judged a different subject is never kept, whatever `keep` says', () => {
  const pick = validateFramePick(
    {
      pieceMarkers: ['lime tracksuit', 'yellow cap'],
      filmKind: 'transformation',
      frames: [verdict(1, { keep: true }), verdict(2, { same: false, keep: true, shows: 'a distinct outfit state' })],
      why: '',
    },
    2,
  );
  assert.deepEqual(pick.keep.map((k) => k.frame), [1]);
  assert.ok(pick.overruled.some((line) => /frame 2 kept but judged a different subject/.test(line)));
});

test('any different subject makes the film a reel, however it was classified, and caps it', () => {
  const frames = [
    ...Array.from({ length: 5 }, (_, i) => verdict(i + 1, { keep: true })),
    verdict(6, { same: false }),
  ];
  const pick = validateFramePick({ pieceMarkers: ['a', 'b'], filmKind: 'transformation', frames, why: '' }, 6);
  assert.equal(pick.filmKind, 'reel');
  assert.equal(pick.keep.length, MAX_REEL_FRAMES);
  assert.ok(pick.overruled.some((line) => /treated as a reel/.test(line)));
});

test('an unusable frame — cropped, blurred, a close-up — is dropped even when kept', () => {
  const pick = validateFramePick(
    { pieceMarkers: ['a', 'b'], filmKind: 'transformation', frames: [verdict(1, { keep: true }), verdict(2, { usable: false, keep: true })], why: '' },
    2,
  );
  assert.deepEqual(pick.keep.map((k) => k.frame), [1]);
});

test('a genuine transformation keeps every state, in time order, up to nine', () => {
  const frames = Array.from({ length: 11 }, (_, i) => verdict(11 - i, { keep: true, shows: `state ${11 - i}` }));
  const pick = validateFramePick({ pieceMarkers: ['a', 'b'], filmKind: 'transformation', frames, why: '' }, 11);
  assert.equal(pick.filmKind, 'transformation');
  assert.equal(pick.keep.length, MAX_KEPT_FRAMES);
  assert.deepEqual(pick.keep.map((k) => k.frame), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('a verdict must exist for every frame shown — a skipped frame is a refusal, not a pass', () => {
  assert.throws(
    () => validateFramePick({ pieceMarkers: ['a', 'b'], filmKind: 'turntable', frames: [verdict(1), verdict(3)], why: '' }, 3),
    /No verdict for frame 2/,
  );
});

test('frame numbers the model invents, repeats, or a kind it makes up, are refused', () => {
  assert.throws(() => validateFramePick({ filmKind: 'turntable', frames: [verdict(4)] }, 3), /not one of the 3 shown/);
  assert.throws(() => validateFramePick({ filmKind: 'turntable', frames: [verdict(1), verdict(1)] }, 1), /judged twice/);
  assert.throws(() => validateFramePick({ filmKind: 'montage', frames: [] }, 0), /Unknown filmKind/);
});

test('the request refuses more frames than CANDIDATE_FRAMES, and counts the still among the images', () => {
  const env = { CASTING_MODEL: 'm' };
  const frames = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1, atSeconds: i, dataUri: 'data:image/jpeg;base64,' }));
  assert.equal(framePickRequest(env, { still: 'data:image/jpeg;base64,', frames: frames(CANDIDATE_FRAMES) }).messages[1].content.filter((p) => p.type === 'image_url').length, CANDIDATE_FRAMES + 1);
  assert.throws(() => framePickRequest(env, { still: 'x', frames: frames(CANDIDATE_FRAMES + 1) }), /answers reliably/);
});

test('candidates stop a second before the end, clear of a fade-out', async () => {
  const { candidateTimes } = await import('../../worker/film-frames.js');
  const times = candidateTimes(17.77);
  assert.equal(times.length, CANDIDATE_FRAMES);
  assert.ok(times.at(-1) <= 17.77 - 0.9, `last candidate ${times.at(-1)}s is inside the last second`);
  assert.ok(times[0] < 0.5);
});
