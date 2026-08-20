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
const SCHEMA_VERSION = 4;

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
const castingStills = (nft) => {
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
const MAX_PROXY_BYTES = 5 * 1024 * 1024;

const bytesToBase64 = (bytes) => {
  let binary = '';
  const len = bytes.byteLength;
  const chunk = 0x8000;
  for (let i = 0; i < len; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const IPFS_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/'];

const withIpfsFallback = (url) => {
  if (!url?.startsWith('https://ipfs.io/ipfs/')) return [url];
  const path = url.slice('https://ipfs.io/ipfs/'.length);
  return IPFS_GATEWAYS.map((gateway) => gateway + path);
};

const fetchOneImageAsDataUri = async (url) => {
  const response = await fetch(url, {
    headers: {
      // IPFS.io and some creator CDNs serve 403 or 0 bytes to bare fetch user-agents.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
    },
  });
  if (!response.ok) {
    throw new Error(`Image fetch ${response.status}: ${url.slice(0, 80)}`);
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_PROXY_BYTES) {
    throw new Error(`Image too large to proxy: ${contentLength} bytes`);
  }
  const contentType = response.headers.get('content-type') || 'image/png';
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_PROXY_BYTES) {
    throw new Error(`Image too large to proxy: ${buffer.byteLength} bytes`);
  }
  return `data:${contentType};base64,${bytesToBase64(new Uint8Array(buffer))}`;
};

const fetchImageAsDataUri = async (urls) => {
  const attempts = urls.flatMap(withIpfsFallback);
  const errors = [];
  for (const url of attempts) {
    try {
      const dataUri = await fetchOneImageAsDataUri(url);
      console.info(`Proxied casting image from ${url.slice(0, 80)}`);
      return dataUri;
    } catch (error) {
      errors.push(`${url.slice(0, 60)}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' | '));
};

const buildContent = async (nft) => {
  const parts = [];
  const stills = castingStills(nft);
  if (stills.length) {
    let imageUrl = stills[0];
    try {
      imageUrl = await fetchImageAsDataUri(stills);
    } catch (error) {
      // Proxying failed — leave the best original URL and let NVIDIA try directly. The failure is
      // logged so a persistently broken piece can be diagnosed without losing the run.
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

  return parts;
};

const request = async (env, nft, notes) => ({
  model: env.CASTING_MODEL,
  messages: [
    { role: 'system', content: BRIEF },
    { role: 'user', content: await buildContent(nft) },
    // The looking pass's own words, fed back so this call formalises a judgement it has
    // already made rather than forming a fresh one. Omitted if that pass failed.
    ...(notes ? [{ role: 'assistant', content: notes }] : []),
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
const lookRequest = async (env, nft) => ({
  model: env.CASTING_MODEL,
  messages: [
    {
      role: 'system',
      content:
        'You are the Casting Director on a film crew that turns NFT artwork into short ' +
        'video. Look at this piece and write a concise visual description for the ' +
        'Screenwriter. Cover: what the subject is, the details that make it recognisable, ' +
        'how it is drawn, any lettering printed on it, how much of the frame the subject ' +
        'fills, and anything that would cause trouble in a render. Four or five sentences. ' +
        'Never name a brand, a marque or a real person, even if you recognise one. Do not ' +
        'repeat that rule back to yourself; just describe what you see.',
    },
    { role: 'user', content: await buildContent(nft) },
  ],
  chat_template_kwargs: { enable_thinking: true },
  temperature: 0.3,
  max_tokens: 2048,
});

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

  return dossier;
};

export const castPiece = async (httpRequest, env) => {
  const { key, nft, refresh = false } = await httpRequest.json();
  if (!key || !nft) {
    return Response.json({ error: 'Body needs { key, nft }' }, { status: 400 });
  }

  const cacheKey = `dossier:v${SCHEMA_VERSION}:${key}`;

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

    // ---- 1. the looking pass, streamed --------------------------------------------
    await emit('phase', { phase: 'looking' });
    let notes = '';
    try {
      const looked = await streamChat(env, await lookRequest(env, nft), (delta) => {
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
      dossier = validate(jsonFrom(await chat(env, await request(env, nft, notes))));
    } catch (error) {
      // One repair pass with the complaint fed back. The defects worth repairing here — a
      // brand name in the subject, a missing field — are precisely the ones a model fixes
      // when told what it did, and a failed dossier costs the user their whole cast.
      console.warn(`Casting Director first pass rejected for ${key}:`, error.message);
      const retry = await request(env, nft, notes);
      retry.messages.push({
        role: 'user',
        content: `Your dossier was rejected: ${error.message}\n\nFix exactly that and emit it again.`,
      });
      dossier = validate(jsonFrom(await chat(env, retry)));
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
      schemaVersion: SCHEMA_VERSION,
      model: env.CASTING_MODEL,
    };

    // No expirationTtl: the artwork behind a token id cannot change, so a dossier is a
    // permanent fact, not a cached one. This is what makes a warm cast instant and keeps
    // repeat traffic off a rate-limited free tier.
    if (env.DOSSIERS) await env.DOSSIERS.put(cacheKey, JSON.stringify(record));

    await emit('result', { ...record, cached: false });
  });
};
