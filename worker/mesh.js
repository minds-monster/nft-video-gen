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

import { sseResponse } from './sse.js';

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
const POLL_INTERVAL_MS = 3000;

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
 * One image in, one textured GLB out.
 *
 * Submitted and polled rather than awaited in one call: measured at 56-107 seconds per piece,
 * which no single request should be holding open.
 */
export const generateMesh = async (env, imageBytes, { onPhase, timeoutMs = 300_000 } = {}) => {
  const headers = { Authorization: `Bearer ${requireKey(env)}` };

  const form = new FormData();
  form.append('file', new Blob([imageBytes], { type: 'image/png' }), 'input.png');
  const uploaded = await (await fetch(`${TRIPO_BASE}/upload`, { method: 'POST', headers, body: form })).json();
  if (uploaded.code !== 0) throw new TripoError(uploaded.code, uploaded.message ?? 'upload failed');
  const fileToken = uploaded.data?.image_token;

  const created = await (
    await fetch(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'image_to_model',
        file: { type: 'png', file_token: fileToken },
        texture: true,
        face_limit: FACE_LIMIT,
      }),
    })
  ).json();
  if (created.code !== 0) throw new TripoError(created.code, created.message ?? 'task rejected');
  const taskId = created.data?.task_id;

  const startedAt = Date.now();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const polled = await (await fetch(`${TRIPO_BASE}/task/${taskId}`, { headers })).json();
    const task = polled.data ?? {};

    if (task.status === 'success') {
      const url = task.output?.pbr_model || task.output?.model;
      if (!url) throw new TripoError(0, 'the task succeeded but returned no model');
      const glb = new Uint8Array(await (await fetch(url)).arrayBuffer());
      return { glb, taskId, seconds: Math.round((Date.now() - startedAt) / 1000) };
    }
    if (['failed', 'banned', 'expired', 'cancelled'].includes(task.status)) {
      throw new TripoError(0, `the task ended as ${task.status}`);
    }
    if (Date.now() - startedAt > timeoutMs) throw new TripoError(0, `task ${taskId} did not finish in time`);
    onPhase?.({ status: task.status, progress: task.progress ?? 0, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) });
  }
};

// ─────────────────────────────────────────────────────────────────────── generation + cache

const dossierFor = async (env, assetKey, version) =>
  env.DOSSIERS ? env.DOSSIERS.get(`dossier:v${version}:${assetKey}`, 'json') : null;

/**
 * The mesh for one piece, made once and never again.
 *
 * Returns the stored record either way — including for a piece the gate refuses, which is a
 * result rather than an error and is written down as one.
 */
export const ensureMesh = async (env, assetKey, { dossierVersion = 5, onPhase, force = false } = {}) => {
  const recordKey = meshRecordKey(assetKey);
  if (!force) {
    const existing = await env.DOSSIERS?.get(recordKey, 'json');
    if (existing) return { ...existing, cached: true };
  }

  const dossier = await dossierFor(env, assetKey, dossierVersion);
  const gate = meshEligibility(dossier);

  const base = {
    assetKey,
    meshVersion: MESH_VERSION,
    medium: gate.medium ?? null,
    createdAt: Date.now(),
  };

  if (!gate.eligible) {
    // A refusal is a first-class record. The bundle must be able to say why a piece has no mesh.
    const record = { ...base, meshEligible: false, reason: gate.reason, r2Key: null };
    await env.DOSSIERS?.put(recordKey, JSON.stringify(record));
    return { ...record, cached: false };
  }

  // The same `sourceImageUrls` the card is built from, so a mesh and a card demonstrably derive
  // from one recorded source rather than from two independent resolutions of "the artwork".
  const source = dossier.sourceImageUrls?.[0];
  onPhase?.({ status: 'fetching' });
  const bytes = await fetchArtworkBytes(dossier);

  onPhase?.({ status: 'generating' });
  const { glb, taskId, seconds } = await generateMesh(env, bytes, { onPhase });

  const r2Key = meshR2Key(assetKey);
  await env.STORYBOARD_IMAGES?.put(r2Key, glb, {
    httpMetadata: { contentType: 'model/gltf-binary' },
    customMetadata: { assetKey, sourceUrl: source ?? '', taskId },
  });

  const record = {
    ...base,
    meshEligible: true,
    reason: null,
    r2Key,
    bytes: glb.byteLength,
    faceLimit: FACE_LIMIT,
    seconds,
    taskId,
    // Provenance, on the record rather than alongside it: this mesh was computed FROM this URL.
    sourceUrl: source ?? null,
    model: 'tripo3d/image_to_model',
  };
  await env.DOSSIERS?.put(recordKey, JSON.stringify(record));
  return { ...record, cached: false };
};

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

// ─────────────────────────────────────────────────────────────────────── routes

/**
 * One cast member's mesh, or an honest account of why there isn't one.
 *
 * Never generates. Generation takes a minute and a half and belongs behind an explicit request,
 * not behind a tile scrolling into view.
 */
export async function handleCastMesh(request, env) {
  const { searchParams } = new URL(request.url);
  const assetKey = searchParams.get('asset');
  if (!assetKey || !ASSET_KEY.test(assetKey)) {
    return json({ error: 'asset must be a chain:address:tokenId key' }, 400);
  }

  const record = await env.DOSSIERS?.get(meshRecordKey(assetKey), 'json');
  if (!record) return json({ status: 'absent', assetKey }, 404);
  if (!record.meshEligible) {
    // 200, not an error: "this piece does not get a mesh, and here is why" is the correct answer
    // for roughly half the library, not a failure to serve one.
    return json({ status: 'ineligible', assetKey, medium: record.medium, reason: record.reason });
  }

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

/** Generate one, on an explicit request. Streamed, because it takes 56-107 seconds and a silent
 * minute and a half is indistinguishable from a hang. */
export async function handleCastMeshGenerate(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const { asset, force = false } = body;
  if (!asset || !ASSET_KEY.test(asset)) return json({ error: 'Body needs { asset }' }, 400);

  return sseResponse(async (emit) => {
    const record = await ensureMesh(env, asset, {
      force,
      onPhase: (phase) => emit('phase', phase).catch(() => {}),
    });
    await emit('result', record);
  }, ctx);
}
