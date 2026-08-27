// A re-export shim over worker/minimax.js, plus the one thing that genuinely cannot be shared.
//
// WHY THIS IS A SHIM AND NOT A COPY. This file used to BE the client — it is what built the hero
// video on the front page, and every rule in it was paid for with a failed render. When the
// Director needed the same client inside the Worker, the choice was to copy it or to move it and
// re-export. Same reasoning scripts/lib/scene-geometry.mjs states over worker/scene.js:
//
//   "A copy would have started drifting the first time either side was touched; a re-export
//    cannot."
//
// That matters more here than anywhere else in the repo, because the thing that would drift is a
// PRICE TABLE and a set of guards against 400s. A probe that prices a render differently from
// production is a probe whose cost accounting is fiction, and a guard that exists on one side
// only is a guard that fails on the side nobody was watching.
//
// The one part that could not move is where image bytes come from: node:fs here, an R2 object or
// a proxied URL in the Worker. So `resolveImage` is injected rather than the module forked, and
// `asDataUri` below is this side's implementation of it.
//
// Every function keeps its ORIGINAL call signature — `createH3Task({...})`, not
// `createH3Task(env, {...})` — so scripts/gen-video.mjs, probe-h3.mjs, gen-launch.mjs,
// gen-audio.mjs and drive-test.mjs all keep working untouched. The env is bound from
// process.env here, which is the only place that is legal: MINIMAX_API_KEY is deliberately not
// VITE_-prefixed, and generation is a build step, never something a page load triggers.

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import {
  createH3Task as createH3TaskWithEnv,
  createV1Task as createV1TaskWithEnv,
  createMusic as createMusicWithEnv,
  createSpeech as createSpeechWithEnv,
  awaitVideo as awaitVideoWithEnv,
  pollVideo as pollVideoWithEnv,
  h3Content as h3ContentShared,
} from '../worker/minimax.js';

export {
  MinimaxError,
  H3_PARAM_LIMITS,
  H3_REFERENCE_LIMITS,
  LATENCY_SECONDS,
  checkH3Params,
  priceUsd,
} from '../worker/minimax.js';

/** The env the Worker takes as a parameter, read from the process here. */
const env = () => ({
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  MINIMAX_BASE_URL: process.env.MINIMAX_BASE_URL,
});

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
};

/**
 * Local file → data URI. The references are files on disk, not public URLs, and the /v2 request
 * body allows 64MB, which is ample for a handful of stills.
 *
 * This is the node:fs half of `resolveImage`. The Worker's half is
 * `fetchImageAsDataUri(castingStills(nft))` in worker/casting-director.js.
 */
export const asDataUri = async (file) => {
  const ext = extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`${file}: MiniMax does not accept ${ext} images`);
  const buffer = await readFile(file);
  return `data:${mime};base64,${buffer.toString('base64')}`;
};

export const h3Content = (options) => h3ContentShared({ ...options, resolveImage: asDataUri });

export const createH3Task = (options) => createH3TaskWithEnv(env(), options);
export const createV1Task = (options) => createV1TaskWithEnv(env(), { resolveImage: asDataUri, ...options });
export const createMusic = (options) => createMusicWithEnv(env(), options);
export const createSpeech = (options) => createSpeechWithEnv(env(), options);
export const awaitVideo = (taskId, options) => awaitVideoWithEnv(env(), taskId, options);
export const pollVideo = (taskId, options) => pollVideoWithEnv(env(), taskId, options);
