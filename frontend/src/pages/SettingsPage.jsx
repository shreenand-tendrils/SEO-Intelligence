import { useEffect, useState } from 'react';
import { Card, KV } from '../components/ui';
import { useSettingsStore } from '../store/settingsStore';
import { api } from '../services/api';

export default function SettingsPage() {
  const { theme, setTheme, pageSize, setPageSize } = useSettingsStore();
  const [health, setHealth] = useState(null);
  const [ai, setAi] = useState(null);
  useEffect(() => {
    api.health().then((r) => setHealth(r.data)).catch((e) => setHealth({ status: 'down', error: e.message }));
    api.ai.status().then((r) => setAi(r.data)).catch((e) => setAi({ error: e.message }));
  }, []);
  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card title="Appearance">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="theme">Theme</label><select id="theme" className="input" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
          <div><label className="label" htmlFor="ps">Rows per page</label><select id="ps" className="input" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>{[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        </div>
        <p className="mt-3 text-xs muted">Only these display preferences are stored in your browser. Crawl data lives in PostgreSQL; API keys stay on the server.</p>
      </Card>
      <Card title="System status"><dl>
        <KV label="API">{health ? health.status : '…'}</KV><KV label="Database">{health && health.database}</KV><KV label="Crawler service">{health && health.crawler}</KV>
        <KV label="Groq AI">{ai ? (ai.error ? ai.error : ai.configured ? `configured · ${ai.model || ''}` : 'not configured') : '…'}</KV>
      </dl></Card>
    </div>
  );
}
