import { isContractAddress } from '../services/alchemy';

// The canvas accepts whatever a collector has in their clipboard: a bare contract, a
// contract with a token id, or the URL of a marketplace/explorer page. Everything is
// reduced to `{ chain, address, tokenId }`, with `chain: null` meaning "we couldn't tell
// from the input — go probe for it".

const ADDRESS = /0x[a-fA-F0-9]{40}/;

// Path slugs used by marketplaces, mapped to keys of NETWORKS in src/services/alchemy.js.
const CHAIN_SLUGS = {
  ethereum: 'eth-mainnet',
  eth: 'eth-mainnet',
  mainnet: 'eth-mainnet',
  matic: 'polygon-mainnet',
  polygon: 'polygon-mainnet',
  base: 'base-mainnet',
  arbitrum: 'arb-mainnet',
  arb: 'arb-mainnet',
  optimism: 'opt-mainnet',
  ape_chain: 'apechain-mainnet',
  apechain: 'apechain-mainnet',
  ronin: 'ronin-mainnet',
  shape: 'shape-mainnet',
  zksync: 'zksync-mainnet',
  flow: 'flow-mainnet',
  abstract: 'abstract-mainnet',
  berachain: 'berachain-mainnet',
  zora: 'zora-mainnet',
};

// Explorers put the chain in the hostname rather than the path.
const HOST_CHAINS = {
  'etherscan.io': 'eth-mainnet',
  'basescan.org': 'base-mainnet',
  'polygonscan.com': 'polygon-mainnet',
  'arbiscan.io': 'arb-mainnet',
  'optimistic.etherscan.io': 'opt-mainnet',
  'apescan.io': 'apechain-mainnet',
  'explorer.zora.energy': 'zora-mainnet',
  'zorascan.xyz': 'zora-mainnet',
};

// Token ids are decimal in practice, but ERC-1155 ids are often written as hex.
const looksLikeTokenId = (value) => /^\d+$/.test(value) || /^0x[0-9a-fA-F]+$/.test(value);

const fromUrl = (value, address) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  const addressAt = segments.findIndex((segment) => segment.toLowerCase() === address.toLowerCase());

  // The segment before the address is the chain on OpenSea (/assets/base/0x…/12) and
  // the one after it is the token id on every marketplace and explorer we handle.
  const slug = addressAt > 0 ? segments[addressAt - 1].toLowerCase() : null;
  const next = addressAt >= 0 ? segments[addressAt + 1] : null;

  return {
    chain: CHAIN_SLUGS[slug] ?? HOST_CHAINS[host] ?? null,
    address,
    tokenId: next && looksLikeTokenId(next) ? next : null,
  };
};

/**
 * Parse pasted text into a target.
 *
 * Accepts `0xabc…`, `0xabc…/123`, `0xabc… 123`, `0xabc…#123`, `0xabc…:123`, and the
 * OpenSea / Etherscan-family / Blur URL forms. Returns null when there is no valid
 * contract address in the input at all.
 */
export const parseContractInput = (raw) => {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const address = value.match(ADDRESS)?.[0];
  if (!address || !isContractAddress(address)) return null;

  if (/^https?:\/\//i.test(value)) {
    const parsed = fromUrl(value, address);
    if (parsed) return parsed;
  }

  // Plain text: anything after the address, past one separator, is the token id.
  const tail = value.slice(value.indexOf(address) + address.length);
  const tokenId = tail.match(/^\s*[/#:\s]\s*([^\s/#:]+)/)?.[1] ?? null;

  return { chain: null, address, tokenId: tokenId && looksLikeTokenId(tokenId) ? tokenId : null };
};
