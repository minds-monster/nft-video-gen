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

// ─────────────────────────────────────────────────────────────────── the medium gate
//
// Which pieces may have a mesh at all. Stated before the probe ran and confirmed by it: a
// 3d-render car and a photoreal sneaker come back as complete objects; a flat-2d-vector figure
// comes back as an invented egg body with voids where its arms should be, and a trading card
// comes back as a paper-thin standee. Both refusals look plausible head-on and fall apart on
// orbit, which is why this is a gate and not a preference.

import { meshEligibility } from '../../worker/mesh.js';

test('the mediums that admit reconstruction are allowed a mesh', () => {
  for (const medium of ['3d-render', 'photoreal']) {
    assert.equal(meshEligibility({ medium }).eligible, true, medium);
  }
});

test('the mediums that do not are refused, each with its own reason', () => {
  for (const medium of ['flat-2d-vector', 'pixel', 'other']) {
    const gate = meshEligibility({ medium });
    assert.equal(gate.eligible, false, medium);
    assert.match(gate.reason, /no back|invent/i);
  }
});

test('a trading card is refused for the card reason, not the flat reason', () => {
  const gate = meshEligibility({ medium: 'trading-card' });
  assert.equal(gate.eligible, false);
  assert.match(gate.reason, /card/i);
});

test('an unknown medium is refused rather than allowed through', () => {
  // The gate fails CLOSED. A piece nothing is known about must not get a mesh by default —
  // the cost of wrongly refusing is a card, and the cost of wrongly allowing is a fabrication.
  assert.equal(meshEligibility({ medium: 'something-new' }).eligible, false);
  assert.equal(meshEligibility({}).eligible, false);
  assert.equal(meshEligibility(null).eligible, false);
});

test('the refusal always carries a reason a person could read', () => {
  for (const dossier of [{ medium: 'flat-2d-vector' }, { medium: 'trading-card' }, {}, null]) {
    const gate = meshEligibility(dossier);
    assert.ok(gate.reason && gate.reason.length > 20, JSON.stringify(dossier));
  }
});
