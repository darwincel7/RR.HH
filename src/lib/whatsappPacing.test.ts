import { describe, it, expect } from 'vitest';
import { estimateBulkDelivery, describeBulkEta } from './whatsappPacing';

// DR time is UTC-4.
const dr = (iso: string) => new Date(`${iso}-04:00`).getTime();

const pacing = {
  sentToday: 0,
  dailyLimit: 200,
  hourlyLimit: 25,
  autoPerHour: 25,
  sendWindow: { start: 8, end: 20 },
};

describe('estimateBulkDelivery', () => {
  it('a normal bulk move during the day: all today, about a minute and a half each', () => {
    const eta = estimateBulkDelivery(20, 0, pacing, dr('2026-10-12T10:00:00'));
    expect(eta).toEqual({ minutes: 48, today: 20, later: 0, startsAt: null });
  });

  it('counts what is already waiting in the queue ahead of these', () => {
    const eta = estimateBulkDelivery(10, 15, pacing, dr('2026-10-12T10:00:00'));
    expect(eta.minutes).toBe(60);
  });

  it('at night, nothing goes out until the window opens', () => {
    const now = dr('2026-10-12T22:00:00');
    const eta = estimateBulkDelivery(5, 0, pacing, now);
    expect(eta.startsAt).toBe(dr('2026-10-13T08:00:00'));
    expect(eta.later).toBe(0);
    expect(eta.minutes).toBe(10 * 60 + 12); // 10h until 8am + 12 min of sending
  });

  it('spills into the next days when the daily budget runs out', () => {
    const eta = estimateBulkDelivery(30, 0, { ...pacing, sentToday: 185 }, dr('2026-10-12T10:00:00'));
    expect(eta.today).toBe(15);
    expect(eta.later).toBe(15);
    expect(eta.minutes).toBeNull();
  });

  it('spills when the window closes before they all fit', () => {
    const eta = estimateBulkDelivery(40, 0, pacing, dr('2026-10-12T19:00:00')); // 1h left → ~25
    expect(eta.today).toBe(25);
    expect(eta.later).toBe(15);
  });

  it('trusts the server when it says the window is closed (device clock may be off)', () => {
    const now = dr('2026-10-12T19:58:00'); // this device thinks it's still open
    const opensAt = dr('2026-10-13T08:00:00');
    const eta = estimateBulkDelivery(5, 0, { ...pacing, sendWindow: { start: 8, end: 20, open: false, opensAt: new Date(opensAt).toISOString() } }, now);
    expect(eta.startsAt).toBe(opensAt);
  });

  it('waits out a fresh number’s quarantine', () => {
    const now = dr('2026-10-12T10:00:00');
    const eta = estimateBulkDelivery(3, 0, { ...pacing, quarantineUntil: new Date(dr('2026-10-12T14:00:00')).toISOString() }, now);
    expect(eta.startsAt).toBe(dr('2026-10-12T14:00:00'));
  });

  it('copes with no pacing info at all (dev mode)', () => {
    const eta = estimateBulkDelivery(5, 0, null, dr('2026-10-12T10:00:00'));
    expect(eta.later).toBe(0);
    expect(eta.minutes).toBe(12);
  });
});

describe('describeBulkEta', () => {
  it('reads as a plan the recruiter can trust', () => {
    const now = dr('2026-10-12T10:00:00');
    expect(describeBulkEta(estimateBulkDelivery(20, 0, pacing, now), pacing, now))
      .toBe('Empezarán a salir de inmediato y terminarán en unos 48 minutos.');
    expect(describeBulkEta(estimateBulkDelivery(50, 0, pacing, now), pacing, now))
      .toBe('Empezarán a salir de inmediato y terminarán en unas 2 horas.');
  });

  it('explains a night-time move and a split across days', () => {
    const night = dr('2026-10-12T22:00:00');
    expect(describeBulkEta(estimateBulkDelivery(5, 0, pacing, night), pacing, night)).toMatch(/^Empezarán a salir mañana a las 8:00/);
    const busy = dr('2026-10-12T10:00:00');
    const split = describeBulkEta(estimateBulkDelivery(30, 0, { ...pacing, sentToday: 185 }, busy), pacing, busy);
    expect(split).toMatch(/hoy saldrán ~15 y los otros 15 en los próximos días/);
  });
});
