/**
 * Order in which vacancies are shown — on the public careers portal and in the
 * recruiter's "Vacantes" list (the same order in both, so what the recruiter
 * arranges is exactly what applicants see).
 *
 * A vacancy's position is the number in `displayOrder` (lower = first). Vacancies
 * that were never arranged by hand (no `displayOrder`, e.g. just created) go FIRST,
 * newest first, so a freshly published opening is visible right away.
 */

/** Creation time in ms, whether it comes from the client SDK, the Admin SDK or JSON. */
function createdMillis(v: any): number {
  const t = v?.createdAt;
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof t._seconds === 'number') return t._seconds * 1000;
  if (typeof t === 'number') return t;
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function hasOrder(v: any): boolean {
  return typeof v?.displayOrder === 'number' && Number.isFinite(v.displayOrder);
}

/** Returns a NEW array sorted for display (does not mutate the input). */
export function sortVacanciesForDisplay<T>(vacancies: T[]): T[] {
  return [...vacancies].sort((a: any, b: any) => {
    const ao = hasOrder(a), bo = hasOrder(b);
    if (ao !== bo) return ao ? 1 : -1; // never-arranged ones first
    if (ao && bo && a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    const byDate = createdMillis(b) - createdMillis(a); // newest first
    if (byDate !== 0) return byDate;
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });
}

/**
 * Moves the vacancy `id` one slot up (-1) or down (+1) in the displayed list and
 * returns the `displayOrder` every vacancy must get (0, 1, 2… in the new order).
 * Renumbering the whole list keeps the order stable and free of ties. Returns null
 * when the move is impossible (already first/last, or unknown id).
 */
export function moveVacancy(sorted: { id: string }[], id: string, direction: -1 | 1): { id: string; displayOrder: number }[] | null {
  const from = sorted.findIndex(v => v.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= sorted.length) return null;
  const next = [...sorted];
  [next[from], next[to]] = [next[to], next[from]];
  return next.map((v, i) => ({ id: v.id, displayOrder: i }));
}
