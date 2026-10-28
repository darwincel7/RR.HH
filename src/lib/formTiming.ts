import { STAGE2_DEADLINE_DAYS } from './whatsappTemplates';
import { DR_UTC_OFFSET_HOURS } from './sendWindow';

/**
 * Formulario de etapa 2: cuándo se le envió el link a cada candidato, cuándo le llegó,
 * cuándo lo abrió y cuándo lo completó — cuánto tardó y si lo hizo a tiempo.
 *
 * Los datos viven en `application.stage2Link` (los escribe el SERVIDOR cuando el
 * mensaje sale de verdad, no cuando se movió la tarjeta: con el ritmo anti-baneo y el
 * horario de envío, un link puede salir horas después del movimiento, y el reloj del
 * candidato empieza cuando lo recibe) más `stage2SubmittedAt` (cuando lo envió).
 *
 * Compartido por el servidor (que calcula la fecha límite al registrar el envío) y las
 * pantallas (perfil, Dashboard), así que todos miden igual.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DR_OFFSET_MS = DR_UTC_OFFSET_HOURS * HOUR_MS;

/** Timestamp de Firestore, Date, ISO o milisegundos → milisegundos (0 si no hay dato). */
export function toMs(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : 0;
  if (typeof v === 'string') { const ms = Date.parse(v); return Number.isFinite(ms) ? ms : 0; }
  if (typeof v === 'object') {
    const anyV = v as any;
    if (typeof anyV.toMillis === 'function') { const ms = anyV.toMillis(); return Number.isFinite(ms) ? ms : 0; }
    // Timestamp serializado ({seconds, nanoseconds} o {_seconds, _nanoseconds}).
    const s = anyV.seconds ?? anyV._seconds;
    if (typeof s === 'number') return s * 1000 + Math.floor((anyV.nanoseconds ?? anyV._nanoseconds ?? 0) / 1e6);
  }
  return 0;
}

/**
 * La fecha límite que el mensaje le dio al candidato: "antes del jueves 15 de octubre"
 * se calcula con el momento en que se ordenó el envío + 3 días (whatsapp.ts). Se
 * toma hasta el FINAL de ese día, hora de RD: completar el mismo jueves cuenta como a
 * tiempo — es como lo lee la gente.
 */
export function stage2DueAtMs(queuedAtMs: number, days: number = STAGE2_DEADLINE_DAYS): number {
  const target = queuedAtMs + days * DAY_MS;
  const drDayStart = Math.floor((target + DR_OFFSET_MS) / DAY_MS) * DAY_MS - DR_OFFSET_MS;
  return drDayStart + DAY_MS - 1;
}

export type Stage2Status =
  | 'a_tiempo'               // lo completó antes del final de la fecha límite
  | 'tarde'                  // lo completó, pero después de la fecha límite
  | 'pendiente'              // se le envió y aún está en plazo
  | 'vencido'                // se le envió, no lo ha completado y el plazo ya pasó
  | 'completado_sin_envio'   // lo completó, pero no hay registro de cuándo se le envió
  | 'sin_envio';             // ni enviado ni completado

/** Indicios de que el mensaje con el link no se pudo leer ("Esperando el mensaje"). */
export type DeliveryIssue =
  | 'retry_requested'   // su teléfono avisó que no pudo descifrarlo (se reenvió solo)
  | 'no_confirmation';  // salió hace rato y WhatsApp no confirma que llegó

export interface Stage2Timing {
  status: Stage2Status;
  /** Primera vez que el link salió (por cualquier vía). */
  sentAtMs: number;
  lastSentAtMs: number;
  /** El envío se dedujo del cambio de etapa (formularios anteriores a este registro). */
  approximate: boolean;
  whatsappSentAtMs: number;
  emailSentAtMs: number;
  whatsappSends: number;
  emailSends: number;
  deliveredAtMs: number;
  readAtMs: number;
  openedAtMs: number;
  submittedAtMs: number;
  dueAtMs: number;
  /** Del envío a completarlo (o hasta ahora, si sigue pendiente). 0 sin envío. */
  elapsedMs: number;
  /** Cuánto después del plazo lo completó, o cuánto lleva vencido. 0 si va a tiempo. */
  lateByMs: number;
  retryRequests: number;
  lastRetryRequestAtMs: number;
  repairedAtMs: number;
  /** Para "Reparar entrega": el mensaje de WhatsApp que llevó el link. */
  outboxId: string | null;
  deliveryIssue: DeliveryIssue | null;
}

/** Sin confirmación de entrega pasado este tiempo, se avisa al reclutador. */
export const NO_CONFIRMATION_AFTER_MS = 2 * HOUR_MS;

export function computeStage2Timing(app: any, nowMs: number): Stage2Timing {
  const link = (app?.stage2Link && typeof app.stage2Link === 'object') ? app.stage2Link : {};
  const sentAtMs = toMs(link.firstSentAt);
  const submittedAtMs = toMs(app?.stage2SubmittedAt);
  const dueAtMs = toMs(link.dueAt) || (sentAtMs ? stage2DueAtMs(sentAtMs) : 0);
  const deliveredAtMs = toMs(link.deliveredAt);
  const readAtMs = toMs(link.readAt);
  const openedAtMs = toMs(link.openedAt);
  const whatsappSentAtMs = toMs(link.whatsappSentAt);
  const retryRequests = Number(link.retryRequests) || 0;
  const completed = !!submittedAtMs || !!app?.stage2Answers;

  let status: Stage2Status;
  let elapsedMs = 0;
  let lateByMs = 0;
  if (completed) {
    // Completó antes del primer envío registrado: le llegó el link por otra vía (lo
    // copiaron a mano, un QR…). No hay un "desde" honesto que medir.
    if (!sentAtMs || !submittedAtMs || submittedAtMs < sentAtMs) {
      status = 'completado_sin_envio';
    } else {
      elapsedMs = submittedAtMs - sentAtMs;
      lateByMs = Math.max(0, submittedAtMs - dueAtMs);
      status = lateByMs > 0 ? 'tarde' : 'a_tiempo';
    }
  } else if (sentAtMs) {
    elapsedMs = Math.max(0, nowMs - sentAtMs);
    lateByMs = Math.max(0, nowMs - dueAtMs);
    status = lateByMs > 0 ? 'vencido' : 'pendiente';
  } else {
    status = 'sin_envio';
  }

  // Solo importa mientras siga sin completarlo y sin abrir el link: abrirlo prueba
  // que el mensaje se leyó.
  let deliveryIssue: DeliveryIssue | null = null;
  if (!completed && !openedAtMs && whatsappSentAtMs && !readAtMs) {
    if (retryRequests > 0) deliveryIssue = 'retry_requested';
    else if (!deliveredAtMs && nowMs - toMs(link.lastWhatsappSentAt || link.whatsappSentAt) >= NO_CONFIRMATION_AFTER_MS) {
      deliveryIssue = 'no_confirmation';
    }
  }

  return {
    status,
    sentAtMs,
    lastSentAtMs: toMs(link.lastSentAt) || sentAtMs,
    approximate: !!link.approximate,
    whatsappSentAtMs,
    emailSentAtMs: toMs(link.emailSentAt),
    whatsappSends: Number(link.whatsappSends) || (whatsappSentAtMs ? 1 : 0),
    emailSends: Number(link.emailSends) || (toMs(link.emailSentAt) ? 1 : 0),
    deliveredAtMs,
    readAtMs,
    openedAtMs,
    submittedAtMs,
    dueAtMs,
    elapsedMs,
    lateByMs,
    retryRequests,
    lastRetryRequestAtMs: toMs(link.lastRetryRequestAt),
    repairedAtMs: toMs(link.repairedAt),
    outboxId: typeof link.outboxId === 'string' && link.outboxId ? link.outboxId : null,
    deliveryIssue,
  };
}

/** "45 min", "3 h 20 min", "2 días 4 h". Redondeado a lo que a una persona le sirve. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return 'menos de 1 min';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin} min`;
  const totalH = Math.floor(totalMin / 60);
  if (totalH < 24) {
    const m = totalMin % 60;
    return m ? `${totalH} h ${m} min` : `${totalH} h`;
  }
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  const days = `${d} ${d === 1 ? 'día' : 'días'}`;
  return h ? `${days} ${h} h` : days;
}

export const STAGE2_STATUS_LABEL: Record<Stage2Status, string> = {
  a_tiempo: 'A tiempo',
  tarde: 'Fuera de plazo',
  pendiente: 'Pendiente',
  vencido: 'Vencido sin completar',
  completado_sin_envio: 'Completado (envío sin registrar)',
  sin_envio: 'Sin enviar',
};

/** Tramos de tiempo de respuesta para la distribución del Dashboard. */
export const RESPONSE_BUCKETS: Array<{ key: string; label: string; maxMs: number }> = [
  { key: 'lt1h', label: 'Menos de 1 hora', maxMs: HOUR_MS },
  { key: 'lt6h', label: '1 a 6 horas', maxMs: 6 * HOUR_MS },
  { key: 'lt24h', label: '6 a 24 horas', maxMs: DAY_MS },
  { key: 'lt3d', label: '1 a 3 días', maxMs: 3 * DAY_MS },
  { key: 'gt3d', label: 'Más de 3 días', maxMs: Infinity },
];

export interface Stage2Summary {
  /** Con envío registrado. */
  sent: number;
  completed: number;
  onTime: number;
  late: number;
  pending: number;
  overdue: number;
  /** Completados sin fecha de envío registrada (no entran en los tiempos). */
  completedWithoutSend: number;
  /** Mediana del envío a completarlo (0 si nadie lo completó). */
  medianMs: number;
  fastestMs: number;
  slowestMs: number;
  deliveryIssues: number;
  completedPct: number;
  onTimePct: number;
  latePct: number;
  buckets: Array<{ key: string; label: string; count: number; pct: number }>;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export function summarizeStage2(timings: Stage2Timing[]): Stage2Summary {
  const withSend = timings.filter(t => t.sentAtMs > 0 && t.status !== 'completado_sin_envio');
  const done = withSend.filter(t => t.status === 'a_tiempo' || t.status === 'tarde');
  const durations = done.map(t => t.elapsedMs).sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const medianMs = durations.length === 0 ? 0
    : durations.length % 2 ? durations[mid] : Math.round((durations[mid - 1] + durations[mid]) / 2);
  const onTime = done.filter(t => t.status === 'a_tiempo').length;
  const late = done.length - onTime;

  const counts = RESPONSE_BUCKETS.map(() => 0);
  for (const ms of durations) {
    const i = RESPONSE_BUCKETS.findIndex(b => ms < b.maxMs);
    counts[i === -1 ? counts.length - 1 : i]++;
  }

  return {
    sent: withSend.length,
    completed: done.length,
    onTime,
    late,
    pending: withSend.filter(t => t.status === 'pendiente').length,
    overdue: withSend.filter(t => t.status === 'vencido').length,
    completedWithoutSend: timings.filter(t => t.status === 'completado_sin_envio').length,
    medianMs,
    fastestMs: durations[0] || 0,
    slowestMs: durations[durations.length - 1] || 0,
    deliveryIssues: withSend.filter(t => t.deliveryIssue).length,
    completedPct: pct(done.length, withSend.length),
    onTimePct: pct(onTime, done.length),
    latePct: pct(late, done.length),
    buckets: RESPONSE_BUCKETS.map((b, i) => ({ key: b.key, label: b.label, count: counts[i], pct: pct(counts[i], durations.length) })),
  };
}
