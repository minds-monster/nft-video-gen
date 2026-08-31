import { loadCollection } from '../hooks/useCollectionNfts';
import { assetKey } from './assetKey';
import { shuffled } from './diversity';

// Pasting a whole-collection contract draws one piece at random — but pasting the same
// contract again should never hand back a piece you've already seen. This module keeps a
// per-collection "already drawn" set for the life of the session.
//
// Bound worth knowing: Alchemy caps `pageSize` at 100 (see fetchCollectionNfts), so the
// no-repeat guarantee holds across the first 100 media-bearing tokens of a collection.
// Paginating deeper is a later change; for a nine-piece drop like Collezione Genesi it
// already covers the whole thing.
const PAGE = 100;

const drawn = new Map(); // `${chain}:${address}` -> Set<tokenId>

/**
 * Draw a piece the caller hasn't been given before.
 *
 * Recycles once the collection is exhausted — which is also what makes a collection
 * "too small" work: a nine-token drop cycles all nine, then starts over.
 *
 * @returns the Alchemy NFT, or null when the collection has nothing showable
 */
export const drawFromCollection = async (chain, address, { exclude = new Set() } = {}) => {
  // Goes through the shared module cache, so repeat pastes cost no extra network.
  const { nfts, isMock } = await loadCollection(chain, address, PAGE);
  if (!nfts.length) return null;

  const key = `${chain}:${address.toLowerCase()}`;
  let seen = drawn.get(key) ?? new Set();
  if (seen.size >= nfts.length) seen = new Set();

  const fresh = nfts.filter(
    (nft) =>
      !seen.has(String(nft.tokenId)) && !exclude.has(assetKey(chain, address, nft.tokenId)),
  );
  // Everything fresh is already on the canvas — fall back to the full set rather than
  // refusing to draw.
  const pool = fresh.length ? fresh : nfts;

  const pick = pool[Math.floor(Math.random() * pool.length)];
  seen.add(String(pick.tokenId));
  drawn.set(key, seen);

  return { nft: pick, isMock };
};

/**
 * Draw up to `count` pieces at once — what the picker shows when you paste a bare
 * collection contract.
 *
 * Shares the same seen-set as `drawFromCollection`, so hitting Shuffle walks *through*
 * a collection rather than re-rolling the same faces, and recycles once the loaded page
 * is used up. Unlike the single draw it doesn't fall back to already-seen pieces to hit
 * its count: a short grid is honest about a small collection.
 *
 * @returns { nfts, isMock, total } — `total` is how many showable pieces exist in the
 *          loaded page, so the caller can tell "that's all of it" from "there's more".
 *          null when the collection has nothing showable at all.
 */
export const drawManyFromCollection = async (chain, address, count, { exclude = new Set() } = {}) => {
  const { nfts, isMock } = await loadCollection(chain, address, PAGE);
  if (!nfts.length) return null;

  const key = `${chain}:${address.toLowerCase()}`;
  let seen = drawn.get(key) ?? new Set();
  // Not enough unseen left to fill a grid — start the cycle over rather than hand back
  // a nearly-empty page.
  if (nfts.length - seen.size < count) seen = new Set();

  const fresh = nfts.filter((nft) => !seen.has(String(nft.tokenId)));
  const pool = fresh.length ? fresh : nfts;

  // Pieces already on the arc are deprioritised, not dropped — they render with a check
  // so you can see what you've taken, and they still count toward the grid.
  const onCanvas = (nft) => (exclude.has(assetKey(chain, address, nft.tokenId)) ? 1 : 0);
  const picks = shuffled(pool)
    .sort((a, b) => onCanvas(a) - onCanvas(b))
    .slice(0, count);

  for (const nft of picks) seen.add(String(nft.tokenId));
  drawn.set(key, seen);

  return { nfts: picks, isMock, total: nfts.length };
};
