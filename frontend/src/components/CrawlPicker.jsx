import { fmtDate } from '../utils/format';

export default function CrawlPicker({ crawls, value, onChange, label = 'Crawl' }) {
  if (!crawls.length) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="muted">{label}</span>
      <select className="input w-auto py-1.5" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {crawls.map((c) => <option key={c.id} value={c.id}>{c.name} · {fmtDate(c.finishedAt)}{c.seoScore ? ` · ${c.seoScore.overall}` : ''}</option>)}
      </select>
    </label>
  );
}
