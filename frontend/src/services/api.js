import axios from 'axios';

// All requests go to the Node API; no secrets live in the browser.
const client = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', timeout: 190000 });

client.interceptors.response.use(
  (r) => r,
  (err) => {
    const e = err.response && err.response.data && err.response.data.error;
    const out = new Error((e && e.message) || (err.code === 'ECONNABORTED' ? 'Request timed out' : err.message || 'Request failed'));
    out.status = err.response ? err.response.status : 0;
    out.code = e && e.code;
    out.details = e && e.details;
    return Promise.reject(out);
  },
);

const unwrap = (p) => p.then((r) => (r.status === 204 ? null : r.data));

export const api = {
  health: () => unwrap(client.get('/health')),
  projects: {
    list: (params) => unwrap(client.get('/projects', { params })),
    create: (body) => unwrap(client.post('/projects', body)),
    get: (id) => unwrap(client.get(`/projects/${id}`)),
    update: (id, body) => unwrap(client.patch(`/projects/${id}`, body)),
    remove: (id) => unwrap(client.delete(`/projects/${id}`)),
    dashboard: (id) => unwrap(client.get(`/projects/${id}/dashboard`)),
    history: (id) => unwrap(client.get(`/projects/${id}/score-history`)),
    crawls: (id, params) => unwrap(client.get(`/projects/${id}/crawls`, { params })),
    startCrawl: (id, settings) => unwrap(client.post(`/projects/${id}/crawls`, settings)),
  },
  crawls: {
    get: (id) => unwrap(client.get(`/crawls/${id}`)),
    stop: (id) => unwrap(client.post(`/crawls/${id}/stop`)),
    remove: (id) => unwrap(client.delete(`/crawls/${id}`)),
    pages: (id, params) => unwrap(client.get(`/crawls/${id}/pages`, { params })),
    issues: (id) => unwrap(client.get(`/crawls/${id}/issues`)),
    reports: (id) => unwrap(client.get(`/crawls/${id}/reports`)),
    scores: (id) => unwrap(client.get(`/crawls/${id}/scores`)),
    compare: (id, otherCrawlId) => unwrap(client.post(`/crawls/${id}/compare`, otherCrawlId ? { otherCrawlId } : {})),
    exportUrl: (id) => `${client.defaults.baseURL}/crawls/${id}/export.xlsx`,
  },
  pages: {
    get: (id) => unwrap(client.get(`/pages/${id}`)),
  },
  ai: {
    status: () => unwrap(client.get('/ai/status')),
    chat: (body) => unwrap(client.post('/ai/chat', body)),
    action: (kind, body) => unwrap(client.post(`/ai/${kind}`, body)),
    conversations: (params) => unwrap(client.get('/ai/conversations', { params })),
    conversation: (id) => unwrap(client.get(`/ai/conversations/${id}`)),
    deleteConversation: (id) => unwrap(client.delete(`/ai/conversations/${id}`)),
  },
};
