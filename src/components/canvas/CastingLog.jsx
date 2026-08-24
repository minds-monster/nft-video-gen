import { ClipboardCheck, Eye, Film, ScanLine, TriangleAlert, Type } from 'lucide-react';
import AgentThought from './AgentThought';
import { RevealOnce } from './RevealText';
import { resolveNftThumb, resolveNftName } from '../../services/alchemy';
import { SCREENWRITER } from '../../hooks/useScreenwriter';
import { cn } from '../../lib/cn';

// What the Casting Director saw — and what the Screenwriter thought — rendered as a stack of
// persistent, foldable HUD cards. Every agent that ran in this session leaves a card behind.

/**
 * A flag worth interrupting the reader for. Amber throughout: degraded-but-recoverable.
 */
const Flag = ({ icon: Icon, children }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-200">
    <Icon className="h-2.5 w-2.5 shrink-0" />
    {children}
  </span>
);

const DossierSummary = ({ entry, state }) => {
  const { nft } = entry;
  const dossier = state?.dossier;
  const thumb = resolveNftThumb(nft);
  const name = resolveNftName(nft);
  const failed = state?.status === 'failed';

  if (failed) {
    return (
      <div className="flex gap-3">
        <span
          className="mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-md border border-white/10 bg-slate-900 bg-cover bg-center"
          style={thumb ? { backgroundImage: `url("${thumb}")` } : undefined}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-slate-300">{name}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-200/90">
            Couldn&rsquo;t be read — it won&rsquo;t appear in the film.
          </p>
          {state?.error && (
            <p className="mt-1 text-[10px] leading-relaxed text-slate-600" title={state.error}>
              {state.error.slice(0, 160)}
              {state.error.length > 160 ? '…' : ''}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="flex gap-3">
        <span
          className="mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-md border border-white/10 bg-slate-900 bg-cover bg-center"
          style={thumb ? { backgroundImage: `url("${thumb}")` } : undefined}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-slate-300">{name}</p>
          <p className="mt-0.5 text-xs text-slate-500">Waiting to be read…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <span
        className="mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-md border border-white/10 bg-slate-900 bg-cover bg-center"
        style={thumb ? { backgroundImage: `url("${thumb}")` } : undefined}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold text-slate-300">{name}</p>
        <p className={cn('mt-0.5 leading-relaxed text-slate-400', 'text-sm')}>
          <RevealOnce text={dossier.subject} />
        </p>

        {dossier.identityMarkers?.length > 0 && (
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Holding onto: {dossier.identityMarkers.join(' · ')}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {dossier.watchedFilm && <Flag icon={Film}>watched its film</Flag>}
          {dossier.burnedInText && (
            <Flag icon={Type}>reads &ldquo;{dossier.burnedInText.slice(0, 40)}&rdquo;</Flag>
          )}
          {dossier.cropAdvice && <Flag icon={ScanLine}>wants a crop</Flag>}
          {dossier.hazards?.map((hazard) => (
            <Flag key={hazard} icon={TriangleAlert}>
              {hazard}
            </Flag>
          ))}
          {state?.previsFlagged && (
            <Flag icon={ClipboardCheck}>
              Previs Supervisor: {state.previsIssue || 'flagged before writing began'}
            </Flag>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Render one persistent card for every piece that has started being read, plus a card for
 * the Screenwriter once its thought has been archived.
 */
const CastingLog = ({ cast, analysis, streams, thoughts }) => {
  const pieceRows = cast
    .map((entry) => ({
      entry,
      state: analysis?.[entry.key],
      stream: streams?.[entry.key],
      thought: thoughts?.[entry.key],
    }))
    .filter(({ state }) => state && state.status !== 'queued');

  const writerStream = streams?.[SCREENWRITER];
  const writerThought = thoughts?.[SCREENWRITER];

  if (!pieceRows.length && !writerStream && !writerThought) return null;

  return (
    <ul className="space-y-3">
      {pieceRows.map(({ entry, state, stream, thought }) => {
        const status = stream ? 'live' : state?.status === 'failed' ? 'failed' : 'done';
        const reasoning = stream?.reasoning ?? thought?.reasoning ?? '';
        const content = stream?.content ?? thought?.content ?? '';
        const phase = stream?.phase ?? thought?.phase ?? state?.status;
        const compiling = status === 'live' && !reasoning?.trim() && !content?.trim();

        return (
          <li key={entry.key}>
            <AgentThought
              label={`Casting Director · ${resolveNftName(entry.nft)}`}
              phase={phase}
              status={status}
              reasoning={reasoning}
              content={content}
              compiling={compiling}
            >
              <DossierSummary entry={entry} state={state} />
            </AgentThought>
          </li>
        );
      })}

      {writerStream && (
        <li key={SCREENWRITER}>
          <AgentThought
            label="Screenwriter"
            phase={writerStream.phase}
            status="live"
            reasoning={writerStream.reasoning}
            content={writerStream.content}
            compiling={!writerStream.reasoning?.trim() && !writerStream.content?.trim()}
          />
        </li>
      )}

      {writerThought && (
        <li key={SCREENWRITER}>
          <AgentThought
            label="Screenwriter"
            phase={writerThought.phase}
            status="done"
            reasoning={writerThought.reasoning}
            content={writerThought.content}
          >
            <p className="text-xs leading-relaxed text-slate-500">
              Draft complete. Re-open this log to read the reasoning behind the shot spec.
            </p>
          </AgentThought>
        </li>
      )}
    </ul>
  );
};

/** Heading used above the log while it is the main event. */
export const CastingLogHeading = () => (
  <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-slate-500">
    <Eye className="h-3 w-3" />
    Agent log
  </p>
);

export default CastingLog;
