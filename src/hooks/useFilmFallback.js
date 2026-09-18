import { useState } from 'react';

/**
 * Walk a token's film candidates on error, instead of giving up on the first.
 *
 * resolveNftVideoCandidates (src/lib/nftMedia.js) returns more than one URL because no single
 * source always works: Alchemy's mirror is sometimes an unfinished stub, and a metadata ipfs.io
 * URL now sits behind a bot challenge that a <video> cannot pass. A player that stopped at the
 * first failure would show the still for a piece whose film is one fallback away.
 *
 * Keyed on the list itself, so a panel that swaps pieces starts again from the first candidate
 * without needing its own reset effect.
 */
export const useFilmFallback = (candidates) => {
  const key = candidates.join('\n');
  const [failed, setFailed] = useState({ key: '', count: 0 });
  const attempt = failed.key === key ? failed.count : 0;
  return {
    film: candidates[attempt] ?? null,
    next: () => setFailed({ key, count: attempt + 1 }),
  };
};
