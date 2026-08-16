// Dev-only CORS workaround for the Minds Builder API.
//
// api.build.hellominds.ai only returns access-control-allow-origin for
// *.hellominds.ai origins, so every browser call from localhost fails preflight
// with "Failed to fetch". @animocabrands/minds-client-lib hardcodes its base URL
// (MindsClientOptions has no baseUrl override), so we can't point it elsewhere.
//
// Instead we wrap fetch and rewrite that origin to the Vite proxy prefix, which
// forwards the request from Node. Import this before any Minds client is created.
//
// This does NOT fix production — see README for the backend-proxy requirement.
const MINDS_API_ORIGIN = 'https://api.build.hellominds.ai';
const MINDS_PROXY_PREFIX = '/__minds';

const rewrite = (url) =>
  url.startsWith(MINDS_API_ORIGIN)
    ? MINDS_PROXY_PREFIX + url.slice(MINDS_API_ORIGIN.length)
    : url;

if (import.meta.env.DEV && typeof window !== 'undefined' && !window.__mindsProxyInstalled) {
  window.__mindsProxyInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    // A Request object carries its URL internally, so rebuild it around the new one.
    if (input instanceof Request) {
      const next = rewrite(input.url);
      return next === input.url
        ? originalFetch(input, init)
        : originalFetch(new Request(next, input), init);
    }
    return originalFetch(rewrite(String(input)), init);
  };
}
