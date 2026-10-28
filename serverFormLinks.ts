import { toMs, stage2DueAtMs } from './src/lib/formTiming';

/**
 * Registro de cuándo salió, llegó y se abrió el link del formulario de etapa 2
 * (`application.stage2Link`). Lógica pura: server.ts hace las lecturas/escrituras.
 *
 * El link se reconoce en el TEXTO que sale (".../eval/{applicationId}") — no hace falta
 * que cada pantalla que mueve tarjetas lo informe, y cuenta igual si el reclutador lo
 * pega a mano en el chat o si sale por correo.
 */

const EVAL_LINK_RE = /\/eval\/([A-Za-z0-9_-]{4,200})/g;

/** Ids de postulación de los links de formulario de etapa 2 dentro de un texto. */
export function extractEvalApplicationIds(text: unknown): string[] {
  if (typeof text !== 'string' || !text) return [];
  const ids = new Set<string>();
  for (const m of text.matchAll(EVAL_LINK_RE)) {
    ids.add(m[1]);
    if (ids.size >= 5) break; // un mensaje real lleva uno; nunca una lista
  }
  return Array.from(ids);
}

export interface LinkSend {
  /** Cuándo salió de verdad. */
  atMs: number;
  /** Cuándo se ordenó el envío (mover la tarjeta): de ahí sale la fecha que dice el mensaje. */
  queuedAtMs: number;
  channel: 'whatsapp' | 'email';
  waMessageId?: string | null;
  outboxId?: string | null;
}

/**
 * Lo que hay que fusionar en `stage2Link` por un envío. El PRIMER envío fija el inicio
 * del reloj y la fecha límite; los siguientes (reenvíos, correo + WhatsApp del mismo
 * movimiento) solo actualizan el último y los contadores.
 */
export function stage2LinkSendUpdate(current: any, send: LinkSend): Record<string, any> {
  const link = current && typeof current === 'object' ? current : {};
  const at = new Date(send.atMs);
  const update: Record<string, any> = { lastSentAt: at };
  // Un inicio aproximado (deducido del cambio de etapa) se conserva: es anterior a
  // este envío, que entonces es un reenvío.
  if (!toMs(link.firstSentAt)) {
    update.firstSentAt = at;
    update.dueAt = new Date(stage2DueAtMs(send.queuedAtMs || send.atMs));
  }
  if (send.channel === 'whatsapp') {
    if (!toMs(link.whatsappSentAt)) update.whatsappSentAt = at;
    update.lastWhatsappSentAt = at;
    update.whatsappSends = (Number(link.whatsappSends) || 0) + 1;
    // El último mensaje de WhatsApp con el link: el que "Reparar entrega" reenvía.
    if (send.outboxId) update.outboxId = send.outboxId;
    if (send.waMessageId) update.waMessageId = send.waMessageId;
  } else {
    if (!toMs(link.emailSentAt)) update.emailSentAt = at;
    update.emailSends = (Number(link.emailSends) || 0) + 1;
  }
  return update;
}

/** Acuse de WhatsApp (3 = entregado, 4+ = leído): solo el primero de cada tipo cuenta. */
export function stage2LinkReceiptUpdate(current: any, status: number, atMs: number): Record<string, any> | null {
  const link = current && typeof current === 'object' ? current : {};
  const at = new Date(atMs);
  const update: Record<string, any> = {};
  if (status >= 3 && !toMs(link.deliveredAt)) update.deliveredAt = at;
  if (status >= 4 && !toMs(link.readAt)) update.readAt = at;
  return Object.keys(update).length ? update : null;
}

/** Quien abre el link: la primera vez fija `openedAt`; las siguientes, cada 10 min como mucho. */
export const OPEN_THROTTLE_MS = 10 * 60_000;

export function stage2LinkOpenUpdate(current: any, nowMs: number): Record<string, any> | null {
  const link = current && typeof current === 'object' ? current : {};
  if (toMs(link.lastOpenedAt) && nowMs - toMs(link.lastOpenedAt) < OPEN_THROTTLE_MS) return null;
  const at = new Date(nowMs);
  return {
    ...(toMs(link.openedAt) ? {} : { openedAt: at }),
    lastOpenedAt: at,
    opens: (Number(link.opens) || 0) + 1,
  };
}

// ---------------------------------------------------------------------------------
// Relleno de lo ya enviado antes de este registro
// ---------------------------------------------------------------------------------

/**
 * A partir de la cola de WhatsApp y del historial de mensajes, reconstruye por
 * postulación los envíos de formularios hechos antes de que existiera `stage2Link`.
 * Un mismo envío suele estar en ambas fuentes (la cola escribe también el historial):
 * por eso los contadores toman el máximo de cada fuente, no la suma.
 */
export function aggregateStage2Sends(outboxDocs: any[], historyDocs: any[]): Map<string, Record<string, any>> {
  type Acc = {
    first: number; last: number; queuedFirst: number;
    outboxSends: number; historySends: number;
    delivered: number; read: number;
    outboxId: string | null; waMessageId: string | null; lastOutboxAt: number;
  };
  const acc = new Map<string, Acc>();
  const get = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { first: 0, last: 0, queuedFirst: 0, outboxSends: 0, historySends: 0, delivered: 0, read: 0, outboxId: null, waMessageId: null, lastOutboxAt: 0 };
      acc.set(id, a);
    }
    return a;
  };
  const minPos = (a: number, b: number) => (a && b ? Math.min(a, b) : a || b);

  for (const d of outboxDocs || []) {
    const at = toMs(d?.sentAt);
    if (d?.status !== 'sent' || !at) continue;
    for (const appId of extractEvalApplicationIds(d.message)) {
      const a = get(appId);
      if (!a.first || at < a.first) { a.first = at; a.queuedFirst = toMs(d.createdAt) || at; }
      a.last = Math.max(a.last, at);
      a.outboxSends++;
      a.delivered = minPos(a.delivered, toMs(d.deliveredAt) || toMs(d.readAt));
      a.read = minPos(a.read, toMs(d.readAt));
      if (at >= a.lastOutboxAt) {
        a.lastOutboxAt = at;
        a.outboxId = typeof d.id === 'string' ? d.id : null;
        a.waMessageId = typeof d.waMessageId === 'string' ? d.waMessageId : null;
      }
    }
  }
  for (const d of historyDocs || []) {
    const at = toMs(d?.sentAt);
    if (d?.direction !== 'outbound' || !at) continue;
    for (const appId of extractEvalApplicationIds(d.text)) {
      const a = get(appId);
      if (!a.first || at < a.first) { a.first = at; a.queuedFirst = at; }
      a.last = Math.max(a.last, at);
      a.historySends++;
    }
  }

  const out = new Map<string, Record<string, any>>();
  for (const [appId, a] of acc) {
    out.set(appId, {
      firstSentAt: new Date(a.first),
      lastSentAt: new Date(a.last),
      dueAt: new Date(stage2DueAtMs(a.queuedFirst || a.first)),
      whatsappSentAt: new Date(a.first),
      lastWhatsappSentAt: new Date(a.last),
      whatsappSends: Math.max(a.outboxSends, a.historySends, 1),
      ...(a.delivered ? { deliveredAt: new Date(a.delivered) } : {}),
      ...(a.read ? { readAt: new Date(a.read) } : {}),
      ...(a.outboxId ? { outboxId: a.outboxId } : {}),
      ...(a.waMessageId ? { waMessageId: a.waMessageId } : {}),
      approximate: false,
      backfilled: true,
    });
  }
  return out;
}

/**
 * Sin rastro del mensaje (envíos anteriores a la cola y al historial): si la
 * postulación sigue en "Formulario etapa 2 enviado", el cambio a esa etapa es la mejor
 * estimación de cuándo se le envió. Se marca como aproximado.
 */
export function approximateStage2Link(app: any): Record<string, any> | null {
  if (app?.stage !== 'Formulario etapa 2 enviado') return null;
  const at = toMs(app?.lastStageUpdate);
  if (!at) return null;
  return {
    firstSentAt: new Date(at),
    lastSentAt: new Date(at),
    dueAt: new Date(stage2DueAtMs(at)),
    approximate: true,
    backfilled: true,
  };
}
