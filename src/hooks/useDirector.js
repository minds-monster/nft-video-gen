import { useCallback, useEffect, useRef, useState } from 'react';

import {
  approveDirectorTake,
  closeDirectorProduction,
  getDirectorJobStatus,
  getDirectorPlan,
  getDirectorProduction,
  assessFilm,
  runScreenTest,
  recordScreenTestVerdict,
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

  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const contextRef = useRef({});

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
    async ({ spec, cast, token }) => {
      setError(null);
      const filmId = filmIdFor(spec);
      contextRef.current = { spec, cast, token, filmId };

      try {
        const started = await startDirectorTake({ spec, cast, mode, allowanceUsd }, token);
        setJob({ jobId: started.jobId, status: started.status, take: { costUsd: started.costUsd } });
        await loadProduction({ token, filmId });

        if (started.status === 'awaiting-approval') return started;
        await follow(started.jobId, token, plan?.params);
        return started;
      } catch (failure) {
        setError(failure.detail ?? failure.message);
        return null;
      }
    },
    [allowanceUsd, follow, loadProduction, mode, plan?.params],
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
        await follow(started.jobId, token, { resolution: '768P', duration: 4 });
        return started;
      } catch (failure) {
        setError(failure.detail ?? failure.message);
        return null;
      }
    },
    [allowanceUsd, follow, loadProduction, mode],
  );

  /** Record what the visitor saw. */
  const judge = useCallback(
    async ({ takeId, answer, note }) => {
      const { token, filmId } = contextRef.current;
      if (!token || !filmId) return;
      try {
        const result = await recordScreenTestVerdict({ filmId, takeId, answer, note }, token);
        setProduction((current) => ({ ...current, takes: result.production.takes }));
      } catch (failure) {
        setError(failure.message);
      }
    },
    [],
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
        if (approved) await follow(job.jobId, token, plan?.params);
        else await loadProduction({ token, filmId });
      } catch (failure) {
        setError(failure.message);
      }
    },
    [follow, job?.jobId, loadProduction, plan?.params],
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
    shoot,
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
    decide,
    settle,
    // Split by what they are for, because the timeline shows them in different places: a Screen
    // Test is evidence, a take is the film.
    screenTests: (production?.takes ?? []).filter((take) => take.kind === 'screen-test'),
    finalTakes: (production?.takes ?? []).filter((take) => take.kind !== 'screen-test'),
  };
}
