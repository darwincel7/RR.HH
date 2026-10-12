import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * sendWhatsAppAutomation end to end, with Firestore, email and the API mocked: what a
 * stage change actually sends. Pins the anti-ban guarantees that live on the client —
 * a different wording per candidate but the SAME text on a retry (the queue dedupes on
 * it), the notification keys the queue dedupes/supersedes by, the email-only channel,
 * and never re-sending an email that already went out.
 */

const docs: Record<string, any> = {};
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  getDoc: vi.fn(async (path: string) => ({ exists: () => path in docs, data: () => docs[path] })),
  addDoc: vi.fn(), collection: vi.fn(), serverTimestamp: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: vi.fn(),
}));
const sendEmail = vi.fn(async (..._args: unknown[]) => ({ success: true }));
vi.mock('./email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a), getEmailTemplate: (_t: string, content: string) => content }));
let apiAnswer: any = { success: true, queued: true };
const apiFetch = vi.fn(async (_url: string, _init?: any) => new Response(JSON.stringify(apiAnswer)));
vi.mock('./api', () => ({ apiFetch: (url: string, init?: any) => apiFetch(url, init) }));

const { sendWhatsAppAutomation, getStageTemplate } = await import('./whatsapp');

const STAGE2 = 'Formulario etapa 2 enviado';
const vars = { nombre: 'ANA MARTINEZ', vacante: 'Cajera', link: 'https://app.test/eval/1', email: 'ana@test.com' };
const sentBody = (i = -1) => JSON.parse(apiFetch.mock.calls.at(i)![1].body);

beforeEach(() => {
  for (const k of Object.keys(docs)) delete docs[k];
  docs['settings/company'] = { name: 'Darwin Cell' };
  apiAnswer = { success: true, queued: true };
  apiFetch.mockClear();
  sendEmail.mockClear();
});

describe('sendWhatsAppAutomation', () => {
  it('queues a personalized message with the notification keys', async () => {
    const r = await sendWhatsAppAutomation('809-555-1000', STAGE2, vars);
    expect(r).toEqual({ status: 'queued', emailed: true });
    const body = sentBody();
    expect(body.message).toMatch(/^(Hola|Buenas) Ana, /);
    expect(body.message).toContain('Darwin Cell');
    expect(body.message).not.toMatch(/[{}]/);
    expect(JSON.parse(body.dedupeKey)).toEqual([STAGE2, 'Cajera', '', '']);
    expect(JSON.parse(body.topicKey)).toEqual([STAGE2, 'Cajera']);
  });

  it('a retry renders exactly the same text (so the queue recognizes it)', async () => {
    await sendWhatsAppAutomation('809-555-1000', STAGE2, vars);
    await sendWhatsAppAutomation('(809) 555 1000', STAGE2, vars); // same phone, other format
    expect(sentBody(0).message).toBe(sentBody(1).message);
    expect(sentBody(0).dedupeKey).toBe(sentBody(1).dedupeKey);
  });

  it('different candidates get different wordings', async () => {
    for (let i = 0; i < 10; i++) await sendWhatsAppAutomation(`80955510${10 + i}`, STAGE2, vars);
    const texts = new Set(apiFetch.mock.calls.map(c => JSON.parse(c[1].body).message));
    expect(texts.size).toBeGreaterThanOrEqual(7);
  });

  it('the stage-2 deadline is never left blank ("antes del :")', async () => {
    await sendWhatsAppAutomation('8095551000', STAGE2, vars);
    expect(sentBody().message).toMatch(/antes del (lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{1,2} de \w+:/);
  });

  it('email-only: the email goes out and the WhatsApp number stays out of it', async () => {
    const r = await sendWhatsAppAutomation('8095551000', STAGE2, vars, { channels: { whatsapp: false } });
    expect(r).toEqual({ status: 'skipped', reason: 'solo_correo', emailed: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('a failed WhatsApp send reports whether the email already went out', async () => {
    apiAnswer = { success: false, error: 'WhatsApp not connected' };
    expect(await sendWhatsAppAutomation('8095551000', STAGE2, vars)).toMatchObject({ status: 'failed', emailed: true });
    expect(await sendWhatsAppAutomation('8095551000', STAGE2, vars, { channels: { email: false } })).toMatchObject({ status: 'failed', emailed: false });
  });

  it('a configured template is used as written (with its own variations)', async () => {
    docs['settings/whatsapp_templates'] = { templates: { Descartado: '{Hola|Hola} {{primer_nombre}}: gracias por participar en {{vacante}}.' } };
    await sendWhatsAppAutomation('8095551000', 'Descartado', vars);
    expect(sentBody().message).toBe('Hola Ana: gracias por participar en Cajera.');
  });
});

describe('getStageTemplate', () => {
  it('falls back to the default template, which comes with variations', async () => {
    expect(await getStageTemplate(STAGE2)).toContain('{Hola|Buenas}');
    expect(await getStageTemplate('Etapa sin plantilla')).toBe('');
  });

  it('a blank configured template falls back to the default too', async () => {
    docs['settings/whatsapp_templates'] = { templates: { [STAGE2]: '   ' } };
    expect(await getStageTemplate(STAGE2)).toContain('{{primer_nombre}}');
  });
});
