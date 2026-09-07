import { useState } from 'react';
import {
  CheckSquare,
  Plus,
  Pencil,
  Trash2,
  Calendar,
  ExternalLink,
} from 'lucide-react';
import { Modal } from './Modal';
import { apiDelete, apiPatch, apiPost } from '../lib/api';
import type { TodoItem, Day } from '../lib/types';
import { TRIP_PHASES, getPhaseIcon } from '../pages/tabs/TodoTab';

interface DayTodoModalProps {
  tripId: string;
  isOpen: boolean;
  onClose: () => void;
  day: Day;
  dayIndex: number;
  todos: TodoItem[];
  onReload: () => Promise<void>;
  onNavigateToTodos?: () => void;
}

export function DayTodoModal({
  tripId,
  isOpen,
  onClose,
  day,
  dayIndex,
  todos,
  onReload,
  onNavigateToTodos,
}: DayTodoModalProps) {
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<string>('During Trip');
  const [newNotes, setNewNotes] = useState('');
  const [showNotesField, setShowNotesField] = useState(false);
  const [busy, setBusy] = useState(false);

  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editCategory, setEditCategory] = useState('');

  if (!isOpen) return null;

  const dayDateStr = day.date.slice(0, 10);
  const dayTodos = todos.filter((t) => t.dueDate && t.dueDate.slice(0, 10) === dayDateStr);

  const handleToggle = async (id: string, done: boolean) => {
    try {
      await apiPatch(`/trips/${tripId}/todos/${id}`, { done });
      await onReload();
    } catch (e) {
      console.error('Failed to toggle to-do', e);
    }
  };

  const handleAdd = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTitle.trim()) return;

    setBusy(true);
    try {
      await apiPost(`/trips/${tripId}/todos`, {
        title: newTitle.trim(),
        dueDate: dayDateStr,
        category: newCategory.trim() || 'During Trip',
        notes: newNotes.trim() || undefined,
      });
      setNewTitle('');
      setNewNotes('');
      setShowNotesField(false);
      await onReload();
    } catch (err) {
      console.error('Failed to create to-do for day', err);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (todo: TodoItem) => {
    setEditingTodo(todo);
    setEditTitle(todo.title || '');
    setEditNotes(todo.notes || '');
    setEditCategory(todo.category || 'During Trip');
  };

  const cancelEdit = () => {
    setEditingTodo(null);
    setEditTitle('');
    setEditNotes('');
    setEditCategory('');
  };

  const saveEdit = async () => {
    if (!editingTodo || !editTitle.trim()) return;
    setBusy(true);
    try {
      await apiPatch(`/trips/${tripId}/todos/${editingTodo.id}`, {
        title: editTitle.trim(),
        notes: editNotes.trim() || null,
        category: editCategory.trim() || 'During Trip',
      });
      setEditingTodo(null);
      await onReload();
    } catch (err) {
      console.error('Failed to update to-do', err);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this to-do?')) return;
    try {
      await apiDelete(`/trips/${tripId}/todos/${id}`);
      if (editingTodo?.id === id) cancelEdit();
      await onReload();
    } catch (err) {
      console.error('Failed to delete to-do', err);
    }
  };

  const formattedDate = new Date(day.date).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const customDayLabel = day.label && !day.label.toLowerCase().startsWith('day ') ? `: ${day.label}` : '';

  return (
    <Modal
      title={`To-Do's — Day ${dayIndex + 1}${customDayLabel}`}
      onClose={onClose}
    >
      <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }} className="muted">
          <Calendar size={14} className="text-accent" />
          <span>Due date: <strong>{formattedDate}</strong></span>
        </div>
        {dayTodos.length > 0 && (
          <span className="badge" style={{ fontSize: '0.75rem' }}>
            {dayTodos.filter((t) => t.done).length} of {dayTodos.length} done
          </span>
        )}
      </div>

      {/* Editing sub-view */}
      {editingTodo ? (
        <div
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--accent)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '1rem',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '8px', color: 'var(--accent)' }}>
            Edit To-Do
          </div>
          <div className="field" style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '0.8rem', marginBottom: '3px' }}>Task title</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Task name…"
              autoFocus
            />
          </div>
          <div className="grid grid-2" style={{ gap: '8px', marginBottom: '8px' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.8rem', marginBottom: '3px' }}>Phase / Category</label>
              <select
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                style={{ fontSize: '0.85rem' }}
              >
                {TRIP_PHASES.map((phase) => (
                  <option key={phase} value={phase}>
                    {phase}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field" style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '0.8rem', marginBottom: '3px' }}>Notes</label>
            <textarea
              rows={2}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Additional notes or details…"
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn sm primary" onClick={() => void saveEdit()} disabled={busy || !editTitle.trim()}>
              Save Changes
            </button>
            <button type="button" className="btn sm" onClick={cancelEdit}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Task List */}
      <div style={{ maxHeight: '42vh', overflowY: 'auto', marginBottom: '1rem' }}>
        {dayTodos.length === 0 ? (
          <div
            style={{
              padding: '1.25rem 1rem',
              textAlign: 'center',
              border: '1px dashed var(--line)',
              borderRadius: '8px',
              color: 'var(--muted)',
              fontSize: '0.88rem',
            }}
          >
            <CheckSquare size={24} style={{ margin: '0 auto 6px', opacity: 0.4 }} />
            <div>No to-do tasks due on Day {dayIndex + 1}.</div>
            <div className="small" style={{ marginTop: '2px', opacity: 0.8 }}>Add a task below to track it for this day.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {dayTodos.map((todo) => {
              const isDone = todo.done;
              return (
                <div
                  key={todo.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '8px 10px',
                    background: isDone ? 'var(--panel-2, rgba(255,255,255,0.02))' : 'var(--panel, rgba(255,255,255,0.04))',
                    border: '1px solid var(--line)',
                    borderRadius: '7px',
                    opacity: isDone ? 0.65 : 1,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isDone}
                    onChange={(e) => void handleToggle(todo.id, e.target.checked)}
                    style={{
                      width: 17,
                      height: 17,
                      marginTop: 2,
                      cursor: 'pointer',
                      accentColor: 'var(--accent)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontWeight: isDone ? 400 : 500,
                          fontSize: '0.9rem',
                          textDecoration: isDone ? 'line-through' : 'none',
                          color: isDone ? 'var(--muted)' : 'var(--text)',
                        }}
                      >
                        {todo.title}
                      </span>
                      {todo.category && (
                        <span
                          className="badge"
                          style={{
                            fontSize: '0.68rem',
                            padding: '1px 5px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          {getPhaseIcon(todo.category)}
                          <span>{todo.category}</span>
                        </span>
                      )}
                    </div>
                    {todo.notes && (
                      <div
                        style={{
                          fontSize: '0.78rem',
                          color: 'var(--muted)',
                          marginTop: '3px',
                          whiteSpace: 'pre-wrap',
                          textDecoration: isDone ? 'line-through' : 'none',
                        }}
                      >
                        {todo.notes}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn xs ghost"
                      title="Edit task"
                      onClick={() => startEdit(todo)}
                      style={{ padding: '2px 5px' }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="btn xs ghost danger"
                      title="Delete task"
                      onClick={() => void handleDelete(todo.id)}
                      style={{ padding: '2px 5px' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Add Form */}
      <form
        onSubmit={(e) => void handleAdd(e)}
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: '8px',
          padding: '10px',
          marginBottom: '1rem',
        }}
      >
        <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text)' }}>
          + Add To-Do for {formattedDate}
        </div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: showNotesField ? '6px' : 0 }}>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="e.g. Buy metro day pass, Pick up luggage…"
            style={{ flex: 1, fontSize: '0.85rem', padding: '6px 8px' }}
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            style={{ width: '115px', fontSize: '0.8rem', padding: '6px 4px' }}
          >
            {TRIP_PHASES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="btn primary sm"
            disabled={busy || !newTitle.trim()}
            style={{ flexShrink: 0, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <Plus size={13} />
            <span>Add</span>
          </button>
        </div>

        {showNotesField ? (
          <div style={{ marginTop: '6px' }}>
            <textarea
              rows={2}
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Optional notes or details…"
              style={{ fontSize: '0.82rem' }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="btn xs link muted"
            style={{ marginTop: '4px', padding: 0 }}
            onClick={() => setShowNotesField(true)}
          >
            + Add notes
          </button>
        )}
      </form>

      {/* Modal Actions Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        {onNavigateToTodos && (
          <button
            type="button"
            className="btn ghost sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem' }}
            onClick={() => {
              onClose();
              onNavigateToTodos();
            }}
          >
            <span>Go to All To-Do's Tab</span>
            <ExternalLink size={12} />
          </button>
        )}
        <button type="button" className="btn sm" onClick={onClose} style={{ marginLeft: 'auto' }}>
          Close
        </button>
      </div>
    </Modal>
  );
}
