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

// ── THE APE PASS: THE GATE IS JUDGING THE WRONG THING — measured 2026-08-25 ──────────────────
//
// The adidas "Into the Metaverse" ape is `trading-card`, so the medium gate refuses it a mesh,
// and the refusal was correct on the evidence it had: a mesh built from that still comes back as
// a paper-thin standee with the card's reverse for a back.
//
// But the token also carries a 16.8s 1920x1920 film, and the Casting Director's own motion pass
// describes it exactly: "The character model rotates 360 degrees on a platform, then flips to
// reveal the back of the card." The artist shot a turntable. One frame of it, cropped to the
// character, produces a free-standing figure with real depth in profile, a properly formed back,
// and no card anywhere. Same token, same artist, same character, $0.30 each:
//
//   from the STILL (the card)      a paper-thin standee, 296k triangles, card reverse as its back
//   from a VIDEO FRAME (the ape)   a figure in the round, 101k triangles, no card at all
//
// THE FINDING IS NOT "USE VIDEO". It is that the gate is a property of the STILL when it should
// be a property of the best available VIEW of the subject. `medium` describes how the artwork is
// presented; it was standing in for "can this be reconstructed", and for a piece whose still is a
// card and whose film is a turntable those two answers differ.
//
// AND THE DISTINCTION THAT MUST NOT BE LOST: this works because the extra views are REAL. They
// are frames the artist rendered, not angles a model invented. Asking a video model to orbit a
// still would produce something that looks the same and is fabricated — the same trap the gate
// exists to catch, moving one step upstream. Real footage is evidence; generated footage is
// inference wearing evidence's clothes.
//
// What the film does NOT give: past about 110 degrees the card occludes the character, so the
// usable coverage is the front hemisphere rather than a true 360. Tripo's `multiview_to_model`
// task type is confirmed valid and is the obvious next step for the angles that do exist.

// ── THE JACKET PASS: VIDEO IS NOT A FREE UPGRADE — measured 2026-08-25 ───────────────────────
//
// D&G Collezione Genesi, "The Golden Impossible Jacket". `3d-render`, so the gate ALLOWS a mesh,
// and `isMannequin` correctly true. Its film pans around the mannequin to show the back — so
// unlike the ape, this is a piece where the pipeline already succeeds and the film offers extra
// real angles on top. The obvious next move is multiview. It made things WORSE:
//
//   STILL only (the pipeline)          a clean, complete jacket, coherent from all four sides
//   MULTIVIEW front+side+back (film)   lumpy, distorted sleeves, muddy form, a spurious flap
//
// Three reasons, and only the third is a fact about multiview itself:
//   1. RESOLUTION. The film is 500x500; cropped to the garment it is ~300px. The still is
//      high-res. More angles at a quarter of the detail is a bad trade.
//   2. LIGHTING. The front frame is dim, the back frame is brightly lit gold, the side is warm.
//      Multiview reconstruction assumes a subject that looks the same from every angle, and a
//      cinematic film is lit to do the opposite.
//   3. AZIMUTH. The slots are front/left/back/right and I supplied a three-quarter as "left".
//      Views that are not where the model is told they are corrupt the reconstruction.
//
// SO THE RULE IS NOT "VIDEO BEATS STILLS". Put beside the ape result it is much narrower and much
// more useful:
//
//   video WINS when the still shows the wrong thing — a card, a busy composite, an occluded
//   subject. The ape's still is a card; one film frame gave the character in the round.
//
//   video LOSES when the still is already a clean, high-res, well-lit view of the right subject.
//   Then the film is a lower-resolution, differently-lit second opinion and it drags quality down.
//
// The discriminator is therefore NOT "does a film exist" but "is the still a good view of the
// subject" — which the dossier already half-answers with `framing` and `medium`. Note also that
// (1) and (2) are properties of THIS film rather than of multiview, so a piece whose film is
// high-res and evenly lit deserves re-testing before the approach is written off.

// ── THE MANNEQUIN IS SCAFFOLDING, AND IT IS REMOVABLE — measured 2026-08-25 ──────────────────
//
// The point of a garment is that a character wears it, so a mannequin bust standing in a beat is
// the wrong subject twice over: it is not the piece, and it is not a person.
//
// The pipeline mesh of the D&G jacket bakes the mannequin's head, hands and legs in as ONE
// CONTINUOUS SURFACE with the jacket — visible immediately in wireframe. That is the answer to
// "can it be removed afterwards": no. There is no mannequin object to delete, only geometry that
// happens to be head-shaped, and cutting it would leave a hole somebody has to invent a fix for.
//
// Removing it from the SOURCE works, and it takes two steps rather than one:
//
//   full still       jacket + chrome head + hands + legs, one closed surface
//   rectangle crop   head and legs gone — but the chrome NECK survives inside the collar,
//                    because a rectangle cannot follow the edge of a garment
//   hue key          the neck gone too. The bust is blue and the garment is gold, so
//                    "blue dominates red" separates them with an enormous margin, and it
//                    catches nothing but a few blue sequins.
//
// THE COLOUR IS THE INTELLIGENCE, NOT THE RECTANGLE. A box is a guess about where the subject is;
// a hue rule is a statement about what the subject is MADE OF, and it follows the garment's own
// outline for free. Where the discriminator comes from is already in the dossier — `palette` is
// the garment's colours, and anything markedly outside it in the collar region is scaffolding.
// Making that systematic means one more field from a pass that is already looking at the image,
// asked for only when `isMannequin` is true.
//
// AND A CEILING WORTH KNOWING: the collar still closes over. Tripo returns CLOSED SHELLS, so
// there is no true neck opening to be had from any amount of masking — only a choice of what
// colour the collar closes with. Masking decides what is in the mesh; it cannot decide that the
// mesh has a hole.
//
// TWO LIMITS WORTH STATING BEFORE ANYONE CALLS THIS SOLVED:
//
//   1. It is still a SHELL, not a wearable. The mesh is a jacket-shaped solid with no inside and
//      no seams. It can be PLACED on a character at the right scale, which is all a previz frame
//      needs; it cannot be WORN. A garment that drapes is a rigged-and-simulated asset, a
//      different class of thing entirely, and no image-to-3D call produces one.
//   2. The crop here was chosen by hand. Automating it needs a subject box that excludes the
//      mannequin — which is the same free vision call probed at the start of stage B, where the
//      model returned a normalised bounding box and a flat-background verdict for $0.
//
// The dossier already knows this piece is a garment on a bust: `isMannequin` is true, and it has
// been true since round 1, where it exists to warn the Screenwriter that "the chrome is the most
// salient thing in the reference and comes along into the render". The same flag should gate the
// crop. The schema saw this coming; nothing has acted on it yet.
//
// It also connects to the open `wornBy` item: a jacket in a scene is not a free-standing subject
// but something a character is wearing, and the scene schema currently has only `containerId` (a
// driver in a car) to say so with. A garment mesh without a wearer to attach to is an asset with
// nowhere to go.

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
