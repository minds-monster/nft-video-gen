// The cast's own pixels, served to the previz renderer.
//
// WHAT THIS IS NOT, and the measurement that decided it. The plan for this round called for an
// AI cut-out: hand the artwork to an image model, ask for the subject on a transparent
// background. Probed on 2026-08-25 against google/gemini-2.5-flash-image, and it failed in the
// most instructive way available — it returned an opaque RGB PNG with a CHECKERBOARD PAINTED
// INTO THE PIXELS. It had reproduced the visual convention for transparency rather than
// producing an alpha channel, because a checkerboard is what "transparent background" looks like
// in its training data. It also cost $0.039 per image, not the fractions of a cent the plan
// assumed.
//
// So the cut-out is not bought, it is COMPUTED — and it turns out to be computable exactly for
// the case that matters most. A PFP on a flat background has a background colour that can be
// read off its own corner pixels, and a subject whose outline is then every pixel that is not
// that colour. That is arithmetic: free, instant, and EXACT where a model was approximate. It
// also cannot fabricate, which matters more here than the money — see the medium gate.
//
// The keying itself lives in the browser (src/lib/castTexture.js), where a canvas gives pixel
// access that a Worker has no image library for. This module's whole job is to get the bytes
// there: resolve the piece's own artwork, cache it, and serve it same-origin so the canvas is
// not tainted and the pixels can actually be read.
//
// PROVENANCE IS THE OTHER HALF OF THE JOB. Every response names the exact source URL it was
// derived from, so a card on screen is traceable to the artwork it came from without anyone
// having to trust that it is.

const R2_PREFIX = 'cast';

/** A year, immutable. The artwork behind a token id cannot change — the same reasoning that
 * makes a dossier permanent rather than cached. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

// Matches src/lib/assetKey.js: `chain:address:tokenId`. Token ids are decimal strings that can
// run to 78 digits, hence the generous tail.
const ASSET_KEY = /^[a-z0-9-]{1,32}:0x[a-fA-F0-9]{40}:[A-Za-z0-9_-]{1,96}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/**
 * The dossier for a piece, at whichever schema version is current.
 *
 * Deliberately reads the CURRENT version only. An older dossier does not carry
 * `sourceImageUrls` — that field arrived with v5 — so there is nothing here to serve from it,
 * and quietly falling back to one would produce a confident 404-shaped success. Running the
 * backfill is what fixes those, and saying so is more useful than guessing.
 */
const dossierFor = async (env, assetKey, version) => {
  if (!env.DOSSIERS) return null;
  return env.DOSSIERS.get(`dossier:v${version}:${assetKey}`, 'json');
};

const IPFS_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/'];

const withIpfsFallback = (url) => {
  if (!url?.startsWith('https://ipfs.io/ipfs/')) return [url];
  const path = url.slice('https://ipfs.io/ipfs/'.length);
  return IPFS_GATEWAYS.map((gateway) => gateway + path);
};

/**
 * The first of the candidates that actually answers with an image.
 *
 * Same walk as worker/casting-director.js's fetchImageAsDataUri, and the same hard-won reasons:
 * some IPFS CIDs have no providers left, some creator CDNs 403 a bare user-agent, and Alchemy's
 * mirror is the one that reliably resolves. Bytes rather than a data URI here, because these are
 * going into an <img>, not into a model's context window.
 */
const fetchArtwork = async (urls) => {
  const errors = [];
  for (const url of urls.flatMap(withIpfsFallback)) {
    if (!url) continue;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') ?? 'image/png';
      if (!contentType.startsWith('image/')) throw new Error(`content-type ${contentType}`);
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType, url };
    } catch (error) {
      errors.push(`${url.slice(0, 60)}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' | ') || 'no candidate URLs');
};

/**
 * One cast member's artwork, same-origin.
 *
 * SAME-ORIGIN IS THE ENTIRE POINT, not a caching nicety. The renderer has to READ these pixels
 * to key the background out, and a cross-origin image taints the canvas so that reading them
 * throws. Alchemy's CDN happens to send permissive CORS today; IPFS gateways and creator CDNs
 * variously do not, and a representation that works for some pieces and silently fails for
 * others is worse than one that works for none.
 */
export async function handleCastArt(request, env) {
  const { searchParams } = new URL(request.url);
  const assetKey = searchParams.get('asset');

  if (!assetKey || !ASSET_KEY.test(assetKey)) {
    return json({ error: 'asset must be a chain:address:tokenId key' }, 400);
  }

  const version = Number(searchParams.get('v') || env.DOSSIER_SCHEMA_VERSION || 5);
  const r2Key = `${R2_PREFIX}/${assetKey}/source`;

  // Served from R2 on every request after the first. The bucket is the same one storyboard
  // sketches use; the `cast/` prefix is what keeps the two apart, here and in the route guard
  // on /api/storyboard/image.
  const cached = env.STORYBOARD_IMAGES ? await env.STORYBOARD_IMAGES.get(r2Key) : null;
  if (cached) {
    return new Response(cached.body, {
      headers: {
        'content-type': cached.httpMetadata?.contentType ?? 'image/png',
        'cache-control': CACHE_CONTROL,
        'access-control-allow-origin': '*',
        'x-source-url': cached.customMetadata?.sourceUrl ?? '',
        'x-cache': 'r2',
      },
    });
  }

  const dossier = await dossierFor(env, assetKey, version);
  if (!dossier) {
    return json({ error: `No v${version} dossier for ${assetKey}. Cast the piece, or run scripts/backfill-profiles.mjs.` }, 404);
  }

  const candidates = dossier.sourceImageUrls ?? [];
  if (!candidates.length) {
    return json({ error: `The dossier for ${assetKey} records no source artwork.` }, 404);
  }

  let artwork;
  try {
    artwork = await fetchArtwork(candidates);
  } catch (error) {
    return json({ error: `Could not fetch the artwork for ${assetKey}: ${error.message}` }, 502);
  }

  if (env.STORYBOARD_IMAGES) {
    await env.STORYBOARD_IMAGES.put(r2Key, artwork.bytes, {
      httpMetadata: { contentType: artwork.contentType },
      // The source is recorded ON the stored object, not only in the dossier. A derivative that
      // travels without its provenance is a derivative nobody can check.
      customMetadata: { sourceUrl: artwork.url, assetKey },
    });
  }

  return new Response(artwork.bytes, {
    headers: {
      'content-type': artwork.contentType,
      'cache-control': CACHE_CONTROL,
      'access-control-allow-origin': '*',
      'x-source-url': artwork.url,
      'x-cache': 'miss',
    },
  });
}
