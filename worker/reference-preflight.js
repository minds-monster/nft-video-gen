// Measure a reference image BEFORE it is submitted, because H3 rejects a bad one AFTER the task
// has queued — and a queued task has been billed.
//
// WHY THIS IS WORTH A FILE. scripts/prep-cast.mjs records the case that costs real money:
//
//   "REFERENCE ASPECT MUST BE 0.4-2.5, short side ≥256px … the API only says so AFTER the task
//    has queued and been billed."
//
// and scripts/probe-h3.mjs names the shape that trips it:
//
//   "A tall figure crop trips this easily: a 352x1024 cut-out of a standing character is 0.344
//    and gets rejected."
//
// That is not an edge case in this product — it is the DEFAULT shape of the input. NFT character
// art is overwhelmingly tall figures, and the Casting Director's own crop advice makes them
// taller. So the single most likely way for a visitor's first render to fail is an aspect ratio,
// and the check costs nothing: image dimensions live in the first few dozen bytes of every format
// that matters, so no decode and no dependency is needed.
//
// 🔑 THE CROP THAT FIXES THE ASPECT IS THE SAME CROP THAT FIXES THE FACE. H3_RULES rule 11 is
// that a full-body reference loses its subject's face — "clothing, colour and silhouette survive
// at any framing; facial identity only survives when the head is a large part of the reference."
// A too-tall reference therefore wants a top-weighted crop for BOTH reasons at once, which is why
// `suggestedCrop` below leans on `gravity` rather than centring. One transform, two hazards.

import { H3_REFERENCE_LIMITS } from './minimax.js';

/**
 * The two framings that lose a face, straight out of the Casting Director's own enum.
 *
 * The dossier judges a character by HEAD SIZE rather than body, on purpose — "a full-body
 * reference renders the right clothes on the wrong face, so head size is what decides whether an
 * identity survives" — which makes these two values the machine-readable form of H3_RULES rule 11.
 * 'busy-composite' is here for a second reason as well: a subject inside a card or panel means the
 * CARD is what gets reproduced, which is the lesson the ape crop in scripts/hero-prompts.mjs
 * exists to defend against.
 */
export const FACE_AT_RISK_FRAMING = new Set(['small-in-frame', 'busy-composite']);

/**
 * Dimensions from a header, for the formats H3 accepts and that carry them cheaply.
 *
 * Returns `null` rather than a guess when the format is unreadable. That distinction is the whole
 * point: "measured and legal" and "could not be measured" are different states, and collapsing
 * them either blocks a good reference or waves a bad one through. HEIC is the real case — H3
 * accepts it, but its dimensions live behind ISO-BMFF box parsing, so it comes back unmeasured
 * and is reported as such rather than failed.
 */
export const measureImage = (bytes) => {
  // Every length bound below is >=, not >. A header exactly long enough to hold the fields it
  // declares is legal, and > refused a minimal 24-byte PNG — which is the shape a generated or
  // stripped reference actually arrives in.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u8 = bytes;

  // PNG: 8-byte signature, then an IHDR chunk whose width and height are big-endian at 16 and 20.
  if (u8.length >= 24 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    return { format: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }

  // GIF: "GIF87a"/"GIF89a", then little-endian width and height at 6 and 8.
  if (u8.length >= 10 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) {
    return { format: 'gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // WebP: "RIFF" .... "WEBP", then one of three chunk types, each storing dimensions differently.
  if (u8.length >= 30 && u8[0] === 0x52 && u8[1] === 0x49 && u8[8] === 0x57 && u8[9] === 0x45) {
    const chunk = String.fromCharCode(u8[12], u8[13], u8[14], u8[15]);
    if (chunk === 'VP8X') {
      // Canvas size is stored MINUS ONE, as two 24-bit little-endian values.
      const w = (u8[24] | (u8[25] << 8) | (u8[26] << 16)) + 1;
      const h = (u8[27] | (u8[28] << 8) | (u8[29] << 16)) + 1;
      return { format: 'webp', width: w, height: h };
    }
    if (chunk === 'VP8 ') {
      return { format: 'webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const bits = u8[21] | (u8[22] << 8) | (u8[23] << 16) | (u8[24] << 24);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }

  // JPEG: walk the marker chain to a Start Of Frame. Height precedes width, which is the opposite
  // of every other format here and is exactly the kind of thing a transcription gets backwards.
  if (u8.length > 4 && u8[0] === 0xff && u8[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < u8.length) {
      if (u8[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = u8[offset + 1];
      // SOF0-SOF15, excluding DHT (C4), JPG (C8) and DAC (CC), which share the range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      offset += 2 + view.getUint16(offset + 2);
    }
    return { format: 'jpeg', width: null, height: null };
  }

  return null;
};

/** `data:image/png;base64,…` → `{ mime, bytes }`. Throws on anything that is not one. */
export const decodeDataUri = (uri) => {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(uri ?? '');
  if (!match) throw new Error('not a base64 data URI');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
};

/**
 * The crop that would bring a reference inside H3's aspect window.
 *
 * Expressed as a Cloudflare Image Transformations request rather than pixels, because that is how
 * it will actually be applied — `/cdn-cgi/image/fit=crop,gravity=…` over the existing
 * /api/cast/art proxy. There is no sharp in a Worker; this is the Worker-side equivalent of what
 * scripts/prep-cast.mjs does at build time.
 *
 * `gravity: 'top'` on a too-tall image is the deliberate choice, not a default: a tall reference
 * is almost always a standing figure, its head is at the top, and rule 11 says facial identity is
 * the one attribute that does not survive a wide framing. Centring the crop would satisfy the API
 * and lose the face — passing the check while causing the failure the check was near.
 */
export const suggestedCrop = ({ width, height }) => {
  if (!width || !height) return null;
  const aspect = width / height;
  if (aspect >= H3_REFERENCE_LIMITS.minAspect && aspect <= H3_REFERENCE_LIMITS.maxAspect) return null;

  if (aspect < H3_REFERENCE_LIMITS.minAspect) {
    return {
      width,
      height: Math.floor(width / H3_REFERENCE_LIMITS.minAspect),
      gravity: 'top',
      why: 'Too tall for H3. Cropping from the top keeps the head, which is the one thing a wide framing loses.',
    };
  }
  return {
    width: Math.floor(height * H3_REFERENCE_LIMITS.maxAspect),
    height,
    gravity: 'center',
    why: 'Too wide for H3. A centre crop keeps the subject that the framing is built around.',
  };
};

/**
 * Check one reference. Returns violations rather than throwing, so a visitor can be shown
 * everything wrong with their cast at once instead of one problem per attempt.
 *
 * `severity` matters: `floor` means the request would be rejected and billed, `soft` means it
 * would render but is a known fidelity hazard. Only floor violations block a shoot.
 */
export const checkReference = ({ key, mime, bytes, dossierFraming = null }) => {
  const violations = [];
  const measured = measureImage(bytes);

  if (bytes.length > H3_REFERENCE_LIMITS.maxBytes) {
    violations.push({
      key,
      code: 'reference-too-large',
      severity: 'floor',
      detail: `${key} is ${(bytes.length / 1e6).toFixed(1)}MB; H3 accepts up to ${H3_REFERENCE_LIMITS.maxBytes / 1e6}MB per image.`,
    });
  }

  if (mime && !H3_REFERENCE_LIMITS.mimes.includes(mime) && mime !== 'image/heic') {
    violations.push({
      key,
      code: 'reference-bad-format',
      severity: 'floor',
      detail: `${key} is ${mime}; H3 accepts ${H3_REFERENCE_LIMITS.mimes.join(', ')} and image/heic.`,
    });
  }

  // Rule 11, as a soft flag rather than a block.
  //
  // Checked BEFORE the unmeasured early-return below, deliberately: this reads the dossier, not
  // the pixels. A reference whose dimensions we could not parse is exactly as likely to lose its
  // face as one we could, and hiding the warning behind a successful measurement would silence it
  // precisely for the formats we understand least. The dossier's own framing is the evidence — the
  // Casting Director emits it as a first-class field precisely so something downstream can act on
  // it (worker/casting-director.js), and this is that something.
  // FRAMING IS AN ENUM, not prose — 'full-bleed' | 'centred-with-margin' | 'small-in-frame' |
  // 'busy-composite' (DOSSIER_SCHEMA in worker/casting-director.js). Matching it as free text is
  // how a check comes to look correct and never fire against real data.
  if (FACE_AT_RISK_FRAMING.has(dossierFraming)) {
    violations.push({
      key,
      code: 'reference-face-at-risk',
      severity: 'soft',
      detail:
        `${key} is framed "${dossierFraming}". Measured on this model: a full-length figure came ` +
        'back wearing its own outfit exactly and with a completely different face — the species ' +
        'was wrong, and prose describing it did not save it. Worth a head crop, or a Screen Test.',
    });
  }

  if (!measured || !measured.width || !measured.height) {
    // Not a violation. An unmeasurable reference may well be fine, and refusing it would block a
    // legal HEIC for no reason — but the Director must not claim the set is preflighted when one
    // of them was never actually looked at.
    return { violations, measured: null, unmeasured: true, crop: null };
  }

  const { width, height } = measured;
  const shortSide = Math.min(width, height);
  const aspect = width / height;

  if (shortSide < H3_REFERENCE_LIMITS.minShortSide) {
    violations.push({
      key,
      code: 'reference-too-small',
      severity: 'floor',
      detail: `${key} is ${width}x${height}; H3 needs a short side of at least ${H3_REFERENCE_LIMITS.minShortSide}px.`,
    });
  }

  if (Math.max(width, height) > H3_REFERENCE_LIMITS.maxSide) {
    violations.push({
      key,
      code: 'reference-too-big',
      severity: 'floor',
      detail: `${key} is ${width}x${height}; H3's longest side is ${H3_REFERENCE_LIMITS.maxSide}px.`,
    });
  }

  if (aspect < H3_REFERENCE_LIMITS.minAspect || aspect > H3_REFERENCE_LIMITS.maxAspect) {
    violations.push({
      key,
      code: 'reference-bad-aspect',
      severity: 'floor',
      detail:
        `${key} is ${width}x${height} — aspect ${aspect.toFixed(3)}, outside H3's ` +
        `${H3_REFERENCE_LIMITS.minAspect}-${H3_REFERENCE_LIMITS.maxAspect} window. ` +
        'Submitted as-is this is rejected after the task has queued, which costs a charge.',
    });
  }


  return { violations, measured, unmeasured: false, crop: suggestedCrop(measured) };
};

/**
 * Preflight a whole reference set.
 *
 * `ok` is false only for floor violations. Soft ones are hazards the Director should TEST, not
 * refuse — that distinction is the difference between a preflight and a nanny.
 */
export const preflightReferences = (references = []) => {
  const results = [];
  const violations = [];

  if (references.length > H3_REFERENCE_LIMITS.maxCount) {
    violations.push({
      key: null,
      code: 'too-many-references',
      severity: 'floor',
      detail:
        `${references.length} references for ${H3_REFERENCE_LIMITS.maxCount} slots. ` +
        'Anything with a reference renders; anything left on prose alone tends not to. Say which ' +
        'pieces do not fit rather than dropping one — a dropped asset is the single most common ' +
        'cause of a wrong render.',
    });
  }

  let totalBytes = 0;
  for (const reference of references) {
    let decoded;
    try {
      decoded = decodeDataUri(reference.dataUri);
    } catch {
      violations.push({
        key: reference.key,
        code: 'reference-unreadable',
        severity: 'floor',
        detail: `${reference.key} could not be read as image data.`,
      });
      continue;
    }
    totalBytes += decoded.bytes.length;
    const result = checkReference({
      key: reference.key,
      mime: decoded.mime,
      bytes: decoded.bytes,
      dossierFraming: reference.dossierFraming ?? null,
    });
    results.push({ key: reference.key, ...result });
    violations.push(...result.violations);
  }

  // Base64 inflates by 4/3, and the ceiling is on the encoded body rather than the raw bytes.
  if (totalBytes * 1.34 > H3_REFERENCE_LIMITS.maxRequestBytes) {
    violations.push({
      key: null,
      code: 'request-too-large',
      severity: 'floor',
      detail: `These references base64-encode to roughly ${Math.round((totalBytes * 1.34) / 1e6)}MB; the request body allows ${H3_REFERENCE_LIMITS.maxRequestBytes / 1e6}MB.`,
    });
  }

  return {
    ok: !violations.some((v) => v.severity === 'floor'),
    violations,
    results,
    unmeasured: results.filter((r) => r.unmeasured).map((r) => r.key),
  };
};
