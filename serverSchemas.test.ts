import { describe, it, expect } from 'vitest';
import {
  applySchema, applyConfirmationSchema, scoreStage2Schema, evaluateTestSchema,
  emailSendSchema, whatsappSendSchema, stageChangeSchema, parseCvSchema,
  decodeImageDataUrl, firstIssueMessage,
} from './serverSchemas';

/** The exact message a body would produce, or null if it validates. */
const errorOf = (schema: any, body: unknown): string | null => {
  const r = schema.safeParse(body);
  return r.success ? null : firstIssueMessage(r.error);
};

const validApply = {
  vacancyId: 'vac123',
  name: 'María Pérez',
  phone: '809-123-4567',
  email: 'maria@example.com',
  cvUrl: 'https://firebasestorage.googleapis.com/v0/b/bucket/o/cv.pdf?alt=media',
};

describe('applySchema (/api/apply — público)', () => {
  it('accepts a normal application', () => {
    const r = applySchema.safeParse(validApply);
    expect(r.success).toBe(true);
    if (r.success) {
      // The lenient optionals default to '' so the handler can .slice() them safely.
      expect(r.data.city).toBe('');
      expect(r.data.candidateId).toBe('');
    }
  });

  it('keeps the exact per-field messages candidates see', () => {
    expect(errorOf(applySchema, { ...validApply, vacancyId: '' })).toBe('Vacante inválida');
    expect(errorOf(applySchema, { ...validApply, vacancyId: 'a/b' })).toBe('Vacante inválida');
    expect(errorOf(applySchema, { ...validApply, name: '' })).toBe('Nombre inválido');
    expect(errorOf(applySchema, { ...validApply, name: 'x'.repeat(201) })).toBe('Nombre inválido');
    expect(errorOf(applySchema, { ...validApply, phone: 'x'.repeat(41) })).toBe('Teléfono inválido');
    expect(errorOf(applySchema, { ...validApply, email: 'no-es-correo' })).toBe('Correo inválido');
    expect(errorOf(applySchema, { ...validApply, email: 'a b@c.com' })).toBe('Correo inválido');
  });

  it('rejects a CV hosted anywhere but our storage bucket (SSRF guard)', () => {
    expect(errorOf(applySchema, { ...validApply, cvUrl: 'https://evil.com/cv.pdf' })).toBe('CV inválido');
    expect(errorOf(applySchema, { ...validApply, cvUrl: 'http://metadata.google.internal/x' })).toBe('CV inválido');
    expect(errorOf(applySchema, { ...validApply, cvUrl: 'x'.repeat(1001) })).toBe('CV inválido');
  });

  it('reports the FIRST invalid field, in the same order the old checks ran', () => {
    // Everything is wrong; the old code answered about the vacancy first.
    expect(errorOf(applySchema, {})).toBe('Vacante inválida');
    expect(errorOf(applySchema, { vacancyId: 'v1' })).toBe('Nombre inválido');
  });

  it('coerces junk in the lenient fields instead of failing the application', () => {
    // The old `str()` helper turned any non-string into '' — a candidate must not be
    // rejected because an optional field arrived with a weird type.
    const r = applySchema.safeParse({ ...validApply, city: 123, cvFileType: null });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.city).toBe('');
      expect(r.data.cvFileType).toBe('');
    }
  });
});

describe('applyConfirmationSchema', () => {
  it('validates the email and tolerates junk in the rest', () => {
    expect(errorOf(applyConfirmationSchema, { email: 'nope' })).toBe('Correo inválido');
    const r = applyConfirmationSchema.safeParse({ email: 'a@b.com', name: 42, vacancyTitle: undefined });
    expect(r.success).toBe(true);
  });
});

describe('answers de candidatos (score-stage2 / evaluate-test)', () => {
  const base = { applicationId: 'app1', answers: { '¿Pregunta?': 'Respuesta' } };

  it('accepts a plain question->answer object', () => {
    expect(scoreStage2Schema.safeParse(base).success).toBe(true);
    expect(evaluateTestSchema.safeParse({ ...base, questions: ['q1'] }).success).toBe(true);
  });

  it('rejects arrays and non-objects with the exact old message', () => {
    for (const bad of [['a'], 'texto', 42, null]) {
      expect(errorOf(scoreStage2Schema, { ...base, answers: bad })).toBe('Respuestas inválidas');
      expect(errorOf(evaluateTestSchema, { ...base, answers: bad })).toBe('Respuestas inválidas');
    }
  });

  it('rejects a path-traversal applicationId', () => {
    expect(errorOf(scoreStage2Schema, { ...base, applicationId: 'a/b' })).toBe('applicationId inválido');
    expect(errorOf(evaluateTestSchema, { ...base, applicationId: '' })).toBe('applicationId inválido');
  });

  it('treats force as false unless it is literally true', () => {
    // force gates a paid AI re-run; a truthy string must not trigger it.
    for (const notTrue of ['true', 1, undefined, null]) {
      const r = scoreStage2Schema.safeParse({ ...base, force: notTrue });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.force).toBe(false);
    }
    const r = scoreStage2Schema.safeParse({ ...base, force: true });
    if (r.success) expect(r.data.force).toBe(true);
  });
});

describe('endpoints de reclutador', () => {
  it('emailSendSchema keeps its two messages', () => {
    expect(errorOf(emailSendSchema, { to: 'nope', subject: 's', html: 'h' })).toBe('Destinatario inválido');
    expect(errorOf(emailSendSchema, { to: 'a@b.com', subject: 5, html: 'h' })).toBe('Asunto/contenido inválido');
  });

  it('whatsappSendSchema rejects blank-only strings, like the old .trim() checks', () => {
    expect(errorOf(whatsappSendSchema, { phone: '   ', message: 'hola' })).toBe('Phone number required');
    expect(errorOf(whatsappSendSchema, { phone: '809', message: '  ' })).toBe('Message required');
    expect(whatsappSendSchema.safeParse({ phone: '8091234567', message: 'hola' }).success).toBe(true);
  });

  it('stageChangeSchema allows an empty message (means: nothing to send)', () => {
    const r = stageChangeSchema.safeParse({ phone: '8091234567' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.message).toBe('');
    expect(errorOf(stageChangeSchema, { message: 'hola' })).toBe('Phone number required');
  });

  it('parseCvSchema pins fileUrl to our bucket and defaults the mimeType', () => {
    expect(errorOf(parseCvSchema, { fileUrl: 'http://metadata.google.internal/token' })).toBe('URL de CV inválida');
    const r = parseCvSchema.safeParse({ fileUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/y.pdf', mimeType: 42 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.mimeType).toBe('application/pdf');
    // No file at all is still schema-valid: the handler answers "No PDF provided".
    expect(parseCvSchema.safeParse({}).success).toBe(true);
  });
});

describe('decodeImageDataUrl', () => {
  const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('decodes a real image and derives the extension', () => {
    const r = decodeImageDataUrl(png1x1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contentType).toBe('image/png');
      expect(r.ext).toBe('png');
      expect(r.buffer.length).toBeGreaterThan(0);
    }
  });

  it('maps jpeg->jpg and svg+xml->svg for the stored filename', () => {
    const jpeg = decodeImageDataUrl('data:image/jpeg;base64,AAAA');
    if (jpeg.ok) expect(jpeg.ext).toBe('jpg');
    const svg = decodeImageDataUrl('data:image/svg+xml;base64,AAAA');
    if (svg.ok) expect(svg.ext).toBe('svg');
  });

  it('keeps the two distinct error messages (missing vs malformed)', () => {
    expect(decodeImageDataUrl(undefined)).toEqual({ ok: false, error: 'Falta la imagen (dataUrl).' });
    expect(decodeImageDataUrl(42)).toEqual({ ok: false, error: 'Falta la imagen (dataUrl).' });
    expect(decodeImageDataUrl('data:text/html;base64,AAAA')).toEqual({ ok: false, error: 'Formato de imagen inválido. Debe ser una imagen.' });
    expect(decodeImageDataUrl('no-es-data-url')).toEqual({ ok: false, error: 'Formato de imagen inválido. Debe ser una imagen.' });
  });
});
