import { useState } from 'react';
import { doc, getDoc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { AlertTriangle, BrainCircuit, CheckCircle, Copy, ExternalLink, Fingerprint, HelpCircle, Loader2, Play, QrCode, RefreshCw, RotateCcw, X } from 'lucide-react';
import { db } from '../lib/firebase';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import LinkQrModal from './LinkQrModal';
import StationPanel from './StationPanel';
import { syncStationsFor } from '../lib/stationActions';
import {
  resolvePersonalityTemplate, snapshotForApplication, templateIssues, newItemId, dimensionReading, answerLabel,
  LEVEL_LABEL, type PersonalityDimension, type PersonalityQuestion, type DimensionResult,
} from '../lib/personalityTest';

/**
 * El Test de Personalidad en el perfil del candidato.
 *
 * La entrevistadora lo aplica cuando lo decide. Lo más directo es "Enviar a un teléfono":
 * en un solo paso guarda en la postulación la versión actual del test (de Formularios) y
 * el teléfono de la empresa que elija lo abre solo (modo estación). También puede
 * aplicarlo y abrirlo en esta pantalla, con QR o con el link. El perfil escucha la
 * postulación en vivo, así que el resultado aparece aquí en cuanto termina.
 */
interface Props {
  application: any;
  candidateName?: string;
  /** Otra postulación de esta persona donde ya respondió el test (la personalidad no cambia por vacante). */
  completedElsewhere?: string;
}

const toMs = (t: any): number => (t?.toMillis ? t.toMillis() : (t ? new Date(t).getTime() || 0 : 0));
const fmtDate = (t: any): string => {
  const ms = toMs(t);
  return ms ? new Date(ms).toLocaleString('es-DO', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};

const LEVEL_STYLE: Record<string, string> = {
  bajo: 'bg-slate-100 text-slate-700',
  medio: 'bg-blue-50 text-blue-800',
  alto: 'bg-violet-100 text-violet-800',
};

export default function PersonalityTestCard({ application, candidateName, completedElsewhere }: Props) {
  const { user } = useAuth();
  const [busy, setBusy] = useState<'' | 'start' | 'cancel' | 'delete'>('');
  const [error, setError] = useState('');
  const [showQr, setShowQr] = useState(false);
  // En qué teléfono de la empresa está (modo estación): entonces sobran el QR y el link.
  const [onPhone, setOnPhone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const [aiError, setAiError] = useState('');

  const pt = application?.personalityTest;
  const status: 'none' | 'open' | 'completed' = pt?.status === 'completed' ? 'completed' : pt?.status === 'open' ? 'open' : 'none';
  const url = `${window.location.origin}/personalidad/${application?.id}`;
  const ref = () => doc(db, 'applications', application.id);

  // Aplica la versión ACTUAL del test (leída en el momento, no la que cargó esta pantalla).
  // Devuelve si quedó aplicado: "Enviar a un teléfono" solo envía si lo está.
  const apply = async (): Promise<boolean> => {
    setError('');
    try {
      const snap = await getDoc(doc(db, 'settings', 'forms'));
      const tpl = resolvePersonalityTemplate(snap.exists() ? snap.data()?.personalityTest : null);
      const blocking = templateIssues(tpl).filter(i => i.blocking);
      if (blocking.length > 0) {
        setError(`El test tiene errores y no se puede aplicar: ${blocking[0].message} Corrígelo en Formularios.`);
        return false;
      }
      await updateDoc(ref(), {
        personalityTest: {
          ...JSON.parse(JSON.stringify(snapshotForApplication(tpl, newItemId('t')))),
          candidateName: candidateName || '',
          openedAt: serverTimestamp(),
          openedBy: user?.displayName || user?.email || '',
        },
      });
      return true;
    } catch (e) {
      console.error('No se pudo aplicar el test de personalidad:', e);
      setError('No se pudo aplicar el test. Revisa tu conexión e inténtalo de nuevo.');
      return false;
    }
  };

  const start = async () => {
    const restarting = status === 'open';
    if (restarting && !window.confirm('¿Reiniciar el test con la versión actual de Formularios? Si el candidato lo tiene abierto, tendrá que empezar de nuevo.')) return;
    setBusy('start');
    try {
      if ((await apply()) && restarting) {
        // Si lo tiene un teléfono de la empresa, lo vuelve a abrir allí con el intento nuevo.
        await syncStationsFor(application.id, 'personality', 'resend')
          .catch(e => console.warn('No se pudo reabrir el test en el teléfono:', e));
      }
    } finally {
      setBusy('');
    }
  };

  const remove = async (kind: 'cancel' | 'delete') => {
    const msg = kind === 'cancel'
      ? '¿Cancelar el test? El link dejará de funcionar hasta que lo vuelvas a aplicar.'
      : '¿Eliminar el resultado del test de personalidad? Se borran sus respuestas y podrás aplicarlo de nuevo.';
    if (!window.confirm(msg)) return;
    setBusy(kind);
    setError('');
    try {
      await updateDoc(ref(), { personalityTest: deleteField() });
      // Cancelado mientras lo tenía un teléfono de la empresa: el teléfono queda libre.
      if (kind === 'cancel') {
        await syncStationsFor(application.id, 'personality', 'clear')
          .catch(e => console.warn('No se pudo liberar el teléfono:', e));
      }
    } catch (e) {
      console.error('No se pudo quitar el test de personalidad:', e);
      setError('No se pudo completar la acción. Inténtalo de nuevo.');
    } finally {
      setBusy('');
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copia este link manualmente:', url);
    }
  };

  const interpret = async () => {
    setInterpreting(true);
    setAiError('');
    try {
      const res = await apiFetch('/api/personality/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: application.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.interpretation) throw new Error(data?.error || 'No se pudo interpretar el test con IA.');
      // Sin Admin SDK (desarrollo) el servidor no puede guardarla: se guarda desde aquí.
      if (data.saved === false) await updateDoc(ref(), { 'personalityTest.aiInterpretation': data.interpretation });
    } catch (e: any) {
      console.error('Error interpreting personality test:', e);
      setAiError(e?.message || 'No se pudo interpretar el test con IA.');
    } finally {
      setInterpreting(false);
    }
  };

  const dims: PersonalityDimension[] = Array.isArray(pt?.dimensions) ? pt.dimensions : [];
  const questions: PersonalityQuestion[] = Array.isArray(pt?.questions) ? pt.questions : [];
  const answers: Record<string, unknown> = pt?.answers && typeof pt.answers === 'object' ? pt.answers : {};
  const results: DimensionResult[] = Array.isArray(pt?.results?.dimensions) ? pt.results.dimensions : [];
  const warnings: string[] = Array.isArray(pt?.results?.warnings) ? pt.results.warnings : [];
  const openAnswers = questions.filter(q => q.type !== 'likert' && answerLabel(q, answers[q.id]));
  const scaleAnswers = questions.filter(q => q.type === 'likert' && answerLabel(q, answers[q.id]));
  const ai = pt?.aiInterpretation;

  return (
    <div id="personality-test-card" className="glass-card rounded-2xl lg:rounded-3xl p-5 lg:p-6 border border-fuchsia-100">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 lg:mb-4">
        <h3 className="text-[10px] lg:text-sm font-display font-bold text-slate-400 uppercase tracking-widest flex items-center">
          <Fingerprint className="w-4 h-4 mr-2 text-fuchsia-500" /> {status === 'none' ? 'Test de personalidad' : (pt?.name || 'Test de personalidad')}
        </h3>
        {status === 'completed' && (
          <button
            onClick={() => remove('delete')}
            disabled={!!busy}
            className="text-[10px] font-bold bg-rose-100 text-rose-700 hover:bg-rose-200 px-2 py-1 rounded-md flex items-center transition-colors disabled:opacity-50"
          >
            {busy === 'delete' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <X className="w-3 h-3 mr-1" />} Eliminar
          </button>
        )}
      </div>

      {error && (
        <p className="mb-3 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 flex items-start">
          <AlertTriangle className="w-3.5 h-3.5 mr-2 mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {/* Pendiente o aplicado: el panel de teléfonos queda en el mismo sitio en los dos
          estados, para que al aplicar-y-enviar no se desmonte a mitad del envío. */}
      {status !== 'completed' && (
        <div className="space-y-3">
          {status === 'none' ? (
            <p className="text-xs lg:text-sm text-slate-500">
              Se responde en persona, cuando tú decidas: en un teléfono de la empresa, en esta pantalla o con QR.
              Mide sus rasgos de personalidad y el resultado aparece aquí al terminar.
              {completedElsewhere && (
                <span className="block mt-1 text-[11px] font-bold text-amber-700">
                  Ya lo respondió en su postulación a {completedElsewhere} (elígela arriba para verlo).
                </span>
              )}
            </p>
          ) : (
            <p className="text-xs font-medium text-fuchsia-800 bg-fuchsia-50 border border-fuchsia-100 rounded-lg px-3 py-2 flex items-start">
              <Loader2 className="w-3.5 h-3.5 mr-2 mt-0.5 animate-spin shrink-0" />
              <span>
                <span className="block">Habilitado{pt?.openedBy ? ` por ${pt.openedBy}` : ''}{fmtDate(pt?.openedAt) ? ` · ${fmtDate(pt.openedAt)}` : ''}</span>
                Esperando las respuestas del candidato ({questions.length} preguntas); el resultado aparecerá aquí solo.
              </span>
            </p>
          )}
          {application?.id && (
            <StationPanel
              kind="personality"
              accent="fuchsia"
              application={application}
              candidateName={candidateName || application.candidateName || ''}
              prepare={status === 'none' ? apply : undefined}
              onPlacement={setOnPhone}
            />
          )}
          {status === 'none' ? (
            <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400">
              <span>O aplícalo para abrirlo en esta pantalla o con QR:</span>
              <button
                onClick={start}
                disabled={!!busy || !application?.id}
                className="flex items-center px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-[11px] font-bold rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {busy === 'start' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
                Aplicar test ahora
              </button>
            </div>
          ) : (
            <>
              {!onPhone && <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center p-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-colors text-xs lg:text-sm"
                >
                  <ExternalLink className="w-4 h-4 mr-2" /> Abrir en esta pantalla
                </a>
                <button
                  onClick={() => setShowQr(true)}
                  className="flex items-center justify-center p-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-colors text-xs lg:text-sm"
                >
                  <QrCode className="w-4 h-4 mr-2" /> QR para su teléfono
                </button>
                <button
                  onClick={copyLink}
                  className="flex items-center justify-center p-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-colors text-xs lg:text-sm"
                >
                  {copied ? <CheckCircle className="w-4 h-4 mr-2 text-emerald-600" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copied ? 'Link copiado' : 'Copiar link'}
                </button>
              </div>}
              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  onClick={start}
                  disabled={!!busy}
                  className="text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-md flex items-center transition-colors disabled:opacity-50"
                >
                  {busy === 'start' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RotateCcw className="w-3 h-3 mr-1" />} Reiniciar
                </button>
                <button
                  onClick={() => remove('cancel')}
                  disabled={!!busy}
                  className="text-[10px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 px-2 py-1 rounded-md flex items-center transition-colors disabled:opacity-50"
                >
                  {busy === 'cancel' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <X className="w-3 h-3 mr-1" />} Cancelar test
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {status === 'completed' && (
        <div className="space-y-4">
          <p className="text-[11px] text-slate-500">
            <span className="block">Respondido{fmtDate(pt?.completedAt) ? ` el ${fmtDate(pt.completedAt)}` : ''}{pt?.station?.name ? ` en ${pt.station.name}` : ''}{pt?.openedBy ? ` · aplicado por ${pt.openedBy}` : ''}</span>
            Es un autoinforme: muestra tendencias para conversar y validar en la entrevista, no un diagnóstico.
          </p>

          {warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 space-y-1">
              {warnings.map((w, i) => (
                <p key={i} className="flex items-start"><AlertTriangle className="w-3.5 h-3.5 mr-2 mt-0.5 shrink-0" /> {w}</p>
              ))}
            </div>
          )}

          {results.length > 0 ? (
            <div className="space-y-3">
              {results.map(r => {
                const d = dims.find(x => x.id === r.id);
                return (
                  <div key={r.id} className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs lg:text-sm font-bold text-slate-800">{r.name}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${LEVEL_STYLE[r.level] || ''}`}>{LEVEL_LABEL[r.level]}</span>
                        <span className="text-xs font-black text-slate-700 tabular-nums">{r.score}/100</span>
                      </span>
                    </div>
                    <div
                      className="h-2 bg-slate-200 rounded-full overflow-hidden"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={r.score}
                      aria-label={`${r.name}: ${r.score} de 100`}
                    >
                      <div className="h-full bg-fuchsia-500 rounded-full" style={{ width: `${Math.max(2, r.score)}%` }} />
                    </div>
                    {dimensionReading(d, r.level) && <p className="text-[11px] text-slate-600 mt-1.5">{dimensionReading(d, r.level)}</p>}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Este test no tenía preguntas de escala asignadas a rasgos, así que no hay puntajes.</p>
          )}

          {openAnswers.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase">Respuestas abiertas y de opción múltiple</h4>
              {openAnswers.map(q => (
                <div key={q.id} className="bg-slate-50 p-2 lg:p-3 rounded-lg lg:rounded-xl border border-slate-100">
                  <p className="text-[9px] lg:text-xs font-bold text-slate-400 mb-0.5">{q.text}</p>
                  <p className="text-xs lg:text-sm font-medium text-slate-800 whitespace-pre-wrap">{answerLabel(q, answers[q.id])}</p>
                </div>
              ))}
            </div>
          )}

          {scaleAnswers.length > 0 && (
            <details>
              <summary className="text-[11px] font-bold text-fuchsia-700 cursor-pointer">Ver las {scaleAnswers.length} respuestas de escala</summary>
              <div className="mt-2 space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {scaleAnswers.map(q => {
                  const d = dims.find(x => x.id === q.dimensionId);
                  return (
                    <div key={q.id} className="bg-white border border-slate-100 rounded-lg p-2">
                      <p className="text-[11px] text-slate-700">{q.text}</p>
                      <p className="text-[11px] font-bold text-slate-800 mt-0.5">
                        {answerLabel(q, answers[q.id])}
                        <span className="font-medium text-slate-400"> · {d ? d.name : 'no puntúa'}{q.reverse ? ' (invertida)' : ''}</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* Interpretación con IA */}
          <div className="border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase flex items-center">
                <BrainCircuit className="w-3.5 h-3.5 mr-1.5 text-violet-500" /> Interpretación IA
              </h4>
              <button
                onClick={interpret}
                disabled={interpreting}
                className="text-[10px] font-bold bg-violet-100 text-violet-700 hover:bg-violet-200 px-2 py-1 rounded-md flex items-center transition-colors disabled:opacity-50"
              >
                {interpreting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                {ai ? 'Volver a interpretar' : 'Interpretar con IA'}
              </button>
            </div>
            {aiError && <p className="mb-2 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{aiError}</p>}
            {interpreting && <p className="text-xs text-violet-700">La IA está leyendo el resultado y las respuestas…</p>}
            {!ai && !interpreting && (
              <p className="text-xs text-slate-500">Traduce el resultado a un perfil práctico: fortalezas, qué explorar, cómo trabaja y su encaje con la vacante.</p>
            )}
            {ai && (
              <div className="space-y-3 text-xs lg:text-sm text-slate-700">
                {ai.summary && <p className="bg-violet-50/60 border border-violet-100 rounded-xl p-3 italic">"{ai.summary}"</p>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {ai.strengths?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-emerald-700 uppercase mb-1">Fortalezas</p>
                      <ul className="space-y-1">{ai.strengths.map((s: string, i: number) => <li key={i} className="flex items-start"><CheckCircle className="w-3.5 h-3.5 mr-1.5 mt-0.5 text-emerald-600 shrink-0" />{s}</li>)}</ul>
                    </div>
                  )}
                  {ai.watch_outs?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-amber-700 uppercase mb-1">A explorar</p>
                      <ul className="space-y-1">{ai.watch_outs.map((s: string, i: number) => <li key={i} className="flex items-start"><AlertTriangle className="w-3.5 h-3.5 mr-1.5 mt-0.5 text-amber-600 shrink-0" />{s}</li>)}</ul>
                    </div>
                  )}
                </div>
                {ai.work_style && <p><span className="font-bold">Cómo trabaja: </span>{ai.work_style}</p>}
                {ai.role_fit && <p><span className="font-bold">Encaje con la vacante: </span>{ai.role_fit}</p>}
                {ai.follow_up_questions?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Preguntas para validar en la entrevista</p>
                    <ul className="space-y-1">{ai.follow_up_questions.map((s: string, i: number) => <li key={i} className="flex items-start"><HelpCircle className="w-3.5 h-3.5 mr-1.5 mt-0.5 text-slate-400 shrink-0" />{s}</li>)}</ul>
                  </div>
                )}
                {fmtDate(ai.interpretedAt) && <p className="text-[10px] text-slate-400">Interpretado el {fmtDate(ai.interpretedAt)}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      <LinkQrModal
        isOpen={showQr}
        onClose={() => setShowQr(false)}
        url={url}
        title="Escanea para responder"
        hint="El candidato abre la cámara de su teléfono y apunta a este código."
        label="QR del test de personalidad"
      />
    </div>
  );
}
