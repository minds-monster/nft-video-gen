import { useCallback, useEffect, useRef, useState } from 'react';

import {
  approveDirectorTake,
  closeDirectorProduction,
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
};

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
    setPlanning(true);
    try {
      const next = await getDirectorPlan({ spec, cast, preflight }, token);
      setPlan(next);
      setError(null);
      return next;
    } catch (failure) {
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
        setJob(status);
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
      } catch {
        // The stream is gone; the render is not. Ask the record directly rather than assuming.
        setPhase('reconnecting');
        await recover(jobId, token, deadlineMs - (Date.now() - startedAt));
      } finally {
        stopTimer();
        const status = await getDirectorJobStatus(token, jobId).catch(() => null);
        if (status) setJob(status);
        if (status?.status === 'complete' || status?.status === 'failed') setPhase(null);
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
        return started;
      } catch (failure) {
        setError(failure.detail ?? failure.message);
        return null;
      }
    },
    [allowanceUsd, follow, loadProduction, mode],
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
      const outstanding = plan?.gate?.outstanding ?? [];
      if (!outstanding.length || !token) return 0;
      setRefusal(null);
      let done = 0;
      for (const entry of outstanding) {
        setBatch({ total: outstanding.length, done, current: entry.question ?? entry.riskId });
        const started = await runTest({ spec, cast, token, riskId: entry.riskId });
        if (!started) break;
        if (started.status === 'awaiting-approval') {
          const approved = await new Promise((resolve) => {
            approvalRef.current = resolve;
          });
          if (!approved) break;
        }
        done += 1;
      }
      setBatch(null);
      await loadPlan({ spec, cast, token });
      return done;
    },
    [loadPlan, plan?.gate?.outstanding, runTest],
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
        // button and the asked-for list reflect it without a reload.
        if (spec?.beats?.length) await loadPlan({ spec, cast: cast ?? [], token });
      } catch (failure) {
        setError(failure.message);
      }
    },
    [job?.jobId, job?.take?.takeId, loadPlan],
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

  /** Approve or decline a parked take. */
  const decide = useCallback(
    async (approved) => {
      const { token, cast, filmId } = contextRef.current;
      if (!job?.jobId || !token) return;
      setError(null);
      try {
        const result = await approveDirectorTake({ jobId: job.jobId, approved, cast }, token);
        setJob((current) => ({ ...current, status: result.status }));
        if (approved) await follow(job.jobId, token, job?.take?.kind === 'screen-test' ? { resolution: '768P', duration: 6 } : plan?.params);
        else await loadProduction({ token, filmId });
      } catch (failure) {
        setError(failure.message);
      } finally {
        // A batch of tests waiting on this click (see `runTests`) continues or stops here.
        approvalRef.current?.(approved);
        approvalRef.current = null;
      }
    },
    [follow, job?.jobId, job?.take?.kind, loadProduction, plan?.params],
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

  const running = job?.status === 'queued' || job?.status === 'running';

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
    // Whether the film may be shot: read, and every asked test answered (worker/director-gate.js).
    gate: plan?.gate ?? null,
    assess,
    thinking,
    reading,
    findings,
    shootingPlan: plan?.shootingPlan ?? null,
    revisions: plan?.revisions ?? [],
    acceptBrief,
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
