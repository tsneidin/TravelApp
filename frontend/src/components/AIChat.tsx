import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot, Send, X, Sparkles, ExternalLink, Plus, Check, MapPin, Settings,
  Paperclip, FileText, Mail, File, UploadCloud, Trash2
} from 'lucide-react';
import { apiGet, apiPost, apiDelete, uploadAiDocument } from '../lib/api';
import type { ChatMessage, AiStatus, AiAction, Suggestion, ParsedDocument } from '../lib/types';
import { Spinner } from './Spinner';
import { AISettingsModal } from './AISettingsModal';
import { ConfirmModal } from './Modal';

/** Format byte size to readable B/KB/MB */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Get appropriate file type icon */
function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return <FileText size={14} style={{ color: '#f87171' }} />;
  if (ext === 'eml' || ext === 'msg') return <Mail size={14} style={{ color: '#60a5fa' }} />;
  return <File size={14} style={{ color: 'var(--accent)' }} />;
}

/** True when a message is likely a pasted itinerary / confirmation to show formatted. */
function isLongPaste(t: string): boolean {
  return t.length > 240 && (t.includes('\n') || /\d/.test(t));
}

/** Renders message content, parsing out attached file badges and collapsible details */
function MessageBody({ content }: { content: string }) {
  // Check for <details><summary>...</summary>...</details>
  const detailsRegex = /<details><summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/;
  const match = detailsRegex.exec(content);

  if (match) {
    const beforeText = content.slice(0, match.index).trim();
    const summaryText = match[1].trim();
    const detailsBody = match[2].trim();

    return (
      <div>
        <FormattedText text={beforeText} />
        <details className="ai-raw" style={{ marginTop: 8 }}>
          <summary className="small" style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>
            {summaryText}
          </summary>
          <pre className="ai-raw-pre">{detailsBody}</pre>
        </details>
      </div>
    );
  }

  if (isLongPaste(content)) {
    return (
      <details className="ai-raw">
        <summary className="small" style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>
          Pasted item — view raw text
        </summary>
        <pre className="ai-raw-pre">{content}</pre>
      </details>
    );
  }

  return <FormattedText text={content} />;
}

/** Parse lines starting with "📎 **[TYPE] filename**" into badges */
function FormattedText({ text }: { text: string }) {
  const lines = text.split('\n');
  const badges: Array<{ type: string; name: string }> = [];
  const normalLines: string[] = [];

  for (const line of lines) {
    const m = line.match(/^📎 \*\*\[([A-Z]+)\] (.*?)\*\*$/);
    if (m) {
      badges.push({ type: m[1], name: m[2] });
    } else {
      normalLines.push(line);
    }
  }

  const remaining = normalLines.join('\n').trim();

  return (
    <>
      {badges.length > 0 && (
        <div className="ai-bubble-attachments-list">
          {badges.map((b, idx) => (
            <div key={`${b.name}-${idx}`} className="ai-bubble-attachment">
              {getFileIcon(b.name)}
              <span>{b.name}</span>
            </div>
          ))}
        </div>
      )}
      {remaining && <div style={{ whiteSpace: 'pre-wrap' }}>{remaining}</div>}
    </>
  );
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
        description: s.summary || undefined,
        website: s.url || undefined,
        sourceText: [s.title, s.context, s.summary, s.url, s.mapUrl].filter(Boolean).join('\n\n'),
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
          {s.mapUrl && (
            <a className="btn sm ghost" href={s.mapUrl} target="_blank" rel="noreferrer">
              <MapPin size={12} /> Map
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
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; id: string }>>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [actions, setActions] = useState<AiAction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [suggestionLimit, setSuggestionLimit] = useState(4);
  const [focusedDay, setFocusedDay] = useState<{ dayId: string | null; dayIndex?: number; label?: string; date?: string } | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    const handleDayFocused = (e: Event) => {
      const customEvent = e as CustomEvent<{ dayId: string | null; dayIndex?: number; label?: string; date?: string; mode?: string }>;
      if (customEvent.detail) {
        setFocusedDay(customEvent.detail.dayId ? customEvent.detail : null);
      }
    };
    window.addEventListener('travelapp:day_focused', handleDayFocused);
    return () => window.removeEventListener('travelapp:day_focused', handleDayFocused);
  }, []);

  useEffect(() => {
    const handleToggle = () => setOpen((prev) => !prev);
    const handleOpen = () => setOpen(true);
    window.addEventListener('travelapp:toggle_ai_chat', handleToggle);
    window.addEventListener('travelapp:open_ai_chat', handleOpen);
    return () => {
      window.removeEventListener('travelapp:toggle_ai_chat', handleToggle);
      window.removeEventListener('travelapp:open_ai_chat', handleOpen);
    };
  }, []);

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
      setPendingFiles([]);
    }
  }, [open, tripId, loaded, loadStatus, loadMessages]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !fabRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, actions, pendingFiles]);

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    const valid = files.filter((f) => f.size <= 15 * 1024 * 1024);
    if (valid.length < files.length) {
      setError('Some files exceeded the 15MB size limit and were skipped.');
    }
    setPendingFiles((prev) => [
      ...prev,
      ...valid.map((f) => ({ file: f, id: `${f.name}-${Date.now()}-${Math.random()}` })),
    ]);
  };

  const removeFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((item) => item.id !== id));
  };

  // Drag-and-drop events
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      setIsDragging(false);
      dragCounter.current = 0;
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      addFiles(Array.from(e.clipboardData.files));
    }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || !tripId || busy || uploadingFiles) return;

    setBusy(true);
    setError('');
    setActions([]);
    setSuggestionLimit(4);

    const filesToUpload = [...pendingFiles];
    setPendingFiles([]);
    setInput('');

    // 1. Process and extract text from attached files
    const parsedDocs: ParsedDocument[] = [];
    if (filesToUpload.length > 0) {
      setUploadingFiles(true);
      try {
        for (const item of filesToUpload) {
          const res = await uploadAiDocument(tripId, item.file);
          if (res.ok && res.document) {
            parsedDocs.push(res.document);
          }
        }
      } catch (err) {
        setError(`Failed to extract document text: ${(err as Error).message}`);
        setUploadingFiles(false);
        setBusy(false);
        // restore files on error
        setPendingFiles(filesToUpload);
        return;
      } finally {
        setUploadingFiles(false);
      }
    }

    // 2. Format optimistic display for chat UI
    let optimisticContent = text;
    if (parsedDocs.length > 0) {
      const badges = parsedDocs
        .map((d) => `📎 **[${(d.fileType || 'FILE').toUpperCase()}] ${d.filename}**`)
        .join('  \n');
      const rawCollapsible = parsedDocs
        .map(
          (d) =>
            `\n\n<details><summary>View extracted text: ${d.filename}</summary>\n\n${d.text.trim()}\n</details>`,
        )
        .join('\n');
      optimisticContent = `${badges}\n\n${text || 'Please analyze this attached travel document and extract any reservations, bookings, flights, hotels, or activities to add to our trip.'}${rawCollapsible}`;
    }

    const optimistic: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: optimisticContent,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);

    // 3. Send message + parsed attachments + focused day to AI chat endpoint
    try {
      const r = await apiPost<{ reply: string; actions: AiAction[] }>(`/trips/${tripId}/ai/chat`, {
        message: text,
        attachments: parsedDocs,
        focusedDayId: focusedDay?.dayId || undefined,
      });
      setActions(r.actions ?? []);
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: 'assistant', content: r.reply, createdAt: new Date().toISOString() },
      ]);

      // If AI executed a focus_day tool call, sync to UI
      for (const act of r.actions || []) {
        if (act.action === 'focus_day' && (act as any).data) {
          window.dispatchEvent(new CustomEvent('travelapp:set_focus_day', { detail: (act as any).data }));
        }
      }

      window.dispatchEvent(new CustomEvent('travelapp:mutated', { detail: { tripId } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clearChatHistory = () => {
    if (!tripId || (messages.length === 0 && actions.length === 0)) return;
    setClearHistoryConfirmOpen(true);
  };

  const doClearChatHistory = async () => {
    if (!tripId) return;
    try {
      await apiDelete(`/trips/${tripId}/ai/messages`);
      setMessages([]);
      setActions([]);
      setError('');
      setClearHistoryConfirmOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <button ref={fabRef} className="ai-fab" title="AI assistant" onClick={() => setOpen((o) => !o)}>
        {open ? <X size={20} /> : <Bot size={20} />}
      </button>

      {open && (
        <>
          <div className="ai-chat-mobile-backdrop" onClick={() => setOpen(false)} />
          <aside
            ref={panelRef}
            className="ai-chat"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="ai-chat-mobile-handle" />
            {isDragging && (
              <div className="ai-dropzone-overlay">
                <UploadCloud size={44} className="ai-dropzone-icon" />
                <div className="ai-dropzone-title">Drop travel documents here</div>
                <div className="small muted">PDFs, booking emails (.eml), itineraries, tickets</div>
              </div>
            )}

            <div className="ai-chat-head">
              <span className="row" style={{ gap: 8 }}>
              <Sparkles size={15} style={{ color: 'var(--accent)' }} />
              AI Assistant
            </span>
            <div className="row" style={{ gap: 4 }}>
              {tripId && (
                <>
                  <button
                    type="button"
                    className="btn sm ghost icon-only"
                    onClick={clearChatHistory}
                    disabled={messages.length === 0 && actions.length === 0}
                    title="Clear chat history & start fresh"
                  >
                    <Trash2 size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost icon-only"
                    onClick={() => setSettingsOpen(true)}
                    title="Configure AI assistant (model, API key, endpoint)"
                  >
                    <Settings size={15} />
                  </button>
                </>
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
            {messages.length === 0 && !busy && !uploadingFiles && (
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
                    Drop or attach <strong>PDF reservation tickets</strong> or <strong>booking emails (.eml)</strong> here!
                    You can also ask questions like &quot;what should we do for 2 days in Tokyo?&quot;
                  </div>
                )}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`ai-bubble ${m.role}`}>
                <MessageBody content={m.content} />
              </div>
            ))}
            {(busy || uploadingFiles) && (
              <div className="ai-bubble assistant ai-typing">
                <Spinner label={uploadingFiles ? 'Extracting document text…' : 'Thinking…'} />
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {actions.filter((a) => a.action !== 'get_suggestions').length > 0 && (
            <div className="ai-actions">
              {actions
                .filter((a) => a.action !== 'get_suggestions')
                .map((a, i) => {
                  const isDelete = a.action.startsWith('delete_');
                  const isUpdate = a.action.startsWith('update_');
                  const icon = !a.ok
                    ? '⚠️'
                    : isDelete
                    ? '🗑️'
                    : isUpdate
                    ? '✏️'
                    : a.action.includes('place')
                    ? '📍'
                    : a.action.includes('booking')
                    ? '🎫'
                    : a.action.includes('expense')
                    ? '💸'
                    : a.action.includes('day')
                    ? '📅'
                    : a.action.includes('packing')
                    ? '🎒'
                    : a.action.includes('journal')
                    ? '📖'
                    : a.action.includes('trip')
                    ? '🗺️'
                    : '✨';
                  return (
                    <span key={i} className={`badge ${a.ok ? 'success' : 'warn'}`} title={a.summary}>
                      {icon} {a.summary.length > 95 ? a.summary.slice(0, 95) + '…' : a.summary}
                    </span>
                  );
                })}
            </div>
          )}

          {actions.some((a) => a.suggestions?.length) && (
            <div className="ai-suggs">
              {actions
                .flatMap((a) => a.suggestions ?? [])
                .slice(0, suggestionLimit)
                .map((s, i) => (
                  <SuggestionCard
                    key={`${s.title}-${i}`}
                    s={s}
                    tripId={tripId ?? ''}
                    onAdded={() => undefined}
                  />
                ))}
              {actions.flatMap((a) => a.suggestions ?? []).length > suggestionLimit && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setSuggestionLimit((n) => n + 4)}
                >
                  More options
                </button>
              )}
            </div>
          )}

          {error && <div className="ai-error">{error}</div>}

          {pendingFiles.length > 0 && (
            <div className="ai-attached-files">
              {pendingFiles.map((item) => (
                <div key={item.id} className="ai-file-chip">
                  {getFileIcon(item.file.name)}
                  <span className="ai-file-chip-name" title={item.file.name}>
                    {item.file.name}
                  </span>
                  <span className="ai-file-chip-size">{formatFileSize(item.file.size)}</span>
                  <button
                    type="button"
                    className="ai-file-chip-del"
                    onClick={() => removeFile(item.id)}
                    title="Remove file"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {focusedDay && focusedDay.dayId && (
            <div style={{ padding: '0 12px 6px 12px' }}>
              <div className="ai-focused-day-pill" style={{ margin: 0 }}>
                <span>
                  🎯 Focusing: {focusedDay.dayId === 'unassigned' ? 'Unassigned Places' : `Day ${focusedDay.dayIndex ?? ''}${focusedDay.label ? ` (${focusedDay.label})` : ''}`}
                </span>
                <button
                  type="button"
                  className="btn xs ghost"
                  style={{ padding: '0 4px', color: '#94a3b8', marginLeft: 4 }}
                  onClick={() => window.dispatchEvent(new CustomEvent('travelapp:set_focus_day', { detail: { mode: 'all', dayId: null } }))}
                  title="Clear day focus"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          <div className="ai-input-row">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.eml,.msg,.txt,.html,.htm,.ics"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <button
              type="button"
              className="btn ghost icon-only ai-attach-btn"
              title="Attach PDF, email (.eml), or document"
              disabled={!tripId || busy || uploadingFiles}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={16} />
            </button>
            <textarea
              rows={2}
              placeholder={
                pendingFiles.length > 0
                  ? 'Add instructions (optional) and send…'
                  : tripId
                  ? 'Ask, paste text, or drop PDFs / emails…'
                  : 'Open a trip to chat'
              }
              value={input}
              disabled={!tripId || busy || uploadingFiles}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="btn primary"
              onClick={() => void send()}
              disabled={(!input.trim() && pendingFiles.length === 0) || !tripId || busy || uploadingFiles}
            >
              {uploadingFiles ? <Spinner /> : <Send size={15} />}
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

          {clearHistoryConfirmOpen && (
            <ConfirmModal
              title="Clear conversation"
              message="Clear AI conversation history for this trip?"
              confirmLabel="Clear"
              danger
              onConfirm={() => void doClearChatHistory()}
              onCancel={() => setClearHistoryConfirmOpen(false)}
            />
          )}
        </aside>
      </>
    )}
  </>
);
}
