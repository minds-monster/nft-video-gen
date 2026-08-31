import { useCallback, useRef, useState } from 'react';
import { subjectAssetsFrom } from '../../worker/scene.js';
import { filmIdFor } from '../../worker/film-id';
import { LATENCY_SECONDS } from '../../worker/tier.js';
import {
  storyboard,
  sketchStoryboardFrame,
  getStoryboard,
  getStoryboardPlan,
  getStoryboardFilms,
  regenerateStoryboardBeat,
  overrideStoryboardBeat,
} from '../services/swarm';

// Mirrors useScreenwriter.js's shape (stage-as-one-value, streamed phases, a ref for the
// context a later action needs) rather than inventing a different pattern for the same
// kind of streaming agent run.
//
// ROUND 8: the run is now ONE whole-film call rather than a chain of per-beat calls, which is
// what fixed "every beat comes back MWS" (round 7 measured 2.4 distinct shot sizes per film on
// the old chain against 3.9 on this one). The consequence the UI has to carry is that nothing
// arrives for three to five minutes, where the old version dribbled frames in as it went.
//
// So `stage` and `heartbeat` are not decoration — they are the whole wait surface. A silent SSE
// stream is indistinguishable from a dead one, to a browser and to a person, and the wait is
// where visitors bail.

/** Coarse and honest beats precise and silent. These are the four stages the worker actually
 * emits, in order, with what each one means to somebody who does not know what a scene graph is. */
export const STAGE_LABEL = {
  planning: 'Reading the scene',
  drafting: 'Blocking the shots',
  validating: 'Checking the geometry',
  finalising: 'Finishing up',
  // A FIFTH STAGE, and it is not a worker phase — it is this client admitting it lost the
  // progress stream. It used to report itself as `finalising`, which is a claim about what
  // the WORKER is doing made by a client that has just stopped being able to see the worker.
  // A visitor watching 'Finishing up' for twelve minutes is being told something false; the
  // work really is still running server-side, and that is what this says instead.
  reconnecting: 'Reconnecting — the work is still running',
};

/** Drives the Storyboarder's whole-film pass, each frame's failure surface, and each frame's
 * opt-in sketch generation. */
export const useStoryboarder = () => {
  const [frames, setFrames] = useState([]);
  const [phase, setPhase] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [spend, setSpend] = useState(null);
  const [plan, setPlan] = useState(null);
  // The tier's own time estimate, mirrored where a run in flight can read it. A ref rather than
  // `plan` itself so `run` does not rebuild every time the badge updates — and written only at
  // the two points that establish the estimate, not on every plan change.
  const planRef = useRef(null);
  // tag -> the cast member's real name, from the worker. "<Subject 1>" is machinery, not language.
  const [subjectNames, setSubjectNames] = useState({});
  // tag -> { assetKey, name, profile, medium }. What each subject IS, so the renderer can draw
  // the piece rather than a capsule — and so a beat can name the artwork it derives from. Stored
  // on the record, which is what makes it survive a reload with no cast in hand.
  const [subjectAssets, setSubjectAssets] = useState({});
  // The visitor's other films, so earlier work is reachable rather than merely stored.
  const [films, setFilms] = useState([]);
  // The model thinking out loud. Live-only: it is the WAIT made watchable, and it is replaced by
  // the real frames the moment those arrive. Nothing here is ever stored or treated as an answer.
  const [reasoning, setReasoning] = useState('');
  // The same stream, split by which beat the model was discussing when it said it — so the
  // thinking appears over the frame it is about.
  //
  // ⚠ IN PRACTICE THIS IS EMPTY, and it is worth knowing why before building anything on it.
  // The provider bounces `stream: true` with a 502 inside a second (measured 2026-08-26, both
  // attempts), so worker/storyboarder.js falls back to the non-streamed call and no reasoning
  // ever arrives. Kept because the fallback is provider-side and could stop happening; not
  // relied on, because for now a wait built on it is a wait built on nothing.
  const [reasoningByBeat, setReasoningByBeat] = useState({});
  // beatIndex -> { framing, principalSubject, motion, intent }. The shot the plan pass decided,
  // which lands ~15s into a run — long before any geometry does.
  //
  // THIS IS THE WAIT SURFACE NOW. Every value in it is a real decision the model made about
  // this specific beat, not a placeholder and not an animation: beat 1 is an EWS on the ape,
  // beat 3 is a CU. Three cards say three different true things while the geometry is still
  // being drawn. Nothing here is ever synthesised to fill time — a card with no plan yet shows
  // no plan, because a visitor who is told something invented has been given a worse deal than
  // a visitor who is told nothing.
  const [beatPlans, setBeatPlans] = useState({});
  // How many times the progress stream has had to be re-established.
  //
  // `streamStoryboardJobEvents` has always emitted these and nothing has ever rendered them,
  // which meant the one signal that distinguishes 'the model is slow' from 'we keep losing the
  // connection' was thrown away at the point it was produced. A visitor staring at a stalled
  // panel deserves to know which of those is happening, and so do we.
  const [reconnects, setReconnects] = useState(0);
  // beatIndex -> 'drawing' | 'drawn' | 'failed'. The beats are generated in parallel and land
  // at different times, so each card reports its own progress rather than sharing one spinner.
  const [beatStatus, setBeatStatus] = useState({});
  // A short rolling log of events from the worker, for debugging "is it still alive?".
  const [events, setEvents] = useState([]);
  // The beats being worked on, known the instant the run starts. The film gets its shape — one
  // card per beat — before it has any content, so the wait is spent watching those fill in rather
  // than watching an empty panel.
  const [beatTexts, setBeatTexts] = useState([]);
  // Seconds the current model call has been in flight, straight from the worker's own heartbeat
  // rather than a client-side timer — so it reports the real call, not the time since the button
  // was clicked.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // frameId -> true while that one frame is busy, so only its own card busies out.
  const [sketching, setSketching] = useState({});
  const [regenerating, setRegenerating] = useState({});
  const abortRef = useRef(null);
  // A client-side timer so elapsed seconds keep climbing even if the SSE stream is quiet.
  const timerRef = useRef(null);
  // The spec/cast a later action needs to reuse — the expensive-to-reassemble half
  // (references, staging) doesn't change when one frame's prompt does.
  const contextRef = useRef(null);

  /** The tier decision, fetched before generating so the visitor sees cost, time and any cap in
   * advance. Never blocks the run — a plan that fails to load is a worse experience, not a
   * broken one. */
  const loadPlan = useCallback(async ({ token, beatCount }) => {
    try {
      const result = await getStoryboardPlan(token, beatCount);
      planRef.current = result;
      setPlan(result);
      return result;
    } catch {
      return null;
    }
  }, []);

  /**
   * Go and get the storyboard whose stream was cut.
   *
   * NEVER a re-run, and the asymmetry with the Casting Director's one-line retry is the point: a
   * storyboard is a single three-to-eight-minute model call, so re-running it on a transport
   * failure would spend the whole wait again to reproduce something the Worker has very probably
   * already finished. It has, in the ordinary case. `handleStoryboard` persists before it emits
   * anything at all ("SAVE FIRST, THEN TELL THE BROWSER", worker/storyboarder.js) and runs under
   * `ctx.waitUntil`, so a client that hangs up cannot stop the record being written.
   *
   * So the cure is a cheap GET, repeated while the run finishes. `filmIdFor(spec)` is a hash of
   * the film's own text and is computed identically on both sides, so the caller needs no id it
   * was not already able to derive.
   */
  const recoverAfterCut = useCallback(async ({ spec, token, deadlineMs }) => {
    const filmId = filmIdFor(spec);
    const until = Date.now() + deadlineMs;
    for (;;) {
      try {
        const saved = await getStoryboard(token, filmId);
        if (saved?.frames?.length) return saved;
      } catch {
        // Not reachable yet, or nothing saved under this film id — both are "not finished", and
        // both are answered by waiting rather than by failing.
      }
      if (Date.now() >= until) return null;
      await new Promise((done) => setTimeout(done, 5000));
    }
  }, []);

  const run = useCallback(async ({ spec, cast, token }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    contextRef.current = { spec, cast, token };

    setRunning(true);
    setError(null);
    setFrames([]);
    setReasoning('');
    setReasoningByBeat({});
    setReconnects(0);
    setBeatPlans({});
    setBeatStatus({});
    setEvents([]);
    setBeatTexts(spec?.beats ?? []);
    // THE CAST IS KNOWN BEFORE ANY OF THIS RUNS. The Worker sends the identical map back with the
    // result; this is the same join, run early, so the wait shows the visitor's own cast rather
    // than capsules.
    setSubjectAssets(subjectAssetsFrom(spec ?? {}, new Map((cast ?? []).map((c) => [c.key, c]))));
    setElapsedSeconds(0);
    setPhase('planning');

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    // ONE DEADLINE FOR THE WHOLE RUN, and the reason is a visitor who sat at 18 minutes.
    //
    // These used to be two independent budgets that STACKED: the progress stream got
    // (max + 120)s, and when it expired the recovery poll started a fresh (max + 120)s of its
    // own. On the free tier that is 12 minutes, then 12 more — a 24-minute worst case before
    // the visitor was told anything at all, for a generation whose own ceiling is well under
    // half of that. Nobody chose 24 minutes; it was the sum of two numbers that were each
    // defensible alone.
    //
    // So the budget is established once, here, as a wall-clock instant. Losing the stream
    // spends the SAME clock rather than restarting it, which is what makes the number the
    // visitor is quoted the number they actually wait.
    const tier = planRef.current?.tier ?? 'free';
    const tierMaxSeconds = LATENCY_SECONDS[tier]?.max ?? LATENCY_SECONDS.free.max;
    const runBudgetMs = (tierMaxSeconds + 120) * 1000;
    const deadlineAt = Date.now() + runBudgetMs;
    const timeLeft = () => Math.max(0, deadlineAt - Date.now());

    try {
      const deadlineMs = timeLeft();

      const result = await storyboard(
        { spec, cast },
        token,
        {
          signal: controller.signal,
          deadlineMs,
          onEvent: (type, data) => {
            // Keep a rolling debug log so the UI can show what the worker is doing.
            setEvents((current) => [...current.slice(-19), { type, data, at: Date.now() }]);
            // `plan` can arrive twice: once up front, and again if the paid model turns out to
            // be unavailable and the run falls back to free. The second one carries the reason.
            if (type === 'plan') {
              planRef.current = data;
              setPlan(data);
              // The tier's beat cap is applied at the open, so the card count matches what will
              // actually be generated rather than what was asked for.
              if (data?.maxBeats) setBeatTexts((current) => current.slice(0, data.maxBeats));
            }
            if (type === 'phase') setPhase(data.phase);
            if (type === 'reconnect') setReconnects((n) => n + 1);
            // The heartbeat is a cross-check against the client-side timer; if it carries a larger
            // elapsed value, trust it (the worker knows when the phase actually started).
            if (type === 'heartbeat') setElapsedSeconds((s) => Math.max(s, data.elapsedSeconds ?? 0));
            // Appended rather than replaced: the delta is a fragment of a sentence, and the UI
            // shows the live tail of the whole trace.
            if (type === 'reasoning') {
              setReasoning((current) => current + data.delta);
              setReasoningByBeat((current) => {
                const index = data.beatIndex ?? 0;
                return { ...current, [index]: (current[index] ?? '') + data.delta };
              });
            }
            // The shot list, one beat at a time, as the plan pass decides it.
            if (type === 'beat-plan' && Number.isInteger(data.beatIndex)) {
              setBeatPlans((current) => ({ ...current, [data.beatIndex]: data }));
              setBeatStatus((current) => ({ ...current, [data.beatIndex]: 'drawing' }));
            }
            // One beat's geometry finished. The beats run concurrently, so these arrive out of
            // order and that is the point — the timeline fills in piecemeal instead of all at once.
            if (type === 'beat-drawn' && Number.isInteger(data.beatIndex)) {
              setBeatStatus((current) => ({
                ...current,
                [data.beatIndex]: data.failed ? 'failed' : 'drawn',
              }));
            }
            if (type === 'frame' && !data.error) {
              setFrames((current) => [...current, data]);
            }
          },
        },
      );
      setFrames(result.frames ?? []);
      if (result.subjectNames) setSubjectNames(result.subjectNames);
      if (result.subjectAssets) setSubjectAssets(result.subjectAssets);
      if (result.plan) setPlan(result.plan);
      if (result.spend) setSpend(result.spend);
      if (result.error) setError(result.error);
    } catch (failure) {
      if (controller.signal.aborted) return;

      // A CUT STREAM IS NOT A LOST FILM. The run keeps going server-side and saves itself; all
      // that broke is the wire. Reported to the visitor as still working, because it is.
      if (failure.truncated) {
        // Not 'finalising'. We do not know that the worker is finalising — we know we cannot
        // see it. Say that.
        setPhase('reconnecting');
        const budgetMs = timeLeft();
        if (budgetMs <= 0) {
          setError(
            `The Storyboarder did not finish within ${Math.round(runBudgetMs / 60_000)} minutes ` +
            `(${failure.message}). The run may still be finishing server-side — generating again ` +
            'is safe, and lands on the same film.',
          );
          return;
        }
        const saved = await recoverAfterCut({ spec, token, deadlineMs: budgetMs });
        if (controller.signal.aborted) return;
        if (saved) {
          setFrames(saved.frames);
          if (saved.subjectNames) setSubjectNames(saved.subjectNames);
          if (saved.subjectAssets) setSubjectAssets(saved.subjectAssets);
          if (saved.spend) setSpend(saved.spend);
          setError(null);
          return;
        }
        // Deliberately does not say whether anything was charged. Zero Budget costs nothing and
        // the paid tier records spend before the frames are built, so a blanket reassurance would
        // be false half the time — and the spend panel already reports the truth either way.
        setError(
          `The connection to the Storyboarder dropped, and no saved film appeared within the ` +
          `${Math.round(runBudgetMs / 60_000)}-minute budget for this run (${failure.message}). ` +
          'Generating again is safe — it lands on the same film.',
        );
        return;
      }

      setError(failure.message);
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRunning(false);
      setPhase(null);
    }
  }, [recoverAfterCut]);

  /** The visitor's explicit second attempt at a beat that failed validation. Three attempts and
   * the beat is dropped — the film keeps its integrity by losing a beat rather than hiding one. */
  const regenerateBeat = useCallback(async (frameId) => {
    const context = contextRef.current;
    if (!context) return;
    setRegenerating((current) => ({ ...current, [frameId]: true }));
    setError(null);
    try {
      const result = await regenerateStoryboardBeat(
        { frameId, spec: context.spec, cast: context.cast },
        context.token,
      );
      setFrames((current) => current.map((f) => (f.frameId === frameId ? result.frame : f)));
      if (result.spend) setSpend(result.spend);
      if (result.plan) setPlan(result.plan);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setRegenerating((current) => ({ ...current, [frameId]: false }));
    }
  }, []);

  /** "I want this beat anyway." */
  const overrideBeat = useCallback(async (frameId) => {
    const context = contextRef.current;
    if (!context) return;
    try {
      const result = await overrideStoryboardBeat({ frameId, filmId: filmIdFor(context.spec) }, context.token);
      setFrames((current) => current.map((f) => (f.frameId === frameId ? result.frame : f)));
    } catch (failure) {
      setError(failure.message);
    }
  }, []);

  const generateSketch = useCallback(async (frameId, promptText) => {
    const context = contextRef.current;
    if (!context) return;
    setSketching((current) => ({ ...current, [frameId]: true }));
    setError(null);
    try {
      const result = await sketchStoryboardFrame(
        { frameId, promptText, spec: context.spec, cast: context.cast },
        context.token,
      );
      setFrames((current) => current.map((f) => (f.frameId === frameId ? result.frame : f)));
      setSpend(result.spend ?? null);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSketching((current) => ({ ...current, [frameId]: false }));
    }
  }, []);

  /** The visitor's other films. Cheap, needs no spec, and is what keeps earlier work reachable
   * now that a storyboard is only loaded for the film the tab is actually about. */
  const loadFilms = useCallback(async (token) => {
    try {
      const result = await getStoryboardFilms(token);
      setFilms(result.films ?? []);
      if (result.spend) setSpend(result.spend);
    } catch {
      // A visitor with no films yet, or an unreachable worker. The empty state is correct either way.
    }
  }, []);

  /** Open a past film from the index, by id rather than by spec — the visitor picking one from a
   * list has no spec in hand, which is the whole situation this exists for. */
  const openFilm = useCallback(async (token, filmId) => {
    try {
      const result = await getStoryboard(token, filmId);
      setFrames(result.frames ?? []);
      setSubjectNames(result.subjectNames ?? {});
      setSubjectAssets(result.subjectAssets ?? {});
      if (result.films) setFilms(result.films);
      if (result.spend) setSpend(result.spend);
      if (result.tier) setPlan({ tier: result.tier, model: result.model, label: result.tierLabel });
    } catch (failure) {
      setError(failure.message);
    }
  }, []);

  /**
   * Resume THIS film's storyboard, on mount.
   *
   * Scoped to the spec's own film id, and a no-op without a spec. Hydrating on the session token
   * alone is what put one film's storyboard into a tab working on another: connect a Mind, and
   * whatever that Mind last produced appeared, regardless of what this tab was about.
   */
  const hydrate = useCallback(async ({ spec, cast, token }) => {
    contextRef.current = { spec, cast, token };
    if (!spec) return;
    try {
      const result = await getStoryboard(token, filmIdFor(spec));
      if (result?.frames?.length) setFrames(result.frames);
      if (result?.subjectNames) setSubjectNames(result.subjectNames);
      if (result?.subjectAssets) setSubjectAssets(result.subjectAssets);
      if (result?.spend) setSpend(result.spend);
      // Enough of a plan to keep the tier badge honest on a reload — which tier and which model
      // actually made these frames. A fresh plan (with cost and time estimates) replaces it as
      // soon as there is a spec to price.
      if (result?.films) setFilms(result.films);
      if (result?.tier) {
        setPlan((current) => current ?? { tier: result.tier, model: result.model, label: result.tierLabel });
      }
    } catch {
      // No prior storyboard for this Mind yet, or not reachable — a normal first visit.
    }
    if (spec?.beats?.length) loadPlan({ token, beatCount: spec.beats.length });
  }, [loadPlan]);

  return {
    frames,
    phase,
    stageLabel: phase ? STAGE_LABEL[phase] ?? null : null,
    elapsedSeconds,
    running,
    error,
    spend,
    plan,
    subjectNames,
    subjectAssets,
    films,
    reasoning,
    reasoningByBeat,
    beatPlans,
    beatStatus,
    reconnects,
    beatTexts,
    events,
    sketching,
    regenerating,
    run,
    loadPlan,
    loadFilms,
    openFilm,
    regenerateBeat,
    overrideBeat,
    generateSketch,
    hydrate,
  };
};
