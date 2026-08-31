import {
  SEARCH_CHAINS,
  chainLabel,
  fetchContractMetadata,
  hasAlchemyKey,
} from '../services/alchemy';
import { findCollection, findCollectionByAddress } from '../data/brands';
import { parseContractInput } from './contractInput';
import { rememberCollection } from './recentCollections';

// Turning pasted text into "which collection is this, on which chain" — shared by the
// contract dock (which then draws one piece) and the asset picker (which draws a grid).
// Both need the same probing, the same brand resolution and the same error copy, so it
// lives here rather than in either component's hook.

// A pasted contract that isn't in the registry still needs a brand to colour the card
// and a sector so the diversity picker can reason about it.
export const syntheticCollection = ({ chain, address, name }) => ({
  name: name || `Collection on ${chainLabel(chain)}`,
  chain,
  address,
  brand: {
    slug: `pasted-${address.toLowerCase()}`,
    name: name || 'Pasted contract',
    sector: 'Pasted',
    // Matches the accent App.jsx already gives a contract opened by address.
    accent: '#951EF5',
  },
});

/** Find which supported chain a bare contract address lives on. */
export const probeChain = async (address) => {
  const probes = await Promise.all(
    SEARCH_CHAINS.map(async (chain) => ({
      chain,
      meta: await fetchContractMetadata({ chain, address }),
    })),
  );
  // Alchemy answers for unknown contracts too, flagged NOT_A_CONTRACT — a name is the
  // reliable signal that something is actually deployed here.
  const named = probes.find(({ meta }) => meta?.name);
  const deployed = probes.find(({ meta }) => meta && meta.tokenType !== 'NOT_A_CONTRACT');
  const hit = named ?? deployed;
  return hit ? { chain: hit.chain, name: hit.meta?.name ?? null } : null;
};

/**
 * Resolve pasted text to `{ chain, address, tokenId, collection }`.
 *
 * Stops short of fetching any token — callers differ in what they want back (one random
 * piece, one exact piece, a grid), and probing is the expensive part they share.
 *
 * @returns { ok: true, chain, address, tokenId, collection, curated }
 *        | { ok: false, error } with copy ready to show the user
 */
export const resolveTarget = async (raw) => {
  const parsed = parseContractInput(raw);
  if (!parsed) {
    return { ok: false, error: 'That doesn’t look like a contract address or an NFT link.' };
  }

  let { chain } = parsed;
  let name = null;

  if (!chain) {
    // Without a key everything answers from mock data, so don't spend five probes.
    const probe = hasAlchemyKey ? await probeChain(parsed.address) : null;
    if (probe) ({ chain, name } = probe);
    else if (!hasAlchemyKey) chain = 'eth-mainnet';
  }

  if (!chain) {
    return { ok: false, error: 'Couldn’t find that contract on any chain we support.' };
  }

  // Address-only match second: a probed chain can disagree with the registry's (Alchemy
  // answers for the same address on several chains) and we'd rather show the real brand
  // on the wrong chain label than an anonymous "Pasted contract".
  const curated = findCollection(chain, parsed.address) ?? findCollectionByAddress(parsed.address);
  const collection = curated ?? syntheticCollection({ chain, address: parsed.address, name });

  // Keyless runs resolve to mock tokens; recording those would fill the list with
  // contracts nobody actually reached.
  if (hasAlchemyKey) {
    rememberCollection({
      chain: collection.chain,
      address: collection.address,
      name: collection.name,
      curated: Boolean(curated),
    });
  }

  return {
    ok: true,
    // Follow the registry's chain when we matched by address, so the follow-up fetch
    // goes where the collection actually is.
    chain: collection.chain,
    address: collection.address,
    tokenId: parsed.tokenId,
    collection,
    curated: Boolean(curated),
  };
};
