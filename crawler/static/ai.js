/* AI SEO Consultant UI (powered by Groq, through the backend only).
 *
 * This file never sees an API key: the browser talks to /ai/* on this app and
 * the backend alone holds the credentials. Everything the model returns is
 * rendered with textContent / escaped text, never as HTML, because crawled
 * page text can reach the model and come back out.
 */
(function () {
  'use strict';

  const ERROR_TITLES = {
    groq_not_configured: 'Groq is not set up yet',
    groq_invalid_key: 'Groq rejected the API key',
    groq_model_unavailable: 'The configured model is not available',
    groq_rate_limited: 'Groq rate limit reached',
    groq_context_too_large: 'Too much data for one request',
    groq_timeout: 'Groq took too long to answer',
    groq_network_error: 'Could not reach Groq',
    groq_api_error: 'Groq returned an error',
    groq_bad_response: 'The AI reply could not be used',
    groq_empty_reply: 'Groq returned an empty reply',
    crawl_not_found: 'Saved crawl not found',
    not_enough_history: 'Not enough history yet',
  };

  const state = { tab: 'chat', convs: {}, busy: false, status: null, crawlFile: null };

  // ---- tiny DOM helpers ----------------------------------------------------
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(c => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const $ = (id) => document.getElementById(id);

  // Very small, safe Markdown: paragraphs, bullets, **bold**, `code`. Escaped first.
  function mdToNodes(text) {
    const box = el('div', { class: 'aic-md' });
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    let list = null;
    const inline = (parent, s) => {
      const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
      let last = 0, m;
      while ((m = re.exec(s))) {
        if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
        const tok = m[0];
        parent.appendChild(tok[0] === '`' ? el('code', { text: tok.slice(1, -1) }) : el('strong', { text: tok.slice(2, -2) }));
        last = m.index + tok.length;
      }
      if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
    };
    lines.forEach(line => {
      const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (bullet) {
        if (!list) { list = el('ul'); box.appendChild(list); }
        const li = el('li'); inline(li, bullet[1]); list.appendChild(li);
      } else if (line.trim()) {
        list = null;
        const hd = line.match(/^#{1,4}\s+(.*)$/);
        const p = el(hd ? 'h4' : 'p'); inline(p, hd ? hd[1] : line); box.appendChild(p);
      } else { list = null; }
    });
    return box;
  }

  function fmtError(err) {
    const e = (err && err.error) || err || {};
    const box = el('div', { class: 'aic-error', role: 'alert' });
    box.appendChild(el('strong', { text: ERROR_TITLES[e.code] || 'Something went wrong' }));
    box.appendChild(el('div', { text: e.message || 'Unknown error.' }));
    if (e.retry_after) box.appendChild(el('div', { class: 'aic-muted', text: `Groq asks you to wait about ${Math.ceil(e.retry_after)} seconds.` }));
    if (e.code === 'groq_not_configured' || e.code === 'groq_invalid_key' || e.code === 'groq_model_unavailable') {
      box.appendChild(el('div', { class: 'aic-muted', text: 'Edit the backend .env file (see docs/GROQ_SETUP.md), restart the app, then try again.' }));
    }
    return box;
  }

  async function api(path, opts) {
    let resp;
    try {
      resp = await fetch(path, opts);
    } catch (e) {
      throw { error: { code: 'groq_network_error', message: 'Could not reach the crawler backend. Is the app still running?' } };
    }
    let data = null;
    try { data = await resp.json(); } catch (e) { /* non-JSON */ }
    if (!resp.ok) throw data && data.error ? data : { error: { code: 'http_' + resp.status, message: `Request failed (HTTP ${resp.status}).` } };
    return data;
  }
  const postJson = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ---- which saved crawl are we talking about? --------------------------------
  async function ensureCrawlFile() {
    const rows = (typeof crawlerResults !== 'undefined') ? crawlerResults : [];  // global `let` in script.js
    if (!rows || !rows.length) throw { error: { code: 'crawl_not_found', message: 'Run or load a crawl first, then ask the AI about it.' } };
    if (window._scCrawlFile) return window._scCrawlFile;
    // The crawl is only in the browser so far. Save it (same as auto-save) so the backend can read it.
    const host = (rows[0].url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const name = (host || 'crawl') + ' - ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
    const d = await postJson('/crawl/save', { name, results: rows, inlinks: typeof crawlerInlinks !== 'undefined' ? crawlerInlinks : {}, reports: typeof _scReportsForSave === 'function' ? _scReportsForSave() : {} });
    window._scCrawlFile = d.file;
    return d.file;
  }

  // ---- drawer -----------------------------------------------------------------
  const TABS = [
    ['chat', 'Chat'], ['summary', 'Summary'], ['plan', 'Action plan'],
    ['prioritize', 'Priorities'], ['compare', 'Compare'], ['history', 'History'],
  ];

  function build() {
    if ($('ai-consultant')) return $('ai-consultant');
    const tabs = el('div', { class: 'aic-tabs', role: 'tablist' }, TABS.map(([id, label]) =>
      el('button', { type: 'button', role: 'tab', class: 'aic-tab', 'data-tab': id, text: label, onclick: () => switchTab(id) })));
    const panes = TABS.map(([id]) => el('section', { class: 'aic-pane', id: 'aic-pane-' + id, 'data-tab': id, hidden: true }));
    const root = el('aside', { id: 'ai-consultant', class: 'aic', hidden: true, 'aria-label': 'AI SEO Consultant' }, [
      el('div', { class: 'aic-head' }, [
        el('h2', { text: 'AI SEO Consultant' }),
        el('span', { id: 'aic-model', class: 'aic-badge', text: 'Groq' }),
        el('span', { class: 'aic-spacer' }),
        el('button', { type: 'button', class: 'aic-x', 'aria-label': 'Close', text: '×', onclick: aiConsultantClose }),
      ]),
      el('div', { id: 'aic-status' }),
      tabs,
      el('div', { class: 'aic-body' }, panes),
      el('div', { class: 'aic-foot', text: 'Answers come from Groq using a compact summary of this crawl. Check important changes before shipping them.' }),
    ]);
    document.body.appendChild(root);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) aiConsultantClose(); });
    return root;
  }

  async function refreshStatus(verify) {
    const box = clear($('aic-status'));
    try {
      const s = await api('/ai/status' + (verify ? '?verify=1' : ''));
      state.status = s;
      if (s.model) $('aic-model').textContent = 'Groq · ' + s.model;
      if (!s.configured) {
        const b = el('div', { class: 'aic-error', role: 'alert' }, [
          el('strong', { text: 'Groq is not set up yet' }),
          ...s.problems.map(p => el('div', { text: p })),
          el('div', { class: 'aic-muted', text: 'Edit the backend .env file (see docs/GROQ_SETUP.md), restart the app, then reopen this panel.' }),
        ]);
        box.appendChild(b);
      } else if (verify) {
        if (s.verified && s.verified.ok) box.appendChild(el('div', { class: 'aic-ok', text: 'Connected to Groq. Key and model are accepted.' }));
        else if (s.error) box.appendChild(fmtError(s.error));
      }
      if (s.configured) box.appendChild(el('button', { type: 'button', class: 'aic-link', text: 'Test connection', onclick: () => refreshStatus(true) }));
    } catch (e) { box.appendChild(fmtError(e)); }
    return state.status;
  }

  function aiConsultantOpen(tab) {
    const root = build();
    root.hidden = false;
    refreshStatus(false);
    switchTab(typeof tab === 'string' ? tab : state.tab);
  }
  function aiConsultantClose() { const r = $('ai-consultant'); if (r) r.hidden = true; }

  function switchTab(id) {
    state.tab = id;
    document.querySelectorAll('#ai-consultant .aic-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    document.querySelectorAll('#ai-consultant .aic-pane').forEach(p => { p.hidden = p.dataset.tab !== id; });
    const pane = $('aic-pane-' + id);
    if (pane && !pane.dataset.ready) { pane.dataset.ready = '1'; initPane(id, pane); }
  }

  function setBusy(btn, on, label) {
    state.busy = on;
    document.querySelectorAll('#ai-consultant button.aic-run, #dock-pane-ai button.aic-run').forEach(b => { b.disabled = on; });
    if (btn) { btn.dataset.label = btn.dataset.label || btn.textContent; btn.textContent = on ? (label || 'Asking Groq…') : btn.dataset.label; }
  }

  // ---- generic runner for the structured features -------------------------------
  function runnerPane(pane, kind, intro, buttonLabel, buildBody, render, extraControls) {
    const out = el('div', { class: 'aic-result' });
    const btn = el('button', { type: 'button', class: 'aic-btn aic-primary aic-run', text: buttonLabel });
    btn.addEventListener('click', async () => {
      clear(out);
      setBusy(btn, true);
      try {
        const file = await ensureCrawlFile();
        const body = await buildBody(file);
        const d = await postJson('/ai/' + kind, body);
        clear(out).appendChild(render(d.result));
        out.appendChild(contextNote(d));
      } catch (e) { clear(out).appendChild(fmtError(e)); }
      setBusy(btn, false);
    });
    pane.appendChild(el('p', { class: 'aic-lede', text: intro }));
    (extraControls || []).forEach(c => pane.appendChild(c));
    pane.appendChild(el('div', { class: 'aic-actions' }, [btn]));
    pane.appendChild(out);
    // Show the most recent saved result for this crawl, if any.
    ensureCrawlFile().then(file => api(`/ai/conversations?crawl_file=${encodeURIComponent(file)}&kind=${kind}&limit=1`)
      .then(async list => {
        const c = (list.conversations || [])[0];
        if (!c) return;
        const full = await api('/ai/conversations/' + c.id);
        const last = (full.messages || []).filter(m => m.structured).pop();
        if (last && !out.firstChild) {
          out.appendChild(el('div', { class: 'aic-muted', text: 'Last result for this crawl (' + new Date(c.updated_at * 1000).toLocaleString() + '):' }));
          out.appendChild(render(last.structured));
        }
      })).catch(() => { /* nothing saved yet, or no crawl loaded */ });
    return out;
  }

  function contextNote(d) {
    const c = d.context || {}, u = d.usage || {};
    const bits = [];
    if (c.pages_total) bits.push(`${c.pages_total} pages summarised`);
    if (c.condensed) bits.push('large crawl: detail condensed to fit the token budget');
    if (u.prompt_tokens) bits.push(`${u.prompt_tokens + (u.completion_tokens || 0)} tokens`);
    return el('div', { class: 'aic-muted aic-note', text: bits.join(' · ') });
  }

  // ---- renderers ---------------------------------------------------------------
  const badge = (text, cls) => el('span', { class: 'aic-pill ' + (cls || ''), text });
  const sevCls = (s) => ({ error: 'sev-error', warning: 'sev-warn', notice: 'sev-info' }[s] || '');
  const lvlCls = (s) => ({ high: 'lvl-high', medium: 'lvl-med', low: 'lvl-low' }[s] || '');
  function listBlock(title, items) {
    if (!items || !items.length) return null;
    return el('div', { class: 'aic-block' }, [el('h4', { text: title }), el('ul', {}, items.map(i => el('li', { text: i })))]);
  }
  const wrap = (kids) => el('div', { class: 'aic-card' }, kids.filter(Boolean));

  function renderSummary(r) {
    return wrap([
      el('div', { class: 'aic-headline' }, [badge(r.health.replace('_', ' '), 'health-' + r.health), el('span', { text: ' ' + r.headline })]),
      ...r.key_findings.map(f => el('div', { class: 'aic-block' }, [
        el('h4', {}, [badge(f.severity, sevCls(f.severity)), document.createTextNode(' ' + f.title)]),
        el('p', { text: f.detail }), f.evidence ? el('p', { class: 'aic-muted', text: f.evidence }) : null].filter(Boolean))),
      listBlock('Quick wins', r.quick_wins), listBlock('Strengths', r.strengths), listBlock('Risks', r.risks),
      r.ai_visibility ? el('div', { class: 'aic-block' }, [el('h4', { text: 'Visibility to search and AI crawlers' }), el('p', { text: r.ai_visibility })]) : null,
    ]);
  }

  function renderPage(r) {
    return wrap([
      el('div', { class: 'aic-headline' }, [badge(r.priority + ' priority', lvlCls(r.priority)), el('span', { text: ' ' + r.summary })]),
      listBlock('What works', r.what_works),
      ...r.problems.map(p => el('div', { class: 'aic-block' }, [
        el('h4', {}, [document.createTextNode(p.issue + ' '), badge(p.effort + ' effort', lvlCls(p.effort === 'low' ? 'low' : p.effort === 'high' ? 'high' : 'medium'))]),
        el('p', { text: p.why_it_matters }), el('p', {}, [el('strong', { text: 'Fix: ' }), document.createTextNode(p.fix)])])),
      r.suggested_title ? el('div', { class: 'aic-block' }, [el('h4', { text: 'Suggested title' }), el('p', { text: r.suggested_title })]) : null,
      r.suggested_meta_description ? el('div', { class: 'aic-block' }, [el('h4', { text: 'Suggested meta description' }), el('p', { text: r.suggested_meta_description })]) : null,
    ]);
  }

  function renderPlan(r) {
    return wrap([
      r.goal ? el('div', { class: 'aic-headline', text: r.goal }) : null,
      ...r.phases.map(ph => el('div', { class: 'aic-block aic-phase' }, [
        el('h4', { text: `Phase ${ph.phase}: ${ph.name}` + (ph.duration ? ` (${ph.duration})` : '') }),
        ph.objective ? el('p', { class: 'aic-muted', text: ph.objective }) : null,
        el('ol', {}, ph.tasks.map(t => el('li', {}, [
          el('strong', { text: t.task }), document.createTextNode(' '),
          badge('impact ' + t.impact, lvlCls(t.impact)), document.createTextNode(' '), badge('effort ' + t.effort, 'neutral'),
          t.issues_addressed.length ? el('div', { class: 'aic-muted', text: `${t.issues_addressed.join(', ')}${t.pages_affected ? ' · ' + t.pages_affected + ' pages' : ''}` }) : null,
          t.how ? el('div', { text: t.how }) : null].filter(Boolean)))),
      ].filter(Boolean))),
      listBlock('How to know it worked', r.success_metrics),
    ]);
  }

  function renderPrioritize(r) {
    return wrap([
      ...r.ranked.map(x => el('div', { class: 'aic-block aic-rank' }, [
        el('h4', {}, [document.createTextNode(`${x.rank}. ${x.issue} `), badge(x.severity, sevCls(x.severity)), document.createTextNode(' '),
          badge(x.pages_affected + ' pages', 'neutral'), document.createTextNode(' '), badge('impact ' + x.impact, lvlCls(x.impact)), document.createTextNode(' '),
          badge('effort ' + x.effort, 'neutral')]),
        el('p', { text: x.rationale }), x.fix ? el('p', {}, [el('strong', { text: 'Fix: ' }), document.createTextNode(x.fix)]) : null].filter(Boolean))),
      r.ignore_for_now && r.ignore_for_now.length ? el('div', { class: 'aic-block' }, [el('h4', { text: 'Safe to leave for now' }),
        el('ul', {}, r.ignore_for_now.map(i => el('li', { text: `${i.issue}: ${i.reason}` })))]) : null,
      r.dropped_unknown_issues ? el('div', { class: 'aic-muted aic-note', text: `${r.dropped_unknown_issues} item(s) the AI named were not issues in this crawl and were removed.` }) : null,
    ]);
  }

  function renderCompare(r) {
    return wrap([
      el('div', { class: 'aic-headline' }, [badge(r.verdict, 'verdict-' + r.verdict), el('span', { text: ' ' + r.headline })]),
      r.improvements.length ? el('div', { class: 'aic-block' }, [el('h4', { text: 'Improved' }), ...r.improvements.map(i => el('p', {}, [el('strong', { text: i.title + ': ' }), document.createTextNode(i.detail)]))]) : null,
      r.regressions.length ? el('div', { class: 'aic-block' }, [el('h4', { text: 'Got worse' }), ...r.regressions.map(i => el('p', {}, [badge(i.severity, sevCls(i.severity)), document.createTextNode(' '), el('strong', { text: i.title + ': ' }), document.createTextNode(i.detail)]))]) : null,
      listBlock('New risks', r.new_risks), listBlock('Next steps', r.next_steps),
    ]);
  }

  function renderHistory(r) {
    return wrap([
      el('div', { class: 'aic-headline' }, [badge(r.trend, 'trend-' + r.trend), el('span', { text: ' ' + r.headline })]),
      r.observations.length ? el('div', { class: 'aic-block' }, [el('h4', { text: 'What changed' }), ...r.observations.map(i => el('p', {}, [el('strong', { text: i.title + ': ' }), document.createTextNode(i.detail)]))]) : null,
      listBlock('Problems that keep coming back', r.recurring_problems), listBlock('Resolved', r.resolved), listBlock('Recommendations', r.recommendations),
    ]);
  }

  // ---- panes ---------------------------------------------------------------------
  function initPane(id, pane) {
    if (id === 'chat') return initChat(pane);
    if (id === 'summary') return runnerPane(pane, 'summary', 'A plain-language summary of the whole crawl: health, key findings, quick wins and risks.', 'Summarise this website', f => ({ crawl_file: f }), renderSummary);
    if (id === 'prioritize') return runnerPane(pane, 'prioritize', 'Ranks the issues in this crawl by impact, reach and effort, so you know what to fix first.', 'Prioritise issues', f => ({ crawl_file: f }), renderPrioritize);
    if (id === 'plan') {
      const focus = el('input', { type: 'text', class: 'aic-input', maxlength: '200', placeholder: 'Optional focus, e.g. "metadata" or "before the migration"' });
      return runnerPane(pane, 'plan', 'A phased improvement plan, ordered by value for effort.', 'Create action plan', f => ({ crawl_file: f, focus: focus.value.trim() }), renderPlan, [focus]);
    }
    if (id === 'history') return runnerPane(pane, 'history', 'Looks at the saved crawls of this site (up to six, last 30 days) and explains the trend.', 'Analyse history', f => ({ crawl_file: f }), renderHistory);
    if (id === 'compare') {
      const sel = el('select', { class: 'aic-input', 'aria-label': 'Earlier crawl to compare against' });
      const out = runnerPane(pane, 'compare', 'Compare this crawl (the "after") with an earlier saved crawl (the "before").', 'Explain what changed',
        async f => { if (!sel.value) throw { error: { code: 'bad_request', message: 'Choose an earlier crawl first.' } }; return { a_file: sel.value, b_file: f }; },
        renderCompare, [sel]);
      ensureCrawlFile().then(f => api('/crawl/list')).then(d => {
        const current = window._scCrawlFile;
        const list = (d.crawls || []).filter(c => c.file !== current);
        sel.appendChild(el('option', { value: '', text: list.length ? 'Choose an earlier crawl…' : 'No other saved crawls' }));
        list.forEach(c => sel.appendChild(el('option', { value: c.file, text: `${c.name} (${c.pages} pages)` })));
      }).catch(() => sel.appendChild(el('option', { value: '', text: 'Run or load a crawl first' })));
      return out;
    }
  }

  function initChat(pane) {
    const log = el('div', { class: 'aic-log', 'aria-live': 'polite' });
    const input = el('textarea', { class: 'aic-input', rows: '2', maxlength: '2000', placeholder: 'Ask about this crawl, e.g. "What should I fix first?" or paste a page URL' });
    const send = el('button', { type: 'button', class: 'aic-btn aic-primary aic-run', text: 'Send' });
    const fresh = el('button', { type: 'button', class: 'aic-link', text: 'New conversation', onclick: () => { state.convs.chat = null; delete state.pageUrl; clear(log); addMsg('assistant', 'New conversation started. Ask me anything about this crawl.'); } });
    function addMsg(role, text) {
      const m = el('div', { class: 'aic-msg ' + role }, [role === 'assistant' ? mdToNodes(text) : el('p', { text })]);
      log.appendChild(m); log.scrollTop = log.scrollHeight; return m;
    }
    async function submit() {
      const text = input.value.trim();
      if (!text || state.busy) return;
      input.value = '';
      addMsg('user', text);
      const pending = el('div', { class: 'aic-msg assistant aic-muted', text: 'Asking Groq…' });
      log.appendChild(pending); log.scrollTop = log.scrollHeight;
      setBusy(send, true, 'Sending…');
      try {
        const file = await ensureCrawlFile();
        const d = await postJson('/ai/chat', { crawl_file: file, message: text, conversation_id: state.convs.chat || undefined, page_url: state.pageUrl || undefined });
        state.convs.chat = d.conversation_id;
        pending.remove();
        addMsg('assistant', d.reply).appendChild(contextNote(d));
      } catch (e) { pending.remove(); log.appendChild(fmtError(e)); }
      setBusy(send, false);
      input.focus();
    }
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    pane.appendChild(log);
    pane.appendChild(el('div', { class: 'aic-compose' }, [input, el('div', { class: 'aic-actions' }, [fresh, el('span', { class: 'aic-spacer' }), send])]));
    addMsg('assistant', 'Ask me anything about this crawl: what to fix first, why a page has an issue, or how to improve a section.');
    // Resume the latest chat for this crawl.
    ensureCrawlFile().then(file => api(`/ai/conversations?crawl_file=${encodeURIComponent(file)}&kind=chat&limit=1`).then(async list => {
      const c = (list.conversations || [])[0];
      if (!c) return;
      const full = await api('/ai/conversations/' + c.id);
      state.convs.chat = c.id; clear(log);
      (full.messages || []).forEach(m => addMsg(m.role, m.content));
    })).catch(() => {});
    state.focusChat = (url) => { state.pageUrl = url; input.value = `Explain the SEO problems on ${url} and how to fix them.`; input.focus(); };
  }

  // ---- page explanation (dock "AI" tab) ---------------------------------------------
  function aiDockOpen() {
    const pane = $('dock-pane-ai');
    const url = window.dockUrl || (typeof dockUrl !== 'undefined' ? dockUrl : null);
    if (!pane) return;
    if (pane.dataset.url === url && pane.firstChild) return;
    pane.dataset.url = url || '';
    clear(pane);
    if (!url) { pane.appendChild(el('div', { class: 'aic-muted', text: 'Select one page to explain it with AI.' })); return; }
    const out = el('div', { class: 'aic-result' });
    const btn = el('button', { type: 'button', class: 'aic-btn aic-primary aic-run', text: 'Explain this page with AI' });
    btn.addEventListener('click', async () => {
      clear(out); setBusy(btn, true);
      try {
        const file = await ensureCrawlFile();
        const d = await postJson('/ai/page', { crawl_file: file, url });
        clear(out).appendChild(renderPage(d.result)); out.appendChild(contextNote(d));
      } catch (e) { clear(out).appendChild(fmtError(e)); }
      setBusy(btn, false);
    });
    const ask = el('button', { type: 'button', class: 'aic-btn', text: 'Ask the consultant about it', onclick: () => { aiConsultantOpen('chat'); setTimeout(() => state.focusChat && state.focusChat(url), 0); } });
    pane.appendChild(el('div', { class: 'aic-actions' }, [btn, ask]));
    pane.appendChild(out);
  }

  window.aiConsultantOpen = aiConsultantOpen;
  window.aiConsultantClose = aiConsultantClose;
  window.aiDockOpen = aiDockOpen;
})();
