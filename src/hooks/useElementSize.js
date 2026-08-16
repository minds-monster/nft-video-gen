import { useEffect, useState } from 'react';

/**
 * Observe an element's box. The holo arc positions cards with inline pixel transforms,
 * so it needs a real width rather than a CSS percentage.
 *
 * Takes the element in state (not a ref) so the observer attaches on the render the node
 * first exists, instead of missing it because a ref's `.current` doesn't trigger effects.
 */
export const useElementSize = (element) => {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!element) return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [element]);

  return size;
};
