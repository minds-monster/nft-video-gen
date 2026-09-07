import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Clock, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { STATE } from '../../hooks/useProductionPipeline';
import { cn } from '../../lib/cn';

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
  const [expanded, setExpanded] = useState(false);

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
            {/* <span className="text-slate-500 text-sm">— ~4m 20s typical wait</span> */}
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
            <div className="flex flex-col bg-black/60 relative p-4 gap-3">
              {[
                { id: 'castingDirector', label: 'Casting Director', desc: 'Selects the ideal AI actors and voice profiles for the script.' },
                { id: 'writersRoom', label: 'Screenwriter', desc: 'Develops the core narrative and dialogue for the video.' },
                { id: 'screenplay', label: 'Screenplay', desc: 'Formats the narrative into a structured, shot-by-shot script.' },
                { id: 'storyboarder', label: 'Storyboarder', desc: 'Generates visual representations for each scene.' },
                { id: 'director', label: 'Timeline', desc: 'Sequences shots, audio, and transitions into a coherent flow.' },
                { id: 'producer', label: 'Producer', desc: 'Oversees the final assembly and rendering of the video.' }
              ].map(role => (
                <div key={role.id} className="flex items-center gap-3 border-b border-white/10 pb-3 last:border-b-0 last:pb-0">
                  <span className="text-[11px] font-medium text-slate-200 bg-white/10 px-2 py-1 rounded shrink-0">{role.label}</span>
                  <span className="text-[11px] text-slate-400 truncate">{role.desc}</span>
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
