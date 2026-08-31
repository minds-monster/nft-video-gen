#!/usr/bin/env node
// Give every piece that can honestly have a mesh, a mesh.
//
// DRY RUN IS THE DEFAULT, and here that matters more than it does for the profile backfill: this
// one spends real money. --write is required, and the dry run prices the exact set it would
// generate before a single credit moves.
//
// THE GATE IS THE BUDGET. Roughly half a library never generates anything — a flat 2D vector has
// no back and a trading card reconstructs as a card — so the bill is set by what the artwork
// actually is, not by how many pieces there are. Refusals are recorded rather than skipped, and
// they cost nothing, so running this over the whole store is cheap even when most of it is
// ineligible.
//
// GENERATION IS A JOB. Each piece is started, then collected on a later poll (see worker/mesh.js
// for why: a 56-107s task held open inside one request loses its work to any reload, eviction or
// deploy). This script therefore starts a batch, then polls until the batch is done, rather than
// waiting on each piece in turn.
//
//   node --env-file-if-exists=.env scripts/backfill-meshes.mjs               # price it, $0
//   node --env-file-if-exists=.env scripts/backfill-meshes.mjs --write
//   node --env-file-if-exists=.env scripts/backfill-meshes.mjs --write --limit 5
//
// Needs the Worker running (`npm run dev:worker`) and TRIPO3D_API_KEY in .dev.vars. Pieces
// without a v5 dossier are skipped and reported: run scripts/backfill-profiles.mjs first.

import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(`--${flag}`);
const value = (flag, fallback) => {
  const at = argv.indexOf(`--${flag}`);
  return at === -1 ? fallback : argv[at + 1];
};

const WRITE = has('write');
const REMOTE = has('remote');
const BASE = value('base', 'http://localhost:8789');
const LIMIT = Number(value('limit', Infinity));
const DOSSIER_VERSION = 5;

// 30 credits per textured image_to_model, and 100 credits to the dollar.
const CREDITS_PER_MESH = 30;
const CREDITS_PER_USD = 100;

const MESH_MEDIUMS = new Set(['3d-render', 'photoreal']);

const kv = (args) =>
  execFileSync('npx', ['wrangler', 'kv', ...args, '--binding', 'DOSSIERS', REMOTE ? '--remote' : '--local'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

const listKeys = () => {
  const out = kv(['key', 'list']);
  return JSON.parse(out.slice(out.indexOf('['))).map((entry) => entry.name);
};

const readJson = (key) => {
  try {
    const raw = kv(['key', 'get', key]);
    return JSON.parse(raw.slice(raw.indexOf('{')));
  } catch {
    return null;
  }
};

const balance = async () => {
  const key = process.env.TRIPO3D_API_KEY;
  if (!key) throw new Error('TRIPO3D_API_KEY is not set (it lives in .env)');
  const response = await fetch('https://api.tripo3d.ai/v2/openapi/user/balance', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return (await response.json())?.data?.balance ?? 0;
};

// ─────────────────────────────────────────────────────────────────────────────── survey

const keys = listKeys();
const dossiers = keys
  .filter((key) => key.startsWith(`dossier:v${DOSSIER_VERSION}:`))
  .map((key) => ({ key, record: readJson(key) }))
  .filter((entry) => entry.record);

const meshed = new Set(keys.filter((key) => key.startsWith('castmesh:')).map((key) => key.split(':').slice(2).join(':')));

const eligible = [];
const refused = [];
for (const { record } of dossiers) {
  if (meshed.has(record.key)) continue;
  (MESH_MEDIUMS.has(record.medium) ? eligible : refused).push(record);
}

const older = keys.filter((key) => /^dossier:v[1-4]:/.test(key)).length;

console.log(`Store: ${dossiers.length} piece(s) at dossier v${DOSSIER_VERSION}, ${REMOTE ? 'remote' : 'local'}.`);
if (older) console.log(`  ${older} older dossier(s) have no physical profile — run scripts/backfill-profiles.mjs to include them.`);
console.log(`  already decided: ${meshed.size}`);
console.log(`  would generate:  ${eligible.length}`);
console.log(`  would refuse:    ${refused.length}  (recorded, costs nothing)`);

const planned = eligible.slice(0, Number.isFinite(LIMIT) ? LIMIT : eligible.length);
const credits = planned.length * CREDITS_PER_MESH;
const have = await balance();

console.log(`\nCost: ${credits} credits = $${(credits / CREDITS_PER_USD).toFixed(2)}. Balance: ${have} credits.`);
if (credits > have) {
  console.log(`  ⚠ SHORT BY ${credits - have} credits ($${((credits - have) / CREDITS_PER_USD).toFixed(2)}). Top up, or use --limit ${Math.floor(have / CREDITS_PER_MESH)}.`);
}

if (!WRITE) {
  console.log('\n--dry-run is the default: nothing has been generated.');
  for (const record of planned.slice(0, 15)) console.log(`  ${record.medium.padEnd(12)} ${record.key}`);
  if (planned.length > 15) console.log(`  ... and ${planned.length - 15} more`);
  console.log(`\nRun it with:  node --env-file-if-exists=.env scripts/backfill-meshes.mjs --write`);
  process.exit(0);
}

if (credits > have) {
  console.log('\nRefusing to start a batch that cannot finish. Nothing spent.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────── start, then collect

console.log(`\nStarting ${planned.length} job(s)...\n`);
const started = [];
for (const record of planned) {
  const response = await fetch(`${BASE}/api/cast/mesh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset: record.key }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    console.log(`  ✘ ${record.key}: ${body.error ?? response.status}`);
    // Out of credit mid-batch stops the batch: every further call would fail the same way.
    if (body.outOfCredit) break;
    continue;
  }
  console.log(`  → ${record.key} ${body.status}${body.taskId ? ` (${body.taskId.slice(0, 8)})` : ''}`);
  if (body.status === 'pending') started.push(record.key);
}

if (!started.length) {
  console.log('\nNothing is pending.');
  process.exit(0);
}

console.log(`\nCollecting ${started.length} job(s). Each takes about a minute and a half.\n`);
const outstanding = new Set(started);
const failures = [];

while (outstanding.size) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  for (const assetKey of [...outstanding]) {
    const response = await fetch(`${BASE}/api/cast/mesh?asset=${encodeURIComponent(assetKey)}`);
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('gltf')) {
      const mb = (Number(response.headers.get('x-mesh-bytes') ?? 0) / 1048576).toFixed(2);
      console.log(`  ✔ ${assetKey}  ${mb} MB`);
      outstanding.delete(assetKey);
      continue;
    }
    const body = await response.json().catch(() => ({}));
    if (body.status === 'failed' || body.status === 'absent') {
      console.log(`  ✘ ${assetKey}: ${body.reason ?? body.status}`);
      failures.push(assetKey);
      outstanding.delete(assetKey);
    }
  }
}

console.log(`\nDone. ${started.length - failures.length} mesh(es) stored, ${failures.length} failed.`);
console.log(`Credits left: ${await balance()}`);
if (failures.length) process.exit(1);
