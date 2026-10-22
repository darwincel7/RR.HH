import React, { useState } from 'react';
import { doc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { latestByApplication } from '../lib/participantStatus';
import { Loader2, UserCheck } from 'lucide-react';
import {
  ATTENDANCE_OPTIONS, attendanceFields, attendanceOf, canMarkAttendance, effectiveAttendance,
  type AttendanceStatus, type OptimisticAttendance,
} from '../lib/interviewAttendance';

interface Props {
  /** La postulación (necesita al menos `id` y `stage`). */
  app: any;
  /** Estado marcado en la página Entrevistas, si esta pantalla lo conoce. */
  participantStatus?: unknown;
  /** Versión para la tarjeta del Kanban: dos botones pequeños, sin encabezado. */
  compact?: boolean;
  /** Se llama con el estado nuevo (o null si se borró) para que la pantalla lo refleje al instante. */
  onMarked?: (status: AttendanceStatus | null) => void;
}

/**
 * "¿Asistió a la entrevista?" — los dos botones que alimentan todas las métricas.
 *
 * Escribe en la POSTULACIÓN (ver `interviewAttendance.ts`) y, si esa postulación está
 * en alguna sesión de la página *Entrevistas*, le copia el estado para que las dos
 * pantallas nunca digan cosas distintas.
 *
 * Volver a pulsar la opción ya marcada la quita: marcar "no vino" por error y dejarlo
 * así falsearía el porcentaje que el reclutador intenta mejorar.
 */
export default function InterviewAttendanceButton({ app, participantStatus, compact, onMarked }: Props) {
  const [saving, setSaving] = useState<AttendanceStatus | null>(null);
  const [error, setError] = useState('');
  // Lo que se acaba de guardar, con la postulación a la que pertenece y lo que se veía
  // antes. `effectiveAttendance` decide cuándo deja de valer (ver `interviewAttendance.ts`):
  // hace falta porque `participantStatus` viene de una lectura única —al QUITAR una marca
  // de ahí, el botón se quedaría marcado como si el clic no hubiera servido— y deja de
  // valer en cuanto los datos cambian, sea por nuestra propia escritura o porque otra
  // persona marcó esa misma asistencia desde la página Entrevistas.
  const [justSaved, setJustSaved] = useState<OptimisticAttendance | null>(null);

  if (!app?.id || !canMarkAttendance(app, participantStatus)) return null;

  const backing = attendanceOf(app, participantStatus);
  const current = effectiveAttendance(backing, justSaved, app.id);
  // ¿Lo que se ve viene de nuestra marca o ya lo confirmaron los datos? Solo para el
  // texto de "quién lo marcó y cuándo", que sale del documento.
  const showingOwnMark = current !== backing;

  const mark = async (status: AttendanceStatus) => {
    // La misma opción otra vez = corregir: se borra la marca.
    const next = current === status ? null : status;
    setSaving(status);
    setError('');
    try {
      const by = auth.currentUser?.displayName || auth.currentUser?.email || 'Equipo';
      await updateDoc(doc(db, 'applications', app.id), attendanceFields(next, by, app.stage || '', app));

      // La agenda queda igual, pero SOLO la última cita: si el candidato tuvo dos
      // sesiones, escribir en las dos borraría el "asistió" real de la primera con el
      // resultado de la segunda, y eso no se recupera.
      try {
        const parts = await getDocs(query(collection(db, 'interview_participants'), where('applicationId', '==', app.id)));
        const latest = latestByApplication(parts.docs.map(d => ({ id: d.id, ...(d.data() as any) }))).get(app.id);
        if (latest) await updateDoc(doc(db, 'interview_participants', latest.id), { status: next || 'pending' });
      } catch (e) {
        console.warn('No se pudo sincronizar la sesión de entrevista:', e);
      }

      setJustSaved({ appId: app.id, status: next, was: backing });
      onMarked?.(next);
    } catch (e) {
      console.error('No se pudo guardar la asistencia:', e);
      setError('No se pudo guardar. Revisa tu conexión.');
    } finally {
      setSaving(null);
    }
  };

  const marked = showingOwnMark && current === null ? null : app?.interviewAttendance;
  const markedWhen = marked?.markedAt?.toDate ? marked.markedAt.toDate().toLocaleString('es-DO', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }) : '';
  const markedBy = marked?.markedBy ? `Marcado por ${marked.markedBy}${markedWhen ? ` · ${markedWhen}` : ''}` : '';

  return (
    <div className={compact ? 'mt-2' : ''} onMouseDown={e => e.stopPropagation()}>
      {!compact && (
        <h3 className="text-[10px] lg:text-sm font-display font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center">
          <UserCheck className="w-4 h-4 mr-2 text-emerald-500" /> Asistencia a la entrevista
        </h3>
      )}
      <div className={`flex gap-1.5 ${compact ? '' : 'gap-2'}`}>
        {ATTENDANCE_OPTIONS.map(opt => {
          const on = current === opt.status;
          return (
            <button
              key={opt.status}
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); mark(opt.status); }}
              disabled={!!saving}
              title={on ? `${opt.label}. Pulsa otra vez para quitar la marca.${markedBy ? `\n${markedBy}` : ''}` : opt.label}
              className={`flex-1 flex items-center justify-center gap-1 border rounded-lg font-bold transition-colors disabled:opacity-60 ${
                compact ? 'text-[10px] py-1.5' : 'text-xs lg:text-sm py-2'
              } ${on ? opt.on : opt.off}`}
            >
              {saving === opt.status
                ? <Loader2 className={`animate-spin ${compact ? 'w-3 h-3' : 'w-4 h-4'}`} />
                : <span>{opt.emoji}</span>}
              {compact ? opt.short : opt.label}
            </button>
          );
        })}
      </div>
      {!compact && (
        <p className="mt-1.5 text-[11px] text-slate-400">
          {current
            ? `${markedBy || 'Registrado'} · Pulsa la misma opción para quitar la marca.`
            : 'Sin registrar. Marcar aquí alimenta el porcentaje de asistencia del Dashboard.'}
        </p>
      )}
      {error && <p className="mt-1 text-[10px] font-bold text-rose-600">{error}</p>}
    </div>
  );
}
