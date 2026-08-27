import { useCallback, useEffect, useState } from 'react';

// The site's first router, and deliberately the smallest one that works: the marketing page
// has always used `#how-it-works`-style anchors, so a "page" is a hash that starts with `#/`
// — `#/owner`, `#/support`, `#/support/<id>/<token>` — and everything else is the home page
// with its anchors untouched. wrangler.jsonc already serves index.html for every path
// (`single-page-application`), so a deep link to one of these survives a reload.

const parse = () => {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  if (!hash.startsWith('#/')) return { path: '/', segments: [] };
  const path = hash.slice(1).split('?')[0];
  return { path, segments: path.split('/').filter(Boolean) };
};

export const useHashRoute = () => {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((path) => {
    window.location.hash = path && path !== '/' ? `#${path}` : '';
  }, []);
  return { ...route, navigate };
};
