import { create } from 'zustand';
import { api } from '../services/api';

export const useReportStore = create((set) => ({
  crawlId: null, reports: null, issues: null, loading: false, error: null,
  comparison: null, compareLoading: false, compareError: null,
  async fetch(crawlId) {
    set({ loading: true, error: null, crawlId });
    try {
      const [r, i] = await Promise.all([api.crawls.reports(crawlId), api.crawls.issues(crawlId)]);
      set({ reports: r.data, issues: i.data, loading: false });
    } catch (e) { set({ error: e.message, loading: false }); }
  },
  async compare(crawlId, otherId) {
    set({ compareLoading: true, compareError: null });
    try { const r = await api.crawls.compare(crawlId, otherId); set({ comparison: r.data, compareLoading: false }); } catch (e) { set({ compareError: e.message, compareLoading: false, comparison: null }); }
  },
}));
