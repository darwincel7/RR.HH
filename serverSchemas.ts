import { z } from 'zod';

/**
 * Zod schemas for every /api/* request body.
 *
 * One place instead of ~35 hand-written checks scattered across server.ts. The rules
 * (and their exact Spanish error messages) are the ones the handlers already enforced —
 * a new endpoint gets a schema here and can't silently forget a check. serverSchemas.test.ts
 * pins the messages and edge cases so a schema change that would alter what candidates
 * see fails the suite.
 *
 * Handlers keep two things for themselves, on purpose:
 *  - size limits that answer 413 (payload too large is not 400 bad request);
 *  - anything needing I/O (does the vacancy exist, is WhatsApp connected).
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** CVs live in OUR bucket. Enforced at every border where a URL enters the system:
 * the server fetches these URLs, so accepting arbitrary ones is an SSRF vector
 * (e.g. Cloud Run's metadata server). */
const STORAGE_URL_PREFIX = 'https://firebasestorage.googleapis.com/';
export const isOurStorageUrl = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 1000 && v.startsWith(STORAGE_URL_PREFIX);

/** A required string field whose every failure mode reports the same message,
 * mirroring how the manual checks answered (one message per field, not per cause). */
const requiredString = (msg: string, max: number) =>
  z.string({ error: msg }).min(1, { error: msg }).max(max, { error: msg });

/** Optional free-text the old code ran through `str()`: any non-string became ''. */
const lenientString = () => z.string().catch('').default('');

/** Firestore document id used in a path: must not smuggle a '/'. */
const docIdField = (msg: string) =>
  requiredString(msg, 200).refine(v => !v.includes('/'), { error: msg });

// ---------------------------------------------------------------------------
// Public endpoints (candidates)
// ---------------------------------------------------------------------------

/** POST /api/apply — key order mirrors the old check order, so the FIRST error
 * reported for a multi-invalid body stays the same. */
export const applySchema = z.object({
  vacancyId: docIdField('Vacante inválida'),
  name: requiredString('Nombre inválido', 200),
  phone: requiredString('Teléfono inválido', 40),
  email: z.string({ error: 'Correo inválido' }).max(200, { error: 'Correo inválido' })
    .regex(EMAIL_RE, { error: 'Correo inválido' }),
  cvUrl: z.string({ error: 'CV inválido' }).max(1000, { error: 'CV inválido' })
    .refine(v => v.startsWith(STORAGE_URL_PREFIX), { error: 'CV inválido' }),
  city: lenientString(),
  cvFileType: lenientString(),
  candidateId: lenientString(), // only honored in dev mode; admin mode derives it from the token
});

/** POST /api/public/apply-confirmation */
export const applyConfirmationSchema = z.object({
  email: z.string({ error: 'Correo inválido' }).max(200, { error: 'Correo inválido' })
    .regex(EMAIL_RE, { error: 'Correo inválido' }),
  name: lenientString(),
  vacancyTitle: lenientString(),
});

/** Candidate answers: a plain object of question -> answer. Arrays are rejected —
 * indexing an array with question ids silently produced an empty evaluation. */
const answersField = z.record(z.string(), z.unknown(), { error: 'Respuestas inválidas' })
  .refine(v => !Array.isArray(v), { error: 'Respuestas inválidas' });

/** The counters the test page keeps while it is answered (src/lib/testIntegrity.ts).
 * They come from the candidate's browser — a signal, not proof — so a malformed block is
 * dropped (undefined) rather than rejecting the answers, and every counter is clamped. */
const DAY_MS = 24 * 60 * 60 * 1000;
const integrityCounter = (max: number) =>
  z.number().finite().min(0).transform(n => Math.min(Math.round(n), max));
const integrityField = () => z.object({
  exits: integrityCounter(10_000),
  awayMs: integrityCounter(DAY_MS),
  pasteBlocked: integrityCounter(10_000),
  durationMs: integrityCounter(DAY_MS),
}).optional().catch(undefined);

/** A Firestore id that may be absent: anything that isn't one becomes ''. */
const optionalDocId = () =>
  z.string().max(200).refine(v => !v.includes('/')).catch('').default('');

/** POST /api/score-stage2 */
export const scoreStage2Schema = z.object({
  applicationId: docIdField('applicationId inválido'),
  answers: answersField,
  force: z.boolean().catch(false).default(false), // only honored for recruiter callers
});

/** POST /api/evaluate-test — `questions` is deliberately unvalidated: the handler
 * already tolerates any shape (non-arrays become []). */
export const evaluateTestSchema = z.object({
  applicationId: docIdField('applicationId inválido'),
  answers: answersField,
  questions: z.unknown().optional(),
  force: z.boolean().catch(false).default(false),
  integrity: integrityField(),
  // Answered on a company phone (station mode): the server checks it was assigned there.
  stationId: optionalDocId(),
});

/** POST /api/public/personality/submit — the answers are checked against the copy of the
 * test SAVED on the application (personalityTest.ts → checkAnswers), never against
 * questions the request carries. `attemptId` ties the submission to the attempt the
 * candidate opened: if the interviewer restarted the test meanwhile, it is refused. */
export const personalitySubmitSchema = z.object({
  applicationId: docIdField('applicationId inválido'),
  answers: answersField,
  attemptId: lenientString(),
  // Answered on a company phone (station mode): the server checks it was assigned there.
  stationId: optionalDocId(),
});

// ---------------------------------------------------------------------------
// Station mode (company phones — src/lib/stations.ts)
// ---------------------------------------------------------------------------

const stationIdField = () => docIdField('Este teléfono no está vinculado.');
/** Which test the phone is on. Phones running the page from before there were two
 * kinds send none: theirs is the situational test. */
const stationKindField = () => z.enum(['test', 'personality']).catch('test').default('test');
const intIn = (min: number, max: number, msg: string) =>
  z.number({ error: msg }).int({ error: msg }).min(min, { error: msg }).max(max, { error: msg });

/** POST /api/public/station/pair */
export const stationPairSchema = z.object({
  code: z.string({ error: 'Escribe los 6 dígitos del código.' }).regex(/^\d{6}$/, { error: 'Escribe los 6 dígitos del código.' }),
  name: z.string({ error: 'Ponle un nombre al teléfono.' }).transform(v => v.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1, { error: 'Ponle un nombre al teléfono.' }).max(40, { error: 'El nombre puede tener hasta 40 caracteres.' })),
});

/** POST /api/public/station/poll */
export const stationPollSchema = z.object({ stationId: stationIdField() });

/** POST /api/public/station/progress */
export const stationProgressSchema = z.object({
  stationId: stationIdField(),
  applicationId: docIdField('applicationId inválido'),
  kind: stationKindField(),
  index: intIn(-1, 1000, 'Avance inválido'),
  total: intIn(0, 1000, 'Avance inválido'),
  exits: intIn(0, 10_000, 'Avance inválido'),
});

/** POST /api/public/station/release */
export const stationReleaseSchema = z.object({
  stationId: stationIdField(),
  applicationId: docIdField('applicationId inválido'),
  kind: stationKindField(),
});

// ---------------------------------------------------------------------------
// Recruiter endpoints
// ---------------------------------------------------------------------------

/** POST /api/email/send — subject/html LENGTH limits stay in the handler (they answer 413). */
export const emailSendSchema = z.object({
  to: z.string({ error: 'Destinatario inválido' }).regex(EMAIL_RE, { error: 'Destinatario inválido' }),
  subject: z.string({ error: 'Asunto/contenido inválido' }),
  html: z.string({ error: 'Asunto/contenido inválido' }),
});

/** POST /api/whatsapp/send */
export const whatsappSendSchema = z.object({
  phone: z.string({ error: 'Phone number required' })
    .refine(v => v.trim().length > 0, { error: 'Phone number required' }),
  message: z.string({ error: 'Message required' })
    .refine(v => v.trim().length > 0, { error: 'Message required' }),
});

/** POST /api/automations/stage-change — an empty message is VALID here: it means
 * "stage changed, nothing to send" and the handler answers success without sending. */
export const stageChangeSchema = z.object({
  phone: requiredString('Phone number required', 40),
  message: lenientString(),
});

/** POST /api/evaluate-interview — only the id travels: the evidence is read from the SAVED
 * application server-side, so the request can't feed the AI a scorecard nobody saved. */
export const evaluateInterviewSchema = z.object({
  applicationId: docIdField('applicationId inválido'),
});

/** POST /api/personality/interpret — only the id travels: the AI reads the answers and the
 * result SAVED on the application. */
export const personalityInterpretSchema = z.object({
  applicationId: docIdField('applicationId inválido'),
});

/** POST /api/candidates/merge — unifica dos perfiles del mismo postulante. Solo viajan
 * los dos ids: QUÉ se mueve y qué se completa lo decide el servidor leyendo los
 * documentos guardados (mergeCandidates.ts), nunca el cuerpo de la petición. */
export const mergeCandidatesSchema = z.object({
  primaryId: docIdField('Perfil principal inválido'),
  duplicateId: docIdField('Perfil duplicado inválido'),
});

/** POST /api/parse-cv — fileUrl restricted to our bucket: the server fetches it, and an
 * arbitrary URL here was the last remaining SSRF path (recruiter-authed, but still a
 * credential-theft risk against the metadata server). */
export const parseCvSchema = z.object({
  pdfBase64: z.string({ error: 'pdfBase64 inválido' }).optional(),
  fileUrl: z.string({ error: 'URL de CV inválida' }).max(1000, { error: 'URL de CV inválida' })
    .refine(v => v.startsWith(STORAGE_URL_PREFIX), { error: 'URL de CV inválida' })
    .optional(),
  mimeType: z.string().catch('application/pdf').default('application/pdf'),
});

// ---------------------------------------------------------------------------
// Shared image-upload decoding (careers hero + company logo)
// ---------------------------------------------------------------------------

// Narrow with `'error' in img`, not `!img.ok`: this project compiles without
// strictNullChecks, where the boolean-discriminant narrowing doesn't kick in.
export type DecodedImage =
  | { ok: true; contentType: string; buffer: Buffer; ext: string }
  | { ok: false; error: string };

/** Decodes a `data:image/...;base64,` URL. Size limits stay with the caller (413). */
export function decodeImageDataUrl(dataUrl: unknown): DecodedImage {
  if (typeof dataUrl !== 'string') return { ok: false, error: 'Falta la imagen (dataUrl).' };
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return { ok: false, error: 'Formato de imagen inválido. Debe ser una imagen.' };
  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext = contentType.split('/')[1].split('+')[0].replace('jpeg', 'jpg');
  return { ok: true, contentType, buffer, ext };
}

/** The message shown to the caller when a schema rejects a body: its first issue,
 * matching the old one-check-at-a-time behavior. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message || 'Datos inválidos';
}
