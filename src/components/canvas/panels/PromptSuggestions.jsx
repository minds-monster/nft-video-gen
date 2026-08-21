import { useState } from 'react';
import { PROMPT_IDEAS } from '../../../data/prompts';
import { cn } from '../../../lib/cn';

/**
 * A small shuffled row of suggested prompts. Used in the hero and in the prompt panel.
 */
const PromptSuggestions = ({
  onSelect,
  count = 4,
  showRefresh = true,
  className,
  label = 'Try',
}) => {
  const [ideas, setIdeas] = useState(() => {
    const shuffled = [...PROMPT_IDEAS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  });

  const refresh = () => {
    const shuffled = [...PROMPT_IDEAS].sort(() => 0.5 - Math.random());
    setIdeas(shuffled.slice(0, count));
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="mr-1 font-mono text-[10px] uppercase tracking-widest text-slate-600">
        {label}
      </span>
      {ideas.map((idea) => (
        <button
          key={idea}
          type="button"
          onClick={() => onSelect?.(idea)}
          className="chip px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          {idea}
        </button>
      ))}
      {showRefresh && (
        <button
          type="button"
          onClick={refresh}
          className="chip px-2 py-1.5 text-xs text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
        >
          Refresh
        </button>
      )}
    </div>
  );
};

export default PromptSuggestions;
