// The Screenwriter: one line of user intent plus N dossiers, out comes a shot spec.
//
// The spec is deliberately shaped like an entry in SHOTS from scripts/launch-prompts.mjs,
// because that file is the target. Everything the race-launch film needed — world, grade,
// guard, continuity, camera, numbered beats, sound, a reference plan — was written by hand
// over several rounds of failed renders. This agent's whole purpose is to produce that same
// object from a sentence.

import { chat, jsonFrom, streamChat } from './nvidia.js';
import { sseResponse } from './sse.js';
import { SCREENWRITER_BRIEF, SHOT_SPEC_SCHEMA } from './rulebook.js';
import {
  FREE_MAX_BEATS,
  FREE_MAX_REFERENCES,
  PAID_MAX_BEATS,
  PAID_MAX_REFERENCES,
} from './tier.js';

/**
 * Default caps when the caller does not supply explicit tier limits.
 *
 * The project treats Zero Budget as the safe baseline: a screenplay that is not told it has
 * paid headroom should never come back longer than the free tier can render.
 */
const DEFAULT_MAX_BEATS = FREE_MAX_BEATS;
const DEFAULT_MAX_REFERENCES = FREE_MAX_REFERENCES;

/** What the model is told about one cast member. Dossier first — it is the real material. */
const castBlock = (entry) => {
  const { key, dossier, name, collectionName } = entry;
  return [
    `--- CAST MEMBER ${key}`,
    `Piece: ${name}${collectionName ? ` (from ${collectionName})` : ''}`,
    `Subject: ${dossier.subject}`,
    `Must stay recognisable by: ${dossier.identityMarkers.join('; ')}`,
    `Palette: ${dossier.palette.join(', ')}`,
    `Artwork medium: ${dossier.medium}`,
    `Framing: ${dossier.framing}${dossier.cropAdvice ? ` — crop advice: ${dossier.cropAdvice}` : ''}`,
    dossier.burnedInText ? `Lettering visible in the art: "${dossier.burnedInText}"` : null,
    dossier.isMannequin ? 'Presented on a mannequin — the guard line is mandatory.' : null,
    dossier.motionNotes ? `In its own film: ${dossier.motionNotes}` : null,
    dossier.hazards?.length ? `Hazards: ${dossier.hazards.join('; ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
};

const capBlock = ({ maxBeats, maxReferences, cast }) => {
  const lines = [];
  if (maxBeats < PAID_MAX_BEATS) {
    lines.push(
      `TIER CONSTRAINT: You are on Zero Budget. The finished film may contain at most ${maxBeats} beat${maxBeats === 1 ? '' : 's'}. ` +
        'Choose the beats that best serve the user\'s line.',
    );
  }
  if (maxReferences < PAID_MAX_REFERENCES) {
    lines.push(
      `REFERENCE CONSTRAINT: You may use at most ${maxReferences} reference slot${maxReferences === 1 ? '' : 's'}. ` +
        (cast.length > maxReferences
          ? `The cast has ${cast.length} pieces, so some must share a slot. Say in your notes which ones share and why.`
          : `All ${cast.length} pieces fit; give each its own.`),
    );
  }
  return lines.length ? lines.join('\n') : null;
};

const userMessage = ({ prompt, cast, primaryKey, note, maxBeats, maxReferences }) =>
  [
    'THE USER ASKED FOR, VERBATIM:',
    prompt,
    '',
    // A rewrite. The note is direction on top of the original line, never a replacement for
    // it — so it is presented as a second instruction rather than folded into the first,
    // and the verbatim intent above stays exactly where it was.
    note?.trim()
      ? `THEY HAVE SINCE DIRECTED YOU:\n${note.trim()}\n\nHonour this while still serving ` +
        'their original line above. If the two genuinely conflict, follow the direction and ' +
        'say so in your notes.\n'
      : null,
    capBlock({ maxBeats, maxReferences, cast }),
    `THE CAST — ${cast.length} piece${cast.length === 1 ? '' : 's'}, all of which must appear.`,
    primaryKey ? `The hero piece, which the film should be built around, is ${primaryKey}.` : null,
    '',
    cast.map(castBlock).join('\n\n'),
    '',
    cast.length > maxReferences
      ? `NOTE: ${cast.length} pieces against ${maxReferences} reference slots. Say in your notes which ones ` +
        'share a slot and why.'
      : `All ${cast.length} pieces fit inside the ${maxReferences} reference slots — give each its own.`,
    '',
    'Write the shot spec.',
  ]
    .filter(Boolean)
    .join('\n');

/**
 * Reject a spec that has quietly dropped a cast member.
 *
 * This is rule 4 enforced in code rather than in the prompt, because it is both the most
 * expensive failure and the least visible one: the spec reads perfectly well, and the loss
 * only surfaces as an asset missing from a render minutes and dollars later.
 */
const validate = (spec, cast, { maxBeats, maxReferences }) => {
  const missing = SHOT_SPEC_SCHEMA.required.filter((field) => spec?.[field] === undefined);
  if (missing.length) throw new Error(`Shot spec missing fields: ${missing.join(', ')}`);
  if (!Array.isArray(spec.beats) || !spec.beats.length) throw new Error('Shot spec has no beats');

  const planned = new Set((spec.referencePlan ?? []).map((slot) => slot.key));
  const dropped = cast.filter((entry) => !planned.has(entry.key)).map((entry) => entry.key);
  if (dropped.length) throw new Error(`Shot spec left cast members unreferenced: ${dropped.join(', ')}`);

  if (spec.beats.length > maxBeats) {
    throw new Error(`Shot spec has ${spec.beats.length} beats; tier allows ${maxBeats}.`);
  }
  if (spec.referencePlan.length > maxReferences) {
    throw new Error(`Shot spec plans ${spec.referencePlan.length} reference slots; tier allows ${maxReferences}.`);
  }

  // Cast keys are database identifiers — chain, contract, token id. They are useful for
  // routing references to slots and actively harmful in prose, because H3 renders text it
  // is shown (rule 8) and "eth-mainnet:0x2847..." is text. Measured: the first end-to-end
  // run put all three keys into `staging` verbatim.
  const prose = [spec.world, spec.staging, spec.continuity, spec.camera, ...spec.beats].join(' ');
  const leaked = cast.filter((entry) => prose.includes(entry.key));
  if (leaked.length || /0x[0-9a-f]{6}/i.test(prose)) {
    throw new Error(
      'Cast keys or contract addresses leaked into the prose. Use <Subject N> bound to ' +
        '<Picture N> in staging, and <Subject N> in the beats.',
    );
  }

  return spec;
};

/**
 * The pass the user watches: the writer thinking the film through in the open.
 *
 * No tools, thinking on — the only shape this endpoint streams under. Its prose is then fed
 * to the structured call as the writer's own draft, so watching it is watching real work
 * rather than a loading animation with a model attached.
 */
const constrainedSchema = (maxBeats, maxReferences) => {
  const schema = JSON.parse(JSON.stringify(SHOT_SPEC_SCHEMA));
  schema.properties.beats.maxItems = maxBeats;
  schema.properties.referencePlan.maxItems = maxReferences;
  return schema;
};

const draftRequest = (env, payload) => ({
  model: env.SCREENWRITER_MODEL,
  messages: [
    { role: 'system', content: SCREENWRITER_BRIEF },
    { role: 'user', content: userMessage(payload) },
    {
      role: 'user',
      content:
        'Before you fill in the spec, think the film through in prose. What is the single ' +
        'image this wants to be? Where does the camera start and where does it end? Which ' +
        'piece carries the shot, and what does each of the others do? Two short paragraphs, ' +
        'written to yourself. Do not call the tool yet.',
    },
  ],
  chat_template_kwargs: { enable_thinking: true },
  temperature: 0.8,
  max_tokens: 3072,
});

const request = (env, payload, draft) => ({
  model: env.SCREENWRITER_MODEL,
  messages: [
    { role: 'system', content: SCREENWRITER_BRIEF },
    { role: 'user', content: userMessage(payload) },
    // The draft it just wrote, handed back so the spec formalises a film it has already
    // imagined instead of starting over.
    ...(draft ? [{ role: 'assistant', content: draft }] : []),
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'emit_shot_spec',
        description: 'Return the completed shot spec.',
        parameters: constrainedSchema(payload.maxBeats, payload.maxReferences),
      },
    },
  ],
  tool_choice: { type: 'function', function: { name: 'emit_shot_spec' } },
  // No `nvext: { guided_json }` here, despite NVIDIA's docs recommending it over a bare
  // json_object response format. Measured: this endpoint rejects it outright with
  // "unknown field `guided_json`" and a 400, listing an nvext allow-list that does not
  // include it. Guided decoding is evidently a self-hosted-NIM feature, not a hosted one.
  //
  // The forced tool call above is doing the work regardless — it is what constrains the
  // Casting Director too — and it is the portable option if this ever moves to OpenRouter.
  // `response_format` reinforces the JSON output even when the model writes it to
  // `message.content` instead of using the forced tool call. Measured: this endpoint
  // accepts it alongside `tool_choice`, and it makes the trailing brace more reliable.
  response_format: { type: 'json_object' },
  chat_template_kwargs: { enable_thinking: 'low_effort' },
  temperature: 0.7,
  max_tokens: 32768,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));

export const screenwrite = async (httpRequest, env) => {
  const payload = await httpRequest.json();
  const { prompt, cast, note } = payload;

  if (!prompt?.trim() || !Array.isArray(cast) || !cast.length) {
    return Response.json(
      { error: 'Body needs { prompt, cast: [{ key, dossier, name }] }' },
      { status: 400 },
    );
  }
  const undossiered = cast.filter((entry) => !entry?.dossier?.subject).map((entry) => entry?.key);
  if (undossiered.length) {
    return Response.json(
      { error: `Cast members have no dossier yet: ${undossiered.join(', ')}` },
      { status: 400 },
    );
  }

  // The UI resolves the tier before writing and passes explicit caps. If something calls this
  // endpoint without them, fall back to the safe Zero Budget baseline rather than the schema's
  // absolute maximum.
  payload.maxBeats = clamp(payload.maxBeats ?? DEFAULT_MAX_BEATS, 1, PAID_MAX_BEATS);
  payload.maxReferences = clamp(
    payload.maxReferences ?? DEFAULT_MAX_REFERENCES,
    1,
    PAID_MAX_REFERENCES,
  );

  return sseResponse(async (emit) => {
    // ---- 1. the draft, streamed ----------------------------------------------------
    await emit('phase', { phase: 'drafting' });
    let draft = '';
    try {
      const drafted = await streamChat(env, draftRequest(env, payload), (delta) => {
        emit('delta', delta).catch(() => {});
      });
      draft = drafted.content.trim();
    } catch (error) {
      // The spec does not depend on the draft, only benefits from it.
      console.warn('Screenwriter could not draft aloud:', error.message);
    }

    // ---- 2. the spec ----------------------------------------------------------------
    await emit('phase', { phase: 'formalising' });
    const caps = { maxBeats: payload.maxBeats, maxReferences: payload.maxReferences };

    let spec;
    try {
      const completion = await chat(env, request(env, payload, draft));
      spec = validate(jsonFrom(completion), cast, caps);
    } catch (error) {
      // One repair attempt, with the complaint fed back in. Cheaper than failing the run,
      // and the failures worth repairing (a dropped cast member, a leaked key) are exactly
      // the ones a model fixes when told.
      console.warn('Screenwriter first pass rejected:', error.message);
      const retry = request(env, payload, draft);
      const wasTruncated = error.message?.includes('Expected JSON');
      const wasCapViolation = error.message?.includes('tier allows');
      retry.messages.push({
        role: 'user',
        content: wasTruncated
          ? 'Your previous spec was cut off before the JSON could close. Write the same ' +
            'spec more concisely — shorter world, grade, guard and notes — and return the ' +
            'complete JSON object.'
          : wasCapViolation
            ? `Your previous spec was rejected: ${error.message}\n\n` +
              `Respect the tier hard cap: at most ${payload.maxBeats} beat${payload.maxBeats === 1 ? '' : 's'} and ` +
              `${payload.maxReferences} reference slot${payload.maxReferences === 1 ? '' : 's'}. Fix precisely that and return the whole spec again.`
            : `Your previous spec was rejected: ${error.message}\n\n` +
              'Fix precisely that and return the whole spec again.',
      });
      spec = validate(jsonFrom(await chat(env, retry)), cast, caps);
    }

    await emit('result', {
      // The user's own words, stored beside the expansion and never overwritten. The UI
      // pins this above the treatment so any drift between what they asked for and what
      // they got is visible rather than merely plausible.
      intent: prompt.trim(),
      // Echoed back so the UI can show what direction produced this draft.
      note: note?.trim() || null,
      // Kept: it is the writer's reasoning in its own words, and the treatment shows it.
      draft,
      ...spec,
      model: env.SCREENWRITER_MODEL,
      // Carried so the UI knows which cap governed the generation and can warn or offer trim.
      maxBeats: payload.maxBeats,
      maxReferences: payload.maxReferences,
    });
  });
};
