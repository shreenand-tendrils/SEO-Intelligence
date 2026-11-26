import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Play, Square, Trash2 } from 'lucide-react';
import { useCrawlStore } from '../store/crawlStore';
import { useProjectStore } from '../store/projectStore';
import { useDashboardStore } from '../store/dashboardStore';
import { Card, CrawlStatusBadge, EmptyState, ErrorState, Pagination, ScorePill, Spinner } from '../components/ui';
import { fmtDate } from '../utils/format';

const DEFAULTS = { url: '', max_pages: 1500, max_depth: 10, max_workers: 5, crawl_delay: 0.4, render_js: false, compare_no_js: false, ignore_robots: false,
  ignore_noindex: false, solve_challenges: true, user_agent: '', include_patterns: '', exclude_patterns: '', sitemap: true, near_dup: true, near_dup_threshold: 90, bot_check: true, bot_sample: 10 };
const UAS = [['', 'Default (crawler)'], ['chrome-mobile', 'Chrome mobile'], ['googlebot', 'Googlebot'], ['googlebot-mobile', 'Googlebot smartphone'], ['bingbot', 'Bingbot'], ['firefox', 'Firefox'], ['safari', 'Safari']];

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs muted">{hint}</span>}</span>
    </label>
  );
}

function NewCrawl({ projectId, seed, onStarted }) {
  const { startCrawl, starting, startError } = useCrawlStore();
  const [f, setF] = useState({ ...DEFAULTS, url: seed || '' });
  useEffect(() => { if (seed && !f.url) setF((x) => ({ ...x, url: seed })); }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const num = (k) => (e) => set(k)(e.target.value === '' ? '' : Number(e.target.value));
  const submit = async (e) => {
    e.preventDefault();
    const body = { ...f };
    if (!body.url) delete body.url;
    const c = await startCrawl(projectId, body);
    if (c) onStarted(c);
  };
  return (
    <Card title="New crawl" subtitle="Same options as the original crawler. Crawls run in the Python crawler service and are stored in PostgreSQL.">
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[2fr_repeat(4,1fr)]">
          <div><label className="label" htmlFor="curl">Start URL</label><input id="curl" className="input" value={f.url} onChange={(e) => set('url')(e.target.value)} placeholder="https://www.example.com/" required /></div>
          <div><label className="label" htmlFor="cmax">Max pages</label><input id="cmax" type="number" min={1} max={100000} className="input" value={f.max_pages} onChange={num('max_pages')} /></div>
          <div><label className="label" htmlFor="cdepth">Max depth</label><input id="cdepth" type="number" min={1} max={100} className="input" value={f.max_depth} onChange={num('max_depth')} /></div>
          <div><label className="label" htmlFor="cw">Workers</label><input id="cw" type="number" min={1} max={20} className="input" value={f.max_workers} onChange={num('max_workers')} /></div>
          <div><label className="label" htmlFor="cd">Delay (s)</label><input id="cd" type="number" step="0.1" min={0} max={10} className="input" value={f.crawl_delay} onChange={num('crawl_delay')} /></div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div><label className="label" htmlFor="cua">User agent</label><select id="cua" className="input" value={f.user_agent} onChange={(e) => set('user_agent')(e.target.value)}>{UAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label" htmlFor="cinc">Include patterns</label><input id="cinc" className="input" value={f.include_patterns} onChange={(e) => set('include_patterns')(e.target.value)} placeholder="/blog/, /docs/" /></div>
          <div><label className="label" htmlFor="cexc">Exclude patterns</label><input id="cexc" className="input" value={f.exclude_patterns} onChange={(e) => set('exclude_patterns')(e.target.value)} placeholder="/tag/, ?sort=" /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Toggle label="Render JavaScript" hint="Playwright; uses one worker" checked={f.render_js} onChange={set('render_js')} />
          <Toggle label="Compare with no-JS" hint="Flags JS-only content" checked={f.compare_no_js} onChange={set('compare_no_js')} />
          <Toggle label="Solve bot challenges" hint="Browser fallback for 403 walls" checked={f.solve_challenges} onChange={set('solve_challenges')} />
          <Toggle label="Ignore robots.txt" checked={f.ignore_robots} onChange={set('ignore_robots')} />
          <Toggle label="Ignore noindex" hint="Follow links on noindex pages" checked={f.ignore_noindex} onChange={set('ignore_noindex')} />
          <Toggle label="Sitemap analysis" checked={f.sitemap} onChange={set('sitemap')} />
          <Toggle label="Near-duplicate content" checked={f.near_dup} onChange={set('near_dup')} />
          <Toggle label="Bot readability check" checked={f.bot_check} onChange={set('bot_check')} />
        </div>
        {startError && <ErrorState message={startError} />}
        <button type="submit" className="btn-primary" disabled={starting}><Play size={16} />{starting ? 'Starting…' : 'Start crawl'}</button>
      </form>
    </Card>
  );
}

function Progress({ crawl, onStop }) {
  const p = crawl.progress || {};
  const msgs = (crawl.messages || []).slice(-6);
  const pct = crawl.configuration ? Math.min(100, Math.round((crawl.pagesCrawled / crawl.configuration.maxPages) * 100)) : null;
  return (
    <Card title="Crawl in progress" subtitle={crawl.seedUrl} action={<button type="button" className="btn-outline" onClick={onStop}><Square size={14} />Stop</button>}>
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <CrawlStatusBadge status={crawl.status} />
        <span><b className="tabular-nums">{crawl.pagesCrawled}</b> crawled</span><span><b className="tabular-nums">{crawl.queued}</b> queued</span>
        <span><b className="tabular-nums">{crawl.fetchErrors}</b> errors</span>{p.elapsed_seconds !== undefined && <span className="muted">{p.elapsed_seconds}s elapsed</span>}
      </div>
      {pct !== null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"><div className="h-full animate-pulse bg-brand-500 transition-all" style={{ width: `${Math.max(3, pct)}%` }} /></div>}
      {msgs.length > 0 && <ul className="mt-3 space-y-0.5 font-mono text-xs muted">{msgs.map((m, i) => <li key={i}>[{m.type}] {m.message}</li>)}</ul>}
    </Card>
  );
}

export default function CrawlsPage() {
  const { projectId } = useParams();
  const [sp, setSp] = useSearchParams();
  const { crawls, meta, loading, error, fetchCrawls, active, stopCrawl, deleteCrawl, watch, isActive, unwatch } = useCrawlStore();
  const project = useProjectStore((s) => s.current);
  const refreshDash = useDashboardStore((s) => s.fetch);
  const [page, setPage] = useState(1);
  useEffect(() => { fetchCrawls(projectId, { page }); return () => unwatch(); }, [projectId, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const onDone = () => { fetchCrawls(projectId, { page: 1 }); refreshDash(projectId, { silent: true }); };
  const running = active && active.projectId === projectId && isActive(active) ? active : null;
  const seed = project && project.id === projectId && project.websites[0] ? project.websites[0].seedUrl : '';
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">Crawls</h1><p className="text-sm muted">Start crawls and browse the crawl history of this project.</p></div>
      {running ? <Progress crawl={running} onStop={() => stopCrawl(running.id)} /> : (sp.get('new') || !crawls.length) && !loading ? <NewCrawl projectId={projectId} seed={seed} onStarted={(c) => { setSp({}); watch(c.id, onDone); }} /> : (
        <div><button type="button" className="btn-primary" onClick={() => setSp({ new: '1' })}><Play size={16} />New crawl</button></div>
      )}
      {error && <ErrorState message={error} />}
      <Card title="History" pad={false}>
        {loading && !crawls.length ? <Spinner /> : !crawls.length ? <EmptyState title="No crawls yet">Start the first crawl above.</EmptyState> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
            <thead className="table-head"><tr><th className="px-4 py-2.5">Crawl</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Score</th><th className="px-4 py-2.5">Pages</th><th className="px-4 py-2.5">Critical / high</th><th className="px-4 py-2.5">Finished</th><th className="px-4 py-2.5">Source</th><th /></tr></thead>
            <tbody>{crawls.map((c) => (
              <tr key={c.id} className="table-row">
                <td className="px-4 py-2.5"><Link className="font-medium hover:underline" to={`/projects/${projectId}/pages?crawl=${c.id}`}>{c.name}</Link><div className="max-w-[320px] truncate text-xs muted">{c.error || c.stopReason || c.seedUrl}</div></td>
                <td className="px-4 py-2.5"><CrawlStatusBadge status={c.status} /></td>
                <td className="px-4 py-2.5"><ScorePill score={c.seoScore ? c.seoScore.overall : null} /></td>
                <td className="px-4 py-2.5 tabular-nums">{c.pagesCrawled}</td>
                <td className="px-4 py-2.5 tabular-nums">{c.seoScore ? `${c.seoScore.criticalCount} / ${c.seoScore.highCount}` : '—'}</td>
                <td className="px-4 py-2.5">{fmtDate(c.finishedAt)}</td>
                <td className="px-4 py-2.5 text-xs muted">{c.source === 'IMPORT' ? 'imported' : 'app'}</td>
                <td className="px-4 py-2.5 text-right">{!isActive(c) && <button type="button" className="btn-ghost px-1.5 text-red-600" aria-label="Delete crawl" onClick={async () => { if (window.confirm(`Delete crawl "${c.name}" from the database?`)) { await deleteCrawl(c.id); onDone(); } }}><Trash2 size={14} /></button>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </div>
  );
}
