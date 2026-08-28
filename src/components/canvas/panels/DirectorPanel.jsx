import { useMemo } from 'react';
import { AlertTriangle, Clapperboard, Check, X } from 'lucide-react';

import CanvasPanel from './CanvasPanel';
import { cn } from '../../../lib/cn';
import { MODES } from '../../../../worker/render-budget.js';
import { verdictLabel } from '../../../../worker/screen-test.js';

/**
 * The Director's own rail, under the Cast.
 *
 * NARROW ON PURPOSE, because it has to be: the left zone is 18% of the canvas — about 250px —
 * and everything here sits on the existing micro-type ladder rather than fighting for width.
 *
 * The panel's best idea is the risk register. A visitor watching named hazards move from open to
 * settled, each carrying the price it cost to settle, is the entire product argument made
 * visible: this is what your money bought, and here is what it told us. The alternative — a
 * spinner and a bill — is what every other tool does.
 */

const money = (value) => (value == null ? null : `$${Number(value).toFixed(2)}`);

/** "41s" / "2m 10s" — seconds alone stops reading as a duration somewhere around ninety. */
const elapsed = (seconds) => {
  if (!seconds || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
};

const SEVERITY = {
  floor: { dot: 'bg-amber-400', label: 'blocks the shoot', text: 'text-amber-300' },
  hazard: { dot: 'bg-purple-400', label: 'worth testing', text: 'text-slate-300' },
  note: { dot: 'bg-slate-600', label: 'worth knowing', text: 'text-slate-400' },
};

/**
 * One named hazard, with what it costs to settle.
 *
 * `measured` is shown on demand rather than hidden away, because it is the difference between a
 * warning and a fact. "A full-length reference was measured losing its subject's face" is a
 * reason to spend $0.32; "this might not work" is not.
 */
const Risk = ({ risk, onTest, settled, busy }) => {
  const tone = SEVERITY[risk.severity] ?? SEVERITY.note;
  return (
    <details className="group rounded-xl border border-white/10 bg-black/30 p-2">
      <summary className="flex cursor-pointer list-none items-start gap-1.5">
        <span
          className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)}
          title={risk.elevatedBy ? `You asked to be sure of: ${risk.elevatedBy}` : undefined}
        />
        <span className={cn('min-w-0 flex-1 text-[11px] leading-snug', tone.text)}>{risk.what}</span>
        {risk.estUsd > 0 && (
          <span className="shrink-0 font-mono text-[9px] text-slate-500">{money(risk.estUsd)}</span>
        )}
      </summary>
      <p className="mt-1.5 border-t border-white/5 pt-1.5 text-[10px] leading-relaxed text-slate-500">
        {risk.source === 'director' ? risk.judgement : risk.measured}
      </p>
      {/* A rehearsal renders the beat as the Director restated it. Shown because it IS the test:
          what the model is told to do physically, and what it is told not to fake. */}
      {risk.test?.direction && (
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          <span className="font-mono text-[9px] uppercase tracking-wider text-slate-600">The rehearsal · </span>
          {risk.test.direction}
        </p>
      )}
      <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-600">
        {risk.source === 'director' ? 'The Director’s own judgement' : `Rule ${risk.rule}`} · {tone.label}
        {risk.elevatedBy ? <span className="text-purple-300/60"> · you asked for this</span> : null}
      </p>

      {/* A hazard you can pay to settle, priced on the button. A hazard fixed by rewriting gets
          no button at all — paying to watch MiniMax reject a brand name would be absurd, and
          offering it would imply otherwise. */}
      {risk.test && !settled && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onTest?.(risk.id)}
          className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-slate-300 transition-colors hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {risk.test.focus === 'rehearsal' ? 'Rehearse' : 'Screen test'} · {money(risk.estUsd)}
        </button>
      )}
      {settled && (
        <p className="mt-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-[10px] text-emerald-200/80">
          Settled — {settled}
        </p>
      )}
      {!risk.test && (
        <p className="mt-1.5 font-mono text-[9px] uppercase tracking-wider text-slate-600">
          Fixed by {risk.fix?.replace(/-/g, ' ') ?? 'changing the script'}, not by spending
        </p>
      )}
    </details>
  );
};

/**
 * The Director thinking, live.
 *
 * The same treatment the Storyboarder already uses — a short tail of the reasoning rather than the
 * whole transcript. Reading four lines of a mind working is legible; reading four hundred is a log
 * file, and a visitor scrolling a log file is not watching anything.
 */
const ThinkingStream = ({ text }) => {
  if (!text?.trim()) return null;
  const tail = text.split('\n').filter((line) => line.trim()).slice(-4).join('\n');
  return (
    <p className="scrollbar-subtle max-h-20 overflow-hidden whitespace-pre-wrap rounded-xl border border-white/5 bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-sky-300/70">
      {tail}
    </p>
  );
};

/**
 * What the Director decided, and what it decided against.
 *
 * `skip` is shown as prominently as `tests`, deliberately. A visitor being asked to spend money is
 * owed the things it chose NOT to spend it on — that is what makes a proposal a judgement rather
 * than a list of everything it could bill for.
 */
const ShootingPlan = ({ plan }) => {
  if (!plan) return null;
  return (
    <div className="space-y-1.5 rounded-xl border border-white/10 bg-black/30 p-2">
      {plan.reading && <p className="text-[11px] leading-relaxed text-slate-300">{plan.reading}</p>}
      {plan.skip?.length > 0 && (
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-slate-600">Not testing</p>
          <ul className="mt-0.5 space-y-0.5">
            {plan.skip.map((entry) => (
              <li key={entry.riskId} className="text-[10px] leading-snug text-slate-500">{entry.why}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.plan && <p className="text-[10px] leading-relaxed text-slate-500">{plan.plan}</p>}
    </div>
  );
};

/** How each asked-for test stands, from worker/director-gate.js. */
const TEST_STATE = {
  unshot: { label: 'Not yet run', cls: 'border-white/10 text-slate-400' },
  'render-failed': { label: 'Render failed', cls: 'border-rose-400/30 text-rose-300' },
  unjudged: { label: 'Came back — answer it', cls: 'border-amber-400/30 text-amber-300' },
  failed: { label: 'Failed — run again', cls: 'border-rose-400/30 text-rose-300' },
  retest: { label: 'Re-test asked for', cls: 'border-amber-400/30 text-amber-300' },
  cleared: { label: 'Held', cls: 'border-emerald-400/30 text-emerald-300' },
};

/**
 * What the Director asked for, and where each ask stands.
 *
 * THIS IS THE BLOCK THE HOLLYWOOD FILM NEVER HAD. The Director's tests used to be a list under
 * "worth testing" with a $0.32 button hidden inside each hazard; a visitor could — and did — go
 * straight to Shoot. Now the asks are one list with one button that runs them all, the Shoot
 * button says how many are owed, and the server refuses to shoot until they are answered
 * (worker/director-gate.js). A test the Director asked for is a precondition, not a suggestion.
 */
const AskedTests = ({ plan, gate, onRunAll, onAnswer, busy, batch }) => {
  const asked = gate?.asked ?? [];
  if (!asked.length) return null;
  // Two different next moves, and the difference cost $2.40 in five identical rehearsals: a
  // clip that came back is ANSWERED (free, in the viewer); only a question with no clip, or a
  // failed one, is RUN. Answering always comes first, because spending again while an answer is
  // owed is exactly the loop this block exists to break.
  const unanswered = gate.unanswered ?? [];
  const toRun = gate.toRun ?? [];
  const whyFor = (riskId) =>
    plan?.tests?.find((test) => test.riskId === riskId)?.why ??
    plan?.demands?.find((demand) => `demand:${demand.id}` === riskId)?.why ??
    null;

  return (
    <div className="space-y-1.5 rounded-xl border border-purple-500/25 bg-purple-950/15 p-2">
      <p className="font-mono text-[9px] uppercase tracking-widest text-purple-300/70">
        The Director asks for · {money(asked.reduce((sum, test) => sum + (test.estUsd ?? 0), 0))}
      </p>
      <ul className="space-y-1.5">
        {asked.map((test) => {
          // A clip waiting to be watched outranks whatever the last answer was.
          const pill =
            test.state !== 'cleared' && test.unansweredCount > 0
              ? TEST_STATE.unjudged
              : TEST_STATE[test.state] ?? TEST_STATE.unshot;
          const label = test.state === 'cleared' && test.answer && test.answer !== 'held' ? 'Cannot tell' : pill.label;
          const why = whyFor(test.riskId);
          return (
            <li key={test.riskId} className="text-[10px] leading-snug text-slate-400">
              <div className="flex items-start justify-between gap-1.5">
                <span className="min-w-0 flex-1 text-slate-200">{test.question ?? test.riskId}</span>
                <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold', pill.cls)}>
                  {label}
                </span>
              </div>
              {why && <p className="mt-0.5 text-slate-500">{why}</p>}
              {test.failedReason && (
                <p className="mt-1 rounded-lg border border-rose-400/20 bg-rose-500/5 p-1.5 text-[10px] leading-snug text-rose-200/80">
                  {test.failedReason}
                </p>
              )}
              {test.finding && (
                <p className="mt-1 rounded-lg border border-white/10 bg-black/40 p-1.5 text-[10px] leading-snug text-slate-300">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-slate-600">Read back · </span>
                  {test.finding}
                  {test.revised ? <span className="text-emerald-200/70"> — changed {test.revised.block}.</span> : null}
                </p>
              )}
              <p className="mt-0.5 font-mono text-[9px] text-slate-600">
                {test.source === 'director' ? 'its own judgement' : 'measured'} · {money(test.estUsd)}
              </p>
            </li>
          );
        })}
      </ul>
      {batch ? (
        <p className="font-mono text-[10px] text-sky-300/70">
          Running {Math.min(batch.done + 1, batch.total)} of {batch.total} — {batch.current}
        </p>
      ) : unanswered.length > 0 ? (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => onAnswer?.(unanswered[0].unansweredTakeId)}
            className="w-full rounded-xl bg-amber-500/90 px-2 py-2 text-[11px] font-semibold text-black transition-colors hover:bg-amber-400"
          >
            Watch and answer the test that came back
          </button>
          <p className="text-[10px] leading-snug text-slate-500">
            Free. The Director reads your answer — and anything you type with it — before it
            changes a word of the script. Nothing more is run until this is answered.
          </p>
        </div>
      ) : toRun.length > 0 ? (
        <button
          type="button"
          disabled={busy}
          onClick={onRunAll}
          className="w-full rounded-xl bg-purple-600 px-2 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
        >
          Run the Director’s {toRun.length} test{toRun.length === 1 ? '' : 's'} · {money(gate.outstandingUsd)}
        </button>
      ) : (
        <p className="text-[10px] leading-relaxed text-emerald-200/70">
          Every test answered. The Director can shoot this with authority.
        </p>
      )}
    </div>
  );
};

/**
 * What the Director changed. The loop, made visible — and reversible.
 *
 * Every row has a ✕, because on 2026-08-28 a visitor watched "the Hollywood sign" get rewritten
 * out of a film about the Hollywood sign and had no way to take it back. The replacement text is
 * shown on demand: "removes the prohibited brand name" is a claim, and the visitor is owed the
 * evidence.
 */
const Revisions = ({ revisions, onDrop, busy }) => {
  if (!revisions?.length) return null;
  return (
    <div className="space-y-1 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2">
      <p className="font-mono text-[9px] uppercase tracking-widest text-emerald-300/60">
        {revisions.length} change{revisions.length === 1 ? '' : 's'} from what it learned
      </p>
      {revisions.map((revision, index) => (
        <details key={`${revision.block}-${revision.at ?? index}`} className="group">
          <summary className="flex cursor-pointer list-none items-start gap-1.5 text-[10px] leading-snug text-slate-400">
            <span className="min-w-0 flex-1">
              <span className="font-mono text-emerald-200/70">{revision.block}</span> — {revision.why}
              {revision.free ? null : <span className="text-slate-600"> · from a test</span>}
            </span>
            {onDrop && revision.at != null && (
              <button
                type="button"
                disabled={busy}
                aria-label="Drop this change"
                title="Take this change back off the script"
                onClick={(event) => {
                  event.preventDefault();
                  onDrop(revision.at);
                }}
                className="shrink-0 rounded px-1 text-slate-500 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </summary>
          {revision.text && (
            <p className="mt-1 whitespace-pre-wrap border-t border-white/5 pt-1 text-[10px] leading-relaxed text-slate-500">
              {revision.text}
            </p>
          )}
        </details>
      ))}
    </div>
  );
};

/** The money. Mode first, because it decides what every other number here means. */
const Budget = ({ envelope, mode, setMode, allowanceUsd, setAllowance, readOnly }) => {
  const spec = MODES[mode] ?? MODES.ask;
  const spent = envelope?.spentUsd ?? 0;
  const allowance = envelope?.allowanceUsd ?? (spec.needsAllowance ? allowanceUsd : null);
  const fraction = allowance ? Math.min(1, spent / allowance) : 0;

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-2">
      <label className="block">
        <span className="font-mono text-[9px] uppercase tracking-widest text-slate-600">Budget</span>
        <select
          value={mode}
          disabled={readOnly}
          onChange={(event) => setMode(event.target.value)}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white outline-none disabled:opacity-50"
        >
          {Object.values(MODES).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[10px] leading-relaxed text-slate-500">{spec.blurb}</p>

      {spec.needsAllowance && (
        <label className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-widest text-slate-600">On this film</span>
          <span className="text-[11px] text-slate-400">$</span>
          <input
            type="number"
            min="1"
            step="1"
            value={envelope?.allowanceUsd ?? allowanceUsd}
            disabled={readOnly || Boolean(envelope?.allowanceUsd)}
            onChange={(event) => setAllowance(Number(event.target.value))}
            className="w-16 rounded-lg border border-white/10 bg-black/40 px-1.5 py-0.5 text-[11px] text-white outline-none disabled:opacity-50"
          />
        </label>
      )}

      {allowance != null && (
        <div>
          <div className="h-1 overflow-hidden rounded-full bg-white/5">
            <div
              className={cn('h-full rounded-full transition-all', fraction > 0.8 ? 'bg-amber-400' : 'bg-purple-500')}
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          <p className="mt-1 font-mono text-[9px] text-slate-500">
            {money(spent)} of {money(allowance)} spent
            {envelope?.releasedUsd ? ` · ${money(envelope.releasedUsd)} released` : ''}
          </p>
        </div>
      )}
    </div>
  );
};

const DirectorPanel = ({
  id,
  director,
  spec,
  cast,
  token,
  collapsed,
  onToggle,
  status,
  onShoot,
  onAnswerTest,
}) => {
  const { plan, planning, envelope, job, phaseLabel, elapsedSeconds, error, running, awaitingApproval } = director;

  const risks = plan?.risks ?? [];
  const blocking = plan?.blocking ?? [];
  const ready = Boolean(plan?.ready) && Boolean(token) && Boolean(spec?.beats?.length);
  // Legal to send is not the same as informed enough to pay for. `ready` is the first; the gate
  // is the second, and the server refuses a Shoot that fails it (worker/director-gate.js).
  const gate = plan?.gate ?? null;
  const outstanding = gate?.outstanding?.length ?? 0;
  const cleared = Boolean(gate?.cleared);
  const batching = Boolean(director.batch);

  const settled = useMemo(
    () => (director.finalTakes ?? []).filter((take) => take.status === 'ready').length,
    [director.finalTakes],
  );

  // Which hazards a Screen Test has already answered, so the register RETIRES rather than just
  // growing. Watching named risks turn from open to settled, each carrying what it cost, is the
  // whole argument this panel exists to make.
  const answeredByRisk = useMemo(() => {
    const map = {};
    for (const test of director.screenTests ?? []) {
      if (test.riskId && test.verdict?.answer) {
        map[test.riskId] = verdictLabel(test, test.verdict.answer);
      }
    }
    return map;
  }, [director.screenTests]);

  const cta = awaitingApproval
    ? `Approve ${money(job?.take?.costUsd)}`
    : running
      ? phaseLabel ?? 'Working'
      : gate?.unread
        ? 'Shoot · read it first'
        : outstanding
          ? `Shoot · ${outstanding} test${outstanding === 1 ? '' : 's'} outstanding`
          : `Shoot · ${money(plan?.estimate?.finalUsd) ?? '—'}`;

  return (
    <CanvasPanel
      id={id}
      title="Director"
      icon={Clapperboard}
      bodyClassName="flex flex-col gap-2"
      collapsed={collapsed}
      onToggle={onToggle}
      status={status}
    >
      {!spec?.beats?.length ? (
        <p className="py-4 text-center text-[11px] text-slate-500">
          Write a screenplay and the Director will price it.
        </p>
      ) : (
        <>
          {/* The scope, once the visitor has accepted one. Shown above the money because it is
              what the money is FOR — and because `must hold` visibly reorders the register below,
              so a visitor can see their own words doing work. */}
          {director.brief && (
            <div className="rounded-xl border border-purple-500/20 bg-purple-950/15 p-2">
              <p className="font-mono text-[9px] uppercase tracking-widest text-purple-300/60">Scope</p>
              {director.brief.intent && (
                <p className="mt-0.5 text-[11px] leading-snug text-slate-300">{director.brief.intent}</p>
              )}
              {director.brief.mustHold?.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {director.brief.mustHold.map((item) => (
                    <li key={item} className="flex items-start gap-1 text-[10px] leading-snug text-slate-400">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-purple-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {director.reading?.reading && !director.shootingPlan && (
            <p className="rounded-xl border border-white/10 bg-black/30 p-2 text-[11px] leading-relaxed text-slate-300">
              {director.reading.reading}
            </p>
          )}
          <ShootingPlan plan={director.shootingPlan} />
          <AskedTests
            plan={director.shootingPlan}
            gate={gate}
            batch={director.batch}
            busy={running || awaitingApproval || planning || !token}
            onRunAll={() => director.runTests?.({ spec, cast, token })}
            onAnswer={onAnswerTest}
          />
          <Revisions
            revisions={director.revisions}
            busy={running || awaitingApproval || planning || batching}
            onDrop={(at) => director.dropRevision?.({ at })}
          />
          <ThinkingStream text={director.thinking} />

          <Budget
            envelope={envelope}
            mode={director.mode}
            setMode={director.setMode}
            allowanceUsd={director.allowanceUsd}
            setAllowance={director.setAllowance}
            readOnly={running || awaitingApproval}
          />

          {/* What the money buys, before any of it is spent. The ceiling is shown beside the
              render itself so a Screen Test reads as a decision rather than an upsell. */}
          {plan && (
            <dl className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/30 p-2 font-mono text-[9px]">
              <dt className="text-slate-600">This take</dt>
              <dd className="text-right text-slate-300">{money(plan.estimate?.finalUsd)}</dd>
              <dt className="text-slate-600">Tests, at most</dt>
              <dd className="text-right text-slate-400">{money(plan.estimate?.testsCeilingUsd)}</dd>
              <dt className="text-slate-600">Typical wait</dt>
              <dd className="text-right text-slate-400">{elapsed(plan.estimate?.seconds?.p50)}</dd>
              <dt className="text-slate-600">Shot from</dt>
              <dd className="text-right text-slate-400">{plan.script?.source}</dd>
            </dl>
          )}

          {/* The register. Floor violations first, because they are what stops the shoot. */}
          {risks.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-mono text-[9px] uppercase tracking-widest text-slate-600">
                {blocking.length ? `${blocking.length} blocking · ` : ''}
                {risks.length} to settle
              </p>
              {risks.map((risk) => (
                <Risk
                  key={risk.id}
                  risk={risk}
                  settled={answeredByRisk[risk.id]}
                  busy={running || awaitingApproval}
                  onTest={(riskId) => director.runTest({ spec, cast, token, riskId })}
                />
              ))}
            </div>
          )}

          {/* An empty register is NOT a clean bill of health, and it must never read as one again.
              The register knows the artwork; only a reading knows the prompt. */}
          {plan && !risks.length && !planning && (
            gate?.unread ? (
              <p className="rounded-xl border border-white/10 bg-black/30 p-2 text-[10px] leading-relaxed text-slate-400">
                Nothing in the measured register applies — which says nothing about what the prompt
                asks the model to do. Have the Director read it before spending.
              </p>
            ) : (
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] leading-relaxed text-emerald-200/70">
                The Director read the prompt and the register, and asked for no tests.
              </p>
            )
          )}

          {/* Live. `elapsedSeconds` is the worker's clock where it has one, so joining late shows
              the real wait rather than restarting it. */}
          {(running || awaitingApproval) && (
            <div className="rounded-xl border border-purple-500/20 bg-purple-950/20 p-2">
              <p className="font-mono text-[10px] text-sky-300/70">
                {phaseLabel ?? 'Waiting for approval'}
                {elapsedSeconds ? ` · ${elapsed(elapsedSeconds)}` : ''}
              </p>
              {job?.take?.taskId && (
                <p className="mt-1 font-mono text-[9px] text-slate-600">task {job.take.taskId}</p>
              )}
            </div>
          )}

          {error && (
            <p className="flex items-start gap-1.5 rounded-xl border border-amber-400/20 bg-amber-500/5 p-2 text-[10px] leading-relaxed text-amber-200/80">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          {/* The gate, refusing. Only after a refusal is "shoot anyway" offered — a visitor who
              wants to spend past the Director's questions may, and the take will say they did. */}
          {director.refusal && !running && !awaitingApproval && (
            <div className="space-y-1.5 rounded-xl border border-amber-400/20 bg-amber-500/5 p-2">
              <p className="text-[10px] leading-relaxed text-amber-200/80">{director.refusal.detail}</p>
              <button
                type="button"
                onClick={() => director.shootAnyway?.({ spec, cast, token })}
                disabled={!ready || batching}
                className="w-full rounded-lg border border-amber-400/30 px-2 py-1 text-[10px] text-amber-200 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Shoot anyway · {money(plan?.estimate?.finalUsd)}
              </button>
            </div>
          )}

          {awaitingApproval ? (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => director.decide(true)}
                className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-purple-600 px-2 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-purple-500"
              >
                <Check className="h-3 w-3" />
                {cta}
              </button>
              <button
                type="button"
                onClick={() => director.decide(false)}
                aria-label="Decline this take"
                className="chip px-2 py-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* Free, so it is never behind the money gate — and offered before Shoot because
                  reading the film first is the whole method this Director is executing. */}
              <button
                type="button"
                onClick={() => director.assess({ spec, cast, token })}
                disabled={!token || running || planning || batching}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {director.shootingPlan ? 'Read it again' : 'Have the Director read it'}
              </button>
            {/* Primary only once the gate is clear. Before that it is still pressable — the
                server refuses, says why, and the override appears — but it is not the button
                the panel is pointing at; "Run the Director's tests" is. */}
            <button
              type="button"
              onClick={() => onShoot?.({ spec, cast, token })}
              disabled={!ready || running || planning || batching}
              className={cn(
                'w-full rounded-xl px-2 py-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600',
                cleared
                  ? 'bg-purple-600 text-white hover:bg-purple-500'
                  : 'border border-white/10 bg-black/40 text-slate-400 hover:text-white',
              )}
            >
              {cta}
            </button>
            </div>
          )}

          {(settled > 0 || (director.screenTests ?? []).length > 0) && (
            <p className="text-center font-mono text-[9px] uppercase tracking-widest text-slate-600">
              {(director.screenTests ?? []).length > 0 &&
                `${director.screenTests.length} test${director.screenTests.length === 1 ? '' : 's'}`}
              {settled > 0 && (director.screenTests ?? []).length > 0 ? ' · ' : ''}
              {settled > 0 && `${settled} take${settled === 1 ? '' : 's'} in Dailies`}
            </p>
          )}
        </>
      )}
    </CanvasPanel>
  );
};

export default DirectorPanel;
