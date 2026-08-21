import { useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, Send, Sparkles } from 'lucide-react';
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
  prompt,
  setPrompt,
  onLaunch,
  ready,
  busy,
  workerOk = true,
  readOnly = false,
  headerAction,
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

  return (
    <CanvasPanel
      title="Prompt"
      icon={Sparkles}
      bodyClassName="flex flex-col gap-3"
      headerAction={headerAction}
    >
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
