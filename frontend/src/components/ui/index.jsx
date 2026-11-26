import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2 } from 'lucide-react';
import { scoreColor, SEVERITY_HEX } from '../../utils/format';

export function Card({ title, subtitle, action, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-3.5 dark:border-ink-800">
          <div>
            <h3 className="card-title">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  );
}

export function ScoreRing({ score, size = 120, stroke = 10, label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, score));
  const col = scoreColor(score);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`Score ${score ?? 'not available'} of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-ink-100 dark:stroke-ink-800" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" stroke={col.hex} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute text-center">
        <div className={`font-bold tabular-nums ${col.text}`} style={{ fontSize: size * 0.3 }}>{score ?? '—'}</div>
        {label && <div className="text-[11px] muted">{label}</div>}
      </div>
    </div>
  );
}

export function ScorePill({ score }) {
  const col = scoreColor(score);
  return <span className={`chip tabular-nums ${score === null || score === undefined ? 'bg-ink-100 text-ink-500 dark:bg-ink-800' : 'text-white'}`} style={score === null || score === undefined ? {} : { background: col.hex }}>{score ?? 'n/a'}</span>;
}

export function ScoreBar({ score, className = '' }) {
  const col = scoreColor(score);
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800 ${className}`}>
      <div className="h-full rounded-full transition-all" style={{ width: `${score ?? 0}%`, background: col.hex }} />
    </div>
  );
}

export function MetricCard({ icon: Icon, label, value, hint, tone = 'default', delta }) {
  const tones = { default: 'text-brand-600 bg-brand-50 dark:bg-brand-900/30 dark:text-brand-300', danger: 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300',
    warn: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300', ok: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300' };
  return (
    <div className="card card-pad flex items-start gap-3">
      {Icon && <div className={`rounded-lg p-2 ${tones[tone]}`}><Icon size={18} /></div>}
      <div className="min-w-0">
        <div className="text-xs font-medium muted">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          {delta !== undefined && delta !== null && <Delta value={delta} />}
        </div>
        {hint && <div className="mt-0.5 truncate text-xs muted">{hint}</div>}
      </div>
    </div>
  );
}

export function Delta({ value, invert = false }) {
  if (value === null || value === undefined) return null;
  const good = invert ? value < 0 : value > 0;
  const cls = value === 0 ? 'text-ink-500' : good ? 'text-emerald-600' : 'text-red-600';
  return <span className={`text-xs font-semibold tabular-nums ${cls}`}>{value > 0 ? '+' : ''}{value}</span>;
}

const SEV_CLS = {
  CRITICAL: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', HIGH: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  MEDIUM: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', LOW: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  INFO: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
};
export function SeverityBadge({ severity }) {
  const s = String(severity || 'INFO').toUpperCase();
  return <span className={`chip ${SEV_CLS[s] || SEV_CLS.INFO}`}><span className="h-1.5 w-1.5 rounded-full" style={{ background: SEVERITY_HEX[s] }} />{s.charAt(0) + s.slice(1).toLowerCase()}</span>;
}

export function StatusBadge({ code }) {
  const c = Number(code) || 0;
  const cls = c === 0 ? 'bg-red-100 text-red-700' : c < 300 ? 'bg-emerald-100 text-emerald-700' : c < 400 ? 'bg-sky-100 text-sky-700' : 'bg-red-100 text-red-700';
  return <span className={`chip tabular-nums ${cls} dark:bg-opacity-20`}>{c || 'ERR'}</span>;
}

const CRAWL_CLS = { COMPLETED: 'bg-emerald-100 text-emerald-700', STOPPED: 'bg-amber-100 text-amber-800', FAILED: 'bg-red-100 text-red-700' };
export function CrawlStatusBadge({ status }) {
  return <span className={`chip ${CRAWL_CLS[status] || 'bg-brand-100 text-brand-700'}`}>{!CRAWL_CLS[status] && <Loader2 size={11} className="animate-spin" />}{String(status).replace('_', ' ').toLowerCase()}</span>;
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm muted"><Loader2 size={18} className="animate-spin" />{label}</div>;
}

export function Skeleton({ className = 'h-24' }) {
  return <div className={`animate-pulse rounded-xl bg-ink-100 dark:bg-ink-800 ${className}`} />;
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-ink-100 p-3 text-ink-500 dark:bg-ink-800"><Icon size={22} /></div>
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="card card-pad flex items-center gap-3 border-red-200 bg-red-50 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
      <AlertTriangle size={18} /> <span className="flex-1">{message}</span>
      {onRetry && <button type="button" className="btn-outline" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta || meta.totalPages <= 1) return meta ? <div className="px-4 py-3 text-xs muted">{meta.total.toLocaleString()} results</div> : null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <span className="text-xs muted">Page {meta.page} of {meta.totalPages} · {meta.total.toLocaleString()} results</span>
      <div className="flex gap-1">
        <button type="button" className="btn-outline px-2 py-1" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
        <button type="button" className="btn-outline px-2 py-1" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-200 dark:border-ink-800" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${value === t.key ? 'border-brand-600 text-brand-700 dark:text-brand-300' : 'border-transparent muted hover:text-ink-800 dark:hover:text-ink-200'}`}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 text-xs dark:bg-ink-800">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KV({ label, children }) {
  return (
    <div className="grid grid-cols-3 gap-3 border-b border-ink-100 py-2 text-sm last:border-0 dark:border-ink-800">
      <dt className="muted">{label}</dt>
      <dd className="col-span-2 break-words">{children === null || children === undefined || children === '' ? <span className="muted">—</span> : children}</dd>
    </div>
  );
}
