import { Film } from 'lucide-react';
import CanvasPanel from './CanvasPanel';

const StoryboardPanel = () => (
  <CanvasPanel title="Storyboard" icon={Film}>
    <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
        <Film className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-white">Timeline is empty</p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
          Generated storyboard frames will appear here once the Storyboarder is connected.
        </p>
      </div>
    </div>
  </CanvasPanel>
);

export default StoryboardPanel;
