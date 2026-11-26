import { useEffect } from 'react';
import { NavLink, Outlet, useParams, Link } from 'react-router-dom';
import { Bot, FileBarChart2, FolderKanban, GitCompareArrows, History, LayoutDashboard, ListTree, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun, Monitor } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { useSettingsStore } from '../store/settingsStore';

const projectNav = [
  { to: '', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: 'pages', label: 'Pages', icon: ListTree },
  { to: 'reports', label: 'Reports & issues', icon: FileBarChart2 },
  { to: 'crawls', label: 'Crawls', icon: History },
  { to: 'compare', label: 'Compare', icon: GitCompareArrows },
  { to: 'ai', label: 'AI Consultant', icon: Bot },
];

function ThemeToggle() {
  const { theme, setTheme } = useSettingsStore();
  const next = { light: 'dark', dark: 'system', system: 'light' }[theme];
  const Icon = { light: Sun, dark: Moon, system: Monitor }[theme];
  return <button type="button" className="btn-ghost px-2" onClick={() => setTheme(next)} title={`Theme: ${theme}`} aria-label="Toggle theme"><Icon size={17} /></button>;
}

export default function AppLayout() {
  const { projectId } = useParams();
  const { current, fetchProject } = useProjectStore();
  const { sidebarCollapsed, toggleSidebar, theme, setTheme } = useSettingsStore();
  useEffect(() => { setTheme(theme); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (projectId && (!current || current.id !== projectId)) fetchProject(projectId); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const link = ({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'}`;
  const project = projectId && current && current.id === projectId ? current : null;
  return (
    <div className="flex min-h-screen">
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-ink-200 bg-white px-3 py-4 transition-all dark:border-ink-800 dark:bg-ink-900 md:flex ${sidebarCollapsed ? 'w-16' : 'w-60'}`}>
        <Link to="/" className="mb-6 flex items-center gap-2 px-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white"><svg width="18" height="18" viewBox="0 0 32 32"><path d="M6 23l7-8 5 5 8-11" stroke="white" strokeWidth="3.5" fill="none" strokeLinecap="round" /></svg></div>
          {!sidebarCollapsed && <div><div className="text-sm font-bold leading-tight">Tendrils SEO</div><div className="text-[11px] muted">Intelligence platform</div></div>}
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          <NavLink to="/" end className={link} title="Projects"><FolderKanban size={18} />{!sidebarCollapsed && 'Projects'}</NavLink>
          {project && (
            <>
              {!sidebarCollapsed && <div className="mt-4 truncate px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide muted">{project.name}</div>}
              {projectNav.map((n) => (
                <NavLink key={n.label} to={`/projects/${projectId}${n.to ? `/${n.to}` : ''}`} end={n.end} className={link} title={n.label}><n.icon size={18} />{!sidebarCollapsed && n.label}</NavLink>
              ))}
            </>
          )}
          <div className="flex-1" />
          <NavLink to="/settings" className={link} title="Settings"><Settings size={18} />{!sidebarCollapsed && 'Settings'}</NavLink>
        </nav>
        <button type="button" className="btn-ghost mt-2 justify-center" onClick={toggleSidebar} aria-label="Toggle sidebar">{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-ink-200 bg-white/80 px-4 backdrop-blur dark:border-ink-800 dark:bg-ink-950/80 md:px-8">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Link to="/" className="muted hover:underline md:hidden">Projects</Link>
            {project && <><span className="muted md:hidden">/</span><span className="truncate font-semibold">{project.name}</span>
              {project.websites && project.websites[0] && <span className="hidden truncate muted sm:inline">· {project.websites[0].host}</span>}</>}
          </div>
          <div className="flex items-center gap-1"><ThemeToggle /></div>
        </header>
        {project && (
          <nav className="flex gap-1 overflow-x-auto border-b border-ink-200 bg-white px-2 py-1 dark:border-ink-800 dark:bg-ink-900 md:hidden">
            {projectNav.map((n) => <NavLink key={n.label} to={`/projects/${projectId}${n.to ? `/${n.to}` : ''}`} end={n.end} className={link}><n.icon size={16} />{n.label}</NavLink>)}
          </nav>
        )}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8"><Outlet /></main>
      </div>
    </div>
  );
}
