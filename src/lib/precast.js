import { castPiece } from '../services/swarm.js';

// Casting started when a piece is ADDED, not when the film is launched.
//
// WHY. A moving piece's film frames (worker/film-frames.js) are chosen on a queue after its cast,
// and that takes one to eight minutes. The site used to cast only on launch and then write the
// screenplay seconds later — so a piece's FIRST film could never have its frames, only a later
// one. Found on staging, 2026-09-18, when the Godzilla test had to be cast by hand to get frames
// in time. Casting on add usually means the frames are ready by the time the visitor has
// written their line, and the launch itself is quicker: its cast step becomes a cache hit.
//
// One cast per piece per page: the promise is kept, so a launch that arrives while a pre-cast is
// still running WAITS for it rather than starting a second cold cast of the same piece, and a
// launch after it finishes gets the dossier without a network call at all.

const inflight = new Map();

/** Start casting this piece, once. Returns the (shared) promise of its dossier, or null. */
export const precast = (entry) => {
  if (!entry?.key || !entry?.nft || entry.isMock) return null;
  if (inflight.has(entry.key)) return inflight.get(entry.key);
  const promise = castPiece({ key: entry.key, nft: entry.nft }, { retries: 1 }).catch((error) => {
    // A failed pre-cast must not stick: the launch will cast it again, with the visitor watching.
    inflight.delete(entry.key);
    throw error;
  });
  promise.catch(() => {});
  inflight.set(entry.key, promise);
  return promise;
};

/** The pre-cast for this piece, if one was started — the launch awaits it instead of casting. */
export const takePrecast = (key) => inflight.get(key) ?? null;
