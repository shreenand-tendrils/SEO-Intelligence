import { create } from 'zustand';
import { api } from '../services/api';

export const useAiStore = create((set, get) => ({
  status: null, conversations: [], active: null, messages: [], sending: false, error: null,
  async fetchStatus() { try { const r = await api.ai.status(); set({ status: r.data }); } catch (e) { set({ status: { configured: false, error: e.message } }); } },
  async fetchConversations(crawlId) {
    try { const r = await api.ai.conversations({ crawlId }); set({ conversations: r.data }); } catch (e) { set({ error: e.message }); }
  },
  async open(id) {
    const r = await api.ai.conversation(id);
    set({ active: r.data, messages: r.data.messages, error: null });
  },
  newConversation() { set({ active: null, messages: [], error: null }); },
  async send(crawlId, message, url) {
    const conversationId = get().active && get().active.id;
    set({ sending: true, error: null, messages: [...get().messages, { id: `tmp-${Date.now()}`, role: 'user', content: message }] });
    try {
      const r = await api.ai.chat({ crawlId, message, conversationId, url });
      const cid = r.data.conversation_id;
      await get().open(cid);
      get().fetchConversations(crawlId);
    } catch (e) { set({ error: e.message }); }
    set({ sending: false });
  },
  async runAction(kind, body) {
    set({ sending: true, error: null });
    try {
      const r = await api.ai.action(kind, body);
      if (r.data.conversation_id) await get().open(r.data.conversation_id);
      get().fetchConversations(body.crawlId);
      set({ sending: false });
      return r.data;
    } catch (e) { set({ error: e.message, sending: false }); return null; }
  },
  async remove(id, crawlId) {
    await api.ai.deleteConversation(id);
    if (get().active && get().active.id === id) get().newConversation();
    get().fetchConversations(crawlId);
  },
}));
