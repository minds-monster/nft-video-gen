// The free tier's transport: the same Nemotron weights, served from OpenRouter instead of
// NVIDIA's own NIM.
//
// WHY OPENROUTER AND NOT NVIDIA, since the key for both is already in this repo. Round 7
// measured all of it (HANDOVER.md's free-tier table has the numbers):
//
//   - NVIDIA's Ultra throughput DEGRADES under sustained use — 11.0s to 16.2s on a trivial call
//     across two hours, until whole-film requests 504 consistently. A request that succeeds at
//     one hour and times out the next is disqualifying for a visitor-facing feature on its own.
//   - OpenRouter is ~12x faster on identical weights (1.3s vs 16.2s on a trivial call) and
//     completed a five-beat film in 236s where NVIDIA's own hosting could not.
//   - NVIDIA's API Trial terms are evaluation-only and define production as "activity serving
//     real end-users". A free tier on minds.monster is production use by that definition.
//     OpenRouter's terms are not so limited.
//
// So the conclusion this file encodes is "model X FROM ORIGIN Y is good enough" (Adam's phrasing,
// and the reason it matters: origin can change without the model changing, and here the origin
// was the entire problem).
//
// THE FORCED TOOL CALL IS NOT OPTIONAL. It is the only structured-output mechanism this endpoint
// honours, and round 7 measured what happens without it: streaming survives the gateway timeout
// that kills a six-beat call, but this endpoint refuses to stream under `tool_choice`, so buying
// length that way costs the schema — malformed JSON, framing self-agreement 0.50 against 1.00.
// The transferable rule from that round: **if a fix requires dropping a gate, the fix is wrong.**
// Five beats with the schema intact beats six without it, which is why FREE_MAX_BEATS is 5.

import { chat, NvidiaError } from './nvidia.js';

/** OpenRouter's id for the weights round 7 actually scored. The `:free` suffix is a different
 * catalogue entry from the paid one (1M context, 65,536 max completion tokens, $0) — confirmed
 * against the live /models endpoint, not assumed from a docs page. */
export const FREE_FILM_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

/** Five, not six. Six beats failed on EVERY free configuration tried, and OpenRouter's failure
 * was the informative one: `finish_reason: error` after 555s having spent 14,578 completion
 * tokens, all of them reasoning, with `max_tokens` at 60,000 — a provider-side TIME limit, not a
 * token budget, so raising the budget does not help. */
export const FREE_MAX_BEATS = 5;

const requireKey = (env) => {
  const key = env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      'OPENROUTER_API_KEY is not set. Locally it goes in .env (the probe scripts read it from ' +
        'there) and .dev.vars for `wrangler dev`; in production use ' +
        '`wrangler secret put OPENROUTER_API_KEY`. It is never VITE_-prefixed.',
    );
  }
  return key;
};

export class OpenRouterTruncatedError extends Error {
  constructor(message) {
    super(`OpenRouter response truncated: ${message}`);
    this.name = 'OpenRouterTruncatedError';
    this.truncated = true;
  }
}

const usageOf = (payload) => {
  const u = payload?.usage ?? {};
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    // Nemotron returns its thinking on a separate `reasoning_content` channel rather than in a
    // usage counter, so this is usually 0 here. Recorded anyway so the free ledger has the same
    // shape as the paid one and the two stay directly comparable.
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
};

/**
 * One whole film, structured by a forced tool call.
 *
 * Three parameters are deliberately NOT sent, each because it was measured broken rather than
 * because it looked unnecessary:
 *   - `response_format` — documented unsupported on Ultra, and measured to degrade output when
 *     it is accepted.
 *   - `reasoning_budget` — returns a 500 (not a clean 400) on the hosted NIM. Reasoning depth
 *     here is `enable_thinking` and nothing else.
 *   - `nvext.guided_json` — 400s with "unknown field"; guided decoding is a self-hosted feature.
 *
 * Cost is always $0, but tokens, latency and attempts are still returned: on this tier
 * wall-clock and the rate limit are the currency, so those are what the ledger records.
 */
export const filmCall = async (env, {
  system,
  user,
  schema,
  toolName = 'emit_film',
  model = env.FREE_STORYBOARD_MODEL ?? FREE_FILM_MODEL,
  temperature = 0.3,
  maxTokens = 32768,
  retries = 2,
  signal,
}) => {
  const startedAt = Date.now();
  const payload = await chat(env, {
    model,
    signal,
    retries,
    apiKey: requireKey(env),
    baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    tools: [
      { type: 'function', function: { name: toolName, description: 'Return the blocking spec.', parameters: schema } },
    ],
    tool_choice: { type: 'function', function: { name: toolName } },
    temperature,
    max_tokens: maxTokens,
    chat_template_kwargs: { enable_thinking: true },
  });

  const choice = payload.choices?.[0];
  const usage = usageOf(payload);
  if (choice?.finish_reason === 'length') {
    throw new OpenRouterTruncatedError(`finish_reason=length after ${usage.completionTokens} tokens (max_tokens ${maxTokens})`);
  }
  if (choice?.finish_reason === 'error') {
    // The provider-side time limit, which arrives as a 200 carrying an error finish reason
    // rather than an HTTP error — invisible to the retry loop in nvidia.js.
    throw new NvidiaError(504, `OpenRouter returned finish_reason=error after ${usage.completionTokens} tokens`);
  }

  return {
    data: parseFilm(choice),
    usage,
    model,
    costUsd: 0,
    latencyMs: Date.now() - startedAt,
  };
};

/** Prefer the tool call; fall back to the content channel. The fallback is not defensive
 * programming for its own sake — this provider does occasionally answer in prose despite a forced
 * call, and worker/nvidia.js's own jsonFrom has done the same two-step since round 1. */
const parseFilm = (choice) => {
  const args = choice?.message?.tool_calls?.[0]?.function?.arguments;
  if (args) return JSON.parse(args);

  const content = choice?.message?.content;
  if (!content) throw new Error('OpenRouter completion had neither a tool call nor content');
  const cleaned = String(content).trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error(`Expected JSON, got: ${cleaned.slice(0, 200)}`);
    return JSON.parse(cleaned.slice(start, end + 1));
  }
};
