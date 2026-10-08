import { masterTestQuestions } from '../data/testQuestions';

/**
 * Tests presenciales por posición.
 *
 * Cada vacante elige qué test presencial se aplica a sus candidatos: el "Test Presencial"
 * general (el de siempre) o uno creado para esa posición (técnicos, caja, redes…). Un test
 * no es solo una lista de preguntas: también dice qué debe evaluar la IA en ellas (perfil
 * buscado + criterios con su peso), porque calificar a un técnico con los criterios de un
 * vendedor daría puntajes sin sentido.
 *
 * Los tests viven en la colección `test_templates`, que solo el equipo puede leer: las
 * respuestas esperadas son privadas. El servidor resuelve el test de cada postulación y se
 * lo sirve al candidato sin lo privado.
 *
 * Lógica pura, compartida por el servidor y el panel — fijada por testTemplates.test.ts.
 */

export type TestQuestionType = 'text' | 'textarea' | 'multiple_choice' | 'scale' | 'multiple_selection';

export interface TestQuestion {
  id: string;
  text: string;
  type: TestQuestionType;
  options?: string[];
  /** Section the question belongs to (e.g. "Bloque A. Lógica…"). Context for the AI. */
  block?: string;
  /** PRIVATE: the correct answer or grading criterion. Only the team and the AI see it —
   * it is stripped from everything served to the candidate. */
  expectedAnswer?: string;
}

export interface TestDimension {
  id: string;
  name: string;
  /** Maximum points for this criterion. The weights of a test add up to 100. */
  weight: number;
  description?: string;
}

export interface TestTemplate {
  id: string;
  name: string;
  /** Internal note: what the test is for / which positions use it. */
  description?: string;
  /** Shown to the candidate before starting. */
  instructions?: string;
  /** "Perfil buscado": what the AI should look for in this position. */
  profile?: string;
  dimensions: TestDimension[];
  questions: TestQuestion[];
  /** "Deleted" tests are archived, never erased: past results still point to them. */
  archived?: boolean;
}

/** What the candidate's page receives: no expected answers, no sections. */
export type PublicTestQuestion = Pick<TestQuestion, 'id' | 'text' | 'type' | 'options'>;

export const TEST_TEMPLATES_COLLECTION = 'test_templates';

/** The general test. Fixed id: vacancies without a chosen test (all the ones created
 * before tests per position existed) use it, and it can't be deleted. */
export const DEFAULT_TEST_ID = 'default';

/** Upper bound of questions per test: everything the candidate answers must reach the AI. */
export const MAX_TEST_QUESTIONS = 120;
export const MAX_QUESTION_TEXT = 500;

export const QUESTION_TYPES: TestQuestionType[] = ['text', 'textarea', 'multiple_choice', 'multiple_selection', 'scale'];

export const QUESTION_TYPE_LABELS: Record<TestQuestionType, string> = {
  text: 'Texto corto',
  textarea: 'Texto largo (Párrafo)',
  multiple_choice: 'Opción múltiple',
  multiple_selection: 'Selección múltiple (Casillas)',
  scale: 'Escala (1 al 5)',
};

const isChoice = (type: TestQuestionType) => type === 'multiple_choice' || type === 'multiple_selection';

// ---------------------------------------------------------------------------
// The general test (the one every vacancy used until now)
// ---------------------------------------------------------------------------

export const DEFAULT_TEST_NAME = 'Test Presencial';
export const DEFAULT_TEST_DESCRIPTION =
  'Test general de juicio situacional: lógica, servicio al cliente, actitudes laborales e integridad. Úsalo como base para crear el test de cada posición.';
export const DEFAULT_TEST_INSTRUCTIONS =
  'No hay respuestas correctas o incorrectas; responde con honestidad lo que harías o piensas en cada situación.';
export const DEFAULT_TEST_PROFILE =
  'Buscamos personas cooperativas, entrenables, receptivas al feedback, que respeten los procesos, estables emocionalmente, orientadas al servicio, responsables y con deseo real de mejorar. NO buscamos perfiles "sumisos", sino colaboradores maduros.';

/** The six criteria the test has always been graded on. Their ids are the prefixes of
 * the score fields stored by older versions (customer_service_score…). */
export const DEFAULT_TEST_DIMENSIONS: TestDimension[] = [
  { id: 'customer_service', name: 'Servicio al cliente', weight: 20, description: 'Empatía, trato, paciencia, orientación a ayudar.' },
  { id: 'practical_intelligence', name: 'Inteligencia práctica', weight: 20, description: 'Comprensión, lógica, criterio, rapidez mental (evaluado principalmente en el Bloque A).' },
  { id: 'behavioral_fit', name: 'Ajuste conductual', weight: 20, description: 'Disciplina, cooperación, reacción a correcciones.' },
  { id: 'stability_responsibility', name: 'Estabilidad y responsabilidad', weight: 20, description: 'Madurez, permanencia, sentido de responsabilidad.' },
  { id: 'improvement_desire', name: 'Deseo de mejora', weight: 10, description: 'Aprendizaje, apertura al feedback, crecimiento.' },
  { id: 'orthography', name: 'Ortografía y redacción', weight: 10, description: 'Letras y signos de puntuación correctos (no se penalizan tildes ni mayúsculas iniciales).' },
];

/** Starting point of a brand-new test: generic criteria the team adapts to the position. */
export const BLANK_TEST_DIMENSIONS: TestDimension[] = [
  { id: 'job_knowledge', name: 'Conocimientos del puesto', weight: 40, description: 'Domina los temas propios de la posición; respuestas correctas y precisas.' },
  { id: 'problem_solving', name: 'Criterio y resolución de problemas', weight: 30, description: 'Lógica, sentido común y capacidad de resolver situaciones reales del puesto.' },
  { id: 'attitude', name: 'Actitud y responsabilidad', weight: 20, description: 'Disposición, honestidad, trato con los demás y sentido de responsabilidad.' },
  { id: 'orthography', name: 'Ortografía y redacción', weight: 10, description: 'Letras y signos de puntuación correctos (no se penalizan tildes ni mayúsculas iniciales).' },
];
export const BLANK_TEST_INSTRUCTIONS =
  'Lee con calma cada pregunta y responde con tus propias palabras. Si no sabes algo, dilo con honestidad: es mejor que inventar.';

/** Last resort when a stored test has no usable criteria. */
const GENERAL_DIMENSION: TestDimension = {
  id: 'general', name: 'Desempeño general', weight: 100, description: 'Qué tan bien responde según el perfil buscado para el puesto.',
};

const masterById = new Map(masterTestQuestions.map(q => [q.id, q]));

/**
 * The questions every vacancy used before tests per position: the ones the team saved in
 * settings/forms (if they customized them) or the bundled master set. Saved sets from an
 * older format (ids C1… / q1…) are ignored, exactly as before.
 */
export function legacyTestQuestions(formsSettings: any): TestQuestion[] {
  const custom = formsSettings?.testQuestions;
  const useCustom = Array.isArray(custom) && custom.length > 0
    && !custom.some((q: any) => q?.id === 'C1' || q?.id === 'q1');
  // The old editor dropped each question's section; recover it from the master set.
  const source = useCustom
    ? custom.map((q: any) => ({ ...q, block: q?.block || masterById.get(q?.id)?.block }))
    : masterTestQuestions;
  return normalizeQuestions(source);
}

/** The general test as it was before tests per position existed. */
export function buildDefaultTestTemplate(formsSettings?: any): TestTemplate {
  return {
    id: DEFAULT_TEST_ID,
    name: DEFAULT_TEST_NAME,
    description: DEFAULT_TEST_DESCRIPTION,
    instructions: DEFAULT_TEST_INSTRUCTIONS,
    profile: DEFAULT_TEST_PROFILE,
    dimensions: DEFAULT_TEST_DIMENSIONS.map(d => ({ ...d })),
    questions: legacyTestQuestions(formsSettings),
  };
}

const randomId = () => Math.random().toString(36).slice(2, 11);
export const newQuestionId = () => `q_${randomId()}`;
export const newDimensionId = () => `dim_${randomId()}`;

/** An empty test for a new position (saved under a new id by the caller). */
export function blankTestTemplate(): TestTemplate {
  return {
    id: '',
    name: '',
    description: '',
    instructions: BLANK_TEST_INSTRUCTIONS,
    profile: '',
    dimensions: BLANK_TEST_DIMENSIONS.map(d => ({ ...d })),
    questions: [{ id: newQuestionId(), text: '', type: 'textarea' }],
  };
}

/** A copy to adapt for another position. Question ids are kept on purpose: the general
 * test's memory question is recognized by its id. */
export function duplicateTestTemplate(t: TestTemplate): TestTemplate {
  const { archived: _archived, ...rest } = t;
  return {
    ...rest,
    id: '',
    name: `${t.name} (copia)`,
    dimensions: t.dimensions.map(d => ({ ...d })),
    questions: t.questions.map(q => ({ ...q, options: q.options ? [...q.options] : undefined })),
  };
}

// ---------------------------------------------------------------------------
// Normalization (whatever is stored → a shape that can't break the candidate's page)
// ---------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Cleans a stored question list. A question nobody could answer would block the candidate
 * (the "Siguiente" button waits for an answer), so: questions without text are dropped and
 * a choice question without options becomes a text question. Missing or repeated ids get a
 * deterministic replacement — the page and the grader normalize the same stored list, so
 * both must arrive at the same ids.
 */
export function normalizeQuestions(raw: unknown): TestQuestion[] {
  if (!Array.isArray(raw)) return [];
  const usedIds = new Set<string>();
  const out: TestQuestion[] = [];
  raw.forEach((r: any, index) => {
    if (!r || typeof r !== 'object') return;
    const text = str(r.text).slice(0, 1000);
    if (!text) return;
    let id = str(r.id).slice(0, 100);
    if (!id || usedIds.has(id)) {
      let n = index + 1;
      id = `q${n}`;
      while (usedIds.has(id)) id = `q${++n}`;
    }
    usedIds.add(id);
    const q: TestQuestion = { id, text, type: QUESTION_TYPES.includes(r.type) ? r.type : 'text' };
    if (isChoice(q.type)) {
      const options = Array.isArray(r.options)
        ? Array.from(new Set<string>(r.options.map((o: unknown) => (typeof o === 'number' ? String(o) : str(o))).filter(Boolean)))
        : [];
      if (options.length === 0) q.type = 'text';
      else q.options = options;
    }
    const block = str(r.block);
    if (block) q.block = block;
    const expected = str(r.expectedAnswer);
    if (expected) q.expectedAnswer = expected;
    out.push(q);
  });
  return out;
}

const DIMENSION_ID_RE = /^[a-z0-9_]{1,40}$/;

/** Cleans stored criteria: each needs a name and a positive weight; ids must be safe to
 * use as keys of the AI's answer (anything else is replaced deterministically). */
export function normalizeDimensions(raw: unknown): TestDimension[] {
  if (!Array.isArray(raw)) return [];
  const usedIds = new Set<string>();
  const out: TestDimension[] = [];
  raw.forEach((r: any, index) => {
    if (!r || typeof r !== 'object') return;
    const name = str(r.name).slice(0, 80);
    const weight = Math.round(Number(r.weight));
    if (!name || !Number.isFinite(weight) || weight <= 0) return;
    let id = typeof r.id === 'string' && DIMENSION_ID_RE.test(r.id) ? r.id : '';
    if (!id || usedIds.has(id)) {
      let n = index + 1;
      id = `dim${n}`;
      while (usedIds.has(id)) id = `dim${++n}`;
    }
    usedIds.add(id);
    const d: TestDimension = { id, name, weight: Math.min(weight, 100) };
    const description = str(r.description).slice(0, 500);
    if (description) d.description = description;
    out.push(d);
  });
  return out;
}

/** A stored test (Firestore doc data) → a usable test. */
export function normalizeTestTemplate(raw: any, id: string): TestTemplate {
  const isDefault = id === DEFAULT_TEST_ID;
  const dimensions = normalizeDimensions(raw?.dimensions);
  const t: TestTemplate = {
    id,
    name: str(raw?.name).slice(0, 120) || (isDefault ? DEFAULT_TEST_NAME : 'Test sin nombre'),
    description: str(raw?.description),
    instructions: str(raw?.instructions),
    profile: str(raw?.profile),
    dimensions: dimensions.length > 0
      ? dimensions
      : isDefault ? DEFAULT_TEST_DIMENSIONS.map(d => ({ ...d })) : [{ ...GENERAL_DIMENSION }],
    questions: normalizeQuestions(raw?.questions),
  };
  if (raw?.archived === true) t.archived = true;
  return t;
}

/** The plain object saved to Firestore (no `undefined`, which Firestore rejects). */
export function toTestTemplateDoc(t: TestTemplate): Record<string, any> {
  return {
    name: t.name.trim(),
    description: (t.description || '').trim(),
    instructions: (t.instructions || '').trim(),
    profile: (t.profile || '').trim(),
    dimensions: t.dimensions.map(d => ({
      id: d.id,
      name: d.name.trim(),
      weight: d.weight,
      description: (d.description || '').trim(),
    })),
    questions: t.questions.map(q => {
      const doc: Record<string, any> = { id: q.id, text: q.text.trim(), type: q.type };
      if (isChoice(q.type)) doc.options = (q.options || []).map(o => o.trim()).filter(Boolean);
      if (q.block?.trim()) doc.block = q.block.trim();
      if (q.expectedAnswer?.trim()) doc.expectedAnswer = q.expectedAnswer.trim();
      return doc;
    }),
  };
}

// ---------------------------------------------------------------------------
// Validation (what the editor checks before saving)
// ---------------------------------------------------------------------------

export const dimensionWeightTotal = (dimensions: TestDimension[] | undefined) =>
  (dimensions || []).reduce((sum, d) => sum + (Number(d.weight) || 0), 0);

/** Every problem that would make the test unusable or its grading meaningless, in words
 * the recruiter can act on. Empty = ready to save. */
export function validateTestTemplate(t: Pick<TestTemplate, 'name' | 'questions' | 'dimensions'>): string[] {
  const errors: string[] = [];
  const questions = t.questions || [];
  const dimensions = t.dimensions || [];

  if (!str(t.name)) errors.push('Ponle un nombre al test.');

  if (questions.length === 0) errors.push('El test necesita al menos una pregunta.');
  if (questions.length > MAX_TEST_QUESTIONS) {
    errors.push(`Un test admite hasta ${MAX_TEST_QUESTIONS} preguntas (este tiene ${questions.length}).`);
  }
  const firstWithText = new Map<string, number>();
  questions.forEach((q, i) => {
    const n = i + 1;
    const text = str(q.text);
    if (!text) { errors.push(`La pregunta ${n} no tiene texto.`); return; }
    if (text.length > MAX_QUESTION_TEXT) {
      errors.push(`La pregunta ${n} es demasiado larga (máximo ${MAX_QUESTION_TEXT} caracteres).`);
    }
    // Answers are stored under the question's text: two equal texts would overwrite each other.
    const key = text.toLowerCase();
    if (firstWithText.has(key)) errors.push(`Las preguntas ${firstWithText.get(key)} y ${n} son iguales; cambia una de las dos.`);
    else firstWithText.set(key, n);
    if (isChoice(q.type)) {
      const raw = q.options || [];
      const options = raw.map(o => str(o));
      if (options.some(o => !o)) errors.push(`La pregunta ${n} tiene una opción vacía.`);
      const filled = options.filter(Boolean);
      if (filled.length < 2) errors.push(`La pregunta ${n} necesita al menos 2 opciones de respuesta.`);
      else if (new Set(filled.map(o => o.toLowerCase())).size !== filled.length) {
        errors.push(`La pregunta ${n} tiene opciones repetidas.`);
      }
    }
  });

  if (dimensions.length === 0) errors.push('Agrega al menos un criterio para que la IA sepa qué evaluar.');
  dimensions.forEach((d, i) => {
    if (!str(d.name)) errors.push(`El criterio ${i + 1} no tiene nombre.`);
    if (!Number.isInteger(d.weight) || d.weight <= 0) errors.push(`El criterio ${i + 1} necesita un peso entero mayor que 0.`);
  });
  const total = dimensionWeightTotal(dimensions);
  if (dimensions.length > 0 && total !== 100) errors.push(`Los pesos de los criterios suman ${total}; deben sumar 100.`);

  return errors;
}

// ---------------------------------------------------------------------------
// Which test applies, and what the candidate may see
// ---------------------------------------------------------------------------

const isDocId = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200 && !v.includes('/');

/** The test a vacancy applies. Vacancies that never chose one use the general test. */
export function vacancyTestId(vacancy: any): string {
  return isDocId(vacancy?.testTemplateId) ? vacancy.testTemplateId : DEFAULT_TEST_ID;
}

/**
 * Ids to try, in order, when loading the test of a postulación: the one the candidate
 * already has in hand (they answered it — grade it, even if the vacancy switched tests
 * meanwhile), the vacancy's test, and the general one. Duplicates and junk removed.
 */
export function testIdCandidates(requestedId: unknown, vacancy: any): string[] {
  const ids = [isDocId(requestedId) ? requestedId : null, vacancyTestId(vacancy), DEFAULT_TEST_ID];
  return Array.from(new Set(ids.filter((id): id is string => !!id)));
}

/** The questions as the candidate gets them: no expected answers, no internal sections. */
export function publicTestQuestions(questions: TestQuestion[]): PublicTestQuestion[] {
  return questions.map(q => {
    const p: PublicTestQuestion = { id: q.id, text: q.text, type: q.type };
    if (q.options) p.options = [...q.options];
    return p;
  });
}

/** General test first, then alphabetical. The general test is listed even before its doc
 * exists (until someone opens Formularios it lives only in code). */
export function sortTestTemplates(list: TestTemplate[]): TestTemplate[] {
  return [...list].sort((a, b) => {
    if (a.id === DEFAULT_TEST_ID) return -1;
    if (b.id === DEFAULT_TEST_ID) return 1;
    return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  });
}

export function withDefaultTest(list: TestTemplate[], formsSettings?: any): TestTemplate[] {
  const hasDefault = list.some(t => t.id === DEFAULT_TEST_ID);
  return sortTestTemplates(hasDefault ? list : [buildDefaultTestTemplate(formsSettings), ...list]);
}

/** The vacancy fields this module reads. */
export interface VacancyRef {
  id: string;
  title?: string;
  testTemplateId?: string;
  [key: string]: any;
}

/** testId → vacancies that apply it (the general test collects those without a choice). */
export function vacanciesByTest<V extends VacancyRef>(vacancies: V[]): Map<string, V[]> {
  const map = new Map<string, V[]>();
  for (const v of vacancies) {
    const id = vacancyTestId(v);
    const list = map.get(id) || [];
    list.push(v);
    map.set(id, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// The candidate's page
// ---------------------------------------------------------------------------

export const MEMORY_WORDS = ['cliente', 'cambio', 'orden', 'llamada', 'factura'];
export const MEMORY_SECONDS = 8;

/** The general test's short-memory item (A11; C11 in an older version): before it the
 * candidate sees MEMORY_WORDS for a few seconds. Recognized by id, so copies of the general
 * test keep it — and by type, so turning that question into something else turns it off. */
export function isMemoryQuestion(q: Pick<TestQuestion, 'id' | 'type'> | null | undefined): boolean {
  return !!q && (q.id === 'A11' || q.id === 'C11') && q.type === 'multiple_selection';
}

// ---------------------------------------------------------------------------
// Answers and results
// ---------------------------------------------------------------------------

export interface QaPair {
  id: string;
  text: string;
  block?: string;
  expectedAnswer?: string;
  /** As submitted: a string, or a list for multiple selection. */
  answer: unknown;
}

export const hasAnswer = (v: unknown): boolean =>
  v !== undefined && v !== null
  && !(typeof v === 'string' && v.trim() === '')
  && !(Array.isArray(v) && v.length === 0);

export function answerToText(v: unknown): string {
  if (Array.isArray(v)) return v.map(x => String(x)).join(', ');
  if (v === undefined || v === null) return '';
  return String(v);
}

/**
 * Pairs the test's questions with the candidate's answers, in the test's order. Answers
 * arrive keyed by question id (a fresh submission) or by question text (results saved
 * earlier, being re-evaluated). Questions without an answer are left out: the page doesn't
 * let anyone skip one, so an unanswered question is one the candidate never saw (added
 * while they were answering) and must not count against them. An answer whose question
 * left the test meanwhile is kept, labelled with the text the candidate saw.
 */
export function pairTestAnswers(
  questions: TestQuestion[],
  answers: Record<string, unknown>,
  clientQuestions?: unknown,
): QaPair[] {
  const own = (k: string) => Object.prototype.hasOwnProperty.call(answers, k) && hasAnswer(answers[k]);
  const used = new Set<string>();
  const pairs: QaPair[] = [];
  for (const q of questions) {
    const key = own(q.id) ? q.id : own(q.text) ? q.text : null;
    if (key === null) continue;
    used.add(key);
    const pair: QaPair = { id: q.id, text: q.text, answer: answers[key] };
    if (q.block) pair.block = q.block;
    if (q.expectedAnswer) pair.expectedAnswer = q.expectedAnswer;
    pairs.push(pair);
  }
  const seenText = new Map<string, string>();
  if (Array.isArray(clientQuestions)) {
    for (const c of clientQuestions as any[]) {
      if (c && typeof c.id === 'string' && typeof c.text === 'string' && c.text.trim()) {
        seenText.set(c.id, c.text.trim().slice(0, 1000));
      }
    }
  }
  for (const key of Object.keys(answers)) {
    if (used.has(key) || !hasAnswer(answers[key])) continue;
    pairs.push({ id: key, text: seenText.get(key) || key, answer: answers[key] });
  }
  return pairs;
}

export interface DimensionScore {
  id: string;
  name: string;
  /** null when the AI didn't grade it. */
  score: number | null;
  max: number;
}

/** Score fields written before tests per position (the general test's six criteria). */
const LEGACY_SCORE_FIELDS: Array<{ id: string; field: string; name: string; max: number }> = [
  { id: 'customer_service', field: 'customer_service_score', name: 'Servicio al cliente', max: 20 },
  { id: 'practical_intelligence', field: 'practical_intelligence_score', name: 'Inteligencia práctica', max: 20 },
  { id: 'behavioral_fit', field: 'behavioral_fit_score', name: 'Ajuste conductual', max: 20 },
  { id: 'stability_responsibility', field: 'stability_responsibility_score', name: 'Estabilidad y responsabilidad', max: 20 },
  { id: 'improvement_desire', field: 'improvement_desire_score', name: 'Deseo de mejora', max: 10 },
  { id: 'orthography', field: 'orthography_score', name: 'Ortografía y redacción', max: 10 },
];

const finiteOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The per-criterion scores of a result, whatever version wrote it. */
export function testDimensionScores(testResults: any): DimensionScore[] {
  if (!testResults || typeof testResults !== 'object') return [];
  if (Array.isArray(testResults.dimensionScores)) {
    return testResults.dimensionScores
      .filter((d: any) => d && typeof d.name === 'string' && d.name.trim())
      .map((d: any) => ({
        id: String(d.id ?? d.name),
        name: d.name,
        score: finiteOrNull(d.score),
        max: Number(d.max) || 0,
      }));
  }
  return LEGACY_SCORE_FIELDS
    .filter(l => finiteOrNull(testResults[l.field]) !== null)
    .map(l => ({ id: l.id, name: l.name, score: finiteOrNull(testResults[l.field]), max: l.max }));
}
