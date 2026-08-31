#!/usr/bin/env node
// Focused timing probe for the Zero Budget storyboarder.
//
// WHAT THIS ROUND CHANGED, and why each change exists — the 2026-08-26 version of this probe
// produced four confident numbers that could not answer the question actually being asked
// ("why is a visitor waiting 18 minutes?"):
//
//  1. IT MEASURED THE WRONG CALL. Production takes the STREAMED branch whenever `onReasoning`
//     is set, which on the free tier is always (worker/storyboarder.js). This probe only ever
//     called `filmCall`. Every free-tier latency number in HANDOVER.md is therefore from a code
//     path that does not run in production. There is now a `stream` cell.
//  2. ITS PASS/FAIL WAS SHAPE-ONLY. `valid` checked `beats.length` and the presence of `camera`
//     and `subjects` — it never ran `validateScene`, the gate production actually applies. A
//     cell could come back "✓, 2x faster" while emitting geometry the Worker would refuse. Every
//     cell now scores floor violations with the real validator.
//  3. `enable_thinking: false` DID NOT TURN REASONING OFF (3,588 reasoning tokens with it set),
//     so the one lever tried was never connected to anything. OpenRouter's own `reasoning`
//     parameter had never been sent from this repo. It is now a cell axis.
//  4. EVERY NUMBER WAS n=1. `--reps` defaults to 3, and per-rep figures are kept alongside the
//     median so a wide spread is visible rather than averaged away.
//  5. NOTHING RECORDED THE RATE LIMIT. On this tier the rate limit is the currency: a run
//     throttled into three multi-minute replays and a run that was simply slow looked identical
//     in our data. Rate-limit headers and attempt counts are captured per rep.
//
// $0, but it consumes the shared OpenRouter free-tier quota — which is itself finite per day,
// so `--cells` exists to run a focused subset rather than the whole matrix.
//
//   node --env-file-if-exists=.env --env-file-if-exists=.dev.vars \
//     scripts/probe-storyboarder-timing.mjs [--reps=3] [--cells=stream,reasoning-off]
//
// Results append to assets/probes/storyboarder-timing/<runId>.json AFTER EVERY REP, so a probe
// that is interrupted an hour in still leaves everything it measured.

import { mkdirSync, writeFileSync } from 'node:fs';
import { Agent, setGlobalDispatcher } from 'undici';
import { H3_FORMAT } from '../worker/rulebook.js';
import {
  SCENE_SCHEMA,
  toStrictSchema,
  buildBrief,
  buildFilmUserMessage,
  COORDINATE_CONTRACT_V2,
  validateScene,
} from '../worker/scene.js';
import { filmCall, streamFilmCall } from '../worker/openrouter.js';
import { generateFilmSplit } from '../worker/storyboarder.js';
import { planAdherence } from '../worker/film-plan.js';

// Node's built-in fetch inherits undici's 300s headersTimeout/bodyTimeout, and it surfaces as a
// bare `TypeError: fetch failed` with no status — trivially misread as a model failure. The
// previous version of this probe did NOT set this, which means it could not have measured the
// streamed path even if it had tried: the one production sample we have is 347s. Same ceiling
// scripts/lib/nvidia-probe.mjs uses, and the same reasoning: a slow answer is still data, and
// latency must be measured rather than silently converted into a failure.
setGlobalDispatcher(new Agent({ headersTimeout: 900_000, bodyTimeout: 900_000 }));

const OUT_DIR = 'assets/probes/storyboarder-timing';
mkdirSync(OUT_DIR, { recursive: true });

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const REPS = Number(arg('reps', 3));
const ONLY = arg('cells', null)?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;

const brief = buildBrief(H3_FORMAT, COORDINATE_CONTRACT_V2);
const strictSchema = toStrictSchema(SCENE_SCHEMA);

const ULTRA = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const SUPER = 'nvidia/nemotron-3-super-120b-a12b:free';

const FIXTURE = {
  id: 'scale-extremes',
  spec: {
    title: 'Salt',
    logline: 'A figure crosses an empty salt flat and finally speaks.',
    world: 'An empty white salt flat under an enormous pale sky, flat to the horizon in every direction, hard noon light.',
    staging: '<Subject 1> is the only figure anywhere in this world.',
    guard: 'Every character has ordinary skin and is a living figure, not a mannequin and not a chrome statue.',
    camera: 'Whatever each beat demands. The range is the point.',
    continuity: 'One continuous passage of time.',
    beats: [
      'A single lone figure, <Subject 1>, is a speck at the far end of the empty salt flat under a huge sky.',
      '<Subject 1> walks toward us across the flat, still small against the emptiness.',
      'Her eye opens, and the iris and its flecks fill the whole picture.',
      'She stands and looks back the way she came, the full length of her against the flat.',
      'She says one word, and we are close enough to read her mouth.',
    ],
    sound: 'Wind across salt, footsteps on crust.',
    music: 'N/A',
    referencePlan: [{ key: 'antagonist', role: 'figure', crop: '' }],
    duration: 12,
    resolution: '768P',
    ratio: '16:9',
    intentTrace: [],
    notes: '',
  },
  cast: [{
    key: 'antagonist',
    name: 'Antagonist',
    dossier: {
      subject: 'a lone figure in a long coat',
      identityMarkers: ['long coat', 'salt dust'],
      physicalProfile: { bodyPlan: 'humanoid', heightM: 1.7, widthM: 0.6, depthM: 0.3, heightConfidence: 'estimated' },
    },
  }],
};

// The same join worker/storyboarder.js's profilesFrom does, so validateScene here checks the
// height the model used against the height the Casting Director measured — exactly as production
// would. Scoring against a weaker validator than production runs is how a probe talks a bad cell
// into looking good.
const PROFILES = Object.fromEntries(
  FIXTURE.spec.referencePlan
    .map((slot, i) => [`<Subject ${i + 1}>`, FIXTURE.cast.find((c) => c.key === slot.key)?.dossier?.physicalProfile])
    .filter(([, p]) => p),
);

const env = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  FREE_STORYBOARD_MODEL: ULTRA,
};

if (!env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY is not set. Add it to .env to run this probe.');
  process.exit(1);
}

/**
 * The matrix.
 *
 * `stream` is the control that matters most: it is what a visitor actually gets today, and it is
 * the number every other cell has to be compared against. The non-streamed cells are the ones
 * previous rounds measured and reported as if they were production.
 */
const CELLS = [
  {
    // The proposed shape: one cheap whole-film shot plan, then every beat drawn in parallel.
    // Runs the REAL production function, not a reimplementation of it, so a difference between
    // what the probe measures and what a visitor gets cannot creep in.
    id: 'split',
    label: 'Ultra · SPLIT plan + parallel beats',
    model: ULTRA,
    split: true,
    beatCount: 3,
  },
  {
    id: 'stream',
    label: 'Ultra · streamed (PRODUCTION PATH)',
    model: ULTRA,
    streamed: true,
    beatCount: 3,
  },
  {
    id: 'nostream',
    label: 'Ultra · non-streamed',
    model: ULTRA,
    beatCount: 3,
  },
  {
    id: 'kwarg-off',
    label: 'Ultra · enable_thinking:false (control)',
    model: ULTRA,
    beatCount: 3,
    enableThinking: false,
  },
  {
    id: 'reasoning-off',
    label: 'Ultra · reasoning:{enabled:false}',
    model: ULTRA,
    beatCount: 3,
    reasoning: { enabled: false },
  },
  {
    id: 'reasoning-low',
    label: 'Ultra · reasoning:{effort:low}',
    model: ULTRA,
    beatCount: 3,
    reasoning: { effort: 'low' },
  },
  {
    id: 'reasoning-cap',
    label: 'Ultra · reasoning:{max_tokens:1500}',
    model: ULTRA,
    beatCount: 3,
    reasoning: { max_tokens: 1500 },
  },
  {
    id: 'super',
    label: 'Super 120B · non-streamed',
    model: SUPER,
    beatCount: 3,
  },
  {
    id: 'super-low',
    label: 'Super 120B · reasoning:{effort:low}',
    model: SUPER,
    beatCount: 3,
    reasoning: { effort: 'low' },
  },
  {
    id: 'one-beat',
    label: 'Ultra · ONE beat (Phase 3 parallel unit)',
    model: ULTRA,
    beatCount: 1,
  },
];

/** Floor violations across a whole film, using the SAME validator and the SAME profiles
 * production gates on. A beat the model simply omitted counts as a floor failure, because that
 * is exactly how worker/storyboarder.js treats it. */
const scoreFilm = (film, beatCount) => {
  const byIndex = new Map((film?.beats ?? []).map((b) => [b.beatIndex, b]));
  const violations = [];
  for (let i = 0; i < beatCount; i += 1) {
    const beat = byIndex.get(i);
    if (!beat) {
      violations.push({ beatIndex: i, code: 'missing-beat', detail: 'No geometry returned for this beat.' });
      continue;
    }
    for (const v of validateScene(beat, { profiles: PROFILES })) {
      if (v.severity === 'floor') violations.push({ beatIndex: i, code: v.code, detail: v.detail });
    }
  }
  const bands = new Set((film?.beats ?? []).map((b) => b.framing).filter(Boolean));
  return {
    floorViolations: violations,
    passesFloor: violations.length === 0,
    distinctBands: bands.size,
    bands: [...bands],
  };
};

const runOnce = async (cell, rep) => {
  const spec = { ...FIXTURE.spec, beats: FIXTURE.spec.beats.slice(0, cell.beatCount) };
  const user = buildFilmUserMessage(spec, FIXTURE.cast);
  const meta = [];
  const options = {
    model: cell.model,
    system: brief,
    user,
    schema: strictSchema,
    toolName: 'emit_film',
    temperature: 0.3,
    maxTokens: 32768,
    enableThinking: cell.enableThinking ?? true,
    reasoning: cell.reasoning ?? null,
    onMeta: (m) => meta.push(m),
  };

  const startedAt = Date.now();
  const marks = [];
  try {
    // `retries: 1` on the non-streamed path, not the default 2. A retry here replays a
    // multi-minute call and silently triples a latency measurement — the exact effect this probe
    // exists to make visible, so it must not be hidden inside the number.
    let result;
    if (cell.split) {
      // The split emits progress as it goes, and WHEN each event lands is half of what is being
      // measured here: the claim is not only that the film is faster overall but that a visitor
      // sees something true within about fifteen seconds. An end-to-end number alone cannot
      // support the second half of that, so every event is timestamped.
      result = await generateFilmSplit(env, { ...cell, tier: 'free', maxBeats: cell.beatCount }, {
        spec,
        cast: FIXTURE.cast,
        beats: spec.beats,
        emit: async (type, data) => { marks.push({ type, data, atMs: Date.now() - startedAt }); },
      });
      result.latencyMs = Date.now() - startedAt;
    } else if (cell.streamed) {
      result = await streamFilmCall(env, { ...options, onReasoning: () => {} });
    } else {
      result = await filmCall(env, { ...options, retries: 1 });
    }

    const score = scoreFilm(result.data, cell.beatCount);
    const seconds = result.latencyMs / 1000;
    const usage = result.usage ?? {};
    const answerTokens = Math.max(0, (usage.completionTokens ?? 0) - (usage.reasoningTokens ?? 0));

    console.log(
      `  rep ${rep}: ${score.passesFloor ? '✓' : `✗ ${score.floorViolations.length} floor`}` +
      ` | ${seconds.toFixed(0)}s | ${(usage.completionTokens ?? 0)} tok` +
      ` (${usage.reasoningTokens ?? 0} reasoning, ${answerTokens} answer)` +
      ` | ${((usage.completionTokens ?? 0) / seconds).toFixed(0)} tok/s | ${score.distinctBands} bands`,
    );

    const firstPlanAt = marks.find((m) => m.type === 'beat-plan')?.atMs ?? null;
    const adherence = result.filmPlan
      ? planAdherence(result.filmPlan, (result.data.beats ?? []).map((b) => ({ beatIndex: b.beatIndex, scene: b })))
      : null;
    if (firstPlanAt != null) {
      console.log(`     first real per-beat signal at ${(firstPlanAt / 1000).toFixed(1)}s` +
        (adherence ? ` | plan honoured ${adherence.matched}/${adherence.checked}` : ''));
    }

    return {
      rep,
      ok: true,
      latencyMs: result.latencyMs,
      firstPlanAtMs: firstPlanAt,
      adherence,
      marks,
      tokensPerSecond: Number(((usage.completionTokens ?? 0) / seconds).toFixed(1)),
      usage,
      answerTokens,
      reasoningShare: usage.completionTokens
        ? Number(((usage.reasoningTokens ?? 0) / usage.completionTokens).toFixed(3))
        : null,
      reasoningChars: cell.streamed ? (result.reasoning?.length ?? 0) : null,
      ...score,
      meta,
      film: result.data,
    };
  } catch (error) {
    console.log(`  rep ${rep}: ✗ ${error.message.slice(0, 140)}`);
    return {
      rep,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error.message,
      status: error.status ?? null,
      meta,
    };
  }
};

/**
 * OpenRouter reports the free-tier quota on its key endpoint, NOT as response headers — the
 * completion route returned no `x-ratelimit-*` at all when this was first tried. So the quota
 * is read directly, at the start and the end of a run, and the difference is what the probe
 * actually cost. On this tier the quota IS the currency; a probe that spends it without saying
 * how much is the same mistake as a spend ledger that does not record tokens.
 */
const keyQuota = async () => {
  try {
    const response = await fetch(`${env.OPENROUTER_BASE_URL}/key`, {
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
    });
    if (!response.ok) return { error: String(response.status) };
    const { data } = await response.json();
    return {
      usage: data?.usage ?? null,
      limit: data?.limit ?? null,
      limitRemaining: data?.limit_remaining ?? null,
      isFreeTier: data?.is_free_tier ?? null,
      rateLimit: data?.rate_limit ?? null,
    };
  } catch (error) {
    return { error: error.message };
  }
};

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const main = async () => {
  const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const cells = ONLY ? CELLS.filter((c) => ONLY.includes(c.id)) : CELLS;
  if (!cells.length) {
    console.error(`No cells matched --cells=${ONLY?.join(',')}. Known: ${CELLS.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`\nZero Budget storyboarder timing probe — run ${runId}`);
  console.log(`${cells.length} cell(s) x ${REPS} rep(s), fixture ${FIXTURE.id}, scored with validateScene`);
  console.log(`Key ${env.OPENROUTER_API_KEY.slice(0, 8)}...\n`);

  const path = `${OUT_DIR}/${runId}.json`;
  const results = [];
  const quotaBefore = await keyQuota();
  console.log(`quota before: ${JSON.stringify(quotaBefore)}\n`);
  const report = { runId, startedAt: new Date().toISOString(), fixture: FIXTURE.id, reps: REPS, quotaBefore, results };
  const save = () => writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);

  for (const cell of cells) {
    console.log(`\n→ ${cell.label}`);
    const reps = [];
    const entry = { ...cell, reps };
    results.push(entry);
    for (let r = 1; r <= REPS; r += 1) {
      reps.push(await runOnce(cell, r));
      // Written after EVERY rep: an hour-long probe that dies at cell 6 should not throw away
      // cells 1-5. Learned the expensive way in round 7.
      const okReps = reps.filter((x) => x.ok);
      entry.medianLatencyMs = median(okReps.map((x) => x.latencyMs));
      entry.medianTokensPerSecond = median(okReps.map((x) => x.tokensPerSecond));
      entry.medianReasoningShare = median(okReps.map((x) => x.reasoningShare).filter((x) => x != null));
      entry.floorPassRate = reps.length ? okReps.filter((x) => x.passesFloor).length / reps.length : 0;
      save();
      // Gentle on a shared free-tier quota.
      if (r < REPS) await new Promise((done) => setTimeout(done, 3000));
    }
    await new Promise((done) => setTimeout(done, 3000));
  }

  console.log(`\n─── Summary (median of ${REPS}) ───`);
  console.log(`${'cell'.padEnd(38)} ${'p50'.padStart(6)} ${'tok/s'.padStart(6)} ${'reason'.padStart(7)} ${'floor'.padStart(6)}`);
  for (const e of results) {
    const p50 = e.medianLatencyMs != null ? `${(e.medianLatencyMs / 1000).toFixed(0)}s` : '—';
    const tps = e.medianTokensPerSecond != null ? String(e.medianTokensPerSecond) : '—';
    const share = e.medianReasoningShare != null ? `${(e.medianReasoningShare * 100).toFixed(0)}%` : '—';
    console.log(`${e.label.padEnd(38)} ${p50.padStart(6)} ${tps.padStart(6)} ${share.padStart(7)} ${`${(e.floorPassRate * 100).toFixed(0)}%`.padStart(6)}`);
  }
  // Every upstream attempt that was NOT the one that answered. A 200 carrying an error body is
  // retried inside worker/nvidia.js, so this is latency that belongs to the provider bouncing
  // us rather than to the model thinking — and it has never been visible in a published figure.
  const wasted = results.flatMap((e) => e.reps).flatMap((r) => r.meta ?? []).filter((m) => m.softError);
  if (wasted.length) {
    console.log(`\n⚠ ${wasted.length} silent upstream retry/retries across this run:`);
    for (const w of wasted.slice(0, 10)) console.log(`   attempt ${w.attempt}: ${w.softError.slice(0, 120)}`);
  }

  report.quotaAfter = await keyQuota();
  report.finishedAt = new Date().toISOString();
  report.silentRetries = wasted.length;
  save();
  console.log(`\nquota after: ${JSON.stringify(report.quotaAfter)}`);
  console.log(`\nWrote ${path}`);
};

main().catch((error) => {
  console.error(`\n✗ ${error.stack ?? error.message}`);
  process.exit(1);
});
