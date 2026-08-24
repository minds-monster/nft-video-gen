// Golden fixtures the grader must pass before any model is run against it.
//
// WHY THIS EXISTS, and why it was written before worker/scene.js was wired into a single
// request: round 7 found FIVE bugs in the grader against ONE in the model, and every one of them
// made the model look worse than it was — a 60m height ceiling that made a real 70m tower
// unsayable, a camera-move classifier that called moved cameras static, screen position scored
// only at the start of a shot the camera moves through. Promoting the grader verbatim promotes
// its bugs verbatim too. Adam's ask, adopted: golden fixtures the grader must pass BEFORE it
// gates anything, because a validator nobody tests silently decides what visitors are allowed to
// see.
//
//   node --test scripts/test/scene-geometry.test.mjs      (npm run test:scene)
//
// The rule these tests encode: every FLOOR violation must fire on a scene crafted to trigger it
// AND stay silent on a clean one. A check that never fires and a check that always fires are the
// same bug wearing different clothes.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FRAMING_BANDS,
  SCREEN_BUCKETS,
  H3_MOTIONS,
  cameraBasis,
  cameraSideOfLine,
  classifyCameraMove,
  compileBeatToH3,
  compileSceneToH3,
  deriveCameraAngle,
  deriveFraming,
  deriveScreenBucket,
  projectSubject,
  selfTest,
  validateScene,
  workedExampleValues,
  SCENE_SCHEMA,
} from '../../worker/scene.js';

// ─────────────────────────────────────────────────────────────────────── fixtures

const STILL = {
  start: { position: { x: 0, y: 1.6, z: 8 }, lookAt: { x: 0, y: 1, z: 0 } },
  end: { position: { x: 0, y: 1.6, z: 8 }, lookAt: { x: 0, y: 1, z: 0 } },
  focalStartMm: 35,
  focalEndMm: 35,
  rollDeg: 0,
  motion: 'Static Shot',
  amplitude: 'small',
  speed: 'slow',
  sensorNote: '36mm-wide sensor, frame height = 36/aspect',
};

const person = (over = {}) => ({
  subject: '<Subject 1>',
  x: 0, z: 0, endX: 0, endZ: 0,
  groundOffsetM: 0, heightM: 1.8, widthM: 0.6, yawDeg: 0,
  containerId: null, action: 'stands motionless',
  screenPosition: 'center', depth: 'midground',
  ...over,
});

/** A scene with nothing wrong with it. Every negative assertion below is measured against this. */
const cleanScene = (over = {}) => ({
  beatIndex: 0,
  kind: 'shot',
  transitionText: null,
  camera: structuredClone(STILL),
  subjects: [person()],
  principalSubject: '<Subject 1>',
  framing: 'WS',
  changes: [],
  containmentNotes: 'Nobody is inside anything.',
  proseNote: 'A wide shot holds on the figure.',
  ...over,
});

const codes = (scene) => validateScene(scene).map((v) => v.code);
const floors = (scene) => validateScene(scene).filter((v) => v.severity === 'floor').map((v) => v.code);

// ─────────────────────────────────────────────────────── the module's own self-test

test('the module self-test passes (worked examples, basis, buckets, floors)', () => {
  assert.deepEqual(selfTest(), []);
});

test('the worked examples handed to the model land in the bands they claim', () => {
  for (const row of workedExampleValues()) {
    assert.equal(row.band, row.expect, `${row.label}: hFrac ${row.hFrac.toFixed(4)} → ${row.band}`);
  }
});

// ─────────────────────────────────────────────────────────────────── band boundaries

test('every framing band boundary resolves to the band that owns it', () => {
  for (const band of FRAMING_BANDS) {
    assert.equal(deriveFraming(band.min), band.band, `hFrac ${band.min} should be ${band.band}`);
    const inside = band.max === Infinity ? band.min + 10 : (band.min + band.max) / 2;
    assert.equal(deriveFraming(inside), band.band);
  }
  // The bands tile the whole range with no gap: the top of one is the bottom of the next.
  for (let i = 0; i < FRAMING_BANDS.length - 1; i += 1) {
    assert.equal(FRAMING_BANDS[i].max, FRAMING_BANDS[i + 1].min);
  }
  assert.equal(deriveFraming(0), 'EWS');
  assert.equal(deriveFraming(1000), 'ECU');
});

test('screen buckets are seven equal bands, symmetric about centre', () => {
  assert.equal(deriveScreenBucket(0), 'center');
  assert.equal(deriveScreenBucket(-1), 'far-left');
  assert.equal(deriveScreenBucket(0.999), 'far-right');
  // Boundaries fall at ±1/7, ±3/7, ±5/7 — walk each one from just below and just above.
  for (const [edge, below, above] of [
    [-5 / 7, 'far-left', 'left'],
    [-3 / 7, 'left', 'center-left'],
    [-1 / 7, 'center-left', 'center'],
    [1 / 7, 'center', 'center-right'],
    [3 / 7, 'center-right', 'right'],
    [5 / 7, 'right', 'far-right'],
  ]) {
    assert.equal(deriveScreenBucket(edge - 1e-6), below, `just left of ${edge}`);
    assert.equal(deriveScreenBucket(edge + 1e-6), above, `just right of ${edge}`);
  }
  // Out-of-frame values clamp rather than indexing off the end of the table.
  assert.equal(deriveScreenBucket(-40), 'far-left');
  assert.equal(deriveScreenBucket(40), 'far-right');
  assert.equal(SCREEN_BUCKETS.length, 7);
});

// ─────────────────────────────────────────────────────────────────────── projection

test('the coordinate contract holds: camera on +Z looking at -Z puts larger x screen-right', () => {
  // This is CONTRACT V2's central promise, and the whole reason M4 went 0.45 → 0.82. If this
  // assertion ever flips, the brief is teaching the model the opposite of what the grader scores.
  const left = projectSubject(person({ x: -2 }), STILL, {});
  const right = projectSubject(person({ x: 2 }), STILL, {});
  assert.ok(left.ndcX < 0, `x=-2 should read screen-left, got ndcX ${left.ndcX}`);
  assert.ok(right.ndcX > 0, `x=+2 should read screen-right, got ndcX ${right.ndcX}`);
  // ndcX = (2 / 8) * (2 * 35 / 36) = 0.486, which lands in the 3/7-5/7 band.
  assert.equal(deriveScreenBucket(left.ndcX), 'left');
  assert.equal(deriveScreenBucket(right.ndcX), 'right');
});

test('a subject behind the lens is reported, not silently projected', () => {
  const behind = projectSubject(person({ z: 20 }), STILL, {});
  assert.equal(behind.behindLens, true);
  assert.ok(Number.isNaN(behind.ndcX));
  assert.ok(behind.zCam < 0);
});

test('a straight-overhead camera still has a defined screen-right', () => {
  // The degenerate case: forward is parallel to world up, so the naive cross product collapses.
  // Returning NaN here would poison every downstream metric for overhead shots.
  const overhead = {
    ...STILL,
    start: { position: { x: 0, y: 20, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } },
    end: { position: { x: 0, y: 20, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } },
  };
  const basis = cameraBasis(overhead.start, 0);
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Number.isFinite(basis.right[axis]), 'right vector must stay finite');
    assert.ok(Number.isFinite(basis.up[axis]), 'up vector must stay finite');
  }
  const p = projectSubject(person(), overhead, {});
  assert.ok(Number.isFinite(p.ndcX) && Number.isFinite(p.hFrac));
  assert.equal(deriveCameraAngle(overhead), 'overhead');
});

test('the projection is evaluated at the end pose too, not only the start', () => {
  // Round 7 bug #3: screen position was scored only where a moving shot BEGAN, so a camera that
  // travelled past its subject scored as if it never moved.
  const dolly = {
    ...STILL,
    end: { position: { x: 6, y: 1.6, z: 8 }, lookAt: { x: 6, y: 1, z: 0 } },
  };
  const atStart = projectSubject(person(), dolly, {});
  const atEnd = projectSubject(person(), dolly, { atEnd: true });
  assert.ok(Math.abs(atStart.ndcX - atEnd.ndcX) > 0.5, 'the same subject must read differently once the camera moves');
});

test('camera angle is read off real pitch and roll, not off a label', () => {
  assert.equal(deriveCameraAngle(STILL), 'eye-level');
  assert.equal(deriveCameraAngle({ ...STILL, rollDeg: 20 }), 'dutch');
  assert.equal(
    deriveCameraAngle({ ...STILL, start: { position: { x: 0, y: 6, z: 4 }, lookAt: { x: 0, y: 1, z: 0 } } }),
    'high',
  );
  assert.equal(
    deriveCameraAngle({ ...STILL, start: { position: { x: 0, y: 0.3, z: 4 }, lookAt: { x: 0, y: 1.7, z: 0 } } }),
    'low',
  );
});

// ─────────────────────────────────────────────────────────── camera-move classification

const move = (start, end, over = {}) => classifyCameraMove({ ...STILL, start, end, ...over }).motion;
const at = (x, y, z, lx = 0, ly = 1, lz = 0) => ({ position: { x, y, z }, lookAt: { x: lx, y: ly, z: lz } });

test('each pose delta classifies as the motion it actually performs', () => {
  const cases = [
    ['Static Shot', at(0, 1.6, 8), at(0, 1.6, 8), {}],
    ['Push In', at(0, 1.6, 8), at(0, 1.6, 3), {}],
    ['Push Out', at(0, 1.6, 3), at(0, 1.6, 8), {}],
    ['Truck Right', at(0, 1.6, 8), at(6, 1.6, 8, 6), {}],
    ['Truck Left', at(0, 1.6, 8), at(-6, 1.6, 8, -6), {}],
    ['Pedestal Up', at(0, 1.6, 8), at(0, 6.6, 8, 0, 6), {}],
    ['Pedestal Down', at(0, 6.6, 8, 0, 6), at(0, 1.6, 8), {}],
    ['Zoom In', at(0, 1.6, 8), at(0, 1.6, 8), { focalEndMm: 120 }],
    ['Zoom Out', at(0, 1.6, 8), at(0, 1.6, 8), { focalStartMm: 120, focalEndMm: 35 }],
    ['Pan Right', at(0, 1.6, 8), at(0, 1.6, 8, 8, 1, 4), {}],
    ['Pan Left', at(0, 1.6, 8), at(0, 1.6, 8, -8, 1, 4), {}],
    ['Tilt Up', at(0, 1.6, 8), at(0, 1.6, 8, 0, 9, 0), {}],
    ['Tilt Down', at(0, 1.6, 8, 0, 9, 0), at(0, 1.6, 8), {}],
    ['Arc Shot', at(0, 1.6, 8), at(8, 1.6, 0), {}],
  ];
  for (const [expected, start, end, over] of cases) {
    assert.equal(move(start, end, over), expected, `${expected}: ${JSON.stringify({ start, end, over })}`);
  }
});

test('a camera that demonstrably moved never classifies as static', () => {
  // Round 7 bug #2, and the numerical form of "beats 2-4 look exactly the same".
  const travelled = { ...STILL, end: at(4, 3, 2, 1, 1, 0) };
  assert.notEqual(classifyCameraMove(travelled).motion, 'Static Shot');
});

test('every classified motion is a motion H3 actually understands', () => {
  const enumFromSchema = SCENE_SCHEMA.properties.beats.items.properties.camera.anyOf[0].properties.motion.enum;
  assert.deepEqual(enumFromSchema, H3_MOTIONS, 'the schema enum must be the rulebook array itself');
  for (const [, start, end, over] of [
    ['', at(0, 1.6, 8), at(0, 1.6, 3), {}],
    ['', at(0, 1.6, 8), at(6, 1.6, 8, 6), {}],
    ['', at(0, 1.6, 8), at(8, 1.6, 0), {}],
  ]) {
    assert.ok(H3_MOTIONS.includes(move(start, end, over)));
  }
});

// ─────────────────────────────────────────────────────────────────────── the floor

test('a clean scene produces no violations at all', () => {
  assert.deepEqual(validateScene(cleanScene()), []);
});

test('each FLOOR violation fires on a scene crafted to trigger it', () => {
  const cases = {
    'camera-inside-subject': cleanScene({ subjects: [person({ z: 8 })] }),
    'subject-behind-lens': cleanScene({ subjects: [person({ z: 20 })] }),
    'subject-floating': cleanScene({ subjects: [person({ groundOffsetM: 3 })] }),
    'subject-underground': cleanScene({ subjects: [person({ groundOffsetM: -1 })] }),
    'absurd-scale': cleanScene({ subjects: [person({ heightM: 900 })] }),
    'non-finite': cleanScene({ subjects: [person({ x: Number.NaN })] }),
    'missing-camera': cleanScene({ camera: null }),
    'transition-has-camera': cleanScene({ kind: 'transition' }),
    'containment-invalid': cleanScene({
      subjects: [
        person({ subject: '<Subject 1>', heightM: 1.3, widthM: 2.0, action: 'idles' }),
        person({ subject: '<Subject 2>', x: 5, groundOffsetM: 0.6, containerId: '<Subject 1>' }),
      ],
    }),
  };
  for (const [code, scene] of Object.entries(cases)) {
    assert.ok(floors(scene).includes(code), `${code} did not fire; got ${JSON.stringify(codes(scene))}`);
  }
});

test('an absurd focal length or camera height is a floor violation', () => {
  assert.ok(floors(cleanScene({ camera: { ...STILL, focalEndMm: 900 } })).includes('absurd-scale'));
  assert.ok(
    floors(cleanScene({ camera: { ...STILL, start: at(0, 900, 8) } })).includes('absurd-scale'),
  );
});

test('a correctly seated driver is clean, and an escaped one is a floor violation', () => {
  const car = person({ subject: '<Subject 1>', heightM: 1.3, widthM: 2.0, action: 'idles at the kerb' });
  const driver = person({ subject: '<Subject 2>', x: 0.3, z: 0.2, endX: 0.3, endZ: 0.2, groundOffsetM: 0.6, heightM: 1.2, widthM: 0.5, containerId: '<Subject 1>', action: 'grips the wheel' });
  assert.deepEqual(floors(cleanScene({ subjects: [car, driver], principalSubject: '<Subject 2>' })), []);
  assert.ok(
    floors(cleanScene({ subjects: [car, { ...driver, x: 5, endX: 5 }] })).includes('containment-invalid'),
  );
  // Seated at ground level inside a car is also wrong — containment is geometry, not a label.
  assert.ok(
    floors(cleanScene({ subjects: [car, { ...driver, groundOffsetM: 0 }] })).includes('containment-invalid'),
  );
});

test('a transition beat is clean when it carries no geometry and dirty when it does', () => {
  const transition = { beatIndex: 2, kind: 'transition', transitionText: 'Cut to black.', camera: null, subjects: [] };
  assert.deepEqual(validateScene(transition), []);
  assert.ok(floors({ ...transition, subjects: [person()] }).includes('transition-has-subjects'));
});

test('a legitimate extreme close-up is NOT called physically impossible', () => {
  // Round 7 bug #5: modelling people as uniform cylinders made a correct ECU (lens 27cm from a
  // face at 300mm) read as "camera inside a body". It must stay SOFT, never FLOOR — the fixture
  // that proves the model can reach the extremes of the range must not be failed by the grader.
  const ecu = cleanScene({
    camera: { ...STILL, start: at(0, 1.6, 0.27, 0, 1.6, 0), end: at(0, 1.6, 0.27, 0, 1.6, 0), focalStartMm: 300, focalEndMm: 300 },
    subjects: [person({ heightM: 1.8, widthM: 0.58 })],
    framing: 'ECU',
  });
  assert.deepEqual(floors(ecu), [], `an ECU must not breach the floor: ${JSON.stringify(validateScene(ecu))}`);
});

test('heuristic checks stay SOFT so a tuned constant can never veto a film', () => {
  const soft = cleanScene({
    subjects: [person({ subject: '<Subject 1>', x: 0 }), person({ subject: '<Subject 2>', x: 0.2 })],
  });
  const found = validateScene(soft);
  assert.ok(found.some((v) => v.code === 'near-interpenetration'));
  assert.ok(found.every((v) => v.code !== 'near-interpenetration' || v.severity === 'soft'));
});

test('crossing the 180-degree line flips the side sign', () => {
  const a = { x: -1, z: 0 };
  const b = { x: 1, z: 0 };
  const front = cameraSideOfLine({ start: at(0, 1.6, 5) }, a, b);
  const reverse = cameraSideOfLine({ start: at(0, 1.6, -5) }, a, b);
  assert.notEqual(front, reverse);
  assert.notEqual(front, 0);
});

// ─────────────────────────────────────────────────────────────────── H3 compilation

test('a compiled beat leaks no scaffolding and stays inside H3 field limits', () => {
  const compiled = compileBeatToH3(
    cleanScene({
      subjects: [
        person({ subject: '<Subject 1>', heightM: 1.3, widthM: 2.0, action: 'idles at the kerb' }),
        person({ subject: '<Subject 2>', x: 0.3, z: 0.2, endX: 0.3, endZ: 0.2, groundOffsetM: 0.6, heightM: 1.2, widthM: 0.5, containerId: '<Subject 1>', action: 'grips the wheel' }),
      ],
    }),
    { world: 'Night on a wet grid.' },
  );
  assert.match(compiled, /Night on a wet grid\./);
  assert.match(compiled, /inside <Subject 1>/);
  assert.doesNotMatch(compiled, /0x[0-9a-fA-F]{6,}/, 'no contract address may leak into the render prompt');
  assert.doesNotMatch(compiled, /integrated_multimodal_description|screenPosition|focalStartMm|groundOffsetM|containerId/);
  assert.doesNotMatch(compiled, /\.\./, 'no doubled full stops from action text');
  assert.ok(compiled.length <= 7000, `H3 caps each field at 7000 chars, got ${compiled.length}`);
});

test('compilation is DERIVED from the geometry, not copied from the model labels', () => {
  // A beat that calls itself a close-up while its numbers say wide compiles to what the numbers
  // say. This is the property that makes a mislabelled beat render correctly anyway.
  const lying = cleanScene({ framing: 'ECU' });
  assert.match(compileBeatToH3(lying), /wide shot/);
  const stillLabelledPush = cleanScene({ camera: { ...STILL, motion: 'Push In' } });
  assert.match(compileBeatToH3(stillLabelledPush), /holds a static shot/);
});

test('a whole film compiles to numbered beats in H3 field shape', () => {
  const film = {
    beats: [
      cleanScene({ beatIndex: 0 }),
      { beatIndex: 1, kind: 'transition', transitionText: 'Cut to black.', camera: null, subjects: [] },
      cleanScene({ beatIndex: 2 }),
    ],
  };
  const out = compileSceneToH3(film, { world: 'A salt flat at dawn.', sound: 'Wind.', music: 'N/A' });
  assert.deepEqual(Object.keys(out), ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music']);
  assert.match(out.integrated_multimodal_description, /Beat 1:.*Beat 2:.*Beat 3:/s);
  assert.match(out.integrated_multimodal_description, /cuts to black/i);
  assert.equal(out.overall_soundscape, 'Wind.');
});
