export const fmtNum = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString());
export const fmtDate = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtShortDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export function shortUrl(u) {
  try { const x = new URL(u); return (x.pathname + x.search) || '/'; } catch { return u; }
}
export function scoreColor(s) {
  if (s === null || s === undefined) return { text: 'text-ink-400', bg: 'bg-ink-200', hex: '#9aa3b2' };
  if (s >= 90) return { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500', hex: '#10b981' };
  if (s >= 75) return { text: 'text-lime-600 dark:text-lime-400', bg: 'bg-lime-500', hex: '#84cc16' };
  if (s >= 50) return { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500', hex: '#f59e0b' };
  return { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500', hex: '#ef4444' };
}
export const SEVERITY_HEX = { CRITICAL: '#dc2626', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#3b82f6', INFO: '#94a3b8' };
export const CATEGORY_LABEL = { technical: 'Technical', onpage: 'On-page', content: 'Content', images: 'Images', linking: 'Internal links', structured: 'Structured data', intl_social: 'Intl & social' };
