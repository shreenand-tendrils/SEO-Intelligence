import { create } from 'zustand';
import { api } from '../services/api';

export const useProjectStore = create((set, get) => ({
  projects: [], meta: null, loading: false, error: null,
  current: null, currentLoading: false, currentError: null,
  async fetchProjects(params) {
    set({ loading: true, error: null });
    try { const r = await api.projects.list(params); set({ projects: r.data, meta: r.meta, loading: false }); } catch (e) { set({ error: e.message, loading: false }); }
  },
  async fetchProject(id, { silent } = {}) {
    if (!silent) set({ currentLoading: true, currentError: null });
    try { const r = await api.projects.get(id); set({ current: r.data, currentLoading: false }); return r.data; } catch (e) { set({ currentError: e.message, currentLoading: false }); return null; }
  },
  async createProject(body) {
    const r = await api.projects.create(body);
    set({ projects: [r.data, ...get().projects] });
    return r.data;
  },
  async updateProject(id, body) {
    const r = await api.projects.update(id, body);
    set({ current: { ...get().current, ...r.data } });
    return r.data;
  },
  async deleteProject(id) {
    await api.projects.remove(id);
    set({ projects: get().projects.filter((p) => p.id !== id) });
  },
}));
