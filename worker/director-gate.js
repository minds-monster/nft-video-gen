// Whether the film may be shot yet: has the Director read it, and has every test it asked for
// been answered.
//
// THE FAILURE THIS EXISTS TO PREVENT happened twice in one week. The Director read a film, found
// nothing in its register, said "nothing known to be wrong", and the visitor paid for a take that
// faked the one thing the film was about. The hero was made the other way round — cheap probes
// first, a named finding from each, then the take — and the whole method is worthless if the
// take can be bought before the probes are looked at.
//
// So this is a GATE, not a hint. `ready` (worker/director.js) says whether the request is legal;
// this says whether it is informed. A visitor can still override it — that is their money and
// their film — but the override is a deliberate act that gets written on the take, never the
// default path.
//
// Pure, so the plan endpoint, the start handler and the Producer's briefing all compute exactly
// the same answer from the same records.

/** Every test the Director asked for, register and demand alike, in the plan's own order. */
export const askedTests = (shootingPlan) => {
  if (!shootingPlan) return [];
  const fromRegister = (shootingPlan.tests ?? []).map((test) => ({
    riskId: test.riskId,
    question: test.question ?? null,
    estUsd: test.estUsd ?? 0,
    source: 'register',
  }));
  const fromDemands = (shootingPlan.demands ?? []).map((demand) => ({
    riskId: `demand:${demand.id}`,
    question: demand.question ?? null,
    estUsd: demand.estUsd ?? 0,
    source: 'director',
  }));
  return [...fromRegister, ...fromDemands];
};

/** The most recent settled screen test against one question. Takes are appended in the order
 * they settle, so the last match is the latest. */
const latestTestFor = (takes, riskId) => {
  let latest = null;
  for (const take of takes ?? []) {
    if (take?.kind === 'screen-test' && take.riskId === riskId) latest = take;
  }
  return latest;
};

/**
 * What stands between this film and the Shoot button.
 *
 * `knownRiskIds` — the ids the register currently raises plus every demand — lets a test the
 * Director asked for and then FIXED for free retire rather than block forever: a continuity test
 * proposed before a continuity block was written is no longer a hazard once the block exists.
 *
 * A test is outstanding when it has not been shot, has not been judged, was judged to have
 * FAILED, or was read back by the Director as needing a re-test — until a later test against
 * the same question supersedes it.
 */
export const testGate = (shootingPlan, takes = [], { knownRiskIds = null } = {}) => {
  const unread = !shootingPlan;
  const asked = askedTests(shootingPlan).filter(
    (test) => !knownRiskIds || knownRiskIds.includes(test.riskId),
  );

  const outstanding = asked
    .map((test) => {
      const latest = latestTestFor(takes, test.riskId);
      const answer = latest?.verdict?.answer ?? null;
      const state = !latest
        ? 'unshot'
        : latest.status !== 'ready'
          ? 'unshot'
          : !answer
            ? 'unjudged'
            : answer === 'failed'
              ? 'failed'
              : latest.retest
                ? 'retest'
                : 'cleared';
      return { ...test, state, takeId: latest?.takeId ?? null, answer };
    });

  const open = outstanding.filter((test) => test.state !== 'cleared');
  return {
    unread,
    asked: outstanding,
    outstanding: open,
    outstandingUsd: Math.round(open.reduce((sum, test) => sum + (test.estUsd ?? 0), 0) * 100) / 100,
    cleared: !unread && open.length === 0,
  };
};
