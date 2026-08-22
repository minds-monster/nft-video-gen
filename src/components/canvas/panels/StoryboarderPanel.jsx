import { Clapperboard } from 'lucide-react';
import CanvasPanel from './CanvasPanel';

const StoryboarderPanel = ({ collapsed, onCollapse, onExpand }) => (
  <CanvasPanel title="Storyboarder" icon={Clapperboard} collapsed={collapsed} onCollapse={onCollapse} onExpand={onExpand}>
    <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
        <Clapperboard className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-white">Storyboarder isn&rsquo;t wired up yet</p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
          Once live, this panel will turn the screenplay into a shot-by-shot storyboard.
        </p>
      </div>
      <button
        type="button"
        disabled
        className="cursor-not-allowed rounded-xl bg-purple-600/40 px-4 py-2 text-xs font-semibold text-white/50"
      >
        Send to Storyboarder
      </button>
    </div>
  </CanvasPanel>
);

export default StoryboarderPanel;
