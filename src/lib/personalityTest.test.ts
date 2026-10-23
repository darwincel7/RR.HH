import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PERSONALITY_TEST, defaultPersonalityTest, resolvePersonalityTemplate, templateIssues, hasBlockingIssues,
  templateForSave, snapshotForApplication, publicQuestions, checkAnswers, scorePersonality, levelForScore,
  dimensionReading, answerLabel, TEXT_ANSWER_MAX_LENGTH,
  type PersonalityTemplate,
} from './personalityTest';

/**
 * El test de personalidad mezcla una PLANTILLA editable con RESPUESTAS por candidato.
 * Lo que fijan estas pruebas falla en silencio y sale caro: un resultado calculado al
 * revés (una frase invertida que suma), una respuesta que no corresponde a lo que la
 * persona vio, o una plantilla rota que se puede aplicar igual.
 */

const tpl = (over: Partial<PersonalityTemplate> = {}): PersonalityTemplate => ({
  name: 'Mini test',
  instructions: '',
  dimensions: [{ id: 'resp', name: 'Responsabilidad', description: '', high: 'Muy responsable', low: 'Poco responsable' }],
  questions: [
    { id: 'q1', text: 'Termino lo que empiezo.', type: 'likert', dimensionId: 'resp' },
    { id: 'q2', text: 'Dejo todo para última hora.', type: 'likert', dimensionId: 'resp', reverse: true },
    { id: 'q3', text: 'Llego a tiempo.', type: 'likert', dimensionId: 'resp' },
  ],
  ...over,
});

describe('el test recomendado', () => {
  it('tiene 5 rasgos con 5 frases de escala cada uno, 2 de ellas invertidas', () => {
    const t = DEFAULT_PERSONALITY_TEST;
    expect(t.dimensions).toHaveLength(5);
    for (const d of t.dimensions) {
      const items = t.questions.filter(q => q.type === 'likert' && q.dimensionId === d.id);
      expect(items).toHaveLength(5);
      expect(items.filter(q => q.reverse)).toHaveLength(2);
    }
  });

  it('no tiene ningún problema que impida guardarlo o aplicarlo, ni avisos', () => {
    expect(templateIssues(DEFAULT_PERSONALITY_TEST)).toEqual([]);
  });

  it('intercala los rasgos: nunca dos frases seguidas del mismo rasgo', () => {
    const dims = DEFAULT_PERSONALITY_TEST.questions.filter(q => q.type === 'likert').map(q => q.dimensionId);
    dims.slice(1).forEach((d, i) => expect(d).not.toBe(dims[i]));
  });

  it('se entrega como copia: editarla no altera la original', () => {
    const t = defaultPersonalityTest();
    t.questions[0].text = 'cambiada';
    t.dimensions.pop();
    expect(DEFAULT_PERSONALITY_TEST.questions[0].text).not.toBe('cambiada');
    expect(DEFAULT_PERSONALITY_TEST.dimensions).toHaveLength(5);
  });
});

describe('resolvePersonalityTemplate', () => {
  it('sin plantilla guardada usa la recomendada', () => {
    expect(resolvePersonalityTemplate(undefined)).toEqual(DEFAULT_PERSONALITY_TEST);
    expect(resolvePersonalityTemplate('roto')).toEqual(DEFAULT_PERSONALITY_TEST);
  });

  it('respeta el nombre y las preguntas que eligió la entrevistadora, y completa solo lo que falta', () => {
    const t = resolvePersonalityTemplate({ name: 'Perfil Ventas', questions: [{ id: 'x', text: '¿Te gusta vender?', type: 'text' }] });
    expect(t.name).toBe('Perfil Ventas');
    expect(t.questions).toEqual([{ id: 'x', text: '¿Te gusta vender?', type: 'text' }]);
    expect(t.dimensions).toEqual(DEFAULT_PERSONALITY_TEST.dimensions);
    expect(t.instructions).toBe(DEFAULT_PERSONALITY_TEST.instructions);
  });

  it('una lista vaciada a propósito se queda vacía', () => {
    expect(resolvePersonalityTemplate({ questions: [] }).questions).toEqual([]);
  });

  it('quita lo que no corresponde a cada tipo y descarta preguntas rotas o con id repetido', () => {
    const t = resolvePersonalityTemplate({
      questions: [
        { id: 'a', text: 'Abierta', type: 'text', dimensionId: 'resp', reverse: true, options: ['x'] },
        { id: 'b', text: 'Escala', type: 'likert', options: ['x'] },
        { id: 'a', text: 'Repetida', type: 'text' },
        null,
        { text: 'Sin id', type: 'text' },
        { id: 'c', text: 'Tipo raro', type: 'slider' },
      ],
    });
    expect(t.questions).toEqual([
      { id: 'a', text: 'Abierta', type: 'text' },
      { id: 'b', text: 'Escala', type: 'likert' },
      { id: 'c', text: 'Tipo raro', type: 'likert' },
    ]);
  });
});

describe('templateIssues', () => {
  it('bloquea un test sin nombre, sin preguntas o con preguntas vacías', () => {
    expect(hasBlockingIssues(tpl({ name: '  ' }))).toBe(true);
    expect(hasBlockingIssues(tpl({ questions: [] }))).toBe(true);
    expect(hasBlockingIssues(tpl({ questions: [{ id: 'q', text: ' ', type: 'text' }] }))).toBe(true);
  });

  it('bloquea una opción múltiple con menos de 2 opciones, opciones vacías o repetidas', () => {
    const choice = (options: string[]) => tpl({ questions: [...tpl().questions, { id: 'c', text: '¿Qué prefieres?', type: 'choice', options }] });
    expect(hasBlockingIssues(choice(['Solo una']))).toBe(true);
    expect(hasBlockingIssues(choice(['A', '']))).toBe(true);
    expect(hasBlockingIssues(choice(['Equipo', 'equipo']))).toBe(true);
    expect(hasBlockingIssues(choice(['Equipo', 'Solo']))).toBe(false);
  });

  it('avisa (sin bloquear) de una frase sin rasgo y de un rasgo con pocas frases', () => {
    const issues = templateIssues(tpl({
      questions: [
        { id: 'q1', text: 'Frase 1', type: 'likert', dimensionId: 'resp' },
        { id: 'q2', text: 'Frase 2', type: 'likert' },
      ],
    }));
    expect(issues.every(i => !i.blocking)).toBe(true);
    expect(issues.map(i => i.message).join(' ')).toMatch(/no está asignada a ningún rasgo/);
    expect(issues.map(i => i.message).join(' ')).toMatch(/solo 1 pregunta/);
  });

  it('una frase asignada a un rasgo que ya se borró cuenta como sin rasgo', () => {
    const issues = templateIssues(tpl({ dimensions: [] }));
    expect(issues.filter(i => /ningún rasgo/.test(i.message))).toHaveLength(3);
  });
});

describe('la copia que se guarda al aplicarlo', () => {
  it('lleva la plantilla limpia, el estado abierto y el id del intento', () => {
    const s = snapshotForApplication(tpl({ name: '  Mini   test ' }), 'intento-1');
    expect(s.status).toBe('open');
    expect(s.attemptId).toBe('intento-1');
    expect(s.name).toBe('Mini test');
    expect(s.questions).toHaveLength(3);
  });

  it('el candidato no ve a qué rasgo suma cada frase ni cuáles son invertidas', () => {
    const pub = publicQuestions(DEFAULT_PERSONALITY_TEST.questions);
    expect(pub.some((q: any) => 'dimensionId' in q || 'reverse' in q)).toBe(false);
    expect(pub.find(q => q.type === 'choice')?.options?.length).toBeGreaterThan(1);
  });

  it('templateForSave no cambia una plantilla válida', () => {
    expect(templateForSave(DEFAULT_PERSONALITY_TEST)).toEqual(DEFAULT_PERSONALITY_TEST);
  });
});

describe('checkAnswers', () => {
  const qs = [
    ...tpl().questions,
    { id: 'c', text: '¿Qué prefieres?', type: 'choice' as const, options: ['Equipo', 'Solo'] },
    { id: 't', text: 'Descríbete', type: 'text' as const },
  ];

  it('acepta respuestas completas y descarta lo que no es de ninguna pregunta', () => {
    const r = checkAnswers(qs, { q1: 5, q2: '1', q3: 4, c: 'Equipo', t: '  Puntual   y   alegre ', intruso: 'x' });
    expect(r).toEqual({ ok: true, answers: { q1: 5, q2: 1, q3: 4, c: 'Equipo', t: 'Puntual y alegre' } });
  });

  it('exige todas las preguntas y dice cuál falta primero', () => {
    const r = checkAnswers(qs, { q1: 5, q3: 4, c: 'Equipo', t: 'Hola' });
    expect(r.ok).toBe(false);
    if ('error' in r) {
      expect(r.missing).toEqual(['q2']);
      expect(r.error).toBe('Falta responder la pregunta 2.');
    }
  });

  it('rechaza valores fuera de la escala, opciones que no existen y textos en blanco', () => {
    const r = checkAnswers(qs, { q1: 6, q2: 2.5, q3: 0, c: 'Otra', t: '   ' });
    expect(r.ok).toBe(false);
    if ('error' in r) {
      expect(r.missing).toEqual(['q1', 'q2', 'q3', 'c', 't']);
      expect(r.error).toMatch(/Faltan 5 preguntas/);
    }
  });

  it('recorta las respuestas abiertas demasiado largas', () => {
    const r = checkAnswers([{ id: 't', text: 'Descríbete', type: 'text' }], { t: 'a'.repeat(TEXT_ANSWER_MAX_LENGTH + 50) });
    expect(r.ok && (r.answers.t as string).length).toBe(TEXT_ANSWER_MAX_LENGTH);
  });

  it('no acepta un arreglo como respuestas', () => {
    expect(checkAnswers(qs, [5, 1, 4]).ok).toBe(false);
  });
});

describe('scorePersonality', () => {
  it('una frase invertida cuenta al revés', () => {
    // Muy de acuerdo con lo bueno (5, 5) y nada de acuerdo con "dejo todo para última hora" (1 → 5).
    const r = scorePersonality(tpl(), { q1: 5, q2: 1, q3: 5 });
    expect(r.dimensions).toEqual([{ id: 'resp', name: 'Responsabilidad', score: 100, level: 'alto', answered: 3 }]);
    // Y al revés: de acuerdo con la invertida baja el rasgo.
    expect(scorePersonality(tpl(), { q1: 1, q2: 5, q3: 1 }).dimensions[0].score).toBe(0);
  });

  it('lleva el promedio a 0–100 (3 = punto medio = 50)', () => {
    expect(scorePersonality(tpl(), { q1: 3, q2: 3, q3: 3 }).dimensions[0]).toMatchObject({ score: 50, level: 'medio' });
    expect(scorePersonality(tpl(), { q1: 4, q2: 2, q3: 4 }).dimensions[0].score).toBe(75);
  });

  it('un rasgo sin respuestas no aparece (no inventa un resultado)', () => {
    const t = tpl({ dimensions: [...tpl().dimensions, { id: 'vacio', name: 'Vacío', description: '', high: '', low: '' }] });
    expect(scorePersonality(t, { q1: 4, q2: 2, q3: 4 }).dimensions.map(d => d.id)).toEqual(['resp']);
  });

  it('avisa cuando respondió casi todo con la misma opción', () => {
    const t = defaultPersonalityTest();
    const answers: Record<string, number> = {};
    t.questions.filter(q => q.type === 'likert').forEach(q => { answers[q.id] = 5; });
    const r = scorePersonality(t, answers);
    expect(r.warnings.join(' ')).toMatch(/casi todo igual \(25 de 25 frases con "totalmente de acuerdo"\)/);
  });

  it('avisa de un perfil demasiado perfecto en todos los rasgos', () => {
    const t = defaultPersonalityTest();
    const answers: Record<string, number> = {};
    t.questions.filter(q => q.type === 'likert').forEach(q => { answers[q.id] = q.reverse ? 1 : 5; });
    const r = scorePersonality(t, answers);
    expect(r.dimensions.every(d => d.score === 100)).toBe(true);
    expect(r.warnings.some(w => /quedar bien/.test(w))).toBe(true);
  });

  it('respuestas variadas no generan avisos', () => {
    const t = defaultPersonalityTest();
    const answers: Record<string, number> = {};
    t.questions.filter(q => q.type === 'likert').forEach((q, i) => { answers[q.id] = (i % 5) + 1; });
    expect(scorePersonality(t, answers).warnings).toEqual([]);
  });
});

describe('lectura del resultado', () => {
  it('niveles: menos de 40 bajo, desde 70 alto', () => {
    expect([0, 39, 40, 69, 70, 100].map(levelForScore)).toEqual(['bajo', 'bajo', 'medio', 'medio', 'alto', 'alto']);
  });

  it('usa el texto de alto o bajo del rasgo, y uno de equilibrio en medio', () => {
    const d = tpl().dimensions[0];
    expect(dimensionReading(d, 'alto')).toBe('Muy responsable');
    expect(dimensionReading(d, 'bajo')).toBe('Poco responsable');
    expect(dimensionReading(d, 'medio')).toMatch(/equilibrio/);
    expect(dimensionReading(undefined, 'alto')).toBe('');
  });

  it('las respuestas de escala se leen en palabras', () => {
    expect(answerLabel({ type: 'likert' }, 4)).toBe('4 · De acuerdo');
    expect(answerLabel({ type: 'text' }, 'Hola')).toBe('Hola');
    expect(answerLabel({ type: 'likert' }, 9)).toBe('');
  });
});
