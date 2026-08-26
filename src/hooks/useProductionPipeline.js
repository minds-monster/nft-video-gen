import { useEffect, useMemo } from 'react';
import { PREVIS, SCREENWRITER, STAGE } from './useScreenwriter';
import { STAGE_LABEL } from './useStoryboarder';
import { PHASE_LABEL } from '../components/canvas/AgentThought';
import { resolveNftName } from '../lib/nftMedia';
import { checkStoryboardInput } from '../../worker/tier.js';

/**
 * The run, as five steps, derived from state that already exists.
 *
 * WHY THIS EXISTS: the canvas runs five agents that mount in five different places across two
 * resizable zones, four of which can be collapsed or scrolled out of view. Nothing anywhere
 * said which one was working. The only global cue was a dot reading "telemetry live", which
 * names no agent, no step, and no elapsed time — so the only person who could tell what was
 * happening was the person who wrote it.
 *
 * NOTHING NEW IS PLUMBED. Every field below is read out of useCanvasComposer, useScreenwriter
 * and useStoryboarder as they already are. This is a projection, not a second copy of the
 * truth — which is the only way a status bar can be trusted, since a status bar that can drift
 * from what the panels say is worse than no status bar.
 */

export const STEP = {
  CAST: 'cast',
  READ: 'read',
  REVIEW: 'review',
  WRITE: 'write',
  BLOCK: 'block',
};

/** Step state. `ready` is `idle` that has an action attached — the run's next move. */
export const STATE = {
  IDLE: 'idle',
  READY: 'ready',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
};

/** Which panel a step belongs to, for click-to-focus. Keys match PromptCanvas's panel map. */
const PANEL = {
  cast: 'cast',
  castingDirector: 'castingDirector',
  writersRoom: 'writersRoom',
  screenplay: 'screenplay',
  storyboarder: 'storyboarder',
  storyboard: 'storyboard',
};

/** "41s" / "2m 10s". Seconds alone stops reading as a duration somewhere around ninety. */
export const formatElapsed = (seconds) => {
  if (!seconds || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
};

/** Roll the per-piece casting statuses up into counts once, rather than at four call sites. */
const tallyAnalysis = (analysis) => {
  const values = Object.values(analysis ?? {});
  return {
    total: values.length,
    queued: values.filter((v) => v?.status === 'queued').length,
    casting: values.filter((v) => v?.status === 'casting').length,
    done: values.filter((v) => v?.status === 'done').length,
    failed: values.filter((v) => v?.status === 'failed').length,
    flagged: values.filter((v) => v?.previsFlagged).length,
  };
};

export const useProductionPipeline = ({ composer, screenwriter, storyboarder, token, budget }) => {
  const spec = screenwriter?.spec ?? null;
  const beatCount = spec?.beats?.length ?? 0;
  const loadPlan = storyboarder?.loadPlan;

  // The tier decision, fetched as soon as there is a spec to price and again whenever the
  // budget changes. Lifted here out of StoryboarderPanel so the pipeline bar's Block CTA and
  // the panel's own button quote the same cost, the same time and the same tier — they used
  // to be two independent reads that could disagree, and the one on the button was the only
  // one anybody checked.
  useEffect(() => {
    if (token && beatCount) loadPlan?.({ token, beatCount });
  }, [token, beatCount, budget?.total, budget?.paidTier, loadPlan]);

  const plan = storyboarder?.plan ?? null;

  // Deterministic, budget-aware caps. The API enforces the same check; this mirrors it so a
  // run the free tier would reject cannot even be started.
  const capViolations = useMemo(() => {
    if (!plan || !spec) return [];
    return checkStoryboardInput(plan, spec);
  }, [plan, spec]);
  const capped = capViolations.length > 0;

  const steps = useMemo(() => {
    const cast = composer?.cast ?? [];
    const analysis = screenwriter?.analysis ?? {};
    const streams = screenwriter?.streams ?? {};
    const thoughts = screenwriter?.thoughts ?? {};
    const stage = screenwriter?.stage ?? STAGE.COMPOSE;
    const writerError = screenwriter?.error ?? null;

    const tally = tallyAnalysis(analysis);
    const previsStream = streams[PREVIS];
    const previsThought = thoughts[PREVIS];
    // Once the Previs Supervisor has spoken, a piece that goes back to `casting` is ITS
    // doing — a cold re-read of something it flagged, measured at 60-120s. Attributing that
    // to the Casting Director would show the Read step going backwards and would name the
    // wrong agent for the longest single gap in the run.
    const previsStarted = Boolean(previsStream || previsThought);
    const recasting = previsStarted && tally.casting > 0;

    // --------------------------------------------------------------------------- 1. Cast
    const primaryName = composer?.primary?.nft ? resolveNftName(composer.primary.nft) : null;
    const castStep = {
      id: STEP.CAST,
      label: 'Cast',
      panel: PANEL.cast,
      state: cast.length ? STATE.DONE : STATE.IDLE,
      detail: cast.length
        ? `${cast.length} piece${cast.length === 1 ? '' : 's'}${primaryName ? ` · ${primaryName} leads` : ''}`
        : 'add a piece to begin',
      short: cast.length ? `${cast.length} piece${cast.length === 1 ? '' : 's'}` : null,
      elapsed: null,
      error: null,
      action: null,
    };

    // ---------------------------------------------------------------------------- 2. Read
    const read = tally.done + tally.failed;
    let readState = STATE.IDLE;
    if (tally.total === 0) readState = STATE.IDLE;
    else if (!previsStarted && (tally.casting > 0 || tally.queued > 0)) readState = STATE.RUNNING;
    else if (tally.done === 0 && tally.failed > 0) readState = STATE.FAILED;
    else if (read === tally.total || previsStarted) readState = STATE.DONE;
    else readState = STATE.RUNNING;

    const readStep = {
      id: STEP.READ,
      label: 'Read',
      panel: PANEL.castingDirector,
      state: readState,
      detail: tally.total
        ? `${read} of ${tally.total} read${tally.failed ? ` · ${tally.failed} skipped` : ''}`
        : 'the Casting Director reads each piece',
      short: tally.total ? `${read}/${tally.total}` : null,
      elapsed: null,
      error: readState === STATE.FAILED ? writerError : null,
      action: null,
    };

    // -------------------------------------------------------------------------- 3. Review
    let reviewState = STATE.IDLE;
    if (previsStream || recasting) reviewState = STATE.RUNNING;
    else if (previsThought) reviewState = STATE.DONE;

    const reviewStep = {
      id: STEP.REVIEW,
      label: 'Review',
      panel: PANEL.writersRoom,
      state: reviewState,
      detail: recasting
        ? `re-reading ${tally.casting} piece${tally.casting === 1 ? '' : 's'} it flagged`
        : previsStream
          ? (PHASE_LABEL[previsStream.phase] ?? 'checking the cast against the prompt')
          : previsThought
            ? tally.flagged
              ? `${tally.flagged} still flagged`
              : 'cast checks out'
            : 'the Previs Supervisor checks the cast',
      short: recasting
        ? `re-reading ${tally.casting}`
        : previsStream
          ? 'checking'
          : previsThought
            ? (tally.flagged ? `${tally.flagged} flagged` : 'checked')
            : null,
      elapsed: null,
      error: null,
      action: null,
    };

    // --------------------------------------------------------------------------- 4. Write
    const writerStream = streams[SCREENWRITER];
    const rewriting = Boolean(screenwriter?.rewriting);
    let writeState = STATE.IDLE;
    if (writerStream || rewriting) writeState = STATE.RUNNING;
    else if (spec) writeState = STATE.DONE;
    else if (writerError && tally.done > 0) writeState = STATE.FAILED;
    else if (stage === STAGE.WRITING && previsThought) writeState = STATE.RUNNING;

    const writeStep = {
      id: STEP.WRITE,
      label: 'Write',
      // While it is thinking you want the stream; once it has landed you want the script.
      panel: spec && !writerStream ? PANEL.screenplay : PANEL.writersRoom,
      state: writeState,
      detail: writerStream
        ? (PHASE_LABEL[writerStream.phase] ?? 'thinking the film through')
        : rewriting
          ? 'rewriting to your note'
          : spec
            ? `${spec.beats?.length ?? 0} beat${spec.beats?.length === 1 ? '' : 's'} · ${spec.duration}s`
            : 'the Screenwriter drafts the film',
      short: writerStream
        ? 'writing'
        : rewriting
          ? 'rewriting'
          : spec
            ? `${spec.beats?.length ?? 0} beats`
            : null,
      elapsed: screenwriter?.elapsed ?? null,
      error: writeState === STATE.FAILED ? writerError : null,
      action: null,
    };

    // --------------------------------------------------------------------------- 5. Block
    const frames = storyboarder?.frames ?? [];
    const running = Boolean(storyboarder?.running);
    const boardError = storyboarder?.error ?? null;
    const writtenCast = screenwriter?.writtenCast ?? null;

    let blockState = STATE.IDLE;
    if (running) blockState = STATE.RUNNING;
    else if (boardError) blockState = STATE.FAILED;
    else if (frames.length) blockState = STATE.DONE;
    else if (spec) blockState = STATE.READY;

    // The reason a disabled button is disabled, said out loud. A dead control with no
    // explanation is the single most common way this canvas stopped a visitor cold.
    let blockedReason = null;
    if (blockState === STATE.READY) {
      if (!token) blockedReason = 'Connect your Mind to enable the Storyboarder.';
      else if (!writtenCast?.length) blockedReason = 'Waiting for the written cast.';
      else if (capped) blockedReason = capViolations.map((v) => v.detail).join(' ');
    }

    const planSummary = plan
      ? [
          plan.label,
          plan.estimateUsd > 0 ? `~$${plan.estimateUsd.toFixed(2)}` : 'no cost',
          plan.estimateSeconds
            ? `~${Math.round(plan.estimateSeconds / 60)}–${Math.round(plan.estimateSeconds / 60) + 2} min`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;

    const blockStep = {
      id: STEP.BLOCK,
      label: 'Block',
      panel: running || frames.length ? PANEL.storyboard : PANEL.storyboarder,
      state: blockState,
      detail: running
        ? (storyboarder?.stageLabel ?? STAGE_LABEL[storyboarder?.phase] ?? 'working')
        : frames.length
          ? `${frames.length} beat${frames.length === 1 ? '' : 's'} blocked`
          : blockState === STATE.READY
            ? (planSummary ?? 'ready to block')
            : 'the Storyboarder blocks each shot',
      short: running
        ? 'blocking'
        : frames.length
          ? `${frames.length} beats`
          : blockState === STATE.READY
            ? 'ready'
            : null,
      elapsed: running ? (storyboarder?.elapsedSeconds ?? 0) : null,
      error: boardError,
      action:
        blockState === STATE.READY
          ? {
              label: capped ? 'Scene exceeds tier limits' : 'Send to Storyboarder',
              disabled: Boolean(blockedReason),
              reason: blockedReason,
              hint: planSummary,
              onClick: () => {
                if (blockedReason || !spec || !writtenCast?.length || !token) return;
                storyboarder.run({ spec, cast: writtenCast, token });
              },
            }
          : null,
    };

    return [castStep, readStep, reviewStep, writeStep, blockStep];
  }, [composer, screenwriter, storyboarder, token, plan, capped, capViolations, spec]);

  // What each panel should say about itself, keyed by panel. CanvasPanel renders this in its
  // header AND in its collapsed strip, so shutting a panel never hides the fact that
  // something inside it is working.
  const panelStatus = useMemo(() => {
    const byPanel = {};
    for (const step of steps) {
      // SILENT UNTIL IT HAS SOMETHING TO SAY. A panel header is 400px of shared space holding
      // a title, a status and a chevron; filling it with the same sentence the pipeline bar is
      // already showing ("the Casting Director reads each piece") pushed the panel's own NAME
      // into an ellipsis to make room for a restatement of the obvious. The bar carries the
      // prose; the header carries the number.
      if (step.state === STATE.IDLE) continue;
      // Later steps win a shared panel (Review and Write both live in the Writers' room),
      // because the later one is the one currently holding the run.
      byPanel[step.panel] = {
        tone: step.state === STATE.READY ? 'idle' : step.state,
        text: (step.elapsed ? formatElapsed(step.elapsed) : null) ?? step.short ?? null,
        title: step.error || step.detail,
      };
    }
    return byPanel;
  }, [steps]);

  const active = steps.find((step) => step.state === STATE.RUNNING) ?? null;
  const failed = steps.find((step) => step.state === STATE.FAILED) ?? null;

  return { steps, panelStatus, active, failed, plan, capped, capViolations };
};
