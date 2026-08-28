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
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * Math.min(ms, 1000));

export const stream = async (path, body, { signal, onEvent, headers, retries = 0 } = {}) => {
  // A TRUNCATED STREAM IS THE MOST RETRYABLE FAILURE THERE IS, and it used to be the only one
  // we gave up on. When a stream is cut the work usually finished anyway — the Worker keeps
  // running and persists what it produced (see worker/sse.js) — so the retry is normally a cache
  // hit answered in one round trip, not a second cold run. Three cast members were marked
  // permanently unreadable on 2026-08-25 for want of exactly this.
  const isRetryable = (err) =>
    err instanceof TypeError ||
    err.truncated === true ||
    (typeof err.status === 'number' && err.status >= 502 && err.status <= 504);

  const attempt = async () => {
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
    // Kept only to describe a truncation. "Ended without a result" says nothing about where it
    // stopped; "cut off after 412 events, last was phase" says whether the work had even begun.
    let events = 0;
    let lastType = null;

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

        events += 1;
        lastType = type;

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
    if (!result) {
      // Neither a `result` nor an `error` frame arrived, which the Worker cannot do
      // deliberately: every thrown handler emits `error`. So the connection was cut, and this
      // says so plainly rather than implying the endpoint decided to answer with nothing.
      const where = lastType ? `after ${events} events, last was "${lastType}"` : 'before it said anything';
      const error = new Error(`${path} was cut off ${where} — no result arrived`);
      error.truncated = true;
      throw error;
    }
    return result;
  };

  let lastErr;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === retries) throw err;
      await sleep(jitter(500 * 2 ** i));
      // The previous attempt may have streamed hundreds of tokens onto the user's screen before
      // it was cut. Replaying them on top would read as the agent saying everything twice, so
      // listeners are told to start the slot over rather than append to it.
      onEvent?.('restart', { attempt: i + 2, reason: err.message });
    }
  }
  throw lastErr;
};

/**
 * GET an SSE stream for a storyboard job and auto-reconnect if it drops.
 *
 * The job runs independently of any single HTTP connection, so a dropped progress stream is a
 * transient wire problem, not a lost film. Reconnects carry the last event index received, so
 * the visitor picks up where they left off without duplicate narration.
 */
/**
 * Follow one long-running job's event log, reconnecting across drops.
 *
 * `basePath` and `label` are the only things that differ between agents, so they are the only
 * things parameterised. The Director needs exactly this loop — including the reconnect that
 * carries `lastEvent` forward, which is what stops a dropped stream replaying narration a
 * visitor has already read.
 */
export const streamJobEvents = async (
  basePath,
  jobId,
  token,
  { signal, onEvent, lastEvent = 0, deadlineMs = null, label = 'The job' } = {},
) => {
  let currentLastEvent = lastEvent;
  const startedAt = Date.now();

  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw new Error('Aborted');
    if (deadlineMs != null && Date.now() - startedAt >= deadlineMs) {
      const error = new Error(`${label} did not finish within ${Math.round(deadlineMs / 1000)} seconds.`);
      error.truncated = true;
      throw error;
    }

    const path = `${basePath}/${encodeURIComponent(jobId)}/events?lastEvent=${currentLastEvent}`;
    try {
      const response = await fetch(path, {
        method: 'GET',
        signal,
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        const error = new Error(payload?.error ?? `${path} → ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

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

          currentLastEvent += 1;
          onEvent?.(type, data);

          if (type === 'result') return data;
          if (type === 'error') {
            const error = new Error(data.error);
            error.retryable = Boolean(data.retryable);
            throw error;
          }
        }
      }

      // The server closed the stream without a terminal event. The job is probably still running,
      // so reconnect after a short wait.
      onEvent?.('reconnect', { lastEvent: currentLastEvent, attempt });
      await sleep(jitter(Math.min(1000 * 2 ** attempt, 10000)));
    } catch (err) {
      if (signal?.aborted) throw new Error('Aborted');
      // 5xx or network errors are retryable; 4xx and explicit error events are not.
      const retryable = err instanceof TypeError || (typeof err.status === 'number' && err.status >= 502 && err.status <= 504);
      if (!retryable) throw err;
      onEvent?.('reconnect', { lastEvent: currentLastEvent, attempt, reason: err.message });
      await sleep(jitter(Math.min(1000 * 2 ** attempt, 15000)));
    }
  }
};

/** The Storyboarder's own name for the shared stream above. */
export const streamStoryboardJobEvents = (jobId, token, options = {}) =>
  streamJobEvents('/api/storyboard/job', jobId, token, { label: 'The Storyboarder', ...options });

/** The Director's. A render is minutes of silence followed by one answer, so the reconnect
 * matters more here than anywhere else — a visitor who closes the tab must not lose a clip that
 * has already been paid for. */
export const streamDirectorJobEvents = (jobId, token, options = {}) =>
  streamJobEvents('/api/director/job', jobId, token, { label: 'The Director', ...options });

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

/**
 * `refresh` skips the dossier cache; `previsNote` is an external complaint from the Previs
 * Supervisor's dossier review (see previsDossierReview below) — both optional, both empty by
 * default so the plain re-cast path this always was is unaffected.
 */
export const castPiece = ({ key, nft, refresh, previsNote }, options) =>
  stream('/api/casting', { ...forCastingWire({ key, nft }), refresh, previsNote }, options);

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
 *
 * `maxBeats` and `maxReferences` come from the resolved tier; when omitted the Worker falls
 * back to the Zero Budget baseline.
 */
export const screenwrite = ({ prompt, cast, primaryKey, note, maxBeats, maxReferences }, options) =>
  stream('/api/screenwriter', { prompt, cast, primaryKey, note, maxBeats, maxReferences }, options);

/** Cast wire shape for the Previs Supervisor — dossier plus the same stripped `nft` shape
 * forCastingWire already produces (not the full raw object): the review never looks at
 * pixels, but it does need enough of the NFT metadata to tell whether the piece is
 * video-backed at all. */
const forPrevisWire = ({ key, dossier, name, nft }) => ({
  key,
  dossier,
  name,
  nft: forCastingWire({ key, nft }).nft,
});

/**
 * The Previs Supervisor's dossier-review layer — runs between casting and screenwriting,
 * checking the assembled cast against what the visitor actually asked for before any writing
 * begins. Advisory only — see worker/previs-supervisor.js's own header for why a failed
 * review must never block the run.
 */
export const previsDossierReview = ({ prompt, cast }, options) =>
  stream('/api/previs/dossier', { prompt, cast: cast.map(forPrevisWire) }, options);

/**
 * Cast wire shape for the Storyboarder — the Screenwriter's own fields plus the raw NFT
 * metadata (stripped via forCastingWire), because the Storyboarder fetches original pixels
 * itself rather than trusting the dossier's prose. See worker/storyboarder.js's header.
 */
export const forStoryboardWire = ({ key, dossier, name, collectionName, nft }) => ({
  key,
  dossier,
  name,
  collectionName,
  nft: forCastingWire({ key, nft }).nft,
});

/** Creates a storyboard generation job and returns its id. The heavy work runs server-side
 * under ctx.waitUntil; the client then connects to the job's progress SSE. */
export const createStoryboardJob = async ({ spec, cast }, token) => {
  const response = await fetch('/api/storyboard', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec, cast: cast.map(forStoryboardWire) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Storyboard job failed: ${response.status}`);
  return payload;
};

/** Poll one job's current state and event log. */
export const getStoryboardJobStatus = async (token, jobId) => {
  const response = await fetch(`/api/storyboard/job/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Job status failed: ${response.status}`);
  return payload;
};

/** Generates a technical blocking spec per beat — text only, no image, no spend. `token` is
 * the visitor's Producer session.
 *
 * Implemented as a job dispatch + reconnectable progress SSE so a dropped connection cannot
 * lose a film that is already generating. */
export const storyboard = async ({ spec, cast }, token, options) => {
  const { jobId } = await createStoryboardJob({ spec, cast }, token);
  return streamStoryboardJobEvents(jobId, token, { ...options, lastEvent: 0 });
};

/** Generates (or regenerates) one frame's opt-in sketch preview, optionally with a
 * visitor-edited prompt — the only call in this file that spends real money. Never call this
 * in a loop across beats; see worker/storyboarder.js's own header on why that's a hard floor. */
export const sketchStoryboardFrame = ({ frameId, promptText, spec, cast }, token, options) =>
  stream(
    '/api/storyboard/sketch',
    { frameId, promptText, spec, cast: cast.map(forStoryboardWire) },
    { ...options, headers: { ...options?.headers, Authorization: `Bearer ${token}` } },
  );

/**
 * What the visitor is told BEFORE they click generate: tier, model, cost estimate, time
 * estimate, and whether their story runs longer than this tier covers.
 *
 * Cheap by design — a KV read and arithmetic, no model call — because the cap has to be decided
 * at the open rather than after a four-minute wait. A visitor is never allowed to start a render
 * they cannot finish.
 */
export const getStoryboardPlan = async (token, beatCount = 0) => {
  const response = await fetch(`/api/storyboard/plan?beats=${beatCount}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Storyboard plan failed: ${response.status}`);
  return response.json();
};

/** One beat, regenerated on the visitor's explicit click after it failed validation. A button,
 * never automatic — the visitor decides whether to spend another attempt on it. */
export const regenerateStoryboardBeat = async ({ frameId, spec, cast }, token) => {
  const response = await fetch('/api/storyboard/beat/regenerate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ frameId, spec, cast: cast.map(forStoryboardWire) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Regenerate failed: ${response.status}`);
  return payload;
};

/** "I want this beat anyway." The way out of the validator for a visitor who disagrees with it —
 * the violations stay on the record, because accepting one is a decision, not an erasure. */
export const overrideStoryboardBeat = async ({ frameId, filmId }, token) => {
  const response = await fetch('/api/storyboard/beat/override', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ frameId, filmId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Override failed: ${response.status}`);
  return payload;
};

/**
 * One film's storyboard, for resuming after a reload — plus a short list of the visitor's other
 * films, so earlier work stays reachable.
 *
 * `filmId` is not optional in practice. Fetching without it returns whatever this Mind produced
 * last, which is exactly how a tab working on one film ended up displaying another's storyboard
 * the moment a Mind connected.
 */
export const getStoryboard = async (token, filmId) => {
  const url = filmId ? `/api/storyboard?film=${encodeURIComponent(filmId)}` : '/api/storyboard';
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Storyboard fetch failed: ${response.status}`);
  return response.json();
};

/** Just the list of this Mind's films — no storyboard. What the timeline offers a returning
 * visitor when the tab has no spec yet, so earlier work is one click away instead of unreachable. */
export const getStoryboardFilms = async (token) => {
  const response = await fetch('/api/storyboard?films=1', { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Storyboard films fetch failed: ${response.status}`);
  return response.json();
};

/** A frame's image, servable directly from an `<img src>` — see handleStoryboardImage's
 * own note on why auth here is a query param instead of a header. */
export const storyboardImageUrl = (token, key) =>
  `/api/storyboard/image?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;

// ────────────────────────────────────────────────────────────────────────────────── director

/** What would be sent, what it would cost, and what is already wrong with it. Spends nothing. */
export const getDirectorPlan = async ({ spec, cast, preflight = false }, token) => {
  const response = await fetch('/api/director/plan', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec, cast: cast.map(forStoryboardWire), preflight }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.detail ?? payload.error ?? 'Plan failed'), payload);
  return payload;
};

/** Open the production and shoot. Returns a job that is either queued or parked for approval —
 * in `ask` mode it is parked every single time, which is the mode working, not failing.
 *
 * `override` is the visitor shooting past the Director's outstanding screen tests. Never defaulted
 * on: without it the server refuses with 409 `untested` / `unread` (worker/director-gate.js), and
 * the panel offers the override only after that refusal. */
export const startDirectorTake = async ({ spec, cast, mode, allowanceUsd, override = false }, token) => {
  const response = await fetch('/api/director/start', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec, cast: cast.map(forStoryboardWire), mode, allowanceUsd, override }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.detail ?? payload.error ?? 'Could not start'), payload);
  return payload;
};

/** The click `ask` mode is built around. The cast rides along because nothing server-side
 * stores it — the queue message is the only place it exists. */
export const approveDirectorTake = async ({ jobId, approved, cast }, token) => {
  const response = await fetch('/api/director/approve', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, approved, cast: (cast ?? []).map(forStoryboardWire) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Approval failed: ${response.status}`);
  return payload;
};

/** Cheap status poll, and the fallback when a stream drops. */
export const getDirectorJobStatus = async (token, jobId) => {
  const response = await fetch(`/api/director/job/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Job status failed: ${response.status}`);
  return payload;
};

/** The production: its money, and every take shot against it. Playback URLs are signed fresh
 * on every read rather than stored, so they never outlive the session that asked. */
export const getDirectorProduction = async (token, filmId) => {
  const response = await fetch(`/api/director?filmId=${encodeURIComponent(filmId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Production fetch failed: ${response.status}`);
  return response.json();
};

/** Every production this Mind has opened, with no spec needed — the Director's twin of
 * getStoryboardFilms, and what brings a returning visitor's dailies back after a reload. */
export const getDirectorFilms = async (token) => {
  const response = await fetch('/api/director?films=1', { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Director films fetch failed: ${response.status}`);
  return response.json();
};

/** Pin an existing take to IPFS and put it in the Mind's filmography. Queued: the CID arrives on
 * the production record a few seconds later, so re-read it rather than expecting it here. */
export const rememberDirectorTake = async ({ filmId, takeId }, token) => {
  const response = await fetch('/api/director/remember', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filmId, takeId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Remember failed: ${response.status}`);
  return payload;
};

/** Settle up and release whatever is left. */
export const closeDirectorProduction = async ({ filmId, reason }, token) => {
  const response = await fetch('/api/director/close', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filmId, reason }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Close failed: ${response.status}`);
  return payload;
};

/** Buy an answer to one named hazard. Returns a job like any other shot — it may be parked for
 * approval, which in `ask` mode it always is. */
export const runScreenTest = async ({ spec, cast, riskId, mode, allowanceUsd }, token) => {
  const response = await fetch('/api/director/test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec, cast: cast.map(forStoryboardWire), riskId, mode, allowanceUsd }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.detail ?? payload.error ?? 'Could not run the test'), payload);
  return payload;
};

/** What the visitor saw. The judge is a person, deliberately — see handleDirectorVerdict. */
export const recordScreenTestVerdict = async ({ filmId, takeId, answer, note, jobId }, token) => {
  const response = await fetch('/api/director/verdict', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filmId, takeId, answer, note, jobId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail ?? payload.error ?? 'Could not record that');
  return payload;
};

/** Accept a scope the assistant proposed. The assistant itself cannot call this — the visitor
 * pressing a button is the only path, which is the whole boundary of its authority. */
export const saveDirectorBrief = async ({ filmId, brief }, token) => {
  const response = await fetch('/api/director/brief', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filmId, brief }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail ?? payload.error ?? 'Could not save that scope');
  return payload;
};

/** Take one of the Director's amendments back off the script. `at` is the revision's timestamp. */
export const dropDirectorRevision = async ({ filmId, at }, token) => {
  const response = await fetch('/api/director/revision/drop', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filmId, at }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail ?? payload.error ?? 'Could not drop that revision');
  return payload;
};

/** Ask the Director to read the film and say what is worth paying to find out. Spends nothing. */
export const assessFilm = async ({ spec, cast }, token) => {
  const response = await fetch('/api/director/assess', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec, cast: cast.map(forStoryboardWire) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail ?? payload.error ?? 'Could not assess');
  return payload;
};
