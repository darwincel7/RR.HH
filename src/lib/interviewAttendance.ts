import { serverTimestamp, deleteField, arrayUnion, increment, Timestamp } from 'firebase/firestore';

/**
 * ¿Asistió el candidato a la entrevista a la que lo invitamos?
 *
 * El dato se guarda en la POSTULACIÓN (no en la sesión de entrevista) por una razón
 * concreta: las métricas necesitan un denominador que no se borre. Si "los invitados"
 * se contaran por la etapa actual, cada persona que avanza a Finalista o se descarta
 * desaparecería del cálculo y el porcentaje de ausencias bajaría solo, sin que nadie
 * hubiera mejorado nada.
 *
 * Por eso al mover a alguien a una etapa de entrevista se sella `interviewInvitedAt`
 * una sola vez, y ahí se queda para siempre:
 *
 *   interviewInvitedAt      primera convocatoria (nunca se sobreescribe)
 *   interviewLastInvitedAt  la más reciente (una reconvocatoria la actualiza)
 *   interviewInviteCount    cuántas veces se le convocó
 *   interviewAttendance     { status, markedAt, markedBy, stage } — la marca VIGENTE
 *   interviewAttendanceLog  marcas anteriores, para no perder "la primera vez no vino"
 *
 * La página Entrevistas sigue guardando su `status` en `interview_participants`
 * (pending/attended/no_show): quien marca ahí escribe también aquí, y `attendanceOf`
 * acepta ese estado como respaldo para lo que se registró antes de esta función.
 */

export type AttendanceStatus = 'attended' | 'no_show';

/** Etapas que significan "lo invitamos a una entrevista" (las que envían la invitación con fecha). */
export const INTERVIEW_INVITE_STAGES = ['Convocado a entrevista', 'Entrevista presencial'];

/**
 * Etapas a las que solo se llega PASANDO por la entrevista. Sirven para no perder de
 * vista a quien fue invitado antes de que existiera el sello `interviewInvitedAt`.
 */
export const POST_INTERVIEW_STAGES = ['Tests presenciales', 'Finalista', 'Oferta', 'Contratado'];

export const isInterviewStage = (stage: string): boolean => INTERVIEW_INVITE_STAGES.includes(stage);

/** Las dos opciones del botón, con su texto y color (una sola definición para todas las pantallas). */
export const ATTENDANCE_OPTIONS: Array<{
  status: AttendanceStatus;
  label: string;
  short: string;
  emoji: string;
  /** Clases del botón cuando ESTÁ marcado. */
  on: string;
  /** Clases del botón cuando no lo está. */
  off: string;
}> = [
  {
    status: 'attended',
    label: 'Asistió a la entrevista',
    short: 'Asistió',
    emoji: '✅',
    on: 'bg-emerald-600 text-white border-emerald-600 shadow-sm',
    off: 'bg-white text-slate-500 border-slate-200 hover:border-emerald-400 hover:text-emerald-700',
  },
  {
    status: 'no_show',
    label: 'No se presentó',
    short: 'No vino',
    emoji: '❌',
    on: 'bg-rose-600 text-white border-rose-600 shadow-sm',
    off: 'bg-white text-slate-500 border-slate-200 hover:border-rose-400 hover:text-rose-700',
  },
];

/** El estado que viene de `interview_participants` traducido al de la postulación. */
export function fromParticipantStatus(status: unknown): AttendanceStatus | null {
  return status === 'attended' || status === 'no_show' ? status : null;
}

/**
 * La asistencia registrada de una postulación. `participantStatus` es el respaldo de la
 * página Entrevistas: lo marcado ahí antes de esta función sigue contando.
 */
export function attendanceOf(app: any, participantStatus?: unknown): AttendanceStatus | null {
  const own = app?.interviewAttendance?.status;
  if (own === 'attended' || own === 'no_show') return own;
  return fromParticipantStatus(participantStatus);
}

/**
 * ¿Se le convocó a entrevista alguna vez? El sello es la respuesta fiable; la etapa
 * actual y la marca de asistencia cubren lo que ya existía antes del sello.
 */
export function wasInvitedToInterview(app: any, participantStatus?: unknown): boolean {
  if (app?.interviewInvitedAt) return true;
  if (attendanceOf(app, participantStatus)) return true;
  const stage = app?.stage || '';
  return INTERVIEW_INVITE_STAGES.includes(stage) || POST_INTERVIEW_STAGES.includes(stage);
}

/**
 * ¿Tiene sentido ofrecer el botón de asistencia en esta postulación? Mira también lo
 * marcado en la página Entrevistas: sin eso, una asistencia que el Dashboard SÍ cuenta
 * (registrada en una sesión, en alguien ya descartado) no se podría corregir desde aquí.
 */
export function canMarkAttendance(app: any, participantStatus?: unknown): boolean {
  return wasInvitedToInterview(app, participantStatus);
}

/**
 * Los campos que hay que añadir al `updateDoc` del cambio de etapa cuando alguien
 * ENTRA a una etapa de entrevista. Devuelve `{}` cuando no hay nada que sellar, así el
 * llamador puede hacer `{ stage, ...interviewInviteStamp(...) }` sin condicionales.
 *
 * Un paso interno del proceso ("Convocado a entrevista" → "Entrevista presencial") NO
 * es una convocatoria nueva: no vuelve a contar ni borra la asistencia ya marcada. Una
 * reconvocatoria de verdad (vuelve a entrar desde fuera de las etapas de entrevista) sí
 * archiva la marca anterior en el log y deja la nueva cita sin marcar.
 */
export function interviewInviteStamp(app: any, fromStage: string, toStage: string): Record<string, any> {
  if (!isInterviewStage(toStage)) return {};

  // Ya estaba dentro del proceso de entrevista: solo completar el sello si falta
  // (postulaciones anteriores a esta función).
  if (isInterviewStage(fromStage)) {
    return app?.interviewInvitedAt ? {} : { interviewInvitedAt: serverTimestamp(), interviewInviteCount: increment(1) };
  }

  const fields: Record<string, any> = {
    interviewLastInvitedAt: serverTimestamp(),
    interviewInviteCount: increment(1),
  };
  if (!app?.interviewInvitedAt) fields.interviewInvitedAt = serverTimestamp();

  // Reconvocatoria: lo de la cita anterior se archiva, la nueva nace sin marcar.
  const previous = app?.interviewAttendance;
  if (previous?.status) {
    fields.interviewAttendance = deleteField();
    fields.interviewAttendanceLog = arrayUnion({
      status: previous.status,
      // serverTimestamp() no se admite dentro de un array.
      at: previous.markedAt || Timestamp.now(),
      by: previous.markedBy || '',
      stage: previous.stage || fromStage || '',
    });
  }
  return fields;
}

/**
 * Dar una CITA nueva (añadir a una sesión en la página Entrevistas). No pasa por un
 * cambio de etapa —el candidato ya está en "Convocado a entrevista"—, así que
 * `interviewInviteStamp` no lo vería nunca.
 *
 * Si ya había una asistencia marcada, esto es una reconvocatoria de verdad: la marca
 * anterior se archiva y la cita nueva nace sin marcar, para que la tarjeta no muestre
 * "no vino" de una reunión que todavía no ha ocurrido.
 */
export function interviewAppointmentStamp(app: any): Record<string, any> {
  const fields: Record<string, any> = { interviewLastInvitedAt: serverTimestamp() };
  if (!app?.interviewInvitedAt) {
    fields.interviewInvitedAt = serverTimestamp();
    fields.interviewInviteCount = increment(1);
  }

  const previous = app?.interviewAttendance;
  if (previous?.status) {
    fields.interviewAttendance = deleteField();
    fields.interviewInviteCount = increment(1);
    fields.interviewAttendanceLog = arrayUnion({
      status: previous.status,
      at: previous.markedAt || Timestamp.now(),
      by: previous.markedBy || '',
      stage: previous.stage || app?.stage || '',
    });
  }
  return fields;
}

/**
 * Los campos de la marca de asistencia. `status` en null la borra (clic en la opción ya
 * marcada = corregir un clic equivocado).
 *
 * Marcar la asistencia de una postulación convocada ANTES de que existiera el sello lo
 * crea de paso: sin fecha de convocatoria, el filtro por período no sabría a qué mes
 * pertenece esa entrevista.
 */
export function attendanceFields(
  status: AttendanceStatus | null,
  by: string,
  stage: string,
  app?: any,
): Record<string, any> {
  if (!status) return { interviewAttendance: deleteField() };
  return {
    interviewAttendance: {
      status,
      markedAt: serverTimestamp(),
      markedBy: by || 'Equipo',
      stage: stage || '',
    },
    ...(app && !app.interviewInvitedAt ? { interviewInvitedAt: serverTimestamp() } : {}),
  };
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

export interface InterviewFunnel {
  /** Cuántos fueron convocados a entrevista. Es el denominador de todo. */
  invited: number;
  attended: number;
  noShow: number;
  /** Convocados sin marca de asistencia todavía. */
  pending: number;
  /** % sobre los convocados (los tres suman 100 cuando hay convocados). */
  attendedPct: number;
  noShowPct: number;
  pendingPct: number;
  /**
   * % de asistencia contando SOLO los que ya tienen marca. Es el número a seguir
   * mientras falte gente por marcar: no se mueve porque alguien olvidara registrar.
   */
  attendedPctOfMarked: number;
  noShowPctOfMarked: number;
}

/** Un porcentaje con un decimal; 0 cuando no hay nada que dividir (nunca NaN). */
export const pct = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

/**
 * El embudo de asistencia de un conjunto de postulaciones. `participantStatusByApp`
 * trae lo marcado en la página Entrevistas (applicationId -> status), como respaldo.
 */
export function computeInterviewFunnel(
  apps: any[],
  participantStatusByApp?: Map<string, unknown> | Record<string, unknown>,
): InterviewFunnel {
  const statusFor = (app: any): unknown => {
    if (!participantStatusByApp) return undefined;
    return participantStatusByApp instanceof Map
      ? participantStatusByApp.get(app?.id)
      : participantStatusByApp[app?.id];
  };

  let invited = 0;
  let attended = 0;
  let noShow = 0;
  for (const app of apps || []) {
    const participantStatus = statusFor(app);
    if (!wasInvitedToInterview(app, participantStatus)) continue;
    invited++;
    const status = attendanceOf(app, participantStatus);
    if (status === 'attended') attended++;
    else if (status === 'no_show') noShow++;
  }
  const pending = invited - attended - noShow;
  const marked = attended + noShow;

  return {
    invited,
    attended,
    noShow,
    pending,
    attendedPct: pct(attended, invited),
    noShowPct: pct(noShow, invited),
    pendingPct: pct(pending, invited),
    attendedPctOfMarked: pct(attended, marked),
    noShowPctOfMarked: pct(noShow, marked),
  };
}

/**
 * El mismo embudo, partido por una clave (vacante, mes, reclutador…). Solo devuelve
 * grupos con al menos un convocado, ordenados de más convocados a menos.
 */
export function groupInterviewFunnel<T>(
  apps: any[],
  keyOf: (app: any) => string,
  labelOf: (key: string) => T,
  participantStatusByApp?: Map<string, unknown> | Record<string, unknown>,
): Array<{ key: string; label: T; funnel: InterviewFunnel }> {
  const byKey = new Map<string, any[]>();
  for (const app of apps || []) {
    const key = keyOf(app) || '';
    const list = byKey.get(key) || [];
    list.push(app);
    byKey.set(key, list);
  }
  return Array.from(byKey.entries())
    .map(([key, list]) => ({ key, label: labelOf(key), funnel: computeInterviewFunnel(list, participantStatusByApp) }))
    .filter(g => g.funnel.invited > 0)
    .sort((a, b) => b.funnel.invited - a.funnel.invited);
}

/** Cuándo se convocó a esta postulación, como Date (o null). Acepta Timestamp o fecha suelta. */
export function invitedAtDate(app: any): Date | null {
  const raw = app?.interviewInvitedAt || app?.interviewLastInvitedAt;
  if (!raw) return null;
  const d = raw?.toDate ? raw.toDate() : new Date(raw);
  return d && !isNaN(d.getTime()) ? d : null;
}

/**
 * Convocados dentro de los últimos `days` días. Las postulaciones SIN fecha de
 * convocatoria (las anteriores a esta función) se incluyen igual: excluirlas haría que
 * el total del período no cuadrara con el total general sin ninguna razón visible.
 */
export function invitedWithinDays(apps: any[], days: number): any[] {
  if (!days) return apps || [];
  const cutoff = Date.now() - days * 86_400_000;
  return (apps || []).filter(app => {
    const d = invitedAtDate(app);
    return !d || d.getTime() >= cutoff;
  });
}
