import { create } from 'zustand';
import { api } from '../services/api';

export const useDashboardStore = create((set) => ({
  data: null, loading: false, error: null, projectId: null,
  async fetch(projectId, { silent } = {}) {
    if (!silent) set({ loading: true, error: null, projectId });
    try { const r = await api.projects.dashboard(projectId); set({ data: r.data, loading: false, projectId }); } catch (e) { set({ error: e.message, loading: false }); }
  },
  reset: () => set({ data: null, error: null, projectId: null }),
}));
