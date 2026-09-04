import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot, Send, X, Sparkles, ExternalLink, Plus, Check, MapPin, Settings
} from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import type { ChatMessage, AiStatus, AiAction, Suggestion } from '../lib/types';
import { Spinner } from './Spinner';
import { AISettingsModal } from './AISettingsModal';

/** True when a message is likely a pasted itinerary / confirmation to show formatted. */
function isLongPaste(t: string): boolean {
  return t.length > 240 && (t.includes('\n') || /\d/.test(t));
}

function SuggestionCard({
  s,
  tripId,
  onAdded,
}: {
  s: Suggestion;
  tripId: string;
  onAdded: (title: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const addPlace = async () => {
    if (adding || added) return;
    setAdding(true);
    try {
      await apiPost(`/trips/${tripId}/places`, {
        name: s.title,
        lat: s.lat ?? undefined,
        lng: s.lng ?? undefined,
        dayId: s.dayId || undefined,
        notes: s.summary || undefined,
        website: s.url || undefined,
        sourceText: [s.title, s.context, s.summary, s.url].filter(Boolean).join('\n\n'),
      });
      setAdded(true);
      onAdded(s.title);
      window.dispatchEvent(new CustomEvent('travelapp:mutated', { detail: { tripId } }));
    } catch {
      /* ignore */
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="ai-sugg">
      {s.thumbnail ? (
        <div className="ai-sugg-thumb" style={{ backgroundImage: `url(${s.thumbnail})` }} />
      ) : (
        <div className="ai-sugg-thumb ai-sugg-thumb-none">
          <MapPin size={16} />
        </div>
      )}
      <div className="ai-sugg-body">
        <div className="ai-sugg-title">{s.title}</div>
        {s.context ? <div className="small muted">{s.context}</div> : null}
        {s.summary ? <div className="ai-sugg-sum">{s.summary}</div> : null}
        <div className="ai-sugg-actions">
          {s.url && (
            <a className="btn sm ghost" href={s.url} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Info
            </a>
          )}
          <button className="btn sm primary" onClick={() => void addPlace()} disabled={adding || added}>
            {added ? <Check size={12} /> : <Plus size={12} />} {added ? 'Added' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AIChat({ tripId }: { tripId: string | null }) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      setActions([]);
    }
  }, [open, tripId, loaded, loadStatus, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, actions]);

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
      window.dispatchEvent(new CustomEvent('travelapp:mutated', { detail: { tripId } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
            <div className="row" style={{ gap: 4 }}>
              {tripId && (
                <button
                  type="button"
                  className="btn sm ghost icon-only"
                  onClick={() => setSettingsOpen(true)}
                  title="Configure AI assistant (model, API key, endpoint)"
                >
                  <Settings size={15} />
                </button>
              )}
              <button
                type="button"
                className="btn sm ghost icon-only"
                onClick={() => setOpen(false)}
                title="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          <div className="ai-chat-sub">
            {!tripId ? (
              <span className="small muted">Open a trip to scope the assistant to it.</span>
            ) : !status?.enabled ? (
              <div className="row between" style={{ width: '100%' }}>
                <span className="small warn">AI is not enabled.</span>
                <button
                  type="button"
                  className="btn sm ghost"
                  style={{ padding: '2px 8px', fontSize: '0.74rem' }}
                  onClick={() => setSettingsOpen(true)}
                >
                  Configure
                </button>
              </div>
            ) : (
              <span className="small muted">Model: {status.model} · {status.baseUrl}</span>
            )}
          </div>

          <div className="ai-messages">
            {messages.length === 0 && !busy && (
              <div className="ai-placeholder">
                <Bot size={28} style={{ color: 'var(--muted)', marginBottom: 8 }} />
                {!status?.enabled ? (
                  <div>
                    <div>Connect your local model (Open WebUI, Ollama) or cloud API (OpenAI, Groq) to get started.</div>
                    <button
                      type="button"
                      className="btn sm primary mt"
                      style={{ marginTop: 10 }}
                      onClick={() => setSettingsOpen(true)}
                    >
                      <Settings size={13} /> Configure AI Assist
                    </button>
                  </div>
                ) : (
                  <div>
                    Ask questions, paste a booking confirmation to import it, try
                    &quot;add a sushi place on day 2&quot; or &quot;what should we do for 2 days in Tokyo?&quot;
                  </div>
                )}
              </div>
            )}
            {messages.map((m) =>
              m.role === 'user' && isLongPaste(m.content) ? (
                <div key={m.id} className="ai-bubble user">
                  <details className="ai-raw">
                    <summary className="small" style={{ color: 'var(--accent)', cursor: 'pointer' }}>
                      Pasted item — view raw text
                    </summary>
                    <pre className="ai-raw-pre">{m.content}</pre>
                  </details>
                </div>
              ) : (
                <div key={m.id} className={`ai-bubble ${m.role}`}>
                  {m.content}
                </div>
              ),
            )}
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
                  {a.ok ? (a.action === 'add_place' ? '➕' : a.action === 'add_booking' ? '🎫' : a.action === 'add_expense' ? '💸' : a.action === 'add_day' ? '📅' : '✨') : '⚠️'} {a.summary.length > 90 ? a.summary.slice(0, 90) + '…' : a.summary}
                </span>
              ))}
            </div>
          )}

          {actions.some((a) => a.suggestions?.length) && (
            <div className="ai-suggs">
              {actions
                .flatMap((a) => a.suggestions ?? [])
                .map((s, i) => (
                  <SuggestionCard
                    key={`${s.title}-${i}`}
                    s={s}
                    tripId={tripId ?? ''}
                    onAdded={() => undefined}
                  />
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

          {settingsOpen && tripId && (
            <AISettingsModal
              tripId={tripId}
              onClose={() => setSettingsOpen(false)}
              onSaved={() => {
                void loadStatus();
              }}
            />
          )}
        </aside>
      )}
    </>
  );
}