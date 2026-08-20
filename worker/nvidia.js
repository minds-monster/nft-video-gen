// A thin OpenAI-compatible client for NVIDIA's hosted NIM endpoints.
//
// Deliberately thin, and deliberately the ONLY place that knows the provider's shape. Two
// reasons, both from the research that produced this build:
//
//  1. NVIDIA removed its credit system in 2025 — the "1,000 free credits" figure in every
//     blog post is stale. What's left is a rate limit (community-observed ~40 RPM per
//     model, account-level) with no free-tier increases available.
//  2. The API Trial terms are evaluation-only. Prototyping is fine; production traffic is
//     not.
//
// So the exit has to be cheap. Base URL and model ids are `vars` in wrangler.jsonc, and
// every request goes through here — pointing the stack at OpenRouter (which serves the
// same weights) is a config change, not a rewrite.

/** Thrown for a non-2xx from the provider, carrying the status so callers can see a 429. */
export class NvidiaError extends Error {
  constructor(status, body) {
    super(`NVIDIA ${status}: ${String(body).slice(0, 400)}`);
    this.name = 'NvidiaError';
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * POST /chat/completions.
 *
 * `body` is passed through as-is apart from `model`, so callers own the provider-specific
 * parts — `nvext.guided_json`, `chat_template_kwargs`, tool definitions. Keeping those at
 * the call site rather than abstracting them is intentional: they differ per model and the
 * abstraction would have to be unpicked the first time one of them changes.
 */
const jitter = (ms) => ms + Math.floor(Math.random() * Math.min(ms, 2000));

export const chat = async (env, { model, signal, retries = 5, ...body }) => {
  const key = env.NVIDIA_API_KEY;
  if (!key) {
    throw new Error(
      'NVIDIA_API_KEY is not set. Locally it goes in .dev.vars; in production use ' +
        '`wrangler secret put NVIDIA_API_KEY`. It is never VITE_-prefixed.',
    );
  }

  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(`${env.NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model, ...body }),
    });

    if (response.ok) return response.json();

    const bodyText = await response.text();
    last = new NvidiaError(response.status, bodyText);
    if (!last.retryable || attempt === retries) throw last;

    // The free tier's rate limit is the expected failure here, not the exceptional one: a
    // cold seven-card cast is seven requests in a burst against ~40 RPM. Backing off is
    // the normal path, so it must not surface as a broken treatment.
    const retryAfter = Number(response.headers.get('retry-after')) || 0;
    const base = retryAfter * 1000 || Math.min(15000, 500 * 2 ** attempt);
    await sleep(jitter(base));
  }
  throw last;
};

/**
 * Stream a completion, calling `onDelta` for each fragment as it arrives.
 *
 * Measured, and it is the constraint the whole streaming design bends around: this endpoint
 * only streams when there is **no forced tool call**. With `tool_choice` set, the same
 * request returns the entire answer in two chunks after a two-second pause — nothing to
 * animate. Without tools, and with thinking enabled, it emits hundreds of deltas starting
 * ~50ms in, and it exposes the model's actual reasoning on a separate `reasoning_content`
 * channel.
 *
 * So structure and liveness cannot come from one call. Callers run a streamed thinking pass
 * for the second channel and a forced tool call for the first — and the thinking is not
 * thrown away, it becomes the input to the formalising call.
 *
 * Deliberately not retried. A retry would replay text the user has already watched appear.
 */
export const streamChat = async (env, { model, signal, ...body }, onDelta) => {
  const key = env.NVIDIA_API_KEY;
  if (!key) throw new Error('NVIDIA_API_KEY is not set.');

  const response = await fetch(`${env.NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ model, ...body, stream: true }),
  });

  if (!response.ok) throw new NvidiaError(response.status, await response.text());

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reasoning = '';
  let content = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // A chunk can split mid-line, so the trailing partial is carried to the next read.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }

      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;

      // Two channels. `reasoning_content` is the model working the problem out; `content`
      // is what it decided. They are shown differently, so they stay separate all the way
      // to the UI rather than being concatenated here.
      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        onDelta({ reasoning: delta.reasoning_content });
      }
      if (delta.content) {
        content += delta.content;
        onDelta({ content: delta.content });
      }
    }
  }

  return { reasoning, content };
};

/**
 * The single JSON object a model was asked to produce.
 *
 * Two extraction paths because the two models in this stack are forced into JSON by
 * different mechanisms — the Casting Director by a tool call (the omni model has no structured
 * output), the Screenwriter by `nvext.guided_json`. Both land here.
 */
export const jsonFrom = (completion) => {
  const message = completion?.choices?.[0]?.message;
  if (!message) throw new Error('No message in completion');

  const call = message.tool_calls?.[0];
  if (call?.function?.arguments) return JSON.parse(call.function.arguments);

  let text = message.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Completion had neither a tool call nor text content');
  }

  // Some endpoints return JSON wrapped in markdown fences even when asked not to.
  text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();

  try {
    return JSON.parse(text);
  } catch {
    // Guided decoding should make this unreachable, but a reasoning model that ignores the
    // constraint tends to wrap the object in prose rather than mangle it — so recovering
    // the outermost braces is worth one attempt before failing the request.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error(`Expected JSON, got: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text.slice(start, end + 1));
  }
};
