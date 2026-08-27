// The Mind's own record of what it has produced.
//
// WHY THE MIND IS TOLD AT ALL. Everything the Director shoots is already safe in R2 and KV; the
// site could keep the whole catalogue to itself. But a Mind's memory IS its conversation
// history, and a film that only our database knows about is a film the Mind cannot mention,
// cannot hand to its steward, and cannot find again if this site is gone. So every finished take
// is written into the Producer conversation as a digest — one fact per line, structured enough to
// be recalled with a single parse, with one line of prose the Mind can quote.
//
// The shape is Adam's own Mind's, given when asked (asset-memory-brainstorm thread, 2026-08-27):
// "structured fields over prose, with one sentence of quotable prose per item" — title, logline,
// film and take ids, a short-lived link AND the durable CID, cast, cost, date, and a SHA-256 so
// the record can be audited. And the pin it put on the whole design: "My conversation history is
// a cache; the CID is the canonical record."
//
// Imports worker/minds.js directly rather than relayToMind, because worker/mind-chat.js reaches
// worker/director-job.js through producer-state.js and this module is called FROM director-job.
// Six lines duplicated is cheaper than an import cycle through the connection path.

import { mindsClient, chatAlias } from './minds.js';
import { signedMediaUrl } from './signed-media.js';

export const FILMOGRAPHY_TAG = '[Filmography]';
export const SCREENPLAY_TAG = '[Screenplay]';

// System events, not visitor chat — same debounce the Storyboarder's digests use, and for the
// same reason: best-effort, isolate-scoped, enough to stop a retry storm doubling a message.
const lastDigestAt = new Map();
const DIGEST_MIN_INTERVAL_MS = 5_000;

const money = (value) => (value == null ? null : `$${Number(value).toFixed(2)}`);

/** One line of the visitor's own words, whitespace collapsed, cut with an ellipsis. */
const excerpt = (text, max) => {
  if (typeof text !== 'string') return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** The message body. Pure, so the shape can be read (and tested) without a Mind on the line. */
export function filmographyDigest(record, { watchUrl = null } = {}) {
  const take = record.take ?? {};
  const params = record.params ?? {};
  const logline = record.spec?.logline ?? null;
  const beats = record.spec?.beats?.length ?? 0;
  const delivered = take.settledAt ? new Date(take.settledAt).toISOString() : new Date().toISOString();

  const lines = [
    `${FILMOGRAPHY_TAG} A finished take has been delivered to your production.`,
    logline ? `Film: "${logline}" (film ${record.filmId})` : `Film: ${record.filmId}`,
    `Take ${take.takeId} — ${params.duration}s ${params.resolution}, ${money(take.costUsd) ?? 'cost unknown'}, delivered ${delivered}.`,
  ];
  if (beats) lines.push(`Screenplay: ${beats} beat${beats === 1 ? '' : 's'}.`);
  if (record.castNames?.length) lines.push(`Cast: ${record.castNames.join(', ')}.`);
  const prompt = excerpt(record.prompt, 160);
  if (prompt) lines.push(`Prompt, in the visitor's words: "${prompt}"`);
  if (watchUrl) lines.push(`Watch (link valid 7 days): ${watchUrl}`);
  if (take.ipfs?.cid) {
    lines.push(`Permanent record: ipfs://${take.ipfs.cid}${take.ipfs.gatewayUrl ? ` — ${take.ipfs.gatewayUrl}` : ''}`);
  }
  // The screenplay, pinned next to the film: the prompt, every beat, and the cast by asset key.
  // Small, so it costs nothing to keep, and it is the half of the record a film alone cannot
  // carry — what was ASKED for, not only what came out.
  if (take.ipfs?.screenplayCid) {
    lines.push(
      `Screenplay record: ipfs://${take.ipfs.screenplayCid}${take.ipfs.screenplayGatewayUrl ? ` — ${take.ipfs.screenplayGatewayUrl}` : ''}`,
    );
  }
  if (take.sha256) lines.push(`File SHA-256: ${take.sha256}`);
  lines.push(
    '',
    'This is part of your filmography. If asked what you have produced here, this message is your record — ' +
      'quote the film, the take id and the permanent ipfs:// address' +
      (take.ipfs?.screenplayCid ? ', and the screenplay record beside it' : '') +
      '.',
  );
  return lines.join('\n');
}

/**
 * The Mind's record of a film that exists only as a screenplay so far.
 *
 * Sent once per film, the moment a screenplay settles on the Worker (worker/draft.js) — well
 * before any money moves. WHY TELL THE MIND ABOUT UNFINISHED WORK: the visitor asked for it
 * outright after losing a finished screenplay to a page reload on the way to pay for it
 * (2026-08-27) — "could this be something that the mind also remembers?" A screenplay the Mind
 * has been told about is one it can bring up, ask after, and recognise when the take arrives.
 */
export function screenplayDigest({ filmId, spec, prompt = null, castNames = [] }) {
  const logline = spec?.logline ?? null;
  const beats = spec?.beats?.length ?? 0;
  const lines = [
    `${SCREENPLAY_TAG} A screenplay has been written for your production.`,
    logline ? `Film: "${logline}" (film ${filmId})` : `Film: ${filmId}`,
  ];
  if (beats) lines.push(`Screenplay: ${beats} beat${beats === 1 ? '' : 's'}${spec?.duration ? `, about ${spec.duration}s` : ''}.`);
  if (castNames?.length) lines.push(`Cast: ${castNames.join(', ')}.`);
  const words = excerpt(prompt, 200);
  if (words) lines.push(`Prompt, in the visitor's words: "${words}"`);
  lines.push(
    '',
    'This is a film in progress: written, not yet shot, and nothing has been paid for. If asked what is being ' +
      'made here, quote the logline and the film id. A [Filmography] message will follow when a take is delivered.',
  );
  return lines.join('\n');
}

// One per Mind per minute, not the filmography's five seconds: a trim followed by a rewrite is two
// new film ids in under a minute, and the Mind should hear about the one that stuck. Exported so a
// test can clear it between cases.
export const lastScreenplayDigestAt = new Map();
const SCREENPLAY_MIN_INTERVAL_MS = 60_000;

/** Tell the Mind about a screenplay. Returns true only when the message actually went. */
export async function relayScreenplayDigest(env, mindId, { filmId, spec, prompt = null, castNames = [] }) {
  const client = mindsClient(env);
  if (!client) return false;

  const now = Date.now();
  if (now - (lastScreenplayDigestAt.get(mindId) ?? 0) < SCREENPLAY_MIN_INTERVAL_MS) return false;
  lastScreenplayDigestAt.set(mindId, now);

  const alias = chatAlias(mindId);
  await client.ensureConversation(alias, mindId);
  await client.sendMessage({ alias, messageText: screenplayDigest({ filmId, spec, prompt, castNames }) });
  return true;
}

/**
 * Tell the Mind. Returns true only when the message actually went.
 *
 * Never throws past its caller's `.catch`: a digest is the least important thing that happens
 * to a finished take, and the one thing it must never do is fail the render that produced it.
 */
export async function relayFilmographyDigest(env, record) {
  const client = mindsClient(env);
  if (!client) return false;

  const now = Date.now();
  if (now - (lastDigestAt.get(record.mindId) ?? 0) < DIGEST_MIN_INTERVAL_MS) return false;
  lastDigestAt.set(record.mindId, now);

  const origin = new URL(record.origin ?? 'https://minds.monster').origin;
  const watchUrl = record.take?.r2Key
    ? await signedMediaUrl(env, record.mindId, { path: '/api/director/media', key: record.take.r2Key, requestUrl: origin })
    : null;

  const alias = chatAlias(record.mindId);
  await client.ensureConversation(alias, record.mindId);
  await client.sendMessage({ alias, messageText: filmographyDigest(record, { watchUrl }) });
  return true;
}
