import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Clock, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { STATE } from '../../hooks/useProductionPipeline';
import { cn } from '../../lib/cn';
import CastingDirectorPanel from './panels/CastingDirectorPanel';
import ScreenwriterPanel from './panels/ScreenwriterPanel';
import ScreenplayPanel from './panels/ScreenplayPanel';
import StoryboarderPanel from './panels/StoryboarderPanel';
import ProducerPanel from './panels/ProducerPanel';
import TimelinePanel from './panels/TimelinePanel';

const CrewStrip = ({
  steps,
  status,
  cast,
  screenwriter,
  storyboarder,
  director,
  token,
  budget,
  pipeline,
  onAcceptBrief,
  onPreviewTake,
  preview,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [activePanel, setActivePanel] = useState('producer');

  const busy = steps.some((step) => step.state === STATE.RUNNING);
  const activeStep = steps.find((step) => step.state === STATE.RUNNING) || steps.find((step) => step.state === STATE.FAILED) || steps[steps.length - 1];

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  const getNodeIcon = (state) => {
    if (state === STATE.DONE) return <Check className="h-4 w-4 text-emerald-400" />;
    if (state === STATE.RUNNING) return <Loader2 className="h-4 w-4 text-purple-400 animate-spin" />;
    if (state === STATE.READY) return <Clock className="h-4 w-4 text-purple-200" />;
    if (state === STATE.FAILED) return <div className="h-2 w-2 rounded-full bg-amber-400" />;
    return <div className="h-2 w-2 rounded-full border border-slate-600 bg-transparent" />; // IDLE
  };

  const getLabelColor = (state) => {
    if (state === STATE.DONE) return 'text-slate-300';
    if (state === STATE.RUNNING) return 'text-white font-medium';
    if (state === STATE.READY) return 'text-purple-200';
    if (state === STATE.FAILED) return 'text-amber-400';
    return 'text-slate-500';
  };

  return (
    <div className="flex flex-col rounded-xl border border-white/10 bg-black/40 overflow-hidden shrink-0 mt-4">
      {/* Header Strip */}
      <div 
        className="flex flex-col gap-3 p-4 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white">Crew at work</span>
            <span className="text-slate-500 text-sm">— ~4m 20s typical wait</span>
          </div>
          <button className="text-slate-400 hover:text-white">
            {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </button>
        </div>

        {/* Nodes */}
        {/* <div className="flex items-center gap-2 overflow-x-auto pb-1 hide-scrollbar">
          {steps.map((step, index) => {
            // Ignore composing/neural canvas step if it's there
            if (step.id === 'compose') return null;

            return (
              <div key={step.id} className="flex items-center shrink-0">
                {index > 1 && (
                  <div className="w-8 md:w-16 h-[1px] bg-white/10 mx-2" />
                )}
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-5 h-5">
                    {getNodeIcon(step.state)}
                  </div>
                  <span className={cn('text-sm whitespace-nowrap', getLabelColor(step.state))}>
                    {step.label}
                    {step.beta && (
                      <span className="ml-1.5 rounded bg-amber-400/10 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-amber-300/80">
                        Beta
                      </span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div> */}

        {/* Live Text Snippet */}
        {activeStep?.detail && (
          <div className="text-sm italic text-slate-400 min-h-[1.25rem] truncate mt-1">
            "{activeStep.detail}"
          </div>
        )}
      </div>

      {/* Expanded Details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/10"
          >
            <div className="flex flex-col bg-black/60 relative">
              {[
                { id: 'castingDirector', label: 'Casting Director' },
                { id: 'writersRoom', label: 'Screenwriter' },
                { id: 'screenplay', label: 'Screenplay' },
                { id: 'storyboarder', label: 'Storyboarder' },
                { id: 'director', label: 'Timeline' },
                { id: 'producer', label: 'Producer' }
              ].map(tab => (
                <div key={tab.id} className="flex flex-col border-b border-white/10 last:border-b-0">
                  <button
                    onClick={() => setActivePanel(activePanel === tab.id ? null : tab.id)}
                    className="flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-white/5 transition-colors text-slate-300 hover:text-white"
                  >
                    <span>{tab.label}</span>
                    {activePanel === tab.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <AnimatePresence>
                    {activePanel === tab.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="max-h-[400px] overflow-y-auto bg-black/40 relative">
                          {tab.id === 'castingDirector' && (
                            <CastingDirectorPanel
                              cast={cast}
                              analysis={screenwriter?.analysis}
                              streams={screenwriter?.streams}
                              thoughts={screenwriter?.thoughts}
                              status={status?.castingDirector}
                              collapsed={false}
                            />
                          )}
                          {tab.id === 'writersRoom' && (
                            <ScreenwriterPanel
                              live={screenwriter?.live ?? []}
                              thoughts={screenwriter?.thoughts ?? {}}
                              error={screenwriter?.error ?? null}
                              status={status?.writersRoom}
                              collapsed={false}
                            />
                          )}
                          {tab.id === 'screenplay' && (
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
                          {tab.id === 'storyboarder' && (
                            <StoryboarderPanel
                              spec={screenwriter?.spec}
                              cast={screenwriter?.writtenCast}
                              storyboarder={storyboarder}
                              pipeline={pipeline}
                              token={token}
                              budget={budget}
                              status={status?.storyboarder}
                              collapsed={false}
                            />
                          )}
                          {tab.id === 'producer' && (
                            <ProducerPanel
                              onAcceptBrief={onAcceptBrief}
                              acceptedBriefAt={director?.brief?.acceptedAt ?? 0}
                              collapsed={false}
                            />
                          )}
                          {tab.id === 'director' && (
                            <TimelinePanel
                              storyboarder={storyboarder}
                              director={director}
                              token={token}
                              budget={budget}
                              status={status?.storyboard}
                              activeTakeId={preview?.takeId ?? null}
                              onPreviewTake={onPreviewTake}
                            />
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CrewStrip;
