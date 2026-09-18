// Film frames in a shot spec — the numbering rule, and the Screenwriter's checks on frame slots.
//
// THE FAILURE THESE EXIST TO PREVENT: a piece given three reference slots (its still plus two
// film frames) is ONE subject. Every consumer that numbered subjects by slot position — the
// Storyboarder, the scene header, the Director's plan — would have called its extra pictures
// <Subject 2> and <Subject 3>: three subjects where the film has one, and the piece after it
// renumbered out from under the Screenwriter's own staging.

import test from 'node:test';
import assert from 'node:assert/strict';

import { subjectSlots } from '../../worker/rulebook.js';
import { filmFramesLine, validate } from '../../worker/screenwriter.js';

const HAND = 'eth-mainnet:0x4f18cba70fc9976398e3481a101c83e1e98fdf7c:5';
const APE = 'eth-mainnet:0x28472a58a490c5e09a238847f66a68a47cc76f0f:1';

const frames = {
  status: 'ready',
  filmKind: 'transformation',
  binding: 'moments from ONE continuous performance, in order, not different subjects',
  frames: [
    { n: 1, atSeconds: 0.3, shows: 'standing on two fingertips' },
    { n: 2, atSeconds: 7.17, shows: 'fingers fanned into a starburst' },
    { n: 3, atSeconds: 15.18, shows: 'curled at rest' },
  ],
};

const cast = [
  { key: HAND, dossier: { subject: 'a sculpted hand' }, filmFrames: frames },
  { key: APE, dossier: { subject: 'an ape in a lime tracksuit' }, filmFrames: null },
];

const spec = (referencePlan) => ({
  title: 't', logline: 'l', world: 'a studio', grade: 'g', guard: '', continuity: '', camera: 'static',
  staging: '<Subject 1> is the sculpted hand in <Picture 1>, <Picture 3> and <Picture 4>. <Subject 2> is the ape in <Picture 2>.',
  beats: ['<Subject 1> dances'], sound: 's', music: 'N/A', duration: 6, resolution: '768P', ratio: '1:1',
  intentTrace: [], notes: '', referencePlan,
});

const caps = { maxBeats: 6, maxReferences: 9 };
const slot = (key, frame) => ({ key, role: 'character', crop: '', ...(frame ? { frame } : {}) });

test('subjects are numbered from each piece\'s FIRST slot; frame slots only add pictures', () => {
  const plan = [slot(HAND), slot(APE), slot(HAND, 2), slot(HAND, 3)];
  assert.deepEqual(subjectSlots(plan).map((s) => s.key), [HAND, APE]);
  assert.deepEqual(subjectSlots([]), []);
  assert.deepEqual(subjectSlots(undefined), []);
});

test('frame slots after every piece\'s first slot pass', () => {
  assert.doesNotThrow(() => validate(spec([slot(HAND), slot(APE), slot(HAND, 2), slot(HAND, 3)]), cast, caps));
});

test('a piece\'s first slot after a frame slot is refused — it would renumber that subject', () => {
  assert.throws(
    () => validate(spec([slot(HAND), slot(HAND, 2), slot(APE)]), cast, caps),
    /first slot after a repeated \(film-frame\) slot/,
  );
});

test('a frame slot must name a frame that exists', () => {
  assert.throws(() => validate(spec([slot(HAND), slot(APE), slot(HAND, 7)]), cast, caps), /frames 1-3/);
  assert.throws(() => validate(spec([slot(HAND), slot(APE, 1)]), cast, caps), /it has none/);
});

test('frame slots count against the tier\'s reference cap like any other slot', () => {
  assert.throws(
    () => validate(spec([slot(HAND), slot(APE), slot(HAND, 2), slot(HAND, 3)]), cast, { maxBeats: 6, maxReferences: 3 }),
    /plans 4 reference slots; tier allows 3/,
  );
});

test('the Screenwriter is shown frames only when there are some, with the kind and the binding wording', () => {
  const line = filmFramesLine(frames);
  assert.match(line, /its film is a transformation/);
  assert.match(line, /moments from ONE continuous performance, in order/);
  assert.match(line, /frame 2 \(7\.17s\): fingers fanned into a starburst/);
  assert.equal(filmFramesLine(null), null);
  assert.equal(filmFramesLine({ status: 'none-kept', frames: [] }), null);
  assert.equal(filmFramesLine({ status: 'edge-refused' }), null);
});
