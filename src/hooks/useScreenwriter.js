import { useCallback, useEffect, useRef, useState } from 'react';
import { castPiece, forCastingWire, screenwrite } from '../services/swarm';
import { resolveNftName } from '../lib/nftMedia';

// Where the canvas is in the pipeline. Kept as one value rather than a set of booleans so
// an impossible state (writing AND showing a treatment) can't be represented.
export const STAGE = {
  COMPOSE: 'compose',
  WRITING: 'writing',
  TREATMENT: 'treatment',
};

// How many pieces are cast at once. The NVIDIA free tier is rate-limited at roughly 40
// requests/min account-wide, and a seven-card cold cast fired in one burst is the exact
// shape that trips it. Two at a time keeps a full cast inside the budget while still
// finishing far faster than a serial walk — and the Worker retries a 429 underneath anyway.
const CASTING_LANES = 2;

/** Slot key for the Screenwriter's own stream, alongside the per-piece ones. */
export const SCREENWRITER = 'screenwriter';

/** Only the fields worker/screenwriter.js actually reads. */
const forWire = ({ key, dossier, name, collectionName }) => ({ key, dossier, name, collectionName });

/** Run `work` over `items` with a fixed number of lanes, in completion order. */
const pooled = async (items, lanes, work) => {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.min(lanes, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await work(next[1], next[0]);
    }
  });
  await Promise.all(runners);
};

/**
 * Seconds since the current run began, or null when nothing is running.
 *
 * Measured, not guessed: a cold dossier takes 8-32s and a five-piece cast runs 50-80s end to
 * end. ChatThread's ElapsedNotice already established the house answer to a wait that long —
 * "silent bouncing dots for two minutes reads as broken, so we count the wait out loud."
 */
const useElapsed = (running) => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) return undefined;
    setSeconds(0);
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  return running ? seconds : null;
};

/**
 * Drives the Casting Director → Screenwriter run for one cast.
 *
 * Deliberately separate from useCanvasComposer, which owns the cast and the prompt and says
 * outright that it owns no submit behaviour. This is that missing half: it takes the
 * `{ prompt, primary, cast }` the canvas already hands to `onLaunch` and does something
 * with it.
 */
export const useScreenwriter = () => {
  const [stage, setStage] = useState(STAGE.COMPOSE);
  // key -> { status: 'queued'|'watching'|'done'|'failed', dossier?, cached?, error? }
  const [analysis, setAnalysis] = useState({});
  const [spec, setSpec] = useState(null);
  const [error, setError] = useState(null);
  // True while a rewrite is in flight. Distinct from `stage` on purpose: the treatment stays
  // on screen and merely goes busy, because blanking a draft the user is reading in order to
  // show a spinner is a worse experience than waiting with it visible.
  const [rewriting, setRewriting] = useState(false);
  // What each agent is saying right now, keyed by what it is working on: a cast entry's key
  // while the Casting Director reads it, or SCREENWRITER while the script is written.
  //
  // Keyed rather than a single slot because the text is rendered in place — inside the row
  // for the piece being read — so three lanes streaming at once is three rows filling in,
  // not three voices fighting over one console.
  const [streams, setStreams] = useState({});
  // Completed agent thoughts, preserved after a stream settles so the user can scroll back
  // and re-read every step of reasoning. Same owner keys as `streams`.
  const [thoughts, setThoughts] = useState({});
  const abortRef = useRef(null);
  // The last cast the Screenwriter was given, so a rewrite can reuse it without re-running
  // the Casting Director. The dossiers are already paid for and cached; re-reading them would turn a
  // ~20s rewrite into an ~80s one.
  //
  // Held twice on purpose: the ref is what `rewrite` reads (it must see the latest value
  // without being re-created and without a stale closure), and the state is what the
  // treatment renders from, since a ref mutation would not re-render on its own.
  const castRef = useRef(null);
  const [writtenCast, setWrittenCast] = useState(null);
  const request = useRef(null);

  const elapsed = useElapsed(stage === STAGE.WRITING || rewriting);

  /** Route one agent's stream into its own slot, so lanes never overwrite each other. */
  const feed = useCallback(
    (owner) => (type, data) => {
      if (type === 'phase') {
        setStreams((current) => {
          const slot = current[owner];
          return {
            ...current,
            [owner]: {
              phase: data.phase,
              // Keep the reasoning the user has already watched; only clear it when the
              // piece actually settles. Otherwise the formalising/watching phases look empty
              // and the live card appears to obfuscate what just happened.
              reasoning: slot?.reasoning ?? '',
              content: slot?.content ?? '',
            },
          };
        });
        return;
      }
      if (type !== 'delta') return;
      setStreams((current) => {
        const slot = current[owner];
        if (!slot) return current;
        return {
          ...current,
          [owner]: {
            ...slot,
            reasoning: slot.reasoning + (data.reasoning ?? ''),
            content: slot.content + (data.content ?? ''),
          },
        };
      });
    },
    [],
  );

  /**
   * Move a finished stream into the persistent thought log, then clear the live slot.
   * The reasoning the user watched arrive is now something they can scroll back to.
   */
  const settle = useCallback((owner) => {
    setStreams((current) => {
      if (!current[owner]) return current;
      const snapshot = current[owner];
      setThoughts((thoughtsCurrent) => ({
        ...thoughtsCurrent,
        [owner]: {
          owner,
          phase: snapshot.phase,
          reasoning: snapshot.reasoning,
          content: snapshot.content,
          finishedAt: Date.now(),
        },
      }));
      const next = { ...current };
      delete next[owner];
      return next;
    });
  }, []);

  const patch = useCallback((key, next) => {
    setAnalysis((current) => ({ ...current, [key]: { ...current[key], ...next } }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    castRef.current = null;
    request.current = null;
    setWrittenCast(null);
    setStage(STAGE.COMPOSE);
    setAnalysis({});
    setSpec(null);
    setError(null);
    setRewriting(false);
    setStreams({});
    setThoughts({});
  }, []);

  /** Back to the composer without throwing away the treatment — the user may return to it. */
  const backToCompose = useCallback(() => setStage(STAGE.COMPOSE), []);
  const showTreatment = useCallback(() => {
    if (spec) setStage(STAGE.TREATMENT);
  }, [spec]);

  const launch = useCallback(
    async ({ prompt, cast, primary }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      request.current = { prompt, primaryKey: primary?.key ?? null };
      setStage(STAGE.WRITING);
      setSpec(null);
      setError(null);
      setAnalysis(Object.fromEntries(cast.map((entry) => [entry.key, { status: 'queued' }])));

      try {
        const dossiers = new Map();

        await pooled(cast, CASTING_LANES, async (entry) => {
          if (signal.aborted) return;
          patch(entry.key, { status: 'watching' });
          try {
            const dossier = await castPiece(
              forCastingWire({ key: entry.key, nft: entry.nft }),
              { signal, onEvent: feed(entry.key) },
            );
            dossiers.set(entry.key, dossier);
            patch(entry.key, { status: 'done', dossier, cached: dossier.cached });
            settle(entry.key);
          } catch (failure) {
            if (signal.aborted) return;
            // One piece failing must not lose the film. The Screenwriter is told about the
            // cast it actually has, and the treatment names what could not be used.
            patch(entry.key, { status: 'failed', error: failure.message });
            settle(entry.key);
          }
        });

        if (signal.aborted) return;

        const usable = cast
          .filter((entry) => dossiers.has(entry.key))
          .map((entry) => ({
            key: entry.key,
            dossier: dossiers.get(entry.key),
            name: resolveNftName(entry.nft),
            collectionName: entry.collection?.name ?? entry.collection?.brand?.name ?? '',
            // UI-only, and stripped before the request goes out: the treatment needs the
            // artwork to draw a <Subject N> chip, but a raw Alchemy object per cast member
            // would add tens of KB to a body the Worker never reads.
            nft: entry.nft,
            collection: entry.collection,
          }));

        if (!usable.length) {
          const failures = Object.values(analysis).filter((state) => state?.status === 'failed');
          const reasons = failures.map((state) => state.error).filter(Boolean);
          const unique = [...new Set(reasons)];
          const detail = unique.length
            ? ` (${unique.slice(0, 2).join('; ')}${unique.length > 2 ? '…' : ''})`
            : '';
          throw new Error(
            `None of the selected pieces could be read.${detail} Try different artwork or wait a moment and retry.`,
          );
        }

        castRef.current = usable;
        setWrittenCast(usable);
        const written = await screenwrite(
          { prompt, cast: usable.map(forWire), primaryKey: primary?.key ?? null },
          { signal, onEvent: feed(SCREENWRITER) },
        );
        if (signal.aborted) return;

        setSpec(written);
        settle(SCREENWRITER);
        setStage(STAGE.TREATMENT);
      } catch (failure) {
        if (signal.aborted || failure.name === 'AbortError') return;
        settle(SCREENWRITER);
        setError(failure.message);
        setStage(STAGE.WRITING);
      }
    },
    [patch, feed, settle, analysis],
  );

  /**
   * Re-run the Screenwriter with a note, reusing the dossiers already in hand.
   *
   * This is the iteration loop: the analysis is the expensive half and it does not change
   * when the direction does.
   */
  const rewrite = useCallback(async (note) => {
    const cast = castRef.current;
    const previous = request.current;
    if (!cast?.length || !previous) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setRewriting(true);
    setError(null);
    try {
      const written = await screenwrite(
        { ...previous, cast: cast.map(forWire), note },
        { signal, onEvent: feed(SCREENWRITER) },
      );
      if (signal.aborted) return;
      setSpec(written);
      setStage(STAGE.TREATMENT);
    } catch (failure) {
      if (signal.aborted || failure.name === 'AbortError') return;
      // The previous spec is deliberately left in place — a failed rewrite should cost the
      // note, not the draft.
      setError(failure.message);
    } finally {
      setRewriting(false);
      settle(SCREENWRITER);
    }
  }, [feed, settle]);

  // Every active stream, as an array the HUD can map over. The first entry is still the
  // most salient one for components that only want a single slot.
  const live = Object.entries(streams).map(([owner, data]) => ({ owner, ...data }));

  return {
    stage,
    analysis,
    spec,
    error,
    elapsed,
    streams,
    live,
    thoughts,
    rewriting,
    launch,
    rewrite,
    reset,
    backToCompose,
    showTreatment,
    // The cast as the Screenwriter saw it, so the treatment can resolve <Subject N> tags to
    // real artwork.
    writtenCast,
    isWriting: stage === STAGE.WRITING,
  };
};
