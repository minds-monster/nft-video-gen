#!/usr/bin/env node
// Stage C: the mesh as a product asset. Cost first, spend second.
//
// DRY RUN IS THE DEFAULT and it needs no endpoint, no GPU and no credit. It answers the question
// that has to be answered before anything is deployed: how many pieces would ever get a mesh, and
// what would that cost. Everything it reports is either measured from the live account or
// arithmetic over stated assumptions you can check.
//
// THE ELIGIBILITY COUNT IS THE REAL COST CONTROL, not the per-second rate. The medium gate means
// roughly half a library never generates a mesh at all — a flat 2D vector has no back, and a
// reconstruction model would invent one. Pieces that cost nothing because they are never
// generated are a bigger saving than any GPU choice.
//
//   node --env-file-if-exists=.env scripts/probe-mesh.mjs              # cost model, $0
//   node --env-file-if-exists=.env scripts/probe-mesh.mjs --gpu "NVIDIA RTX A4000"
//
// H5-H8 (is the mesh honest, what does it really cost, how heavy is the GLB, does medium predict
// honesty) need a deployed endpoint and are added here once one exists.

import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const value = (flag, fallback) => {
  const at = argv.indexOf(`--${flag}`);
  return at === -1 ? fallback : argv[at + 1];
};

// Which mediums admit volumetric reconstruction. Stated here as the single source of the gate,
// hard-coded from the dossier schema and never learned per asset.
const MESH_MEDIUMS = new Set(['3d-render', 'photoreal']);

// ── the assumptions, all in one place so they can be argued with ─────────────────────────────
//
// Every one of these is a guess until H6 measures it on a real endpoint. They are stated as a
// band rather than a number because a single figure would read as knowledge.
const ASSUMPTIONS = {
  // RunPod serverless flex, 16-24GB class. Their pod on-demand rate for this class is ~$0.17/hr
  // ($0.000047/s); serverless carries a premium over that, so the band starts well above it.
  usdPerSecond: { low: 0.00016, high: 0.00024 },
  // TripoSR-class forward pass plus mesh extraction, on that GPU class.
  executionSeconds: { low: 5, high: 15 },
  // Container pull and weight load, paid once per worker spin-up rather than per job.
  coldStartSeconds: { low: 20, high: 60 },
  // How many jobs share one cold start when a batch runs back to back.
  jobsPerColdStart: 10,
};

// Enough significant figures for the number to still be a number. A per-second rate rounded to
// four decimal places prints a band as "$0.0002-$0.0002", which reads as a measurement rather
// than the range it actually is.
const usd = (n) => {
  if (n === 0) return '$0';
  const places = Math.abs(n) < 0.001 ? 5 : Math.abs(n) < 0.01 ? 4 : 2;
  return `$${n.toFixed(places)}`;
};

const perPiece = (rate, exec, cold) => rate * (exec + cold / ASSUMPTIONS.jobsPerColdStart);

const graphql = async (query) => {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) throw new Error('RUNPOD_API_KEY is not set (it lives in .env)');
  const response = await fetch('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await response.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 300));
  return body.data;
};

/** Every cached dossier's medium, straight from the local store. */
const library = () => {
  const list = execFileSync('npx', ['wrangler', 'kv', 'key', 'list', '--binding', 'DOSSIERS', '--local'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const keys = JSON.parse(list.slice(list.indexOf('['))).map((entry) => entry.name);
  const mediums = [];
  for (const key of keys) {
    const raw = execFileSync('npx', ['wrangler', 'kv', 'key', 'get', key, '--binding', 'DOSSIERS', '--local'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    try {
      mediums.push(JSON.parse(raw.slice(raw.indexOf('{'))).medium ?? '(none)');
    } catch {
      mediums.push('(unreadable)');
    }
  }
  return mediums;
};

// ── report ───────────────────────────────────────────────────────────────────────────────────

console.log('RunPod account');
const me = (await graphql('query { myself { clientBalance currentSpendPerHr } }')).myself;
const balance = me?.clientBalance ?? 0;
console.log(`  balance          ${usd(balance)}`);
console.log(`  spending now     ${usd(me?.currentSpendPerHr ?? 0)}/hr`);
if (balance <= 0) {
  console.log('  ⚠ NEGATIVE — workers will not run until the account is topped up. Nothing below can execute.');
}

const wanted = value('gpu', 'NVIDIA RTX A4000');
const gpus = (await graphql('query { gpuTypes { id displayName memoryInGb lowestPrice(input:{gpuCount:1}) { uninterruptablePrice } } }')).gpuTypes;
const gpu = gpus.find((g) => g.id === wanted);
if (gpu) {
  console.log(`\nGPU  ${gpu.displayName} (${gpu.memoryInGb}GB)`);
  console.log(`  pod on-demand    ${usd(gpu.lowestPrice?.uninterruptablePrice ?? 0)}/hr  (serverless carries a premium over this)`);
}

const mediums = library();
const counts = mediums.reduce((acc, m) => ({ ...acc, [m]: (acc[m] ?? 0) + 1 }), {});
const eligible = mediums.filter((m) => MESH_MEDIUMS.has(m)).length;

console.log(`\nLibrary  ${mediums.length} cached dossier(s)`);
for (const [medium, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  const gated = MESH_MEDIUMS.has(medium) ? 'mesh' : 'card only';
  console.log(`  ${String(n).padStart(3)}  ${medium.padEnd(16)} ${gated}`);
}
console.log(`\n  mesh-eligible under the gate: ${eligible} of ${mediums.length} (${Math.round((eligible / mediums.length) * 100)}%)`);
console.log(`  never generated, so never billed: ${mediums.length - eligible}`);

const { usdPerSecond: rate, executionSeconds: exec, coldStartSeconds: cold } = ASSUMPTIONS;
const low = perPiece(rate.low, exec.low, cold.low);
const high = perPiece(rate.high, exec.high, cold.high);

console.log('\nProjected cost — ASSUMPTIONS, not measurements. H6 replaces these with real numbers.');
console.log(`  rate         ${usd(rate.low)}-${usd(rate.high)} per GPU-second`);
console.log(`  execution    ${exec.low}-${exec.high}s per mesh`);
console.log(`  cold start   ${cold.low}-${cold.high}s, shared across ~${ASSUMPTIONS.jobsPerColdStart} jobs in a batch`);
console.log(`\n  per mesh                 ${usd(low)} - ${usd(high)}`);
console.log(`  whole library (${eligible})       ${usd(low * eligible)} - ${usd(high * eligible)}`);
console.log(`  probe, ~20 generations   ${usd(low * 20)} - ${usd(high * 20)}`);
console.log('\nFor comparison, measured rather than assumed:');
console.log('  the AI cut-out probed for stage B cost $0.0391 for ONE image — an order of');
console.log('  magnitude more than a whole mesh is projected to cost here.');
