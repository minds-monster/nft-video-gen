#!/usr/bin/env node
// Can a frontier model hold a world?
//
// Round 7 wants an editable 3D previz: drag a character, move a camera, add a shot. All of that
// is mechanical ONCE the model can populate continuous coordinates that mean what they say —
// and worthless if it can't. This probe answers that one question before any of it gets built,
// in the house style of scripts/probe-h3.mjs: numbered hypotheses, a dry run that spends
// nothing, real cost accounting, and artifacts you can go and look at afterwards.
//
//   P1  Coordinates at all — physically valid scenes: nothing underground, nothing inside
//       anything else, no subject behind its own lens, no absurd scale.
//   P2  Coordinate comprehension (THE CRUX) — the model's own framing/screenPosition labels
//       agree with what its own numbers project to. A model that emits coordinates it does not
//       understand disagrees with itself, and then the numbers are decoration.
//   P3  Scope, not schema, is the every-beat-is-MWS bug — variety is higher when the model sees
//       all beats at once. Controls c0/c1 make this separable from the representation.
//   P4  Continuity is free in world space — positions persist unless the beat text moves them.
//   P5  Containment is expressible — a driver inside a car lands inside the car's volume.
//   P6  The 180-degree line — computable from geometry, and pre-registered per fixture.
//   P7  Transitions survive — [CUT TO BLACK] comes back geometry-free.
//   P8  Reasoning effort buys geometry — /v1/responses beats a forced tool call at effort none.
//   P9  The scene compiles to H3 mechanically — the premise of the whole round-4 pivot.
//   P10 Prose fidelity — the one judged metric, and deliberately not part of the pass gate.
//
// ── STAGE 0 FINDINGS (measured 2026-08-24, before stage 1 spent anything) ───────────────────
//   1. Strict json_schema ACCEPTS numeric minimum/maximum keywords on this account. The schema
//      therefore goes through unstripped and the API enforces the ranges.
//   2. `temperature` is REJECTED outright alongside reasoning: "Unsupported parameter:
//      'temperature' is not supported with this model." A third GPT-5.6 quirk to sit beside the
//      two already documented in worker/openai.js, and the reason no responses cell sets one.
//   3. sol @ high effort: ~$0.54 and ~122s for a five-beat film, 5178 reasoning tokens of it
//      invisible. terra @ low: ~$0.04, ~30s. Today's production request: $0.0068 for one beat.
//
//   node --env-file-if-exists=.env scripts/probe-storyboard-geometry.mjs --dry-run
//   node --env-file-if-exists=.env scripts/probe-storyboard-geometry.mjs --stage 0
//   node --env-file-if-exists=.env scripts/probe-storyboard-geometry.mjs --stage 1
//   node --env-file-if-exists=.env scripts/probe-storyboard-geometry.mjs scene-film --fixtures scale-extremes
//   node --env-file-if-exists=.env scripts/probe-storyboard-geometry.mjs --replay <runId>   # re-score, $0
//   node --env-file-if-exists=.env scripts/probe-storyboard-geometry.mjs --judge <runId>
//
// Bare argv words select cells; --flags configure. --replay exists because the metric
// definitions WILL be argued about once the first numbers land, and re-scoring saved responses
// has to cost nothing.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { H3_FORMAT } from '../worker/rulebook.js';
import { SCENE_SCHEMA, toStrictSchema, buildBrief, buildFilmUserMessage, buildChainedUserMessage, COORDINATE_CONTRACT_V2 } from './lib/scene-brief.mjs';
import { blockingSchema, blockingBrief, legacyFilmSchema, LEGACY_PARAMS, buildLegacyBeatMessage, buildLegacyFilmMessage } from './lib/legacy-blocking.mjs';
import { FIXTURES, fixtureById, aspectOf } from './lib/storyboard-fixtures.mjs';
import { chatCompletionsCall, responsesCall, costUsd, MODELS, TOKEN_PRICES } from './lib/openai-probe.mjs';
import { nvidiaToolCall, nvidiaStreamCall, NVIDIA_MODELS } from './lib/nvidia-probe.mjs';
// The PRODUCTION transport and the PRODUCTION split, imported rather than reimplemented.
// Round 11 found the timing probe scoring a code path production does not take; the fix there
// was to call the real thing, and the same applies here. These cells score exactly what a
// visitor gets, from the origin a visitor is served by.
import { filmCall } from '../worker/openrouter.js';
import {
  FILM_PLAN_SCHEMA,
  buildPlanBrief,
  buildPlanUserMessage,
  buildBeatUserMessage,
} from '../worker/film-plan.js';
import { scoreFilm, stability } from './lib/score.mjs';
import { selfTest } from './lib/scene-geometry.mjs';
import { renderScorecard, renderScenesHtml } from './lib/report.mjs';

const OUT_ROOT = 'assets/probes/storyboard-geometry';

/**
 * OpenRouter, which is where production actually serves the free tier from.
 *
 * THE EXISTING FREE CELLS POINT AT NVIDIA'S OWN HOSTING, and that is the confound that produced
 * round 7's "Super fails the absolute floor 3/3" verdict. Round 11 measured Super on OpenRouter
 * at 93s against Ultra's 354s with an identical shot plan and an identical violation count — so
 * that verdict was about the ORIGIN, not the weights, exactly as the round-7 rule warns:
 * report "model X FROM ORIGIN Y is good enough", never "model X is good enough".
 *
 * The `:free` suffix is a distinct catalogue entry from the paid one, not a modifier.
 */
const OR_MODELS = {
  ultra: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  super: 'nvidia/nemotron-3-super-120b-a12b:free',
};

const orEnv = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
};
const TRANSITION_PREFIX = /^\s*\[(CUT TO BLACK|TRANSITION|FADE)\]\s*/i;

// ─────────────────────────────────────────────────────────────────────── argv

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const has = (name) => argv.includes(`--${name}`);
const bareWords = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && flag(argv[i - 1].slice(2)) === a));

const DRY_RUN = has('dry-run');
const STAGE = flag('stage', null);
const REPEATS = Number(flag('repeats', 3));
const MAX_SPEND = Number(flag('max-spend', 250));
const REPLAY = flag('replay', null);
const JUDGE_RUN = flag('judge', null);
const CAPTURE = has('capture');

// ─────────────────────────────────────────────────────────────────────── cells

const brief = buildBrief(H3_FORMAT);
const briefV2 = buildBrief(H3_FORMAT, COORDINATE_CONTRACT_V2);
const briefFor = (cell) => (cell.contract === 'v2' ? briefV2 : brief);

/**
 * A cell is one complete way of asking. Only the fields that DIFFER between cells live here —
 * the brief is shared by construction, asserted below, so the scope comparison measures scope
 * rather than two different sets of instructions.
 */
const CELLS = {
  'scene-film': {
    label: 'world-space scene graph, whole film in one call, sol @ high reasoning',
    kind: 'scene', scope: 'film', transport: 'responses', model: MODELS.sol, effort: 'high',
  },
  'scene-chain': {
    label: "world-space scene graph, one beat at a time (today's context discipline), sol @ high",
    kind: 'scene', scope: 'chain', transport: 'responses', model: MODELS.sol, effort: 'high',
  },
  c0: {
    label: "CONTROL: today's exact production request, verbatim",
    kind: 'legacy', scope: 'chain', transport: 'chat', model: LEGACY_PARAMS.model,
    temperature: LEGACY_PARAMS.temperature, maxCompletionTokens: LEGACY_PARAMS.maxCompletionTokens,
  },
  c1: {
    label: "CONTROL: today's schema, whole film in one call (the scope ablation)",
    kind: 'legacy', scope: 'film', transport: 'chat', model: LEGACY_PARAMS.model,
    temperature: LEGACY_PARAMS.temperature, maxCompletionTokens: 8000,
  },
  'scene-film-v2': {
    label: 'world-space, whole film, CONTRACT V2 (camera looks -Z so larger x is screen-right)',
    kind: 'scene', scope: 'film', transport: 'responses', model: MODELS.sol, effort: 'high',
    contract: 'v2',
  },
  // ── The free tier. Same contract, same fixtures, same grader — only the model changes, which
  // is what makes these directly comparable to the stored scene-film-v2 results without
  // re-running the paid model. Cost is zero; wall-clock and the shared ~40 RPM limit are what
  // this tier actually spends.
  'ultra-free': {
    label: 'FREE: nemotron-3-ultra-550b-a55b, whole film, contract V2, forced tool call',
    kind: 'scene', scope: 'film', transport: 'nvidia', model: NVIDIA_MODELS.ultra,
    contract: 'v2', enableThinking: true, maxTokens: 32768, free: true, retries: 1,
  },
  // MEASURED AND REJECTED, 2026-08-24. The streamed variant survives the ~300s gateway timeout
  // that kills a six-beat forced tool call, and one hand-run sample looked excellent (M3 0.92).
  // Across a real run it was much worse, and the reason is structural: streaming on this
  // endpoint REQUIRES dropping the forced tool call, and the forced tool call is what was
  // enforcing the schema. Four films in:
  //     captured  r0  TypeError: terminated          (the stream died; no retry existed)
  //     captured  r1  floor 5, M3 0.50, 742s
  //     captured  r2  floor 0, M3 0.63, 469s
  //   grid-launch r0  SyntaxError: malformed JSON at position 7377
  //   grid-launch r1  floor 3, M3 0.50, 1038s
  // Against the same model WITH a forced tool call: floor 0, M3 1.00, M4 1.00, 250s.
  // Buying length by giving up structure costs schema adherence and quality together, and one
  // good sample was not evidence. Kept runnable so the finding stays reproducible.
  'ultra-free-streamed': {
    label: 'FREE, REJECTED: streamed (survives the 504, loses the schema)',
    kind: 'scene', scope: 'film', transport: 'nvidia-stream', model: NVIDIA_MODELS.ultra,
    contract: 'v2', enableThinking: true, maxTokens: 32768, free: true,
  },
  'super-free': {
    label: 'FREE: nemotron-3-super-120b-a12b (proven on this key as the Screenwriter)',
    kind: 'scene', scope: 'film', transport: 'nvidia', model: NVIDIA_MODELS.super,
    contract: 'v2', enableThinking: true, maxTokens: 32768, free: true,
  },
  // ── Round 11. All three on OPENROUTER, which is the origin production serves from — see
  // OR_MODELS. `ultra-or-film` is the baseline the other two are read against, and it is the
  // same shape as round 7's c1 (whole film, one call), so its numbers are directly comparable
  // to c1's 3.1 distinct bands / 0.26 MWS share.
  'ultra-or-film': {
    label: 'R11 baseline: Ultra 550B on OpenRouter, whole film in one call',
    kind: 'scene', scope: 'film', transport: 'openrouter', model: OR_MODELS.ultra,
    contract: 'v2', maxTokens: 32768, free: true, retries: 1,
  },
  'super-or-film': {
    label: 'R11: Super 120B on OpenRouter, whole film in one call',
    kind: 'scene', scope: 'film', transport: 'openrouter', model: OR_MODELS.super,
    contract: 'v2', maxTokens: 32768, free: true, retries: 1,
  },
  // The shape that actually ships. Deliberately NOT beat-trimmed: the split does one call per
  // beat, so it is not bound by the provider-side time limit that makes six beats impossible in
  // a single call (round 7: `finish_reason: error` after 555s). Whether that holds across the
  // six-beat grid-launch fixture is one of the things this run is for.
  'split-or': {
    label: 'R11: SPLIT — shot plan, then one call per beat, Ultra on OpenRouter',
    kind: 'scene', scope: 'split', transport: 'openrouter', model: OR_MODELS.ultra,
    contract: 'v2', maxTokens: 32768, free: true, retries: 1,
  },
  'split-or-super': {
    label: 'R11: SPLIT on Super 120B — the two round-11 wins together',
    kind: 'scene', scope: 'split', transport: 'openrouter', model: OR_MODELS.super,
    contract: 'v2', maxTokens: 32768, free: true, retries: 1,
  },
  // ── Temporary stage for the storyboarder slowness investigation. Free tier only, small matrix.
  'f2-ultra-3-on': {
    label: 'F2: Ultra 550B, 3 beats, thinking ON (production config)',
    kind: 'scene', scope: 'film', transport: 'nvidia', model: NVIDIA_MODELS.ultra,
    contract: 'v2', enableThinking: true, maxTokens: 32768, free: true, retries: 1,
    trimBeats: 3,
  },
  'f2-ultra-3-off': {
    label: 'F2: Ultra 550B, 3 beats, thinking OFF',
    kind: 'scene', scope: 'film', transport: 'nvidia', model: NVIDIA_MODELS.ultra,
    contract: 'v2', enableThinking: false, maxTokens: 32768, free: true, retries: 1,
    trimBeats: 3,
  },
  'f2-ultra-2-on': {
    label: 'F2: Ultra 550B, 2 beats, thinking ON',
    kind: 'scene', scope: 'film', transport: 'nvidia', model: NVIDIA_MODELS.ultra,
    contract: 'v2', enableThinking: true, maxTokens: 32768, free: true, retries: 1,
    trimBeats: 2,
  },
  'f2-super-3-on': {
    label: 'F2: Super 120B, 3 beats, thinking ON',
    kind: 'scene', scope: 'film', transport: 'nvidia', model: NVIDIA_MODELS.super,
    contract: 'v2', enableThinking: true, maxTokens: 32768, free: true, retries: 1,
    trimBeats: 3,
  },
  // Stage 2's ladder. Defined now so --dry-run can price them, run only when asked.
  'scene-film-terra-high': { label: 'ladder: terra @ high', kind: 'scene', scope: 'film', transport: 'responses', model: MODELS.terra, effort: 'high' },
  'scene-film-terra-med': { label: 'ladder: terra @ medium', kind: 'scene', scope: 'film', transport: 'responses', model: MODELS.terra, effort: 'medium' },
  'scene-film-sol-med': { label: 'ladder: sol @ medium', kind: 'scene', scope: 'film', transport: 'responses', model: MODELS.sol, effort: 'medium' },
  'scene-film-terra-cc': { label: 'ladder: terra, forced tool call, effort none', kind: 'scene', scope: 'film', transport: 'chat', model: MODELS.terra, maxCompletionTokens: 12000 },
  'scene-film-luna-high': { label: 'ladder: luna @ high', kind: 'scene', scope: 'film', transport: 'responses', model: MODELS.luna, effort: 'high' },
};

const STAGE_CELLS = {
  1: ['scene-film', 'scene-chain', 'c0', 'c1'],
  2: ['scene-film-v2'],
  f1: ['ultra-free'],
  f2: ['f2-ultra-3-on', 'f2-ultra-3-off', 'f2-ultra-2-on', 'f2-super-3-on'],
};

// ─────────────────────────────────────────────────────────────────────── one film

const isTransition = (text) => TRANSITION_PREFIX.test(text);

const sceneSchemaFor = (strictRanges) => (strictRanges ? SCENE_SCHEMA : toStrictSchema(SCENE_SCHEMA));

/** One model call, whatever the transport. Returns the parsed payload plus everything the
 * ledger and the raw archive need. */
const callModel = async (cell, { system, user, schema, toolName, strictRanges }) => {
  if (cell.transport === 'nvidia-stream') {
    // The only configuration that gets a six-beat film at full reasoning depth off this
    // endpoint — see nvidiaStreamCall's header for the three measurements that force it.
    return nvidiaStreamCall({
      model: cell.model,
      system, user,
      schema: toStrictSchema(schema),
      enableThinking: cell.enableThinking ?? true,
      maxTokens: cell.maxTokens ?? 32768,
      temperature: cell.temperature ?? 0.3,
    });
  }
  if (cell.transport === 'nvidia') {
    return nvidiaToolCall({
      model: cell.model,
      system, user,
      // NVIDIA has no strict-schema mode; the forced tool call carries the structure, and the
      // range keywords are stripped because nothing enforces them here and an unrecognised
      // keyword is a needless 400 risk on an endpoint that has already rejected `guided_json`.
      schema: toStrictSchema(schema),
      toolName: toolName ?? 'emit_film',
      enableThinking: cell.enableThinking ?? true,
      responseFormat: cell.responseFormat ?? false,
      maxTokens: cell.maxTokens ?? 32768,
      temperature: cell.temperature ?? 0.3,
      retries: cell.retries ?? 5,
    });
  }
  if (cell.transport === 'openrouter') {
    const result = await filmCall(orEnv, {
      model: cell.model,
      system, user,
      schema: toStrictSchema(schema),
      toolName: toolName ?? 'emit_film',
      maxTokens: cell.maxTokens ?? 32768,
      temperature: cell.temperature ?? 0.3,
      retries: cell.retries ?? 1,
      enableThinking: cell.enableThinking ?? true,
      reasoning: cell.reasoning ?? null,
    });
    return { ...result, attempts: 1, usedToolCall: true, request: { model: cell.model }, raw: null };
  }
  if (cell.transport === 'responses') {
    // Stage 0 finding, measured 2026-08-24: strict json_schema on this account ACCEPTS numeric
    // minimum/maximum keywords, so the full schema goes through unstripped and the API enforces
    // the ranges for us. toStrictSchema stays as the fallback the stage-0 probe still exercises.
    return responsesCall({
      model: cell.model,
      system, user,
      schema,
      effort: cell.effort ?? 'high',
      maxOutputTokens: cell.maxOutputTokens ?? 24000,
      strict: true,
    });
  }
  return chatCompletionsCall({
    model: cell.model,
    system, user, schema, toolName,
    temperature: cell.temperature ?? 0.3,
    maxCompletionTokens: cell.maxCompletionTokens ?? 12000,
  });
};

/**
 * Produce one film for one cell and one fixture.
 *
 * The four shapes differ only in what the model is shown and what schema it fills. Transitions
 * are pre-filtered for the LEGACY cells exactly as worker/storyboarder.js does today (the
 * production schema has no concept of a transition), and NOT pre-filtered for the scene cells,
 * where handling them is hypothesis P7. That asymmetry is inherent to the comparison, not a
 * thumb on the scale, and the scorecard says so.
 */
const runFilm = async (cell, fixture) => {
  const calls = [];
  const record = (result) => {
    calls.push({
      usage: result.usage, latencyMs: result.latencyMs, attempts: result.attempts,
      // Zero for every NVIDIA model (no entry in TOKEN_PRICES), which is correct — on that tier
      // rateLimitHits and latency are the real ledger, not dollars.
      costUsd: costUsd(cell.model, result.usage), rateLimitHits: result.rateLimitHits ?? 0,
      usedToolCall: result.usedToolCall, request: result.request, raw: result.raw,
    });
    return result.data;
  };

  if (cell.kind === 'scene' && cell.scope === 'film') {
    const spec = cell.trimBeats && fixture.spec.beats.length > cell.trimBeats
      ? { ...fixture.spec, beats: fixture.spec.beats.slice(0, cell.trimBeats) }
      : fixture.spec;
    const data = record(await callModel(cell, {
      system: briefFor(cell),
      user: buildFilmUserMessage(spec, fixture.cast),
      schema: SCENE_SCHEMA,
      toolName: 'emit_film',
    }));
    return { film: data, calls };
  }

  // THE SPLIT, scored the way production runs it: one whole-film shot plan, then one call per
  // beat, each beat shown the WHOLE plan. The distinction from `chain` below is the entire
  // hypothesis — a chained beat sees only its predecessor and collapses toward the middle
  // (round 7's c0: 2.4 distinct bands, 0.45 MWS), whereas a split beat sees the film's whole
  // shot rhythm and is told which part of it it owns. If this scores like `chain` rather than
  // like `film`, the split is wrong and FREE_STORYBOARD_SPLIT should default to 0.
  if (cell.kind === 'scene' && cell.scope === 'split') {
    const spec = cell.trimBeats && fixture.spec.beats.length > cell.trimBeats
      ? { ...fixture.spec, beats: fixture.spec.beats.slice(0, cell.trimBeats) }
      : fixture.spec;
    const plan = record(await callModel(
      // 16384, not the 4096 this started at — see the ceiling note in worker/storyboarder.js.
      // A plan call spends most of its budget reasoning, so a tight cap truncates the answer
      // rather than shortening the thinking.
      { ...cell, maxTokens: 16384 },
      { system: buildPlanBrief(), user: buildPlanUserMessage(spec, fixture.cast), schema: FILM_PLAN_SCHEMA, toolName: 'emit_plan' },
    ));
    const beats = [];
    for (let i = 0; i < spec.beats.length; i += 1) {
      // Sequential here, not pooled. Round 11 measured this route SHEDDING concurrent
      // film-sized requests with a 502 at concurrency 2 and 3, which is why production runs
      // FREE_STORYBOARD_BEAT_CONCURRENCY=1 — and a probe that ran them concurrently would be
      // scoring shed requests as model failures.
      const data = record(await callModel(cell, {
        system: briefFor(cell),
        user: buildBeatUserMessage(spec, fixture.cast, i, plan),
        schema: SCENE_SCHEMA,
        toolName: 'emit_film',
      }));
      const beat = (data.beats ?? []).find((b) => b.beatIndex === i) ?? (data.beats ?? [])[0];
      if (!beat) throw new Error(`split call for beat ${i + 1} returned no beat`);
      beat.beatIndex = i;
      beats.push(beat);
    }
    return {
      film: { units: 'metres', aspect: aspectOf(spec), sceneScaleNote: plan?.sceneScaleNote ?? '', beats },
      calls,
      filmPlan: plan,
    };
  }

  if (cell.kind === 'scene' && cell.scope === 'chain') {
    const beats = [];
    let previous = null;
    for (let i = 0; i < fixture.spec.beats.length; i += 1) {
      const data = record(await callModel(cell, {
        system: briefFor(cell),
        user: buildChainedUserMessage(fixture.spec, fixture.cast, i, previous),
        schema: SCENE_SCHEMA,
        toolName: 'emit_film',
      }));
      const beat = (data.beats ?? [])[0];
      if (!beat) throw new Error(`chained call for beat ${i + 1} returned no beat`);
      beat.beatIndex = i;
      beats.push(beat);
      previous = beat;
    }
    return { film: { units: 'metres', aspect: aspectOf(fixture.spec), sceneScaleNote: '', beats }, calls };
  }

  if (cell.kind === 'legacy' && cell.scope === 'chain') {
    const beats = [];
    let previous = null;
    for (let i = 0; i < fixture.spec.beats.length; i += 1) {
      if (isTransition(fixture.spec.beats[i])) {
        beats.push({ transition: true, transitionText: fixture.spec.beats[i].replace(TRANSITION_PREFIX, '') });
        previous = null;
        continue;
      }
      const data = record(await chatCompletionsCall({
        model: cell.model,
        system: blockingBrief(),
        user: buildLegacyBeatMessage(fixture.spec, fixture.cast, i, previous),
        schema: blockingSchema(),
        toolName: 'emit_blocking',
        temperature: cell.temperature,
        maxCompletionTokens: cell.maxCompletionTokens,
      }));
      beats.push(data);
      previous = data;
    }
    return { film: { beats }, calls };
  }

  // legacy + film — the scope ablation
  const data = record(await chatCompletionsCall({
    model: cell.model,
    system: blockingBrief(),
    user: buildLegacyFilmMessage(fixture.spec, fixture.cast),
    schema: legacyFilmSchema(),
    toolName: 'emit_blocking',
    temperature: cell.temperature,
    maxCompletionTokens: cell.maxCompletionTokens,
  }));
  return { film: data, calls };
};

// ─────────────────────────────────────────────────────────────────────── stage 0

/**
 * Stage 0 answers the questions that decide HOW stage 1 asks, before stage 1 spends anything:
 * does strict json_schema accept our schema with numeric ranges, does temperature co-exist with
 * reasoning, does the output[] walk find the payload, and what do the two usage shapes look like
 * (reasoning tokens bill at the output rate and must be counted).
 *
 * Stage 1 refuses to run until this is green, because a stage-1 run that discovers a 400 on call
 * three has already wasted the two before it.
 */
const stage0 = async () => {
  const fixture = fixtureById('scale-extremes');
  const user = buildFilmUserMessage(fixture.spec, fixture.cast);
  const results = [];

  const probes = [
    {
      id: 's0-strict-with-ranges',
      question: 'does strict json_schema accept minimum/maximum keywords?',
      run: () => responsesCall({ model: MODELS.terra, system: brief, user, schema: SCENE_SCHEMA, effort: 'low', maxOutputTokens: 16000, strict: true }),
    },
    {
      id: 's0-strict-ranges-stripped',
      question: 'does it accept the schema with range keywords stripped?',
      run: () => responsesCall({ model: MODELS.terra, system: brief, user, schema: toStrictSchema(SCENE_SCHEMA), effort: 'low', maxOutputTokens: 16000, strict: true }),
    },
    {
      id: 's0-temperature-with-reasoning',
      question: 'can temperature be passed alongside reasoning.effort?',
      run: () => responsesCall({ model: MODELS.terra, system: brief, user, schema: toStrictSchema(SCENE_SCHEMA), effort: 'low', maxOutputTokens: 16000, strict: true, temperature: 0.3 }),
    },
    {
      id: 's0-chat-forced-tool',
      question: 'does the scene schema work as a forced tool call at effort none?',
      run: () => chatCompletionsCall({ model: MODELS.terra, system: brief, user, schema: SCENE_SCHEMA, toolName: 'emit_film', maxCompletionTokens: 12000 }),
    },
    {
      id: 's0-sol-high',
      question: 'does sol at high effort return a whole film inside 24k output tokens?',
      run: () => responsesCall({ model: MODELS.sol, system: brief, user, schema: toStrictSchema(SCENE_SCHEMA), effort: 'high', maxOutputTokens: 24000, strict: true }),
    },
    {
      id: 's0-legacy-control',
      question: "does today's production request still run unchanged?",
      run: () => chatCompletionsCall({
        model: LEGACY_PARAMS.model, system: blockingBrief(),
        user: buildLegacyBeatMessage(fixture.spec, fixture.cast, 0, null),
        schema: blockingSchema(), toolName: 'emit_blocking',
        temperature: LEGACY_PARAMS.temperature, maxCompletionTokens: LEGACY_PARAMS.maxCompletionTokens,
      }),
    },
  ];

  for (const probe of probes) {
    process.stdout.write(`  ${probe.id.padEnd(30)} `);
    try {
      const result = await probe.run();
      const cost = costUsd(probe.id.includes('sol') ? MODELS.sol : MODELS.terra, result.usage);
      const beats = result.data.beats?.length ?? 0;
      console.log(
        `✓ ${beats} beats | ${result.usage.promptTokens}in ${result.usage.completionTokens}out ` +
        `(${result.usage.reasoningTokens} reasoning) | $${cost.toFixed(4)} | ${(result.latencyMs / 1000).toFixed(1)}s`,
      );
      results.push({ ...probe, question: probe.question, ok: true, usage: result.usage, costUsd: cost, latencyMs: result.latencyMs, beats, sample: result.data });
    } catch (error) {
      console.log(`✗ ${error.name}: ${error.message.slice(0, 160)}`);
      results.push({ id: probe.id, question: probe.question, ok: false, error: `${error.name}: ${error.message}` });
    }
  }
  return results;
};

/**
 * Stage F0 — the free tier's smoke test, and a hard gate on stage F1.
 *
 * Six questions, none of which should be answered from a catalogue page. This account has a
 * documented history of models that are listed but unreachable: HANDOVER records
 * deepseek-v3.1-terminus absent from the catalog, deepseek-coder-6.7b returning "not found for
 * account", and deepseek-v4-flash hanging for 170s with zero response on its own dedicated key.
 * "It's on build.nvidia.com" is not evidence that this key can call it.
 */
const stageF0 = async () => {
  const fixture = fixtureById('scale-extremes');
  const user = buildFilmUserMessage(fixture.spec, fixture.cast);
  const system = briefV2;
  const results = [];

  const probes = [
    {
      id: 'f0-ultra-reachable',
      question: 'is nemotron-3-ultra reachable on THIS key at all?',
      run: () => nvidiaToolCall({ model: NVIDIA_MODELS.ultra, system, user, schema: toStrictSchema(SCENE_SCHEMA), enableThinking: true, maxTokens: 32768 }),
    },
    {
      id: 'f0-ultra-response-format',
      question: 'does it accept response_format alongside tool_choice? (docs say no, Super says yes)',
      run: () => nvidiaToolCall({ model: NVIDIA_MODELS.ultra, system, user, schema: toStrictSchema(SCENE_SCHEMA), enableThinking: true, responseFormat: true, maxTokens: 32768 }),
    },
    {
      id: 'f0-ultra-reasoning-budget',
      question: 'does it accept reasoning_budget? (documented for Nemotron 3, never sent by this repo)',
      run: () => nvidiaToolCall({ model: NVIDIA_MODELS.ultra, system, user, schema: toStrictSchema(SCENE_SCHEMA), enableThinking: true, reasoningBudget: 16384, maxTokens: 32768 }),
    },
    {
      id: 'f0-ultra-thinking-off',
      question: 'does it still hold the schema with thinking OFF? (the latency escape hatch)',
      run: () => nvidiaToolCall({ model: NVIDIA_MODELS.ultra, system, user, schema: toStrictSchema(SCENE_SCHEMA), enableThinking: false, maxTokens: 32768 }),
    },
    {
      id: 'f0-super-reachable',
      question: 'does the proven fallback still work unchanged?',
      run: () => nvidiaToolCall({ model: NVIDIA_MODELS.super, system, user, schema: toStrictSchema(SCENE_SCHEMA), enableThinking: true, maxTokens: 32768 }),
    },
    {
      id: 'f0-ultra-six-beat',
      question: 'does a SIX-beat film fit? (scale-extremes is five; grid-launch is the real load)',
      run: () => {
        const big = fixtureById('grid-launch');
        return nvidiaToolCall({ model: NVIDIA_MODELS.ultra, system, user: buildFilmUserMessage(big.spec, big.cast), schema: toStrictSchema(SCENE_SCHEMA), enableThinking: true, maxTokens: 32768 });
      },
    },
  ];

  for (const probe of probes) {
    process.stdout.write(`  ${probe.id.padEnd(28)} `);
    try {
      const result = await probe.run();
      const beats = result.data.beats?.length ?? 0;
      console.log(
        `✓ ${beats} beats | ${result.usage.promptTokens}in ${result.usage.completionTokens}out | ` +
        `${(result.latencyMs / 1000).toFixed(0)}s | ${result.attempts} attempt(s)` +
        `${result.rateLimitHits ? `, ${result.rateLimitHits}×429` : ''}` +
        `${result.usedToolCall ? '' : ' | ⚠ answered in content, not a tool call'}`,
      );
      results.push({ id: probe.id, question: probe.question, ok: true, beats, usage: result.usage, latencyMs: result.latencyMs, attempts: result.attempts, rateLimitHits: result.rateLimitHits, usedToolCall: result.usedToolCall, sample: result.data });
    } catch (error) {
      console.log(`✗ ${error.name}: ${error.message.slice(0, 150)}`);
      results.push({ id: probe.id, question: probe.question, ok: false, kind: error.kind ?? 'error', error: `${error.name}: ${error.message}` });
    }
  }
  return results;
};

// ─────────────────────────────────────────────────────────────────────── main

const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const outDir = `${OUT_ROOT}/${runId}`;

const gitHead = () => {
  try { return execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(); } catch { return 'unknown'; }
};

const writeJson = (path, value) => {
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const selectedFixtures = () => {
  const wanted = flag('fixtures', null);
  if (!wanted || wanted === true) return FIXTURES;
  const ids = String(wanted).split(',').map((s) => s.trim());
  return FIXTURES.filter((f) => ids.includes(f.id));
};

const selectedCells = () => {
  const named = bareWords.filter((w) => CELLS[w]);
  if (named.length) return named;
  if (STAGE && STAGE_CELLS[STAGE]) return STAGE_CELLS[STAGE];
  return STAGE_CELLS[1];
};

const main = async () => {
  const failures = selfTest();
  if (failures.length) {
    console.error('✗ scene-geometry self-test failed — refusing to run:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  if (REPLAY) return replay(REPLAY);
  if (JUDGE_RUN) return judge(JUDGE_RUN);
  if (CAPTURE) return capture();

  if (String(STAGE).toLowerCase() === 'f0') {
    console.log('\nSTAGE F0 — free tier smoke. Six questions a catalogue page cannot answer.\n');
    if (DRY_RUN) { console.log('  (--dry-run: 6 calls against build.nvidia.com, $0, but they spend the shared ~40 RPM)\n'); return; }
    const results = await stageF0();
    writeJson(`${outDir}/stage-f0.json`, { runId, gitHead: gitHead(), results });
    const green = results.filter((r) => r.ok).length;
    console.log(`\n  ${green}/${results.length} probes returned a parseable film  →  ${outDir}/stage-f0.json`);
    const reachable = results.find((r) => r.id === 'f0-ultra-reachable');
    if (!reachable?.ok) {
      console.log('\n  ⚠ Ultra is NOT reachable on this key. Stage F1 cannot run as designed —');
      console.log('    fall back to super-free alone, or resolve account access first.');
    }
    const sixBeat = results.find((r) => r.id === 'f0-ultra-six-beat');
    if (sixBeat?.ok && sixBeat.beats < 6) {
      console.log(`\n  ⚠ the six-beat film came back with only ${sixBeat.beats} beats — check truncation before F1.`);
    }
    return;
  }

  if (String(STAGE) === '0') {
    console.log('\nSTAGE 0 — smoke and shape. Answers how stage 1 must ask, before stage 1 spends.\n');
    if (DRY_RUN) { console.log('  (--dry-run: 6 probe calls, roughly $0.30-$2.00 depending on tier)\n'); return; }
    const results = await stage0();
    writeJson(`${outDir}/stage0.json`, { runId, gitHead: gitHead(), results });
    const spent = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    console.log(`\n  spent $${spent.toFixed(4)}  →  ${outDir}/stage0.json`);
    const green = results.filter((r) => r.ok).length;
    console.log(`  ${green}/${results.length} probes returned a parseable film.`);
    if (!results.find((r) => r.id === 's0-sol-high')?.ok) {
      console.log('  ⚠ the stage-1 champion transport did not return — fix before stage 1.');
    }
    return;
  }

  const cells = selectedCells();
  const fixtures = selectedFixtures();
  const plannedCalls = cells.flatMap((id) => fixtures.map((f) => ({
    cell: id, fixture: f.id,
    callsPerFilm: CELLS[id].scope === 'chain'
      ? f.spec.beats.length
      : CELLS[id].scope === 'split' ? f.spec.beats.length + 1 : 1,
  })));

  console.log(`\nRUN ${runId}`);
  console.log(`cells:    ${cells.join(', ')}`);
  console.log(`fixtures: ${fixtures.map((f) => `${f.id}(${f.sha})`).join(', ')}`);
  console.log(`repeats:  ${REPEATS}`);
  const totalCalls = plannedCalls.reduce((s, p) => s + p.callsPerFilm, 0) * REPEATS;
  const totalFilms = plannedCalls.length * REPEATS;
  console.log(`films:    ${totalFilms}  (${totalCalls} model calls)`);
  if (!fixtureById('captured')) {
    console.log('\n⚠ fixture "captured" (real Screenwriter output) is not frozen yet — running without it.');
    console.log('  Freeze it with --capture against a local `wrangler dev`, per the plan.');
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing will be spent. Resolved matrix:\n');
    for (const p of plannedCalls) {
      const cell = CELLS[p.cell];
      console.log(`  ${p.cell.padEnd(14)} ${p.fixture.padEnd(18)} ${cell.transport}/${cell.model}${cell.effort ? `@${cell.effort}` : ''}  ${p.callsPerFilm} call(s) × ${REPEATS}`);
    }
    const sample = fixtures[0];
    console.log('\nSample request (first cell, first fixture) — system brief head:\n');
    console.log(brief.split('\n').slice(0, 6).map((l) => `  ${l}`).join('\n'));
    console.log('\n  ... user message head:\n');
    console.log(buildFilmUserMessage(sample.spec, sample.cast).split('\n').slice(0, 8).map((l) => `  ${l}`).join('\n'));
    console.log(`\nPrices in use (USD per 1M tokens): ${JSON.stringify(TOKEN_PRICES)}`);
    console.log('Real cost is unknown until stage 0 prints measured token counts — run --stage 0 first.\n');
    return;
  }

  mkdirSync(`${outDir}/raw`, { recursive: true });
  writeJson(`${outDir}/matrix.json`, {
    runId, gitHead: gitHead(), startedAt: new Date().toISOString(),
    cells: Object.fromEntries(cells.map((c) => [c, CELLS[c]])),
    fixtures: fixtures.map((f) => ({ id: f.id, sha: f.sha, beats: f.spec.beats.length })),
    repeats: REPEATS, prices: TOKEN_PRICES, maxSpend: MAX_SPEND,
  });

  const ledger = [];
  const scored = [];
  let spent = 0;

  let quotaExhausted = false;
  for (const cellId of cells) {
    if (quotaExhausted) break;
    const cell = CELLS[cellId];
    for (const fixture of fixtures) {
      for (let repeat = 0; repeat < REPEATS; repeat += 1) {
        if (spent > MAX_SPEND) {
          console.log(`\n⚠ --max-spend $${MAX_SPEND} reached; stopping early with ${scored.length} films scored.`);
          break;
        }
        const tag = `${cellId}__${fixture.id}__r${repeat}`;
        process.stdout.write(`  ${tag.padEnd(46)} `);
        const startedAt = Date.now();
        try {
          const { film, calls } = await runFilm(cell, fixture);
          const filmCost = calls.reduce((s, c) => s + c.costUsd, 0);
          spent += filmCost;
          const result = scoreFilm({ film, kind: cell.kind, fixture });

          writeJson(`${outDir}/raw/${tag}.json`, {
            cell: cellId, fixture: fixture.id, fixtureSha: fixture.sha, repeat,
            film, calls: calls.map((c) => ({ ...c, raw: undefined })), costUsd: filmCost,
          });
          scored.push({ cell: cellId, fixture: fixture.id, repeat, ...result, rawFilm: film, costUsd: filmCost });
          ledger.push({
            tag, cell: cellId, fixture: fixture.id, repeat, model: cell.model,
            costUsd: filmCost, calls: calls.length,
            promptTokens: calls.reduce((s, c) => s + c.usage.promptTokens, 0),
            completionTokens: calls.reduce((s, c) => s + c.usage.completionTokens, 0),
            reasoningTokens: calls.reduce((s, c) => s + c.usage.reasoningTokens, 0),
            wallMs: Date.now() - startedAt,
          });

          console.log(
            `${result.passesFloor ? '✓' : '✗'} floor ${result.floorCount} | ` +
            `M3 ${result.metrics.m3.mean === null ? ' n/a ' : result.metrics.m3.mean.toFixed(2)} | ` +
            `bands ${result.metrics.m6.distinctBands} ${(result.derivedBands.filter(Boolean).join(',') || '-')} | ` +
            `$${filmCost.toFixed(3)} | ${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
          );
        } catch (error) {
          console.log(`✗ ${error.name}: ${error.message.slice(0, 120)}`);
          scored.push({ cell: cellId, fixture: fixture.id, repeat, failed: true, failure: error.kind ?? 'error', error: `${error.name}: ${error.message}` });
          ledger.push({ tag, cell: cellId, fixture: fixture.id, repeat, failed: true, failure: error.kind ?? 'error' });

          // A DAY'S QUOTA DOES NOT COME BACK BEFORE THE RUN ENDS, so there is nothing to be
          // gained by attempting the rest of the matrix. On 2026-08-26 this loop met the
          // free-models-per-day cap on film 7 and then dutifully attempted films 8 through 15,
          // each failing instantly, filling a scorecard with nine rows that say nothing about
          // any model and burying the two real results among them.
          //
          // Stopping here is not just faster; it is the difference between a partial run that
          // reports what it measured and a full run that appears to have tested everything and
          // failed. Whatever HAS been scored is still written out below.
          if (error.quotaExhausted) {
            quotaExhausted = true;
            console.log(
              '\n⛔ Daily free-model quota exhausted — abandoning the rest of the matrix.\n' +
              `   Scored ${scored.filter((r) => !r.failed).length} of ${scored.length} attempted film(s) before the wall.\n` +
              '   The free tier is 50 requests/day below 10 credits, 1000 above. Note that a SPLIT\n' +
              '   film costs one call per beat plus one for the plan, so it burns quota 4-7x faster\n' +
              '   than a whole-film cell — budget the matrix accordingly, or add credits.',
            );
          }
        }
        if (quotaExhausted) break;
      }
      if (quotaExhausted) break;
    }
    if (quotaExhausted) break;
  }

  // rawFilm is stripped here — raw/ already holds every film verbatim, and metrics.json is
  // meant to stay readable enough to grep.
  writeJson(`${outDir}/metrics.json`, scored.map(({ rawFilm, ...rest }) => rest));
  writeJson(`${outDir}/ledger.json`, { runId, totalUsd: spent, entries: ledger });

  const report = renderScorecard({ runId, cells: CELLS, cellIds: cells, fixtures, scored, ledger, spent, repeats: REPEATS, stabilityOf: stability });
  writeFileSync(`${outDir}/scorecard.md`, report.markdown);
  writeFileSync(`${outDir}/scenes.html`, renderScenesHtml({ runId, scored, fixtures }));

  console.log(`\n${report.verdictLine}`);
  console.log(`\nspent $${spent.toFixed(2)}`);
  console.log(`scorecard  ${outDir}/scorecard.md`);
  console.log(`scenes     ${outDir}/scenes.html   ← open this. The numbers are only half of it.`);
};

// ─────────────────────────────────────────────────────────────────── replay / judge / capture

const replay = (id) => {
  const dir = `${OUT_ROOT}/${id}`;
  const matrix = JSON.parse(readFileSync(`${dir}/matrix.json`, 'utf8'));
  const scored = [];
  for (const file of readdirSync(`${dir}/raw`)) {
    const saved = JSON.parse(readFileSync(`${dir}/raw/${file}`, 'utf8'));
    const fixture = fixtureById(saved.fixture);
    if (!fixture) { console.log(`  skipping ${file}: fixture ${saved.fixture} no longer defined`); continue; }
    if (fixture.sha !== saved.fixtureSha) {
      console.error(`✗ fixture ${saved.fixture} has changed since this run (${saved.fixtureSha} → ${fixture.sha}).`);
      console.error('  Re-scoring against a different fixture would not be a comparison. Refusing.');
      process.exit(1);
    }
    const cell = matrix.cells[saved.cell];
    // Recompute cost from the stored per-call usage instead of trusting saved.costUsd: the price
    // table was corrected mid-run (sol was guessed at $12/$68, verified at $4/$20), and a replay
    // that inherited the old figure would keep reporting a number known to be 3.4x too high.
    const recosted = (saved.calls ?? []).reduce((sum, c) => sum + costUsd(cell.model, c.usage), 0);
    scored.push({ cell: saved.cell, fixture: saved.fixture, repeat: saved.repeat, costUsd: recosted, rawFilm: saved.film, ...scoreFilm({ film: saved.film, kind: cell.kind, fixture }) });
  }
  const ledger = JSON.parse(readFileSync(`${dir}/ledger.json`, 'utf8'));
  // Re-price the ledger entries too, from the same stored usage, so the cost table in the
  // scorecard agrees with the per-film figures above it.
  const entries = (ledger.entries ?? []).map((entry) => {
    const film = scored.find((r) => `${r.cell}__${r.fixture}__r${r.repeat}` === entry.tag);
    return film ? { ...entry, costUsd: film.costUsd } : entry;
  });
  const respent = scored.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const report = renderScorecard({ runId: id, cells: matrix.cells, cellIds: Object.keys(matrix.cells), fixtures: FIXTURES, scored, ledger: entries, spent: respent, repeats: matrix.repeats, stabilityOf: stability });
  writeJson(`${dir}/metrics.json`, scored);
  writeFileSync(`${dir}/scorecard.md`, report.markdown);
  writeFileSync(`${dir}/scenes.html`, renderScenesHtml({ runId: id, scored, fixtures: FIXTURES }));
  console.log(`re-scored ${scored.length} films for $0`);
  console.log(report.verdictLine);
};

/**
 * M16 — the only judged metric, and deliberately not part of the pass gate.
 *
 * Blinded by construction: the judge sees the beat text and the COMPILED H3 DESCRIPTION, never
 * the JSON, never a cell or model label. It grades what H3 would actually receive. It is told
 * explicitly that framing, camera, geometry and continuity are computed elsewhere and are none
 * of its business — a vibe must not be allowed to overrule arithmetic.
 */
const judge = async (id) => {
  const dir = `${OUT_ROOT}/${id}`;
  const scored = JSON.parse(readFileSync(`${dir}/metrics.json`, 'utf8'));
  const system = `You are grading whether a shot description depicts the beat a screenwriter wrote.

You are NOT grading framing, camera work, geometry, continuity or containment. Those are
measured separately, in code, and your opinion on them would be noise. Grade only the three
questions asked, each strictly against the beat text you are given.`;

  const schema = {
    type: 'object', additionalProperties: false,
    required: ['depicts', 'adds', 'contradicts', 'reason'],
    properties: {
      depicts: { type: 'boolean', description: 'Does the description depict the event the beat describes?' },
      adds: { type: 'boolean', description: 'Does it add a significant action, subject or location the beat does not contain?' },
      contradicts: { type: 'boolean', description: 'Does it contradict anything explicit in the beat: who is present, who moves, or where they are?' },
      reason: { type: 'string', description: 'One clause.' },
    },
  };

  const results = [];
  let spent = 0;
  for (const row of scored) {
    if (row.failed || !row.h3?.length) continue;
    const fixture = fixtureById(row.fixture);
    for (const item of row.h3) {
      const beatText = fixture.spec.beats[item.beat];
      if (!beatText) continue;
      const user = `Beat as written:\n${beatText}\n\nShot description to grade:\n${item.text}`;
      try {
        const result = await responsesCall({ model: MODELS.sol, system, user, schema, schemaName: 'fidelity', effort: 'medium', maxOutputTokens: 2000 });
        spent += costUsd(MODELS.sol, result.usage);
        results.push({ cell: row.cell, fixture: row.fixture, repeat: row.repeat, beat: item.beat, ...result.data });
      } catch (error) {
        results.push({ cell: row.cell, fixture: row.fixture, repeat: row.repeat, beat: item.beat, error: error.message });
      }
    }
  }
  writeJson(`${dir}/judge/results.json`, { runId: id, spent, results });
  const byCell = {};
  for (const r of results) {
    if (r.error) continue;
    byCell[r.cell] ??= { depicts: 0, adds: 0, contradicts: 0, n: 0 };
    byCell[r.cell].depicts += r.depicts ? 1 : 0;
    byCell[r.cell].adds += r.adds ? 1 : 0;
    byCell[r.cell].contradicts += r.contradicts ? 1 : 0;
    byCell[r.cell].n += 1;
  }
  console.log('\nM16 beat-text fidelity (reported, NOT a gate):');
  for (const [cell, v] of Object.entries(byCell)) {
    const fidelity = v.depicts / v.n - 0.5 * (v.adds / v.n) - v.contradicts / v.n;
    console.log(`  ${cell.padEnd(14)} fidelity ${fidelity.toFixed(2)}  depicts ${(v.depicts / v.n).toFixed(2)}  adds ${(v.adds / v.n).toFixed(2)}  contradicts ${(v.contradicts / v.n).toFixed(2)}  (n=${v.n})`);
  }
  console.log(`\njudge spend $${spent.toFixed(2)} → ${dir}/judge/results.json`);
};

/**
 * Freeze fixture F0: real Screenwriter output, captured once from a live local run.
 *
 * It exists because every other fixture is hand-authored, and hand-authored beats are tidy in
 * ways real Nemotron output is not — odd phrasing, a referencePlan carrying garments and props,
 * an intentTrace, subjects named obliquely. If the schema only survives beats I wrote, it hasn't
 * been tested.
 *
 * Its expectations are derived MECHANICALLY and deliberately thinly. I cannot honestly
 * pre-register a shot size for a beat the Screenwriter hasn't written yet, so
 * expectFramingBand is null throughout and F0 contributes to variety, self-agreement, the
 * sanity floor and inclusion discipline — not to the pre-registered band hit rate. Inventing
 * band expectations after reading the beats would be exactly the post-hoc rationalisation the
 * pre-registration rule exists to prevent.
 */
const capture = async () => {
  const target = 'scripts/fixtures/captured-spec.json';
  if (existsSync(target)) {
    console.error(`✗ ${target} already exists. A frozen fixture is never re-captured — that is the point.`);
    process.exit(1);
  }

  const base = flag('dev-url', 'http://127.0.0.1:8789');
  const castFile = JSON.parse(readFileSync('scripts/fixtures/cast-dossiers.json', 'utf8'));
  const cast = ['ape', 'velvetJacket', 'camoCar', 'antagonist'].map((n) => castFile[n]);
  const prompt =
    'A short film on a wet night starting grid: the hero ape puts on the velvet jacket, gets ' +
    'into the camouflaged supercar, and launches past a rival who is watching from the barrier. ' +
    'One continuous take, no cuts.';

  console.log(`Capturing real Screenwriter output from ${base}/api/screenwriter ...`);
  const response = await fetch(`${base}/api/screenwriter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, cast }),
  });
  if (!response.ok) {
    console.error(`✗ ${response.status}: ${(await response.text()).slice(0, 400)}`);
    process.exit(1);
  }

  // The route is SSE; the spec arrives as the terminal `result` event.
  const text = await response.text();
  let spec = null;
  for (const block of text.split('\n\n')) {
    const event = /^event: (.*)$/m.exec(block)?.[1];
    const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
    if (event === 'result' && data) spec = JSON.parse(data);
    if (event === 'error' && data) { console.error(`✗ worker error: ${data}`); process.exit(1); }
  }
  if (!spec?.beats?.length) {
    console.error('✗ no spec in the stream. Raw tail:');
    console.error(text.slice(-800));
    process.exit(1);
  }

  const tagsOf = (t) => [...new Set(String(t).match(/<Subject \d+>/g) ?? [])];

  // MEASURED FINDING, first capture 2026-08-24: the live Screenwriter writes its beats in PROSE
  // ("the ape", "the camouflaged supercar") and defines the <Subject N> tags only in the staging
  // block. So a tag regex over the beat text finds nothing, and the obvious mechanical
  // derivation (exclude everything not yet named) marks every subject excluded in every beat and
  // manufactures false early-reveal violations.
  //
  // This is also a real fact about production worth writing down: worker/storyboarder.js's tag
  // discipline silently depends on the model resolving prose beat text against staging. Nothing
  // in the pipeline states that inference step, and nothing tests it.
  //
  // Rather than guess, the capture emits EMPTY inclusion expectations and says so loudly. A
  // human maps prose to tags from the staging block afterwards — which is reading, not tuning,
  // and is still done before any storyboard output for this fixture exists.
  const taggedBeats = spec.beats.filter((b) => tagsOf(b).length).length;
  const perBeat = spec.beats.map((beatText, beat) => ({
    beat,
    mustInclude: tagsOf(beatText),
    mustExclude: [],
    expectFramingBand: null,
  }));

  const captured = {
    capturedAt: new Date().toISOString(),
    prompt,
    model: spec.model ?? null,
    spec,
    cast,
    expectations: {
      axisTested: false,
      perBeat,
      containment: [],
      movement: [],
      transitions: spec.beats.map((t, i) => (TRANSITION_PREFIX.test(t) ? i : null)).filter((i) => i !== null),
      permittedSideSwaps: [],
    },
  };
  writeJson(target, captured);
  console.log(`\n✓ froze ${spec.beats.length} beats, ${spec.referencePlan.length} reference slots → ${target}`);
  if (taggedBeats < spec.beats.length) {
    console.log(`\n⚠ ${spec.beats.length - taggedBeats}/${spec.beats.length} beats name their subjects in PROSE, not as <Subject N> tags.`);
    console.log('  Inclusion, containment and movement expectations are left EMPTY and must be');
    console.log('  hand-mapped from spec.staging before this fixture means anything. Do it now,');
    console.log('  before any storyboard output for it exists.');
  }
  console.log(`  title: ${spec.title}`);
  spec.beats.forEach((b, i) => console.log(`  ${i + 1}. ${b.slice(0, 100)}${b.length > 100 ? '…' : ''}`));
  console.log('\nRe-run the probe and fixture "captured" will be included.');
};

main().catch((error) => {
  console.error(`\n✗ ${error.stack ?? error.message}`);
  process.exit(1);
});
