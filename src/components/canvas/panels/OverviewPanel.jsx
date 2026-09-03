import { Plus, Folder, Box, Code, Settings, Pin, SlidersHorizontal, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useProjects, useTasks } from '../../../hooks/useSupabaseData';
import { cn } from '../../../lib/cn';

const OverviewPanel = ({ onNewTask, onTaskSelect, id }) => {
  const { user, signOut } = useAuth();
  const { projects, loading: projectsLoading } = useProjects();
  const { tasks, loading: tasksLoading } = useTasks();
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
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors">
            <Folder className="h-4 w-4" />
            <span>Projects</span>
          </button>
          
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors opacity-60 cursor-not-allowed" disabled>
            <Box className="h-4 w-4" />
            <span>Artifacts</span>
          </button>
          
          <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors opacity-60 cursor-not-allowed" disabled>
            <Settings className="h-4 w-4" />
            <span>Customize</span>
          </button>
        </div>
      </div>

      <div className="px-4 py-2 mt-4 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2 shrink-0">
          <span>Projects</span>
        </div>
        
        <div className="flex flex-col gap-1 overflow-y-auto max-h-[30%] mb-2">
          {projectsLoading ? (
            <div className="text-xs text-slate-500 px-2 py-1">Loading...</div>
          ) : projects.length === 0 ? (
            <div className="text-xs text-slate-500 px-2 py-1">No projects yet.</div>
          ) : (
            projects.map(p => (
              <button key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left w-full truncate">
                <Folder className="h-4 w-4 text-purple-400" />
                <span className="text-sm truncate">{p.name}</span>
              </button>
            ))
          )}
        </div>



        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2 mt-4 shrink-0">
          <span>Recent Tasks</span>
          <SlidersHorizontal className="h-3.5 w-3.5 opacity-50" />
        </div>
        
        <div className="flex flex-col gap-1 overflow-y-auto flex-1">
          {tasksLoading ? (
            <div className="text-xs text-slate-500 px-2 py-1">Loading...</div>
          ) : tasks.length === 0 ? (
            <div className="text-xs text-slate-500 px-2 py-1">No tasks yet.</div>
          ) : (
            tasks.map(t => (
              <button key={t.id} onClick={() => onTaskSelect?.(t)} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left w-full truncate">
                <span className={cn("h-1.5 w-1.5 rounded-full border shrink-0", t.status === 'completed' ? 'bg-green-500 border-green-500' : 'border-slate-500 opacity-50')} />
                <span className="text-sm truncate">{t.prompt || 'Untitled Task'}</span>
              </button>
            ))
          )}
        </div>

        <div className="mt-auto shrink-0 pt-4 pb-2 border-t border-white/10">
          <button onClick={signOut} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors w-full text-left">
            <LogOut className="h-4 w-4" />
            <span className="text-sm">Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default OverviewPanel;
