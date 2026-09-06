export interface MemberInfo {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string | null;
}

export interface ExpenseSplitInput {
  userId: string;
  amount?: number;
  percentage?: number;
  shares?: number;
  isPaid?: boolean;
}

export interface NormalizedSplit {
  userId: string;
  amount: number;
  percentage?: number;
  shares?: number;
}

export interface MemberBalance {
  userId: string;
  name: string;
  email?: string;
  avatarUrl?: string | null;
  totalPaid: number;
  totalShare: number;
  netBalance: number; // positive = owed money, negative = owes money
}

export interface SettlementTransaction {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amount: number;
  currency: string;
}

export interface TripSettlementSummary {
  currency: string;
  totalSpent: number;
  memberBalances: MemberBalance[];
  settlements: SettlementTransaction[];
}

/** Round to 2 decimal places */
export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Normalizes expense splits according to splitType (equal, exact, percentage, shares, none).
 */
export function normalizeExpenseSplits(
  totalAmount: number,
  paidById: string | null | undefined,
  splitType: string | null | undefined,
  splits: ExpenseSplitInput[] | null | undefined,
  tripMembers: MemberInfo[],
): NormalizedSplit[] {
  const effectiveSplitType = splitType || 'equal';
  const memberIds = tripMembers.map((m) => m.id);
  const fallbackUserId = paidById || memberIds[0] || 'unknown';

  if (totalAmount <= 0) {
    return [];
  }

  // 1. None: Payer pays for themselves only
  if (effectiveSplitType === 'none') {
    return [{ userId: fallbackUserId, amount: round2(totalAmount) }];
  }

  // 2. Exact: User specifies explicit amounts
  if (effectiveSplitType === 'exact' && Array.isArray(splits) && splits.length > 0) {
    return splits
      .filter((s) => s.userId && typeof s.amount === 'number' && s.amount > 0)
      .map((s) => ({
        userId: s.userId,
        amount: round2(s.amount ?? 0),
      }));
  }

  // 3. Percentage: User specifies percentages
  if (effectiveSplitType === 'percentage' && Array.isArray(splits) && splits.length > 0) {
    const validSplits = splits.filter((s) => s.userId && typeof s.percentage === 'number' && s.percentage > 0);
    const totalPercentage = validSplits.reduce((acc, s) => acc + (s.percentage ?? 0), 0);
    if (totalPercentage > 0) {
      let distributed = 0;
      const res: NormalizedSplit[] = [];
      validSplits.forEach((s, idx) => {
        const isLast = idx === validSplits.length - 1;
        const amt = isLast
          ? round2(totalAmount - distributed)
          : round2((totalAmount * (s.percentage ?? 0)) / totalPercentage);
        distributed += amt;
        res.push({
          userId: s.userId,
          amount: amt,
          percentage: s.percentage,
        });
      });
      return res;
    }
  }

  // 4. Shares: User specifies share weights (e.g. 2 shares, 1 share)
  if (effectiveSplitType === 'shares' && Array.isArray(splits) && splits.length > 0) {
    const validSplits = splits.filter((s) => s.userId && typeof s.shares === 'number' && s.shares > 0);
    const totalShares = validSplits.reduce((acc, s) => acc + (s.shares ?? 0), 0);
    if (totalShares > 0) {
      let distributed = 0;
      const res: NormalizedSplit[] = [];
      validSplits.forEach((s, idx) => {
        const isLast = idx === validSplits.length - 1;
        const amt = isLast
          ? round2(totalAmount - distributed)
          : round2((totalAmount * (s.shares ?? 0)) / totalShares);
        distributed += amt;
        res.push({
          userId: s.userId,
          amount: amt,
          shares: s.shares,
        });
      });
      return res;
    }
  }

  // 5. Equal: Split equally among specified participants or all members
  let targetUserIds: string[] = [];
  if (Array.isArray(splits) && splits.length > 0) {
    targetUserIds = splits.map((s) => s.userId).filter(Boolean);
  }
  if (targetUserIds.length === 0) {
    targetUserIds = memberIds.length > 0 ? memberIds : [fallbackUserId];
  }

  const count = targetUserIds.length;
  if (count === 0) return [];

  const basePerPerson = Math.floor((totalAmount * 100) / count) / 100;
  let remainderCents = Math.round((totalAmount - basePerPerson * count) * 100);

  return targetUserIds.map((userId) => {
    let amt = basePerPerson;
    if (remainderCents > 0) {
      amt = round2(amt + 0.01);
      remainderCents -= 1;
    }
    return {
      userId,
      amount: amt,
    };
  });
}

/**
 * Calculates member balances and simplified debt settlement transactions.
 */
export function calculateTripSettlement(
  expenses: Array<{
    id: string;
    amount: number;
    currency: string;
    paidById?: string | null;
    splitType?: string | null;
    splits?: unknown;
    userId?: string;
  }>,
  members: MemberInfo[],
  primaryCurrency = 'USD',
): TripSettlementSummary {
  const memberMap = new Map<string, MemberInfo>();
  for (const m of members) {
    memberMap.set(m.id, m);
  }

  // Running totals per member
  const paidMap = new Map<string, number>();
  const shareMap = new Map<string, number>();

  for (const m of members) {
    paidMap.set(m.id, 0);
    shareMap.set(m.id, 0);
  }

  let totalSpent = 0;

  for (const exp of expenses) {
    const amount = Number(exp.amount) || 0;
    if (amount <= 0) continue;
    totalSpent = round2(totalSpent + amount);

    const payerId = exp.paidById || exp.userId || members[0]?.id;
    if (payerId) {
      if (!paidMap.has(payerId)) paidMap.set(payerId, 0);
      paidMap.set(payerId, round2((paidMap.get(payerId) ?? 0) + amount));
    }

    const rawSplits = Array.isArray(exp.splits)
      ? (exp.splits as ExpenseSplitInput[])
      : null;

    const normalized = normalizeExpenseSplits(
      amount,
      payerId,
      exp.splitType,
      rawSplits,
      members,
    );

    for (const split of normalized) {
      if (!shareMap.has(split.userId)) shareMap.set(split.userId, 0);
      shareMap.set(split.userId, round2((shareMap.get(split.userId) ?? 0) + split.amount));
    }
  }

  // Build member balance list
  const allUserIds = new Set<string>([...memberMap.keys(), ...paidMap.keys(), ...shareMap.keys()]);
  const memberBalances: MemberBalance[] = [];

  for (const userId of allUserIds) {
    const mem = memberMap.get(userId) || { id: userId, name: 'Unknown User' };
    const totalPaid = round2(paidMap.get(userId) ?? 0);
    const totalShare = round2(shareMap.get(userId) ?? 0);
    const netBalance = round2(totalPaid - totalShare);

    memberBalances.push({
      userId,
      name: mem.name,
      email: mem.email,
      avatarUrl: mem.avatarUrl,
      totalPaid,
      totalShare,
      netBalance,
    });
  }

  // Greedy Min-Cash-Flow Debt Simplification Algorithm
  const debtors: Array<{ userId: string; name: string; amount: number }> = [];
  const creditors: Array<{ userId: string; name: string; amount: number }> = [];

  for (const mb of memberBalances) {
    if (mb.netBalance < -0.005) {
      debtors.push({ userId: mb.userId, name: mb.name, amount: -mb.netBalance });
    } else if (mb.netBalance > 0.005) {
      creditors.push({ userId: mb.userId, name: mb.name, amount: mb.netBalance });
    }
  }

  // Sort debtors descending (largest debt first) and creditors descending (largest credit first)
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const settlements: SettlementTransaction[] = [];

  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    const settleAmt = round2(Math.min(debtor.amount, creditor.amount));

    if (settleAmt > 0) {
      settlements.push({
        fromUserId: debtor.userId,
        fromName: debtor.name,
        toUserId: creditor.userId,
        toName: creditor.name,
        amount: settleAmt,
        currency: primaryCurrency,
      });

      debtor.amount = round2(debtor.amount - settleAmt);
      creditor.amount = round2(creditor.amount - settleAmt);
    }

    if (debtor.amount <= 0.005) {
      dIdx++;
    }
    if (creditor.amount <= 0.005) {
      cIdx++;
    }
  }

  return {
    currency: primaryCurrency,
    totalSpent,
    memberBalances,
    settlements,
  };
}
