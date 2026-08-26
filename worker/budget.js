// The Producer activation gate. Adam's own read from the brainstorm: "the very first
// substantive thing you need from a visitor is their budget... plant that seed early,
// but don't ask for it in the greeting itself — at a natural moment, once the first
// real question surfaces." Two numbers, both optional individually: a total and a
// per-render ceiling — "I have $20 to spend on this whole thing" and "don't let any
// single render go over $5" are different instructions, per his own reply.
//
// Stored per Mind (not per visitor/session) — a Mind is the one visitor's own Producer
// in this product, so there's no cross-visitor budget to disambiguate.

import { requireSession } from './mind-chat.js';
import { tokenCostUsd } from './openai.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const budgetKey = (mindId) => `budget:${mindId}`;

/** `{ total, perRender, paidTier, setAt } | null` — no TTL, a production decision persists.
 *
 * `paidTier` is a SEPARATE field from the money, deliberately. Adam's round-8 read, and it is the
 * distinction the whole tier design rests on: a budget is a spending cap, not a model selector,
 * and conflating them means a visitor who types "$2" has silently opted into a paid model they
 * never chose. The free path is not a degraded toy — on round 7's fixtures it scored M4 1.00
 * against sol's 0.82 — so paid is a different trade-off, not an upgrade, and it gets its own
 * affirmative click. See worker/tier.js. */
export async function getBudget(env, mindId) {
  return (await env.MIND_CONNECTIONS.get(budgetKey(mindId), 'json')) ?? null;
}

function isValidAmount(value) {
  return value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

export async function setBudget(env, mindId, { total, perRender, paidTier }) {
  if (!isValidAmount(total) || !isValidAmount(perRender) || (total == null && perRender == null)) {
    throw Object.assign(new Error('invalid_budget'), { status: 400 });
  }
  const existing = await getBudget(env, mindId);
  const record = {
    total: total ?? existing?.total ?? null,
    perRender: perRender ?? existing?.perRender ?? null,
    // Explicitly false rather than absent when unchecked, so "never chose paid" and "chose paid
    // then turned it off" are the same readable state rather than one of them being undefined.
    paidTier: paidTier == null ? (existing?.paidTier ?? false) : Boolean(paidTier),
    setAt: Date.now(),
  };
  await env.MIND_CONNECTIONS.put(budgetKey(mindId), JSON.stringify(record));
  return record;
}

const spendKey = (mindId) => `spend:${mindId}`;

// Capped, not unbounded — this is a running ledger for budget-gating and Producer
// visibility, not a full audit trail. The full per-generation history (prompt text, which
// cast assets informed it, every regen) lives on the storyboard record itself, keyed per
// frame — see worker/storyboarder.js. This log only needs enough tail to be legible.
const MAX_SPEND_EVENTS = 200;

/**
 * What one recorded event actually cost, computed NOW rather than read back from what we thought
 * it cost when it happened.
 *
 * SPEND IS COMPUTED AT READ TIME, NEVER LOCKED AT EMIT TIME. This is a hard rule, and round 7
 * paid to learn it: a price table invented at emit time reported a bill 3.4x too high (sol
 * guessed at $12/$68, verified at $4/$20), and every historical figure stayed wrong because the
 * dollars had been frozen into the records. Now an LLM event stores `model` + `usage`, so
 * correcting a number in TOKEN_PRICES retroactively corrects every figure the Producer has ever
 * been shown. Image events keep their stored `amountUsd` — gpt-image-2 is priced per image and
 * there are no tokens to recompute from — which is why both paths survive here.
 */
export const eventCostUsd = (event) => {
  if (event?.usage && event?.model) return tokenCostUsd(event.model, event.usage);
  return event?.amountUsd ?? 0;
};

/** `{ totalSpent, events, thresholdsRelayed }` — no TTL, mirrors the budget cap itself.
 *
 * `totalSpent` is recomputed on every read from the events themselves, plus `retiredSpentUsd` for
 * events already trimmed off the tail of the log. */
export async function getSpend(env, mindId) {
  const stored = (await env.MIND_CONNECTIONS.get(spendKey(mindId), 'json')) ?? null;
  const events = stored?.events ?? [];
  const retired = stored?.retiredSpentUsd ?? 0;
  return {
    ...stored,
    events,
    retiredSpentUsd: retired,
    totalSpent: events.reduce((sum, event) => sum + eventCostUsd(event), retired),
    thresholdsRelayed: stored?.thresholdsRelayed ?? [],
  };
}

/**
 * Append one real spend event and persist it.
 *
 * `kind` distinguishes 'image' (gpt-image-2, priced per image) from 'llm' (priced per token).
 * `failed` marks a call that cost money and produced nothing usable — a beat that breached the
 * floor and could not be repaired. Those are recorded rather than swallowed, because Adam's
 * question is the one a visitor eventually asks: "why did my budget run out faster than the
 * beats I can see?" A failed beat that spent real tokens must show up in the answer.
 */
export async function recordSpend(env, mindId, { amountUsd, kind = 'image', model, usage, frameId, beatIndex, failed = false }) {
  const current = await getSpend(env, mindId);
  const event = { kind, model, usage, amountUsd, frameId, beatIndex, failed, at: Date.now() };
  const all = [...current.events, event];
  const kept = all.slice(-MAX_SPEND_EVENTS);
  // Anything trimmed off the tail keeps counting toward the total; it just stops being legible
  // individually. Dropping it silently would make a long-running Mind's spend appear to shrink.
  const trimmed = all.slice(0, all.length - kept.length);
  const record = {
    events: kept,
    retiredSpentUsd: current.retiredSpentUsd + trimmed.reduce((sum, e) => sum + eventCostUsd(e), 0),
    thresholdsRelayed: current.thresholdsRelayed ?? [],
  };
  await env.MIND_CONNECTIONS.put(spendKey(mindId), JSON.stringify(record));
  return {
    ...record,
    totalSpent: record.events.reduce((sum, e) => sum + eventCostUsd(e), record.retiredSpentUsd),
  };
}

/**
 * Marks a 50%/80%-of-cap threshold as already relayed to the connected Mind, so a digest
 * fires once per threshold per Mind rather than on every generation past it. Adam's own
 * cadence ask: threshold crossings, not a running ping.
 */
export async function markThresholdRelayed(env, mindId, threshold) {
  const current = await getSpend(env, mindId);
  if (current.thresholdsRelayed?.includes(threshold)) return current;
  // `totalSpent` is derived on read, so it must not be written back into the stored record —
  // persisting a computed field is how a stale number outlives the table it came from.
  const { totalSpent: _derivedTotal, ...stored } = current;
  const record = { ...stored, thresholdsRelayed: [...(current.thresholdsRelayed ?? []), threshold] };
  await env.MIND_CONNECTIONS.put(spendKey(mindId), JSON.stringify(record));
  return record;
}

export async function handleBudgetSet(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const perRender = body.perRender === '' || body.perRender == null ? null : Number(body.perRender);
  const paidTier = body.paidTier == null ? null : Boolean(body.paidTier);

  try {
    const existing = await getBudget(env, session.mindId);
    // Ignore any total parameter in request body to prevent manual credits increase
    const record = await setBudget(env, session.mindId, {
      total: existing?.total ?? null,
      perRender,
      paidTier,
    });
    return json({ budget: record });
  } catch (err) {
    if (err.status === 400) return json({ error: 'invalid_budget' }, 400);
    throw err;
  }
}
