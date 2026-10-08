import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, getDocs,
  serverTimestamp, writeBatch, type Unsubscribe,
} from 'firebase/firestore';
import { db, auth } from './firebase';

/**
 * Recruiter notes about a candidate.
 *
 * Stored in their own collection (`candidate_notes`, one doc per note) rather than on
 * the candidate doc, on purpose: the candidate doc is readable by the applicant
 * themselves (firestore.rules: isOwner(candidateId)), and internal notes ("no contestó
 * 3 veces", "referencia negativa") must NEVER be visible to them. One doc per note also
 * lets two recruiters write at the same time without overwriting each other.
 *
 * Notes belong to the CANDIDATE (not to one application), so they follow the person
 * across vacancies. The vacancy they were written under is kept only as context.
 */

export interface NoteCategory {
  id: string;
  label: string;
  emoji: string;
  /** Tailwind classes for the badge. */
  badge: string;
  /** Tailwind classes for the note card's left accent. */
  accent: string;
}

export const NOTE_CATEGORIES: NoteCategory[] = [
  { id: 'general',     label: 'General',     emoji: '📝', badge: 'bg-slate-100 text-slate-700',     accent: 'border-l-slate-300' },
  { id: 'llamada',     label: 'Llamada',     emoji: '📞', badge: 'bg-sky-100 text-sky-800',         accent: 'border-l-sky-400' },
  { id: 'whatsapp',    label: 'WhatsApp',    emoji: '💬', badge: 'bg-emerald-100 text-emerald-800', accent: 'border-l-emerald-400' },
  { id: 'entrevista',  label: 'Entrevista',  emoji: '🗣️', badge: 'bg-fuchsia-100 text-fuchsia-800', accent: 'border-l-fuchsia-400' },
  { id: 'referencia',  label: 'Referencia',  emoji: '✅', badge: 'bg-blue-100 text-blue-800',       accent: 'border-l-blue-400' },
  { id: 'positivo',    label: 'Punto fuerte', emoji: '⭐', badge: 'bg-amber-100 text-amber-800',    accent: 'border-l-amber-400' },
  { id: 'alerta',      label: 'Alerta',      emoji: '⚠️', badge: 'bg-rose-100 text-rose-800',       accent: 'border-l-rose-500' },
  { id: 'seguimiento', label: 'Seguimiento', emoji: '⏰', badge: 'bg-violet-100 text-violet-800',   accent: 'border-l-violet-400' },
];

export const DEFAULT_NOTE_CATEGORY = 'general';

export function getNoteCategory(id: string | undefined): NoteCategory {
  return NOTE_CATEGORIES.find(c => c.id === id) || NOTE_CATEGORIES[0];
}

/** Hard cap so one paste can't bloat the collection (also enforced in firestore.rules). */
export const NOTE_MAX_LENGTH = 10000;

export interface CandidateNote {
  id: string;
  candidateId: string;
  text: string;
  category: string;
  pinned: boolean;
  authorUid?: string;
  authorName?: string;
  createdAt?: any;
  updatedAt?: any;
  updatedBy?: string;
  applicationId?: string;
  vacancyTitle?: string;
}

const notesCol = () => collection(db, 'candidate_notes');

const toMillis = (t: any): number =>
  t?.toMillis ? t.toMillis() : (t instanceof Date ? t.getTime() : 0);

/** Pinned first, then newest first. A note still being saved (no timestamp yet) goes on top. */
export function sortNotes(notes: CandidateNote[]): CandidateNote[] {
  return [...notes].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const am = a.createdAt ? toMillis(a.createdAt) : Number.MAX_SAFE_INTEGER;
    const bm = b.createdAt ? toMillis(b.createdAt) : Number.MAX_SAFE_INTEGER;
    return bm - am;
  });
}

/** Live notes of one candidate (sorted). */
export function subscribeCandidateNotes(
  candidateId: string,
  onChange: (notes: CandidateNote[]) => void,
  onError?: (e: unknown) => void,
): Unsubscribe {
  // Single-field equality → no composite index needed; sorting happens client-side.
  return onSnapshot(
    query(notesCol(), where('candidateId', '==', candidateId)),
    snap => onChange(sortNotes(snap.docs.map(d => ({ id: d.id, ...d.data() } as CandidateNote)))),
    e => { console.error('candidate_notes snapshot error:', e); onError?.(e); },
  );
}

/** Every note, grouped by candidate — for the global search. */
export async function loadAllNotesByCandidate(): Promise<Map<string, CandidateNote[]>> {
  const snap = await getDocs(notesCol());
  const map = new Map<string, CandidateNote[]>();
  snap.docs.forEach(d => {
    const n = { id: d.id, ...d.data() } as CandidateNote;
    if (!n.candidateId) return;
    const list = map.get(n.candidateId) || [];
    list.push(n);
    map.set(n.candidateId, list);
  });
  return map;
}

function currentAuthor() {
  const u = auth.currentUser;
  return {
    authorUid: u?.uid || '',
    authorName: u?.displayName || u?.email || 'Equipo',
  };
}

export async function addCandidateNote(input: {
  candidateId: string;
  text: string;
  category: string;
  pinned?: boolean;
  applicationId?: string;
  vacancyTitle?: string;
}): Promise<void> {
  const text = input.text.trim().slice(0, NOTE_MAX_LENGTH);
  if (!text) return;
  await addDoc(notesCol(), {
    candidateId: input.candidateId,
    text,
    category: getNoteCategory(input.category).id,
    pinned: !!input.pinned,
    ...currentAuthor(),
    ...(input.applicationId ? { applicationId: input.applicationId } : {}),
    ...(input.vacancyTitle ? { vacancyTitle: input.vacancyTitle } : {}),
    createdAt: serverTimestamp(),
  });
}

export async function updateCandidateNote(
  noteId: string,
  patch: Partial<Pick<CandidateNote, 'text' | 'category' | 'pinned'>>,
): Promise<void> {
  const data: Record<string, unknown> = { ...patch };
  if (typeof patch.text === 'string') {
    data.text = patch.text.trim().slice(0, NOTE_MAX_LENGTH);
    // Only real content edits count as "editado" — pinning is not an edit.
    data.updatedAt = serverTimestamp();
    data.updatedBy = currentAuthor().authorName;
  }
  await updateDoc(doc(db, 'candidate_notes', noteId), data);
}

export async function deleteCandidateNote(noteId: string): Promise<void> {
  await deleteDoc(doc(db, 'candidate_notes', noteId));
}

/** Deletes every note of a candidate (used when the candidate is deleted). */
export async function deleteAllCandidateNotes(candidateId: string): Promise<void> {
  const snap = await getDocs(query(notesCol(), where('candidateId', '==', candidateId)));
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}
