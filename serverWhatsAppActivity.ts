/**
 * Pure logic behind the "Mensajes de WhatsApp" side panel — no I/O, so it's testable.
 *
 * The panel answers, for every message, the recruiter's three questions: to WHOM, WHAT
 * (which notification, automatic or typed by hand) and WHEN (when it went out, or —
 * for one still in line — roughly when it will). Failures are explained in plain words
 * and say whether retrying can help.
 *
 * Nothing here decides whether a message is sent: the drain (server.ts) and its rules
 * (serverWhatsAppQueue.ts) do. This module only PREDICTS what they will do, using the
 * same caps, window and pacing, so the estimate and reality agree.
 */
import {
  AUTO_SPACING_MIN_MS, AUTO_SPACING_MAX_MS, AUTO_BURST_MIN, AUTO_BURST_MAX,
  AUTO_LONG_PAUSE_MIN_MS, AUTO_LONG_PAUSE_MAX_MS, dailySendLimit,
} from './serverWhatsAppQueue';
import { nextSendWindowOpenMs, DR_UTC_OFFSET_HOURS, type SendWindow } from './src/lib/sendWindow';

/** Average time one automated message takes in the drain: gaps, long rests and typing. */
export function averageAutomationMessageMs(): number {
  const avgGap = (AUTO_SPACING_MIN_MS + AUTO_SPACING_MAX_MS) / 2;
  const avgLong = (AUTO_LONG_PAUSE_MIN_MS + AUTO_LONG_PAUSE_MAX_MS) / 2;
  const avgBurst = (AUTO_BURST_MIN + AUTO_BURST_MAX) / 2;
  const avgTyping = 5_000;
  return ((avgBurst - 1) * avgGap + avgLong) / avgBurst + avgTyping;
}

// DR wall-clock helpers (UTC-4 all year): the daily budget resets at DR midnight, the
// hourly one at the top of each DR hour — same keys the drain uses.
const DR_OFFSET_MS = DR_UTC_OFFSET_HOURS * 3_600_000;
const drDayKey = (ms: number) => new Date(ms + DR_OFFSET_MS).toISOString().slice(0, 10);
const drHourKey = (ms: number) => new Date(ms + DR_OFFSET_MS).toISOString().slice(0, 13);
const nextDrMidnight = (ms: number) => {
  const c = new Date(ms + DR_OFFSET_MS);
  return Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate() + 1) - DR_OFFSET_MS;
};
const nextHourStart = (ms: number) => Math.floor(ms / 3_600_000) * 3_600_000 + 3_600_000;

/** Why a queued message hasn't gone out yet (the panel turns it into one short line). */
export type WaitReason =
  | 'sending'      // the drain has it right now
  | 'now'          // next in line, about to go
  | 'turn'         // waiting its turn behind others (protective pacing)
  | 'retry'        // failed once, retrying later on its own
  | 'window'       // night: automated messages wait for the morning
  | 'daily'        // today's limit is used up → tomorrow
  | 'hourly'       // this hour's limit is used up → next hour
  | 'quarantine'   // number just linked: automated messages rest a few hours
  | 'disconnected'; // WhatsApp is down: nothing can go out until it's back

export interface QueueItem {
  id: string;
  origin: 'manual' | 'automation';
  status: 'queued' | 'sending';
  /** When it may next be attempted (retry backoff); 0 = now. */
  nextAttemptAtMs: number;
}

export interface EtaContext {
  nowMs: number;
  /** Can WhatsApp send right now? (connected, not suspended) */
  connected: boolean;
  window: SendWindow;
  quarantineUntilMs: number;
  /** Earliest the next AUTOMATED message may go (persisted pacing gap). */
  autoNextAtMs: number;
  sentToday: number;
  sentThisHour: number;
  hourlyCap: number;
  /** When the current number was first paired (drives the daily ramp); 0 = unknown. */
  linkedAtMs: number;
  matureDailyCap: number;
  /** Average spacing between automated messages (defaults to the drain's real pacing). */
  perMessageMs?: number;
}

export interface QueueEta { etaMs: number | null; reason: WaitReason }

/**
 * Roughly when each queued message will go out, in queue order. Manual chat goes first
 * and skips the automation guards (as in the drain); automated messages respect the
 * quarantine, the send window, the hour/day caps and the pacing gap.
 */
export function estimateQueueEtas(items: QueueItem[], ctx: EtaContext): Record<string, QueueEta> {
  const out: Record<string, QueueEta> = {};
  const now = ctx.nowMs;
  const perMessage = Math.max(1_000, ctx.perMessageMs ?? averageAutomationMessageMs());
  const capAt = (ms: number) => dailySendLimit(ctx.linkedAtMs ? (ms - ctx.linkedAtMs) / 86_400_000 : 0, ctx.matureDailyCap);

  let day = drDayKey(now);
  let hour = drHourKey(now);
  let usedDay = Math.max(0, ctx.sentToday || 0);
  let usedHour = Math.max(0, ctx.sentThisHour || 0);
  const roll = (t: number) => {
    if (drDayKey(t) !== day) { day = drDayKey(t); usedDay = 0; }
    if (drHourKey(t) !== hour) { hour = drHourKey(t); usedHour = 0; }
  };

  const manual = items.filter(i => i.origin === 'manual');
  const auto = items.filter(i => i.origin !== 'manual');

  // 1) Manual chat: right away (a few seconds apart), whatever the caps say.
  let manualT = now;
  for (const m of manual) {
    if (!ctx.connected) { out[m.id] = { etaMs: null, reason: 'disconnected' }; continue; }
    if (m.status === 'sending') { out[m.id] = { etaMs: now, reason: 'sending' }; continue; }
    const t = Math.max(manualT, m.nextAttemptAtMs || 0);
    out[m.id] = { etaMs: t, reason: t > now + 60_000 ? 'retry' : 'now' };
    manualT = t + 15_000;
    usedDay++; usedHour++; // manual messages count toward the budgets too
  }

  // 2) Automated messages, one at a time.
  let t = Math.max(now, ctx.autoNextAtMs || 0, manualT > now ? manualT : now);
  let first = true;
  for (const a of auto) {
    if (!ctx.connected) { out[a.id] = { etaMs: null, reason: 'disconnected' }; continue; }
    if (a.status === 'sending') { out[a.id] = { etaMs: now, reason: 'sending' }; first = false; continue; }

    // The FIRST guard that holds it back is the reason shown.
    let reason: WaitReason | null = null;
    if (a.nextAttemptAtMs > t) { t = a.nextAttemptAtMs; reason = 'retry'; }
    if (ctx.quarantineUntilMs > t) { t = ctx.quarantineUntilMs; reason = reason || 'quarantine'; }
    // Walk forward until every guard lets it out (bounded: weeks of hops at most).
    for (let hop = 0; hop < 400; hop++) {
      const open = nextSendWindowOpenMs(t, ctx.window);
      if (open > t) { t = open; reason = reason || 'window'; }
      roll(t);
      if (usedDay >= capAt(t)) { t = nextDrMidnight(t); reason = reason || 'daily'; continue; }
      if (usedHour >= ctx.hourlyCap) { t = nextHourStart(t); reason = reason || 'hourly'; continue; }
      break;
    }
    const finalReason: WaitReason = reason || (first && t - now < 90_000 ? 'now' : 'turn');
    out[a.id] = { etaMs: t, reason: finalReason };
    usedDay++; usedHour++;
    t += perMessage;
    first = false;
  }
  return out;
}

/** A failed message, explained: what happened in plain words and whether retrying helps. */
export interface FailureInfo { reason: string; retryable: boolean; hint?: string }

export function describeFailure(lastError: string | null | undefined): FailureInfo {
  const e = String(lastError || '');
  if (/opt-out|pidió no recibir/i.test(e)) {
    return { reason: 'El candidato pidió no recibir más mensajes', retryable: false, hint: 'Contáctalo por correo o llamada.' };
  }
  if (/no tiene WhatsApp/i.test(e)) {
    return { reason: 'Ese número no tiene WhatsApp', retryable: false, hint: 'Corrige el teléfono en el perfil y escríbele desde ahí.' };
  }
  if (/Tel[eé]fono inv[aá]lido|phone_invalido/i.test(e)) {
    return { reason: 'El teléfono no es válido', retryable: false, hint: 'Corrige el teléfono en el perfil y escríbele desde ahí.' };
  }
  if (/^Vencido/i.test(e)) {
    return { reason: 'No salió a tiempo (WhatsApp desconectado o límite del día)', retryable: true };
  }
  if (/forbidden|not-authorized|unauthorized|403/i.test(e)) {
    return { reason: 'WhatsApp rechazó el envío', retryable: true };
  }
  if (/timed? ?out|timeout|connection|closed|ECONN|socket/i.test(e)) {
    return { reason: 'Se cortó la conexión de WhatsApp al enviarlo', retryable: true };
  }
  return { reason: 'No se pudo enviar', retryable: true };
}

/** "Convocado a entrevista" + vacancy title from the automation's topic key, when present. */
export function vacancyFromTopicKey(topicKey: unknown): string | null {
  if (typeof topicKey !== 'string' || !topicKey) return null;
  try {
    const parsed = JSON.parse(topicKey);
    const v = Array.isArray(parsed) ? parsed[1] : null;
    return typeof v === 'string' && v.trim() && v !== 'la vacante' ? v.trim().slice(0, 120) : null;
  } catch {
    return null;
  }
}
