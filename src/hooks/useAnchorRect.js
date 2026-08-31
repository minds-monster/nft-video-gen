import { useCallback, useEffect, useState } from 'react';

const read = (element) => {
  const box = element.getBoundingClientRect();
  // Document coordinates, not viewport. The composer is positioned `absolute` inside the
  // page so it scrolls natively while collapsed — a fixed element re-positioned on every
  // scroll event would visibly lag the page it's supposed to be sitting in.
  return {
    top: box.top + window.scrollY,
    left: box.left + window.scrollX,
    width: box.width,
    height: box.height,
  };
};

const same = (a, b) =>
  a && b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

/**
 * Track an element's box in document space.
 *
 * Used for the invisible placeholder the hero reserves for the prompt composer, which
 * lives at root level to escape the hero's stacking context and needs to know where its
 * slot on the page actually is.
 */
export const useAnchorRect = (element) => {
  const [rect, setRect] = useState(null);

  const measure = useCallback(() => {
    if (!element) return;
    const next = read(element);
    // Bail on identical values: body's ResizeObserver fires for changes that don't move
    // the anchor at all, and a fresh object each time would re-render the whole composer.
    setRect((current) => (same(current, next) ? current : next));
  }, [element]);

  useEffect(() => {
    if (!element) return undefined;

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // The anchor also moves when anything above it reflows — a wrapping headline, a font
    // swap — without its own size changing. Watching the body catches that.
    observer.observe(document.body);

    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [element, measure]);

  return rect;
};
