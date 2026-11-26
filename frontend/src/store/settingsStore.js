import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// UI preferences only (persisted). Never put credentials here.
function apply(theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export const useSettingsStore = create(persist((set) => ({
  theme: 'system',
  pageSize: 50,
  sidebarCollapsed: false,
  setTheme: (theme) => { apply(theme); set({ theme }); },
  setPageSize: (pageSize) => set({ pageSize }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}), { name: 'seo-settings', partialize: (s) => ({ theme: s.theme, pageSize: s.pageSize, sidebarCollapsed: s.sidebarCollapsed }) }));
