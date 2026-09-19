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

/** The same name useScreenwriter sends the Screenwriter, for the owner's records. */
export const collectionNameOf = (entry) => entry?.collection?.name ?? entry?.collection?.brand?.name ?? null;

/** Start casting this piece, once. Returns the (shared) promise of its dossier, or null. */
export const precast = (entry) => {
  if (!entry?.key || !entry?.nft || entry.isMock) return null;
  if (inflight.has(entry.key)) return inflight.get(entry.key);
  const promise = castPiece({ key: entry.key, nft: entry.nft, collectionName: collectionNameOf(entry) }, { retries: 1 }).catch((error) => {
    // A failed pre-cast must not stick: the launch will cast it again, with the visitor watching.
    inflight.delete(entry.key);
    throw error;
  });
  promise.catch(() => {});
  inflight.set(entry.key, promise);
  return promise;
};

/**
 * Which pieces on the canvas may be pre-cast: every one except those in `skip`.
 *
 * `skip` is the pieces a saved draft put back (useDraftPersistence's `restoredKeys`). Every cast
 * is paid — the casting server settles x402 on each one, cached or not — so pre-casting a restored
 * draft charged the pieces' creators and owners again on EVERY page load, the owner's own pages
 * included: auth.test's draft paid for Fragile Memories three times in six minutes of opening the
 * Records tab (2026-09-19). A restored piece was cast in the session that put it there, so its
 * film frames already exist; the launch casts it if it is actually used.
 */
export const precastable = (cast, skip) => (cast ?? []).filter((entry) => entry?.key && !skip?.has(entry.key));

/** The pre-cast for this piece, if one was started — the launch awaits it instead of casting. */
export const takePrecast = (key) => inflight.get(key) ?? null;
