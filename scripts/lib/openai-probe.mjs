// A raw-fetch OpenAI client for the probe. Mirrors worker/openai.js's hard-won quirks without
// importing it — the worker version reads its key off an `env` binding that doesn't exist in
// Node, and a probe that quietly diverged from production's request shape would be measuring
// the wrong thing.
//
// The two quirks, both copied deliberately from worker/openai.js:126-138, where they are
// documented as confirmed against the live API:
//   1. `max_tokens` is rejected by the GPT-5.6 family — it wants `max_completion_tokens`.
//   2. A forced function tool call 400s on /v1/chat/completions unless `reasoning_effort` is
//      explicitly 'none'. The API's own error says: use /v1/responses or set it to 'none'.
//
// Quirk 2 is precisely why this probe tests /v1/responses at all: on chat completions, a forced
// tool call and real reasoning effort are mutually exclusive, so today's storyboarder runs with
// zero reasoning budget by construction.

const BASE_URL = 'https://api.openai.com/v1';

export const MODELS = { sol: 'gpt-5.6-sol', terra: 'gpt-5.6-terra', luna: 'gpt-5.6-luna' };

/**
 * Token prices, USD per million. The $2/$12 for terra is measured (see HANDOVER.md's note on
 * ~$0.006/beat from live token counts); the other tiers are estimates until stage 0 prints real
 * numbers. Carried in the same spirit as worker/openai.js's COST_TABLE comment: this exists to
 * make spend directionally visible before it happens, and the measured `usage` is what corrects
 * it afterwards.
 *
 * Reasoning tokens are billed at the output rate and are included in output_tokens by the API,
 * so they need no separate line — but they ARE counted and reported separately, because a
 * high-effort cell can spend most of its money on tokens nobody ever sees.
 */
export const TOKEN_PRICES = {
  // VERIFIED against OpenAI's own model docs 2026-08-24, after an earlier guess of $12/$68 for
  // sol turned out to be 3.4x too high on output and inflated every figure in the first run.
  // Guessing a price table and then reporting spend from it is not measurement.
  //   sol   $4 / $20   (cached input $0.40; long-context >272K tokens is 2x in, 1.5x out)
  //   terra $2 / $12   (matches the measured ~$0.006/beat in HANDOVER.md)
  //   luna  $0.20 / $1.20
  'gpt-5.6-sol': { in: 4, out: 20 },
  'gpt-5.6-terra': { in: 2, out: 12 },
  'gpt-5.6-luna': { in: 0.2, out: 1.2 },
};

/** Long-context surcharge threshold. Nothing in this probe comes close — the largest prompt is
 * about 3.5K tokens — but the boundary is recorded so a future caller feeding whole screenplays
 * in doesn't discover it in a bill. */
export const LONG_CONTEXT_THRESHOLD = 272_000;

export class ProbeApiError extends Error {
  constructor(status, body, kind = 'http') {
    super(`OpenAI ${status}: ${String(body).slice(0, 500)}`);
    this.name = 'ProbeApiError';
    this.status = status;
    this.kind = kind;
    this.retryable = status === 429 || status >= 500;
  }
}

/** A response that ran out of output budget mid-thought. A distinct class, not a parse error:
 * it means the cell needs more tokens, not that the model failed. */
export class TruncatedError extends Error {
  constructor(detail) {
    super(`OpenAI response truncated: ${detail}`);
    this.name = 'TruncatedError';
    this.kind = 'truncated';
  }
}

/** A model that declined to answer. Also distinct — a refusal is information about the prompt,
 * not about the model's spatial reasoning. */
export class RefusalError extends Error {
  constructor(detail) {
    super(`OpenAI refusal: ${detail}`);
    this.name = 'RefusalError';
    this.kind = 'refusal';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requireKey = () => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set. It lives in .env / .dev.vars.');
  return key;
};

const post = async (path, body, { retries = 3 } = {}) => {
  const key = requireKey();
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const startedAt = Date.now();
      const response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new ProbeApiError(response.status, text);
        if (error.retryable && attempt < retries) {
          lastError = error;
          await sleep(Math.min(30000, 1500 * 2 ** attempt) + Math.random() * 500);
          continue;
        }
        throw error;
      }
      return { payload: JSON.parse(text), latencyMs: Date.now() - startedAt, attempts: attempt + 1 };
    } catch (error) {
      if (error instanceof ProbeApiError && !error.retryable) throw error;
      if (attempt >= retries) throw error;
      lastError = error;
      await sleep(Math.min(30000, 1500 * 2 ** attempt) + Math.random() * 500);
    }
  }
  throw lastError;
};

const usageOf = (payload) => {
  const u = payload.usage ?? {};
  return {
    promptTokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    completionTokens: u.completion_tokens ?? u.output_tokens ?? 0,
    reasoningTokens:
      u.completion_tokens_details?.reasoning_tokens ?? u.output_tokens_details?.reasoning_tokens ?? 0,
  };
};

export const costUsd = (model, usage) => {
  const price = TOKEN_PRICES[model];
  if (!price) return 0;
  return (usage.promptTokens / 1e6) * price.in + (usage.completionTokens / 1e6) * price.out;
};

/**
 * /v1/chat/completions with a forced tool call — today's production path, reproduced exactly so
 * the control cells measure what actually ships rather than an approximation of it.
 */
export const chatCompletionsCall = async ({
  model, system, user, schema, toolName = 'emit_film',
  temperature = 0.3, maxCompletionTokens = 1500, retries = 3,
}) => {
  const body = {
    model,
    reasoning_effort: 'none',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    tools: [{ type: 'function', function: { name: toolName, description: 'Return the blocking spec.', parameters: schema } }],
    tool_choice: { type: 'function', function: { name: toolName } },
    temperature,
    max_completion_tokens: maxCompletionTokens,
  };
  const { payload, latencyMs, attempts } = await post('/chat/completions', body, { retries });

  const choice = payload.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new TruncatedError(`finish_reason=length after ${usageOf(payload).completionTokens} tokens`);
  }
  if (choice?.message?.refusal) throw new RefusalError(choice.message.refusal);

  const call = choice?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error('OpenAI chat completion had no tool call');

  return {
    data: JSON.parse(call.function.arguments),
    usage: usageOf(payload),
    latencyMs,
    attempts,
    request: body,
    raw: payload,
  };
};

/**
 * /v1/responses with strict structured output — the path that allows real reasoning effort
 * alongside a guaranteed schema, which chat completions does not.
 *
 * `strict` is a parameter rather than a constant because stage 0 exists to find out empirically
 * whether this account's strict mode accepts numeric range keywords. The schema states its
 * ranges in prose as well, so stripping them loses nothing the model can read.
 */
export const responsesCall = async ({
  model, system, user, schema, schemaName = 'film_blocking',
  effort = 'high', maxOutputTokens = 16000, strict = true, temperature = null, retries = 3,
}) => {
  const body = {
    model,
    reasoning: { effort },
    input: [
      { role: 'system', content: [{ type: 'input_text', text: system }] },
      { role: 'user', content: [{ type: 'input_text', text: user }] },
    ],
    text: { format: { type: 'json_schema', name: schemaName, strict, schema } },
    max_output_tokens: maxOutputTokens,
  };
  if (temperature !== null) body.temperature = temperature;

  const { payload, latencyMs, attempts } = await post('/responses', body, { retries });

  if (payload.status === 'incomplete') {
    throw new TruncatedError(
      `${payload.incomplete_details?.reason ?? 'unknown'} after ${usageOf(payload).completionTokens} tokens`,
    );
  }

  const message = (payload.output ?? []).find((item) => item.type === 'message');
  const refusal = message?.content?.find((c) => c.type === 'refusal');
  if (refusal) throw new RefusalError(refusal.refusal ?? 'refused');

  const outputText =
    message?.content?.find((c) => c.type === 'output_text')?.text ?? payload.output_text;
  if (!outputText) throw new Error('OpenAI response had no output_text');

  return {
    data: JSON.parse(outputText),
    usage: usageOf(payload),
    latencyMs,
    attempts,
    request: body,
    raw: payload,
  };
};
