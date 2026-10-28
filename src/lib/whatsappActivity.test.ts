import { describe, it, expect } from 'vitest';
import {
  describeWait, whatLabel, deliveryLabel, isForCandidate, candidateStageState, whenLabel,
  deliveryAttention, UNCONFIRMED_AFTER_MS,
  type ActivityData, type ActivityMessage,
} from './whatsappActivity';

// 13 oct 2026, 2:00 p.m. DR (UTC-4).
const NOW = Date.parse('2026-10-13T18:00:00Z');

const msg = (over: Partial<ActivityMessage> = {}): ActivityMessage => ({
  id: 'x', candidateId: 'c1', candidateName: 'Ana', phone: '809-555-1000', origin: 'automation',
  stage: 'Convocado a entrevista', vacancy: 'Vendedor', preview: 'Hola', status: 'queued',
  createdAt: null, sentAt: null, deliveredAt: null, readAt: null, failedAt: null, attempts: 0,
  ...over,
});

const data = (over: Partial<ActivityData> = {}): ActivityData => ({ enabled: true, pending: [], failed: [], sent: [], ...over });

describe('describeWait', () => {
  it('says when a waiting message goes out, and why it waits', () => {
    expect(describeWait({ waitReason: 'now', etaAt: null }, NOW)).toBe('Sale en un momento');
    expect(describeWait({ waitReason: 'turn', etaAt: '2026-10-13T18:25:00Z' }, NOW)).toMatch(/^Sale ~2:25/);
    expect(describeWait({ waitReason: 'daily', etaAt: '2026-10-14T12:00:00Z' }, NOW)).toMatch(/^Sale mañana ~8:00.*límite de hoy/);
    expect(describeWait({ waitReason: 'window', etaAt: '2026-10-14T12:00:00Z' }, NOW)).toMatch(/fuera de horario/);
    expect(describeWait({ waitReason: 'disconnected', etaAt: null }, NOW)).toBe('Espera a que WhatsApp se reconecte');
  });
});

describe('labels', () => {
  it('names what was sent and how', () => {
    expect(whatLabel(msg())).toBe('Convocado a entrevista · Vendedor');
    expect(whatLabel(msg({ origin: 'manual', stage: null }))).toBe('Mensaje manual (chat)');
  });

  it('reports the strongest receipt', () => {
    expect(deliveryLabel(msg())).toBe('Enviado');
    expect(deliveryLabel(msg({ deliveredAt: '2026-10-13T18:01:00Z' }))).toBe('Entregado');
    expect(deliveryLabel(msg({ deliveredAt: '2026-10-13T18:01:00Z', readAt: '2026-10-13T18:05:00Z' }))).toBe('Leído');
  });

  it('shows today as a bare time and other days with their name', () => {
    expect(whenLabel('2026-10-13T17:14:00Z', NOW)).toMatch(/^1:14/);
    expect(whenLabel('2026-10-12T17:14:00Z', NOW)).toMatch(/^ayer 1:14/);
    expect(whenLabel(null, NOW)).toBe('');
  });
});

describe('isForCandidate', () => {
  it('matches by id, or by phone in any format', () => {
    expect(isForCandidate(msg(), 'c1', null)).toBe(true);
    expect(isForCandidate(msg({ candidateId: null }), 'c1', '(809) 555 1000')).toBe(true);
    expect(isForCandidate(msg({ candidateId: null }), 'c1', '809-555-9999')).toBe(false);
    expect(isForCandidate(msg({ candidateId: null, phone: null }), 'c1', null)).toBe(false);
  });
});

describe('candidateStageState', () => {
  it('shows a failure of THIS stage, with priority over a waiting message', () => {
    const failed = msg({ id: 'f', status: 'failed', retryable: true });
    const pending = msg({ id: 'p' });
    const r = candidateStageState(data({ failed: [failed], pending: [pending] }), { candidateId: 'c1' }, 'Convocado a entrevista', 'Vendedor');
    expect(r).toEqual({ kind: 'failed', message: failed });
  });

  it('ignores a failure from another stage or another vacancy (it would be old news)', () => {
    const otherStage = msg({ id: 'f1', status: 'failed', stage: 'Formulario etapa 2 enviado' });
    const otherVacancy = msg({ id: 'f2', status: 'failed', vacancy: 'Cajero' });
    expect(candidateStageState(data({ failed: [otherStage, otherVacancy] }), { candidateId: 'c1' }, 'Convocado a entrevista', 'Vendedor')).toBeNull();
  });

  it('a manual chat message counts whatever the stage', () => {
    const manual = msg({ id: 'm', origin: 'manual', stage: null });
    expect(candidateStageState(data({ pending: [manual] }), { candidateId: 'c1' }, 'Oferta', 'Vendedor')?.kind).toBe('pending');
  });

  it('nothing to show without data', () => {
    expect(candidateStageState(null, { candidateId: 'c1' }, 'Oferta')).toBeNull();
    expect(candidateStageState(data({ enabled: false }), { candidateId: 'c1' }, 'Oferta')).toBeNull();
  });
});

describe('deliveryAttention — "Esperando el mensaje"', () => {
  const sent = (over: Partial<ActivityMessage> = {}) => msg({ status: 'sent', sentAt: new Date(NOW - 10 * 60_000).toISOString(), ...over });

  it('su teléfono pidió reenviarlo y aún no lo ha leído', () => {
    expect(deliveryAttention(sent({ retryRequests: 1 }), NOW)).toBe('retry');
    expect(deliveryAttention(sent({ retryRequests: 1, deliveredAt: '2026-10-13T17:55:00Z' }), NOW)).toBe('retry');
  });

  it('sin acuse de entrega pasado el umbral', () => {
    expect(deliveryAttention(sent(), NOW)).toBeNull();
    const old = new Date(NOW - UNCONFIRMED_AFTER_MS).toISOString();
    expect(deliveryAttention(sent({ sentAt: old }), NOW)).toBe('unconfirmed');
    expect(deliveryAttention(sent({ sentAt: old, deliveredAt: old }), NOW)).toBeNull();
  });

  it('leído o no enviado → nada que mirar', () => {
    expect(deliveryAttention(sent({ retryRequests: 2, readAt: '2026-10-13T17:58:00Z' }), NOW)).toBeNull();
    expect(deliveryAttention(msg({ status: 'queued', retryRequests: 1 }), NOW)).toBeNull();
  });
});
