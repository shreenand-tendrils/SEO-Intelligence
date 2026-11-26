import { Route, Routes, Link } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import ProjectsPage from './pages/ProjectsPage';
import DashboardPage from './pages/DashboardPage';
import PagesPage from './pages/PagesPage';
import PageDetailPage from './pages/PageDetailPage';
import ReportsPage from './pages/ReportsPage';
import CrawlsPage from './pages/CrawlsPage';
import ComparePage from './pages/ComparePage';
import AiPage from './pages/AiPage';
import SettingsPage from './pages/SettingsPage';
import { EmptyState } from './components/ui';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<DashboardPage />} />
        <Route path="projects/:projectId/pages" element={<PagesPage />} />
        <Route path="projects/:projectId/pages/:pageId" element={<PageDetailPage />} />
        <Route path="projects/:projectId/reports" element={<ReportsPage />} />
        <Route path="projects/:projectId/crawls" element={<CrawlsPage />} />
        <Route path="projects/:projectId/compare" element={<ComparePage />} />
        <Route path="projects/:projectId/ai" element={<AiPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<EmptyState title="Page not found" action={<Link className="btn-primary" to="/">Back to projects</Link>}>That address does not exist.</EmptyState>} />
      </Route>
    </Routes>
  );
}
