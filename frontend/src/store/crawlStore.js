import { create } from 'zustand';
import { api } from '../services/api';

const ACTIVE = ['QUEUED', 'RUNNING', 'POST_PROCESSING', 'SAVING'];
let timer = null;

export const useCrawlStore = create((set, get) => ({
  crawls: [], meta: null, loading: false, error: null,
  active: null, starting: false, startError: null,
  isActive: (c) => Boolean(c && ACTIVE.includes(c.status)),
  async fetchCrawls(projectId, params) {
    set({ loading: true, error: null });
    try {
      const r = await api.projects.crawls(projectId, params);
      set({ crawls: r.data, meta: r.meta, loading: false });
      const running = r.data.find((c) => ACTIVE.includes(c.status));
      if (running && !timer) get().watch(running.id);
    } catch (e) { set({ error: e.message, loading: false }); }
  },
  async startCrawl(projectId, settings) {
    set({ starting: true, startError: null });
    try {
      const r = await api.projects.startCrawl(projectId, settings);
      set({ starting: false, active: r.data });
      get().watch(r.data.id);
      return r.data;
    } catch (e) { set({ starting: false, startError: e.message }); return null; }
  },
  async stopCrawl(id) { await api.crawls.stop(id); },
  watch(id, onDone) {
    clearInterval(timer);
    const tick = async () => {
      try {
        const r = await api.crawls.get(id);
        set({ active: r.data });
        if (!ACTIVE.includes(r.data.status)) {
          clearInterval(timer); timer = null;
          set((s) => ({ crawls: s.crawls.map((c) => (c.id === id ? { ...c, ...r.data } : c)) }));
          if (onDone) onDone(r.data);
        }
      } catch { /* transient */ }
    };
    tick();
    timer = setInterval(tick, 2000);
  },
  unwatch() { clearInterval(timer); timer = null; },
  async deleteCrawl(id) {
    await api.crawls.remove(id);
    set((s) => ({ crawls: s.crawls.filter((c) => c.id !== id) }));
  },
}));
