import React, { useEffect, useState } from 'react';
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { normalizePhone } from '../lib/phone';
import Modal from './ui/Modal';
import { Pencil, Save, X, Loader2 } from 'lucide-react';

/**
 * Edit a candidate's own contact data (name, phone, email, city) from the profile.
 *
 * Candidates type their data themselves when applying, and it is often wrong or goes
 * stale: a mistyped phone, a new number, a name with typos. Until now the only fix was
 * touching Firestore by hand.
 *
 * Two things must stay in sync when saving — this modal owns both:
 *  - `phoneNormalized` is recomputed from the new phone, so inbound WhatsApp replies
 *    keep matching this candidate (that link breaks silently otherwise);
 *  - `candidateName` is propagated to EVERY application of the candidate, because the
 *    kanban/list/ranking render the application's copy of the name, not the profile's.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  candidateId: string;
  candidate: { fullName?: string; name?: string; phone?: string; email?: string; city?: string } | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EditCandidateModal({ isOpen, onClose, candidateId, candidate }: Props) {
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', city: '' });
  const [saving, setSaving] = useState(false);

  // Refill from the live candidate each time the modal opens (the profile is realtime).
  useEffect(() => {
    if (isOpen && candidate) {
      setForm({
        fullName: candidate.fullName || candidate.name || '',
        phone: candidate.phone || '',
        email: candidate.email || '',
        city: candidate.city || '',
      });
    }
  }, [isOpen, candidate]);

  const save = async () => {
    const fullName = form.fullName.trim();
    const phone = form.phone.trim();
    const email = form.email.trim();
    const city = form.city.trim();
    if (!fullName) { alert('El nombre no puede quedar vacío.'); return; }
    if (email && !EMAIL_RE.test(email)) { alert('El correo no tiene un formato válido.'); return; }
    if (phone && normalizePhone(phone).length < 7) { alert('El teléfono es demasiado corto.'); return; }

    setSaving(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'candidates', candidateId), {
        fullName, phone, email, city,
        phoneNormalized: phone ? normalizePhone(phone) : '',
      }, { merge: true });

      // The boards render the application's candidateName — update every copy.
      const appsSnap = await getDocs(query(collection(db, 'applications'), where('candidateId', '==', candidateId)));
      appsSnap.docs.forEach(d => batch.update(d.ref, { candidateName: fullName }));

      await batch.commit();
      onClose();
    } catch (err) {
      console.error('No se pudieron guardar los datos del candidato:', err);
      alert('No se pudieron guardar los cambios. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white';

  return (
    <Modal isOpen={isOpen} onClose={saving ? undefined : onClose} overlayClassName="bg-slate-900/50 z-[120]">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl relative">
        <button onClick={onClose} disabled={saving} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center mb-5">
          <div className="p-2 bg-violet-100 text-violet-600 rounded-xl mr-3">
            <Pencil className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Editar datos del candidato</h2>
            <p className="text-xs text-slate-500">Corrige o actualiza lo que el candidato suministró.</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-600 mb-1 block">Nombre completo</label>
            <input className={inputCls} value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 mb-1 block">Teléfono</label>
            <input className={inputCls} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Ej. 809-123-4567" />
            <p className="text-[11px] text-slate-400 mt-1">Los WhatsApp automáticos y las respuestas del candidato usarán este número.</p>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 mb-1 block">Correo</label>
            <input className={inputCls} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 mb-1 block">Ciudad</label>
            <input className={inputCls} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={save} disabled={saving} className="px-5 py-2 text-sm font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
