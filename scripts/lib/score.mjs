// Every metric in the probe's scorecard, computed in code.
//
// The design rule this file exists to enforce: a metric an LLM judges is a metric that can be
// argued with. Everything here is arithmetic over the model's own numbers, so a disputed result
// is re-checkable by hand from the raw response. The one genuine judgement call — does the prose
// describe the beat the Screenwriter actually wrote — lives in the runner, is blinded, and is
// explicitly NOT part of the pass gate.
//
// SEVERITY. Metrics marked FLOOR in the plan (M2a, M8's teleport, M9, M10) return violations
// tagged `floor`. One floor violation fails that fixture outright — no rate, no averaging. The
// soft metrics rest on tuned constants and are scored instead, because a threshold nobody has
// calibrated should not get to veto a round.

import {
  FRAMING_ORDER,
  cameraMoveScore,
  isDirectionFlip,
  cameraSideOfLine,
  classifyCameraMove,
  compileBeatToH3,
  deriveFraming,
  deriveScreenBucket,
  projectSubject,
  sceneScaleOf,
  validateScene,
  UNSCOREABLE_MOTIONS,
} from './scene-geometry.mjs';
import { aspectOf } from './storyboard-fixtures.mjs';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const horizDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Both candidate and control films reduced to one shape, so every metric that CAN apply to both
 * does. The control has no geometry, and says so explicitly rather than defaulting to zero —
 * a missing measurement and a measurement of zero are different findings.
 */
export const normalise = (film, kind) => {
  if (kind === 'legacy') {
    const beats = (film.beats ?? []).map((b, i) => ({
      beatIndex: i,
      kind: 'shot',
      geometry: null,
      declaredFraming: b.framing ?? null,
      declaredMotion: b.cameraMovement ?? null,
      subjects: (b.subjectsInFrame ?? []).map((s) => ({
        subject: s.subject,
        declaredScreenPosition: s.screenPosition ?? null,
        declaredDepth: s.depth ?? null,
        action: s.action ?? '',
        containerId: null,
      })),
      excluded: b.subjectsExcluded ?? [],
      proseNote: b.visualPrompt ?? '',
      raw: b,
    }));
    return { kind, beats, aspect: 16 / 9 };
  }
  const beats = (film.beats ?? []).map((b, i) => ({
    beatIndex: Number.isInteger(b.beatIndex) ? b.beatIndex : i,
    kind: b.kind ?? 'shot',
    geometry: b.kind === 'transition' ? null : b,
    declaredFraming: b.framing ?? null,
    declaredMotion: b.camera?.motion ?? null,
    subjects: (b.subjects ?? []).map((s) => ({
      subject: s.subject,
      declaredScreenPosition: s.screenPosition ?? null,
      declaredDepth: s.depth ?? null,
      action: s.action ?? '',
      containerId: s.containerId ?? null,
      geo: s,
    })),
    excluded: [],
    proseNote: b.proseNote ?? '',
    changes: b.changes ?? [],
    transitionText: b.transitionText ?? null,
    raw: b,
  }));
  return { kind, beats, aspect: film.aspect && film.aspect > 0 ? film.aspect : 16 / 9 };
};

const projectAll = (beat, aspect, atEnd = false) => {
  if (!beat.geometry?.camera) return new Map();
  const out = new Map();
  for (const s of beat.subjects) {
    out.set(s.subject, projectSubject(s.geo, beat.geometry.camera, { aspect, atEnd }));
  }
  return out;
};

/** Every subject tag the beat's own text puts in the beat, plus what the fixture pinned. */
const tagsIn = (text) => new Set((text.match(/<Subject \d+>/g) ?? []));

export const scoreFilm = ({ film, kind, fixture }) => {
  const aspect = aspectOf(fixture.spec);
  const norm = normalise(film, kind);
  const beats = norm.beats;
  const exp = fixture.expectations;
  const specBeats = fixture.spec.beats ?? [];

  const violations = [];
  const note = (code, severity, detail, extra = {}) =>
    violations.push({ code, severity, detail, ...extra });

  // ── M1 structural validity ───────────────────────────────────────────────────────────────
  const m1 = { beatsExpected: specBeats.length, beatsReturned: beats.length, tagErrors: [], indexErrors: [] };
  const refCount = (fixture.spec.referencePlan ?? []).length;
  for (const beat of beats) {
    for (const s of beat.subjects) {
      const match = /^<Subject (\d+)>$/.exec(s.subject ?? '');
      if (!match) {
        m1.tagErrors.push({ beat: beat.beatIndex, tag: s.subject });
      } else if (Number(match[1]) < 1 || Number(match[1]) > refCount) {
        m1.tagErrors.push({ beat: beat.beatIndex, tag: s.subject, reason: 'out of referencePlan range' });
      }
    }
  }
  beats.forEach((b, i) => {
    if (b.beatIndex !== i) m1.indexErrors.push({ position: i, beatIndex: b.beatIndex });
  });
  m1.valid = m1.beatsReturned === m1.beatsExpected && !m1.tagErrors.length && !m1.indexErrors.length;

  // Schema validity is an ABSOLUTE floor, added by Adam before the free-tier probe. It was 1.00
  // across the whole paid run, so this changes nothing there — but a weaker model's
  // instruction-following is exactly where validity drifts, and "brilliant reasoning,
  // unparseable JSON" is precisely what a visitor experiences as a broken tool. No amount of
  // good geometry rescues a film the UI cannot render.
  if (!m1.valid) {
    note('schema-invalid', 'floor',
      `Expected ${m1.beatsExpected} beats, got ${m1.beatsReturned}` +
      `${m1.tagErrors.length ? `; ${m1.tagErrors.length} bad subject tag(s): ${m1.tagErrors.slice(0, 3).map((t) => JSON.stringify(t.tag)).join(', ')}` : ''}` +
      `${m1.indexErrors.length ? `; ${m1.indexErrors.length} beatIndex mismatch(es)` : ''}.`);
  }

  // Per-beat output floor, also Adam's. Free models compress to fit an output ceiling, and a
  // whole-film size check would let the LAST beats of a long film silently degrade while the
  // total still looked healthy. So this is checked per beat, never per film.
  const REQUIRED_BEAT_FIELDS = ['beatIndex', 'kind', 'camera', 'subjects', 'framing', 'proseNote'];
  const MIN_SHOT_BEAT_CHARS = 200;
  const m17 = { thin: 0, missingFields: 0, applicable: kind !== 'legacy' };
  if (m17.applicable) {
    for (const beat of beats) {
      const missing = REQUIRED_BEAT_FIELDS.filter((f) => !(f in (beat.raw ?? {})));
      if (missing.length) {
        m17.missingFields += 1;
        note('beat-missing-fields', 'floor',
          `Beat ${beat.beatIndex + 1} is missing required field(s): ${missing.join(', ')}.`,
          { beat: beat.beatIndex });
      }
      if (beat.kind === 'transition') continue;
      const size = JSON.stringify(beat.raw ?? {}).length;
      if (size < MIN_SHOT_BEAT_CHARS) {
        m17.thin += 1;
        note('beat-truncated', 'floor',
          `Beat ${beat.beatIndex + 1} serialises to only ${size} characters — below the ${MIN_SHOT_BEAT_CHARS} floor. A shot beat this small has been compressed away rather than written.`,
          { beat: beat.beatIndex });
      }
    }
  }

  if (kind !== 'legacy') {
    m1.canaries = {
      units: film.units === 'metres',
      sensorNote: beats
        .filter((b) => b.geometry?.camera)
        .every((b) => b.geometry.camera.sensorNote === '36mm-wide sensor, frame height = 36/aspect'),
    };
  }

  // ── M2 plausibility ──────────────────────────────────────────────────────────────────────
  const m2 = { floor: 0, soft: 0, byCode: {} };
  if (kind !== 'legacy') {
    for (const beat of beats) {
      if (!beat.geometry && beat.kind !== 'transition') continue;
      const scene = beat.kind === 'transition'
        ? { beatIndex: beat.beatIndex, kind: 'transition', camera: beat.raw.camera, subjects: beat.raw.subjects ?? [] }
        : { ...beat.geometry, beatIndex: beat.beatIndex };
      for (const v of validateScene(scene, { aspect })) {
        m2.byCode[v.code] = (m2.byCode[v.code] ?? 0) + 1;
        if (v.severity === 'floor') m2.floor += 1; else m2.soft += 1;
        note(v.code, v.severity, v.detail, { beat: beat.beatIndex, subject: v.subject });
      }
    }
    m2.softPerScene = beats.length ? m2.soft / beats.length : 0;
  }

  // ── M3/M4/M5 self-agreement ──────────────────────────────────────────────────────────────
  const m3 = { scores: [], exact: 0, counted: 0, rows: [] };
  const m4 = { scores: [], sideErrors: 0, counted: 0 };
  const m5 = { scores: [], counted: 0, unscoreable: 0, directionFlips: 0, rows: [] };
  const derivedBands = [];

  for (const beat of beats) {
    if (beat.kind === 'transition') { derivedBands.push(null); continue; }
    if (kind === 'legacy' || !beat.geometry?.camera) {
      derivedBands.push(beat.declaredFraming);
      continue;
    }
    const projections = projectAll(beat, aspect);
    const principalTag = beat.geometry.principalSubject ?? beat.subjects[0]?.subject ?? null;
    const p = principalTag ? projections.get(principalTag) : null;
    const derived = p && Number.isFinite(p.hFrac) ? deriveFraming(p.hFrac) : null;
    derivedBands.push(derived);

    if (derived && beat.declaredFraming) {
      const gap = Math.abs(FRAMING_ORDER.indexOf(derived) - FRAMING_ORDER.indexOf(beat.declaredFraming));
      const score = gap === 0 ? 1 : gap === 1 ? 0.5 : 0;
      m3.scores.push(score);
      if (gap === 0) m3.exact += 1;
      m3.counted += 1;
      m3.rows.push({ beat: beat.beatIndex, declared: beat.declaredFraming, derived, hFrac: p.hFrac, score });
      if (gap > 1) {
        note('framing-disagreement', 'soft',
          `Beat ${beat.beatIndex + 1} declares ${beat.declaredFraming}; its own geometry gives ${derived} (hFrac ${p.hFrac.toFixed(3)}).`,
          { beat: beat.beatIndex });
      }
    }

    const endProjections = projectAll(beat, aspect, true);
    for (const s of beat.subjects) {
      const proj = projections.get(s.subject);
      const projEnd = endProjections.get(s.subject);
      if (!proj || !s.declaredScreenPosition) continue;

      // Scored against the START and the END of the beat, best of the two.
      //
      // The schema carries one screenPosition per subject, but a beat has two camera poses and
      // two subject positions. On a moving shot a subject legitimately starts off-frame and
      // ends centred — grid-launch beat 3 aims the camera at x=0 at the start and x=3.2 at the
      // end with the subject at 3.2, so "center" is true at the end and wildly false at the
      // start. Scoring the start alone measured the schema's ambiguity, not the model.
      //
      // A label matching NEITHER endpoint is still a real disagreement, so the metric keeps its
      // teeth. The build should split this into screenPositionStart/End and remove the ambiguity
      // at the source rather than leaning on this leniency.
      const order = ['far-left', 'left', 'center-left', 'center', 'center-right', 'right', 'far-right'];
      const declaredIndex = order.indexOf(s.declaredScreenPosition);
      const candidates = [proj, projEnd]
        .filter((p) => p && Number.isFinite(p.ndcX))
        .map((p) => ({ ndcX: p.ndcX, gap: Math.abs(order.indexOf(deriveScreenBucket(p.ndcX)) - declaredIndex) }));
      if (!candidates.length) continue;
      const best = candidates.reduce((a, b) => (a.gap <= b.gap ? a : b));

      m4.scores.push(best.gap === 0 ? 1 : best.gap === 1 ? 0.5 : 0);
      m4.counted += 1;

      const declaredLeft = s.declaredScreenPosition.includes('left');
      const declaredRight = s.declaredScreenPosition.includes('right');
      // A side error only counts when the subject is on the wrong side at BOTH ends of the beat.
      const wrongSide = (p) => (declaredLeft && p.ndcX > 1 / 7) || (declaredRight && p.ndcX < -1 / 7);
      if (candidates.length && candidates.every(wrongSide)) {
        m4.sideErrors += 1;
        note('screen-side-error', 'soft',
          `Beat ${beat.beatIndex + 1}: ${s.subject} declared ${s.declaredScreenPosition} but projects to ndcX ${candidates.map((c) => c.ndcX.toFixed(2)).join(' -> ')} across the beat.`,
          { beat: beat.beatIndex, subject: s.subject });
      }
    }

    const derivedMove = classifyCameraMove(beat.geometry.camera, sceneScaleOf(beat.geometry)).motion;
    const declaredMove = beat.declaredMotion;
    if (declaredMove && UNSCOREABLE_MOTIONS.has(declaredMove)) {
      m5.unscoreable += 1;
    } else if (declaredMove) {
      const score = cameraMoveScore(declaredMove, derivedMove);
      m5.scores.push(score);
      m5.counted += 1;
      m5.rows.push({ beat: beat.beatIndex, declared: declaredMove, derived: derivedMove, score });
      if (isDirectionFlip(declaredMove, derivedMove)) {
        m5.directionFlips += 1;
        note('camera-direction-flip', 'soft',
          `Beat ${beat.beatIndex + 1} declares "${declaredMove}" but its own poses do "${derivedMove}" — right axis, opposite direction.`,
          { beat: beat.beatIndex });
      } else if (score === 0) {
        note('camera-move-disagreement', 'soft',
          `Beat ${beat.beatIndex + 1} declares "${declaredMove}"; its own poses do "${derivedMove}".`,
          { beat: beat.beatIndex });
      }
    }
  }

  m3.mean = mean(m3.scores);
  m3.exactRate = m3.counted ? m3.exact / m3.counted : null;
  m4.mean = mean(m4.scores);
  m4.sideErrorRate = m4.counted ? m4.sideErrors / m4.counted : null;
  m5.mean = mean(m5.scores);

  // ── M6 framing variety ───────────────────────────────────────────────────────────────────
  const shotBands = derivedBands.filter(Boolean);
  const counts = {};
  for (const b of shotBands) counts[b] = (counts[b] ?? 0) + 1;
  const indices = shotBands.map((b) => FRAMING_ORDER.indexOf(b)).filter((i) => i >= 0);
  const m6 = {
    basis: kind === 'legacy' ? 'declared (control has no geometry)' : 'derived',
    distinctBands: Object.keys(counts).length,
    modalShare: shotBands.length ? Math.max(...Object.values(counts)) / shotBands.length : null,
    spread: indices.length ? Math.max(...indices) - Math.min(...indices) : null,
    mwsShare: shotBands.length ? (counts.MWS ?? 0) / shotBands.length : null,
    bands: shotBands,
  };
  const scored = (exp.perBeat ?? []).filter((e) => e.expectFramingBand);
  const hits = scored.filter((e) => derivedBands[e.beat] && e.expectFramingBand.includes(derivedBands[e.beat]));
  m6.extremeHitRate = scored.length ? hits.length / scored.length : null;
  for (const e of scored) {
    const got = derivedBands[e.beat];
    if (got && !e.expectFramingBand.includes(got)) {
      note('framing-expectation-miss', 'soft',
        `Beat ${e.beat + 1} came back ${got}; pre-registered as ${e.expectFramingBand.join('/')}. Beat text: "${specBeats[e.beat]}"`,
        { beat: e.beat });
    }
  }

  // ── M7 camera-position variety ───────────────────────────────────────────────────────────
  const m7 = { staticCameraPairs: 0, meanDisplacementRel: null };
  if (kind !== 'legacy') {
    const shots = beats.filter((b) => b.geometry?.camera);
    const displacements = [];
    for (let i = 1; i < shots.length; i += 1) {
      const a = shots[i - 1].geometry.camera;
      const b = shots[i].geometry.camera;
      const scale = Math.max(sceneScaleOf(shots[i].geometry), 1);
      const posDelta = horizDist(a.start.position, b.start.position) / scale;
      const lookDelta = horizDist(a.start.lookAt, b.start.lookAt) / scale;
      displacements.push(posDelta);
      if (posDelta < 0.01 && lookDelta < 0.01) {
        m7.staticCameraPairs += 1;
        note('identical-consecutive-camera', 'soft',
          `Beats ${shots[i - 1].beatIndex + 1} and ${shots[i].beatIndex + 1} have the same camera pose.`,
          { beat: shots[i].beatIndex });
      }
    }
    m7.meanDisplacementRel = mean(displacements);
  }

  // ── M8 continuity ────────────────────────────────────────────────────────────────────────
  const m8 = { teleports: 0, wrongDirection: 0, unjustifiedDrift: 0, missedMove: 0, heightInstability: null, selfReportRecall: null };
  if (kind !== 'legacy') {
    const duration = fixture.spec.duration ?? 12;
    const perBeatSeconds = duration / Math.max(specBeats.length, 1);
    const teleportLimit = 3 * 8 * perBeatSeconds; // 8 m/s is a hard sprint

    const heights = new Map();
    for (const beat of beats) {
      for (const s of beat.subjects) {
        if (!s.geo) continue;
        if (!heights.has(s.subject)) heights.set(s.subject, []);
        heights.get(s.subject).push(s.geo.heightM);
      }
    }
    const instabilities = [];
    for (const [tag, hs] of heights) {
      if (hs.length < 2) continue;
      const m = mean(hs);
      const sd = Math.sqrt(mean(hs.map((h) => (h - m) ** 2)));
      const rel = m > 0 ? sd / m : 0;
      instabilities.push(rel);
      if (rel > 0.05) {
        note('height-drift', 'soft',
          `${tag} varies in height across beats: ${hs.map((h) => h.toFixed(2)).join(', ')}m.`,
          { subject: tag });
      }
    }
    m8.heightInstability = mean(instabilities);

    const shots = beats.filter((b) => b.kind !== 'transition');
    let reported = 0;
    let computed = 0;
    for (let i = 1; i < shots.length; i += 1) {
      const prev = shots[i - 1];
      const cur = shots[i];
      // Continuity is never evaluated across a transition — a cut is meant to break it.
      const between = beats.filter(
        (b) => b.beatIndex > prev.beatIndex && b.beatIndex < cur.beatIndex && b.kind === 'transition',
      );
      if (between.length) continue;

      const scale = Math.max(sceneScaleOf(cur.geometry ?? {}), 1);
      for (const s of cur.subjects) {
        const before = prev.subjects.find((p) => p.subject === s.subject);
        if (!before?.geo || !s.geo) continue;
        // Two distinct displacements, and a movement expectation is satisfied by EITHER:
        //   betweenBeats — the subject is somewhere else than where the last beat left it
        //   withinBeat   — the subject travels during this beat (x,z -> endX,endZ)
        // A beat whose whole action is "the car drives off" encodes its movement within the beat,
        // and an earlier version of this check looked only between beats and called that a missed
        // move. Drift, by contrast, is only ever a between-beats question.
        const moved = horizDist({ x: before.geo.endX, z: before.geo.endZ }, { x: s.geo.x, z: s.geo.z });
        const withinBeat = horizDist({ x: s.geo.x, z: s.geo.z }, { x: s.geo.endX, z: s.geo.endZ });
        const travelled = Math.max(moved, withinBeat);
        const expectation = (exp.movement ?? []).find((e) => e.subject === s.subject && e.beat === cur.beatIndex);
        if (moved > 0.15 * scale) computed += 1;
        if (moved > 0.15 * scale && (cur.changes ?? []).some((c) => c.subject === s.subject)) reported += 1;

        if (moved > teleportLimit) {
          m8.teleports += 1;
          note('teleport', 'floor',
            `${s.subject} moves ${moved.toFixed(1)}m between beats ${prev.beatIndex + 1} and ${cur.beatIndex + 1}; the physical ceiling for this beat is ${teleportLimit.toFixed(1)}m.`,
            { beat: cur.beatIndex, subject: s.subject });
        }
        if (expectation?.moved && travelled < (expectation.minMetres ?? 1)) {
          m8.missedMove += 1;
          note('missed-move', 'soft',
            `${s.subject} was pre-registered to move at least ${expectation.minMetres}m in beat ${cur.beatIndex + 1}; it travelled ${travelled.toFixed(2)}m (${withinBeat.toFixed(2)}m within the beat, ${moved.toFixed(2)}m since the last one).`,
            { beat: cur.beatIndex, subject: s.subject });
        }
        if (!expectation && moved > 0.15 * scale) {
          m8.unjustifiedDrift += 1;
          note('unjustified-drift', 'soft',
            `${s.subject} drifts ${moved.toFixed(1)}m into beat ${cur.beatIndex + 1} with nothing in the beat text moving it.`,
            { beat: cur.beatIndex, subject: s.subject });
        }
      }
    }
    m8.selfReportRecall = computed ? reported / computed : null;
  }

  // ── M9 containment ───────────────────────────────────────────────────────────────────────
  // Not applicable to the legacy control cells. Today's BLOCKING_SCHEMA has no containerId field
  // at all — it cannot express "the driver is inside the car" in any form — so failing it for
  // the absence measures the schema's vocabulary, not the model's understanding, and would put
  // floor violations on a control whose whole job is to be a fair baseline. A capability the
  // control structurally lacks is scored N/A, exactly as M10's axis test already is.
  const m9 = { expected: 0, hit: 0, applicable: kind !== 'legacy' };
  for (const rule of (m9.applicable ? exp.containment ?? [] : [])) {
    for (const beatIndex of rule.beats) {
      m9.expected += 1;
      const beat = beats.find((b) => b.beatIndex === beatIndex);
      const s = beat?.subjects.find((x) => x.subject === rule.subject);
      if (s && s.containerId === rule.container) {
        m9.hit += 1;
      } else {
        note('containment-missed', 'floor',
          `${rule.subject} should be inside ${rule.container} in beat ${beatIndex + 1}; got containerId ${JSON.stringify(s?.containerId ?? null)}.`,
          { beat: beatIndex, subject: rule.subject });
      }
    }
  }
  m9.rate = m9.expected ? m9.hit / m9.expected : null;

  // ── M10 the 180-degree line ──────────────────────────────────────────────────────────────
  const m10 = { tested: Boolean(exp.axisTested) && kind !== 'legacy', axisErrors: 0, unpermittedCrosses: 0, pairs: [] };
  if (m10.tested) {
    const shots = beats.filter((b) => b.geometry?.camera && b.subjects.length >= 2);
    for (let i = 1; i < shots.length; i += 1) {
      const prev = shots[i - 1];
      const cur = shots[i];
      const shared = cur.subjects.map((s) => s.subject).filter((t) => prev.subjects.some((p) => p.subject === t));
      if (shared.length < 2) continue;
      const [tagA, tagB] = shared;
      const geo = (beat, tag) => beat.subjects.find((s) => s.subject === tag).geo;

      const sidePrev = cameraSideOfLine(prev.geometry.camera, geo(prev, tagA), geo(prev, tagB));
      const sideCur = cameraSideOfLine(cur.geometry.camera, geo(cur, tagA), geo(cur, tagB));

      const projPrev = projectAll(prev, aspect);
      const projCur = projectAll(cur, aspect);
      const orderPrev = Math.sign(projPrev.get(tagA).ndcX - projPrev.get(tagB).ndcX);
      const orderCur = Math.sign(projCur.get(tagA).ndcX - projCur.get(tagB).ndcX);

      const sideChanged = sidePrev !== 0 && sideCur !== 0 && sidePrev !== sideCur;
      const orderFlipped = orderPrev !== 0 && orderCur !== 0 && orderPrev !== orderCur;
      const permitted = (exp.permittedSideSwaps ?? []).includes(cur.beatIndex);

      // A subject who walks around the table swaps sides without the camera moving, so an
      // order flip is only impossible when NEITHER the camera crossed nor the subjects moved.
      const subjectsMoved =
        horizDist(geo(prev, tagA), geo(cur, tagA)) > 0.3 || horizDist(geo(prev, tagB), geo(cur, tagB)) > 0.3;

      m10.pairs.push({ beat: cur.beatIndex, tagA, tagB, sidePrev, sideCur, orderPrev, orderCur, permitted, subjectsMoved });

      if (orderFlipped && !sideChanged && !subjectsMoved) {
        m10.axisErrors += 1;
        note('axis-error', 'floor',
          `Beat ${cur.beatIndex + 1}: ${tagA} and ${tagB} swap sides of frame although the camera stayed on the same side of the line and neither subject moved. Physically impossible.`,
          { beat: cur.beatIndex });
      }
      if (sideChanged && !permitted) {
        m10.unpermittedCrosses += 1;
        note('unpermitted-line-cross', 'floor',
          `Beat ${cur.beatIndex + 1}: the camera crossed the line between ${tagA} and ${tagB}, which this beat does not license.`,
          { beat: cur.beatIndex });
      }
    }
  }

  // ── M11 transitions ──────────────────────────────────────────────────────────────────────
  const m11 = { expected: (exp.transitions ?? []).length, correct: 0 };
  for (const beatIndex of exp.transitions ?? []) {
    const beat = beats.find((b) => b.beatIndex === beatIndex);
    const ok = kind === 'legacy'
      ? true // production pre-filters transitions before the model ever sees them
      : beat?.kind === 'transition' && !beat.raw.camera && !(beat.raw.subjects ?? []).length;
    if (ok) m11.correct += 1;
    else {
      note('transition-not-honoured', 'soft',
        `Beat ${beatIndex + 1} is a [CUT TO BLACK] but came back as kind=${beat?.kind ?? 'missing'} with ${(beat?.raw.subjects ?? []).length} subjects.`,
        { beat: beatIndex });
    }
  }
  m11.rate = m11.expected ? m11.correct / m11.expected : null;

  // ── M12 inclusion discipline ─────────────────────────────────────────────────────────────
  const m12 = { earlyReveals: 0, omissions: 0, beats: 0 };
  for (const e of exp.perBeat ?? []) {
    const beat = beats.find((b) => b.beatIndex === e.beat);
    if (!beat) continue;
    m12.beats += 1;
    const present = new Set(beat.subjects.map((s) => s.subject));
    for (const tag of e.mustExclude ?? []) {
      if (present.has(tag)) {
        m12.earlyReveals += 1;
        note('early-reveal', 'soft',
          `${tag} appears in beat ${e.beat + 1}, which does not put it there. Beat text: "${specBeats[e.beat]}"`,
          { beat: e.beat, subject: tag });
      }
    }
    for (const tag of e.mustInclude ?? []) {
      if (!present.has(tag)) {
        m12.omissions += 1;
        note('omission', 'soft',
          `${tag} is named in beat ${e.beat + 1} but is absent from the blocking. Beat text: "${specBeats[e.beat]}"`,
          { beat: e.beat, subject: tag });
      }
    }
  }
  m12.earlyRevealRate = m12.beats ? m12.earlyReveals / m12.beats : null;
  m12.omissionRate = m12.beats ? m12.omissions / m12.beats : null;

  // ── M13 H3 compilability ─────────────────────────────────────────────────────────────────
  const m13 = { failures: 0, compiled: [] };
  if (kind !== 'legacy') {
    for (const beat of beats) {
      try {
        const scene = beat.kind === 'transition'
          ? { kind: 'transition', transitionText: beat.transitionText }
          : beat.geometry;
        const text = compileBeatToH3(scene, beat.beatIndex === 0 ? fixture.spec : {}, { aspect });
        const problems = [];
        if (!text || text.length < 20) problems.push('empty or trivially short');
        if (text.length > 7000) problems.push(`${text.length} chars exceeds H3's 7000 limit`);
        if (/0x[0-9a-fA-F]{40}/.test(text)) problems.push('contains a contract address');
        if (/eth-mainnet|polygon-mainnet|base-mainnet/.test(text)) problems.push('contains a cast key');
        if (/integrated_multimodal_description|focalStartMm|screenPosition|groundOffsetM/.test(text)) {
          problems.push('leaks schema scaffolding');
        }
        if (beat.kind !== 'transition') {
          for (const s of beat.subjects) {
            if (!text.includes(s.subject)) problems.push(`drops ${s.subject}`);
          }
        }
        if (problems.length) {
          m13.failures += 1;
          note('h3-compile-failure', 'soft', `Beat ${beat.beatIndex + 1}: ${problems.join('; ')}.`, { beat: beat.beatIndex });
        }
        m13.compiled.push({ beat: beat.beatIndex, text });
      } catch (error) {
        m13.failures += 1;
        note('h3-compile-throw', 'soft', `Beat ${beat.beatIndex + 1}: ${error.message}`, { beat: beat.beatIndex });
      }
    }
  }

  const floorViolations = violations.filter((v) => v.severity === 'floor');

  return {
    fixture: fixture.id,
    fixtureSha: fixture.sha,
    kind,
    metrics: { m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m17 },
    violations,
    floorCount: floorViolations.length,
    passesFloor: floorViolations.length === 0,
    derivedBands,
    prose: beats.map((b) => ({ beat: b.beatIndex, text: b.proseNote })),
    h3: m13.compiled,
  };
};

/** M14 — how much a cell's answers wobble between identical requests. Computed across repeats,
 * so it lives outside scoreFilm. A model that reasons about geometry gives similar geometry
 * three times; a model that pattern-matches gives three different films. */
export const stability = (runs) => {
  if (runs.length < 2) return { bandInstability: null, repeats: runs.length };
  const beatCount = Math.max(...runs.map((r) => r.derivedBands.length));
  const perBeat = [];
  for (let i = 0; i < beatCount; i += 1) {
    const bands = runs.map((r) => r.derivedBands[i]).filter(Boolean);
    if (bands.length < 2) continue;
    const counts = {};
    for (const b of bands) counts[b] = (counts[b] ?? 0) + 1;
    const modal = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const modalIndex = FRAMING_ORDER.indexOf(modal);
    perBeat.push(mean(bands.map((b) => Math.abs(FRAMING_ORDER.indexOf(b) - modalIndex))));
  }
  return { bandInstability: mean(perBeat), repeats: runs.length };
};
