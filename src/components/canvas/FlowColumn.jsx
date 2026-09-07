import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import MovieRenderPanel from './panels/MovieRenderPanel';
import CastingLog from './CastingLog';
import PromptSuggestions from './panels/PromptSuggestions';
import ScreenwriterPanel from './panels/ScreenwriterPanel';
import ScreenplayPanel from './panels/ScreenplayPanel';
import StoryboarderPanel from './panels/StoryboarderPanel';
import DirectorPanel from './panels/DirectorPanel';
import TimelinePanel from './panels/TimelinePanel';
import { useEffect, useRef } from 'react';

const Connector = () => (
  <motion.div 
    layout
    initial={{ opacity: 0, height: 0 }}
    animate={{ opacity: 1, height: 40 }}
    exit={{ opacity: 0, height: 0 }}
    className="flex justify-center w-full my-2 shrink-0 overflow-hidden relative"
  >
    <div className="w-0.5 h-full bg-white/10 absolute top-0" />
    <motion.div 
      initial={{ top: "-100%" }}
      animate={{ top: "100%" }}
      transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
      className="w-0.5 h-[50%] bg-gradient-to-b from-transparent via-purple-500 to-transparent absolute"
    />
  </motion.div>
);

const FlowColumn = ({
  idSuffix = '',
  composing,
  prompt,
  setPrompt,
  launch,
  ready,
  resolving,
  preview,
  primary,
  viewedTake,
  previewLoading,
  previewNfts,
  viewedTakeIndex,
  director,
  addPreviewToCast,
  browseNext,
  browsePrev,
  clearPreview,
  setPrimary,
  cast,
  screenwriter,
  storyboarder,
  pipeline,
  token,
  budget,
  status,
  onAcceptBrief,
  onPreviewTake
}) => {
  const isProcessStarted = !composing;
  const isViewerVisible = Boolean(preview || viewedTake);
  const isCastingLogVisible = cast.some(entry => {
    const state = screenwriter?.analysis?.[entry.key];
    return state && state.status !== 'queued';
  });
  const hasContentBelow = isProcessStarted || isViewerVisible || isCastingLogVisible;
  const isCentered = !hasContentBelow;

  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current && isCentered) {
      textareaRef.current.focus();
    }
  }, [isCentered]);

  return (
    <div className={cn("flex-1 min-h-0 flex flex-col items-center w-full h-full pb-20", isCentered ? "justify-center" : "justify-start")}>
      <AnimatePresence mode="popLayout">
          <motion.div layout key="flow-content" className="w-full flex flex-col items-center pt-4 pb-[10%]">
            {/* 1. The Prompt */}
            {!composing && prompt ? (
              <motion.div layout className="w-full max-w-3xl shrink-0 p-5 rounded-2xl bg-black/40 border border-white/10 shadow-lg z-10">
                <div className="flex items-center gap-2 text-purple-400 mb-2">
                  <Sparkles className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-wider">Your Prompt</span>
                </div>
                <p className="text-xl text-white leading-relaxed font-light">{prompt}</p>
              </motion.div>
            ) : composing && (
              <motion.div layout className="flex flex-col gap-3 shrink-0 w-full max-w-3xl z-10">
                <motion.div layout className="mb-2 text-center">
                  <h2 className="text-2xl font-medium text-slate-200 tracking-wide">Where will your story begin?</h2>
                </motion.div>
                <div className="flex items-center gap-3 bg-black/40 rounded-xl border border-white/10 px-4 py-2 shadow-lg">
                  <Sparkles className="h-5 w-5 text-purple-400" />
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    readOnly={!composing}
                    placeholder="Describe your film"
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

            {/* Connecting line to Casting Director */}
            {!composing && cast.length > 0 && <Connector />}

            {/* 2. Casting Log / Pros */}
            {cast.length > 0 && (
              <motion.div layout className="w-full max-w-3xl shrink-0 z-10 flex flex-col">
                <CastingLog
                  cast={cast}
                  analysis={screenwriter?.analysis}
                  streams={screenwriter?.streams}
                  thoughts={screenwriter?.thoughts}
                />
              </motion.div>
            )}

            {/* The rest of the pipeline panels in the second column */}
            {!composing && cast.length > 0 && (
              <motion.div layout className="w-full max-w-3xl shrink-0 z-10 grid gap-4 mt-4">
                {status?.writersRoom && (
                  <ScreenwriterPanel
                    live={screenwriter?.live ?? []}
                    thoughts={screenwriter?.thoughts ?? {}}
                    error={screenwriter?.error ?? null}
                    status={status?.writersRoom}
                    collapsed={false}
                  />
                )}
                
                {status?.screenplay && (
                  <ScreenplayPanel
                    spec={screenwriter?.spec}
                    cast={cast}
                    analysis={screenwriter?.analysis}
                    rewriting={screenwriter?.rewriting}
                    live={screenwriter?.live ?? []}
                    trimBeat={screenwriter?.trimBeat}
                    requestTrim={screenwriter?.requestTrim}
                    status={status?.screenplay}
                    collapsed={false}
                  />
                )}
                
                {(status?.storyboarder || status?.storyboard) && (
                  <StoryboarderPanel
                    spec={screenwriter?.spec}
                    cast={screenwriter?.writtenCast}
                    storyboarder={storyboarder}
                    pipeline={pipeline}
                    token={token}
                    budget={budget}
                    status={status?.storyboarder || status?.storyboard}
                    collapsed={false}
                  />
                )}
                
                {status?.screenplay && director && (
                  <DirectorPanel
                    director={director}
                    spec={screenwriter?.spec}
                    cast={cast}
                    token={token}
                    status={status?.director}
                    collapsed={false}
                  />
                )}

                {status?.director && (director?.takes?.length > 0 || storyboarder?.frames?.length > 0) && (
                  <TimelinePanel
                    storyboarder={storyboarder}
                    director={director}
                    token={token}
                    budget={budget}
                    status={status?.director || status?.storyboard}
                    activeTakeId={preview?.takeId ?? null}
                    onPreviewTake={onPreviewTake}
                  />
                )}
              </motion.div>
            )}

            {/* Connecting line to Output Video */}
            {((composing && preview) || viewedTake) && <Connector />}

            {/* 3. Output Video (Viewer) */}
            {((composing && preview) || viewedTake) && (
              <motion.div layout className="w-full max-w-3xl shrink-0 flex flex-col relative z-10">
                <button
                  type="button"
                  onClick={() => {
                    if (preview) clearPreview();
                    if (primary) setPrimary(null);
                  }}
                  className="absolute right-3 top-2 z-20 flex items-center justify-center rounded-md p-1 bg-black/50 hover:bg-black/80 text-white rounded-full transition-all"
                  aria-label="Close viewer"
                >
                  <X className="h-4 w-4" />
                </button>
                <MovieRenderPanel
                  id={`canvas-panel-viewer${idSuffix}`}
                  primary={primary}
                  preview={preview}
                  previewLoading={previewLoading}
                  previewNfts={previewNfts}
                  take={viewedTake}
                  takeIndex={viewedTakeIndex}
                  onJudge={director?.judge}
                  onRemember={director?.remember}
                  onAdd={() => {
                    addPreviewToCast();
                    clearPreview();
                  }}
                  onNext={browseNext}
                  onPrev={browsePrev}
                  onClear={clearPreview}
                  collapsed={false}
                  onToggle={() => {}}
                />
              </motion.div>
            )}
          </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default FlowColumn;
