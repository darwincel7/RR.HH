/**
 * Where "Atrás" goes when there is no in-app history to return to (a link opened in a
 * new tab, a reload on a deep page): the logical parent screen instead of leaving the app.
 * Pure — pinned by navigation.test.ts.
 */
export function parentPath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '') || '/';
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^\/vacancies\/([^/]+)\/ranking$/))) return `/vacancies/${m[1]}/kanban`;
  if (/^\/vacancies\/[^/]+(\/kanban)?$/.test(p)) return '/vacancies';
  if (/^\/candidates\/[^/]+$/.test(p)) return '/candidates';
  if (/^\/forms\/tests\/[^/]+$/.test(p)) return '/forms?seccion=tests';
  return '/';
}

/**
 * React Router's BrowserRouter stores the position in the session history as
 * `history.state.idx` (0 = the first page of this tab). > 0 means there is somewhere
 * inside the app to go back to.
 */
export function historyIndex(): number {
  try {
    const idx = (window.history.state as any)?.idx;
    return typeof idx === 'number' ? idx : 0;
  } catch {
    return 0;
  }
}
