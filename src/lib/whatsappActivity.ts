import { normalizePhone } from './phone';

/**
 * WhatsApp activity as the side panel and the candidate cards show it: to whom, what
 * and when — sent, waiting or failed. The data comes from GET /api/whatsapp/activity;
 * these helpers only shape it into short Spanish lines (pure, so they're testable).
 */

export type WaitReason =
  | 'sending' | 'now' | 'turn' | 'retry' | 'window' | 'daily' | 'hourly' | 'quarantine' | 'disconnected';

export interface ActivityMessage {
  id: string;
  candidateId: string | null;
  candidateName: string | null;
  phone: string | null;
  origin: 'manual' | 'automation';
  stage: string | null;
  vacancy: string | null;
  preview: string;
  status: 'queued' | 'sending' | 'sent' | 'failed';
  createdAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  attempts: number;
  // sent only — "Esperando el mensaje": the candidate's phone couldn't decrypt it and
  // asked for it again; and whether someone already repaired / re-sent it.
  retryRequests?: number;
  lastRetryRequestAt?: string | null;
  repairs?: number;
  lastRepairAt?: string | null;
  resentAt?: string | null;
  resendOf?: string | null;
  canRepair?: boolean;
  // pending only
  etaAt?: string | null;
  waitReason?: WaitReason;
  // failed only
  reason?: string;
  retryable?: boolean;
  hint?: string;
}

export interface ActivityData {
  enabled: boolean;
  generatedAt?: string;
  connection?: string;
  suspended?: boolean;
  sentToday?: number;
  dailyLimit?: number;
  pending: ActivityMessage[];
  failed: ActivityMessage[];
  sent: ActivityMessage[];
}

/** Fired after the app queues a WhatsApp message, so the panel refreshes right away. */
export const WA_ACTIVITY_CHANGED_EVENT = 'wa-activity-changed';

export function notifyWhatsAppActivityChanged(): void {
  try {
    window.dispatchEvent(new Event(WA_ACTIVITY_CHANGED_EVENT));
  } catch { /* not in a browser (tests) */ }
}

// All clock times are shown in DR time, whatever the device's timezone.
const DR_TZ = 'America/Santo_Domingo';
const drDay = (ms: number) => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit', timeZone: DR_TZ });
}

/** "hoy", "ayer", "mañana" or "lun 12 oct". */
export function dayLabel(ms: number, nowMs: number): string {
  const d = drDay(ms);
  if (d === drDay(nowMs)) return 'hoy';
  if (d === drDay(nowMs - 86_400_000)) return 'ayer';
  if (d === drDay(nowMs + 86_400_000)) return 'mañana';
  return new Date(ms).toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: DR_TZ });
}

/** "2:14 p. m." today, otherwise "ayer 2:14 p. m." / "lun 12 oct 2:14 p. m.". */
export function whenLabel(iso: string | null | undefined, nowMs: number): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return '';
  const day = dayLabel(ms, nowMs);
  return day === 'hoy' ? formatClock(ms) : `${day} ${formatClock(ms)}`;
}

/** One line: when a waiting message should go out, and why it waits. */
export function describeWait(m: Pick<ActivityMessage, 'waitReason' | 'etaAt'>, nowMs: number): string {
  const eta = m.etaAt ? Date.parse(m.etaAt) : NaN;
  const at = Number.isFinite(eta)
    ? (dayLabel(eta, nowMs) === 'hoy' ? `~${formatClock(eta)}` : `${dayLabel(eta, nowMs)} ~${formatClock(eta)}`)
    : '';
  switch (m.waitReason) {
    case 'sending': return 'Enviando ahora…';
    case 'now': return 'Sale en un momento';
    case 'retry': return `Reintenta solo ${at}`.trim();
    case 'window': return `Sale ${at} (fuera de horario)`;
    case 'daily': return `Sale ${at} (ya se llegó al límite de hoy)`;
    case 'hourly': return `Sale ${at} (límite por hora)`;
    case 'quarantine': return `Sale ${at} (número recién vinculado)`;
    case 'disconnected': return 'Espera a que WhatsApp se reconecte';
    default: return at ? `Sale ${at}` : 'En cola';
  }
}

/** "Convocado a entrevista · Vendedor" for automations; "Mensaje manual" for the chat. */
export function whatLabel(m: Pick<ActivityMessage, 'origin' | 'stage' | 'vacancy'>): string {
  if (m.origin === 'manual') return 'Mensaje manual (chat)';
  const stage = m.stage || 'Mensaje automático';
  return m.vacancy ? `${stage} · ${m.vacancy}` : stage;
}

/** What the recipient's side reports for a sent message. */
export function deliveryLabel(m: Pick<ActivityMessage, 'readAt' | 'deliveredAt'>): 'Leído' | 'Entregado' | 'Enviado' {
  if (m.readAt) return 'Leído';
  if (m.deliveredAt) return 'Entregado';
  return 'Enviado';
}

/** Without a delivery receipt this long after going out, the panel flags the message. */
export const UNCONFIRMED_AFTER_MS = 2 * 3_600_000;

/**
 * Should the recruiter look at this sent message? 'retry': the candidate's phone
 * couldn't decrypt it and asked for it again (it was re-sent automatically — if they
 * still see "Esperando el mensaje", repair it). 'unconfirmed': no delivery receipt after
 * a while (phone off… or stuck). A read message never needs attention.
 */
export function deliveryAttention(
  m: Pick<ActivityMessage, 'status' | 'sentAt' | 'deliveredAt' | 'readAt' | 'retryRequests'>,
  nowMs: number,
): 'retry' | 'unconfirmed' | null {
  if (m.status !== 'sent' || m.readAt) return null;
  if ((m.retryRequests || 0) > 0) return 'retry';
  const sent = m.sentAt ? Date.parse(m.sentAt) : NaN;
  if (!m.deliveredAt && Number.isFinite(sent) && nowMs - sent >= UNCONFIRMED_AFTER_MS) return 'unconfirmed';
  return null;
}

/** Does this message belong to that candidate? By id, or by phone for older messages. */
export function isForCandidate(m: Pick<ActivityMessage, 'candidateId' | 'phone'>, candidateId?: string | null, phone?: string | null): boolean {
  if (candidateId && m.candidateId && m.candidateId === candidateId) return true;
  const a = normalizePhone(m.phone || '');
  const b = normalizePhone(phone || '');
  return !!a && a === b;
}

/**
 * The WhatsApp state to show on a candidate's card for the stage it sits in: a failure
 * (with the retry button) wins over a message still waiting. A failure from another
 * stage is old news — retrying it would send outdated information — so it isn't shown
 * on the card (the side panel still lists it).
 */
export function candidateStageState(
  data: ActivityData | null,
  who: { candidateId?: string | null; phone?: string | null },
  stage?: string | null,
  vacancy?: string | null,
): { kind: 'failed'; message: ActivityMessage } | { kind: 'pending'; message: ActivityMessage } | null {
  if (!data?.enabled) return null;
  const relevant = (m: ActivityMessage) =>
    isForCandidate(m, who.candidateId, who.phone) &&
    (m.origin === 'manual' || !stage || m.stage === stage) &&
    (!vacancy || !m.vacancy || m.vacancy === vacancy);
  const failed = data.failed.find(relevant);
  if (failed) return { kind: 'failed', message: failed };
  const pending = data.pending.find(relevant);
  if (pending) return { kind: 'pending', message: pending };
  return null;
}
