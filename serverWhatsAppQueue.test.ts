import { describe, it, expect } from 'vitest';
import {
  nextSpacingMs, retryBackoffMs, afterFailure, drainAction, typingDelayMs,
  dailySendLimit, isOptOutMessage, isPermanentSendError,
  OUTBOX_MAX_ATTEMPTS, SEND_SPACING_MIN_MS, SEND_SPACING_MAX_MS,
  LONG_PAUSE_EVERY, LONG_PAUSE_MIN_MS, LONG_PAUSE_MAX_MS,
  HOURLY_SEND_CAP, WA_MATURE_DAILY_CAP,
  nextAutomationGap, randomBurstTarget, sanitizeAutoNextAt, automationMessagesPerHour,
  AUTO_SPACING_MIN_MS, AUTO_SPACING_MAX_MS, AUTO_BURST_MIN, AUTO_BURST_MAX,
  AUTO_LONG_PAUSE_MIN_MS, AUTO_LONG_PAUSE_MAX_MS, AUTO_MAX_SCHEDULED_GAP_MS,
  outboxFate, outboxQueuedAtMs, PREVIOUS_QUEUE_CUTOFF_MS, OUTBOX_MAX_AGE_HOURS, isDuplicateInOutbox,
} from './serverWhatsAppQueue';

describe('nextSpacingMs', () => {
  it('always lands inside the anti-spam window', () => {
    expect(nextSpacingMs(1, () => 0)).toBe(SEND_SPACING_MIN_MS);
    expect(nextSpacingMs(1, () => 1)).toBe(SEND_SPACING_MAX_MS);
    for (let i = 0; i < 50; i++) {
      const v = nextSpacingMs(1);
      expect(v).toBeGreaterThanOrEqual(SEND_SPACING_MIN_MS);
      expect(v).toBeLessThanOrEqual(SEND_SPACING_MAX_MS);
    }
  });

  it('is far slower than the 2.5-5s pacing the account was banned on', () => {
    expect(SEND_SPACING_MIN_MS).toBeGreaterThanOrEqual(6000);
  });

  it('takes a long breather every few messages, like a person would', () => {
    const v = nextSpacingMs(LONG_PAUSE_EVERY, () => 0);
    expect(v).toBeGreaterThanOrEqual(LONG_PAUSE_MIN_MS);
    expect(nextSpacingMs(LONG_PAUSE_EVERY, () => 1)).toBe(LONG_PAUSE_MAX_MS);
    expect(nextSpacingMs(LONG_PAUSE_EVERY * 2, () => 0)).toBe(LONG_PAUSE_MIN_MS);
    // ...but not on ordinary messages, and never on the very first one.
    expect(nextSpacingMs(0, () => 1)).toBe(SEND_SPACING_MAX_MS);
    expect(nextSpacingMs(LONG_PAUSE_EVERY + 1, () => 1)).toBe(SEND_SPACING_MAX_MS);
  });
});

describe('outboxFate (messages from the past never go out)', () => {
  const H = 3_600_000;
  const maxAge = OUTBOX_MAX_AGE_HOURS * H;
  const cutoff = PREVIOUS_QUEUE_CUTOFF_MS;

  it('the queue that existed before the cutoff is discarded, whatever its age', () => {
    expect(outboxFate(cutoff - 1, cutoff + 60_000, cutoff, maxAge)).toBe('previous');
    expect(outboxFate(cutoff - 30 * 24 * H, cutoff + H, cutoff, maxAge)).toBe('previous');
  });

  it('new messages go out normally, including after the night or the daily limit', () => {
    expect(outboxFate(cutoff + 1, cutoff + 2, cutoff, maxAge)).toBe('send');
    expect(outboxFate(cutoff + H, cutoff + H + 36 * H, cutoff, maxAge)).toBe('send');
  });

  it('a message that waited longer than the max age expires instead of going out late', () => {
    expect(outboxFate(cutoff + H, cutoff + H + maxAge + 1, cutoff, maxAge)).toBe('expired');
  });

  it('a manual re-queue (Reintentar) restarts the clock — even for a message from before the cutoff', () => {
    const created = cutoff - 5 * 24 * H;
    const requeued = cutoff + 10 * H;
    expect(outboxFate(outboxQueuedAtMs(created, requeued), requeued + H, cutoff, maxAge)).toBe('send');
  });

  it('never drops a message whose queue time is unknown', () => {
    expect(outboxFate(outboxQueuedAtMs(0, 0), cutoff + 100 * H, cutoff, maxAge)).toBe('send');
  });

  it('the cutoff is the moment the old queue was declared "del pasado" (12 oct 2026, 5:45 p. m. RD)', () => {
    expect(new Date(PREVIOUS_QUEUE_CUTOFF_MS).toISOString()).toBe('2026-10-12T21:45:00.000Z');
    expect(OUTBOX_MAX_AGE_HOURS).toBeGreaterThanOrEqual(36); // a night + a full sending day must fit
  });
});

describe('isDuplicateInOutbox', () => {
  const H = 3_600_000;
  const maxAge = OUTBOX_MAX_AGE_HOURS * H;
  const cutoff = PREVIOUS_QUEUE_CUTOFF_MS;
  const now = cutoff + 10 * H;
  const entry = (over: object) => ({ status: 'queued', message: 'Hola', dedupeKey: 'k', createdAtMs: now - H, queuedAtMs: now - H, ...over });
  const auto = { message: 'Hola', origin: 'automation' as const, dedupeKey: 'k' };

  it('an automation already waiting for this phone is not queued twice (same text or same notification)', () => {
    expect(isDuplicateInOutbox([entry({})], auto, now, cutoff, maxAge)).toBe(true);
    expect(isDuplicateInOutbox([entry({ message: 'Otra redacción' })], auto, now, cutoff, maxAge)).toBe(true);
    expect(isDuplicateInOutbox([entry({ status: 'sending' })], auto, now, cutoff, maxAge)).toBe(true);
  });

  it('a message from the old queue never blocks the new one (it will be discarded, not sent)', () => {
    const old = entry({ createdAtMs: cutoff - 3 * 24 * H, queuedAtMs: cutoff - 3 * 24 * H });
    expect(isDuplicateInOutbox([old], auto, now, cutoff, maxAge)).toBe(false);
  });

  it('an expired one does not block it either', () => {
    const stale = entry({ createdAtMs: now - maxAge - H, queuedAtMs: now - maxAge - H });
    expect(isDuplicateInOutbox([stale], auto, now, cutoff, maxAge)).toBe(false);
  });

  it('sent, failed or dismissed messages never count', () => {
    for (const status of ['sent', 'failed', 'dismissed']) {
      expect(isDuplicateInOutbox([entry({ status })], auto, now, cutoff, maxAge), status).toBe(false);
    }
  });

  it('manual chat only dedupes the identical text within 2 minutes (a double click)', () => {
    const manual = { message: 'ok', origin: 'manual' as const };
    expect(isDuplicateInOutbox([entry({ message: 'ok', createdAtMs: now - 30_000, queuedAtMs: now - 30_000 })], manual, now, cutoff, maxAge)).toBe(true);
    expect(isDuplicateInOutbox([entry({ message: 'ok', createdAtMs: now - 5 * 60_000, queuedAtMs: now - 5 * 60_000 })], manual, now, cutoff, maxAge)).toBe(false);
  });
});

describe('nextAutomationGap (bulk template pacing)', () => {
  it('spaces automated messages about a minute apart, irregularly', () => {
    const lo = nextAutomationGap({ burstCount: 0, burstTarget: AUTO_BURST_MAX }, () => 0);
    const hi = nextAutomationGap({ burstCount: 0, burstTarget: AUTO_BURST_MAX }, () => 0.9999);
    expect(lo.gapMs).toBe(AUTO_SPACING_MIN_MS);
    expect(hi.gapMs).toBeLessThanOrEqual(AUTO_SPACING_MAX_MS);
    expect(hi.gapMs).toBeGreaterThan(lo.gapMs);
  });

  it('is much slower than the 1:1 chat spacing (bursts were the ban pattern)', () => {
    expect(AUTO_SPACING_MIN_MS).toBeGreaterThanOrEqual(SEND_SPACING_MAX_MS);
  });

  it('rests longer after each burst, and the burst size itself varies', () => {
    let state = { burstCount: 0, burstTarget: 4 };
    const gaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = nextAutomationGap(state, () => 0);
      gaps.push(r.gapMs);
      state = r.state;
    }
    expect(gaps.slice(0, 3).every(g => g < AUTO_LONG_PAUSE_MIN_MS)).toBe(true);
    expect(gaps[3]).toBeGreaterThanOrEqual(AUTO_LONG_PAUSE_MIN_MS);
    expect(gaps[3]).toBeLessThanOrEqual(AUTO_LONG_PAUSE_MAX_MS);
    expect(state.burstCount).toBe(0); // a fresh burst after the rest
    const sizes = new Set(Array.from({ length: 200 }, () => randomBurstTarget()));
    expect(Math.min(...sizes)).toBe(AUTO_BURST_MIN);
    expect(Math.max(...sizes)).toBe(AUTO_BURST_MAX);
  });

  it('recovers from a missing/corrupt persisted burst state', () => {
    const r = nextAutomationGap({ burstCount: NaN as any, burstTarget: 999 }, () => 0);
    expect(r.gapMs).toBeGreaterThanOrEqual(AUTO_SPACING_MIN_MS);
    expect(r.state.burstTarget).toBeGreaterThanOrEqual(AUTO_BURST_MIN);
    expect(r.state.burstTarget).toBeLessThanOrEqual(AUTO_BURST_MAX);
  });
});

describe('sanitizeAutoNextAt', () => {
  const now = 1_700_000_000_000;
  it('honors a sane persisted schedule, ignores a corrupt one', () => {
    expect(sanitizeAutoNextAt(now + 60_000, now)).toBe(now + 60_000);
    expect(sanitizeAutoNextAt(now - 60_000, now)).toBe(now - 60_000); // already due
    expect(sanitizeAutoNextAt(now + AUTO_MAX_SCHEDULED_GAP_MS + 1, now)).toBe(now); // skew: don't block for hours
    expect(sanitizeAutoNextAt(undefined, now)).toBe(0);
    expect(sanitizeAutoNextAt('x', now)).toBe(0);
  });
});

describe('automationMessagesPerHour', () => {
  it('is what the bulk-move estimate promises: modest, and never above the hourly cap', () => {
    const perHour = automationMessagesPerHour(HOURLY_SEND_CAP);
    expect(perHour).toBeGreaterThan(10);
    expect(perHour).toBeLessThanOrEqual(HOURLY_SEND_CAP);
    expect(automationMessagesPerHour(5)).toBe(5);
  });
});

describe('typingDelayMs', () => {
  it('scales with message length and stays bounded', () => {
    const short = typingDelayMs(20, () => 0.5);
    const long = typingDelayMs(500, () => 0.5);
    expect(long).toBeGreaterThan(short);
    // Even a huge template can't stall the queue for more than ~10s of "typing".
    expect(typingDelayMs(100_000, () => 1)).toBeLessThanOrEqual(10_000);
    expect(typingDelayMs(0, () => 0)).toBeGreaterThan(0);
  });

  it('jitters so no two messages type for exactly the same time', () => {
    expect(typingDelayMs(100, () => 0)).toBeLessThan(typingDelayMs(100, () => 1));
  });
});

describe('dailySendLimit (warm-up ramp)', () => {
  it('starts small on a freshly linked number and grows with age', () => {
    const day0 = dailySendLimit(0);
    const day3 = dailySendLimit(3);
    const day10 = dailySendLimit(10);
    const mature = dailySendLimit(30);
    expect(day0).toBeLessThanOrEqual(25);
    expect(day3).toBeGreaterThan(day0);
    expect(day10).toBeGreaterThan(day3);
    expect(mature).toBe(WA_MATURE_DAILY_CAP);
  });

  it('never exceeds the configured mature cap, even mid-ramp', () => {
    expect(dailySendLimit(5, 40)).toBe(40);
    expect(dailySendLimit(60, 40)).toBe(40);
  });

  it('treats an unknown link date as day zero (safest)', () => {
    expect(dailySendLimit(0)).toBe(dailySendLimit(0.5));
  });

  it('hourly cap exists and is modest', () => {
    expect(HOURLY_SEND_CAP).toBeGreaterThan(0);
    expect(HOURLY_SEND_CAP).toBeLessThanOrEqual(60);
  });
});

describe('isOptOutMessage', () => {
  it('detects the ways candidates actually ask to stop', () => {
    for (const t of [
      'no me escriban más',
      'NO ME ESCRIBAS',
      'por favor no me contacten',
      'deja de escribirme',
      'dejen de molestar',
      'no quiero más mensajes',
      'no quiero mensajes',
      'borrame',
      'bórrenme de su lista',
      'elimíname',
      'quitame de ahi',
      'stop',
      'BAJA',
      'no me manden más nada',
      'no me envien mas informacion',
    ]) {
      expect(isOptOutMessage(t), t).toBe(true);
    }
  });

  it('ignores ordinary conversation, even when it contains "no"', () => {
    for (const t of [
      'sí, autorizo',
      'no puedo ese día, ¿tienen otro horario?',
      'hola, ¿de qué empresa me escriben?',
      'no sé si pueda llegar a las 3',
      'gracias por la información',
      'no me molesta el horario',        // "I don't mind" — not an opt-out
      'no me mandaron el link',          // complaining it never arrived — not an opt-out
      'puedo trabajar desde el lunes',   // "baja" hides inside "trabajar"
      'me dieron de baja en la otra empresa',
      'ok',
      '',
      null,
      undefined,
    ]) {
      expect(isOptOutMessage(t as any), String(t)).toBe(false);
    }
  });

  it('never opts anyone out on a long message (that is a conversation)', () => {
    expect(isOptOutMessage('no me escriban ' + 'x'.repeat(200))).toBe(false);
  });
});

describe('retryBackoffMs', () => {
  it('grows and then plateaus', () => {
    const seq = [1, 2, 3, 4, 5, 6, 7].map(retryBackoffMs);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
    expect(retryBackoffMs(1)).toBe(30_000);      // a blip retries quickly
    expect(retryBackoffMs(99)).toBe(3_600_000);  // a real outage doesn't spin
  });
});

describe('isPermanentSendError / afterFailure', () => {
  const now = 1_700_000_000_000;

  it('requeues with a future retry while attempts remain', () => {
    const r = afterFailure(0, now, 'Connection Closed');
    expect(r.status).toBe('queued');
    expect(r.attempts).toBe(1);
    expect(r.nextAttemptAt!.getTime()).toBe(now + 30_000);
    expect(r.lastError).toBe('Connection Closed');
  });

  it('gives up (status failed) only after the last allowed attempt', () => {
    const beforeLast = afterFailure(OUTBOX_MAX_ATTEMPTS - 2, now, 'x');
    expect(beforeLast.status).toBe('queued');
    const last = afterFailure(OUTBOX_MAX_ATTEMPTS - 1, now, 'x');
    expect(last.status).toBe('failed');
    expect(last.nextAttemptAt).toBeNull();
  });

  it('fails immediately on errors WhatsApp will never accept on retry', () => {
    for (const e of ['forbidden', 'not-authorized', 'item-not-found', 'bad-request', 'unauthorized']) {
      expect(isPermanentSendError(e), e).toBe(true);
      const r = afterFailure(0, now, e);
      expect(r.status, e).toBe('failed');
      expect(r.nextAttemptAt).toBeNull();
    }
  });

  it('keeps retrying transient network errors', () => {
    for (const e of ['Timed Out', 'Connection Closed', 'WebSocket Error']) {
      expect(isPermanentSendError(e), e).toBe(false);
      expect(afterFailure(0, now, e).status, e).toBe('queued');
    }
  });
});

describe('drainAction', () => {
  it('sends only while actually connected', () => {
    expect(drainAction('connected', false)).toBe('send');
  });

  it('waits for a reconnect on transient states', () => {
    expect(drainAction('disconnected', false)).toBe('wait');
    expect(drainAction('connecting', false)).toBe('wait');
  });

  it('stops (without burning attempts) when only a human can fix it', () => {
    // Logged out and waiting for a QR scan, or auto-reconnect suspended after a 440
    // conflict: retrying would fail every message for nothing. They stay queued.
    expect(drainAction('qr', false)).toBe('stop');
    expect(drainAction('connected', true)).toBe('stop');
    expect(drainAction('disconnected', true)).toBe('stop');
  });
});
