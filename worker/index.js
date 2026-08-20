// The API half of the app. The other half is `dist/`, served as static assets by the
// same deploy — see the `assets` block in wrangler.jsonc.
//
// This exists because the SPA cannot make these calls itself. Vite inlines every VITE_
// variable into the client bundle (.env.example warns about exactly that), so an NVIDIA
// key put anywhere the browser can reach it is a published key; and
// integrate.api.nvidia.com sends no CORS headers to a browser origin anyway. Same two
// reasons the Minds API is proxied through the dev server in vite.config.js — this is
// that idea, made to work in production too.

import { castPiece } from './casting-director.js';
import { screenwrite } from './screenwriter.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

// Surfaced to the client so a rate-limited run can say so, rather than reading as a bug.
// The free tier's ~40 RPM ceiling makes 429 an expected outcome, not an exceptional one.
const failure = (error) => {
  const status = error?.status === 429 ? 429 : 500;
  return json({ error: error?.message ?? 'Unknown error', retryable: status === 429 }, status);
};

const ROUTES = {
  'POST /api/casting': castPiece,
  'POST /api/screenwriter': screenwrite,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/health') {
      // Reports configuration, never values — enough to tell "the key is missing" apart
      // from "the model rejected the request", which are otherwise the same 500.
      return json({
        ok: true,
        hasNvidiaKey: Boolean(env.NVIDIA_API_KEY),
        hasDossierStore: Boolean(env.DOSSIERS),
        castingModel: env.CASTING_MODEL,
        screenwriterModel: env.SCREENWRITER_MODEL,
      });
    }

    const handler = ROUTES[`${request.method} ${pathname}`];
    if (!handler) return json({ error: `No route for ${request.method} ${pathname}` }, 404);

    try {
      return await handler(request, env, ctx);
    } catch (error) {
      console.error(`${request.method} ${pathname} failed:`, error);
      return failure(error);
    }
  },
};
