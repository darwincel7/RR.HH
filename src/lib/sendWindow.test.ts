import { describe, it, expect } from 'vitest';
import {
  parseSendWindow, isWithinSendWindow, nextSendWindowOpenMs, minutesLeftInWindow, formatWindowHour, DEFAULT_SEND_WINDOW,
} from './sendWindow';

// DR time is UTC-4: 8:00 a.m. in Santo Domingo is 12:00 UTC.
const dr = (iso: string) => new Date(`${iso}-04:00`).getTime();

describe('parseSendWindow', () => {
  it('reads "start-end" hours', () => {
    expect(parseSendWindow('9-18')).toEqual({ start: 9, end: 18 });
    expect(parseSendWindow(' 7 - 21 ')).toEqual({ start: 7, end: 21 });
  });

  it('can be turned off explicitly', () => {
    expect(parseSendWindow('off')).toEqual({ start: 0, end: 24 });
    expect(parseSendWindow('0-24')).toEqual({ start: 0, end: 24 });
  });

  it('never silently disables the protection on a typo', () => {
    for (const bad of ['', '20-8', '8-8', '25-30', 'mañana', '8']) {
      expect(parseSendWindow(bad)).toEqual(DEFAULT_SEND_WINDOW);
    }
  });
});

describe('isWithinSendWindow (default 8:00 a.m. – 7:59 p.m., DR time)', () => {
  const w = DEFAULT_SEND_WINDOW;

  it('is open during the working day', () => {
    expect(isWithinSendWindow(dr('2026-10-12T08:00:00'), w)).toBe(true);
    expect(isWithinSendWindow(dr('2026-10-12T13:30:00'), w)).toBe(true);
    expect(isWithinSendWindow(dr('2026-10-12T19:59:00'), w)).toBe(true);
  });

  it('is closed at night and early morning', () => {
    expect(isWithinSendWindow(dr('2026-10-12T20:00:00'), w)).toBe(false);
    expect(isWithinSendWindow(dr('2026-10-12T23:15:00'), w)).toBe(false);
    expect(isWithinSendWindow(dr('2026-10-13T06:59:00'), w)).toBe(false);
  });

  it('uses DR time, not the server clock: 8:30 p.m. in DR is 00:30 UTC of the next day', () => {
    expect(isWithinSendWindow(Date.UTC(2026, 9, 13, 0, 30), w)).toBe(false);
    expect(isWithinSendWindow(Date.UTC(2026, 9, 12, 12, 0), w)).toBe(true); // 8:00 a.m. DR
  });
});

describe('nextSendWindowOpenMs', () => {
  const w = DEFAULT_SEND_WINDOW;

  it('is now when open', () => {
    const now = dr('2026-10-12T10:00:00');
    expect(nextSendWindowOpenMs(now, w)).toBe(now);
  });

  it('late at night → tomorrow at 8:00 a.m.', () => {
    expect(nextSendWindowOpenMs(dr('2026-10-12T22:10:00'), w)).toBe(dr('2026-10-13T08:00:00'));
  });

  it('before dawn → today at 8:00 a.m.', () => {
    expect(nextSendWindowOpenMs(dr('2026-10-13T05:45:00'), w)).toBe(dr('2026-10-13T08:00:00'));
  });
});

describe('minutesLeftInWindow', () => {
  it('counts down to the closing hour', () => {
    expect(minutesLeftInWindow(dr('2026-10-12T18:30:00'), DEFAULT_SEND_WINDOW)).toBe(90);
    expect(minutesLeftInWindow(dr('2026-10-12T21:00:00'), DEFAULT_SEND_WINDOW)).toBe(0);
    expect(minutesLeftInWindow(dr('2026-10-12T21:00:00'), { start: 0, end: 24 })).toBe(Infinity);
  });
});

describe('formatWindowHour', () => {
  it('reads like a clock', () => {
    expect(formatWindowHour(8)).toBe('8:00 a. m.');
    expect(formatWindowHour(20)).toBe('8:00 p. m.');
    expect(formatWindowHour(12)).toBe('12:00 p. m.');
  });
});
