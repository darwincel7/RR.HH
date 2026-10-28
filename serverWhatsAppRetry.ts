import { proto, jidDecode, jidEncode } from '@whiskeysockets/baileys';

/**
 * "Esperando el mensaje. Esto puede tomar tiempo." — lo que ve el candidato cuando su
 * teléfono recibe un mensaje nuestro que NO puede descifrar (sesión de cifrado
 * desfasada: un reinicio a mitad de una escritura de claves, un cambio de teléfono, la
 * migración de WhatsApp a identificadores LID…).
 *
 * WhatsApp lo resuelve solo: el teléfono del candidato nos pide reenviarlo y Baileys lo
 * vuelve a cifrar con una sesión nueva — PERO solo si `getMessage` le devuelve el
 * contenido. Antes ese contenido vivía únicamente en memoria: Cloud Run reinicia o
 * apaga la instancia (deploys, inactividad), y la petición de reenvío que llegaba
 * después — p. ej. cuando el candidato encendía los datos horas más tarde — se quedaba
 * sin respuesta. El candidato veía "Esperando el mensaje" PARA SIEMPRE.
 *
 * Ahora el contenido exacto se guarda en la cola (`whatsapp_outbox.waMessageProto`) y
 * se recupera de ahí. Para los mensajes enviados antes de este cambio se reconstruye
 * desde el texto: lo que Baileys envía para `{ text }` sin vista previa de enlace es
 * exactamente `{ extendedTextMessage: { text } }` (fijado por prueba).
 */

/** Contenido de un mensaje enviado → base64, para guardarlo junto al mensaje en la cola. */
export function encodeSentMessage(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  try {
    return Buffer.from(proto.Message.encode(message as proto.IMessage).finish()).toString('base64');
  } catch {
    return null;
  }
}

/** El mensaje a reenviar, a partir del documento de la cola. undefined si no hay con qué. */
export function sentMessageFromOutbox(doc: any): proto.IMessage | undefined {
  if (!doc) return undefined;
  if (typeof doc.waMessageProto === 'string' && doc.waMessageProto) {
    try {
      return proto.Message.decode(Buffer.from(doc.waMessageProto, 'base64'));
    } catch { /* corrupto: se reconstruye desde el texto */ }
  }
  if (typeof doc.message === 'string' && doc.message) {
    return proto.Message.fromObject({ extendedTextMessage: { text: doc.message } });
  }
  return undefined;
}

/**
 * Todos los dispositivos del destinatario a los que hay que abrir una sesión de cifrado
 * nueva: el teléfono (dispositivo 0, que la consulta de dispositivos omite) más los
 * vinculados que WhatsApp reporte. Sin duplicados ni dispositivos de otro usuario.
 */
export function recipientDeviceJids(baseJid: string, devices: Array<{ user?: string; device?: number }>): string[] {
  const base = jidDecode(baseJid);
  if (!base?.user) return [];
  const server = base.server === 'lid' ? 'lid' : 's.whatsapp.net';
  const out = new Set<string>([jidEncode(base.user, server)]);
  for (const d of devices || []) {
    if (!d || d.user !== base.user) continue;
    out.add(d.device ? jidEncode(base.user, server, d.device) : jidEncode(base.user, server));
  }
  return Array.from(out);
}

/**
 * ¿La petición de reenvío vino de un dispositivo NUESTRO? Cada mensaje sale también como
 * copia al teléfono de la empresa, que puede pedir reenviarla. Eso no dice nada del
 * candidato: no debe contarse como "su teléfono no pudo abrirlo".
 */
export function isOwnDevice(participant: unknown, me: { id?: string | null; lid?: string | null } | null | undefined): boolean {
  if (typeof participant !== 'string' || !participant || !me) return false;
  const who = jidDecode(participant)?.user;
  if (!who) return false;
  return [me.id, me.lid].some(j => typeof j === 'string' && !!j && jidDecode(j)?.user === who);
}

/** Máximo de reparaciones manuales por mensaje, y espera mínima entre dos. */
export const MAX_MANUAL_REPAIRS = 3;
export const REPAIR_COOLDOWN_MS = 2 * 60_000;
/** Más allá de esto el mensaje es viejo: WhatsApp ya no guarda su lugar en el chat. */
export const REPAIR_MAX_AGE_MS = 30 * 86_400_000;

/** ¿Se puede reparar este mensaje ahora? null = sí; si no, el motivo para el reclutador. */
export function repairBlockedReason(doc: any, nowMs: number, toMs: (v: unknown) => number): string | null {
  if (!doc) return 'El mensaje ya no existe.';
  if (doc.status !== 'sent') return 'Solo se pueden reparar mensajes que ya salieron.';
  if (!doc.waMessageId) return 'Este mensaje no guardó su identificador de WhatsApp; usa "Enviar de nuevo".';
  const sentAt = toMs(doc.sentAt);
  if (sentAt && nowMs - sentAt > REPAIR_MAX_AGE_MS) return 'El mensaje tiene más de 30 días; usa "Enviar de nuevo".';
  if ((Number(doc.repairs) || 0) >= MAX_MANUAL_REPAIRS) return 'Ya se reparó varias veces; usa "Enviar de nuevo".';
  const last = toMs(doc.lastRepairAt);
  if (last && nowMs - last < REPAIR_COOLDOWN_MS) return 'Se acaba de reparar; espera un par de minutos.';
  return null;
}
