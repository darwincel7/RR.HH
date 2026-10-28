import { describe, it, expect } from 'vitest';
import {
  toMs, stage2DueAtMs, computeStage2Timing, formatDuration, summarizeStage2,
  NO_CONFIRMATION_AFTER_MS, STAGE2_STATUS_LABEL,
} from './formTiming';

const H = 3_600_000;
const D = 24 * H;
// Lunes 12 oct 2026, 10:00 a. m. en RD (14:00 UTC).
const MON_10AM = Date.parse('2026-10-12T14:00:00Z');

describe('toMs', () => {
  it('entiende Timestamp de Firestore, Date, ISO, número y el Timestamp serializado', () => {
    expect(toMs({ toMillis: () => 123 })).toBe(123);
    expect(toMs(new Date(5000))).toBe(5000);
    expect(toMs('2026-10-12T14:00:00Z')).toBe(MON_10AM);
    expect(toMs(42)).toBe(42);
    expect(toMs({ seconds: 10, nanoseconds: 5_000_000 })).toBe(10_005);
    expect(toMs({ _seconds: 10, _nanoseconds: 0 })).toBe(10_000);
  });
  it('sin dato → 0 (nunca NaN)', () => {
    for (const v of [null, undefined, '', 'basura', NaN, -5, {}, new Date('x')]) expect(toMs(v)).toBe(0);
  });
});

describe('stage2DueAtMs — la fecha que dice el mensaje ("antes del jueves 15")', () => {
  it('es el FINAL del día, hora de RD, 3 días después de ordenar el envío', () => {
    // Lunes 12, 10 a. m. + 3 días = jueves 15; vence el jueves a las 11:59:59 p. m. RD.
    expect(new Date(stage2DueAtMs(MON_10AM)).toISOString()).toBe('2026-10-16T03:59:59.999Z');
  });
  it('de noche en RD (ya es otro día en UTC) sigue contando el día de RD', () => {
    // Lunes 12, 10:30 p. m. RD = martes 13 02:30 UTC → el jueves 15 de RD, no el viernes.
    const monNight = Date.parse('2026-10-13T02:30:00Z');
    expect(new Date(stage2DueAtMs(monNight)).toISOString()).toBe('2026-10-16T03:59:59.999Z');
  });
  it('otros plazos', () => {
    expect(new Date(stage2DueAtMs(MON_10AM, 1)).toISOString()).toBe('2026-10-14T03:59:59.999Z');
  });
});

describe('computeStage2Timing', () => {
  const sent = (extra: any = {}) => ({
    stage2Link: { firstSentAt: new Date(MON_10AM), whatsappSentAt: new Date(MON_10AM), lastWhatsappSentAt: new Date(MON_10AM), dueAt: new Date(stage2DueAtMs(MON_10AM)), ...extra.link },
    ...extra.app,
  });

  it('completado a tiempo: cuánto tardó desde que se le envió', () => {
    const t = computeStage2Timing(sent({ app: { stage2SubmittedAt: new Date(MON_10AM + 5 * H + 30 * 60_000), stage2Answers: { q: 'r' } } }), MON_10AM + 10 * D);
    expect(t.status).toBe('a_tiempo');
    expect(t.elapsedMs).toBe(5.5 * H);
    expect(t.lateByMs).toBe(0);
  });

  it('el mismo día límite (jueves 9 p. m.) todavía es a tiempo', () => {
    const thu9pm = Date.parse('2026-10-16T01:00:00Z');
    expect(computeStage2Timing(sent({ app: { stage2SubmittedAt: new Date(thu9pm) } }), thu9pm).status).toBe('a_tiempo');
  });

  it('completado a destiempo: cuánto después del plazo', () => {
    const due = stage2DueAtMs(MON_10AM);
    const t = computeStage2Timing(sent({ app: { stage2SubmittedAt: new Date(due + 2 * D) } }), due + 5 * D);
    expect(t.status).toBe('tarde');
    expect(t.lateByMs).toBe(2 * D);
    expect(t.elapsedMs).toBe(due + 2 * D - MON_10AM);
  });

  it('pendiente en plazo y vencido: el reloj corre hasta ahora', () => {
    const p = computeStage2Timing(sent(), MON_10AM + 30 * H);
    expect(p.status).toBe('pendiente');
    expect(p.elapsedMs).toBe(30 * H);
    const due = stage2DueAtMs(MON_10AM);
    const v = computeStage2Timing(sent(), due + 1 * D);
    expect(v.status).toBe('vencido');
    expect(v.lateByMs).toBe(1 * D);
  });

  it('completado sin envío registrado (o antes del primer envío): no inventa una duración', () => {
    expect(computeStage2Timing({ stage2SubmittedAt: new Date(MON_10AM) }, MON_10AM).status).toBe('completado_sin_envio');
    const before = computeStage2Timing(sent({ app: { stage2SubmittedAt: new Date(MON_10AM - H) } }), MON_10AM);
    expect(before.status).toBe('completado_sin_envio');
    expect(before.elapsedMs).toBe(0);
  });

  it('respuestas guardadas sin fecha también cuentan como completado', () => {
    expect(computeStage2Timing(sent({ app: { stage2Answers: { q: 'r' } } }), MON_10AM + D).status).toBe('completado_sin_envio');
  });

  it('nada enviado ni completado', () => {
    const t = computeStage2Timing({}, MON_10AM);
    expect(t.status).toBe('sin_envio');
    expect(t.elapsedMs).toBe(0);
  });

  it('sin dueAt guardado, lo deduce del envío', () => {
    const t = computeStage2Timing({ stage2Link: { firstSentAt: new Date(MON_10AM) } }, MON_10AM);
    expect(t.dueAtMs).toBe(stage2DueAtMs(MON_10AM));
  });

  describe('indicios de "Esperando el mensaje"', () => {
    it('su teléfono pidió reenviarlo y no lo ha leído ni abierto', () => {
      expect(computeStage2Timing(sent({ link: { retryRequests: 2 } }), MON_10AM + H).deliveryIssue).toBe('retry_requested');
    });
    it('sin confirmación de entrega pasado el umbral', () => {
      expect(computeStage2Timing(sent(), MON_10AM + NO_CONFIRMATION_AFTER_MS - 1).deliveryIssue).toBeNull();
      expect(computeStage2Timing(sent(), MON_10AM + NO_CONFIRMATION_AFTER_MS).deliveryIssue).toBe('no_confirmation');
    });
    it('el umbral corre desde el ÚLTIMO WhatsApp (un reenvío reinicia la espera)', () => {
      const t = computeStage2Timing(sent({ link: { lastWhatsappSentAt: new Date(MON_10AM + 5 * H) } }), MON_10AM + 6 * H);
      expect(t.deliveryIssue).toBeNull();
    });
    it('entregado, leído, abierto o completado → sin alerta', () => {
      const late = MON_10AM + 5 * H;
      expect(computeStage2Timing(sent({ link: { deliveredAt: new Date(MON_10AM + 60_000) } }), late).deliveryIssue).toBeNull();
      expect(computeStage2Timing(sent({ link: { readAt: new Date(MON_10AM + 60_000), retryRequests: 1 } }), late).deliveryIssue).toBeNull();
      expect(computeStage2Timing(sent({ link: { openedAt: new Date(MON_10AM + 60_000), retryRequests: 1 } }), late).deliveryIssue).toBeNull();
      expect(computeStage2Timing(sent({ app: { stage2SubmittedAt: new Date(late) } }), late).deliveryIssue).toBeNull();
    });
    it('solo por correo → no aplica (no hay WhatsApp que se atasque)', () => {
      const t = computeStage2Timing({ stage2Link: { firstSentAt: new Date(MON_10AM), emailSentAt: new Date(MON_10AM) } }, MON_10AM + 5 * H);
      expect(t.deliveryIssue).toBeNull();
    });
  });
});

describe('formatDuration', () => {
  it('a la medida de una persona', () => {
    expect(formatDuration(20_000)).toBe('menos de 1 min');
    expect(formatDuration(45 * 60_000)).toBe('45 min');
    expect(formatDuration(3 * H)).toBe('3 h');
    expect(formatDuration(3 * H + 20 * 60_000)).toBe('3 h 20 min');
    expect(formatDuration(D)).toBe('1 día');
    expect(formatDuration(2 * D + 4 * H + 59 * 60_000)).toBe('2 días 4 h');
    expect(formatDuration(NaN)).toBe('menos de 1 min');
  });
});

describe('summarizeStage2', () => {
  const at = (hours: number, status: any, extra: any = {}) => ({
    ...computeStage2Timing({}, 0), status, sentAtMs: MON_10AM, elapsedMs: hours * H, ...extra,
  });

  it('cuenta, porcentajes y mediana solo de los completados con envío registrado', () => {
    const s = summarizeStage2([
      at(0.5, 'a_tiempo'), at(5, 'a_tiempo'), at(30, 'a_tiempo'), at(100, 'tarde'),
      at(10, 'pendiente'), at(90, 'vencido', { deliveryIssue: 'no_confirmation' }),
      { ...computeStage2Timing({}, 0), status: 'completado_sin_envio' },
      computeStage2Timing({}, 0), // sin envío: no cuenta
    ] as any);
    expect(s.sent).toBe(6);
    expect(s.completed).toBe(4);
    expect(s.onTime).toBe(3);
    expect(s.late).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.overdue).toBe(1);
    expect(s.completedWithoutSend).toBe(1);
    expect(s.deliveryIssues).toBe(1);
    expect(s.medianMs).toBe(17.5 * H); // (5 + 30) / 2
    expect(s.fastestMs).toBe(0.5 * H);
    expect(s.slowestMs).toBe(100 * H);
    expect(s.completedPct).toBe(67);
    expect(s.onTimePct).toBe(75);
    expect(s.latePct).toBe(25);
    expect(s.buckets.map(b => b.count)).toEqual([1, 1, 0, 1, 1]);
  });

  it('vacío → ceros, nunca NaN', () => {
    const s = summarizeStage2([]);
    expect(s.medianMs).toBe(0);
    expect(s.completedPct).toBe(0);
    expect(s.buckets.every(b => b.pct === 0)).toBe(true);
  });

  it('hay etiqueta para cada estado', () => {
    for (const k of ['a_tiempo', 'tarde', 'pendiente', 'vencido', 'completado_sin_envio', 'sin_envio']) {
      expect((STAGE2_STATUS_LABEL as any)[k]).toBeTruthy();
    }
  });
});
