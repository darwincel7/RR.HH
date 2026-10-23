import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Building2, CheckCircle, Link2, Loader2, Smartphone, WifiOff, AlertTriangle } from 'lucide-react';
import CandidateTest from './CandidateTest';
import { STATION_POLL_MS, isPairingCode } from '../lib/stations';

/**
 * Modo estación, en el teléfono de la empresa (src/lib/stations.ts).
 *
 * Se vincula una vez con el código del panel y desde entonces espera: cada pocos segundos
 * le pregunta al servidor si tiene un test asignado y, en cuanto lo tiene, lo abre solo
 * (el candidato nunca ve un link). Al terminar despide al candidato y vuelve a esperar.
 * Su llave —el id secreto de su documento— vive en este navegador.
 */

const STORAGE_KEY = 'aura_station';
const DONE_SCREEN_MS = 8000;

interface Linked { stationId: string; name: string }
interface Assignment { applicationId: string; assignedAt: number }
interface Company { name: string; logoUrl: string }

function readLinked(): Linked | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return v && typeof v.stationId === 'string' && v.stationId ? { stationId: v.stationId, name: String(v.name || '') } : null;
  } catch {
    return null;
  }
}

function writeLinked(v: Linked | null) {
  try {
    if (v) localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* sin almacenamiento: habrá que vincularlo de nuevo al recargar */ }
}

const postJson = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Instalado en la pantalla de inicio se abre sin barra de direcciones (y sin pestañas). */
function useStationManifest() {
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/estacion.webmanifest';
    const theme = document.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#2563eb';
    document.head.append(link, theme);
    const title = document.title;
    document.title = 'Estación de tests';
    return () => { link.remove(); theme.remove(); document.title = title; };
  }, []);
}

/** La pantalla no se apaga sola mientras la página está a la vista: un teléfono que se
 * bloquea a mitad del test contaría como una salida que el candidato no hizo. */
function useWakeLock() {
  useEffect(() => {
    let lock: any = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (document.visibilityState === 'visible' && 'wakeLock' in navigator && !lock) {
          lock = await (navigator as any).wakeLock.request('screen');
          lock.addEventListener?.('release', () => { lock = null; });
          if (cancelled) lock.release?.();
        }
      } catch { /* sin permiso o no soportado: la pantalla se apaga como siempre */ }
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      lock?.release?.();
    };
  }, []);
}

function Shell({ company, badge, children, footer }: { company: Company | null; badge: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="h-14 px-4 flex items-center justify-between bg-white border-b border-gray-100 shrink-0">
        {company?.logoUrl ? (
          <img src={company.logoUrl} alt={company.name} className="h-8 max-w-[140px] object-contain" />
        ) : (
          <span className="flex items-center font-display font-bold text-gray-800">
            <Building2 className="w-5 h-5 text-blue-600 mr-1.5" /> {company?.name || 'Estación de tests'}
          </span>
        )}
        {badge}
      </header>
      <main className="flex-1 flex flex-col">{children}</main>
      {footer}
    </div>
  );
}

const StationBadge = ({ name, muted }: { name: string; muted?: boolean }) => (
  <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex items-center ${muted ? 'bg-gray-100 text-gray-500' : 'bg-blue-50 text-blue-700'}`}>
    <Smartphone className="w-3.5 h-3.5 mr-1" /> {name}
  </span>
);

function PairScreen({ notice, onPaired }: { notice: string; onPaired: (v: Linked) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isPairingCode(code)) { setError('Escribe los 6 dígitos del código.'); return; }
    if (!name.trim()) { setError('Ponle un nombre al teléfono.'); return; }
    setBusy(true);
    try {
      const res = await postJson('/api/public/station/pair', { code, name });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.stationId) throw new Error(data?.error || 'No se pudo vincular. Inténtalo de nuevo.');
      onPaired({ stationId: data.stationId, name: data.name });
    } catch (err: any) {
      setError(err?.message || 'No se pudo vincular. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell company={null} badge={<StationBadge name="Sin vincular" muted />}>
      <form onSubmit={submit} className="w-full max-w-sm mx-auto px-6 pt-10 pb-8">
        <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto">
          <Link2 className="w-7 h-7 text-blue-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 text-center mt-4">Vincular este teléfono</h1>
        <p className="text-sm text-gray-500 text-center mt-2">
          Escribe el código que aparece en el panel, en <b>Teléfonos</b> → <i>Vincular un teléfono nuevo</i>.
        </p>
        {notice && (
          <p className="mt-5 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-start">
            <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 shrink-0" /> {notice}
          </p>
        )}
        <label className="block text-sm font-medium text-gray-700 mt-6 mb-1.5" htmlFor="station-code">Código de vinculación</label>
        <input
          id="station-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
          placeholder="000000"
          className="w-full p-3 border-2 border-blue-200 rounded-md text-center text-3xl font-bold tracking-[0.4em] text-gray-900 focus:border-blue-500 focus:outline-none"
        />
        <label className="block text-sm font-medium text-gray-700 mt-5 mb-1.5" htmlFor="station-name">Nombre de este teléfono</label>
        <input
          id="station-name"
          value={name}
          maxLength={40}
          onChange={e => setName(e.target.value)}
          placeholder="Teléfono 1"
          className="w-full p-3 border border-gray-300 rounded-md text-gray-900 focus:ring-blue-500 focus:border-blue-500"
        />
        {error && <p className="mt-4 text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full flex items-center justify-center py-3 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 shadow-sm"
        >
          {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Vincular
        </button>
        <p className="text-xs text-gray-400 text-center mt-4">Se hace una sola vez. Después el teléfono se queda esperando candidatos.</p>
      </form>
    </Shell>
  );
}

function WaitingScreen({ name, company, online, notice }: { name: string; company: Company | null; online: boolean; notice: string }) {
  return (
    <Shell
      company={company}
      badge={<StationBadge name={name} />}
      footer={
        <footer className="px-5 py-4 flex items-center justify-center text-xs text-gray-500">
          {online
            ? <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-emerald-500 mr-1.5" /> Conectado</span>
            : <span className="flex items-center text-amber-700"><WifiOff className="w-3.5 h-3.5 mr-1.5" /> Sin conexión, reintentando…</span>}
        </footer>
      }
    >
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="relative w-40 h-40 flex items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-blue-100/60 animate-pulse" />
          <span className="absolute inset-5 rounded-full bg-blue-100" />
          <span className="relative w-24 h-24 rounded-full bg-blue-600 flex items-center justify-center shadow-lg">
            <Smartphone className="w-10 h-10 text-white" />
          </span>
        </div>
        <p className="font-display font-bold text-4xl text-gray-900 mt-8">{name}</p>
        <p className="text-gray-600 mt-2 flex items-center text-lg"><Loader2 className="w-5 h-5 mr-2 animate-spin text-blue-600" /> Esperando candidato…</p>
        {notice ? (
          <p className="mt-8 max-w-sm text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">{notice}</p>
        ) : (
          <p className="mt-8 max-w-sm bg-white border border-gray-100 rounded-lg px-4 py-3 text-sm text-gray-500 shadow-sm">
            Cuando RR.HH te envíe el test, aparecerá aquí solo. No tienes que tocar nada.
          </p>
        )}
      </div>
    </Shell>
  );
}

function DoneScreen({ name, company, firstName, until }: { name: string; company: Company | null; firstName: string; until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  const pct = Math.min(100, Math.max(0, 100 - ((until - now) / DONE_SCREEN_MS) * 100));
  return (
    <Shell company={company} badge={<StationBadge name={name} />}>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <CheckCircle className="w-24 h-24 text-green-500" />
        <p className="text-3xl font-bold text-gray-900 mt-5">{firstName ? `¡Listo, ${firstName}!` : '¡Listo!'}</p>
        <p className="text-gray-600 mt-3 max-w-sm">Tus respuestas se guardaron. Devuelve el teléfono a quien te atendió.</p>
        <div className="mt-10 w-full max-w-sm bg-white border border-gray-100 rounded-lg p-4 shadow-sm">
          <p className="text-xs text-gray-500">Este teléfono vuelve a <b>«Esperando candidato…»</b> en {left} s</p>
          <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Las respuestas no quedan guardadas en el teléfono.</p>
        </div>
      </div>
    </Shell>
  );
}

function StationRunner({ linked, onUnlinked }: { linked: Linked; onUnlinked: () => void }) {
  const [name, setName] = useState(linked.name);
  const [company, setCompany] = useState<Company | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState('');
  const [done, setDone] = useState<{ firstName: string; until: number } | null>(null);
  // Assignments that already ended here (application → assignedAt): if the server still
  // lists one for a moment, it is not opened again — the server frees the phone when the
  // answers arrive. A re-send of the same test is a new assignment (new assignedAt).
  const finished = useRef(new Map<string, number>());
  const current = useRef<Assignment | null>(null);
  const inFlight = useRef(false);
  const lastProgress = useRef('');

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await postJson('/api/public/station/poll', { stationId: linked.stationId });
      if (res.status === 404) { onUnlinked(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOnline(true);
      if (data.name) setName(data.name);
      if (data.company) setCompany({ name: data.company.name || '', logoUrl: data.company.logoUrl || '' });
      const listed: Assignment | null = data.assignment?.applicationId
        ? { applicationId: data.assignment.applicationId, assignedAt: Number(data.assignment.assignedAt) || 0 }
        : null;
      // Forget finished ones the server no longer lists.
      for (const [id, at] of finished.current) {
        if (listed?.applicationId !== id || listed.assignedAt !== at) finished.current.delete(id);
      }
      const next = listed && finished.current.get(listed.applicationId) !== listed.assignedAt ? listed : null;
      const prev = current.current;
      if (prev && (!next || next.applicationId !== prev.applicationId)) {
        setNotice('El test de ese candidato se canceló o se pasó a otro teléfono.');
      }
      if (next && (!prev || next.applicationId !== prev.applicationId)) setNotice('');
      if (next?.applicationId !== prev?.applicationId || next?.assignedAt !== prev?.assignedAt) {
        current.current = next;
        setAssignment(next);
      }
    } catch {
      setOnline(false);
    } finally {
      inFlight.current = false;
    }
  }, [linked.stationId, onUnlinked]);

  useEffect(() => {
    poll();
    const t = window.setInterval(poll, STATION_POLL_MS);
    return () => window.clearInterval(t);
  }, [poll]);

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(null), Math.max(0, done.until - Date.now()));
    return () => window.clearTimeout(t);
  }, [done]);

  if (done) return <DoneScreen name={name} company={company} firstName={done.firstName} until={done.until} />;

  if (assignment) {
    const applicationId = assignment.applicationId;
    // A new assignment (even of the same test, re-sent) starts the page from scratch.
    return (
      <Fragment key={`${applicationId}:${assignment.assignedAt}`}>
      <CandidateTest
        applicationId={applicationId}
        station={{
          stationId: linked.stationId,
          name,
          onProgress: p => {
            const key = `${applicationId}:${p.index}:${p.total}:${p.exits}`;
            if (key === lastProgress.current) return;
            lastProgress.current = key;
            postJson('/api/public/station/progress', { stationId: linked.stationId, applicationId, ...p }).catch(() => { /* el próximo avance lo repone */ });
          },
          onDone: ({ firstName, alreadyAnswered }) => {
            finished.current.set(applicationId, assignment.assignedAt);
            current.current = null;
            setAssignment(null);
            setNotice('');
            setDone({ firstName, until: Date.now() + DONE_SCREEN_MS });
            if (alreadyAnswered) {
              postJson('/api/public/station/release', { stationId: linked.stationId, applicationId }).catch(() => { /* lo libera el panel */ });
            }
          },
        }}
      />
      </Fragment>
    );
  }

  return <WaitingScreen name={name} company={company} online={online} notice={notice} />;
}

export default function Station() {
  const [linked, setLinked] = useState<Linked | null>(() => readLinked());
  const [notice, setNotice] = useState('');
  useStationManifest();
  useWakeLock();

  const onUnlinked = useCallback(() => {
    writeLinked(null);
    setLinked(null);
    setNotice('Este teléfono se desvinculó desde el panel. Para volver a usarlo, vincúlalo con un código nuevo.');
  }, []);

  if (!linked) {
    return (
      <PairScreen
        notice={notice}
        onPaired={v => { writeLinked(v); setNotice(''); setLinked(v); }}
      />
    );
  }
  return <Fragment key={linked.stationId}><StationRunner linked={linked} onUnlinked={onUnlinked} /></Fragment>;
}
