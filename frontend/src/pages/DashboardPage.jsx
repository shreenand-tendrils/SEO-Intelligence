import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, CheckCircle2, FileSearch, Gauge, Layers, Play, ShieldAlert, Sparkles } from 'lucide-react';
import { useDashboardStore } from '../store/dashboardStore';
import { Card, EmptyState, ErrorState, MetricCard, ScoreBar, ScorePill, ScoreRing, SeverityBadge, Skeleton, StatusBadge, Delta, CrawlStatusBadge } from '../components/ui';
import { DonutChart, ScoreTrendChart, SimpleBarChart, bucketColor, codeColor, severityColor } from '../components/charts';
import { CATEGORY_LABEL, fmtDate, fmtNum, shortUrl } from '../utils/format';

function IssueList({ items, empty, projectId, crawlId, tone }) {
  if (!items || !items.length) return <p className="py-6 text-center text-sm muted">{empty}</p>;
  return (
    <ul className="divide-y divide-ink-100 dark:divide-ink-800">
      {items.map((i) => (
        <li key={i.issue} className="flex items-center justify-between gap-3 py-2 text-sm">
          <Link to={`/projects/${projectId}/pages?crawl=${crawlId}&issue=${encodeURIComponent(i.issue)}`} className="min-w-0 truncate hover:underline">{i.issue}</Link>
          <span className="flex shrink-0 items-center gap-2">{i.severity && <SeverityBadge severity={i.severity} />}<span className={`tabular-nums ${tone || 'muted'}`}>{i.pages_before !== undefined ? <>{i.pages_before}→{i.pages_after}</> : i.pages}</span></span>
        </li>
      ))}
    </ul>
  );
}

function PageList({ pages, projectId }) {
  return (
    <ul className="divide-y divide-ink-100 dark:divide-ink-800">
      {pages.map((p) => (
        <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
          <ScorePill score={p.seoScore} />
          <Link to={`/projects/${projectId}/pages/${p.id}`} className="min-w-0 flex-1 truncate hover:underline" title={p.url}>{shortUrl(p.url)}</Link>
          <StatusBadge code={p.statusCode} />
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const { projectId } = useParams();
  const { data, loading, error, fetch } = useDashboardStore();
  useEffect(() => { fetch(projectId); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data || !data.runningCrawl) return undefined;
    const t = setInterval(() => fetch(projectId, { silent: true }), 5000);
    return () => clearInterval(t);
  }, [data && data.runningCrawl && data.runningCrawl.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorState message={error} onRetry={() => fetch(projectId)} />;
  if (loading || !data || data.project.id !== projectId) return <div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;
  const running = data.runningCrawl;
  if (data.empty) {
    return (
      <Card>
        <EmptyState icon={FileSearch} title="No completed crawl yet" action={<Link to={`/projects/${projectId}/crawls?new=1`} className="btn-primary"><Play size={16} />Start a crawl</Link>}>
          {running ? <>A crawl is running ({running.pagesCrawled} pages so far). The dashboard fills in when it completes.</> : 'Run a crawl to see the SEO score, issues and page analysis for this website.'}
        </EmptyState>
      </Card>
    );
  }
  const { score, kpis, crawl } = data;
  const cats = ['technical', 'onpage', 'content', 'linking', 'images', 'structured', 'intl_social']
    .map((k) => data.categoryScores.find((c) => c.category === k) || { category: k, score: null, pages: 0 });
  const q = `?crawl=${crawl.id}`;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">SEO overview</h1>
          <p className="text-sm muted">Latest crawl <span className="font-medium text-ink-700 dark:text-ink-200">{crawl.name}</span> · {fmtDate(crawl.finishedAt)} · <a className="hover:underline" href={crawl.seedUrl} target="_blank" rel="noreferrer">{crawl.seedUrl}</a></p>
        </div>
        <div className="flex gap-2">
          {running && <span className="flex items-center gap-2 text-sm"><CrawlStatusBadge status={running.status} />{running.pagesCrawled} pages</span>}
          <Link to={`/projects/${projectId}/ai${q}`} className="btn-outline"><Sparkles size={16} />Ask AI</Link>
          <Link to={`/projects/${projectId}/crawls?new=1`} className="btn-primary"><Play size={16} />New crawl</Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card title="Website SEO score" subtitle={`Algorithm ${score.version} · pages ${score.pageVersion}`}>
          <div className="flex items-center gap-6">
            <ScoreRing score={score.overall} size={136} label={score.grade} />
            <div className="space-y-1.5 text-sm">
              <div className="muted">Previous crawl</div>
              <div className="flex items-baseline gap-2"><span className="text-xl font-semibold tabular-nums">{score.previous ?? '—'}</span><Delta value={score.change} /></div>
              <div className="pt-2 text-xs muted">{kpis.excellent} excellent pages · {kpis.needAttention} need attention</div>
            </div>
          </div>
          <div className="mt-5 space-y-2.5">
            {score.components.map((c) => (
              <div key={c.key} title={c.explanation}>
                <div className="mb-1 flex justify-between text-xs"><span>{c.label} <span className="muted">×{c.weight}</span></span><span className="font-semibold tabular-nums">{c.score ?? 'n/a'}</span></div>
                <ScoreBar score={c.score} />
              </div>
            ))}
          </div>
          {score.caps && score.caps.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{score.caps.join('; ')}</p>}
        </Card>
        <div className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Layers} label="Pages crawled" value={fmtNum(kpis.pagesCrawled)} hint={`${fmtNum(kpis.pagesAnalyzed)} scored`} />
          <MetricCard icon={CheckCircle2} tone="ok" label="Indexable pages" value={fmtNum(kpis.indexable)} hint={`${fmtNum(kpis.nonIndexable)} non-indexable`} />
          <MetricCard icon={AlertOctagon} tone="danger" label="Critical issues" value={fmtNum(kpis.critical)} hint={`${fmtNum(kpis.errors)} error pages`} />
          <MetricCard icon={AlertTriangle} tone="warn" label="High issues" value={fmtNum(kpis.high)} hint={`${fmtNum(kpis.medium)} medium · ${fmtNum(kpis.low)} low`} />
          <Card title="Score trend" subtitle={`${data.history.length} crawl${data.history.length === 1 ? '' : 's'}`} className="sm:col-span-2 xl:col-span-4">
            {data.history.length > 1 ? <ScoreTrendChart data={data.history} height={190} /> : <p className="py-14 text-center text-sm muted">Run another crawl to see the trend.</p>}
          </Card>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {cats.map((c) => (
          <div key={c.category} className="card p-4">
            <div className="flex items-center justify-between text-xs muted"><span>{CATEGORY_LABEL[c.category]}</span><Gauge size={14} /></div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{c.score ?? '—'}</div>
            <ScoreBar score={c.score} className="mt-2" />
            <div className="mt-1.5 text-[11px] muted">avg over {c.pages} pages</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Page score distribution"><SimpleBarChart data={data.scoreDistribution} x="bucket" y="pages" colors={bucketColor} /></Card>
        <Card title="Issues by severity"><DonutChart data={data.severity.filter((s) => s.count)} nameKey="severity" valueKey="count" colors={severityColor} /></Card>
        <Card title="Response codes"><DonutChart data={data.responseCodes} nameKey="code" valueKey="pages" colors={codeColor} /></Card>
        <Card title="Crawl depth"><SimpleBarChart data={data.depth} x="depth" y="pages" color="#6366f1" /></Card>
        <Card title="Indexability"><DonutChart data={data.indexability.filter((d) => d.pages)} nameKey="label" valueKey="pages" colors={(d) => (d.label === 'Indexable' ? '#10b981' : '#f97316')} /></Card>
        <Card title="Most common issues" subtitle="Pages affected" pad>
          <IssueList items={data.topIssues.slice(0, 8)} empty="No issues found." projectId={projectId} crawlId={crawl.id} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Critical issues" action={<ShieldAlert size={16} className="text-red-500" />}><IssueList items={data.criticalIssues} empty="No critical issues." projectId={projectId} crawlId={crawl.id} tone="text-red-600" /></Card>
        <Card title="Lowest-scoring pages" action={<Link className="text-xs text-brand-600 hover:underline" to={`/projects/${projectId}/pages${q}&sort=score&order=asc`}>View all</Link>}><PageList pages={data.lowestPages} projectId={projectId} /></Card>
        <Card title="Highest-scoring pages"><PageList pages={data.highestPages} projectId={projectId} /></Card>
      </div>

      <Card title="Changes since previous crawl" subtitle={data.changes ? `vs ${data.changes.previousCrawl.name} · ${data.changes.pagesAdded} pages added, ${data.changes.pagesRemoved} removed` : undefined}
        action={data.changes && <Link className="text-xs text-brand-600 hover:underline" to={`/projects/${projectId}/compare${q}`}>Full comparison</Link>}>
        {data.changes ? (
          <div className="grid gap-6 md:grid-cols-3">
            <div><h4 className="mb-1 text-xs font-semibold uppercase muted">New issues</h4><IssueList items={data.changes.newIssues} empty="None." projectId={projectId} crawlId={crawl.id} tone="text-red-600" /></div>
            <div><h4 className="mb-1 text-xs font-semibold uppercase muted">Resolved</h4><IssueList items={data.changes.resolvedIssues} empty="None." projectId={projectId} crawlId={crawl.id} tone="text-emerald-600" /></div>
            <div><h4 className="mb-1 text-xs font-semibold uppercase muted">Persistent</h4><IssueList items={data.changes.persistentIssues} empty="None." projectId={projectId} crawlId={crawl.id} /></div>
          </div>
        ) : <p className="py-4 text-center text-sm muted">This is the first completed crawl for this website.</p>}
      </Card>

      <p className="text-xs muted">{score.explanation}</p>
    </div>
  );
}
