#!/usr/bin/env node
// Render a probe or the hero clip through MiniMax and mirror the result locally.
//
//   npm run gen:video -- --probe ape
//   npm run gen:video -- --probe ape,car,launch,showroom
//   npm run gen:video -- --hero
//   npm run gen:video -- --probe launch --dry-run     # cost + payload shape only
//
// Every render writes three files into assets/renders/ (gitignored):
//   <name>-<n>.mp4       the video
//   <name>-<n>.json      the exact request, so a good render is reproducible
//   <name>-<n>.grid.png  a 3x3 contact sheet, for judging without watching
//
// Reads MINIMAX_API_KEY from .env. That variable is intentionally NOT VITE_-prefixed:
// generation is a build step, never something a visitor's page load triggers.

import { execFile } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { MONTAGE, PROBES, SHOTS } from './hero-prompts.mjs';
import { awaitVideo, createH3Task, createV1Task, h3Content, priceUsd } from './minimax.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'assets/renders');

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const arg = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
};
const dryRun = process.argv.includes('--dry-run');

const jobs = [];

// --shots renders the hero montage: every shot in MONTAGE order, one asset each.
if (process.argv.includes('--shots')) {
  for (const name of MONTAGE) jobs.push({ name: `shot-${name}`, config: SHOTS[name] });
}
for (const name of arg('--shot')?.split(',').map((value) => value.trim()) ?? []) {
  const config = SHOTS[name];
  if (!config) {
    console.error(`Unknown shot "${name}". Available: ${Object.keys(SHOTS).join(', ')}`);
    process.exit(1);
  }
  jobs.push({ name: `shot-${name}`, config });
}
for (const name of arg('--probe')?.split(',').map((value) => value.trim()) ?? []) {
  const config = PROBES[name];
  if (!config) {
    console.error(`Unknown probe "${name}". Available: ${Object.keys(PROBES).join(', ')}`);
    process.exit(1);
  }
  jobs.push({ name, config });
}
if (!jobs.length) {
  console.error(
    'Nothing to render.\n' +
      '  --shots                render the whole hero montage\n' +
      '  --shot <name[,name]>   render individual shots\n' +
      '  --probe <name[,name]>  render a diagnostic probe\n\n' +
      `Shots:  ${Object.keys(SHOTS).join(', ')}\n` +
      `Probes: ${Object.keys(PROBES).join(', ')}`,
  );
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

/** Next free index for a name, so repeat attempts accumulate instead of overwriting. */
const nextIndex = async (name) => {
  const existing = await readdir(outDir).catch(() => []);
  const used = existing
    .map((file) => file.match(new RegExp(`^${name}-(\\d+)\\.mp4$`))?.[1])
    .filter(Boolean)
    .map(Number);
  return used.length ? Math.max(...used) + 1 : 1;
};

/**
 * A 5x3 contact sheet at an even 2fps — enough to judge fidelity, morphing AND whether the
 * shot actually progresses through the beats it was asked for.
 *
 * The even sampling is the important part. This previously used
 * `select='not(mod(n,round(max(1,t))))'`, whose interval grows with `t`, so the samples
 * clumped into the opening second and the rest of the clip was never shown. That produced a
 * badly wrong reading of a good render — a shot that ran a full four-beat sequence looked
 * like a static tableau. Keep it uniform.
 */
const contactSheet = async (mp4, out) => {
  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-i', mp4,
    '-vf', 'fps=2,scale=320:-1,tile=5x3',
    '-frames:v', '1',
    out,
  ]);
};

let spent = 0;

for (const { name, config } of jobs) {
  const index = await nextIndex(name);
  const label = `${name}-${index}`;
  const cost = priceUsd(config);

  console.log(`\n${c.bold}${label}${c.reset} ${c.dim}${config.model} ${config.resolution} ${config.duration}s${c.reset}`);
  if (config.why) console.log(`${c.dim}${config.why}${c.reset}`);
  console.log(`${c.dim}refs: ${(config.referenceImages ?? [config.firstFrameImage]).filter(Boolean).length} · est $${cost?.toFixed(2) ?? '?'}${c.reset}`);

  if (dryRun) {
    console.log(`${c.yellow}dry run — not submitted${c.reset}`);
    console.log(`${c.dim}${config.text.slice(0, 300)}…${c.reset}`);
    continue;
  }

  const startedAt = Date.now();
  let taskId;
  let url;
  try {
    if (config.api === 'v2') {
      const content = await h3Content({
        text: config.text,
        referenceImages: config.referenceImages ?? [],
        firstFrame: config.firstFrame,
        lastFrame: config.lastFrame,
      });
      taskId = await createH3Task({ ...config, content });
    } else {
      taskId = await createV1Task({
        model: config.model,
        prompt: config.text,
        firstFrameImage: config.firstFrameImage,
        lastFrameImage: config.lastFrameImage,
        duration: config.duration,
        resolution: config.resolution,
      });
    }
    console.log(`${c.dim}task ${taskId}${c.reset}`);

    ({ url } = await awaitVideo(taskId, {
      api: config.api,
      onTick: ({ status, elapsedMs }) => {
        if (elapsedMs) process.stdout.write(`\r${c.dim}  ${status} ${Math.round(elapsedMs / 1000)}s${c.reset}   `);
      },
    }));
    process.stdout.write('\r');
  } catch (error) {
    console.log(`${c.red}✗ ${error.message}${c.reset}`);
    continue;
  }

  const mp4 = resolve(outDir, `${label}.mp4`);
  const response = await fetch(url);
  await writeFile(mp4, Buffer.from(await response.arrayBuffer()));

  // Keep the request next to the result — a good render is worthless if we can't repeat it.
  await writeFile(
    resolve(outDir, `${label}.json`),
    `${JSON.stringify({ ...config, taskId, sourceUrl: url, seconds: Math.round((Date.now() - startedAt) / 1000) }, null, 2)}\n`,
  );

  const grid = resolve(outDir, `${label}.grid.png`);
  await contactSheet(mp4, grid).catch((error) =>
    console.log(`${c.yellow}  contact sheet failed: ${error.message}${c.reset}`),
  );

  spent += cost ?? 0;
  console.log(
    `${c.green}✓${c.reset} ${label}.mp4 ${c.dim}in ${Math.round((Date.now() - startedAt) / 1000)}s${c.reset}`,
  );
  console.log(`${c.dim}  ${grid.replace(`${root}/`, '')}${c.reset}`);
}

if (!dryRun) console.log(`\n${c.bold}Spent ≈ $${spent.toFixed(2)}${c.reset}\n`);
