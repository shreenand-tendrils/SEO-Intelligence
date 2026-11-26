import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Bot, ListChecks, MessageSquarePlus, Send, Sparkles, Target, Trash2, TrendingUp, User } from 'lucide-react';
import { useCrawlSelection } from '../hooks/useCrawlSelection';
import { useAiStore } from '../store/aiStore';
import CrawlPicker from '../components/CrawlPicker';
import { Card, EmptyState, ErrorState, Spinner } from '../components/ui';
import { fmtDate } from '../utils/format';

const SUGGESTIONS = ['Why is my SEO score low?', 'Which pages should I fix first?', 'What are the biggest technical SEO issues?', 'Which pages are missing metadata?',
  'Which issues were resolved since the last crawl?', 'What changed between the latest crawl and the previous one?', 'Create a prioritised SEO action plan.'];

function Structured({ value }) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return <span>{String(value)}</span>;
  if (Array.isArray(value)) return <ul className="ml-4 list-disc space-y-1">{value.map((v, i) => <li key={i}><Structured value={v} /></li>)}</ul>;
  return <div className="space-y-1.5">{Object.entries(value).map(([k, v]) => <div key={k}><span className="text-xs font-semibold uppercase muted">{k.replace(/_/g, ' ')}</span><div><Structured value={v} /></div></div>)}</div>;
}

function Message({ m }) {
  const mine = m.role === 'user';
  return (
    <div className={`flex gap-3 ${mine ? 'flex-row-reverse' : ''}`}>
      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${mine ? 'bg-ink-200 dark:bg-ink-700' : 'bg-brand-600 text-white'}`}>{mine ? <User size={15} /> : <Bot size={15} />}</div>
      <div className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-4 py-2.5 text-sm ${mine ? 'bg-brand-600 text-white' : 'bg-ink-100 dark:bg-ink-800'}`}>
        {m.structured && !mine ? <Structured value={m.structured} /> : m.content}
      </div>
    </div>
  );
}

export default function AiPage() {
  const { projectId } = useParams();
  const [sp] = useSearchParams();
  const focusUrl = sp.get('url') || '';
  const sel = useCrawlSelection(projectId);
  const { status, conversations, active, messages, sending, error, fetchStatus, fetchConversations, open, newConversation, send, runAction, remove } = useAiStore();
  const [text, setText] = useState('');
  const end = useRef(null);
  useEffect(() => { fetchStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel.crawlId) { fetchConversations(sel.crawlId); newConversation(); } }, [sel.crawlId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (end.current) end.current.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, sending]);
  if (sel.loading) return <Spinner />;
  if (!sel.crawls.length) return <Card><EmptyState icon={Bot} title="No completed crawls">The AI Consultant answers from a completed crawl's data.</EmptyState></Card>;
  const configured = status && status.configured !== false && !status.error;
  const submit = (msg) => { const m = (msg || text).trim(); if (!m || sending) return; setText(''); send(sel.crawlId, m, focusUrl || undefined); };
  const prevId = (() => { const i = sel.crawls.findIndex((c) => c.id === sel.crawlId); return sel.crawls[i + 1] && sel.crawls[i + 1].id; })();
  const actions = [
    { kind: 'summary', label: 'Site summary', icon: Sparkles },
    { kind: 'plan', label: 'Action plan', icon: ListChecks },
    { kind: 'prioritize', label: 'Prioritise fixes', icon: Target },
    ...(focusUrl ? [{ kind: 'page', label: 'Improve this page', icon: Target, body: { url: focusUrl } }] : []),
    ...(prevId ? [{ kind: 'compare', label: 'Explain changes', icon: TrendingUp, body: { otherCrawlId: prevId } }, { kind: 'history', label: 'History trend', icon: TrendingUp }] : []),
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">AI SEO Consultant</h1><p className="text-sm muted">Groq-powered answers grounded only in this crawl's data, scores and comparisons.</p></div>
        <CrawlPicker crawls={sel.crawls} value={sel.crawlId} onChange={sel.select} />
      </div>
      {status && !configured && <ErrorState message={status.error || 'Groq is not configured. Set GROQ_API_KEY and GROQ_MODEL in the crawler service environment.'} />}
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Conversations" action={<button type="button" className="btn-ghost px-2" onClick={newConversation} aria-label="New conversation"><MessageSquarePlus size={16} /></button>} pad={false}>
          <ul className="max-h-[560px] overflow-y-auto">
            {conversations.map((c) => (
              <li key={c.id} className={`group flex items-center gap-2 border-b border-ink-100 px-4 py-2.5 text-sm dark:border-ink-800 ${active && active.id === c.id ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(c.id)}><div className="truncate font-medium">{c.title || c.kind}</div><div className="text-xs muted">{c.kind} · {fmtDate(c.updatedAt)}</div></button>
                <button type="button" className="hidden text-red-600 group-hover:block" aria-label="Delete conversation" onClick={() => remove(c.id, sel.crawlId)}><Trash2 size={13} /></button>
              </li>
            ))}
            {!conversations.length && <li className="px-4 py-6 text-center text-sm muted">No conversations for this crawl yet.</li>}
          </ul>
        </Card>
        <Card pad={false} className="flex min-h-[560px] flex-col">
          <div className="flex flex-wrap gap-2 border-b border-ink-100 p-3 dark:border-ink-800">
            {actions.map((a) => <button key={a.kind} type="button" className="btn-outline py-1.5 text-xs" disabled={sending || !configured} onClick={() => runAction(a.kind, { crawlId: sel.crawlId, ...(a.body || {}) })}><a.icon size={14} />{a.label}</button>)}
            {focusUrl && <span className="self-center truncate text-xs muted">Focus: {focusUrl}</span>}
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {!messages.length && !sending && (
              <div className="py-6 text-center"><Bot className="mx-auto mb-2 text-brand-600" /><p className="mb-4 text-sm muted">Ask about this crawl. Answers only use the crawl's real URLs, issues and scores.</p>
                <div className="flex flex-wrap justify-center gap-2">{SUGGESTIONS.map((s) => <button key={s} type="button" disabled={!configured} className="chip cursor-pointer bg-ink-100 px-3 py-1.5 text-ink-700 hover:bg-brand-50 dark:bg-ink-800 dark:text-ink-200" onClick={() => submit(s)}>{s}</button>)}</div></div>
            )}
            {messages.map((m) => <Message key={m.id} m={m} />)}
            {sending && <div className="flex items-center gap-2 text-sm muted"><Bot size={15} className="animate-pulse" />Analysing the crawl…</div>}
            {error && <ErrorState message={error} />}
            <div ref={end} />
          </div>
          <form className="flex gap-2 border-t border-ink-100 p-3 dark:border-ink-800" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input className="input" placeholder={configured ? 'Ask about scores, issues, pages or changes…' : 'AI is not configured'} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} disabled={!configured} aria-label="Message" />
            <button type="submit" className="btn-primary" disabled={sending || !text.trim() || !configured}><Send size={15} /></button>
          </form>
        </Card>
      </div>
    </div>
  );
}
