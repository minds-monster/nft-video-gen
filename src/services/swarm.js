// Client side of the agent swarm in worker/.
//
// Relative paths on purpose. In dev, vite.config.js proxies /api to `wrangler dev`; in
// production the Worker and the built SPA are a single deploy. So there is no base URL to
// configure and no key on this side of the wire — which is the point, since Vite would
// inline one straight into the bundle.

/**
 * POST a JSON body and read a server-sent event stream back.
 *
 * Not EventSource, despite the wire format: EventSource can only issue GETs, and these
 * endpoints take a cast and a prompt. Reading the body by hand costs a parser and buys
 * AbortController, which the rewrite path needs to cancel a run in flight.
 *
 * `onEvent(type, data)` fires for every event. Resolves with the payload of the terminal
 * `result` event, or throws whatever the terminal `error` event carried.
 *
 * Exported (not just used internally): worker/assistant.js's chat turn is the same
 * transport with a different owner, and reimplementing this byte-parsing loop a second
 * time to send an extra header would be pure duplication for no reason — see
 * src/services/assistantChat.js.
 */
export const stream = async (path, body, { signal, onEvent, headers } = {}) => {
  const response = await fetch(path, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    // A failure before the stream opens is still plain JSON — a 400 from the guard clauses,
    // or the Worker itself falling over.
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.error ?? `${path} → ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  let failure = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Events are separated by a blank line; a read can split one in half, so the trailing
    // partial waits for the next chunk.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      let type = 'message';
      let raw = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) raw += line.slice(5).trim();
      }
      if (!raw) continue;

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }

      if (type === 'result') result = data;
      else if (type === 'error') failure = data;
      else onEvent?.(type, data);
    }
  }

  if (failure) {
    const error = new Error(failure.error);
    // The free NVIDIA tier is rate-limited at roughly 40 requests/min, so a cold cast can
    // legitimately hit 429. The UI says "busy, retrying" rather than "failed" for these.
    error.retryable = Boolean(failure.retryable);
    throw error;
  }
  if (!result) throw new Error(`${path} ended without a result`);
  return result;
};

/**
 * Dossier for one piece, streaming the Casting Director's reasoning as it looks.
 *
 * Cached forever in KV behind the Worker, so a piece that has been looked at before returns
 * in a single round trip with no stream at all — `cached: true` on the result says which
 * happened, and the UI uses it to skip the animation.
 *
 * `nft` is sent whole rather than as an id because the Worker has no Alchemy key: the
 * browser has already paid for this metadata, so re-fetching it server-side would be a
 * second bill for the same bytes.
 */
/**
 * Strip an Alchemy NFT down to only the fields the Casting Director reads.
 *
 * The full Alchemy object can be several hundred KB per token (contract metadata,
 * spam classifications, openSea metadata, etc.), and sending 4-7 of them through the
 * Vite proxy bloats the request for no benefit. The Worker has no Alchemy key, so we
 * keep the media/metadata it actually needs.
 */
export const forCastingWire = ({ key, nft }) => {
  const rawMetadata = nft?.raw?.metadata ?? nft?.rawMetadata ?? {};
  return {
    key,
    nft: {
      contract: nft?.contract ? { address: nft.contract.address } : undefined,
      tokenId: nft?.tokenId,
      name: nft?.name,
      title: nft?.title,
      description: nft?.description,
      image: nft?.image
        ? {
            pngUrl: nft.image.pngUrl,
            cachedUrl: nft.image.cachedUrl,
            originalUrl: nft.image.originalUrl,
            thumbnailUrl: nft.image.thumbnailUrl,
            contentType: nft.image.contentType,
            size: nft.image.size,
          }
        : undefined,
      animationUrl: nft?.animationUrl,
      media: nft?.media?.[0] ? [{ gateway: nft.media[0].gateway }] : undefined,
      raw: {
        metadata: {
          image: rawMetadata.image,
          animation_url: rawMetadata.animation_url,
          video_url: rawMetadata.video_url,
          description: rawMetadata.description,
          attributes: rawMetadata.attributes,
        },
      },
    },
  };
};

export const castPiece = ({ key, nft }, options) =>
  stream('/api/casting', forCastingWire({ key, nft }), options);

/**
 * Quick reachability check for the agent Worker.
 *
 * In dev the Worker is a separate process (`npm run dev:worker`); in production it is
 * part of the same deploy. This lets the UI tell the user when the dev setup is wrong
 * instead of surfacing every failure as a model error.
 */
export const checkHealth = async () => {
  const response = await fetch('/api/health');
  if (!response.ok) throw new Error(`Worker health check failed: ${response.status}`);
  return response.json();
};

/**
 * The shot spec. Every cast entry must already carry a `dossier`.
 *
 * `note` is direction for a rewrite — it never replaces the prompt, which stays pinned in
 * the UI as the thing the film is answerable to.
 */
export const screenwrite = ({ prompt, cast, primaryKey, note }, options) =>
  stream('/api/screenwriter', { prompt, cast, primaryKey, note }, options);
