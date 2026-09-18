// Pure resolvers for the media hiding inside an Alchemy NFT response.
//
// These live here rather than in src/services/alchemy.js because that module reads
// `import.meta.env` at module scope, which Node can't evaluate — so importing it from a
// script throws. Everything in this file is pure and dependency-free, so both the browser
// app and scripts/*.mjs can use it. src/services/alchemy.js re-exports all of it, so
// existing imports from there keep working.

export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

export const toHttp = (url) =>
  url?.startsWith('ipfs://') ? IPFS_GATEWAY + url.slice('ipfs://'.length) : url;

export const getAllImageCandidates = (nft) => [
  nft?.image?.cachedUrl,
  nft?.image?.pngUrl,
  nft?.image?.originalUrl,
  nft?.image?.thumbnailUrl,
  nft?.media?.[0]?.gateway,
  nft?.raw?.metadata?.image,
  nft?.rawMetadata?.image,
  nft?.raw?.metadata?.image_url,
  nft?.rawMetadata?.image_url,
  nft?.raw?.metadata?.display_image_url,
  nft?.rawMetadata?.display_image_url,
  nft?.raw?.metadata?.original_image_url,
  nft?.rawMetadata?.original_image_url,
  nft?.contract?.openSeaMetadata?.imageUrl,
];

// alchemy-sdk v3 moved image fields from `media[]`/`rawMetadata` to a structured
// `image` object. We read v3 first and keep the v2 keys as a fallback so older
// cached responses (and the mocks in alchemy.js) still render.
// `thumbnailUrl` deliberately sits BELOW the full-size options. Cards render artwork with
// `object-contain` and the Studio shows it up to 72vh tall, so a thumbnail standing in for the
// real image is visibly soft — a crop used to hide that. resolveNftThumb below now serves the
// case that actually wants a small file.
export const resolveNftImage = (nft) =>
  toHttp(getAllImageCandidates(nft).find((value) => typeof value === 'string' && value.trim()));

// The blurred bed painted behind `object-contain` artwork, so a piece that doesn't match its
// card's shape sits on a soft enlargement of itself instead of on dead bars. Thumbnail first:
// this gets blurred beyond recognition, so bytes matter and sharpness does not.
export const resolveNftThumb = (nft) =>
  toHttp(
    [
      nft?.image?.thumbnailUrl,
      ...getAllImageCandidates(nft),
    ].find((value) => typeof value === 'string' && value.trim())
  ) ?? null;

// Things an animation_url can point at that a <video> can't play. We deny-list rather
// than allow-list extensions because the video URLs frequently have none at all.
const NON_VIDEO_EXT = /\.(html?|glb|gltf|svg|pdf|json|png|jpe?g|gif|webp|avif)(\?|#|$)/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;

// Many brand NFTs are films, not stills: the still lives in `image` and the video in
// the metadata's `animation_url` (Nike's CRYPTOKICKS, YSL's Beauty Blocks). Some
// tokens have only the video. Alchemy also sometimes reports a video contentType on
// the image object itself.
//
// Crucially, a lot of these URLs carry NO file extension — adidas Into the Metaverse
// points at a bare IPFS CID (`ipfs://Qm…/`) that serves video/mp4. So we can't require
// an extension; anything that isn't recognisably non-video is treated as a candidate,
// and the player falls back to the still if it turns out not to be playable.
//
// ALCHEMY MIRRORS THE FILM TOO, under `animation` — `{ cachedUrl, contentType, size,
// originalUrl }`, parallel to `image` — and until 2026-09-18 nothing here read it. Measured
// that day (scripts/probe-frames.mjs): ipfs.io now answers every non-browser fetch, and
// every subresource load from a page, with a Cloudflare bot challenge, so for 26 of 61 films
// in the registry the metadata's own URL is dead and Alchemy's mirror is the only source.
// But the mirror is not always complete: for about 1 film in 5 it is a partial-upload stub
// (HTTP 206, ~120 bytes of JSON) and the metadata's URL is the one that works. Neither
// source is sufficient alone, so this returns BOTH, in order, and callers walk the list.
const alchemyFilm = (nft, declared) => {
  const animation = nft?.animation;
  if (!animation) return [];
  const type = animation.contentType;
  // A known non-video type — an HTML piece, a GLB, a GIF, a JSON document — is not a film.
  if (type && !type.startsWith('video/')) return [];
  // Type unknown: trust the metadata's own URL. If it is recognisably not a video, neither
  // is Alchemy's copy of it.
  if (!type && declared && NON_VIDEO_EXT.test(toHttp(declared))) return [];
  return [animation.cachedUrl, animation.originalUrl];
};

/** Every URL a token's film might play from, best first. Walk it; any one may fail. */
export const resolveNftVideoCandidates = (nft) => {
  const metadata = nft?.raw?.metadata ?? nft?.rawMetadata ?? {};
  const declared = [
    metadata.animation_url,
    metadata.animation,
    metadata.video_url,
    metadata.video,
    nft?.animationUrl,
  ].find((value) => typeof value === 'string' && value.trim());
  const [mirror, mirroredOriginal] = alchemyFilm(nft, declared?.trim());
  const imageFilm = nft?.image?.contentType?.startsWith('video/')
    ? [nft.image.originalUrl, nft.image.cachedUrl]
    : [];

  // The mirror leads: it is a fast CDN, and the only source for a challenged ipfs.io film.
  // Where it is a stub, the next entry is the metadata's own URL — the one that worked
  // before this list existed.
  return [mirror, ...imageFilm, declared, mirroredOriginal]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => toHttp(value.trim()))
    .filter((url) => !NON_VIDEO_EXT.test(url))
    .filter((url, index, all) => all.indexOf(url) === index);
};

/** The first film candidate, for callers that only ask whether a token HAS a film. */
export const resolveNftVideo = (nft) => resolveNftVideoCandidates(nft)[0] ?? null;

/**
 * True when `url` might be a video even though it's in an image slot — an
 * extension-less IPFS URI. adidas Phase 1 puts an mp4 in `image`, so an <img> onError
 * there isn't a broken token, it's a film in the wrong field.
 */
export const mayBeVideoUrl = (url) =>
  Boolean(url) && !IMAGE_EXT.test(url) && !NON_VIDEO_EXT.test(url);

/**
 * `{ image, video, videos }` — image or video may be null, but a renderable NFT has at
 * least one. `videos` is every film candidate in order; a player should try the next on
 * error (src/hooks/useFilmFallback.js) rather than giving up on the first.
 */
export const resolveNftMedia = (nft) => {
  const videos = resolveNftVideoCandidates(nft);
  return { image: resolveNftImage(nft), video: videos[0] ?? null, videos };
};

// v3 renamed `title` to `name`; BAYC returns null for both, hence the token fallback.
export const resolveNftName = (nft) => nft?.name || nft?.title || `Token #${nft?.tokenId}`;

// Some collections put the interesting copy in the token description; the Studio
// shows it when there is one.
export const resolveNftDescription = (nft) =>
  nft?.description ||
  nft?.raw?.metadata?.description ||
  nft?.rawMetadata?.description ||
  '';

/**
 * Every still Alchemy knows about for a token, best-quality first.
 *
 * `cachedUrl` is what the UI wants (fast, CORS-friendly) but it can be a thumbnail,
 * so reference-image preparation wants `originalUrl`/`pngUrl` ahead of it. Returned in
 * preference order for a caller that will try each until one downloads at usable size.
 */
export const stillCandidates = (nft) =>
  [
    nft?.image?.originalUrl,
    nft?.image?.pngUrl,
    ...getAllImageCandidates(nft),
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => toHttp(value.trim()))
    // An "image" field that is really an mp4 is no use as a still.
    .filter((url) => !nft?.image?.contentType?.startsWith('video/') || url !== toHttp(nft.image.originalUrl))
    .filter((url, index, all) => all.indexOf(url) === index);
