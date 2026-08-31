// The first still for a piece that H3 will actually ACCEPT — measured before a cent is spent.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT cost three renders on 2026-08-28. A generative-art
// token's first still was a 140x250 thumbnail; H3's floor is a 256px short side; the request was
// accepted, queued, billed, and failed a minute later with "invalid param: image size 140x250".
// Nothing on the production recorded the failure, so the panel read "not yet run" and offered
// the same doomed run again. Twice.
//
// worker/reference-preflight.js could already measure an image. What was missing was calling it
// at the moment of spending, and letting a piece with several candidate stills (Alchemy serves
// a PNG conversion, a CDN copy, the original, a thumbnail — worker/casting-director.js
// `castingStills`) fall through to one that is legal rather than dying on the first that loads.

import { fetchArtwork, toDataUri } from './artwork.js';
import { checkReference } from './reference-preflight.js';

/**
 * What a Worker can safely hold as a reference. H3 accepts 30MB per image, but a data URI is
 * built from a JS string and this runtime has 128MB: a 27.5MB PNG (the Yawanawa token's CDN
 * copy, measured 2026-08-28) is ~55MB as a binary string and ~74MB again as base64. So anything
 * above this is not loaded whole — a resized copy is asked for instead (`fetchResized`).
 */
export const REFERENCE_PROXY_BYTES = 8 * 1024 * 1024;

/** The longest side a resized copy is asked for. Generous for identity; far under the cap. */
const RESIZE_MAX_SIDE = 2048;

/**
 * Ask Cloudflare to resize on the way in. The `cf.image` option needs Image Resizing enabled on
 * the zone; where it is not, the origin bytes come back untouched and the size check below
 * refuses them — so this can only ever help, never load more than the cap.
 */
const fetchResized = async (url, maxBytes) => {
  const response = await fetch(url, {
    cf: { image: { width: RESIZE_MAX_SIDE, height: RESIZE_MAX_SIDE, fit: 'scale-down', format: 'png' } },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!contentType.startsWith('image/')) throw new Error(`content-type ${contentType}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new Error(`still ${(declared / 1e6).toFixed(1)}MB after asking for a resized copy — Image Resizing is not enabled on this zone`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`still ${(bytes.byteLength / 1e6).toFixed(1)}MB after asking for a resized copy`);
  return { url, bytes, contentType };
};

/**
 * Walk the candidate URLs for one piece and return the first that fetches AND passes every floor
 * check. Throws — with `code: 'reference_illegal'` and every candidate's reason — when none does.
 *
 * Unmeasurable formats (HEIC) pass, as the preflight intends: "measured and legal" and "could not
 * be measured" are different states, and refusing the second would block a legal reference.
 */
export async function fetchLegalReference(urls, { key, dossierFraming = null, maxBytes = REFERENCE_PROXY_BYTES } = {}) {
  const tried = [];
  for (const url of urls ?? []) {
    let artwork;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential against third-party media hosts.
      artwork = await fetchArtwork([url], { maxBytes });
    } catch (error) {
      // Too big to hold is not the same as unusable: a 3072x5472 original is the BEST still a
      // piece has. Ask for it smaller before writing it off.
      if (/too large to proxy/.test(error.message)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          artwork = await fetchResized(url, maxBytes);
        } catch (resizeError) {
          tried.push({ url, reason: `${error.message}; ${resizeError.message}` });
          continue;
        }
      } else {
        tried.push({ url, reason: error.message });
        continue;
      }
    }
    const check = checkReference({ key, mime: artwork.contentType, bytes: artwork.bytes, dossierFraming });
    const floor = check.violations.filter((violation) => violation.severity === 'floor');
    if (!floor.length) {
      return { dataUri: toDataUri(artwork), url: artwork.url ?? url, measured: check.measured, check, tried };
    }
    tried.push({ url, reason: floor.map((violation) => violation.detail).join('; ') });
  }

  const summary = tried.length
    ? tried.map((entry) => entry.reason).join(' | ')
    : 'no candidate URLs';
  throw Object.assign(
    new Error(`No usable still for "${key}" — every candidate was refused before spending: ${summary}`),
    { code: 'reference_illegal', key, tried, fatal: true },
  );
}
