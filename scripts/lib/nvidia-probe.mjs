// A raw-fetch NVIDIA NIM client for the free-tier probe.
//
// Mirrors worker/nvidia.js's wire format without importing it — the worker reads its key off an
// `env` binding that does not exist in Node, and a probe that quietly diverged from production's
// request shape would be measuring the wrong thing. Same reasoning as scripts/lib/openai-probe.mjs.
//
// Every difference from the OpenAI client below is a MEASURED fact already recorded in this
// repo, not a guess:
//
//   1. `max_tokens`, not `max_completion_tokens`. (worker/screenwriter.js:154 sends 32768.)
//   2. Reasoning is `chat_template_kwargs: { enable_thinking: ... }`. The three forms this repo
//      has actually sent are `true` (screenwriter.js:116, casting-director.js:408), the string
//      `'low_effort'` (screenwriter.js:152), and `false` (casting-director.js:376, mandatory for
//      video input). `reasoning_budget` appears NOWHERE in this codebase — NVIDIA's docs mention
//      it for Nemotron 3, so whether the hosted endpoint accepts it is a stage-F0 question.
//   3. NO `nvext.guided_json`. worker/screenwriter.js:141-144 records it measured to a 400,
//      "unknown field `guided_json`", with an nvext allow-list that excludes it — guided decoding
//      is a self-hosted-NIM feature, not a hosted one. Structure comes from a forced tool call.
//   4. `response_format: { type: 'json_object' }` IS accepted alongside `tool_choice` on
//      nemotron-3-super (screenwriter.js:148 relies on it). NVIDIA's docs say Ultra does not
//      support it. F0 resolves that empirically rather than trusting either source.
//
// The 429 is the EXPECTED failure on this tier, not the exceptional one — the free key carries a
// ~40 RPM ceiling shared across every model on the account. Backoff therefore mirrors
// worker/nvidia.js:70-76 exactly, including honouring `retry-after`.
//
// Cost is always zero here. That does not make this tier free: wall-clock and the shared rate
// limit are the currency, so those are what the ledger records instead.

import { Agent, setGlobalDispatcher } from 'undici';

const BASE_URL = process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';

// MEASURED, stage F0, 2026-08-24: Node's built-in fetch inherits undici's 300s headersTimeout
// and bodyTimeout, and a six-beat film on Ultra with thinking on takes LONGER than that. It
// surfaced as a bare `TypeError: fetch failed` with no status — indistinguishable from a network
// outage, and easy to misread as "the model can't do six beats" when the model was still
// working. The five-beat film took 250s; the six-beat one never got to finish.
//
// undici is already a direct dependency (7.29.0), so the ceiling is raised rather than worked
// around. 15 minutes is deliberately generous: on this tier the question is whether the answer
// is any good, and a slow answer is still data. Latency is measured and reported separately —
// it must not be silently converted into a failure.
setGlobalDispatcher(new Agent({ headersTimeout: 900_000, bodyTimeout: 900_000 }));

export const NVIDIA_MODELS = {
  ultra: 'nvidia/nemotron-3-ultra-550b-a55b',
  super: 'nvidia/nemotron-3-super-120b-a12b',
  nano: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
};

export class NvidiaProbeError extends Error {
  constructor(status, body, kind = 'http') {
    super(`NVIDIA ${status}: ${String(body).slice(0, 500)}`);
    this.name = 'NvidiaProbeError';
    this.status = status;
    this.kind = status === 429 ? 'rate-limit' : kind;
    this.retryable = status === 429 || status >= 500;
  }
}

export class NvidiaTruncatedError extends Error {
  constructor(detail) {
    super(`NVIDIA response truncated: ${detail}`);
    this.name = 'NvidiaTruncatedError';
    this.kind = 'truncated';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * Math.min(ms, 2000));

const requireKey = () => {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) {
    throw new Error(
      'NVIDIA_API_KEY is not set. It lives in .dev.vars, NOT .env — run node with both:\n' +
        '  node --env-file-if-exists=.env --env-file-if-exists=.dev.vars <script>',
    );
  }
  return key;
};

/**
 * One POST, with worker/nvidia.js's own retry discipline. Returns the parsed payload plus the
 * operational numbers that matter more than cost on this tier: latency, attempts, and how many
 * of those attempts were rate-limited.
 */
const post = async (path, body, { retries = 5, signal } = {}) => {
  const key = requireKey();
  let last;
  let rateLimitHits = 0;
  const startedAt = Date.now();

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      // A transport failure, not an API answer — `TypeError: fetch failed` carries no status, so
      // it has to be caught explicitly or it escapes the retry loop entirely. The first version
      // of this client let it through untouched, which turned one slow request into a hard
      // failure with no diagnosis attached.
      last = networkError;
      last.kind = 'network';
      if (attempt === retries) throw last;
      await sleep(jitter(Math.min(15000, 1000 * 2 ** attempt)));
      continue;
    }

    if (response.ok) {
      return {
        payload: await response.json(),
        latencyMs: Date.now() - startedAt,
        attempts: attempt + 1,
        rateLimitHits,
      };
    }

    const text = await response.text();
    last = new NvidiaProbeError(response.status, text);
    if (response.status === 429) rateLimitHits += 1;
    if (!last.retryable || attempt === retries) {
      last.rateLimitHits = rateLimitHits;
      throw last;
    }

    // worker/nvidia.js:74-76 verbatim: honour retry-after when the server sends one, else
    // exponential backoff capped at 15s, then jitter so a burst doesn't re-collide.
    const retryAfter = Number(response.headers.get('retry-after')) || 0;
    const base = retryAfter * 1000 || Math.min(15000, 500 * 2 ** attempt);
    await sleep(jitter(base));
  }
  throw last;
};

const usageOf = (payload) => {
  const u = payload.usage ?? {};
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    // Nemotron returns its thinking on a separate `reasoning_content` channel rather than in a
    // usage counter (worker/nvidia.js:130-140), so this is usually 0 here. Kept so the ledger
    // shape matches the OpenAI probe's and the two runs stay directly comparable.
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
};

/** Free tier. Recorded anyway so the ledger has the same shape as the paid run's. */
export const costUsd = () => 0;

/**
 * A forced tool call — the only structured-output mechanism this endpoint actually honours, and
 * the one every NVIDIA-backed agent in this repo already uses.
 *
 * `enableThinking` takes the same three values the repo sends in production. `responseFormat`
 * is opt-in rather than default precisely because Ultra is documented not to support it and
 * Super is measured to accept it — F0 decides which is true here.
 */
export const nvidiaToolCall = async ({
  model,
  system,
  user,
  schema,
  toolName = 'emit_film',
  temperature = 0.3,
  maxTokens = 32768,
  enableThinking = true,
  responseFormat = false,
  reasoningBudget = null,
  retries = 5,
  signal,
}) => {
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    tools: [
      {
        type: 'function',
        function: { name: toolName, description: 'Return the blocking spec.', parameters: schema },
      },
    ],
    tool_choice: { type: 'function', function: { name: toolName } },
    temperature,
    max_tokens: maxTokens,
  };
  if (enableThinking !== null) body.chat_template_kwargs = { enable_thinking: enableThinking };
  if (responseFormat) body.response_format = { type: 'json_object' };
  // MEASURED, stage F0: sending `reasoning_budget` returns a 500 Internal Server Error on the
  // hosted endpoint — not a clean 400 naming the field, which is what makes it worth writing
  // down. NVIDIA's docs describe it for Nemotron 3; the hosted NIM does not take it. Reasoning
  // depth here is `enable_thinking` only. Left reachable so the finding stays reproducible.
  if (reasoningBudget !== null) body.reasoning_budget = reasoningBudget;

  const { payload, latencyMs, attempts, rateLimitHits } = await post('/chat/completions', body, { retries, signal });

  const choice = payload.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new NvidiaTruncatedError(
      `finish_reason=length after ${usageOf(payload).completionTokens} tokens (max_tokens ${maxTokens})`,
    );
  }

  // worker/nvidia.js's jsonFrom does the same two-step: prefer the tool call, fall back to
  // content, because this provider does occasionally answer in prose despite a forced call.
  const call = choice?.message?.tool_calls?.[0];
  let data;
  if (call?.function?.arguments) {
    data = JSON.parse(call.function.arguments);
  } else {
    const content = choice?.message?.content;
    if (!content) throw new Error('NVIDIA completion had neither a tool call nor content');
    const cleaned = String(content).trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    try {
      data = JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start === -1 || end <= start) throw new Error(`Expected JSON, got: ${cleaned.slice(0, 200)}`);
      data = JSON.parse(cleaned.slice(start, end + 1));
    }
  }

  return {
    data,
    usage: usageOf(payload),
    latencyMs,
    attempts,
    rateLimitHits,
    request: body,
    raw: payload,
    usedToolCall: Boolean(call?.function?.arguments),
  };
};

/**
 * The streamed path — and on this endpoint it is not an optimisation, it is the only way to get
 * a long film at full reasoning depth.
 *
 * MEASURED, stage F0, 2026-08-24, in this order:
 *   - A six-beat film with `enable_thinking: true` and a forced tool call returns **HTTP 504**.
 *     The gateway kills the connection somewhere around 300s. A five-beat film finishes in 250s;
 *     a six-beat one does not finish at all.
 *   - Dropping to `'low_effort'` or `false` completes six beats (213s / 269s) but collapses
 *     quality — framing self-agreement falls from 1.00 to 0.58 and 0.40, and thinking-off
 *     produced nine floor violations. Length and reasoning were mutually exclusive.
 *   - Streaming breaks the trade-off: **737s, six beats, full thinking, parsed cleanly.** A
 *     gateway timeout kills an IDLE connection; a stream is never idle.
 *
 * Two constraints force the shape of this function, both measured rather than assumed:
 *   1. This endpoint does not stream under a forced `tool_choice` — already documented in
 *      worker/nvidia.js:80-100, and confirmed again here. So structure cannot come from a tool.
 *   2. `stream: true` together with `response_format: { type: 'json_object' }` **truncates the
 *      stream after roughly one second** with partial data and no error. So structure cannot
 *      come from response_format either.
 *
 * What is left is the oldest mechanism there is: put the schema in the system prompt, ask for
 * one JSON object and nothing else, and parse the content channel — which is exactly the
 * fallback branch worker/nvidia.js's own `jsonFrom` already implements for this provider.
 */
export const nvidiaStreamCall = async ({
  model,
  system,
  user,
  schema,
  temperature = 0.3,
  maxTokens = 32768,
  enableThinking = true,
  signal,
  onProgress,
}) => {
  const key = requireKey();
  const startedAt = Date.now();

  const systemWithSchema =
    `${system}\n\nOUTPUT FORMAT. Return one JSON object and nothing else — no prose before or ` +
    `after it, and no markdown fence. It must validate against this schema exactly:\n${JSON.stringify(schema)}`;

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemWithSchema },
        { role: 'user', content: user },
      ],
      chat_template_kwargs: { enable_thinking: enableThinking },
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!response.ok) throw new NvidiaProbeError(response.status, await response.text());

  // Two channels, exactly as worker/nvidia.js:130-140 reads them: `reasoning_content` carries
  // the thinking, `content` carries the answer. Nemotron reports no reasoning-token count in
  // `usage`, so reasoning is measured in characters here — the only honest number available.
  let content = '';
  let reasoningChars = 0;
  let contentChunks = 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta;
        if (delta?.reasoning_content) reasoningChars += delta.reasoning_content.length;
        if (delta?.content) {
          content += delta.content;
          contentChunks += 1;
          onProgress?.({ contentChunks, reasoningChars, elapsedMs: Date.now() - startedAt });
        }
      } catch {
        // A malformed SSE frame is not worth failing a twelve-minute call over.
      }
    }
  }

  const latencyMs = Date.now() - startedAt;
  if (!content.trim()) throw new NvidiaTruncatedError(`stream ended after ${latencyMs}ms with no content`);

  const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error(`Expected JSON, got: ${cleaned.slice(0, 200)}`);
    }
    data = JSON.parse(cleaned.slice(start, end + 1));
  }

  return {
    data,
    // No usage block on a stream, so tokens are estimated from characters at the usual ~4:1.
    // Marked estimated rather than silently reported as measured.
    usage: {
      promptTokens: Math.round(systemWithSchema.length / 4),
      completionTokens: Math.round(content.length / 4),
      reasoningTokens: Math.round(reasoningChars / 4),
      estimated: true,
    },
    latencyMs,
    attempts: 1,
    rateLimitHits: 0,
    contentChunks,
    reasoningChars,
    streamed: true,
    request: { model, stream: true, enable_thinking: enableThinking, max_tokens: maxTokens },
    raw: null,
  };
};
