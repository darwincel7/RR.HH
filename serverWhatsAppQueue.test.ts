import { describe, it, expect } from 'vitest';
import {
  nextSpacingMs, retryBackoffMs, afterFailure, drainAction,
  OUTBOX_MAX_ATTEMPTS, SEND_SPACING_MIN_MS, SEND_SPACING_MAX_MS,
} from './serverWhatsAppQueue';

describe('nextSpacingMs', () => {
  it('always lands inside the anti-spam window', () => {
    expect(nextSpacingMs(() => 0)).toBe(SEND_SPACING_MIN_MS);
    expect(nextSpacingMs(() => 1)).toBe(SEND_SPACING_MAX_MS);
    for (let i = 0; i < 50; i++) {
      const v = nextSpacingMs();
      expect(v).toBeGreaterThanOrEqual(SEND_SPACING_MIN_MS);
      expect(v).toBeLessThanOrEqual(SEND_SPACING_MAX_MS);
    }
  });

  it('is far slower than the old 600ms burst that got the account flagged', () => {
    expect(SEND_SPACING_MIN_MS).toBeGreaterThanOrEqual(2000);
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

describe('afterFailure', () => {
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
