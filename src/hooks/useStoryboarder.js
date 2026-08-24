import { useCallback, useRef, useState } from 'react';
import {
  storyboard,
  sketchStoryboardFrame,
  getStoryboard,
  getStoryboardPlan,
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
  // tag -> the cast member's real name, from the worker. "<Subject 1>" is machinery, not language.
  const [subjectNames, setSubjectNames] = useState({});
  // Seconds the current model call has been in flight, straight from the worker's own heartbeat
  // rather than a client-side timer — so it reports the real call, not the time since the button
  // was clicked.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // frameId -> true while that one frame is busy, so only its own card busies out.
  const [sketching, setSketching] = useState({});
  const [regenerating, setRegenerating] = useState({});
  const abortRef = useRef(null);
  // The spec/cast a later action needs to reuse — the expensive-to-reassemble half
  // (references, staging) doesn't change when one frame's prompt does.
  const contextRef = useRef(null);

  /** The tier decision, fetched before generating so the visitor sees cost, time and any cap in
   * advance. Never blocks the run — a plan that fails to load is a worse experience, not a
   * broken one. */
  const loadPlan = useCallback(async ({ token, beatCount }) => {
    try {
      const result = await getStoryboardPlan(token, beatCount);
      setPlan(result);
      return result;
    } catch {
      return null;
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
    setElapsedSeconds(0);
    setPhase('planning');

    try {
      const result = await storyboard(
        { spec, cast },
        token,
        {
          signal: controller.signal,
          onEvent: (type, data) => {
            // `plan` can arrive twice: once up front, and again if the paid model turns out to
            // be unavailable and the run falls back to free. The second one carries the reason.
            if (type === 'plan') setPlan(data);
            if (type === 'phase') setPhase(data.phase);
            if (type === 'heartbeat') setElapsedSeconds(data.elapsedSeconds ?? 0);
            if (type === 'frame' && !data.error) {
              setFrames((current) => [...current, data]);
            }
          },
        },
      );
      setFrames(result.frames ?? []);
      if (result.subjectNames) setSubjectNames(result.subjectNames);
      if (result.plan) setPlan(result.plan);
      if (result.spend) setSpend(result.spend);
      if (result.error) setError(result.error);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure.message);
    } finally {
      setRunning(false);
      setPhase(null);
    }
  }, []);

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
      const result = await overrideStoryboardBeat({ frameId }, context.token);
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

  /** Resume a storyboard already generated in an earlier session, on mount. */
  const hydrate = useCallback(async ({ spec, cast, token }) => {
    contextRef.current = { spec, cast, token };
    try {
      const result = await getStoryboard(token);
      if (result?.frames?.length) setFrames(result.frames);
      if (result?.subjectNames) setSubjectNames(result.subjectNames);
      if (result?.spend) setSpend(result.spend);
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
    sketching,
    regenerating,
    run,
    loadPlan,
    regenerateBeat,
    overrideBeat,
    generateSketch,
    hydrate,
  };
};
