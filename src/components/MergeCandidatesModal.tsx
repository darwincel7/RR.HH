import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Loader2, Users, AlertTriangle, ArrowRight, Search, CheckCircle, X, Merge } from 'lucide-react';
import Modal from './ui/Modal';
import CandidateAvatar from './CandidateAvatar';
import { apiFetch } from '../lib/api';
import {
  findDuplicateCandidates, planCandidateMerge, normalizeName,
  DUPLICATE_REASON_LABEL, type DuplicateCandidate,
} from '../lib/mergeCandidates';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** El perfil que SOBREVIVE (el que está abierto). */
  primaryId: string;
  primary: any;
  /** Postulaciones del principal, ya cargadas por el perfil. */
  primaryApps: any[];
  /** Se llama al terminar, con el resumen del servidor. */
  onMerged?: (summary: any) => void;
}

/**
 * Unificar dos perfiles del mismo postulante.
 *
 * Primero propone los parecidos (mismo teléfono, correo o nombre) y deja buscar
 * cualquier otro; después muestra EXACTAMENTE qué va a pasar — qué postulaciones se
 * mudan, cuáles se combinan, qué evidencia llega y qué se archiva — y solo entonces
 * aparece el botón de confirmar. La vista previa la calcula el mismo módulo que usa el
 * servidor para ejecutarla (`mergeCandidates.ts`), así que no puede prometer otra cosa.
 */
export default function MergeCandidatesModal({ isOpen, onClose, primaryId, primary, primaryApps, onMerged }: Props) {
  const [allCandidates, setAllCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [term, setTerm] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selectedApps, setSelectedApps] = useState<any[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [vacancyTitles, setVacancyTitles] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<any>(null);

  // Se carga al abrir (no antes): es una lectura de toda la colección de candidatos.
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const [candSnap, vacSnap] = await Promise.all([
          getDocs(collection(db, 'candidates')),
          getDocs(collection(db, 'vacancies')),
        ]);
        setAllCandidates(candSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        const titles: Record<string, string> = {};
        vacSnap.docs.forEach(d => { titles[d.id] = (d.data() as any).title || 'Vacante'; });
        setVacancyTitles(titles);
      } catch (e) {
        console.error('No se pudieron cargar los perfiles:', e);
        setError('No se pudieron cargar los perfiles para comparar.');
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen]);

  // Al cerrar se olvida todo: reabrir con una selección vieja es la forma de unificar al
  // candidato equivocado.
  useEffect(() => {
    if (!isOpen) {
      setTerm(''); setSelectedId(''); setSelectedApps([]); setDone(null); setError('');
    }
  }, [isOpen]);

  const suggestions = useMemo(
    () => findDuplicateCandidates({ id: primaryId, ...primary }, allCandidates),
    [primaryId, primary, allCandidates],
  );

  const searchResults = useMemo(() => {
    const q = normalizeName(term);
    const digits = term.replace(/\D/g, '');
    if (q.length < 3 && digits.length < 4) return [] as DuplicateCandidate[];
    return allCandidates
      .filter(c => c.id !== primaryId && !c.mergedInto)
      .filter(c => {
        const name = normalizeName(c.fullName || c.name);
        const phone = String(c.phoneNormalized || c.phone || '').replace(/\D/g, '');
        const email = String(c.email || '').toLowerCase();
        return (q.length >= 3 && (name.includes(q) || email.includes(q)))
          || (digits.length >= 4 && phone.includes(digits));
      })
      .slice(0, 12)
      .map(c => ({ id: c.id, reasons: [], candidate: c } as DuplicateCandidate));
  }, [term, allCandidates, primaryId]);

  const selected = allCandidates.find(c => c.id === selectedId) || null;

  // Las postulaciones del duplicado: sin ellas la vista previa no sabe qué se mueve.
  useEffect(() => {
    if (!selectedId) { setSelectedApps([]); return; }
    let alive = true;
    setLoadingApps(true);
    getDocs(query(collection(db, 'applications'), where('candidateId', '==', selectedId)))
      .then(snap => { if (alive) setSelectedApps(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))); })
      .catch(e => { console.error('No se pudieron cargar sus postulaciones:', e); if (alive) setError('No se pudieron cargar las postulaciones de ese perfil.'); })
      .finally(() => { if (alive) setLoadingApps(false); });
    return () => { alive = false; };
  }, [selectedId]);

  const plan = useMemo(() => {
    if (!selected) return null;
    return planCandidateMerge({ primary, primaryApps, duplicate: selected, duplicateApps: selectedApps, vacancyTitles });
  }, [selected, primary, primaryApps, selectedApps, vacancyTitles]);

  const runMerge = async () => {
    if (!selectedId) return;
    setMerging(true);
    setError('');
    try {
      const res = await apiFetch('/api/candidates/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryId, duplicateId: selectedId }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data?.success) throw new Error(data?.error || 'No se pudo unificar los perfiles.');
      setDone(data);
      onMerged?.(data);
    } catch (e: any) {
      setError(e?.message || 'No se pudo unificar los perfiles.');
    } finally {
      setMerging(false);
    }
  };

  const nameOf = (c: any) => c?.fullName || c?.name || 'Sin nombre';

  const Row: React.FC<{ item: DuplicateCandidate }> = ({ item }) => {
    const c = item.candidate;
    const on = selectedId === item.id;
    return (
      <button
        type="button"
        onClick={() => setSelectedId(on ? '' : item.id)}
        className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
          on ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-slate-200 hover:border-violet-300 bg-white'
        }`}
      >
        <CandidateAvatar photoUrl={c.photoUrl} name={nameOf(c)} size={36} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800 truncate">{nameOf(c)}</p>
          <p className="text-[11px] text-slate-500 truncate">
            {[c.phone, c.email, c.city].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
          </p>
          {item.reasons.length > 0 && (
            <p className="text-[10px] font-bold text-violet-600 mt-0.5">
              {item.reasons.map(r => DUPLICATE_REASON_LABEL[r]).join(' · ')}
            </p>
          )}
        </div>
        {on && <CheckCircle className="w-5 h-5 text-violet-600 shrink-0" />}
      </button>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} closeOnBackdrop overlayClassName="bg-slate-900/60 z-[105]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Merge className="w-5 h-5 text-violet-600 shrink-0" />
            <div className="min-w-0">
              <h2 className="font-bold text-slate-800 truncate">Unificar perfiles duplicados</h2>
              <p className="text-[11px] text-slate-500 truncate">
                Todo se junta en <strong>{nameOf(primary)}</strong>, el perfil que tienes abierto.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {done ? (
            <div className="text-center py-6">
              <CheckCircle className="w-14 h-14 mx-auto text-emerald-500 mb-3" />
              <h3 className="text-lg font-bold text-slate-800 mb-1">Perfiles unificados</h3>
              <p className="text-sm text-slate-500 mb-5">
                Todo quedó en <strong>{nameOf(primary)}</strong>. El perfil duplicado ya no recibe postulaciones ni mensajes.
              </p>
              <ul className="text-left text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5 max-w-md mx-auto">
                {done.moved?.length > 0 && <li>↔️ {done.moved.length} postulación(es) movida(s): {done.moved.map((m: any) => m.vacancyTitle).join(', ')}</li>}
                {done.combined?.map((c: any, i: number) => (
                  <li key={i}>
                    🔗 <strong>{c.vacancyTitle}</strong>: una sola postulación en etapa "{c.stage}"
                    {c.taken?.length > 0 && <> · llegó: {c.taken.join(', ')}</>}
                    {c.archived?.length > 0 && <> · archivado para consultar: {c.archived.join(', ')}</>}
                  </li>
                ))}
                {done.filled?.length > 0 && <li>✍️ Datos completados: {done.filled.join(', ')}</li>}
                {done.alternatePhones?.length > 0 && <li>📞 Teléfono alternativo guardado: {done.alternatePhones.join(', ')}</li>}
                {done.notes > 0 && <li>📝 {done.notes} nota(s)</li>}
                {done.messages > 0 && <li>💬 {done.messages} mensaje(s) de WhatsApp</li>}
                {done.participants > 0 && <li>📅 {done.participants} cita(s) de entrevista</li>}
              </ul>
              {/* Las postulaciones ya se unificaron; si algo secundario no se pudo mover,
                  se dice en vez de darlo por bueno. */}
              {done.warnings?.length > 0 && (
                <div className="mt-3 max-w-md mx-auto text-left text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <strong className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Quedó algo pendiente</strong>
                  <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    {done.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                  </ul>
                  <button
                    onClick={runMerge}
                    disabled={merging}
                    className="mt-2 px-3 py-1.5 bg-amber-600 text-white font-bold rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Reintentar lo pendiente
                  </button>
                </div>
              )}
              <button onClick={onClose} className="mt-5 px-5 py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 text-sm">
                Listo
              </button>
            </div>
          ) : (
            <>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Buscando perfiles parecidos…
                </div>
              ) : (
                <>
                  <div>
                    <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                      Perfiles que parecen la misma persona
                    </h3>
                    {suggestions.length === 0 ? (
                      <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
                        Ninguno coincide por teléfono, correo ni nombre completo. Si el duplicado se registró con otro
                        número y otro nombre escrito distinto, búscalo abajo.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {suggestions.slice(0, 6).map(s => <Row key={s.id} item={s} />)}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                      O busca el perfil duplicado
                    </h3>
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        value={term}
                        onChange={e => setTerm(e.target.value)}
                        placeholder="Nombre, teléfono o correo…"
                        className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                      />
                    </div>
                    {term.trim().length > 0 && (
                      <div className="mt-2 space-y-2">
                        {searchResults.length === 0
                          ? <p className="text-xs text-slate-400 px-1">Sin resultados (escribe al menos 3 letras o 4 dígitos).</p>
                          : searchResults.map(s => <Row key={s.id} item={s} />)}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Vista previa: exactamente lo que el servidor va a hacer. */}
              {selected && (
                <div className="border-t border-slate-100 pt-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700 mb-3">
                    <span className="truncate max-w-[40%]">{nameOf(selected)}</span>
                    <ArrowRight className="w-4 h-4 text-violet-500 shrink-0" />
                    <span className="truncate max-w-[40%]">{nameOf(primary)}</span>
                  </div>

                  {loadingApps ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Revisando sus postulaciones…
                    </div>
                  ) : plan?.empty ? (
                    <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
                      Ese perfil no aporta nada nuevo: no tiene postulaciones ni datos que al principal le falten.
                      Si de verdad es la misma persona, puedes unificarlo igual para dejarlo fuera de la base.
                    </p>
                  ) : (
                    <ul className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                      {plan?.moves.map(m => (
                        <li key={m.appId}>
                          ↔️ Se mueve su postulación a <strong>{m.vacancyTitle}</strong> (etapa "{m.stage}"), con su
                          test, formulario y entrevista. Los links ya enviados siguen funcionando.
                        </li>
                      ))}
                      {plan?.combines.map(c => (
                        <li key={c.fromAppId}>
                          🔗 Los dos aplicaron a <strong>{c.vacancyTitle}</strong>: quedará una sola postulación
                          {c.stageChanged ? <> en la etapa más avanzada (<strong>{c.stage}</strong>)</> : <> en "{c.stage}"</>}.
                          {c.taken.length > 0 && <> Llega del duplicado: <strong>{c.taken.join(', ')}</strong>.</>}
                          {c.archived.length > 0 && (
                            <> Los dos tienen <strong>{c.archived.join(', ')}</strong>: se conserva el de este perfil y
                            el del duplicado queda archivado en la postulación para consultarlo.</>
                          )}
                        </li>
                      ))}
                      {plan && plan.filled.length > 0 && <li>✍️ Se completan datos vacíos: <strong>{plan.filled.join(', ')}</strong>.</li>}
                      {plan && plan.alternatePhones.length > 0 && (
                        <li>📞 Se guarda su otro teléfono (<strong>{plan.alternatePhones.join(', ')}</strong>) para que el buscador lo encuentre.</li>
                      )}
                      <li>📝💬📅 Sus notas, su historial de WhatsApp y sus citas de entrevista pasan a este perfil.</li>
                      <li className="text-slate-500">
                        El perfil duplicado no se borra: queda marcado como unificado, deja de recibir postulaciones y
                        mensajes, y sus links viejos llevan aquí.
                      </li>
                    </ul>
                  )}

                  <div className="mt-3 flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Revisa que sea la misma persona: esto no se deshace con un botón. Dos personas distintas que
                      comparten un teléfono (familia, un mismo celular) NO deben unificarse.
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <p className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">{error}</p>
              )}
            </>
          )}
        </div>

        {!done && (
          <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              {selected ? '1 perfil seleccionado' : 'Elige el perfil duplicado'}
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Cancelar
              </button>
              <button
                onClick={runMerge}
                disabled={!selectedId || merging || loadingApps}
                className="px-5 py-2 bg-violet-600 text-white text-sm font-bold rounded-xl hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2"
              >
                {merging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Merge className="w-4 h-4" />}
                {merging ? 'Unificando…' : 'Unificar en este perfil'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
