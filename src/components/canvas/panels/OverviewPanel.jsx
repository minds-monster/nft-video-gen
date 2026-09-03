import { Plus, Folder, Box, Code, Settings, Pin, SlidersHorizontal, MessageSquare } from 'lucide-react';

const OverviewPanel = ({ onNewTask, id }) => {
  return (
    <div id={id} className="flex-1 flex flex-col min-h-0 bg-transparent text-slate-300">
      <div className="p-4 flex flex-col gap-1">
        <button
          onClick={onNewTask}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span className="font-medium">New</span>
        </button>

        <div className="mt-2 flex flex-col gap-1">
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors opacity-60 cursor-not-allowed" disabled>
            <Folder className="h-4 w-4" />
            <span>Projects</span>
          </button>
          
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors opacity-60 cursor-not-allowed" disabled>
            <Box className="h-4 w-4" />
            <span>Artifacts</span>
          </button>

          <button className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 transition-colors opacity-60 cursor-not-allowed" disabled>
            <div className="flex items-center gap-3">
              <Code className="h-4 w-4" />
              <span>Code</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-400 bg-blue-500/10">Upgrade</span>
          </button>
          
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors opacity-60 cursor-not-allowed" disabled>
            <Settings className="h-4 w-4" />
            <span>Customize</span>
          </button>
        </div>
      </div>

      <div className="px-4 py-2 mt-4">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
          <span>Projects</span>
          <Plus className="h-3.5 w-3.5 cursor-not-allowed opacity-50" />
        </div>
        <button className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 cursor-not-allowed w-full text-left" disabled>
          <Pin className="h-4 w-4" />
          <span className="text-sm">Pin projects to keep them here</span>
        </button>
      </div>

      <div className="px-4 py-2 mt-4 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
          <span>Chats and tasks</span>
          <SlidersHorizontal className="h-3.5 w-3.5 cursor-not-allowed opacity-50" />
        </div>
        
        <div className="flex flex-col gap-1 mt-2">
          {/* Mock task list */}
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left w-full truncate">
            <span className="h-1.5 w-1.5 rounded-full border border-slate-500 shrink-0 opacity-50" />
            <span className="text-sm truncate">NFT movie maker interface redesign</span>
          </button>
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left w-full truncate">
            <span className="h-1.5 w-1.5 rounded-full border border-slate-500 shrink-0 opacity-50" />
            <span className="text-sm truncate">Cyberpunk city flythrough</span>
          </button>
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left w-full truncate">
            <span className="h-1.5 w-1.5 rounded-full border border-slate-500 shrink-0 opacity-50" />
            <span className="text-sm truncate">Pixel art character animation</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default OverviewPanel;
