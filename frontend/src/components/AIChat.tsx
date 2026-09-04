import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Send, X, Sparkles } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import type { ChatMessage, AiStatus, AiAction } from '../lib/types';
import { Spinner } from './Spinner';

export function AIChat({ tripId }: { tripId: string | null }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState<AiAction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async () => {
    if (!tripId) return;
    try {
      const s = await apiGet<AiStatus>(`/trips/${tripId}/ai/status`);
      setStatus(s);
    } catch {
      setStatus(null);
    }
  }, [tripId]);

  const loadMessages = useCallback(async () => {
    if (!tripId) return;
    try {
      const r = await apiGet<{ messages: ChatMessage[] }>(`/trips/${tripId}/ai/messages`);
      setMessages(r.messages);
    } catch {
      setMessages([]);
    } finally {
      setLoaded(true);
    }
  }, [tripId]);

  useEffect(() => {
    if (open && tripId && !loaded) {
      void loadStatus();
      void loadMessages();
    }
    if (!tripId) {
      setMessages([]);
      setStatus(null);
      setLoaded(false);
    }
  }, [open, tripId, loaded, loadStatus, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || !tripId || busy) return;
    setBusy(true);
    setError('');
    setActions([]);
    const optimistic: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setInput('');
    try {
      const r = await apiPost<{ reply: string; actions: AiAction[] }>(`/trips/${tripId}/ai/chat`, { message: text });
      setActions(r.actions ?? []);
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: 'assistant', content: r.reply, createdAt: new Date().toISOString() }]);
      // Broadcast so the page (itinerary/budget/bookings) refreshes with AI changes.
      window.dispatchEvent(new CustomEvent('travelapp:mutated', { detail: { tripId } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const actionLabel = (a: AiAction) =>
    a.ok ? (a.action === 'add_place' ? '➕ Itinerary' : a.action === 'add_booking' ? '🎫 Booking' : a.action === 'add_expense' ? '💸 Expense' : '📅 Day') : '⚠️';

  return (
    <>
      <button className="ai-fab" title="AI assistant" onClick={() => setOpen((o) => !o)}>
        {open ? <X size={20} /> : <Bot size={20} />}
      </button>

      {open && (
        <aside className="ai-chat">
          <div className="ai-chat-head">
            <span className="row" style={{ gap: 8 }}>
              <Sparkles size={15} style={{ color: 'var(--accent)' }} />
              AI Assistant
            </span>
            <button className="btn sm ghost icon-only" onClick={() => setOpen(false)} title="Close"><X size={15} /></button>
          </div>

          <div className="ai-chat-sub">
            {!tripId ? (
              <span className="small muted">Open a trip to scope the assistant to it.</span>
            ) : !status?.enabled ? (
              <span className="small warn">
                AI is not configured. Set AI_ENABLED=true, AI_BASE_URL, AI_MODEL in the server .env.
              </span>
            ) : (
              <span className="small muted">Model: {status.model} · {status.baseUrl}</span>
            )}
          </div>

          <div className="ai-messages">
            {messages.length === 0 && !busy && (
              <div className="ai-placeholder">
                <Bot size={28} style={{ color: 'var(--muted)', marginBottom: 8 }} />
                <div>
                  Ask questions, paste a booking confirmation to import it, try
                  "add a sushi place on day 2" or "what should we do for 2 days in Tokyo?"
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`ai-bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="ai-bubble assistant ai-typing">
                <Spinner label="Thinking…" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {actions.length > 0 && (
            <div className="ai-actions">
              {actions.map((a, i) => (
                <span key={i} className="badge" title={a.summary}>
                  {actionLabel(a)} {a.summary.length > 60 ? a.summary.slice(0, 60) + '…' : a.summary}
                </span>
              ))}
            </div>
          )}
          {error && <div className="ai-error">{error}</div>}

          <div className="ai-input-row">
            <textarea
              rows={2}
              placeholder={tripId ? 'Ask or paste a confirmation email…' : 'Open a trip to chat'}
              value={input}
              disabled={!tripId || busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn primary" onClick={() => void send()} disabled={!input.trim() || !tripId || busy}>
              <Send size={15} />
            </button>
          </div>
        </aside>
      )}
    </>
  );
}