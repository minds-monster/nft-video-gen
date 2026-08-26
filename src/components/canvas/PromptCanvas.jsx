import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Eye, Loader2, Search, Send, Sparkles, X } from 'lucide-react';
import { Group, Panel, Separator, useDefaultLayout, useGroupRef, usePanelRef } from 'react-resizable-panels';
import HudFrame from './HudFrame';
import ContractDock from './ContractDock';
import AssetPicker from './AssetPicker';
import PipelineBar from './PipelineBar';
import ZoneStub from './ZoneStub';
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
import { PANEL_STRIP_HEIGHT } from './panels/CanvasPanel';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useMindChatContext } from '../../context/mindChat';
import { useMindStatusBadge } from '../../hooks/useMindStatusBadge';
import { STATE, useProductionPipeline } from '../../hooks/useProductionPipeline';
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

/** Width of a collapsed side zone. Matches ZoneStub's own constant. */
const ZONE_STUB = 44;

/** Resize hit target, per Apple's accessibility guidance (20pt fine / 28pt coarse).
 *  The separator LOOKS 8px wide; this is how big it actually is to a pointer. */
const RESIZE_TARGET = { fine: 24, coarse: 32 };

/** Every panel that can be collapsed, and which side zone it lives in.
 *
 * The zone matters for focus: clicking "Read" in the pipeline bar while the right rail is
 * collapsed has to open the rail before it can open the panel, or the scroll lands on
 * nothing. */
const PANEL_ZONE = {
  assets: 'leftZone',
  cast: 'leftZone',
  prompt: null,
  viewer: null,
  storyboard: null,
  castingDirector: 'rightZone',
  writersRoom: 'rightZone',
  screenplay: 'rightZone',
  storyboarder: 'rightZone',
  producer: 'rightZone',
};

const COLLAPSE_KEY = 'canvas-collapsed';
const LAYOUT_KEYS = ['canvas-zones', 'canvas-left', 'canvas-centre', 'canvas-right'];

const readCollapsed = () => {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
};

/**
 * The prompt composer — the hero's text box and the neural canvas, as a single element.
 *
 * Focusing it grows it from bar-size to screen-size; nothing unmounts and nothing new mounts,
 * so the box genuinely expands rather than being swapped for an overlay.
 *
 * The expanded interior is organised like Final Cut Pro: three resizable, collapsible zones
 * (browser left, viewer/timeline centre, inspector right), each containing the relevant panel,
 * under a pipeline bar that says which agent is working and what happens next.
 */
const PromptCanvas = ({ composer, onLaunch, screenwriter, storyboarder }) => {
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

  // Hoisted out of StoryboardPanel and StoryboarderPanel, which each ran their own independent
  // 6-second poll of the same endpoint. One poll, one budget, passed down.
  const { session } = useMindChatContext();
  const token = session?.token;
  const badge = useMindStatusBadge({ token, active: Boolean(token) && open });
  const budget = badge?.budget;

  const pipeline = useProductionPipeline({ composer, screenwriter, storyboarder, token, budget });

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

  const lastOpen = useRef(false);
  const openScrollY = useRef(0);
  if (open && !lastOpen.current) {
    openScrollY.current = window.scrollY;
    lastOpen.current = true;
  } else if (!open) {
    lastOpen.current = false;
  }

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
  const isFixed = open && !morphing;
  const target = open
    ? {
        top: isFixed ? inset : openScrollY.current + inset,
        left: inset,
        width: viewport.width - inset * 2,
        height: viewport.height - inset * 2,
      }
    : anchorRect;

  const zIndex = open || morphing ? 50 : 30;
  const blurred = !(open && !morphing);

  useFocusTrap(shellRef, open, { restoreFocus: false });
  useBodyScrollLock(open && !morphing);

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

  // --------------------------------------------------------------------------- layout state
  //
  // COLLAPSE HAS ONE SOURCE OF TRUTH: react-resizable-panels' own `isCollapsed()`. `collapsed`
  // below is a mirror of it, refreshed from `onResize`, never set by hand. The version this
  // replaces kept a parallel React flag that only moved when the chevron was clicked — so a
  // panel dragged past its minimum collapsed in the library while the UI still believed it was
  // open, rendering a full header and a scrollable body inside a 35px box with no expand
  // affordance rendered at all. That state had no way out.
  //
  // MIN AND COLLAPSED SIZES ARE IN PIXELS, not percent. Numbers are pixels to this library.
  // A five-panel rail at `minSize="10"` puts the snap cliff at a tenth of whatever the rail
  // height happens to be, which changes every time a sibling moves — so the distance you had
  // to learn was never the same twice. In pixels it is fixed and learnable, and `collapsedSize`
  // can match the strip's real height exactly.
  const zonesRef = useGroupRef();
  const leftGroupRef = useGroupRef();
  const centreGroupRef = useGroupRef();
  const rightGroupRef = useGroupRef();

  const leftZoneRef = usePanelRef();
  const rightZoneRef = usePanelRef();
  const promptRef = usePanelRef();
  const viewerRef = usePanelRef();
  const castingDirectorRef = usePanelRef();
  const writersRoomRef = usePanelRef();
  const screenplayRef = usePanelRef();
  const storyboarderRef = usePanelRef();
  const producerRef = usePanelRef();

  const panelRefs = useMemo(
    () => ({
      leftZone: leftZoneRef,
      rightZone: rightZoneRef,
      prompt: promptRef,
      viewer: viewerRef,
      castingDirector: castingDirectorRef,
      writersRoom: writersRoomRef,
      screenplay: screenplayRef,
      storyboarder: storyboarderRef,
      producer: producerRef,
    }),
    [
      leftZoneRef,
      rightZoneRef,
      promptRef,
      viewerRef,
      castingDirectorRef,
      writersRoomRef,
      screenplayRef,
      storyboarderRef,
      producerRef,
    ],
  );

  const [collapsed, setCollapsed] = useState(readCollapsed);

  const syncCollapsed = useCallback((key) => {
    setCollapsed((current) => {
      const next = Boolean(panelRefs[key]?.current?.isCollapsed());
      if (current[key] === next) return current;
      const updated = { ...current, [key]: next };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(updated));
      } catch {
        // Private mode, quota, a browser that has opinions. Losing the memory of which panels
        // were shut is not worth failing a resize over.
      }
      return updated;
    });
    // panelRefs is stable; the ref objects it holds are the mutable part.
  }, [panelRefs]);

  const togglePanel = useCallback(
    (key) => {
      const handle = panelRefs[key]?.current;
      if (!handle) return;
      // No setState here on purpose. `collapse()`/`expand()` fire `onResize`, which calls
      // `syncCollapsed`, which reads the library back. One direction of flow, so the chevron
      // and a drag cannot produce different results.
      if (handle.isCollapsed()) handle.expand();
      else handle.collapse();
    },
    [panelRefs],
  );

  /** Open a panel and put it on screen. What a pipeline-bar click actually does.
   *
   * Two-phase, because a collapsed side zone does not render its children at all — expanding
   * the zone is a React state change, so the panel this is trying to reach does not exist yet
   * at the moment of the click. Phase one opens the zone; the effect below picks it up once
   * the panel has actually mounted. */
  const [pendingFocus, setPendingFocus] = useState(null);

  const focusPanel = useCallback(
    (key) => {
      const zone = PANEL_ZONE[key];
      if (zone && panelRefs[zone]?.current?.isCollapsed()) panelRefs[zone].current.expand();
      setPendingFocus({ key, at: Date.now() });
    },
    [panelRefs],
  );

  useEffect(() => {
    if (!pendingFocus) return undefined;
    const key = pendingFocus.key;
    const id = requestAnimationFrame(() => {
      const handle = panelRefs[key]?.current;
      if (handle?.isCollapsed()) handle.expand();
      const element = document.getElementById(`canvas-panel-${key}`);
      // Give a remounting zone one more frame before giving up, rather than silently
      // scrolling nowhere.
      if (!element && Date.now() - pendingFocus.at < 400) {
        setPendingFocus({ key, at: pendingFocus.at });
        return;
      }
      element?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
      setPendingFocus(null);
    });
    return () => cancelAnimationFrame(id);
  }, [pendingFocus, panelRefs, reduceMotion]);

  // Restore the collapse map once the panels exist. Sizes are restored by `useDefaultLayout`
  // below; collapse is a separate fact the library does not store for us.
  const restored = useRef(false);
  useEffect(() => {
    if (!open) {
      restored.current = false;
      return;
    }
    if (restored.current) return;
    restored.current = true;
    const wanted = readCollapsed();
    requestAnimationFrame(() => {
      for (const [key, value] of Object.entries(wanted)) {
        const handle = panelRefs[key]?.current;
        if (!handle) continue;
        if (value && !handle.isCollapsed()) handle.collapse();
        else if (!value && handle.isCollapsed()) handle.expand();
      }
    });
  }, [open, panelRefs]);

  // Layout memory, using the library's own persistence hook rather than a hand-rolled one.
  const zonesLayout = useDefaultLayout({ id: 'canvas-zones', storage: localStorage, onlySaveAfterUserInteractions: true });
  const leftLayout = useDefaultLayout({ id: 'canvas-left', storage: localStorage, onlySaveAfterUserInteractions: true });
  const centreLayout = useDefaultLayout({ id: 'canvas-centre', storage: localStorage, onlySaveAfterUserInteractions: true });
  const rightLayout = useDefaultLayout({ id: 'canvas-right', storage: localStorage, onlySaveAfterUserInteractions: true });

  const resetLayout = useCallback(() => {
    try {
      for (const key of LAYOUT_KEYS) localStorage.removeItem(key);
      localStorage.removeItem(COLLAPSE_KEY);
    } catch {
      // See syncCollapsed.
    }
    for (const ref of Object.values(panelRefs)) {
      if (ref.current?.isCollapsed()) ref.current.expand();
    }
    zonesRef.current?.setLayout({ leftZone: 18, centreZone: 55, rightZone: 27 });
    leftGroupRef.current?.setLayout({ assets: 55, cast: 45 });
    centreGroupRef.current?.setLayout({ prompt: 14, viewer: 30, storyboard: 56 });
    rightGroupRef.current?.setLayout({
      castingDirector: 22,
      writersRoom: 18,
      screenplay: 30,
      storyboarder: 16,
      producer: 14,
    });
  }, [panelRefs, zonesRef, leftGroupRef, centreGroupRef, rightGroupRef]);

  const status = pipeline.panelStatus;
  const zoneBusy = useCallback(
    (keys) => keys.some((key) => status[key]?.tone === 'running'),
    [status],
  );
  const zoneFailed = useCallback(
    (keys) => keys.some((key) => status[key]?.tone === STATE.FAILED),
    [status],
  );

  const handleProps = {
    className: 'canvas-resize-handle',
    title: 'Drag to resize · double-click to reset',
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
        style={{ position: isFixed ? 'fixed' : 'absolute', zIndex }}
        className={cn(
          'composer-bloom overflow-hidden border border-slate-700/50 outline-none',
          blurred && 'backdrop-blur-xl',
        )}
      >
        {open && <HudFrame sweep={!reduceMotion} />}

        {open && (
          <button
            type="button"
            onClick={closeCanvas}
            aria-label="Close the composer"
            className="absolute right-3 top-2.5 z-20 flex items-center gap-1.5 rounded-full px-2 py-1 text-slate-500 transition-colors hover:bg-white/10 hover:text-white md:right-5"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest">Esc</span>
            <X className="h-3.5 w-3.5" />
          </button>
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
          /* THE INTERIOR IS SIZED TO THE TARGET, NOT TO THE ANIMATING SHELL.
             The shell spring-animates from the 68px collapsed bar up to full screen, and the
             panel tree used to mount inside it on the very first frame — i.e. into a box 68px
             tall. Every pixel `minSize` in this layout is violated at 68px, and a collapsible
             panel below its minimum collapses, so half the canvas snapped shut before it had
             ever been seen and stayed that way, because collapse is sticky. It also meant the
             initial layout was computed against a group of nearly zero size, which drops every
             constraint (see `ve()` in the library) and hands out equal shares instead of the
             defaults.
             Pinning the interior to the known target dimensions means the panels mount at
             their final size on frame one. The shell still animates; the content inside it no
             longer reflows nine panels sixty times on the way. */
          <div
            className="relative flex flex-col"
            style={{ width: target.width, height: target.height }}
          >
            {/* The run, always on screen, above everything it describes. */}
            <div className="relative z-10 pr-16 md:pr-20">
              <PipelineBar
                steps={pipeline.steps}
                onFocusPanel={focusPanel}
                composing={composing}
                onReset={resetLayout}
              />
            </div>

            <Group
              orientation="horizontal"
              groupRef={zonesRef}
              resizeTargetMinimumSize={RESIZE_TARGET}
              defaultLayout={zonesLayout.defaultLayout}
              onLayoutChanged={zonesLayout.onLayoutChanged}
              className="min-h-0 flex-1"
            >
              {/* Left zone: Assets + Cast */}
              <Panel
                id="leftZone"
                panelRef={leftZoneRef}
                defaultSize="18"
                minSize={180}
                maxSize="35"
                collapsible
                collapsedSize={ZONE_STUB}
                onResize={() => syncCollapsed('leftZone')}
                className="flex flex-col"
              >
                {collapsed.leftZone ? (
                  <ZoneStub
                    label="Assets"
                    icon={Search}
                    side="left"
                    running={zoneBusy(['assets', 'cast'])}
                    onExpand={() => togglePanel('leftZone')}
                  />
                ) : (
                  <>
                    <Group
                      orientation="vertical"
                      groupRef={leftGroupRef}
                      resizeTargetMinimumSize={RESIZE_TARGET}
                      defaultLayout={leftLayout.defaultLayout}
                      onLayoutChanged={leftLayout.onLayoutChanged}
                      className="min-h-0 flex-1"
                    >
                      <Panel id="assets" defaultSize="55" minSize={120} className="flex flex-col">
                        <AssetsPanel
                          id="canvas-panel-assets"
                          pool={pool}
                          castKeys={castKeys}
                          isMock={isMock}
                          onAdd={addAsset}
                          onPreview={setPreviewCandidate}
                          onBrowseCollection={browseCollection}
                        />
                      </Panel>
                      <Separator {...handleProps} />
                      <Panel id="cast" defaultSize="45" minSize={120} className="flex flex-col">
                        <CastPanel
                          id="canvas-panel-cast"
                          cast={cast}
                          primaryKey={primaryKey}
                          setPrimary={setPrimary}
                          removeAsset={removeAsset}
                          openPicker={openPicker}
                          loading={poolLoading && cast.length === 0}
                          full={cast.length >= 7}
                          analysis={screenwriter?.analysis}
                          readOnly={!composing}
                          status={status.cast}
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
                  </>
                )}
              </Panel>

              <Separator {...handleProps} />

              {/* Center zone: Prompt + Viewer + Storyboard */}
              <Panel id="centreZone" defaultSize="55" minSize="30" className="flex flex-col">
                <Group
                  orientation="vertical"
                  groupRef={centreGroupRef}
                  resizeTargetMinimumSize={RESIZE_TARGET}
                  defaultLayout={centreLayout.defaultLayout}
                  onLayoutChanged={centreLayout.onLayoutChanged}
                  className="min-h-0 flex-1"
                >
                  <Panel
                    id="prompt"
                    panelRef={promptRef}
                    defaultSize="14"
                    minSize={110}
                    maxSize="30"
                    collapsible
                    collapsedSize={PANEL_STRIP_HEIGHT}
                    onResize={() => syncCollapsed('prompt')}
                    className="flex flex-col"
                  >
                    <PromptPanel
                      id="canvas-panel-prompt"
                      prompt={prompt}
                      setPrompt={setPrompt}
                      onLaunch={launch}
                      ready={ready}
                      busy={resolving || screenwriter?.isWriting}
                      workerOk={workerOk}
                      readOnly={!composing}
                      onBackToCompose={screenwriter?.backToCompose}
                      collapsed={collapsed.prompt}
                      onToggle={() => togglePanel('prompt')}
                    />
                  </Panel>
                  <Separator {...handleProps} />
                  <Panel
                    id="viewer"
                    panelRef={viewerRef}
                    defaultSize="30"
                    minSize={150}
                    collapsible
                    collapsedSize={PANEL_STRIP_HEIGHT}
                    onResize={() => syncCollapsed('viewer')}
                    className="flex flex-col"
                  >
                    <MovieRenderPanel
                      id="canvas-panel-viewer"
                      primary={primary}
                      preview={preview}
                      previewLoading={previewLoading}
                      previewNfts={previewNfts}
                      onAdd={addPreviewToCast}
                      onNext={browseNext}
                      onPrev={browsePrev}
                      onClear={clearPreview}
                      collapsed={collapsed.viewer}
                      onToggle={() => togglePanel('viewer')}
                    />
                  </Panel>
                  <Separator {...handleProps} />
                  <Panel id="storyboard" defaultSize="56" minSize={180} className="flex flex-col">
                    <StoryboardPanel
                      id="canvas-panel-storyboard"
                      storyboarder={storyboarder}
                      token={token}
                      budget={budget}
                      status={status.storyboard}
                    />
                  </Panel>
                </Group>
              </Panel>

              <Separator {...handleProps} />

              {/* Right zone: agent inspector panels */}
              <Panel
                id="rightZone"
                panelRef={rightZoneRef}
                defaultSize="27"
                minSize={240}
                maxSize="45"
                collapsible
                collapsedSize={ZONE_STUB}
                onResize={() => syncCollapsed('rightZone')}
                className="flex flex-col"
              >
                {collapsed.rightZone ? (
                  <ZoneStub
                    label="Agents"
                    icon={Eye}
                    side="right"
                    running={zoneBusy(['castingDirector', 'writersRoom', 'screenplay', 'storyboarder'])}
                    failed={zoneFailed(['castingDirector', 'writersRoom', 'screenplay', 'storyboarder'])}
                    onExpand={() => togglePanel('rightZone')}
                  />
                ) : (
                  <Group
                    orientation="vertical"
                    groupRef={rightGroupRef}
                    resizeTargetMinimumSize={RESIZE_TARGET}
                    defaultLayout={rightLayout.defaultLayout}
                    onLayoutChanged={rightLayout.onLayoutChanged}
                    className="min-h-0 flex-1"
                  >
                    <Panel
                      id="castingDirector"
                      panelRef={castingDirectorRef}
                      defaultSize="22"
                      minSize={104}
                      collapsible
                      collapsedSize={PANEL_STRIP_HEIGHT}
                      onResize={() => syncCollapsed('castingDirector')}
                      className="flex flex-col"
                    >
                      <CastingDirectorPanel
                        id="canvas-panel-castingDirector"
                        cast={cast}
                        analysis={screenwriter?.analysis}
                        streams={screenwriter?.streams}
                        thoughts={screenwriter?.thoughts}
                        collapsed={collapsed.castingDirector}
                        onToggle={() => togglePanel('castingDirector')}
                        status={status.castingDirector}
                      />
                    </Panel>
                    <Separator {...handleProps} />
                    <Panel
                      id="writersRoom"
                      panelRef={writersRoomRef}
                      defaultSize="18"
                      minSize={104}
                      collapsible
                      collapsedSize={PANEL_STRIP_HEIGHT}
                      onResize={() => syncCollapsed('writersRoom')}
                      className="flex flex-col"
                    >
                      <ScreenwriterPanel
                        id="canvas-panel-writersRoom"
                        live={screenwriter?.live ?? []}
                        thoughts={screenwriter?.thoughts ?? {}}
                        error={screenwriter?.error ?? null}
                        collapsed={collapsed.writersRoom}
                        onToggle={() => togglePanel('writersRoom')}
                        status={status.writersRoom}
                      />
                    </Panel>
                    <Separator {...handleProps} />
                    <Panel
                      id="screenplay"
                      panelRef={screenplayRef}
                      defaultSize="30"
                      minSize={104}
                      collapsible
                      collapsedSize={PANEL_STRIP_HEIGHT}
                      onResize={() => syncCollapsed('screenplay')}
                      className="flex flex-col"
                    >
                      <ScreenplayPanel
                        id="canvas-panel-screenplay"
                        spec={screenwriter?.spec}
                        cast={cast}
                        analysis={screenwriter?.analysis}
                        rewriting={screenwriter?.rewriting}
                        live={screenwriter?.live ?? []}
                        trimBeat={screenwriter?.trimBeat}
                        requestTrim={screenwriter?.requestTrim}
                        collapsed={collapsed.screenplay}
                        onToggle={() => togglePanel('screenplay')}
                        status={status.screenplay}
                      />
                    </Panel>
                    <Separator {...handleProps} />
                    <Panel
                      id="storyboarder"
                      panelRef={storyboarderRef}
                      defaultSize="16"
                      minSize={104}
                      collapsible
                      collapsedSize={PANEL_STRIP_HEIGHT}
                      onResize={() => syncCollapsed('storyboarder')}
                      className="flex flex-col"
                    >
                      <StoryboarderPanel
                        id="canvas-panel-storyboarder"
                        spec={screenwriter?.spec}
                        cast={screenwriter?.writtenCast}
                        storyboarder={storyboarder}
                        pipeline={pipeline}
                        token={token}
                        budget={budget}
                        collapsed={collapsed.storyboarder}
                        onToggle={() => togglePanel('storyboarder')}
                        status={status.storyboarder}
                        onOpenProducer={() => focusPanel('producer')}
                      />
                    </Panel>
                    <Separator {...handleProps} />
                    <Panel
                      id="producer"
                      panelRef={producerRef}
                      defaultSize="14"
                      minSize={104}
                      collapsible
                      collapsedSize={PANEL_STRIP_HEIGHT}
                      onResize={() => syncCollapsed('producer')}
                      className="flex flex-col"
                    >
                      <ProducerPanel
                        id="canvas-panel-producer"
                        collapsed={collapsed.producer}
                        onToggle={() => togglePanel('producer')}
                      />
                    </Panel>
                  </Group>
                )}
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
