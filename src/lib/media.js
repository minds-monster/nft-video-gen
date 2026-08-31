// Pull a playable video (or image) out of a Mind reply.
//
// The client library's MessageRecord type only declares `attachments?: unknown[]`
// plus an index signature — it has no documented artifact/mimeType field — so the
// real shape of a generated video is not knowable from the types. We therefore
// check the shapes the previous UI assumed, the attachments array, and any bare
// media URL in the message text, and log anything unrecognised once so the actual
// shape is easy to capture from a live generation.
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i;
const URL_RE = /https?:\/\/[^\s"'<>)]+/gi;

const kindFor = (url, mimeType) => {
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('image/')) return 'image';
  if (VIDEO_EXT.test(url)) return 'video';
  if (IMAGE_EXT.test(url)) return 'image';
  return null;
};

const firstString = (...values) => values.find((v) => typeof v === 'string' && v);

const loggedShapes = new Set();
const logUnknown = (label, value) => {
  if (loggedShapes.has(label)) return;
  loggedShapes.add(label);
  console.info(
    `[mind] unrecognised ${label} shape — capture this to wire up media rendering:`,
    value,
  );
};

const fromAttachment = (attachment) => {
  if (typeof attachment === 'string') {
    const kind = kindFor(attachment);
    return kind ? { url: attachment, kind } : null;
  }
  if (!attachment || typeof attachment !== 'object') return null;

  const url = firstString(
    attachment.url,
    attachment.artifactUrl,
    attachment.downloadUrl,
    attachment.signedUrl,
    attachment.uri,
    attachment.src,
    attachment.location,
  );
  if (!url) {
    logUnknown('attachment', attachment);
    return null;
  }
  const kind = kindFor(url, attachment.mimeType ?? attachment.contentType ?? attachment.type);
  return kind ? { url, kind } : null;
};

/** Returns `{ url, kind: 'video' | 'image' }` or null. */
export const extractMedia = (msg) => {
  if (!msg) return null;

  // Shape the previous UI assumed.
  const direct = firstString(msg.artifactUrl, msg.url, msg.mediaUrl);
  if (direct) {
    const kind = kindFor(direct, msg.mimeType);
    if (kind) return { url: direct, kind };
  }
  if (typeof msg.artifact === 'string') {
    const kind = kindFor(msg.artifact, msg.mimeType);
    if (kind) return { url: msg.artifact, kind };
  }

  // Documented (but untyped) attachments array.
  if (Array.isArray(msg.attachments)) {
    for (const attachment of msg.attachments) {
      const found = fromAttachment(attachment);
      if (found) return found;
    }
  }

  // Last resort: a bare media URL in the reply text.
  const inText = String(msg.messageText ?? '').match(URL_RE) ?? [];
  for (const url of inText) {
    const kind = kindFor(url);
    if (kind) return { url, kind };
  }

  return null;
};

/** Strips a media URL out of the prose so it isn't printed under the player. */
export const messageTextWithoutMedia = (msg, media) => {
  const text = String(msg?.messageText ?? '');
  if (!media?.url || !text.includes(media.url)) return text;
  return text.replace(media.url, '').replace(/\s{2,}/g, ' ').trim();
};
