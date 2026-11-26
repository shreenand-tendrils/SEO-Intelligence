import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCrawlSelection } from '../hooks/useCrawlSelection';
import { useReportStore } from '../store/reportStore';
import CrawlPicker from '../components/CrawlPicker';
import { Card, EmptyState, ErrorState, SeverityBadge, Spinner, Tabs } from '../components/ui';
import { SimpleBarChart } from '../components/charts';

const short = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return String(u); } };
const Urls = ({ urls, n = 30 }) => <ul className="space-y-0.5 text-xs">{(urls || []).slice(0, n).map((u, i) => <li key={i} className="break-all">{typeof u === 'string' ? u : u.url || JSON.stringify(u)}{u && u.status_code ? ` (${u.status_code})` : ''}</li>)}{(urls || []).length > n && <li className="muted">…{urls.length - n} more</li>}</ul>;

function DupGroups({ groups }) {
  if (!groups || !groups.length) return <p className="text-sm muted">None found.</p>;
  return <div className="divide-y divide-ink-100 dark:divide-ink-800">{groups.slice(0, 100).map((g, i) => <div key={i} className="py-2.5"><div className="text-sm font-medium">{g.value || <span className="muted">(empty)</span>} <span className="text-xs muted">· {g.urls.length} pages</span></div><Urls urls={g.urls} n={10} /></div>)}</div>;
}

export default function ReportsPage() {
  const { projectId } = useParams();
  const sel = useCrawlSelection(projectId);
  const { reports, issues, loading, error, fetch } = useReportStore();
  const [tab, setTab] = useState('issues');
  useEffect(() => { if (sel.crawlId) fetch(sel.crawlId); }, [sel.crawlId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (sel.loading) return <Spinner />;
  if (!sel.crawls.length) return <Card><EmptyState title="No completed crawls">Reports appear after a crawl completes.</EmptyState></Card>;
  const r = reports || {};
  const sm = r.sitemap || {};
  const nd = r.near_dup || {};
  const bc = r.bot_check || {};
  const traps = r.url_traps || {};
  const tabs = [
    { key: 'issues', label: 'All issues', count: issues ? issues.length : undefined }, { key: 'codes', label: 'Response codes' },
    { key: 'dups', label: 'Duplicates' }, { key: 'redirects', label: 'Redirect chains', count: (r.redirect_chains || []).length },
    { key: 'sitemap', label: 'Sitemap & orphans' }, { key: 'neardup', label: 'Near-duplicates', count: (nd.pairs || []).length },
    { key: 'bots', label: 'Bot readability' }, { key: 'depth', label: 'Depth & traps' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Reports & issues</h1><p className="text-sm muted">The crawler's site-level reports, stored with each crawl.</p></div>
        <CrawlPicker crawls={sel.crawls} value={sel.crawlId} onChange={sel.select} />
      </div>
      {error && <ErrorState message={error} onRetry={() => fetch(sel.crawlId)} />}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {loading || !reports ? <Spinner /> : (
        <>
          {tab === 'issues' && (
            <Card pad={false}><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="table-head"><tr><th className="px-4 py-2.5">Issue</th><th className="px-4 py-2.5">Severity</th><th className="px-4 py-2.5">Category</th><th className="px-4 py-2.5">Pages</th></tr></thead>
              <tbody>{(issues || []).map((i) => <tr key={i.issue} className="table-row"><td className="px-4 py-2"><Link className="hover:underline" to={`/projects/${projectId}/pages?crawl=${sel.crawlId}&issue=${encodeURIComponent(i.issue)}`}>{i.issue}</Link></td><td className="px-4 py-2"><SeverityBadge severity={i.severity} /></td><td className="px-4 py-2 muted">{i.category}</td><td className="px-4 py-2 tabular-nums">{i.pages}</td></tr>)}</tbody></table>
              {!(issues || []).length && <EmptyState title="No issues">The crawler flagged nothing.</EmptyState>}</div></Card>
          )}
          {tab === 'codes' && (
            <div className="grid gap-4 lg:grid-cols-2">
              {Object.entries(r.response_codes || {}).map(([k, urls]) => <Card key={k} title={`${k} (${(urls || []).length})`}><Urls urls={urls} /></Card>)}
              {!Object.keys(r.response_codes || {}).length && <Card><EmptyState title="No response-code report" /></Card>}
            </div>
          )}
          {tab === 'dups' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Duplicate titles"><DupGroups groups={r.duplicate_titles} /></Card>
              <Card title="Duplicate meta descriptions"><DupGroups groups={r.duplicate_metas} /></Card>
              <Card title="Duplicate H1s"><DupGroups groups={r.duplicate_h1s} /></Card>
              <Card title="Duplicate body content"><DupGroups groups={r.duplicate_bodies} /></Card>
            </div>
          )}
          {tab === 'redirects' && (
            <Card title="Redirect chains (2+ hops)">{(r.redirect_chains || []).length ? <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">{r.redirect_chains.map((c, i) => <li key={i} className="py-2"><div className="font-medium break-all">{c.url} <span className="text-xs muted">· {c.hops} hops</span></div><div className="text-xs muted break-all">{(c.chain || []).map((h) => (typeof h === 'string' ? h : `${h.status || ''} ${h.url}`)).join(' → ')}</div></li>)}</ul> : <p className="text-sm muted">No redirect chains.</p>}</Card>
          )}
          {tab === 'sitemap' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Sitemap totals"><dl className="text-sm">{Object.entries(sm.totals || {}).map(([k, v]) => <div key={k} className="flex justify-between py-1"><dt className="muted">{k.replace(/_/g, ' ')}</dt><dd className="tabular-nums">{v}</dd></div>)}<div className="flex justify-between py-1"><dt className="muted">sitemap URL count (crawl)</dt><dd>{r.sitemap_count ?? '—'}</dd></div></dl>
                {(sm.sitemap_errors || []).length > 0 && <div className="mt-2 text-xs text-red-600">{sm.sitemap_errors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('; ')}</div>}
                {!r.sitemap && <p className="text-sm muted">Sitemap analysis was not run.</p>}</Card>
              <Card title={`Orphans: in sitemap, not crawled (${(r.orphans || []).length})`}><Urls urls={r.orphans} /></Card>
              {Object.entries(sm.reports || {}).map(([k, v]) => <Card key={k} title={`${k.replace(/_/g, ' ')} (${(v || []).length})`}><Urls urls={v} /></Card>)}
            </div>
          )}
          {tab === 'neardup' && (
            <Card title="Near-duplicate pairs" subtitle={nd.stats ? `Threshold ${nd.stats.threshold ?? ''} · ${nd.stats.pages_compared ?? nd.stats.compared ?? ''} pages compared` : undefined} pad={false}>
              {(nd.pairs || []).length ? <table className="w-full text-sm"><thead className="table-head"><tr><th className="px-4 py-2">Page A</th><th className="px-4 py-2">Page B</th><th className="px-4 py-2">Similarity</th></tr></thead><tbody>{nd.pairs.slice(0, 300).map((p, i) => <tr key={i} className="table-row"><td className="break-all px-4 py-2">{short(p.url_a)}</td><td className="break-all px-4 py-2">{short(p.url_b)}</td><td className="px-4 py-2 tabular-nums">{Math.round(p.similarity * 100)}%</td></tr>)}</tbody></table> : <p className="p-5 text-sm muted">{r.near_dup ? 'No near-duplicates above the threshold.' : 'Near-duplicate analysis was not run.'}</p>}
            </Card>
          )}
          {tab === 'bots' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Verdict per crawler">{Object.keys(bc.verdicts || {}).length ? <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">{Object.entries(bc.verdicts).map(([a, v]) => <li key={a} className="flex justify-between py-1.5"><span>{a}</span><span className={v.state === 'same' ? 'text-emerald-600' : 'text-orange-600'}>{v.state} <span className="text-xs muted">({v.checked} pages)</span></span></li>)}</ul> : <p className="text-sm muted">Bot readability check was not run.</p>}
                {bc.robots_note && <p className="mt-2 text-xs muted">{typeof bc.robots_note === 'string' ? bc.robots_note : JSON.stringify(bc.robots_note)}</p>}</Card>
              <Card title="Page findings">{Object.keys(bc.page_issues || {}).length ? <ul className="space-y-2 text-sm">{Object.entries(bc.page_issues).map(([u, list]) => <li key={u}><div className="break-all font-medium">{short(u)}</div><ul className="text-xs muted">{(list || []).map((x, i) => <li key={i}>{x}</li>)}</ul></li>)}</ul> : <p className="text-sm muted">No crawler-specific differences on the sampled pages.</p>}</Card>
            </div>
          )}
          {tab === 'depth' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Depth distribution"><SimpleBarChart data={Object.entries(r.depth_distribution || {}).map(([depth, pages]) => ({ depth, pages }))} x="depth" y="pages" color="#6366f1" /></Card>
              <Card title="URL traps (soft-404 probe)"><dl className="text-sm"><div className="flex justify-between py-1"><dt className="muted">Probed</dt><dd>{traps.checked ? 'yes' : 'no'}</dd></div><div className="flex justify-between py-1"><dt className="muted">Unknown URLs return 200 (soft 404)</dt><dd className={traps.soft_404 ? 'text-red-600' : ''}>{traps.soft_404 ? 'yes' : 'no'}</dd></div><div className="flex justify-between py-1"><dt className="muted">Nested URL trap</dt><dd className={traps.nested_trap ? 'text-red-600' : ''}>{traps.nested_trap ? 'yes' : 'no'}</dd></div></dl></Card>
              {r.crawl_summary && <Card title="Crawl summary" className="lg:col-span-2"><pre className="max-h-80 overflow-auto text-xs">{JSON.stringify(r.crawl_summary, null, 2)}</pre></Card>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
