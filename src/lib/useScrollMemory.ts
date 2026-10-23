import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * "Atrás" returns to the exact spot: opening a profile from the Embudo or the Ranking
 * and coming back used to land at the top/left of everything.
 *
 * Every element marked `data-scroll-key="…"` (the board, each column, a table…) plus
 * the window has its scroll position remembered for THIS history entry (location.key),
 * in sessionStorage so it also survives a reload of the tab. A fresh visit to the same
 * page is a new entry and starts at the top, like the browser does.
 *
 * `ready` = the content is rendered (data loaded); positions are put back then, and once
 * more shortly after in case late content (photos, WhatsApp state) grew the lists —
 * unless the recruiter has already started scrolling.
 */
type Positions = Record<string, [number, number]>;
const WINDOW = '__window';
const PREFIX = 'scrollMemory:';
const MAX_ENTRIES = 40;

const storageKeyFor = (pathname: string, key: string) => `${PREFIX}${pathname}#${key}`;

function read(storageKey: string): Positions | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(storageKey: string, positions: Positions) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(positions));
    // Keep the tab's storage small: forget the oldest entries.
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    if (keys.length > MAX_ENTRIES) keys.slice(0, keys.length - MAX_ENTRIES).forEach(k => sessionStorage.removeItem(k));
  } catch { /* storage full or disabled: nothing to remember */ }
}

function apply(positions: Positions) {
  document.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach(el => {
    const p = positions[el.dataset.scrollKey || ''];
    if (p) { el.scrollLeft = p[0]; el.scrollTop = p[1]; }
  });
  const w = positions[WINDOW];
  if (w) window.scrollTo(w[0], w[1]);
}

export function useScrollMemory(ready: boolean) {
  const location = useLocation();
  const storageKey = storageKeyFor(location.pathname, location.key);
  // One page visit = one set of positions. Kept across a filter typed into the URL
  // (a replace navigation gets a new key) so what was scrolled before isn't lost.
  const positions = useRef<Positions>(read(storageKey) || {});
  const restored = useRef(false);
  const userScrolled = useRef(false);
  // The same page component showing another path (Ranking of another vacancy) is a
  // new visit: start from what was saved for THAT entry, and restore it once loaded.
  const visitPath = useRef(location.pathname);
  if (visitPath.current !== location.pathname) {
    visitPath.current = location.pathname;
    positions.current = read(storageKey) || {};
    restored.current = false;
    userScrolled.current = false;
  }

  useLayoutEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const saved = { ...positions.current };
    if (Object.keys(saved).length === 0) return;
    apply(saved);
    const timers = [250, 700].map(ms => window.setTimeout(() => { if (!userScrolled.current) apply(saved); }, ms));
    return () => timers.forEach(t => window.clearTimeout(t));
  }, [ready]);

  useEffect(() => {
    let timer: number | undefined;
    const flush = () => { window.clearTimeout(timer); timer = undefined; write(storageKey, positions.current); };
    const onScroll = (e: Event) => {
      // Leaving the page shrinks it and the browser clamps the scroll, firing one last
      // 'scroll' after the new page is already in history: that's not a position here.
      if (((window.history.state as any)?.key ?? 'default') !== location.key) return;
      const t = e.target;
      if (t === document || t === document.documentElement) {
        positions.current[WINDOW] = [window.scrollX, window.scrollY];
      } else if (t instanceof HTMLElement && t.dataset.scrollKey) {
        positions.current[t.dataset.scrollKey] = [t.scrollLeft, t.scrollTop];
      } else {
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 150);
    };
    // Only a person scrolling cancels the late re-apply (our own scrollTo also fires 'scroll').
    const onUserInput = () => { userScrolled.current = true; };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('wheel', onUserInput, { passive: true });
    window.addEventListener('touchmove', onUserInput, { passive: true });
    window.addEventListener('keydown', onUserInput);
    flush(); // a replace navigation: carry what we have to the new key
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener('wheel', onUserInput);
      window.removeEventListener('touchmove', onUserInput);
      window.removeEventListener('keydown', onUserInput);
      flush();
    };
  }, [storageKey]);
}
