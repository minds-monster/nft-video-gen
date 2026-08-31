// Curated brand registry — the spine of the explore UI.
//
// Each brand renders a section in the wall. A brand with at least one entry in
// `collections` loads live NFTs through src/services/alchemy.js; a brand with an
// empty `collections` array renders a "collection pending" tile instead. We never
// substitute someone else's artwork for a brand we can't resolve on-chain.
//
// `chain` must be a key of NETWORKS in src/services/alchemy.js, and that chain must
// be enabled on your Alchemy app or it answers 403. Alchemy also doesn't serve its
// NFT endpoints on every chain (Flow, for one), so some drops are unreachable from
// this data source regardless of settings.
//
// To promote a brand from pending to live:
//   npm run verify:brands -- --search "brand name"   # find candidate contracts
//   ...add the address here, then...
//   npm run verify:brands                            # confirm it resolves
//
// Only addresses that pass verification should be committed. Contract search is
// full of copycats, so every address below was also spot-checked by pulling a
// sample token image and confirming it is the brand's own artwork. Where a
// contract is a campaign/partner deployment rather than a first-party mint, the
// entry carries a `note`.

export const SECTORS = [
  'Sport & Streetwear',
  'Fashion & Luxury',
  'Automotive',
  'Digital Native',
  'Entertainment',
];

export const BRANDS = [
  // ---------------------------------------------------------------- Sport
  {
    slug: 'nike',
    name: 'Nike',
    sector: 'Sport & Streetwear',
    accent: '#F5F5F5',
    blurb: 'Dunk Genesis CRYPTOKICKS — the swoosh, built with RTFKT.',
    collections: [
      {
        name: 'RTFKT x Nike Dunk Genesis CRYPTOKICKS',
        chain: 'eth-mainnet',
        address: '0xf661d58cFE893993b11d53d11148c4650590C692',
      },
    ],
  },
  {
    slug: 'adidas',
    name: 'Adidas',
    sector: 'Sport & Streetwear',
    accent: '#7BE0FF',
    blurb: 'Into the Metaverse — the three stripes, on-chain.',
    collections: [
      {
        name: 'adidas Originals: Into the Metaverse',
        chain: 'eth-mainnet',
        address: '0x28472a58A490c5e09A238847F66A68a47cC76f0f',
      },
      {
        name: 'adidas Originals x Prada Re-Source',
        chain: 'eth-mainnet',
        address: '0x0F8b8Dcfc08191c74AA38DA34426A0e7D1f30deB',
      },
    ],
  },

  // ------------------------------------------------------- Fashion & Luxury
  {
    slug: 'louis-vuitton',
    name: 'Louis Vuitton',
    sector: 'Fashion & Luxury',
    accent: '#C8A45C',
    blurb: 'VIA — the Maison’s trunks, rendered for a digital audience.',
    collections: [
      {
        name: 'VIA Tile Trunk',
        chain: 'base-mainnet',
        address: '0xC8dA1caC0d0ec57F78d0F34bb459474244E72771',
      },
    ],
  },
  {
    slug: 'gucci',
    name: 'Gucci',
    sector: 'Fashion & Luxury',
    accent: '#4FA97A',
    blurb: 'Vault experiments, digital collectibles and virtual couture.',
    collections: [
      {
        name: 'SUPERGUCCI',
        chain: 'eth-mainnet',
        address: '0x78d61C684A992b0289Bbfe58Aaa2659F667907f8',
        note: 'Gucci × Superplastic.',
      },
    ],
  },
  {
    slug: 'prada',
    name: 'Prada',
    sector: 'Fashion & Luxury',
    accent: '#CFCDC7',
    blurb: 'Timecapsule — a monthly drop pairing a garment with a token.',
    collections: [
      {
        name: 'Prada Timecapsule',
        chain: 'eth-mainnet',
        address: '0x0e220A4F3957C17a2e780922DBC13Cb2C9aa4274',
      },
    ],
  },
  {
    slug: 'dolce-gabbana',
    name: 'Dolce & Gabbana',
    sector: 'Fashion & Luxury',
    accent: '#B99A4B',
    blurb: 'Collezione Genesi — couture as a collectible.',
    collections: [
      {
        name: 'Collezione Genesi',
        chain: 'eth-mainnet',
        address: '0xd71B53FE1Df51075c5a965956cdc87421C2fFeD7',
        note: 'Nine pieces, with UNXD.',
      },
      {
        name: 'DGFamily',
        chain: 'eth-mainnet',
        address: '0xEb6C5acCafD8515c1b9E4c794bDC41532C5543EC',
      },
    ],
  },
  {
    slug: 'givenchy',
    name: 'Givenchy',
    sector: 'Fashion & Luxury',
    accent: '#E6E1DA',
    blurb: 'Parisian couture, collaborating with digital artists.',
    collections: [
      {
        name: 'Givenchy',
        chain: 'polygon-mainnet',
        address: '0x364350D93FC86580ec23ab427c0e899083ECd599',
      },
      {
        name: 'BSTROY x Givenchy',
        chain: 'eth-mainnet',
        address: '0xE5d8aEDB8dbd3A9EB406E5B11E1838b07712090A',
        note: 'By Felt Zine.',
      },
    ],
  },
  {
    slug: 'ysl-beaute',
    name: 'YSL Beauté',
    sector: 'Fashion & Luxury',
    accent: '#D4AF37',
    blurb: 'Beauty IP extended into collectible digital objects.',
    collections: [
      {
        name: 'YSL Beauty',
        chain: 'polygon-mainnet',
        address: '0x4C04517E467F25F8C95634872c505A59a60200f4',
      },
    ],
  },
  {
    slug: 'rimowa',
    name: 'Rimowa',
    sector: 'Fashion & Luxury',
    accent: '#A8AAAD',
    blurb: 'Grooved aluminium — an icon made for motion.',
    collections: [
      {
        name: 'RTFKT x RIMOWA Meta-Artisan',
        chain: 'eth-mainnet',
        address: '0xba83BF331E478294e17c46E56A446250aaD0B84C',
      },
    ],
  },

  // ------------------------------------------------------------- Automotive
  {
    slug: 'lamborghini',
    name: 'Lamborghini',
    sector: 'Automotive',
    accent: '#DDB321',
    blurb: 'Sant’Agata design language, on-chain.',
    collections: [
      {
        name: 'Automobili Lamborghini Revuelto',
        chain: 'base-mainnet',
        address: '0x962c80b21465fc4d1069ea764c2404cf2efF4460',
        note: 'Revuelto campaign deployment.',
      },
    ],
  },
  {
    slug: 'porsche',
    name: 'Porsche',
    sector: 'Automotive',
    accent: '#D6423E',
    blurb: 'The 911 silhouette as a generative collectible.',
    collections: [
      {
        name: 'PORSCHΞ 911',
        chain: 'eth-mainnet',
        address: '0xb763d44326552600c3B83258aD490F68777D4c27',
      },
    ],
  },
  {
    slug: 'bugatti',
    name: 'Bugatti',
    sector: 'Automotive',
    accent: '#4C90CF',
    blurb: 'Hyper-luxury engineering, in editions of very few.',
    collections: [
      {
        name: 'Asprey Bugatti La Voiture Noire',
        chain: 'eth-mainnet',
        address: '0xb92b8d7e45c0f197A8236c8345b86765250BAF7c',
        // Measured: every sampled token is 1661x2610. Without this the square card box
        // cropped a quarter off the top and bottom of the car.
        artRatio: 1661 / 2610,
        note: 'Issued by Asprey Studio.',
      },
    ],
  },
  {
    slug: 'mercedes-benz',
    name: 'Mercedes-Benz',
    sector: 'Automotive',
    accent: '#A4AAAE',
    blurb: 'NXT — the star’s digital art programme.',
    collections: [
      {
        name: 'Mercedes-Benz NXT Eternities',
        chain: 'eth-mainnet',
        address: '0xDAe1908bEBc9e811fbE095D759946A8f706a64DB',
      },
    ],
  },
  {
    slug: 'mclaren',
    name: 'McLaren Automotive',
    sector: 'Automotive',
    accent: '#FF8000',
    blurb: 'MSO LAB — papaya orange and carbon fibre, for the camera.',
    collections: [
      {
        name: 'McLaren MSO LAB Genesis',
        chain: 'eth-mainnet',
        address: '0xC2Ac394984f3850027dac95Fe8A62E446c5FB786',
      },
    ],
  },

  // ----------------------------------------------------------- Digital Native
  {
    slug: 'animoca-brands',
    name: 'Animoca Brands',
    sector: 'Digital Native',
    accent: '#7C5CFF',
    blurb: 'The open-metaverse portfolio behind Mocaverse and the mind you talk to.',
    collections: [
      {
        name: 'Mocaverse',
        chain: 'eth-mainnet',
        address: '0x59325733eb952a92e069C87F0A6168b29E80627f',
      },
      {
        name: 'The Sandbox Assets',
        chain: 'eth-mainnet',
        address: '0xa342f5D851E866E18ff98F351f2c6637f4478dB5',
        note: 'The Sandbox (an Animoca Brands company). ASSETs are voxel items minted by community creators on the Sandbox marketplace, not a first-party brand mint.',
      },
    ],
  },

  // ------------------------------------------------------------- Entertainment
  {
    slug: 'warner-bros',
    name: 'Warner Bros.',
    sector: 'Entertainment',
    // Matrix green. Every collection here is currently The Matrix Avatars, and the four
    // golds already in this file are indistinguishable from each other at dot size, so a
    // WB shield gold would not identify anything. Revisit if the catalogue broadens beyond
    // The Matrix. 9.98:1 on the page ground, so it stays legible as 11px caption text.
    accent: '#3CCF6E',
    blurb: 'The Matrix Avatars — Resurrections-era avatars and artifacts, minted on Polygon.',
    // All four contracts were confirmed by deployer rather than by name search: each one's
    // `contractDeployer` is 0x8e47ce1396e9ae9df4e09054a664392337100459, the wallet that
    // created them. That matters here because searching Alchemy for "matrix" returns
    // pages of unrelated copycats and none of these four. To add more later, check the
    // candidate's contractDeployer against that wallet before committing it.
    collections: [
      {
        name: 'The Matrix Avatars',
        chain: 'polygon-mainnet',
        address: '0x8eA732c9dcC90d98DAEA6c6F51A72a21B47899Ae',
        // Measured: every sampled token is 1000x1500. This is the collection whose avatars
        // were losing their heads to a square box.
        artRatio: 2 / 3,
        note: 'Contract name TheMatrixAvatarsBase. The avatars as minted, before the red/blue pill split below.',
      },
      {
        name: 'The Matrix Avatars — Red Pill',
        chain: 'polygon-mainnet',
        address: '0xc37D61AD831DBC979469dC48A7f55141E2e27f03',
        // Same 2:3 as the other avatar contracts. Declared for the day the art is re-pinned;
        // until then these render as correctly-shaped fallback tiles rather than square ones.
        artRatio: 2 / 3,
        // Token names resolve, so these render as brand-tinted fallback tiles with the
        // right titles rather than as broken images — but there is no artwork to show.
        // RE-CHECKED 2026-08-25: no longer true. Alchemy has since ingested this contract —
        // pngUrl and cachedUrl both resolve, contentType image/jpeg, 1000x1500 as declared.
        // Kept below as the record of what was wrong and when, since it was measured once.
        note: 'The red-pill cohort. WAS UNRETRIEVABLE UNTIL 2026-08-25: Alchemy never ingested this contract (thumbnailUrl/pngUrl/contentType all null) so it just echoes the raw ipfs:// URL, and the CID itself is no longer pinned — ipfs.io and pinata time out, w3s.link and nftstorage.link answer 504. Nothing in this codebase can fix that; it needs the collection re-pinned at source. Kept in the registry because it is a verified first-party contract and its titles still resolve.',
      },
      {
        name: 'The Matrix Avatars — Blue Pill',
        chain: 'polygon-mainnet',
        address: '0xCC16D5f112d2D6B7d4572Eb191a59F22aaf87d02',
        // Measured: every sampled token is 1000x1500.
        artRatio: 2 / 3,
        note: 'The blue-pill cohort.',
      },
      {
        name: 'The Matrix Avatars — Artifacts',
        chain: 'polygon-mainnet',
        address: '0xcb569DBAdd7E31Ed90755f27be6f83cdc04837b7',
        note: 'ERC-1155 rather than ERC-721, and a good part of it is video rather than stills (e.g. "Glitch in The Matrix" is an mp4) — NftCard plays those on hover.',
      },
    ],
  },
];

export const BRANDS_BY_SLUG = new Map(BRANDS.map((brand) => [brand.slug, brand]));

export const getBrand = (slug) => BRANDS_BY_SLUG.get(slug) ?? null;

export const hasLiveCollection = (brand) => (brand?.collections?.length ?? 0) > 0;

export const DEFAULT_ART_RATIO = 1;

/**
 * The width/height a collection's card box should take, so the box matches the artwork.
 *
 * Cards render their media with `object-contain`, which never crops whatever shape arrives.
 * This ratio is the cosmetic half: when the box matches the art, `contain` and `cover` are
 * pixel-identical, so a correctly-declared collection is full-bleed with no letterbox at all.
 * A collection whose tokens vary in shape should simply OMIT `artRatio` — it then gets a
 * square box, and `contain` letterboxes each piece rather than cropping it.
 *
 * Measured (Alchemy + magick/ffprobe, several tokens each): most collections are exactly 1:1.
 * The ones that aren't are marked with `artRatio` at their entry above.
 */
export const artRatio = (collection) =>
  Number(collection?.artRatio) > 0 ? Number(collection.artRatio) : DEFAULT_ART_RATIO;

// Sector order follows SECTORS; brands keep their registry order within a sector.
export const BRANDS_BY_SECTOR = SECTORS.map((sector) => ({
  sector,
  brands: BRANDS.filter((brand) => brand.sector === sector),
}));

export const LIVE_BRANDS = BRANDS.filter(hasLiveCollection);

// Flat list of every live collection, tagged with its brand — used by the featured
// marquee and by Studio navigation.
export const LIVE_COLLECTIONS = LIVE_BRANDS.flatMap((brand) =>
  brand.collections.map((collection) => ({ ...collection, brand })),
);

export const findCollection = (chain, address) => {
  const target = address?.toLowerCase();
  return (
    LIVE_COLLECTIONS.find(
      (collection) =>
        collection.chain === chain && collection.address.toLowerCase() === target,
    ) ?? null
  );
};

// Chain-blind lookup, for when a pasted address had to have its chain probed. A wrong
// guess (Alchemy answers for the same address on several chains) would otherwise render
// a curated brand as an anonymous "Pasted contract".
export const findCollectionByAddress = (address) => {
  const target = address?.toLowerCase();
  if (!target) return null;
  return (
    LIVE_COLLECTIONS.find((collection) => collection.address.toLowerCase() === target) ?? null
  );
};

export const searchBrands = (query) => {
  const q = query.trim().toLowerCase();
  if (!q) return BRANDS;
  return BRANDS.filter(
    (brand) =>
      brand.name.toLowerCase().includes(q) ||
      brand.slug.includes(q) ||
      brand.sector.toLowerCase().includes(q) ||
      brand.collections.some((collection) =>
        collection.name.toLowerCase().includes(q),
      ),
  );
};
