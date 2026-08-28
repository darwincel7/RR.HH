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

/** Drain budget per HTTP-driven pass — stay well inside Cloud Run's request timeout. */
export const OUTBOX_DRAIN_DEADLINE_MS = 240_000;

/**
 * Pause between consecutive sends: 2.5–5s randomized. The old client-side 600ms burst
 * of identical texts is exactly the fingerprint WhatsApp's anti-spam looks for; slower,
 * jittered pacing keeps the account healthy. The queue makes the slowness invisible —
 * the recruiter does not wait on it.
 */
export const SEND_SPACING_MIN_MS = 2_500;
export const SEND_SPACING_MAX_MS = 5_000;

export function nextSpacingMs(random: () => number = Math.random): number {
  return Math.round(SEND_SPACING_MIN_MS + (SEND_SPACING_MAX_MS - SEND_SPACING_MIN_MS) * random());
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

/** After another failure, what the message's new state should be. */
export function afterFailure(attemptsMade: number, now: number, error: string): {
  status: 'queued' | 'failed'; attempts: number; nextAttemptAt: Date | null; lastError: string;
} {
  const attempts = attemptsMade + 1;
  if (attempts >= OUTBOX_MAX_ATTEMPTS) {
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
