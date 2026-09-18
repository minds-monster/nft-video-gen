#!/usr/bin/env node
// Does the Casting Director pick the RIGHT frames from a film? Run worker/film-frames.js's exact
// request against screen-test runs whose right answers are already known by eye:
//
//   eth-mainnet-0x78d61c68-10   SUPERGUCCI #11    a turntable — expect a few distinct angles
//   eth-mainnet-0x4f18cba7-5    Idle Hands #4     a transformation — expect one frame per state, in order
//   eth-mainnet-0x28472a58-1    adidas ITM #1     a REEL of four different characters — expect only
//                                                 frames of the still's own ape, or none
//
// The adidas run is the one that matters. The motion pass called that film "the character
// rotates 360 degrees"; a picker that keeps its other characters would put someone else's NFT
// into a visitor's film.
//
// Uses frames already extracted by scripts/screen-frames.mjs (`extract`). Costs one NVIDIA call
// per run, no MiniMax.
//
//   node --env-file=.env scripts/probe-frame-pick.mjs
//   node --env-file=.env scripts/probe-frame-pick.mjs assets/screen-tests/eth-mainnet-0x4f18cba7-5

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Agent, setGlobalDispatcher } from 'undici';

import { chat, jsonFrom } from '../worker/nvidia.js';
import { CANDIDATE_FRAMES, framePickRequest, validateFramePick } from '../worker/film-frames.js';

const run = promisify(execFile);

// Node's fetch gives up after 300s waiting for response headers ("fetch failed"). An eleven-frame
// pick with reasoning on runs past that — three runs in a row died there on 2026-09-18 — while a
// Worker has no such cap. Lifted here so the probe measures the model, not Node.
setGlobalDispatcher(new Agent({ headersTimeout: 900_000, bodyTimeout: 900_000 }));

const DEFAULT_RUNS = [
  'assets/screen-tests/eth-mainnet-0x78d61c68-10',
  'assets/screen-tests/eth-mainnet-0x4f18cba7-5',
  'assets/screen-tests/eth-mainnet-0x28472a58-1',
];

const env = {
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  NVIDIA_BASE_URL: process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
  CASTING_MODEL: process.env.CASTING_MODEL ?? 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
};

/** A 512px JPEG data URI — what the model needs to judge a frame, at a fraction of the payload. */
const small = async (file) => {
  const out = join(tmpdir(), `pick-${Math.random().toString(36).slice(2)}.jpg`);
  await run('sips', ['-Z', '512', '-s', 'format', 'jpeg', file, '--out', out]);
  return `data:image/jpeg;base64,${(await readFile(out)).toString('base64')}`;
};

const probe = async (dir) => {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const still = await small(join(dir, manifest.still.file));
  // At most CANDIDATE_FRAMES, spread evenly across whatever was extracted — the model's limit.
  const all = manifest.frames;
  const chosen = all.length <= CANDIDATE_FRAMES
    ? all
    : Array.from({ length: CANDIDATE_FRAMES }, (_, i) => all[Math.round((i * (all.length - 1)) / (CANDIDATE_FRAMES - 1))]);
  const frames = [];
  for (const [index, frame] of chosen.entries()) {
    // eslint-disable-next-line no-await-in-loop
    frames.push({ n: index + 1, disk: frame.n, atSeconds: frame.atSeconds, dataUri: await small(join(dir, frame.file)) });
  }

  const started = Date.now();
  const pick = validateFramePick(jsonFrom(await chat(env, { ...framePickRequest(env, { still, frames, thinking: !process.argv.includes('--no-think') }), retries: 2 })), frames.length);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n${manifest.name}  (${frames.length} frames shown, ${seconds}s)`);
  console.log(`  kind     ${pick.filmKind}`);
  console.log(`  markers  ${pick.pieceMarkers.join(' · ')}`);
  for (const v of pick.verdicts) {
    const f = frames.find((x) => x.n === v.frame);
    const kept = pick.keep.some((k) => k.frame === v.frame);
    const mark = kept ? 'KEEP' : v.sameAsPiece === false ? 'OTHER' : v.usable === false ? 'unusable' : '';
    console.log(`    #${String(v.frame).padEnd(3)}${String(f?.atSeconds).padStart(6)}s  ${mark.padEnd(9)}${v.subject} | ${v.looks}${kept && v.shows ? '  →  ' + v.shows : ''}`);
  }
  for (const line of pick.overruled) console.log(`  ⚠ overruled: ${line}`);
  console.log(`  why      ${pick.why}`);
};

const main = async () => {
  if (!env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not set (it lives in .env)');
  const given = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const dirs = given.length ? given : DEFAULT_RUNS;
  for (const dir of dirs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await probe(dir);
    } catch (error) {
      console.log(`\n${dir}\n  ❌ ${error.message.slice(0, 400)}`);
    }
  }
};

main();
