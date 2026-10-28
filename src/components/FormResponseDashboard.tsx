import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Timer, Send, FileCheck2, AlertTriangle, Loader2, Hourglass, ArrowDownWideNarrow, Clock } from 'lucide-react';
import { db } from '../lib/firebase';
import {
  computeStage2Timing, summarizeStage2, formatDuration, STAGE2_STATUS_LABEL,
  type Stage2Timing,
} from '../lib/formTiming';
import { whenLabel } from '../lib/whatsappActivity';
import { STATUS_STYLE, dueLabel } from './FormTimingCard';

/**
 * Formulario de etapa 2: cuánto tardan los candidatos en completarlo desde que se les
 * envía el link, y quiénes lo hicieron a destiempo (o siguen sin hacerlo pasado el plazo).
 *
 * El reloj empieza cuando el link SALIÓ de verdad (no cuando se movió la tarjeta) y la
 * fecha límite es la que el mensaje le dijo al candidato. Formularios enviados antes de
 * este registro se fecharon desde la cola de WhatsApp; los que no dejaron rastro, por el
 * cambio de etapa (marcados como aproximados).
 */

const PERIODS: Array<{ days: number; label: string }> = [
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 0, label: 'Todo' },
];

type Filter = 'todos' | 'tarde' | 'pendientes' | 'entrega';
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'todos', label: 'Todos' },
  { key: 'tarde', label: 'A destiempo' },
  { key: 'pendientes', label: 'Sin completar' },
  { key: 'entrega', label: 'Problema de entrega' },
];

type Row = { app: any; t: Stage2Timing };

function Tile({ icon, value, caption, detail, tint, border }: {
  icon: React.ReactNode; value: string; caption: string; detail: string; tint: string; border: string;
}) {
  return (
    <div className={`bg-white rounded-2xl p-4 lg:p-5 border ${border} shadow-sm`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${tint}`}>{icon}</div>
      <p className="text-3xl font-extrabold text-slate-900 leading-none">{value}</p>
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1.5">{caption}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">{detail}</p>
    </div>
  );
}

export default function FormResponseDashboard() {
  const [apps, setApps] = useState<any[]>([]);
  const [vacancyTitles, setVacancyTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<Filter>('todos');
  const [sortSlowest, setSortSlowest] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const appsCol = collection(db, 'applications');
        // Dos fuentes, unidas por id: a quién se le ENVIÓ en el período y quién lo
        // COMPLETÓ en el período (incluye completados sin envío registrado). Con un
        // período se pide solo ese rango: el panel vive en la pantalla de inicio.
        const cutoff = days > 0 ? new Date(Date.now() - days * 86_400_000) : null;
        const byField = (field: string) => getDocs(cutoff
          ? query(appsCol, where(field, '>=', cutoff))
          : query(appsCol, where(field, '!=', null)));
        const [sent, done, vacSnap] = await Promise.all([
          byField('stage2Link.firstSentAt'),
          byField('stage2SubmittedAt'),
          getDocs(collection(db, 'vacancies')),
        ]);
        if (!alive) return;
        const byId = new Map<string, any>();
        [sent, done].forEach(snap => snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...(d.data() as any) })));
        const titles: Record<string, string> = {};
        vacSnap.docs.forEach(d => { titles[d.id] = (d.data() as any).title || 'Vacante'; });
        setApps(Array.from(byId.values()));
        setVacancyTitles(titles);
      } catch (e) {
        console.error('No se pudieron cargar los tiempos del formulario:', e);
        if (alive) setError('No se pudieron cargar los tiempos del formulario.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [days]);

  const now = Date.now();
  const rows: Row[] = useMemo(
    () => apps.map(app => ({ app, t: computeStage2Timing(app, now) })).filter(r => r.t.status !== 'sin_envio'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apps],
  );
  const summary = useMemo(() => summarizeStage2(rows.map(r => r.t)), [rows]);

  const visible = useMemo(() => {
    const keep = (r: Row) => {
      if (filter === 'tarde') return r.t.status === 'tarde' || r.t.status === 'vencido';
      if (filter === 'pendientes') return r.t.status === 'pendiente' || r.t.status === 'vencido';
      if (filter === 'entrega') return !!r.t.deliveryIssue;
      return true;
    };
    const list = rows.filter(keep);
    list.sort((a, b) => sortSlowest
      ? b.t.elapsedMs - a.t.elapsedMs
      : (b.t.sentAtMs || b.t.submittedAtMs) - (a.t.sentAtMs || a.t.submittedAtMs));
    return list;
  }, [rows, filter, sortSlowest]);
  const shown = showAll ? visible : visible.slice(0, 25);
  const maxBucket = Math.max(1, ...summary.buckets.map(b => b.count));

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center">
            <Timer className="w-4 h-4 mr-2 text-blue-500" />
            Formulario etapa 2: tiempo de respuesta
          </h2>
          <p className="text-xs text-slate-400 mt-1">Desde que se le envió el link hasta que lo completó, y quién lo hizo a destiempo.</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          {PERIODS.map(p => (
            <button
              key={p.days}
              onClick={() => { setDays(p.days); setShowAll(false); }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${days === p.days ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando tiempos…
        </div>
      ) : error ? (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl p-4">{error}</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-10">
          <Send className="w-12 h-12 mx-auto text-slate-200 mb-3" />
          <p className="text-sm font-bold text-slate-600">Ningún formulario enviado en este período</p>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Al mover a alguien a "Formulario etapa 2 enviado", el momento en que el link le sale por WhatsApp o correo queda registrado aquí.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
            <Tile
              icon={<Send className="w-5 h-5 text-indigo-600" />}
              value={String(summary.sent)}
              caption="Enviados"
              detail={days ? `últimos ${days} días` : 'todo el histórico'}
              tint="bg-indigo-50" border="border-indigo-100"
            />
            <Tile
              icon={<FileCheck2 className="w-5 h-5 text-emerald-600" />}
              value={`${summary.completedPct}%`}
              caption="Completados"
              detail={`${summary.completed} de ${summary.sent} enviados`}
              tint="bg-emerald-50" border="border-emerald-100"
            />
            <Tile
              icon={<Clock className="w-5 h-5 text-blue-600" />}
              value={summary.completed ? formatDuration(summary.medianMs) : '—'}
              caption="Tiempo típico"
              detail={summary.completed ? `la mitad respondió en menos · más lento: ${formatDuration(summary.slowestMs)}` : 'aún nadie lo completó'}
              tint="bg-blue-50" border="border-blue-100"
            />
            <Tile
              icon={<Hourglass className="w-5 h-5 text-rose-700" />}
              value={String(summary.late + summary.overdue)}
              caption="Fuera de plazo"
              detail={`${summary.late} lo completaron tarde · ${summary.overdue} vencidos sin completar`}
              tint="bg-rose-50" border="border-rose-100"
            />
          </div>

          {summary.completed > 0 && (
            <div className="mb-6">
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">¿Cuánto tardaron los que lo completaron?</h3>
              <div className="space-y-1.5">
                {summary.buckets.map(b => (
                  <div key={b.key} className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-[11px]">
                    <span className="font-semibold text-slate-600">{b.label}</span>
                    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      {b.count > 0 && <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max((b.count / maxBucket) * 100, 3)}%` }} />}
                    </div>
                    <span className="text-right font-bold text-slate-700">{b.count} <span className="font-normal text-slate-400">({b.pct}%)</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.deliveryIssues > 0 && (
            <button
              type="button"
              onClick={() => setFilter('entrega')}
              className="mb-5 w-full text-left flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-2.5 hover:bg-amber-100 transition-colors"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                <strong>{summary.deliveryIssues} candidato(s) podrían tener el mensaje atascado</strong> («Esperando el mensaje»): WhatsApp no
                confirma la entrega o su teléfono pidió reenviarlo, y no han abierto el link. Ábrelos para pulsar <b>Reparar entrega</b>.
              </span>
            </button>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => { setFilter(f.key); setShowAll(false); }}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-full border transition-colors ${filter === f.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:text-slate-800'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSortSlowest(v => !v)}
              className="flex items-center text-[11px] font-bold text-slate-500 hover:text-slate-800"
              title="Cambiar el orden"
            >
              <ArrowDownWideNarrow className="w-3.5 h-3.5 mr-1" />
              {sortSlowest ? 'Los que más tardaron primero' : 'Los más recientes primero'}
            </button>
          </div>

          {visible.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">Nadie en este filtro.</p>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden">
              <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] gap-3 px-4 py-2 bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <span>Candidato</span><span>Enviado</span><span>Completado</span><span>Tardó</span><span>Estado</span>
              </div>
              {shown.map(({ app, t }) => (
                <div key={app.id} className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] gap-x-3 gap-y-0.5 px-4 py-2.5 text-xs items-center hover:bg-slate-50/60">
                  <div className="min-w-0">
                    <Link to={`/candidates/${app.candidateId}`} className="font-bold text-slate-800 hover:text-indigo-600 truncate block">
                      {app.candidateName || 'Sin nombre'}
                    </Link>
                    <span className="text-[11px] text-slate-400 truncate block">{vacancyTitles[app.vacancyId] || app.vacancyTitle || 'Vacante'}</span>
                  </div>
                  <div className="text-slate-600">
                    <span className="md:hidden text-slate-400">Enviado: </span>
                    {t.sentAtMs ? <>{t.approximate ? '≈ ' : ''}{whenLabel(new Date(t.sentAtMs).toISOString(), now)}</> : <span className="text-slate-300">sin registro</span>}
                    {t.deliveryIssue && <span className="block text-[10px] font-bold text-amber-700">⚠ posible mensaje atascado</span>}
                  </div>
                  <div className="text-slate-600">
                    <span className="md:hidden text-slate-400">Completado: </span>
                    {t.submittedAtMs ? whenLabel(new Date(t.submittedAtMs).toISOString(), now)
                      : t.dueAtMs ? <span className="text-slate-400">aún no · plazo: {dueLabel(t.dueAtMs)}</span> : 'aún no'}
                  </div>
                  <div className="font-bold text-slate-800">
                    <span className="md:hidden font-normal text-slate-400">Tardó: </span>
                    {t.status === 'a_tiempo' || t.status === 'tarde' ? formatDuration(t.elapsedMs)
                      : t.status === 'pendiente' || t.status === 'vencido' ? <span className="font-normal text-slate-500">lleva {formatDuration(t.elapsedMs)}</span>
                      : '—'}
                    {(t.status === 'tarde' || t.status === 'vencido') && t.lateByMs > 0 && (
                      <span className="block text-[10px] font-semibold text-rose-700">+{formatDuration(t.lateByMs)} del plazo</span>
                    )}
                  </div>
                  <div>
                    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border whitespace-nowrap ${STATUS_STYLE[t.status]}`}>
                      {STAGE2_STATUS_LABEL[t.status]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {visible.length > shown.length && (
            <button onClick={() => setShowAll(true)} className="mt-3 text-[11px] font-bold text-indigo-600 hover:text-indigo-700">
              Ver los {visible.length} →
            </button>
          )}

          <p className="mt-5 pt-4 border-t border-slate-100 text-[11px] text-slate-400 max-w-3xl">
            El tiempo cuenta desde que el link <b>salió de verdad</b> (con el ritmo anti-bloqueo y el horario de envío puede salir
            horas después de mover la tarjeta). "A tiempo" es completarlo hasta el final del día que el mensaje indicó como límite.
            {summary.completedWithoutSend > 0 && <> {summary.completedWithoutSend} completado(s) sin fecha de envío registrada no entran en los tiempos.</>}
            {rows.some(r => r.t.approximate) && <> Las fechas con ≈ son aproximadas: formularios enviados antes de este registro, fechados por el cambio de etapa.</>}
          </p>
        </>
      )}
    </div>
  );
}
