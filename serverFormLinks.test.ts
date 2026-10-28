import { describe, it, expect } from 'vitest';
import {
  extractEvalApplicationIds, stage2LinkSendUpdate, stage2LinkReceiptUpdate, stage2LinkOpenUpdate,
  aggregateStage2Sends, approximateStage2Link, OPEN_THROTTLE_MS,
} from './serverFormLinks';
import { stage2DueAtMs } from './src/lib/formTiming';

const H = 3_600_000;
const T0 = Date.parse('2026-10-12T14:00:00Z');
const msg = (id: string) => `Hola Ana 👋, completa el formulario: https://rrhh.example.com/eval/${id} antes del jueves 15 de octubre.`;

describe('extractEvalApplicationIds — reconoce el link del formulario en lo que sale', () => {
  it('saca el id de la postulación del link', () => {
    expect(extractEvalApplicationIds(msg('uidAbc123_vac9XYZ'))).toEqual(['uidAbc123_vac9XYZ']);
  });
  it('también dentro de HTML (correo) y sin repetir', () => {
    const html = `<a href="https://x.com/eval/app_1">https://x.com/eval/app_1</a>`;
    expect(extractEvalApplicationIds(html)).toEqual(['app_1']);
  });
  it('no confunde el link del test ni textos sin link', () => {
    expect(extractEvalApplicationIds('https://x.com/test/app_1')).toEqual([]);
    expect(extractEvalApplicationIds('Hola, te esperamos mañana')).toEqual([]);
    expect(extractEvalApplicationIds(undefined)).toEqual([]);
    expect(extractEvalApplicationIds('https://x.com/eval/ejemplo')).toEqual(['ejemplo']);
  });
});

describe('stage2LinkSendUpdate', () => {
  it('el PRIMER envío inicia el reloj y fija la fecha límite desde que se ordenó', () => {
    const queued = T0 - 9 * H; // movido de noche, salió por la mañana
    const u = stage2LinkSendUpdate(undefined, { atMs: T0, queuedAtMs: queued, channel: 'whatsapp', waMessageId: '3EB0', outboxId: 'o1' });
    expect(u.firstSentAt).toEqual(new Date(T0));
    expect(u.dueAt).toEqual(new Date(stage2DueAtMs(queued)));
    expect(u.whatsappSentAt).toEqual(new Date(T0));
    expect(u.whatsappSends).toBe(1);
    expect(u.outboxId).toBe('o1');
    expect(u.waMessageId).toBe('3EB0');
  });

  it('un reenvío no mueve el inicio ni la fecha límite; suma y apunta al último mensaje', () => {
    const current = { firstSentAt: new Date(T0), dueAt: new Date(stage2DueAtMs(T0)), whatsappSentAt: new Date(T0), whatsappSends: 1, outboxId: 'o1' };
    const u = stage2LinkSendUpdate(current, { atMs: T0 + 48 * H, queuedAtMs: T0 + 48 * H, channel: 'whatsapp', outboxId: 'o2' });
    expect(u.firstSentAt).toBeUndefined();
    expect(u.dueAt).toBeUndefined();
    expect(u.whatsappSentAt).toBeUndefined();
    expect(u.lastSentAt).toEqual(new Date(T0 + 48 * H));
    expect(u.lastWhatsappSentAt).toEqual(new Date(T0 + 48 * H));
    expect(u.whatsappSends).toBe(2);
    expect(u.outboxId).toBe('o2');
  });

  it('correo y WhatsApp del mismo movimiento: cada canal con su fecha', () => {
    const viaEmail = stage2LinkSendUpdate(undefined, { atMs: T0, queuedAtMs: T0, channel: 'email' });
    expect(viaEmail.emailSentAt).toEqual(new Date(T0));
    expect(viaEmail.emailSends).toBe(1);
    expect(viaEmail.whatsappSends).toBeUndefined();
    const then = stage2LinkSendUpdate({ ...viaEmail }, { atMs: T0 + H, queuedAtMs: T0, channel: 'whatsapp' });
    expect(then.firstSentAt).toBeUndefined(); // ya empezó con el correo
    expect(then.whatsappSentAt).toEqual(new Date(T0 + H));
  });

  it('un inicio aproximado (del cambio de etapa) se conserva: el envío real es un reenvío', () => {
    const u = stage2LinkSendUpdate({ firstSentAt: new Date(T0 - 72 * H), approximate: true }, { atMs: T0, queuedAtMs: T0, channel: 'whatsapp' });
    expect(u.firstSentAt).toBeUndefined();
    expect(u.whatsappSentAt).toEqual(new Date(T0));
  });
});

describe('stage2LinkReceiptUpdate', () => {
  it('entregado y leído: solo el primero de cada uno', () => {
    expect(stage2LinkReceiptUpdate({}, 3, T0)).toEqual({ deliveredAt: new Date(T0) });
    expect(stage2LinkReceiptUpdate({ deliveredAt: new Date(T0) }, 3, T0 + H)).toBeNull();
    expect(stage2LinkReceiptUpdate({ deliveredAt: new Date(T0) }, 4, T0 + H)).toEqual({ readAt: new Date(T0 + H) });
    // Leído sin entregado previo (acuse perdido): leer implica que llegó.
    expect(stage2LinkReceiptUpdate(undefined, 4, T0)).toEqual({ deliveredAt: new Date(T0), readAt: new Date(T0) });
    expect(stage2LinkReceiptUpdate({}, 2, T0)).toBeNull();
  });
});

describe('stage2LinkOpenUpdate', () => {
  it('la primera apertura fija openedAt; luego, una escritura cada 10 min como mucho', () => {
    const first = stage2LinkOpenUpdate(undefined, T0)!;
    expect(first).toEqual({ openedAt: new Date(T0), lastOpenedAt: new Date(T0), opens: 1 });
    expect(stage2LinkOpenUpdate(first, T0 + OPEN_THROTTLE_MS - 1)).toBeNull();
    const again = stage2LinkOpenUpdate(first, T0 + OPEN_THROTTLE_MS)!;
    expect(again.openedAt).toBeUndefined();
    expect(again.opens).toBe(2);
  });
});

describe('aggregateStage2Sends — relleno de lo enviado antes del registro', () => {
  it('toma el primer y el último envío, acuses y el último mensaje; no duplica cola + historial', () => {
    const outbox = [
      { id: 'o1', status: 'sent', message: msg('appA_123'), createdAt: new Date(T0 - 2 * H), sentAt: new Date(T0), deliveredAt: new Date(T0 + 60_000), waMessageId: 'w1' },
      { id: 'o2', status: 'sent', message: msg('appA_123'), createdAt: new Date(T0 + 47 * H), sentAt: new Date(T0 + 48 * H), readAt: new Date(T0 + 49 * H), waMessageId: 'w2' },
      { id: 'o3', status: 'failed', message: msg('appA_123'), sentAt: null },
      { id: 'o4', status: 'sent', message: 'sin link', sentAt: new Date(T0) },
    ];
    // La cola también escribe el historial: los mismos dos envíos.
    const history = [
      { direction: 'outbound', text: msg('appA_123'), sentAt: new Date(T0 + 1000) },
      { direction: 'outbound', text: msg('appA_123'), sentAt: new Date(T0 + 48 * H + 1000) },
      { direction: 'inbound', text: msg('appA_123'), sentAt: new Date(T0 - 99 * H) }, // respuesta: no es un envío
    ];
    const out = aggregateStage2Sends(outbox, history);
    expect(Array.from(out.keys())).toEqual(['appA_123']);
    const a = out.get('appA_123')!;
    expect(a.firstSentAt).toEqual(new Date(T0));
    expect(a.lastSentAt).toEqual(new Date(T0 + 48 * H + 1000));
    expect(a.dueAt).toEqual(new Date(stage2DueAtMs(T0 - 2 * H)));
    expect(a.whatsappSends).toBe(2);
    expect(a.deliveredAt).toEqual(new Date(T0 + 60_000));
    expect(a.readAt).toEqual(new Date(T0 + 49 * H));
    expect(a.outboxId).toBe('o2');
    expect(a.waMessageId).toBe('w2');
    expect(a.backfilled).toBe(true);
  });

  it('solo historial (envíos anteriores a la cola)', () => {
    const out = aggregateStage2Sends([], [{ direction: 'outbound', text: msg('appB_456'), sentAt: new Date(T0) }]);
    expect(out.get('appB_456')?.firstSentAt).toEqual(new Date(T0));
    expect(out.get('appB_456')?.whatsappSends).toBe(1);
  });
});

describe('approximateStage2Link', () => {
  it('quien sigue en "Formulario etapa 2 enviado" sin rastro: la fecha del cambio de etapa, marcada aproximada', () => {
    const a = approximateStage2Link({ stage: 'Formulario etapa 2 enviado', lastStageUpdate: new Date(T0) })!;
    expect(a.firstSentAt).toEqual(new Date(T0));
    expect(a.approximate).toBe(true);
  });
  it('en otra etapa o sin fecha no se inventa nada', () => {
    expect(approximateStage2Link({ stage: 'Evaluación IA etapa 2', lastStageUpdate: new Date(T0) })).toBeNull();
    expect(approximateStage2Link({ stage: 'Formulario etapa 2 enviado' })).toBeNull();
  });
});
