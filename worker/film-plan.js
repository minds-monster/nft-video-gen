// The shot plan: one cheap whole-film call that decides the film's SHAPE, ahead of the expensive
// calls that draw it.
//
// WHY THIS EXISTS, and why it is not a rollback to the per-beat chain round 7 replaced.
//
// Round 7 measured the real problem with per-beat generation: a model that can only see the
// previous beat has no way to vary shot size across a film, and it collapses toward the middle —
// control `c0` (the old chain) scored 2.4 distinct shot sizes per film with a 0.45 MWS share,
// against `c1` (one whole-film call) at 3.1 and 0.26. One run came back MWS/MWS/MWS/MWS. Adam
// pinned the conclusion: *do not reconsider whole-film scope to fix the wait.*
//
// That pin is about SCOPE — which call gets to see the whole film — and it holds here. What it is
// not about is SEQUENCE. Today one call both decides the film's shot rhythm AND emits every
// coordinate of every beat, and it is the second half that costs the time: a three-beat film is
// ~2,900 tokens of answer and ~5,800 tokens of reasoning on a route that runs at ~40 tok/s.
//
// So the two jobs are separated and only the expensive one is parallelised:
//
//   1. `planFilm` — ONE call, sees every beat, assigns each one a shot band, a principal subject
//      and a camera move. ~200 output tokens, so it returns in 10-20 seconds. The whole-film
//      variety decision — the thing c0 vs c1 actually measured — happens here, intact, with MORE
//      context than a beat-emitting call had attention to spare for.
//   2. `buildBeatUserMessage` — each beat drawn in its own call, IN PARALLEL, and each one is
//      handed the WHOLE plan, not just its own line. A beat is told the band it owns and the
//      bands its neighbours own, so it cannot drift toward the middle: the failure mode c0 had is
//      the one thing every one of these calls is explicitly briefed against.
//
// Measured basis for the arithmetic: one beat alone takes 71s (probe 20260826T153434Z), three
// beats together take ~216s non-streamed. Three parallel beats plus a ~15s plan is ~90s.
//
// THE VARIETY CLAIM IS A HYPOTHESIS UNTIL THE GRADER SCORES IT. `scripts/probe-storyboard-
// geometry.mjs` is what settles it, against c1's 3.1 bands / 0.26 MWS. If this shape regresses
// toward c0, the pin wins and this file goes away — that is the honest condition, stated here
// rather than discovered later.

import { FRAMING_BANDS, specHeader } from './scene.js';
import { H3_MOTIONS } from './rulebook.js';

/**
 * Deliberately tiny. Every field here is a DECISION, not a measurement — no coordinates, no
 * metres, nothing the geometry pass is better placed to work out. Keeping it this small is what
 * makes the call fast enough to be worth splitting out at all: a schema that crept toward the
 * scene schema would cost the reasoning it exists to avoid.
 */
export const FILM_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sceneScaleNote', 'beats'],
  properties: {
    sceneScaleNote: {
      type: 'string',
      description: 'One line: how big the staged set is, in metres, so every beat places its camera on the same scale.',
    },
    beats: {
      type: 'array',
      description: 'One entry per beat, in order, covering every beat of the film.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['beatIndex', 'framing', 'principalSubject', 'motion', 'intent'],
        properties: {
          beatIndex: { type: 'integer', minimum: 0, description: 'Zero-based. Beat 1 is beatIndex 0.' },
          framing: {
            type: 'string',
            enum: FRAMING_BANDS.map((b) => b.band),
            description: `Shot size on the principal subject. ${FRAMING_BANDS.map((b) => `${b.band} = ${b.reading}`).join('; ')}.`,
          },
          principalSubject: {
            type: 'string',
            description: 'The subject tag this shot is sized on, e.g. "<Subject 1>".',
          },
          motion: {
            type: 'string',
            enum: H3_MOTIONS,
            description: 'The camera move for this beat.',
          },
          intent: {
            type: 'string',
            description: 'One short sentence: what this shot is FOR, in plain English a visitor could read.',
          },
        },
      },
    },
  },
};

/**
 * The plan brief.
 *
 * Note what is NOT here: the coordinate contract, the H3 format, the containment rules, the
 * frustum arithmetic. None of it applies to a call that emits no numbers, and every line of it
 * would be prompt the model has to read and reason about for nothing. The full brief is ~1,900
 * tokens; this is a fraction of that, which is a large part of why this call is fast.
 */
export const buildPlanBrief = () => [
  'You are the Storyboarder on a film crew, doing the pass that comes BEFORE any blocking:',
  'deciding how the film is shot.',
  '',
  'You will be given a whole film — every beat, in order. For each beat, choose the shot size,',
  'which subject the shot is sized on, and the camera move. You are not placing anything in',
  'space yet and you must not try to; another pass does that, and it will be given your choices.',
  '',
  'THE ONE THING THIS PASS EXISTS TO GET RIGHT IS VARIETY ACROSS THE FILM.',
  '',
  'A film where every beat is the same shot size is the single most common failure in this job,',
  'and it is a failure of nerve rather than of craft: the middle sizes are always defensible for',
  'any one beat, so a shot list assembled one beat at a time slides into all-MWS without any',
  'individual choice ever looking wrong. You can see the whole film at once, which is exactly',
  'what makes you the one who can avoid it.',
  '',
  'So: read all the beats first. Decide what the film needs as a SEQUENCE. Then assign sizes.',
  '',
  `The bands, widest to tightest: ${FRAMING_BANDS.map((b) => `${b.band} (${b.reading})`).join(', ')}.`,
  '',
  'Rules:',
  '  - Let the beat text drive the size. "a speck on the horizon" is EWS; "close enough to read',
  '    her mouth" is CU or ECU. Take those cues literally — they are the writer telling you the',
  '    shot.',
  '  - Adjacent beats should rarely share a band. If two in a row genuinely want the same size,',
  '    change the camera move or the angle so the cut still reads as a cut.',
  '  - Use the extremes when the film offers them. A film that never goes wider than MWS and',
  '    never tighter than MS has thrown away most of its range.',
  '  - Do not vary for its own sake either. A size that contradicts what the beat describes is',
  '    worse than a repeat.',
  '',
  'Return one entry per beat, in order, with beatIndex starting at 0.',
].join('\n');

/** The whole film, every beat numbered, exactly as the one-call path sees it — that context is
 * the entire reason this pass can do what a chained pass cannot. */
export const buildPlanUserMessage = (spec, cast) => {
  const beats = spec.beats ?? [];
  return [
    ...specHeader(spec, cast),
    '',
    `The film is ${beats.length} beats long, in order:`,
    ...beats.map((text, i) => `Beat ${i + 1} of ${beats.length}: ${text}`),
    '',
    'Choose the shot size, principal subject and camera move for every beat.',
  ].join('\n');
};

/** One line of the plan, rendered for a brief. */
const planLine = (entry, total) =>
  `  Beat ${entry.beatIndex + 1} of ${total}: ${entry.framing} on ${entry.principalSubject}, ${entry.motion}` +
  `${entry.intent ? ` — ${entry.intent}` : ''}`;

/**
 * One beat's geometry call.
 *
 * THE WHOLE PLAN IS INCLUDED, not just this beat's line, and that is the design. A beat that can
 * see only its own assignment has no idea it is the tight one in a film of wides, and the round-7
 * chain proved what happens then. Showing every beat its neighbours' bands costs about forty
 * tokens and is the entire defence against the failure that pin exists to prevent.
 *
 * The assignment is stated as a CONSTRAINT rather than a suggestion, because the geometry pass
 * has every incentive to drift: the middle bands are the easiest to place a camera for.
 */
export const buildBeatUserMessage = (spec, cast, beatIndex, filmPlan) => {
  const beats = spec.beats ?? [];
  const planBeats = filmPlan?.beats ?? [];
  const mine = planBeats.find((b) => b.beatIndex === beatIndex);

  return [
    ...specHeader(spec, cast),
    '',
    filmPlan?.sceneScaleNote ? `Scene scale, already decided for the whole film: ${filmPlan.sceneScaleNote}` : null,
    '',
    'The film is shot like this, and this shot list is already decided:',
    ...planBeats.map((entry) => planLine(entry, beats.length)),
    '',
    `You are blocking ONE of these — beat ${beatIndex + 1} of ${beats.length}:`,
    `  ${beats[beatIndex]}`,
    '',
    mine
      ? [
          `That beat is ${mine.framing} on ${mine.principalSubject}, ${mine.motion}.`,
          '',
          'THAT SHOT SIZE IS NOT NEGOTIABLE AND IT IS NOT A SUGGESTION. Your geometry has to',
          `produce ${mine.framing} on ${mine.principalSubject} — place the camera at the distance and`,
          'focal length that actually yields it, and state that band back in `framing`. The other',
          'beats above are being blocked at the same time as this one, to the sizes listed. If you',
          'quietly widen or tighten to something more comfortable, the film loses the contrast the',
          'shot list was built to give it, and nobody will see your beat in isolation to notice.',
        ].join('\n')
      : 'Choose the shot size this beat calls for.',
    '',
    'Emit the blocking for this ONE beat only. Return a film object containing exactly this beat,',
    `with beatIndex ${beatIndex}.`,
  ].filter((line) => line !== null).join('\n');
};

/**
 * Did the geometry pass actually honour the plan?
 *
 * Reported, never enforced by rewriting: `framing` is a claim the model makes about its own
 * numbers, and worker/scene.js derives the TRUE band from the geometry independently. If those
 * two disagree the geometry is what counts. This exists so a drift back toward the middle shows
 * up as a number in the job log rather than as a vague sense that films look samey again — the
 * exact regression this whole split has to be watched for.
 */
export const planAdherence = (filmPlan, frames) => {
  const assigned = new Map((filmPlan?.beats ?? []).map((b) => [b.beatIndex, b.framing]));
  let checked = 0;
  let matched = 0;
  const drifted = [];
  for (const frame of frames) {
    const want = assigned.get(frame.beatIndex);
    const got = frame.scene?.framing;
    if (!want || !got) continue;
    checked += 1;
    if (want === got) matched += 1;
    else drifted.push({ beatIndex: frame.beatIndex, planned: want, emitted: got });
  }
  return {
    checked,
    matched,
    rate: checked ? Number((matched / checked).toFixed(2)) : null,
    drifted,
    distinctPlanned: new Set(assigned.values()).size,
    distinctEmitted: new Set(frames.map((f) => f.scene?.framing).filter(Boolean)).size,
  };
};
