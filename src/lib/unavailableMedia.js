import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * A registry of tokens whose artwork cannot be displayed, so they are never shown anywhere.
 *
 * WHY THIS IS RUNTIME AND NOT A FILTER AT FETCH TIME
 * Some collections hand out media URLs that no longer resolve — YSL's "Golden Block" tokens
 * point at a third-party host that times out, and half of The Matrix Avatars Red Pill points
 * at an IPFS CID that is no longer pinned. Those tokens still LOOK fine in the API response:
 * they have a URL, a name and full metadata.
 *
 * The obvious shortcut is to trust Alchemy's ingestion fields — when `image.contentType` and
 * `image.size` are null, Alchemy could not fetch the origin either. Within those two
 * collections that predicts failure perfectly (verified, 8/8 each way). It was measured
 * across the whole registry before being rejected: of 39 tokens it would have dropped, 13
 * actually load fine — Bugatti #5/#8/#10, four McLaren pieces and three Matrix Artifacts
 * films are all served from reachable third-party hosts that Alchemy simply never cached.
 * A synchronous filter therefore hides real artwork, which is worse than the problem.
 *
 * So the browser decides: a card that exhausts its still AND its film reports the token here,
 * and every surface drops it from that moment on. Because the entry is keyed by contract and
 * token rather than by surface, one failure in the grid also removes it from the marquee, the
 * picker and the Studio's prev/next — and persisting to localStorage means a returning visitor
 * never sees it at all. The cost is that the very first encounter shows a loading tile for as
 * long as the origin takes to fail; that happens once per browser, then never again.
 */

const STORAGE_KEY = 'mm.unavailable-media.v1';
// A dead collection is a few hundred tokens at worst. The cap only exists so a very long
// browsing session can't grow the entry unboundedly.
const MAX_ENTRIES = 2000;

const listeners = new Set();
let ids = new Set();
// useSyncExternalStore needs a value that changes identity when the set changes; the Set
// itself is mutated in place, so a counter is the snapshot.
let version = 0;

const load = () => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return new Set(parsed.slice(-MAX_ENTRIES));
  } catch {
    // Private-mode Safari throws on localStorage access. An in-memory registry still works.
  }
  return new Set();
};

ids = load();

const persist = () => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(-MAX_ENTRIES)));
  } catch {
    // Quota or private mode — the in-memory set is authoritative either way.
  }
};

/**
 * Keyed on contract + token rather than on the collection entry, so any surface can compute it
 * from the NFT alone without threading its collection through.
 */
export const mediaKey = (nft) => {
  const address = nft?.contract?.address ?? nft?.contractAddress ?? '';
  return `${String(address).toLowerCase()}:${nft?.tokenId ?? ''}`;
};

/**
 * Recorded only in response to a real media `error` event, never to a timer.
 *
 * A deadline was tried twice and removed both times. Measured in the browser, the dead hosts
 * here surface on their own — YSL's arianee host errors at 2.2s, the unpinned Red Pill CID
 * errors at 30s through ipfs.io — so a timer only ever bought speed, and it cost accuracy:
 * off-screen `loading="lazy"` images never start fetching at all, and a dozen large stills
 * from one host queue behind each other. A 9s deadline suppressed 124 real tokens.
 */
export const markMediaUnavailable = (nft) => {
  const key = mediaKey(nft);
  if (!key || key === ':' || ids.has(key)) return;
  ids.add(key);
  version += 1;
  persist();
  for (const listener of listeners) listener();
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => version;

const identity = (item) => item;

/**
 * Drops tokens already known to have unshowable artwork. Every surface that renders a list of
 * NFTs runs its list through this, which is what makes one discovery apply everywhere.
 *
 * `select` exists because not every surface holds bare NFTs — the marquee's items are
 * `{ nft, collection }` and the picker's are `{ nft, collection }` candidates.
 */
export const useAvailableNfts = (list, select = identity) => {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () =>
      Array.isArray(list) ? list.filter((item) => !ids.has(mediaKey(select(item)))) : list,
    // `version` is intentionally in the dependency list: the Set is mutated in place, so its
    // identity never changes and the filter has to re-run when the counter moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, select, version],
  );
};

/** For a single token, e.g. the Studio opened directly on a dead piece. */
export const useIsMediaUnavailable = (nft) => {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return Boolean(nft) && ids.has(mediaKey(nft));
};

/** Stable reporter for cards to call once their media is exhausted. */
export const useReportUnavailable = () => useCallback((nft) => markMediaUnavailable(nft), []);

/** Escape hatch: forget every suppression, e.g. after a dead host is restored. */
export const clearUnavailableMedia = () => {
  ids = new Set();
  version += 1;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — the in-memory reset above is what matters.
  }
  for (const listener of listeners) listener();
};
