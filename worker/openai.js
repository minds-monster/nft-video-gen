// A thin client for two of OpenAI's APIs: gpt-image-2's edit endpoint (a single, on-demand,
// opt-in "sketch preview" per storyboard frame — see worker/storyboarder.js's header for why
// this stopped being the pipeline's default mechanism in round 4), and chat completions with
// a forced tool call, used for the Storyboarder's actual default output: a structured
// blocking-JSON spec per beat, text-only, cheap, and — round 3/4's real finding — far more
// controllable than an image model for a job that is fundamentally about precise structured
// direction, not a picture.
//
// Deliberately thin, matching worker/nvidia.js's own reasoning: base URL and model stay
// out of the call sites that don't need to know them, and every provider-specific shape
// (multipart edits, size/quality enums, tool-call extraction) lives at the one call site
// that does. Raw fetch, no SDK.
//
// gpt-image-2, not gpt-image-1: the first live Storyboarder run (see the plan doc's
// post-mortem) produced generic, low-fidelity output partly because gpt-image-1 needs
// input_fidelity requested explicitly and this build never did. gpt-image-2 (OpenAI, shipped
// April 2026) applies high-fidelity processing to every input image automatically — no
// parameter to set, confirmed against OpenAI's own docs: "for gpt-image-2, omit this
// parameter; the API doesn't allow changing it." Separately non-optional: gpt-image-1 is
// scheduled for shutdown 2026-10-23, independently confirmed via web search.
//
// gpt-5.6-terra, not gpt-4o: the obvious first instinct (Gemini's own recommendation, and
// the OpenAI key was already in hand) was gpt-4o — checked against OpenAI's current model
// docs and it's deprecated (chatgpt-4o-latest access ended February 2026). The current
// family is GPT-5.6 (sol/terra/luna, see GPT5_MODEL below) — terra by default: forced
// tool-call structured output doesn't need frontier-tier reasoning, so there's no reason to
// default to sol (the flagship) over the cost-conscious middle tier.

export class OpenAIError extends Error {
  constructor(status, body) {
    super(`OpenAI ${status}: ${String(body).slice(0, 400)}`);
    this.name = 'OpenAIError';
    this.status = status;
    // The error code, when the body is JSON — worth parsing rather than pattern-matching the
    // message, because one of these codes changes what "retryable" means.
    try {
      this.code = JSON.parse(String(body))?.error?.code ?? null;
    } catch {
      this.code = null;
    }
    // MEASURED 2026-08-24, and it cost a pointless retry storm to notice: an exhausted credit
    // balance arrives as **429**, the same status as a rate limit. Backing off and retrying an
    // empty wallet just spends wall-clock to be told the same thing three more times. A rate
    // limit clears on its own; a billing problem never does.
    this.outOfCredit = this.code === 'insufficient_quota' || this.code === 'credit_balance_exhausted';
    this.retryable = (status === 429 && !this.outOfCredit) || status >= 500;
  }
}

const BASE_URL = 'https://api.openai.com/v1';

const requireKey = (env) => {
  const key = env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      'OPENAI_API_KEY is not set. Locally it goes in .dev.vars; in production use ' +
        '`wrangler secret put OPENAI_API_KEY`. It is never VITE_-prefixed.',
    );
  }
  return key;
};

const dataUriToBlob = (dataUri) => {
  const [header, base64] = dataUri.split(',');
  const contentType = header.match(/data:(.*);base64/)?.[1] ?? 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
};

/**
 * Flat per-image cost table for gpt-image-2. OpenAI prices this model by token (image
 * input/output tokens), not a flat per-image number, and the exact token count per
 * generation isn't published — so this is a documented estimate, not measured fact. It
 * exists to make budget-gating and the running-spend ticker directionally correct before
 * real spend; worker/budget.js's recordSpend is what makes the real number visible once
 * this runs for real, which is the actual correction mechanism, not this table.
 */
const COST_TABLE = {
  low: { '1024x1024': 0.02, '1024x1536': 0.03, '1536x1024': 0.03 },
  medium: { '1024x1024': 0.05, '1024x1536': 0.07, '1536x1024': 0.07 },
  high: { '1024x1024': 0.19, '1024x1536': 0.25, '1536x1024': 0.25 },
};

export const estimateCostUsd = ({ size = '1024x1024', quality = 'medium' } = {}) =>
  COST_TABLE[quality]?.[size] ?? COST_TABLE.medium['1024x1024'];

/**
 * gpt-image-2's edit endpoint — the one that accepts reference images (up to 16) and
 * composes a new image around them, which is what lets a storyboard frame preserve the
 * actual cast's likeness instead of inventing a generic interpretation of it. Every input
 * image gets high-fidelity processing automatically on this model — no fidelity parameter
 * to pass, and none accepted.
 *
 * `images` is an array of data URIs — real pixels, fetched fresh from the source NFT by
 * the caller (never derived from the Casting Director's dossier text). `prompt` is the
 * per-beat staging instruction. Returns `{ b64, costUsd }`.
 */
export const editImage = async (env, { prompt, images, size = '1024x1024', quality = 'medium' }) => {
  const key = requireKey(env);
  if (!images?.length) throw new Error('editImage needs at least one reference image');

  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', quality);
  images.forEach((dataUri, index) => {
    form.append('image[]', dataUriToBlob(dataUri), `reference-${index}.png`);
  });

  const response = await fetch(`${BASE_URL}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!response.ok) throw new OpenAIError(response.status, await response.text());
  const payload = await response.json();
  const item = payload.data?.[0];
  if (!item?.b64_json) throw new Error('OpenAI image response had no image data');

  return { b64: item.b64_json, costUsd: estimateCostUsd({ size, quality }) };
};

/** The GPT-5.6 tier ids, named so a call site says what it means ("cost-conscious default")
 * rather than a bare model string. sol = flagship ("frontier model for complex professional
 * work"), terra = balances intelligence and cost, luna = cost-tier. Confirmed against
 * OpenAI's current model docs, not assumed — worth restating because it's easy to guess
 * backwards from the names alone. */
export const GPT5_MODEL = {
  sol: 'gpt-5.6-sol',
  terra: 'gpt-5.6-terra',
  luna: 'gpt-5.6-luna',
};

/**
 * Per-million-token prices for the GPT-5.6 family. VERIFIED against OpenAI's pricing page, not
 * guessed — and the distinction cost real money to learn: round 7's probe invented a price for
 * sol ($12/$68 against an actual $4/$20) and reported a bill 3.4x too high until someone checked.
 *
 * THE RULE THIS TABLE EXISTS TO ENFORCE: spend is computed at READ time from stored token counts,
 * never locked in at emit time. Correcting a number here retroactively corrects every historical
 * figure the Producer has ever been shown. A dollar amount frozen into a record when the call was
 * made cannot be corrected at all.
 */
export const TOKEN_PRICES = {
  'gpt-5.6-sol': { in: 4, out: 20 },
  'gpt-5.6-terra': { in: 2, out: 12 },
  'gpt-5.6-luna': { in: 0.2, out: 1.2 },
};

/** Normalises the two different `usage` shapes /v1/chat/completions and /v1/responses return.
 * Reasoning tokens are billed at the OUTPUT rate and are nested INSIDE completion_tokens on
 * OpenAI (unlike NVIDIA, where they arrive on a disjoint channel) — so they are reported for
 * visibility but must never be added to the total again. */
export const usageOf = (payload) => {
  const u = payload?.usage ?? {};
  return {
    promptTokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    completionTokens: u.completion_tokens ?? u.output_tokens ?? 0,
    reasoningTokens:
      u.completion_tokens_details?.reasoning_tokens ?? u.output_tokens_details?.reasoning_tokens ?? 0,
  };
};

/** Dollars for one call, from its stored token counts. Unknown model (a free-tier one, say)
 * costs zero rather than throwing — the ledger still records its tokens. */
export const tokenCostUsd = (model, usage) => {
  const price = TOKEN_PRICES[model];
  if (!price || !usage) return 0;
  return (usage.promptTokens / 1e6) * price.in + (usage.completionTokens / 1e6) * price.out;
};

/** The model ran out of room mid-answer. Distinct from a transport failure because the response
 * is a well-formed 200 carrying half a film — retrying it verbatim just spends the same money to
 * hit the same ceiling, so callers need to raise the budget or shorten the request instead. */
export class OpenAITruncatedError extends Error {
  constructor(message) {
    super(`OpenAI response truncated: ${message}`);
    this.name = 'OpenAITruncatedError';
    this.truncated = true;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * /v1/responses with strict structured output — the path that allows real reasoning effort
 * ALONGSIDE a guaranteed schema, which chat completions does not (see chatCompletion's quirk 2:
 * a forced tool call there requires reasoning_effort 'none'). Round 7 measured the difference and
 * it is the whole reason this function exists: the storyboard's geometry is reasoning-bound, with
 * 76% of output tokens spent on reasoning.
 *
 * Two measured facts baked in rather than rediscovered:
 *   - strict `json_schema` on this account DOES accept numeric minimum/maximum, so SCENE_SCHEMA
 *     goes through unstripped and the API enforces the ranges for us.
 *   - `temperature` is rejected outright alongside `reasoning` ("Unsupported parameter"), so it
 *     is not sent at all. Do not add it back.
 *
 * Retries 429/5xx with backoff — `OpenAIError.retryable` has existed unused since round 1.
 */
export const respond = async (env, {
  model = GPT5_MODEL.sol,
  system,
  user,
  schema,
  schemaName = 'film_blocking',
  effort = 'high',
  maxOutputTokens = 32000,
  strict = true,
  retries = 3,
  signal,
}) => {
  const key = requireKey(env);
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

  const startedAt = Date.now();
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(`${BASE_URL}/responses`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const payload = await response.json();
      return { payload, usage: usageOf(payload), model, latencyMs: Date.now() - startedAt, attempts: attempt + 1 };
    }
    last = new OpenAIError(response.status, await response.text());
    if (!last.retryable || attempt === retries) throw last;
    await sleep(Math.min(15000, 500 * 2 ** attempt) + Math.floor(Math.random() * 500));
  }
  throw last;
};

/** The structured payload from a respond() result, with truncation raised as its own error so a
 * caller can tell "the model ran out of room" apart from "the model refused" apart from "the
 * transport broke". All three look like a failed parse otherwise. */
export const jsonFromResponse = ({ payload }) => {
  if (payload?.status === 'incomplete') {
    throw new OpenAITruncatedError(
      `${payload.incomplete_details?.reason ?? 'unknown reason'} after ${usageOf(payload).completionTokens} tokens`,
    );
  }
  const message = (payload?.output ?? []).find((item) => item.type === 'message');
  const refusal = message?.content?.find((c) => c.type === 'refusal');
  if (refusal) throw new Error(`OpenAI refused: ${refusal.refusal ?? 'no reason given'}`);

  const outputText = message?.content?.find((c) => c.type === 'output_text')?.text ?? payload?.output_text;
  if (!outputText) throw new Error('OpenAI response had no output_text');
  return JSON.parse(outputText);
};

/**
 * Chat completions with a forced tool call — the same structured-output pattern
 * worker/nvidia.js's chat/jsonFrom establishes for every other agent in this codebase,
 * pointed at OpenAI's own models. Returns the raw completion; pair with jsonFromToolCall
 * below to extract the structured payload.
 *
 * Two GPT-5.6-specific quirks, both confirmed against the live API before this shipped
 * (neither is documented anywhere obvious, and both silently 400 without the fix):
 *   1. `max_tokens` is rejected outright — this family wants `max_completion_tokens`.
 *   2. A forced function tool call 400s on chat completions unless `reasoning_effort` is
 *      explicitly "none" ("Function tools with reasoning_effort are not supported... use
 *      /v1/responses or set reasoning_effort to 'none'"). Every caller here wants a forced
 *      tool call, so "none" is the default rather than something each call site repeats.
 */
export const chatCompletion = async (env, { model = GPT5_MODEL.terra, reasoning_effort = 'none', ...body }) => {
  const key = requireKey(env);
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, reasoning_effort, ...body }),
  });
  if (!response.ok) throw new OpenAIError(response.status, await response.text());
  return response.json();
};

/** The single JSON object a forced tool call was asked to produce. Named distinctly from
 * worker/nvidia.js's own jsonFrom (which also handles that provider's occasional non-tool-call
 * fallback) since OpenAI's forced tool_choice is reliable enough not to need one. */
export const jsonFromToolCall = (completion) => {
  const call = completion?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error('OpenAI chat completion had no tool call');
  return JSON.parse(call.function.arguments);
};
