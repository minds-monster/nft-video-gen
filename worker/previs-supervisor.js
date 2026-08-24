// The Previs Supervisor: a review layer, not a producer agent. It writes nothing a visitor
// ever sees directly — it reads what a producer agent (Casting Director, Screenwriter,
// eventually the Storyboarder) already produced and checks it against the contract the next
// stage actually needs, catching exactly the class of bug no single producer agent has a
// reason to catch in itself: the Casting Director's job is cataloging one piece, not asking
// "did I capture every character in it"; the Screenwriter's job is writing, not verifying its
// own scene renders as written.
//
// This file is meant to grow to three review layers over time (dossier / shot spec /
// rendered frames — see the plan doc), which is why it's one file under one agent identity
// from the start even though only the first layer, dossier review, ships now. Adam's own
// sequencing: pre-Screenwriter first because it's the cheapest intervention and catches the
// most damaging bug class (the wrong hero character) before any writing happens at all.
//
// AUTHORITY, PINNED IN WRITING PER ADAM'S OWN FLOOR — never loosen these without the same
// deliberateness this file's other constraints get:
//   1. Supervisor authority, not visitor-facing authority. It reviews a producer agent's
//      contract with the next stage — it is never the visitor's editor and never decides
//      anything a visitor would recognise as a creative call.
//   2. Flag with a named diagnosis, and request at most ONE capped retry per stage per
//      production. Never a second attempt on its own initiative, never a loop.
//   3. It cannot approve or reject final output — that stays the visitor's call, always. If
//      an issue survives the one retry, it surfaces to the connected Mind (Producer), which
//      decides whether the visitor needs to hear about it. It never escalates to the visitor
//      directly.
//
// Text-only, free NVIDIA tier, no new vision call — Adam's own cost-discipline note: dossier
// review is "text in, text out," cheap by construction. It works from the dossier's own
// words plus a cheap `hasVideo` hint, not a fresh look at the artwork.

import { chat, jsonFrom } from './nvidia.js';
import { sseResponse } from './sse.js';
import { requireSession, relayToMind } from './mind-chat.js';
import { resolveNftVideo } from '../src/lib/nftMedia.js';

const PREVIS_SUPERVISOR_BRIEF = `You are the Previs Supervisor on a film crew that turns
licensed NFT artwork into short generated video. You do not write anything a visitor sees.
You review the Casting Director's dossiers against what the visitor actually asked for,
before the Screenwriter starts writing from them, and flag anything that would send the
Screenwriter down the wrong path.

The one failure mode worth naming, because it is the one measured to actually happen: a piece
whose underlying asset is a video can contain more than one distinct character across its
runtime, but the Casting Director only ever looks at one still frame. If the visitor named a
specific character, trait, or detail that the dossier doesn't reflect at all, and the piece is
video-backed, that is very likely the Casting Director having only seen one of several
characters — flag it as "wrong-character" or "incomplete-dossier", say what's missing, and say
what the Casting Director should look for on a second pass.

Only flag a real mismatch between what the visitor asked for and what a dossier actually says.
A dossier being terse is not itself a problem. Silence — no visible mismatch — should return an
empty issues array, not a manufactured concern.

Return your review by calling the tool. Write no prose outside it.`;

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The cast entry key this issue is about.' },
          class: {
            type: 'string',
            enum: ['wrong-character', 'incomplete-dossier', 'other'],
            description: 'What kind of mismatch this is.',
          },
          detail: {
            type: 'string',
            description: 'What is wrong, specifically — what the visitor asked for vs. what the dossier says.',
          },
          recommendedFix: {
            type: 'string',
            description: 'What the Casting Director should look for or do differently on a second pass.',
          },
        },
        required: ['key', 'class', 'detail', 'recommendedFix'],
      },
    },
  },
  required: ['issues'],
};

const castReviewBlock = ({ key, dossier, name, hasVideo }) =>
  [
    `--- CAST MEMBER ${key}`,
    `Piece: ${name}`,
    `Video-backed: ${hasVideo ? 'yes — a single still could easily miss other characters in it' : 'no'}`,
    `Dossier subject: ${dossier?.subject ?? '(none)'}`,
    dossier?.identityMarkers?.length ? `Identity markers: ${dossier.identityMarkers.join('; ')}` : null,
    dossier?.motionNotes ? `Motion notes: ${dossier.motionNotes}` : null,
  ]
    .filter(Boolean)
    .join('\n');

const reviewMessage = ({ prompt, cast }) =>
  [
    'THE VISITOR ASKED FOR, VERBATIM:',
    prompt,
    '',
    `THE CAST — ${cast.length} piece${cast.length === 1 ? '' : 's'}, each with the dossier the Casting Director actually produced:`,
    '',
    cast.map(castReviewBlock).join('\n\n'),
    '',
    'Does the visitor\'s line name a specific character, piece, or trait that no dossier below ' +
      'reflects? Does any dossier look like it may have only captured part of a video-backed ' +
      'asset? Call the tool with every real issue you find, or an empty issues array if the ' +
      'cast genuinely matches what was asked for.',
  ]
    .filter(Boolean)
    .join('\n');

const reviewRequest = (env, { prompt, cast }) => ({
  // Reuses the Casting Director's own model/key rather than introducing a second one — this
  // review is plain text reasoning, well inside what that model already does reliably under
  // a forced tool call (see worker/casting-director.js's own emit_dossier usage).
  model: env.CASTING_MODEL,
  messages: [
    { role: 'system', content: PREVIS_SUPERVISOR_BRIEF },
    { role: 'user', content: reviewMessage({ prompt, cast }) },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'emit_review',
        description: 'Return the dossier review.',
        parameters: REVIEW_SCHEMA,
      },
    },
  ],
  tool_choice: { type: 'function', function: { name: 'emit_review' } },
  temperature: 0.2,
  max_tokens: 2048,
});

export async function handlePrevisDossierReview(httpRequest, env) {
  const body = await httpRequest.json().catch(() => ({}));
  const { prompt, cast } = body;
  if (!prompt?.trim() || !Array.isArray(cast) || !cast.length) {
    return Response.json({ error: 'Body needs { prompt, cast: [{ key, dossier, name, nft }] }' }, { status: 400 });
  }

  return sseResponse(async (emit) => {
    const reviewCast = cast.map((entry) => ({
      key: entry.key,
      dossier: entry.dossier,
      name: entry.name,
      hasVideo: Boolean(resolveNftVideo(entry.nft)),
    }));

    await emit('phase', { phase: 'reviewing' });

    let review;
    try {
      review = jsonFrom(await chat(env, reviewRequest(env, { prompt, cast: reviewCast })));
    } catch (error) {
      // Advisory only. A failed review must never block the pipeline it's meant to protect —
      // see it as a missed check, not a broken run.
      console.warn('Previs Supervisor dossier review failed:', error.message);
      review = { issues: [] };
    }

    // Producer visibility is optional, never required: Casting Director and Screenwriter both
    // work without a connected Mind, and this review has to work the same way. Fires on every
    // call that finds issues, first pass or the retry's re-check alike — the second occurrence
    // of the same issue after a retry is itself the "still unresolved" signal Adam's floor
    // asks for, without this code needing to track which attempt it's on.
    const session = await requireSession(httpRequest, env).catch(() => null);
    if (session && review.issues?.length) {
      await relayToMind(
        env,
        session.mindId,
        `[Previs Supervisor] ${review.issues.length} cast issue(s) found before writing began: ` +
          review.issues.map((issue) => `${issue.key} (${issue.class}): ${issue.detail}`).join('; '),
      ).catch((err) => console.warn('Previs Supervisor relay failed:', err.message));
    }

    await emit('result', review);
  });
}
