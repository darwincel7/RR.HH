/**
 * Pure decision logic for the WhatsApp outbox — no I/O, so every rule that decides
 * whether/when a message goes out is unit-testable.
 *
 * Why an outbox at all: sends used to go straight at the live Baileys socket from the
 * request handler. If the socket was down (or died mid-batch), the message was simply
 * lost and a human had to notice and retry. With the outbox, a message is DURABLE from
 * the moment the recruiter acts: it stays queued until a send actually succeeds, no
 * matter how many disconnections happen in between.
 */

/** Give up on a message after this many failed attempts (then it's flagged + alerted). */
export const OUTBOX_MAX_ATTEMPTS = 6;

/** A message stuck in 'sending' longer than this was orphaned by a crash/restart. */
export const OUTBOX_STUCK_MS = 3 * 60 * 1000;

/** Drain budget per HTTP-driven pass — stay well inside Cloud Run's request timeout.
 * 200s, not 240: after the last deadline check a message can still add up to ~40s
 * (waitForWhatsAppReady 25s + typing ≤10s + the send itself) before the pass ends. */
export const OUTBOX_DRAIN_DEADLINE_MS = 200_000;

/**
 * Pause between consecutive sends: 8–20s randomized, with a longer 45–90s "breather"
 * every few messages. The account that got BANNED was pacing at 2.5–5s — regular,
 * fast, near-identical texts are exactly the fingerprint WhatsApp's anti-spam looks
 * for; a human sending invitations pauses irregularly and takes breaks. The durable
 * queue makes the slowness invisible — the recruiter never waits on it.
 */
export const SEND_SPACING_MIN_MS = 8_000;
export const SEND_SPACING_MAX_MS = 20_000;
export const LONG_PAUSE_EVERY = 6;         // every ~6 sends…
export const LONG_PAUSE_MIN_MS = 45_000;   // …rest 45–90s
export const LONG_PAUSE_MAX_MS = 90_000;

export function nextSpacingMs(sentInBurst = 0, random: () => number = Math.random): number {
  const longBreak = sentInBurst > 0 && sentInBurst % LONG_PAUSE_EVERY === 0;
  const min = longBreak ? LONG_PAUSE_MIN_MS : SEND_SPACING_MIN_MS;
  const max = longBreak ? LONG_PAUSE_MAX_MS : SEND_SPACING_MAX_MS;
  return Math.round(min + (max - min) * random());
}

/**
 * "Typing…" time shown to the recipient before a message goes out (presence update
 * `composing`). A message that materializes with zero typing time is a bot tell;
 * scale with length like a person would, capped so long templates don't stall the
 * queue. ±25% jitter so no two messages "type" for exactly the same time.
 */
export function typingDelayMs(messageLength: number, random: () => number = Math.random): number {
  const base = Math.min(1_500 + messageLength * 35, 8_000);
  const jitter = 0.75 + random() * 0.5; // 0.75–1.25
  return Math.round(base * jitter);
}

/**
 * Daily send budget by account age ("warm-up"). A freshly QR-linked number that
 * immediately blasts at full volume is the classic instant-ban pattern — reputation
 * is earned over ~2 weeks. Days are counted since the CURRENT number was first
 * paired; an unknown link date is treated as day 0 (safest assumption).
 */
export const WA_MATURE_DAILY_CAP = 200;

export function dailySendLimit(daysSinceLinked: number, matureCap = WA_MATURE_DAILY_CAP): number {
  const ramp =
    daysSinceLinked < 1 ? 20 :
    daysSinceLinked < 2 ? 35 :
    daysSinceLinked < 4 ? 60 :
    daysSinceLinked < 7 ? 100 :
    daysSinceLinked < 14 ? 150 :
    matureCap;
  return Math.min(ramp, matureCap);
}

/** Hourly ceiling, independent of account age: bulk moves drip out instead of bursting. */
export const HOURLY_SEND_CAP = 25;

/**
 * Opt-out detector for inbound replies. A recipient who asked to stop and keeps
 * receiving messages will block/report the number — recipient reports are the
 * strongest ban signal there is — so honoring "no me escriban" protects both the
 * candidate and the account. Conservative on purpose: only short, unambiguous
 * requests count (a long sentence that merely contains "no" must not opt anyone out).
 */
const OPT_OUT_RE = new RegExp(
  [
    // "no me escriban / no me contacten / no molesten…" — imperative forms aimed at
    // us. Deliberately NOT bare stems: "no me molesta el horario" (= I don't mind)
    // and "no me mandaron el link" (= it never arrived) are conversation, not opt-out.
    'no\\s+(me\\s+)?(escrib(as|an|a|ir)|contact(es|en|e|ar)|molest(es|en|ar)|mand(es|en)|env[ií](es|en))(me)?\\b',
    'dej(a|en?)\\s+de\\s+(escribir|molestar|mandar|enviar)\\w*',
    'no\\s+quiero\\s+(m[aá]s\\s+)?(mensajes?|informaci[oó]n|nada)',
    'b[oó]rr(a|en)me\\b',
    'b[oó]rr(a|en)\\s+mi\\s+n[uú]mero',
    'elim[ií]n(a|en)(me|nos)\\b',
    'qu[ií]t(a|en)me\\b',
    's[aá]quenme\\b',
    // Single-word commands only as the WHOLE message ("baja" appears inside
    // "trabajar" and "me dieron de baja" — those must never opt anyone out).
    '^\\s*(stop|baja|unsubscribe)[\\s.!]*$',
    'cancelar\\s+suscripci[oó]n',
  ].join('|'),
  'i'
);

export function isOptOutMessage(text: string | null | undefined): boolean {
  const t = (text || '').trim();
  if (!t || t.length > 120) return false; // long messages are conversation, not an opt-out command
  return OPT_OUT_RE.test(t);
}

/**
 * Backoff before retry N (1-based attempts already made): 30s, 2m, 8m, 30m, 1h, 1h…
 * Fast enough that a blip recovers quickly; slow enough that a real outage doesn't
 * burn attempts before anyone can react.
 */
export function retryBackoffMs(attemptsMade: number): number {
  const schedule = [30_000, 120_000, 480_000, 1_800_000, 3_600_000];
  return schedule[Math.min(Math.max(attemptsMade, 1), schedule.length) - 1];
}

/**
 * Errors that will NEVER succeed on retry: WhatsApp explicitly refused the request
 * (blocked, no such user, malformed). Retrying the same text six times at a target
 * that already said no is pure spam-amplification — precisely the wrong move while
 * an account is under suspicion — so these fail on the FIRST attempt. Timeouts and
 * dropped connections stay retryable (the backoff schedule handles those).
 */
const PERMANENT_SEND_ERROR_RE = /forbidden|not-authorized|unauthorized|item-not-found|bad-request|phone_invalido/i;

export function isPermanentSendError(error: string): boolean {
  return PERMANENT_SEND_ERROR_RE.test(error || '');
}

/** After another failure, what the message's new state should be. */
export function afterFailure(attemptsMade: number, now: number, error: string): {
  status: 'queued' | 'failed'; attempts: number; nextAttemptAt: Date | null; lastError: string;
} {
  const attempts = attemptsMade + 1;
  if (attempts >= OUTBOX_MAX_ATTEMPTS || isPermanentSendError(error)) {
    return { status: 'failed', attempts, nextAttemptAt: null, lastError: error };
  }
  return { status: 'queued', attempts, nextAttemptAt: new Date(now + retryBackoffMs(attempts)), lastError: error };
}

/**
 * Whether the drain loop should even try to send right now, given the socket state.
 * - 'connected': send.
 * - 'qr' / logged-out / replaced-suspended: STOP — sending is impossible until a human
 *   acts (scan / Forzar Reconexión); messages stay queued, none are burned as failures.
 * - otherwise ('connecting'/'disconnected'): worth waiting for a reconnect.
 */
export function drainAction(connectionStatus: string, reconnectSuspended: boolean): 'send' | 'wait' | 'stop' {
  if (reconnectSuspended || connectionStatus === 'qr') return 'stop';
  if (connectionStatus === 'connected') return 'send';
  return 'wait';
}
