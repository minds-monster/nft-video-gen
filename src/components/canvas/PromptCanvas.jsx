import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import HudFrame from './HudFrame';
import ContractDock from './ContractDock';
import AssetPicker from './AssetPicker';
import PromptPanel from './panels/PromptPanel';
import AssetsPanel from './panels/AssetsPanel';
import CastPanel from './panels/CastPanel';
import MovieRenderPanel from './panels/MovieRenderPanel';
import StoryboardPanel from './panels/StoryboardPanel';
import CastingDirectorPanel from './panels/CastingDirectorPanel';
import ScreenwriterPanel from './panels/ScreenwriterPanel';
import ScreenplayPanel from './panels/ScreenplayPanel';
import StoryboarderPanel from './panels/StoryboarderPanel';
import ProducerPanel from './panels/ProducerPanel';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { checkHealth } from '../../services/swarm';
import { STAGE } from '../../hooks/useScreenwriter';
import { cn } from '../../lib/cn';

/** Height of the collapsed bar. The hero reserves exactly this much for the anchor. */
export const COLLAPSED_HEIGHT = 68;

const EXPANDED_INSET = 24;
const COLLAPSED_RADIUS = 10; // = --radius-2xl
const EXPANDED_RADIUS = 14; // = --radius-3xl
const GLASS = 'rgba(18, 10, 26, 0.55)';
const SOLID = 'rgb(9, 4, 15)';

/**
 * The prompt composer — the hero's text box and the neural canvas, as a single element.
 *
 * Focusing it grows it from bar-size to screen-size; nothing unmounts and nothing new mounts,
 * so the box genuinely expands rather than being swapped for an overlay.
 *
 * The expanded interior is organised like Final Cut Pro: three resizable, collapsible zones
 * (browser left, viewer/timeline centre, inspector right), each containing the relevant panel.
 */
const PromptCanvas = ({ composer, onLaunch, screenwriter }) => {
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
    addAsset,
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
    preview,
    previewLoading,
    previewNfts,
    setPreviewCandidate,
    browseCollection,
    browseNext,
    browsePrev,
    addPreviewToCast,
    clearPreview,
  } = composer;

  const shellRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const wide = useMediaQuery('(min-width: 768px)');

  const [workerOk, setWorkerOk] = useState(true);
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    checkHealth()
      .then(() => {
        if (!cancelled) setWorkerOk(true);
      })
      .catch(() => {
        if (!cancelled) setWorkerOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const openScrollY = useRef(0);
  if (!open) openScrollY.current = window.scrollY;

  const [morphing, setMorphing] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setMorphing(true);
  }, [open]);

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

  const zIndex = open || morphing ? 50 : 30;
  const blurred = !(open && !morphing);

  useFocusTrap(shellRef, open, { restoreFocus: false });

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (picker) closePicker();
      else {
        closeCanvas();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, picker, closePicker, closeCanvas]);

  const stage = screenwriter?.stage ?? STAGE.COMPOSE;
  const composing = stage === STAGE.COMPOSE;

  const launch = useCallback(() => {
    const text = prompt.trim();
    if (!text || !primary || !composing) return;
    onLaunch?.({ prompt: text, primary, cast });
  }, [prompt, primary, cast, composing, onLaunch]);

  const ready = Boolean(prompt.trim()) && Boolean(primary) && composing && workerOk;

  // Collapse state for the four inspector panels that can yield space to Producer.
  // `CanvasPanel`'s collapsed/onCollapse/onExpand only toggle content visibility; the
  // panelRef.collapse()/.expand() calls are what actually shrink/restore the outer
  // react-resizable-panels Panel's allocated height. Both must move together, or the
  // panel would either hide its content while still holding its full height, or shrink
  // without the header chevron reflecting it.
  const castingDirectorRef = usePanelRef();
  const screenwriterRef = usePanelRef();
  const screenplayRef = usePanelRef();
  const storyboarderRef = usePanelRef();
  const [inspectorCollapsed, setInspectorCollapsed] = useState({
    castingDirector: false,
    screenwriter: false,
    screenplay: false,
    storyboarder: false,
  });
  const panelRefsByKey = {
    castingDirector: castingDirectorRef,
    screenwriter: screenwriterRef,
    screenplay: screenplayRef,
    storyboarder: storyboarderRef,
  };
  const collapseInspector = (key) => {
    panelRefsByKey[key].current?.collapse();
    setInspectorCollapsed((prev) => ({ ...prev, [key]: true }));
  };
  const expandInspector = (key) => {
    panelRefsByKey[key].current?.expand();
    setInspectorCollapsed((prev) => ({ ...prev, [key]: false }));
  };

  if (!target) return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={closeCanvas}
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
        initial={{
          opacity: 0,
          top: target.top,
          left: target.left,
          width: target.width,
          height: target.height,
          borderRadius: COLLAPSED_RADIUS,
          backgroundColor: GLASS,
        }}
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

        {open && (
          <>
            <p className="pointer-events-none absolute left-5 top-4 z-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] md:left-8 md:top-6">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  composing ? 'bg-emerald-400' : 'animate-pulse bg-purple-400',
                )}
              />
              <span className={cn(composing ? 'text-slate-600' : 'text-purple-300/80')}>
                Neural canvas
              </span>
              {!composing && <span className="text-slate-700">· telemetry live</span>}
            </p>

            <button
              type="button"
              onClick={closeCanvas}
              aria-label="Close the composer"
              className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-white md:right-6 md:top-6"
            >
              <span className="font-mono text-[10px] uppercase tracking-widest">Esc</span>
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {!open ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="flex w-full max-w-3xl items-center gap-5">
              <Sparkles className="h-6 w-6 shrink-0 text-purple-400" />
              <textarea
                rows={1}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onFocus={openCanvas}
                readOnly={!composing}
                placeholder="Describe your film…"
                aria-label="Describe your film"
                className="min-w-0 flex-1 resize-none bg-transparent text-lg leading-snug text-white outline-none placeholder:text-slate-500"
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
          </div>
        ) : (
          <div className="relative flex h-full flex-col pt-14 md:pt-16">
            <Group orientation="horizontal" className="flex-1">
              {/* Left zone: Assets + Cast */}
              <Panel
                defaultSize="18"
                minSize="8"
                maxSize="35"
                collapsible
                className="flex flex-col"
              >
                <Group orientation="vertical" className="flex-1">
                  <Panel defaultSize="55" minSize="15" className="flex flex-col">
                    <AssetsPanel
                      pool={pool}
                      castKeys={castKeys}
                      isMock={isMock}
                      onAdd={addAsset}
                      onPreview={setPreviewCandidate}
                      onBrowseCollection={browseCollection}
                    />
                  </Panel>
                  <Separator className="canvas-resize-handle" />
                  <Panel defaultSize="45" minSize="15" className="flex flex-col">
                    <CastPanel
                      cast={cast}
                      primaryKey={primaryKey}
                      setPrimary={setPrimary}
                      removeAsset={removeAsset}
                      openPicker={openPicker}
                      loading={poolLoading && cast.length === 0}
                      full={cast.length >= 7}
                      analysis={screenwriter?.analysis}
                      readOnly={!composing}
                    />
                  </Panel>
                </Group>

                <div className="shrink-0 border-t border-white/10 px-3 py-2">
                  <ContractDock
                    onResolve={resolveContract}
                    resolving={resolving}
                    error={resolveError}
                    onReshuffle={reshuffle}
                  />
                </div>
              </Panel>

              <Separator className="canvas-resize-handle" />

              {/* Center zone: Prompt + Movie render + Storyboard */}
              <Panel
                defaultSize="55"
                minSize="30"
                className="flex flex-col"
              >
                <Group orientation="vertical" className="flex-1">
                  <Panel defaultSize="14" minSize="10" maxSize="25" className="flex flex-col">
                    <PromptPanel
                      prompt={prompt}
                      setPrompt={setPrompt}
                      onLaunch={launch}
                      ready={ready}
                      busy={resolving || screenwriter?.isWriting}
                      workerOk={workerOk}
                      readOnly={!composing}
                      headerAction={
                        !composing ? (
                          <button
                            type="button"
                            onClick={screenwriter?.backToCompose}
                            className="font-mono text-[9px] uppercase tracking-widest text-purple-300 transition-colors hover:text-white"
                          >
                            Back to compose
                          </button>
                        ) : undefined
                      }
                    />
                  </Panel>
                  <Separator className="canvas-resize-handle" />
                  <Panel defaultSize="58" minSize="25" className="flex flex-col">
                    <MovieRenderPanel
                      primary={primary}
                      preview={preview}
                      previewLoading={previewLoading}
                      previewNfts={previewNfts}
                      onAdd={addPreviewToCast}
                      onNext={browseNext}
                      onPrev={browsePrev}
                      onClear={clearPreview}
                    />
                  </Panel>
                  <Separator className="canvas-resize-handle" />
                  <Panel defaultSize="28" minSize="15" className="flex flex-col">
                    <StoryboardPanel />
                  </Panel>
                </Group>
              </Panel>

              <Separator className="canvas-resize-handle" />

              {/* Right zone: agent inspector panels */}
              <Panel
                defaultSize="27"
                minSize="10"
                maxSize="45"
                collapsible
                className="flex flex-col"
              >
                <Group orientation="vertical" className="flex-1">
                  <Panel
                    defaultSize="22"
                    minSize="10"
                    collapsible
                    collapsedSize="4"
                    panelRef={castingDirectorRef}
                    className="flex flex-col"
                  >
                    <CastingDirectorPanel
                      cast={cast}
                      analysis={screenwriter?.analysis}
                      streams={screenwriter?.streams}
                      thoughts={screenwriter?.thoughts}
                      collapsed={inspectorCollapsed.castingDirector}
                      onCollapse={() => collapseInspector('castingDirector')}
                      onExpand={() => expandInspector('castingDirector')}
                    />
                  </Panel>
                  <Separator className="canvas-resize-handle" />
                  <Panel
                    defaultSize="18"
                    minSize="10"
                    collapsible
                    collapsedSize="4"
                    panelRef={screenwriterRef}
                    className="flex flex-col"
                  >
                    <ScreenwriterPanel
                      live={screenwriter?.live ?? []}
                      thoughts={screenwriter?.thoughts ?? {}}
                      collapsed={inspectorCollapsed.screenwriter}
                      onCollapse={() => collapseInspector('screenwriter')}
                      onExpand={() => expandInspector('screenwriter')}
                    />
                  </Panel>
                  <Separator className="canvas-resize-handle" />
                  <Panel
                    defaultSize="30"
                    minSize="10"
                    collapsible
                    collapsedSize="4"
                    panelRef={screenplayRef}
                    className="flex flex-col"
                  >
                    <ScreenplayPanel
                      spec={screenwriter?.spec}
                      cast={cast}
                      analysis={screenwriter?.analysis}
                      rewriting={screenwriter?.rewriting}
                      live={screenwriter?.live ?? []}
                      collapsed={inspectorCollapsed.screenplay}
                      onCollapse={() => collapseInspector('screenplay')}
                      onExpand={() => expandInspector('screenplay')}
                    />
                  </Panel>
                  <Separator className="canvas-resize-handle" />
                  <Panel
                    defaultSize="12"
                    minSize="8"
                    collapsible
                    collapsedSize="4"
                    panelRef={storyboarderRef}
                    className="flex flex-col"
                  >
                    <StoryboarderPanel
                      collapsed={inspectorCollapsed.storyboarder}
                      onCollapse={() => collapseInspector('storyboarder')}
                      onExpand={() => expandInspector('storyboarder')}
                    />
                  </Panel>
                  <Separator className="canvas-resize-handle" />
                  <Panel defaultSize="18" minSize="10" className="flex flex-col">
                    <ProducerPanel />
                  </Panel>
                </Group>
              </Panel>
            </Group>

            <AnimatePresence>
              {picker && (
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
          </div>
        )}
      </motion.div>
    </>
  );
};

export default PromptCanvas;
