// The MiniMax video client, and the ONLY place that knows this provider's shape.
//
// Promoted verbatim from scripts/minimax.mjs, which built the hero video on the front page —
// 22 clips, $17.69, six takes. Everything here was measured against the live API and most of
// it was paid for with a failed render, so treat the comments as the record they are.
//
// TWO API SURFACES, because the project needs both:
//   /v2  MiniMax-H3 (Hailuo 3.0) — 4-15s, 768P|2K, up to 9 reference images. The only way to
//        condition a render on several exact assets at once, which is the whole licensing thesis.
//   /v1  MiniMax-Hailuo-02 etc. — 6s|10s, first+last frame, and the bracketed camera directives
//        ([Push in], [Tracking shot]) that /v2 does not use.
//
// Docs: https://platform.minimax.io/docs/api-reference/video-generation-v2-create
//       https://platform.minimax.io/docs/api-reference/video-generation-i2v
//
// WHY THIS LIVES IN worker/ RATHER THAN scripts/, and why scripts/minimax.mjs is now a shim over
// it: the same reasoning scripts/lib/scene-geometry.mjs states over worker/scene.js. A copy would
// have started drifting the first time either side was touched; a re-export cannot. The probes
// and production now price, format and fail identically, permanently.
//
// The one thing that could NOT be shared is where image bytes come from — node:fs on one side,
// an R2 object or a proxied URL on the other. So it is injected as `resolveImage` rather than
// forked. Everything else, including every guard, is common.

/**
 * Legal parameter ranges, exported because more than one caller has to know them BEFORE
 * spending. worker/rulebook.js states the same numbers to the Screenwriter in prose; these are
 * the machine-readable half, and worker/reference-preflight.js checks against them.
 */
// Named H3_PARAM_LIMITS, not H3_LIMITS, because worker/rulebook.js already exports an
// H3_LIMITS — the same facts written as prose for a model to read. Two different things
// sharing one name across two modules is how the wrong one quietly gets imported.
export const H3_PARAM_LIMITS = {
  minDuration: 4,
  maxDuration: 15,
  resolutions: ['768P', '2K'],
  ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
};

/**
 * What H3 will accept as a reference image.
 *
 * These are checked locally BEFORE a task is submitted, because the API only rejects them AFTER
 * the task has queued — and a queued task has been billed. scripts/prep-cast.mjs records the
 * case that costs real money: a 352x1024 figure crop is aspect 0.344, under the 0.4 floor, and
 * you find out one poll cycle and one charge later.
 */
export const H3_REFERENCE_LIMITS = {
  maxCount: 9,
  minShortSide: 256,
  maxSide: 5760,
  minAspect: 0.4,
  maxAspect: 2.5,
  maxBytes: 30 * 1024 * 1024,
  // The /v2 request body as a whole, all references inclusive.
  maxRequestBytes: 64 * 1024 * 1024,
  mimes: ['image/jpeg', 'image/png', 'image/webp'],
};

/**
 * Documented failure codes worth naming, because the generic message is unhelpful and these four
 * account for nearly every real failure.
 *
 * 1026 is the one an agent will hit constantly: this product's whole input is licensed BRAND
 * artwork, and naming the brand in the prompt is exactly what trips it.
 */
const CODE_HINTS = {
  1002: 'rate limited — slow down or retry',
  1008: 'insufficient balance on the MiniMax account',
  1026:
    'rejected by the content filter. Prompts naming real brands or people trip this — ' +
    'describe form and material instead and let the reference images carry the marks',
  2013: 'invalid parameters — check duration/resolution are legal for this model',
};

/**
 * A MiniMax failure, with the distinctions that change what a caller should DO.
 *
 * The three flags exist because they are three genuinely different situations and collapsing any
 * two of them produces a wrong action:
 *
 *   `retryable`        — waiting helps. A burst rate limit or a 5xx.
 *   `contentFiltered`  — waiting never helps, and it cost nothing but a round trip. The request
 *                        has to CHANGE. Never bill a visitor for one of these.
 *   `accountBalance`   — OUR account is empty, not the visitor's budget. This is an operator
 *                        failure wearing a provider error's clothes, and a visitor must never be
 *                        billed for it or told their budget ran out. Same lesson NvidiaError's
 *                        `quotaExhausted` split learned on the other provider.
 */
export class MinimaxError extends Error {
  constructor(code, message, { status = null } = {}) {
    const hint = CODE_HINTS[code];
    super(`MiniMax ${code}: ${message}${hint ? `\n  ${hint}` : ''}`);
    this.name = 'MinimaxError';
    this.code = code;
    this.status = status;
    this.hint = hint ?? null;
    this.contentFiltered = code === 1026;
    this.accountBalance = code === 1008;
    this.invalidParams = code === 2013;
    this.retryable = code === 1002 || (typeof status === 'number' && status >= 500);
    // Whether this failure may be charged to the visitor. A rejected request never rendered
    // anything and never will, so it is free; only a task that actually reached the queue costs.
    this.billable = false;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * Math.min(ms, 2000));

const baseUrlOf = (env) => env?.MINIMAX_BASE_URL || 'https://api.minimax.io';

const keyOf = (env) => {
  const value = env?.MINIMAX_API_KEY;
  if (!value) {
    throw new Error(
      'MINIMAX_API_KEY is not set. Locally it goes in .dev.vars; in production use ' +
        '`wrangler secret put MINIMAX_API_KEY`. It is never VITE_-prefixed — generation is ' +
        'something the server does, never something a visitor page load triggers.',
    );
  }
  return value;
};

/**
 * A render takes minutes and is polled dozens of times, so a single transient socket error must
 * not throw away a clip we have already paid for. Retries the TRANSPORT only — an HTTP response,
 * including an error one, is handed back to the caller as-is.
 */
const fetchWithRetry = async (url, init, attempts = 4) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await sleep(jitter(2000 * 2 ** attempt));
    }
  }
  throw new Error(
    `${init?.method ?? 'GET'} ${url} failed after ${attempts} attempts: ${lastError.message}`,
  );
};

/**
 * One request.
 *
 * A 200 IS NOT SUCCESS ON THIS WIRE FORMAT. MiniMax reports application errors inside an HTTP
 * 200 via `base_resp` — the same trap worker/nvidia.js documents for OpenRouter, on a completely
 * unrelated provider. Unwrapping it here, at the layer that owns the wire format, is what lets
 * every caller above see a real code instead of a success that contains a failure.
 */
const request = async (env, method, path, body, { signal } = {}) => {
  const response = await fetchWithRetry(`${baseUrlOf(env)}${path}`, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${keyOf(env)}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new MinimaxError(response.status, `${method} ${path} returned non-JSON: ${text.slice(0, 400)}`, {
      status: response.status,
    });
  }

  const code = json?.base_resp?.status_code;
  if (code) {
    throw new MinimaxError(code, json.base_resp.status_msg ?? 'no reason given', { status: response.status });
  }
  if (!response.ok) {
    throw new MinimaxError(response.status, text.slice(0, 400), { status: response.status });
  }
  return json;
};

// ---------------------------------------------------------------------------- /v2 (H3)

/** The default resolver: everything is already a data URI. The Worker's images arrive that way
 * from worker/casting-director.js's `fetchImageAsDataUri`, so it needs no resolver at all. */
const alreadyResolved = async (value) => {
  if (typeof value === 'string' && value.startsWith('data:')) return value;
  throw new Error(
    'h3Content was handed something that is not a data URI and no `resolveImage` was supplied. ' +
      'In the Worker use fetchImageAsDataUri(); in a script pass the node:fs resolver.',
  );
};

/**
 * Build the `content` array for an H3 request.
 *
 * TWO GUARDS, BOTH MEASURED, BOTH LOAD-BEARING:
 *
 * 1. Reference mode and frame mode are MUTUALLY EXCLUSIVE. Probe P1 tried it and got a 400:
 *    "reference mode cannot be mixed with first_frame/middle_frame/last_frame; choose one
 *    (2013)". Reference mode is what preserves the artwork, so no shot in this product can be
 *    frame-chained — joins have to be DESIGNED instead (a lightning flash, a whip pan, a wash
 *    to white). See scripts/launch-prompts.mjs rule 2.
 *
 * 2. Nine references, hard. The cap is not advisory and anything beyond it is a 400.
 *
 * The item shape is not guessable and was verified against the live API: the type is `image_url`
 * (not `image`) and the URL nests under `image_url.url`. A flat `url` is accepted by the parser
 * and then rejected as empty, so the error message does not lead you to the fix.
 */
export const h3Content = async ({
  text,
  referenceImages = [],
  firstFrame,
  lastFrame,
  resolveImage = alreadyResolved,
}) => {
  if (referenceImages.length && (firstFrame || lastFrame)) {
    throw new Error('H3 rejects reference images alongside first/last frame images — pick one mode.');
  }
  if (referenceImages.length > H3_REFERENCE_LIMITS.maxCount) {
    throw new Error(
      `H3 accepts at most ${H3_REFERENCE_LIMITS.maxCount} reference images, got ${referenceImages.length}`,
    );
  }

  const image = async (role, input) => ({
    type: 'image_url',
    role,
    image_url: { url: await resolveImage(input) },
  });

  const content = [{ type: 'text', text }];
  for (const input of referenceImages) content.push(await image('reference_image', input));
  if (firstFrame) content.push(await image('first_frame', firstFrame));
  if (lastFrame) content.push(await image('last_frame', lastFrame));
  return content;
};

/** Rejects a request that would 400, before it is sent. Returns violation objects rather than
 * throwing, so a caller can show a visitor everything wrong at once. */
export const checkH3Params = ({ duration, resolution, ratio }) => {
  const violations = [];
  if (!Number.isInteger(duration) || duration < H3_PARAM_LIMITS.minDuration || duration > H3_PARAM_LIMITS.maxDuration) {
    violations.push({
      code: 'bad-duration',
      detail: `H3 duration must be a whole number of seconds from ${H3_PARAM_LIMITS.minDuration} to ${H3_PARAM_LIMITS.maxDuration}; got ${duration}.`,
    });
  }
  if (resolution && !H3_PARAM_LIMITS.resolutions.includes(resolution)) {
    violations.push({
      code: 'bad-resolution',
      detail: `Resolution must be one of ${H3_PARAM_LIMITS.resolutions.join(', ')}; got ${resolution}.`,
    });
  }
  if (ratio && !H3_PARAM_LIMITS.ratios.includes(ratio)) {
    violations.push({
      code: 'bad-ratio',
      detail: `Ratio must be one of ${H3_PARAM_LIMITS.ratios.join(', ')}; got ${ratio}.`,
    });
  }
  return violations;
};

export const createH3Task = async (
  env,
  { model = 'MiniMax-H3', resolution = '768P', duration = 6, ratio = '16:9', content, signal },
) => {
  const violations = checkH3Params({ duration, resolution, ratio });
  if (violations.length) throw new Error(violations.map((v) => v.detail).join(' '));

  const json = await request(env, 'POST', '/v2/video_generation', { model, resolution, duration, ratio, content }, { signal });
  const taskId = json.task_id ?? json.taskId;
  if (!taskId) throw new Error(`No task_id in response: ${JSON.stringify(json).slice(0, 300)}`);
  return taskId;
};

// ------------------------------------------------------------------------- /v1 (legacy)

export const createV1Task = async (
  env,
  { model = 'MiniMax-Hailuo-02', prompt, firstFrameImage, lastFrameImage, duration = 6, resolution = '768P', resolveImage = alreadyResolved, signal },
) => {
  const body = {
    model,
    prompt,
    duration,
    resolution,
    // The default (true) rewrites the prompt through an LLM, which strips the bracketed camera
    // directives this surface exists for. Never let it.
    prompt_optimizer: false,
  };
  if (firstFrameImage) body.first_frame_image = await resolveImage(firstFrameImage);
  if (lastFrameImage) body.last_frame_image = await resolveImage(lastFrameImage);

  const json = await request(env, 'POST', '/v1/video_generation', body, { signal });
  const taskId = json.task_id ?? json.taskId;
  if (!taskId) throw new Error(`No task_id in response: ${JSON.stringify(json).slice(0, 300)}`);
  return taskId;
};

// ------------------------------------------------------------------------------ polling
//
// The two surfaces disagree about almost everything here, and none of it matches the published
// examples closely enough to guess. Verified against the live API:
//   /v2  →  { task: { status: 'queued'|'running'|'succeeded'|'failed', content: { url }, usage } }
//   /v1  →  { status: 'Preparing'|'Queueing'|'Processing'|'Success'|'Fail', file_id }
// So v2 nests under `task` and uses lowercase statuses; v1 is flat and capitalised, and needs a
// second call to exchange `file_id` for a download URL.

const PENDING = new Set(['queued', 'running', 'preparing', 'processing', 'Preparing', 'Queueing', 'Processing']);
const FAILED = new Set(['failed', 'Fail']);
const DONE = new Set(['succeeded', 'Success']);

const queryPath = (api, taskId) =>
  api === 'v2' ? `/v2/query/video_generation/${taskId}` : `/v1/query/video_generation?task_id=${taskId}`;

/**
 * ONE poll. No loop, no sleep, no timeout of its own.
 *
 * This is the primitive worker/director.js is built on, and the single-shot shape is the whole
 * point. A 2K/15s render measured 941-1123 SECONDS; a Queue invocation gets 15 minutes. Awaiting
 * a render inside one invocation therefore risks the invocation being killed while holding a clip
 * that has already been charged for — which is exactly the failure worker/mesh.js's header
 * describes paying for on the 3D side. The Director polls across invocations instead.
 *
 * Returns a settled verdict rather than throwing on `failed`, because "this task failed" is an
 * outcome the job log has to record against money already spent, not an exception to unwind.
 */
export const pollVideo = async (env, taskId, { api = 'v2', signal } = {}) => {
  const json = await request(env, 'GET', queryPath(api, taskId), undefined, { signal });
  const task = api === 'v2' ? (json.task ?? json) : json;
  const status = task.status ?? task.task_status;

  if (FAILED.has(status)) {
    return {
      done: true,
      failed: true,
      status,
      url: null,
      usage: task.usage ?? null,
      reason: task.error?.message ?? task.status_msg ?? json.base_resp?.status_msg ?? 'no reason given',
    };
  }

  if (DONE.has(status)) {
    if (api === 'v2') {
      const url = task.content?.url ?? task.content?.video_url;
      if (!url) throw new Error(`succeeded but no content.url: ${JSON.stringify(json).slice(0, 400)}`);
      return { done: true, failed: false, status, url, usage: task.usage ?? null, reason: null };
    }
    const fileId = task.file_id;
    if (!fileId) throw new Error(`Success but no file_id: ${JSON.stringify(json).slice(0, 400)}`);
    const file = await request(env, 'GET', `/v1/files/retrieve?file_id=${fileId}`, undefined, { signal });
    const url = file.file?.download_url;
    if (!url) throw new Error(`no download_url: ${JSON.stringify(file).slice(0, 300)}`);
    return { done: true, failed: false, status, url, usage: null, reason: null };
  }

  if (!PENDING.has(status)) {
    throw new Error(`unexpected status "${status}": ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { done: false, failed: false, status, url: null, usage: task.usage ?? null, reason: null };
};

/**
 * Poll until the task settles. For scripts, which have no invocation ceiling — the Worker uses
 * `pollVideo` across queue messages instead.
 *
 * Returns a direct MP4 URL, which is SHORT-LIVED. Mirror the bytes rather than storing the link.
 */
export const awaitVideo = async (
  env,
  taskId,
  { api = 'v2', intervalMs = 10_000, timeoutMs = 30 * 60_000, onTick, signal } = {},
) => {
  const deadline = Date.now() + timeoutMs;
  for (let tick = 0; ; tick += 1) {
    if (Date.now() > deadline) {
      throw new Error(
        `task ${taskId} still unsettled after ${Math.round(timeoutMs / 60_000)} min — ` +
          `query it directly rather than re-rendering, it may yet succeed and you have paid for it`,
      );
    }
    const result = await pollVideo(env, taskId, { api, signal });
    onTick?.({ tick, status: result.status, elapsedMs: tick * intervalMs, usage: result.usage });
    if (result.failed) throw new Error(`task ${taskId} failed: ${result.reason}`);
    if (result.done) return { url: result.url, usage: result.usage };
    await sleep(intervalMs);
  }
};

// --------------------------------------------------------------------------------- audio
//
// H3 emits a native AAC track per clip (verified: launch-1.mp4 carries aac/32kHz/stereo, while
// the Hailuo-02 renders are silent). But per-clip audio cannot be continuous across a cut, so
// generated tracks are used only as diegetic STEMS — rain, servos, engines, crowd, thunder — and
// a single score is laid underneath separately.

/** Instrumental score. `is_instrumental` matters — without it the model writes and sings lyrics. */
export const createMusic = async (
  env,
  { model = 'music-3.0', prompt, instrumental = true, sampleRate = 44100, bitrate = 256000, format = 'mp3', signal },
) => {
  const json = await request(
    env,
    'POST',
    '/v1/music_generation',
    {
      model,
      prompt,
      is_instrumental: instrumental,
      audio_setting: { sample_rate: sampleRate, bitrate, format },
      output_format: 'url',
    },
    { signal },
  );
  // The payload nests differently depending on output_format, and hex is returned when a URL is
  // not available, so accept either rather than guessing.
  const audio = json.data?.audio ?? json.audio ?? json.data?.audio_url;
  if (!audio) throw new Error(`no audio in music response: ${JSON.stringify(json).slice(0, 400)}`);
  return { audio, isUrl: /^https?:/.test(audio) };
};

/** Announcer line. `emotion` is honoured on speech-02/2.6/2.8 models. */
export const createSpeech = async (
  env,
  {
    model = 'speech-02-hd',
    text,
    voiceId = 'English_expressive_narrator',
    speed = 1.0,
    vol = 1.0,
    pitch = 0,
    emotion,
    sampleRate = 44100,
    bitrate = 256000,
    format = 'mp3',
    signal,
  },
) => {
  const voice_setting = { voice_id: voiceId, speed, vol, pitch };
  if (emotion) voice_setting.emotion = emotion;
  const json = await request(
    env,
    'POST',
    '/v1/t2a_v2',
    { model, text, stream: false, voice_setting, audio_setting: { sample_rate: sampleRate, bitrate, format } },
    { signal },
  );
  const audio = json.data?.audio;
  if (!audio) throw new Error(`no audio in t2a response: ${JSON.stringify(json).slice(0, 400)}`);
  // t2a returns hex-encoded bytes, not a URL.
  return { audio, isUrl: /^https?:/.test(audio) };
};

// ---------------------------------------------------------------------------------- price

/**
 * Published pay-as-you-go rates.
 *
 * H3 is linear in duration, which is why a Screen Test is worth running: the 4s diagnostic that
 * answers a question costs $0.32 against $1.95 for the 2K/15s render it protects.
 *
 * Scored in scripts/test/minimax-client.test.mjs against assets/renders/ledger.json — 22 real
 * manifests from the hero production, which makes this table a golden fixture rather than a
 * transcription anyone has to trust.
 */
export const priceUsd = ({ model, resolution, duration }) => {
  if (model?.startsWith('MiniMax-H3')) {
    return duration * (resolution === '2K' ? 0.13 : 0.08);
  }
  const table = {
    'MiniMax-Hailuo-02': { '512P-6': 0.1, '512P-10': 0.15, '768P-6': 0.28, '768P-10': 0.56, '1080P-6': 0.49 },
    'MiniMax-Hailuo-2.3': { '768P-6': 0.28, '768P-10': 0.56, '1080P-6': 0.49 },
    'MiniMax-Hailuo-2.3-Fast': { '768P-6': 0.19, '768P-10': 0.32, '1080P-6': 0.33 },
  };
  return table[model]?.[`${resolution}-${duration}`] ?? null;
};

/**
 * How long a render of this shape has actually taken, from every manifest in assets/renders/.
 *
 * Reported as a spread, never a single number, for the reason worker/tier.js's LATENCY_SECONDS
 * states: quoting a p50 as a promise is how a visitor comes to feel lied to. These are what the
 * wait surface bounds itself by, not what it advertises.
 *
 *   768P / 4s   133-149 s      768P / 6s   190-333 s
 *   768P / 15s  ~530 s         2K   / 15s  941-1123 s
 */
export const LATENCY_SECONDS = (resolution, duration) => {
  if (resolution === '2K') return { p50: 1050, max: 1500 };
  if (duration >= 12) return { p50: 530, max: 900 };
  if (duration >= 6) return { p50: 260, max: 600 };
  return { p50: 145, max: 400 };
};
