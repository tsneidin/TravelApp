import { useMemo, useState } from 'react';
import {
  Plus, Trash2, StickyNote, ArrowRight, CheckCircle2,
  Users, DollarSign, Wallet, Scale, ArrowUpRight, ArrowDownLeft
} from 'lucide-react';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import type { Trip, Expense, AuditUser, ExpenseSplit } from '../../lib/types';
import { Modal, ConfirmModal } from '../../components/Modal';
import { Avatar } from '../../components/Avatar';
import { AuditBadge } from '../../components/AuditBadge';
import { useAuth } from '../../lib/auth';

interface MemberSplitState {
  included: boolean;
  amount: string;
  percentage: string;
  shares: string;
}

export function BudgetTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'list' | 'settlement'>('list');

  // Form states
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(trip.currency);
  const [category, setCategory] = useState('other');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [paidById, setPaidById] = useState(user?.id ?? trip.ownerId);
  const [splitType, setSplitType] = useState<'equal' | 'exact' | 'percentage' | 'shares' | 'none'>('equal');
  const [memberSplits, setMemberSplits] = useState<Record<string, MemberSplitState>>({});

  const [noteExpense, setNoteExpense] = useState<Expense | null>(null);
  const [expenseNotes, setExpenseNotes] = useState('');
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);

  const expenses = trip.expenses ?? [];
  const allMembers: AuditUser[] = useMemo(() => {
    const list: AuditUser[] = [];
    if (trip.owner) {
      list.push(trip.owner);
    }
    if (trip.members) {
      for (const m of trip.members) {
        if (m.user && !list.some((u) => u.id === m.user?.id)) {
          list.push(m.user);
        }
      }
    }
    return list;
  }, [trip.owner, trip.members]);

  const initSplitsForMembers = (
    existingType = 'equal',
    existingSplits?: ExpenseSplit[] | null,
    totalAmt = 0,
  ) => {
    const map: Record<string, MemberSplitState> = {};
    const count = allMembers.length || 1;
    const defaultShare = Math.round((100 / count) * 10) / 10;

    for (const m of allMembers) {
      const existing = existingSplits?.find((s) => s.userId === m.id);
      map[m.id] = {
        included: existing ? true : existingSplits && existingSplits.length > 0 ? false : true,
        amount: existing?.amount !== undefined ? String(existing.amount) : '',
        percentage: existing?.percentage !== undefined ? String(existing.percentage) : String(defaultShare),
        shares: existing?.shares !== undefined ? String(existing.shares) : '1',
      };
    }
    setMemberSplits(map);
  };

  const openNewExpenseModal = () => {
    setEditingExpense(null);
    setDescription('');
    setAmount('');
    setCurrency(trip.currency);
    setCategory('other');
    setDate('');
    setNotes('');
    setPaidById(user?.id ?? trip.ownerId);
    setSplitType('equal');
    initSplitsForMembers('equal');
    setOpen(true);
  };

  const openEditExpenseModal = (exp: Expense) => {
    setEditingExpense(exp);
    setDescription(exp.description);
    setAmount(String(exp.amount));
    setCurrency(exp.currency || trip.currency);
    setCategory(exp.category || 'other');
    setDate(exp.date ? exp.date.slice(0, 10) : '');
    setNotes(exp.notes ?? '');
    setPaidById(exp.paidById || exp.createdById || user?.id || trip.ownerId);
    const sType = (exp.splitType as 'equal' | 'exact' | 'percentage' | 'shares' | 'none') || 'equal';
    setSplitType(sType);
    initSplitsForMembers(sType, exp.splits, exp.amount);
    setOpen(true);
  };

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  const total = useMemo(() => {
    return expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  }, [expenses]);

  // Comprehensive Member Balances & Settlements Calculation
  const settlementData = useMemo(() => {
    const paidMap = new Map<string, number>();
    const shareMap = new Map<string, number>();

    for (const m of allMembers) {
      paidMap.set(m.id, 0);
      shareMap.set(m.id, 0);
    }

    for (const exp of expenses) {
      const amt = Number(exp.amount) || 0;
      if (amt <= 0) continue;

      const payerId = exp.paidById || exp.createdById || allMembers[0]?.id;
      if (payerId) {
        paidMap.set(payerId, (paidMap.get(payerId) ?? 0) + amt);
      }

      // Calculate shares based on splitType
      const sType = exp.splitType || 'equal';
      if (sType === 'none') {
        if (payerId) {
          shareMap.set(payerId, (shareMap.get(payerId) ?? 0) + amt);
        }
      } else if (sType === 'exact' && Array.isArray(exp.splits) && exp.splits.length > 0) {
        for (const s of exp.splits) {
          shareMap.set(s.userId, (shareMap.get(s.userId) ?? 0) + (s.amount || 0));
        }
      } else if (sType === 'percentage' && Array.isArray(exp.splits) && exp.splits.length > 0) {
        const totalPct = exp.splits.reduce((sum, s) => sum + (s.percentage || 0), 0) || 100;
        for (const s of exp.splits) {
          const splitAmt = (amt * (s.percentage || 0)) / totalPct;
          shareMap.set(s.userId, (shareMap.get(s.userId) ?? 0) + splitAmt);
        }
      } else if (sType === 'shares' && Array.isArray(exp.splits) && exp.splits.length > 0) {
        const totalShares = exp.splits.reduce((sum, s) => sum + (s.shares || 0), 0) || 1;
        for (const s of exp.splits) {
          const splitAmt = (amt * (s.shares || 0)) / totalShares;
          shareMap.set(s.userId, (shareMap.get(s.userId) ?? 0) + splitAmt);
        }
      } else {
        // Equal split
        const targetIds = Array.isArray(exp.splits) && exp.splits.length > 0
          ? exp.splits.map((s) => s.userId)
          : allMembers.map((m) => m.id);
        const count = targetIds.length || 1;
        const perPerson = amt / count;
        for (const uid of targetIds) {
          shareMap.set(uid, (shareMap.get(uid) ?? 0) + perPerson);
        }
      }
    }

    const memberBalances = allMembers.map((m) => {
      const totalPaid = Math.round(((paidMap.get(m.id) ?? 0) + Number.EPSILON) * 100) / 100;
      const totalShare = Math.round(((shareMap.get(m.id) ?? 0) + Number.EPSILON) * 100) / 100;
      const netBalance = Math.round((totalPaid - totalShare + Number.EPSILON) * 100) / 100;
      return {
        user: m,
        totalPaid,
        totalShare,
        netBalance,
      };
    });

    // Compute Simplified Settlements (Who owes whom)
    const debtors: Array<{ user: AuditUser; amount: number }> = [];
    const creditors: Array<{ user: AuditUser; amount: number }> = [];

    for (const mb of memberBalances) {
      if (mb.netBalance < -0.005) {
        debtors.push({ user: mb.user, amount: -mb.netBalance });
      } else if (mb.netBalance > 0.005) {
        creditors.push({ user: mb.user, amount: mb.netBalance });
      }
    }

    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const settlements: Array<{ from: AuditUser; to: AuditUser; amount: number }> = [];
    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];
      const settleAmt = Math.round((Math.min(debtor.amount, creditor.amount) + Number.EPSILON) * 100) / 100;

      if (settleAmt > 0) {
        settlements.push({
          from: debtor.user,
          to: creditor.user,
          amount: settleAmt,
        });
        debtor.amount = Math.round((debtor.amount - settleAmt + Number.EPSILON) * 100) / 100;
        creditor.amount = Math.round((creditor.amount - settleAmt + Number.EPSILON) * 100) / 100;
      }

      if (debtor.amount <= 0.005) dIdx++;
      if (creditor.amount <= 0.005) cIdx++;
    }

    const currentUserId = user?.id;
    const currentUserBalance = memberBalances.find((mb) => mb.user.id === currentUserId);

    return {
      memberBalances,
      settlements,
      currentUserBalance,
    };
  }, [expenses, allMembers, user?.id]);

  const saveExpense = async () => {
    if (!description.trim() || !amount) return;

    const totalNum = Number(amount);
    let splitsPayload: ExpenseSplit[] | undefined = undefined;

    if (splitType === 'none') {
      splitsPayload = [{ userId: paidById, amount: totalNum }];
    } else if (splitType === 'exact') {
      splitsPayload = Object.entries(memberSplits)
        .filter(([_, state]) => state.included && Number(state.amount) > 0)
        .map(([userId, state]) => ({ userId, amount: Number(state.amount) }));
    } else if (splitType === 'percentage') {
      splitsPayload = Object.entries(memberSplits)
        .filter(([_, state]) => state.included && Number(state.percentage) > 0)
        .map(([userId, state]) => ({
          userId,
          amount: Math.round(((totalNum * Number(state.percentage)) / 100) * 100) / 100,
          percentage: Number(state.percentage),
        }));
    } else if (splitType === 'shares') {
      const totalShares = Object.values(memberSplits)
        .filter((s) => s.included)
        .reduce((sum, s) => sum + (Number(s.shares) || 0), 0) || 1;

      splitsPayload = Object.entries(memberSplits)
        .filter(([_, state]) => state.included && Number(state.shares) > 0)
        .map(([userId, state]) => ({
          userId,
          amount: Math.round(((totalNum * Number(state.shares)) / totalShares) * 100) / 100,
          shares: Number(state.shares),
        }));
    } else {
      // Equal
      const includedUsers = Object.entries(memberSplits)
        .filter(([_, state]) => state.included)
        .map(([userId]) => userId);

      const targetList = includedUsers.length > 0 ? includedUsers : allMembers.map((m) => m.id);
      const perPerson = Math.round((totalNum / (targetList.length || 1)) * 100) / 100;
      splitsPayload = targetList.map((userId) => ({ userId, amount: perPerson }));
    }

    const payload = {
      description: description.trim(),
      amount: totalNum,
      currency,
      category,
      date: date || undefined,
      notes: notes || undefined,
      paidById,
      splitType,
      splits: splitsPayload,
    };

    if (editingExpense) {
      await apiPatch(`/trips/${trip.id}/expenses/${editingExpense.id}`, payload);
    } else {
      await apiPost(`/trips/${trip.id}/expenses`, payload);
    }

    setOpen(false);
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

  const fmt = (v: number) =>
    Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      {/* KPI Cards */}
      <div className="kpis">
        <div className="kpi">
          <div className="k-label">Total spent</div>
          <div className="k-value">{fmt(total)} {trip.currency}</div>
          <div className="k-sub">{expenses.length} expenses across trip</div>
        </div>

        <div className="kpi">
          <div className="k-label">You paid</div>
          <div className="k-value" style={{ color: 'var(--accent)' }}>
            {fmt(settlementData.currentUserBalance?.totalPaid ?? 0)} {trip.currency}
          </div>
          <div className="k-sub">Your out-of-pocket spend</div>
        </div>

        <div className="kpi">
          <div className="k-label">Your share</div>
          <div className="k-value" style={{ color: 'var(--text)' }}>
            {fmt(settlementData.currentUserBalance?.totalShare ?? 0)} {trip.currency}
          </div>
          <div className="k-sub">Your portion of group costs</div>
        </div>

        <div className="kpi">
          <div className="k-label">Net Balance</div>
          {settlementData.currentUserBalance ? (
            settlementData.currentUserBalance.netBalance > 0.005 ? (
              <>
                <div className="k-value" style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ArrowDownLeft size={18} /> +{fmt(settlementData.currentUserBalance.netBalance)} {trip.currency}
                </div>
                <div className="k-sub" style={{ color: '#10b981', fontWeight: 600 }}>You are owed money</div>
              </>
            ) : settlementData.currentUserBalance.netBalance < -0.005 ? (
              <>
                <div className="k-value" style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ArrowUpRight size={18} /> -{fmt(Math.abs(settlementData.currentUserBalance.netBalance))} {trip.currency}
                </div>
                <div className="k-sub" style={{ color: '#ef4444', fontWeight: 600 }}>You owe money</div>
              </>
            ) : (
              <>
                <div className="k-value" style={{ color: '#10b981' }}>$0.00</div>
                <div className="k-sub">All settled up! 🎉</div>
              </>
            )
          ) : (
            <div className="k-value muted">—</div>
          )}
        </div>
      </div>

      {/* View Switcher & Action Header */}
      <div className="row between" style={{ marginBottom: 14, alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, background: 'var(--panel)', padding: 4, borderRadius: 8, border: '1px solid var(--line)' }}>
          <button
            type="button"
            className={`btn sm ${activeSubTab === 'list' ? 'primary' : 'ghost'}`}
            onClick={() => setActiveSubTab('list')}
          >
            <DollarSign size={14} /> Expenses ({expenses.length})
          </button>
          <button
            type="button"
            className={`btn sm ${activeSubTab === 'settlement' ? 'primary' : 'ghost'}`}
            onClick={() => setActiveSubTab('settlement')}
          >
            <Scale size={14} /> Balances & Settlement ({settlementData.settlements.length})
          </button>
        </div>

        <button className="btn sm primary" onClick={openNewExpenseModal}>
          <Plus size={14} /> Add expense
        </button>
      </div>

      {/* TAB 1: EXPENSES LIST */}
      {activeSubTab === 'list' && (
        <>
          {expenses.length === 0 ? (
            <div className="empty-state">
              <div className="big">No expenses yet</div>
              <p>Track flights, meals, hotels, activities, and cost splitting here.</p>
              <button className="btn primary" onClick={openNewExpenseModal} style={{ marginTop: 12 }}>
                <Plus size={14} /> Add first expense
              </button>
            </div>
          ) : (
            <>
              {byCategory.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {byCategory.map(([cat, amt]) => (
                    <span key={cat} className="badge" style={{ padding: '3px 9px', fontSize: '0.78rem' }}>
                      {cat}: <strong>{fmt(amt)} {trip.currency}</strong>
                    </span>
                  ))}
                </div>
              )}
              <div className="panel table-wrap">
                <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Paid By</th>
                    <th>Split Mode</th>
                    <th>Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => {
                    const payer = e.paidBy || (allMembers.find((m) => m.id === e.paidById) ?? null);
                    const splitCount = Array.isArray(e.splits) ? e.splits.length : allMembers.length;
                    return (
                      <tr key={e.id}>
                        <td>{e.date ? new Date(e.date).toLocaleDateString() : '—'}</td>
                        <td style={{ textAlign: 'left' }}>
                          <div style={{ fontWeight: 600 }}>{e.description}</div>
                          <AuditBadge createdBy={e.createdBy} createdAt={e.createdAt} />
                        </td>
                        <td><span className="badge">{e.category}</span></td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Avatar user={payer} size="sm" />
                            <span style={{ fontSize: '0.85rem' }}>{payer?.name || '—'}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${e.splitType === 'none' ? '' : 'accent'}`} style={{ fontSize: '0.72rem' }}>
                            {e.splitType === 'none'
                              ? 'No split (Payer only)'
                              : e.splitType === 'exact'
                              ? `Exact (${splitCount})`
                              : e.splitType === 'percentage'
                              ? `% split (${splitCount})`
                              : e.splitType === 'shares'
                              ? `Shares (${splitCount})`
                              : `Equal (${splitCount})`}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{fmt(e.amount)} {e.currency}</td>
                        <td>
                          <div className="row" style={{ justifyContent: 'flex-end' }}>
                            <button
                              className="btn sm ghost"
                              title="Edit expense & splits"
                              onClick={() => openEditExpenseModal(e)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn sm ghost"
                              title="Add or edit expense notes"
                              onClick={() => openNotes(e)}
                            >
                              <StickyNote size={13} /> {e.notes ? 'Notes' : ''}
                            </button>
                            <button
                              className="btn sm ghost danger"
                              onClick={() => remove(e)}
                              title="Delete expense"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="total-row">
                    <td colSpan={5}>TOTAL</td>
                    <td colSpan={2}>{fmt(total)} {trip.currency}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
          )}
        </>
      )}

      {/* TAB 2: BALANCES & DEBT SETTLEMENT */}
      {activeSubTab === 'settlement' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Member Balance Breakdown Cards */}
          <div>
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Users size={16} style={{ color: 'var(--accent)' }} /> Member Balances & Cost Sharing
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {settlementData.memberBalances.map((mb) => {
                const isPositive = mb.netBalance > 0.005;
                const isNegative = mb.netBalance < -0.005;
                const isYou = mb.user.id === user?.id;

                return (
                  <div
                    key={mb.user.id}
                    style={{
                      background: 'var(--panel)',
                      border: '1px solid var(--line)',
                      borderRadius: 10,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar user={mb.user} size="lg" />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                            {mb.user.name} {isYou && <span className="badge" style={{ fontSize: '0.68rem', marginLeft: 4 }}>You</span>}
                          </div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>{mb.user.email}</div>
                        </div>
                      </div>

                      <span
                        className={`badge ${isPositive ? 'ok' : isNegative ? 'danger' : ''}`}
                        style={{ fontWeight: 700, fontSize: '0.82rem' }}
                      >
                        {isPositive ? `+${fmt(mb.netBalance)}` : isNegative ? `-${fmt(Math.abs(mb.netBalance))}` : '$0.00'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--muted)', borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 4 }}>
                      <div>Paid: <strong style={{ color: 'var(--text)' }}>{fmt(mb.totalPaid)} {trip.currency}</strong></div>
                      <div>Share: <strong style={{ color: 'var(--text)' }}>{fmt(mb.totalShare)} {trip.currency}</strong></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Debt Settlement Transactions ("Who Owes Whom") */}
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: 18 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Wallet size={16} style={{ color: 'var(--accent)' }} /> Simplified Debt Settlement ("Who Owes Whom")
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '0.84rem', color: 'var(--muted)' }}>
              Calculates the minimum number of direct payments required to settle all shared expenses completely.
            </p>

            {settlementData.settlements.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#10b981' }}>
                <CheckCircle2 size={36} style={{ margin: '0 auto 8px', display: 'block' }} />
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>All balances are settled!</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: 4 }}>No payments currently required between members.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {settlementData.settlements.map((s, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar user={s.from} size="md" />
                      <span style={{ fontWeight: 600 }}>{s.from.name}</span>
                      <ArrowRight size={16} style={{ color: 'var(--muted)' }} />
                      <Avatar user={s.to} size="md" />
                      <span style={{ fontWeight: 600 }}>{s.to.name}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--accent)' }}>
                        {fmt(s.amount)} {trip.currency}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADD / EDIT EXPENSE MODAL */}
      {open && (
        <Modal title={editingExpense ? 'Edit expense' : 'Add expense'} onClose={() => setOpen(false)} wide>
          <div className="field mb-3">
            <label>Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Group dinner in Shibuya, Bullet train tickets…"
              autoFocus
              required
            />
          </div>

          <div className="grid grid-2 mb-3">
            <div className="field">
              <label>Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div className="field">
              <label>Currency</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-2 mb-3">
            <div className="field">
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {['transport', 'lodging', 'food', 'activity', 'shopping', 'entertainment', 'other'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {/* WHO PAID SECTION */}
          <div className="field mb-4">
            <label>Who Paid?</label>
            <select value={paidById} onChange={(e) => setPaidById(e.target.value)}>
              {allMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.id === user?.id ? '(You)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* COST SPLITTING MECHANISM */}
          <div
            style={{
              padding: 14,
              background: 'var(--panel)',
              borderRadius: 10,
              border: '1px solid var(--line)',
              marginBottom: 18,
            }}
          >
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.86rem', marginBottom: 8 }}>
              Cost Splitting Method
            </label>

            {/* Split Mode Buttons */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {(
                [
                  { id: 'equal', label: 'Split Equally' },
                  { id: 'exact', label: 'Exact Amounts' },
                  { id: 'percentage', label: 'Percentages (%)' },
                  { id: 'shares', label: 'By Shares' },
                  { id: 'none', label: 'No Split (Payer only)' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`btn sm ${splitType === m.id ? 'primary' : 'ghost'}`}
                  onClick={() => setSplitType(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Split Configuration per member */}
            {splitType !== 'none' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allMembers.map((m) => {
                  const s = memberSplits[m.id] || { included: true, amount: '', percentage: '100', shares: '1' };
                  const totalAmt = Number(amount) || 0;
                  const includedCount = Object.values(memberSplits).filter((x) => x.included).length || 1;

                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: s.included ? 'rgba(255,255,255,0.03)' : 'transparent',
                        borderRadius: 6,
                        opacity: s.included ? 1 : 0.45,
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={s.included}
                          onChange={(e) => {
                            setMemberSplits({
                              ...memberSplits,
                              [m.id]: { ...s, included: e.target.checked },
                            });
                          }}
                        />
                        <Avatar user={m} size="sm" />
                        <span style={{ fontSize: '0.88rem' }}>{m.name}</span>
                      </label>

                      {/* Mode specific input */}
                      {splitType === 'equal' && s.included && (
                        <span style={{ fontSize: '0.84rem', color: 'var(--muted)', fontWeight: 600 }}>
                          {fmt(totalAmt / includedCount)} {currency}
                        </span>
                      )}

                      {splitType === 'exact' && s.included && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 120 }}>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={s.amount}
                            onChange={(e) => {
                              setMemberSplits({
                                ...memberSplits,
                                [m.id]: { ...s, amount: e.target.value },
                              });
                            }}
                            placeholder="0.00"
                            style={{ padding: '4px 8px', fontSize: '0.84rem', width: '100%' }}
                          />
                        </div>
                      )}

                      {splitType === 'percentage' && s.included && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 90 }}>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            max="100"
                            value={s.percentage}
                            onChange={(e) => {
                              setMemberSplits({
                                ...memberSplits,
                                [m.id]: { ...s, percentage: e.target.value },
                              });
                            }}
                            placeholder="%"
                            style={{ padding: '4px 8px', fontSize: '0.84rem', width: '100%' }}
                          />
                          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>%</span>
                        </div>
                      )}

                      {splitType === 'shares' && s.included && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 90 }}>
                          <input
                            type="number"
                            step="1"
                            min="1"
                            value={s.shares}
                            onChange={(e) => {
                              setMemberSplits({
                                ...memberSplits,
                                [m.id]: { ...s, shares: e.target.value },
                              });
                            }}
                            placeholder="1"
                            style={{ padding: '4px 8px', fontSize: '0.84rem', width: '100%' }}
                          />
                          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>share</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="field mb-3">
            <label>Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Receipt details, reference number, special split notes…"
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={saveExpense}
              disabled={!description.trim() || !amount}
            >
              {editingExpense ? 'Save Changes' : 'Save Expense'}
            </button>
          </div>
        </Modal>
      )}

      {/* EXPENSE NOTES MODAL */}
      {noteExpense && (
        <Modal title={`Notes — ${noteExpense.description}`} onClose={() => setNoteExpense(null)}>
          <div className="field">
            <label>Expense notes</label>
            <textarea
              rows={7}
              value={expenseNotes}
              onChange={(event) => setExpenseNotes(event.target.value)}
              autoFocus
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setNoteExpense(null)}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={() => void saveExpenseNotes()}>
              Save notes
            </button>
          </div>
        </Modal>
      )}

      {/* DELETE EXPENSE CONFIRMATION MODAL */}
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