import { useState } from 'react';
import { Check, ChevronRight, Copy, PenLine, Terminal } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
import HudCard from '../HudCard';
import { RevealOnce } from '../RevealText';
import AgentThought from '../AgentThought';
import { h3Script } from '../../../lib/h3Script';
import { SCREENWRITER } from '../../../hooks/useScreenwriter';
import { cn } from '../../../lib/cn';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.3em] text-slate-500';

const Section = ({ label, children }) => (
  <div className="min-w-0">
    <p className={LABEL}>{label}</p>
    <div className="mt-2 text-sm leading-relaxed text-slate-300">{children}</div>
  </div>
);

const Fold = ({ label, count, icon: Icon, children, tone = 'default' }) => {
  const summary = (
    <>
      <div className="flex items-center gap-2">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-purple-300 transition-transform duration-200 group-open:rotate-90" />
        {Icon && <Icon className="h-3 w-3 shrink-0" />}
        <span className={cn(tone === 'brand' && 'text-purple-300/80')}>{label}</span>
      </div>
      {count != null && <span className="text-slate-600">{count}</span>}
    </>
  );

  return (
    <HudCard summary={summary}>
      <div className={cn('text-sm', tone === 'brand' && 'text-slate-300')}>{children}</div>
    </HudCard>
  );
};

const H3Request = ({ spec }) => {
  const [copied, setCopied] = useState(false);
  const script = h3Script(spec);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failures; the text is on screen.
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="chip mb-3 flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-300 hover:text-white"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="scrollbar-subtle max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-400">
        {script}
      </pre>
    </>
  );
};

/**
 * The settled screenplay: title, logline, beats, and technical fields.
 */
const ScreenplayPanel = ({ spec, cast, analysis, rewriting, live }) => {
  if (!spec) {
    return (
      <CanvasPanel title="Screenplay" icon={PenLine}>
        <p className="py-6 text-center text-xs text-slate-500">
          The screenplay appears here once the Screenwriter finishes drafting.
        </p>
      </CanvasPanel>
    );
  }

  const traced = new Map();
  for (const { beat, from } of spec.intentTrace ?? []) {
    if (!traced.has(beat)) traced.set(beat, []);
    traced.get(beat).push(from);
  }

  const skipped = cast.filter((entry) => analysis?.[entry.key]?.status === 'failed');
  const technical = [
    ['World', spec.world],
    ['Staging', spec.staging],
    ['Continuity', spec.continuity],
    ['Grade', spec.grade],
    ['Guard', spec.guard],
  ].filter(([, value]) => value?.trim());

  const writerStream = live.find((stream) => stream.owner === SCREENWRITER);

  return (
    <CanvasPanel title="Screenplay" icon={PenLine}>
      <div className={cn('space-y-4', rewriting && 'opacity-60')}>
        {/* User intent */}
        <HudCard
          summary={
            <>
              <span className="text-purple-300/80">You asked for</span>
            </>
          }
        >
          <p className="text-sm italic leading-relaxed text-slate-200">
            &ldquo;{spec.intent}&rdquo;
          </p>
          {spec.note && (
            <p className="mt-2 border-t border-white/10 pt-2 text-xs leading-relaxed text-purple-200/70">
              then directed: &ldquo;{spec.note}&rdquo;
            </p>
          )}
        </HudCard>

        {/* Headline */}
        <HudCard>
          <h2 className="text-xl uppercase tracking-tight text-white md:text-2xl">
            <RevealOnce text={spec.title} />
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            <RevealOnce delay={80} text={spec.logline} />
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-widest text-slate-600">
            <span>{spec.duration}s</span>
            <span aria-hidden="true">·</span>
            <span>{spec.resolution}</span>
            <span aria-hidden="true">·</span>
            <span>{spec.ratio}</span>
            <span aria-hidden="true">·</span>
            <span>
              {spec.referencePlan?.length ?? 0}/9 reference
              {spec.referencePlan?.length === 1 ? ' slot' : ' slots'}
            </span>
          </p>
        </HudCard>

        {skipped.length > 0 && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-200">
            {skipped.length === 1 ? 'One piece' : `${skipped.length} pieces`} couldn&rsquo;t be read and{' '}
            {skipped.length === 1 ? 'was' : 'were'} left out.
          </p>
        )}

        {rewriting && writerStream && (
          <AgentThought
            label={`Screenwriter · ${writerStream.phase}`}
            phase={writerStream.phase}
            status="live"
            reasoning={writerStream.reasoning}
            content={writerStream.content}
            compiling={!writerStream.reasoning?.trim() && !writerStream.content?.trim()}
          />
        )}

        {/* Beats */}
        <HudCard summary="Beats">
          <ol className="space-y-3">
            {spec.beats.map((beat, index) => (
              <li key={index} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/10 font-mono text-[10px] font-bold text-slate-300">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p>
                    <RevealOnce delay={120 + index * 60} text={beat} />
                  </p>
                  {traced.has(index + 1) && (
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-600">
                      from {traced.get(index + 1).map((from) => `“${from}”`).join(' · ')}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </HudCard>

        {/* Folds */}
        <div className="space-y-2">
          <Fold label="Camera">
            <RevealOnce delay={300} text={spec.camera} />
          </Fold>

          <div className="grid gap-2 sm:grid-cols-2">
            <Fold label="Sound">
              <RevealOnce delay={360} text={spec.sound} />
            </Fold>
            <Fold label="Music">
              <RevealOnce delay={400} text={spec.music} />
            </Fold>
          </div>

          {spec.notes && (
            <Fold label="From the Screenwriter">
              <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-slate-400">
                <RevealOnce delay={440} text={spec.notes} />
              </p>
            </Fold>
          )}

          {spec.draft && (
            <Fold label="How the Screenwriter got there">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                <RevealOnce delay={100} text={spec.draft} />
              </div>
            </Fold>
          )}

          <Fold label="The technical script" count={technical.length}>
            <div className="space-y-4">
              {technical.map(([label, value], index) => (
                <Section key={label} label={label}>
                  <RevealOnce delay={index * 60} text={value} />
                </Section>
              ))}
            </div>
          </Fold>

          <Fold label="The H3 request" icon={Terminal} tone="brand">
            <H3Request spec={spec} />
          </Fold>
        </div>
      </div>
    </CanvasPanel>
  );
};

export default ScreenplayPanel;
