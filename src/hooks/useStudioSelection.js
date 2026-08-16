import { useCallback, useEffect, useState } from 'react';
import { useBodyScrollLock } from './useBodyScrollLock';

// Deep links without a router: #/studio/<chain>/<address>/<tokenId>
// A shared Studio link therefore survives a hard reload, and Back closes the panel.
const parseHash = (hash) => {
  const match = /^#\/studio\/([^/]+)\/(0x[a-fA-F0-9]{40})\/(.+)$/.exec(hash ?? '');
  if (!match) return null;
  const [, chain, address, tokenId] = match;
  return { chain, address, tokenId: decodeURIComponent(tokenId) };
};

export const studioHash = ({ chain, address, tokenId }) =>
  `#/studio/${chain}/${address}/${encodeURIComponent(tokenId)}`;

export const useStudioSelection = () => {
  const [selection, setSelection] = useState(() => parseHash(window.location.hash));
  // Carried from the hero prompt bar into the Studio so the first idea isn't lost.
  const [pendingPrompt, setPendingPrompt] = useState('');

  useEffect(() => {
    const onHashChange = () => setSelection(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const open = useCallback((next, prompt = '') => {
    if (!next?.address || next.tokenId == null) return;
    const target = { chain: next.chain, address: next.address, tokenId: String(next.tokenId) };
    setPendingPrompt(prompt);
    // Pushing a hash gives us Back-to-close for free; hashchange syncs state.
    window.location.hash = studioHash(target);
  }, []);

  const close = useCallback(() => {
    if (parseHash(window.location.hash)) {
      // history.back() would leave the app if the Studio was opened from a cold link.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setSelection(null);
    }
    setPendingPrompt('');
  }, []);

  // Body scroll lock while the overlay is up. Ref-counted, because the prompt canvas
  // locks too — two independent locks would restore each other's captured value and
  // leave the page scrolling behind whichever overlay is still open.
  useBodyScrollLock(Boolean(selection));

  return { selection, open, close, pendingPrompt };
};
