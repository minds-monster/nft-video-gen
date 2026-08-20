import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ChevronRight,
  Clapperboard,
  Check,
  Clock,
  Copy,
  Eye,
  PenLine,
  RotateCcw,
  Send,
  Terminal,
} from 'lucide-react';
import AgentThought from './AgentThought';
import CastingLog from './CastingLog';
import HudCard from './HudCard';
import { RevealOnce } from './RevealText';
import { STAGE, SCREENWRITER } from '../../hooks/useScreenwriter';
import { h3Script } from '../../lib/h3Script';
import { cn } from '../../lib/cn';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.3em] text-slate-500';

/** A labelled block of the spec. */
const Section = ({ label, children }) => (
  <div className="min-w-0">
    <p className={LABEL}>{label}</p>
    <div className="mt-2 text-sm leading-relaxed text-slate-300">{children}</div>
  </div>
);

/**
 * A fold. Native <details> rather than state-driven markup: it is keyboard accessible and
 * findable by in-page search for free, which a div pretending to be a disclosure is not.
 * Wrapped in HudCard so every dropdown menu shares the same HUD chrome.
 */
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

/* ------------------------------------------------------------------ waiting */

// Human-readable labels for the phases the user watches. These are intentionally verbs,
// because the whole surface is about revealing work as it happens.
const PHASE_LABEL = {
  looking: 'reading the artwork',
  watching: 'watching its film',
  formalising: 'writing it up',
  drafting: 'thinking the film through',
};

// Tool-call / video phases have no token stream, so we render a cycling glyph field to keep
// the card alive instead of going silent.
const COMPILES = ['formalising', 'watching'];

const formatElapsed = (seconds) => {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
};

const PhasePill = ({ label, state }) => (
  <span
    className={cn(
      'flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest transition-colors',
      state === 'done' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      state === 'active' && 'border-purple-500/40 bg-purple-500/15 text-purple-200',
      state === 'pending' && 'border-white/10 bg-white/[0.03] text-slate-600',
    )}
  >
    <span
      className={cn(
        'h-1.5 w-1.5 rounded-full',
        state === 'done' && 'bg-emerald-400',
        state === 'active' && 'animate-pulse bg-purple-400',
        state === 'pending' && 'bg-slate-700',
      )}
    />
    {label}
  </span>
);

const MissionClock = ({ elapsed, settled, total, phaseName }) => (
  <div className="flex flex-col items-center gap-2 text-center">
    <div className="flex items-center gap-2 font-mono text-2xl tracking-tight text-white">
      <Clock className="h-5 w-5 text-purple-400" />
      {formatElapsed(elapsed)}
    </div>
    <p className="max-w-md text-sm font-medium text-slate-300">{phaseName}</p>
    <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
      {total > 0 && `${settled} of ${total} pieces read · `}
      live telemetry
    </p>
  </div>
);

/**
 * The HUD dashboard shown while agents are working.
 *
 * No spinners. Every piece that has started gets a persistent AgentThought card. Live cards
 * stream reasoning; settled cards fold but stay in the log. The log is scrollable so a long
 * cast never pushes the rest of the canvas away.
 */
const Working = ({ analysis, cast, elapsed, live, thoughts, streams }) => {
  const states = Object.values(analysis);
  const total = states.length;
  const settled = states.filter((a) => a.status === 'done' || a.status === 'failed').length;
  const castingDone = total > 0 && settled === total;

  const writerStream = live.find((stream) => stream.owner === SCREENWRITER);
  const writerActive = Boolean(writerStream);

  // Timeline state: compose is always done by the time we reach Working.
  const timeline = [
    { key: 'compose', label: 'Compose', state: 'done' },
    {
      key: 'cast',
      label: 'Cast',
      state: total === 0 ? 'pending' : castingDone ? 'done' : 'active',
    },
    {
      key: 'write',
      label: 'Write',
      state: writerActive ? 'active' : castingDone ? 'done' : 'pending',
    },
    { key: 'treatment', label: 'Treatment', state: 'pending' },
  ];

  const phaseName = writerActive
    ? 'The Screenwriter is drafting your film'
    : total > 0
      ? `The Casting Director is reading the cast`
      : 'Establishing agent telemetry';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {/* Phase timeline */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {timeline.map((item, index) => (
          <div key={item.key} className="flex items-center gap-2">
            <PhasePill label={item.label} state={item.state} />
            {index < timeline.length - 1 && (
              <span
                className={cn(
                  'hidden h-px w-4 sm:block',
                  item.state === 'done' ? 'bg-emerald-500/40' : 'bg-white/10',
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Mission clock */}
      <MissionClock elapsed={elapsed} settled={settled} total={total} phaseName={phaseName} />

      {/* Persistent scrollable agent log: live cards expand, settled cards fold. */}
      {(total > 0 || writerActive) && (
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          <CastingLog cast={cast} analysis={analysis} streams={streams} thoughts={thoughts} />
        </div>
      )}
    </div>
  );
};

const Failure = ({ error, onRetry, onBack }) => (
  <div className="flex flex-col items-center gap-4 py-10 text-center">
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/15 text-red-300">
      <AlertTriangle className="h-5 w-5" />
    </span>
    <div>
      <p className="text-sm font-semibold text-white">The Screenwriter couldn&rsquo;t finish</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">{error}</p>
    </div>
    <div className="flex gap-2">
      <button type="button" onClick={onBack} className="chip px-4 py-2 text-xs text-slate-300 hover:text-white">
        Back to the canvas
      </button>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Try again
      </button>
    </div>
  </div>
);

/* ---------------------------------------------------------------- the script */

const H3Request = ({ spec }) => {
  const [copied, setCopied] = useState(false);
  const script = h3Script(spec);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is permission-gated and refuses outright in some contexts. The text is on
      // screen and selectable, so a failed copy is a minor inconvenience, not an error worth
      // interrupting the page for.
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
      {/* The exact string h3Script() produces — the same function the renderer will call, so
          what you copy is what would be sent. */}
      <pre className="scrollbar-subtle max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-400">
        {script}
      </pre>
    </>
  );
};

/* ------------------------------------------------------------ direct the writer */

const Direct = ({ onRewrite, rewriting }) => {
  const [note, setNote] = useState('');
  const submit = () => {
    const text = note.trim();
    if (!text || rewriting) return;
    onRewrite(text);
    setNote('');
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <p className={LABEL}>Direct the writer</p>
      <div className="mt-2 flex items-start gap-2">
        <textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Keep it one unbroken take. Lose the rain."
          aria-label="Give the Screenwriter a note and rewrite"
          className="scrollbar-subtle min-w-0 flex-1 resize-none bg-transparent text-sm leading-relaxed text-white outline-none placeholder:text-slate-600"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!note.trim() || rewriting}
          aria-label="Rewrite with this note"
          className="flex shrink-0 items-center justify-center rounded-lg bg-purple-600 p-2 text-white transition-colors hover:bg-purple-500 disabled:bg-purple-600/40 disabled:text-white/50"
        >
          <Send className={cn('h-4 w-4', rewriting && 'animate-pulse')} />
        </button>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
        Around half a minute — the cast has already been read, so only the script changes.
      </p>
    </div>
  );
};

/* -------------------------------------------------------------- the treatment */

const Treatment = ({ spec, cast, analysis, onBack, onRewrite, rewriting, live, streams, thoughts }) => {
  // Grouped, not a Map. A real run returned ten trace entries for five beats — every beat
  // traced to both "a slow dolly around it" and "neon rain" — and keying a Map by beat threw
  // all but the last away, silently defeating the one field that exists to make drift visible.
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
    <div className={cn('mx-auto w-full max-w-3xl space-y-5 pb-4', rewriting && 'opacity-60')}>
      {/* 1. The user's original prompt, always reachable at the top. */}
      <HudCard
        summary={
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-purple-300 transition-transform duration-200 group-open:rotate-90" />
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

      {/* 2. The headline spec — the main body, immediately visible. */}
      <HudCard>
        <h2 className="text-2xl uppercase tracking-tight text-white md:text-3xl">
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

        {/* 3. Story beats. */}
        <div className="mt-5">
          <Section label="Beats">
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
          </Section>
        </div>
      </HudCard>

      {/* Cast dropouts — only shown if something failed. */}
      {skipped.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {cast.length - skipped.length} of {cast.length} pieces made it into the film.{' '}
            {skipped.length === 1 ? 'One piece' : `${skipped.length} pieces`} couldn&rsquo;t be
            read and {skipped.length === 1 ? 'was' : 'were'} left out.
          </span>
        </p>
      )}

      {/* 4. Direct the writer — the main action. */}
      {rewriting && writerStream && (
        <AgentThought
          label={`Screenwriter · ${PHASE_LABEL[writerStream.phase] ?? writerStream.phase}`}
          phase={writerStream.phase}
          status="live"
          reasoning={writerStream.reasoning}
          content={writerStream.content}
          compiling={COMPILES.includes(writerStream.phase) && !writerStream.reasoning && !writerStream.content}
        />
      )}

      <Direct onRewrite={onRewrite} rewriting={rewriting} />

      {/* 5–10. Trimming: everything else folded by default in the same HUD style. */}
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

        <HudCard
          summary={
            <>
              <div className="flex items-center gap-2">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-purple-300 transition-transform duration-200 group-open:rotate-90" />
                <Eye className="h-3 w-3 shrink-0" />
                <span>What the Casting Director saw</span>
              </div>
              <span className="text-slate-600">{cast.length}</span>
            </>
          }
        >
          <CastingLog cast={cast} analysis={analysis} streams={streams} thoughts={thoughts} />
        </HudCard>

        <Fold label="The H3 request" icon={Terminal} tone="brand">
          <H3Request spec={spec} />
        </Fold>
      </div>

      {/* 11. Footer. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-slate-500 transition-colors hover:text-white"
        >
          Back to the canvas
        </button>

        <button
          type="button"
          disabled
          title="The Storyboarder isn't wired up yet"
          className="flex cursor-not-allowed items-center gap-2 rounded-xl bg-purple-600/40 px-5 py-2.5 text-sm font-semibold text-white/50"
        >
          <Clapperboard className="h-4 w-4" />
          Send to the Storyboarder
        </button>
      </div>
    </div>
  );
};

/**
 * Everything the canvas shows after the send button. Which of the three it is comes from
 * `stage` alone — the hook models them as one value precisely so this component cannot be
 * asked to render two at once.
 */
const TreatmentPanel = ({ screenwriter, cast, onRetry }) => {
  const {
    stage,
    analysis,
    spec,
    error,
    elapsed,
    live,
    streams,
    thoughts,
    rewriting,
    backToCompose,
    rewrite,
  } = screenwriter;
  if (stage === STAGE.COMPOSE) return null;

  // Two different casts, and conflating them is a bug worth naming.
  //
  // `writtenCast` is what the Screenwriter was actually given — failed pieces are not in it,
  // so it is the only correct thing to resolve <Subject N> chips against.
  //
  // `cast` is what the USER chose. Everything that reports on the run — the Casting Director log, and
  // above all the "n of m pieces made it in" line — has to count against this one, or a
  // dropped piece becomes invisible precisely where it most needs saying.
  const resolved = screenwriter.writtenCast ?? cast;

  return (
    <motion.div
      key="treatment"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.3 } }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className="w-full"
    >
      <div className="mb-5 flex items-center justify-center gap-3">
        <span className="h-px w-8 bg-white/10" />
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-slate-500">
          <PenLine className="h-3 w-3" />
          Screenwriter
        </p>
        <span className="h-px w-8 bg-white/10" />
      </div>

      {error && !spec ? (
        <Failure error={error} onRetry={onRetry} onBack={backToCompose} />
      ) : stage === STAGE.TREATMENT && spec ? (
        <>
          {/* A rewrite that failed keeps the draft on screen and says so above it, rather
              than replacing a treatment the user is reading with an error page. */}
          {error && (
            <p className="mx-auto mb-4 max-w-3xl rounded-xl bg-amber-400/10 p-3 text-xs text-amber-200">
              That rewrite didn&rsquo;t land: {error}
            </p>
          )}
          <Treatment
            spec={spec}
            cast={cast}
            resolved={resolved}
            analysis={analysis}
            onBack={backToCompose}
            onRewrite={rewrite}
            rewriting={rewriting}
            live={live}
            streams={streams}
            thoughts={thoughts}
          />
        </>
      ) : (
        <Working
          analysis={analysis}
          cast={cast}
          elapsed={elapsed}
          live={live}
          streams={streams}
          thoughts={thoughts}
        />
      )}
    </motion.div>
  );
};

export default TreatmentPanel;
