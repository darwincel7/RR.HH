import React, { useEffect, useMemo, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { latestByApplication } from '../lib/participantStatus';
import { Link } from 'react-router-dom';
import { UserCheck, UserX, Users, HelpCircle, Loader2, ArrowRight } from 'lucide-react';
import {
  INTERVIEW_INVITE_STAGES, POST_INTERVIEW_STAGES,
  computeInterviewFunnel, groupInterviewFunnel, invitedWithinDays,
  type InterviewFunnel,
} from '../lib/interviewAttendance';

/**
 * Asistencia a entrevistas: de los que convocamos, ¿cuántos vinieron y cuántos no?
 *
 * Los tres estados son un estado, no categorías: verde = vino, rojo = no vino, gris =
 * nadie lo registró todavía. El verde y el rojo están separados a propósito
 * (emerald-500 / rose-700): el verde/rojo "natural" de Tailwind queda a ΔE 5.8 en
 * deuteranopía — indistinguibles para quien no ve el rojo. Aun así, ningún dato se
 * comunica solo con color: cada segmento lleva su número y su etiqueta.
 */

const PERIODS: Array<{ days: number; label: string }> = [
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 0, label: 'Todo' },
];

/** Verde/rojo validados para daltonismo + gris neutro para "sin dato". */
const SEG = {
  attended: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Asistió' },
  noShow: { bar: 'bg-rose-700', dot: 'bg-rose-700', text: 'text-rose-700', label: 'No se presentó' },
  pending: { bar: 'bg-slate-200', dot: 'bg-slate-300', text: 'text-slate-500', label: 'Sin registrar' },
};

/** Barra apilada: 2px de hueco entre segmentos y extremos redondeados (nunca una barra 3D ni un anillo). */
function AttendanceBar({ funnel, height = 'h-3' }: { funnel: InterviewFunnel; height?: string }) {
  const segments = [
    { key: 'attended', value: funnel.attended, pctValue: funnel.attendedPct, ...SEG.attended },
    { key: 'noShow', value: funnel.noShow, pctValue: funnel.noShowPct, ...SEG.noShow },
    { key: 'pending', value: funnel.pending, pctValue: funnel.pendingPct, ...SEG.pending },
  ].filter(s => s.value > 0);

  return (
    <div className={`flex w-full ${height} gap-0.5 rounded-full overflow-hidden bg-slate-100`}>
      {segments.map(s => (
        <div
          key={s.key}
          className={`${s.bar} first:rounded-l-full last:rounded-r-full`}
          style={{ width: `${Math.max(s.pctValue, 1.5)}%` }}
          title={`${s.label}: ${s.value} de ${funnel.invited} convocados (${s.pctValue}%)`}
        />
      ))}
    </div>
  );
}

/** Un número grande con su contexto debajo. Sin gráfica: un solo valor no es una gráfica. */
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

export default function InterviewAttendanceDashboard() {
  const [apps, setApps] = useState<any[]>([]);
  const [vacancyTitles, setVacancyTitles] = useState<Record<string, string>>({});
  const [participantStatus, setParticipantStatus] = useState<Map<string, unknown>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const appsCol = collection(db, 'applications');
        // El sello de convocatoria es la fuente fiable, pero no puede ser la única: si
        // esa consulta falla (o ni se puede construir), el panel sigue funcionando con
        // la etapa actual en vez de quedarse en blanco. Por eso el try va también
        // alrededor de query().
        //
        // Con un período elegido se pide solo ese rango: el panel vive en la pantalla de
        // inicio y leer todas las postulaciones de la historia en cada visita cuesta
        // lecturas de verdad. "Todo" es una decisión explícita de quien lo pulsa.
        const stampedQuery = async () => {
          try {
            if (days > 0) {
              const cutoff = new Date(Date.now() - days * 86_400_000);
              return await getDocs(query(appsCol, where('interviewInvitedAt', '>=', cutoff)));
            }
            return await getDocs(query(appsCol, where('interviewInvitedAt', '!=', null)));
          } catch (e) {
            console.warn('No se pudo leer por fecha de convocatoria (se usa la etapa actual):', e);
            return null;
          }
        };
        // Dos fuentes, unidas por id: el sello de convocatoria (sobrevive al descarte y
        // al avance) y la etapa actual (cubre lo convocado antes del sello).
        const [stamped, byStage, vacSnap, partSnap] = await Promise.all([
          stampedQuery(),
          getDocs(query(appsCol, where('stage', 'in', [...INTERVIEW_INVITE_STAGES, ...POST_INTERVIEW_STAGES]))),
          getDocs(collection(db, 'vacancies')),
          // La asistencia marcada en la página Entrevistas cuenta igual.
          getDocs(collection(db, 'interview_participants')).catch(() => null),
        ]);
        if (!alive) return;

        const byId = new Map<string, any>();
        [stamped, byStage].forEach(snap => snap?.docs.forEach(d => byId.set(d.id, { id: d.id, ...(d.data() as any) })));

        const titles: Record<string, string> = {};
        vacSnap.docs.forEach(d => { titles[d.id] = (d.data() as any).title || 'Vacante'; });

        // De cada postulación, su ÚLTIMA cita: entre dos sesiones manda la más reciente
        // (la anterior ya pasó y su resultado quedó archivado).
        const latest = latestByApplication(partSnap?.docs.map(d => ({ id: d.id, ...(d.data() as any) })) || []);
        const parts = new Map<string, unknown>();
        latest.forEach((row, appId) => parts.set(appId, row.status));

        // Quien fue marcado en una sesión ANTES de que existiera el sello y luego se
        // descartó no aparece en ninguna de las dos consultas: ni tiene sello ni está en
        // una etapa de entrevista. Sin esto, esas ausencias históricas se perderían y el
        // porcentaje de "no se presentó" se leería más bajo de lo que fue — justo la
        // distorsión que este panel existe para evitar.
        const missing = Array.from(latest.keys()).filter(id => id && !byId.has(id));
        for (let i = 0; i < missing.length && i < 300; i += 30) {
          try {
            const snap = await getDocs(query(appsCol, where(documentId(), 'in', missing.slice(i, i + 30))));
            snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...(d.data() as any) }));
          } catch (e) {
            console.warn('No se pudieron leer las postulaciones de la agenda:', e);
            break;
          }
        }
        if (!alive) return;

        setApps(Array.from(byId.values()));
        setVacancyTitles(titles);
        setParticipantStatus(parts);
      } catch (e: any) {
        console.error('No se pudieron cargar las métricas de entrevista:', e);
        if (alive) setError('No se pudieron cargar las métricas de entrevista.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [days]);

  const inPeriod = useMemo(() => invitedWithinDays(apps, days), [apps, days]);
  const funnel = useMemo(() => computeInterviewFunnel(inPeriod, participantStatus), [inPeriod, participantStatus]);
  const byVacancy = useMemo(
    () => groupInterviewFunnel(
      inPeriod,
      a => a.vacancyId || '',
      k => vacancyTitles[k] || (k === 'bulk_upload' ? 'Subida masiva de CVs' : 'Sin vacante'),
      participantStatus,
    ),
    [inPeriod, vacancyTitles, participantStatus],
  );
  // Convocatorias sin fecha: su asistencia cuenta, pero no se puede atribuir a un período.
  const sinFecha = useMemo(
    () => computeInterviewFunnel(inPeriod.filter(a => !a.interviewInvitedAt && !a.interviewLastInvitedAt), participantStatus).invited,
    [inPeriod, participantStatus],
  );

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 lg:p-8">
      {/* Filtros en una fila sobre los datos. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center">
            <UserCheck className="w-4 h-4 mr-2 text-emerald-500" />
            Asistencia a entrevistas
          </h2>
          <p className="text-xs text-slate-400 mt-1">De los convocados: quiénes vinieron y quiénes no se presentaron.</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          {PERIODS.map(p => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                days === p.days ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando métricas…
        </div>
      ) : error ? (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl p-4">{error}</p>
      ) : funnel.invited === 0 ? (
        <div className="text-center py-10">
          <Users className="w-12 h-12 mx-auto text-slate-200 mb-3" />
          <p className="text-sm font-bold text-slate-600">Nadie convocado a entrevista en este período</p>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Al mover una tarjeta a "Convocado a entrevista" queda registrada aquí, y el botón
            ✅/❌ de la tarjeta o del perfil cierra el dato.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
            <Tile
              icon={<Users className="w-5 h-5 text-indigo-600" />}
              value={String(funnel.invited)}
              caption="Convocados"
              detail={days ? `últimos ${days} días` : 'todo el histórico'}
              tint="bg-indigo-50" border="border-indigo-100"
            />
            <Tile
              icon={<UserCheck className="w-5 h-5 text-emerald-600" />}
              value={`${funnel.attendedPct}%`}
              caption="Asistieron"
              detail={`${funnel.attended} de ${funnel.invited} convocados`}
              tint="bg-emerald-50" border="border-emerald-100"
            />
            <Tile
              icon={<UserX className="w-5 h-5 text-rose-700" />}
              value={`${funnel.noShowPct}%`}
              caption="No se presentaron"
              detail={`${funnel.noShow} de ${funnel.invited} convocados`}
              tint="bg-rose-50" border="border-rose-100"
            />
            <Tile
              icon={<HelpCircle className="w-5 h-5 text-slate-500" />}
              value={String(funnel.pending)}
              caption="Sin registrar"
              detail={funnel.pending > 0 ? `${funnel.pendingPct}% del total — márcalos` : 'todo registrado ✓'}
              tint="bg-slate-100" border="border-slate-200"
            />
          </div>

          {/* El número a seguir mientras falte gente por marcar: no se mueve por los olvidos. */}
          {funnel.pending > 0 && funnel.attended + funnel.noShow > 0 && (
            <div className="mb-6 flex flex-wrap items-center gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-2.5">
              <strong>Sobre lo ya registrado:</strong>
              <span>{funnel.attendedPctOfMarked}% asistió · {funnel.noShowPctOfMarked}% no se presentó</span>
              <span className="text-amber-700">
                ({funnel.attended + funnel.noShow} de {funnel.invited} marcados). Mientras falten marcas, este es el
                porcentaje comparable entre períodos.
              </span>
            </div>
          )}

          <div className="mb-2">
            <AttendanceBar funnel={funnel} height="h-4" />
          </div>
          {/* Leyenda siempre presente: el color nunca es el único canal. */}
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-7 text-[11px] font-semibold">
            {[
              { ...SEG.attended, n: funnel.attended, p: funnel.attendedPct },
              { ...SEG.noShow, n: funnel.noShow, p: funnel.noShowPct },
              { ...SEG.pending, n: funnel.pending, p: funnel.pendingPct },
            ].map(s => (
              <span key={s.label} className="flex items-center text-slate-600">
                <span className={`w-2.5 h-2.5 rounded-full mr-2 ${s.dot}`} />
                {s.label}: <span className={`ml-1 ${s.text}`}>{s.n} ({s.p}%)</span>
              </span>
            ))}
          </div>

          <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Por vacante</h3>
          <div className="space-y-3">
            {byVacancy.map(g => (
              <div key={g.key} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 items-center">
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-xs font-bold text-slate-700 truncate" title={g.label}>{g.label}</span>
                    <span className="text-[11px] text-slate-400 shrink-0">{g.funnel.invited} convocado(s)</span>
                  </div>
                  <AttendanceBar funnel={g.funnel} />
                </div>
                <div className="flex items-center gap-3 text-[11px] font-bold whitespace-nowrap">
                  <span className="text-emerald-700">✅ {g.funnel.attended} · {g.funnel.attendedPct}%</span>
                  <span className="text-rose-700">❌ {g.funnel.noShow} · {g.funnel.noShowPct}%</span>
                  {g.funnel.pending > 0 && <span className="text-slate-400">◻️ {g.funnel.pending} s/registrar</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-400 max-w-xl">
              {sinFecha > 0 && (
                <>
                  <strong>{sinFecha}</strong> convocatoria(s) sin fecha registrada (anteriores a esta función) se
                  incluyen en todos los períodos: se estiman por la etapa actual.{' '}
                </>
              )}
              Quien fue convocado sigue contando aunque luego avance o se descarte — así el porcentaje de ausencias
              solo baja cuando de verdad falta menos gente.
            </p>
            <Link to="/interviews" className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-full flex items-center shrink-0">
              Agenda de entrevistas <ArrowRight className="w-3 h-3 ml-1" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
