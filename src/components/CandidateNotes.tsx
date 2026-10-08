import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NotebookPen, Pin, PinOff, Pencil, Trash2, Loader2, Search, X, Check, AlertTriangle } from 'lucide-react';
import {
  NOTE_CATEGORIES, DEFAULT_NOTE_CATEGORY, NOTE_MAX_LENGTH, getNoteCategory,
  subscribeCandidateNotes, addCandidateNote, updateCandidateNote, deleteCandidateNote,
  type CandidateNote,
} from '../lib/notes';
import { smartMatch } from '../lib/smartSearch';

/**
 * The candidate's notebook: everything the team learns about a person — calls,
 * WhatsApp conversations, references, impressions, alerts, follow-ups — in one clear,
 * categorized, searchable place. Notes are shared by the whole team, live (a note written
 * by a colleague appears instantly), and the global candidate search looks inside them.
 */

// One-click prompts for the facts recruiters most often need to record.
const QUICK_FIELDS = [
  'Disponibilidad:',
  'Expectativa salarial:',
  'Vive en / sector:',
  'Transporte:',
  'Experiencia en ventas:',
  'Referencias:',
  'Próximo paso:',
];

const draftKey = (candidateId: string) => `noteDraft:${candidateId}`;

function readDraft(candidateId: string): string {
  try { return localStorage.getItem(draftKey(candidateId)) || ''; } catch { return ''; }
}
function writeDraft(candidateId: string, text: string) {
  try {
    if (text) localStorage.setItem(draftKey(candidateId), text);
    else localStorage.removeItem(draftKey(candidateId));
  } catch { /* storage disabled — the draft just isn't remembered */ }
}

function formatDate(t: any): string {
  const d: Date | null = t?.toDate ? t.toDate() : (t instanceof Date ? t : null);
  if (!d) return 'Guardando…';
  return d.toLocaleString('es-DO', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Render with `key={candidateId}` so switching candidates remounts (fresh draft/state). */
interface Props {
  candidateId: string;
  /** The application being managed, to record which vacancy the note was written under. */
  applicationId?: string;
  vacancyTitle?: string;
}

export default function CandidateNotes({ candidateId, applicationId, vacancyTitle }: Props) {
  const [notes, setNotes] = useState<CandidateNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [text, setText] = useState(() => readDraft(candidateId));
  const [category, setCategory] = useState(DEFAULT_NOTE_CATEGORY);
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [filterCat, setFilterCat] = useState<string>('');
  const [filterText, setFilterText] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editCategory, setEditCategory] = useState(DEFAULT_NOTE_CATEGORY);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    return subscribeCandidateNotes(
      candidateId,
      (n) => { setNotes(n); setLoading(false); },
      () => { setLoadError(true); setLoading(false); },
    );
  }, [candidateId]);

  // Remember the unsent draft so navigating away (or a reload) never loses it.
  useEffect(() => { writeDraft(candidateId, text); }, [candidateId, text]);

  const countsByCat = useMemo(() => {
    const m: Record<string, number> = {};
    notes.forEach(n => { const c = getNoteCategory(n.category).id; m[c] = (m[c] || 0) + 1; });
    return m;
  }, [notes]);

  const visibleNotes = useMemo(() => notes.filter(n => {
    if (filterCat && getNoteCategory(n.category).id !== filterCat) return false;
    if (filterText && !smartMatch([{ label: 'Nota', value: n.text }, { label: 'Autor', value: n.authorName }], filterText).matched) return false;
    return true;
  }), [notes, filterCat, filterText]);

  const insertQuickField = (label: string) => {
    const prefix = text && !text.endsWith('\n') ? '\n' : '';
    const next = `${text}${prefix}${label} `;
    setText(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) { el.focus(); el.setSelectionRange(next.length, next.length); }
    });
  };

  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await addCandidateNote({ candidateId, text, category, pinned, applicationId, vacancyTitle });
      setText('');
      setPinned(false);
      setCategory(DEFAULT_NOTE_CATEGORY);
    } catch (e) {
      console.error('No se pudo guardar la nota:', e);
      alert('No se pudo guardar la nota. Tu texto se mantiene; revisa la conexión e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (n: CandidateNote) => {
    setEditingId(n.id);
    setEditText(n.text);
    setEditCategory(getNoteCategory(n.category).id);
  };

  const saveEdit = async () => {
    if (!editingId || !editText.trim()) return;
    setBusyId(editingId);
    try {
      await updateCandidateNote(editingId, { text: editText, category: editCategory });
      setEditingId(null);
    } catch (e) {
      console.error('No se pudo editar la nota:', e);
      alert('No se pudo guardar el cambio. Inténtalo de nuevo.');
    } finally {
      setBusyId(null);
    }
  };

  const togglePin = async (n: CandidateNote) => {
    setBusyId(n.id);
    try { await updateCandidateNote(n.id, { pinned: !n.pinned }); }
    catch (e) { console.error('No se pudo fijar la nota:', e); }
    finally { setBusyId(null); }
  };

  const remove = async (n: CandidateNote) => {
    if (!window.confirm('¿Eliminar esta nota? Esta acción no se puede deshacer.')) return;
    setBusyId(n.id);
    try { await deleteCandidateNote(n.id); }
    catch (e) { console.error('No se pudo eliminar la nota:', e); alert('No se pudo eliminar la nota.'); }
    finally { setBusyId(null); }
  };

  const highlight = (body: string) => {
    if (!filterText.trim()) return body;
    const r = smartMatch([{ label: 'Nota', value: body }], filterText);
    const h = r.hits[0];
    if (!h || !h.match) return body;
    const idx = body.indexOf(h.match);
    if (idx === -1) return body;
    return (
      <>
        {body.slice(0, idx)}
        <mark className="bg-yellow-200 text-slate-900 rounded px-0.5">{h.match}</mark>
        {body.slice(idx + h.match.length)}
      </>
    );
  };

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors whitespace-nowrap ${
      active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
    }`;

  return (
    <section className="glass-card rounded-2xl lg:rounded-3xl p-5 lg:p-6 border border-amber-100" aria-labelledby="candidate-notes-title">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <h3 id="candidate-notes-title" className="text-sm lg:text-base font-display font-bold text-slate-800 flex items-center">
          <NotebookPen className="w-5 h-5 mr-2 text-amber-500" />
          Notas del candidato
          <span className="ml-2 px-2 py-0.5 text-[11px] font-bold rounded-full bg-amber-100 text-amber-800">{notes.length}</span>
        </h3>
        <p className="text-[11px] text-slate-400">Compartidas con todo el equipo · el buscador de candidatos busca aquí también</p>
      </div>

      {loadError && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>No se pudieron cargar las notas. Si es la primera vez que se usan, falta publicar las reglas de Firestore actualizadas (ver README).</span>
        </div>
      )}

      {/* Composer */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 lg:p-4 mb-5 shadow-sm">
        <div className="flex flex-wrap gap-1.5 mb-3" role="radiogroup" aria-label="Tipo de nota">
          {NOTE_CATEGORIES.map(c => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={category === c.id}
              onClick={() => setCategory(c.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                category === c.id ? `${c.badge} ring-2 ring-offset-1 ring-slate-400` : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value.slice(0, NOTE_MAX_LENGTH))}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
          placeholder="Escribe todo lo que quieras sobre este candidato: lo que dijo en la llamada, dónde vive, disponibilidad, referencias, impresiones, acuerdos…"
          rows={4}
          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm leading-relaxed focus:ring-2 focus:ring-amber-400 focus:bg-white outline-none resize-y min-h-[96px]"
        />

        <div className="flex flex-wrap gap-1.5 mt-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider self-center mr-1">Añadir:</span>
          {QUICK_FIELDS.map(f => (
            <button key={f} type="button" onClick={() => insertQuickField(f)}
              className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-amber-100 hover:text-amber-800 transition-colors">
              + {f.replace(':', '')}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} className="rounded text-amber-500 focus:ring-amber-400" />
            <Pin className="w-3.5 h-3.5" /> Fijar arriba (información clave)
          </label>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-400 hidden sm:inline">
              {text ? 'Borrador guardado · ' : ''}Ctrl + Enter para guardar
            </span>
            <button
              onClick={save}
              disabled={saving || !text.trim()}
              className="px-4 py-2 bg-slate-900 text-white text-xs lg:text-sm font-bold rounded-xl hover:bg-slate-800 transition-all shadow-md disabled:opacity-40 flex items-center"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              Guardar nota
            </button>
          </div>
        </div>
      </div>

      {/* Filters (only worth showing once there is something to filter) */}
      {notes.length > 2 && (
        <div className="flex flex-col md:flex-row md:items-center gap-2 mb-3">
          <div className="relative md:w-56 flex-shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              placeholder="Buscar en las notas…"
              className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-400 outline-none"
            />
            {filterText && (
              <button onClick={() => setFilterText('')} className="absolute right-2 top-2 p-0.5 text-slate-400 hover:text-slate-700" aria-label="Limpiar">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button onClick={() => setFilterCat('')} className={chip(!filterCat)}>Todas ({notes.length})</button>
            {NOTE_CATEGORIES.filter(c => countsByCat[c.id]).map(c => (
              <button key={c.id} onClick={() => setFilterCat(filterCat === c.id ? '' : c.id)} className={chip(filterCat === c.id)}>
                {c.emoji} {c.label} ({countsByCat[c.id]})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Notes list */}
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-amber-500" /></div>
      ) : notes.length === 0 ? (
        <p className="text-center text-xs text-slate-400 py-6">Aún no hay notas. La primera que escribas aparecerá aquí para todo el equipo.</p>
      ) : visibleNotes.length === 0 ? (
        <p className="text-center text-xs text-slate-400 py-6">Ninguna nota coincide con el filtro.</p>
      ) : (
        <ul className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
          {visibleNotes.map(n => {
            const cat = getNoteCategory(n.category);
            const isEditing = editingId === n.id;
            return (
              <li key={n.id} className={`rounded-xl border border-slate-200 border-l-4 ${cat.accent} bg-white p-3 lg:p-4 ${n.pinned ? 'ring-1 ring-amber-200 bg-amber-50/40' : ''}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    {n.pinned && <span className="flex items-center font-bold text-amber-700"><Pin className="w-3 h-3 mr-0.5" />Fijada</span>}
                    <span className={`px-2 py-0.5 rounded-full font-bold ${cat.badge}`}>{cat.emoji} {cat.label}</span>
                    <span className="font-bold text-slate-700">{n.authorName || 'Equipo'}</span>
                    <span className="text-slate-400">· {formatDate(n.createdAt)}</span>
                    {n.updatedAt && <span className="text-slate-400 italic" title={n.updatedBy ? `Editada por ${n.updatedBy}` : undefined}>(editada)</span>}
                    {n.vacancyTitle && <span className="text-slate-400">· {n.vacancyTitle}</span>}
                  </div>
                  {!isEditing && (
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {busyId === n.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 mr-1" />}
                      <button onClick={() => togglePin(n)} disabled={busyId === n.id} title={n.pinned ? 'Desfijar' : 'Fijar arriba'}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                        {n.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => startEdit(n)} disabled={busyId === n.id} title="Editar"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => remove(n)} disabled={busyId === n.id} title="Eliminar"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {NOTE_CATEGORIES.map(c => (
                        <button key={c.id} type="button" onClick={() => setEditCategory(c.id)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${editCategory === c.id ? `${c.badge} ring-2 ring-slate-400` : 'bg-slate-50 text-slate-500'}`}>
                          {c.emoji} {c.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={editText}
                      onChange={e => setEditText(e.target.value.slice(0, NOTE_MAX_LENGTH))}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      rows={4}
                      autoFocus
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-400 outline-none resize-y"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                      <button onClick={saveEdit} disabled={busyId === n.id || !editText.trim()}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg disabled:opacity-50 flex items-center">
                        {busyId === n.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                        Guardar
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-800 whitespace-pre-wrap break-words leading-relaxed">{highlight(n.text)}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
