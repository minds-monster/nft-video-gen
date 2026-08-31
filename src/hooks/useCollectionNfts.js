import { useEffect, useState } from 'react';
import { fetchCollectionNfts } from '../services/alchemy';
import nftsData from '../data/nfts.json';

// Module-level cache so re-opening a brand section (or the Studio) is instant and
// we don't re-hit Alchemy for a collection we've already loaded this session.
const cache = new Map();
const inflight = new Map();

const keyOf = (chain, address, limit) => `${chain}:${address?.toLowerCase()}:${limit}`;

export const loadCollection = (chain, address, limit = 24) => {
  const key = keyOf(chain, address, limit);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);

  // Check the static JSON cache (check both limit:100 and limit:24 keys, slice if needed)
  const key100 = keyOf(chain, address, 100);
  const key24 = keyOf(chain, address, 24);
  const hitData = nftsData[key] || nftsData[key100] || nftsData[key24];
  
  if (hitData) {
    const result = {
      ...hitData,
      nfts: hitData.nfts.slice(0, limit),
      pageKey: hitData.nfts.length > limit ? 'has-more-placeholder' : null,
    };
    cache.set(key, result);
    return Promise.resolve(result);
  }

  const promise = fetchCollectionNfts({ chain, address, limit }).then((result) => {
    // Never cache a transient failure. fetchCollectionNfts swallows errors into
    // `{ nfts: [], error }`, so caching that would let one 429 blank a collection for
    // the rest of the session with no way to retry.
    if (!result.error) cache.set(key, result);
    inflight.delete(key);
    return result;
  });
  inflight.set(key, promise);
  return promise;
};

export const getCachedCollection = (chain, address, limit = 24) =>
  cache.get(keyOf(chain, address, limit)) ?? null;

/**
 * Load one collection's NFTs. `enabled: false` defers the fetch, which lets the
 * brand wall load collections lazily as sections come into view.
 */
export const useCollectionNfts = ({ chain, address, limit = 24, enabled = true } = {}) => {
  const cached = address && enabled ? getCachedCollection(chain, address, limit) : null;
  // `status` separates "haven't asked yet" from "asked and got nothing". Without it,
  // the frame between `enabled` flipping true and the effect running looks identical
  // to an empty result, and the UI flashes an error at anyone who scrolls fast.
  const [state, setState] = useState(() =>
    cached
      ? { nfts: cached.nfts, isMock: cached.isMock, status: 'done', error: null }
      : { nfts: [], isMock: false, status: 'idle', error: null },
  );

  useEffect(() => {
    if (!address || !enabled) return;

    const hit = getCachedCollection(chain, address, limit);
    if (hit) {
      setState({ nfts: hit.nfts, isMock: hit.isMock, status: 'done', error: null });
      return;
    }

    let active = true;
    setState({ nfts: [], isMock: false, status: 'loading', error: null });

    loadCollection(chain, address, limit).then((result) => {
      if (!active) return;
      setState({
        nfts: result.nfts,
        isMock: result.isMock,
        status: 'done',
        error: result.error ?? null,
      });
    });

    return () => {
      active = false;
    };
  }, [chain, address, limit, enabled]);

  return {
    ...state,
    // `loading` stays true while idle so callers render a skeleton, never an error.
    loading: state.status !== 'done',
    settled: state.status === 'done',
  };
};
