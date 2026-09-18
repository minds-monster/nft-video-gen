// Getting an NFT's actual pixels, over a network that keeps deciding not to serve them.
//
// One module because there were three copies. worker/casting-director.js, worker/cast-art.js and
// worker/mesh.js each walked the same candidate list against the same hostile gateways, and the
// three had already drifted: cast-art.js checked the content-type, casting-director.js did not,
// and mesh.js had no IPFS fallback at all despite a comment claiming it used "the same candidate
// walk". Every consumer wants the same three things — try the candidates in order, insist on an
// image, say precisely why each one failed — so they are said once here.
//
// WHAT THE CANDIDATES COST, measured 2026-08-25 against the pieces that prompted this:
//
//   pngUrl (Alchemy/Cloudinary re-encode)   200 image/png   135-404 KB   0.5-2.4s
//   cachedUrl (Alchemy CDN mirror)          200 (as minted) 0.1-1.9 MB   1.2-2.0s
//   originalUrl (ipfs.io)                   403 text/html   5.8 KB       ← every single one
//
// That last row is the reason the content-type check is not optional. ipfs.io now answers a
// blocked CID with an HTTP 403 carrying an HTML error page, and 403 is a status, not a throw —
// so without the check the bytes of a "Gateway blocked" page get base64'd into a data: URI and
// handed to a vision model as artwork. The model then 400s, which is non-retryable, and the
// visitor is told the artwork could not be described rather than that it could not be fetched.

/**
 * Gateways to try for an IPFS path, in order.
 *
 * `cloudflare-ipfs.com` used to be the second entry and was decommissioned by Cloudflare in 2024,
 * which made the "fallback" a guaranteed second failure — a dead CID cost two round trips and
 * produced no alternative. These three are independent operators, so a CID unpinned at one has a
 * real chance at another.
 */
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://w3s.link/ipfs/',
];

const IPFS_PREFIX = 'https://ipfs.io/ipfs/';

/** An ipfs.io URL becomes one attempt per gateway; anything else is left exactly as it is. */
export const withIpfsFallback = (url) => {
  if (!url?.startsWith(IPFS_PREFIX)) return [url];
  const path = url.slice(IPFS_PREFIX.length);
  return IPFS_GATEWAYS.map((gateway) => gateway + path);
};

// IPFS.io and some creator CDNs serve 403 or 0 bytes to a bare fetch user-agent.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0';

/** A hung origin used to stall a whole cast: there was no deadline anywhere on this path. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * One candidate, fetched and checked. Throws with a reason worth reading.
 *
 * `maxBytes` is enforced twice on purpose — once on the declared content-length so an oversized
 * body is refused before it is downloaded, and once on what actually arrived, because the header
 * is a claim rather than a fact.
 */
const fetchOne = async (url, maxBytes) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') ?? 'image/png';
  if (!contentType.startsWith('image/')) throw new Error(`content-type ${contentType}`);

  const declared = response.headers.get('content-length');
  if (maxBytes && declared && Number(declared) > maxBytes) {
    throw new Error(`too large to proxy: ${declared} bytes`);
  }

  const buffer = await response.arrayBuffer();
  if (maxBytes && buffer.byteLength > maxBytes) {
    throw new Error(`too large to proxy: ${buffer.byteLength} bytes`);
  }

  return { bytes: new Uint8Array(buffer), contentType, url };
};

/**
 * The first candidate that actually answers with an image.
 *
 * Throws an Error whose message names EVERY attempt and what each one did. That string is the
 * only account anyone gets of a piece that cannot be fetched, so it is assembled rather than
 * summarised — "ipfs.io: content-type text/html | dweb.link: HTTP 504" is diagnosable and
 * "could not fetch the artwork" is not.
 */
export const fetchArtwork = async (urls, { maxBytes = 0 } = {}) => {
  const errors = [];
  for (const url of (urls ?? []).flatMap(withIpfsFallback)) {
    if (!url) continue;
    try {
      return await fetchOne(url, maxBytes);
    } catch (error) {
      errors.push(`${url.slice(0, 60)}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' | ') || 'no candidate URLs');
};

/** A film by its opening bytes: an ISO-BMFF `ftyp` box (mp4, mov) or an EBML header (webm). */
const looksLikeFilm = (bytes) =>
  (bytes.length >= 8 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp') ||
  (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3);

/**
 * The first candidate URL that actually serves a FILM, or null — without downloading any of them.
 *
 * THE STATUS CODE IS NOT EVIDENCE HERE, measured three ways on 2026-09-18
 * (scripts/probe-frames.mjs): Alchemy's animation mirror answers HTTP 206 with a ~120-byte JSON
 * stub for films it never finished copying; a creator host answered 206 with an HTML error page;
 * and ipfs.io answers with a bot-challenge page. Handed to a video model as a film, each of those
 * fails in a way that looks like the MODEL failing. So the opening bytes decide.
 *
 * Only the first chunk is read and the rest cancelled, because some hosts ignore Range and would
 * otherwise stream a 40MB film into a check that needs twelve bytes of it.
 */
export const findFilm = async (urls) => {
  for (const url of (urls ?? []).flatMap(withIpfsFallback)) {
    if (!url) continue;
    try {
      // eslint-disable-next-line no-await-in-loop -- one host at a time, as fetchArtwork does.
      const response = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, Range: 'bytes=0-63' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok || !response.body) continue;
      const reader = response.body.getReader();
      // eslint-disable-next-line no-await-in-loop
      const { value } = await reader.read();
      reader.cancel().catch(() => {});
      if (value && looksLikeFilm(value)) return url;
    } catch {
      // A dead or slow host is just the next candidate's turn.
    }
  }
  return null;
};

/**
 * Bytes as a base64 data URI, for the models that take an image inline.
 *
 * Chunked because `String.fromCharCode.apply` on a multi-megabyte array blows the argument limit.
 */
export const toDataUri = ({ bytes, contentType }) => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
};
