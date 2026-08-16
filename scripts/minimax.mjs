// A thin MiniMax video-generation client for build-time use.
//
// Deliberately server-side only: MINIMAX_API_KEY is NOT VITE_-prefixed, so it never
// reaches the browser bundle. The hero video is a build artifact, not something a
// visitor's page load triggers.
//
// Two API surfaces, because we need both:
//   /v2  MiniMax-H3 (Hailuo 3.0) — 4-15s, 768P|2K, up to 9 reference images. The only
//        way to condition a render on several exact assets at once.
//   /v1  MiniMax-Hailuo-02 etc. — 6s|10s, supports first+last frame and the bracketed
//        camera directives ([Push in], [Tracking shot], …) that /v2 does not use.
//
// Docs: https://platform.minimax.io/docs/api-reference/video-generation-v2-create
//       https://platform.minimax.io/docs/api-reference/video-generation-i2v

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const BASE = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io';

// Documented failure codes worth naming, because the generic message is unhelpful and
// these three account for nearly every real failure.
const CODE_HINTS = {
  1002: 'rate limited — slow down or retry',
  1008: 'insufficient balance on the MiniMax account',
  1026:
    'rejected by the content filter. Prompts naming real brands or people trip this — ' +
    'describe form and material instead and let the reference images carry the marks',
  2013: 'invalid parameters — check duration/resolution are legal for this model',
};

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
};

const key = () => {
  const value = process.env.MINIMAX_API_KEY;
  if (!value) {
    throw new Error(
      'MINIMAX_API_KEY is not set. It lives in .env (unprefixed, so it stays server-side).',
    );
  }
  return value;
};

const headers = () => ({
  Authorization: `Bearer ${key()}`,
  'Content-Type': 'application/json',
});

/**
 * Local file → data URI. The references are files on disk, not public URLs, and the
 * /v2 request body allows up to 64MB, which is ample for a handful of stills.
 */
export const asDataUri = async (file) => {
  const ext = extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`${file}: MiniMax does not accept ${ext} images`);
  const buffer = await readFile(file);
  return `data:${mime};base64,${buffer.toString('base64')}`;
};

/**
 * A render takes minutes and is polled dozens of times, so a single transient socket
 * error should not throw away a clip we have already paid for. Retries the transport only
 * — an HTTP response, including an error one, is returned to the caller as-is.
 */
const fetchWithRetry = async (url, init, attempts = 4) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      await new Promise((done) => setTimeout(done, 2000 * 2 ** attempt));
    }
  }
  throw new Error(`${init?.method ?? 'GET'} ${url} failed after ${attempts} attempts: ${lastError.message}`);
};

const request = async (method, path, body) => {
  const response = await fetchWithRetry(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 400)}`);
  }

  // MiniMax reports application errors inside a 200, via base_resp.
  const code = json?.base_resp?.status_code;
  if (code) {
    const hint = CODE_HINTS[code];
    throw new Error(
      `${method} ${path} → MiniMax ${code}: ${json.base_resp.status_msg}` +
        (hint ? `\n  ${hint}` : ''),
    );
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 400)}`);
  }
  return json;
};

// ---------------------------------------------------------------------- /v2 (H3)

/**
 * Build the `content` array for an H3 request.
 *
 * Note the mutual exclusion: H3 accepts EITHER first/last frame images (image-to-video)
 * OR reference images (reference-to-video), never both in one request. Reference mode is
 * what we want for brand fidelity — it takes up to 9 images and holds their identity.
 */
export const h3Content = async ({ text, referenceImages = [], firstFrame, lastFrame }) => {
  if (referenceImages.length && (firstFrame || lastFrame)) {
    throw new Error(
      'H3 rejects reference images alongside first/last frame images — pick one mode.',
    );
  }
  if (referenceImages.length > 9) {
    throw new Error(`H3 accepts at most 9 reference images, got ${referenceImages.length}`);
  }

  // Verified against the live API: the item type is `image_url` (not `image`) and the URL
  // is nested under `image_url.url`. A flat `url` is accepted by the parser and then
  // rejected as empty, so this shape is not guessable from the error message alone.
  const image = async (role, file) => ({
    type: 'image_url',
    role,
    image_url: { url: await asDataUri(file) },
  });

  const content = [{ type: 'text', text }];
  for (const file of referenceImages) content.push(await image('reference_image', file));
  if (firstFrame) content.push(await image('first_frame', firstFrame));
  if (lastFrame) content.push(await image('last_frame', lastFrame));
  return content;
};

export const createH3Task = async ({
  model = 'MiniMax-H3',
  resolution = '768P',
  duration = 6,
  ratio = '16:9',
  content,
}) => {
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) {
    throw new Error(`H3 duration must be an integer 4-15, got ${duration}`);
  }
  const json = await request('POST', '/v2/video_generation', {
    model,
    resolution,
    duration,
    ratio,
    content,
  });
  const taskId = json.task_id ?? json.taskId;
  if (!taskId) throw new Error(`No task_id in response: ${JSON.stringify(json).slice(0, 300)}`);
  return taskId;
};

// ------------------------------------------------------------------- /v1 (legacy)

export const createV1Task = async ({
  model = 'MiniMax-Hailuo-02',
  prompt,
  firstFrameImage,
  lastFrameImage,
  duration = 6,
  resolution = '768P',
}) => {
  const body = {
    model,
    prompt,
    duration,
    resolution,
    // The default (true) rewrites the prompt through an LLM, which strips the bracketed
    // camera directives we are relying on. Never let it.
    prompt_optimizer: false,
  };
  if (firstFrameImage) body.first_frame_image = await asDataUri(firstFrameImage);
  if (lastFrameImage) body.last_frame_image = await asDataUri(lastFrameImage);

  const json = await request('POST', '/v1/video_generation', body);
  const taskId = json.task_id ?? json.taskId;
  if (!taskId) throw new Error(`No task_id in response: ${JSON.stringify(json).slice(0, 300)}`);
  return taskId;
};

// ------------------------------------------------------------------------ polling

// The two surfaces disagree about almost everything here, and none of it matches the
// published examples closely enough to guess. Verified against the live API:
//   /v2  →  { task: { status: 'queued'|'running'|'succeeded'|'failed', content: { url }, usage } }
//   /v1  →  { status: 'Preparing'|'Queueing'|'Processing'|'Success'|'Fail', file_id }
// So v2 nests under `task` and uses lowercase statuses; v1 is flat and capitalised, and
// needs a second call to exchange `file_id` for a download URL.
const PENDING = new Set([
  'queued', 'running', 'preparing', 'processing',
  'Preparing', 'Queueing', 'Processing',
]);
const FAILED = new Set(['failed', 'Fail']);
const DONE = new Set(['succeeded', 'Success']);

/**
 * Poll until the task settles. Returns a direct MP4 URL, which is short-lived — mirror
 * the bytes locally rather than storing the link.
 */
export const awaitVideo = async (taskId, { api = 'v2', intervalMs = 10_000, timeoutMs = 30 * 60_000, onTick } = {}) => {
  const path =
    api === 'v2'
      ? `/v2/query/video_generation/${taskId}`
      : `/v1/query/video_generation?task_id=${taskId}`;

  // Bounded, because a task that never settles used to hang the run forever. The longest
  // render measured so far is a 15s 2K clip at ~530s, so 30 minutes is generous.
  const deadline = Date.now() + timeoutMs;

  for (let tick = 0; ; tick += 1) {
    if (Date.now() > deadline) {
      throw new Error(
        `task ${taskId} still unsettled after ${Math.round(timeoutMs / 60_000)} min — ` +
          `query it directly rather than re-rendering, it may yet succeed and you have paid for it`,
      );
    }
    const json = await request('GET', path);
    const task = api === 'v2' ? (json.task ?? json) : json;
    const status = task.status ?? task.task_status;
    onTick?.({ tick, status, elapsedMs: tick * intervalMs, usage: task.usage });

    if (FAILED.has(status)) {
      throw new Error(
        `task ${taskId} failed: ${task.error?.message ?? task.status_msg ?? json.base_resp?.status_msg ?? 'no reason given'}`,
      );
    }

    if (DONE.has(status)) {
      if (api === 'v2') {
        const url = task.content?.url ?? task.content?.video_url;
        if (!url) throw new Error(`succeeded but no content.url: ${JSON.stringify(json).slice(0, 400)}`);
        return { url, usage: task.usage };
      }
      const fileId = task.file_id;
      if (!fileId) throw new Error(`Success but no file_id: ${JSON.stringify(json).slice(0, 400)}`);
      const file = await request('GET', `/v1/files/retrieve?file_id=${fileId}`);
      const url = file.file?.download_url;
      if (!url) throw new Error(`no download_url: ${JSON.stringify(file).slice(0, 300)}`);
      return { url, usage: null };
    }

    if (!PENDING.has(status)) {
      throw new Error(`unexpected status "${status}": ${JSON.stringify(json).slice(0, 300)}`);
    }
    await new Promise((done) => setTimeout(done, intervalMs));
  }
};

// ------------------------------------------------------------------------- audio
//
// H3 emits a native AAC track per clip (verified: launch-1.mp4 carries aac/32kHz/stereo,
// while the Hailuo-02 renders are silent). But per-clip audio cannot be continuous across a
// cut, so the generated tracks are used only as diegetic STEMS — rain, servos, engines,
// crowd, thunder — and a single score is laid underneath from here.

/**
 * Instrumental score. Synchronous-ish: returns a downloadable URL rather than a task.
 * `is_instrumental` matters — without it the model writes and sings lyrics.
 */
export const createMusic = async ({
  model = 'music-3.0',
  prompt,
  instrumental = true,
  sampleRate = 44100,
  bitrate = 256000,
  format = 'mp3',
}) => {
  const json = await request('POST', '/v1/music_generation', {
    model,
    prompt,
    is_instrumental: instrumental,
    audio_setting: { sample_rate: sampleRate, bitrate, format },
    output_format: 'url',
  });
  // The payload nests differently depending on output_format, and hex is returned when a URL
  // is not available, so accept either rather than guessing.
  const audio = json.data?.audio ?? json.audio ?? json.data?.audio_url;
  if (!audio) throw new Error(`no audio in music response: ${JSON.stringify(json).slice(0, 400)}`);
  return { audio, isUrl: /^https?:/.test(audio) };
};

/** Announcer line for the green light. `emotion` is honoured on speech-02/2.6/2.8 models. */
export const createSpeech = async ({
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
}) => {
  const voice_setting = { voice_id: voiceId, speed, vol, pitch };
  if (emotion) voice_setting.emotion = emotion;
  const json = await request('POST', '/v1/t2a_v2', {
    model,
    text,
    stream: false,
    voice_setting,
    audio_setting: { sample_rate: sampleRate, bitrate, format },
  });
  const audio = json.data?.audio;
  if (!audio) throw new Error(`no audio in t2a response: ${JSON.stringify(json).slice(0, 400)}`);
  // t2a returns hex-encoded bytes, not a URL.
  return { audio, isUrl: /^https?:/.test(audio) };
};

/** Published pay-as-you-go rates, for logging what a run actually cost. */
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
