import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Search, X } from 'lucide-react';
import { historyIndex, parentPath } from '../../lib/navigation';

/**
 * Always-visible bar above every internal page:
 *  - "Atrás" / "Adelante" move through the screens visited in this tab (like the
 *    browser buttons, but inside the app and visible on mobile). With nothing to go back
 *    to, "Atrás" goes to the logical parent screen instead of leaving the app.
 *  - A global search box: from any screen, type a name, phone, place or something
 *    written in a note and land in the candidate list with the results.
 */
export function useHistoryNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const navType = useNavigationType();
  const [idx, setIdx] = useState(historyIndex());
  // Furthest history position reachable with "Adelante". A new navigation (PUSH)
  // discards the forward entries, exactly like the browser does.
  const maxIdx = useRef(idx);

  useEffect(() => {
    const i = historyIndex();
    setIdx(i);
    if (navType === 'PUSH' || i > maxIdx.current) maxIdx.current = i;
  }, [location.key, navType]);

  const canGoBack = idx > 0;
  const canGoForward = idx < maxIdx.current;

  const goBack = () => {
    if (canGoBack) navigate(-1);
    else navigate(parentPath(location.pathname));
  };
  const goForward = () => { if (canGoForward) navigate(1); };

  return { goBack, goForward, canGoBack, canGoForward, isHome: location.pathname === '/' };
}

export default function TopBar() {
  const { goBack, goForward, canGoForward, isHome, canGoBack } = useHistoryNav();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const onCandidates = location.pathname === '/candidates';
  const [term, setTerm] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // The long hint doesn't fit next to the arrows on a phone.
  const [narrow] = useState(() => {
    try { return window.matchMedia('(max-width: 639px)').matches; } catch { return false; }
  });

  // On the candidate list the page's own search box is the source of truth; keep this
  // one in sync so both always show the same query.
  useEffect(() => {
    if (onCandidates) setTerm(searchParams.get('q') || '');
  }, [onCandidates, searchParams]);

  // "/" focuses the global search from anywhere (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = term.trim();
    const params = new URLSearchParams(onCandidates ? searchParams : undefined);
    if (q) params.set('q', q); else params.delete('q');
    const qs = params.toString();
    navigate(`/candidates${qs ? `?${qs}` : ''}`, { replace: onCandidates });
  };

  const navBtn = 'flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed';

  return (
    <div className="max-w-7xl mx-auto w-full mb-4 lg:mb-6 flex items-center gap-2">
      <button
        onClick={goBack}
        disabled={isHome && !canGoBack}
        title="Volver a la pantalla anterior (Alt + ←)"
        className={`${navBtn} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-violet-700 shadow-sm`}
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="hidden sm:inline">Atrás</span>
      </button>
      <button
        onClick={goForward}
        disabled={!canGoForward}
        title="Ir a la pantalla siguiente (Alt + →)"
        aria-label="Adelante"
        className={`${navBtn} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-violet-700 shadow-sm`}
      >
        <ArrowRight className="w-4 h-4" />
      </button>

      <form onSubmit={submit} className="relative flex-1 max-w-xl ml-auto" role="search">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          ref={inputRef}
          value={term}
          onChange={e => setTerm(e.target.value)}
          placeholder={narrow ? 'Buscar candidato…' : 'Buscar candidato: nombre, teléfono, lugar, notas…'}
          aria-label="Buscar candidatos por nombre, teléfono, lugar o notas"
          className="w-full pl-9 pr-16 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-400 outline-none shadow-sm"
        />
        {term ? (
          <button type="button" onClick={() => { setTerm(''); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700" aria-label="Limpiar búsqueda">
            <X className="w-4 h-4" />
          </button>
        ) : (
          <kbd className="hidden md:block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">/</kbd>
        )}
      </form>
    </div>
  );
}
