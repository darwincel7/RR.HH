import { minutesLeftInWindow, nextSendWindowOpenMs, formatWindowHour, DR_UTC_OFFSET_HOURS, type SendWindow } from './sendWindow';

// Days and clock times are DR's — the send window is defined in DR time, whatever the
// timezone of the device showing the estimate.
const DR_TZ = 'America/Santo_Domingo';
const drDay = (ms: number) => new Date(ms + DR_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);

/**
 * How long a bulk move's WhatsApp messages will take to go out — shown BEFORE moving, so
 * the slow, protective pace reads as a plan and not as "it's not working".
 *
 * Approximate by design: it uses the server's average automated pace (messages/hour),
 * what's already waiting in the queue, today's remaining budget and the send window.
 */

export interface PacingInfo {
  sentToday?: number;
  dailyLimit?: number;
  hourlyLimit?: number;
  autoPerHour?: number;
  quarantineUntil?: string | null;
  sendWindow?: { start: number; end: number; open?: boolean; opensAt?: string } | null;
  /** A queued message that can't go out within this many hours expires (not sent). */
  maxQueueHours?: number;
}

export interface BulkEta {
  /** Minutes until the last of these messages is expected out; null when some spill into another day. */
  minutes: number | null;
  /** How many of them are expected out today. */
  today: number;
  /** How many wait for another day (daily budget used up, or the send window closes). */
  later: number;
  /** When automated sending (re)starts, if it's paused right now (night, quarantine). */
  startsAt: number | null;
}

export function estimateBulkDelivery(count: number, pendingAhead: number, pacing: PacingInfo | null | undefined, nowMs: number): BulkEta {
  const n = Math.max(0, Math.floor(count));
  const ahead = Math.max(0, Math.floor(pendingAhead));
  const perHour = Math.max(1, pacing?.autoPerHour || Math.min(pacing?.hourlyLimit || 25, 25));
  const window: SendWindow = pacing?.sendWindow
    ? { start: pacing.sendWindow.start, end: pacing.sendWindow.end }
    : { start: 0, end: 24 };

  // When automated sending can start: after the quarantine, inside the window. The
  // server's own verdict on the window wins over this device's clock.
  let start = nowMs;
  const quarantine = pacing?.quarantineUntil ? new Date(pacing.quarantineUntil).getTime() : 0;
  if (quarantine > start) start = quarantine;
  const serverOpensAt = pacing?.sendWindow?.open === false && pacing.sendWindow.opensAt ? Date.parse(pacing.sendWindow.opensAt) : NaN;
  if (Number.isFinite(serverOpensAt) && serverOpensAt > start) start = serverOpensAt;
  start = nextSendWindowOpenMs(start, window);
  const startsAt = start > nowMs + 60_000 ? start : null;

  // Today's room: the daily budget left, and what fits before the window closes. If
  // sending only starts on a later day, that day's full budget applies instead.
  const startsToday = drDay(start) === drDay(nowMs);
  const dailyLimit = pacing?.dailyLimit ?? Infinity;
  const dailyLeft = Math.max(0, startsToday ? dailyLimit - (pacing?.sentToday || 0) : dailyLimit);
  const windowRoom = Math.floor((minutesLeftInWindow(start, window) / 60) * perHour);
  const room = Math.max(0, Math.min(dailyLeft, windowRoom) - ahead);

  const today = Math.min(n, room);
  const later = n - today;
  const minutes = later > 0 ? null : Math.ceil((start - nowMs) / 60_000 + ((ahead + n) / perHour) * 60);
  return { minutes, today, later, startsAt };
}

function humanDuration(minutes: number): string {
  if (minutes < 2) return 'un par de minutos';
  if (minutes < 60) return `unos ${Math.round(minutes)} minutos`;
  let h = Math.floor(minutes / 60);
  let m = Math.round((minutes % 60) / 5) * 5;
  if (m === 60) { h++; m = 0; }
  const hours = h === 1 ? 'una hora' : `unas ${h} horas`;
  return m > 0 ? `${hours} y ${m} minutos` : hours;
}

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit', timeZone: DR_TZ });

function dayWord(ms: number, nowMs: number): string {
  if (drDay(ms) === drDay(nowMs)) return 'hoy';
  if (drDay(ms) === drDay(nowMs + 86_400_000)) return 'mañana';
  return `el ${new Date(ms).toLocaleDateString('es-DO', { weekday: 'long', timeZone: DR_TZ })}`;
}

/** The estimate in one sentence a recruiter can act on. */
export function describeBulkEta(eta: BulkEta, pacing?: PacingInfo | null, nowMs: number = Date.now()): string {
  const startText = eta.startsAt
    ? `Empezarán a salir ${dayWord(eta.startsAt, nowMs)} a las ${timeOf(eta.startsAt)}`
    : 'Empezarán a salir de inmediato';
  if (eta.later === 0 && eta.minutes !== null) {
    const sendingMinutes = eta.minutes - (eta.startsAt ? Math.max(0, (eta.startsAt - nowMs) / 60_000) : 0);
    return `${startText} y terminarán en ${humanDuration(Math.max(1, sendingMinutes))}.`;
  }
  const why = pacing?.sendWindow && !(pacing.sendWindow.start === 0 && pacing.sendWindow.end === 24)
    ? `por el límite diario y el horario de envío (${formatWindowHour(pacing.sendWindow.start)} – ${formatWindowHour(pacing.sendWindow.end)})`
    : 'por el límite diario de envíos';
  return eta.today > 0
    ? `${startText}: ${dayWord(eta.startsAt || nowMs, nowMs)} saldrán ~${eta.today} y los otros ${eta.later} en los próximos días, ${why}.`
    : `Ya no caben más envíos ${dayWord(eta.startsAt || nowMs, nowMs)} ${why}: los ${eta.later} saldrán en los próximos días.`;
}
