// The Director's money: four modes, one film, no second ledger.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is a visitor spending money they did not agree to. Every
// other agent in this build costs fractions of a cent or nothing; the Director costs $0.32 a
// Screen Test and up to $1.95 a render, on a real card, and it is the first thing here that can
// run a balance down without a person watching.
//
// Two properties carry most of that weight, and both are asserted repeatedly below:
//
//   1. THE GATE IS AT THE OPEN, NEVER AT THE END. A film that cannot afford its own final render
//      is refused before the first Screen Test — not after three of them have been paid for and
//      the visitor has bought knowledge they can no longer use.
//   2. SPEND IS DERIVED, NEVER STORED. An envelope holds an allowance and a mode. What has been
//      spent is filtered out of the one global ledger at read time, so the two views cannot drift
//      and escrow has nothing to reconcile.

import test from 'node:test';
import assert from 'node:assert/strict';

import { recordSpend, setBudget } from '../../worker/budget.js';
import {
  DEFAULT_MODE,
  MODES,
  authoriseSpend,
  closeEnvelope,
  getEnvelope,
  openEnvelope,
  recordDecision,
  reservedElsewhere,
  setAllowance,
  spentOnFilm,
} from '../../worker/render-budget.js';

class MockKV {
  store = new Map();
  async get(key, type = 'text') {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value) {
    this.store.set(key, value);
  }
  async delete(key) {
    this.store.delete(key);
  }
}

const MIND = 'mind-test';
const makeEnv = () => ({ MIND_CONNECTIONS: new MockKV() });

/** A funded account. Only Stripe can move `total` in production, so this stands in for a top-up. */
const funded = async (totalUsd = 20) => {
  const env = makeEnv();
  await setBudget(env, MIND, { total: totalUsd, perRender: 5 });
  return env;
};

const shoot = (env, filmId, amountUsd) =>
  recordSpend(env, MIND, { kind: 'video', amountUsd, filmId, model: 'MiniMax-H3' });

// ------------------------------------------------------------------------------ the default

test('the default mode is the most conservative one', () => {
  assert.equal(DEFAULT_MODE, 'ask');
  assert.equal(MODES.ask.approvesEach, true);
  assert.equal(MODES.ask.needsAllowance, false);
});

test('only escrow reserves — an allowance is a limit, not a claim on the balance', () => {
  assert.equal(MODES.escrow.reserves, true);
  for (const mode of ['ask', 'allowance', 'discretion']) {
    assert.equal(MODES[mode].reserves, false, `${mode} must not hold money away from other films`);
  }
});

test("discretion escalates to the Producer; every other mode escalates to the visitor", () => {
  assert.equal(MODES.discretion.escalatesTo, 'producer');
  for (const mode of ['ask', 'allowance', 'escrow']) assert.equal(MODES[mode].escalatesTo, 'visitor');
});

// -------------------------------------------------------------------------- the open gate

test('the Director refuses to open with no budget at all — it can never be free', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => openEnvelope(env, MIND, { filmId: 'f1', mode: 'ask', finalUsd: 0.48 }),
    (error) => error.status === 402 && error.message === 'no_budget',
  );
});

test('a film that cannot afford its own final render is refused AT THE OPEN', async () => {
  // The property that matters most. Refused here costs nothing; discovered later costs whatever
  // the Screen Tests already came to, plus a visitor who cannot use what they learned.
  const env = await funded(20);
  await assert.rejects(
    () => openEnvelope(env, MIND, { filmId: 'f1', mode: 'allowance', allowanceUsd: 1, finalUsd: 1.95 }),
    (error) => {
      assert.equal(error.status, 402);
      assert.equal(error.message, 'cannot_afford_final');
      assert.match(error.detail, /\$1\.95/);
      assert.match(error.detail, /shorter or lower-resolution/, 'refusing has to say what would work');
      return true;
    },
  );
});

test('a mode that needs an allowance refuses to open without one', async () => {
  const env = await funded(20);
  for (const mode of ['allowance', 'escrow', 'discretion']) {
    await assert.rejects(
      () => openEnvelope(env, MIND, { filmId: `f-${mode}`, mode }),
      (error) => error.message === 'allowance_required',
      `${mode} needs a ceiling`,
    );
  }
  // `ask` does not, because every single spend is a click — the clicks ARE the ceiling.
  const envelope = await openEnvelope(env, MIND, { filmId: 'f-ask', mode: 'ask', finalUsd: 0.48 });
  assert.equal(envelope.allowanceUsd, null);
});

test('an allowance larger than the balance is refused, with the arithmetic', async () => {
  const env = await funded(5);
  await assert.rejects(
    () => openEnvelope(env, MIND, { filmId: 'f1', mode: 'allowance', allowanceUsd: 10, finalUsd: 0.48 }),
    (error) => error.message === 'insufficient_balance' && /\$10\.00/.test(error.detail) && /\$5\.00/.test(error.detail),
  );
});

// ------------------------------------------------------------------- derived, never stored

test('spend is derived by filtering the one global ledger, not accumulated on the envelope', async () => {
  const env = await funded(20);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'allowance', allowanceUsd: 6, finalUsd: 0.48 });

  await shoot(env, 'f1', 0.32);
  await shoot(env, 'f1', 0.32);
  await shoot(env, 'other-film', 1.95);

  const envelope = await getEnvelope(env, MIND, 'f1');
  assert.equal(envelope.spentUsd, 0.64, "another film's spend must never land on this one");
  assert.equal(envelope.remainingUsd, 5.36);

  // The stored record itself carries no total — that is the invariant, not an implementation note.
  const stored = await env.MIND_CONNECTIONS.get(`production:${MIND}:f1`, 'json');
  assert.equal(stored.spentUsd, undefined);
  assert.equal(stored.remainingUsd, undefined);
});

test('LLM spend on the same film does not count against the render allowance', async () => {
  // Storyboarder tokens are recorded with no amountUsd — they are priced from tokens at read
  // time. Counting them here would silently shrink the render budget by an unrelated number.
  const env = await funded(20);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'allowance', allowanceUsd: 6, finalUsd: 0.48 });
  await recordSpend(env, MIND, { kind: 'llm', model: 'gpt-5.6-sol', usage: { promptTokens: 1000, completionTokens: 2000 }, filmId: 'f1' });
  assert.equal((await getEnvelope(env, MIND, 'f1')).spentUsd, 0);
});

// ---------------------------------------------------------------------------- authorisation

test('ask mode stops on every spend until that exact proposal is approved', async () => {
  const env = await funded(20);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'ask', finalUsd: 0.48 });

  const first = await authoriseSpend(env, MIND, { filmId: 'f1', costUsd: 0.32, proposalId: 'p1', what: 'a Screen Test' });
  assert.equal(first.verdict, 'needs-approval');
  assert.equal(first.reason, 'mode_requires_approval');
  assert.equal(first.escalateTo, 'visitor');

  await recordDecision(env, MIND, 'f1', { proposalId: 'p1', approved: true, what: 'a Screen Test', costUsd: 0.32 });
  assert.equal((await authoriseSpend(env, MIND, { filmId: 'f1', costUsd: 0.32, proposalId: 'p1' })).verdict, 'allowed');

  // Approving one proposal must not authorise the next one.
  assert.equal((await authoriseSpend(env, MIND, { filmId: 'f1', costUsd: 0.32, proposalId: 'p2' })).verdict, 'needs-approval');
});

test('a declined proposal is recorded, so "why did it not shoot?" is answerable', async () => {
  const env = await funded(20);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'ask', finalUsd: 0.48 });
  await recordDecision(env, MIND, 'f1', { proposalId: 'p1', approved: false, what: 'a Screen Test', costUsd: 0.32 });

  const envelope = await getEnvelope(env, MIND, 'f1');
  assert.equal(envelope.decisions.length, 1);
  assert.equal(envelope.decisions[0].approved, false);
  assert.equal((await authoriseSpend(env, MIND, { filmId: 'f1', costUsd: 0.32, proposalId: 'p1' })).verdict, 'needs-approval');
});

test('allowance mode spends freely below the line and stops above it', async () => {
  const env = await funded(20);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'allowance', allowanceUsd: 1, finalUsd: 0.48 });

  assert.equal((await authoriseSpend(env, MIND, { filmId: 'f1', costUsd: 0.32 })).verdict, 'allowed');
  await shoot(env, 'f1', 0.32);
  await shoot(env, 'f1', 0.32);

  const over = await authoriseSpend(env, MIND, { filmId: 'f1', costUsd: 0.48, what: 'the final render' });
  assert.equal(over.verdict, 'needs-approval');
  assert.equal(over.reason, 'over_allowance');
  assert.match(over.detail, /\$0\.36 is left/);
});

test('raising the allowance is what "come back for more" resolves to', async () => {
  const env = await funded(20);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'allowance', allowanceUsd: 1, finalUsd: 0.48 });
  await shoot(env, 'f1', 0.96);
  assert.equal((await authoriseSpend(env, MIND, { filmId: 'f1', costUsd: 0.48 })).verdict, 'needs-approval');

  await setAllowance(env, MIND, 'f1', 3);
  assert.equal((await authoriseSpend(env, MIND, { filmId: 'f1', costUsd: 0.48 })).verdict, 'allowed');
});

test('discretion escalates to the Producer rather than to the visitor', async () => {
  const env = await funded(20);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'discretion', allowanceUsd: 1, finalUsd: 0.48 });
  await shoot(env, 'f1', 0.96);
  const over = await authoriseSpend(env, MIND, { filmId: 'f1', costUsd: 0.48 });
  assert.equal(over.escalateTo, 'producer');
});

test('the global balance is the floor under every mode, allowance or not', async () => {
  const env = await funded(1);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'allowance', allowanceUsd: 1, finalUsd: 0.48 });
  await shoot(env, 'f1', 0.9);
  const verdict = await authoriseSpend(env, MIND, { filmId: 'f1', costUsd: 0.48 });
  assert.equal(verdict.verdict, 'refused', 'an allowance can never authorise money that is not there');
  assert.equal(verdict.reason, 'insufficient_balance');
});

// ---------------------------------------------------------------------------------- escrow

test('an open escrow holds money away from a second film; other modes do not', async () => {
  const env = await funded(10);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'escrow', allowanceUsd: 8, finalUsd: 0.48 });

  await assert.rejects(
    () => openEnvelope(env, MIND, { filmId: 'f2', mode: 'allowance', allowanceUsd: 5, finalUsd: 0.48 }),
    (error) => error.message === 'insufficient_balance' && /set aside for other films/.test(error.detail),
  );

  // $2 is genuinely still available, so a film that fits does open.
  const second = await openEnvelope(env, MIND, { filmId: 'f2', mode: 'allowance', allowanceUsd: 2, finalUsd: 0.48 });
  assert.equal(second.allowanceUsd, 2);
});

test('closing an escrow releases exactly the unspent remainder, and only once', async () => {
  const env = await funded(10);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'escrow', allowanceUsd: 8, finalUsd: 0.48 });
  await shoot(env, 'f1', 1.95);

  const closed = await closeEnvelope(env, MIND, 'f1', { reason: 'delivered' });
  assert.equal(closed.spentUsd, 1.95);
  assert.equal(closed.releasedUsd, 6.05);
  assert.ok(closed.closedAt);

  // Idempotent: settling a settled production must not release a second time.
  const again = await closeEnvelope(env, MIND, 'f1');
  assert.equal(again.releasedUsd, 6.05);
  assert.equal(again.closedAt, closed.closedAt);
});

test('a released escrow stops reserving, freeing the money for the next film', async () => {
  const env = await funded(10);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'escrow', allowanceUsd: 8, finalUsd: 0.48 });
  await shoot(env, 'f1', 1.95);
  await closeEnvelope(env, MIND, 'f1');

  const second = await openEnvelope(env, MIND, { filmId: 'f2', mode: 'escrow', allowanceUsd: 8, finalUsd: 0.48 });
  assert.equal(second.allowanceUsd, 8);
});

test('a closed production authorises nothing further', async () => {
  const env = await funded(10);
  await openEnvelope(env, MIND, { filmId: 'f1', mode: 'allowance', allowanceUsd: 5, finalUsd: 0.48 });
  await closeEnvelope(env, MIND, 'f1');
  const verdict = await authoriseSpend(env, MIND, { filmId: 'f1', costUsd: 0.32 });
  assert.equal(verdict.verdict, 'refused');
  assert.equal(verdict.reason, 'closed');
});

// ------------------------------------------------------------------------------- helpers

test('reservedElsewhere counts only OPEN escrows, and never the film asking', async () => {
  const spend = { events: [{ filmId: 'a', amountUsd: 1 }] };
  const envelopes = [
    { filmId: 'a', mode: 'escrow', allowanceUsd: 5, closedAt: null },
    { filmId: 'b', mode: 'escrow', allowanceUsd: 4, closedAt: Date.now() },
    { filmId: 'c', mode: 'allowance', allowanceUsd: 9, closedAt: null },
  ];
  assert.equal(reservedElsewhere(envelopes, spend, 'z'), 4, 'only a, and only its unspent $4');
  assert.equal(reservedElsewhere(envelopes, spend, 'a'), 0, 'a must not reserve against itself');
});

test('spentOnFilm ignores events belonging to no film', async () => {
  const spend = { events: [{ filmId: null, amountUsd: 5 }, { filmId: 'f1', amountUsd: 0.32 }] };
  assert.equal(spentOnFilm(spend, 'f1'), 0.32);
});
