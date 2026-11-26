import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderPlus, Globe, Search, Trash2 } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { Card, EmptyState, ErrorState, ScorePill, Skeleton } from '../components/ui';
import { fmtDate } from '../utils/format';

function NewProject({ onDone }) {
  const create = useProjectStore((s) => s.createProject);
  const [form, setForm] = useState({ name: '', seedUrl: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const p = await create({ name: form.name, seedUrl: form.seedUrl || undefined }); onDone(p); } catch (x) { setErr(x.details ? x.details.map((d) => `${d.path}: ${d.message}`).join('; ') : x.message); }
    setBusy(false);
  };
  return (
    <Card title="New project" subtitle="A project groups the crawls of one website.">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
        <div><label className="label" htmlFor="pname">Project name</label><input id="pname" className="input" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme marketing site" /></div>
        <div><label className="label" htmlFor="purl">Website URL</label><input id="purl" className="input" required value={form.seedUrl} onChange={(e) => setForm({ ...form, seedUrl: e.target.value })} placeholder="https://www.example.com/" /></div>
        <button className="btn-primary justify-center" disabled={busy} type="submit"><FolderPlus size={16} />Create</button>
      </form>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </Card>
  );
}

export default function ProjectsPage() {
  const { projects, loading, error, fetchProjects, deleteProject } = useProjectStore();
  const [q, setQ] = useState('');
  const nav = useNavigate();
  useEffect(() => { const t = setTimeout(() => fetchProjects({ q }), 200); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Projects</h1><p className="text-sm muted">Every website you audit, with its latest SEO score.</p></div>
        <div className="relative w-full sm:w-72"><Search size={15} className="absolute left-3 top-2.5 text-ink-400" /><input className="input pl-9" placeholder="Search projects or hosts" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" /></div>
      </div>
      <NewProject onDone={(p) => nav(`/projects/${p.id}/crawls?new=1`)} />
      {error && <ErrorState message={error} onRetry={() => fetchProjects({ q })} />}
      {loading && !projects.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div> : null}
      {!loading && !error && !projects.length && <Card><EmptyState icon={Globe} title="No projects yet">Create a project above, then run its first crawl. Existing saved crawls can be imported with the legacy importer.</EmptyState></Card>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => (
          <div key={p.id} className="card group relative p-5 transition hover:border-brand-300 hover:shadow-md">
            <Link to={`/projects/${p.id}`} className="absolute inset-0" aria-label={`Open ${p.name}`} />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><h3 className="truncate font-semibold">{p.name}</h3><p className="truncate text-sm muted">{(p.websites[0] && p.websites[0].host) || 'No website yet'}</p></div>
              <ScorePill score={p.latestCrawl && p.latestCrawl.seoScore ? p.latestCrawl.seoScore.overall : null} />
            </div>
            <div className="mt-5 flex items-center justify-between text-xs muted">
              <span>{p.crawlCount} crawl{p.crawlCount === 1 ? '' : 's'}{p.latestCrawl ? ` · ${p.latestCrawl.pagesCrawled} pages` : ''}</span>
              <span>{p.latestCrawl ? fmtDate(p.latestCrawl.finishedAt) : 'Never crawled'}</span>
            </div>
            <button type="button" className="btn-ghost absolute bottom-3 right-3 z-10 hidden px-1.5 py-1 text-red-600 group-hover:flex" aria-label={`Delete ${p.name}`}
              onClick={async () => { if (window.confirm(`Delete project "${p.name}" and all its crawls from the database?`)) await deleteProject(p.id); }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
