import { useCallback, useEffect, useRef, useState } from 'react';
import {
  castPiece,
  forCastingWire,
  getStoryboardPlan,
  previsDossierReview,
  screenwrite,
} from '../services/swarm';
import { resolveNftName } from '../lib/nftMedia';
import { useMindChatContext } from '../context/mindChat';

// Where the canvas is in the pipeline. Kept as one value rather than a set of booleans so
// an impossible state (writing AND showing a treatment) can't be represented.
export const STAGE = {
  COMPOSE: 'compose',
  WRITING: 'writing',
  TREATMENT: 'treatment',
};

// How many pieces are cast at once. The NVIDIA Zero Budget model is rate-limited at roughly 40
// requests/min account-wide, and a seven-card cold cast fired in one burst is the exact
// shape that trips it. Two at a time keeps a full cast inside the budget while still
// finishing far faster than a serial walk — and the Worker retries a 429 underneath anyway.
const CASTING_LANES = 2;

/** Slot key for the Screenwriter's own stream, alongside the per-piece ones. */
export const SCREENWRITER = 'screenwriter';

/** Hard caps, mirrored from worker/tier.js so the UI can reason about them without a Worker round-trip. */
const FREE_MAX_BEATS = 3;
const PAID_MAX_BEATS = 6;
const FREE_MAX_REFERENCES = 4;
const PAID_MAX_REFERENCES = 9;

/**
 * Slot key for the Previs Supervisor, which runs BETWEEN casting and screenwriting.
 *
 * It had no slot at all until 2026-08-26, and no surface anywhere in the canvas — so the minutes
 * it spends were dead air. Measured on a real five-piece cast: 23s to review, 60-120s to re-cast
 * one flagged piece cold (`refresh: true`), 23s to re-check. For all of that every card read
 * "known already" and the Screenwriter panel said it was waiting on the Casting Director, which
 * had already finished. An agent that can hold the run for two minutes has to be able to say so.
 */
export const PREVIS = 'previs';

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
  const { session } = useMindChatContext();
  const token = session?.token;

  const [stage, setStage] = useState(STAGE.COMPOSE);
  // key -> { status: 'queued'|'casting'|'done'|'failed', dossier?, cached?, error? }
  //
  // `casting` was called `watching` until it collided with the Casting Director's OWN
  // `watching` phase, which means "watching the token's film" — two different vocabularies
  // sharing one key, resolved through the same lookup in CastingLog. A piece that had not
  // started yet rendered as "WATCHING ITS FILM" behind a green done-dot, which is an actively
  // misleading thing for a log whose job is to say what happened.
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
  // Caps that governed the last generation, so rewrites stay on the same tier rather than
  // silently switching back to the Zero Budget default.
  const capsRef = useRef({ maxBeats: FREE_MAX_BEATS, maxReferences: FREE_MAX_REFERENCES });
  // The same caps as state, so the draft that persists them (src/hooks/useDraftPersistence.js)
  // re-runs when they change. The ref stays the thing `rewrite` reads.
  const [caps, setCaps] = useState(capsRef.current);

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
              message: data.message,
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
      // A retried attempt re-streams from the beginning; keeping the cut attempt's text would
      // show the same reasoning twice. See the retry loop in src/services/swarm.js.
      if (type === 'restart') {
        setStreams((current) =>
          current[owner] ? { ...current, [owner]: { phase: current[owner].phase, reasoning: '', content: '' } } : current,
        );
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
          message: snapshot.message,
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
    capsRef.current = { maxBeats: FREE_MAX_BEATS, maxReferences: FREE_MAX_REFERENCES };
    setCaps(capsRef.current);
    setWrittenCast(null);
    setStage(STAGE.COMPOSE);
    setAnalysis({});
    setSpec(null);
    setError(null);
    setRewriting(false);
    setStreams({});
    setThoughts({});
  }, []);

  /**
   * Put a saved draft back (src/lib/draftStore.js), as if the run that produced it had just
   * finished. Both refs are repopulated on purpose: `rewrite` and `requestTrim` read
   * `request.current` and `castRef.current` and silently do nothing without them, which would
   * turn a restored treatment into one the visitor can look at but not iterate on.
   */
  const restore = useCallback(({ prompt, primaryKey = null, spec: savedSpec = null, writtenCast: savedCast = null, caps: savedCaps = null, stage: savedStage = STAGE.COMPOSE }) => {
    abortRef.current?.abort();
    abortRef.current = null;
    request.current = typeof prompt === 'string' ? { prompt, primaryKey } : null;
    capsRef.current = savedCaps?.maxBeats
      ? { maxBeats: savedCaps.maxBeats, maxReferences: savedCaps.maxReferences ?? FREE_MAX_REFERENCES }
      : { maxBeats: FREE_MAX_BEATS, maxReferences: FREE_MAX_REFERENCES };
    setCaps(capsRef.current);
    const usable = Array.isArray(savedCast) && savedCast.length ? savedCast : null;
    castRef.current = usable;
    setWrittenCast(usable);
    // The Casting Director's log shows every piece as read — its dossier is right there, and a
    // dossier that survived a page load was cached by the Worker long before that.
    setAnalysis(Object.fromEntries((usable ?? []).map((entry) => [entry.key, { status: 'done', dossier: entry.dossier, cached: true }])));
    const hasSpec = Boolean(savedSpec?.beats?.length);
    setSpec(hasSpec ? savedSpec : null);
    setError(null);
    setRewriting(false);
    setStreams({});
    setThoughts({});
    setStage(hasSpec && savedStage === STAGE.TREATMENT ? STAGE.TREATMENT : STAGE.COMPOSE);
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

      // Resolve the tier before any writing starts. A failed plan read is not fatal: the
      // Worker will fall back to the Zero Budget baseline on its own.
      let maxBeats = FREE_MAX_BEATS;
      let maxReferences = FREE_MAX_REFERENCES;
      try {
        const resolvedPlan = token ? await getStoryboardPlan(token, 0) : null;
        if (resolvedPlan) {
          maxBeats = resolvedPlan.maxBeats ?? maxBeats;
          maxReferences = resolvedPlan.tier === 'paid' ? PAID_MAX_REFERENCES : FREE_MAX_REFERENCES;
        }
      } catch (planError) {
        console.warn('Could not resolve tier before screenwriting:', planError.message);
      }
      capsRef.current = { maxBeats, maxReferences };
      setCaps(capsRef.current);

      try {
        const dossiers = new Map();
        // Collected here rather than read back from `analysis` below. `analysis` is a stale
        // closure — it is in this callback's dependency list, so the running invocation only ever
        // sees the snapshot taken before the launch — which silently emptied the `detail` in the
        // "none of these could be read" message, exactly when a reason mattered most.
        const failures = [];

        await pooled(cast, CASTING_LANES, async (entry) => {
          if (signal.aborted) return;
          patch(entry.key, { status: 'casting' });
          try {
            // One retry, and only the transport kinds are retried (see isRetryable in
            // src/services/swarm.js). A cut stream normally means the Worker finished and
            // persisted the dossier anyway, so the second attempt is a cache hit rather than a
            // second cold cast — which is why one is enough and two would be waste.
            const dossier = await castPiece(
              forCastingWire({ key: entry.key, nft: entry.nft }),
              { signal, onEvent: feed(entry.key), retries: 1 },
            );
            dossiers.set(entry.key, dossier);
            patch(entry.key, { status: 'done', dossier, cached: dossier.cached });
            settle(entry.key);
          } catch (failure) {
            if (signal.aborted) return;
            // One piece failing must not lose the film. The Screenwriter is told about the
            // cast it actually has, and the treatment names what could not be used.
            failures.push(failure.message);
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
          const unique = [...new Set(failures.filter(Boolean))];
          const detail = unique.length
            ? ` (${unique.slice(0, 2).join('; ')}${unique.length > 2 ? '…' : ''})`
            : '';
          throw new Error(
            `None of the selected pieces could be read.${detail} Try different artwork or wait a moment and retry.`,
          );
        }

        // Previs Supervisor: one cheap, text-only review before any writing begins — the
        // class of bug no producer agent has reason to catch in itself (e.g. a dossier that
        // only captured one of several characters in a video-backed piece). Bounded to one
        // retry per flagged cast member, per its own authority floor — never a loop.
        // Advisory throughout: a failed review must never block the run it's meant to guard.
        try {
          const firstReview = await previsDossierReview(
            { prompt, cast: usable },
            { signal, onEvent: feed(PREVIS) },
          );
          if (firstReview.issues?.length && !signal.aborted) {
            const retried = [];
            for (const issue of firstReview.issues) {
              const entry = usable.find((u) => u.key === issue.key);
              if (!entry || signal.aborted) continue;
              try {
                // Back to 'casting' for the duration: this is a COLD re-read (refresh: true skips
                // the dossier cache), so the card must stop claiming the piece is already known
                // while a fresh 60-120s call runs against it. Streamed into the piece's own slot,
                // so the reasoning appears on the card it belongs to.
                patch(entry.key, { status: 'casting' });
                const revisedDossier = await castPiece(
                  { key: entry.key, nft: entry.nft, refresh: true, previsNote: issue.detail },
                  { signal, onEvent: feed(entry.key), retries: 1 },
                );
                entry.dossier = revisedDossier;
                patch(entry.key, { status: 'done', dossier: revisedDossier });
                settle(entry.key);
              } catch {
                patch(entry.key, { status: 'done' });
                settle(entry.key);
                // Revision call itself failed (network, rate limit) — original dossier
                // stands, and the re-check below will flag the same issue again.
              }
              retried.push(entry);
            }
            if (retried.length && !signal.aborted) {
              const recheck = await previsDossierReview(
                { prompt, cast: retried },
                { signal, onEvent: feed(PREVIS) },
              );
              const stillFlagged = new Map((recheck.issues ?? []).map((issue) => [issue.key, issue]));
              for (const entry of retried) {
                const issue = stillFlagged.get(entry.key);
                if (issue) patch(entry.key, { previsFlagged: true, previsIssue: issue.detail });
              }
            }
          }
        } catch (error) {
          if (!signal.aborted) console.warn('Previs Supervisor review failed:', error.message);
        } finally {
          settle(PREVIS);
        }
        if (signal.aborted) return;

        castRef.current = usable;
        setWrittenCast(usable);
        const written = await screenwrite(
          {
            prompt,
            cast: usable.map(forWire),
            primaryKey: primary?.key ?? null,
            maxBeats,
            maxReferences,
          },
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
    [patch, feed, settle, token],
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
      const { maxBeats, maxReferences } = capsRef.current;
      const written = await screenwrite(
        { ...previous, cast: cast.map(forWire), note, maxBeats, maxReferences },
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

  /**
   * Manually remove one beat from the settled spec. This is the fast, client-side trim path;
   * it does not re-call the model, so the visitor can quickly get under the tier cap.
   */
  const trimBeat = useCallback((index) => {
    setSpec((current) => {
      if (!current || !Array.isArray(current.beats)) return current;
      const nextBeats = current.beats.filter((_, i) => i !== index);
      if (nextBeats.length === 0) return current; // never leave the spec beatless
      const nextTrace = (current.intentTrace ?? [])
        .filter((t) => t.beat !== index + 1)
        .map((t) => ({
          ...t,
          beat: t.beat > index + 1 ? t.beat - 1 : t.beat,
        }));
      return { ...current, beats: nextBeats, intentTrace: nextTrace };
    });
  }, []);

  /**
   * Ask the Screenwriter to compress the current spec to fit the tier cap that governed it.
   * This is the model-assisted trim path: it keeps every cast member but rewrites the story
   * to live inside the allowed beats and reference slots.
   */
  const requestTrim = useCallback(() => {
    const { maxBeats, maxReferences } = capsRef.current;
    const tierName = maxBeats < PAID_MAX_BEATS ? 'Zero Budget' : 'the current tier';
    const note =
      `Trim this to fit ${tierName}: at most ${maxBeats} beat${maxBeats === 1 ? '' : 's'} and ` +
      `${maxReferences} reference slot${maxReferences === 1 ? '' : 's'}. Keep every cast member visible and preserve ` +
      "the user's original idea; just compress the story.";
    return rewrite(note);
  }, [rewrite]);

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
    restore,
    caps,
    backToCompose,
    showTreatment,
    trimBeat,
    requestTrim,
    // The cast as the Screenwriter saw it, so the treatment can resolve <Subject N> tags to
    // real artwork.
    writtenCast,
    isWriting: stage === STAGE.WRITING,
  };
};
