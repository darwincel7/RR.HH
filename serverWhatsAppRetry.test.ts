import { describe, it, expect } from 'vitest';
import { proto, generateWAMessageContent } from '@whiskeysockets/baileys';
import {
  encodeSentMessage, sentMessageFromOutbox, recipientDeviceJids, repairBlockedReason, isOwnDevice,
  MAX_MANUAL_REPAIRS, REPAIR_COOLDOWN_MS, REPAIR_MAX_AGE_MS,
} from './serverWhatsAppRetry';
import { toMs } from './src/lib/formTiming';

const bytes = (m: proto.IMessage) => Buffer.from(proto.Message.encode(m).finish()).toString('hex');
const TEXT = 'Hola María 👋, completa tu formulario aquí: https://rrhh.example.com/eval/abc123_vac9 antes del jueves 15 de octubre.';

describe('sentMessageFromOutbox — lo que se reenvía cuando el teléfono del candidato lo pide', () => {
  it('reconstruye desde el texto EXACTAMENTE el mensaje que Baileys envía para { text } (sin vista previa)', async () => {
    // Así salen los mensajes de la cola: sock.sendMessage(jid, { text }). Sin
    // link-preview-js instalado no hay vista previa del enlace.
    const sent = await generateWAMessageContent({ text: TEXT }, { logger: undefined as any, upload: undefined as any });
    const rebuilt = sentMessageFromOutbox({ message: TEXT });
    expect(rebuilt).toBeDefined();
    expect(bytes(rebuilt!)).toBe(bytes(sent));
  });

  it('prefiere el contenido guardado al enviarlo (exacto aunque el texto cambie de forma)', () => {
    const original = proto.Message.fromObject({ extendedTextMessage: { text: TEXT, contextInfo: { expiration: 86400 } } });
    const stored = encodeSentMessage(original);
    expect(stored).toBeTruthy();
    const back = sentMessageFromOutbox({ waMessageProto: stored, message: 'otro texto' });
    expect(bytes(back!)).toBe(bytes(original));
  });

  it('un contenido guardado corrupto no deja al candidato sin reenvío: usa el texto', () => {
    const back = sentMessageFromOutbox({ waMessageProto: '###no-es-base64-valido###', message: TEXT });
    expect(back?.extendedTextMessage?.text).toBe(TEXT);
  });

  it('sin texto ni contenido no inventa nada', () => {
    expect(sentMessageFromOutbox(null)).toBeUndefined();
    expect(sentMessageFromOutbox({})).toBeUndefined();
    expect(sentMessageFromOutbox({ message: '' })).toBeUndefined();
  });

  it('encodeSentMessage no revienta con basura', () => {
    expect(encodeSentMessage(null)).toBeNull();
    expect(encodeSentMessage('texto')).toBeNull();
  });
});

describe('recipientDeviceJids — a qué dispositivos se les abre sesión nueva al reparar', () => {
  it('incluye siempre el teléfono (dispositivo 0) y los vinculados, sin duplicados', () => {
    expect(recipientDeviceJids('18095551234@s.whatsapp.net', [
      { user: '18095551234', device: 0 },
      { user: '18095551234', device: 3 },
      { user: '18095551234', device: 3 },
    ])).toEqual(['18095551234@s.whatsapp.net', '18095551234:3@s.whatsapp.net']);
  });

  it('sin respuesta de dispositivos, al menos el teléfono', () => {
    expect(recipientDeviceJids('18095551234@s.whatsapp.net', [])).toEqual(['18095551234@s.whatsapp.net']);
  });

  it('nunca toca dispositivos de otro usuario (p. ej. los nuestros)', () => {
    expect(recipientDeviceJids('18095551234@s.whatsapp.net', [{ user: '18490000000', device: 2 }]))
      .toEqual(['18095551234@s.whatsapp.net']);
  });

  it('jid inválido → nada', () => {
    expect(recipientDeviceJids('', [])).toEqual([]);
  });
});

describe('repairBlockedReason', () => {
  const now = Date.parse('2026-10-28T15:00:00Z');
  const ok = { status: 'sent', waMessageId: '3EB0ABC', sentAt: new Date(now - 3_600_000) };

  it('un mensaje enviado con su id se puede reparar', () => {
    expect(repairBlockedReason(ok, now, toMs)).toBeNull();
  });
  it('solo los ya enviados', () => {
    expect(repairBlockedReason({ ...ok, status: 'queued' }, now, toMs)).toMatch(/ya salieron/);
    expect(repairBlockedReason(null, now, toMs)).toMatch(/no existe/);
  });
  it('sin id de WhatsApp o muy viejo → "Enviar de nuevo"', () => {
    expect(repairBlockedReason({ ...ok, waMessageId: undefined }, now, toMs)).toMatch(/Enviar de nuevo/);
    expect(repairBlockedReason({ ...ok, sentAt: new Date(now - REPAIR_MAX_AGE_MS - 1) }, now, toMs)).toMatch(/30 días/);
  });
  it('limita las reparaciones seguidas', () => {
    expect(repairBlockedReason({ ...ok, repairs: MAX_MANUAL_REPAIRS }, now, toMs)).toMatch(/varias veces/);
    expect(repairBlockedReason({ ...ok, repairs: 1, lastRepairAt: new Date(now - REPAIR_COOLDOWN_MS + 1000) }, now, toMs)).toMatch(/espera/);
    expect(repairBlockedReason({ ...ok, repairs: 1, lastRepairAt: new Date(now - REPAIR_COOLDOWN_MS - 1000) }, now, toMs)).toBeNull();
  });
});

describe('isOwnDevice — quién pidió el reenvío', () => {
  const me = { id: '18495550000:12@s.whatsapp.net', lid: '987654321:12@lid' };
  it('el teléfono de la empresa (por número o por LID) no es el candidato', () => {
    expect(isOwnDevice('18495550000@s.whatsapp.net', me)).toBe(true);
    expect(isOwnDevice('18495550000:0@s.whatsapp.net', me)).toBe(true);
    expect(isOwnDevice('987654321:3@lid', me)).toBe(true);
  });
  it('el candidato sí cuenta', () => {
    expect(isOwnDevice('18095551234@s.whatsapp.net', me)).toBe(false);
    expect(isOwnDevice('111222333@lid', me)).toBe(false);
  });
  it('sin datos → se cuenta como del candidato (no se esconde nada)', () => {
    expect(isOwnDevice(undefined, me)).toBe(false);
    expect(isOwnDevice('18495550000@s.whatsapp.net', null)).toBe(false);
  });
});
