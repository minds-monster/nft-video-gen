// Turning a piece's artwork into something that can stand in a scene.
//
// THE CUT-OUT IS COMPUTED, NOT GENERATED, and that is a measured decision rather than a frugal
// one. Asking an image model for "the subject on a transparent background" was probed on
// 2026-08-25: it returned an opaque RGB PNG with a CHECKERBOARD PAINTED INTO THE PIXELS — the
// visual convention for transparency, reproduced as image content — and charged $0.039 for it.
// See worker/cast-art.js's header.
//
// A flat-background PFP does not need a model at all. Its background colour is sitting in its
// own corner pixels, and its outline is every pixel that is not that colour. That is exact where
// a model is approximate, free where a model is not, and — the part that actually matters — it
// CANNOT INVENT ANYTHING. It only ever removes; it never draws. For a round whose whole
// discipline is that a representation must not fabricate what the source does not contain, an
// operation that is incapable of fabricating is worth more than a better-looking one.
//
// Where the background is NOT flat, nothing is keyed and the card stays a rectangle. That is
// honest about a busy composite, and it is the case a paid cut-out could improve later — with
// its price now known rather than assumed.

/** Big enough to read at hero scale, small enough that five of them are not a memory problem. */
const MAX_EDGE = 1024;

/** How close a pixel must be to the sampled background to be removed outright. Euclidean in RGB,
 * so 24 is a little under 2% of the space's diagonal — tight enough to keep a pale subject on a
 * white field, loose enough to absorb JPEG ringing and PNG quantisation. */
const KEY_TOLERANCE = 24;

/** Beyond the hard threshold, alpha ramps rather than cliffs. Without this every cut-out carries
 * a one-pixel halo of background colour, which reads as a sticker outline the moment the card is
 * seen against anything darker than the artwork's own background. */
const FEATHER = 3;

/** The four corners have to agree this closely before the background counts as flat. Deliberately
 * stricter than KEY_TOLERANCE: a gradient background is exactly the thing that looks flat at one
 * corner and is not, and keying it would eat half the subject. */
const FLATNESS_TOLERANCE = 12;

const distance = (data, i, r, g, b) => {
  const dr = data[i] - r;
  const dg = data[i + 1] - g;
  const db = data[i + 2] - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

/**
 * The colour of a small corner patch, per channel, by MEDIAN rather than mean.
 *
 * Measured the difference on a fixture where the subject reaches into the corner: the mean of a
 * patch that is three parts pink background and one part black outline is a muddy rose that
 * exists nowhere in the image, and keying on it removes neither. The median of the same patch is
 * the pink, because the background is what most of the patch actually is.
 *
 * The general rule this is an instance of: when a sample may be contaminated by the thing you are
 * trying to exclude, averaging spreads the contamination and the median rejects it.
 */
const patchColour = (data, width, x0, y0, size) => {
  const channels = [[], [], []];
  for (let y = y0; y < y0 + size; y += 1) {
    for (let x = x0; x < x0 + size; x += 1) {
      const i = (y * width + x) * 4;
      channels[0].push(data[i]);
      channels[1].push(data[i + 1]);
      channels[2].push(data[i + 2]);
    }
  }
  return channels.map((values) => {
    values.sort((a, b) => a - b);
    const mid = values.length >> 1;
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  });
};

/**
 * Is the area outside the subject one flat colour, and which?
 *
 * Answered from the corners, because the corners are the one part of an image that is background
 * in almost every composition — a subject that reaches all four corners is full-bleed, and
 * full-bleed is precisely the case where there is nothing to remove.
 */
export const backgroundColour = (data, width, height) => {
  // Down to a single pixel on a small image. A patch that is a large fraction of the picture is
  // not a sample of the corner, it is a sample of the subject.
  const size = Math.max(1, Math.min(8, Math.floor(Math.min(width, height) / 64)));
  const corners = [
    patchColour(data, width, 0, 0, size),
    patchColour(data, width, width - size, 0, size),
    patchColour(data, width, 0, height - size, size),
    patchColour(data, width, width - size, height - size, size),
  ];
  const [r0, g0, b0] = corners[0];
  for (const [r, g, b] of corners.slice(1)) {
    if (Math.hypot(r - r0, g - g0, b - b0) > FLATNESS_TOLERANCE) return null;
  }
  const mean = corners.reduce((acc, c) => [acc[0] + c[0] / 4, acc[1] + c[1] / 4, acc[2] + c[2] / 4], [0, 0, 0]);
  return mean.map(Math.round);
};

/**
 * Remove the background, from the EDGES INWARD.
 *
 * A flood fill rather than "delete every pixel of this colour", and the difference is the whole
 * correctness of the thing: an ape on a white field usually has white in its eyes and teeth, and
 * a global colour replace punches holes straight through the face. Only background that is
 * connected to the edge of the image is background.
 */
export const keyOut = (data, width, height, [r, g, b]) => {
  const total = width * height;
  const seen = new Uint8Array(total);
  // An explicit stack, not recursion: a 1024x1024 flood fill would blow the call stack, and
  // typically does so on exactly the pieces with the largest flat backgrounds.
  const stack = [];

  for (let x = 0; x < width; x += 1) {
    stack.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    stack.push(y * width, y * width + width - 1);
  }

  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    const d = distance(data, i, r, g, b);
    if (d > KEY_TOLERANCE * FEATHER) continue;

    // Inside the hard threshold the pixel is background and goes entirely. Between there and the
    // feather limit it is a blend of subject and background — an anti-aliased edge — and keeping
    // it partly opaque is what stops the outline reading as a cut-out halo.
    data[i + 3] = d <= KEY_TOLERANCE
      ? 0
      : Math.round(255 * ((d - KEY_TOLERANCE) / (KEY_TOLERANCE * (FEATHER - 1))));

    // Only continue through pixels that were fully removed. Spreading through half-transparent
    // edge pixels is how a fill leaks into the subject through an anti-aliased gap.
    if (data[i + 3] !== 0) continue;
    const x = p % width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (p >= width) stack.push(p - width);
    if (p < total - width) stack.push(p + width);
  }
};

/** The tightest rectangle containing everything still visible. */
export const boundsOf = (data, width, height) => {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < 8) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
};

/**
 * One cast member's artwork, ready to stand up in a scene.
 *
 * Returns the cropped canvas plus what was actually done to it — never a bare image, because the
 * renderer has to be able to say honestly whether it is showing a cut-out subject or a rectangle
 * of artwork, and those are different claims.
 *
 * CROPPING TO THE SUBJECT IS WHAT MAKES TRUE HEIGHT TRUE. The card is drawn at the subject's
 * measured heightM. If the texture were the whole image, that height would be spread across the
 * artwork's margins and the piece would stand shorter than it is — the same quiet lie about scale
 * the physical profile exists to remove.
 */
export const buildCastTexture = async (imageUrl, { signal } = {}) => {
  // FETCHED RATHER THAN ASSIGNED TO AN <img>, for the error messages. An Image whose src returns
  // a 404 of JSON reports "the source image cannot be decoded", which is true and useless — the
  // actual answer is usually "this piece has no v5 dossier yet, run the backfill". A response
  // object can say so.
  const response = await fetch(imageUrl, { signal });
  if (!response.ok) {
    const reason = await response.json().then((body) => body.error).catch(() => `HTTP ${response.status}`);
    throw new Error(reason);
  }

  // The artwork this was derived from, carried back from the Worker. Held so a card on screen can
  // name its own source without a second lookup — provenance travelling WITH the pixels rather
  // than alongside them.
  const sourceUrl = response.headers.get('x-source-url') || null;
  const image = await createImageBitmap(await response.blob());
  if (signal?.aborted) throw new Error('aborted');

  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const background = backgroundColour(imageData.data, width, height);

  if (!background) {
    // A busy composite. Nothing is removed, and the caller is told so rather than being handed a
    // rectangle that claims to be a cut-out.
    return { canvas, width, height, aspect: width / height, keyed: false, background: null, sourceUrl };
  }

  keyOut(imageData.data, width, height, background);
  ctx.putImageData(imageData, 0, 0);

  const bounds = boundsOf(imageData.data, width, height);
  // Everything keyed away means the corners were the subject — a full-bleed pattern, or artwork
  // whose subject IS its background. Keeping the original is the only honest answer.
  if (!bounds || bounds.width < width * 0.05 || bounds.height < height * 0.05) {
    ctx.drawImage(image, 0, 0, width, height);
    return { canvas, width, height, aspect: width / height, keyed: false, background, sourceUrl };
  }

  const cropped = document.createElement('canvas');
  cropped.width = bounds.width;
  cropped.height = bounds.height;
  cropped.getContext('2d').drawImage(canvas, bounds.left, bounds.top, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);

  return {
    canvas: cropped,
    width: bounds.width,
    height: bounds.height,
    aspect: bounds.width / bounds.height,
    keyed: true,
    background,
    sourceUrl,
    // How much of the original the subject actually occupied. The dossier's own `framing` field is
    // a judgement about this; this is the measurement, and the two disagreeing is worth knowing.
    coverage: (bounds.width * bounds.height) / (width * height),
  };
};

/** The URL the renderer asks for. One place, so the route and the query shape are stated once. */
export const castArtUrl = (assetKey) => `/api/cast/art?asset=${encodeURIComponent(assetKey)}`;
