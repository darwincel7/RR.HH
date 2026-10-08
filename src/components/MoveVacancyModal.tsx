import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { PIPELINE_STAGES } from '../constants/stages';
import {
  planVacancyMove, fetchVacanciesByCandidate, executeVacancyMove, KEEP_STAGE,
  type MovableApp, type MoveMode,
} from '../lib/moveApplication';
import Modal from './ui/Modal';
import { ArrowRightLeft, Copy, Loader2, X, CheckCircle, AlertTriangle } from 'lucide-react';

/**
 * Move (or copy) one or many applications to another vacancy. Used from the candidate
 * profile, the global candidate list and the Kanban board.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  apps: MovableApp[];
  /** Called after a successful move/copy (to clear selection, refresh, etc.). */
  onDone?: () => void;
}

interface Summary {
  mode: MoveMode;
  target: string;
  done: number;
  alreadyThere: string[];
  conflicts: string[];
}

export default function MoveVacancyModal({ isOpen, onClose, apps, onDone }: Props) {
  const [vacancies, setVacancies] = useState<{ id: string; title: string; active: boolean }[]>([]);
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState<MoveMode>('move');
  const [stage, setStage] = useState<string>(KEEP_STAGE);
  const [working, setWorking] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTarget('');
    setMode('move');
    setStage(KEEP_STAGE);
    setSummary(null);
    getDocs(collection(db, 'vacancies'))
      .then(snap => {
        const list = snap.docs.map(d => ({ id: d.id, title: d.data().title || 'Sin título', active: !!d.data().active }));
        // Published vacancies first, then alphabetically.
        list.sort((a, b) => (a.active === b.active ? a.title.localeCompare(b.title, 'es') : a.active ? -1 : 1));
        setVacancies(list);
      })
      .catch(e => console.error('No se pudieron cargar las vacantes:', e));
  }, [isOpen]);

  const currentVacancies = new Set(apps.map(a => a.vacancyId));
  const titles: Record<string, string> = { bulk_upload: 'Subida masiva de CVs' };
  vacancies.forEach(v => { titles[v.id] = v.title; });

  const confirm = async () => {
    if (!target || working) return;
    setWorking(true);
    try {
      const existing = await fetchVacanciesByCandidate(apps.map(a => a.candidateId));
      const plan = planVacancyMove(apps, target, existing);
      if (plan.ready.length > 0) {
        await executeVacancyMove(plan.ready, {
          mode, targetVacancyId: target, targetVacancyTitle: titles[target] || target,
          vacancyTitles: titles, stage,
        });
      }
      const name = (a: MovableApp) => a.candidateName || 'Sin nombre';
      setSummary({
        mode,
        target: titles[target] || target,
        done: plan.ready.length,
        alreadyThere: plan.alreadyThere.map(name),
        conflicts: plan.conflicts.map(name),
      });
      if (plan.ready.length > 0) onDone?.();
    } catch (e) {
      console.error('No se pudo mover a la vacante:', e);
      alert('No se pudo completar la operación. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setWorking(false);
    }
  };

  const count = apps.length;
  const who = count === 1 ? (apps[0]?.candidateName || 'este candidato') : `${count} candidatos`;

  return (
    <Modal isOpen={isOpen} onClose={working ? undefined : onClose} overlayClassName="bg-slate-900/50 z-[120]">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl relative">
        <button onClick={onClose} disabled={working} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600" aria-label="Cerrar">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center mb-5">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl mr-3">
            <ArrowRightLeft className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Cambiar de vacante</h2>
            <p className="text-xs text-slate-500">{who}</p>
          </div>
        </div>

        {summary ? (
          <div className="space-y-3">
            {summary.done > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                <CheckCircle className="w-5 h-5 flex-shrink-0" />
                <span>
                  {summary.done} {summary.done === 1 ? 'perfil' : 'perfiles'} {summary.mode === 'move' ? 'movido(s)' : 'copiado(s)'} a <strong>{summary.target}</strong>.
                </span>
              </div>
            )}
            {summary.conflicts.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>Ya tenían una postulación en <strong>{summary.target}</strong> (no se duplicaron): {summary.conflicts.join(', ')}.</span>
              </div>
            )}
            {summary.alreadyThere.length > 0 && (
              <p className="text-xs text-slate-500">Ya estaban en esa vacante: {summary.alreadyThere.join(', ')}.</p>
            )}
            <div className="flex justify-end pt-2">
              <button onClick={onClose} className="px-5 py-2 text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl">Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1 block">Vacante destino</label>
                <select
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                >
                  <option value="">— Elige la vacante —</option>
                  {vacancies.map(v => (
                    <option key={v.id} value={v.id} disabled={count === 1 && currentVacancies.has(v.id)}>
                      {v.title}{v.active ? '' : ' (no publicada)'}{count === 1 && currentVacancies.has(v.id) ? ' — actual' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'move', icon: ArrowRightLeft, title: 'Mover', desc: 'Sale de la vacante actual con todo su historial, notas y evaluaciones.' },
                  { id: 'copy', icon: Copy, title: 'Copiar', desc: 'Se queda donde está y además entra a la nueva con su CV.' },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setMode(opt.id)}
                    className={`text-left p-3 rounded-xl border-2 transition-colors ${mode === opt.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}
                  >
                    <span className="flex items-center text-sm font-bold text-slate-800"><opt.icon className="w-4 h-4 mr-1.5" />{opt.title}</span>
                    <span className="block text-[11px] text-slate-500 mt-1 leading-snug">{opt.desc}</span>
                  </button>
                ))}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 mb-1 block">Etapa en la nueva vacante</label>
                <select
                  value={stage}
                  onChange={e => setStage(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                >
                  <option value={KEEP_STAGE}>Mantener la etapa actual</option>
                  {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">No se envía ningún WhatsApp al candidato por este cambio.</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={onClose} disabled={working} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button
                onClick={confirm}
                disabled={!target || working || count === 0}
                className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center"
              >
                {working ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRightLeft className="w-4 h-4 mr-2" />}
                {mode === 'move' ? 'Mover' : 'Copiar'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
