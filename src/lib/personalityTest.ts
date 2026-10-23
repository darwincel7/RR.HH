/**
 * Test de Personalidad (presencial).
 *
 * La entrevistadora lo aplica cuando lo decide —en la entrevista, desde el perfil del
 * candidato—, no lo dispara ninguna etapa del embudo. Dos datos distintos viven aquí y no
 * se pueden confundir:
 *  - la PLANTILLA (settings/forms → personalityTest): nombre, instrucciones, rasgos y
 *    preguntas, editable por cualquier reclutador desde Formularios;
 *  - la APLICACIÓN (applications/{id} → personalityTest): una COPIA de la plantilla tomada
 *    en el momento de aplicarlo, más las respuestas y el resultado. Editar o borrar una
 *    pregunta después nunca cambia ni borra lo que alguien ya respondió, y el resultado se
 *    calcula siempre contra las preguntas que esa persona vio.
 *
 * El modelo por defecto son los Cinco Grandes rasgos (Big Five), adaptados al trabajo de
 * atención al cliente. Las preguntas de escala suman al rasgo que tengan asignado; las
 * "invertidas" restan (estar de acuerdo con "Me pongo de mal humor con facilidad" baja la
 * estabilidad emocional). Las de opción múltiple y las abiertas no puntúan: se muestran a
 * la entrevistadora y las lee la IA.
 *
 * Este módulo es PURO (sin Firestore): lo usan igual el editor, la pantalla del candidato,
 * el perfil y el servidor, que es quien calcula y guarda el resultado.
 */

export type PersonalityQuestionType = 'likert' | 'choice' | 'text';

export interface PersonalityDimension {
  id: string;
  name: string;
  /** Qué mide, en una frase (lo ve la entrevistadora, nunca el candidato). */
  description: string;
  /** Cómo leer un resultado alto / bajo. */
  high: string;
  low: string;
}

export interface PersonalityQuestion {
  id: string;
  text: string;
  type: PersonalityQuestionType;
  /** Solo escala: el rasgo al que suma. Sin rasgo, la respuesta se guarda pero no puntúa. */
  dimensionId?: string;
  /** Solo escala: estar de acuerdo RESTA al rasgo. */
  reverse?: boolean;
  /** Solo opción múltiple. */
  options?: string[];
}

export interface PersonalityTemplate {
  name: string;
  instructions: string;
  dimensions: PersonalityDimension[];
  questions: PersonalityQuestion[];
}

export const QUESTION_TYPE_LABEL: Record<PersonalityQuestionType, string> = {
  likert: 'Escala de acuerdo (1 a 5)',
  choice: 'Opción múltiple',
  text: 'Respuesta abierta',
};

/** Las cinco opciones de la escala, de 1 a 5. */
export const LIKERT_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Totalmente en desacuerdo' },
  { value: 2, label: 'En desacuerdo' },
  { value: 3, label: 'Ni de acuerdo ni en desacuerdo' },
  { value: 4, label: 'De acuerdo' },
  { value: 5, label: 'Totalmente de acuerdo' },
];

export const NAME_MAX_LENGTH = 120;
export const INSTRUCTIONS_MAX_LENGTH = 1500;
export const DIMENSION_NAME_MAX_LENGTH = 80;
export const DIMENSION_TEXT_MAX_LENGTH = 500;
export const QUESTION_MAX_LENGTH = 400;
export const OPTION_MAX_LENGTH = 200;
export const MAX_OPTIONS = 10;
export const MAX_DIMENSIONS = 12;
export const MAX_QUESTIONS = 120;
export const TEXT_ANSWER_MAX_LENGTH = 2000;

const dim = (id: string, name: string, description: string, high: string, low: string): PersonalityDimension =>
  ({ id, name, description, high, low });
const likert = (id: string, dimensionId: string, text: string, reverse = false): PersonalityQuestion =>
  (reverse ? { id, text, type: 'likert', dimensionId, reverse: true } : { id, text, type: 'likert', dimensionId });

/**
 * El test recomendado: 5 rasgos × 5 frases (2 invertidas por rasgo, para detectar a quien
 * marca "de acuerdo" a todo), intercaladas para que las del mismo rasgo no vayan seguidas,
 * y al final 2 de opción múltiple y 2 abiertas. Unos 10 minutos.
 */
export const DEFAULT_PERSONALITY_TEST: PersonalityTemplate = {
  name: 'Test de Personalidad',
  instructions: 'No hay respuestas buenas ni malas. Lee cada frase y marca qué tan de acuerdo estás según cómo eres normalmente, no cómo te gustaría ser. Responde con sinceridad; toma unos 10 minutos.',
  dimensions: [
    dim('sociabilidad', 'Sociabilidad (Extroversión)',
      'Energía en el trato con la gente: iniciativa para hablar, comodidad con desconocidos y entusiasmo.',
      'Se siente a gusto tratando con clientes y desconocidos, toma la iniciativa y transmite energía. Encaja bien en ventas y atención al público.',
      'Prefiere ambientes tranquilos y con menos trato con la gente; puede necesitar tiempo para soltarse con clientes nuevos.'),
    dim('amabilidad', 'Amabilidad (Empatía y cooperación)',
      'Trato cálido, paciencia, disposición a ayudar y a cooperar con el equipo.',
      'Trato cálido y paciente; coopera y busca acuerdos. A explorar: si le cuesta poner límites o decir que no.',
      'Trato más directo o competitivo; puede chocar con compañeros o clientes difíciles. Conviene explorar cómo maneja los conflictos.'),
    dim('responsabilidad', 'Responsabilidad (Orden y compromiso)',
      'Organización, cumplimiento de normas y horarios, constancia y cuidado de los detalles.',
      'Organizada, puntual y constante; cumple los procesos y termina lo que empieza.',
      'Puede costarle el orden, la puntualidad o seguir procesos; conviene validar referencias y dar seguimiento cercano al inicio.'),
    dim('estabilidad', 'Estabilidad emocional',
      'Calma bajo presión y manejo de la frustración y de las críticas.',
      'Mantiene la calma bajo presión y con clientes molestos, y se recupera rápido de un error o una corrección.',
      'Puede afectarle la presión, las críticas o los clientes difíciles; conviene explorar cómo maneja el estrés.'),
    dim('apertura', 'Apertura (Aprendizaje y cambio)',
      'Curiosidad, gusto por aprender cosas nuevas y adaptación a los cambios.',
      'Curiosa y con ganas de aprender; se adapta rápido a productos, sistemas o procesos nuevos.',
      'Prefiere lo conocido y las rutinas; puede costarle adaptarse a cambios frecuentes.'),
  ],
  questions: [
    likert('S1', 'sociabilidad', 'Me resulta fácil iniciar una conversación con alguien que no conozco.'),
    likert('A1', 'amabilidad', 'Me pongo en el lugar de los demás antes de juzgarlos.'),
    likert('R1', 'responsabilidad', 'Termino lo que empiezo, aunque se ponga difícil.'),
    likert('E1', 'estabilidad', 'Mantengo la calma cuando un cliente está molesto.'),
    likert('O1', 'apertura', 'Me gusta aprender cosas nuevas, aunque no me lo pidan.'),
    likert('S2', 'sociabilidad', 'Disfruto los lugares con mucho movimiento y mucha gente.'),
    likert('A2', 'amabilidad', 'Si un compañero necesita ayuda, se la doy aunque no sea mi tarea.'),
    likert('R2', 'responsabilidad', 'Llego a tiempo a mis compromisos.'),
    likert('E2', 'estabilidad', 'Me pongo de mal humor con facilidad.', true),
    likert('O2', 'apertura', 'Me adapto rápido cuando cambia la forma de hacer las cosas.'),
    likert('S3', 'sociabilidad', 'Prefiero trabajar sin tener que hablar con muchas personas.', true),
    likert('A3', 'amabilidad', 'Cuando alguien me habla mal, le respondo de la misma forma.', true),
    likert('R3', 'responsabilidad', 'Con frecuencia dejo las cosas para última hora.', true),
    likert('E3', 'estabilidad', 'Cuando me corrigen, lo tomo como una oportunidad para mejorar y no como un ataque.'),
    likert('O3', 'apertura', 'Prefiero hacer las cosas siempre de la misma manera.', true),
    likert('S4', 'sociabilidad', 'En un grupo, suelo ser quien anima o propone las cosas.'),
    likert('A4', 'amabilidad', 'Tengo paciencia con las personas que tardan en entender algo.'),
    likert('R4', 'responsabilidad', 'Sigo las normas y los procesos aunque nadie me esté supervisando.'),
    likert('E4', 'estabilidad', 'Me preocupo demasiado por cosas que todavía no han pasado.', true),
    likert('O4', 'apertura', 'Me interesa entender cómo funcionan las cosas, por ejemplo la tecnología.'),
    likert('S5', 'sociabilidad', 'Me cuesta acercarme a un cliente si no me habla primero.', true),
    likert('A5', 'amabilidad', 'Me cuesta reconocer que otra persona tiene la razón.', true),
    likert('R5', 'responsabilidad', 'Se me olvidan con facilidad las tareas que me encargan.', true),
    likert('E5', 'estabilidad', 'Bajo presión sigo pensando con claridad.'),
    likert('O5', 'apertura', 'Me incomoda que me pidan usar un sistema o una herramienta nueva.', true),
    {
      id: 'C1', type: 'choice',
      text: 'Cuando tengo un problema en el trabajo, lo primero que hago es…',
      options: ['Intento resolverlo por mi cuenta', 'Le pregunto a un compañero', 'Le aviso a mi supervisor', 'Espero a ver si se resuelve solo'],
    },
    {
      id: 'C2', type: 'choice',
      text: '¿En qué ambiente trabajas mejor?',
      options: ['Con mucha gente y mucho movimiento', 'En un equipo pequeño', 'Con tranquilidad y por mi cuenta', 'Me adapto a cualquiera'],
    },
    { id: 'T1', type: 'text', text: 'Si le preguntáramos a tu último jefe o a un compañero, ¿qué tres palabras usaría para describirte?' },
    { id: 'T2', type: 'text', text: '¿Qué es lo que más te cuesta de trabajar con otras personas y cómo lo manejas?' },
  ],
};

/** Copia profunda: nadie que reciba la plantilla por defecto puede mutar la original. */
export function defaultPersonalityTest(): PersonalityTemplate {
  return JSON.parse(JSON.stringify(DEFAULT_PERSONALITY_TEST));
}

const clean = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** Como clean, pero respeta los saltos de línea (instrucciones, respuestas abiertas). */
const cleanMultiline = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
const cleanId = (v: unknown): string => clean(v, 60).replace(/[^\w-]/g, '');

export function newItemId(prefix = 'p'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeDimension(raw: any): PersonalityDimension | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanId(raw.id);
  if (!id) return null;
  return {
    id,
    name: clean(raw.name, DIMENSION_NAME_MAX_LENGTH),
    description: clean(raw.description, DIMENSION_TEXT_MAX_LENGTH),
    high: clean(raw.high, DIMENSION_TEXT_MAX_LENGTH),
    low: clean(raw.low, DIMENSION_TEXT_MAX_LENGTH),
  };
}

function sanitizeQuestion(raw: any): PersonalityQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanId(raw.id);
  if (!id) return null;
  const type: PersonalityQuestionType = raw.type === 'choice' || raw.type === 'text' ? raw.type : 'likert';
  const q: PersonalityQuestion = { id, text: clean(raw.text, QUESTION_MAX_LENGTH), type };
  if (type === 'likert') {
    const d = cleanId(raw.dimensionId);
    if (d) q.dimensionId = d;
    if (raw.reverse === true) q.reverse = true;
  }
  if (type === 'choice') {
    q.options = Array.isArray(raw.options)
      ? raw.options.map((o: unknown) => clean(o, OPTION_MAX_LENGTH)).slice(0, MAX_OPTIONS)
      : [];
  }
  return q;
}

/** Sin ids repetidos: el primero gana (el id es la clave de la respuesta). */
function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(i => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

/**
 * La plantilla guardada, en una forma confiable. Sin plantilla guardada → la recomendada.
 * Una lista vaciada A PROPÓSITO se respeta (el editor avisa que así no se puede aplicar);
 * solo un campo ausente o roto vuelve al valor por defecto.
 */
export function resolvePersonalityTemplate(raw: any): PersonalityTemplate {
  if (!raw || typeof raw !== 'object') return defaultPersonalityTest();
  const def = defaultPersonalityTest();
  return {
    name: typeof raw.name === 'string' ? clean(raw.name, NAME_MAX_LENGTH) : def.name,
    instructions: typeof raw.instructions === 'string' ? cleanMultiline(raw.instructions, INSTRUCTIONS_MAX_LENGTH) : def.instructions,
    dimensions: Array.isArray(raw.dimensions)
      ? uniqueById(raw.dimensions.map(sanitizeDimension).filter(Boolean) as PersonalityDimension[]).slice(0, MAX_DIMENSIONS)
      : def.dimensions,
    questions: Array.isArray(raw.questions)
      ? uniqueById(raw.questions.map(sanitizeQuestion).filter(Boolean) as PersonalityQuestion[]).slice(0, MAX_QUESTIONS)
      : def.questions,
  };
}

export interface TemplateIssue {
  /** Bloquea guardar (o aplicar). Los avisos solo informan. */
  blocking: boolean;
  message: string;
}

/**
 * Lo que impide usar la plantilla (bloqueante) y lo que conviene revisar (aviso). El editor
 * lo muestra antes de guardar; el perfil no deja aplicar una plantilla con bloqueantes.
 */
export function templateIssues(t: PersonalityTemplate): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const block = (message: string) => issues.push({ blocking: true, message });
  const warn = (message: string) => issues.push({ blocking: false, message });

  if (!clean(t.name, NAME_MAX_LENGTH)) block('El test necesita un nombre.');
  if (t.questions.length === 0) block('El test no tiene preguntas.');
  if (t.questions.length > MAX_QUESTIONS) block(`El test admite como máximo ${MAX_QUESTIONS} preguntas.`);
  if (t.dimensions.length > MAX_DIMENSIONS) block(`El test admite como máximo ${MAX_DIMENSIONS} rasgos.`);

  t.dimensions.forEach((d, i) => {
    if (!clean(d.name, DIMENSION_NAME_MAX_LENGTH)) block(`El rasgo ${i + 1} no tiene nombre.`);
  });
  const dimIds = new Set(t.dimensions.map(d => d.id));

  t.questions.forEach((q, i) => {
    const n = i + 1;
    if (!clean(q.text, QUESTION_MAX_LENGTH)) block(`La pregunta ${n} está vacía.`);
    if (q.type === 'choice') {
      const opts = (q.options || []).map(o => clean(o, OPTION_MAX_LENGTH));
      if (opts.filter(Boolean).length < 2) block(`La pregunta ${n} (opción múltiple) necesita al menos 2 opciones.`);
      if (opts.some(o => !o)) block(`La pregunta ${n} tiene una opción vacía.`);
      const keys = opts.filter(Boolean).map(o => o.toLowerCase());
      if (new Set(keys).size !== keys.length) block(`La pregunta ${n} tiene opciones repetidas.`);
    }
    if (q.type === 'likert' && (!q.dimensionId || !dimIds.has(q.dimensionId))) {
      warn(`La pregunta ${n} no está asignada a ningún rasgo: se guarda la respuesta, pero no suma al resultado.`);
    }
  });

  t.dimensions.forEach(d => {
    const count = t.questions.filter(q => q.type === 'likert' && q.dimensionId === d.id).length;
    const label = clean(d.name, DIMENSION_NAME_MAX_LENGTH) || 'Un rasgo';
    if (count === 0) warn(`"${label}" no tiene preguntas de escala: no tendrá resultado.`);
    else if (count < 3) warn(`"${label}" tiene solo ${count} pregunta(s) de escala; con menos de 3 el resultado es poco confiable.`);
  });
  return issues;
}

export const hasBlockingIssues = (t: PersonalityTemplate): boolean => templateIssues(t).some(i => i.blocking);

/** Lo que se guarda en Formularios: limpio, sin campos que no correspondan a su tipo. */
export function templateForSave(t: PersonalityTemplate): PersonalityTemplate {
  return resolvePersonalityTemplate(JSON.parse(JSON.stringify(t)));
}

// ---------------------------------------------------------------------------
// La aplicación del test a una postulación
// ---------------------------------------------------------------------------

export type PersonalityStatus = 'open' | 'completed';

export type PersonalityAnswer = number | string;

export interface DimensionResult {
  id: string;
  name: string;
  /** 0 a 100. */
  score: number;
  level: PersonalityLevel;
  /** Preguntas de escala respondidas que suman a este rasgo. */
  answered: number;
}

export type PersonalityLevel = 'bajo' | 'medio' | 'alto';

export interface PersonalityResults {
  dimensions: DimensionResult[];
  /** Avisos sobre CÓMO respondió (todo igual, perfil demasiado perfecto…). */
  warnings: string[];
}

/** La copia de la plantilla que se guarda en la postulación al aplicarlo. */
export interface PersonalityApplication extends PersonalityTemplate {
  status: PersonalityStatus;
  /** Identifica ESTE intento: si se repite el test, el progreso guardado del anterior no se recupera. */
  attemptId: string;
  answers?: Record<string, PersonalityAnswer>;
  results?: PersonalityResults;
}

export const LEVEL_LABEL: Record<PersonalityLevel, string> = { bajo: 'Bajo', medio: 'Medio', alto: 'Alto' };

export function levelForScore(score: number): PersonalityLevel {
  if (score >= 70) return 'alto';
  if (score < 40) return 'bajo';
  return 'medio';
}

/** Cómo leer un rasgo con su nivel (medio = equilibrio entre los dos extremos). */
export function dimensionReading(d: Pick<PersonalityDimension, 'high' | 'low'> | undefined, level: PersonalityLevel): string {
  if (!d) return '';
  if (level === 'alto') return d.high;
  if (level === 'bajo') return d.low;
  return 'Nivel intermedio: muestra un equilibrio entre los dos extremos según la situación.';
}

/** La copia que se guarda en la postulación al aplicarlo (sin respuestas todavía). */
export function snapshotForApplication(t: PersonalityTemplate, attemptId: string): PersonalityApplication {
  return { ...templateForSave(t), status: 'open', attemptId };
}

/** Lo que ve el candidato: sin rasgos ni preguntas invertidas, para no orientar sus respuestas. */
export function publicQuestions(questions: PersonalityQuestion[]): Array<Pick<PersonalityQuestion, 'id' | 'text' | 'type' | 'options'>> {
  return questions.map(q => (q.type === 'choice'
    ? { id: q.id, text: q.text, type: q.type, options: q.options || [] }
    : { id: q.id, text: q.text, type: q.type }));
}

export function isAnswered(q: Pick<PersonalityQuestion, 'type' | 'options'>, value: unknown): boolean {
  if (q.type === 'likert') return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;
  if (q.type === 'choice') return typeof value === 'string' && (q.options || []).includes(value);
  return typeof value === 'string' && value.trim().length > 0;
}

// Narrow with `'error' in check`, not `!check.ok`: this project compiles without
// strictNullChecks, where the boolean-discriminant narrowing doesn't kick in.
export type AnswerCheck =
  | { ok: true; answers: Record<string, PersonalityAnswer> }
  | { ok: false; error: string; missing: string[] };

/**
 * Las respuestas recibidas, validadas contra las preguntas que ESA persona vio (la copia
 * guardada, nunca lo que diga la petición): escala 1–5 entera, opción que exista, texto
 * recortado. Todas son obligatorias. Lo que no corresponda a ninguna pregunta se descarta.
 */
export function checkAnswers(questions: PersonalityQuestion[], raw: unknown): AnswerCheck {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const answers: Record<string, PersonalityAnswer> = {};
  const missing: string[] = [];
  for (const q of questions) {
    let v = src[q.id];
    if (q.type === 'likert' && typeof v === 'string' && /^[1-5]$/.test(v.trim())) v = Number(v.trim());
    if (q.type === 'text' && typeof v === 'string') v = cleanMultiline(v, TEXT_ANSWER_MAX_LENGTH);
    if (!isAnswered(q, v)) {
      missing.push(q.id);
      continue;
    }
    answers[q.id] = v as PersonalityAnswer;
  }
  if (missing.length > 0) {
    const first = questions.findIndex(q => q.id === missing[0]) + 1;
    return {
      ok: false,
      missing,
      error: missing.length === 1
        ? `Falta responder la pregunta ${first}.`
        : `Faltan ${missing.length} preguntas por responder (la primera es la ${first}).`,
    };
  }
  return { ok: true, answers };
}

/**
 * El resultado: por rasgo, el promedio de sus frases (las invertidas cuentan al revés:
 * 5 → 1) llevado a 0–100, y su nivel. Además, avisos sobre la forma de responder que
 * restan confianza al resultado — no lo anulan: la entrevistadora decide.
 */
export function scorePersonality(t: Pick<PersonalityTemplate, 'dimensions' | 'questions'>, answers: Record<string, unknown>): PersonalityResults {
  const dimensions: DimensionResult[] = [];
  for (const d of t.dimensions) {
    const values = t.questions
      .filter(q => q.type === 'likert' && q.dimensionId === d.id && isAnswered(q, answers[q.id]))
      .map(q => (q.reverse ? 6 - (answers[q.id] as number) : (answers[q.id] as number)));
    if (values.length === 0) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const score = Math.round(((avg - 1) / 4) * 100);
    dimensions.push({ id: d.id, name: d.name, score, level: levelForScore(score), answered: values.length });
  }

  const warnings: string[] = [];
  const raw = t.questions.filter(q => q.type === 'likert' && isAnswered(q, answers[q.id])).map(q => answers[q.id] as number);
  if (raw.length >= 8) {
    const counts = new Map<number, number>();
    raw.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    const [topValue, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCount / raw.length >= 0.8) {
      const label = LIKERT_OPTIONS.find(o => o.value === topValue)?.label.toLowerCase() || String(topValue);
      warnings.push(`Respondió casi todo igual (${topCount} de ${raw.length} frases con "${label}"): el resultado es poco confiable. Conviene repasar algunas respuestas con la persona.`);
    }
  }
  if (dimensions.length >= 3 && dimensions.every(d => d.score >= 85)) {
    warnings.push('Perfil casi perfecto en todos los rasgos: puede haber respondido para "quedar bien". Valídalo con preguntas de la entrevista y referencias.');
  }
  return { dimensions, warnings };
}

/** Las respuestas de escala en palabras (para el perfil y para la IA). */
export function answerLabel(q: Pick<PersonalityQuestion, 'type'>, value: unknown): string {
  if (q.type === 'likert') {
    const o = LIKERT_OPTIONS.find(x => x.value === Number(value));
    return o ? `${o.value} · ${o.label}` : '';
  }
  return typeof value === 'string' ? value : '';
}
