import { SECTORS } from '../data/brands';
import { candidateKey } from './assetKey';

// The registry is lopsided — Fashion & Luxury has seven brands and Automotive five,
// against two for Sport and one for Digital Native. Anything that walks the collection
// list in order (or round-robins collections, like the featured marquee's `interleave`)
// hands back a cast of supercars. So the canvas picks by *sector* first and only then by
// brand, which caps how much of the screen any one corner of the registry can own.

const groupBySectorAndBrand = (candidates) => {
  const bySector = new Map();

  for (const candidate of candidates) {
    const brand = candidate?.collection?.brand;
    if (!brand || !candidate.nft) continue;

    if (!bySector.has(brand.sector)) bySector.set(brand.sector, new Map());
    const byBrand = bySector.get(brand.sector);
    if (!byBrand.has(brand.slug)) byBrand.set(brand.slug, []);
    byBrand.get(brand.slug).push(candidate);
  }

  return bySector;
};

// Fisher-Yates on a copy — the caller's array is the shared featured pool.
export const shuffled = (items) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * Pick `count` pieces that don't all come from the same corner of the registry.
 *
 * Round-robins sectors on the outside and rotates brands within a sector on the inside,
 * so a five-card cast drawn from this registry lands at most two Automotive pieces —
 * the "not five cars at once" guarantee is structural, not luck.
 *
 * @param candidates [{ nft, collection }] — `collection.brand` carries slug/sector/accent
 * @param count      how many to return
 * @param exclude    Set of `assetKey`s already spoken for (the current cast, on reshuffle)
 * @param randomize  vary which sector leads and which piece a brand offers
 */
export const pickDiverseCast = (
  candidates,
  count,
  { exclude = new Set(), randomize = true } = {},
) => {
  if (count <= 0) return [];

  const bySector = groupBySectorAndBrand(candidates);
  // SECTORS order first, then anything unknown (a pasted collection's synthetic brand).
  const sectors = [
    ...SECTORS.filter((sector) => bySector.has(sector)),
    ...[...bySector.keys()].filter((sector) => !SECTORS.includes(sector)),
  ];
  if (!sectors.length) return [];

  const sectorOffset = randomize ? Math.floor(Math.random() * sectors.length) : 0;
  const brandOffset = randomize ? Math.floor(Math.random() * 16) : 0;

  // Per-brand read cursor, so a brand never offers the same piece twice.
  const cursors = new Map();
  const taken = new Set(exclude);
  const picked = [];

  const pools = new Map();
  const poolFor = (sector, slug) => {
    const poolKey = `${sector}/${slug}`;
    if (!pools.has(poolKey)) {
      const items = bySector.get(sector).get(slug);
      pools.set(poolKey, randomize ? shuffled(items) : items);
    }
    return pools.get(poolKey);
  };

  const usedBrands = new Set();
  // While false, a brand that has already contributed is skipped, so a five-piece cast
  // is five different brands. Only relaxed once a whole round can't place anything —
  // otherwise Digital Native (one brand) would cap the cast at four.
  let relaxed = false;

  for (let round = 0; picked.length < count; round += 1) {
    let progressed = false;

    for (let s = 0; s < sectors.length && picked.length < count; s += 1) {
      const sector = sectors[(sectorOffset + s) % sectors.length];
      const slugs = [...bySector.get(sector).keys()];

      // Rotate which brand answers for this sector each round, so Fashion's seven
      // brands take turns instead of the first one supplying every slot.
      for (let step = 0; step < slugs.length; step += 1) {
        const slug = slugs[(round + step + brandOffset) % slugs.length];
        if (!relaxed && usedBrands.has(slug)) continue;

        const pool = poolFor(sector, slug);
        let index = cursors.get(slug) ?? 0;
        while (index < pool.length && taken.has(candidateKey(pool[index]))) index += 1;
        if (index >= pool.length) {
          cursors.set(slug, index);
          continue;
        }

        cursors.set(slug, index + 1);
        const pick = pool[index];
        taken.add(candidateKey(pick));
        usedBrands.add(slug);
        picked.push(pick);
        progressed = true;
        break; // at most one piece per sector per round
      }
    }

    if (progressed) continue;
    if (relaxed) break; // every brand is exhausted

    // Nothing placed with the one-per-brand rule; retry this round without it.
    relaxed = true;
    round -= 1;
  }

  return picked;
};
