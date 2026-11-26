import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, Search } from 'lucide-react';
import { usePageStore } from '../store/pageStore';
import { useSettingsStore } from '../store/settingsStore';
import { useCrawlSelection } from '../hooks/useCrawlSelection';
import CrawlPicker from '../components/CrawlPicker';
import { Card, EmptyState, ErrorState, Pagination, ScorePill, Spinner, StatusBadge } from '../components/ui';
import { api } from '../services/api';
import { shortUrl } from '../utils/format';

const COLS = [
  { key: 'score', label: 'Score' }, { key: 'url', label: 'URL' }, { key: 'status', label: 'Status' }, { key: null, label: 'Indexable' },
  { key: 'issues', label: 'Issues' }, { key: 'title', label: 'Title' }, { key: 'words', label: 'Words' }, { key: 'depth', label: 'Depth' },
  { key: 'inlinks', label: 'Inlinks' }, { key: 'response', label: 'Time' },
];

export default function PagesPage() {
  const { projectId } = useParams();
  const [sp] = useSearchParams();
  const sel = useCrawlSelection(projectId);
  const { rows, meta, loading, error, query, setQuery, fetchPages } = usePageStore();
  const pageSize = useSettingsStore((s) => s.pageSize);
  const [issues, setIssues] = useState([]);
  const [search, setSearch] = useState(query.search);
  useEffect(() => {
    const patch = {};
    for (const k of ['issue', 'severity', 'sort', 'order', 'status']) if (sp.get(k)) patch[k] = sp.get(k);
    if (Object.keys(patch).length) setQuery(patch);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel.crawlId) fetchPages(sel.crawlId, pageSize); }, [sel.crawlId, query, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel.crawlId) api.crawls.issues(sel.crawlId).then((r) => setIssues(r.data)).catch(() => setIssues([])); }, [sel.crawlId]);
  useEffect(() => { const t = setTimeout(() => { if (search !== query.search) setQuery({ search }); }, 300); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sel.loading) return <Spinner />;
  if (sel.error) return <ErrorState message={sel.error} />;
  if (!sel.crawls.length) return <Card><EmptyState title="No completed crawls">Run a crawl to analyse this site's pages.</EmptyState></Card>;
  const sortBy = (k) => k && setQuery({ sort: k, order: query.sort === k && query.order === 'asc' ? 'desc' : 'asc' });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Pages</h1><p className="text-sm muted">Every crawled URL with its page SEO score.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <CrawlPicker crawls={sel.crawls} value={sel.crawlId} onChange={sel.select} />
          <a className="btn-outline" href={api.crawls.exportUrl(sel.crawlId)}><Download size={15} />XLSX</a>
        </div>
      </div>
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-ink-100 p-3 dark:border-ink-800">
          <div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-2.5 text-ink-400" /><input className="input pl-9" placeholder="Search URL or title" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search pages" /></div>
          <select className="input w-auto" value={query.status} onChange={(e) => setQuery({ status: e.target.value })} aria-label="Status filter">
            <option value="">All statuses</option><option value="2xx">2xx</option><option value="3xx">3xx</option><option value="4xx">4xx</option><option value="5xx">5xx</option><option value="error">Fetch errors</option>
          </select>
          <select className="input w-auto" value={query.indexable} onChange={(e) => setQuery({ indexable: e.target.value })} aria-label="Indexability filter">
            <option value="">Any indexability</option><option value="true">Indexable</option><option value="false">Non-indexable</option>
          </select>
          <select className="input w-auto" value={query.severity} onChange={(e) => setQuery({ severity: e.target.value })} aria-label="Severity filter">
            <option value="">Any severity</option>{['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </select>
          <select className="input w-auto max-w-[260px]" value={query.issue} onChange={(e) => setQuery({ issue: e.target.value })} aria-label="Issue filter">
            <option value="">Any issue</option>{issues.map((i) => <option key={i.issue} value={i.issue}>{i.issue} ({i.pages})</option>)}
          </select>
        </div>
        {error && <div className="p-3"><ErrorState message={error} /></div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="table-head"><tr>{COLS.map((c) => (
              <th key={c.label} className="px-3 py-2.5">
                {c.key ? <button type="button" className="inline-flex items-center gap-1 uppercase" onClick={() => sortBy(c.key)}>{c.label}{query.sort === c.key && (query.order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button> : c.label}
              </th>))}</tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="px-3 py-2"><ScorePill score={p.seoScore} /></td>
                  <td className="max-w-[340px] px-3 py-2"><Link to={`/projects/${projectId}/pages/${p.id}?crawl=${sel.crawlId}`} className="block truncate font-medium text-brand-700 hover:underline dark:text-brand-300" title={p.url}>{shortUrl(p.url)}</Link></td>
                  <td className="px-3 py-2"><StatusBadge code={p.statusCode} /></td>
                  <td className="px-3 py-2">{p.indexable ? <span className="text-emerald-600">Yes</span> : <span className="text-orange-600">No</span>}</td>
                  <td className="px-3 py-2 tabular-nums">{p.issueCount}{p.criticalCount ? <span className="ml-1 text-xs text-red-600">({p.criticalCount} crit)</span> : null}</td>
                  <td className="max-w-[260px] truncate px-3 py-2" title={p.title || ''}>{p.title || <span className="muted">missing</span>}</td>
                  <td className="px-3 py-2 tabular-nums">{p.wordCount}</td>
                  <td className="px-3 py-2 tabular-nums">{p.depth}</td>
                  <td className="px-3 py-2 tabular-nums">{p.inlinkCount}</td>
                  <td className="px-3 py-2 tabular-nums">{p.responseTime ? `${p.responseTime}s` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <Spinner />}
          {!loading && !rows.length && <EmptyState title="No pages match">Clear or change the filters.</EmptyState>}
        </div>
        <Pagination meta={meta} onPage={(page) => setQuery({ page })} />
      </Card>
    </div>
  );
}
