// A Screen Test: the cheapest render that can answer one question.
//
// WHAT A SCREEN TEST IS, and why it is not just a small version of the film. On a real set a
// screen test is a trial shoot that exists to find out whether something works before anyone
// commits to it — not a preview. That distinction is the whole design here, and it comes
// straight out of how the hero was actually made (scripts/probe-h3.mjs):
//
//   "Deliberately 4s @ 768P: $0.32 a probe, ~$1 for the set. Cheap enough that measuring beats
//    arguing."
//
// and, more importantly:
//
//   "The discriminator is ORDER, not fidelity. Both these references are known-good … so 'did
//    they appear' tells us nothing new."
//
// A test that cannot come back with a surprising answer is money spent on reassurance. So every
// script below STRIPS THE FILM AWAY and stages only the thing under test: one subject, a plain
// space, one move. If the ape's face is going to be wrong, it will be wrong here — and it will
// be obvious, because there is nothing else in frame to look at.
//
// The invariants that must survive stripping are the ones that would otherwise cause a FALSE
// negative: the anti-mannequin guard (rule 7) and the ban on added type (rule 8). A test that
// fails because we forgot the guard has taught us nothing about the film.

import { h3ScriptFrom } from '../src/lib/h3Script.js';
import { SCREEN_TEST, MOTION_TEST } from './director-risks.js';
import { priceUsd } from './minimax.js';

/** Shared by every test, so a difference between two tests is the thing under test and nothing
 * else — the same reasoning scripts/launch-prompts.mjs gives for its own invariant blocks. */
const GRADE =
  'Photoreal cinematic render, soft even key light, shallow depth of field. ' +
  'No captions, subtitles, watermarks or added signage.';

const GUARD =
  'Every character has ordinary skin and is a living figure, not a mannequin and not a chrome statue.';

/** A plain space with nothing in it to compete for attention. */
const VOID = 'A dark seamless studio, lit from the front, background falling off to black.';

/**
 * The line a rehearsal adds, whatever the beat. Rule 12's finding is that a transformation gets
 * cheated with a dissolve, and a rehearsal that quietly allowed the cheat would come back "held"
 * and teach us the wrong thing — the same false-negative logic as the guard above.
 */
const NO_OVERLAY =
  'This is one single continuous unbroken shot, filmed in one take. Nothing fades in or out, ' +
  'nothing dissolves, nothing is superimposed or overlaid, and no second copy of any subject ' +
  'appears over the first. Every change happens to the physical thing on screen, in the scene.';

const describe = (entry) => entry?.dossier?.subject ?? 'the subject from the reference';

/** `demand:<slug>` — a test the Director asked for rather than one the register measured. */
export const DEMAND_PREFIX = 'demand:';
export const isDemandId = (riskId) => typeof riskId === 'string' && riskId.startsWith(DEMAND_PREFIX);

/**
 * A demand in the shape the panel and the test endpoint already understand.
 *
 * A demand is the Director's judgement — "will the letters actually become a brain?" — rather
 * than a measured finding, and the shape says so: `source: 'director'`, `measured: null`, and
 * `judgement` where a register entry has the failed render it cites. What it shares with the
 * register is the part that spends: a question, a price computed from the parameters rather than
 * quoted by the model, and a test the same machinery can shoot.
 */
export const demandAsRisk = (demand) => {
  if (!demand?.id || !demand.question) return null;
  const params = demand.params ?? MOTION_TEST;
  return {
    id: `${DEMAND_PREFIX}${demand.id}`,
    source: 'director',
    rule: null,
    severity: 'hazard',
    what: demand.question,
    evidence: { beats: demand.beats ?? [], onHeld: demand.onHeld ?? null, onFailed: demand.onFailed ?? null },
    measured: null,
    judgement: demand.why ?? '',
    fix: 'test',
    estUsd: priceUsd(params) ?? 0,
    elevatedBy: null,
    test: {
      question: demand.question,
      params,
      refKeys: demand.refKeys ?? [],
      focus: 'rehearsal',
      direction: demand.direction ?? null,
      answers: demand.answers ?? null,
      beats: demand.beats ?? [],
      onHeld: demand.onHeld ?? null,
      onFailed: demand.onFailed ?? null,
    },
  };
};

const markers = (entry) => {
  const list = entry?.dossier?.identityMarkers ?? [];
  return list.length ? ` It must stay recognisable by: ${list.join('; ')}.` : '';
};

/**
 * Build the test for one risk.
 *
 * Returns null when the risk is not settled by rendering — a brand name is fixed by rewriting,
 * and paying to watch it be rejected would be absurd.
 */
export function buildScreenTest(risk, spec, cast = []) {
  if (!risk?.test) return null;
  const byKey = new Map(cast.map((entry) => [entry?.key, entry]));
  const entry = byKey.get(risk.test.refKeys?.[0]);

  // `answers` are the verdict buttons in this test's own words — { held, failed, unclear } — and
  // travel with the take so the visitor is never asked "did it hold?" about an either/or.
  const common = {
    question: risk.test.question,
    riskId: risk.id,
    refKeys: risk.test.refKeys ?? [],
    answers: risk.test.answers ?? null,
  };

  if (risk.test.focus === 'identity') {
    // One subject, one slow move, nothing else. Probe P8's finding is that wardrobe transfers and
    // FACES do not, so the camera is put where a face would have to hold up.
    return {
      ...common,
      params: SCREEN_TEST,
      script: h3ScriptFrom({
        staging: `<Subject 1> is ${describe(entry)} in <Picture 1>.`,
        description:
          `${GRADE} ${VOID} A medium close-up frames <Subject 1> alone, facing the lens. ` +
          `Beat 1: <Subject 1> stands still and turns slowly toward the lens, lifting its chin. ` +
          `The camera pushes in with small amplitude at slow speed.${markers(entry)} ${GUARD}`,
        soundscape: 'A quiet room tone.',
        music: 'N/A',
      }),
    };
  }

  if (risk.test.focus === 'dimensionality') {
    // Rule 10. Flat art rendered as-is comes out a sticker, so the question is whether it can be
    // made a thing in the world — and the prompt has to ask for that explicitly, as the hero's
    // crowd did.
    return {
      ...common,
      params: SCREEN_TEST,
      script: h3ScriptFrom({
        staging: `<Subject 1> is ${describe(entry)} in <Picture 1>.`,
        description:
          `${GRADE} ${VOID} <Subject 1> is a solid physical object standing in the room, with real ` +
          `thickness and its own shadow on the floor — never a flat printed image, sticker or decal. ` +
          `Beat 1: the camera arcs slowly around <Subject 1> at medium amplitude, revealing its side ` +
          `and depth.${markers(entry)} ${GUARD}`,
        soundscape: 'A quiet room tone.',
        music: 'N/A',
      }),
    };
  }

  if (risk.test.focus === 'rehearsal') {
    // THE ONE TEST THAT KEEPS THE FILM. An identity test strips everything away because the
    // thing under test is a face; a rehearsal keeps the world, the staging and the references
    // because the thing under test is whether the model can DO what the beat asks, in the scene
    // it asks for it in. That is the shape the hero's own probes had — P3 asked whether a large
    // composition change would land, in the actual composition — and the shape the Hollywood
    // film never got.
    //
    // The Director's `direction` (a demand) replaces the beat text when present: it is the beat
    // restated as a physical constraint, which is what a rehearsal exists to check. Otherwise
    // the named beats are rendered as written. Beat indices are 1-based.
    const named = (risk.test.beats ?? [])
      .map((n) => spec?.beats?.[n - 1])
      .filter(Boolean);
    const beats = risk.test.direction?.trim()
      ? [risk.test.direction.trim()]
      : named.length
        ? named
        : (spec?.beats ?? []).slice(0, 3);
    return {
      ...common,
      params: risk.test.params ?? MOTION_TEST,
      script: h3ScriptFrom({
        staging: spec?.staging ?? '',
        description:
          `${GRADE} ${spec?.world ?? VOID} ${spec?.guard?.trim() || GUARD} ${spec?.camera ?? ''} ` +
          `${NO_OVERLAY} ` +
          beats.map((beat, index) => `Beat ${index + 1}: ${beat}`).join(' '),
        soundscape: spec?.sound ?? 'Room tone.',
        music: 'N/A',
      }),
    };
  }

  if (risk.test.focus === 'continuity') {
    // The one test that must NOT strip the film, because the thing under test is whether the film
    // holds together. Six seconds and the first beats only — enough for a cut to happen if it is
    // going to, which four seconds is not.
    const beats = (spec?.beats ?? []).slice(0, 3);
    return {
      ...common,
      params: MOTION_TEST,
      script: h3ScriptFrom({
        staging: spec?.staging ?? '',
        description:
          `${GRADE} ${spec?.world ?? VOID} ` +
          'This is one single continuous unbroken shot, filmed in one take. There are no cuts, no ' +
          'edits, no jump cuts and no scene changes at any point. The camera never stops moving and ' +
          `never teleports. ${spec?.camera ?? ''} ` +
          beats.map((beat, index) => `Beat ${index + 1}: ${beat}`).join(' ') +
          ` ${GUARD}`,
        soundscape: spec?.sound ?? 'Room tone.',
        music: 'N/A',
      }),
    };
  }

  return null;
}

/**
 * What the visitor is asked after watching it.
 *
 * A verdict is a plain yes/no on the test's OWN question, not a rating. "Did the face survive?"
 * has an answer somebody can give in a second; "how good was this?" does not, and a scale invites
 * a shrug where the whole point is a decision.
 */
export const VERDICTS = [
  { id: 'held', label: 'It held', tone: 'good' },
  { id: 'failed', label: 'It did not', tone: 'bad' },
  { id: 'unclear', label: 'Cannot tell', tone: 'neutral' },
];

/** The label for one verdict on one take: the test's own words when it has them, else the generic. */
export const verdictLabel = (take, answer) =>
  take?.answers?.[answer] ?? VERDICTS.find((entry) => entry.id === answer)?.label ?? answer;
