// The cast as geometry: one mesh per piece, generated once and kept forever.
//
// WHY A HOSTED API AND NOT OUR OWN GPU. Because the reason to self-host turned out not to exist.
// The measured fact was that OpenRouter's catalogue has no image-to-3D models, and that hardened
// into "so we must host one" — which does not follow. Tripo3D, fal.ai, Replicate and Stability
// all serve this. A GPU endpoint was deployed and torn down before anyone checked. See
// scripts/probe-mesh.mjs for the full post-mortem; the transferable part is that a measurement
// about ONE provider is not a measurement about the capability.
//
// WHAT A MESH IS FOR, AND WHY NOTHING IS REFUSED ANY MORE.
//
// This module used to refuse a mesh to any piece whose `medium` implied the far side would be
// invented — a flat 2D character, a trading card. The reasoning was that invented geometry sold
// as a derivative is a fabrication wearing the artist's name.
//
// ADAM OVERTURNED IT, AND THE CORRECTION IS WORTH KEEPING BECAUSE THE OLD REASONING WAS INVERTED.
// It implicitly held that only a FAITHFUL derivative owes the artist anything — that a partly
// inferred one is somehow less their work. That is backwards. Derivation is what creates the
// obligation, not fidelity, and a loose proxy built from someone's artwork owes them exactly as
// much as a tight one.
//
// The "fabrication" objection only bites if the asset CLAIMS TO BE the artwork. These do not.
// Their purpose is to be a blocking proxy: a volume at true scale that lets someone frame a shot.
// Judged against that purpose, an inferred back is not a defect, and a piece that reads correctly
// from every angle at previz scale has done its whole job. Measured, and it decided this: the
// flat-2d astronaut was refused by the old rule and is one of the best-looking meshes in the set.
//
// SO THE MEDIUM IS NOW A LABEL, NOT A PERMISSION. Everything generates; what changes per piece is
// how much of it was OBSERVED rather than IMPLIED, and that is recorded rather than used to
// refuse. This is more honest than the gate was, not less: a stated confidence beats a silent
// binary. The dossier already had the vocabulary — `physicalProfile.heightConfidence` is
// 'known' | 'inferred' | 'unknowable', doing precisely this job for size.
//
// THE ONE THING A LABEL CANNOT FIX is a reconstruction of the WRONG SUBJECT. A trading card
// reconstructs as a card, not as the character on it — that is not a confidence problem, it is a
// picture of a different object, and the fix is a better source image (the token's own film,
// where one exists) rather than a caveat.
//
// A mesh is not a rendering upgrade that has to look better than a cut-out. It is a product
// asset — the thing an x402 bundle sells alongside the impostor, the Casting Director's notes and
// the ownership record — so the bar is "is this valid to sell as a portable, identity-bearing
// artifact", which is a question about correctness rather than beauty.
//
import { fetchArtwork } from './artwork.js';

const R2_PREFIX = 'cast';
const MESH_VERSION = 1;


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
 * What kind of mesh this piece yields, and how much of it is inference.
 *
 * Never refuses. Returns a description that travels with the asset, so a consumer knows what they
 * have rather than having to assume. Exported and pure so the renderer, a backfill and a test all
 * read the same judgement instead of each re-deriving it.
 */
export const meshDisposition = (dossier) => {
  const medium = dossier?.medium ?? null;
  if (!medium) {
    return { known: false, reason: 'This piece has no dossier yet, so nothing is known about what it is.' };
  }

  // How much of the far side the source actually shows. A render or a photograph of a real object
  // carries shading, occlusion and perspective that constrain the parts you cannot see; flat
  // artwork carries almost none of that, and the model fills the gap.
  const inference = { '3d-render': 'low', photoreal: 'low', 'trading-card': 'high' }[medium] ?? 'high';

  return {
    known: true,
    medium,
    representation: 'blocking-proxy',
    inference,
    // A caveat is about the SUBJECT being wrong, not about confidence — see the header.
    caveat:
      medium === 'trading-card'
        ? 'The artwork is a card, so a reconstruction models the card rather than the subject on it. Measured: it comes back as a paper-thin standee. Where the token carries a film showing the subject itself, that is the better source.'
        : null,
    reason: null,
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

/** The same candidate walk cast-art.js and casting-director.js use — and now literally the same
 * one. The comment here used to claim that while quietly having no IPFS fallback at all, which is
 * the exact drift that made worker/artwork.js worth extracting. */
const fetchArtworkBytes = async (dossier) => {
  const { bytes } = await fetchArtwork(dossier.sourceImageUrls);
  return bytes;
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
  const existing = normalise(await env.DOSSIERS?.get(meshRecordKey(assetKey), 'json'));
  const stale = existing && existing.status === 'ready' && !existing.representation;
  if (existing && !force && !stale && !['failed', 'absent'].includes(existing.status)) {
    return { ...existing, cached: true };
  }

  const dossier = await dossierFor(env, assetKey, dossierVersion);
  const disposition = meshDisposition(dossier);
  const base = { assetKey, meshVersion: MESH_VERSION, medium: disposition.medium ?? null, createdAt: Date.now() };

  // The only thing that stops a mesh now is not knowing what the piece IS. Everything else
  // generates and is labelled — see the header.
  if (!disposition.known) {
    return { ...(await putRecord(env, assetKey, { ...base, status: 'unknown', reason: disposition.reason, r2Key: null })), cached: false };
  }

  const bytes = await fetchArtworkBytes(dossier);
  const taskId = await startMeshTask(env, bytes);

  return {
    ...(await putRecord(env, assetKey, {
      ...base,
      status: 'pending',
      // WHAT THIS ASSET IS, carried with it rather than assumed by whoever opens it. The whole
      // argument for generating everything rests on the label being structural.
      representation: disposition.representation,
      inference: disposition.inference,
      caveat: disposition.caveat,
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
  if (!record) return record;
  // A refusal written by the old medium GATE is not a fact about the piece any more, it is a
  // decision that has since been overturned. Read it as "never generated" so the piece can be,
  // rather than bumping the version and orphaning three meshes that are already paid for.
  if (record.status === 'ineligible' || record.meshEligible === false) {
    return { ...record, status: 'absent', supersededGate: true };
  }
  if (record.status) return record;
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

  if (record.status === 'unknown') {
    return json({ status: 'unknown', assetKey, reason: record.reason });
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
      'x-representation': record.representation ?? 'blocking-proxy',
      'x-inference': record.inference ?? 'unknown',
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
