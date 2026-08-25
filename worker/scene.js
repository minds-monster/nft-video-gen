import { H3_MOTIONS } from './rulebook.js';

// Re-exported so every consumer reads the vocabulary from one place, whichever module it
// happens to import.
export { H3_MOTIONS };

// The scene graph: the schema a model fills in, the geometry that checks it, and the compiler
// that turns it into what MiniMax-H3 reads.
//
// PROMOTED VERBATIM from scripts/lib/scene-geometry.mjs + scripts/lib/scene-brief.mjs, which is
// what round 7's probe scored 62 films against. Those two paths are now re-export shims pointing
// back here, so the probe and production can never diverge — the day they do, the probe's verdict
// expires and nobody notices.
//
// That dual purpose is the point, not a convenience. If the probe scored geometry with one
// implementation and production accepted it with another, the probe's verdict would expire the
// day the build started. Everything here is pure: no fetch, no env, no DOM, no Worker globals,
// so worker/ and src/ can both import it unchanged.
//
// Nothing in this file talks to a model. It answers one question about a scene that already
// exists: is this geometry physically possible, and does it mean what its own labels claim?
//
//   node --test scripts/test/scene-geometry.test.mjs   # the golden-fixture suite
//
// THE COORDINATE CONTRACT is stated once, below, and is handed to the model verbatim as part
// of its brief. Every ambiguity here becomes a scoring dispute later, so it is law rather than
// description: metres, right-handed, +Y up, ground at y=0, origin fixed under the principal
// subject of beat 1 for the whole film, yaw 0 faces +Z, 36mm-wide sensor.

// ─────────────────────────────────────────────────────────────────────── vector helpers

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => {
  const l = len(a);
  if (!(l > 1e-9)) return { x: 0, y: 0, z: -1 };
  return scale(a, 1 / l);
};
const horizDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const deg = (rad) => (rad * 180) / Math.PI;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** Rodrigues rotation of v about a unit axis f. Used only for camera roll, where v ⟂ f, but
 * written generally so the third term isn't a silent assumption. */
const rotateAbout = (v, f, radians) => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return add(add(scale(v, c), scale(cross(f, v), s)), scale(f, dot(f, v) * (1 - c)));
};

// ─────────────────────────────────────────────────────────────────────── the contract

export const SENSOR_WIDTH_MM = 36;
export const sensorHeightMm = (aspect) => SENSOR_WIDTH_MM / aspect;

/**
 * Shot size as a fraction of frame height occupied by a standing figure, derived from
 * anthropometry rather than taste: a head is roughly 1/7.5 of stature, so "head and shoulders
 * fills the frame" lands near hFrac 3.5-7, and "the whole body with headroom" near 0.25-0.75.
 *
 * This table is given TO THE MODEL as well as used by the grader. Withholding it would measure
 * the model's guess at our private thresholds instead of its spatial arithmetic, which is not
 * the question the probe is asking.
 */
export const FRAMING_BANDS = [
  { band: 'EWS', min: 0, max: 0.25, reading: 'the figure is a quarter of frame height or less' },
  { band: 'WS', min: 0.25, max: 0.75, reading: 'full body with headroom' },
  { band: 'MWS', min: 0.75, max: 1.4, reading: 'the frame cuts around the knees' },
  { band: 'MS', min: 1.4, max: 2.2, reading: 'waist up' },
  { band: 'MCU', min: 2.2, max: 3.5, reading: 'chest up' },
  { band: 'CU', min: 3.5, max: 7.0, reading: 'head and shoulders' },
  { band: 'ECU', min: 7.0, max: Infinity, reading: 'part of a face' },
];

export const FRAMING_ORDER = FRAMING_BANDS.map((b) => b.band);

/** Seven equal bands across the frame width. Boundaries fall at ±1/7, ±3/7, ±5/7. */
export const SCREEN_BUCKETS = [
  'far-left',
  'left',
  'center-left',
  'center',
  'center-right',
  'right',
  'far-right',
];

// H3_MOTIONS now lives in worker/rulebook.js and is imported above — the enum below and the
// sentence H3 actually reads are built from the same array.

/** Motions that cannot be verified from a start/end pose pair — a handheld shake and a POV
 * both describe how the camera behaves between the two poses, not where it ends up. Scored as
 * "unscoreable" rather than wrong, because counting them as errors would punish an honest
 * answer. */
export const UNSCOREABLE_MOTIONS = new Set(['Shake Slightly', 'Shake Strongly', 'POV']);

export const deriveFraming = (hFrac) =>
  FRAMING_BANDS.find((b) => hFrac >= b.min && hFrac < b.max)?.band ?? 'ECU';

export const deriveScreenBucket = (ndcX) => {
  const clamped = Math.max(-1, Math.min(1, ndcX));
  const index = Math.min(6, Math.floor(((clamped + 1) / 2) * 7));
  return SCREEN_BUCKETS[index];
};

// ─────────────────────────────────────────────────────────────────────── projection

/**
 * The camera's orthonormal basis. Right-handed, +Y up: for a camera at (0,0,8) looking at the
 * origin, forward is -Z and right is +X.
 *
 * The degenerate case is real and worth handling rather than producing NaN: a straight-down
 * overhead shot has forward parallel to world up, so the cross product collapses. World +Z
 * stands in as the reference in that case, which keeps "screen right" defined instead of
 * poisoning every downstream metric with NaN.
 */
export const cameraBasis = (pose, rollDeg = 0) => {
  const forward = norm(sub(pose.lookAt, pose.position));
  const reference = Math.abs(forward.y) > 0.999 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  let right = norm(cross(forward, reference));
  let up = cross(right, forward);
  if (rollDeg) {
    const r = (rollDeg * Math.PI) / 180;
    right = rotateAbout(right, forward, r);
    up = rotateAbout(up, forward, r);
  }
  return { forward, right, up };
};

/** Where a subject lands in the frame, and how much of it it fills. The single piece of
 * arithmetic the whole probe rests on. */
export const projectSubject = (subject, camera, { aspect = 16 / 9, atEnd = false } = {}) => {
  const pose = atEnd ? camera.end : camera.start;
  const focalMm = atEnd ? camera.focalEndMm : camera.focalStartMm;
  const { forward, right, up } = cameraBasis(pose, camera.rollDeg ?? 0);

  const x = atEnd ? subject.endX : subject.x;
  const z = atEnd ? subject.endZ : subject.z;
  const centre = { x, y: (subject.groundOffsetM ?? 0) + subject.heightM / 2, z };

  const v = sub(centre, pose.position);
  const zCam = dot(v, forward);
  const sh = sensorHeightMm(aspect);

  if (!(zCam > 1e-6)) {
    return { zCam, ndcX: NaN, ndcY: NaN, hFrac: NaN, behindLens: true, centre };
  }

  return {
    zCam,
    ndcX: (dot(v, right) / zCam) * ((2 * focalMm) / SENSOR_WIDTH_MM),
    ndcY: (dot(v, up) / zCam) * ((2 * focalMm) / sh),
    hFrac: (subject.heightM * focalMm) / (zCam * sh),
    behindLens: false,
    centre,
  };
};

/** Shot angle read off the camera's own pitch and roll, so "dutch" means the camera is
 * actually rolled rather than merely labelled that way. */
export const deriveCameraAngle = (camera) => {
  const { forward } = cameraBasis(camera.start, 0);
  const pitch = deg(Math.asin(Math.max(-1, Math.min(1, forward.y))));
  if (Math.abs(camera.rollDeg ?? 0) >= 5) return 'dutch';
  if (pitch <= -55) return 'overhead';
  if (pitch <= -12) return 'high';
  if (pitch >= 12) return 'low';
  return 'eye-level';
};

// ─────────────────────────────────────────────────────────── camera-move classification

const yawOf = (f) => deg(Math.atan2(f.x, f.z));
const pitchOf = (f) => deg(Math.asin(Math.max(-1, Math.min(1, f.y))));
const angleDelta = (a, b) => {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
};

/**
 * What the camera ACTUALLY does between its two poses, independent of what the model called it.
 *
 * This is the metric that catches a beat labelled "Push In" whose start and end poses are
 * identical — which is, in numbers, the "beats 2-4 all look exactly the same" complaint that
 * started this round.
 *
 * `sceneScale` normalises the "did it move at all" threshold: 5cm is a large move on a tabletop
 * and no move at all across a starting grid.
 */
/** Positive when the camera's new forward has swung toward the side of frame the old pose called
 * right. Convention-free by construction: it is measured against the basis, not inferred from a
 * yaw sign. */
const panDirection = (b0, b1) => dot(b1.forward, b0.right);

export const classifyCameraMove = (camera, sceneScale = 10) => {
  const p0 = camera.start;
  const p1 = camera.end;
  const b0 = cameraBasis(p0, 0);
  const b1 = cameraBasis(p1, 0);

  const translation = sub(p1.position, p0.position);
  const moved = len(translation);
  const movedRel = moved / Math.max(sceneScale, 1e-6);

  const d0 = len(sub(p0.lookAt, p0.position));
  const d1 = len(sub(p1.lookAt, p1.position));
  const distanceChange = d0 > 1e-6 ? (d1 - d0) / d0 : 0;

  const dYaw = angleDelta(yawOf(b0.forward), yawOf(b1.forward));
  const dPitch = pitchOf(b1.forward) - pitchOf(b0.forward);
  const dRoll = (camera.rollDeg ?? 0) - (camera.startRollDeg ?? camera.rollDeg ?? 0);
  const focalRatio = camera.focalStartMm > 0 ? camera.focalEndMm / camera.focalStartMm : 1;

  // Lateral/axial are resolved in the MIDPOINT basis, not the start basis. Decomposing an 8m
  // slide against the start basis when the camera also swings 96 degrees through the move
  // assigns most of a plainly lateral truck to the "axial" component and misreads it as a push.
  // The mean of the two forward vectors is the honest frame for the move as a whole.
  const midForward = norm(add(b0.forward, b1.forward));
  const midBasis = Math.abs(midForward.y) > 0.999
    ? b0
    : { forward: midForward, right: norm(cross(midForward, { x: 0, y: 1, z: 0 })), up: { x: 0, y: 1, z: 0 } };

  const lateral = dot(translation, midBasis.right);
  const vertical = translation.y;
  const axial = dot(translation, midBasis.forward);

  const stillish = movedRel < 0.01;
  const measurements = { moved, movedRel, distanceChange, lateral, vertical, axial, dYaw, dPitch, focalRatio };

  if (Math.abs(dRoll) >= 5) return { motion: 'Roll', measurements };

  if (stillish) {
    // A camera that has not moved can still zoom, pan or tilt.
    if (Math.abs(focalRatio - 1) >= 0.1) {
      return { motion: focalRatio > 1 ? 'Zoom In' : 'Zoom Out', measurements };
    }
    if (Math.abs(dYaw) >= 5 && Math.abs(dYaw) >= Math.abs(dPitch)) {
      // Direction comes from the PROJECTION, not from the sign of dYaw.
      //
      // BUG FOUND BY scripts/test/scene-geometry.test.mjs, 2026-08-24, before this file was ever
      // wired into a request. The yaw convention (0 faces +Z, 90 faces +X) runs the opposite way
      // round to screen handedness: with forward = (sin y, 0, cos y), right works out to
      // (-cos y, 0, sin y), so INCREASING yaw swings the camera toward screen-LEFT. The old
      // `dYaw > 0 ? 'Pan Right'` therefore reported every pan backwards — a camera at (0,1.6,8)
      // looking at the origin and swinging to (8,1,4) is plainly panning right, and scored as
      // Pan Left. Same family as the v1 coordinate-contract bug: a handedness rule stated
      // correctly in one place and applied inverted in another.
      //
      // Projecting the new forward onto the OLD right vector cannot be got the wrong way round,
      // because it asks the question directly: did the camera swing toward the side of frame we
      // already call right?
      return { motion: panDirection(b0, b1) > 0 ? 'Pan Right' : 'Pan Left', measurements };
    }
    if (Math.abs(dPitch) >= 5) return { motion: dPitch > 0 ? 'Tilt Up' : 'Tilt Down', measurements };
    return { motion: 'Static Shot', measurements };
  }

  // From here the camera demonstrably moved, so Static Shot is no longer a permissible answer.
  // An earlier version of this function could fall through every branch and return Static for a
  // camera that had travelled a real distance — which made a moved camera look like a model that
  // had mislabelled a still one, the exact error the metric exists to detect.
  if (Math.abs(dYaw) > 25 && Math.abs(distanceChange) < 0.35) {
    return { motion: 'Arc Shot', measurements };
  }
  if (Math.abs(distanceChange) > 0.15) {
    return { motion: distanceChange < 0 ? 'Push In' : 'Push Out', measurements };
  }
  if (Math.abs(vertical) > Math.abs(lateral) && Math.abs(vertical) > Math.abs(axial)) {
    return { motion: vertical > 0 ? 'Pedestal Up' : 'Pedestal Down', measurements };
  }
  if (Math.abs(axial) > Math.abs(lateral)) {
    return { motion: axial > 0 ? 'Push In' : 'Push Out', measurements };
  }
  return { motion: lateral > 0 ? 'Truck Right' : 'Truck Left', measurements };
};

/** Moves that a pose delta genuinely cannot tell apart. A tracking shot and a truck differ by
 * whether the subject moves too, not by where the camera ends up; a push and a zoom differ by
 * whether the perspective changes, which is real but easy to conflate. Scored at half credit
 * rather than zero — this is a measurement limit, not a model error. */
const MOVE_FAMILIES = [
  ['Push In', 'Zoom In'],
  ['Push Out', 'Zoom Out'],
  ['Truck Left', 'Tracking Shot', 'Arc Shot'],
  ['Truck Right', 'Tracking Shot', 'Arc Shot'],
  ['Pan Left', 'Arc Shot'],
  ['Pan Right', 'Arc Shot'],
];

export const cameraMoveScore = (declared, derived) => {
  if (UNSCOREABLE_MOTIONS.has(declared)) return null;
  if (declared === derived) return 1;
  // "Tracking Shot" means the camera follows a subject. Whether it does that by trucking,
  // pushing or arcing is not recoverable from a start/end pose pair, so it scores half credit
  // against any real move and zero only against Static — where the claim is genuinely false.
  if (declared === 'Tracking Shot') return derived === 'Static Shot' ? 0 : 0.5;
  const sameFamily = MOVE_FAMILIES.some((f) => f.includes(declared) && f.includes(derived));
  if (sameFamily) return 0.5;
  // Right axis, wrong direction (Truck Left vs Truck Right) is a different and more serious
  // error than picking the wrong axis entirely — a render would move the camera the wrong way.
  // Scored zero, but reported separately so the scorecard can tell the two apart.
  return 0;
};

/** Same move, opposite direction. Reported distinctly from a wrong-axis answer. */
export const isDirectionFlip = (declared, derived) => {
  const pairs = [['Truck Left', 'Truck Right'], ['Pan Left', 'Pan Right'], ['Tilt Up', 'Tilt Down'],
    ['Pedestal Up', 'Pedestal Down'], ['Push In', 'Push Out'], ['Zoom In', 'Zoom Out']];
  return pairs.some((p) => p.includes(declared) && p.includes(derived) && declared !== derived);
};

// ─────────────────────────────────────────────────────────────────────── validation

const FLOOR = 'floor';
const SOFT = 'soft';

/** How big the staged world is, used to normalise thresholds that would otherwise be absurd at
 * one scale and meaningless at another. */
export const sceneScaleOf = (scene) => {
  const points = [];
  for (const s of scene.subjects ?? []) points.push({ x: s.x, y: 0, z: s.z });
  if (scene.camera?.start) points.push(scene.camera.start.position);
  if (scene.camera?.end) points.push(scene.camera.end.position);
  if (points.length < 2) return 10;
  let max = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      max = Math.max(max, horizDist(points[i], points[j]));
    }
  }
  return Math.max(max, 1);
};

/**
 * Everything that can be wrong with one beat's geometry, on its own terms.
 *
 * Severity is the load-bearing distinction, and it is drawn deliberately:
 *   FLOOR - no judgement involved. A camera inside a body, a subject behind its own lens, a
 *           person underground, a driver outside the car he is stated to be inside. One of
 *           these fails the fixture outright.
 *   SOFT  - rests on a tuned constant nobody has calibrated yet (how close is too close?).
 *           Scored, never a veto.
 *
 * `profiles` is optional and maps a subject tag to that piece's `physicalProfile` from its
 * dossier. Passing it adds the height-agreement check below; omitting it changes nothing, which
 * is what keeps every existing caller — and the golden-fixture suite — honest.
 */
export const validateScene = (scene, { aspect = 16 / 9, profiles = null } = {}) => {
  const violations = [];
  const push = (code, severity, detail, extra = {}) =>
    violations.push({ code, severity, detail, beatIndex: scene.beatIndex, ...extra });

  if (scene.kind === 'transition') {
    if (scene.camera) push('transition-has-camera', FLOOR, 'A transition beat carries a camera pose.');
    if ((scene.subjects ?? []).length) {
      push('transition-has-subjects', FLOOR, 'A transition beat carries subjects.');
    }
    return violations;
  }

  const camera = scene.camera;
  if (!camera) {
    push('missing-camera', FLOOR, 'A shot beat has no camera.');
    return violations;
  }

  const numbers = [
    camera.start?.position, camera.start?.lookAt, camera.end?.position, camera.end?.lookAt,
  ];
  for (const p of numbers) {
    if (!p || !finite(p.x) || !finite(p.y) || !finite(p.z)) {
      push('non-finite', FLOOR, 'A camera pose contains a non-finite coordinate.');
      return violations;
    }
  }
  if (!finite(camera.focalStartMm) || !finite(camera.focalEndMm)) {
    push('non-finite', FLOOR, 'A focal length is non-finite.');
    return violations;
  }

  for (const focal of [camera.focalStartMm, camera.focalEndMm]) {
    if (focal < 8 || focal > 300) {
      push('absurd-scale', FLOOR, `Focal length ${focal}mm is outside 8-300mm.`);
    }
  }
  for (const pose of [camera.start, camera.end]) {
    if (pose.position.y < 0.02 || pose.position.y > 500) {
      push('absurd-scale', FLOOR, `Camera height ${pose.position.y}m is outside 0.02-500m.`);
    }
  }
  if (len(sub(camera.start.lookAt, camera.start.position)) < 1e-3) {
    push('non-finite', FLOOR, 'Camera position and lookAt are the same point — no view direction.');
  }

  const byTag = new Map((scene.subjects ?? []).map((s) => [s.subject, s]));

  for (const s of scene.subjects ?? []) {
    const coords = [s.x, s.z, s.endX, s.endZ, s.heightM, s.widthM, s.groundOffsetM, s.yawDeg];
    if (coords.some((n) => !finite(n))) {
      push('non-finite', FLOOR, `${s.subject} has a non-finite coordinate.`, { subject: s.subject });
      continue;
    }
    // Bounds match SCENE_SCHEMA's own, deliberately: if the schema permits a 70m tower then the
    // grader must not call one absurd. The two drifting apart is how a probe ends up measuring
    // its own inconsistency.
    if (s.heightM < 0.02 || s.heightM > 500 || s.widthM < 0.02 || s.widthM > 500) {
      push('absurd-scale', FLOOR, `${s.subject} is ${s.heightM}m tall and ${s.widthM}m wide.`, {
        subject: s.subject,
      });
    }
    // THE HEIGHT THE DOSSIER OBSERVED VERSUS THE HEIGHT THE MODEL USED.
    //
    // Two severities, because the two failures are not the same failure. A 30% disagreement is a
    // judgement call — the model may be staging a crouching figure, or reading a stylised
    // character's proportions differently — and refusing the beat over it would throw away
    // working geometry. An order-of-magnitude disagreement is not a judgement call: it means the
    // model priced the shot on a different object than the one in the artwork, and since hFrac is
    // directly proportional to heightM, the stated framing is then arithmetic about nothing.
    //
    // Soft first, on purpose. The threshold below is uncalibrated, and promoting it to a floor
    // before the numbers exist would be exactly the tuned-constant veto the SOFT band is for.
    const observed = profiles?.[s.subject]?.heightM;
    if (finite(observed) && observed > 0 && finite(s.heightM) && s.heightM > 0) {
      const ratio = s.heightM / observed;
      if (ratio > 2 || ratio < 0.5) {
        push(
          'height-contradicts-profile',
          FLOOR,
          `${s.subject} is staged at ${s.heightM}m, but the piece itself was measured at ${observed}m — different by more than a factor of two, so the shot size is computed on the wrong object.`,
          { subject: s.subject },
        );
      } else if (ratio > 1.25 || ratio < 0.8) {
        push(
          'height-contradicts-profile',
          SOFT,
          `${s.subject} is staged at ${s.heightM}m against a measured ${observed}m.`,
          { subject: s.subject },
        );
      }
    }
    if (s.groundOffsetM < 0) {
      push('subject-underground', FLOOR, `${s.subject} sits at ${s.groundOffsetM}m, below ground.`, {
        subject: s.subject,
      });
    } else if (s.groundOffsetM > 0.05 && !s.containerId) {
      push(
        'subject-floating',
        FLOOR,
        `${s.subject} floats ${s.groundOffsetM}m above the ground with no container.`,
        { subject: s.subject },
      );
    }

    if (s.containerId) {
      const container = byTag.get(s.containerId);
      if (!container) {
        push('containment-invalid', FLOOR, `${s.subject} names container ${s.containerId}, absent from this beat.`, {
          subject: s.subject,
        });
      } else {
        const gap = horizDist({ x: s.x, z: s.z }, { x: container.x, z: container.z });
        if (gap > container.widthM / 2) {
          push(
            'containment-invalid',
            FLOOR,
            `${s.subject} is ${gap.toFixed(2)}m from the centre of ${s.containerId}, whose half-width is ${(container.widthM / 2).toFixed(2)}m — outside the thing it is inside.`,
            { subject: s.subject },
          );
        }
        if (s.groundOffsetM <= 0 || s.groundOffsetM > container.heightM) {
          push(
            'containment-invalid',
            FLOOR,
            `${s.subject} sits at ${s.groundOffsetM}m inside ${s.containerId}, which is ${container.heightM}m tall.`,
            { subject: s.subject },
          );
        }
      }
    }

    const p = projectSubject(s, camera, { aspect });
    if (p.behindLens) {
      push('subject-behind-lens', FLOOR, `${s.subject} is listed in frame but sits behind the lens.`, {
        subject: s.subject,
      });
      continue;
    }
    if (Math.abs(p.ndcX) > 1.15 || Math.abs(p.ndcY) > 1.15) {
      push(
        'projects-outside-frame',
        SOFT,
        `${s.subject} is listed in frame but projects to (${p.ndcX.toFixed(2)}, ${p.ndcY.toFixed(2)}).`,
        { subject: s.subject },
      );
    }
  }

  // The camera cannot be standing inside somebody. Horizontal overlap alone isn't enough — a
  // camera directly above a crouching figure is fine — so the vertical span has to overlap too.
  //
  // The radius is deliberately HALF the bounding half-width, not the half-width itself. A
  // subject is modelled here as a uniform cylinder as wide as its widest point and as tall as
  // its full height, which is a crude stand-in for a body: a person 0.58m across the shoulders
  // is nothing like 0.58m across at the face. A legitimate extreme close-up puts the lens about
  // 27cm from the centre-line of a head at 300mm — measured, on fixture F4's "the iris fills the
  // picture" beat — which grazes that cylinder while being exactly right as filmmaking.
  //
  // So: well inside the volume is a floor violation; grazing the bounding cylinder is reported
  // as soft. Calling a correct close-up physically impossible would have failed the fixture that
  // most clearly demonstrates the model CAN reach the extremes of the shot-size range.
  for (const s of scene.subjects ?? []) {
    if (!finite(s.x) || !finite(s.z) || !finite(s.heightM)) continue;
    for (const pose of [camera.start, camera.end]) {
      const gap = horizDist({ x: s.x, z: s.z }, { x: pose.position.x, z: pose.position.z });
      const low = s.groundOffsetM ?? 0;
      const high = low + s.heightM;
      const verticallyOverlapping = pose.position.y >= low && pose.position.y <= high;
      if (!verticallyOverlapping) continue;
      if (gap < s.widthM * 0.25) {
        push('camera-inside-subject', FLOOR, `The camera stands inside ${s.subject} (${gap.toFixed(2)}m from its centre-line, well within its ${s.widthM}m width).`, {
          subject: s.subject,
        });
        break;
      }
      if (gap < s.widthM / 2) {
        push('camera-grazes-subject', SOFT, `The camera sits ${gap.toFixed(2)}m from ${s.subject}'s centre-line, inside its ${s.widthM}m bounding width — very tight, but plausible for a close shot.`, {
          subject: s.subject,
        });
        break;
      }
    }
  }

  const subjects = scene.subjects ?? [];
  for (let i = 0; i < subjects.length; i += 1) {
    for (let j = i + 1; j < subjects.length; j += 1) {
      const a = subjects[i];
      const b = subjects[j];
      if (a.containerId === b.subject || b.containerId === a.subject) continue;
      if (!finite(a.x) || !finite(b.x)) continue;
      const gap = horizDist(a, b);
      const need = 0.6 * ((a.widthM + b.widthM) / 2);
      if (gap < need) {
        push(
          'near-interpenetration',
          SOFT,
          `${a.subject} and ${b.subject} are ${gap.toFixed(2)}m apart, closer than ${need.toFixed(2)}m.`,
          { subject: a.subject },
        );
      }
    }
  }

  return violations;
};

/** Which side of the line through two subjects the camera stands on. The sign is arbitrary;
 * only whether it CHANGES between beats carries meaning. */
export const cameraSideOfLine = (camera, a, b) => {
  const axis = { x: b.x - a.x, y: 0, z: b.z - a.z };
  const toCamera = { x: camera.start.position.x - a.x, y: 0, z: camera.start.position.z - a.z };
  const c = cross(axis, toCamera).y;
  if (Math.abs(c) < 1e-6) return 0;
  return Math.sign(c);
};

// ─────────────────────────────────────────────────────────────────────── H3 compilation

const AMPLITUDE_WORDS = { small: 'small amplitude', medium: 'medium amplitude', large: 'large amplitude' };
const SPEED_WORDS = { slow: 'slow speed', medium: 'medium speed', fast: 'fast speed' };

const FRAMING_PHRASE = {
  ECU: 'an extreme close-up',
  CU: 'a close-up',
  MCU: 'a medium close-up',
  MS: 'a medium shot',
  MWS: 'a medium-wide shot',
  WS: 'a wide shot',
  EWS: 'an extreme wide shot',
};

const ANGLE_PHRASE = {
  low: 'from a low angle',
  'eye-level': 'at eye level',
  high: 'from a high angle',
  dutch: 'on a canted dutch angle',
  overhead: 'from directly overhead',
};

const SCREEN_PHRASE = {
  'far-left': 'at the far left of frame',
  left: 'on the left of frame',
  'center-left': 'left of centre',
  center: 'in the centre of frame',
  'center-right': 'right of centre',
  right: 'on the right of frame',
  'far-right': 'at the far right of frame',
};

const DEPTH_PHRASE = { foreground: 'in the foreground', midground: 'in the midground', background: 'in the background' };

const depthFromZ = (zCam, all) => {
  const zs = all.filter((n) => Number.isFinite(n));
  if (zs.length < 2) return 'midground';
  const min = Math.min(...zs);
  const max = Math.max(...zs);
  if (max - min < 0.5) return 'midground';
  const t = (zCam - min) / (max - min);
  if (t < 1 / 3) return 'foreground';
  if (t < 2 / 3) return 'midground';
  return 'background';
};

/**
 * One beat's geometry rendered into the language MiniMax H3 actually reads — mechanically, with
 * no model in the loop.
 *
 * This is the whole premise of the round made checkable: the scene graph is only "a more precise
 * technical submission to H3" if it can become H3's own format without anything inventing the
 * difference. Everything here is DERIVED from the numbers, never copied from the model's own
 * labels, so a beat whose label disagrees with its geometry compiles to what the geometry says.
 */
export const compileBeatToH3 = (scene, spec = {}, { aspect = 16 / 9, subjectNames = {} } = {}) => {
  if (scene.kind === 'transition') {
    return `The screen cuts to black. ${scene.transitionText ?? ''}`.trim();
  }
  const camera = scene.camera;
  const subjects = scene.subjects ?? [];
  const projections = subjects.map((s) => projectSubject(s, camera, { aspect }));
  const zs = projections.map((p) => p.zCam);

  const principal =
    subjects.find((s) => s.subject === scene.principalSubject) ?? subjects[0] ?? null;
  const principalProjection = principal
    ? projections[subjects.indexOf(principal)]
    : null;
  const framing = principalProjection ? deriveFraming(principalProjection.hFrac) : 'MWS';
  const angle = deriveCameraAngle(camera);

  const nameOf = (tag) => subjectNames[tag] ?? tag;

  const sentence = (text) => {
    const trimmed = String(text ?? '').trim().replace(/\.+$/, '');
    if (!trimmed) return '';
    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
  };

  const opening = `Live-action, cinematic. ${sentence(`${FRAMING_PHRASE[framing]} ${ANGLE_PHRASE[angle]} frames the scene`)}`;

  const placements = subjects.map((s, i) => {
    const p = projections[i];
    const bucket = Number.isFinite(p.ndcX) ? deriveScreenBucket(p.ndcX) : 'center';
    const depth = depthFromZ(p.zCam, zs);
    const inside = s.containerId ? `, inside ${nameOf(s.containerId)},` : '';
    // The action is stripped of its own trailing full stop before being joined, so a model that
    // writes "Stands motionless." and one that writes "stands motionless" both compile to one
    // clean sentence rather than "stands motionless.." — H3 renders the text it is shown, so
    // punctuation noise is not cosmetic.
    const action = String(s.action ?? '').trim().replace(/\.+$/, '');
    return sentence(`${nameOf(s.subject)}${inside} is ${SCREEN_PHRASE[bucket]} ${DEPTH_PHRASE[depth]}, ${action}`);
  });

  const derivedMove = classifyCameraMove(camera, sceneScaleOf(scene)).motion;
  const motion = derivedMove === 'Static Shot'
    ? 'The camera holds a static shot.'
    : `The camera ${derivedMove.toLowerCase()}s with ${AMPLITUDE_WORDS[camera.amplitude] ?? 'medium amplitude'} at ${SPEED_WORDS[camera.speed] ?? 'medium speed'}.`;

  const containment = scene.containmentNotes ? sentence(scene.containmentNotes) : '';
  const world = spec.world ? sentence(spec.world) : '';

  return [world, opening, placements.filter(Boolean).join(' '), motion.trim(), containment]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/** The whole film as an H3 script. Beats are numbered because ordering is the thing H3 is most
 * likely to shuffle — the same reasoning as scripts/launch-prompts.mjs's own `beats()` helper. */
export const compileSceneToH3 = (film, spec = {}, options = {}) => {
  const beats = (film.beats ?? []).map(
    (beat, i) => `Beat ${i + 1}: ${compileBeatToH3(beat, i === 0 ? spec : {}, options)}`,
  );
  return {
    integrated_multimodal_description: beats.join(' '),
    overall_soundscape: spec.sound ?? 'N/A',
    non_diegetic_music: spec.music ?? 'N/A',
  };
};

// ─────────────────────────────────────────────────────────────────────── self-test

/**
 * The brief hands the model three worked examples. If the arithmetic in those examples were
 * wrong we would be teaching the model to be wrong and then scoring it for agreeing with us —
 * so they are recomputed here and the module refuses to load quietly if they drift.
 */
export const WORKED_EXAMPLES = [
  {
    label: 'a 1.8m figure at the origin, camera 8m back at 50mm',
    camera: {
      start: { position: { x: 0, y: 1.6, z: 8 }, lookAt: { x: 0, y: 1.0, z: 0 } },
      end: { position: { x: 0, y: 1.6, z: 8 }, lookAt: { x: 0, y: 1.0, z: 0 } },
      focalStartMm: 50, focalEndMm: 50, rollDeg: 0,
    },
    subject: { subject: '<Subject 1>', x: 0, z: 0, endX: 0, endZ: 0, groundOffsetM: 0, heightM: 1.8, widthM: 0.6, yawDeg: 0 },
    expect: 'WS',
  },
  {
    label: 'the same figure with the camera 1.7m away at 85mm',
    camera: {
      start: { position: { x: 0, y: 1.5, z: 1.7 }, lookAt: { x: 0, y: 1.5, z: 0 } },
      end: { position: { x: 0, y: 1.5, z: 1.7 }, lookAt: { x: 0, y: 1.5, z: 0 } },
      focalStartMm: 85, focalEndMm: 85, rollDeg: 0,
    },
    subject: { subject: '<Subject 1>', x: 0, z: 0, endX: 0, endZ: 0, groundOffsetM: 0, heightM: 1.8, widthM: 0.6, yawDeg: 0 },
    expect: 'CU',
  },
  {
    label: 'the same figure 60m away at 24mm',
    camera: {
      start: { position: { x: 0, y: 1.6, z: 60 }, lookAt: { x: 0, y: 1.0, z: 0 } },
      end: { position: { x: 0, y: 1.6, z: 60 }, lookAt: { x: 0, y: 1.0, z: 0 } },
      focalStartMm: 24, focalEndMm: 24, rollDeg: 0,
    },
    subject: { subject: '<Subject 1>', x: 0, z: 0, endX: 0, endZ: 0, groundOffsetM: 0, heightM: 1.8, widthM: 0.6, yawDeg: 0 },
    expect: 'EWS',
  },
];

export const workedExampleValues = () =>
  WORKED_EXAMPLES.map((ex) => {
    const p = projectSubject(ex.subject, ex.camera, { aspect: 16 / 9 });
    return { label: ex.label, hFrac: p.hFrac, band: deriveFraming(p.hFrac), expect: ex.expect };
  });

export const selfTest = () => {
  const failures = [];
  const check = (name, ok, detail = '') => {
    if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  };

  for (const row of workedExampleValues()) {
    check(`worked example: ${row.label}`, row.band === row.expect, `got ${row.band} (hFrac ${row.hFrac.toFixed(4)}), expected ${row.expect}`);
  }

  // Basis orientation: a camera on +Z looking at the origin has forward -Z and right +X.
  const basis = cameraBasis({ position: { x: 0, y: 0, z: 8 }, lookAt: { x: 0, y: 0, z: 0 } }, 0);
  check('basis forward is -Z', Math.abs(basis.forward.z + 1) < 1e-9, JSON.stringify(basis.forward));
  check('basis right is +X', Math.abs(basis.right.x - 1) < 1e-9, JSON.stringify(basis.right));
  check('basis up is +Y', Math.abs(basis.up.y - 1) < 1e-9, JSON.stringify(basis.up));

  // A subject to world +X should read screen-right from that camera.
  const rightward = projectSubject(
    { subject: '<S>', x: 2, z: 0, endX: 2, endZ: 0, groundOffsetM: 0, heightM: 1.8, widthM: 0.6, yawDeg: 0 },
    { start: { position: { x: 0, y: 1, z: 8 }, lookAt: { x: 0, y: 1, z: 0 } }, end: { position: { x: 0, y: 1, z: 8 }, lookAt: { x: 0, y: 1, z: 0 } }, focalStartMm: 35, focalEndMm: 35, rollDeg: 0 },
    {},
  );
  check('a subject at +X reads screen-right', rightward.ndcX > 0, `ndcX ${rightward.ndcX}`);

  // Screen buckets are symmetric and cover the frame.
  check('ndcX 0 is centre', deriveScreenBucket(0) === 'center');
  check('ndcX -1 is far-left', deriveScreenBucket(-1) === 'far-left');
  check('ndcX +1 is far-right', deriveScreenBucket(0.99) === 'far-right');

  // Move classification: an identical start and end pose is Static, whatever it was called.
  const still = {
    start: { position: { x: 0, y: 1.6, z: 8 }, lookAt: { x: 0, y: 1, z: 0 } },
    end: { position: { x: 0, y: 1.6, z: 8 }, lookAt: { x: 0, y: 1, z: 0 } },
    focalStartMm: 35, focalEndMm: 35, rollDeg: 0,
  };
  check('identical poses classify as Static Shot', classifyCameraMove(still).motion === 'Static Shot', classifyCameraMove(still).motion);

  const pushIn = {
    start: { position: { x: 0, y: 1.6, z: 8 }, lookAt: { x: 0, y: 1, z: 0 } },
    end: { position: { x: 0, y: 1.6, z: 3 }, lookAt: { x: 0, y: 1, z: 0 } },
    focalStartMm: 35, focalEndMm: 35, rollDeg: 0,
  };
  check('closing the distance classifies as Push In', classifyCameraMove(pushIn).motion === 'Push In', classifyCameraMove(pushIn).motion);

  const truckRight = {
    start: { position: { x: 0, y: 1.6, z: 8 }, lookAt: { x: 0, y: 1, z: 0 } },
    end: { position: { x: 6, y: 1.6, z: 8 }, lookAt: { x: 6, y: 1, z: 0 } },
    focalStartMm: 35, focalEndMm: 35, rollDeg: 0,
  };
  check('a lateral slide classifies as Truck Right', classifyCameraMove(truckRight).motion === 'Truck Right', classifyCameraMove(truckRight).motion);

  // The floor catches the things it exists to catch.
  const cameraInside = {
    beatIndex: 0, kind: 'shot', principalSubject: '<Subject 1>',
    camera: { ...still, amplitude: 'small', speed: 'slow', motion: 'Static Shot' },
    subjects: [{ subject: '<Subject 1>', x: 0, z: 8, endX: 0, endZ: 8, groundOffsetM: 0, heightM: 1.8, widthM: 0.6, yawDeg: 0, containerId: null, action: 'stands' }],
  };
  check(
    'a camera inside a subject is a floor violation',
    validateScene(cameraInside).some((v) => v.code === 'camera-inside-subject' && v.severity === 'floor'),
    JSON.stringify(validateScene(cameraInside).map((v) => v.code)),
  );

  const behind = {
    beatIndex: 0, kind: 'shot', principalSubject: '<Subject 1>',
    camera: { ...still, amplitude: 'small', speed: 'slow', motion: 'Static Shot' },
    subjects: [{ subject: '<Subject 1>', x: 0, z: 20, endX: 0, endZ: 20, groundOffsetM: 0, heightM: 1.8, widthM: 0.6, yawDeg: 0, containerId: null, action: 'stands' }],
  };
  check(
    'a subject behind the lens is a floor violation',
    validateScene(behind).some((v) => v.code === 'subject-behind-lens'),
    JSON.stringify(validateScene(behind).map((v) => v.code)),
  );

  const floating = {
    beatIndex: 0, kind: 'shot', principalSubject: '<Subject 1>',
    camera: { ...still, amplitude: 'small', speed: 'slow', motion: 'Static Shot' },
    subjects: [{ subject: '<Subject 1>', x: 0, z: 0, endX: 0, endZ: 0, groundOffsetM: 3, heightM: 1.8, widthM: 0.6, yawDeg: 0, containerId: null, action: 'hovers' }],
  };
  check(
    'a floating subject with no container is a floor violation',
    validateScene(floating).some((v) => v.code === 'subject-floating'),
  );

  const contained = {
    beatIndex: 0, kind: 'shot', principalSubject: '<Subject 2>',
    camera: { ...still, amplitude: 'small', speed: 'slow', motion: 'Static Shot' },
    subjects: [
      { subject: '<Subject 1>', x: 0, z: 0, endX: 0, endZ: 0, groundOffsetM: 0, heightM: 1.3, widthM: 2.0, yawDeg: 0, containerId: null, action: 'idles' },
      { subject: '<Subject 2>', x: 0.3, z: 0.2, endX: 0.3, endZ: 0.2, groundOffsetM: 0.6, heightM: 1.2, widthM: 0.5, yawDeg: 0, containerId: '<Subject 1>', action: 'grips the wheel' },
    ],
  };
  check(
    'a correctly seated driver produces no floor violation',
    !validateScene(contained).some((v) => v.severity === 'floor'),
    JSON.stringify(validateScene(contained)),
  );

  const escaped = JSON.parse(JSON.stringify(contained));
  escaped.subjects[1].x = 5;
  check(
    'a driver outside his own car is a floor violation',
    validateScene(escaped).some((v) => v.code === 'containment-invalid'),
  );

  // The axis: moving the camera to the other side of a two-hander flips the side sign.
  const a = { x: -1, z: 0 };
  const b = { x: 1, z: 0 };
  const front = { start: { position: { x: 0, y: 1.6, z: 5 }, lookAt: { x: 0, y: 1, z: 0 } } };
  const reverse = { start: { position: { x: 0, y: 1.6, z: -5 }, lookAt: { x: 0, y: 1, z: 0 } } };
  check('crossing the line flips the side sign', cameraSideOfLine(front, a, b) !== cameraSideOfLine(reverse, a, b));

  // H3 compilation is mechanical and leaks no scaffolding.
  const compiled = compileBeatToH3(contained, { world: 'Night on a wet grid.' });
  check('compiled H3 mentions its subjects', compiled.includes('<Subject 1>') && compiled.includes('<Subject 2>'));
  check('compiled H3 leaks no field names', !/integrated_multimodal_description|screenPosition|focalStartMm/.test(compiled));
  check('compiled H3 states containment', /inside <Subject 1>/.test(compiled), compiled);

  return failures;
};

// ═══════════════════════════════════════════════ the schema, the contract and the brief
//
// Merged in from scripts/lib/scene-brief.mjs. Keeping these in the same module as the grader is
// deliberate: the band table the model is TAUGHT and the band table it is SCORED against are the
// same object, so they cannot drift apart.

// The world-space scene schema and the brief that asks a model to fill it in.
//
// Split from scripts/lib/scene-geometry.mjs only to keep each file readable — the two merge
// into worker/scene.js on PASS. The split is safe in one direction only: this file imports the
// band table and the H3 motion vocabulary FROM the grader, so the numbers the model is taught
// and the numbers it is scored against are the same objects, and cannot drift apart.



// ─────────────────────────────────────────────────────────────────────── the schema

const POSE = {
  type: 'object',
  additionalProperties: false,
  required: ['position', 'lookAt'],
  properties: {
    position: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'z'],
      properties: {
        x: { type: 'number', description: 'Metres. Larger x is further right in frame when the camera looks toward -Z, which is the ordinary setup.' },
        y: { type: 'number', description: 'Metres above the ground plane. Must be > 0.' },
        z: { type: 'number', description: 'Metres. The audience sits on the +Z side; put the camera at positive z looking back toward -Z.' },
      },
    },
    lookAt: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'z'],
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
      },
      description: 'The world point the camera is aimed at. Never equal to position.',
    },
  },
};

const CAMERA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'start', 'end', 'focalStartMm', 'focalEndMm', 'rollDeg',
    'motion', 'amplitude', 'speed', 'sensorNote',
  ],
  properties: {
    start: POSE,
    end: POSE,
    focalStartMm: { type: 'number', minimum: 8, maximum: 300, description: 'Full-frame equivalent focal length at the start of the beat. 8-300.' },
    focalEndMm: { type: 'number', minimum: 8, maximum: 300, description: 'Focal length at the end of the beat. Equal to focalStartMm unless the shot zooms.' },
    rollDeg: { type: 'number', minimum: -45, maximum: 45, description: 'Roll about the view axis. A dutch angle is a non-zero roll. 0 for a level camera.' },
    motion: { type: 'string', enum: H3_MOTIONS, description: "MiniMax-H3's own motion vocabulary. Must describe what your own start and end poses actually do." },
    amplitude: { type: 'string', enum: ['small', 'medium', 'large'] },
    speed: { type: 'string', enum: ['slow', 'medium', 'fast'] },
    sensorNote: {
      type: 'string',
      enum: ['36mm-wide sensor, frame height = 36/aspect'],
      description: 'Echo this back exactly. It confirms you used the stated sensor size.',
    },
  },
};

const SUBJECT = {
  type: 'object',
  additionalProperties: false,
  required: [
    'subject', 'x', 'z', 'endX', 'endZ', 'groundOffsetM', 'heightM', 'widthM',
    'yawDeg', 'containerId', 'action', 'screenPosition', 'depth',
  ],
  properties: {
    subject: { type: 'string', description: 'Exactly the tag and nothing else — "<Subject 1>", never "<Subject 1> — the ape".' },
    x: { type: 'number', description: 'Ground position in metres at the START of the beat.' },
    z: { type: 'number', description: 'Ground position in metres at the START of the beat.' },
    endX: { type: 'number', description: 'Ground position at the END of the beat. Equal to x if this subject does not move within the beat.' },
    endZ: { type: 'number', description: 'Ground position at the END of the beat.' },
    groundOffsetM: { type: 'number', minimum: 0, maximum: 200, description: 'Height of the base of this subject above the ground. 0 for anything standing on the ground; greater than 0 only when seated in or on something, in which case containerId must be set.' },
    // Ceilings raised from 60m to 500m after a measured failure on fixture F3 (2026-08-24).
    // Buildings are subjects too: the fixture contains "a massive brutalist concrete tower", and
    // the model's own sceneScaleNote correctly worked out that it was 70m tall — but 70 was
    // unsayable under a 60m cap that strict mode actually enforces, so a nonsense 0.064 came back
    // and the grader flagged a floor violation that was the schema's fault. A range that makes
    // the true answer impossible does not test the model.
    heightM: { type: 'number', minimum: 0.02, maximum: 500, description: 'Real height in metres. An adult human is about 1.8; a car about 1.3; a tower block can be 70 or more. This never changes between beats.' },
    widthM: { type: 'number', minimum: 0.02, maximum: 500, description: 'Real width in metres across the widest horizontal axis. An adult human is about 0.6; a car about 2.0; a building can be tens of metres.' },
    yawDeg: { type: 'number', minimum: -180, maximum: 180, description: 'Facing, rotation about +Y. 0 faces +Z, 90 faces +X.' },
    containerId: { type: ['string', 'null'], description: 'The tag of the subject this one is inside or on, e.g. a driver in a car. null when standing free.' },
    action: { type: 'string', description: 'What this subject is doing right now, in this beat.' },
    screenPosition: { type: 'string', enum: SCREEN_BUCKETS, description: 'Where this subject falls in the frame. Derivable from your own geometry — state it, and make sure it agrees.' },
    depth: { type: 'string', enum: ['foreground', 'midground', 'background'] },
  },
};

const BEAT = {
  type: 'object',
  additionalProperties: false,
  required: [
    'beatIndex', 'kind', 'transitionText', 'camera', 'subjects',
    'principalSubject', 'framing', 'changes', 'containmentNotes', 'proseNote',
  ],
  properties: {
    beatIndex: { type: 'integer', minimum: 0, description: 'Zero-based index of the beat this describes.' },
    kind: { type: 'string', enum: ['shot', 'transition'] },
    transitionText: { type: ['string', 'null'], description: 'For a transition beat, the text after the marker. null for a shot.' },
    camera: { anyOf: [CAMERA, { type: 'null' }], description: 'null if and only if kind is "transition".' },
    subjects: { type: 'array', items: SUBJECT, description: 'Every subject visible in this beat. Empty for a transition.' },
    principalSubject: { type: ['string', 'null'], description: 'The tag of the subject the shot size is defined on.' },
    framing: { type: 'string', enum: FRAMING_BANDS.map((b) => b.band), description: 'Shot size on the principal subject. Derivable from your own geometry — state it, and make sure it agrees.' },
    changes: {
      type: 'array',
      description: 'Every subject whose position changed since the previous beat, and whether this beat\'s own text justifies it.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subject', 'what', 'justifiedByBeatText'],
        properties: {
          subject: { type: 'string' },
          what: { type: 'string' },
          justifiedByBeatText: { type: 'boolean' },
        },
      },
    },
    containmentNotes: { type: 'string', description: 'Whatever a renderer needs to get physically right: who is inside what, who is holding what.' },
    proseNote: { type: 'string', description: 'One plain-English paragraph describing this shot to a human reader. Present tense.' },
  },
};

export const SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['units', 'aspect', 'sceneScaleNote', 'beats'],
  properties: {
    units: { type: 'string', enum: ['metres'], description: 'Echo this back exactly.' },
    aspect: { type: 'number', minimum: 0.4, maximum: 2.5, description: 'Frame aspect ratio, width over height. 16:9 is 1.7778.' },
    sceneScaleNote: { type: 'string', description: 'One line: how big the staged set is, in metres, so the camera can be placed sensibly.' },
    beats: { type: 'array', items: BEAT },
  },
};

/**
 * OpenAI's strict structured-output mode supports a subset of JSON Schema, and numeric range
 * keywords have historically not been in it. Rather than guess, the schema above states ranges
 * BOTH as keywords and in prose inside each description — so if strict mode rejects the
 * keywords, stripping them loses nothing the model can read.
 *
 * Stage 0 of the probe decides which form to use, empirically, before any real money moves.
 */
const RANGE_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];

export const toStrictSchema = (node) => {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (RANGE_KEYWORDS.includes(key)) continue;
    out[key] = toStrictSchema(value);
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────── the contract

const bandTable = FRAMING_BANDS.map((b) => {
  const range = b.max === Infinity ? `>= ${b.min}` : `${b.min} - ${b.max}`;
  return `  ${b.band.padEnd(4)} hFrac ${range.padEnd(12)} ${b.reading}`;
}).join('\n');

const workedExamples = workedExampleValues()
  .map((v) => `  ${v.label}\n    hFrac = ${v.hFrac.toFixed(4)}  ->  ${v.band}`)
  .join('\n');

/**
 * CONTRACT V2 — the same geometry, stated to match the model's actual prior.
 *
 * Measured finding from stage 1 (48 films): across 94 subject pairs, the declared left/right
 * ordering agreed with plain world +X 85% of the time and with the ACTUAL projection only 7%.
 * The model reads screen position straight off world coordinates and never applies the
 * handedness rule. It also parked the camera at negative Z looking toward +Z in 49 of 60 beats —
 * the orientation where larger X is screen-LEFT — and then labelled larger X as "right" anyway.
 *
 * V1 stated the convention correctly and never stated its CONSEQUENCE, and the schema's own
 * field description ("+X is world-right") actively invited the confusion.
 *
 * The fix here is not a sterner warning. It is to choose the convention under which the model's
 * instinct is CORRECT: the camera looks down -Z by default (the film and OpenGL convention), so
 * "larger X is further right in frame" becomes true for the ordinary case. Fighting a strong
 * prior with a footnote is worse engineering than adopting the prior.
 */
export const COORDINATE_CONTRACT_V2 = `THE COORDINATE CONTRACT. This is law, not guidance. Every number you emit is interpreted
under it exactly as written.

  Units are metres. The space is right-handed and +Y is up. The ground is the plane y = 0.
  The origin is the ground point directly beneath the film's principal subject as staged in
  beat 1, and it does not move for the rest of the film.

  THE AUDIENCE SITS ON THE +Z SIDE AND LOOKS TOWARD -Z. Place your camera at positive Z,
  looking back toward the origin and beyond it into negative Z. This is the ordinary case and
  you should use it unless a beat genuinely calls for something else.

  THE CONSEQUENCE, WHICH YOU MUST APPLY: with the camera on the +Z side looking toward -Z, a
  subject with a LARGER x appears FURTHER RIGHT in the frame. Smaller x is further left. So to
  put someone on the left of frame, give them a smaller x than the person on the right.

  If a beat does move the camera to the far side and look back toward +Z, then left and right
  in frame SWAP: from over there, larger x is now on the LEFT. Crossing to the far side is
  exactly what "crossing the line" means, and the subjects change sides of frame when you do it.
  Do not cross without meaning to.

  Worked example, and check yours against it:
    camera at (0, 1.6, 8) looking at (0, 1.0, 0)  ->  it is looking toward -Z
    a subject at x = -2 appears on the LEFT of frame
    a subject at x = +2 appears on the RIGHT of frame

  yawDeg is rotation about +Y. Forward is (sin yaw, 0, cos yaw): yaw 0 faces +Z, yaw 90 faces
  +X. A character facing the audience in the ordinary setup therefore has yaw near 0.

  A camera is two poses, start and end, each a world position and a world lookAt point, plus a
  focal length at each end and a roll. A dutch angle is a non-zero rollDeg, not a label.
  The camera never sits at y <= 0, and never sits inside a subject's own volume.

  The sensor is full-frame: ${SENSOR_WIDTH_MM}mm wide, and the frame height is ${SENSOR_WIDTH_MM}/aspect
  (at 16:9 that is 20.25mm).

HOW SHOT SIZE IS COMPUTED. Not a matter of taste — it follows from where you put the camera:

  hFrac = (subject heightM * focalMm) / (distance along the optical axis * frame height mm)

  and hFrac is the fraction of frame height the subject fills:

${bandTable}

  Worked examples, so there is no ambiguity about the arithmetic:

${workedExamples}

  You state 'framing' yourself, and it must be the band your own numbers produce. If you want a
  close-up, put the camera close or lengthen the lens — do not label a wide shot as a close-up.
  The same applies to 'screenPosition' and 'depth': they are readable off your own geometry, and
  they are checked against it.`;

export const COORDINATE_CONTRACT = `THE COORDINATE CONTRACT. This is law, not guidance. Every number you emit is interpreted
under it exactly as written.

  Units are metres. The space is right-handed and +Y is up. The ground is the plane y = 0.
  The origin is the ground point directly beneath the film's principal subject as staged in
  beat 1, and it does not move for the rest of the film — every beat's coordinates are in that
  same frame, which is what makes continuity between beats mean anything.

  yawDeg is rotation about +Y. Forward is (sin yaw, 0, cos yaw): yaw 0 faces +Z, yaw 90 faces
  +X. Range -180 to 180.

  A camera is two poses, start and end, each a world position and a world lookAt point, plus a
  focal length at each end and a roll. A dutch angle is a non-zero rollDeg, not a label.
  The camera never sits at y <= 0, and never sits inside a subject's own volume.

  The sensor is full-frame: ${SENSOR_WIDTH_MM}mm wide, and the frame height is ${SENSOR_WIDTH_MM}/aspect
  (at 16:9 that is 20.25mm).

HOW SHOT SIZE IS COMPUTED. Not a matter of taste — it follows from where you put the camera:

  hFrac = (subject heightM * focalMm) / (distance along the optical axis * frame height mm)

  and hFrac is the fraction of frame height the subject fills:

${bandTable}

  Worked examples, so there is no ambiguity about the arithmetic:

${workedExamples}

  You state 'framing' yourself, and it must be the band your own numbers produce. If you want a
  close-up, put the camera close or lengthen the lens — do not label a wide shot as a close-up.
  The same applies to 'screenPosition' and 'depth': they are readable off your own geometry, and
  they are checked against it.`;

// ─────────────────────────────────────────────────────────────────────── the brief

const RULES = `Rules.

1. DELIBERATE SHOT VARIETY. Shot size must vary across the film. A film in which every beat
   lands in the same band has failed, no matter how well each beat reads on its own. Choose each
   beat's camera distance from what the beat is about: a beat about an emotion or a detail goes
   close; a beat about geography, scale or simultaneity goes wide. State in sceneScaleNote how
   big the set is, and place the camera accordingly.

2. CONTINUITY IS THE WORLD, NOT A CLAIM. A subject's world position persists between beats.
   Move a subject only if this beat's own text moves them. Every move goes in 'changes' with
   justifiedByBeatText set honestly. A subject's heightM never changes between beats — a person
   is the same height in beat 5 as in beat 1.

2b. SIZES ARE GIVEN, NOT CHOSEN. Where a cast entry states a size, those are the numbers —
   copy them into heightM and widthM in every beat that subject appears in. They were measured
   from the artwork itself, and shot size is computed from them, so substituting your own
   changes the framing of the shot without changing anything you can see. Only invent a size
   for a subject the cast list gives none for.

3. THE 180-DEGREE LINE. The line runs through the two principal subjects. Keep the camera on one
   side of it across consecutive beats. If a beat genuinely calls for crossing, cross — and
   expect the subjects to swap sides of frame, because that is what crossing means.

4. CONTAINMENT IS GEOMETRY. A subject inside or on another sets containerId, sits within the
   container's own footprint, and has a groundOffsetM greater than zero and no greater than the
   container's height. A person in a vehicle is inside it, not visible through the windscreen
   from an impossible angle.

5. INCLUSION. Never place a subject in a beat that the beat's own text doesn't put there. A cast
   member with a reference available who has no part in this beat simply does not appear in that
   beat's subjects array. An early, unearned reveal is a real error, not a safe default.

6. TAG DISCIPLINE. Every 'subject' and 'containerId' field is the bare tag and nothing else —
   exactly "<Subject 1>", never "<Subject 1> — the ape" or any other appended description.
   Downstream code matches these by exact tag; anything extra breaks that match silently.

7. TRANSITIONS. A beat whose text begins [CUT TO BLACK], [TRANSITION] or [FADE] is not a shot.
   Return kind "transition", camera null, subjects [], and the marker's remaining text in
   transitionText.

8. PROSE. proseNote is one plain-English paragraph per beat, present tense, written for a human
   reader who will never see the numbers — the camera described as motion + amplitude + speed in
   H3's own vocabulary. It describes the same shot the numbers describe. It is never a second,
   differing account of the beat.`;

/**
 * The brief. The scope argument changes NOTHING here — both the whole-film and the chained
 * cells get byte-identical system prompts, so that the probe's scope comparison measures scope
 * and not two different sets of instructions. Only the user message differs.
 */
export const buildBrief = (h3Format, contract = COORDINATE_CONTRACT) => `You are the Storyboarder on a film crew that turns licensed NFT artwork into short generated
video. Your job is not to describe a pretty picture — it is a precise technical blocking
specification, exact enough that a video-render pipeline can follow it without guessing.

${h3Format}

${contract}

${RULES}

Return the film by calling the tool. Write no prose outside it.`;

/**
 * The observed size of a piece, in the words the model needs to plan a camera with.
 *
 * WHY THIS IS ON THE CAST LINE AND NOT IN THE RULES. hFrac is directly proportional to
 * heightM, so before this existed the model invented a height and every shot size in the film
 * inherited the invention. Stating the real one HERE — attached to the subject it belongs to,
 * at the moment the model reads what that subject is — is what turns "a close-up of the ape"
 * into an arithmetic problem with a known input.
 *
 * Silent when the dossier predates the profile (schema v4 and earlier). A cast line that says
 * nothing is exactly what the model saw before; a cast line that says "unknown" invites it to
 * reason about the gap.
 */
const profileLine = (dossier) => {
  const profile = dossier?.physicalProfile;
  if (!profile || !Number.isFinite(profile.heightM)) return '';
  const confidence = profile.heightConfidence === 'unknowable' ? ', size unknowable — treat as approximate' : '';
  const shape = profile.silhouetteNotes ? `; ${profile.silhouetteNotes}` : '';
  return `\n    ${profile.bodyPlan}, ${profile.heightM}m tall × ${profile.widthM}m wide × ${profile.depthM}m deep${confidence}${shape}`;
};

export const castLine = (index, entry) => {
  const dossier = entry?.dossier ?? {};
  const subject = dossier.subject ?? entry?.name ?? entry?.key ?? 'unknown';
  const markers = dossier.identityMarkers?.length
    ? ` (${dossier.identityMarkers.slice(0, 3).join(', ')})`
    : '';
  return `<Subject ${index + 1}> — ${subject}${markers}${profileLine(dossier)}`;
};

/**
 * Tag -> the piece cast in that slot: what to draw it as, and what it derives from.
 *
 * STORED ON THE STORYBOARD, NOT DERIVED ON THE CLIENT, for the same reason `subjectNames` is —
 * a visitor who reloads and re-opens an earlier film has no cast in hand, and a card that
 * silently reverts to a grey capsule on reload is a representation that only works while you are
 * watching it.
 *
 * It is also where provenance lives. Every frame of every film now names the source asset each
 * subject derives from, which is the half of attribution that is genuinely painful to retrofit:
 * the asset path can be rebuilt from the dossiers at any time, but the RENDER path cannot, so
 * anything blocked before this existed is untraceable and always will be.
 */
export const subjectAssetsFrom = (spec, castByKey) =>
  Object.fromEntries(
    (spec.referencePlan ?? [])
      .map((slot, i) => {
        const entry = castByKey.get(slot.key);
        if (!entry) return null;
        return [
          `<Subject ${i + 1}>`,
          {
            assetKey: entry.key,
            name: entry.name ?? entry.collectionName ?? null,
            collectionName: entry.collectionName ?? null,
            // The renderer reads bodyPlan, depthM and headRatio off this. Null for a cast whose
            // dossiers predate v5, which the renderer handles by falling back to its heuristic.
            profile: entry.dossier?.physicalProfile ?? null,
            medium: entry.dossier?.medium ?? null,
            sourceImageUrls: entry.dossier?.sourceImageUrls ?? null,
          },
        ];
      })
      .filter(Boolean),
  );

const specHeader = (spec, cast) => {
  const referenceLines = (spec.referencePlan ?? []).map((slot, i) => {
    const entry = cast.find((c) => c.key === slot.key);
    return castLine(i, entry ?? { key: slot.key });
  });
  return [
    spec.logline ? `Logline: ${spec.logline}` : null,
    spec.world ? `World: ${spec.world}` : null,
    spec.staging ? `Staging: ${spec.staging}` : null,
    spec.guard ? `Guard: ${spec.guard}` : null,
    spec.camera ? `Film's overall camera direction: ${spec.camera}` : null,
    spec.continuity ? `Continuity: ${spec.continuity}` : null,
    spec.ratio ? `Frame aspect: ${spec.ratio}` : null,
    '',
    'Cast with references available (referencePlan order):',
    ...referenceLines,
  ].filter((line) => line !== null);
};

/** The whole film in one call — the model sees every beat, numbered, with the total. This is
 * the context today's per-beat storyboarder never has, and the suspected root cause of every
 * beat coming back the same shot size. */
export const buildFilmUserMessage = (spec, cast) => {
  const beats = spec.beats ?? [];
  return [
    ...specHeader(spec, cast),
    '',
    `The film is ${beats.length} beats long, in order:`,
    ...beats.map((text, i) => `Beat ${i + 1} of ${beats.length}: ${text}`),
    '',
    'Write the blocking for every beat.',
  ].join('\n');
};

/** One beat at a time, with only the previous beat's scene for context — exactly the context
 * discipline worker/storyboarder.js uses today, reproduced so the comparison is honest. */
export const buildChainedUserMessage = (spec, cast, beatIndex, previousScene) => {
  const beats = spec.beats ?? [];
  return [
    ...specHeader(spec, cast),
    '',
    `This is beat ${beatIndex + 1} of ${beats.length}: ${beats[beatIndex]}`,
    previousScene
      ? `\nThe previous beat's own scene, for continuity:\n${JSON.stringify(previousScene)}`
      : '\nThis is the first beat — there is nothing before it.',
    '',
    'Write the blocking for this beat. Return a film object containing exactly this one beat.',
  ].join('\n');
};
