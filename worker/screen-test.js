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

/** Shared by every test, so a difference between two tests is the thing under test and nothing
 * else — the same reasoning scripts/launch-prompts.mjs gives for its own invariant blocks. */
const GRADE =
  'Photoreal cinematic render, soft even key light, shallow depth of field. ' +
  'No captions, subtitles, watermarks or added signage.';

const GUARD =
  'Every character has ordinary skin and is a living figure, not a mannequin and not a chrome statue.';

/** A plain space with nothing in it to compete for attention. */
const VOID = 'A dark seamless studio, lit from the front, background falling off to black.';

const describe = (entry) => entry?.dossier?.subject ?? 'the subject from the reference';

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

  const common = { question: risk.test.question, riskId: risk.id, refKeys: risk.test.refKeys ?? [] };

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
