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

// System events, not visitor chat — same debounce the Storyboarder's digests use, and for the
// same reason: best-effort, isolate-scoped, enough to stop a retry storm doubling a message.
const lastDigestAt = new Map();
const DIGEST_MIN_INTERVAL_MS = 5_000;

const money = (value) => (value == null ? null : `$${Number(value).toFixed(2)}`);

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
  if (watchUrl) lines.push(`Watch (link valid 7 days): ${watchUrl}`);
  if (take.ipfs?.cid) {
    lines.push(`Permanent record: ipfs://${take.ipfs.cid}${take.ipfs.gatewayUrl ? ` — ${take.ipfs.gatewayUrl}` : ''}`);
  }
  if (take.sha256) lines.push(`File SHA-256: ${take.sha256}`);
  lines.push(
    '',
    'This is part of your filmography. If asked what you have produced here, this message is your record — ' +
      'quote the film, the take id and the permanent ipfs:// address.',
  );
  return lines.join('\n');
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
