// The cast as geometry: one mesh per piece, generated once and kept forever.
//
// WHY A HOSTED API AND NOT OUR OWN GPU. Because the reason to self-host turned out not to exist.
// The measured fact was that OpenRouter's catalogue has no image-to-3D models, and that hardened
// into "so we must host one" — which does not follow. Tripo3D, fal.ai, Replicate and Stability
// all serve this. A GPU endpoint was deployed and torn down before anyone checked. See
// scripts/probe-mesh.mjs for the full post-mortem; the transferable part is that a measurement
// about ONE provider is not a measurement about the capability.
//
// THE MEDIUM GATE IS ENFORCED HERE, AND IT IS THE POINT OF THIS MODULE.
//
// A mesh is not a rendering upgrade that has to look better than a cut-out. It is a product
// asset — the thing an x402 bundle sells alongside the impostor, the Casting Director's notes and
// the ownership record — so the bar is "is this valid to sell as a portable, identity-bearing
// artifact", which is a question about correctness rather than beauty.
//
// Measured on real pieces, 2026-08-25, and this is why the gate is not negotiable:
//
//   3d-render car      a complete, recognisable car from front, flank and rear      SHIP
//   3d-render sneaker  a complete, recognisable shoe from every angle               SHIP
//   flat-2d astronaut  a smooth INVENTED egg body, black voids where arms belong    REFUSE
//   trading-card ape   a paper-thin standee, the card as its backing plane          REFUSE
//
// Both refusals look completely plausible head-on and fall apart on orbit. That is the failure
// this gate exists to prevent: not an ugly mesh, but a convincing one that quietly fabricates a
// third dimension the source artwork never had, and ships it under the artist's name.
//
// INELIGIBILITY IS RECORDED, NEVER LEFT AS A GAP. A piece that gets no mesh gets a record saying
// so and why. A format that can only express absence by omission cannot be honest about it — the
// bundle has to be able to say "this piece has no mesh, and here is the reason".

const R2_PREFIX = 'cast';
const MESH_VERSION = 1;

/** Which mediums admit volumetric reconstruction. Hard-coded from the dossier schema, stated
 * before the probe ran, and confirmed by it. No classifier ever picks this per asset. */
const MESH_MEDIUMS = new Set(['3d-render', 'photoreal']);

/**
 * The polygon budget, and it is load-bearing rather than a preference.
 *
 * Tripo's default output is 8.8-15.7MB at around 500k triangles, which is not loadable in a beat
 * tile beside three.js and four other cast members. At face_limit 30000 the same car comes back
 * at 3.82MB and 102k triangles, and the only visible difference is slightly softer panel lines —
 * invisible at the size a storyboard frame is actually looked at.
 */
const FACE_LIMIT = 30000;

const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const ASSET_KEY = /^[a-z0-9-]{1,32}:0x[a-fA-F0-9]{40}:[A-Za-z0-9_-]{1,96}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const meshRecordKey = (assetKey) => `castmesh:v${MESH_VERSION}:${assetKey}`;
export const meshR2Key = (assetKey) => `${R2_PREFIX}/${assetKey}/v${MESH_VERSION}/mesh.glb`;

/**
 * Whether this piece may have a mesh at all, and — when it may not — the reason in words a
 * visitor could read.
 *
 * Exported and pure so the same decision can be made in the renderer, in a backfill and in a
 * test without any of them re-deriving it.
 */
export const meshEligibility = (dossier) => {
  const medium = dossier?.medium ?? null;
  if (!medium) return { eligible: false, reason: 'This piece has no dossier yet, so nothing is known about what it is.' };
  if (MESH_MEDIUMS.has(medium)) return { eligible: true, reason: null, medium };
  return {
    eligible: false,
    medium,
    reason:
      medium === 'trading-card'
        ? 'The artwork is a card, so a reconstruction would model the card rather than the subject on it — measured, and it comes back as a paper-thin standee.'
        : `A ${medium} piece has no back. A reconstruction would invent one, and an invented back is a fabrication wearing the artwork's name.`,
  };
};

// ─────────────────────────────────────────────────────────────────────── the Tripo transport

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';

export class TripoError extends Error {
  constructor(code, message) {
    super(`Tripo ${code}: ${message}`);
    this.name = 'TripoError';
    this.code = code;
    // 2010 is "not enough credit" — an account state needing a person, not a retry.
    this.outOfCredit = code === 2010;
  }
}

const requireKey = (env) => {
  const key = env.TRIPO3D_API_KEY;
  if (!key) {
    throw new Error(
      'TRIPO3D_API_KEY is not set. Locally it goes in .env (scripts read it there) AND .dev.vars ' +
        '(so `wrangler dev` can see it); in production use `wrangler secret put TRIPO3D_API_KEY`.',
    );
  }
  return key;
};

/**
 * Start a generation and return its handle. Does NOT wait for it.
 *
 * A MESH TAKES 56-107 SECONDS AND NO REQUEST SHOULD BE HOLDING THAT OPEN. Learned here the
 * expensive way: the first version awaited the whole task inside one SSE response, and the local
 * server reloaded mid-flight seven times over one afternoon. Each reload killed the in-flight
 * request, and each killed request abandoned a generation that had already been charged for —
 * $0.60 of meshes that were made and then dropped on the floor.
 *
 * A dev-server reload is the harmless version of the real thing: a Worker eviction, a deploy, a
 * closed tab. Any of them ends a long-held request, and the same handover that flagged "a closed
 * tab still destroys a run" said what the fix is — make it a job. So this call is short and
 * idempotent, the task id is written down BEFORE anything can go wrong, and `collectMesh` below
 * finishes the work on some later, equally short request.
 */
const startMeshTask = async (env, imageBytes) => {
  const headers = { Authorization: `Bearer ${requireKey(env)}` };

  const form = new FormData();
  form.append('file', new Blob([imageBytes], { type: 'image/png' }), 'input.png');
  const uploaded = await tripoJson(fetch(`${TRIPO_BASE}/upload`, { method: 'POST', headers, body: form }));
  if (uploaded.code !== 0) throw new TripoError(uploaded.code, uploaded.message ?? 'upload failed');

  const created = await tripoJson(
    fetch(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'image_to_model',
        file: { type: 'png', file_token: uploaded.data?.image_token },
        texture: true,
        face_limit: FACE_LIMIT,
      }),
    }),
  );
  if (created.code !== 0) throw new TripoError(created.code, created.message ?? 'task rejected');
  return created.data?.task_id;
};

/**
 * Tripo's responses are not always JSON.
 *
 * Measured: a status call came back as an HTML error page mid-task, and an unguarded .json()
 * threw and took a paid generation with it. Anything that is not JSON is a transport failure to
 * be retried, never a result to be parsed.
 */
const tripoJson = async (promise) => {
  const response = await promise;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    throw new TripoError(0, `expected JSON, got ${contentType || 'nothing'} (HTTP ${response.status})`);
  }
  return response.json();
};

/** Where a running task has got to. Never throws for a task still in progress. */
export const pollMeshTask = async (env, taskId) => {
  const headers = { Authorization: `Bearer ${requireKey(env)}` };
  const polled = await tripoJson(fetch(`${TRIPO_BASE}/task/${taskId}`, { headers }));
  const task = polled.data ?? {};
  return {
    status: task.status ?? 'unknown',
    progress: task.progress ?? 0,
    modelUrl: task.output?.pbr_model || task.output?.model || null,
  };
};

// ─────────────────────────────────────────────────────────── the job, and its two short halves

const dossierFor = async (env, assetKey, version) =>
  env.DOSSIERS ? env.DOSSIERS.get(`dossier:v${version}:${assetKey}`, 'json') : null;

/** The same candidate walk worker/cast-art.js uses — dead IPFS gateways and hotlink-protected
 * CDNs are why this is a list rather than a URL. */
const fetchArtworkBytes = async (dossier) => {
  const errors = [];
  for (const url of dossier.sourceImageUrls ?? []) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      errors.push(`${url.slice(0, 50)}: ${error.message}`);
    }
  }
  throw new Error(`Could not fetch the artwork: ${errors.join(' | ')}`);
};

const putRecord = async (env, assetKey, record) => {
  await env.DOSSIERS?.put(meshRecordKey(assetKey), JSON.stringify(record));
  return record;
};

/**
 * PHASE ONE: decide, and if a mesh is warranted, start the task and write down its handle.
 *
 * Short by construction. The record is persisted the moment the task exists, so a generation can
 * never again be paid for and then lost because the request that started it went away.
 */
export const requestMesh = async (env, assetKey, { dossierVersion = 5, force = false } = {}) => {
  const existing = await env.DOSSIERS?.get(meshRecordKey(assetKey), 'json');
  if (existing && !force && existing.status !== 'failed') return { ...existing, cached: true };

  const dossier = await dossierFor(env, assetKey, dossierVersion);
  const gate = meshEligibility(dossier);
  const base = { assetKey, meshVersion: MESH_VERSION, medium: gate.medium ?? null, createdAt: Date.now() };

  // A refusal is a first-class record, not an absence. The bundle has to be able to say why a
  // piece has no mesh, and roughly half the library is in this branch.
  if (!gate.eligible) {
    return { ...(await putRecord(env, assetKey, { ...base, status: 'ineligible', meshEligible: false, reason: gate.reason, r2Key: null })), cached: false };
  }

  const bytes = await fetchArtworkBytes(dossier);
  const taskId = await startMeshTask(env, bytes);

  return {
    ...(await putRecord(env, assetKey, {
      ...base,
      status: 'pending',
      meshEligible: true,
      reason: null,
      taskId,
      r2Key: null,
      faceLimit: FACE_LIMIT,
      // Provenance recorded with the job rather than after it: this mesh derives from this URL,
      // stated before there is a mesh to attach it to.
      sourceUrl: dossier.sourceImageUrls?.[0] ?? null,
      model: 'tripo3d/image_to_model',
    })),
    cached: false,
  };
};

/**
 * PHASE TWO: if the task has finished, bring the bytes home.
 *
 * Also short, also idempotent, and safe to call as often as anyone likes — two callers racing
 * both store identical bytes under the same key, which is a waste of one download and nothing
 * worse.
 */
export const collectMesh = async (env, assetKey) => {
  const record = await env.DOSSIERS?.get(meshRecordKey(assetKey), 'json');
  if (!record || record.status !== 'pending') return record ?? null;

  let task;
  try {
    task = await pollMeshTask(env, record.taskId);
  } catch (error) {
    // A transport failure is not a failed generation. The task id is on the record, so the next
    // caller tries again rather than the mesh being written off.
    return { ...record, pollError: error.message };
  }

  if (['failed', 'banned', 'expired', 'cancelled'].includes(task.status)) {
    return putRecord(env, assetKey, { ...record, status: 'failed', reason: `The generation ended as ${task.status}.` });
  }
  if (task.status !== 'success' || !task.modelUrl) {
    return { ...record, progress: task.progress };
  }

  const glb = new Uint8Array(await (await fetch(task.modelUrl)).arrayBuffer());
  const r2Key = meshR2Key(assetKey);
  await env.STORYBOARD_IMAGES?.put(r2Key, glb, {
    httpMetadata: { contentType: 'model/gltf-binary' },
    customMetadata: { assetKey, sourceUrl: record.sourceUrl ?? '', taskId: record.taskId },
  });

  return putRecord(env, assetKey, { ...record, status: 'ready', r2Key, bytes: glb.byteLength, readyAt: Date.now() });
};

// ─────────────────────────────────────────────────────────────────────── routes

/**
 * A record's state, derived when it is not written down.
 *
 * `status` arrived after the first records did, and a record without one still says everything
 * needed to work it out: no mesh allowed, or bytes already in R2. Deriving it is two lines and
 * costs nothing, where the alternative — bumping the version so old records are never read —
 * would orphan meshes that have already been paid for. Version bumps are right when a shape
 * change makes old data WRONG; this one only makes it terser.
 */
const normalise = (record) => {
  if (!record || record.status) return record;
  if (record.meshEligible === false) return { ...record, status: 'ineligible' };
  if (record.r2Key) return { ...record, status: 'ready' };
  return { ...record, status: 'absent' };
};

/**
 * One cast member's mesh, or an honest account of where it has got to.
 *
 * Collects a finished job on the way past — so the thing that finalises a generation is an
 * ordinary short request, and no long-lived one has to survive for a mesh to arrive.
 */
export async function handleCastMesh(request, env) {
  const { searchParams } = new URL(request.url);
  const assetKey = searchParams.get('asset');
  if (!assetKey || !ASSET_KEY.test(assetKey)) {
    return json({ error: 'asset must be a chain:address:tokenId key' }, 400);
  }

  const record = normalise(await collectMesh(env, assetKey));
  if (!record) return json({ status: 'absent', assetKey }, 404);

  // 200 for a refusal, deliberately: "this piece does not get a mesh, and here is why" is the
  // correct answer for about half the library, not a failure to serve one.
  if (record.status === 'ineligible') {
    return json({ status: 'ineligible', assetKey, medium: record.medium, reason: record.reason });
  }
  if (record.status === 'pending') {
    return json({ status: 'pending', assetKey, progress: record.progress ?? 0, taskId: record.taskId });
  }
  if (record.status === 'failed') return json({ status: 'failed', assetKey, reason: record.reason }, 502);

  const object = await env.STORYBOARD_IMAGES?.get(record.r2Key);
  if (!object) return json({ status: 'absent', assetKey }, 404);

  return new Response(object.body, {
    headers: {
      'content-type': 'model/gltf-binary',
      'cache-control': CACHE_CONTROL,
      'access-control-allow-origin': '*',
      'x-source-url': record.sourceUrl ?? '',
      'x-mesh-bytes': String(record.bytes ?? 0),
    },
  });
}

/** Start one. Returns as soon as the task has a handle, which is the whole point — see
 * requestMesh. Polling for the result is what GET is for. */
export async function handleCastMeshGenerate(request, env) {
  const body = await request.json().catch(() => ({}));
  const { asset, force = false } = body;
  if (!asset || !ASSET_KEY.test(asset)) return json({ error: 'Body needs { asset }' }, 400);
  try {
    return json(await requestMesh(env, asset, { force }));
  } catch (error) {
    return json({ error: error.message, outOfCredit: Boolean(error.outOfCredit) }, error.outOfCredit ? 402 : 500);
  }
}
