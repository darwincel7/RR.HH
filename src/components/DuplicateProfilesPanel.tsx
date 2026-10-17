import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Loader2, Users, CheckCircle, X, Merge, ArrowRight } from 'lucide-react';
import Modal from './ui/Modal';
import CandidateAvatar from './CandidateAvatar';
import MergeCandidatesModal from './MergeCandidatesModal';
import { groupDuplicates, countRedundantProfiles, type DuplicateGroup } from '../lib/duplicateGroups';
import { DUPLICATE_REASON_LABEL } from '../lib/mergeCandidates';

/**
 * Los duplicados que YA están en la base, todos juntos.
 *
 * El aviso del perfil solo aparece si alguien abre por casualidad uno de los dos
 * perfiles. Esta pantalla responde la pregunta con la que se limpia de verdad: cuántos
 * hay y cuáles son.
 *
 * Quién sobrevive lo decide una persona, nunca el sistema: dentro de cada grupo se
 * propone el perfil más completo primero, pero la unificación se lanza desde el perfil
 * que el reclutador elija, y pasa por la misma vista previa de siempre.
 */
export default function DuplicateProfilesPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [merge, setMerge] = useState<{ primary: any; duplicateId?: string } | null>(null);
  /** Grupos ya resueltos en esta sesión: desaparecen de la lista sin recargar la base. */
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const snap = await getDocs(collection(db, 'candidates'));
      setCandidates(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    } catch (e) {
      console.error('No se pudo leer la base de candidatos:', e);
      setError('No se pudo leer la base de candidatos.');
    } finally {
      setLoading(false);
    }
  };

  // Se lee al abrir: es la colección completa de candidatos, no algo que hacer de fondo.
  useEffect(() => {
    if (!isOpen) return;
    setResolved(new Set());
    load();
  }, [isOpen]);

  const groups = useMemo(() => groupDuplicates(candidates), [candidates]);
  // Los ya unificados se quitan de su grupo, así el contador de "perfiles de más"
  // baja de verdad a medida que se limpian y un grupo de dos desaparece al resolverlo.
  const visible = useMemo(
    () => groups
      .map(g => ({ ...g, members: g.members.filter(m => !resolved.has(m.id)) }))
      .filter(g => g.members.length > 1),
    [groups, resolved],
  );
  const redundant = countRedundantProfiles(visible);

  const nameOf = (c: any) => c?.fullName || c?.name || 'Sin nombre';

  const Group: React.FC<{ group: DuplicateGroup }> = ({ group }) => {
    const members = group.members;
    return (
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <span className="text-xs font-bold text-slate-700">
            {members.length} perfiles · {nameOf(members[0])}
          </span>
          <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
            {group.reasons.map(r => DUPLICATE_REASON_LABEL[r]).join(' · ')}
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {members.map((m, i) => (
            <div key={m.id} className="flex items-center gap-3 p-3">
              <CandidateAvatar photoUrl={m.photoUrl} name={nameOf(m)} size={36} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800 truncate">
                  {nameOf(m)}
                  {i === 0 && <span className="ml-2 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">más completo</span>}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {[m.phone, m.email, m.city].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                </p>
              </div>
              <button
                onClick={() => setMerge({
                  primary: m,
                  // Con dos perfiles, el otro ya viene elegido: un clic menos y menos
                  // forma de equivocarse. Con tres o más, se elige en el modal.
                  duplicateId: members.length === 2 ? members.find(x => x.id !== m.id)?.id : undefined,
                })}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 text-violet-700 text-[11px] font-bold rounded-lg hover:bg-violet-100 transition-colors"
                title={`Unificar en el perfil de ${nameOf(m)}: este sobrevive y el resto se junta aquí`}
              >
                <Merge className="w-3.5 h-3.5" /> Unificar aquí
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} closeOnBackdrop overlayClassName="bg-slate-900/60 z-[100]">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Users className="w-5 h-5 text-violet-600 shrink-0" />
              <div className="min-w-0">
                <h2 className="font-bold text-slate-800">Perfiles duplicados en la base</h2>
                <p className="text-[11px] text-slate-500">
                  Mismo teléfono, mismo correo o mismo nombre completo. Tú eliges cuál sobrevive.
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Revisando toda la base…
              </div>
            ) : error ? (
              <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-4">{error}</p>
            ) : visible.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
                <p className="text-sm font-bold text-slate-700">Sin duplicados detectados</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Nadie comparte teléfono, correo ni nombre completo con otro perfil. Un duplicado escrito con otro
                  número y el nombre distinto no se puede detectar solo: ese se unifica desde el perfil.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-2.5">
                  <strong>{visible.length} grupo(s)</strong>
                  <span>· {redundant} perfil(es) de más en la base</span>
                  <span className="text-amber-700">
                    Revisa cada grupo antes de unificar: dos personas que comparten un celular (familia) no deben unificarse.
                  </span>
                </div>
                {visible.map(g => <Group key={g.members[0].id} group={g} />)}
              </>
            )}
          </div>

          <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
            <p className="text-[11px] text-slate-400">
              {candidates.length > 0 && `${candidates.length} perfiles revisados`}
            </p>
            <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
              Cerrar
            </button>
          </div>
        </div>
      </Modal>

      {/* La unificación de siempre, con su vista previa: desde aquí llega el par ya elegido. */}
      {merge && (
        <MergeCandidatesModal
          isOpen
          onClose={() => setMerge(null)}
          primaryId={merge.primary.id}
          primary={merge.primary}
          preselectedDuplicateId={merge.duplicateId}
          onMerged={(summary) => {
            // El perfil absorbido sale de la lista al instante; el resto del grupo sigue
            // visible si todavía queda más de uno (grupos de tres o más).
            if (summary?.duplicateId) setResolved(prev => new Set(prev).add(summary.duplicateId));
          }}
        />
      )}
    </>
  );
}
