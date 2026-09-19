// Who this browser is, for the owner's records (worker/records.js): the guestId (src/services/
// guest.js) and, once a Mind is connected, its session.

import { getGuestId } from './guest.js';
import { getStoredSession } from './mindConnect.js';

/** `x-guest-id`, plus the Mind session when there is one — enough for the Worker to say who. */
export const identityHeaders = () => {
  const headers = {};
  const guestId = getGuestId();
  if (guestId) headers['x-guest-id'] = guestId;
  const token = getStoredSession()?.token;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
};

/**
 * Tell the Worker a piece was cast, with any x402 transaction hashes the casting stream paid.
 * Fire-and-forget: a lost record must never be something the visitor sees.
 */
export const reportCast = ({ key, nft, txHashes = [] }) => {
  try {
    const body = JSON.stringify({
      asset: {
        key,
        name: nft?.name ?? nft?.title ?? null,
        collectionName: nft?.collection?.name ?? nft?.contract?.name ?? nft?.contract?.openSeaMetadata?.collectionName ?? null,
      },
      txHashes,
    });
    fetch('/api/records/cast', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...identityHeaders() },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Records are never allowed to be the reason something else failed.
  }
};
