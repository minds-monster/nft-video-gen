#!/usr/bin/env node
// H3 capability probes for the race-launch hero.
//
// The first race-launch attempt failed because H3 was asked to invent a composition from
// five references and instead rendered two of them as a static tableau
// (see scripts/hero-prompts.mjs). The fix is to lock composition with a `first_frame` and
// let the model only move the camera. That raises three questions the docs do not settle,
// and each one changes the production pipeline:
//
//   P1  Does H3 accept `first_frame` TOGETHER with `reference_image`?
//       minimax.mjs:h3Content asserts they are mutually exclusive, but that comment never
//       claims to have been verified against the live API (unlike the item-shape note
//       below it, which does). MiniMax's own guide lists both roles; aggregator docs say
//       1 first + 1 last + 9 refs. If they DO combine, wardrobe can be injected onto a
//       locked plate and we never need an external image model.
//
//   P2  With composition locked, how many refs does H3 actually hold — 1 or 3?
//       Decides whether garments get baked into keyframes or passed as references.
//
//   P3  Does FL2V (first_frame + last_frame) honour the last frame across a LARGE
//       composition change? Docs warn it works best when the two frames "differ in one
//       thing". If it holds, every shot pins both ends — no generation-of-a-generation
//       colour drift. If not, we fall back to frame-chaining.
//
// Deliberately 4s @ 768P: $0.32 a probe, ~$1 for the set. Cheap enough that measuring
// beats arguing.
//
//   node --env-file=.env scripts/probe-h3.mjs            # all three
//   node --env-file=.env scripts/probe-h3.mjs p1 p3      # a subset
//   node --env-file=.env scripts/probe-h3.mjs --dry-run  # print requests, spend nothing

import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { asDataUri, createH3Task, awaitVideo, priceUsd } from './minimax.mjs';

const run = promisify(execFile);
const OUT = 'assets/renders';
const IN = '/tmp/probe';

// Shared blocks, so the probes differ only in the variable under test. No brand names
// anywhere — that trips the content filter (error 1026); the references carry the marks.
const WORLD =
  'Night on a wet black asphalt starting grid, heavy rain falling through the beams of ' +
  'overhead floodlights and steam drifting low across the ground.';
const GRADE =
  'Photoreal cinematic render, anamorphic lens, shallow depth of field, high-contrast ' +
  'night grade, volumetric rain and light shafts, reflections in standing water. ' +
  'No text or signage anywhere.';
const COURTNEY =
  'a stylised bald young woman with green diamond-shaped paint around both eyes, dark ' +
  'plum lipstick and a studded black choker';

const PROBES = {
  // ------------------------------------------------------------------ P1
  p1: {
    question: 'Does H3 accept first_frame + 1 reference_image, and does the ref land?',
    firstFrame: `${IN}/ff-porsche.png`,
    referenceImages: [`${IN}/ref-courtney.png`],
    text: `${WORLD} Through the windscreen of the white sports car, ${COURTNEY} sits at the wheel with both hands on the rim. She turns her face to the lens and winks. The camera pushes in slowly toward the windscreen. ${GRADE}

Sound: rain on metal, an idling engine, a low synth pulse.`,
  },

  // ------------------------------------------------------------------ P2
  p2: {
    question: 'With composition locked, does H3 hold 3 refs — character + tiara + gown?',
    firstFrame: `${IN}/ff-porsche.png`,
    referenceImages: [`${IN}/ref-courtney.png`, `${IN}/tiara.png`, `${IN}/dress.png`],
    // The gown reference is photographed on a gold chrome mannequin, so the prompt has to
    // say explicitly that the garment is worn by the character — otherwise the chrome
    // skin is the most salient thing in that reference and it comes along for the ride.
    text: `${WORLD} Through the windscreen of the white sports car, ${COURTNEY} sits at the wheel. She wears a tall jewelled tiara set with deep red and turquoise-blue stones, and an off-the-shoulder silver metallic gown embroidered with colourful jewelled goblets. She has ordinary skin and is not a mannequin. She turns her face to the lens and winks. The camera pushes in slowly toward the windscreen. ${GRADE}

Sound: rain on metal, an idling engine, a low synth pulse.`,
  },

  // ------------------------------------------------------------------ P3
  p3: {
    question: 'Does FL2V land the last frame across a large composition change?',
    firstFrame: `${IN}/ff-porsche.png`,
    lastFrame: `${IN}/ff-mclaren.png`,
    text: `${WORLD} The camera trucks steadily to the right along the front row of the grid, leaving the white sports car behind and arriving on a mid-engined coupe wrapped in a fine black-and-white topographic line pattern with gold wheels. Both cars stand still with engines idling, rain beading on the bodywork. ${GRADE}

Sound: rain, idling engines, a distant crowd.`,
  },

  // ------------------------------------------------------------------ P4
  // P1/P2 came back 400: "reference mode cannot be mixed with first_frame/middle_frame/
  // last_frame; choose one (2013)". So the guard in minimax.mjs was right, and the two
  // modes are hard-separated. That makes reference mode's true capacity the question that
  // matters: the post-mortem measured 2-of-5 refs surviving, but never tried a request
  // with only 2. If exactly 2 hold reliably, keyframes can be assembled in stages on
  // MiniMax alone (dress the character first, stage her second). If not, keyframes need
  // an external multi-reference image model.
  p4: {
    question: 'Does reference mode hold exactly 2 refs — character + garment?',
    referenceImages: [`${IN}/ref-courtney.png`, `${IN}/dress.png`],
    text: `A stylised bald young woman with green diamond-shaped paint around both eyes, dark plum lipstick and a studded black choker stands in a dark studio, lit from the front. She wears an off-the-shoulder silver metallic gown embroidered with colourful jewelled goblets. She has ordinary skin and is not a mannequin. She turns slowly toward the lens. Glossy toy-like 3D render, saturated colour, soft studio key light, deep violet background falling off to black. No text or signage anywhere.

Sound: a low synth pad.`,
  },

  // ------------------------------------------------------------------ P5
  // The 2013 error named `middle_frame`, a role absent from the published docs. If it is
  // real, one generation can be pinned at three points instead of two — which is exactly
  // the fix for H3 ignoring multi-beat direction. A directed beat (turn, then wink) stops
  // being a request and becomes geometry.
  p5: {
    question: 'Is middle_frame real — can one shot be pinned at three points?',
    firstFrame: `${IN}/ff-porsche.png`,
    middleFrame: `${IN}/ff-mclaren-clean.png`,
    lastFrame: `${IN}/ff-porsche.png`,
    text: `${WORLD} The camera trucks smoothly to the right from the white sports car onto a mid-engined coupe wrapped in fine black-and-white topographic line pattern with gold wheels, then returns to the left. The cars stand still, rain beading on the bodywork. ${GRADE}

Sound: rain, idling engines.`,
  },

  // ------------------------------------------------------------------ P6
  // P4 proved reference mode holds exactly 2 refs. So build keyframes by ITERATED 2-REF
  // FUSION: each pass adds one licensed asset and its output frame becomes the next pass's
  // character ref. This pass adds the tiara to the already-gowned Courtney — never more
  // than two things for the model to reconcile at once.
  p6: {
    question: 'Iterated fusion: does a 2nd pass add the tiara without losing the gown?',
    referenceImages: [`${IN}/ref-courtney-dressed.png`, `${IN}/tiara.png`],
    text: `The bald young woman with green diamond-shaped paint around both eyes from the reference, wearing her off-the-shoulder silver metallic gown with gold trim, now also wears a tall jewelled tiara set with deep red and turquoise-blue stones and clear brilliants on her head. She faces the lens, still. Her gown, face paint and studded choker are unchanged. Glossy toy-like 3D render, soft studio key light, deep violet background falling off to black. No text or signage anywhere.

Sound: a low synth pad.`,
  },

  // ------------------------------------------------------------------ P7
  // The last real unknown, and the crux of the whole production. Reference mode INVENTS
  // composition — that is what wrecked the first attempt at five refs. But at two refs,
  // does it place a finished character correctly inside a car? The `showroom` probe is the
  // encouraging precedent: from one car ref it re-composed a whole gallery of them and
  // held the badges. If this works, no external image model is needed anywhere.
  p7: {
    question: 'Does 2-ref reference mode seat a finished character in the car?',
    referenceImages: [`${IN}/ref-courtney-dressed.png`, `${IN}/ff-porsche.png`],
    text: `${WORLD} Three-quarter view from the front left of the white rounded-silhouette sports car with four round LED headlamps from the reference, framed on its open driver's window. The bald young woman with green diamond-shaped paint around both eyes from the reference sits at the wheel in her off-the-shoulder silver metallic gown, one hand on the rim, turning her face to the lens. Rain beads on the paintwork and runs down the glass. ${GRADE}

Sound: rain on metal, an idling engine.`,
  },
};

const CONFIG = { model: 'MiniMax-H3', resolution: '768P', duration: 4, ratio: '16:9' };

/**
 * Build H3 `content` WITHOUT the mutual-exclusion guard in minimax.mjs — testing that
 * guard is the entire point of P1. Same verified item shape: type `image_url`, url nested
 * under `image_url.url`.
 */
const content = async ({ text, referenceImages = [], firstFrame, middleFrame, lastFrame }) => {
  const image = async (role, file) => ({
    type: 'image_url',
    role,
    image_url: { url: await asDataUri(file) },
  });
  const items = [{ type: 'text', text }];
  for (const file of referenceImages) items.push(await image('reference_image', file));
  if (firstFrame) items.push(await image('first_frame', firstFrame));
  if (middleFrame) items.push(await image('middle_frame', middleFrame));
  if (lastFrame) items.push(await image('last_frame', lastFrame));
  return items;
};

// 5x3 even sampling. The earlier version of this used a select filter whose interval grew
// with t, which clumped every sample into the opening second and made a working four-beat
// shot read as a static tableau. Even sampling or the sheet lies to you.
const contactSheet = (mp4, png) =>
  run('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', 'fps=2,scale=320:-1,tile=5x3', '-frames:v', '1', png]);

/**
 * Preflight every image locally. H3 enforces aspect in [0.4, 2.5] and a 256px minimum side,
 * but it only tells you AFTER the task has queued and failed — which costs a poll cycle and
 * kills the rest of the run. A tall figure crop trips this easily: a 352x1024 cut-out of a
 * standing character is 0.344 and gets rejected.
 */
const preflight = async (files) => {
  for (const file of files) {
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
    ]);
    const [w, h] = stdout.trim().split(',').map(Number);
    const aspect = w / h;
    if (aspect < 0.4 || aspect > 2.5) {
      throw new Error(
        `${file}: aspect ${aspect.toFixed(3)} (${w}x${h}) outside H3's [0.4, 2.5] — pad or widen the crop`,
      );
    }
    if (Math.min(w, h) < 256) throw new Error(`${file}: short side ${Math.min(w, h)}px < 256`);
  }
};

const probe = async (name) => {
  const spec = PROBES[name];
  const roles = [
    spec.firstFrame && 'first_frame',
    spec.middleFrame && 'middle_frame',
    spec.lastFrame && 'last_frame',
    spec.referenceImages?.length && `${spec.referenceImages.length}x reference_image`,
  ].filter(Boolean);

  console.log(`\n=== ${name.toUpperCase()} — ${spec.question}`);
  console.log(`    roles: ${roles.join(' + ')}`);

  await preflight([
    ...(spec.referenceImages ?? []),
    spec.firstFrame, spec.middleFrame, spec.lastFrame,
  ].filter(Boolean));

  const body = { ...CONFIG, content: await content(spec) };
  const started = Date.now();

  let taskId;
  try {
    taskId = await createH3Task(body);
  } catch (error) {
    // A rejection here IS the P1 answer, so record it rather than crashing the run.
    console.log(`    ✗ REJECTED: ${error.message}`);
    return { name, accepted: false, error: error.message };
  }
  console.log(`    ✓ accepted — task ${taskId} (roles combine: ${roles.length > 1})`);

  // A task that queues and then fails validation server-side must not take the rest of the
  // run down with it — each probe answers an independent question.
  let url;
  let usage;
  try {
    ({ url, usage } = await awaitVideo(taskId, {
      onTick: ({ tick, status }) => {
        if (tick % 3 === 0) process.stdout.write(`    ${status} ${tick * 10}s\r`);
      },
    }));
  } catch (error) {
    console.log(`    ✗ FAILED after queueing: ${error.message}`);
    return { name, accepted: true, rendered: false, error: error.message };
  }

  const mp4 = `${OUT}/probe-${name}.mp4`;
  const response = await fetch(url);
  await writeFile(mp4, Buffer.from(await response.arrayBuffer()));
  await contactSheet(mp4, `${OUT}/probe-${name}.grid.png`);

  const seconds = Math.round((Date.now() - started) / 1000);
  const meta = { name, question: spec.question, roles, ...body, content: undefined, taskId, sourceUrl: url, seconds, usage };
  await writeFile(`${OUT}/probe-${name}.json`, JSON.stringify(meta, null, 2));

  console.log(`    → ${mp4} in ${seconds}s ($${priceUsd(CONFIG)?.toFixed(2)})`);
  return { name, accepted: true, mp4, seconds };
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const names = args.filter((a) => !a.startsWith('--'));
const selected = names.length ? names : Object.keys(PROBES);

await mkdir(OUT, { recursive: true });

if (dryRun) {
  for (const name of selected) {
    const spec = PROBES[name];
    console.log(`\n=== ${name.toUpperCase()} — ${spec.question}`);
    console.log(`first_frame: ${spec.firstFrame ?? '—'}`);
    console.log(`last_frame:  ${spec.lastFrame ?? '—'}`);
    console.log(`refs:        ${(spec.referenceImages ?? []).join(', ') || '—'}`);
    console.log(`${JSON.stringify(CONFIG)}\n${spec.text}`);
  }
  console.log(`\n${selected.length} probes, $${(selected.length * priceUsd(CONFIG)).toFixed(2)} if run.`);
  process.exit(0);
}

// Sequential: MiniMax rate-limits concurrent tasks (error 1002) and each probe answers a
// question that can change the next one.
const results = [];
for (const name of selected) results.push(await probe(name));

console.log('\n──────── summary');
for (const r of results) {
  const verdict = !r.accepted
    ? `REJECTED — ${r.error}`
    : r.rendered === false
      ? `accepted but FAILED — ${r.error}`
      : `rendered in ${r.seconds}s`;
  console.log(`  ${r.name}: ${verdict}`);
}
const billed = results.filter((r) => r.rendered !== false && r.accepted).length;
console.log(`  spend: $${(billed * priceUsd(CONFIG)).toFixed(2)} (${billed} billed of ${results.length})`);
console.log('\nNow VIEW the contact sheets — the whole point is what actually landed:');
for (const r of results.filter((x) => x.accepted && x.rendered !== false)) {
  console.log(`  ${OUT}/probe-${r.name}.grid.png`);
}
