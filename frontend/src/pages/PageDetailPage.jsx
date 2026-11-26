import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, CircleSlash, ExternalLink, HelpCircle, Sparkles, XCircle } from 'lucide-react';
import { usePageStore } from '../store/pageStore';
import { Card, ErrorState, KV, ScoreBar, ScoreRing, SeverityBadge, Spinner, StatusBadge, Tabs } from '../components/ui';
import { fmtDate } from '../utils/format';

const STATUS_ICON = { pass: [CheckCircle2, 'text-emerald-500'], fail: [XCircle, 'text-red-500'], partial: [XCircle, 'text-amber-500'], unknown: [HelpCircle, 'text-ink-400'], na: [CircleSlash, 'text-ink-300'] };
const yes = (v) => (v ? 'Yes' : 'No');
const list = (a, n = 50) => (a && a.length ? <ul className="space-y-0.5">{a.slice(0, n).map((x, i) => <li key={i} className="break-all">{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}{a.length > n && <li className="muted">…{a.length - n} more</li>}</ul> : null);

function Checks({ breakdown }) {
  return (
    <div className="space-y-5">
      {breakdown.categories.map((c) => {
        const checks = breakdown.checks.filter((x) => x.category === c.key);
        return (
          <div key={c.key}>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">{c.label} <span className="font-normal muted">weight {c.weight}</span></h4>
              <span className="text-sm font-semibold tabular-nums">{c.score ?? 'n/a'}<span className="muted">/100</span></span>
            </div>
            <ScoreBar score={c.score} />
            <p className="mt-1 text-xs muted">{c.explanation}</p>
            <ul className="mt-2 divide-y divide-ink-100 text-sm dark:divide-ink-800">
              {checks.map((x) => {
                const [Icon, cls] = STATUS_ICON[x.status] || STATUS_ICON.na;
                return (
                  <li key={x.key} className="flex items-start gap-2 py-1.5">
                    <Icon size={16} className={`mt-0.5 shrink-0 ${cls}`} />
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{x.label}</span>{x.status !== 'pass' && x.status !== 'na' && <SeverityBadge severity={x.severity} />}</div>
                      <div className="text-xs muted">{x.detail}</div>{x.status !== 'pass' && x.status !== 'na' && x.fix && <div className="text-xs text-brand-700 dark:text-brand-300">Fix: {x.fix}</div>}</div>
                    <span className="shrink-0 text-xs tabular-nums muted">{x.status === 'na' ? 'n/a' : `${x.earned}/${x.points}`}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function PageDetailPage() {
  const { projectId, pageId } = useParams();
  const { detail: p, detailLoading, detailError, fetchDetail } = usePageStore();
  const [tab, setTab] = useState('overview');
  useEffect(() => { fetchDetail(pageId); }, [pageId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (detailError) return <ErrorState message={detailError} onRetry={() => fetchDetail(pageId)} />;
  if (detailLoading || !p || p.id !== pageId) return <Spinner />;
  const d = p.data || {};
  const b = p.scoreBreakdown || { categories: [], checks: [], top_issues: [] };
  const sec = d.security || {};
  const tabs = [{ key: 'overview', label: 'Overview' }, { key: 'score', label: 'Score breakdown' }, { key: 'issues', label: 'Issues', count: p.issues.length },
    { key: 'content', label: 'Content & headings' }, { key: 'links', label: 'Links', count: p.inlinks.length }, { key: 'images', label: 'Images', count: d.images_total || 0 },
    { key: 'technical', label: 'Technical' }, { key: 'social', label: 'Social & intl' }];
  return (
    <div className="space-y-5">
      <Link to={`/projects/${projectId}/pages?crawl=${p.crawl.id}`} className="inline-flex items-center gap-1 text-sm muted hover:underline"><ArrowLeft size={14} />All pages</Link>
      <div className="card card-pad flex flex-wrap items-center gap-6">
        <ScoreRing score={p.seoScore} size={112} label={b.grade} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge code={p.statusCode} /><span className={`chip ${p.indexable ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>{p.indexable ? 'Indexable' : 'Non-indexable'}</span><span className="chip bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300">depth {p.depth}</span></div>
          <h1 className="break-all text-lg font-semibold">{p.url} <a href={p.url} target="_blank" rel="noreferrer" className="inline-block align-middle muted" aria-label="Open URL"><ExternalLink size={14} /></a></h1>
          <p className="text-sm muted">{p.title || 'No title'} · crawl {p.crawl.name} · {fmtDate(p.crawl.finishedAt)} · score {p.scoreVersion}</p>
          {b.caps && b.caps.length > 0 && <p className="text-xs text-amber-700">{b.caps.join('; ')}</p>}
        </div>
        <Link to={`/projects/${projectId}/ai?crawl=${p.crawl.id}&url=${encodeURIComponent(p.url)}`} className="btn-outline"><Sparkles size={15} />Improve with AI</Link>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Top issues and fixes" subtitle="Ordered by severity, then points lost">
            {b.top_issues.length ? <ul className="space-y-3">{b.top_issues.map((t) => (
              <li key={t.check} className="text-sm"><div className="flex items-center gap-2"><SeverityBadge severity={t.severity} /><span className="font-medium">{t.label}</span><span className="text-xs muted">−{t.lost} pts</span></div>
                <div className="mt-0.5 text-xs muted">{t.detail}</div>{t.fix && <div className="text-xs text-brand-700 dark:text-brand-300">{t.fix}</div>}</li>))}</ul> : <p className="text-sm muted">No deductions.</p>}
          </Card>
          <Card title="Category scores">
            <div className="space-y-3">{b.categories.map((c) => <div key={c.key}><div className="mb-1 flex justify-between text-xs"><span>{c.label}</span><span className="font-semibold">{c.score ?? 'n/a'}</span></div><ScoreBar score={c.score} /></div>)}</div>
            {p.scoreHistory.length > 1 && <div className="mt-5 border-t border-ink-100 pt-3 text-xs dark:border-ink-800"><div className="mb-1 font-semibold">Score history</div>{p.scoreHistory.map((h) => <div key={h.pageId} className="flex justify-between py-0.5"><span className="muted">{h.crawl.name}</span><span className="tabular-nums">{h.score ?? 'n/a'}</span></div>)}</div>}
          </Card>
          <Card title="Metadata" className="lg:col-span-2"><dl>
            <KV label={`Title (${p.titleLength} chars)`}>{p.title}</KV>
            <KV label={`Meta description (${p.metaLength} chars)`}>{p.metaDescription}</KV>
            <KV label="H1">{p.h1}</KV>
            <KV label="Canonical">{p.canonical}{d.canonical_kind && <span className="ml-2 chip bg-ink-100 dark:bg-ink-800">{d.canonical_kind}</span>}</KV>
            <KV label="Word count">{p.wordCount}</KV>
            <KV label="Schema">{(d.schema_types || []).join(', ')}</KV>
          </dl></Card>
        </div>
      )}
      {tab === 'score' && <Card title="Score breakdown" subtitle={b.explanation}><Checks breakdown={b} /></Card>}
      {tab === 'issues' && (
        <Card title="Detected issues" subtitle="Verbatim from the crawler, with severity from the scoring engine" pad={false}>
          {p.issues.length ? <ul className="divide-y divide-ink-100 dark:divide-ink-800">{p.issues.map((i) => {
            const fix = (b.checks.find((c) => c.key === i.checkKey) || {}).fix;
            return <li key={i.id} className="flex items-start gap-3 px-5 py-2.5 text-sm"><SeverityBadge severity={i.severity} /><div className="min-w-0 flex-1"><div>{i.label}</div><div className="text-xs muted">{i.groupLabel} · {i.category}{i.convention ? ' · convention' : ''}</div>{fix && <div className="text-xs text-brand-700 dark:text-brand-300">Fix: {fix}</div>}</div></li>;
          })}</ul> : <p className="p-5 text-sm muted">No issues flagged for this page.</p>}
        </Card>
      )}
      {tab === 'content' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Headings"><dl><KV label={`H1 (${(d.h1_list || []).length})`}>{list(d.h1_list)}</KV><KV label={`H2 (${d.h2_count || 0})`}>{list(d.h2_list, 30)}</KV></dl></Card>
          <Card title="Content"><dl><KV label="Words">{p.wordCount}</KV><KV label="Body hash">{d.body_hash}</KV><KV label="Pagination">{yes(d.is_pagination)}</KV><KV label="Captured text">{p.bodyTextLength ? `${p.bodyTextLength} chars stored` : null}</KV>
            {d.js_diff && <KV label="JavaScript dependency">{d.js_diff.severity} — {(d.js_diff.summary || '').toString()}</KV>}</dl></Card>
        </div>
      )}
      {tab === 'links' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={`Inlinks (${p.inlinks.length})`} pad={false}><ul className="max-h-[480px] divide-y divide-ink-100 overflow-y-auto text-sm dark:divide-ink-800">{p.inlinks.map((l) => <li key={l.id} className="px-5 py-2"><div className="break-all">{l.sourceUrl}</div><div className="text-xs muted">{l.anchor ? `“${l.anchor}”` : 'no anchor'}{l.placement ? ` · ${l.placement}` : ''}</div></li>)}{!p.inlinks.length && <li className="px-5 py-3 muted">No internal pages link here (or it is the start page).</li>}</ul></Card>
          <Card title={`Outlinks (${p.internalLinks} internal · ${p.externalLinks} external)`}><dl><KV label="Internal">{list((d.internal_link_urls || []).map((x) => (Array.isArray(x) ? x[0] : x)), 60)}</KV><KV label="External">{list((d.external_link_urls || []).map((x) => (Array.isArray(x) ? x[0] : x)), 40)}</KV></dl></Card>
        </div>
      )}
      {tab === 'images' && (
        <Card title={`Images (${d.images_total || 0} total · ${d.images_no_alt || 0} missing alt · ${d.images_empty_alt || 0} empty alt)`} pad={false}>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="table-head"><tr><th className="px-4 py-2">Image</th><th className="px-4 py-2">Alt</th></tr></thead><tbody>
            {(d.images_all_data || []).slice(0, 200).map((im, i) => <tr key={i} className="table-row"><td className="max-w-[480px] break-all px-4 py-2">{im.src || im.url || JSON.stringify(im)}</td><td className="px-4 py-2">{im.alt === undefined || im.alt === null ? <span className="text-red-600">missing</span> : im.alt === '' ? <span className="text-amber-600">empty</span> : im.alt}</td></tr>)}
          </tbody></table>{!(d.images_all_data || []).length && <p className="p-5 text-sm muted">{d.images_total ? 'Per-image data not captured in this crawl.' : 'No images on this page.'}</p>}</div>
        </Card>
      )}
      {tab === 'technical' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Response"><dl><KV label="Status">{p.statusCode}</KV><KV label="Content type">{p.contentType}</KV><KV label="Response time">{p.responseTime}s</KV><KV label="Fetch error">{p.fetchError}</KV><KV label="X-Robots-Tag">{d.x_robots_tag}</KV><KV label="Indexable">{yes(p.indexable)}</KV></dl></Card>
          <Card title="Redirects"><dl><KV label="Redirects to">{p.redirectUrl}</KV><KV label="Kind">{d.redirect_kind}</KV><KV label="Hops">{d.redirect_hops}</KV><KV label="Chain">{list((d.redirect_chain || []).map((h) => `${h.status || ''} ${h.url || JSON.stringify(h)}`))}</KV></dl></Card>
          <Card title="Security"><dl><KV label="HTTPS">{yes(sec.is_https)}</KV><KV label="HSTS">{yes(sec.hsts)}</KV><KV label="CSP">{yes(sec.csp)}</KV><KV label="X-Content-Type-Options">{yes(sec.x_content_type_options)}</KV><KV label="X-Frame-Options">{yes(sec.x_frame_options)}</KV><KV label="Referrer-Policy">{yes(sec.referrer_policy)}</KV><KV label="Mixed content">{list(d.mixed_content)}</KV></dl></Card>
          <Card title="URL & analytics"><dl><KV label="URL issues">{list(d.url_issues)}</KV><KV label="Analytics">{d.analytics ? JSON.stringify(d.analytics) : null}</KV><KV label="Bot challenge">{d.challenge ? JSON.stringify(d.challenge) : null}</KV></dl></Card>
        </div>
      )}
      {tab === 'social' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Open Graph"><dl>{Object.entries(d.og_tags || {}).map(([k, v]) => <KV key={k} label={k}>{String(v)}</KV>)}{!Object.keys(d.og_tags || {}).length && <p className="text-sm muted">No Open Graph tags.</p>}</dl></Card>
          <Card title="Twitter"><dl>{Object.entries(d.twitter_tags || {}).map(([k, v]) => <KV key={k} label={k}>{String(v)}</KV>)}{!Object.keys(d.twitter_tags || {}).length && <p className="text-sm muted">No Twitter tags.</p>}</dl></Card>
          <Card title="Hreflang" className="lg:col-span-2"><dl>{(d.hreflang || []).map((h, i) => <KV key={i} label={h.lang || h.hreflang || '?'}>{h.href || h.url || JSON.stringify(h)}</KV>)}{!(d.hreflang || []).length && <p className="text-sm muted">No hreflang annotations.</p>}</dl></Card>
        </div>
      )}
    </div>
  );
}
