import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import type { Trip } from '../../lib/types';

export function PackingTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const items = trip.packing ?? [];
  const [newItem, setNewItem] = useState('');
  const [newCat, setNewCat] = useState('General');

  const categories = ['General', ...new Set(items.map((i) => i.category).filter(Boolean))] as string[];

  const add = async () => {
    if (!newItem) return;
    await apiPost(`/trips/${trip.id}/packing`, { item: newItem, category: newCat });
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
          <button className="btn primary" onClick={() => void add()} disabled={!newItem}>
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
                <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, margin: '10px 0 6px' }}>
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
                    <div className="grow title" style={{ textDecoration: i.done ? 'line-through' : undefined, opacity: i.done ? 0.55 : 1 }}>
                      {i.item}
                    </div>
                    <button className="btn sm ghost danger" onClick={() => void remove(i.id)}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}