import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckSquare,
  Clock,
  FileText,
  Pencil,
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

const DEFAULT_TEMPLATES = [
  { title: 'Place USPS mail hold', category: 'Home & Mail' },
  { title: 'Refill prescription medications', category: 'Health & Meds' },
  { title: 'Check passport expiration & validity', category: 'Finance & Docs' },
  { title: 'Notify bank & credit cards of travel', category: 'Finance & Docs' },
  { title: 'Set up international roaming or eSIM', category: 'Pre-Trip' },
  { title: 'Arrange pet sitting / house plants care', category: 'Home & Mail' },
  { title: 'Download offline maps & entertainment', category: 'Pre-Trip' },
];

const PRESET_CATEGORIES = [
  'Pre-Trip',
  'Home & Mail',
  'Health & Meds',
  'Finance & Docs',
  'Bookings & Tickets',
  'Packing & Prep',
];

function formatDueDate(dateStr?: string | null): { text: string; isOverdue: boolean; isToday: boolean; isSoon: boolean } | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());

  const diffDays = Math.round((targetDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const text = targetDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: targetDay.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });

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
  const [newTitle, setNewTitle] = useState('');
  const [newCat, setNewCat] = useState('Pre-Trip');
  const [newDueDate, setNewDueDate] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [showNotesField, setShowNotesField] = useState(false);
  const [editing, setEditing] = useState<TodoEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');

  const categories = useMemo(() => {
    const custom = todos.map((t) => t.category).filter(Boolean) as string[];
    return Array.from(new Set([...PRESET_CATEGORIES, ...custom]));
  }, [todos]);

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

  const filteredTodos = useMemo(() => {
    if (filter === 'pending') return todos.filter((t) => !t.done);
    if (filter === 'completed') return todos.filter((t) => t.done);
    return todos;
  }, [todos, filter]);

  // Group filtered items by category
  const groupedByCategory = useMemo(() => {
    const map = new Map<string, TodoItem[]>();
    for (const item of filteredTodos) {
      const cat = item.category || 'Pre-Trip';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return map;
  }, [filteredTodos]);

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
        <div className="panel mb" style={{ padding: '12px 14px', background: 'rgba(34, 211, 238, 0.04)', borderColor: 'rgba(34, 211, 238, 0.2)' }}>
          <div className="row between mb" style={{ marginBottom: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <Sparkles size={14} style={{ color: 'var(--accent)' }} />
              <span className="small font-semibold" style={{ color: 'var(--text)' }}>Quick Pre-Trip Suggestions:</span>
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
                }}
                onClick={() => void add(tpl.title, tpl.category)}
              >
                + {tpl.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Task Management Panel */}
      <div className="panel">
        <div className="row between mb">
          <h2 className="panel-title" style={{ margin: 0 }}>Pre-Trip Tasks & To-Do's</h2>
          <div className="segmented-btn-group" style={{ display: 'inline-flex', background: 'var(--panel-2)', borderRadius: 7, padding: 2 }}>
            <button
              type="button"
              className={`btn sm ${filter === 'all' ? 'primary' : 'ghost'}`}
              style={{ padding: '3px 10px', fontSize: '0.78rem' }}
              onClick={() => setFilter('all')}
            >
              All ({todos.length})
            </button>
            <button
              type="button"
              className={`btn sm ${filter === 'pending' ? 'primary' : 'ghost'}`}
              style={{ padding: '3px 10px', fontSize: '0.78rem' }}
              onClick={() => setFilter('pending')}
            >
              Pending ({pendingCount})
            </button>
            <button
              type="button"
              className={`btn sm ${filter === 'completed' ? 'primary' : 'ghost'}`}
              style={{ padding: '3px 10px', fontSize: '0.78rem' }}
              onClick={() => setFilter('completed')}
            >
              Done ({doneCount})
            </button>
          </div>
        </div>

        {/* Add Task Form */}
        <div style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="grow" style={{ minWidth: 200 }}>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Place USPS mail hold, refill prescriptions..."
                onKeyDown={(e) => e.key === 'Enter' && void add()}
                style={{ width: '100%' }}
              />
            </div>
            <select
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              style={{ width: 'auto', minWidth: 140 }}
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
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
            <button
              className="btn primary"
              onClick={() => void add()}
              disabled={!newTitle.trim()}
            >
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

        {/* Task Item List */}
        {todos.length === 0 ? (
          <div className="empty-state">
            <CheckSquare size={36} className="muted" style={{ margin: '0 auto 10px', opacity: 0.5 }} />
            <div className="big">No to-do items yet</div>
            <p>Keep track of pre-trip chores, mail holds, prescriptions, and errands before departure.</p>
          </div>
        ) : filteredTodos.length === 0 ? (
          <div className="empty-state">
            <p className="muted">No tasks matching the selected filter ({filter}).</p>
          </div>
        ) : (
          Array.from(groupedByCategory.entries()).map(([cat, items]) => (
            <div key={cat} className="mb" style={{ marginBottom: 16 }}>
              <div
                className="small muted"
                style={{
                  textTransform: 'uppercase',
                  letterSpacing: '.07em',
                  fontWeight: 600,
                  margin: '12px 0 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{cat}</span>
                <span className="badge" style={{ fontSize: '0.7rem', padding: '1px 6px' }}>{items.length}</span>
              </div>

              {items.map((item) => {
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
                      <button
                        className="btn sm ghost"
                        title="Edit to-do item"
                        onClick={() => openEdit(item)}
                      >
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
              })}
            </div>
          ))
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
            <label>Category</label>
            <input
              list="todo-categories"
              value={editing.category}
              onChange={(e) => setEditing({ ...editing, category: e.target.value })}
            />
            <datalist id="todo-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
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
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
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
