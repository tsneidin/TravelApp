import { describe, it, expect } from 'vitest';
import {
  normalizeExpenseSplits,
  calculateTripSettlement,
  round2,
  type MemberInfo,
} from '../src/services/expenseSplitting.js';

describe('Expense Splitting Service', () => {
  const members: MemberInfo[] = [
    { id: 'u1', name: 'Alice', email: 'alice@example.com' },
    { id: 'u2', name: 'Bob', email: 'bob@example.com' },
    { id: 'u3', name: 'Charlie', email: 'charlie@example.com' },
  ];

  describe('normalizeExpenseSplits', () => {
    it('splits equally among all members by default', () => {
      const splits = normalizeExpenseSplits(100, 'u1', 'equal', null, members);
      expect(splits).toHaveLength(3);
      const sum = splits.reduce((s, x) => s + x.amount, 0);
      expect(round2(sum)).toBe(100);
      expect(splits[0].amount).toBe(33.34);
      expect(splits[1].amount).toBe(33.33);
      expect(splits[2].amount).toBe(33.33);
    });

    it('splits equally among selected subset of members', () => {
      const splits = normalizeExpenseSplits(50, 'u1', 'equal', [{ userId: 'u1' }, { userId: 'u2' }], members);
      expect(splits).toHaveLength(2);
      expect(splits[0].amount).toBe(25);
      expect(splits[1].amount).toBe(25);
    });

    it('handles exact amount splits', () => {
      const splits = normalizeExpenseSplits(90, 'u1', 'exact', [
        { userId: 'u1', amount: 50 },
        { userId: 'u2', amount: 40 },
      ], members);
      expect(splits).toHaveLength(2);
      expect(splits[0].amount).toBe(50);
      expect(splits[1].amount).toBe(40);
    });

    it('handles percentage splits', () => {
      const splits = normalizeExpenseSplits(200, 'u1', 'percentage', [
        { userId: 'u1', percentage: 50 },
        { userId: 'u2', percentage: 25 },
        { userId: 'u3', percentage: 25 },
      ], members);
      expect(splits).toHaveLength(3);
      expect(splits[0].amount).toBe(100);
      expect(splits[1].amount).toBe(50);
      expect(splits[2].amount).toBe(50);
    });

    it('handles share-weighted splits', () => {
      const splits = normalizeExpenseSplits(120, 'u1', 'shares', [
        { userId: 'u1', shares: 2 },
        { userId: 'u2', shares: 1 },
      ], members);
      expect(splits).toHaveLength(2);
      expect(splits[0].amount).toBe(80);
      expect(splits[1].amount).toBe(40);
    });

    it('handles none (payer only) split', () => {
      const splits = normalizeExpenseSplits(45, 'u2', 'none', null, members);
      expect(splits).toEqual([{ userId: 'u2', amount: 45 }]);
    });
  });

  describe('calculateTripSettlement', () => {
    it('computes correct member balances and settlements for equal split', () => {
      // Alice paid $90 for Dinner (split 3 ways: Alice 30, Bob 30, Charlie 30)
      // Bob paid $30 for Taxi (split between Alice & Bob: Alice 15, Bob 15)
      const expenses = [
        {
          id: 'e1',
          amount: 90,
          currency: 'USD',
          paidById: 'u1',
          splitType: 'equal',
          splits: null,
        },
        {
          id: 'e2',
          amount: 30,
          currency: 'USD',
          paidById: 'u2',
          splitType: 'equal',
          splits: [{ userId: 'u1' }, { userId: 'u2' }],
        },
      ];

      const res = calculateTripSettlement(expenses, members, 'USD');

      expect(res.totalSpent).toBe(120);

      // Alice: paid 90, consumed (30 + 15 = 45), net = +45
      const alice = res.memberBalances.find((m) => m.userId === 'u1')!;
      expect(alice.totalPaid).toBe(90);
      expect(alice.totalShare).toBe(45);
      expect(alice.netBalance).toBe(45);

      // Bob: paid 30, consumed (30 + 15 = 45), net = -15
      const bob = res.memberBalances.find((m) => m.userId === 'u2')!;
      expect(bob.totalPaid).toBe(30);
      expect(bob.totalShare).toBe(45);
      expect(bob.netBalance).toBe(-15);

      // Charlie: paid 0, consumed 30, net = -30
      const charlie = res.memberBalances.find((m) => m.userId === 'u3')!;
      expect(charlie.totalPaid).toBe(0);
      expect(charlie.totalShare).toBe(30);
      expect(charlie.netBalance).toBe(-30);

      // Settlements: Charlie pays Alice $30, Bob pays Alice $15
      expect(res.settlements).toHaveLength(2);
      expect(res.settlements).toContainEqual({
        fromUserId: 'u3',
        fromName: 'Charlie',
        toUserId: 'u1',
        toName: 'Alice',
        amount: 30,
        currency: 'USD',
      });
      expect(res.settlements).toContainEqual({
        fromUserId: 'u2',
        fromName: 'Bob',
        toUserId: 'u1',
        toName: 'Alice',
        amount: 15,
        currency: 'USD',
      });
    });
  });
});
