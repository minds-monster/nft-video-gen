import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export function useProjects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    if (!user) {
      setProjects([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setProjects(data);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = async (name) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('projects')
      .insert([{ name, user_id: user.id }])
      .select()
      .single();
      
    if (!error && data) {
      setProjects(prev => [data, ...prev]);
      return data;
    }
    return null;
  };

  const deleteProject = async (id) => {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (!error) {
      setProjects(prev => prev.filter(p => p.id !== id));
    }
  };

  return { projects, loading, createProject, deleteProject, refetch: fetchProjects };
}

export function useTasks(projectId) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    if (!user) {
      setTasks([]);
      setLoading(false);
      return;
    }
    
    let query = supabase.from('tasks').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (projectId) {
      query = query.eq('project_id', projectId);
    }
    
    const { data, error } = await query;
    if (!error && data) {
      setTasks(data);
    }
    setLoading(false);
  }, [user, projectId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const createTask = async (taskData) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('tasks')
      .insert([{ ...taskData, project_id: projectId, user_id: user.id }])
      .select()
      .single();
      
    if (!error && data) {
      setTasks(prev => [data, ...prev]);
      return data;
    }
    return null;
  };

  const updateTask = async (id, updates) => {
    const { data, error } = await supabase
      .from('tasks')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
      
    if (!error && data) {
      setTasks(prev => prev.map(t => t.id === id ? data : t));
      return data;
    }
    return null;
  };

  const deleteTask = async (id) => {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (!error) {
      setTasks(prev => prev.filter(t => t.id !== id));
    }
  };

  return { tasks, loading, createTask, updateTask, deleteTask, refetch: fetchTasks };
}
