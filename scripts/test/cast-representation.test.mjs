// What a piece IS in space, checked the way the golden-fixture suite checks geometry.
//
// Two things are under test here and they fail in different places. The Casting Director's
// profile floor runs at CASTING time, where a defect is still repairable for the price of one
// call. The height-agreement check runs at BLOCKING time, where the dossier's measurement and
// the model's staging can be compared for the first time.
//
// The case that matters most is the cheapest one: a character labelled a vehicle. Nothing
// downstream of casting ever sees the artwork again, so nothing downstream can catch it.
//
//   node --test scripts/test/cast-representation.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePhysicalProfile } from '../../worker/casting-director.js';
import { validateScene, castLine } from '../../worker/scene.js';

const ape = {
  bodyPlan: 'biped',
  heightM: 1.5,
  widthM: 0.6,
  depthM: 0.35,
  heightConfidence: 'inferred',
  headRatio: 5.5,
  silhouetteNotes: 'broad shoulders, heavy brow, no neck',
  facing: 'toward',
};

// A scene is only ever compared against a profile through its subjects, so the fixture is the
// smallest thing validateScene will accept as a shot.
const sceneWith = (heightM) => ({
  beatIndex: 0,
  kind: 'shot',
  camera: {
    start: { position: { x: 0, y: 1.6, z: 8 }, lookAt: { x: 0, y: 1, z: 0 } },
    end: { position: { x: 0, y: 1.6, z: 8 }, lookAt: { x: 0, y: 1, z: 0 } },
    focalStartMm: 35,
    focalEndMm: 35,
    rollDeg: 0,
  },
  subjects: [{
    subject: '<Subject 1>',
    x: 0, z: 0, endX: 0, endZ: 0,
    groundOffsetM: 0,
    heightM,
    widthM: 0.6,
    yawDeg: 0,
    containerId: null,
    action: 'standing',
  }],
  principalSubject: '<Subject 1>',
});

const profiles = { '<Subject 1>': ape };
const codes = (scene, options) =>
  validateScene(scene, options).filter((v) => v.code === 'height-contradicts-profile');

test('a well-formed profile passes', () => {
  assert.equal(validatePhysicalProfile(ape), null);
});

test('a biped wider than it is tall is rejected — the vehicle-mislabel floor', () => {
  const complaint = validatePhysicalProfile({ ...ape, widthM: 2.0, heightM: 1.3 });
  assert.match(complaint, /wider than it is tall/);
});

test('the same dimensions are fine once the body plan says vehicle', () => {
  assert.equal(validatePhysicalProfile({ ...ape, bodyPlan: 'vehicle', widthM: 2.0, heightM: 1.3, headRatio: null }), null);
});

test('a dimension outside the believable range is rejected', () => {
  assert.match(validatePhysicalProfile({ ...ape, heightM: 1800 }), /outside the believable range/);
  assert.match(validatePhysicalProfile({ ...ape, depthM: 0 }), /outside the believable range/);
});

test('a non-numeric dimension is rejected rather than coerced', () => {
  assert.match(validatePhysicalProfile({ ...ape, widthM: '0.6' }), /not a number/);
});

test('an unknown body plan is rejected with the list of real ones', () => {
  const complaint = validatePhysicalProfile({ ...ape, bodyPlan: 'humanoid' });
  assert.match(complaint, /bodyPlan is "humanoid"/);
  assert.match(complaint, /biped/);
});

test('headRatio may be null, but may not be nonsense', () => {
  assert.equal(validatePhysicalProfile({ ...ape, headRatio: null }), null);
  assert.match(validatePhysicalProfile({ ...ape, headRatio: 30 }), /headRatio is 30/);
});

test('a missing profile is a complaint, not a crash', () => {
  assert.match(validatePhysicalProfile(undefined), /missing/);
});

test('staging that agrees with the measurement is silent', () => {
  assert.equal(codes(sceneWith(1.5), { profiles }).length, 0);
});

test('a moderate disagreement is SOFT — a tuned constant never vetoes a film', () => {
  const found = codes(sceneWith(2.1), { profiles });
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'soft');
});

test('a factor-of-two disagreement is FLOOR — the shot size is computed on the wrong object', () => {
  const found = codes(sceneWith(4.5), { profiles });
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'floor');
  assert.equal(found[0].subject, '<Subject 1>');
});

test('the check is symmetric — staging a piece far too small fails the same way', () => {
  const found = codes(sceneWith(0.4), { profiles });
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'floor');
});

test('without profiles the check is off entirely, so a pre-v5 cast still blocks', () => {
  assert.equal(codes(sceneWith(4.5)).length, 0);
  assert.equal(codes(sceneWith(4.5), { profiles: {} }).length, 0);
});

test('a profile with no measured height cannot fire the check', () => {
  const vague = { '<Subject 1>': { ...ape, heightM: null } };
  assert.equal(codes(sceneWith(4.5), { profiles: vague }).length, 0);
});

test('the cast line carries the measurement to the model', () => {
  const line = castLine(0, { dossier: { subject: 'a stylised ape character', identityMarkers: ['tan muzzle'], physicalProfile: ape } });
  assert.match(line, /<Subject 1>/);
  assert.match(line, /biped, 1\.5m tall × 0\.6m wide × 0\.35m deep/);
  assert.match(line, /broad shoulders/);
});

test('a pre-v5 dossier produces exactly the cast line it always did', () => {
  const line = castLine(0, { dossier: { subject: 'a stylised ape character', identityMarkers: ['tan muzzle'] } });
  assert.equal(line, '<Subject 1> — a stylised ape character (tan muzzle)');
});

test('an unknowable size is passed on as approximate rather than as fact', () => {
  const line = castLine(0, { dossier: { subject: 'a floating glyph', identityMarkers: ['gold'], physicalProfile: { ...ape, bodyPlan: 'object', heightConfidence: 'unknowable', headRatio: null } } });
  assert.match(line, /size unknowable/);
});

// ──────────────────────────────────────────────────────────── the medium LABEL (was a gate)
//
// Nothing is refused any more. The medium decides how much of a mesh is INFERRED rather than
// observed, and that travels with the asset instead of deciding whether it exists. The reasoning
// is in worker/mesh.js's header: derivation is what owes the artist, not fidelity, and a blocking
// proxy never claims to be the artwork.

import { meshDisposition } from '../../worker/mesh.js';

test('a piece with a dossier is never refused, whatever its medium', () => {
  for (const medium of ['3d-render', 'photoreal', 'flat-2d-vector', 'pixel', 'trading-card', 'other']) {
    assert.equal(meshDisposition({ medium }).known, true, medium);
    assert.equal(meshDisposition({ medium }).representation, 'blocking-proxy', medium);
  }
});

test('a render or a photograph is low inference; flat artwork is high', () => {
  assert.equal(meshDisposition({ medium: '3d-render' }).inference, 'low');
  assert.equal(meshDisposition({ medium: 'photoreal' }).inference, 'low');
  assert.equal(meshDisposition({ medium: 'flat-2d-vector' }).inference, 'high');
  assert.equal(meshDisposition({ medium: 'pixel' }).inference, 'high');
});

test('an unrecognised medium is HIGH inference, not low', () => {
  // Fails toward honesty: a piece nothing is known about must not be described as well observed.
  assert.equal(meshDisposition({ medium: 'something-new' }).inference, 'high');
});

test('a trading card carries a caveat about the SUBJECT, not about confidence', () => {
  const d = meshDisposition({ medium: 'trading-card' });
  assert.equal(d.known, true);
  assert.match(d.caveat, /card rather than the subject/i);
});

test('no other medium invents a caveat for itself', () => {
  for (const medium of ['3d-render', 'photoreal', 'flat-2d-vector', 'pixel']) {
    assert.equal(meshDisposition({ medium }).caveat, null, medium);
  }
});

test('not knowing what a piece is, is the one thing that still stops a mesh', () => {
  for (const dossier of [{}, null, { medium: null }]) {
    const d = meshDisposition(dossier);
    assert.equal(d.known, false, JSON.stringify(dossier));
    assert.ok(d.reason.length > 20);
  }
});
