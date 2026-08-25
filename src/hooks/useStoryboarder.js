import { useCallback, useRef, useState } from 'react';
import { subjectAssetsFrom } from '../../worker/scene.js';
import { filmIdFor } from '../../worker/film-id';
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
  // The model thinking out loud, and the provisional geometry it has talked itself into. Both are
  // live-only: they are the WAIT made watchable, and they are replaced wholesale by the real
  // frames the moment those arrive. Nothing here is ever stored or treated as an answer.
  const [reasoning, setReasoning] = useState('');
  // The same stream, split by which beat the model was discussing when it said it — so the
  // thinking appears over the frame it is about.
  const [reasoningByBeat, setReasoningByBeat] = useState({});
  const [ghostBeats, setGhostBeats] = useState([]);
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
    setGhostBeats([]);
    setBeatTexts(spec?.beats ?? []);
    // THE CAST IS KNOWN BEFORE ANY OF THIS RUNS. It is per cast member, not per beat, so the
    // ghost frames can open with the real pieces already standing on the grid — only their
    // POSITIONS are provisional. The Worker sends the identical map back with the result; this is
    // the same join, run early, so the wait shows the visitor's own cast rather than capsules.
    setSubjectAssets(subjectAssetsFrom(spec ?? {}, new Map((cast ?? []).map((c) => [c.key, c]))));
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
            if (type === 'plan') {
              planRef.current = data;
              setPlan(data);
              // The tier's beat cap is applied at the open, so the card count matches what will
              // actually be generated rather than what was asked for.
              if (data?.maxBeats) setBeatTexts((current) => current.slice(0, data.maxBeats));
            }
            if (type === 'phase') setPhase(data.phase);
            if (type === 'heartbeat') setElapsedSeconds(data.elapsedSeconds ?? 0);
            // Appended rather than replaced: the delta is a fragment of a sentence, and the UI
            // shows the live tail of the whole trace.
            if (type === 'reasoning') {
              setReasoning((current) => current + data.delta);
              setReasoningByBeat((current) => {
                const index = data.beatIndex ?? 0;
                return { ...current, [index]: (current[index] ?? '') + data.delta };
              });
            }
            // Replaced wholesale, because the parser re-reads the entire trace each time — that
            // is how the model changing its mind becomes a correction on screen rather than a
            // second contradictory ghost beside the first.
            if (type === 'ghost') setGhostBeats(data.beats ?? []);
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
        setPhase('finalising');
        // Whatever the tier said the whole call would take, from now — generous on purpose, since
        // the alternative to waiting is throwing away a film that is already paid for in time.
        const budgetMs = Math.max(60_000, (planRef.current?.estimateSeconds ?? 480) * 1000);
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
        // Deliberately does not say whether anything was charged. The free tier costs nothing and
        // the paid tier records spend before the frames are built, so a blanket reassurance would
        // be false half the time — and the spend panel already reports the truth either way.
        setError(
          `The connection to the Storyboarder dropped, and no saved film appeared within ${Math.round(budgetMs / 60_000)} minutes (${failure.message}). Generating again is safe — it lands on the same film.`,
        );
        return;
      }

      setError(failure.message);
    } finally {
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
    ghostBeats,
    beatTexts,
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
