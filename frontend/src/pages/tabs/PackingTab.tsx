import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import type { Trip } from '../../lib/types';
import { Modal } from '../../components/Modal';
import { AuditBadge } from '../../components/AuditBadge';

interface PackingEdit {
  id: string;
  item: string;
  category: string;
}

export function PackingTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const items = trip.packing ?? [];
  const [newItem, setNewItem] = useState('');
  const [newCat, setNewCat] = useState('General');
  const [editing, setEditing] = useState<PackingEdit | null>(null);
  const [saving, setSaving] = useState(false);

  const categories = ['General', ...new Set(items.map((i) => i.category).filter(Boolean))] as string[];

  const add = async () => {
    if (!newItem.trim()) return;
    await apiPost(`/trips/${trip.id}/packing`, { item: newItem.trim(), category: newCat });
    setNewItem('');
    await reload();
  };

  const toggle = async (id: string, done: boolean) => {
    await apiPatch(`/trips/${trip.id}/packing/${id}`, { done });
    await reload();
  };

  const remove = async (id: string) => {
    await apiDelete(`/trips/${trip.id}/packing/${id}`);
    await reload();
  };

  const openEdit = (item: { id: string; item: string; category?: string | null }) => {
    setEditing({ id: item.id, item: item.item, category: item.category || 'General' });
  };

  const saveEdit = async () => {
    if (!editing?.item.trim()) return;
    setSaving(true);
    try {
      await apiPatch(`/trips/${trip.id}/packing/${editing.id}`, {
        item: editing.item.trim(),
        category: editing.category || 'General',
      });
      setEditing(null);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const doneCount = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <div>
      <div className="kpis">
        <div className="kpi">
          <div className="k-label">Packing progress</div>
          <div className="k-value" style={{ color: 'var(--accent)' }}>{pct}%</div>
          <div className="k-sub">{doneCount} of {items.length} packed</div>
        </div>
      </div>

      <div className="panel">
        <div className="row mb">
          <div className="grow">
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="e.g. Power adapter" onKeyDown={(e) => e.key === 'Enter' && void add()} />
          </div>
          <select value={newCat} onChange={(e) => setNewCat(e.target.value)} style={{ width: 'auto' }}>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="btn primary" onClick={() => void add()} disabled={!newItem.trim()}>
            <Plus size={14} /> Add
          </button>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">
            <div className="big">Nothing packed yet</div>
            <p>Build your checklist so nothing gets left behind.</p>
          </div>
        ) : (
          categories.map((cat) => {
            const catItems = items.filter((i) => (i.category || 'General') === cat);
            if (!catItems.length) return null;
            return (
              <div key={cat} className="mb">
                <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, margin: '10px 0 6px' }}>
                  {cat}
                </div>
                {catItems.map((i) => (
                  <div className="list-row" key={i.id}>
                    <input
                      type="checkbox"
                      checked={i.done}
                      onChange={(e) => void toggle(i.id, e.target.checked)}
                      style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                    />
                    <div className="grow" style={{ fontWeight: 400, textDecoration: i.done ? 'line-through' : undefined, opacity: i.done ? 0.55 : 1 }}>
                      <div>{i.item}</div>
                      {(i.createdBy || i.updatedBy) && (
                        <div style={{ marginTop: 2 }}>
                          <AuditBadge createdBy={i.createdBy} createdAt={i.createdAt} updatedBy={i.updatedBy} updatedAt={i.updatedAt} />
                        </div>
                      )}
                    </div>
                    <button className="btn sm ghost" title="Edit packing item" onClick={() => openEdit(i)}>
                      <Pencil size={13} />
                    </button>
                    <button className="btn sm ghost danger" title="Delete packing item" onClick={() => void remove(i.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {editing && (
        <Modal title="Edit packing item" onClose={() => setEditing(null)}>
          <label>
            Item
            <input
              autoFocus
              value={editing.item}
              onChange={(e) => setEditing({ ...editing, item: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && void saveEdit()}
            />
          </label>
          <label>
            Category
            <input
              value={editing.category}
              onChange={(e) => setEditing({ ...editing, category: e.target.value })}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={() => void saveEdit()} disabled={saving || !editing.item.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
