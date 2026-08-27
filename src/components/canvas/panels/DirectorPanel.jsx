import { useMemo } from 'react';
import { AlertTriangle, Clapperboard, Check, X } from 'lucide-react';

import CanvasPanel from './CanvasPanel';
import { cn } from '../../../lib/cn';
import { MODES } from '../../../../worker/render-budget.js';
import { VERDICTS } from '../../../../worker/screen-test.js';

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
        {risk.measured}
      </p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-600">
        Rule {risk.rule} · {tone.label}
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
          Screen test · {money(risk.estUsd)}
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
      {plan.tests?.length > 0 && (
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-slate-600">
            Worth testing · {money(plan.totalTestUsd)}
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {plan.tests.map((test) => (
              <li key={test.riskId} className="text-[10px] leading-snug text-slate-400">
                <span className="text-slate-300">{test.question ?? test.riskId}</span> — {test.why}
              </li>
            ))}
          </ul>
        </div>
      )}
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
      {plan.ownConcern && (
        <p className="rounded-lg border border-white/10 bg-black/40 p-1.5 text-[10px] leading-snug text-slate-400">
          <span className="font-mono text-[9px] uppercase tracking-wider text-slate-600">Its own hunch · </span>
          {plan.ownConcern.question} — {plan.ownConcern.why}
        </p>
      )}
      {plan.plan && <p className="text-[10px] leading-relaxed text-slate-500">{plan.plan}</p>}
    </div>
  );
};

/** What the tests actually changed. The loop, made visible. */
const Revisions = ({ revisions }) => {
  if (!revisions?.length) return null;
  return (
    <div className="space-y-1 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2">
      <p className="font-mono text-[9px] uppercase tracking-widest text-emerald-300/60">
        {revisions.length} change{revisions.length === 1 ? '' : 's'} from what it learned
      </p>
      {revisions.map((revision, index) => (
        <p key={`${revision.block}-${index}`} className="text-[10px] leading-snug text-slate-400">
          <span className="font-mono text-emerald-200/70">{revision.block}</span> — {revision.why}
        </p>
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
}) => {
  const { plan, planning, envelope, job, phaseLabel, elapsedSeconds, error, running, awaitingApproval } = director;

  const risks = plan?.risks ?? [];
  const blocking = plan?.blocking ?? [];
  const ready = Boolean(plan?.ready) && Boolean(token) && Boolean(spec?.beats?.length);

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
        map[test.riskId] = VERDICTS.find((v) => v.id === test.verdict.answer)?.label ?? test.verdict.answer;
      }
    }
    return map;
  }, [director.screenTests]);

  const cta = awaitingApproval
    ? `Approve ${money(job?.take?.costUsd)}`
    : running
      ? phaseLabel ?? 'Working'
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
          <Revisions revisions={director.revisions} />
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

          {plan && !risks.length && !planning && (
            <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] leading-relaxed text-emerald-200/70">
              Nothing known to be wrong with this one. Every measured hazard was checked and none apply.
            </p>
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
                disabled={!token || running || planning}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {director.shootingPlan ? 'Read it again' : 'Have the Director read it'}
              </button>
            <button
              type="button"
              onClick={() => onShoot?.({ spec, cast, token })}
              disabled={!ready || running || planning}
              className="w-full rounded-xl bg-purple-600 px-2 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
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
