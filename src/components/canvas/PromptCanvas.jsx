import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Loader2, Search, Send, Sparkles, X, Menu } from 'lucide-react';
import HudFrame from './HudFrame';
import ContractDock from './ContractDock';
import AssetPicker from './AssetPicker';
import AssetsPanel from './panels/AssetsPanel';
import CastPanel from './panels/CastPanel';
import MovieRenderPanel from './panels/MovieRenderPanel';
import PromptSuggestions from './panels/PromptSuggestions';
import OverviewPanel from './panels/OverviewPanel';
import LoginPanel from './panels/LoginPanel';
import { filmIdFor } from '../../../worker/film-id.js';
import CrewStrip from './CrewStrip';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useMindChatContext } from '../../context/mindChat';
import { useMindStatusBadge } from '../../hooks/useMindStatusBadge';
import { useProductionPipeline } from '../../hooks/useProductionPipeline';
import { checkHealth } from '../../services/swarm';
import { STAGE } from '../../hooks/useScreenwriter';
import { cn } from '../../lib/cn';
import { useTasks } from '../../hooks/useSupabaseData';
import { useAuth } from '../../context/AuthContext';
import { resolveNftName } from '../../lib/nftMedia';

const EXPANDED_INSET = 24;
const COLLAPSED_RADIUS = 10;
const EXPANDED_RADIUS = 14;
const GLASS = 'rgba(18, 10, 26, 0.55)';
const SOLID = 'rgb(9, 4, 15)';
export const COLLAPSED_HEIGHT = 68;

const PromptCanvas = ({ composer, onLaunch, screenwriter, storyboarder, director, onStartFresh, budgetBoostUntil = null }) => {
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
    previewTake,
    browseCollection,
    browseNext,
    browsePrev,
    addPreviewToCast,
    clearPreview,
  } = composer;

  const hasShot = preview?.takeId || previewNfts?.length > 0;

  const shellRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const wide = useMediaQuery('(min-width: 768px)');

  const { session } = useMindChatContext();
  const token = session?.token;
  const badge = useMindStatusBadge({ token, active: Boolean(token) && open, boostUntil: budgetBoostUntil });
  const budget = badge?.budget;

  const pipeline = useProductionPipeline({ composer, screenwriter, storyboarder, director, token, budget });
  const status = pipeline.panelStatus;

  const spec = screenwriter?.spec ?? null;
  const loadDirectorPlan = director?.loadPlan;
  const loadDirectorProduction = director?.loadProduction;
  useEffect(() => {
    if (!token || !spec?.beats?.length) return;
    loadDirectorPlan?.({ spec, cast, token });
  }, [token, spec, cast, budget?.total, loadDirectorPlan]);

  useEffect(() => {
    if (!token || !spec?.beats?.length) return;
    loadDirectorProduction?.({ token, filmId: filmIdFor(spec) });
  }, [token, spec, loadDirectorProduction]);

  const { user } = useAuth();
  const { createTask, updateTask } = useTasks();
  const [activeTaskId, setActiveTaskId] = useState(null);

  const handleNewTask = useCallback(() => {
    onStartFresh?.();
    setActiveTaskId(null);
    setViewMode('assets');
  }, [onStartFresh]);

  const handleTaskSelect = useCallback((task) => {
    setActiveTaskId(task.id);
    composer.restore({
      prompt: task.prompt,
      cast: task.cast_data,
      primaryKey: task.primary_cast_key
    });
    if (task.spec && screenwriter?.restore) {
      screenwriter.restore({
        stage: STAGE.COMPOSE,
        spec: task.spec,
        writtenCast: [],
        caps: {}
      });
    }
    if (task.preview_take_id) {
      previewTake(task.preview_take_id);
    } else {
      clearPreview();
    }
    setViewMode('assets');
  }, [composer, screenwriter, previewTake, clearPreview]);
  
  // Sync state to task
  useEffect(() => {
    if (!user) return;
    
    const syncToTask = async () => {
      let savePrompt = prompt;
      if (!savePrompt && cast.length > 0) {
        savePrompt = resolveNftName(cast[0].nft);
      }

      const taskData = {
        prompt: savePrompt,
        cast_data: cast,
        primary_cast_key: primaryKey,
        spec,
        preview_take_id: preview?.takeId
      };
      
      if (activeTaskId) {
        await updateTask(activeTaskId, taskData);
      } else if (prompt || cast.length > 0) {
        const newTask = await createTask(taskData);
        if (newTask) {
          setActiveTaskId(newTask.id);
        }
      }
    };
    
    // Debounce the sync
    const timeoutId = setTimeout(syncToTask, 1500);
    return () => clearTimeout(timeoutId);
  }, [user, prompt, cast, primaryKey, spec, preview?.takeId, activeTaskId, createTask, updateTask]);

  const acceptBrief = director?.acceptBrief;
  const onAcceptBrief = useCallback(
    (brief) => acceptBrief?.({ brief, spec, cast, token }),
    [acceptBrief, spec, cast, token],
  );

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

  const [leftWidth, setLeftWidth] = useState(25);
  const [middleWidth, setMiddleWidth] = useState(50);
  const [rightWidth, setRightWidth] = useState(25);
  const [isDragging, setIsDragging] = useState(false);
  const dragTarget = useRef(null);
  const [viewMode, setViewMode] = useState('overview');

  const handleMouseDownLeft = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    dragTarget.current = 'left';
  }, []);

  const handleMouseDownRight = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    dragTarget.current = 'right';
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      if (!shellRef.current) return;
      const rect = shellRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percentage = (x / rect.width) * 100;

      if (dragTarget.current === 'left') {
        const newLeft = Math.max(10, Math.min(percentage, 50));
        setLeftWidth(newLeft);
        setMiddleWidth(100 - newLeft - rightWidth);
      } else if (dragTarget.current === 'right') {
        const newRight = Math.max(10, Math.min(100 - percentage, 50));
        setRightWidth(newRight);
        setMiddleWidth(100 - leftWidth - newRight);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragTarget.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, hasShot, rightWidth, leftWidth]);

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

  const viewedTake = useMemo(() => {
    if (!preview?.takeId) return null;
    return (director?.takes ?? []).find((take) => take.takeId === preview.takeId) ?? null;
  }, [preview?.takeId, director?.takes]);

  const viewedTakeIndex = useMemo(() => {
    if (!viewedTake) return null;
    const at = (director?.finalTakes ?? []).findIndex((take) => take.takeId === viewedTake.takeId);
    return at < 0 ? null : at + 1;
  }, [viewedTake, director?.finalTakes]);

  const onPreviewTake = useCallback(
    (takeId) => {
      previewTake(takeId);
    },
    [previewTake],
  );

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
          'composer-bloom overflow-hidden border border-slate-700/50 outline-none flex flex-col',
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
          <div
            className="relative flex flex-col h-full w-full"
          >
            {/* 1. Top Header */}
            <div className="shrink-0 flex items-center px-4 md:px-6 py-4 border-b border-white/10">
              {viewMode !== 'overview' && (
                <button 
                  onClick={() => setViewMode('overview')} 
                  className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
                >
                  <Menu className="h-5 w-5" />
                </button>
              )}
            </div>

            {/* 2. Three-column main area */}
            <div className="flex flex-col md:hidden flex-1 min-h-0">
              {/* Mobile Column 1: Asset catalog or Overview */}
              <div className="w-full shrink-0 border-b border-white/10 flex flex-col relative bg-black/20 max-h-[40vh]">
                {viewMode === 'overview' ? (
                  <OverviewPanel id="canvas-panel-overview-mobile" onNewTask={handleNewTask} onTaskSelect={handleTaskSelect} />
                ) : (
                  <>
                    <div className="flex-1 flex flex-col min-h-0 p-4">
                      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 shrink-0">Your collections</h3>
                      <AssetsPanel
                        id="canvas-panel-assets-mobile"
                        pool={pool}
                        castKeys={castKeys}
                        isMock={isMock}
                        onAdd={addAsset}
                        onPreview={setPreviewCandidate}
                        onBrowseCollection={browseCollection}
                      />
                    </div>
                    <div className="shrink-0 border-t border-white/10 p-3 bg-black/40">
                      <ContractDock
                        onResolve={resolveContract}
                        resolving={resolving}
                        error={resolveError}
                        onReshuffle={reshuffle}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Mobile Column 2: Viewer */}
              <div className="flex flex-col transition-all duration-500 ease-in-out p-4 flex-1 min-h-0 justify-center">
                <AnimatePresence mode="popLayout">
                  {!user && viewMode === 'overview' && (
                    <motion.div
                      key="login-mobile"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.3 }}
                      layout
                      className="flex-1 min-h-0 flex flex-col relative mb-4"
                    >
                      <LoginPanel id="canvas-panel-login-mobile" />
                    </motion.div>
                  )}
                  {user && viewMode === 'overview' && (
                    <motion.div
                      key="create-project-mobile"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.3 }}
                      layout
                      className="flex-1 flex flex-col items-center justify-center gap-4 text-center h-full mb-4"
                    >
                      <div className="w-16 h-16 bg-purple-600/20 text-purple-400 rounded-2xl flex items-center justify-center mb-2">
                        <Plus className="h-8 w-8" />
                      </div>
                      <h2 className="text-xl font-semibold text-white">Start a new project</h2>
                      <button 
                        onClick={handleNewTask}
                        className="mt-2 flex items-center gap-2 px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium transition-all shadow-lg hover:shadow-purple-500/25"
                      >
                        <Plus className="h-5 w-5" />
                        Create New Project
                      </button>
                    </motion.div>
                  )}
                  {viewMode !== 'overview' && (preview || primary || viewedTake) && (
                    <motion.div
                      key="viewer"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.3 }}
                      layout
                      className="flex-1 min-h-0 flex flex-col relative"
                    >
                      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 shrink-0">Viewer</h3>
                      <div className="flex-1 min-h-0 flex flex-col">
                        <MovieRenderPanel
                          id="canvas-panel-viewer-mobile"
                          primary={primary}
                          preview={preview}
                          previewLoading={previewLoading}
                          previewNfts={previewNfts}
                          take={viewedTake}
                          takeIndex={viewedTakeIndex}
                          onJudge={director?.judge}
                          onRemember={director?.remember}
                          onAdd={addPreviewToCast}
                          onNext={browseNext}
                          onPrev={browsePrev}
                          onClear={clearPreview}
                          collapsed={false}
                          onToggle={() => {}}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                
                {viewMode !== 'overview' && (
                  <motion.div layout className="mt-4 flex flex-col gap-3 shrink-0 w-full max-w-3xl mx-auto">
                    <div className="flex items-center gap-3 bg-black/40 rounded-xl border border-white/10 px-4 py-2 shadow-sm">
                      <Sparkles className="h-5 w-5 text-purple-400" />
                      <textarea
                        rows={1}
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        readOnly={!composing}
                        placeholder="Describe your film..."
                        className="flex-1 resize-none bg-transparent text-slate-300 outline-none placeholder:text-slate-600 py-2"
                      />
                      <button
                        type="button"
                        onClick={launch}
                        disabled={!ready}
                        className={cn(
                          'flex shrink-0 items-center justify-center rounded-xl p-2.5 text-white transition-colors',
                          'bg-purple-600 hover:bg-purple-500',
                          'disabled:bg-purple-600/40 disabled:text-white/50',
                        )}
                      >
                        {resolving ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Send className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                    <PromptSuggestions
                      onSelect={setPrompt}
                      count={3}
                      className="justify-center"
                    />
                  </motion.div>
                )}
              </div>

              {/* Mobile Column 3: Cast slots */}
              <div className={cn("flex-1 flex flex-col bg-black/40 p-4 overflow-y-auto", (hasShot || viewMode === 'overview') && "hidden")}>
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 shrink-0">Your cast</h3>
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
                
                <CrewStrip
                  steps={pipeline.steps}
                  status={status}
                  cast={cast}
                  screenwriter={screenwriter}
                  storyboarder={storyboarder}
                  director={director}
                  token={token}
                  budget={budget}
                  pipeline={pipeline}
                  onAcceptBrief={onAcceptBrief}
                  onPreviewTake={onPreviewTake}
                  preview={preview}
                />
              </div>
            </div>

            <div className="hidden md:flex flex-row flex-1 min-h-0 w-full">
              {/* Column 1: Asset catalog or Overview */}
              <div 
                className="shrink-0 border-r border-white/10 flex flex-col relative bg-black/20"
                style={{ width: `${leftWidth}%` }}
              >
                {viewMode === 'overview' ? (
                  <OverviewPanel id="canvas-panel-overview" onNewTask={handleNewTask} onTaskSelect={handleTaskSelect} />
                ) : (
                  <>
                    <div className="flex-1 flex flex-col min-h-0 p-4">
                      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 shrink-0">Your collections</h3>
                      <AssetsPanel
                        id="canvas-panel-assets"
                        pool={pool}
                        castKeys={castKeys}
                        isMock={isMock}
                        onAdd={addAsset}
                        onPreview={setPreviewCandidate}
                        onBrowseCollection={browseCollection}
                      />
                    </div>
                    <div className="shrink-0 border-t border-white/10 p-3 bg-black/40">
                      <ContractDock
                        onResolve={resolveContract}
                        resolving={resolving}
                        error={resolveError}
                        onReshuffle={reshuffle}
                      />
                    </div>
                  </>
                )}
              </div>
              
              {/* Resizer 1 */}
              <div
                className="w-2 -ml-1 -mr-1 z-10 cursor-col-resize flex items-center justify-center hover:bg-purple-500/50 active:bg-purple-500 group"
                onMouseDown={handleMouseDownLeft}
              >
                <div className="w-0.5 h-8 bg-white/20 rounded-full group-hover:bg-white" />
              </div>

              {/* Column 2: Chatbot style viewer */}
              <div 
                className="shrink-0 border-r border-white/10 flex flex-col transition-all duration-500 ease-in-out min-w-0 p-4"
                style={{ width: viewMode === 'overview' ? `${100 - leftWidth}%` : `${middleWidth}%` }}
              >
                <div className="flex-1 min-h-0 flex flex-col justify-center">
                  <AnimatePresence mode="popLayout">
                    {!user && viewMode === 'overview' && (
                      <motion.div
                        key="login-mid"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.3 }}
                        layout
                        className="flex-1 min-h-0 flex flex-col mb-4"
                      >
                        <LoginPanel id="canvas-panel-login-mid" />
                      </motion.div>
                    )}
                    {user && viewMode === 'overview' && (
                      <motion.div
                        key="create-project"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.3 }}
                        layout
                        className="flex-1 flex flex-col items-center justify-center gap-4 text-center h-full"
                      >
                        <div className="w-16 h-16 bg-purple-600/20 text-purple-400 rounded-2xl flex items-center justify-center mb-2 shadow-[0_0_30px_-5px_rgba(147,51,234,0.3)]">
                          <Plus className="h-8 w-8" />
                        </div>
                        <h2 className="text-3xl font-semibold text-white tracking-tight">Start a new project</h2>
                        <p className="text-slate-400 max-w-md text-base leading-relaxed">
                          Create a new film, or select an existing project from the sidebar to continue working.
                        </p>
                        <button 
                          onClick={handleNewTask}
                          className="mt-6 flex items-center gap-2 px-8 py-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium transition-all shadow-[0_0_40px_-10px_rgba(147,51,234,0.5)] hover:shadow-[0_0_60px_-15px_rgba(147,51,234,0.7)] hover:scale-105 active:scale-95"
                        >
                          <Plus className="h-5 w-5" />
                          Create New Project
                        </button>
                      </motion.div>
                    )}
                    {viewMode !== 'overview' && (preview || primary || viewedTake) && (
                      <motion.div
                        key="viewer"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.3 }}
                        layout
                        className="flex-1 min-h-0 flex flex-col mb-4 relative"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (preview) clearPreview();
                            if (primary) setPrimary(null);
                          }}
                          className="absolute right-3 top-2 z-20 flex items-center justify-center rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                          aria-label="Close viewer"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <MovieRenderPanel
                          id="canvas-panel-viewer"
                          primary={primary}
                          preview={preview}
                          previewLoading={previewLoading}
                          previewNfts={previewNfts}
                          take={viewedTake}
                          takeIndex={viewedTakeIndex}
                          onJudge={director?.judge}
                          onRemember={director?.remember}
                          onAdd={addPreviewToCast}
                          onNext={browseNext}
                          onPrev={browsePrev}
                          onClear={clearPreview}
                          collapsed={false}
                          onToggle={() => {}}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {viewMode !== 'overview' && (
                    <motion.div layout className="flex flex-col gap-3 shrink-0 w-full max-w-3xl mx-auto">
                      <div className="flex items-center gap-3 bg-black/40 rounded-xl border border-white/10 px-4 py-2 shadow-lg">
                        <Sparkles className="h-5 w-5 text-purple-400" />
                        <textarea
                          rows={1}
                          value={prompt}
                          onChange={(event) => setPrompt(event.target.value)}
                          readOnly={!composing}
                          placeholder="Describe your film..."
                          className="flex-1 resize-none bg-transparent text-slate-300 outline-none placeholder:text-slate-600 py-2"
                        />
                        <button
                          type="button"
                          onClick={launch}
                          disabled={!ready}
                          className={cn(
                            'flex shrink-0 items-center justify-center rounded-xl p-2.5 text-white transition-colors',
                            'bg-purple-600 hover:bg-purple-500',
                            'disabled:bg-purple-600/40 disabled:text-white/50',
                          )}
                        >
                          {resolving ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Send className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                      <PromptSuggestions
                        onSelect={setPrompt}
                        count={3}
                        className="justify-center"
                      />
                    </motion.div>
                  )}
                </div>
              </div>

              {/* Resizer 2 */}
              {viewMode !== 'overview' && (
                <div
                  className="w-2 -ml-1 -mr-1 z-10 cursor-col-resize flex items-center justify-center hover:bg-purple-500/50 active:bg-purple-500 group"
                  onMouseDown={handleMouseDownRight}
                >
                  <div className="w-0.5 h-8 bg-white/20 rounded-full group-hover:bg-white" />
                </div>
              )}

              {/* Column 3: Cast slots */}
              {viewMode !== 'overview' && (
                <div 
                  className="shrink-0 flex flex-col bg-black/40 p-4 overflow-y-auto min-w-0"
                  style={{ width: `${rightWidth}%` }}
                >
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 shrink-0">Your cast</h3>
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

                  <CrewStrip
                    steps={pipeline.steps}
                    status={status}
                    cast={cast}
                    screenwriter={screenwriter}
                    storyboarder={storyboarder}
                    director={director}
                    token={token}
                    budget={budget}
                    pipeline={pipeline}
                    onAcceptBrief={onAcceptBrief}
                    onPreviewTake={onPreviewTake}
                    preview={preview}
                  />
                </div>
              )}
            </div>



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
