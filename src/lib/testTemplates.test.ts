import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TEST_ID, DEFAULT_TEST_DIMENSIONS, MAX_TEST_QUESTIONS,
  buildDefaultTestTemplate, blankTestTemplate, duplicateTestTemplate,
  normalizeQuestions, normalizeDimensions, normalizeTestTemplate, toTestTemplateDoc,
  validateTestTemplate, dimensionWeightTotal, vacancyTestId, testIdCandidates,
  publicTestQuestions, withDefaultTest, vacanciesByTest, isMemoryQuestion,
  pairTestAnswers, testDimensionScores, answerToText,
  type TestTemplate,
} from './testTemplates';
import { masterTestQuestions } from '../data/testQuestions';

/** Recursively finds `undefined` values — Firestore rejects a write that contains one. */
const undefinedPaths = (v: any, path = ''): string[] => {
  if (v === undefined) return [path || '(raíz)'];
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => undefinedPaths(x, `${path}.${k}`));
  }
  return [];
};

const validTest = (): TestTemplate => ({
  id: 't1',
  name: 'Test Técnico',
  dimensions: [
    { id: 'tech', name: 'Conocimiento técnico', weight: 70 },
    { id: 'attitude', name: 'Actitud', weight: 30 },
  ],
  questions: [
    { id: 'q1', text: '¿Cómo cambias una pantalla?', type: 'textarea', expectedAnswer: 'Calor, ventosa, desconectar batería primero' },
    { id: 'q2', text: '¿Qué revisas primero si no carga?', type: 'multiple_choice', options: ['El puerto', 'La pantalla'] },
  ],
});

describe('el test general (lo que había antes de los tests por posición)', () => {
  it('sin preguntas guardadas usa el banco maestro completo con sus 6 criterios', () => {
    const t = buildDefaultTestTemplate(undefined);
    expect(t.id).toBe(DEFAULT_TEST_ID);
    expect(t.name).toBe('Test Presencial');
    expect(t.questions).toHaveLength(masterTestQuestions.length);
    expect(t.dimensions.map(d => d.id)).toEqual([
      'customer_service', 'practical_intelligence', 'behavioral_fit',
      'stability_responsibility', 'improvement_desire', 'orthography',
    ]);
    expect(dimensionWeightTotal(t.dimensions)).toBe(100);
    expect(validateTestTemplate(t)).toEqual([]);
  });

  it('respeta las preguntas que el equipo personalizó en settings/forms y les devuelve su sección', () => {
    const t = buildDefaultTestTemplate({
      testQuestions: [
        { id: 'A1', text: 'Pregunta editada', type: 'text' },
        { id: 'nueva', text: 'Pregunta agregada', type: 'textarea' },
      ],
    });
    expect(t.questions.map(q => q.text)).toEqual(['Pregunta editada', 'Pregunta agregada']);
    // The old editor dropped the section; it comes back from the master set by id.
    expect(t.questions[0].block).toBe('Bloque A. Lógica, atención y memoria');
    expect(t.questions[1].block).toBeUndefined();
  });

  it('ignora los formatos viejos guardados (ids C1 / q1), igual que antes', () => {
    for (const viejo of [[{ id: 'C1', text: 'x', type: 'text' }], [{ id: 'q1', text: 'x', type: 'text' }]]) {
      expect(buildDefaultTestTemplate({ testQuestions: viejo }).questions).toHaveLength(masterTestQuestions.length);
    }
  });

  it('cada llamada devuelve copias: editar una no altera la siguiente', () => {
    const a = buildDefaultTestTemplate();
    a.dimensions[0].weight = 99;
    expect(buildDefaultTestTemplate().dimensions[0].weight).toBe(DEFAULT_TEST_DIMENSIONS[0].weight);
  });
});

describe('normalizeQuestions — nada guardado puede trabar la página del candidato', () => {
  it('descarta preguntas sin texto y convierte en texto una de opciones sin opciones', () => {
    const qs = normalizeQuestions([
      { id: 'a', text: '   ', type: 'text' },
      { id: 'b', text: '¿Elige una?', type: 'multiple_choice', options: [] },
      null,
      'basura',
    ]);
    expect(qs).toEqual([{ id: 'b', text: '¿Elige una?', type: 'text' }]);
  });

  it('limpia y deduplica las opciones', () => {
    const [q] = normalizeQuestions([{ id: 'a', text: 'P', type: 'multiple_selection', options: [' Uno ', 'Uno', '', 'Dos', 7] }]);
    expect(q.options).toEqual(['Uno', 'Dos', '7']);
  });

  it('un tipo desconocido se vuelve texto corto', () => {
    expect(normalizeQuestions([{ id: 'a', text: 'P', type: 'dibujo' }])[0].type).toBe('text');
  });

  it('ids faltantes o repetidos se reemplazan igual en cada lectura (página y evaluación deben coincidir)', () => {
    const raw = [
      { text: 'Uno', type: 'text' },
      { id: 'x', text: 'Dos', type: 'text' },
      { id: 'x', text: 'Tres', type: 'text' },
      { id: 'q1', text: 'Cuatro', type: 'text' },
    ];
    const first = normalizeQuestions(raw).map(q => q.id);
    expect(new Set(first).size).toBe(4);
    expect(normalizeQuestions(raw).map(q => q.id)).toEqual(first);
  });

  it('conserva la sección y la respuesta esperada', () => {
    const [q] = normalizeQuestions([{ id: 'a', text: 'P', type: 'text', block: 'Bloque X', expectedAnswer: ' 42 ' }]);
    expect(q.block).toBe('Bloque X');
    expect(q.expectedAnswer).toBe('42');
  });
});

describe('normalizeDimensions', () => {
  it('descarta criterios sin nombre o sin peso', () => {
    const ds = normalizeDimensions([
      { id: 'a', name: '', weight: 50 },
      { id: 'b', name: 'B', weight: 0 },
      { id: 'c', name: 'C', weight: 'x' },
      { id: 'd', name: 'D', weight: 40 },
    ]);
    expect(ds).toEqual([{ id: 'd', name: 'D', weight: 40 }]);
  });

  it('reemplaza ids que no sirven como clave de la respuesta de la IA', () => {
    const ds = normalizeDimensions([
      { id: 'Servicio al cliente', name: 'Servicio', weight: 50 },
      { id: 'ok_id', name: 'Otro', weight: 25 },
      { id: 'ok_id', name: 'Repetido', weight: 25 },
    ]);
    expect(ds.map(d => d.id)).toEqual(['dim1', 'ok_id', 'dim3']);
    ds.forEach(d => expect(d.id).toMatch(/^[a-z0-9_]+$/));
  });
});

describe('normalizeTestTemplate', () => {
  it('el test general sin criterios guardados vuelve a sus 6 criterios', () => {
    const t = normalizeTestTemplate({ name: 'Test Presencial', questions: [] }, DEFAULT_TEST_ID);
    expect(t.dimensions).toHaveLength(6);
  });

  it('otro test sin criterios usa un único criterio general de 100 puntos', () => {
    const t = normalizeTestTemplate({ name: 'X', questions: [{ id: 'a', text: 'P', type: 'text' }] }, 'abc');
    expect(t.dimensions).toEqual([expect.objectContaining({ id: 'general', weight: 100 })]);
  });

  it('marca los tests archivados y pone nombre si falta', () => {
    const t = normalizeTestTemplate({ archived: true }, 'abc');
    expect(t.archived).toBe(true);
    expect(t.name).toBe('Test sin nombre');
  });
});

describe('validateTestTemplate — lo que el editor exige antes de guardar', () => {
  it('un test completo no tiene errores', () => {
    expect(validateTestTemplate(validTest())).toEqual([]);
  });

  it('un test nuevo en blanco pide nombre y el texto de la pregunta', () => {
    const errors = validateTestTemplate(blankTestTemplate());
    expect(errors).toContain('Ponle un nombre al test.');
    expect(errors).toContain('La pregunta 1 no tiene texto.');
  });

  it('los pesos de los criterios deben sumar 100', () => {
    const t = validTest();
    t.dimensions[0].weight = 60;
    expect(validateTestTemplate(t)).toEqual(['Los pesos de los criterios suman 90; deben sumar 100.']);
  });

  it('rechaza dos preguntas iguales (las respuestas se guardan con el texto de la pregunta)', () => {
    const t = validTest();
    t.questions[1] = { id: 'q3', text: '¿cómo cambias una pantalla?', type: 'text' };
    expect(validateTestTemplate(t)).toEqual(['Las preguntas 1 y 2 son iguales; cambia una de las dos.']);
  });

  it('las preguntas de opciones necesitan 2 opciones distintas y sin vacías', () => {
    const t = validTest();
    t.questions[1].options = ['Solo una'];
    expect(validateTestTemplate(t)).toContain('La pregunta 2 necesita al menos 2 opciones de respuesta.');
    t.questions[1].options = ['A', 'a'];
    expect(validateTestTemplate(t)).toContain('La pregunta 2 tiene opciones repetidas.');
    t.questions[1].options = ['A', 'B', ' '];
    expect(validateTestTemplate(t)).toContain('La pregunta 2 tiene una opción vacía.');
  });

  it('exige al menos un criterio y pesos enteros positivos', () => {
    const sin = validTest();
    sin.dimensions = [];
    expect(validateTestTemplate(sin)).toContain('Agrega al menos un criterio para que la IA sepa qué evaluar.');
    const raro = validTest();
    raro.dimensions = [{ id: 'a', name: 'A', weight: 100.5 }];
    expect(validateTestTemplate(raro)).toContain('El criterio 1 necesita un peso entero mayor que 0.');
  });

  it(`no admite más de ${MAX_TEST_QUESTIONS} preguntas (la IA debe ver todas las respuestas)`, () => {
    const t = validTest();
    t.questions = Array.from({ length: MAX_TEST_QUESTIONS + 1 }, (_, i) => ({ id: `q${i}`, text: `Pregunta ${i}`, type: 'text' as const }));
    expect(validateTestTemplate(t)).toEqual([`Un test admite hasta ${MAX_TEST_QUESTIONS} preguntas (este tiene ${MAX_TEST_QUESTIONS + 1}).`]);
  });
});

describe('qué test aplica cada vacante', () => {
  it('una vacante sin test elegido usa el general', () => {
    expect(vacancyTestId({ title: 'Cajero' })).toBe(DEFAULT_TEST_ID);
    expect(vacancyTestId(null)).toBe(DEFAULT_TEST_ID);
    expect(vacancyTestId({ testTemplateId: 'tecnicos' })).toBe('tecnicos');
  });

  it('un id basura nunca llega a Firestore como ruta', () => {
    for (const junk of ['', '   ', 'a/b', 42, {}, 'x'.repeat(201)]) {
      expect(vacancyTestId({ testTemplateId: junk })).toBe(DEFAULT_TEST_ID);
    }
  });

  it('al evaluar, primero el test que el candidato tiene en mano, luego el de la vacante, luego el general', () => {
    expect(testIdCandidates('ventas', { testTemplateId: 'tecnicos' })).toEqual(['ventas', 'tecnicos', DEFAULT_TEST_ID]);
    expect(testIdCandidates(undefined, { testTemplateId: 'tecnicos' })).toEqual(['tecnicos', DEFAULT_TEST_ID]);
    expect(testIdCandidates('a/b', {})).toEqual([DEFAULT_TEST_ID]);
    expect(testIdCandidates(DEFAULT_TEST_ID, {})).toEqual([DEFAULT_TEST_ID]);
  });

  it('agrupa las vacantes por test (las que no eligieron, en el general)', () => {
    const map = vacanciesByTest([
      { id: 'v1', testTemplateId: 'tecnicos' },
      { id: 'v2' },
      { id: 'v3', testTemplateId: 'tecnicos' },
    ]);
    expect(map.get('tecnicos')?.map(v => v.id)).toEqual(['v1', 'v3']);
    expect(map.get(DEFAULT_TEST_ID)?.map(v => v.id)).toEqual(['v2']);
  });
});

describe('lo que ve el candidato', () => {
  it('nunca recibe la respuesta esperada ni la sección', () => {
    const pub = publicTestQuestions(validTest().questions);
    expect(JSON.stringify(pub)).not.toContain('Calor, ventosa');
    pub.forEach(q => {
      expect(q).not.toHaveProperty('expectedAnswer');
      expect(q).not.toHaveProperty('block');
    });
    expect(pub[1].options).toEqual(['El puerto', 'La pantalla']);
  });

  it('la pregunta de memoria del test general se reconoce por id y tipo', () => {
    const a11 = masterTestQuestions.find(q => q.id === 'A11')!;
    expect(isMemoryQuestion(a11)).toBe(true);
    expect(isMemoryQuestion({ id: 'C11', type: 'multiple_selection' })).toBe(true);
    // Repurposed by the team into another kind of question → no memorization screen.
    expect(isMemoryQuestion({ id: 'A11', type: 'textarea' })).toBe(false);
    expect(isMemoryQuestion({ id: 'q_x', type: 'multiple_selection' })).toBe(false);
    expect(isMemoryQuestion(null)).toBe(false);
  });
});

describe('lista de tests en el panel', () => {
  it('muestra el test general aunque su documento todavía no exista, y siempre primero', () => {
    const otros = [
      normalizeTestTemplate({ name: 'Zeta' }, 'z'),
      normalizeTestTemplate({ name: 'Ábaco' }, 'a'),
    ];
    const list = withDefaultTest(otros);
    expect(list.map(t => t.id)).toEqual([DEFAULT_TEST_ID, 'a', 'z']);
    // Already saved → not duplicated.
    expect(withDefaultTest(list).filter(t => t.id === DEFAULT_TEST_ID)).toHaveLength(1);
  });

  it('duplicar conserva los ids de las preguntas (la de memoria sigue funcionando) sin compartir arreglos', () => {
    const general = buildDefaultTestTemplate();
    const copia = duplicateTestTemplate({ ...general, archived: true });
    expect(copia.id).toBe('');
    expect(copia.name).toBe('Test Presencial (copia)');
    expect(copia).not.toHaveProperty('archived');
    expect(copia.questions.map(q => q.id)).toEqual(general.questions.map(q => q.id));
    copia.questions.find(q => q.options)!.options!.push('nueva');
    expect(general.questions.find(q => q.options)!.options).not.toContain('nueva');
  });

  it('el documento a guardar no contiene undefined (Firestore lo rechazaría)', () => {
    const t = validTest();
    t.questions.push({ id: 'q9', text: 'Escala', type: 'scale', options: ['restos'] });
    const docData = toTestTemplateDoc(t);
    expect(undefinedPaths(docData)).toEqual([]);
    // Options only travel with choice questions.
    expect(docData.questions[2]).not.toHaveProperty('options');
    expect(docData.questions[0].expectedAnswer).toBe('Calor, ventosa, desconectar batería primero');
  });
});

describe('pairTestAnswers — cada respuesta con su pregunta', () => {
  const questions = validTest().questions;

  it('envío nuevo: respuestas por id, en el orden del test, con la respuesta esperada al lado', () => {
    const pairs = pairTestAnswers(questions, { q2: 'El puerto', q1: 'Con calor' });
    expect(pairs.map(p => [p.text, p.answer])).toEqual([
      ['¿Cómo cambias una pantalla?', 'Con calor'],
      ['¿Qué revisas primero si no carga?', 'El puerto'],
    ]);
    expect(pairs[0].expectedAnswer).toBe('Calor, ventosa, desconectar batería primero');
  });

  it('reevaluación: respuestas guardadas por texto', () => {
    const pairs = pairTestAnswers(questions, { '¿Cómo cambias una pantalla?': 'Con calor' });
    expect(pairs).toEqual([expect.objectContaining({ id: 'q1', answer: 'Con calor' })]);
  });

  it('no cuenta en contra una pregunta que el candidato nunca vio (agregada mientras respondía)', () => {
    const pairs = pairTestAnswers(questions, { q1: 'Con calor', q2: '' });
    expect(pairs.map(p => p.id)).toEqual(['q1']);
  });

  it('conserva la respuesta a una pregunta que salió del test, con el texto que vio el candidato', () => {
    const pairs = pairTestAnswers(questions, { q1: 'Con calor', viejo: ['a', 'b'] }, [{ id: 'viejo', text: '¿Pregunta borrada?' }]);
    expect(pairs[1]).toEqual({ id: 'viejo', text: '¿Pregunta borrada?', answer: ['a', 'b'] });
    expect(answerToText(pairs[1].answer)).toBe('a, b');
  });
});

describe('testDimensionScores — puntajes por criterio de cualquier versión', () => {
  it('lee el formato nuevo, sin convertir en 0 un criterio que la IA no calificó', () => {
    const scores = testDimensionScores({
      dimensionScores: [
        { id: 'tech', name: 'Técnico', score: 55.5, max: 70 },
        { id: 'attitude', name: 'Actitud', score: null, max: 30 },
      ],
    });
    expect(scores).toEqual([
      { id: 'tech', name: 'Técnico', score: 55.5, max: 70 },
      { id: 'attitude', name: 'Actitud', score: null, max: 30 },
    ]);
  });

  it('traduce los campos que guardaban las versiones anteriores', () => {
    const scores = testDimensionScores({ score: 80, customer_service_score: 18, orthography_score: 0 });
    expect(scores).toEqual([
      { id: 'customer_service', name: 'Servicio al cliente', score: 18, max: 20 },
      { id: 'orthography', name: 'Ortografía y redacción', score: 0, max: 10 },
    ]);
  });

  it('sin resultados no hay criterios', () => {
    expect(testDimensionScores(undefined)).toEqual([]);
    expect(testDimensionScores({ score: 70 })).toEqual([]);
  });
});
