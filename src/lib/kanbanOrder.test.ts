import { describe, it, expect } from 'vitest';
import { getKanbanOrder, computeDropOrder, ORDER_GAP } from './kanbanOrder';

/** A column as rendered: newest first, i.e. descending order. */
const column = (...orders: number[]) =>
  orders.map((kanbanOrder, i) => ({ id: `card-${i}`, kanbanOrder }));

describe('getKanbanOrder', () => {
  it('prefers an explicit kanbanOrder', () => {
    expect(getKanbanOrder({ kanbanOrder: 42, submittedAt: { toMillis: () => 999 } })).toBe(42);
  });

  it('falls back to the application date for cards never reordered by hand', () => {
    expect(getKanbanOrder({ submittedAt: { toMillis: () => 1700000000000 } })).toBe(1700000000000);
    const d = new Date('2026-08-26T12:00:00Z');
    expect(getKanbanOrder({ submittedAt: { toDate: () => d } })).toBe(d.getTime());
  });

  it('returns 0 rather than NaN when there is no usable date', () => {
    // NaN would poison every comparison and scramble the whole column.
    expect(getKanbanOrder({})).toBe(0);
    expect(getKanbanOrder(null)).toBe(0);
    expect(getKanbanOrder({ submittedAt: null })).toBe(0);
  });

  it('accepts kanbanOrder 0 as a real position', () => {
    // A `typeof === 'number'` check is required here: a truthiness check would treat 0
    // as "unset" and send the card back to its date.
    expect(getKanbanOrder({ kanbanOrder: 0, submittedAt: { toMillis: () => 555 } })).toBe(0);
  });
});

describe('computeDropOrder', () => {
  it('puts a card dropped between two others exactly between them', () => {
    expect(computeDropOrder(column(300, 100), 1, 0)).toBe(200);
  });

  it('puts a card dropped at the top above everything', () => {
    const order = computeDropOrder(column(300, 200, 100), 0, 0);
    expect(order).toBe(300 + ORDER_GAP);
    expect(order).toBeGreaterThan(300);
  });

  it('puts a card dropped at the bottom below everything', () => {
    const order = computeDropOrder(column(300, 200, 100), 3, 0);
    expect(order).toBe(100 - ORDER_GAP);
    expect(order).toBeLessThan(100);
  });

  it('uses the fallback only when the column is empty', () => {
    expect(computeDropOrder([], 0, 1234)).toBe(1234);
  });

  it('lands the card on the exact slot it was dropped on, at every position', () => {
    // The real invariant: drop at index i, re-sort the column descending, and the card
    // must come back at index i. This is what broke when the board switched to
    // newest-first and the placement maths still assumed ascending order.
    const existing = column(500, 400, 300, 200, 100);
    for (let i = 0; i <= existing.length; i++) {
      const dropped = { id: 'dropped', kanbanOrder: computeDropOrder(existing, i, Date.now()) };
      const rendered = [...existing, dropped].sort((a, b) => getKanbanOrder(b) - getKanbanOrder(a));
      expect(rendered.findIndex(c => c.id === 'dropped')).toBe(i);
    }
  });

  it('keeps working on a column whose cards have no kanbanOrder yet', () => {
    // Boards that predate manual ordering fall back to submittedAt; a drop must still
    // land correctly among them.
    const byDate = [3000, 2000, 1000].map((ms, i) => ({ id: `old-${i}`, submittedAt: { toMillis: () => ms } }));
    const dropped = { id: 'dropped', kanbanOrder: computeDropOrder(byDate, 1, Date.now()) };
    const rendered = [...byDate, dropped].sort((a, b) => getKanbanOrder(b) - getKanbanOrder(a));
    expect(rendered.findIndex(c => c.id === 'dropped')).toBe(1);
  });
});
