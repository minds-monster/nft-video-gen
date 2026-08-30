// Money for the Director, budgeted PER FILM.
//
// WHY THE UNIT IS A FILM, and why there is no per-render cap here.
//
// Everything else in this codebase budgets per Mind: `budget:<mindId>` holds a total and a
// `perRender` ceiling, and `spend:<mindId>` is one running ledger. That is the right shape for
// the Storyboarder, whose costs are fractions of a cent and continuous.
//
// It is the wrong shape for the Director, and Adam's reasoning is the reason:
//
//   "I don't like the per-render cap as for most people it's completely abstract — we have no
//    idea how much a render will be before we've played around with these tools, so I think the
//    thrust should be on looking at total budget PER VIDEO on the highest level."
//
// That is correct, and it generalises. A per-render ceiling asks a visitor for a number they
// cannot possibly know: "$5 per render" is meaningless until you have seen what $0.32 and $1.95
// each buy. A total against one film is a number anyone can reason about — it is the same
// decision as "how much is this worth to me". So `budget.perRender` still exists and the
// Storyboarder's sketch path still honours it, but THE DIRECTOR NEVER CONSULTS IT. What replaces
// it is the priced proposal: every shoot names its own cost before it happens.
//
// ── NO SECOND LEDGER ────────────────────────────────────────────────────────────────────────
//
// An envelope stores an allowance and a mode. It does NOT store what has been spent. That number
// is derived at read time by filtering `spend:<mindId>` on `filmId`, which obeys the hard rule
// worker/budget.js states about itself:
//
//   "SPEND IS COMPUTED AT READ TIME, NEVER LOCKED AT EMIT TIME."
//
// The consequence is worth being explicit about, because it is what makes escrow honest rather
// than elaborate: there is no money to move. Reserving an allowance is a claim on the global
// balance while the envelope is open; releasing it is closing the envelope. Nothing is
// transferred, so nothing can be lost in transfer, and the global ledger stays the only record
// of what was actually spent.

import { getBudget, getSpend } from './budget.js';

/**
 * The four modes, weakest to strongest grant of authority.
 *
 * Adam's own framing, and the reason this is a set rather than a policy: "there's a place for all
 * of the ones you are proposing depending on how experienced the user is." A visitor's first film
 * and their tenth are different situations, and the honest answer is to let them say which one
 * they are in.
 */
export const MODES = {
  ask: {
    id: 'ask',
    label: 'Ask me every time',
    blurb: 'Nothing is shot without a click. Every Screen Test and the final render is a priced card you approve.',
    needsAllowance: false,
    reserves: false,
    approvesEach: true,
    escalatesTo: 'visitor',
  },
  allowance: {
    id: 'allowance',
    label: 'Set an allowance',
    blurb: 'A total for this film. The Director spends freely below it and comes back to you for more.',
    needsAllowance: true,
    reserves: false,
    approvesEach: false,
    escalatesTo: 'visitor',
  },
  escrow: {
    id: 'escrow',
    label: 'Commit and settle',
    blurb: 'The allowance is set aside for this film while it runs, and whatever is left is released when it is done.',
    needsAllowance: true,
    // The one real mechanical difference: a reserved allowance is unavailable to another film,
    // so "set aside" is true rather than decorative.
    reserves: true,
    approvesEach: false,
    escalatesTo: 'visitor',
  },
  discretion: {
    id: 'discretion',
    label: "Producer's discretion",
    blurb: 'An allowance plus authority: the Director proposes, your Producer decides, and only comes to you above the ceiling.',
    needsAllowance: true,
    reserves: false,
    approvesEach: false,
    escalatesTo: 'producer',
  },
};

/** The safe default, and deliberately the most conservative one. A visitor who has never seen
 * what a render costs should not have their first experience be money leaving silently. */
export const DEFAULT_MODE = 'ask';

const envelopeKey = (mindId, filmId) => `production:${mindId}:${filmId}`;
const indexKey = (mindId) => `productions:${mindId}`;

/** Bounded like the films index it sits beside, and for the same reason: this is a working list,
 * not an audit trail. The audit trail is the spend ledger, which is keyed independently. */
const MAX_INDEXED = 20;

const round = (value) => Math.round(value * 100) / 100;

// ────────────────────────────────────────────────────────────────────────────────── storage

const loadRaw = (env, mindId, filmId) =>
  env.MIND_CONNECTIONS.get(envelopeKey(mindId, filmId), 'json').catch(() => null);

const saveRaw = async (env, mindId, record) => {
  record.updatedAt = Date.now();
  // No TTL. A production decision persists, exactly as `budget:` and `spend:` do — a visitor who
  // comes back in a month should find their film where they left it, and its money as they set it.
  await env.MIND_CONNECTIONS.put(envelopeKey(mindId, record.filmId), JSON.stringify(record));
  await indexEnvelope(env, mindId, record);
  return record;
};

async function indexEnvelope(env, mindId, record) {
  const existing = (await env.MIND_CONNECTIONS.get(indexKey(mindId), 'json').catch(() => null)) ?? [];
  const next = [
    { filmId: record.filmId, mode: record.mode, allowanceUsd: record.allowanceUsd, openedAt: record.openedAt, closedAt: record.closedAt ?? null },
    ...existing.filter((entry) => entry.filmId !== record.filmId),
  ].slice(0, MAX_INDEXED);
  await env.MIND_CONNECTIONS.put(indexKey(mindId), JSON.stringify(next)).catch(() => {});
}

// ───────────────────────────────────────────────────────────────────────────── derived spend

/**
 * What this film has actually cost, from the one ledger that records it.
 *
 * Filtering rather than accumulating is the whole design. It also means a price correction in
 * worker/minimax.js retroactively corrects every film's figure, which is the property round 7
 * paid to learn on the other side of the house.
 */
export const spentOnFilm = (spend, filmId) =>
  round(
    (spend?.events ?? [])
      .filter((event) => event.filmId === filmId)
      .reduce((sum, event) => sum + (event.amountUsd ?? 0), 0),
  );

/**
 * How much of the global balance is spoken for by OTHER films still holding an escrow.
 *
 * Only escrow reserves. An allowance is a limit on what the Director may spend; a reservation is
 * a claim that money is unavailable elsewhere, and conflating them would let two films each
 * "have" the same $10.
 */
export const reservedElsewhere = (envelopes, spend, exceptFilmId = null) =>
  round(
    envelopes
      .filter((e) => e.mode === 'escrow' && !e.closedAt && e.filmId !== exceptFilmId)
      .reduce((sum, e) => sum + Math.max(0, (e.allowanceUsd ?? 0) - spentOnFilm(spend, e.filmId)), 0),
  );

// ────────────────────────────────────────────────────────────────────────────── the envelope

/** One film's money, with everything derived filled in. `null` when the film has no envelope. */
export async function getEnvelope(env, mindId, filmId) {
  const record = await loadRaw(env, mindId, filmId);
  if (!record) return null;
  const spend = await getSpend(env, mindId);
  const spentUsd = spentOnFilm(spend, filmId);
  return {
    ...record,
    spentUsd,
    remainingUsd: record.allowanceUsd == null ? null : round(record.allowanceUsd - spentUsd),
    mode: MODES[record.mode] ? record.mode : DEFAULT_MODE,
  };
}

export async function listEnvelopes(env, mindId) {
  return (await env.MIND_CONNECTIONS.get(indexKey(mindId), 'json').catch(() => null)) ?? [];
}

/**
 * Open a production, or update the one that is already open.
 *
 * ⚠️ THE GATE IS AT THE OPEN, NEVER AT THE END. worker/tier.js states the same rule for the
 * Storyboarder and the reasoning transfers directly: a visitor must never start a run they cannot
 * finish. A film whose allowance cannot cover its own final render is refused HERE, with the
 * arithmetic shown, rather than after three Screen Tests have been paid for.
 */
/**
 * The refusals a visitor can fix with money. Named here so the panel can offer a top-up for
 * exactly these and nothing else — a 404 for a test the film no longer has is not a billing
 * problem, and a "Top up" button beside it would be a lie.
 */
export const BUDGET_REFUSALS = new Set(['no_budget', 'insufficient_balance', 'cannot_afford_final']);

export async function openEnvelope(env, mindId, { filmId, mode = DEFAULT_MODE, allowanceUsd: requested = null, finalUsd = 0 }) {
  if (!MODES[mode]) throw Object.assign(new Error('unknown_mode'), { status: 400 });
  const spec = MODES[mode];
  // A mode with no allowance HAS no allowance. The client keeps a default figure in its state
  // for the modes that need one and sends it regardless; honouring it in `ask` mode made every
  // ask-mode film "need" $5 at the open and drew a spend bar against a ceiling nobody set.
  const allowanceUsd = spec.needsAllowance ? requested : null;

  if (spec.needsAllowance && !(allowanceUsd > 0)) {
    throw Object.assign(new Error('allowance_required'), {
      status: 400,
      detail: `"${spec.label}" needs a total for this film. Without one there is no ceiling, which is the failure this whole system exists to prevent.`,
    });
  }

  const budget = await getBudget(env, mindId);
  const spend = await getSpend(env, mindId);
  const envelopes = await listEnvelopes(env, mindId);

  // The Director can never be free. There is no Zero Budget path here and there should not be
  // one: H3 charges per second of footage, and pretending otherwise would mean us paying for
  // every visitor's experiments.
  const globalRemaining = budget?.total == null ? 0 : round(budget.total - spend.totalSpent);
  const reserved = reservedElsewhere(envelopes, spend, filmId);
  const available = round(globalRemaining - reserved);

  // Every money refusal carries `wanted` and `available`, because the panel sizes the top-up
  // from them. Found necessary on 2026-08-30: a Mind with no budget row pressed "Run the
  // Director's 2 tests", this threw in milliseconds, and the visitor saw the button come back.
  const wanted = allowanceUsd ?? finalUsd;

  if (budget?.total == null) {
    throw Object.assign(new Error('no_budget'), {
      status: 402,
      detail: 'The Director needs a budget before it can shoot anything. Top up to give it something to work with.',
      available: 0,
      reserved: 0,
      wanted,
    });
  }

  if (wanted > available) {
    throw Object.assign(new Error('insufficient_balance'), {
      status: 402,
      detail:
        `This film needs $${wanted.toFixed(2)} and $${available.toFixed(2)} is available` +
        (reserved > 0 ? ` — $${reserved.toFixed(2)} is set aside for other films still open.` : '.'),
      available,
      reserved,
      wanted,
    });
  }

  // Even in `ask` mode, where there is no allowance, the final render has to be affordable at the
  // open. Otherwise a visitor approves three Screen Tests and then discovers the film itself is
  // out of reach — having spent money to learn things they now cannot use.
  if (finalUsd > 0 && finalUsd > (allowanceUsd ?? available)) {
    throw Object.assign(new Error('cannot_afford_final'), {
      status: 402,
      detail:
        `The final render costs $${finalUsd.toFixed(2)}, which is more than ` +
        `${allowanceUsd == null ? 'the balance' : 'the allowance'} of $${(allowanceUsd ?? available).toFixed(2)}. ` +
        'Raise it, or shorten the film — a shorter or lower-resolution take costs proportionally less.',
      available: allowanceUsd ?? available,
      reserved,
      wanted: finalUsd,
    });
  }

  const existing = await loadRaw(env, mindId, filmId);
  return saveRaw(env, mindId, {
    filmId,
    mode,
    allowanceUsd: allowanceUsd ?? null,
    decisions: existing?.decisions ?? [],
    openedAt: existing?.openedAt ?? Date.now(),
    closedAt: null,
    releasedAt: null,
    releasedUsd: null,
  });
}

/**
 * Settle up. Idempotent — closing a closed envelope returns it unchanged rather than releasing
 * twice, which matters because this is called from both a delivered film and an abandoned one.
 */
export async function closeEnvelope(env, mindId, filmId, { reason = 'delivered' } = {}) {
  const record = await loadRaw(env, mindId, filmId);
  if (!record) return null;
  if (record.closedAt) return getEnvelope(env, mindId, filmId);

  const spend = await getSpend(env, mindId);
  const spentUsd = spentOnFilm(spend, filmId);

  await saveRaw(env, mindId, {
    ...record,
    closedAt: Date.now(),
    releasedAt: Date.now(),
    // What the visitor gets back, which for a non-reserving mode is a statement rather than a
    // movement: the money was never held anywhere but their own balance.
    releasedUsd: record.allowanceUsd == null ? 0 : Math.max(0, round(record.allowanceUsd - spentUsd)),
    closeReason: reason,
  });
  return getEnvelope(env, mindId, filmId);
}

// ───────────────────────────────────────────────────────────────────────────── authorisation

/**
 * May the Director spend this, right now?
 *
 * Returns a verdict rather than throwing, because "you need to approve this" is an ordinary step
 * in the flow rather than an error. Three outcomes:
 *
 *   allowed          — go.
 *   needs-approval   — stop and ask. The job parks; a POST resumes it.
 *   refused          — cannot proceed at all, with the arithmetic.
 *
 * ⚠️ THIS IS NOT ATOMIC, and it does not need to be: the Director shoots ONE task at a time. That
 * is already a hard constraint for two independent reasons — MiniMax rate-limits concurrent tasks
 * (error 1002), and scripts/probe-h3.mjs runs its probes strictly in sequence because "each probe
 * answers a question that can change the next one". If concurrency ever rises, this becomes a
 * race and needs rethinking rather than patching.
 */
export async function authoriseSpend(env, mindId, { filmId, costUsd, what = 'this render', proposalId = null }) {
  const envelope = await getEnvelope(env, mindId, filmId);
  if (!envelope) {
    return { verdict: 'refused', reason: 'no_envelope', detail: 'This film has no budget set yet.' };
  }
  if (envelope.closedAt) {
    return { verdict: 'refused', reason: 'closed', detail: 'This production has been settled and closed.' };
  }

  const spec = MODES[envelope.mode];
  const budget = await getBudget(env, mindId);
  const spend = await getSpend(env, mindId);
  const globalRemaining = budget?.total == null ? 0 : round(budget.total - spend.totalSpent);

  // The global balance is the floor under every mode. An allowance can never authorise money that
  // is not there.
  if (costUsd > globalRemaining) {
    return {
      verdict: 'refused',
      reason: 'insufficient_balance',
      detail: `${what} costs $${costUsd.toFixed(2)} and $${globalRemaining.toFixed(2)} is left in the balance.`,
    };
  }

  if (envelope.remainingUsd != null && costUsd > envelope.remainingUsd) {
    return {
      verdict: 'needs-approval',
      reason: 'over_allowance',
      escalateTo: spec.escalatesTo,
      detail:
        `${what} costs $${costUsd.toFixed(2)}, and $${envelope.remainingUsd.toFixed(2)} is left of the ` +
        `$${envelope.allowanceUsd.toFixed(2)} on this film.`,
      proposalId,
    };
  }

  if (spec.approvesEach) {
    const approved = (envelope.decisions ?? []).some(
      (decision) => decision.proposalId === proposalId && decision.approved,
    );
    if (!approved) {
      return {
        verdict: 'needs-approval',
        reason: 'mode_requires_approval',
        escalateTo: spec.escalatesTo,
        detail: `${what} costs $${costUsd.toFixed(2)}.`,
        proposalId,
      };
    }
  }

  return { verdict: 'allowed', remainingUsd: envelope.remainingUsd, detail: null };
}

/**
 * Record a decision on a proposal.
 *
 * Append-only, and declines are kept as deliberately as approvals. "Why did the Director not
 * shoot the thing it said it would?" has to be answerable, and a declined proposal that left no
 * trace makes it unanswerable.
 */
export async function recordDecision(env, mindId, filmId, { proposalId, approved, what, costUsd, by = 'visitor' }) {
  const record = await loadRaw(env, mindId, filmId);
  if (!record) throw Object.assign(new Error('no_envelope'), { status: 404 });
  const decisions = [
    ...(record.decisions ?? []),
    { proposalId, approved: Boolean(approved), what, costUsd, by, at: Date.now() },
  ];
  await saveRaw(env, mindId, { ...record, decisions });
  return getEnvelope(env, mindId, filmId);
}

/** Raise (or lower) the allowance on an open film, which is what "come back for more" resolves to. */
export async function setAllowance(env, mindId, filmId, allowanceUsd) {
  const record = await loadRaw(env, mindId, filmId);
  if (!record) throw Object.assign(new Error('no_envelope'), { status: 404 });
  if (record.closedAt) throw Object.assign(new Error('closed'), { status: 409 });
  await saveRaw(env, mindId, { ...record, allowanceUsd });
  return getEnvelope(env, mindId, filmId);
}
