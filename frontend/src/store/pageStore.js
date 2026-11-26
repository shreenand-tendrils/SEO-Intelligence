import { create } from 'zustand';
import { api } from '../services/api';

export const usePageStore = create((set, get) => ({
  rows: [], meta: null, loading: false, error: null,
  query: { search: '', status: '', indexable: '', issue: '', severity: '', sort: 'score', order: 'asc', page: 1 },
  detail: null, detailLoading: false, detailError: null,
  setQuery(patch) { set({ query: { ...get().query, page: 1, ...patch } }); },
  async fetchPages(crawlId, pageSize) {
    set({ loading: true, error: null });
    const q = Object.fromEntries(Object.entries(get().query).filter(([, v]) => v !== '' && v !== null));
    try { const r = await api.crawls.pages(crawlId, { ...q, pageSize }); set({ rows: r.data, meta: r.meta, loading: false }); } catch (e) { set({ error: e.message, loading: false }); }
  },
  async fetchDetail(pageId) {
    set({ detailLoading: true, detailError: null });
    try { const r = await api.pages.get(pageId); set({ detail: r.data, detailLoading: false }); } catch (e) { set({ detailError: e.message, detailLoading: false }); }
  },
}));
