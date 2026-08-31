#!/usr/bin/env node
// How is the geometry probe doing?
//
// Reads the run directory rather than the console log, so it works from any terminal, survives
// the session that launched the run, and needs nothing running. Every film the probe finishes is
// written to raw/ immediately — that directory IS the progress.
//
//   node scripts/probe-progress.mjs            # newest run
//   node scripts/probe-progress.mjs --watch    # refresh every 30s
//   node scripts/probe-progress.mjs <runId>

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { costUsd } from './lib/openai-probe.mjs';

const ROOT = 'assets/probes/storyboard-geometry';
const argv = process.argv.slice(2);
const WATCH = argv.includes('--watch');
const ONELINE = argv.includes('--oneline');
const wanted = argv.find((a) => !a.startsWith('--'));

/**
 * Cost is RECOMPUTED from each call's stored token usage, never read back from the costUsd the
 * run wrote. The price table was corrected mid-run (sol was guessed at $12/$68 and verified at
 * $4/$20), so the stored figures are known to be 3.4x too high. Tokens are measured; dollars are
 * derived, and the derivation has to happen at read time to stay honest.
 */
const realCost = (saved, model) =>
  (saved.calls ?? []).reduce((sum, c) => sum + costUsd(model, c.usage), 0);

const newestRun = () => {
  const runs = readdirSync(ROOT).filter((r) => existsSync(`${ROOT}/${r}/matrix.json`));
  if (!runs.length) throw new Error(`no runs with a matrix.json under ${ROOT}`);
  return runs.sort().at(-1);
};

const bar = (done, total, width = 28) => {
  const filled = total ? Math.round((done / total) * width) : 0;
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
};

const report = () => {
  const runId = wanted ?? newestRun();
  const dir = `${ROOT}/${runId}`;
  const matrix = JSON.parse(readFileSync(`${dir}/matrix.json`, 'utf8'));

  const cellIds = Object.keys(matrix.cells);
  const expected = cellIds.length * matrix.fixtures.length * matrix.repeats;

  const files = existsSync(`${dir}/raw`) ? readdirSync(`${dir}/raw`) : [];
  const films = files.map((f) => {
    const saved = JSON.parse(readFileSync(`${dir}/raw/${f}`, 'utf8'));
    const model = matrix.cells[saved.cell]?.model;
    return { ...saved, costUsd: realCost(saved, model), mtime: statSync(`${dir}/raw/${f}`).mtimeMs };
  }).sort((a, b) => a.mtime - b.mtime);

  const spent = films.reduce((s, f) => s + (f.costUsd ?? 0), 0);
  // Reasoning is nested INSIDE completion tokens on OpenAI, and DISJOINT from them on the
  // NVIDIA streaming path — there the two channels are separate and both are estimated from
  // character counts, since Nemotron reports no reasoning-token figure at all. Reporting
  // reasoning as a percentage of output without accounting for that produced "277% reasoning",
  // which is not a number. `usage.estimated` marks the disjoint case.
  const tokens = films.reduce((acc, f) => {
    for (const c of f.calls ?? []) {
      acc.in += c.usage.promptTokens;
      acc.reasoning += c.usage.reasoningTokens;
      // Normalise to the OpenAI convention so one number means one thing across both tiers.
      acc.out += c.usage.estimated
        ? c.usage.completionTokens + c.usage.reasoningTokens
        : c.usage.completionTokens;
      if (c.usage.estimated) acc.estimated = true;
    }
    return acc;
  }, { in: 0, out: 0, reasoning: 0, estimated: false });
  const startedAt = new Date(matrix.startedAt).getTime();
  const elapsedMin = (Date.now() - startedAt) / 60000;
  const perFilm = films.length ? elapsedMin / films.length : null;
  const remaining = perFilm ? (expected - films.length) * perFilm : null;

  const finished = existsSync(`${dir}/scorecard.md`);

  if (ONELINE) {
    const pct = expected ? Math.round((films.length / expected) * 100) : 0;
    const cells = cellIds
      .map((id) => `${id} ${films.filter((f) => f.cell === id).length}/${matrix.fixtures.length * matrix.repeats}`)
      .join('  ');
    console.log(
      `PROBE ${pct}% — ${films.length}/${expected} films · $${spent.toFixed(2)} spent · ` +
      `${elapsedMin.toFixed(0)}m elapsed${remaining && !finished ? `, ~${remaining.toFixed(0)}m left` : ''} · ` +
      `${(tokens.out / 1000).toFixed(0)}k out-tokens${tokens.estimated ? '~' : ''} (${Math.round((tokens.reasoning / Math.max(tokens.out, 1)) * 100)}% reasoning) · ${cells}` +
      `${finished ? '  ✓ FINISHED' : ''}`,
    );
    return finished;
  }

  console.log(`\nrun ${runId}${finished ? '   ✓ FINISHED' : '   … running'}`);
  console.log(`${bar(films.length, expected)} ${films.length}/${expected} films`);
  console.log(`spent $${spent.toFixed(2)} of $${matrix.maxSpend} cap` +
    (perFilm ? `  ·  ${elapsedMin.toFixed(0)} min elapsed, ~${remaining.toFixed(0)} min left at ${perFilm.toFixed(1)} min/film` : ''));

  console.log('\nby cell:');
  for (const id of cellIds) {
    const mine = films.filter((f) => f.cell === id);
    const want = matrix.fixtures.length * matrix.repeats;
    const cost = mine.reduce((s, f) => s + (f.costUsd ?? 0), 0);
    console.log(`  ${id.padEnd(13)} ${String(mine.length).padStart(2)}/${want}  $${cost.toFixed(2).padStart(6)}   ${matrix.cells[id].label.slice(0, 58)}`);
  }

  if (films.length) {
    console.log('\nlast 8 films:');
    for (const f of films.slice(-8)) {
      const beats = f.film?.beats?.length ?? 0;
      console.log(`  ${`${f.cell}/${f.fixture}/r${f.repeat}`.padEnd(40)} ${String(beats).padStart(2)} beats  $${(f.costUsd ?? 0).toFixed(3)}`);
    }
  }

  console.log(
    `tokens: ${(tokens.in / 1000).toFixed(0)}k in, ${(tokens.out / 1000).toFixed(0)}k out ` +
    `(${Math.round((tokens.reasoning / Math.max(tokens.out, 1)) * 100)}% invisible reasoning)` +
    `${tokens.estimated ? '  — estimated from character counts; this provider reports no token usage on a stream' : ''}`,
  );

  if (finished) {
    const verdict = readFileSync(`${dir}/scorecard.md`, 'utf8').split('\n').find((l) => l.includes('VERDICT'));
    console.log(`\n${verdict ?? ''}`);
    console.log(`\nscorecard  ${dir}/scorecard.md`);
    console.log(`scenes     ${dir}/scenes.html`);
  }
  console.log('');
  return existsSync(`${dir}/scorecard.md`);
};

if (WATCH) {
  const tick = async () => {
    process.stdout.write('\x1Bc');
    const done = report();
    if (!done) setTimeout(tick, 30000);
  };
  tick();
} else {
  // Exit 7 when the run is complete, so a shell loop can stop polling without parsing output.
  process.exit(report() ? 7 : 0);
}
