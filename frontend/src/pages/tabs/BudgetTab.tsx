import { useMemo, useState } from 'react';
import { Plus, Trash2, StickyNote } from 'lucide-react';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import type { Trip, Expense } from '../../lib/types';
import { Modal, ConfirmModal } from '../../components/Modal';

interface ExpenseForm {
  description: string;
  amount: string;
  currency: string;
  category: string;
  date: string;
  notes: string;
}

export function BudgetTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ExpenseForm>({ description: '', amount: '', currency: trip.currency, category: 'other', date: '', notes: '' });

  const [noteExpense, setNoteExpense] = useState<Expense | null>(null);
  const [expenseNotes, setExpenseNotes] = useState('');
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);

  const expenses = trip.expenses ?? [];
  const currency = trip.currency;

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  const save = async () => {
    if (!form.description) return;
    await apiPost(`/trips/${trip.id}/expenses`, {
      description: form.description,
      amount: Number(form.amount || 0),
      currency: form.currency || currency,
      category: form.category || 'other',
      date: form.date || undefined,
      notes: form.notes || undefined,
    });
    setOpen(false);
    setForm({ description: '', amount: '', currency: currency, category: 'other', date: '', notes: '' });
    await reload();
  };

  const openNotes = (expense: Expense) => {
    setNoteExpense(expense);
    setExpenseNotes(expense.notes ?? '');
  };

  const saveExpenseNotes = async () => {
    if (!noteExpense) return;
    await apiPatch(`/trips/${trip.id}/expenses/${noteExpense.id}`, { notes: expenseNotes });
    setNoteExpense(null);
    await reload();
  };

  const remove = (e: Expense) => {
    setDeletingExpense(e);
  };

  const fmt = (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      <div className="kpis">
        <div className="kpi">
          <div className="k-label">Total spent</div>
          <div className="k-value">{fmt(total)} {currency}</div>
          <div className="k-sub">{expenses.length} expenses</div>
        </div>
        {byCategory.slice(0, 3).map(([cat, amt]) => (
          <div className="kpi" key={cat}>
            <div className="k-label">{cat}</div>
            <div className="k-value" style={{ color: 'var(--accent)' }}>{fmt(amt)}</div>
            <div className="k-sub">{Math.round((amt / (total || 1)) * 100)}% of budget</div>
          </div>
        ))}
        {byCategory.length === 0 && (
          <div className="kpi">
            <div className="k-label">Category</div>
            <div className="k-value muted">—</div>
            <div className="k-sub">Add expenses to see breakdown</div>
          </div>
        )}
      </div>

      <div className="row between">
        <h2 className="panel-title">Expenses</h2>
        <button className="btn sm" onClick={() => setOpen(true)}>
          <Plus size={14} /> Add expense
        </button>
      </div>

      {expenses.length === 0 ? (
        <div className="empty-state">
          <div className="big">No expenses yet</div>
          <p>Track flights, meals, hotels and activities here.</p>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td>{e.date ? new Date(e.date).toLocaleDateString() : '—'}</td>
                  <td style={{ textAlign: 'left' }}>{e.description}</td>
                  <td><span className="badge">{e.category}</span></td>
                  <td>{fmt(e.amount)} {e.currency}</td>
                  <td>
                    <div className="row">
                      <button className="btn sm ghost" title="Add or edit expense notes" onClick={() => openNotes(e)}><StickyNote size={13} /> {e.notes ? 'Notes' : ''}</button>
                      <button className="btn sm ghost danger" onClick={() => remove(e)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={3}>TOTAL</td>
                <td colSpan={2}>{fmt(total)} {currency}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal title="Add expense" onClose={() => setOpen(false)}>
          <div className="field">
            <label>Description</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Shinkansen Tokyo → Kyoto" autoFocus />
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Amount</label>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div className="field">
              <label>Currency</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Category</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {['transport', 'lodging', 'food', 'activity', 'shopping', 'entertainment', 'other'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional details, receipt reference, who paid…" />
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={!form.description}>Save</button>
          </div>
        </Modal>
      )}

      {noteExpense && (
        <Modal title={`Notes — ${noteExpense.description}`} onClose={() => setNoteExpense(null)}>
          <div className="field">
            <label>Expense notes</label>
            <textarea rows={7} value={expenseNotes} onChange={(event) => setExpenseNotes(event.target.value)} autoFocus />
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setNoteExpense(null)}>Cancel</button>
            <button className="btn primary" onClick={() => void saveExpenseNotes()}>Save notes</button>
          </div>
        </Modal>
      )}

      {deletingExpense && (
        <ConfirmModal
          title="Delete expense"
          message={`Delete expense "${deletingExpense.description}"?`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await apiDelete(`/trips/${trip.id}/expenses/${deletingExpense.id}`);
            setDeletingExpense(null);
            await reload();
          }}
          onCancel={() => setDeletingExpense(null)}
        />
      )}
    </div>
  );
}