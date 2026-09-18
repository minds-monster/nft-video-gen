// Frames from an NFT's own film, chosen to be H3 references.
//
// WHY THIS EXISTS. A moving piece is submitted to MiniMax as one still, and two paid screen tests
// (scripts/screen-frames.mjs, 2026-09-18) measured what that loses:
//
//   · a turntable (SUPERGUCCI #11): frames do no harm; any benefit was inside run-to-run noise.
//   · a transformation (Idle Hands #4): the still alone rendered a GENERIC stand-in for the
//     artwork's middle and the wrong ending; nine of the film's own frames, bound as "moments in
//     order", rendered the artwork's actual states, in order, near frame-accurate.
//
// So for some pieces the film's frames are not an upgrade — they are the only way to render them.
//
// WHY THE MODEL CHOOSES FROM FRAMES, AND DOES NOT NAME TIMESTAMPS. The Casting Director's motion
// pass watches the film and describes it; on the adidas Into the Metaverse token it wrote "the
// character rotates 360 degrees on a platform", and eight frames at explicit timestamps showed a
// PROMO REEL of four different characters — two apes, a woman, a crystal figure. A model asked to
// name moments from a video it watched with reasoning switched off (video input requires it) is
// the wrong instrument. Instead, frames are pulled at EXPLICIT timestamps (worker/frames.js
// `sampleTimes`, the sampler whose history is in that file's header) and shown SIDE BY SIDE WITH
// THE STILL, as images — which the model can reason about — and it picks frames by number. "Is
// this the same subject as the still?" is a far easier question with both pictures in front of it.
//
// ⚠️ A FILM CAN CONTAIN SOMEONE ELSE'S PIECE. The adidas reel includes another holder's avatar.
// A frame of a different subject is never kept, however similar its style: rendered into a
// visitor's film it would be an NFT they do not own.

import { chat, jsonFrom } from './nvidia.js';
import { fetchArtwork, findFilm, toDataUri } from './artwork.js';
import { checkReference } from './reference-preflight.js';
import { frameUrl, sampleTimes } from './frames.js';

/** How a film moves, which decides how many frames it needs and how they are bound in a prompt. */
export const FILM_KINDS = ['turntable', 'transformation', 'performance', 'camera-move', 'reel', 'static', 'other'];

/**
 * How pictures of ONE subject are bound in a prompt, by film kind — the wording each screen test
 * used. Angles and moments are different instructions, and giving H3 the wrong one is how nine
 * frames of a transformation become "views of one character from different angles".
 */
export const BINDING_BY_KIND = {
  turntable: 'views of ONE subject from different angles, not different subjects',
  transformation: 'moments from ONE continuous performance, in order, not different subjects',
  performance: 'moments from ONE continuous performance, in order, not different subjects',
  'camera-move': 'views of ONE subject from different angles, not different subjects',
  reel: 'views of ONE subject, not different subjects',
  static: 'views of ONE subject, not different subjects',
  other: 'views of ONE subject, not different subjects',
};

/** More than H3's nine slots is never useful: the Screenwriter still has to fit the rest of the cast. */
export const MAX_KEPT_FRAMES = 9;

/** A reel's own subject appears briefly; more than this from one is repetition, not coverage. */
export const MAX_REEL_FRAMES = 3;

/**
 * How many frames are sampled for the model to choose from: EIGHT.
 *
 * The hard ceiling is eleven — the model takes at most TWELVE images in one prompt and the still
 * is the first ("VLLMValidationError: At most 12 image(s) may be provided in one prompt", 16
 * frames, 2026-09-18). But eleven is not usable in practice, measured the same day on Idle Hands:
 * two replies that were bare reasoning with no tool call at all, and one that returned a verdict
 * for "frame 12" of 11. Eight frames: four runs across two films, four correct replies.
 *
 * Eight over a 17.8s film is one frame every 2.4s — enough to catch each state of a
 * transformation. A film whose states are shorter than that loses some; that is the trade for a
 * pick that returns.
 */
export const CANDIDATE_FRAMES = 8;

export const FRAME_PICK_SCHEMA = {
  type: 'object',
  properties: {
    pieceMarkers: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 6,
      description:
        'FIRST, from THE PIECE only: the concrete details that identify its subject as this ' +
        'individual — face, species, clothing and its colours, headwear, accessories, material. ' +
        'e.g. "lime-green tracksuit", "yellow bucket hat", "white floral ceramic body".',
    },
    frames: {
      type: 'array',
      description: 'Exactly one verdict per frame, numbered 1 to the number of frames shown, in order. Never skip one; THE PIECE gets none.',
      items: {
        type: 'object',
        properties: {
          frame: { type: 'integer', minimum: 1, description: 'The frame number, as labelled.' },
          subject: {
            type: 'string',
            description: 'WHO or WHAT the main subject of THIS frame is, with its clothing and colours, in a few words.',
          },
          looks: {
            type: 'string',
            description:
              'The subject\'s SHAPE and pose in THIS frame, and what has changed since the previous ' +
              'frame: which way it faces, how many parts it has, what they are doing. e.g. "back ' +
              'view", "standing on two fingertips, index raised", "fingers multiplied into a ' +
              'starburst of about fifteen", "long stretched fingers reaching out like legs". Never ' +
              'repeat the identity here — describe the difference.',
          },
          sameAsPiece: {
            type: 'boolean',
            description:
              'true only if this frame\'s subject is the SAME individual as the piece — matching ' +
              'pieceMarkers. Different clothing, face, headwear, colours or species means a ' +
              'DIFFERENT subject: false.',
          },
          usable: {
            type: 'boolean',
            description:
              'true only if the subject is fully in view — not cropped by the frame edge, not an ' +
              'extreme close-up, not blurred, not faded, not buried under text.',
          },
          keep: { type: 'boolean', description: 'Whether to hand this frame to the video model.' },
          shows: {
            type: 'string',
            description: 'If kept, what it adds in a few words ("back view", "fingers fanned into a starburst"). Else empty.',
          },
        },
        required: ['frame', 'subject', 'looks', 'sameAsPiece', 'usable', 'keep', 'shows'],
      },
    },
    filmKind: {
      type: 'string',
      enum: FILM_KINDS,
      description:
        '"turntable": the same subject turns or is shown from different angles. ' +
        '"transformation": the same subject changes SHAPE while keeping its material, colours ' +
        'and identifying details. "performance": the same subject moves or acts without ' +
        'changing shape. "camera-move": the camera travels around a scene that barely moves. ' +
        '"reel": DIFFERENT subjects appear in turn. "static": almost nothing changes. ' +
        '"other": none of these.',
    },
    why: {
      type: 'string',
      description: 'One or two sentences: why these frames, and why the others were left out.',
    },
  },
  required: ['pieceMarkers', 'frames', 'filmKind', 'why'],
};

const BRIEF = `You are the Casting Director on a film crew that turns NFT artwork into short video.

The first picture is THE PIECE: the artwork a visitor owns. The pictures after it are frames from the piece's own film, in order, each labelled with its number and time. You are choosing which frames to hand to a video model as extra reference images of the piece's subject.

Work in this order:

1. From THE PIECE alone, list the details that identify its subject as this individual (pieceMarkers).

2. For EVERY frame, say who or what its main subject is (subject), and separately what SHAPE and pose it is in and what changed since the previous frame (looks). Then decide whether it is the SAME individual as the piece. Compare against pieceMarkers. Films are often reels that show several different characters one after another, sometimes of the same species and style. A different outfit, face, headwear, colour scheme or species means a DIFFERENT subject — never "a new state" or "a transformation" of the piece. A frame of a different subject belongs to someone else and must never be kept.

3. Decide whether each frame is usable: the subject fully in view, not cropped by the edge, not an extreme close-up, not blurred, faded or buried under text. A reference's framing leaks into the render — a close-up reference makes the render jump into a close-up.

4. Classify the film, then keep only frames that are the same subject AND usable, choosing what a still cannot show and nothing that repeats:
   - turntable: the distinct angles — front, three-quarter, side, back. Usually 2 to 4.
   - transformation: one frame per distinct shape, in order, from first form to last. Up to ${MAX_KEPT_FRAMES}. A true transformation changes SHAPE while its material and colours stay the same — parts multiply, stretch, fuse, melt or reassemble. If the looks you wrote for two frames describe different numbers or forms of parts, that is a transformation, not a performance. Missing a state means the video model invents a generic stand-in for it, so cover the whole arc — the first form, every distinct shape in the middle, and the last form — not just the frames that look alike.
   - performance: the 2 to 4 poses that differ MOST — read your own looks and choose the frames whose looks are furthest apart, across the whole film, not the first few.
   - camera-move or static: 1 or 2.
   - reel: only frames of the piece's own subject, at most ${MAX_REEL_FRAMES}; none if it never appears.
   Two frames that look nearly the same: keep one.

Return your choice by calling the emit_frames tool. Do not write prose.`;

/**
 * The request: the still, then each frame labelled with its number and time, then the tool.
 *
 * Images, not video, so reasoning stays ON — video input forces it off (see the motion pass in
 * worker/casting-director.js), and "same subject?" is exactly the careful visual judgement that
 * reasoning is doing.
 *
 * ⚠️ `thinking: false` EXISTS TO BE MEASURED, NEVER TO SHIP. Tried 2026-09-18 because reasoning
 * over eleven images runs to five minutes: it answered in 20-30s and the answers were FABRICATED.
 * On the adidas reel it described all eight frames as "the ape in the lime tracksuit" — including
 * the other ape, the woman and the crystal figure — called it a turntable and kept all eight; on
 * Idle Hands it described every frame as "thumb extended upward". Without reasoning the model
 * does not look at each image. And the code guard in validateFramePick cannot catch that, because
 * it trusts the per-frame verdicts, and those were the lie. The latency is the price of the look;
 * the queue (worker/index.js) is what pays it.
 */
export const framePickRequest = (env, { still, frames, thinking = true }) => {
  if (frames.length > CANDIDATE_FRAMES) {
    throw new Error(`${frames.length} frames is over the ${CANDIDATE_FRAMES} this model answers reliably (it accepts 12 images at most, the still included).`);
  }
  return {
    model: env.CASTING_MODEL,
    messages: [
      { role: 'system', content: BRIEF },
      {
        role: 'user',
        content: [
          // Said outright, because it was miscounted: on an eleven-frame film the model returned a
          // verdict for "frame 12", counting THE PIECE among the frames (2026-09-18). An off-by-one
          // there shifts every verdict onto the wrong frame, which is why validateFramePick refuses
          // a number that was not shown rather than dropping it.
          {
            type: 'text',
            text: `There are exactly ${frames.length} frames after THE PIECE, numbered 1 to ${frames.length}. THE PIECE is not a frame and has no number.`,
          },
          { type: 'text', text: 'THE PIECE:' },
          { type: 'image_url', image_url: { url: still } },
          ...frames.flatMap((frame) => [
            { type: 'text', text: `Frame ${frame.n} — ${frame.atSeconds}s:` },
            { type: 'image_url', image_url: { url: frame.dataUri } },
          ]),
        ],
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'emit_frames',
          description: 'Return a verdict for every frame, the film kind, and which frames to keep.',
          parameters: FRAME_PICK_SCHEMA,
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'emit_frames' } },
    chat_template_kwargs: { enable_thinking: thinking },
    temperature: 0.2,
    // Generous on purpose: reasoning over eleven images spends most of the budget before the
    // tool call is written. At 6144 an eleven-frame transformation came back as bare reasoning
    // with no tool call at all (2026-09-18).
    max_tokens: 16384,
  };
};

/**
 * The model's choice, checked — and where the model's own verdicts OVERRULE its conclusion.
 *
 * Measured 2026-09-18 on the adidas reel: asked holistically, the model classified four different
 * characters as a "transformation" and kept another holder's ape as "a distinct outfit state".
 * So the decision is not taken from its narrative. Per-frame verdicts are required, and then:
 *
 *   · a frame it judged NOT the same subject, or NOT usable, is never kept — whatever `keep` says;
 *   · if ANY frame shows a different subject, the film is a reel, however it was classified, and
 *     is capped at MAX_REEL_FRAMES.
 *
 * Losing a legitimate frame costs some fidelity. Keeping a wrong one puts an NFT the visitor does
 * not own into their film. The asymmetry decides every tie.
 *
 * Returns `{ filmKind, pieceMarkers, keep: [{ frame, shows }], verdicts, overruled, why }`, the
 * kept frames in time order.
 */
export const validateFramePick = (pick, frameCount) => {
  if (!FILM_KINDS.includes(pick?.filmKind)) throw new Error(`Unknown filmKind "${pick?.filmKind}".`);
  if (!Array.isArray(pick.frames)) throw new Error('frames must be an array of per-frame verdicts.');

  const verdicts = new Map();
  for (const verdict of pick.frames) {
    if (!Number.isInteger(verdict?.frame) || verdict.frame < 1 || verdict.frame > frameCount) {
      throw new Error(`Frame ${verdict?.frame} was not one of the ${frameCount} shown.`);
    }
    if (verdicts.has(verdict.frame)) throw new Error(`Frame ${verdict.frame} was judged twice.`);
    verdicts.set(verdict.frame, verdict);
  }
  const missing = Array.from({ length: frameCount }, (_, i) => i + 1).filter((n) => !verdicts.has(n));
  if (missing.length) throw new Error(`No verdict for frame${missing.length > 1 ? 's' : ''} ${missing.join(', ')}.`);

  const overruled = [];
  const othersAppear = [...verdicts.values()].some((v) => v.sameAsPiece === false);
  let filmKind = pick.filmKind;
  if (othersAppear && filmKind !== 'reel') {
    overruled.push(`classified "${filmKind}" but judged some frames a different subject — treated as a reel`);
    filmKind = 'reel';
  }

  let keep = [...verdicts.values()]
    .filter((v) => v.keep)
    .filter((v) => {
      if (v.sameAsPiece !== true) overruled.push(`frame ${v.frame} kept but judged a different subject — dropped`);
      else if (v.usable !== true) overruled.push(`frame ${v.frame} kept but judged unusable — dropped`);
      return v.sameAsPiece === true && v.usable === true;
    })
    .sort((a, b) => a.frame - b.frame)
    .map((v) => ({ frame: v.frame, shows: v.shows }));

  const cap = filmKind === 'reel' ? MAX_REEL_FRAMES : MAX_KEPT_FRAMES;
  if (keep.length > cap) {
    overruled.push(`kept ${keep.length}; capped at ${cap} for a ${filmKind}`);
    keep = keep.slice(0, cap);
  }

  return { filmKind, pieceMarkers: pick.pieceMarkers ?? [], keep, verdicts: [...verdicts.values()], overruled, why: pick.why ?? '' };
};

/**
 * Where the candidates are sampled: production's own sampler, over all but the film's last second.
 *
 * NFT films often fade out, and sampleTimes stops 0.3s from the end — inside the fade. Measured on
 * Idle Hands (2026-09-18): its last candidate, at 17.47s of 17.77s, was washing to white, and the
 * model kept it as the ending ("hand curled into a ball") over the clean resting pose at 15.18s,
 * which it passed over as a repeat. A washed-out reference makes a washed-out ending.
 */
export const FADE_MARGIN_SECONDS = 0.7;
export const candidateTimes = (durationSeconds) =>
  sampleTimes(Math.max(1, durationSeconds - FADE_MARGIN_SECONDS), CANDIDATE_FRAMES);

// ─────────────────────────────────────────────────────────────────────── a film's length

// There is no ffprobe in a Worker, and a sampler that does not know a film's length either
// crushes its samples into the opening seconds or asks for times past the end — both of which
// worker/frames.js's header records as the way this project has already misjudged a film. The
// length is in the container header, so it is READ there rather than guessed.

const indexOfBytes = (bytes, pattern, from = 0) => {
  outer: for (let i = from; i <= bytes.length - pattern.length; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) if (bytes[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
};

const MVHD = [0x6d, 0x76, 0x68, 0x64];
const plausible = (seconds) => (Number.isFinite(seconds) && seconds > 0.2 && seconds < 3600 ? seconds : null);

/** Seconds from an ISO-BMFF `mvhd` box (mp4, mov), or null. Both box versions: 32- and 64-bit. */
export const mp4Duration = (bytes) => {
  const at = indexOfBytes(bytes, MVHD);
  if (at < 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[at + 4];
  if (version === 1) {
    if (at + 36 > bytes.length) return null;
    return plausible(Number(view.getBigUint64(at + 28)) / view.getUint32(at + 24));
  }
  if (at + 24 > bytes.length) return null;
  return plausible(view.getUint32(at + 20) / view.getUint32(at + 16));
};

/** Seconds from a WebM/Matroska Segment Info — Duration (0x4489) × TimecodeScale (0x2AD7B1). */
export const webmDuration = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let scale = 1_000_000;
  const ts = indexOfBytes(bytes, [0x2a, 0xd7, 0xb1]);
  if (ts >= 0 && bytes[ts + 3] >= 0x81 && bytes[ts + 3] <= 0x88) {
    const length = bytes[ts + 3] & 0x7f;
    scale = 0;
    for (let i = 0; i < length; i += 1) scale = scale * 256 + bytes[ts + 4 + i];
  }
  const at = indexOfBytes(bytes, [0x44, 0x89]);
  if (at < 0) return null;
  const size = bytes[at + 2];
  const value = size === 0x88 && at + 11 <= bytes.length ? view.getFloat64(at + 3)
    : size === 0x84 && at + 7 <= bytes.length ? view.getFloat32(at + 3)
    : null;
  return value === null ? null : plausible((value * scale) / 1e9);
};

/** Up to `limit` bytes of `url` under a Range header, then the stream is cancelled. */
const readBytes = async (url, range, limit) => {
  const response = await fetch(url, { headers: { Range: range }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < limit) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, bytes.length - offset);
    bytes.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= bytes.length) break;
  }
  return bytes;
};

/**
 * A film's length in seconds, from its own header — or null when it cannot be read.
 *
 * An mp4 keeps it in `moov`, which is at the FRONT of a web-optimised file and at the END of
 * most others, so the tail is read when the head does not have it.
 */
export const filmDuration = async (url) => {
  const head = await readBytes(url, 'bytes=0-262143', 262_144);
  if (!head || head.length < 12) return null;
  if (String.fromCharCode(head[4], head[5], head[6], head[7]) === 'ftyp') {
    const fromHead = mp4Duration(head);
    if (fromHead) return fromHead;
    const tail = await readBytes(url, 'bytes=-1048576', 1_048_576);
    return tail ? mp4Duration(tail) : null;
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return webmDuration(head);
  return null;
};

// ───────────────────────────────────────────────────────────────────── the stored record

/**
 * Where a piece's chosen frames are recorded — beside its dossier, not inside it.
 *
 * A separate key rather than a dossier schema bump, because a bump would orphan every dossier in
 * the store and re-cast the whole library to add a field most pieces do not have. This way the
 * frames arrive for a piece the next time it is cast, and nothing else changes.
 */
export const filmFramesKey = (key) => `filmframes:v1:${key}`;
const pendingKey = (key) => `filmframes:pending:${key}`;

/**
 * What is kept for good: the model's judgement, which is minutes of reasoning to reproduce.
 *
 * NOT "no film" or "no duration", although they look permanent. They are statements about what
 * this code could find, and that improves — measured the day it was written: the browser's
 * casting wire (src/services/swarm.js forCastingWire) was dropping Alchemy's `animation`
 * object, so every piece whose only working film is that mirror would have been recorded
 * filmless FOREVER. They are cheap to re-check, so they expire.
 */
const PERMANENT = new Set(['ready', 'none-kept']);
const RETRY_AFTER_SECONDS = 86_400;
const RECHECK_AFTER_SECONDS = 7 * 86_400;
const EXPIRES = { 'no-film': RECHECK_AFTER_SECONDS, 'no-duration': RECHECK_AFTER_SECONDS };

const PICK_WIDTH = 512;
const REFERENCE_WIDTH = 1280;
const STILL_BYTES = 4 * 1024 * 1024;

export const frameR2Key = (key, atSeconds) => `cast/${key}/frames/${atSeconds}.jpg`;

export const readFilmFrames = async (env, key) =>
  (env.DOSSIERS ? env.DOSSIERS.get(filmFramesKey(key), 'json').catch(() => null) : null);

const saveRecord = async (env, record) => {
  const options = PERMANENT.has(record.status) ? {} : { expirationTtl: EXPIRES[record.status] ?? RETRY_AFTER_SECONDS };
  await env.DOSSIERS.put(filmFramesKey(record.key), JSON.stringify(record), options);
  await env.DOSSIERS.delete(pendingKey(record.key)).catch(() => {});
  return record;
};

/**
 * Ask for a piece's frames to be chosen, once. Cheap enough to call on every cast: it reads a
 * record, and only enqueues when there is none and none is on its way.
 *
 * `stills` and `films` are URL lists (castingStills, resolveNftVideoCandidates) rather than the
 * NFT object, which can run past a queue message's size limit on a long description.
 */
export const requestFilmFrames = async (env, { key, stills, films }) => {
  if (!films?.length) return { queued: false, reason: 'no film' };
  if (!env.FILM_FRAMES_JOBS || !env.DOSSIERS) return { queued: false, reason: 'not configured' };
  if (await readFilmFrames(env, key)) return { queued: false, reason: 'already recorded' };
  if (await env.DOSSIERS.get(pendingKey(key))) return { queued: false, reason: 'pending' };
  await env.DOSSIERS.put(pendingKey(key), '1', { expirationTtl: 1800 });
  await env.FILM_FRAMES_JOBS.send({ key, stills, films }, { contentType: 'json' });
  return { queued: true };
};

/**
 * Choose and store one piece's frames. Runs on the queue: the pick alone is 1½-5 minutes.
 *
 * Every step verifies the real thing rather than trusting a status code — see findFilm and
 * scripts/probe-frames.mjs for the three ways a 2xx lied about being a film.
 */
export async function computeFilmFrames(env, { key, stills, films }) {
  const origin = env.SITE_ORIGIN;
  if (!origin) throw Object.assign(new Error('SITE_ORIGIN is not set; frames are extracted on the zone.'), { fatal: true });
  const base = { v: 1, key, model: env.CASTING_MODEL, at: Date.now() };

  // Each real film in turn, until one the edge will actually extract from. NOT simply the first
  // real film: a token's first candidate can be a host outside the zone's allowed origins while
  // the next is Alchemy's copy on one inside them — measured on staging's first real cast
  // (Godzilla, 2026-09-18): an S3 original first, nft2-cdn second. Stopping at the first would
  // have recorded "edge-refused" for a film the edge serves perfectly well one candidate later.
  const times = (length) => candidateTimes(length);
  const tried = [];
  let film = null;
  let duration = null;
  const candidates = [];
  for (const url of films ?? []) {
    // eslint-disable-next-line no-await-in-loop -- one host at a time.
    const real = await findFilm([url]);
    if (!real) continue;
    const host = new URL(real).host;
    // eslint-disable-next-line no-await-in-loop
    const length = await filmDuration(real);
    if (!length) {
      tried.push(`${host}: no readable length`);
      continue;
    }
    const firstAt = times(length)[0];
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(frameUrl(origin, real, firstAt, PICK_WIDTH));
    if (!response.ok) {
      // eslint-disable-next-line no-await-in-loop
      const detail = (await response.text().catch(() => '')).slice(0, 160);
      tried.push(`${host}: HTTP ${response.status} ${detail}`.trim());
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const bytes = new Uint8Array(await response.arrayBuffer());
    candidates.push({ n: 1, atSeconds: firstAt, dataUri: toDataUri({ bytes, contentType: 'image/jpeg' }) });
    film = real;
    duration = length;
    break;
  }
  if (!film) {
    const status = !tried.length ? 'no-film' : tried.every((line) => line.endsWith('no readable length')) ? 'no-duration' : 'edge-refused';
    return saveRecord(env, { ...base, status, films, detail: tried.join(' | ') || null });
  }

  for (const atSeconds of times(duration).slice(1)) {
    // eslint-disable-next-line no-await-in-loop -- serial, as worker/frames.js does, for the same reason.
    const response = await fetch(frameUrl(origin, film, atSeconds, PICK_WIDTH));
    if (!response.ok) continue;
    // eslint-disable-next-line no-await-in-loop
    const bytes = new Uint8Array(await response.arrayBuffer());
    candidates.push({ n: candidates.length + 1, atSeconds, dataUri: toDataUri({ bytes, contentType: 'image/jpeg' }) });
  }
  if (candidates.length < 2) return saveRecord(env, { ...base, status: 'edge-refused', film, detail: 'fewer than two frames came back' });

  const still = toDataUri(await fetchArtwork(stills, { maxBytes: STILL_BYTES }));
  const pick = validateFramePick(jsonFrom(await chat(env, { ...framePickRequest(env, { still, frames: candidates }), retries: 2 })), candidates.length);

  const frames = [];
  const skipped = [];
  for (const kept of pick.keep) {
    const candidate = candidates[kept.frame - 1];
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(frameUrl(origin, film, candidate.atSeconds, REFERENCE_WIDTH));
    if (!response.ok) {
      skipped.push(`${candidate.atSeconds}s: HTTP ${response.status}`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const bytes = new Uint8Array(await response.arrayBuffer());
    const check = checkReference({ key: `${key}@${candidate.atSeconds}s`, mime: 'image/jpeg', bytes });
    const floor = check.violations.filter((violation) => violation.severity === 'floor');
    if (floor.length) {
      skipped.push(`${candidate.atSeconds}s: ${floor.map((v) => v.detail).join('; ')}`);
      continue;
    }
    const r2Key = frameR2Key(key, candidate.atSeconds);
    // eslint-disable-next-line no-await-in-loop
    await env.STORYBOARD_IMAGES.put(r2Key, bytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      // Provenance on the object itself, as worker/cast-art.js does for stills.
      customMetadata: { sourceUrl: film, atSeconds: String(candidate.atSeconds), assetKey: key },
    });
    frames.push({
      n: frames.length + 1,
      atSeconds: candidate.atSeconds,
      r2Key,
      width: check.measured?.width ?? null,
      height: check.measured?.height ?? null,
      shows: kept.shows,
    });
  }

  return saveRecord(env, {
    ...base,
    status: frames.length ? 'ready' : 'none-kept',
    film,
    duration,
    filmKind: pick.filmKind,
    binding: BINDING_BY_KIND[pick.filmKind],
    frames,
    // The audit trail: what the model saw in every frame, and where the code overruled it.
    // pieceMarkers can hold brand names read off the art — kept here, never put into prose.
    pieceMarkers: pick.pieceMarkers,
    verdicts: pick.verdicts.map(({ frame, subject, looks, sameAsPiece, usable }) => ({
      frame, atSeconds: candidates[frame - 1]?.atSeconds ?? null, subject, looks, sameAsPiece, usable,
    })),
    overruled: pick.overruled,
    skipped,
    why: pick.why,
  });
}

// ───────────────────────────────────────────────────────────────────────────── the queue

/** Matched by prefix, as isDirectorQueue is: the staging queue is `film-frames-jobs-staging`. */
export const isFilmFramesQueue = (name) => /^film-frames-jobs(-|$)/.test(name ?? '');

export async function handleFilmFramesQueue(batch, env) {
  for (const message of batch.messages) {
    const key = message.body?.key;
    try {
      // eslint-disable-next-line no-await-in-loop
      const record = await computeFilmFrames(env, message.body ?? {});
      console.log(`film frames ${key}: ${record.status}${record.frames ? ` (${record.frames.length} kept, ${record.filmKind})` : ''}`);
      message.ack();
    } catch (error) {
      // NVIDIA capacity 503s and a model reply that is prose instead of a tool call are both
      // common and both pass on a second try. A missing SITE_ORIGIN will not.
      if (!error.fatal && message.attempts < 3) {
        console.warn(`film frames ${key} failed (attempt ${message.attempts}), retrying:`, error.message);
        message.retry({ delaySeconds: 60 * message.attempts });
        continue;
      }
      console.warn(`film frames ${key} gave up:`, error.message);
      // eslint-disable-next-line no-await-in-loop
      if (key && env.DOSSIERS) await saveRecord(env, { v: 1, key, status: 'failed', error: error.message.slice(0, 500), at: Date.now() }).catch(() => {});
      message.ack();
    }
  }
}

// ───────────────────────────────────────────────────────────── frames as H3 references

/**
 * A reference slot that uses a film frame travels as `key@<seconds>s` in a take's refKeys.
 *
 * By TIME, not by frame number: the number is the Screenwriter's handle into the record's list,
 * while the time names the stored image itself (frameR2Key). A render therefore never depends on
 * the list it was planned against still being the same list. Cast keys are
 * `chain:0xaddress:tokenId`, which never contain "@".
 */
export const frameRefKey = (key, atSeconds) => `${key}@${atSeconds}s`;

export const parseRefKey = (ref) => {
  const match = /^(.+)@(\d+(?:\.\d+)?)s$/.exec(ref ?? '');
  return match ? { key: match[1], atSeconds: Number(match[2]) } : { key: ref, atSeconds: null };
};

/**
 * A spec's reference slots as refKeys. A frame slot becomes `key@seconds`, looked up in the
 * stored record — never in anything the browser sent. A frame that no longer resolves falls back
 * to the piece's still: the piece stays in the film, which is the one thing a slot must do.
 */
export const refKeysForPlan = async (env, referencePlan) => {
  const records = new Map();
  const refs = [];
  for (const slot of referencePlan ?? []) {
    if (!Number.isInteger(slot?.frame)) {
      refs.push(slot.key);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- one KV read per piece, cached below.
    if (!records.has(slot.key)) records.set(slot.key, await readFilmFrames(env, slot.key));
    const frame = records.get(slot.key)?.frames?.find((candidate) => candidate.n === slot.frame);
    refs.push(frame ? frameRefKey(slot.key, frame.atSeconds) : slot.key);
  }
  return refs;
};

/** A stored frame as the data URI H3 takes, or null when it is not there. */
export const readFrameDataUri = async (env, key, atSeconds) => {
  const object = await env.STORYBOARD_IMAGES?.get(frameR2Key(key, atSeconds));
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  return toDataUri({ bytes, contentType: object.httpMetadata?.contentType ?? 'image/jpeg' });
};
