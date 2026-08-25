import { useEffect, useState } from 'react';
import { LIVE_COLLECTIONS } from '../data/brands';
import { loadCollection } from './useCollectionNfts';
import { resolveNftImage, resolveNftVideo } from '../lib/nftMedia';

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

      const groups = loaded.map(({ collection, result }) => {
        // Filter out dead/stale assets
        const validNfts = result.nfts.filter((nft) => {
          const img = resolveNftImage(nft);
          const vid = resolveNftVideo(nft);
          if (!img && !vid) return false;

          const address = (nft.contract?.address || nft.contractAddress || '').toLowerCase();
          const yslAddress = '0x4c04517e467f25f8c95634872c505a59a60200f4';
          const matrixRedPillAddress = '0xc37d61ad831dbc979469dc48a7f55141e2e27f03';

          // YSL and Matrix Red Pill have broken/unpinned URLs. Drop them if Alchemy didn't cache them.
          if (address === yslAddress || address === matrixRedPillAddress) {
            if (!nft?.image?.cachedUrl && !nft?.image?.pngUrl && !nft?.image?.thumbnailUrl) {
              return false;
            }
          }

          return true;
        });

        // Shuffle the valid assets to show different ones on every reload
        const shuffled = [...validNfts].sort(() => 0.5 - Math.random());

        return shuffled.slice(0, perCollection).map((nft) => ({ nft, collection }));
      });

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
