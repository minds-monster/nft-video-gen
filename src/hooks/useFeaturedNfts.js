import { useEffect, useState } from 'react';
import { LIVE_COLLECTIONS } from '../data/brands';
import { loadCollection } from './useCollectionNfts';

// The featured rail should look like a curated wall, not one collection repeated —
// so we take a few pieces from each live collection and interleave them.
const interleave = (groups) => {
  const out = [];
  const depth = Math.max(0, ...groups.map((group) => group.length));
  for (let i = 0; i < depth; i += 1) {
    for (const group of groups) {
      if (group[i]) out.push(group[i]);
    }
  }
  return out;
};

export const useFeaturedNfts = ({ perCollection = 4, max = 28 } = {}) => {
  const [state, setState] = useState({ items: [], loading: true, isMock: false });

  useEffect(() => {
    let active = true;

    Promise.all(
      LIVE_COLLECTIONS.map((collection) =>
        loadCollection(collection.chain, collection.address, 24).then((result) => ({
          collection,
          result,
        })),
      ),
    ).then((loaded) => {
      if (!active) return;

      const groups = loaded.map(({ collection, result }) =>
        result.nfts.slice(0, perCollection).map((nft) => ({ nft, collection })),
      );

      setState({
        items: interleave(groups).slice(0, max),
        loading: false,
        isMock: loaded.some(({ result }) => result.isMock),
      });
    });

    return () => {
      active = false;
    };
  }, [perCollection, max]);

  return state;
};
