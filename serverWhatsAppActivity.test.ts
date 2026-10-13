import { describe, it, expect } from 'vitest';
import {
  estimateQueueEtas, describeFailure, vacancyFromTopicKey, averageAutomationMessageMs,
  type EtaContext, type QueueItem,
} from './serverWhatsAppActivity';

// 13 oct 2026, 2:00 p.m. in the Dominican Republic (UTC-4) = 18:00 UTC.
const NOW = Date.parse('2026-10-13T18:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

const ctx = (over: Partial<EtaContext> = {}): EtaContext => ({
  nowMs: NOW,
  connected: true,
  window: { start: 8, end: 20 },
  quarantineUntilMs: 0,
  autoNextAtMs: 0,
  sentToday: 0,
  sentThisHour: 0,
  hourlyCap: 25,
  linkedAtMs: NOW - 30 * 24 * HOUR, // mature number: 200/day
  matureDailyCap: 200,
  perMessageMs: MIN,
  ...over,
});

const auto = (id: string, over: Partial<QueueItem> = {}): QueueItem => ({ id, origin: 'automation', status: 'queued', nextAttemptAtMs: 0, ...over });
const manual = (id: string): QueueItem => ({ id, origin: 'manual', status: 'queued', nextAttemptAtMs: 0 });

describe('estimateQueueEtas', () => {
  it('the first automated message goes now; the rest follow one by one', () => {
    const r = estimateQueueEtas([auto('a'), auto('b'), auto('c')], ctx());
    expect(r.a).toEqual({ etaMs: NOW, reason: 'now' });
    expect(r.b).toEqual({ etaMs: NOW + MIN, reason: 'turn' });
    expect(r.c).toEqual({ etaMs: NOW + 2 * MIN, reason: 'turn' });
  });

  it('honors the pacing gap still running from the previous automated send', () => {
    const r = estimateQueueEtas([auto('a')], ctx({ autoNextAtMs: NOW + 3 * MIN }));
    expect(r.a.etaMs).toBe(NOW + 3 * MIN);
    expect(r.a.reason).toBe('turn');
  });

  it('manual chat goes right away and first, even when the day is used up', () => {
    const r = estimateQueueEtas([auto('a'), manual('m')], ctx({ sentToday: 200 }));
    expect(r.m.reason).toBe('now');
    expect(r.m.etaMs).toBe(NOW);
    expect(r.a.reason).toBe('daily');
  });

  it('when today’s limit is used up, the message waits for tomorrow morning', () => {
    const r = estimateQueueEtas([auto('a')], ctx({ sentToday: 200 }));
    expect(r.a.reason).toBe('daily');
    expect(r.a.etaMs).toBe(Date.parse('2026-10-14T12:00:00Z')); // 8:00 a.m. DR
  });

  it('at night, automated messages wait for the window to open', () => {
    const night = Date.parse('2026-10-14T02:30:00Z'); // 10:30 p.m. DR on the 13th
    const r = estimateQueueEtas([auto('a')], ctx({ nowMs: night }));
    expect(r.a.reason).toBe('window');
    expect(r.a.etaMs).toBe(Date.parse('2026-10-14T12:00:00Z'));
  });

  it('the hourly cap pushes the overflow to the next hour', () => {
    const r = estimateQueueEtas([auto('a'), auto('b')], ctx({ sentThisHour: 24, hourlyCap: 25 }));
    expect(r.a.reason).toBe('now');
    expect(r.b.reason).toBe('hourly');
    expect(r.b.etaMs).toBe(Date.parse('2026-10-13T19:00:00Z'));
  });

  it('spills a big batch into the next day once the young number’s daily budget runs out', () => {
    const linkedAtMs = NOW - 2 * HOUR; // day 0 → 20/day
    const items = Array.from({ length: 12 }, (_, i) => auto(`m${i}`));
    const r = estimateQueueEtas(items, ctx({ linkedAtMs, sentToday: 10 }));
    expect(r.m9.etaMs! < Date.parse('2026-10-14T00:00:00Z')).toBe(true);
    expect(r.m10.reason).toBe('daily');
    expect(r.m10.etaMs).toBe(Date.parse('2026-10-14T12:00:00Z'));
  });

  it('respects the post-pairing quarantine', () => {
    const until = NOW + 2 * HOUR;
    const r = estimateQueueEtas([auto('a'), manual('m')], ctx({ quarantineUntilMs: until }));
    expect(r.a).toEqual({ etaMs: until, reason: 'quarantine' });
    expect(r.m.reason).toBe('now');
  });

  it('shows a pending retry at its retry time', () => {
    const r = estimateQueueEtas([auto('a', { nextAttemptAtMs: NOW + 8 * MIN })], ctx());
    expect(r.a).toEqual({ etaMs: NOW + 8 * MIN, reason: 'retry' });
  });

  it('says so when WhatsApp is disconnected (no made-up times)', () => {
    const r = estimateQueueEtas([auto('a'), manual('m')], ctx({ connected: false }));
    expect(r.a).toEqual({ etaMs: null, reason: 'disconnected' });
    expect(r.m).toEqual({ etaMs: null, reason: 'disconnected' });
  });

  it('marks the one being sent right now', () => {
    const r = estimateQueueEtas([auto('a', { status: 'sending' }), auto('b')], ctx());
    expect(r.a.reason).toBe('sending');
    expect(r.b.reason).toBe('turn');
  });

  it('uses the real drain pacing by default', () => {
    const avg = averageAutomationMessageMs();
    expect(avg).toBeGreaterThan(20_000);
    expect(avg).toBeLessThan(10 * MIN);
  });
});

describe('describeFailure', () => {
  it('explains each failure in plain words and says whether retrying helps', () => {
    expect(describeFailure('El candidato pidió no recibir mensajes (opt-out)').retryable).toBe(false);
    expect(describeFailure('El número no tiene WhatsApp')).toMatchObject({ retryable: false, reason: 'Ese número no tiene WhatsApp' });
    expect(describeFailure('Teléfono inválido').retryable).toBe(false);
    expect(describeFailure('Vencido: estuvo más de 48 h en cola…')).toMatchObject({ retryable: true });
    expect(describeFailure('Timed Out')).toMatchObject({ retryable: true, reason: 'Se cortó la conexión de WhatsApp al enviarlo' });
    expect(describeFailure(null)).toMatchObject({ retryable: true, reason: 'No se pudo enviar' });
  });
});

describe('vacancyFromTopicKey', () => {
  it('reads the vacancy from the automation topic key', () => {
    expect(vacancyFromTopicKey(JSON.stringify(['Convocado a entrevista', 'Vendedor']))).toBe('Vendedor');
    expect(vacancyFromTopicKey(JSON.stringify(['Descartado', 'la vacante']))).toBeNull();
    expect(vacancyFromTopicKey('no-json')).toBeNull();
    expect(vacancyFromTopicKey(undefined)).toBeNull();
  });
});
