// The Casting Director: looks at one NFT and writes a dossier.
//
// Why this agent exists at all. src/lib/nftMedia.js can resolve a token's image, film and
// description, but nothing in the metadata will ever say "this is a trading card, the
// character is a sixth of the frame, behind a neon border and a wall of type". That fact
// is what broke the first hero render — probe P3 reproduced the McLaren card's
// "MCL_GENESIS / HONORARY" letter-perfect (see scripts/prep-cast.mjs, learning #2). Only
// looking at the pixels gets you it, and the Screenwriter cannot write around a hazard it
// cannot see.
//
// The output is also what the Storyboarder will want later, which is why `framing` and
// `cropAdvice` are first-class fields rather than prose asides.

import { chat, jsonFrom, streamChat } from './nvidia.js';
import { sseResponse } from './sse.js';
import { fetchArtwork, toDataUri } from './artwork.js';
import {
  toHttp,
  resolveNftVideo,
  resolveNftDescription,
} from '../src/lib/nftMedia.js';

// Bump when the schema, the brief, or the pipeline changes in a way that makes stored
// dossiers wrong. Old entries are then simply never read again — cheaper and safer than a
// migration over a store whose whole point is that it never expires.
//
// v3: split the film into its own pass. Every v2 dossier for a token WITH a film was
//     written by the reasoning-disabled video call and is measurably worse — see castPiece().
// v4: reject dossiers that reuse lettering from the artwork in the subject — see validate().
// v5: physicalProfile — what the piece IS in space, not just how it looks. See below.
const SCHEMA_VERSION = 5;

/**
 * How big the thing actually is, and what shape of thing it is.
 *
 * THIS IS A DOSSIER FIELD, NOT A RENDERER FIELD, and that is an architectural decision rather
 * than a filing convenience. Three consumers need it and they must not disagree: the Screenwriter
 * plans prose around a subject's size, worker/scene.js computes hFrac from `heightM`, and the
 * previz renderer picks its primitives from `bodyPlan`. One field set, three consumers, zero
 * drift. Split it between the dossier and the renderer and they are guaranteed to diverge.
 *
 * WHY IT IS WORTH A SCHEMA BUMP. Until now the Storyboarder GUESSED a height for every subject,
 * and `hFrac = heightM · focalMm / (zCam · sensorHeightMm)` — so a guessed height was a guessed
 * shot size, in every beat of every film. This is the only part of round 9 that makes the film
 * more CORRECT rather than only better-looking.
 *
 * The Casting Director is already looking at the pixels, and dossiers are cached permanently per
 * asset, so this costs one extra field set on a call that was happening anyway.
 */
const PHYSICAL_PROFILE = {
  type: 'object',
  additionalProperties: false,
  required: [
    'bodyPlan',
    'heightM',
    'widthM',
    'depthM',
    'heightConfidence',
    'headRatio',
    'silhouetteNotes',
    'facing',
  ],
  properties: {
    bodyPlan: {
      type: 'string',
      enum: [
        'biped',
        'quadruped',
        'vehicle',
        'aircraft',
        'vessel',
        'object',
        'architecture',
        'creature-other',
      ],
      description:
        'What KIND of thing this is in space, which decides the shape it is drawn as. A ' +
        'character, avatar, mascot or humanoid creature that stands on two legs is "biped" ' +
        'however stylised. A car, truck or bike is "vehicle". A handbag, sneaker or weapon is ' +
        '"object". A building or structure is "architecture". Use "creature-other" for a ' +
        'living thing that is none of the above — a bird, a fish, a blob.',
    },
    heightM: {
      type: 'number',
      minimum: 0.02,
      maximum: 500,
      description:
        'How tall the SUBJECT would be in the real world, in metres — never the artwork, the ' +
        'card or the frame around it. An adult human is about 1.8; a stylised ape character ' +
        'about 1.5; a car about 1.3; a sneaker about 0.12; a tower block 70 or more. Estimate ' +
        'from what the thing is, not from how big it looks in the picture.',
    },
    widthM: {
      type: 'number',
      minimum: 0.02,
      maximum: 500,
      description: 'Real-world width across the widest horizontal axis, in metres. An adult human is about 0.6; a car about 2.0.',
    },
    depthM: {
      type: 'number',
      minimum: 0.02,
      maximum: 500,
      description: 'Real-world depth front-to-back, in metres. An adult human is about 0.35; a car about 4.5.',
    },
    heightConfidence: {
      type: 'string',
      enum: ['known', 'inferred', 'unknowable'],
      description:
        '"known" when the subject is a real kind of thing with a standard size (a person, a ' +
        'sedan, a sneaker). "inferred" when it is invented but comparable to something real. ' +
        '"unknowable" when nothing in the image gives any sense of scale — say so rather than ' +
        'inventing confidence.',
    },
    headRatio: {
      type: ['number', 'null'],
      description:
        'For a figure only: total height divided by head height. A realistic adult human is ' +
        'about 7.5; a chibi or big-headed character can be 3 or 4. null for anything without ' +
        'a head. This is what stops a stylised character being drawn with realistic proportions.',
    },
    silhouetteNotes: {
      type: 'string',
      description:
        'What the OUTLINE of this thing is, in a few words — the features that would still ' +
        'identify it as a black shape. e.g. "long tail, wide shoulders, no neck", "low wedge ' +
        'profile, huge rear wing". Empty string only if there is genuinely nothing distinctive.',
    },
    facing: {
      type: 'string',
      enum: ['toward', 'away', 'left', 'right', 'unclear'],
      description:
        'Which way the subject faces IN THIS ARTWORK. "toward" means it looks out at the ' +
        'viewer. This says which side of the subject the artwork actually shows, so nothing ' +
        'downstream has to guess whether it is holding a front view or a side one.',
    },
  },
};

const DOSSIER_SCHEMA = {
  type: 'object',
  properties: {
    subject: {
      type: 'string',
      description:
        'One sentence naming what this is, in the register a film treatment would use. ' +
        'Form, colour and material only — never a brand, marque or real person.',
    },
    identityMarkers: {
      type: 'array',
      items: { type: 'string' },
      description:
        'The 3-5 concrete details that must survive into the render for this piece to ' +
        'still read as itself. e.g. "red heart-shaped sunglasses", "grey arms and dark ' +
        'mitten hands". Specific and visual, never evaluative.',
      minItems: 1,
      maxItems: 6,
    },
    palette: {
      type: 'array',
      items: { type: 'string' },
      description: 'Two to five dominant colours, as plain names.',
    },
    medium: {
      type: 'string',
      enum: ['flat-2d-vector', '3d-render', 'photoreal', 'trading-card', 'pixel', 'other'],
      description:
        'How the artwork is PRESENTED. If the subject sits inside a card, frame, border or ' +
        'panel, this is "trading-card" no matter how the subject itself is rendered — the ' +
        'card is what gets reproduced, so it outranks the art inside it. Otherwise describe ' +
        'the art: flat-2d-vector must be staged as a physical object in the world or it ' +
        'renders as a sticker.',
    },
    burnedInText: {
      type: 'string',
      description:
        'Any lettering, numbering or signage visible IN the artwork, transcribed. Empty ' +
        'string if none. Video models reproduce this letter-perfect, so it has to be ' +
        'known about before it appears in a render nobody asked for.',
    },
    framing: {
      type: 'string',
      enum: ['full-bleed', 'centred-with-margin', 'small-in-frame', 'busy-composite'],
      description:
        'How much of the image the actual subject occupies. For a CHARACTER, judge by the ' +
        'HEAD, not the body: a full-length figure whose face is a small part of the picture ' +
        'is "small-in-frame". Measured — a full-body reference renders the right clothes on ' +
        'the wrong face, so head size is what decides whether an identity survives.',
    },
    cropAdvice: {
      type: 'string',
      description:
        'When framing is not full-bleed, what to crop to so the subject dominates. ' +
        'Empty string when no crop is needed.',
    },
    isMannequin: {
      type: 'boolean',
      description:
        'True ONLY when the subject is clothing with nobody in it — a garment on a bust, ' +
        'a headless form, a chrome display figure. FALSE for every character, creature, ' +
        'avatar or mascot, however stylised or obviously synthetic, and false no matter ' +
        'what it is wearing. Getting this wrong on a character is harmful: it triggers an ' +
        '"ordinary skin" instruction that strips fur off an animal.',
    },
    motionNotes: {
      type: 'string',
      description:
        'Only when a film was supplied: what actually moves, and how. Empty string ' +
        'otherwise. Never speculate about motion from a still.',
    },
    hazards: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Anything that will degrade a render or trip a content filter: visible brand ' +
        'marks, real faces, heavy type, a subject too small to read, extreme aspect.',
    },
    physicalProfile: PHYSICAL_PROFILE,
  },
  required: [
    'subject',
    'identityMarkers',
    'palette',
    'medium',
    'burnedInText',
    'framing',
    'cropAdvice',
    'isMannequin',
    'motionNotes',
    'hazards',
    'physicalProfile',
  ],
};

const BRIEF = `You are the Casting Director on a film crew that turns NFT artwork into short video.

You are shown one piece of artwork — sometimes a still, sometimes a still and the film the
token actually contains. You write a dossier the Screenwriter will use to stage it.

Rules, each learned from a render that failed:

1. NEVER name a brand, marque, company, collection or real person, even when you recognise
   one, and even when it is written on the artwork. The video model rejects prompts that do.
   Describe form, material and colour instead: not "a Porsche 911" but "a white
   rounded-silhouette sports car with four round LED headlamps"; not "a Bored Ape" but "a
   stylised ape character with a tan muzzle". NFT collection names are brands too. If you
   recognise one, it goes in "hazards", never in "subject" or "identityMarkers".

1b. Nothing you transcribe into "burnedInText" may reappear in "subject" or
   "identityMarkers". Text printed on the artwork is a label on the packaging, not a
   description of the thing inside it.
2. Transcribe any text you can see in the artwork into "burnedInText". Video models
   reproduce lettering with uncanny accuracy, and a card's title bar ends up printed
   across the film.
3. Judge how much of the frame the subject actually occupies. Trading cards and busy
   composites bury their subject; say so, and say what to crop to.
4. Garments are frequently photographed on chrome or gold mannequins. Flag it — without a
   guard the chrome is the most salient thing in the reference and comes along into the
   render. But a character in clothes is a character, not a mannequin.
5. Judge a character's framing by how big its HEAD is. Clothing and colour survive into a
   render at any framing; a face does not. If the head is small in the picture, say
   small-in-frame and give crop advice, even when the figure itself is centred and clear.
6. Only describe motion if you were given a film. Never infer it from a still.
7. Be concrete and visual. "Striking cyberpunk aesthetic" is useless; "magenta rim light
   against a wet black street" can be rendered.

8. SIZE IS THE SUBJECT'S, NOT THE PICTURE'S. physicalProfile describes how big the thing
   would be if it walked into the room — never how big it appears in the artwork, and never
   the dimensions of the card or frame around it. A sneaker photographed filling the whole
   image is still about 0.12m tall. A character shown from the waist up is still described
   at full standing height.

9. GET THE BODY PLAN RIGHT BEFORE THE NUMBERS. A camera placed for a 1.8m biped and a camera
   placed for a 2m-wide vehicle are different shots, so calling a character a vehicle ruins
   every frame it appears in. If the subject stands on two legs it is "biped", however
   stylised, however synthetic, and whatever it is wearing or sitting in.

10. SAY WHEN YOU CANNOT TELL. heightConfidence is "unknowable" when nothing in the piece
   gives any sense of scale — an abstract form, a floating shape, a pattern. An honest
   "unknowable" is useful downstream; a confident guess dressed as knowledge is not.

Return the dossier by calling the emit_dossier tool. Do not write prose.`;

/**
 * Candidate stills for the model, ordered by fetchability.
 *
 * Deliberately NOT stillCandidates() from nftMedia.js, which orders by fidelity because
 * its caller is preparing reference images. This orders by *fetchability*: NVIDIA's
 * servers download the URL themselves, and prep-cast.mjs already established that some
 * IPFS CIDs have no providers left while Alchemy's CDN mirror always resolves. pngUrl
 * leads because it is a normalised re-encode — some originals are AVIF, which the vision
 * models do not accept.
 */
export const castingStills = (nft) => {
  const rawMetadata = nft?.raw?.metadata ?? nft?.rawMetadata ?? {};
  return [
    nft?.image?.pngUrl,
    nft?.image?.cachedUrl,
    nft?.image?.originalUrl,
    nft?.image?.thumbnailUrl,
    nft?.media?.[0]?.gateway,
    rawMetadata.image,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => toHttp(value.trim()))
    .filter((value, index, all) => all.indexOf(value) === index);
};

const traitLines = (nft) => {
  const attributes = nft?.raw?.metadata?.attributes ?? nft?.rawMetadata?.attributes;
  if (!Array.isArray(attributes)) return '';
  return attributes
    .map((a) => (a?.trait_type && a?.value != null ? `${a.trait_type}: ${a.value}` : null))
    .filter(Boolean)
    .join(', ');
};

// Some artwork URLs are reachable from a browser but not from NVIDIA's servers: dead IPFS
// gateways, hotlink-protected CDNs, or URLs that need a browser user-agent. We fetch the
// image in the Worker and hand it to the model as a base64 data URI. That keeps the bytes
// we already resolved from Alchemy from being lost at the last hop.
//
// The walk itself now lives in worker/artwork.js, shared with cast-art.js and mesh.js — see that
// file's header for what each candidate actually costs, and why refusing a non-image response is
// the difference between "could not fetch it" and "the model could not describe it".
const MAX_PROXY_BYTES = 5 * 1024 * 1024;

// Exported for worker/storyboarder.js: it independently re-resolves the same raw asset
// this function fetches for the dossier, rather than trusting the dossier's prose as a
// substitute for the pixels. See that file's header for why this matters.
export const fetchImageAsDataUri = async (urls) => {
  const artwork = await fetchArtwork(urls, { maxBytes: MAX_PROXY_BYTES });
  console.info(`Proxied casting image from ${artwork.url.slice(0, 80)}`);
  return toDataUri(artwork);
};

/**
 * The message parts both model passes are shown — built ONCE per cast.
 *
 * It used to be built per request, which meant the artwork was downloaded and base64-encoded
 * twice for every cold cast (the looking pass and the formalising pass) and a third time if the
 * dossier needed repairing. Beyond the wasted round trips and the multi-megabyte re-encodes, the
 * two passes could resolve DIFFERENT candidates — one gateway alive for the first call and dead
 * for the second — so the pass that reasoned about the picture and the pass that wrote it up were
 * not guaranteed to have seen the same picture.
 *
 * Returns the parts alongside `imageError`: the fetch is allowed to fail (NVIDIA can often
 * retrieve a URL we cannot), but the reason has to survive as something more than a log line, or
 * an unfetchable piece surfaces as the model complaining about artwork it never received.
 */
const buildContent = async (nft) => {
  const parts = [];
  let imageError = null;
  const stills = castingStills(nft);
  if (stills.length) {
    let imageUrl = stills[0];
    try {
      imageUrl = await fetchImageAsDataUri(stills);
    } catch (error) {
      // Proxying failed — leave the best original URL and let NVIDIA try directly. The reason is
      // kept so a persistently broken piece can be diagnosed without losing the run.
      imageError = error.message;
      console.warn(`Could not proxy casting image for token #${nft?.tokenId}: ${error.message}`);
    }
    parts.push({ type: 'image_url', image_url: { url: imageUrl } });
  }

  const traits = traitLines(nft);
  const description = resolveNftDescription(nft);
  parts.push({
    type: 'text',
    text: [
      // The token name often carries the brand/collection name (e.g. "McLaren MSO LAB...").
      // Feeding it to the model primes it to keep naming the brand in its reasoning and
      // dossier, so we identify the piece by token id only.
      `Token id: #${nft?.tokenId ?? 'unknown'}`,
      description ? `Collection description: ${description.slice(0, 800)}` : null,
      traits ? `Traits: ${traits}` : null,
      'Leave motionNotes empty — motion is asked about separately.',
      'Write the dossier.',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  return { parts, imageError };
};

const request = (env, content, notes, previsNote) => ({
  model: env.CASTING_MODEL,
  messages: [
    { role: 'system', content: BRIEF },
    { role: 'user', content },
    // The looking pass's own words, fed back so this call formalises a judgement it has
    // already made rather than forming a fresh one. Omitted if that pass failed.
    ...(notes ? [{ role: 'assistant', content: notes }] : []),
    // An external complaint from the Previs Supervisor's dossier review (worker/
    // previs-supervisor.js) — a specific, named reason this dossier didn't match what the
    // visitor actually asked for, arriving as its own fresh request rather than the
    // in-request schema-validation retry below. Same idea, different source.
    ...(previsNote
      ? [
          {
            role: 'user',
            content: `The Previs Supervisor flagged this dossier before it reached the Screenwriter: ${previsNote}\n\nLook again and revise the dossier to address this specifically.`,
          },
        ]
      : []),
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'emit_dossier',
        description: 'Return the completed dossier for this artwork.',
        parameters: DOSSIER_SCHEMA,
      },
    },
  ],
  // This model has no structured-output mode (the catalogue badge says so), but it does
  // have function calling — so the schema is enforced through a forced tool call instead.
  tool_choice: { type: 'function', function: { name: 'emit_dossier' } },
  temperature: 0.2,
  max_tokens: 4096,
  // Reasoning left ON, which is the whole reason this pass never carries the film. See
  // the two-pass note above castPiece().
});

// ---------------------------------------------------------------------- the motion pass

const MOTION_SCHEMA = {
  type: 'object',
  properties: {
    motionNotes: {
      type: 'string',
      description:
        'What actually moves in this film and how, in one or two sentences. Camera moves, ' +
        'character action, anything that turns or animates. Describe only what you see.',
    },
  },
  required: ['motionNotes'],
};

const motionRequest = (env, film) => ({
  model: env.CASTING_MODEL,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'video_url', video_url: { url: film } },
        {
          type: 'text',
          text:
            'This is the film inside an NFT. In one or two sentences, say what moves and ' +
            'how. Describe motion only — not colours, not style, not text.',
        },
      ],
    },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'emit_motion',
        description: 'Return what moves in this film.',
        parameters: MOTION_SCHEMA,
      },
    },
  ],
  tool_choice: { type: 'function', function: { name: 'emit_motion' } },
  // Mandatory for video, and the reason this is its own request: reasoning is only
  // supported for text and image, so a video call must run with thinking off.
  chat_template_kwargs: { enable_thinking: false },
  temperature: 0.2,
  max_tokens: 1024,
});

/**
 * The pass the user watches.
 *
 * No tools, thinking on — the only configuration this endpoint actually streams under (see
 * streamChat). It asks the model to look at the artwork and say what it sees, in the open,
 * and its reasoning channel is what fills the wait.
 *
 * It is not decoration. The prose it produces is handed to the formalising call below as
 * the model's own first look, which makes this think-then-answer rather than two attempts
 * at the same question.
 */
const lookRequest = (env, content) => ({
  model: env.CASTING_MODEL,
  messages: [
    {
      role: 'system',
      content:
        'You are the Casting Director on a film crew that turns NFT artwork into short ' +
        'video. Look at this piece and write a concise visual description for the ' +
        'Screenwriter. Cover: what the subject is, the details that make it recognisable, ' +
        'how it is drawn, any lettering printed on it, how much of the frame the subject ' +
        'fills, how big the thing would be if it stood in the room with you, and anything ' +
        'that would cause trouble in a render. Four or five sentences. ' +
        'Never name a brand, a marque or a real person, even if you recognise one. Do not ' +
        'repeat that rule back to yourself; just describe what you see.',
    },
    { role: 'user', content },
  ],
  chat_template_kwargs: { enable_thinking: true },
  temperature: 0.3,
  max_tokens: 2048,
});

const DIMENSIONS = ['heightM', 'widthM', 'depthM'];

// Same bounds worker/scene.js enforces on a subject (scene.js:412). Stated here too rather
// than imported: a dossier is written long before any scene exists, and a profile that the
// scene schema would reject later is a defect NOW, at the one moment it can still be repaired
// for the cost of a single call.
const MIN_DIMENSION_M = 0.02;
const MAX_DIMENSION_M = 500;

/**
 * The floor under the physical profile.
 *
 * Returns a complaint the model can act on, or null. Deliberately not a list of every
 * imperfection — the repair pass gets ONE attempt, so it is told the single most important
 * thing wrong rather than handed a report to triage.
 *
 * THE BODY-PLAN FLOOR IS THE ONE THAT MATTERS. Everything else here is shape-checking a
 * forced tool call. But a character labelled a vehicle gets a camera placed for a car in
 * every beat it appears in, and no downstream stage can recover from that, because nothing
 * downstream ever sees the artwork again.
 */
export const validatePhysicalProfile = (profile) => {
  if (!profile || typeof profile !== 'object') return 'physicalProfile is missing.';

  const enums = PHYSICAL_PROFILE.properties;
  for (const field of ['bodyPlan', 'heightConfidence', 'facing']) {
    if (!enums[field].enum.includes(profile[field])) {
      return `physicalProfile.${field} is "${profile[field]}", which is not one of: ${enums[field].enum.join(', ')}.`;
    }
  }

  for (const field of DIMENSIONS) {
    const value = profile[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `physicalProfile.${field} is not a number.`;
    }
    if (value < MIN_DIMENSION_M || value > MAX_DIMENSION_M) {
      return `physicalProfile.${field} is ${value}m, outside the believable range ${MIN_DIMENSION_M}-${MAX_DIMENSION_M}m. Give the size of the SUBJECT in the real world, not of the artwork.`;
    }
  }

  // A standing figure is taller than it is wide. This is the cheapest available test for
  // "described a character with a vehicle's dimensions", and it costs nothing to be sure of.
  if (profile.bodyPlan === 'biped' && profile.widthM >= profile.heightM) {
    return `physicalProfile says a biped ${profile.heightM}m tall and ${profile.widthM}m wide — wider than it is tall. A standing figure is taller than it is wide; if this is really a vehicle or an object, say so in bodyPlan.`;
  }

  if (profile.headRatio !== null) {
    if (typeof profile.headRatio !== 'number' || !Number.isFinite(profile.headRatio)) {
      return 'physicalProfile.headRatio must be a number, or null for something with no head.';
    }
    // 2 is a big-headed chibi; 12 is a stylised elongated figure. Outside that the model has
    // measured something other than a head.
    if (profile.headRatio < 2 || profile.headRatio > 12) {
      return `physicalProfile.headRatio is ${profile.headRatio}. A big-headed character is about 3, a realistic adult about 7.5 — this is neither.`;
    }
  }

  return null;
};

/**
 * Validate rather than trust. A forced tool call gets the shape right almost always, and
 * "almost" is the problem: a missing `identityMarkers` silently produces a Screenwriter
 * prompt with nothing to hold the character together, and the failure only shows up as a
 * bad render minutes later.
 */
const validate = (dossier) => {
  const missing = DOSSIER_SCHEMA.required.filter((field) => dossier?.[field] === undefined);
  if (missing.length) throw new Error(`Dossier missing fields: ${missing.join(', ')}`);
  if (!Array.isArray(dossier.identityMarkers) || !dossier.identityMarkers.length) {
    throw new Error('Dossier has no identityMarkers');
  }

  // Brand names are the one dossier defect that costs a whole render: MiniMax rejects a
  // prompt naming a real brand outright (error 1026), and the Screenwriter builds its prose
  // out of these fields.
  //
  // Enumerating brands would be hopeless, but there is a shortcut that generalises: the
  // brand is almost always PRINTED ON THE ARTWORK, and the model has just transcribed it
  // into burnedInText. So anything it read off the card must not reappear in the words
  // describing the subject. Measured on the adidas Phase 2 card, where the card reads
  // "BORED APE YACHT CLUB" and the first dossier duly opened "A Bored Ape character...".
  const printed = (dossier.burnedInText ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4)
    .map((word) => word.toLowerCase());

  if (printed.length) {
    const described = [dossier.subject, ...dossier.identityMarkers].join(' ').toLowerCase();
    const leaked = [...new Set(printed)].filter((word) =>
      new RegExp(`\\b${word}\\b`).test(described),
    );
    if (leaked.length) {
      throw new Error(
        `Lettering from the artwork leaked into the description: ${leaked.join(', ')}. ` +
          'Describe the subject in your own words.',
      );
    }
  }

  const profileComplaint = validatePhysicalProfile(dossier.physicalProfile);
  if (profileComplaint) throw new Error(profileComplaint);

  return dossier;
};

export const castPiece = async (httpRequest, env, ctx) => {
  const { key, nft, refresh = false, previsNote } = await httpRequest.json();
  if (!key || !nft) {
    return Response.json({ error: 'Body needs { key, nft }' }, { status: 400 });
  }

  const cacheKey = `dossier:v${SCHEMA_VERSION}:${key}`;

  // `ctx` IS NOT OPTIONAL HERE, whatever the signature suggests. Casting was the one long
  // endpoint that never passed it, so the runtime was free to cancel the whole invocation the
  // moment the response stream was abandoned — killing a finished dossier seconds before the KV
  // write that would have made it permanent. See worker/sse.js's header: the guarantee was
  // written for exactly this handler and this handler was the one opting out of it.
  return sseResponse(async (emit) => {
    if (!castingStills(nft).length) {
      throw new Error(
        'No usable image URL found for this piece. The token may be video-only, or Alchemy ' +
          'may not have returned any media for it.',
      );
    }

    // A warm dossier skips every model call, so there is nothing to stream and nothing to
    // wait for — it resolves in one round trip. Saying so is what makes the cache legible
    // rather than making a known piece look skipped.
    if (!refresh && env.DOSSIERS) {
      const hit = await env.DOSSIERS.get(cacheKey, 'json');
      if (hit) {
        await emit('result', { ...hit, cached: true });
        return;
      }
    }

    // The artwork, resolved once and shown to every pass below.
    const { parts, imageError } = await buildContent(nft);

    // ---- 1. the looking pass, streamed --------------------------------------------
    await emit('phase', { phase: 'looking' });
    let notes = '';
    try {
      const looked = await streamChat(env, lookRequest(env, parts), (delta) => {
        // Fire-and-forget: awaiting each write inside the delta callback would serialise
        // the parse loop against the socket and stutter the text the user is reading.
        emit('delta', delta).catch(() => {});
      });
      notes = looked.content.trim();
    } catch (error) {
      // The dossier does not depend on this pass — it only benefits from it. A failure here
      // costs the user the animation, not the cast.
      console.warn(`Casting Director could not think out loud for ${key}:`, error.message);
    }

    // ---- 2. the formalising pass ---------------------------------------------------
    await emit('phase', { phase: 'formalising' });

    // The dossier always comes from the still, never from the film. Measured, on the adidas
    // Phase 2 card: with the video attached the same model called it a "3d-render" and
    // transcribed only "PHASE 2"; without it, the same image became "trading-card" with
    // "PHASE 2 BORED APE YACHT CLUB INDIGO HERZ" and usable crop advice.
    //
    // The cause is not the prompt. This model requires chat_template_kwargs.enable_thinking
    // = false for video input — reasoning is only supported for text and image — so a
    // request carrying a film is a request with the reasoning switched off, and the careful
    // visual work is exactly what that reasoning was doing.
    //
    // So the film gets its own narrow call, which asks only what moves. That question does
    // not need reasoning, and it is the one thing a still genuinely cannot answer.
    let dossier;
    try {
      dossier = validate(jsonFrom(await chat(env, request(env, parts, notes, previsNote))));
    } catch (error) {
      // One repair pass with the complaint fed back. The defects worth repairing here — a
      // brand name in the subject, a missing field — are precisely the ones a model fixes
      // when told what it did, and a failed dossier costs the user their whole cast.
      console.warn(`Casting Director first pass rejected for ${key}:`, error.message);
      const retry = request(env, parts, notes, previsNote);
      retry.messages.push({
        role: 'user',
        content: `Your dossier was rejected: ${error.message}\n\nFix exactly that and emit it again.`,
      });

      try {
        dossier = validate(jsonFrom(await chat(env, retry)));
      } catch (repairError) {
        // AN UNFETCHABLE IMAGE IS NOT A MODEL FAILURE, and reporting it as one sends whoever is
        // debugging to the wrong half of the system. The repair pass still runs first — we hand
        // the model the raw URL when proxying fails and it can often fetch what we could not, so
        // a first-pass rejection is usually an ordinary brand leak rather than a blind guess. But
        // once BOTH passes have failed on a piece whose pixels we never got, the artwork is the
        // likeliest reason and the only one nobody downstream can work out for themselves.
        if (imageError) {
          throw new Error(
            `Could not fetch this piece's artwork, and the dossier written without it was rejected twice: ${imageError}`,
          );
        }
        throw repairError;
      }
    }

    // ---- 3. the film ----------------------------------------------------------------
    const film = resolveNftVideo(nft);
    let watchedFilm = false;
    if (film) {
      await emit('phase', { phase: 'watching' });
      try {
        const motion = jsonFrom(await chat(env, motionRequest(env, film)));
        if (motion?.motionNotes) {
          dossier.motionNotes = motion.motionNotes;
          watchedFilm = true;
        }
      } catch (error) {
        // Entirely survivable, and common: the model caps MP4s at two minutes, IPFS gateways
        // die, and resolveNftVideo deny-lists by extension over URLs that often have none —
        // so plenty of "films" are not films. The dossier above is already complete.
        console.warn(`Casting Director could not watch the film for ${key}:`, error.message);
      }
    }

    const record = {
      ...dossier,
      key,
      watchedFilm,
      notes,
      // WHAT THIS DOSSIER WAS WRITTEN FROM, recorded rather than reconstructable.
      //
      // The ordered candidate list, not the single URL that happened to resolve: fetching walks
      // this list until one works (see fetchImageAsDataUri), and which one that is depends on
      // which IPFS gateway is alive today. The list is the stable fact; the winner is not.
      //
      // Two things need it. Provenance — a derivative is only traceable to its source if the
      // source is named — and any later pass that has to look at the same pixels again without
      // re-resolving the token from scratch.
      sourceImageUrls: castingStills(nft),
      // Non-null only when every candidate refused us and NVIDIA fetched the URL itself. Worth
      // storing: a dossier written from a picture we could not see is still a real dossier, but
      // it is one whose provenance nothing downstream can re-check.
      imageError,
      schemaVersion: SCHEMA_VERSION,
      model: env.CASTING_MODEL,
    };

    // No expirationTtl: the artwork behind a token id cannot change, so a dossier is a
    // permanent fact, not a cached one. This is what makes a warm cast instant and keeps
    // repeat traffic off rate-limited Zero Budget queries.
    if (env.DOSSIERS) await env.DOSSIERS.put(cacheKey, JSON.stringify(record));

    await emit('result', { ...record, cached: false });
  }, ctx);
};
