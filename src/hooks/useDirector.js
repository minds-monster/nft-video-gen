import { useCallback, useEffect, useRef, useState } from 'react';

import {
  approveDirectorTake,
  closeDirectorProduction,
  dropDirectorRevision,
  getDirectorFilms,
  getDirectorJobStatus,
  getDirectorPlan,
  getDirectorProduction,
  assessFilm,
  runScreenTest,
  recordScreenTestVerdict,
  rememberDirectorTake,
  saveDirectorBrief,
  startDirectorTake,
  streamDirectorJobEvents,
} from '../services/swarm';
import { filmIdFor } from '../../worker/film-id.js';
import { LATENCY_SECONDS } from '../../worker/minimax.js';
import { DEFAULT_MODE } from '../../worker/render-budget.js';

/**
 * The Director, client-side.
 *
 * WHAT MAKES THIS DIFFERENT FROM useStoryboarder, and why the difference matters: a storyboard
 * is free and can be re-run. A take costs real money and cannot. So every state here is built
 * around one question — can a visitor lose something they paid for? — and the answer is no in
 * every path:
 *
 *   · The render runs in a Queue consumer, not in this tab. Closing the tab loses the progress
 *     stream and nothing else.
 *   · A dropped stream reconnects carrying `lastEvent`, so narration is never replayed.
 *   · When the stream gives up entirely, `recover` falls back to a cheap status poll. It NEVER
 *     re-starts the take — re-running is the one thing that would charge twice.
 *   · The finished film is read back from the production record, which has no TTL, rather than
 *     from the job log, which expires in a day.
 */

/** Visitor-facing prose for each phase. Deliberately says what is happening rather than naming
 * a step: "submitting" is our word, not theirs. */
export const PHASE_LABEL = {
  submitting: 'Sending the shot to MiniMax',
  rendering: 'Rendering — this is the slow part',
  mirroring: 'Bringing the film back',
  unsettled: 'MiniMax has not answered yet',
  reconnecting: 'Reconnecting — the render is still running',
  stalled: 'Gave up waiting — the job is still queued on the server. Nothing more is charged; reload to check again',
};

/**
 * A job's status only moves forward.
 *
 * `GET /api/director/job/:id` reads KV, and a KV read can be up to 60 seconds stale. A record
 * that still says `awaiting-approval` after the approval was sent would put the Approve button
 * back on a render that is already running — and the second click then 409s. So a read that
 * would move a job BACKWARDS keeps the status this tab already knows, and takes the rest.
 */
const STATUS_RANK = { 'awaiting-approval': 0, queued: 1, running: 2, cancelled: 3, complete: 3, failed: 3 };
const mergeJob = (current, next) => {
  if (!next) return current;
  if (!current || current.jobId !== next.jobId) return next;
  const regressed = (STATUS_RANK[next.status] ?? 0) < (STATUS_RANK[current.status] ?? 0);
  return { ...current, ...next, status: regressed ? current.status : next.status };
};

/**
 * Why a run of tests stopped, in the shape the panel shows where the button was.
 *
 * `error` is the server's code (`no_budget`, `insufficient_balance`, `unknown_risk`, …) and
 * `wanted`/`available` its arithmetic, so a money refusal can offer a top-up sized to the gap.
 */
const haltFrom = (failure, extra = {}) => ({
  kind: 'refused',
  error: failure?.error ?? null,
  status: failure?.status ?? null,
  detail: failure?.detail ?? failure?.message ?? 'The test could not be started.',
  available: failure?.available ?? null,
  wanted: failure?.wanted ?? null,
  at: Date.now(),
  ...extra,
});

export function useDirector() {
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [production, setProduction] = useState(null);
  const [films, setFilms] = useState([]);
  const [job, setJob] = useState(null);
  const [phase, setPhase] = useState(null);
  const [elapsedSeconds, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  // The Director's own reasoning, as it arrives. One rolling string because that is how the deltas
  // come — the panel shows its tail, the way StoryboardPanel already does for the Storyboarder.
  const [thinking, setThinking] = useState('');
  const [reading, setReading] = useState(null);
  const [findings, setFindings] = useState([]);
  const [mode, setMode] = useState(DEFAULT_MODE);
  const [allowanceUsd, setAllowance] = useState(5);
  // The refusal the server gave the last Shoot — `untested` or `unread`, with what is owed
  // (worker/director-gate.js). The "Shoot anyway" control exists only while this is set: it is
  // offered AFTER a refusal, never as the default path.
  const [refusal, setRefusal] = useState(null);
  // Progress through "run every test the Director asked for": { total, done, current }.
  const [batch, setBatch] = useState(null);
  // Why the last run of tests stopped before it was done — the server's refusal, or the
  // visitor's own decline. KEPT APART FROM `error` SO THE PANEL CAN SHOW IT WHERE THE CLICK
  // WAS. On 2026-08-30 a Mind with no budget pressed "Run the Director's 2 tests"; the 402
  // landed in `error`, which renders under the whole risk register, and all the visitor saw
  // was the button come back — three times.
  const [batchHalt, setBatchHalt] = useState(null);

  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const contextRef = useRef({});
  // Resolved by `decide`, so a batch of tests parked for approval can wait for the click.
  const approvalRef = useRef(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    stopTimer();
  }, [stopTimer]);

  /** What a take would cost and what is wrong with it. Free, so the panel can call it freely. */
  const loadPlan = useCallback(async ({ spec, cast, token, preflight = false }) => {
    if (!token || !spec?.beats?.length) return null;
    // The film being priced is the film every later click acts on, whether or not Shoot or a
    // test has been pressed yet — dropping a revision needs it.
    contextRef.current = { ...contextRef.current, spec, cast, token, filmId: filmIdFor(spec) };
    setPlanning(true);
    try {
      const next = await getDirectorPlan({ spec, cast, preflight }, token);
      setPlan(next);
      setError(null);
      return next;
    } catch (failure) {
      console.error('[director] plan failed', failure);
      setError(failure.message);
      return null;
    } finally {
      setPlanning(false);
    }
  }, []);

  const loadProduction = useCallback(async ({ token, filmId }) => {
    if (!token || !filmId) return null;
    try {
      const next = await getDirectorProduction(token, filmId);
      setProduction(next);
      return next;
    } catch {
      // A production that has never been opened is a 200 with nothing in it, so a throw here is
      // a transport problem — not worth surfacing over the panel's own empty state.
      return null;
    }
  }, []);

  /** Every production this Mind has, spec-free. Empty is the correct answer for a first visit. */
  const loadFilms = useCallback(async (token) => {
    if (!token) return [];
    try {
      const next = await getDirectorFilms(token);
      setFilms(next.films ?? []);
      return next.films ?? [];
    } catch {
      return [];
    }
  }, []);

  /**
   * Open a production by id alone — the way back in when the tab has no spec.
   *
   * Sets the context as well as the state, because `judge` and `settle` read the film they act on
   * from contextRef rather than from props; a production merely loaded would play but not accept a
   * verdict.
   */
  const openProduction = useCallback(
    async ({ token, filmId }) => {
      if (!token || !filmId) return null;
      contextRef.current = { ...contextRef.current, token, filmId };
      return loadProduction({ token, filmId });
    },
    [loadProduction],
  );

  /**
   * The cheap fallback. Polls the job record until it settles or the clock runs out.
   *
   * ⚠️ NEVER RE-STARTS THE TAKE. A render that has been submitted has been charged for, and the
   * only correct response to "I lost the stream" is to go and look.
   */
  const recover = useCallback(async (jobId, token, remainingMs) => {
    const until = Date.now() + Math.max(0, remainingMs);
    while (Date.now() < until) {
      const status = await getDirectorJobStatus(token, jobId).catch(() => null);
      if (status) {
        setJob((current) => mergeJob(current, status));
        if (status.status === 'complete' || status.status === 'failed') return status;
      }
      await new Promise((done) => setTimeout(done, 5000));
    }
    return null;
  }, []);

  /**
   * Follow a job to its end.
   *
   * ONE WALL-CLOCK DEADLINE FOR THE WHOLE RUN, not per connection. Losing the stream spends the
   * same clock rather than restarting it — the storyboarder learned this the expensive way, where
   * a per-attempt deadline turned a 10-minute ceiling into a 24-minute worst case.
   */
  const follow = useCallback(
    async (jobId, token, params) => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      const latency = LATENCY_SECONDS(params?.resolution ?? '768P', params?.duration ?? 6);
      const deadlineMs = (latency.max + 180) * 1000;
      const startedAt = Date.now();

      stopTimer();
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);

      try {
        await streamDirectorJobEvents(jobId, token, {
          signal: controller.signal,
          deadlineMs,
          onEvent: (type, data) => {
            if (type === 'phase') setPhase(data.phase);
            else if (type === 'heartbeat') {
              setPhase('rendering');
              // The worker's own clock is authoritative — it knows when the task was submitted,
              // and this tab may have joined late.
              if (data.elapsedSeconds) setElapsed((current) => Math.max(current, data.elapsedSeconds));
            } else if (type === 'take') setJob((current) => ({ ...current, take: { ...current?.take, ...data } }));
            else if (type === 'reasoning') setThinking((current) => current + (data.delta ?? ''));
            else if (type === 'reading') setReading(data);
            else if (type === 'finding') setFindings((current) => [...current, data]);
            else if (type === 'revision') setFindings((current) => [...current, { revision: data }]);
            else if (type === 'proposed') setFindings((current) => [...current, { proposed: data }]);
            else if (type === 'reconnect') setPhase('reconnecting');
            else if (type === 'error') setError(data.error);
          },
        });
      } catch (failure) {
        // The stream is gone; the render is not. Ask the record directly rather than assuming.
        console.warn('[director] progress stream dropped, polling the job instead', failure);
        setPhase('reconnecting');
        await recover(jobId, token, deadlineMs - (Date.now() - startedAt));
      } finally {
        stopTimer();
        const status = await getDirectorJobStatus(token, jobId).catch(() => null);
        if (status) setJob((current) => mergeJob(current, status));
        if (status?.status === 'complete' || status?.status === 'failed') setPhase(null);
        // The clock ran out and the record never settled. Say so, rather than leaving
        // "reconnecting" and a frozen timer on screen indefinitely — which is what a visitor
        // saw on 2026-08-31 when staging's queue was not consuming Director jobs at all.
        else if (Date.now() - startedAt >= deadlineMs) {
          console.error('[director] job did not settle within the deadline', { jobId, status: status?.status, step: status?.step });
          setPhase('stalled');
        }
        const { filmId } = contextRef.current;
        if (filmId) await loadProduction({ token, filmId });
      }
    },
    [loadProduction, recover, stopTimer],
  );

  /** Press Shoot. Returns the job, which may be parked awaiting approval — that is `ask` mode
   * working, not failing. */
  const shoot = useCallback(
    async ({ spec, cast, token, override = false }) => {
      setError(null);
      setRefusal(null);
      setBatchHalt(null);
      const filmId = filmIdFor(spec);
      contextRef.current = { spec, cast, token, filmId };

      try {
        const started = await startDirectorTake({ spec, cast, mode, allowanceUsd, override }, token);
        setJob({ jobId: started.jobId, status: started.status, take: { costUsd: started.costUsd } });
        await loadProduction({ token, filmId });

        if (started.status === 'awaiting-approval') return started;
        await follow(started.jobId, token, plan?.params);
        return started;
      } catch (failure) {
        // The gate. The Director asked for tests that are not answered, or has not read the
        // film at all. Not an error in the usual sense — it is the product working — so it is
        // kept apart from `error`, and the panel offers "shoot anyway" beside it.
        if (failure.error === 'untested' || failure.error === 'unread') {
          setRefusal(failure);
          await loadPlan({ spec, cast, token });
          return null;
        }
        console.error('[director] shoot refused', failure);
        setError(failure.detail ?? failure.message);
        return null;
      }
    },
    [allowanceUsd, follow, loadPlan, loadProduction, mode, plan?.params],
  );

  /** Shoot past the Director's outstanding tests. Offered only after a refusal; written on the take. */
  const shootAnyway = useCallback(
    ({ spec, cast, token }) => shoot({ spec, cast, token, override: true }),
    [shoot],
  );

  /**
   * Ask the Director to read the film.
   *
   * Costs nothing, so there is no gate and no approval — but it is still a JOB rather than a
   * direct call, purely so the reasoning streams. Watching it decide how to spend your money is
   * the point; a finished list handed over with no working reads as an upsell.
   */
  const assess = useCallback(
    async ({ spec, cast, token }) => {
      if (!spec?.beats?.length || !token) return null;
      setError(null);
      setRefusal(null);
      setThinking('');
      setFindings([]);
      contextRef.current = { spec, cast, token, filmId: filmIdFor(spec) };
      try {
        const started = await assessFilm({ spec, cast }, token);
        setJob({ jobId: started.jobId, status: started.status, kind: 'plan' });
        await follow(started.jobId, token, { resolution: '768P', duration: 4 });
        await loadPlan({ spec, cast, token });
        return started;
      } catch (failure) {
        console.error('[director] reading failed', failure);
        setError(failure.message);
        return null;
      }
    },
    [follow, loadPlan],
  );

  /**
   * Buy an answer to one named hazard.
   *
   * Identical machinery to `shoot` — same job, same poll, same mirror — because a Screen Test IS
   * a take, differing only in what it is for. Keeping them one path is what makes a test cheap to
   * offer; if testing had its own pipeline it would have its own bugs.
   */
  const runTest = useCallback(
    async ({ spec, cast, token, riskId }) => {
      setError(null);
      setBatchHalt(null);
      const filmId = filmIdFor(spec);
      contextRef.current = { spec, cast, token, filmId };
      try {
        const started = await runScreenTest({ spec, cast, riskId, mode, allowanceUsd }, token);
        setJob({
          jobId: started.jobId,
          status: started.status,
          take: { costUsd: started.costUsd, kind: 'screen-test', question: started.question },
        });
        await loadProduction({ token, filmId });
        if (started.status === 'awaiting-approval') return started;
        // Six seconds, the longer of the two test shapes: a rehearsal takes 190-333s to settle
        // and a deadline sized for a 4s probe would give up on one that is still rendering.
        await follow(started.jobId, token, { resolution: '768P', duration: 6 });
        // The clip moves the gate (a question now has an unjudged answer). Re-read it, so the
        // "run" button does not offer to buy the same answer again.
        await loadPlan({ spec, cast, token });
        return started;
      } catch (failure) {
        console.error('[director] screen test could not start', failure);
        setError(failure.detail ?? failure.message);
        setBatchHalt(haltFrom(failure, { riskId }));
        return null;
      }
    },
    [allowanceUsd, follow, loadPlan, loadProduction, mode],
  );

  /**
   * Run every test the Director asked for, in the order it asked, one after another.
   *
   * ONE AT A TIME, not fired together: in `ask` mode each test parks for approval and the panel
   * holds one job at a time, so the loop waits for the visitor's click (`decide` resolves it) and
   * for the clip to land before starting the next. A declined test stops the batch — the visitor
   * said no, and the rest are still there to run later.
   */
  const runTests = useCallback(
    async ({ spec, cast, token }) => {
      // Only what needs RUNNING. A test that came back unanswered is not re-bought — it is
      // answered, for free, in the viewer.
      const outstanding = plan?.gate?.toRun ?? [];
      if (!outstanding.length || !token) return 0;
      setRefusal(null);
      setBatchHalt(null);
      let done = 0;
      const total = outstanding.length;
      for (const entry of outstanding) {
        const question = entry.question ?? entry.riskId;
        setBatch({ total, done, current: question });
        const started = await runTest({ spec, cast, token, riskId: entry.riskId });
        if (!started) {
          // `runTest` has already recorded WHY (see `batchHalt`); add where in the run it was.
          setBatchHalt((current) => (current ? { ...current, question, done, total } : current));
          break;
        }
        if (started.status === 'awaiting-approval') {
          const approved = await new Promise((resolve) => {
            approvalRef.current = resolve;
          });
          if (!approved) {
            setBatchHalt({
              kind: 'declined',
              error: null,
              detail: `You declined "${question}". ${total - done - 1 > 0 ? `${total - done - 1} more not run — they are still here to run later.` : 'Nothing more was run.'}`,
              question,
              done,
              total,
              at: Date.now(),
            });
            break;
          }
        }
        done += 1;
      }
      // The refreshed gate lands BEFORE the progress line is taken down, so the stale "run"
      // button never flashes in between with a count that is about to change.
      await loadPlan({ spec, cast, token });
      setBatch(null);
      return done;
    },
    [loadPlan, plan?.gate?.toRun, runTest],
  );

  /** Record what the visitor saw. */
  const judge = useCallback(
    async ({ takeId, answer, note }) => {
      const { token, filmId, spec, cast } = contextRef.current;
      if (!token || !filmId) return;
      try {
        // The job id lets the Director read the verdict back (the review step). Sent when this
        // tab still holds it; the server falls back to the id stored on the take otherwise.
        const jobId = job?.take?.takeId === takeId ? job.jobId : undefined;
        const result = await recordScreenTestVerdict({ filmId, takeId, answer, note, jobId }, token);
        setProduction((current) => ({ ...current, takes: result.production.takes }));
        // A verdict moves the gate (worker/director-gate.js). Re-read the plan so the Shoot
        // button and the asked-for list reflect it without a reload — and again as the Director's
        // read-back lands, which takes the queue a few seconds and may change the script.
        if (spec?.beats?.length) await loadPlan({ spec, cast: cast ?? [], token });
        for (const delay of [8000, 20000, 45000]) {
          setTimeout(() => {
            loadProduction({ token, filmId });
            if (spec?.beats?.length) loadPlan({ spec, cast: cast ?? [], token });
          }, delay);
        }
      } catch (failure) {
        console.error('[director] verdict not recorded', failure);
        setError(failure.message);
      }
    },
    [job?.jobId, job?.take?.takeId, loadPlan, loadProduction],
  );

  /**
   * Accept a scope the assistant proposed.
   *
   * Re-plans immediately, because that is the point: `mustHold` reorders the risk register so the
   * hazards the visitor said they care about come first. A brief that changed nothing visible
   * would read as a button that did nothing.
   */
  const acceptBrief = useCallback(
    async ({ brief, spec, cast, token }) => {
      if (!spec?.beats?.length || !token) return null;
      try {
        const saved = await saveDirectorBrief({ filmId: filmIdFor(spec), brief }, token);
        await loadPlan({ spec, cast, token });
        return saved.brief;
      } catch (failure) {
        setError(failure.message);
        return null;
      }
    },
    [loadPlan],
  );

  /** Take one of the Director's amendments off the script, then re-price against what is left. */
  const dropRevision = useCallback(
    async ({ at }) => {
      const { token, filmId, spec, cast } = contextRef.current;
      if (!token || !filmId) return;
      setError(null);
      try {
        await dropDirectorRevision({ filmId, at }, token);
        if (spec?.beats?.length) await loadPlan({ spec, cast: cast ?? [], token });
      } catch (failure) {
        setError(failure.message);
      }
    },
    [loadPlan],
  );

  /** Approve or decline a parked take. */
  const decide = useCallback(
    async (approved) => {
      const { token, cast, filmId, spec } = contextRef.current;
      if (!job?.jobId || !token) return;
      setError(null);
      const params = job?.take?.kind === 'screen-test' ? { resolution: '768P', duration: 6 } : plan?.params;
      const refreshPlan = () => (spec?.beats?.length ? loadPlan({ spec, cast: cast ?? [], token }) : null);
      try {
        const result = await approveDirectorTake({ jobId: job.jobId, approved, cast }, token);
        setJob((current) => ({ ...current, status: result.status }));
        if (approved) {
          await follow(job.jobId, token, params);
          await refreshPlan();
        } else {
          await loadProduction({ token, filmId });
        }
      } catch (failure) {
        console.error('[director] approval failed', failure);
        // 409 `not_awaiting`: the record has already moved on — a stale read put the Approve
        // button back on a job that was approved, or the button was pressed twice. A render
        // that is running is not an error; go and look, and follow it if it is.
        if (failure.error === 'not_awaiting') {
          const status = await getDirectorJobStatus(token, job.jobId).catch(() => null);
          if (status) setJob((current) => mergeJob(current, status));
          if (status?.status === 'queued' || status?.status === 'running') {
            await follow(job.jobId, token, params);
            await refreshPlan();
            return;
          }
        }
        setError(failure.detail ?? failure.message);
      } finally {
        // A batch of tests waiting on this click (see `runTests`) continues or stops here.
        approvalRef.current?.(approved);
        approvalRef.current = null;
      }
    },
    [follow, job?.jobId, job?.take?.kind, loadPlan, loadProduction, plan?.params],
  );

  /**
   * Put a take into the Mind's memory: pinned to IPFS, told about in the Producer conversation.
   * The work is queued, so the production is re-read a couple of times afterwards to pick up
   * the CID and the "remembered" mark as they land.
   */
  const remember = useCallback(
    async ({ takeId }) => {
      const { token, filmId } = contextRef.current;
      if (!token || !filmId || !takeId) return null;
      setError(null);
      try {
        const result = await rememberDirectorTake({ filmId, takeId }, token);
        for (const delay of [6000, 15000, 30000]) {
          setTimeout(() => loadProduction({ token, filmId }), delay);
        }
        return result;
      } catch (failure) {
        setError(failure.message);
        return null;
      }
    },
    [loadProduction],
  );

  const settle = useCallback(
    async ({ token, filmId, reason = 'delivered' }) => {
      try {
        const result = await closeDirectorProduction({ filmId, reason }, token);
        setProduction((current) => ({ ...current, envelope: result.envelope }));
      } catch (failure) {
        setError(failure.message);
      }
    },
    [],
  );

  // A stalled job is not "running" as far as the buttons are concerned: the visitor may read
  // or shoot again, and the server's own idempotency guards a job that later wakes up.
  const running = (job?.status === 'queued' || job?.status === 'running') && phase !== 'stalled';

  return {
    plan,
    planning,
    production,
    takes: production?.takes ?? [],
    envelope: production?.envelope ?? null,
    job,
    phase,
    phaseLabel: phase ? PHASE_LABEL[phase] ?? null : null,
    elapsedSeconds,
    error,
    running,
    awaitingApproval: job?.status === 'awaiting-approval',
    mode,
    setMode,
    allowanceUsd,
    setAllowance,
    loadPlan,
    loadProduction,
    films,
    loadFilms,
    openProduction,
    shoot,
    shootAnyway,
    refusal,
    runTests,
    batch,
    // Why the last run stopped short, if it did — shown by the panel in place of the run button.
    batchHalt,
    // Whether the film may be shot: read, and every asked test answered (worker/director-gate.js).
    gate: plan?.gate ?? null,
    assess,
    thinking,
    reading,
    findings,
    shootingPlan: plan?.shootingPlan ?? null,
    revisions: plan?.revisions ?? [],
    acceptBrief,
    dropRevision,
    brief: plan?.brief ?? null,
    runTest,
    judge,
    remember,
    decide,
    settle,
    // Split by what they are for, because the timeline shows them in different places: a Screen
    // Test is evidence, a take is the film.
    screenTests: (production?.takes ?? []).filter((take) => take.kind === 'screen-test'),
    finalTakes: (production?.takes ?? []).filter((take) => take.kind !== 'screen-test'),
  };
}
