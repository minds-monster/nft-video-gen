#!/usr/bin/env node
// Focused timing probe for the storyboarder free tier.
// Compares 2 vs 3 beats, thinking on vs off, and Ultra vs Super.
// $0 (free tier) but consumes the shared OpenRouter rate limit.
//
//   node --env-file-if-exists=.env scripts/probe-storyboarder-timing.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { H3_FORMAT } from '../worker/rulebook.js';
import {
  SCENE_SCHEMA,
  toStrictSchema,
  buildBrief,
  buildFilmUserMessage,
  COORDINATE_CONTRACT_V2,
} from '../worker/scene.js';
import { filmCall } from '../worker/openrouter.js';

const OUT_DIR = 'assets/probes/storyboarder-timing';
mkdirSync(OUT_DIR, { recursive: true });

const brief = buildBrief(H3_FORMAT, COORDINATE_CONTRACT_V2);
const strictSchema = toStrictSchema(SCENE_SCHEMA);

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

const env = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  FREE_STORYBOARD_MODEL: 'nvidia/nemotron-3-ultra-550b-a55b:free',
};

if (!env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY is not set. Add it to .env to run this probe.');
  process.exit(1);
}

const cells = [
  {
    id: 'ultra-3-on',
    label: 'Ultra 550B, 3 beats, thinking ON',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    enableThinking: true,
    beatCount: 3,
  },
  {
    id: 'ultra-3-off',
    label: 'Ultra 550B, 3 beats, thinking OFF',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    enableThinking: false,
    beatCount: 3,
  },
  {
    id: 'ultra-2-on',
    label: 'Ultra 550B, 2 beats, thinking ON',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    enableThinking: true,
    beatCount: 2,
  },
  {
    id: 'super-3-on',
    label: 'Super 120B, 3 beats, thinking ON',
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    enableThinking: true,
    beatCount: 3,
  },
];

const runCell = async (cell) => {
  const spec = { ...FIXTURE.spec, beats: FIXTURE.spec.beats.slice(0, cell.beatCount) };
  const user = buildFilmUserMessage(spec, FIXTURE.cast);

  console.log(`\n→ ${cell.label}`);
  const startedAt = Date.now();
  let result;
  try {
    result = await filmCall(env, {
      model: cell.model,
      system: brief,
      user,
      schema: strictSchema,
      toolName: 'emit_film',
      temperature: 0.3,
      maxTokens: 32768,
      retries: 1,
      enableThinking: cell.enableThinking,
    });
  } catch (error) {
    return {
      ...cell,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error.message,
    };
  }

  const beats = result.data?.beats ?? [];
  const valid = beats.length === cell.beatCount && beats.every((b) => b.camera && b.subjects);
  console.log(`  ${valid ? '✓' : '✗'} ${beats.length}/${cell.beatCount} beats | ${(result.latencyMs / 1000).toFixed(0)}s | ${result.attempts ?? 1} attempt(s)`);

  return {
    ...cell,
    ok: true,
    latencyMs: result.latencyMs,
    attempts: result.attempts ?? 1,
    usage: result.usage,
    beatCountReturned: beats.length,
    valid,
    sample: result.data,
  };
};

const main = async () => {
  const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  console.log(`\nStoryboarder free-tier timing probe — run ${runId}`);
  console.log(`Using OpenRouter key ${env.OPENROUTER_API_KEY.slice(0, 8)}...`);

  const results = [];
  for (const cell of cells) {
    results.push(await runCell(cell));
    // Brief pause to be gentle on the shared rate limit.
    await new Promise((done) => setTimeout(done, 2000));
  }

  const report = {
    runId,
    startedAt: new Date().toISOString(),
    fixture: FIXTURE.id,
    results,
  };

  const path = `${OUT_DIR}/${runId}.json`;
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);

  console.log('\n─── Summary ───');
  for (const r of results) {
    const status = r.ok ? (r.valid ? '✓' : '✗ shape') : '✗ error';
    console.log(`  ${status} ${r.label.padEnd(36)} ${(r.latencyMs / 1000).toFixed(0).padStart(4)}s${r.attempts ? ` (${r.attempts} attempt${r.attempts === 1 ? '' : 's'})` : ''}`);
  }
  console.log(`\nWrote ${path}`);
};

main().catch((error) => {
  console.error(`\n✗ ${error.stack ?? error.message}`);
  process.exit(1);
});
