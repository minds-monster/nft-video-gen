import { Alchemy, Network } from "alchemy-sdk";
import { resolveNftImage, resolveNftVideo } from "../lib/nftMedia";

// The media resolvers are pure, so they live in src/lib/nftMedia.js where Node scripts
// can import them too — this module can't be imported outside Vite because of the
// `import.meta.env` reads below. Re-exported here so existing callers are unaffected.
export {
  IPFS_GATEWAY,
  toHttp,
  resolveNftImage,
  resolveNftVideo,
  resolveNftThumb,
  resolveNftMedia,
  resolveNftName,
  resolveNftDescription,
  mayBeVideoUrl,
  stillCandidates,
} from "../lib/nftMedia";

// In a real application, you would load these securely
// We use Vite's import.meta.env for environment variables.
const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY;
const defaultChain = import.meta.env.VITE_ALCHEMY_NETWORK || "eth-mainnet";

export const hasAlchemyKey = Boolean(apiKey);

// Chains the brand registry may reference. Alchemy's `Network` values are already
// the `<chain>-mainnet` strings we use as keys, so the map is mostly documentation
// of what we support — add a line here before referencing a chain in brands.js.
export const NETWORKS = {
  "eth-mainnet": Network.ETH_MAINNET,
  "polygon-mainnet": Network.MATIC_MAINNET,
  "base-mainnet": Network.BASE_MAINNET,
  "opt-mainnet": Network.OPT_MAINNET,
  "arb-mainnet": Network.ARB_MAINNET,
  "apechain-mainnet": Network.APECHAIN_MAINNET,
  "ronin-mainnet": Network.RONIN_MAINNET,
  "shape-mainnet": Network.SHAPE_MAINNET,
  "zksync-mainnet": Network.ZKSYNC_MAINNET,
  "flow-mainnet": Network.FLOW_MAINNET,
  "abstract-mainnet": Network.ABSTRACT_MAINNET,
  "berachain-mainnet": Network.BERACHAIN_MAINNET,
  "anime-mainnet": Network.ANIME_MAINNET,
  "story-mainnet": Network.STORY_MAINNET,
};

// Chains Alchemy serves but alchemy-sdk has no `Network` member for yet — as of 3.6.5
// (the current release) that's Robinhood Chain, live on Alchemy with the NFT API but
// absent from the enum. The SDK's `url` override reaches them: it replaces the host the
// client derives from `network`, and the NFT client honours it too, so everything below
// works unchanged. Fold a chain back into NETWORKS once the SDK ships its member.
const CUSTOM_HOSTS = {
  "robinhood-mainnet": "robinhood-mainnet.g.alchemy.com",
};

// Short labels for the chain pill in the UI.
export const CHAIN_LABELS = {
  "eth-mainnet": "Ethereum",
  "polygon-mainnet": "Polygon",
  "base-mainnet": "Base",
  "opt-mainnet": "Optimism",
  "arb-mainnet": "Arbitrum",
  "apechain-mainnet": "ApeChain",
  "ronin-mainnet": "Ronin",
  "shape-mainnet": "Shape",
  "zksync-mainnet": "zkSync",
  "flow-mainnet": "Flow",
  "abstract-mainnet": "Abstract",
  "berachain-mainnet": "Berachain",
  "anime-mainnet": "Anime",
  "story-mainnet": "Story",
  "robinhood-mainnet": "Robinhood",
};

export const chainLabel = (chain) => CHAIN_LABELS[chain] ?? chain;

// Chains offered for search and for opening a pasted contract address. Each must be
// enabled on your Alchemy app or it answers 403; Alchemy also doesn't serve its NFT
// endpoints on every chain in NETWORKS (Flow, for one), so this list stays curated.
// Every entry costs one metadata request per pasted address, so this is a budget, not
// a catalogue — the chains a pasted contract is actually likely to live on.
export const SEARCH_CHAINS = [
  "eth-mainnet",
  "base-mainnet",
  "polygon-mainnet",
  "arb-mainnet",
  "opt-mainnet",
  "robinhood-mainnet",
];

// One client per chain, built on first use. A client is cheap but not free, and
// the brand wall touches several chains in a single session.
const clients = new Map();

export const clientFor = (chain = defaultChain) => {
  const network = NETWORKS[chain];
  if (!network) {
    console.warn(`Unsupported chain "${chain}" — falling back to ${defaultChain}`);
    return clientFor(defaultChain);
  }
  if (!clients.has(chain)) {
    clients.set(chain, new Alchemy({ apiKey, network }));
  }
  return clients.get(chain);
};

/**
 * The NFT API v3 over plain fetch, for the CUSTOM_HOSTS chains.
 *
 * Not an optimisation — a necessity. The SDK's `url` setting looks like the way to point
 * it at a network its enum doesn't know, but it silently routes NFT calls to the *v2*
 * API, whose response shape (`contract: { address }`, no `spamClassifications`) makes the
 * v3 parser throw. fetchCollectionNfts swallows that into an empty result, so the
 * collection renders blank rather than erroring. Going straight to the v3 REST endpoint
 * returns exactly the shape the SDK would have produced, which is also the shape
 * nftMedia.js already reads.
 */
const restCall = async (chain, method, params) => {
  const url = new URL(`https://${CUSTOM_HOSTS[chain]}/nft/v3/${apiKey}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${method} on ${chain}: ${response.status} ${await response.text()}`);
  }
  return response.json();
};

const usesRest = (chain) => chain in CUSTOM_HOSTS;

// Only NFTs we can actually show are useful in a visual wall — but a video-only
// token (no still image) is still showable, so don't filter those out.
const withMedia = (nfts) =>
  nfts.filter((nft) => Boolean(resolveNftImage(nft) || resolveNftVideo(nft)));

/**
 * Fetch a page of NFTs for one collection on one chain.
 * Returns `{ nfts, pageKey, isMock }` — never throws.
 */
export const fetchCollectionNfts = async ({
  chain = defaultChain,
  address,
  limit = 24,
  pageKey = null,
} = {}) => {
  if (!address) return { nfts: [], pageKey: null, isMock: false };

  // If we don't have an API key configured yet, return mock data for demonstration
  if (!hasAlchemyKey) {
    console.warn("No Alchemy API key found, returning mock NFTs");
    return { nfts: mockNFTs.slice(0, limit), pageKey: null, isMock: true };
  }

  try {
    const response = usesRest(chain)
      ? await restCall(chain, "getNFTsForContract", {
          contractAddress: address,
          withMetadata: true,
          limit: Math.min(limit, 100),
          pageKey,
        })
      : await clientFor(chain).nft.getNftsForContract(address, {
          pageKey: pageKey ?? undefined,
          pageSize: Math.min(limit, 100),
          omitMetadata: false,
        });
    return {
      nfts: withMedia(response.nfts ?? []),
      pageKey: response.pageKey ?? null,
      isMock: false,
    };
  } catch (error) {
    console.error(`Error fetching NFTs for ${address} on ${chain}:`, error);
    return { nfts: [], pageKey: null, isMock: false, error };
  }
};

/**
 * Original signature, kept so existing callers keep working.
 * Prefer `fetchCollectionNfts` for anything new — it exposes chain and pageKey.
 */
export const getNFTsForContract = async (contractAddress, pageKey = null) => {
  const { nfts } = await fetchCollectionNfts({ address: contractAddress, pageKey });
  return nfts;
};

/** Collection-level metadata (name, symbol, supply, banner) for a contract. */
export const fetchContractMetadata = async ({ chain = defaultChain, address } = {}) => {
  if (!address || !hasAlchemyKey) return null;
  try {
    if (usesRest(chain)) {
      return await restCall(chain, "getContractMetadata", { contractAddress: address });
    }
    return await clientFor(chain).nft.getContractMetadata(address);
  } catch (error) {
    console.error(`Error fetching contract metadata for ${address} on ${chain}:`, error);
    return null;
  }
};

/** Fetch a single token — used when a Studio deep link is opened cold. */
export const fetchNft = async ({ chain = defaultChain, address, tokenId } = {}) => {
  if (!address || tokenId == null) return null;
  if (!hasAlchemyKey) {
    return mockNFTs.find((nft) => nft.tokenId === String(tokenId)) ?? mockNFTs[0];
  }
  try {
    if (usesRest(chain)) {
      return await restCall(chain, "getNFTMetadata", {
        contractAddress: address,
        tokenId: String(tokenId),
      });
    }
    return await clientFor(chain).nft.getNftMetadata(address, String(tokenId));
  } catch (error) {
    console.error(`Error fetching token ${tokenId} of ${address} on ${chain}:`, error);
    return null;
  }
};

/**
 * Search collections by name across a set of chains. Powers "I can't find my
 * brand" — every collection ever minted stays reachable, not just the curated ones.
 */
export const searchCollections = async (query, chains = SEARCH_CHAINS) => {
  const q = query?.trim();
  if (!q || !hasAlchemyKey) return [];

  const perChain = await Promise.all(
    chains.map(async (chain) => {
      try {
        // Returns `{ contracts: NftContract[] }`.
        const { contracts = [] } = usesRest(chain)
          ? await restCall(chain, "searchContractMetadata", { query: q })
          : await clientFor(chain).nft.searchContractMetadata(q);
        return contracts.map((contract) => ({ ...contract, chain }));
      } catch (error) {
        console.error(`Collection search failed on ${chain}:`, error);
        return [];
      }
    }),
  );

  return perChain
    .flat()
    .filter((contract) => contract.name)
    .slice(0, 24);
};

const EIP55 = /^0x[a-fA-F0-9]{40}$/;
export const isContractAddress = (value) => EIP55.test(value?.trim() ?? "");

// Placeholder pieces for a keyless checkout. The UI labels these "Demo data" —
// they are never presented as a brand's real artwork.
const mockNFTs = Array.from({ length: 12 }, (_, index) => {
  const photoId = 101 + index;
  const image = `https://picsum.photos/id/${photoId}/600/600`;
  return {
    contract: { address: "0x0000000000000000000000000000000000000000" },
    tokenId: String(index + 1),
    name: `Demo Piece ${index + 1}`,
    image: { cachedUrl: image },
    raw: { metadata: { image } },
  };
});
