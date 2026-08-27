/**
 * Where a card sits inside its Kanban column.
 *
 * Columns render NEWEST FIRST (descending order), and a card dropped at a given slot has
 * to stay exactly there — including after a reload, which means the position must be a
 * number stored in Firestore, not just the on-screen array index.
 *
 * Extracted from KanbanBoard so the placement maths can be tested on its own: getting it
 * wrong makes cards jump to a different row than the one the recruiter dropped them on,
 * which is both confusing and, for a funnel, misleading.
 */

/** Distance used when a card lands at the very top or bottom, leaving room for later drops. */
export const ORDER_GAP = 100000;

/**
 * A card's position. An explicit `kanbanOrder` (written when the recruiter drops a card
 * somewhere specific) wins; otherwise fall back to the application date, so boards that
 * were never reordered by hand keep a sensible newest-first order.
 */
export function getKanbanOrder(app: any): number {
  if (typeof app?.kanbanOrder === 'number') return app.kanbanOrder;
  const t: any = app?.submittedAt;
  return t?.toMillis ? t.toMillis() : (t?.toDate ? t.toDate().getTime() : 0);
}

/**
 * The order value a card must take to land on the slot it was dropped on.
 *
 * `destItems` is the destination column WITHOUT the dragged card, sorted as rendered
 * (descending) — the same list the drag library indexes against. Because the column is
 * descending, the card ABOVE the slot holds the HIGHER order and the one BELOW the LOWER
 * one: the mirror image of an ascending board.
 *
 * `emptyColumnOrder` is used only when the column has no other cards (callers pass
 * Date.now(), kept as a parameter so this function stays pure and testable).
 */
export function computeDropOrder(destItems: any[], destinationIndex: number, emptyColumnOrder: number): number {
  const prevItem = destItems[destinationIndex - 1]; // card ABOVE the slot (higher order)
  const nextItem = destItems[destinationIndex];     // card BELOW the slot (lower order)

  if (prevItem && nextItem) return (getKanbanOrder(prevItem) + getKanbanOrder(nextItem)) / 2;
  if (prevItem) return getKanbanOrder(prevItem) - ORDER_GAP; // dropped at the bottom
  if (nextItem) return getKanbanOrder(nextItem) + ORDER_GAP; // dropped at the top
  return emptyColumnOrder;
}
