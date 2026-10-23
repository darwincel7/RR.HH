import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Smartphone, WifiOff, Clock, KeyRound, RefreshCw, Loader2, Trash2, X, CheckCircle, ExternalLink, ListChecks,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { watchStations, clearStation, unlinkStation, createPairingCode, discardPairingCode } from '../lib/stationActions';
import {
  stationState, assignedApplicationId, progressLabel, doneTodayOf, formatPairingCode, toMs, type Station,
} from '../lib/stations';

/**
 * Teléfonos de la empresa (modo estación, src/lib/stations.ts): quién está respondiendo
 * en cada uno, en vivo; liberar o desvincular; y el código para vincular uno nuevo.
 */

const STATE_STYLE = {
  free: { label: 'Libre', pill: 'bg-emerald-100 text-emerald-700', icon: 'bg-emerald-50 text-emerald-600' },
  busy: { label: 'Ocupado', pill: 'bg-amber-100 text-amber-800', icon: 'bg-amber-50 text-amber-600' },
  offline: { label: 'Sin conexión', pill: 'bg-slate-100 text-slate-500', icon: 'bg-slate-100 text-slate-400' },
} as const;

function ago(ms: number, now: number): string {
  if (!ms) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return 'ahora';
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `a las ${new Date(ms).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' })}`;
}

function PairingCard() {
  const { user } = useAuth();
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [qr, setQr] = useState('');
  const [now, setNow] = useState(Date.now());
  const stationUrl = `${window.location.origin}/estacion`;

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    import('qrcode')
      .then(m => m.default.toDataURL(stationUrl, { width: 200, margin: 1 }))
      .then(img => { if (!cancelled) setQr(img); })
      .catch(() => { /* queda el link escrito */ });
    return () => { cancelled = true; };
  }, [stationUrl]);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      if (code) await discardPairingCode(code.code);
      setCode(await createPairingCode(user?.displayName || user?.email || ''));
    } catch (e) {
      console.error('No se pudo generar el código:', e);
      setError('No se pudo generar el código. Revisa tu conexión.');
    } finally {
      setBusy(false);
    }
  };

  const left = code ? Math.max(0, code.expiresAt - now) : 0;
  const expired = !!code && left === 0;

  return (
    <div className="rounded-3xl p-5 lg:p-6 bg-white border-2 border-dashed border-violet-200">
      <p className="font-display font-bold text-slate-900 flex items-center"><KeyRound className="w-5 h-5 mr-2 text-violet-600" /> Vincular un teléfono nuevo</p>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5 items-start">
        <div className="text-center">
          {qr ? <img src={qr} alt="QR para abrir la página de estación" className="w-36 h-36 mx-auto" /> : <div className="w-36 h-36 mx-auto bg-slate-50 rounded-xl" />}
          <a href={stationUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center text-[11px] text-violet-700 font-bold break-all">
            {stationUrl.replace(/^https?:\/\//, '')} <ExternalLink className="w-3 h-3 ml-1 shrink-0" />
          </a>
        </div>
        <div>
          <ol className="text-xs lg:text-sm text-slate-600 space-y-1.5 list-decimal pl-4">
            <li>En el teléfono nuevo, escanea este QR (o escribe la dirección) para abrir la página de estación.</li>
            <li>Genera un código y escríbelo en el teléfono, con un nombre: «Teléfono 1», «Teléfono 2»…</li>
            <li>Déjalo listo una sola vez (abajo: <i>Cómo dejar listo un teléfono</i>).</li>
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {code && !expired ? (
              <div>
                <p className="text-4xl font-black tracking-[0.15em] text-violet-700 tabular-nums">{formatPairingCode(code.code)}</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Vence en {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} · sirve una sola vez
                </p>
              </div>
            ) : expired ? (
              <p className="text-xs text-amber-700 font-bold">El código venció.</p>
            ) : null}
            <button
              onClick={generate}
              disabled={busy}
              className="flex items-center px-4 py-2 bg-violet-600 text-white text-sm font-bold rounded-xl hover:bg-violet-700 disabled:opacity-50 shadow-md"
            >
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : code ? <RefreshCw className="w-4 h-4 mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
              {code ? 'Generar otro código' : 'Generar código'}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function StationCard({ station, now }: { station: Station; now: number }) {
  const [busy, setBusy] = useState('');
  const state = stationState(station, now);
  const style = STATE_STYLE[state];
  const a = station.assignment;
  const assigned = assignedApplicationId(station);
  const progress = progressLabel(a?.progress);
  const exits = a?.progress?.exits || 0;

  const release = async () => {
    if (!window.confirm(`¿Liberar ${station.name}? Si alguien lo está respondiendo, el test se cierra en ese teléfono (sus respuestas no se envían).`)) return;
    setBusy('release');
    try { await clearStation(station.id); } catch { window.alert('No se pudo liberar. Inténtalo de nuevo.'); } finally { setBusy(''); }
  };
  const unlink = async () => {
    if (!window.confirm(`¿Desvincular ${station.name}? El teléfono vuelve a la pantalla de vincular y necesitará un código nuevo.`)) return;
    setBusy('unlink');
    try { await unlinkStation(station.id); } catch { window.alert('No se pudo desvincular. Inténtalo de nuevo.'); setBusy(''); }
  };

  return (
    <div className="glass-card rounded-2xl p-4 flex items-start gap-3">
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${style.icon}`}>
        {state === 'offline' ? <WifiOff className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-slate-900 flex items-center flex-wrap gap-2">
          {station.name}
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${style.pill}`}>{style.label}</span>
        </p>
        {assigned ? (
          <p className="text-sm text-slate-700 mt-0.5">
            {a?.candidateId
              ? <Link to={`/candidates/${a.candidateId}`} className="font-bold text-violet-700 hover:underline">{a.candidateName || 'Candidato'}</Link>
              : <span className="font-bold">{a?.candidateName || 'Candidato'}</span>}
            {' · Test situacional'}{progress ? ` · ${progress}` : ' · aún no lo empieza'}
            {exits > 0 && <span className="text-amber-700"> · salió {exits} {exits === 1 ? 'vez' : 'veces'}</span>}
          </p>
        ) : (
          <p className="text-sm text-slate-600 mt-0.5">{state === 'offline' ? 'Apagado, sin internet o con la página cerrada' : 'Esperando candidato'}</p>
        )}
        <p className="text-[11px] text-slate-400 mt-1 flex items-center flex-wrap gap-x-1">
          <Clock className="w-3 h-3" />
          {assigned && toMs(a?.assignedAt) ? `Enviado ${ago(toMs(a?.assignedAt), now)} · ` : ''}
          {state === 'offline' ? `Última vez: ${ago(toMs(station.lastSeenAt), now) || 'nunca'}` : `Activo ${ago(toMs(station.lastSeenAt), now)}`}
          {doneTodayOf(station, now) > 0 && ` · ${doneTodayOf(station, now)} hoy`}
        </p>
      </div>
      <div className="flex flex-col gap-1.5 shrink-0">
        {assigned && (
          <button onClick={release} disabled={!!busy} className="text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-md flex items-center disabled:opacity-50">
            {busy === 'release' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <X className="w-3 h-3 mr-1" />} Liberar
          </button>
        )}
        <button onClick={unlink} disabled={!!busy} className="text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 px-2.5 py-1.5 rounded-md flex items-center disabled:opacity-50">
          {busy === 'unlink' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />} Desvincular
        </button>
      </div>
    </div>
  );
}

export default function Phones() {
  const [stations, setStations] = useState<Station[] | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => watchStations(setStations, () => setError('No se pudieron cargar los teléfonos. Revisa tus permisos o tu conexión.')), []);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  const list = stations || [];
  const count = (st: string) => list.filter(s => stationState(s, now) === st).length;
  const doneToday = list.reduce((n, s) => n + doneTodayOf(s, now), 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl lg:text-3xl font-display font-bold text-slate-900 flex items-center">
          <Smartphone className="w-7 h-7 mr-2 text-violet-600" /> Teléfonos de la empresa
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Los teléfonos donde los candidatos responden el test situacional. Desde el perfil del candidato, <b>Enviar a un teléfono</b> se lo abre solo, sin pasarle ningún link.
        </p>
      </div>

      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="glass-card rounded-2xl p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ahora</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{count('busy')} <span className="text-sm font-bold text-slate-500">respondiendo</span></p>
          <p className="text-xs text-slate-500">{count('free')} libre{count('free') === 1 ? '' : 's'} · {count('offline')} sin conexión</p>
        </div>
        <div className="glass-card rounded-2xl p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Hoy</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{doneToday} <span className="text-sm font-bold text-slate-500">test{doneToday === 1 ? '' : 's'} terminado{doneToday === 1 ? '' : 's'}</span></p>
          <p className="text-xs text-slate-500">en {list.length} teléfono{list.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      <div className="space-y-3">
        {!stations && !error && <Loader2 className="w-6 h-6 animate-spin text-violet-500" />}
        {stations && list.length === 0 && (
          <p className="glass-card rounded-2xl p-5 text-sm text-slate-500">Aún no hay teléfonos vinculados. Vincula el primero aquí abajo.</p>
        )}
        {list.map(s => <div key={s.id}><StationCard station={s} now={now} /></div>)}
      </div>

      <PairingCard />

      <details className="glass-card rounded-2xl p-5 group">
        <summary className="font-display font-bold text-slate-900 cursor-pointer flex items-center">
          <ListChecks className="w-5 h-5 mr-2 text-violet-600" /> Cómo dejar listo un teléfono (una sola vez)
        </summary>
        <ul className="mt-4 space-y-3 text-sm text-slate-600">
          {[
            ['Instálalo como app.', 'Con la página de estación abierta en Chrome: menú ⋮ → «Agregar a la pantalla principal» o «Instalar app». Se abre sin barra de direcciones, así el candidato no puede ir a otra página.'],
            ['Apaga las ayudas del teclado.', 'Ajustes → Sistema → Teclado (Gboard) → Corrección ortográfica: apaga Autocorrección, Corrector ortográfico, Mostrar sugerencias y Mayúsculas automáticas. Apaga también el dictado por voz. En Samsung: Teclado Samsung → apaga Texto predictivo y Corrección automática.'],
            ['Fija la app.', 'Ajustes → Seguridad → Fijar aplicaciones (o «Fijar ventana»), con PIN para desfijar. Abre la app de estación y fíjala: el candidato no podrá salir a otra aplicación.'],
            ['Sin cuenta ni apps de más.', 'No dejes cuenta de Google en la Play Store y desactiva el Asistente o Gemini, para que no se puedan instalar ni usar apps de IA.'],
            ['Déjalo cargando.', 'La página mantiene la pantalla encendida mientras espera candidatos.'],
          ].map(([title, text]) => (
            <li key={title} className="flex items-start">
              <CheckCircle className="w-4 h-4 mr-2 mt-0.5 text-emerald-500 shrink-0" />
              <span><b>{title}</b> {text}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
