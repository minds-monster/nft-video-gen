#!/usr/bin/env node
// Render race-launch shots from scripts/launch-prompts.mjs.
//
// Separate from gen-video.mjs so the existing hero pipeline keeps working while this film is
// being built. Writes into assets/renders/ alongside everything else.
//
//   node --env-file=.env scripts/gen-launch.mjs oneshot
//   node --env-file=.env scripts/gen-launch.mjs lambo porsche mclaren launch
//   node --env-file=.env scripts/gen-launch.mjs --spine
//   node --env-file=.env scripts/gen-launch.mjs oneshot --dry-run
//
// Every take is kept: takes accumulate as <name>-1, <name>-2, … so a good earlier render is
// never overwritten by a worse retry.

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { asDataUri, createH3Task, awaitVideo, priceUsd } from './minimax.mjs';
import { SHOTS, SPINE, buildShot } from './launch-prompts.mjs';

const run = promisify(execFile);
const OUT = 'assets/renders';

const nextIndex = async (name) => {
  const files = await readdir(OUT).catch(() => []);
  const pattern = new RegExp(`^${name}-(\\d+)\\.mp4$`);
  const used = files.map((f) => pattern.exec(f)).filter(Boolean).map((m) => Number(m[1]));
  return used.length ? Math.max(...used) + 1 : 1;
};

/**
 * H3 rejects reference images outside aspect [0.4, 2.5] or under 256px on the short side —
 * but only after the task has queued, which costs a poll cycle and the whole run. Check here.
 */
const preflight = async (files) => {
  for (const file of files) {
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
    ]);
    const [w, h] = stdout.trim().split(',').map(Number);
    if (!w || !h) throw new Error(`${file}: could not read dimensions`);
    const aspect = w / h;
    if (aspect < 0.4 || aspect > 2.5) {
      throw new Error(`${file}: aspect ${aspect.toFixed(3)} outside H3's [0.4, 2.5]`);
    }
    if (Math.min(w, h) < 256) throw new Error(`${file}: short side ${Math.min(w, h)}px < 256`);
  }
};

/**
 * Reference mode only — no first/last frame anywhere, because the API refuses to mix them
 * with references and every shot here carries its own. See launch-prompts.mjs rule 2.
 */
const buildContent = async ({ text, referenceImages }) => {
  if (referenceImages.length > 9) {
    throw new Error(`H3 accepts at most 9 reference images, got ${referenceImages.length}`);
  }
  const content = [{ type: 'text', text }];
  for (const file of referenceImages) {
    content.push({ type: 'image_url', role: 'reference_image', image_url: { url: await asDataUri(file) } });
  }
  return content;
};

/**
 * Evenly sampled 6x4 contact sheet.
 *
 * This is load-bearing, not a nicety. The previous attempt's entire architecture was wrong
 * because it was judged from a sheet whose sampling clumped every frame into the opening
 * second, making a full four-beat sequence look like a static tableau. `fps=N` samples
 * evenly; never judge a render from anything else.
 */
const contactSheet = async (mp4, png, duration) => {
  const fps = (24 / duration).toFixed(3); // 24 tiles spread across the whole clip
  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', mp4, '-vf', `fps=${fps},scale=320:-1,tile=6x4`, '-frames:v', '1', png,
  ]);
};

const render = async (name) => {
  const shot = buildShot(name);
  const index = await nextIndex(name);
  const label = `${name}-${index}`;

  console.log(`\n=== ${label}  ${shot.duration}s @ ${shot.resolution}  ${shot.referenceImages.length} refs`);
  console.log(`    refs: ${shot.referenceKeys.join(', ')}`);

  await preflight(shot.referenceImages);

  const config = {
    model: shot.model,
    resolution: shot.resolution,
    duration: shot.duration,
    ratio: shot.ratio,
  };
  const started = Date.now();
  const taskId = await createH3Task({ ...config, content: await buildContent(shot) });
  console.log(`    task ${taskId} — est $${priceUsd(config)?.toFixed(2)}`);

  const { url, usage } = await awaitVideo(taskId, {
    onTick: ({ tick, status }) => {
      if (tick % 3 === 0) process.stdout.write(`    ${status} ${tick * 10}s\r`);
    },
  });

  const mp4 = `${OUT}/${label}.mp4`;
  const response = await fetch(url);
  await writeFile(mp4, Buffer.from(await response.arrayBuffer()));
  await contactSheet(mp4, `${OUT}/${label}.grid.png`, shot.duration);

  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames,duration', '-of', 'csv=p=0', mp4,
  ]);
  const seconds = Math.round((Date.now() - started) / 1000);

  await writeFile(
    `${OUT}/${label}.json`,
    JSON.stringify(
      { ...config, name, referenceKeys: shot.referenceKeys, referenceImages: shot.referenceImages,
        text: shot.text, why: shot.why ?? null, taskId, sourceUrl: url, seconds, usage, probe: stdout.trim() },
      null, 2,
    ),
  );

  console.log(`    → ${mp4}  (${stdout.trim()})  in ${seconds}s`);
  return { label, mp4, grid: `${OUT}/${label}.grid.png`, seconds, cost: priceUsd(config) ?? 0 };
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const names = args.includes('--spine') ? SPINE : args.filter((a) => !a.startsWith('--'));
if (!names.length) {
  console.log(`usage: gen-launch.mjs <shot…> | --spine     shots: ${Object.keys(SHOTS).join(', ')}`);
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

if (dryRun) {
  let total = 0;
  for (const name of names) {
    const shot = buildShot(name);
    total += priceUsd(shot) ?? 0;
    console.log(`\n=== ${name}  ${shot.duration}s @ ${shot.resolution}  refs: ${shot.referenceKeys.join(', ')}`);
    console.log(shot.text);
  }
  console.log(`\n${names.length} shot(s), $${total.toFixed(2)} if run.`);
  process.exit(0);
}

const done = [];
for (const name of names) {
  try {
    done.push(await render(name));
  } catch (error) {
    console.log(`    ✗ ${name}: ${error.message}`);
  }
}

console.log('\n──────── summary');
for (const d of done) console.log(`  ${d.label}  ${d.seconds}s  $${d.cost.toFixed(2)}`);
console.log(`  spend: $${done.reduce((s, d) => s + d.cost, 0).toFixed(2)}`);
console.log('\nVIEW every contact sheet before accepting a take:');
for (const d of done) console.log(`  ${d.grid}`);
