import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCrawlSelection } from '../hooks/useCrawlSelection';
import { useReportStore } from '../store/reportStore';
import CrawlPicker from '../components/CrawlPicker';
import { Card, Delta, EmptyState, ErrorState, MetricCard, SeverityBadge, Spinner } from '../components/ui';
import { CATEGORY_LABEL, shortUrl } from '../utils/format';

function IssueTable({ items, mode }) {
  if (!items.length) return <p className="text-sm muted">None.</p>;
  return (
    <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
      {items.map((i) => <li key={i.issue} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{i.issue}</span><span className="flex shrink-0 items-center gap-2"><SeverityBadge severity={i.severity} />
        <span className="tabular-nums">{mode === 'persistent' ? <>{i.pages_before}→{i.pages_after} <Delta value={i.delta} invert /></> : i.pages}</span></span></li>)}
    </ul>
  );
}

export default function ComparePage() {
  const { projectId } = useParams();
  const sel = useCrawlSelection(projectId);
  const { comparison: c, compareLoading, compareError, compare } = useReportStore();
  const [other, setOther] = useState('');
  useEffect(() => {
    if (!sel.crawlId) return;
    const idx = sel.crawls.findIndex((x) => x.id === sel.crawlId);
    const def = other || (sel.crawls[idx + 1] && sel.crawls[idx + 1].id) || '';
    if (def && def !== sel.crawlId) { if (!other) setOther(def); compare(sel.crawlId, def); }
  }, [sel.crawlId, other, sel.crawls.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (sel.loading) return <Spinner />;
  if (sel.crawls.length < 2) return <Card><EmptyState title="Need two crawls">Run at least two crawls of this website to compare them.</EmptyState></Card>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Compare crawls</h1><p className="text-sm muted">What changed between two crawls: score, issues and pages.</p></div>
        <div className="flex flex-wrap gap-3"><CrawlPicker label="Baseline" crawls={sel.crawls.filter((x) => x.id !== sel.crawlId)} value={other} onChange={setOther} /><CrawlPicker label="Compared" crawls={sel.crawls} value={sel.crawlId} onChange={sel.select} /></div>
      </div>
      {compareError && <ErrorState message={compareError} />}
      {compareLoading || !c ? <Spinner /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Site score" value={`${c.base.score ?? '—'} → ${c.target.score ?? '—'}`} delta={c.score_delta} hint={`${c.base.name} → ${c.target.name}`} />
            <MetricCard label="Pages" value={`${c.base.pages} → ${c.target.pages}`} hint={`${c.pages_added_count} added · ${c.pages_removed_count} removed`} />
            <MetricCard label="New issue types" tone="danger" value={c.new_issues.length} />
            <MetricCard label="Resolved issue types" tone="ok" value={c.resolved_issues.length} />
          </div>
          <Card title="Category averages">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">{c.categories.map((x) => <div key={x.category} className="text-sm"><div className="text-xs muted">{CATEGORY_LABEL[x.category] || x.category}</div><div className="font-semibold tabular-nums">{x.before ?? '—'} → {x.after ?? '—'} {x.before !== null && x.after !== null && <Delta value={x.after - x.before} />}</div></div>)}</div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="New issues"><IssueTable items={c.new_issues} /></Card>
            <Card title="Resolved issues"><IssueTable items={c.resolved_issues} /></Card>
            <Card title="Persistent issues"><IssueTable items={c.persistent_issues} mode="persistent" /></Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Most improved pages"><ul className="text-sm">{c.improved_pages.map((p) => <li key={p.url} className="flex justify-between py-1"><span className="truncate">{shortUrl(p.url)}</span><span className="tabular-nums">{p.before}→{p.after} <Delta value={p.delta} /></span></li>)}{!c.improved_pages.length && <li className="muted">None.</li>}</ul></Card>
            <Card title="Most declined pages"><ul className="text-sm">{c.declined_pages.map((p) => <li key={p.url} className="flex justify-between py-1"><span className="truncate">{shortUrl(p.url)}</span><span className="tabular-nums">{p.before}→{p.after} <Delta value={p.delta} /></span></li>)}{!c.declined_pages.length && <li className="muted">None.</li>}</ul></Card>
            <Card title={`Pages added (${c.pages_added_count})`}><ul className="max-h-64 overflow-auto text-xs">{c.pages_added.map((u) => <li key={u} className="break-all">{u}</li>)}</ul></Card>
            <Card title={`Pages removed (${c.pages_removed_count})`}><ul className="max-h-64 overflow-auto text-xs">{c.pages_removed.map((u) => <li key={u} className="break-all">{u}</li>)}</ul></Card>
          </div>
          <p className="text-xs muted">Ask the <Link className="underline" to={`/projects/${projectId}/ai?crawl=${sel.crawlId}`}>AI Consultant</Link> to explain these changes.</p>
        </>
      )}
    </div>
  );
}
