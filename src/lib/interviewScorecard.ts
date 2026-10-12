/**
 * The structured interview scorecard ("Evaluar Entrevista" in the candidate profile).
 *
 * Two kinds of data live here and must never be confused:
 *  - the QUESTION BANK (settings/forms → scorecard.recommendedQuestions): suggestions
 *    shared by every interview, editable by any recruiter — from Formularios or right
 *    inside the interview modal;
 *  - the ANSWERS (applications/{id} → interviewScorecard.answers): what THIS candidate
 *    said, as described by the interviewer. Each answer keeps the question text it was
 *    given to (a snapshot), so editing or deleting a bank question later never rewrites
 *    or loses what a candidate already answered.
 *
 * A question only carries an answer once the interviewer SELECTS it for that: the bank
 * is a menu of suggestions, not a form every candidate must fill. The AI interview
 * evaluation reads the described answers, so every rule here decides what it sees.
 */

export interface ScorecardTemplate {
  recommendedQuestions: string[];
  positiveSignals: string[];
  redFlags: string[];
  metrics: string[];
}

export const DEFAULT_SCORECARD: ScorecardTemplate = {
  recommendedQuestions: [
    'Cuéntame de una vez que atendiste a un cliente difícil. ¿Qué pasó y cómo lo resolviste?',
    '¿Qué haces cuando un cliente tiene razón, pero te habla mal?',
    '¿Qué significa para ti dar un excelente servicio?',
    'Háblame de una ocasión en la que un supervisor te corrigió. ¿Cómo reaccionaste?',
    '¿Cómo te manejas trabajando con normas, políticas o procesos definidos?',
    'Si no estás de acuerdo con una instrucción, ¿qué haces?',
    '¿Cuál ha sido el trabajo en el que más has durado y por qué?',
    '¿Por qué saliste de tus últimos dos trabajos?',
    '¿Qué tendría que ofrecerte una empresa para que quieras durar mucho tiempo en ella?',
    '¿Qué fue lo último importante que aprendiste en un trabajo?',
    '¿Qué haces cuando cometes un error?',
    '¿En qué aspecto te gustaría mejorar más dentro del trabajo?',
  ],
  positiveSignals: ['Sonrisa natural', 'Tono amable', 'Empatía genuina', 'Seguridad sin arrogancia', 'Respeto', 'Facilidad para aprender', 'Interés real en el trabajo', 'Madurez emocional'],
  redFlags: ['Habla mal de todos sus jefes', 'Se contradice mucho', 'Culpa siempre a otros', 'Poca paciencia', 'Arrogancia', 'Actitud conflictiva', 'Poca estabilidad', 'Resistencia a correcciones', 'Respuestas vacías o muy ensayadas', 'Baja energía o apatía'],
  metrics: ['Puntualidad', 'Presentación personal', 'Contacto visual', 'Claridad al hablar', 'Energía', 'Cortesía y escucha activa'],
};

/** Metric sliders store 10–50 (shown as 1.0–5.0); an untouched metric sits at 3.0. */
export const METRIC_DEFAULT_VALUE = 30;

export const QUESTION_MAX_LENGTH = 300;
export const ANSWER_MAX_LENGTH = 3000;
/** Hard ceiling on described answers per interview (keeps the doc and the AI prompt bounded). */
export const MAX_INTERVIEW_ANSWERS = 60;

const stringList = (v: unknown, fallback: string[]): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : fallback;

/**
 * The scorecard template from the settings doc, field by field: a doc that only saved one
 * list (e.g. the question bank edited from the interview modal) keeps the defaults for
 * the rest. An intentionally EMPTY list stays empty — only a missing one falls back.
 */
export function resolveScorecardTemplate(raw: any): ScorecardTemplate {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    recommendedQuestions: stringList(r.recommendedQuestions, DEFAULT_SCORECARD.recommendedQuestions),
    positiveSignals: stringList(r.positiveSignals, DEFAULT_SCORECARD.positiveSignals),
    redFlags: stringList(r.redFlags, DEFAULT_SCORECARD.redFlags),
    metrics: stringList(r.metrics, DEFAULT_SCORECARD.metrics),
  };
}

/** One question the interviewer chose to describe the candidate's answer to. */
export interface InterviewAnswer {
  question: string;
  answer: string;
}

export interface InterviewScorecardData {
  positiveSignals: string[];
  redFlags: string[];
  metrics: Record<string, number>;
  answers: InterviewAnswer[];
}

/** A fresh scorecard, so one candidate's evaluation NEVER bleeds into another's. */
export function blankScorecard(template: ScorecardTemplate): InterviewScorecardData {
  const metrics: Record<string, number> = {};
  template.metrics.forEach(m => { metrics[m] = METRIC_DEFAULT_VALUE; });
  return { positiveSignals: [], redFlags: [], metrics, answers: [] };
}

/** Saved answers in a trustworthy shape (older scorecards have none at all). */
export function sanitizeAnswers(raw: unknown): InterviewAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a: any) => a && typeof a.question === 'string')
    .map((a: any) => ({ question: a.question, answer: typeof a.answer === 'string' ? a.answer : '' }));
}

/** A saved scorecard (or none) as the editable shape the modal works with. */
export function loadScorecard(saved: any, template: ScorecardTemplate): InterviewScorecardData {
  if (!saved || typeof saved !== 'object') return blankScorecard(template);
  return {
    positiveSignals: stringList(saved.positiveSignals, []),
    redFlags: stringList(saved.redFlags, []),
    metrics: saved.metrics && typeof saved.metrics === 'object' ? { ...saved.metrics } : blankScorecard(template).metrics,
    answers: sanitizeAnswers(saved.answers),
  };
}

/** Trimmed, single-spaced and capped: how a question is stored. */
export function cleanQuestion(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, QUESTION_MAX_LENGTH);
}

/** Identity of a question: case-, accent- and spacing-insensitive, so "¿Que haces…" and
 * "¿Qué haces…" are the same question and never appear twice. */
export function questionKey(text: string): string {
  return cleanQuestion(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export interface QuestionRow {
  question: string;
  /** Part of the shared bank (vs. asked only in this interview). */
  inBank: boolean;
  /** Chosen to describe the candidate's answer — only then does it carry one. */
  selected: boolean;
  answer: string;
}

/**
 * What the modal lists: the bank in its own order, then this interview's extra questions
 * — ones asked only to this candidate, or answered ones that have since left the bank —
 * so an answer never disappears from view just because the bank changed.
 */
export function buildQuestionRows(bank: string[], answers: InterviewAnswer[]): QuestionRow[] {
  const byKey = new Map<string, InterviewAnswer>();
  answers.forEach(a => byKey.set(questionKey(a.question), a));
  const rows: QuestionRow[] = [];
  const seen = new Set<string>();
  for (const q of bank) {
    const k = questionKey(q);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const a = byKey.get(k);
    rows.push({ question: q, inBank: true, selected: !!a, answer: a?.answer || '' });
  }
  for (const a of answers) {
    const k = questionKey(a.question);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    rows.push({ question: a.question, inBank: false, selected: true, answer: a.answer });
  }
  return rows;
}

/** Selects a question for describing the answer (optionally restoring a draft typed
 * earlier in the session) or deselects it — a deselected question carries no answer. */
export function selectQuestion(answers: InterviewAnswer[], question: string, selected: boolean, draft = ''): InterviewAnswer[] {
  const k = questionKey(question);
  const exists = answers.some(a => questionKey(a.question) === k);
  if (selected) {
    return exists ? answers : [...answers, { question: cleanQuestion(question), answer: draft.slice(0, ANSWER_MAX_LENGTH) }];
  }
  return exists ? answers.filter(a => questionKey(a.question) !== k) : answers;
}

export function setAnswerText(answers: InterviewAnswer[], question: string, text: string): InterviewAnswer[] {
  const k = questionKey(question);
  return answers.map(a => (questionKey(a.question) === k ? { ...a, answer: String(text ?? '').slice(0, ANSWER_MAX_LENGTH) } : a));
}

/**
 * Keeps an answer attached to its question when the wording changes. If the new wording
 * already has its own answer here, the two descriptions are merged instead of one
 * silently overwriting the other.
 */
export function renameAnsweredQuestion(answers: InterviewAnswer[], from: string, to: string): InterviewAnswer[] {
  const kf = questionKey(from);
  const newText = cleanQuestion(to);
  const kt = questionKey(newText);
  const source = answers.find(a => questionKey(a.question) === kf);
  if (!source || !kt) return answers;
  if (kt === kf) return answers.map(a => (a === source ? { ...a, question: newText } : a));
  const target = answers.find(a => questionKey(a.question) === kt);
  if (!target) return answers.map(a => (a === source ? { ...a, question: newText } : a));
  const merged = [target.answer, source.answer].map(s => s.trim()).filter(Boolean).join('\n');
  return answers
    .filter(a => a !== source)
    .map(a => (a === target ? { ...a, answer: merged.slice(0, ANSWER_MAX_LENGTH) } : a));
}

/** Drops a question asked only in this interview (bank questions are deselected instead). */
export function removeAnsweredQuestion(answers: InterviewAnswer[], question: string): InterviewAnswer[] {
  const k = questionKey(question);
  return answers.filter(a => questionKey(a.question) !== k);
}

export type QuestionEdit = { answers: InterviewAnswer[] } | { error: string };

/**
 * A question asked only to this candidate. If it is actually a bank question, that one
 * gets selected instead of creating a near-duplicate.
 */
export function addInterviewQuestion(bank: string[], answers: InterviewAnswer[], text: string): QuestionEdit {
  const q = cleanQuestion(text);
  const k = questionKey(q);
  if (!k) return { error: 'Escribe la pregunta.' };
  if (answers.some(a => questionKey(a.question) === k)) return { error: 'Esa pregunta ya está en esta entrevista.' };
  const inBank = bank.find(b => questionKey(b) === k);
  return { answers: [...answers, { question: inBank || q, answer: '' }] };
}

export type BankEdit = { bank: string[] } | { error: string };

export function addToBank(bank: string[], text: string): BankEdit {
  const q = cleanQuestion(text);
  const k = questionKey(q);
  if (!k) return { error: 'Escribe la pregunta.' };
  if (bank.some(b => questionKey(b) === k)) return { error: 'Esa pregunta ya está en el banco.' };
  return { bank: [...bank, q] };
}

/**
 * Rewords a bank question in place. Applied to the CURRENT bank inside a transaction, so
 * if a colleague removed the original meanwhile, the new wording is appended instead of
 * being lost.
 */
export function renameInBank(bank: string[], from: string, to: string): BankEdit {
  const q = cleanQuestion(to);
  const kt = questionKey(q);
  if (!kt) return { error: 'La pregunta no puede quedar vacía.' };
  const kf = questionKey(from);
  if (kt !== kf && bank.some(b => questionKey(b) === kt)) return { error: 'Esa pregunta ya está en el banco.' };
  const idx = bank.findIndex(b => questionKey(b) === kf);
  if (idx === -1) return { bank: [...bank, q] };
  const next = [...bank];
  next[idx] = q;
  return { bank: next };
}

export function removeFromBank(bank: string[], text: string): string[] {
  const k = questionKey(text);
  return bank.filter(b => questionKey(b) !== k);
}

/** What gets stored: trimmed, capped, one entry per question (the first, as listed on
 * screen). Selected-but-empty entries are kept — the selection itself is the
 * interviewer's choice — and the AI only reads the ones with text (answeredOnly). */
export function answersForSave(answers: InterviewAnswer[]): InterviewAnswer[] {
  const seen = new Set<string>();
  const out: InterviewAnswer[] = [];
  for (const a of answers) {
    const question = cleanQuestion(a.question);
    const k = questionKey(question);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ question, answer: String(a.answer ?? '').trim().slice(0, ANSWER_MAX_LENGTH) });
  }
  return out.slice(0, MAX_INTERVIEW_ANSWERS);
}

/** Answers the interviewer actually described. */
export function answeredOnly(answers: InterviewAnswer[] | undefined | null): InterviewAnswer[] {
  return sanitizeAnswers(answers).filter(a => a.answer.trim() && cleanQuestion(a.question));
}

/**
 * Is there anything for the AI to analyze? A described answer, a marked signal or red
 * flag, a metric moved off its starting 3.0, or the interviewer's own 1–5 rating /
 * comments. An untouched scorecard saved as-is is NOT evidence — analyzing it would
 * produce a confident-sounding verdict out of nothing.
 */
export function hasInterviewEvidence(scorecard: any, observation?: any): boolean {
  const s = scorecard && typeof scorecard === 'object' ? scorecard : {};
  if (answeredOnly(s.answers).length > 0) return true;
  if (stringList(s.positiveSignals, []).length > 0 || stringList(s.redFlags, []).length > 0) return true;
  const metrics = s.metrics && typeof s.metrics === 'object' ? Object.values(s.metrics) : [];
  if (metrics.some(v => typeof v === 'number' && v !== METRIC_DEFAULT_VALUE)) return true;
  const o = observation && typeof observation === 'object' ? observation : {};
  return Number(o.score) > 0 || (typeof o.notes === 'string' && o.notes.trim().length > 0);
}
