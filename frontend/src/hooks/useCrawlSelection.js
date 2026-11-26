import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';

/** Completed crawls of a project plus the selected one (?crawl=…, default latest). */
export function useCrawlSelection(projectId) {
  const [params, setParams] = useSearchParams();
  const [crawls, setCrawls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api.projects.crawls(projectId, { pageSize: 100 })
      .then((r) => { if (live) { setCrawls(r.data.filter((c) => ['COMPLETED', 'STOPPED'].includes(c.status))); setLoading(false); } })
      .catch((e) => { if (live) { setError(e.message); setLoading(false); } });
    return () => { live = false; };
  }, [projectId]);
  const crawlId = params.get('crawl') || (crawls[0] && crawls[0].id) || null;
  const select = (id) => { const p = new URLSearchParams(params); p.set('crawl', id); setParams(p, { replace: true }); };
  return { crawls, crawlId, crawl: crawls.find((c) => c.id === crawlId) || null, select, loading, error };
}
