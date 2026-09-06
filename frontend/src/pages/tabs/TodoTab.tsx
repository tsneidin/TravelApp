import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckSquare,
  Clock,
  Compass,
  FileText,
  Pencil,
  PlaneLanding,
  PlaneTakeoff,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { apiDelete, apiPatch, apiPost } from '../../lib/api';
import type { TodoItem, Trip } from '../../lib/types';
import { Modal } from '../../components/Modal';

interface TodoEdit {
  id: string;
  title: string;
  category: string;
  dueDate: string;
  notes: string;
}

export const TRIP_PHASES = ['Pre-Trip', 'During Trip', 'Post-Trip'] as const;
export type TripPhase = (typeof TRIP_PHASES)[number];

const DEFAULT_TEMPLATES: { title: string; category: TripPhase }[] = [
  // Pre-Trip
  { title: 'Check passport expiration & travel validity', category: 'Pre-Trip' },
  { title: 'Place USPS mail hold', category: 'Pre-Trip' },
  { title: 'Refill prescription medications', category: 'Pre-Trip' },
  { title: 'Notify bank & credit cards of travel dates', category: 'Pre-Trip' },
  { title: 'Set up international roaming or eSIM', category: 'Pre-Trip' },
  { title: 'Download offline Google maps & entertainment', category: 'Pre-Trip' },
  { title: 'Arrange pet sitting / house plants care', category: 'Pre-Trip' },
  { title: 'Print or save offline boarding passes & vouchers', category: 'Pre-Trip' },

  // During Trip
  { title: 'Pick up pocket Wi-Fi / transit pass at airport', category: 'During Trip' },
  { title: 'Keep receipts for duty-free & tax refunds', category: 'During Trip' },
  { title: 'Confirm activity & dining reservations for tomorrow', category: 'During Trip' },
  { title: 'Buy regional gifts & souvenirs', category: 'During Trip' },
  { title: 'Recharge camera batteries & power banks nightly', category: 'During Trip' },

  // Post-Trip
  { title: 'Submit travel expense reports & insurance claims', category: 'Post-Trip' },
  { title: 'Resume USPS mail delivery', category: 'Post-Trip' },
  { title: 'Review credit card statements for foreign transaction fees', category: 'Post-Trip' },
  { title: 'Organize, tag, and backup trip photos', category: 'Post-Trip' },
  { title: 'Unpack luggage and wash travel gear', category: 'Post-Trip' },
];

export function getPhaseIcon(category?: string | null) {
  const norm = (category || '').trim().toLowerCase();
  if (norm.includes('post') || norm.includes('after') || norm.includes('return') || norm.includes('unpack')) {
    return <PlaneLanding size={15} style={{ color: '#ec4899' }} />;
  }
  if (norm.includes('during') || norm.includes('in-trip') || norm.includes('transit') || norm.includes('on the road')) {
    return <Compass size={15} style={{ color: '#38bdf8' }} />;
  }
  return <PlaneTakeoff size={15} style={{ color: '#f59e0b' }} />;
}

export function normalizePhase(category?: string | null): TripPhase | string {
  if (!category) return 'Pre-Trip';
  const trimmed = category.trim();
  const lower = trimmed.toLowerCase();
  if (lower.includes('post') || lower.includes('after') || lower.includes('return') || lower.includes('unpack')) {
    return 'Post-Trip';
  }
  if (lower.includes('during') || lower.includes('in-trip') || lower.includes('transit') || lower.includes('on the road')) {
    return 'During Trip';
  }
  if (
    lower.includes('pre') ||
    lower.includes('before') ||
    lower.includes('prep') ||
    lower.includes('home') ||
    lower.includes('mail') ||
    lower.includes('health') ||
    lower.includes('doc') ||
    lower.includes('finance') ||
    lower.includes('pack')
  ) {
    return 'Pre-Trip';
  }
  return trimmed;
}

function formatDueDate(dateStr?: string | null): { text: string; isOverdue: boolean; isToday: boolean; isSoon: boolean } | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());

  const diffDays = Math.round((targetDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const text = targetDay.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: targetDay.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });

  if (diffDays < 0) {
    return { text: `Overdue · ${text}`, isOverdue: true, isToday: false, isSoon: false };
  }
  if (diffDays === 0) {
    return { text: 'Due Today', isOverdue: false, isToday: true, isSoon: true };
  }
  if (diffDays === 1) {
    return { text: 'Due Tomorrow', isOverdue: false, isToday: false, isSoon: true };
  }
  if (diffDays <= 3) {
    return { text: `Due in ${diffDays} days (${text})`, isOverdue: false, isToday: false, isSoon: true };
  }
  return { text: `Due ${text}`, isOverdue: false, isToday: false, isSoon: false };
}

export function TodoTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const todos = useMemo(() => trip.todos ?? [], [trip.todos]);
  const [phaseFilter, setPhaseFilter] = useState<'all' | TripPhase>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [newTitle, setNewTitle] = useState('');
  const [newCat, setNewCat] = useState<string>('Pre-Trip');
  const [newDueDate, setNewDueDate] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [showNotesField, setShowNotesField] = useState(false);
  const [editing, setEditing] = useState<TodoEdit | null>(null);
  const [saving, setSaving] = useState(false);

  // Available categories list
  const categories = useMemo(() => {
    const custom = todos.map((t) => t.category).filter(Boolean) as string[];
    return Array.from(new Set([...TRIP_PHASES, ...custom]));
  }, [todos]);

  // Counts by phase
  const preCount = useMemo(() => todos.filter((t) => normalizePhase(t.category) === 'Pre-Trip').length, [todos]);
  const duringCount = useMemo(() => todos.filter((t) => normalizePhase(t.category) === 'During Trip').length, [todos]);
  const postCount = useMemo(() => todos.filter((t) => normalizePhase(t.category) === 'Post-Trip').length, [todos]);

  // Sync category default when phase filter changes
  const handleSelectPhaseFilter = (phase: 'all' | TripPhase) => {
    setPhaseFilter(phase);
    if (phase !== 'all') {
      setNewCat(phase);
    }
  };

  const add = async (customTitle?: string, customCat?: string) => {
    const titleToAdd = (customTitle ?? newTitle).trim();
    if (!titleToAdd) return;

    await apiPost(`/trips/${trip.id}/todos`, {
      title: titleToAdd,
      category: customCat ?? newCat,
      dueDate: newDueDate || undefined,
      notes: newNotes.trim() || undefined,
    });

    setNewTitle('');
    setNewDueDate('');
    setNewNotes('');
    setShowNotesField(false);
    await reload();
  };

  const toggle = async (id: string, done: boolean) => {
    await apiPatch(`/trips/${trip.id}/todos/${id}`, { done });
    await reload();
  };

  const remove = async (id: string) => {
    await apiDelete(`/trips/${trip.id}/todos/${id}`);
    await reload();
  };

  const openEdit = (todo: TodoItem) => {
    setEditing({
      id: todo.id,
      title: todo.title,
      category: todo.category || 'Pre-Trip',
      dueDate: todo.dueDate ? todo.dueDate.split('T')[0] : '',
      notes: todo.notes || '',
    });
  };

  const saveEdit = async () => {
    if (!editing?.title.trim()) return;
    setSaving(true);
    try {
      await apiPatch(`/trips/${trip.id}/todos/${editing.id}`, {
        title: editing.title.trim(),
        category: editing.category || 'Pre-Trip',
        dueDate: editing.dueDate || null,
        notes: editing.notes.trim() || null,
      });
      setEditing(null);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const doneCount = todos.filter((t) => t.done).length;
  const pendingCount = todos.length - doneCount;
  const pct = todos.length ? Math.round((doneCount / todos.length) * 100) : 0;

  const overdueCount = useMemo(() => {
    return todos.filter((t) => {
      if (t.done || !t.dueDate) return false;
      const d = formatDueDate(t.dueDate);
      return d?.isOverdue;
    }).length;
  }, [todos]);

  // Filtered by phase + status
  const filteredTodos = useMemo(() => {
    return todos.filter((t) => {
      if (phaseFilter !== 'all') {
        const phase = normalizePhase(t.category);
        if (phase !== phaseFilter) return false;
      }
      if (statusFilter === 'pending' && t.done) return false;
      if (statusFilter === 'completed' && !t.done) return false;
      return true;
    });
  }, [todos, phaseFilter, statusFilter]);

  // Group items by category / phase
  const groupedSections = useMemo(() => {
    const map = new Map<string, TodoItem[]>();

    // If specific phase filter is active, initialize only that phase
    if (phaseFilter !== 'all') {
      map.set(phaseFilter, []);
    } else {
      map.set('Pre-Trip', []);
      map.set('During Trip', []);
      map.set('Post-Trip', []);
    }

    for (const item of filteredTodos) {
      const phase = normalizePhase(item.category);
      if (!map.has(phase)) map.set(phase, []);
      map.get(phase)!.push(item);
    }

    // Filter out empty placeholder sections if no items and searching/filtering
    const entries: [string, TodoItem[]][] = [];
    for (const [key, items] of map.entries()) {
      if (items.length > 0 || phaseFilter === key || (phaseFilter === 'all' && statusFilter === 'all')) {
        entries.push([key, items]);
      }
    }

    // Sort sections: Pre-Trip -> During Trip -> Post-Trip -> Others
    const phaseOrder = ['Pre-Trip', 'During Trip', 'Post-Trip'];
    entries.sort(([a], [b]) => {
      const idxA = phaseOrder.indexOf(a);
      const idxB = phaseOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    return entries;
  }, [filteredTodos, phaseFilter, statusFilter]);

  const existingTitles = useMemo(() => new Set(todos.map((t) => t.title.toLowerCase().trim())), [todos]);
  const availableTemplates = useMemo(
    () => DEFAULT_TEMPLATES.filter((tpl) => !existingTitles.has(tpl.title.toLowerCase())),
    [existingTitles],
  );

  return (
    <div>
      {/* KPI Progress Cards */}
      <div className="kpis">
        <div className="kpi">
          <div className="k-label">To-Do progress</div>
          <div className="k-value" style={{ color: pct === 100 && todos.length > 0 ? 'var(--success, #10b981)' : 'var(--accent)' }}>
            {pct}%
          </div>
          <div className="k-sub">{doneCount} of {todos.length} tasks completed</div>
        </div>
        <div className="kpi">
          <div className="k-label">Pending tasks</div>
          <div className="k-value">{pendingCount}</div>
          <div className="k-sub">{pendingCount === 0 && todos.length > 0 ? 'All caught up! 🎉' : 'Tasks remaining'}</div>
        </div>
        {overdueCount > 0 && (
          <div className="kpi" style={{ borderColor: 'rgba(239, 68, 68, 0.4)' }}>
            <div className="k-label" style={{ color: 'var(--danger, #ef4444)' }}>Overdue tasks</div>
            <div className="k-value" style={{ color: 'var(--danger, #ef4444)' }}>{overdueCount}</div>
            <div className="k-sub" style={{ color: 'var(--danger, #ef4444)' }}>Needs attention</div>
          </div>
        )}
      </div>

      {/* 1-Click Starter Suggestions */}
      {availableTemplates.length > 0 && (
        <div
          className="panel mb"
          style={{
            padding: '12px 14px',
            background: 'rgba(34, 211, 238, 0.04)',
            borderColor: 'rgba(34, 211, 238, 0.2)',
          }}
        >
          <div className="row between mb" style={{ marginBottom: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <Sparkles size={14} style={{ color: 'var(--accent)' }} />
              <span className="small font-semibold" style={{ color: 'var(--text)' }}>
                Suggested Travel Tasks (Pre-Trip, During Trip & Post-Trip):
              </span>
            </div>
            <span className="small muted">Click to add to your checklist</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {availableTemplates.map((tpl) => (
              <button
                key={tpl.title}
                type="button"
                className="btn sm ghost"
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                  borderRadius: 20,
                  padding: '4px 10px',
                  fontSize: '0.78rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
                onClick={() => void add(tpl.title, tpl.category)}
              >
                {getPhaseIcon(tpl.category)}
                <span>+ {tpl.title}</span>
                <span
                  style={{
                    fontSize: '0.68rem',
                    padding: '1px 5px',
                    borderRadius: 4,
                    background: 'var(--panel-2)',
                    color: 'var(--muted)',
                  }}
                >
                  {tpl.category}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Task Management Panel */}
      <div className="panel">
        <div className="row between mb" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="panel-title" style={{ margin: 0 }}>Trip Tasks & To-Do's</h2>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              Categorized by Pre-Trip preparation, During Trip tasks, and Post-Trip follow-ups.
            </p>
          </div>

          {/* Dual Phase & Status Filter Tabs */}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {/* Phase Filters */}
            <div
              className="segmented-btn-group"
              style={{ display: 'inline-flex', background: 'var(--panel-2)', borderRadius: 7, padding: 2 }}
            >
              <button
                type="button"
                className={`btn sm ${phaseFilter === 'all' ? 'primary' : 'ghost'}`}
                style={{ padding: '3px 10px', fontSize: '0.78rem' }}
                onClick={() => handleSelectPhaseFilter('all')}
              >
                All ({todos.length})
              </button>
              <button
                type="button"
                className={`btn sm ${phaseFilter === 'Pre-Trip' ? 'primary' : 'ghost'}`}
                style={{ padding: '3px 10px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => handleSelectPhaseFilter('Pre-Trip')}
              >
                <PlaneTakeoff size={12} /> Pre-Trip ({preCount})
              </button>
              <button
                type="button"
                className={`btn sm ${phaseFilter === 'During Trip' ? 'primary' : 'ghost'}`}
                style={{ padding: '3px 10px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => handleSelectPhaseFilter('During Trip')}
              >
                <Compass size={12} /> During Trip ({duringCount})
              </button>
              <button
                type="button"
                className={`btn sm ${phaseFilter === 'Post-Trip' ? 'primary' : 'ghost'}`}
                style={{ padding: '3px 10px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => handleSelectPhaseFilter('Post-Trip')}
              >
                <PlaneLanding size={12} /> Post-Trip ({postCount})
              </button>
            </div>

            {/* Status Filter */}
            <div
              className="segmented-btn-group"
              style={{ display: 'inline-flex', background: 'var(--panel-2)', borderRadius: 7, padding: 2 }}
            >
              <button
                type="button"
                className={`btn sm ${statusFilter === 'all' ? 'primary' : 'ghost'}`}
                style={{ padding: '3px 8px', fontSize: '0.78rem' }}
                onClick={() => setStatusFilter('all')}
              >
                All Status
              </button>
              <button
                type="button"
                className={`btn sm ${statusFilter === 'pending' ? 'primary' : 'ghost'}`}
                style={{ padding: '3px 8px', fontSize: '0.78rem' }}
                onClick={() => setStatusFilter('pending')}
              >
                Pending ({pendingCount})
              </button>
              <button
                type="button"
                className={`btn sm ${statusFilter === 'completed' ? 'primary' : 'ghost'}`}
                style={{ padding: '3px 8px', fontSize: '0.78rem' }}
                onClick={() => setStatusFilter('completed')}
              >
                Done ({doneCount})
              </button>
            </div>
          </div>
        </div>

        {/* Add Task Form */}
        <div style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="grow" style={{ minWidth: 220 }}>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={
                  newCat === 'Post-Trip'
                    ? 'e.g. Submit expense reports, resume mail delivery...'
                    : newCat === 'During Trip'
                    ? 'e.g. Pick up transit pass, keep receipts for tax refunds...'
                    : 'e.g. Place USPS mail hold, refill prescriptions...'
                }
                onKeyDown={(e) => e.key === 'Enter' && void add()}
                style={{ width: '100%' }}
              />
            </div>
            <select
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              style={{ width: 'auto', minWidth: 140, fontWeight: 500 }}
            >
              <option value="Pre-Trip">🛫 Pre-Trip</option>
              <option value="During Trip">🧭 During Trip</option>
              <option value="Post-Trip">🛬 Post-Trip</option>
              {categories
                .filter((c) => !TRIP_PHASES.includes(c as TripPhase))
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                title="Optional due date"
                style={{ width: 'auto', padding: '6px 8px' }}
              />
            </div>
            <button
              type="button"
              className={`btn sm ${showNotesField ? 'primary' : 'ghost'}`}
              title="Add notes"
              onClick={() => setShowNotesField(!showNotesField)}
            >
              <FileText size={14} /> Notes
            </button>
            <button className="btn primary" onClick={() => void add()} disabled={!newTitle.trim()}>
              <Plus size={14} /> Add Task
            </button>
          </div>

          {showNotesField && (
            <div className="mt" style={{ marginTop: 8 }}>
              <input
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Optional details, confirmation numbers, pharmacy hours, links..."
                onKeyDown={(e) => e.key === 'Enter' && void add()}
                style={{ width: '100%', fontSize: '0.85rem' }}
              />
            </div>
          )}
        </div>

        {/* Task Item List Categorized by Phase */}
        {todos.length === 0 ? (
          <div className="empty-state">
            <CheckSquare size={36} className="muted" style={{ margin: '0 auto 10px', opacity: 0.5 }} />
            <div className="big">No to-do items yet</div>
            <p>Keep track of tasks across Pre-Trip, During Trip, and Post-Trip phases.</p>
          </div>
        ) : filteredTodos.length === 0 ? (
          <div className="empty-state">
            <p className="muted">
              No tasks matching {phaseFilter !== 'all' ? `"${phaseFilter}"` : ''}{' '}
              {statusFilter !== 'all' ? `(${statusFilter})` : ''}.
            </p>
          </div>
        ) : (
          groupedSections.map(([cat, items]) => {
            const catDoneCount = items.filter((t) => t.done).length;
            const catTotal = items.length;

            return (
              <div key={cat} className="mb" style={{ marginBottom: 20 }}>
                <div
                  className="small"
                  style={{
                    fontWeight: 700,
                    margin: '14px 0 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: 4,
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text)' }}>
                    {getPhaseIcon(cat)}
                    <span style={{ fontSize: '0.92rem', letterSpacing: '0.02em' }}>{cat}</span>
                    <span className="badge" style={{ fontSize: '0.72rem', padding: '1px 7px' }}>
                      {catTotal} {catTotal === 1 ? 'task' : 'tasks'}
                    </span>
                  </div>

                  {catTotal > 0 && (
                    <span className="small muted" style={{ fontSize: '0.75rem' }}>
                      {catDoneCount} of {catTotal} completed
                    </span>
                  )}
                </div>

                {items.length === 0 ? (
                  <div className="small muted" style={{ padding: '8px 12px', fontStyle: 'italic' }}>
                    No {cat.toLowerCase()} tasks yet.{' '}
                    <button
                      type="button"
                      className="btn xs link"
                      onClick={() => {
                        setNewCat(cat);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      + Add a {cat} task
                    </button>
                  </div>
                ) : (
                  items.map((item) => {
                    const due = formatDueDate(item.dueDate);
                    return (
                      <div
                        className={`list-row ${item.done ? 'opacity-70' : ''}`}
                        key={item.id}
                        style={{
                          alignItems: 'flex-start',
                          padding: '10px 12px',
                          background: item.done ? 'var(--panel-2)' : 'var(--panel)',
                          borderRadius: 8,
                          marginBottom: 6,
                          border: '1px solid var(--line)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={item.done}
                          onChange={(e) => void toggle(item.id, e.target.checked)}
                          style={{
                            width: 18,
                            height: 18,
                            marginTop: 2,
                            accentColor: 'var(--accent)',
                            cursor: 'pointer',
                          }}
                        />

                        <div className="grow" style={{ minWidth: 0, paddingLeft: 4 }}>
                          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span
                              style={{
                                fontWeight: item.done ? 400 : 500,
                                textDecoration: item.done ? 'line-through' : undefined,
                                color: item.done ? 'var(--muted)' : 'var(--text)',
                                fontSize: '0.92rem',
                              }}
                            >
                              {item.title}
                            </span>

                            {due && !item.done && (
                              <span
                                className="todo-due-chip"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  padding: '2px 7px',
                                  borderRadius: 5,
                                  background: due.isOverdue
                                    ? 'rgba(239, 68, 68, 0.15)'
                                    : due.isSoon
                                    ? 'rgba(245, 158, 11, 0.15)'
                                    : 'rgba(255, 255, 255, 0.08)',
                                  color: due.isOverdue
                                    ? 'var(--danger, #ef4444)'
                                    : due.isSoon
                                    ? 'var(--warning, #f59e0b)'
                                    : 'var(--muted)',
                                  border: `1px solid ${
                                    due.isOverdue
                                      ? 'rgba(239, 68, 68, 0.3)'
                                      : due.isSoon
                                      ? 'rgba(245, 158, 11, 0.3)'
                                      : 'rgba(255, 255, 255, 0.12)'
                                  }`,
                                }}
                              >
                                {due.isOverdue ? <AlertCircle size={11} /> : <Clock size={11} />}
                                {due.text}
                              </span>
                            )}

                            {due && item.done && (
                              <span className="small muted" style={{ fontSize: '0.74rem' }}>
                                {due.text}
                              </span>
                            )}
                          </div>

                          {item.notes && (
                            <div
                              className="small muted"
                              style={{
                                marginTop: 4,
                                fontSize: '0.8rem',
                                lineHeight: 1.4,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}
                            >
                              {item.notes}
                            </div>
                          )}
                        </div>

                        <div className="row" style={{ gap: 4, flexShrink: 0, marginLeft: 8 }}>
                          <button className="btn sm ghost" title="Edit to-do item" onClick={() => openEdit(item)}>
                            <Pencil size={13} />
                          </button>
                          <button
                            className="btn sm ghost danger"
                            title="Delete to-do item"
                            onClick={() => void remove(item.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Edit Modal */}
      {editing && (
        <Modal title="Edit To-Do Task" onClose={() => setEditing(null)}>
          <div className="field">
            <label>Task Title</label>
            <input
              autoFocus
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && void saveEdit()}
            />
          </div>

          <div className="field small">
            <label>Trip Phase / Category</label>
            <select
              value={editing.category}
              onChange={(e) => setEditing({ ...editing, category: e.target.value })}
              style={{ fontWeight: 500 }}
            >
              <option value="Pre-Trip">🛫 Pre-Trip</option>
              <option value="During Trip">🧭 During Trip</option>
              <option value="Post-Trip">🛬 Post-Trip</option>
              {categories
                .filter((c) => !TRIP_PHASES.includes(c as TripPhase))
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
          </div>

          <div className="field small">
            <label>Due Date</label>
            <input
              type="date"
              value={editing.dueDate}
              onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Notes & Details</label>
            <textarea
              rows={3}
              value={editing.notes}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              placeholder="Additional details, confirmation codes, instructions..."
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void saveEdit()}
              disabled={saving || !editing.title.trim()}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
