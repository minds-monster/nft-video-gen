// Signed, scoped links to bytes in R2 — for anything the BROWSER has to fetch itself.
//
// WHY A URL AND NOT AN ATTACHMENT. `<img src>` and `<video src>` cannot send an Authorization
// header. Everything else in this API is a fetch() the client controls, so a Bearer token is
// enough; media is the exception, and the exception is structural rather than a shortcut.
//
// So the session travels in the query string instead, as a short-lived HMAC — the same
// self-verifying token worker/session.js issues, with its own expiry. Two things make that safe
// enough for this:
//
//   1. It is scoped by PREFIX. A token proves you are mind X; the key must begin with the prefix
//      belonging to mind X or the read 404s. A leaked link is a link to one object, not to a
//      store, and never to somebody else's.
//   2. It expires on its own. Seven days matches how long a storyboard link has always lived.
//
// Lifted out of worker/storyboarder.js when the Director needed exactly the same thing for video.
// Copying it would have been the obvious move and the wrong one: this is an authorisation check,
// and an authorisation check that exists twice is one that will eventually be tightened once.

import { signSession, verifySession } from './session.js';

/** Seven days. Long enough that a visitor can come back to a finished film without re-signing,
 * short enough that a link pasted somewhere does not stay live indefinitely. */
export const MEDIA_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A signed absolute URL to one object.
 *
 * `requestUrl` is the incoming request's URL, used only for its origin — so a link built during
 * `wrangler dev` points at localhost and one built in production points at the custom domain,
 * without either needing to be configured.
 */
export async function signedMediaUrl(env, mindId, { path, key, requestUrl, ttlMs = MEDIA_LINK_TTL_MS }) {
  const token = await signSession(env, { mindId, exp: Date.now() + ttlMs });
  const url = new URL(path, requestUrl);
  url.searchParams.set('key', key);
  url.searchParams.set('token', token);
  return url.toString();
}

/**
 * Serve one object, or 404.
 *
 * ⚠️ EVERY FAILURE IS A 404, deliberately — a missing object, an expired token, a valid token for
 * somebody else's key. Distinguishing them would turn this endpoint into an oracle for which keys
 * exist, and there is nothing a legitimate caller can do differently with the finer answer.
 *
 * `prefixFor` receives the verified mindId and returns the prefix that mind's keys must start
 * with. Passing a function rather than a string is what keeps the scoping decision at the call
 * site, where the key layout is known.
 */
export async function serveSignedMedia(request, env, { bucket, prefixFor, contentType }) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const key = searchParams.get('key');
  const session = token ? await verifySession(env, token) : null;

  const notFound = () =>
    new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

  if (!session || !key || !key.startsWith(prefixFor(session.mindId))) return notFound();

  const object = await bucket.get(key);
  if (!object) return notFound();

  const type = typeof contentType === 'function' ? contentType(key) : contentType;
  return new Response(object.body, {
    headers: {
      'content-type': type,
      // Immutable because these keys are versioned — a regenerated take gets a new key rather
      // than overwriting one, so a cached response can never be stale.
      'cache-control': 'private, max-age=31536000, immutable',
      // R2 gives us the length; handing it over lets a <video> element seek instead of streaming
      // blind, which is the difference between a scrubbable clip and one you can only watch.
      ...(object.size != null ? { 'content-length': String(object.size) } : {}),
      'accept-ranges': 'bytes',
    },
  });
}
