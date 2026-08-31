// One identity for a piece, shared by the canvas cast, the diversity picker and the
// contract roulette. Addresses are lower-cased because Alchemy, the brand registry and
// pasted URLs all disagree on EIP-55 checksum casing for the same contract.
export const assetKey = (chain, address, tokenId) =>
  `${chain}:${String(address ?? '').toLowerCase()}:${tokenId}`;

/** Same identity, derived from a `{ nft, collection }` candidate. */
export const candidateKey = (candidate) =>
  assetKey(candidate.collection.chain, candidate.collection.address, candidate.nft.tokenId);
