import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Clock, Film, Image as ImageIcon, Loader2, Maximize2, RefreshCw, ShieldAlert, Sparkles, X } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
import { storyboardImageUrl } from '../../../services/swarm';
import { cn } from '../../../lib/cn';
import {
  classifyCameraMove,
  deriveCameraAngle,
  deriveFraming,
  projectSubject,
  sceneScaleOf,
} from '../../../../worker/scene.js';

// The timeline: one card per beat, in order.
//
// ROUND 8 REPLACED THE TOP-DOWN SCHEMATIC ENTIRELY — deleted, not patched, which was the explicit
// call after three rounds of feedback said it was unreadable ("I don't understand whatsoever how
// to read these... other than the text"). Each beat is now a real 3D frame seen through that
// beat's own camera, plus the prose note, which is and always was the thing a human actually
// reads first.
//
// CARD ORDER IS THE ARGUMENT: prose, then picture, then numbers. The prose is the primary human
// surface (Adam's round-5 priority #1, re-confirmed in round 8); the 3D is what makes a camera
// move visible at all; the derived facts are last because they are a check, not a description.
//
// EVERY LABEL HERE IS DERIVED FROM THE GEOMETRY, never read off the model's own claims. A beat
// that calls itself a close-up while its numbers say wide shows "WS", because that is what H3
// will be told and what the render will be. The redundant labels in the schema exist to be
// checked against, not to be displayed.
//
// SCHEMATIC IS THE DEFAULT VIEW, and the artwork is one click away. Not a hedge — the two views
// answer different questions. The schematic is where you judge whether the blocking is right, and
// it is the surface editing will attach to; the artwork is where you see whether it is YOUR ape
// standing there. The toggle is per-panel rather than per-tile because the question is usually
// asked of the whole film at once.

const SceneViewport = lazy(() => import('../scene3d/BeatView'));
const ViewCanvas = lazy(() => import('../scene3d/ViewCanvas'));
const ModalViewport = lazy(() => import('../scene3d/FrameViewport'));

/** Shot size, angle and camera move, computed here rather than trusted. */
const derivedFacts = (scene, aspect = 16 / 9) => {
  if (!scene?.camera) return null;
  const subjects = scene.subjects ?? [];
  const principal = subjects.find((s) => s.subject === scene.principalSubject) ?? subjects[0] ?? null;
  const projection = principal ? projectSubject(principal, scene.camera, { aspect }) : null;
  return {
    framing: projection && Number.isFinite(projection.hFrac) ? deriveFraming(projection.hFrac) : null,
    angle: deriveCameraAngle(scene.camera),
    motion: classifyCameraMove(scene.camera, sceneScaleOf(scene)).motion,
    focalMm: Math.round(scene.camera.focalStartMm),
    subjectCount: subjects.length,
  };
};

const FactRow = ({ facts }) =>
  facts ? (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-wider text-slate-500">
      <span className="flex items-center gap-1 text-purple-300">
        <Camera className="h-3 w-3" />
        {facts.framing ?? '—'}
      </span>
      <span>· {facts.angle}</span>
      <span>· {facts.motion}</span>
      <span>· {facts.focalMm}mm</span>
    </div>
  ) : null;

/** A beat the validator refused.
 *
 * ADAM'S FAILURE SURFACE, and the reason there is no "here it is anyway, with a warning" option:
 * showing a flagged beat as though it were fine is deceptive, and a flag the visitor has to
 * notice and interpret is only marginally better. So the beat is refused, the reason is in plain
 * English, and the visitor gets three honest choices — try again, accept it deliberately, or let
 * it go. Regenerate is a button rather than an automatic retry because the choice to spend
 * another attempt is theirs.
 */
const RefusedFrame = ({ frame, onRegenerate, onOverride, busy }) => {
  const dropped = frame.status === 'dropped';
  const [confirming, setConfirming] = useState(false);
  const reasons = (frame.violations ?? []).map((v) => v.english ?? v.detail ?? v.code);

  return (
    <div className="flex aspect-video flex-col justify-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
        <ShieldAlert className="h-3 w-3" />
        {dropped ? 'Beat dropped' : "Couldn't place this shot"}
      </p>
      <p className="text-[11px] leading-relaxed text-slate-300">
        {dropped
          ? `Dropped after ${frame.attempts} attempts. The rest of the film is intact.`
          : reasons.length
            ? `The geometry didn't work out — ${reasons.join('; ')}.`
            : 'The geometry for this beat did not check out.'}
      </p>
      {!dropped && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onRegenerate(frame.frameId)}
            disabled={busy}
            className="sticker sticker-hover rounded-lg bg-amber-500/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-black hover:bg-amber-400 disabled:opacity-50"
          >
            {busy ? 'Trying again…' : `Try again (${3 - (frame.attempts ?? 1)} left)`}
          </button>
          {/* Two clicks, deliberately. The friction IS the safeguard. */}
          {confirming ? (
            <button
              type="button"
              onClick={() => onOverride(frame.frameId)}
              className="rounded-lg border border-white/20 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-200 hover:bg-white/10"
            >
              Yes, use it anyway
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300"
            >
              Use it anyway
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/** A [CUT TO BLACK]-style beat — no blocking, no image, nothing to generate. */
const TransitionCard = ({ frame }) => (
  <div className="flex aspect-video min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black p-4 text-center">
    <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-300">
      Beat {frame.beatIndex + 1} · Transition
    </span>
    <p className="text-xs leading-relaxed text-slate-500">{frame.transitionText || 'Cut to black'}</p>
  </div>
);

/** Round-4 frames carry `blocking` and no geometry. They stay readable rather than being
 * migrated or thrown away — a visitor's existing storyboard should not vanish because the
 * generator changed underneath it. */
const LegacyBlocking = ({ blocking }) => (
  <div className="scrollbar-subtle max-h-32 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-2 text-[11px] leading-relaxed text-slate-400">
    <p className="font-semibold uppercase tracking-wider text-slate-500">
      {blocking.framing} · {blocking.cameraAngle}
    </p>
    <p>{blocking.cameraMovement}</p>
    {blocking.visualPrompt && <p className="text-slate-500">{blocking.visualPrompt}</p>}
  </div>
);

const FrameCard = ({
  frame,
  token,
  aspect,
  nameOf,
  castAssets,
  showArt,
  onGenerateSketch,
  sketching,
  regenerating,
  onRegenerate,
  onOverride,
  perRenderCap,
  onExpand,
}) => {
  const [draft, setDraft] = useState('');
  const trackRef = useRef(null);
  // Only mount a view for a tile that is actually on screen. Two reasons, and the second is the
  // load-bearing one: it saves drawing beats nobody is looking at, and a <View> paints into its
  // tracked rectangle whether or not that rectangle has scrolled out of its own panel — so
  // without this, a tile scrolled past the top of the timeline would paint over the panel above.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = trackRef.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio > 0.55),
      { threshold: [0, 0.55, 1] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const submit = (event) => {
    event.preventDefault();
    if (sketching) return;
    const estimate = frame.costUsd || 0.02;
    if (perRenderCap != null && estimate > perRenderCap) {
      // eslint-disable-next-line no-alert
      const proceed = window.confirm(`This will cost about $${estimate.toFixed(2)}, over your per-render cap of $${perRenderCap}. Proceed?`);
      if (!proceed) return;
    }
    onGenerateSketch(frame.frameId, draft.trim() || undefined);
    setDraft('');
  };

  const hasSketch = Boolean(frame.r2Key);
  const refused = frame.status === 'failed' || frame.status === 'dropped';
  const facts = useMemo(() => derivedFacts(frame.scene, aspect), [frame.scene, aspect]);

  // No `overflow-hidden` on the card. The tile inside clips its own corners already, and hiding
  // the overflow here silently cut the derived-facts row and the sketch form off the bottom of
  // every card — a clip with no scrollbar and no error, which is exactly the kind of bug that
  // survives a screenshot review, because the card still looks finished.
  // `min-w-0` because these are grid items: a grid track is `minmax(auto, 1fr)`, so without
  // it the card's widest indivisible child sets a floor and three columns stop being equal —
  // they blow the panel out sideways instead of compressing.
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20">
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-300">
            Beat {frame.beatIndex + 1}
          </span>
          {!refused && (
            <button
              type="button"
              onClick={() => onExpand(frame)}
              aria-label="View larger"
              title="View larger"
              className="rounded-full bg-black/40 p-1 text-slate-500 transition-colors hover:bg-black/70 hover:text-white"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Prose first. It is what a visitor reads, and it survives even a refused beat — the
            writing was never what failed. */}
        {frame.proseNote && (
          <p className="scrollbar-subtle max-h-24 overflow-y-auto text-[11px] leading-relaxed text-slate-300">
            {frame.proseNote}
          </p>
        )}

        {refused ? (
          <RefusedFrame
            frame={frame}
            onRegenerate={onRegenerate}
            onOverride={onOverride}
            busy={regenerating}
          />
        ) : (
          <div
            ref={trackRef}
            className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black/40"
          >
            {sketching ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
              </div>
            ) : hasSketch ? (
              <img
                src={storyboardImageUrl(token, frame.r2Key)}
                alt={`Beat ${frame.beatIndex + 1} sketch`}
                className="h-full w-full object-cover"
              />
            ) : frame.scene ? (
              <Suspense fallback={null}>
                <SceneViewport
                  frame={frame}
                  aspect={aspect}
                  active={visible}
                  nameOf={nameOf}
                  castAssets={castAssets}
                  showArt={showArt}
                />
              </Suspense>
            ) : frame.blocking ? (
              <LegacyBlocking blocking={frame.blocking} />
            ) : null}
            {hasSketch && (
              <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">
                Sketch preview — not final
              </span>
            )}
          </div>
        )}

        <FactRow facts={facts} />

        {frame.overriddenAt && (
          <p className="text-[10px] uppercase tracking-wider text-amber-400/80">Accepted despite validation</p>
        )}

        {!refused && (
          <form onSubmit={submit} className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={hasSketch ? 'Re-prompt this sketch…' : 'Optional: steer the sketch…'}
              rows={1}
              className="scrollbar-subtle min-w-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white placeholder-slate-600 outline-none focus:border-purple-500/50"
            />
            <button
              type="submit"
              disabled={sketching}
              aria-label={hasSketch ? 'Regenerate sketch' : 'Generate sketch preview'}
              title={hasSketch ? 'Regenerate sketch' : 'Generate sketch preview'}
              className="sticker sticker-hover shrink-0 rounded-lg bg-purple-600 p-1.5 text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/40"
            >
              {hasSketch ? (
                <RefreshCw className={cn('h-3.5 w-3.5', sketching && 'animate-spin')} />
              ) : (
                <Sparkles className={cn('h-3.5 w-3.5', sketching && 'animate-pulse')} />
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

/** The "blow it up" view. Its own WebGL context rather than a shared <View>, because the modal
 * sits above the shared canvas in z-order and one extra context for one modal is well inside the
 * browser's limit. */
const FrameModal = ({ frame, token, aspect, nameOf, castAssets, showArt, onClose }) => {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const hasSketch = Boolean(frame.r2Key);
  const facts = derivedFacts(frame.scene, aspect);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Beat ${frame.beatIndex + 1} detail`}
        onClick={(event) => event.stopPropagation()}
        className="scrollbar-subtle max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-purple-300">
            Beat {frame.beatIndex + 1}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {frame.proseNote && (
          <p className="mb-4 text-sm leading-relaxed text-slate-300">{frame.proseNote}</p>
        )}

        {hasSketch ? (
          <img
            src={storyboardImageUrl(token, frame.r2Key)}
            alt={`Beat ${frame.beatIndex + 1} sketch`}
            className="mb-4 w-full rounded-xl"
          />
        ) : frame.scene ? (
          <div className="mb-4 aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black/40">
            <Suspense fallback={null}>
              <ModalViewport
                frame={frame}
                aspect={aspect}
                nameOf={nameOf}
                castAssets={castAssets}
                showArt={showArt}
              />
            </Suspense>
          </div>
        ) : null}

        <FactRow facts={facts} />

        {frame.scene?.subjects?.length > 0 && (
          <div className="mt-3 text-sm text-slate-400">
            <p className="mb-1 text-xs uppercase tracking-wider text-slate-600">In frame</p>
            <ul className="space-y-1">
              {frame.scene.subjects.map((s) => (
                <li key={s.subject}>
                  <span className="text-slate-300">{nameOf(s.subject)}</span>
                  {s.containerId ? <span className="text-slate-500"> (inside {nameOf(s.containerId)})</span> : null} — {s.action}
                </li>
              ))}
            </ul>
          </div>
        )}

        {frame.scene?.containmentNotes && (
          <p className="mt-3 text-sm text-slate-500">{frame.scene.containmentNotes}</p>
        )}
      </div>
    </div>
  );
};

/** Tier, model and money, always visible and never buried in a digest.
 *
 * The model NAME is on it, not just the dollars — Adam's point, and the reason the badge is worth
 * the space: a cost badge tells a visitor what they are spending, not what is doing the work, and
 * on this build those are two different disclosures. Cost and time sit together because a visitor
 * decides on both at once. */
const TierBadge = ({ plan, spend }) => {
  if (!plan) return null;
  const spent = spend?.totalSpent;
  const modelShort = plan.model?.split('/').pop()?.replace(':free', '') ?? plan.model;
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-0.5 text-[9px] uppercase tracking-wider text-slate-400">
      <span className={plan.tier === 'paid' ? 'text-amber-300' : 'text-emerald-300'}>{plan.label}</span>
      <span className="text-slate-600">·</span>
      <span className="normal-case tracking-normal text-slate-500">{modelShort}</span>
      {plan.tier === 'paid' && (
        <>
          <span className="text-slate-600">·</span>
          <span>
            ${(spent ?? 0).toFixed(2)}
            {plan.budget?.total != null ? ` of $${plan.budget.total}` : ''}
          </span>
        </>
      )}
    </span>
  );
};

/** The live tail of the model thinking out loud.
 *
 * Not the whole trace — 8,000 characters of deliberation is a wall, not a window. The last few
 * lines, scrolling, is what reads as *someone working*. The full reasoning is still streamed and
 * could be opened in full later; this is the ambient version.
 */
const ThinkingStream = ({ reasoning }) => {
  const tail = useMemo(() => {
    const lines = (reasoning ?? '').split('\n').filter((line) => line.trim());
    return lines.slice(-4).join('\n');
  }, [reasoning]);
  if (!tail) return null;
  return (
    <p className="scrollbar-subtle max-h-20 overflow-hidden whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-sky-300/70">
      {tail}
    </p>
  );
};

/**
 * A beat while it is still being thought about.
 *
 * The whole film arrives at once at the very end — measured: the structured answer does not stream.
 * We show the beat text and the model's live reasoning tail so the wait is legible, but we no
 * longer draw provisional wireframes that may contradict the final geometry.
 */
/**
 * A beat that has been PLANNED but not yet drawn.
 *
 * Everything on this card is a real decision the model made about this specific beat, roughly
 * fifteen seconds into a run that takes minutes: the shot size, which subject it is sized on,
 * the camera move, and one line about what the shot is for. Three cards therefore say three
 * DIFFERENT true things while the geometry is still being drawn, and each one resolves on its
 * own as its own call returns — the beats are generated in parallel, so they land out of order.
 *
 * NOTHING HERE IS EVER SYNTHESISED TO FILL THE TIME. It is tempting, because a card with no
 * plan yet is a card with nothing on it, and this repo has been here before: round 8 removed
 * the ghost wireframes for exactly this — they animated a fiction, and the fiction was usually
 * wrong by the time the real geometry arrived. A visitor who is shown something invented has
 * been given a worse deal than a visitor who is shown nothing, because the invention is
 * indistinguishable from the real thing until it contradicts it.
 */
const ShotPlan = ({ plan, status }) => {
  if (!plan) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-purple-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-purple-200">
          {plan.framing}
        </span>
        {plan.motion && (
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{plan.motion}</span>
        )}
        {status === 'drawn' && (
          <span className="text-[10px] text-emerald-400">blocked</span>
        )}
        {status === 'failed' && (
          <span className="text-[10px] text-amber-400">could not be blocked</span>
        )}
      </div>
      {plan.intent && (
        <p className="line-clamp-2 text-[10px] italic leading-relaxed text-slate-500">{plan.intent}</p>
      )}
    </div>
  );
};

const PlaceholderCard = ({ beatIndex, beatText, reasoning, shotPlan, status }) => (
  <div className="min-w-0 rounded-2xl border border-sky-500/20 bg-sky-500/[0.03]">
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
          Beat {beatIndex + 1}
        </span>
      </div>

      {beatText && (
        <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">{beatText}</p>
      )}

      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-sky-500/20 bg-black/40">
        <span className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-widest text-slate-700">
          {/* The label names the stage this beat is ACTUALLY at, which is not the same for every
              card once the beats run concurrently. 'waiting' is the honest word before the shot
              list exists — not a progress bar for something that has not started. */}
          {shotPlan ? 'blocking…' : 'waiting'}
        </span>
      </div>

      <ShotPlan plan={shotPlan} status={status} />
      <ThinkingStream reasoning={reasoning} />
    </div>
  </div>
);

/** The wait.
 *
 * One whole-film call takes three to five minutes, and this is the surface Adam called the
 * highest-stakes in the build: "a visitor who waits 4 minutes for a working product is patient; a
 * visitor who waits 4 minutes wondering if it's broken is not." Where a reasoning channel exists,
 * the honest answer is not a better spinner — it is to show the work. */
const WaitHeader = ({ stageLabel, elapsedSeconds, plan, thinking, planned, drawn, total, reconnects }) => {
  const estimate = plan?.estimateSeconds ?? 240;
  const low = Math.round(estimate / 60);
  // "the whole film arrives at once" stopped being true when the beats started running in
  // parallel, and a wait surface that describes the wrong shape of wait is the specific thing
  // this pass is fixing. Once the shot list exists, count the beats that have actually landed.
  const detail = drawn > 0 || planned > 0
    ? `${drawn} of ${total} beats blocked`
    : thinking
      ? 'thinking out loud below'
      : `usually ${low}\u2013${low + 2} minutes`;
  return (
    <div className="col-span-full flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <p className="flex items-center gap-2 text-xs text-slate-300">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
        <span className="font-semibold text-white">{stageLabel ?? 'Working'}</span>
        <span className="text-slate-500">{detail}</span>
      </p>
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-600">
        <Clock className="h-3 w-3" />
        {elapsedSeconds > 0 ? `${elapsedSeconds}s elapsed` : 'starting'}
        {/* Stated rather than hidden. A run that has reconnected four times is having a
            different problem from a run that is simply long, and the visitor is the one
            sitting through it. The work itself survives a dropped stream — that is what the
            Queue consumer is for — so this is information, not an alarm. */}
        {reconnects > 0 && (
          <span className="text-amber-500/70">· reconnected {reconnects}x</span>
        )}
      </p>
    </div>
  );
};

/**
 * One beat's slot in the timeline.
 *
 * THE SLOT IS STABLE; ONLY ITS CONTENTS CHANGE. The timeline used to render two entirely
 * separate lists — a grid of ghost cards while the run was in flight, swapped wholesale for a
 * grid of real frames the moment the result landed. Different keys, different components,
 * every card in the grid replaced at once. If you were reading beat three when the film
 * arrived, beat three moved out from under you and the panel jumped back to the top. Keying
 * every beat by its index instead means a beat occupies the same position in the grid from the
 * instant the run starts until long after it finishes, and filling in is something that
 * happens *to* that card rather than *instead of* it.
 */
const BeatCard = ({ index, frame, beatText, reasoning, shotPlan, status, aspect, frameProps }) => {
  if (frame?.transition) return <TransitionCard frame={frame} />;
  if (frame) {
    // `sketching` and `regenerating` are per-frame maps upstream; only this frame's own busy
    // flag reaches the card, so one frame regenerating never busies out its neighbours.
    const { sketching, regenerating, ...rest } = frameProps;
    return (
      <FrameCard
        frame={frame}
        aspect={aspect}
        sketching={Boolean(sketching?.[frame.frameId])}
        regenerating={Boolean(regenerating?.[frame.frameId])}
        {...rest}
      />
    );
  }
  return <PlaceholderCard beatIndex={index} beatText={beatText} reasoning={reasoning} shotPlan={shotPlan} status={status} />;
};

const StoryboardPanel = ({ id, storyboarder, token, budget, status, tabs }) => {
  const {
    frames,
    sketching,
    regenerating,
    generateSketch,
    regenerateBeat,
    overrideBeat,
    plan,
    spend,
    subjectNames,
    subjectAssets,
    films,
    openFilm,
    running,
    stageLabel,
    elapsedSeconds,
    reasoning,
    reasoningByBeat,
    beatPlans,
    beatStatus,
    reconnects,
    beatTexts,
  } = storyboarder ?? {};
  const [expandedFrame, setExpandedFrame] = useState(null);
  const [showArt, setShowArt] = useState(false);
  const rootRef = useRef(null);

  // The cast's real names, so a hover says "the ape" rather than "<Subject 1>". The tags are how
  // the machinery matches subjects across the schema, the references and the render prompt; they
  // are not what a person should be shown. Falls back to the tag when a storyboard predates the
  // mapping being stored.
  const nameOf = useMemo(() => (tag) => subjectNames?.[tag] ?? tag, [subjectNames]);

  // Only offer the toggle when there is something to toggle TO. A storyboard blocked before the
  // cast was recorded on the record has no artwork to show, and a control that does nothing is
  // worse than no control.
  const hasArt = useMemo(
    () => Object.values(subjectAssets ?? {}).some((asset) => asset?.assetKey),
    [subjectAssets],
  );

  const aspect = 16 / 9;
  // `tabs` is rendered by whoever owns the timeline slot (TimelinePanel), not built here — the
  // strip has to look identical above the storyboard and above the Dailies, and it has to survive
  // the empty-state early return below, which mounts its own <CanvasPanel>.
  const header = (
    <div className="flex items-center gap-2">
      {tabs}
      {hasArt && (
        <button
          type="button"
          onClick={() => setShowArt((on) => !on)}
          title={showArt ? 'Show the schematic' : 'Show the cast artwork'}
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider transition-colors',
            showArt
              ? 'bg-purple-500/20 text-purple-200 hover:bg-purple-500/30'
              : 'bg-black/40 text-slate-500 hover:text-slate-300',
          )}
        >
          <ImageIcon className="h-3 w-3" />
          {showArt ? 'Artwork' : 'Schematic'}
        </button>
      )}
      <TierBadge plan={plan} spend={spend} />
    </div>
  );

  if (!frames?.length && !running) {
    return (
      <CanvasPanel id={id} title="Storyboard (Beta)" icon={Film} headerAction={header} status={status}>
        <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
            <Film className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Timeline is empty</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
              Each beat will appear here as a 3D frame you can look around.
            </p>
          </div>
          {plan?.overCapCopy && (
            <p className="mx-auto max-w-sm text-xs leading-relaxed text-amber-300/90">{plan.overCapCopy}</p>
          )}

          {/* Past films. A storyboard belongs to ONE film now, so this is what stops earlier work
              becoming unreachable after a reload — the tab has no spec until the Screenwriter runs
              again, and a visitor should not have to regenerate a film to see it. */}
          {films?.length > 0 && token && (
            <div className="mx-auto w-full max-w-sm text-left">
              <p className="mb-2 text-center text-[10px] uppercase tracking-widest text-slate-600">
                Your earlier films
              </p>
              <ul className="space-y-1">
                {films.map((film) => (
                  <li key={film.filmId}>
                    <button
                      type="button"
                      onClick={() => openFilm(token, film.filmId)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-left text-xs text-slate-300 transition-colors hover:border-purple-500/40 hover:bg-purple-500/5"
                    >
                      <span className="min-w-0 flex-1 truncate">{film.logline ?? 'Untitled film'}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-600">
                        {film.frames} {film.frames === 1 ? 'beat' : 'beats'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CanvasPanel>
    );
  }

  const ordered = [...(frames ?? [])].sort((a, b) => a.beatIndex - b.beatIndex);

  // One slot per beat, held open from the moment the run starts. A beat that has landed shows
  // its frame; a beat that has not shows the ghost. Both live at the same index in the same
  // list, so the timeline never re-shuffles under a reader — see BeatCard.
  const beats = (() => {
    const byIndex = new Map(ordered.map((frame) => [frame.beatIndex, frame]));
    const highestFrame = ordered.length ? Math.max(...ordered.map((f) => f.beatIndex)) + 1 : 0;
    const count = Math.max(beatTexts?.length ?? 0, highestFrame);
    return Array.from({ length: count }, (_, index) => ({
      index,
      frame: byIndex.get(index) ?? null,
    }));
  })();

  const frameProps = {
    token,
    nameOf,
    showArt,
    sketching,
    regenerating,
    onRegenerate: regenerateBeat,
    onOverride: overrideBeat,
    perRenderCap: budget?.perRender ?? null,
    onGenerateSketch: generateSketch,
    onExpand: setExpandedFrame,
  };

  return (
    <>
      <div ref={rootRef} className="flex h-full min-h-0 flex-col">
        <CanvasPanel
          id={id}
          title="Storyboard (Beta)"
          icon={Film}
          headerAction={header}
          status={status}
          /* THREE TO A ROW, ALWAYS. A storyboard is read as a contact sheet: the unit is the
             row, and holding the row at three keeps the beat you are looking at in the context
             of the two either side of it no matter how the panel is sized. Vertical space is
             what decides how MUCH you see — one row, two, or the whole film — which is the
             axis you actually control by dragging the panel or scrolling it.
             Deliberately not responsive. Breakpoints here (of either kind) mean the film
             re-flows into a different shape every time the zone is resized, so the beat you
             had your eye on moves to another row — the same class of "it shifted while I was
             reading it" this pass exists to remove. Cards get narrower instead. */
          bodyClassName="grid grid-cols-3 content-start gap-3"
        >
          {plan?.downgraded && (
            <p className="col-span-full rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px] leading-relaxed text-sky-200">
              {plan.downgradeReason}
            </p>
          )}
          {plan?.overCapCopy && (
            <p className="col-span-full rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              {plan.overCapCopy}
            </p>
          )}
          {running && (
            <WaitHeader
              stageLabel={stageLabel}
              elapsedSeconds={elapsedSeconds}
              plan={plan}
              thinking={Boolean(reasoning)}
              planned={Object.keys(beatPlans ?? {}).length}
              drawn={Object.values(beatStatus ?? {}).filter((v) => v === 'drawn').length}
              total={beats.length}
              reconnects={reconnects}
            />
          )}

          {/* One card per beat from the moment the run starts, so the film has a shape before
              it has any content, and each frame fills in as the model reasons its way there. */}
          {beats.map(({ index, frame }) => (
            <BeatCard
              key={index}
              index={index}
              frame={frame}
              beatText={beatTexts?.[index]}
              reasoning={reasoningByBeat?.[index]}
              shotPlan={beatPlans?.[index]}
              status={beatStatus?.[index]}
              aspect={aspect}
              frameProps={frameProps}
            />
          ))}
        </CanvasPanel>
      </div>
      {/* One shared WebGL context for every tile above. Mounted only when there is geometry to
          draw, so a visitor who never generates a storyboard never pays for a renderer. */}
      {ordered.some((frame) => frame.scene) && (
        <Suspense fallback={null}>
          <ViewCanvas eventSource={rootRef} />
        </Suspense>
      )}
      {expandedFrame && (
        <FrameModal
          frame={expandedFrame}
          token={token}
          aspect={aspect}
          nameOf={nameOf}
          castAssets={subjectAssets}
          showArt={showArt}
          onClose={() => setExpandedFrame(null)}
        />
      )}
    </>
  );
};

export default StoryboardPanel;
