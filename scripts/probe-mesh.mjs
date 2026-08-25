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
// ── FIRST MESH TRIAL — measured 2026-08-25 on a real GPU, recorded so it is not re-run blind ──
//
// Model: TripoSR (single-image, the lightest of the family). Hardware: RTX 4000 Ada 20GB,
// community cloud, $0.20/hr. Total cost of the trial: $0.039 for 13 minutes.
//
// H6 COST AND LATENCY — answered, and an order of magnitude cheaper than projected above:
//   model forward      320ms warm (1450ms on the first image)
//   mesh extraction    ~2.4s   <- dominates; marching cubes at the default 256 resolution
//   background removal ~1.4s per image
//   per mesh, warm     ~4.2s  =  $0.00023 at $0.20/hr
//
// H7 GLB WEIGHT — 1.55MB to 3.57MB, 81k-187k triangles, vertex-coloured. Five in one page is
// ~12MB on top of three.js, which is why the renderer loads a mesh only on expand/orbit.
//
// H5 IS THE PROBLEM, AND THE TRIAL WAS ONLY PARTLY VALID. Four fixtures ran; two of them were
// never a fair test, because rembg failed to isolate a subject and TripoSR was handed a
// RECTANGLE. It duly reconstructed a rectangle: a flat relief slab with an invented black back.
// Read TripoSR's own saved input.png before believing any mesh result — it shows exactly what the
// model was given, and twice here it was not what we thought.
//
//   sneaker    rembg kept the whole white product shot   -> slab. INVALID INPUT, not a verdict.
//   astronaut  rembg kept the whole frame                -> slab. INVALID INPUT.
//   ape-card   rembg correctly isolated THE CARD         -> a card-shaped slab. The medium gate
//              predicted exactly this: the object in a trading card IS the card.
//   lambo      rembg isolated the car cleanly            -> an unrecognisable lumpy blob.
//
// The Lamborghini is the one clean trial: a 3d-render, properly isolated, precisely the case the
// gate says deserves a mesh — and the result is not a car. Under the asset bar (is this honest?)
// that is a failure, not a near miss. One clean trial is not a verdict on image-to-3D; it is a
// verdict on TripoSR, which is the oldest and weakest model of its family.
//
// ── SECOND TRIAL: A HOSTED API, AND THE PREMISE THAT WAS WRONG — 2026-08-25 ──────────────────
//
// THE SELF-HOSTING PUSH WAS BUILT ON A BAD INFERENCE, and it is worth naming precisely because
// it survived a plan, a design review and a deployment before anyone checked it. The measured
// fact was "OpenRouter's catalogue contains no image-to-3D models". That is true. It hardened
// into "therefore the mesh path must be self-hosted", which does not follow and was one search
// away from being disproved: Tripo3D, fal.ai, Replicate and Stability all host image-to-3D.
//
// Tripo3D, image_to_model with texture, 30 credits = $0.30 per mesh:
//
//   lambo      3d-render   PASS  a complete, recognisable car. Coherent front, flank and rear.
//   sneaker    3d-render   PASS  a complete, recognisable shoe from every angle.
//   astronaut  flat-2d     FAIL  a smooth invented egg body with black voids where arms belong.
//   ape-card   card        FAIL  a paper-thin standee: the figure is flat, the card its backing.
//
// H5 PASSES for the mediums the gate admits, and H8 IS CONFIRMED BY THE FAILURES rather than by
// the successes — which is the stronger result. Both control pieces look plausible head-on and
// fall apart on orbit, which is exactly the fraud the medium gate was written to prevent, and
// exactly what could not have been judged from a thumbnail.
//
// THE EARLIER BLOB WAS THE MODEL, NOT THE MEDIUM. TripoSR failed on the same Lamborghini image
// that Tripo3D reconstructs cleanly. A negative result from one model is not a result about the
// capability — a lesson worth more than the $0.04 it cost.
//
// H6  $0.30 per mesh, 56-107s. Self-hosted TripoSR was $0.00023 and 4.2s, and produced blobs;
//     cheapness is not a property worth having on its own.
// H7  WAS FAILING and is now solved. Default output is 8.8-15.7MB at ~500k triangles, which is
//     not loadable in a beat tile. `face_limit: 30000` returns 3.82MB at 102k triangles, and the
//     only visible cost is slightly softer panel lines — invisible at tile size. Always send it.
//
// Parameters confirmed accepted by the task endpoint (they pass validation and fail later on the
// file, where an invalid model_version is rejected outright with code 2017): face_limit, quad,
// texture_quality.

// TO REDEPLOY THE SELF-HOSTED PATH, kept only because the finding above cost more time than
// money to work out and a future round may want it back:
//   pod: template runpod-torch-v240, 40GB container disk, community, ports "22/tcp"
//   nvcc is INSTALLED BUT NOT ON PATH in that image, and torchmcubes silently fails to build
//   without it. export PATH=/usr/local/cuda/bin:$PATH, CUDACXX, CUDA_HOME, TORCH_CUDA_ARCH_LIST.
//   pip install -r requirements.txt ABORTS ENTIRELY when torchmcubes fails, so nothing else
//   installs either — build torchmcubes first, then the requirements, then onnxruntime, which
//   rembg needs and the requirements file does not list.

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
