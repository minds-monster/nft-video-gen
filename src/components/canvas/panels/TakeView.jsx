import { useState } from 'react';
import { ArrowLeft, Brain, Copy, Download, FileText, Link2, Loader2 } from 'lucide-react';

import { cn } from '../../../lib/cn';
import { ANSWER_TONE } from '../../../lib/takeTone';
import { VERDICTS, verdictLabel } from '../../../../worker/screen-test.js';

/**
 * A take, played large. The Viewer's body when what is being viewed came out of the Director
 * rather than off-chain.
 *
 * EVERYTHING ABOUT THE TAKE IS HERE, not on the card that opened it. The request that produced
 * it, the button that saves it, and — for a screen test — the three answers. All three are things
 * you do after watching, so they belong beside the thing you watched, not beside its thumbnail.
 */

const money = (value) => (value == null ? null : `$${Number(value).toFixed(2)}`);

const duration = (seconds) => {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const TakeView = ({ take, index, onJudge, onRemember, onClear }) => {
  const [showScript, setShowScript] = useState(false);
  // "Remembering" is queued server-side; this is only the button's own state while the CID and
  // the remembered mark make their way back onto the take.
  const [remembering, setRemembering] = useState(false);
  // Playback prefers our copy (fast, signed, close). The IPFS gateway is the fallback for when
  // the signed link has expired or the bucket is gone — which is exactly what the CID is for.
  const [useGateway, setUseGateway] = useState(false);
  const [copied, setCopied] = useState(false);
  // What the visitor saw, in their own words. Goes with the verdict to the Director's read-back
  // as "What was seen" — the one place a visitor can tell the Director something the three
  // buttons cannot. Optional, and worth more than the button.
  const [note, setNote] = useState(take.verdict?.note ?? '');
  // Answering again — a changed mind, or words added to a bare click. The Director reads the
  // new answer back exactly as it would a first one.
  const [reanswering, setReanswering] = useState(false);

  const isTest = take.kind === 'screen-test';
  const answered = take.verdict?.answer;
  const title = isTest ? (take.question ?? 'An unnamed test') : `Take ${index}`;
  const cid = take.ipfs?.cid ?? null;
  const gatewayUrl = take.ipfs?.gatewayUrl ?? (cid ? `https://gateway.pinata.cloud/ipfs/${cid}` : null);
  const src = useGateway && gatewayUrl ? gatewayUrl : take.url;

  // Tests too, since 2026-08-28: a rehearsal the visitor liked is production knowledge the Mind
  // should be able to name, not just a clip in our bucket.
  const canRemember = take.status === 'ready' && Boolean(onRemember);
  const remembered = take.digestedAt ? new Date(take.digestedAt) : null;
  const remember = async () => {
    setRemembering(true);
    await onRemember?.({ takeId: take.takeId });
    // Long enough for the queue to pin and tell the Mind; the hook re-reads the take meanwhile.
    setTimeout(() => setRemembering(false), 20000);
  };

  const copyCid = () => {
    navigator.clipboard?.writeText(`ipfs://${cid}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <>
      <div className="relative mx-auto flex min-h-0 w-full max-w-full flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40">
        <div className="relative max-h-full max-w-full" style={{ aspectRatio: '16/9' }}>
          {src ? (
            <video
              key={src}
              src={src}
              // Same reason as the NFT branch: the autoPlay attribute alone is unreliable, so
              // kick playback off once the media is actually ready.
              onCanPlay={(event) => event.currentTarget.play().catch(() => {})}
              onError={() => {
                if (!useGateway && gatewayUrl) setUseGateway(true);
              }}
              controls
              autoPlay
              loop
              muted
              playsInline
              className="block h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center p-6 text-center text-xs leading-relaxed text-slate-500">
              {take.reason ?? 'This take produced no film.'}
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate-600">
              {isTest ? 'Screen test' : 'Daily'}
            </p>
            <h3
              className={cn(
                'mt-0.5 text-white',
                isTest
                  ? 'text-sm font-semibold leading-snug'
                  : 'truncate text-lg uppercase tracking-tight',
              )}
            >
              {title}
            </h3>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              {take.params?.resolution} · {take.params?.duration}s
              {take.seconds ? ` · shot in ${duration(take.seconds)}` : ''}
            </p>
          </div>
          <p className="shrink-0 font-mono text-sm text-slate-300">{money(take.costUsd)}</p>
        </div>

        {isTest && answered && (
          <p
            className={cn(
              'mt-2 rounded-xl border px-2 py-1.5 text-[11px] font-semibold',
              ANSWER_TONE[answered],
            )}
          >
            {verdictLabel(take, answered)}
            {take.verdict.note ? (
              <span className="font-normal opacity-80"> — {take.verdict.note}</span>
            ) : null}
            {!reanswering && (
              <button
                type="button"
                onClick={() => setReanswering(true)}
                className="ml-2 font-mono text-[9px] font-normal uppercase tracking-wider opacity-70 hover:opacity-100"
              >
                Change your answer
              </button>
            )}
          </p>
        )}

        {isTest && take.review?.finding && (
          <p className="mt-1 rounded-xl border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] leading-relaxed text-slate-300">
            <span className="font-mono text-[9px] uppercase tracking-widest text-slate-600">The Director read it back · </span>
            {take.review.finding}
            {take.review.revised ? (
              <span className="text-emerald-200/80"> Changed the {take.review.revised.block} block: {take.review.revised.why}</span>
            ) : null}
          </p>
        )}

        {isTest && take.retest && (
          <p className="mt-1 rounded-xl border border-amber-400/20 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-amber-200/80">
            The Director read this back and asked for the question to be run again against the
            revised script.
          </p>
        )}

        {isTest && (!answered || reanswering) && take.status === 'ready' && (
          <div className="mt-2">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-widest text-slate-600">
              You just watched it — tell the Director what you saw
            </p>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={600}
              placeholder='In your own words — e.g. "the letters inflated properly but the brain faded in over them at the end". Optional; the Director reads this before changing the script.'
              className="scrollbar-subtle mb-1 w-full resize-none rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] leading-snug text-white placeholder:text-slate-600 focus:border-purple-500/40 focus:outline-none"
            />
            <div className="flex gap-1">
              {VERDICTS.map((verdict) => (
                <button
                  key={verdict.id}
                  type="button"
                  onClick={() => {
                    setReanswering(false);
                    onJudge?.({ takeId: take.takeId, answer: verdict.id, note: note.trim() || undefined });
                  }}
                  className="flex-1 rounded-lg border border-white/10 bg-black/40 px-1.5 py-1 text-[10px] text-slate-300 transition-colors hover:border-white/25 hover:text-white"
                >
                  {verdictLabel(take, verdict.id)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowScript((on) => !on)}
            className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[9px] uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
          >
            <FileText className="h-3 w-3" />
            {showScript ? 'Hide request' : 'The request'}
          </button>
          {take.url && (
            <a
              href={take.url}
              download={isTest ? `${take.takeId}.mp4` : `take-${index}.mp4`}
              className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[9px] uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
            >
              <Download className="h-3 w-3" />
              Save
            </a>
          )}
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-[10px] text-slate-500 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to lead
          </button>
          {take.taskId && (
            <span className="font-mono text-[9px] text-slate-700">task {take.taskId}</span>
          )}
        </div>

        {/* The Mind's memory of this take. A take shot before the filmography existed has no
            digest and no CID; this is how it gets both — and how a Mind that has lost the
            thread is reminded. */}
        {canRemember && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={remember}
              disabled={remembering}
              className={cn(
                'flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors',
                remembered
                  ? 'bg-black/40 text-slate-400 hover:text-slate-200'
                  : 'bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 hover:text-purple-200',
                remembering && 'opacity-60',
              )}
            >
              {remembering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
              {remembering
                ? cid ? 'Telling your Mind…' : 'Pinning and telling your Mind…'
                : remembered ? 'Remind your Mind' : 'Put this in your Mind’s memory'}
            </button>
            {remembered && !remembering && (
              <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-400/80">
                In your Mind’s memory since {remembered.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        )}

        {/* The permanent address. Shown as the Mind was given it — ipfs://<cid> — because this is
            the one line that outlives our links, our bucket and this site; the gateway link is
            merely the way a browser reads it today. */}
        {cid && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5">
            <Link2 className="h-3 w-3 shrink-0 text-emerald-400" />
            <span className="font-mono text-[9px] uppercase tracking-widest text-emerald-400/80">Permanent copy</span>
            <a
              href={gatewayUrl}
              target="_blank"
              rel="noreferrer"
              title={gatewayUrl}
              className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300 hover:text-white"
            >
              ipfs://{cid}
            </a>
            <button
              type="button"
              onClick={copyCid}
              className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[9px] uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
            >
              <Copy className="h-3 w-3" />
              {copied ? 'Copied' : 'Copy'}
            </button>
            {take.sha256 && (
              <span className="w-full truncate font-mono text-[9px] text-slate-700" title={take.sha256}>
                sha256 {take.sha256}
              </span>
            )}
          </div>
        )}

        {showScript && (
          <pre className="scrollbar-subtle mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
            {take.script?.text ?? 'No script recorded for this take.'}
          </pre>
        )}
      </div>
    </>
  );
};

export default TakeView;
