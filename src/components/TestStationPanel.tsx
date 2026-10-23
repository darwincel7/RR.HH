import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRightLeft, Loader2, Send, ShieldAlert, ShieldCheck, Smartphone, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { watchStations, sendTestToStation, clearStation } from '../lib/stationActions';
import { assignedApplicationId, stationState, progressLabel, toMs, type Station } from '../lib/stations';

/**
 * El test situacional en los teléfonos de la empresa, desde el perfil (modo estación):
 * "Enviar a un teléfono" lo manda al que elijas y el teléfono lo abre solo; mientras lo
 * responde se ve en vivo dónde está y por qué pregunta va, y se puede pasar a otro
 * teléfono o cancelar. Solo mientras el test está pendiente.
 */
interface Props {
  application: { id: string; candidateId?: string };
  candidateName: string;
}

const STATE_PILL = {
  free: { label: 'Libre', cls: 'bg-emerald-100 text-emerald-700' },
  busy: { label: 'Ocupado', cls: 'bg-amber-100 text-amber-800' },
  offline: { label: 'Sin conexión', cls: 'bg-slate-100 text-slate-500' },
} as const;

const fmtTime = (ms: number) => (ms ? new Date(ms).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' }) : '');

export default function TestStationPanel({ application, candidateName }: Props) {
  const { user } = useAuth();
  const [stations, setStations] = useState<Station[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => watchStations(setStations, () => setLoadError('No se pudieron cargar los teléfonos.')), []);
  // "Sin conexión" depende de la hora: se recalcula aunque no cambie ningún documento.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const here = stations?.find(s => assignedApplicationId(s) === application.id) || null;
  const by = user?.displayName || user?.email || '';

  const send = async (stationId: string) => {
    setBusy(stationId);
    setError('');
    try {
      await sendTestToStation({
        stationId,
        fromStationId: here?.id,
        applicationId: application.id,
        candidateId: application.candidateId || '',
        candidateName,
        by,
      });
      setPicking(false);
    } catch (e: any) {
      setError(e?.message || 'No se pudo enviar el test. Inténtalo de nuevo.');
    } finally {
      setBusy('');
    }
  };

  const cancel = async () => {
    if (!here || !window.confirm(`¿Cancelar el test en ${here.name}? El teléfono vuelve a esperar candidato.`)) return;
    setBusy('cancel');
    setError('');
    try {
      await clearStation(here.id, application.id);
    } catch {
      setError('No se pudo cancelar. Inténtalo de nuevo.');
    } finally {
      setBusy('');
    }
  };

  if (loadError) return <p className="text-[11px] text-rose-700">{loadError}</p>;
  if (!stations) return <Loader2 className="w-4 h-4 animate-spin text-violet-500" />;

  const progress = here?.assignment?.progress;
  const picker = picking && (
    <div className="w-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl p-2 text-left">
      <p className="text-[10px] font-bold text-slate-400 uppercase px-2 pt-1 pb-2">
        {here ? `¿A qué teléfono lo pasas? Empezará de nuevo allí.` : '¿En qué teléfono lo hará?'}
      </p>
      {stations.length === 0 && (
        <p className="text-xs text-slate-500 px-2 pb-2">
          Aún no hay teléfonos vinculados. <Link to="/phones" className="font-bold text-violet-700 hover:underline">Vincula uno en Teléfonos</Link>.
        </p>
      )}
      {stations.map(s => {
        const state = stationState(s, now);
        const mine = s.id === here?.id;
        const otherApp = assignedApplicationId(s) && !mine;
        const detail = mine
          ? 'Aquí está ahora'
          : otherApp
            ? `${s.assignment?.candidateName || 'Otro candidato'} está respondiendo`
            : state === 'offline'
              ? `Sin conexión${toMs(s.lastSeenAt) ? ` desde las ${fmtTime(toMs(s.lastSeenAt))}` : ''}: lo abrirá al reconectarse`
              : 'Esperando candidato';
        const pill = STATE_PILL[state];
        return (
          <div key={s.id} className={`flex items-center justify-between gap-2 px-2 py-2 rounded-xl ${otherApp || mine ? 'opacity-60' : 'hover:bg-slate-50'}`}>
            <div className="min-w-0">
              <p className="text-xs lg:text-sm font-bold text-slate-800 flex items-center flex-wrap gap-x-2">
                <span className="flex items-center"><Smartphone className="w-3.5 h-3.5 mr-1 text-slate-400" />{s.name}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${pill.cls}`}>{pill.label}</span>
              </p>
              <p className="text-[10px] lg:text-[11px] text-slate-500 mt-0.5">{detail}</p>
            </div>
            {!otherApp && !mine && (
              <button
                onClick={() => send(s.id)}
                disabled={!!busy}
                className={`shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-lg flex items-center disabled:opacity-50 ${state === 'free' ? 'bg-violet-600 text-white hover:bg-violet-700 shadow' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                {busy === s.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                {here ? 'Pasar aquí' : 'Enviar'}
              </button>
            )}
          </div>
        );
      })}
      <p className="text-[10px] text-slate-400 px-2 pt-2">El teléfono lo abre solo en unos segundos. El link nunca se muestra.</p>
    </div>
  );

  if (here) {
    const confirmedAt = toMs(progress?.confirmedAt);
    const state = stationState(here, now);
    return (
      <div className="w-full text-left">
        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-3 lg:p-4">
          <p className="text-xs lg:text-sm font-bold text-violet-900 flex items-center">
            <Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" /> En {here.name}
          </p>
          <p className="text-[11px] lg:text-xs text-violet-800 mt-1">
            {confirmedAt
              ? `Confirmó su nombre a las ${fmtTime(confirmedAt)}`
              : `Enviado a las ${fmtTime(toMs(here.assignment?.assignedAt)) || '…'}; aún no lo empieza.`}
          </p>
          {progress && progress.total > 0 && progress.index >= 0 && (
            <>
              <p className="mt-2 text-[11px] font-bold text-violet-900">{progressLabel(progress)}</p>
              <div className="mt-1 h-2 bg-violet-100 rounded-full overflow-hidden">
                <div className="h-full bg-violet-600 rounded-full" style={{ width: `${Math.round(((progress.index + 1) / progress.total) * 100)}%` }} />
              </div>
            </>
          )}
          {progress && (
            progress.exits > 0
              ? <p className="text-[11px] text-amber-800 mt-2 flex items-center"><ShieldAlert className="w-3.5 h-3.5 mr-1" /> Salió de la pantalla {progress.exits} {progress.exits === 1 ? 'vez' : 'veces'}</p>
              : <p className="text-[11px] text-violet-700 mt-2 flex items-center"><ShieldCheck className="w-3.5 h-3.5 mr-1" /> No ha salido de la pantalla</p>
          )}
          {state === 'offline' && (
            <p className="text-[11px] text-amber-800 mt-2 flex items-center"><AlertTriangle className="w-3.5 h-3.5 mr-1" /> El teléfono no responde desde las {fmtTime(toMs(here.lastSeenAt))}</p>
          )}
        </div>
        {error && <p className="mt-2 text-[11px] text-rose-700">{error}</p>}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button
            onClick={() => setPicking(p => !p)}
            disabled={!!busy}
            className="text-[10px] lg:text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-md flex items-center disabled:opacity-50"
          >
            <ArrowRightLeft className="w-3 h-3 mr-1" /> Pasar a otro teléfono
          </button>
          <button
            onClick={cancel}
            disabled={!!busy}
            className="text-[10px] lg:text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 px-2.5 py-1.5 rounded-md flex items-center disabled:opacity-50"
          >
            {busy === 'cancel' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <X className="w-3 h-3 mr-1" />} Cancelar
          </button>
        </div>
        {picker}
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center">
      <button
        onClick={() => setPicking(p => !p)}
        className="flex items-center px-4 py-2 bg-violet-600 text-white text-xs lg:text-sm font-bold rounded-xl hover:bg-violet-700 transition-all shadow-md"
      >
        <Smartphone className="w-4 h-4 mr-2" /> Enviar a un teléfono
      </button>
      {error && <p className="mt-2 text-[11px] text-rose-700">{error}</p>}
      {picker}
    </div>
  );
}
