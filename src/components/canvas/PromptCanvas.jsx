import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import HudFrame from './HudFrame';
import HoloArc from './HoloArc';
import ContractDock from './ContractDock';
import AssetPicker from './AssetPicker';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { resolveNftName } from '../../services/alchemy';
import { PROMPT_IDEAS } from '../../data/prompts';
import { cn } from '../../lib/cn';

const MAX_CAST = 7;
const TEXTAREA_MAX = 260;

/** Height of the collapsed bar. The hero reserves exactly this much for the anchor. */
export const COLLAPSED_HEIGHT = 68;

const EXPANDED_INSET = 24; // matches the old md:inset-6
// framer animates these, so they are plain numbers and the --radius-* tokens cannot reach
// them. They must be kept in sync with index.css by hand, or the morphing panel ends up a
// visibly different shape from the rounded-2xl/3xl panels sitting next to it.
const COLLAPSED_RADIUS = 10; // = --radius-2xl
const EXPANDED_RADIUS = 14; // = --radius-3xl

// Literals, not var(): framer-motion interpolates these two and its colour parser handles
// rgb/hex only — hand it a var() or an oklch() and the bar→fullscreen morph dies silently
// at runtime, with no build error. Mirrors --panel-rgb at 55% and --ground-rgb in
// index.css; keep in sync.
const GLASS = 'rgba(18, 10, 26, 0.55)'; // slate-900/55
const SOLID = 'rgb(9, 4, 15)'; // slate-950

/**
 * The prompt composer — the hero's text box and the neural canvas, as a single element.
 *
 * There is one node. Focusing it grows it from bar-size to screen-size; nothing unmounts
 * and nothing new mounts, so the box genuinely expands rather than being swapped for an
 * overlay that resembles it.
 *
 * It has to be rendered at root level, as a sibling of <main>: `main` is `relative z-10`
 * and the hero <section> is `isolate`, and either stacking context would pin a descendant
 * below the z-40 header at any z-index. So the hero reserves an invisible anchor of the
 * same size and this tracks it — positioned `absolute` in *document* space, which means
 * it scrolls with the page natively while collapsed instead of chasing scroll events.
 */
const PromptCanvas = ({ composer, onLaunch }) => {
  const {
    open,
    openCanvas,
    closeCanvas,
    anchorRect,
    prompt,
    setPrompt,
    cast,
    primary,
    primaryKey,
    setPrimary,
    removeAsset,
    reshuffle,
    pool,
    poolLoading,
    castKeys,
    isMock,
    picker,
    openPicker,
    closePicker,
    chooseFromPicker,
    resolveContract,
    resolving,
    resolveError,
    pickerView,
    pickerResolving,
    pickerError,
    loadIntoPicker,
    shufflePickerView,
    clearPickerView,
  } = composer;

  const shellRef = useRef(null);
  const textareaRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const wide = useMediaQuery('(min-width: 768px)');

  // Body scroll is locked while open, so the scroll offset the expanded rect is measured
  // against can't drift underneath us. Captured at the moment of opening.
  const openScrollY = useRef(0);
  if (!open) openScrollY.current = window.scrollY;

  // `morphing` lags the open/closed flip until the animation settles. Two things depend
  // on it, and both would misbehave if they switched instantly — see `zIndex` and
  // `blurred` below.
  const [morphing, setMorphing] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    // Skip the mount run: nothing is morphing yet, and flagging it would park the
    // collapsed bar at z-50 (over the header) until the first animation settled.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setMorphing(true);
  }, [open]);

  // The expanded rect is derived from the viewport, so it has to re-render on resize.
  // (`anchorRect` handles the collapsed side through its own observers.)
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const inset = wide ? EXPANDED_INSET : 0;
  const target = open
    ? {
        top: openScrollY.current + inset,
        left: inset,
        width: viewport.width - inset * 2,
        height: viewport.height - inset * 2,
      }
    : anchorRect;

  // Collapsed, the bar must pass *under* the sticky header when the hero scrolls past it,
  // so it can't just live at z-50. It also can't drop back to z-30 the instant it starts
  // shrinking, or it ducks beneath the header mid-flight.
  const zIndex = open || morphing ? 50 : 30;
  // backdrop-filter is invisible behind an opaque surface but still costs a full-screen
  // recomposite every frame. Keep it for the glass state and the morph, drop it once the
  // surface has finished going solid.
  const blurred = !(open && !morphing);

  useFocusTrap(shellRef, open, { restoreFocus: false });

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (picker) closePicker();
      else {
        // Blur first: leaving focus in the textarea would re-fire onFocus on the next
        // click and reopen the canvas the user just dismissed.
        textareaRef.current?.blur();
        closeCanvas();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, picker, closePicker, closeCanvas]);

  const grow = useCallback(
    (element) => {
      if (!element) return;
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, open ? TEXTAREA_MAX : 32)}px`;
    },
    [open],
  );

  // Resize after the value has landed in the DOM — measuring inside onChange reads the
  // previous value, so a long suggestion wouldn't expand the field.
  useEffect(() => {
    grow(textareaRef.current);
  }, [prompt, grow, open]);

  // The type size is CSS-transitioned between the two states, so the measurement above
  // runs against a half-interpolated font and comes out short. Re-measure once the
  // transition lands. (`min-h` on the field covers the intervening frames.)
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return undefined;
    const onEnd = (event) => {
      if (event.propertyName === 'font-size') grow(element);
    };
    element.addEventListener('transitionend', onEnd);
    return () => element.removeEventListener('transitionend', onEnd);
  }, [grow]);

  const dismiss = () => {
    textareaRef.current?.blur();
    closeCanvas();
  };

  const launch = () => {
    const text = prompt.trim();
    if (!text || !primary) return;
    onLaunch?.({ prompt: text, primary, cast });
  };

  const ready = Boolean(prompt.trim()) && Boolean(primary);

  // Until the anchor has been measured there's nowhere to put the collapsed bar.
  if (!target) return null;

  return (
    <>
      {/* Backdrop. Not the box — just the dimmer that hides the page behind it, including
          the gutter the inset leaves at md. */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={dismiss}
            className="fixed inset-0 z-[45] bg-slate-950/92"
          />
        )}
      </AnimatePresence>

      <motion.div
        ref={shellRef}
        tabIndex={-1}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? 'true' : undefined}
        aria-label={open ? 'Compose your film' : undefined}
        data-expanded={open}
        // Mount at the collapsed rect so the first frame isn't animated in from nothing;
        // only opacity fades, timed with the hero's own entrance.
        initial={{
          opacity: 0,
          top: target.top,
          left: target.left,
          width: target.width,
          height: target.height,
          borderRadius: COLLAPSED_RADIUS,
          backgroundColor: GLASS,
        }}
        // One element, two rects. Everything else about it is continuous.
        animate={{
          opacity: 1,
          top: target.top,
          left: target.left,
          width: target.width,
          height: target.height,
          borderRadius: open ? (wide ? EXPANDED_RADIUS : 0) : COLLAPSED_RADIUS,
          backgroundColor: open ? SOLID : GLASS,
        }}
        onAnimationComplete={() => setMorphing(false)}
        transition={
          reduceMotion
            ? { duration: 0 }
            : {
                type: 'spring',
                stiffness: 220,
                damping: 30,
                mass: 0.9,
                opacity: { duration: 0.5, delay: 0.12 },
              }
        }
        style={{ position: 'absolute', zIndex }}
        className={cn(
          'composer-bloom overflow-hidden border border-slate-700/50 outline-none',
          blurred && 'backdrop-blur-xl',
        )}
      >
        {open && <HudFrame sweep={!reduceMotion} />}

        <div className="relative flex h-full flex-col">
          {/* ---------------------------------------------- expanded-only top chrome */}
          <AnimatePresence>
            {open && (
              <motion.div
                key="chrome"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.25, delay: 0.15 } }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
              >
                <p className="pointer-events-none absolute left-5 top-4 z-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-600 md:left-8 md:top-6">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Neural canvas
                </p>

                <button
                  type="button"
                  onClick={dismiss}
                  aria-label="Close the composer"
                  className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-white md:right-6 md:top-6"
                >
                  <span className="font-mono text-[10px] uppercase tracking-widest">Esc</span>
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* `justify-center` on a scroll container makes overflow above the centre point
              unreachable; centring an inner `min-h-full` block keeps it scrollable. */}
          <div
            className={cn(
              'min-h-0 flex-1',
              open
                ? 'scrollbar-subtle overscroll-contain-y overflow-y-auto px-5 pb-2 pt-14 md:px-10 md:pt-16'
                : 'overflow-hidden p-2',
            )}
          >
            <div
              className={cn(
                'mx-auto flex flex-col',
                open ? 'min-h-full max-w-6xl justify-center gap-10 py-2' : 'h-full justify-center',
              )}
            >
              {/* ------------------------------------------------------------- prompt
                  The one row that exists in both states. Same icon, same input, same
                  send button — only the type size and the column width transition. */}
              <div className={cn('mx-auto w-full shrink-0', open && 'max-w-3xl')}>
                <div
                  className={cn(
                    'flex w-full transition-all duration-500',
                    // Collapsed gap matches the old bar's icon padding + input padding
                    // (12px + 8px), so the icon sits exactly where it always has.
                    open ? 'items-start gap-3 md:gap-4' : 'items-center gap-5',
                  )}
                >
                  <Sparkles
                    className={cn(
                      'h-6 w-6 shrink-0 text-purple-400 transition-all duration-500',
                      open ? 'mt-1.5' : 'ml-3',
                    )}
                  />

                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onFocus={openCanvas}
                    onKeyDown={(event) => {
                      // Enter sends, Shift+Enter is a newline.
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        launch();
                      }
                    }}
                    placeholder="Describe your film…"
                    aria-label="Describe your film"
                    className={cn(
                      'scrollbar-subtle min-w-0 flex-1 resize-none bg-transparent leading-snug',
                      'text-white outline-none transition-all duration-500 placeholder:text-slate-500',
                      open ? 'min-h-10 py-1 text-2xl md:text-3xl' : 'text-lg',
                    )}
                  />

                  <button
                    type="button"
                    onClick={launch}
                    disabled={!ready}
                    aria-label="Generate"
                    className={cn(
                      'flex shrink-0 items-center justify-center rounded-xl p-3 text-white shadow-lg transition-colors',
                      'bg-purple-600 hover:bg-purple-500',
                      'disabled:bg-purple-600/40 disabled:text-white/50',
                    )}
                  >
                    {resolving ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <Send className="h-6 w-6" />
                    )}
                  </button>
                </div>

                <AnimatePresence>
                  {open && (
                    <motion.div
                      key="suggestions"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1, transition: { duration: 0.25, delay: 0.15 } }}
                      exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    >
                      {/* The only rule that marks the writing area, in place of a box. */}
                      <div className="mt-3 ml-9 h-px bg-gradient-to-r from-white/15 via-white/5 to-transparent md:ml-11" />

                      <div className="mt-3 ml-9 flex flex-wrap items-center gap-2 md:ml-11">
                        <span className="mr-1 font-mono text-[10px] uppercase tracking-widest text-slate-600">
                          Try
                        </span>
                        {PROMPT_IDEAS.map((idea) => (
                          <button
                            key={idea}
                            type="button"
                            onClick={() => {
                              setPrompt(idea);
                              textareaRef.current?.focus();
                            }}
                            className="chip px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            {idea}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* --------------------------------------------------------------- cast */}
              <AnimatePresence>
                {open && (
                  <motion.div
                    key="cast"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { duration: 0.25, delay: 0.15 } }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    className="w-full shrink-0"
                  >
                    <div className="mb-1 flex items-center justify-center gap-3">
                      <span className="h-px w-8 bg-white/10" />
                      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-slate-500">
                        Cast
                      </p>
                      <span className="h-px w-8 bg-white/10" />
                    </div>

                    <HoloArc
                      cast={cast}
                      primaryKey={primaryKey}
                      onPromote={setPrimary}
                      onRemove={removeAsset}
                      onSwap={(key) => openPicker(key)}
                      onAdd={() => openPicker(null)}
                      loading={poolLoading && cast.length === 0}
                      full={cast.length >= MAX_CAST}
                    />

                    <p
                      aria-live="polite"
                      className="mt-1 text-center font-mono text-[10px] uppercase tracking-widest text-slate-600"
                    >
                      {cast.length === 0
                        ? 'Add a piece to begin'
                        : primary
                          ? `${resolveNftName(primary.nft)} leads · ${cast.length} ${cast.length === 1 ? 'piece' : 'pieces'}`
                          : `${cast.length} pieces`}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ------------------------------------------------------------- contract */}
          <AnimatePresence>
            {open && (
              <motion.footer
                key="dock"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.25, delay: 0.15 } }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                className="shrink-0 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:px-10 md:pb-6"
              >
                <div className="mx-auto max-w-3xl">
                  <ContractDock
                    onResolve={resolveContract}
                    resolving={resolving}
                    error={resolveError}
                    onReshuffle={reshuffle}
                  />
                </div>
              </motion.footer>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {open && picker && (
            <AssetPicker
              pool={pool}
              castKeys={castKeys}
              isMock={isMock}
              mode={picker.replaceKey ? 'swap' : 'add'}
              onChoose={chooseFromPicker}
              onClose={closePicker}
              pastedView={pickerView}
              onLoadContract={loadIntoPicker}
              onShufflePasted={shufflePickerView}
              onClearPasted={clearPickerView}
              resolving={pickerResolving}
              error={pickerError}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
};

export default PromptCanvas;
