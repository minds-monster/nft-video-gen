// The Zero Budget transport: the same Nemotron weights, served from OpenRouter instead of
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
//     real end-users". A Zero Budget tier on minds.monster is production use by that definition.
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
// Three beats with the schema intact beats six without it, which is why FREE_MAX_BEATS is 3.

import { chat, NvidiaError } from './nvidia.js';

/** OpenRouter's id for the weights round 7 actually scored. The `:free` suffix is a different
 * catalogue entry from the paid one (1M context, 65,536 max completion tokens, $0) — confirmed
 * against the live /models endpoint, not assumed from a docs page. */
export const FREE_FILM_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

/** Three, not six. Six beats failed on every free configuration tried, and OpenRouter's failure
 * was the informative one: `finish_reason: error` after 555s having spent 14,578 completion
 * tokens, all of them reasoning, with `max_tokens` at 60,000 — a provider-side TIME limit, not a
 * token budget, so raising the budget does not help. The Screenwriter now emits only three beats
 * on Zero Budget, so the cap matches the actual spec length. */
export const FREE_MAX_BEATS = 3;

/**
 * The environment's reasoning depth, if one is configured.
 *
 * Parsed rather than trusted: `FREE_STORYBOARD_REASONING` is a JSON string in wrangler.jsonc,
 * and a typo in it must not take the free tier down. A value that will not parse is ignored
 * with a warning, which leaves the model at its own default — the same behaviour as leaving it
 * empty, and the right direction for a knob whose whole purpose is to be adjustable.
 */
export const envReasoning = (env) => {
  const raw = env?.FREE_STORYBOARD_REASONING;
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    console.warn(`FREE_STORYBOARD_REASONING is not valid JSON, ignoring: ${raw.slice(0, 80)}`);
    return null;
  }
};

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
 *   - `reasoning_budget` — returns a 500 (not a clean 400) on the hosted NIM.
 *   - `nvext.guided_json` — 400s with "unknown field"; guided decoding is a self-hosted feature.
 *
 * REASONING DEPTH IS THE WHOLE LATENCY STORY ON THIS TIER, and `enable_thinking` is NOT the
 * control it was assumed to be. Measured 2026-08-26 (assets/probes/storyboarder-timing): a
 * three-beat film returns ~2,900 tokens of ANSWER and 5,835 tokens of reasoning — 66% of
 * everything generated, on a route that runs at ~40 tok/s. Sending
 * `chat_template_kwargs: { enable_thinking: false }` did not turn it off: the same film still
 * spent 3,588 tokens reasoning. That kwarg is a provider passthrough and there is no evidence it
 * reaches the model at all.
 *
 * So `reasoning` is the parameter that matters here — OpenRouter's OWN unified control
 * (`{ enabled }`, `{ effort }`, `{ max_tokens }`), sent alongside the kwarg rather than instead
 * of it because the two are aimed at different layers. Left null by default; set per call, or
 * per environment through `FREE_STORYBOARD_REASONING` in wrangler.jsonc, so the depth can be
 * re-pointed without a deploy — the same reason `FREE_STORYBOARD_MODEL` is a var.
 *
 * THE GATE STILL APPLIES. Round 7's rule is that if a fix requires dropping a gate, the fix is
 * wrong. Cheaper reasoning is only a win if the emission still passes `validateScene`, which is
 * what the timing probe now scores per cell.
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
  enableThinking = true,
  reasoning,
  onMeta,
}) => {
  const startedAt = Date.now();
  const depth = reasoning !== undefined ? reasoning : envReasoning(env);
  const payload = await chat(env, {
    model,
    signal,
    retries,
    onMeta,
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
    chat_template_kwargs: { enable_thinking: enableThinking },
    ...(depth ? { reasoning: depth } : {}),
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

/**
 * The same call, streamed — so a visitor can watch the model think instead of watching a spinner.
 *
 * MEASURED SHAPE, and it decides the whole UI (2026-08-25, one 3-beat film):
 *   - reasoning starts at 4.4s and runs continuously: 937 deltas, 8,121 characters
 *   - the structured answer does NOT stream. The tool-call arguments arrive as ONE 6,358-character
 *     delta at 347.3s, atomically, at the very end
 *
 * So there is no partial JSON to watch assemble, and anything that claims otherwise is animating a
 * fiction. What there is instead is the model narrating its geometry in prose as it decides it.
 * That reasoning text is forwarded to the browser so the wait is legible; it is not parsed into
 * provisional geometry.
 *
 * `onReasoning` is called with each delta as it lands. It must never throw: a display problem must
 * not be able to kill a generation that is minutes deep and already paid for.
 */
export const streamFilmCall = async (env, {
  system,
  user,
  schema,
  toolName = 'emit_film',
  model = env.FREE_STORYBOARD_MODEL ?? FREE_FILM_MODEL,
  temperature = 0.3,
  maxTokens = 32768,
  onReasoning,
  signal,
  enableThinking = true,
  reasoning,
  onMeta,
}) => {
  const startedAt = Date.now();
  const depth = reasoning !== undefined ? reasoning : envReasoning(env);
  const response = await fetch(`${env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${requireKey(env)}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
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
      chat_template_kwargs: { enable_thinking: enableThinking },
      ...(depth ? { reasoning: depth } : {}),
      stream: true,
    }),
  });

  onMeta?.({
    status: response.status,
    attempt: 0,
    headers: Object.fromEntries(
      ["x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-reset-requests", "retry-after"]
        .map((h) => [h, response.headers.get(h)])
        .filter(([, v]) => v != null),
    ),
  });

  if (!response.ok) throw new NvidiaError(response.status, await response.text());

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reasoningText = '';
  let args = '';
  let content = '';
  let usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };
  let finishReason = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      // A 200 carrying an error object, same as the non-streamed path — see worker/nvidia.js.
      if (event.error) throw new NvidiaError(event.error.code ?? 502, event.error.message ?? 'upstream error');
      if (event.usage) usage = usageOf(event);
      const choice = event.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta ?? {};
      const thought = delta.reasoning ?? delta.reasoning_content;
      if (thought) {
        reasoningText += thought;
        try {
          await onReasoning?.(thought, reasoningText);
        } catch {
          // Showing the work must never be able to break the work.
        }
      }
      if (delta.content) content += delta.content;
      const toolArgs = delta.tool_calls?.[0]?.function?.arguments;
      if (toolArgs) args += toolArgs;
    }
  }

  if (finishReason === 'length') {
    throw new OpenRouterTruncatedError(`finish_reason=length after ${usage.completionTokens} tokens (max_tokens ${maxTokens})`);
  }
  if (finishReason === 'error') {
    throw new NvidiaError(504, `OpenRouter returned finish_reason=error after ${usage.completionTokens} tokens`);
  }

  return {
    data: parseFilm({ message: { tool_calls: args ? [{ function: { arguments: args } }] : undefined, content } }),
    reasoning: reasoningText,
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
