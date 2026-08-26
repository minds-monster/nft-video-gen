import { useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, Lock, Send, Sparkles } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
import PromptSuggestions from './PromptSuggestions';
import { cn } from '../../../lib/cn';

const TEXTAREA_MAX = 260;

/**
 * The primary prompt input for the canvas.
 *
 * Includes the large textarea, suggested prompts, the generate button, and the worker-down
 * warning. The auto-grow behaviour and keyboard handling are self-contained here.
 */
const PromptPanel = ({
  id,
  prompt,
  setPrompt,
  onLaunch,
  ready,
  busy,
  workerOk = true,
  readOnly = false,
  onBackToCompose,
  collapsed,
  onToggle,
}) => {
  const textareaRef = useRef(null);

  // Focus the prompt as soon as the expanded canvas appears, so a user who clicked the
  // collapsed bar (or a front-page suggestion) can keep typing without an extra click.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const grow = useCallback((element) => {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, TEXTAREA_MAX)}px`;
  }, []);

  useEffect(() => {
    grow(textareaRef.current);
  }, [prompt, grow]);

  const submit = () => {
    if (!ready || readOnly) return;
    onLaunch?.();
  };

  const setPromptAndFocus = (idea) => {
    setPrompt(idea);
    textareaRef.current?.focus();
  };

  // Why the Send button is dead, said on the button itself. A disabled control with no
  // explanation is the fastest way to make somebody think the app is broken.
  const disabledReason = !ready
    ? readOnly
      ? 'The prompt is locked while the crew works — use “Back to compose” to edit it.'
      : !workerOk
        ? 'The agent worker is not reachable.'
        : !prompt.trim()
          ? 'Describe your film first.'
          : 'Add at least one piece to the cast.'
    : undefined;

  return (
    <CanvasPanel
      id={id}
      title="Prompt"
      icon={Sparkles}
      collapsed={collapsed}
      onToggle={onToggle}
      status={readOnly ? { tone: 'done', text: 'locked' } : undefined}
      bodyClassName="flex flex-col gap-3"
      headerAction={
        readOnly && onBackToCompose ? (
          <button
            type="button"
            onClick={onBackToCompose}
            className="shrink-0 font-mono text-[9px] uppercase tracking-widest text-purple-300 transition-colors hover:text-white"
          >
            Back to compose
          </button>
        ) : undefined
      }
    >
      {/* THE LOCK, EXPLAINED. Once the run starts, the prompt, the cast and the Send button all
          go dead together; the only cue used to be a text link in the panel header, so anybody
          who tried to change their mind mid-run got silence from three controls at once. */}
      {readOnly && (
        <p className="flex items-start gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
          <Lock className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" />
          <span>
            Locked while the crew works.{' '}
            {onBackToCompose && (
              <button
                type="button"
                onClick={onBackToCompose}
                className="text-purple-300 underline underline-offset-2 transition-colors hover:text-white"
              >
                Back to compose
              </button>
            )}{' '}
            to edit the prompt and cast. Your draft is kept.
          </span>
        </p>
      )}

      <div className="flex items-start gap-3">
        <Sparkles className="mt-2 h-5 w-5 shrink-0 text-purple-400" />
        <textarea
          ref={textareaRef}
          rows={1}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          readOnly={readOnly}
          placeholder="Describe your film…"
          aria-label="Describe your film"
          className={cn(
            'scrollbar-subtle min-w-0 flex-1 resize-none bg-transparent py-1 text-xl leading-snug',
            'text-white outline-none transition-all placeholder:text-slate-500 md:text-2xl',
          )}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          aria-label="Generate"
          title={disabledReason ?? 'Generate'}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-xl p-3 text-white shadow-lg transition-colors',
            'bg-purple-600 hover:bg-purple-500',
            'disabled:bg-purple-600/40 disabled:text-white/50',
          )}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </div>

      {!workerOk && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div className="text-xs leading-relaxed text-amber-200">
            <p className="font-semibold">Agent worker is not running.</p>
            <p className="text-amber-200/70">
              In dev, run{' '}
              <code className="rounded bg-amber-400/10 px-1 py-0.5 font-mono">
                npm run dev:worker
              </code>{' '}
              in another terminal, then try again.
            </p>
          </div>
        </div>
      )}

      {!readOnly && (
        <PromptSuggestions
          onSelect={setPromptAndFocus}
          className="mt-1"
        />
      )}
    </CanvasPanel>
  );
};

export default PromptPanel;
