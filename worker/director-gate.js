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

/** Every settled screen test against one question, in the order they settled. */
const readyTestsFor = (takes, riskId) =>
  (takes ?? []).filter((take) => take?.kind === 'screen-test' && take.riskId === riskId && take.status === 'ready');

/** The last render of this question that FAILED, when nothing has succeeded since. */
const latestFailureFor = (takes, riskId) => {
  let failure = null;
  for (const take of takes ?? []) {
    if (take?.kind !== 'screen-test' || take.riskId !== riskId) continue;
    if (take.status === 'failed') failure = take;
    else if (take.status === 'ready') failure = null;
  }
  return failure;
};

/**
 * What stands between this film and the Shoot button.
 *
 * `knownRiskIds` — the ids the register currently raises plus every demand — lets a test the
 * Director asked for and then FIXED for free retire rather than block forever: a continuity test
 * proposed before a continuity block was written is no longer a hazard once the block exists.
 *
 * A test is outstanding when it has not been shot, has not been judged, was judged to have
 * FAILED, or was read back by the Director as needing a re-test — until a later JUDGED test
 * against the same question supersedes it.
 *
 * THE ANSWER IS WHAT COUNTS, NOT THE LATEST CLIP. A visitor ran the same rehearsal five times
 * (2026-08-28, $2.40) because each clip came back "unanswered", the gate called that
 * outstanding, and the only control offered was "run it again". So a question with a judged
 * answer is settled by that answer, later unjudged clips notwithstanding — and a question that
 * has a clip nobody has answered needs ANSWERING, not running: it is in `unanswered`, never in
 * `toRun`, and it costs nothing.
 */
export const testGate = (shootingPlan, takes = [], { knownRiskIds = null } = {}) => {
  const unread = !shootingPlan;
  const asked = askedTests(shootingPlan).filter(
    (test) => !knownRiskIds || knownRiskIds.includes(test.riskId),
  );

  const outstanding = asked
    .map((test) => {
      const ready = readyTestsFor(takes, test.riskId);
      const judged = ready.filter((take) => take.verdict?.answer);
      const latest = judged[judged.length - 1] ?? null;
      const unjudged = ready.filter((take) => !take.verdict?.answer);
      const answer = latest?.verdict?.answer ?? null;
      const failure = ready.length ? null : latestFailureFor(takes, test.riskId);
      const state = failure
        ? 'render-failed'
        : !ready.length
        ? 'unshot'
        : !latest
          ? 'unjudged'
          : answer === 'failed'
            ? 'failed'
            : latest.retest
              ? 'retest'
              : 'cleared';
      return {
        ...test,
        state,
        answer,
        takeId: (latest ?? ready[ready.length - 1])?.takeId ?? null,
        // What the Director made of the answer, when it has read it back.
        finding: latest?.review?.finding ?? null,
        revised: latest?.review?.revised ?? null,
        // The clip waiting to be watched, when there is one — the thing to open, not to re-buy.
        unansweredTakeId: unjudged[unjudged.length - 1]?.takeId ?? null,
        unansweredCount: unjudged.length,
        // Why the last attempt produced nothing, so the panel can say so instead of "not yet run".
        failedReason: failure?.reason ?? null,
      };
    });

  const open = outstanding.filter((test) => test.state !== 'cleared');
  // Whatever its last answer, a question with a clip nobody has watched is answered, not bought.
  const unanswered = open.filter((test) => test.unansweredCount > 0);
  const toRun = open.filter((test) => test.unansweredCount === 0);
  return {
    unread,
    asked: outstanding,
    outstanding: open,
    // Split by what the visitor has to DO: watch and answer (free), or spend to run.
    unanswered,
    toRun,
    outstandingUsd: Math.round(toRun.reduce((sum, test) => sum + (test.estUsd ?? 0), 0) * 100) / 100,
    cleared: !unread && open.length === 0,
  };
};
