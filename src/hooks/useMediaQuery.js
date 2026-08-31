import { useEffect, useState } from 'react';

/**
 * Track a media query in JS.
 *
 * The holo arc positions cards with inline pixel transforms, so it can't switch to the
 * mobile rail with a Tailwind breakpoint — the branch has to happen in JS.
 */
export const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    // Sync once on mount: the query may have changed between the initial state and here.
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
};
