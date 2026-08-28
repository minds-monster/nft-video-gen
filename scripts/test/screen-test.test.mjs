// Screen Tests: what a $0.32 render is allowed to be, and what it must never be.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is a test that cannot come back with a surprising
// answer. scripts/probe-h3.mjs names it exactly, about its own P8 probe:
//
//   "The discriminator is ORDER, not fidelity. Both these references are known-good — they
//    rendered correctly in launch-1 — so 'did they appear' tells us nothing new."
//
// A Screen Test that restages the whole film answers nothing: if it comes back wrong, you cannot
// say which of nine things was wrong. So an identity test STRIPS THE FILM AWAY and shows one
// subject in a void — and the assertions below are mostly about what is NOT in the script.
//
// The second failure guarded here is subtler and would look like a discovery: a test that fails
// because the anti-mannequin guard was stripped along with everything else has taught us nothing
// about the film, only about the test.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScreenTest, demandAsRisk, isDemandId, VERDICTS, verdictLabel } from '../../worker/screen-test.js';
import { assessRisks } from '../../worker/director-risks.js';
import { SCREEN_TEST, MOTION_TEST } from '../../worker/director-risks.js';

const dossier = (over = {}) => ({
  subject: 'a stylised blue-furred ape character with a tan muzzle',
  identityMarkers: ['woven yellow bucket hat', 'red heart-shaped sunglasses'],
  palette: ['blue', 'yellow'],
  medium: '3d-render',
  burnedInText: '',
  framing: 'full-bleed',
  cropAdvice: '',
  isMannequin: false,
  motionNotes: '',
  hazards: [],
  ...over,
});

const spec = (over = {}) => ({
  world: 'Night on a wet black asphalt starting grid.',
  grade: 'Photoreal.',
  guard: '',
  staging: '<Subject 1> is the ape.',
  continuity: '',
  camera: 'The camera trucks left at slow speed.',
  beats: ['the ape turns to the lens', 'the lights go green', 'the cars launch'],
  sound: 'rain',
  music: 'N/A',
  referencePlan: [{ key: 'ape', role: 'character', crop: '' }],
  duration: 6,
  resolution: '768P',
  ratio: '16:9',
  ...over,
});

const cast = (over = {}) => [{ key: 'ape', name: 'ape', dossier: dossier(over) }];

const riskFor = (specValue, castValue, id) =>
  assessRisks({ spec: specValue, cast: castValue }).risks.find((r) => r.id === id);

// ------------------------------------------------------------------------------ identity

test('an identity test shows one subject in a void, and none of the film', () => {
  const risk = riskFor(spec(), cast({ framing: 'small-in-frame' }), 'identity-at-risk:ape');
  const built = buildScreenTest(risk, spec(), cast({ framing: 'small-in-frame' }));

  assert.deepEqual(built.params, SCREEN_TEST, '4s at 768P — $0.32, cheap enough that measuring beats arguing');
  assert.match(built.script, /seamless studio/);
  // The film must not leak in. If it does, a failure cannot be attributed to the subject.
  assert.doesNotMatch(built.script, /starting grid/, "the film's world would give the answer somewhere to hide");
  assert.doesNotMatch(built.script, /lights go green/);
  assert.doesNotMatch(built.script, /cars launch/);
});

test('an identity test carries the identity markers it is testing for', () => {
  const c = cast({ framing: 'small-in-frame' });
  const built = buildScreenTest(riskFor(spec(), c, 'identity-at-risk:ape'), spec(), c);
  assert.match(built.script, /red heart-shaped sunglasses/);
  assert.match(built.script, /woven yellow bucket hat/);
});

test('the anti-mannequin guard survives the stripping, on every test', () => {
  // A test that fails because we removed the guard has taught us about the test, not the film.
  const c = cast({ framing: 'small-in-frame', medium: 'flat-2d-vector' });
  for (const id of ['identity-at-risk:ape', 'flat-art:ape']) {
    const built = buildScreenTest(riskFor(spec(), c, id), spec(), c);
    assert.match(built.script, /ordinary skin/, `${id} must keep the guard`);
  }
});

test('every test forbids ADDED type without forbidding printed type', () => {
  // Rule 8. "No text anywhere" fights the artwork itself — a cap with a number on it, a monogram.
  const c = cast({ framing: 'small-in-frame' });
  const built = buildScreenTest(riskFor(spec(), c, 'identity-at-risk:ape'), spec(), c);
  assert.match(built.script, /No captions, subtitles, watermarks or added signage/);
  assert.doesNotMatch(built.script, /no text anywhere/i);
});

// ------------------------------------------------------------------------- dimensionality

test('a flat-art test asks for a solid object and forbids the sticker outcome by name', () => {
  const c = cast({ medium: 'flat-2d-vector' });
  const built = buildScreenTest(riskFor(spec(), c, 'flat-art:ape'), spec(), c);
  assert.match(built.script, /solid physical object/);
  assert.match(built.script, /never a flat printed image, sticker or decal/);
  assert.match(built.script, /arcs slowly around/, 'depth is only visible if the camera moves around it');
});

// ------------------------------------------------------------------------------ continuity

test('a continuity test does NOT strip the film, because the film is what is under test', () => {
  const specValue = spec({ continuity: '' });
  const built = buildScreenTest(riskFor(specValue, cast(), 'uncommitted-continuity'), specValue, cast());

  assert.deepEqual(built.params, MOTION_TEST, 'four seconds cannot show a cut that has not happened yet');
  assert.match(built.script, /starting grid/, 'the real world stays — this is a test OF the film');
  assert.match(built.script, /Beat 1: /);
  assert.match(built.script, /no cuts, no edits, no jump cuts/);
});

test('a continuity test takes only the first three beats, not the whole film', () => {
  const specValue = spec({ beats: ['one', 'two', 'three', 'four', 'five'], continuity: '' });
  const built = buildScreenTest(riskFor(specValue, cast(), 'uncommitted-continuity'), specValue, cast());
  assert.match(built.script, /Beat 3: three/);
  assert.doesNotMatch(built.script, /Beat 4/, 'six seconds does not hold five beats, and a crowded test proves nothing');
});

// -------------------------------------------------------------------------------- refusals

test('a risk fixed by rewriting is never turned into a render', () => {
  // Paying to watch MiniMax reject a brand name would be absurd. The register already knows the
  // difference; this asserts the builder respects it.
  const specValue = spec({ beats: ['the Lamborghini Revuelto stands still'] });
  const castValue = [{ key: 'ape', name: 'Lamborghini Revuelto', dossier: dossier({ hazards: ['Lamborghini badge (brand mark)'] }) }];
  const risk = riskFor(specValue, castValue, 'brand-name-in-script');
  assert.ok(risk, 'the hazard is real');
  assert.equal(buildScreenTest(risk, specValue, castValue), null, 'but it is not a render');
});

test('an unknown focus produces no test rather than a guess', () => {
  assert.equal(buildScreenTest({ id: 'x', test: { focus: 'vibes', refKeys: [] } }, spec(), cast()), null);
  assert.equal(buildScreenTest({ id: 'x', test: null }, spec(), cast()), null);
});

// --------------------------------------------------------------------------------- verdicts

test('a verdict is a decision, not a rating', () => {
  // "How good was this?" has no answer anybody can act on. "Did the face survive?" does.
  assert.deepEqual(VERDICTS.map((v) => v.id), ['held', 'failed', 'unclear']);
  assert.ok(VERDICTS.every((v) => v.label && v.tone));
});

test('every built test states the question it is buying an answer to', () => {
  const c = cast({ framing: 'small-in-frame' });
  const built = buildScreenTest(riskFor(spec(), c, 'identity-at-risk:ape'), spec(), c);
  assert.match(built.question, /\?$/, 'a test without a question is a render with a smaller bill');
  assert.equal(built.riskId, 'identity-at-risk:ape', 'and it has to say which hazard it settles');
});

test('every test emits H3 three-field wire format, not a prose blob', () => {
  const c = cast({ framing: 'small-in-frame' });
  const built = buildScreenTest(riskFor(spec(), c, 'identity-at-risk:ape'), spec(), c);
  assert.match(built.script, /integrated_multimodal_description: /);
  assert.match(built.script, /overall_soundscape: /);
  assert.match(built.script, /non_diegetic_music: N\/A/);
  assert.ok(built.script.length < 7000, 'H3 caps each field at 7000 characters');
});

// ------------------------------------------------------------------------------- rehearsals
//
// THE THIRD SHAPE, and the opposite of the identity test above: a rehearsal KEEPS the film,
// because the thing under test is whether the model can DO what the beat asks, in the scene it
// asks for it in. A rehearsal that came back "held" against a black void would have told the
// Hollywood-sign film nothing. The second guard is the anti-dissolve line: rule 12's finding is
// that a transformation gets cheated with a crossfade, and a rehearsal that quietly allowed the
// cheat would be a false negative.

const brainSpec = (over = {}) =>
  spec({
    world: 'Golden hour over dry hills, the white letters of a hillside sign catching low sun.',
    guard: 'Every character has ordinary skin.',
    staging: '<Subject 1> is the hillside sign in <Picture 1>.',
    camera: 'The camera pushes in with medium amplitude at slow speed.',
    beats: [
      'the camera closes on the letters',
      'the letters inflate like balloons and morph into an enormous brain',
      'the brain pulses',
    ],
    referencePlan: [{ key: 'sign', role: 'prop', crop: '' }],
    ...over,
  });

const brainCast = [{ key: 'sign', dossier: dossier({ subject: 'a hillside sign of white capital letters' }) }];

const rehearsalRisk = (over = {}) => ({
  id: 'transformation-faked:2',
  what: 'beat 2 asks one thing to become another',
  measured: 'measured',
  test: {
    question: 'Does the change in beat 2 physically happen?',
    params: MOTION_TEST,
    refKeys: ['sign'],
    focus: 'rehearsal',
    beats: [2],
    ...over,
  },
});

test('a rehearsal keeps the world, the staging and the camera, and renders the named beat', () => {
  const built = buildScreenTest(rehearsalRisk(), brainSpec(), brainCast);
  assert.ok(built);
  assert.deepEqual(built.params, MOTION_TEST, 'six seconds — a transformation needs two beats of time');
  assert.match(built.script, /hillside sign catching low sun/, 'the world survives');
  assert.match(built.script, /<Subject 1> is the hillside sign/, 'the staging survives');
  assert.match(built.script, /pushes in with medium amplitude/, 'the camera survives');
  assert.match(built.script, /Beat 1: the letters inflate like balloons/, 'the named beat, renumbered from 1');
  assert.doesNotMatch(built.script, /the brain pulses/, 'and only the named beat');
  assert.deepEqual(built.refKeys, ['sign']);
});

test('a test carries its own answer labels to the take, and the generic ones are the fallback', () => {
  const labelled = buildScreenTest(
    rehearsalRisk({ answers: { held: 'The letters became the brain', failed: 'A brain faded in over them', unclear: 'Cannot tell' } }),
    brainSpec(),
    brainCast,
  );
  assert.equal(labelled.answers.held, 'The letters became the brain');
  const generic = buildScreenTest(rehearsalRisk(), brainSpec(), brainCast);
  assert.equal(generic.answers, null);
  assert.equal(verdictLabel({ answers: labelled.answers }, 'failed'), 'A brain faded in over them');
  assert.equal(verdictLabel({}, 'failed'), 'It did not');
});

test('the register\'s own rule-12 risk builds the same rehearsal', () => {
  const specValue = brainSpec();
  const risk = riskFor(specValue, brainCast, 'transformation-faked:2');
  assert.ok(risk, 'rule 12 fires on the morph');
  const built = buildScreenTest(risk, specValue, brainCast);
  assert.match(built.script, /Beat 1: the letters inflate like balloons/);
  assert.equal(built.riskId, 'transformation-faked:2');
});

test('a rehearsal forbids the dissolve, so the cheat cannot come back as "held"', () => {
  const built = buildScreenTest(rehearsalRisk(), brainSpec(), brainCast);
  assert.match(built.script, /Nothing fades in or out, nothing dissolves, nothing is superimposed/);
  assert.match(built.script, /one single continuous unbroken shot/);
});

test('a demand\'s direction replaces the beat text — the constraint is what gets rehearsed', () => {
  const direction =
    'The letters are rubber. They inflate, fuse along their seams into one mass, and that mass folds into the ridges of a brain. The camera holds on them throughout.';
  const built = buildScreenTest(rehearsalRisk({ direction }), brainSpec(), brainCast);
  assert.match(built.script, /Beat 1: The letters are rubber\. They inflate/);
  assert.doesNotMatch(built.script, /inflate like balloons/, 'the original beat is not rendered alongside it');
});

test('a rehearsal with no named beat renders the first beats of the film', () => {
  const built = buildScreenTest(rehearsalRisk({ beats: [] }), brainSpec(), brainCast);
  assert.match(built.script, /Beat 1: the camera closes on the letters/);
  assert.match(built.script, /Beat 2: the letters inflate/);
  assert.match(built.script, /Beat 3: the brain pulses/);
});

test('a rehearsal keeps the anti-mannequin guard when the script has none', () => {
  const built = buildScreenTest(rehearsalRisk(), brainSpec({ guard: '' }), brainCast);
  assert.match(built.script, /ordinary skin/);
});

// --------------------------------------------------------------------------------- demands

test('a demand becomes a risk the panel and the test endpoint already understand', () => {
  const risk = demandAsRisk({
    id: 'letters-become-brain',
    question: 'Do the letters physically become the brain?',
    why: 'the prompt says literally',
    beats: [2],
    refKeys: ['sign'],
    direction: 'The letters are rubber...',
    onHeld: 'shoot',
    onFailed: 'split the beat',
  });
  assert.equal(risk.id, 'demand:letters-become-brain');
  assert.ok(isDemandId(risk.id));
  assert.equal(risk.source, 'director');
  assert.equal(risk.measured, null, 'judgement is labelled as judgement');
  assert.equal(risk.judgement, 'the prompt says literally');
  assert.equal(risk.estUsd, 0.48, 'priced from the parameters, never by the model');
  assert.equal(risk.test.focus, 'rehearsal');
  assert.equal(risk.test.direction, 'The letters are rubber...');
});

test('a demand with no id or question is not a risk', () => {
  assert.equal(demandAsRisk({ question: 'q?' }), null);
  assert.equal(demandAsRisk({ id: 'x' }), null);
  assert.equal(demandAsRisk(null), null);
});
