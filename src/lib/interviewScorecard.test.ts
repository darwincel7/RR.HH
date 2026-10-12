import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCORECARD, METRIC_DEFAULT_VALUE, ANSWER_MAX_LENGTH, MAX_INTERVIEW_ANSWERS,
  resolveScorecardTemplate, blankScorecard, loadScorecard, questionKey,
  buildQuestionRows, selectQuestion, setAnswerText, renameAnsweredQuestion, removeAnsweredQuestion,
  addInterviewQuestion, addToBank, renameInBank, removeFromBank, answersForSave, answeredOnly,
  hasInterviewEvidence,
} from './interviewScorecard';

/**
 * The interview scorecard mixes a SHARED question bank with PER-CANDIDATE answers.
 * The failure modes these tests pin are silent and costly: an answer that vanishes when
 * someone edits the bank, a question that appears twice, or one candidate's evaluation
 * leaking into another's.
 */

const BANK = ['¿Por qué saliste de tu último trabajo?', '¿Qué haces cuando cometes un error?'];

describe('resolveScorecardTemplate', () => {
  it('falls back to the defaults for missing lists only', () => {
    const t = resolveScorecardTemplate({ recommendedQuestions: ['Solo una'] });
    expect(t.recommendedQuestions).toEqual(['Solo una']);
    expect(t.positiveSignals).toEqual(DEFAULT_SCORECARD.positiveSignals);
    expect(t.metrics).toEqual(DEFAULT_SCORECARD.metrics);
  });

  it('keeps a bank the recruiter intentionally emptied', () => {
    expect(resolveScorecardTemplate({ recommendedQuestions: [] }).recommendedQuestions).toEqual([]);
  });

  it('survives a missing or malformed settings doc', () => {
    expect(resolveScorecardTemplate(undefined)).toEqual(DEFAULT_SCORECARD);
    expect(resolveScorecardTemplate({ redFlags: 'no-es-lista' }).redFlags).toEqual(DEFAULT_SCORECARD.redFlags);
    expect(resolveScorecardTemplate({ metrics: ['A', 3, null] }).metrics).toEqual(['A']);
  });
});

describe('blankScorecard / loadScorecard', () => {
  it('starts every metric at 3.0 and with nothing marked', () => {
    const s = blankScorecard(DEFAULT_SCORECARD);
    expect(Object.values(s.metrics).every(v => v === METRIC_DEFAULT_VALUE)).toBe(true);
    expect(s.positiveSignals).toEqual([]);
    expect(s.answers).toEqual([]);
  });

  it('loads an older scorecard saved before answers existed', () => {
    const s = loadScorecard({ positiveSignals: ['Respeto'], redFlags: [], metrics: { Energía: 40 } }, DEFAULT_SCORECARD);
    expect(s.answers).toEqual([]);
    expect(s.metrics).toEqual({ Energía: 40 });
  });

  it('never hands back the saved object itself (edits must not mutate the source)', () => {
    const saved = { positiveSignals: [], redFlags: [], metrics: { Energía: 40 }, answers: [] };
    const s = loadScorecard(saved, DEFAULT_SCORECARD);
    s.metrics.Energía = 10;
    expect(saved.metrics.Energía).toBe(40);
  });

  it('drops malformed answers instead of crashing the modal', () => {
    const s = loadScorecard({ answers: [{ question: 'Q', answer: 'A' }, null, { answer: 'sin pregunta' }, { question: 'Q2' }] }, DEFAULT_SCORECARD);
    expect(s.answers).toEqual([{ question: 'Q', answer: 'A' }, { question: 'Q2', answer: '' }]);
  });
});

describe('questionKey', () => {
  it('ignores case, accents and spacing', () => {
    expect(questionKey('  ¿Qué  haces cuando COMETES un error? ')).toBe(questionKey('¿que haces cuando cometes un error?'));
  });
});

describe('buildQuestionRows', () => {
  it('lists the bank in order, marking the selected ones with their answer', () => {
    const rows = buildQuestionRows(BANK, [{ question: BANK[1], answer: 'Lo reconozco y lo corrijo' }]);
    expect(rows.map(r => [r.question, r.inBank, r.selected, r.answer])).toEqual([
      [BANK[0], true, false, ''],
      [BANK[1], true, true, 'Lo reconozco y lo corrijo'],
    ]);
  });

  it('keeps answers to questions that are not (or no longer) in the bank, after the bank', () => {
    const rows = buildQuestionRows(BANK, [{ question: 'Pregunta solo para este candidato', answer: 'X' }]);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual({ question: 'Pregunta solo para este candidato', inBank: false, selected: true, answer: 'X' });
  });

  it('matches an answer to its bank question despite small wording differences', () => {
    const rows = buildQuestionRows(BANK, [{ question: '¿que haces cuando cometes un error?', answer: 'A' }]);
    expect(rows).toHaveLength(2);
    expect(rows[1].selected).toBe(true);
  });

  it('never shows a question twice', () => {
    const rows = buildQuestionRows([...BANK, BANK[0].toUpperCase()], []);
    expect(rows).toHaveLength(2);
  });
});

describe('selecting a question to describe the answer', () => {
  it('only a selected question carries an answer', () => {
    let a = selectQuestion([], BANK[0], true);
    a = setAnswerText(a, BANK[0], 'Buscaba crecer');
    expect(a).toEqual([{ question: BANK[0], answer: 'Buscaba crecer' }]);
    a = selectQuestion(a, BANK[0], false);
    expect(a).toEqual([]);
  });

  it('restores the draft typed before an accidental deselect', () => {
    expect(selectQuestion([], BANK[0], true, 'borrador')).toEqual([{ question: BANK[0], answer: 'borrador' }]);
  });

  it('selecting twice does not duplicate nor reorder', () => {
    const a = [{ question: BANK[1], answer: 'x' }, { question: BANK[0], answer: 'y' }];
    expect(selectQuestion(a, BANK[1], true)).toBe(a);
  });

  it('caps very long descriptions', () => {
    const a = setAnswerText([{ question: 'Q', answer: '' }], 'Q', 'x'.repeat(ANSWER_MAX_LENGTH + 50));
    expect(a[0].answer).toHaveLength(ANSWER_MAX_LENGTH);
  });
});

describe('renameAnsweredQuestion', () => {
  it('moves the answer to the new wording', () => {
    const a = renameAnsweredQuestion([{ question: 'Vieja', answer: 'resp' }], 'Vieja', 'Nueva');
    expect(a).toEqual([{ question: 'Nueva', answer: 'resp' }]);
  });

  it('merges instead of overwriting when the new wording already has an answer', () => {
    const a = renameAnsweredQuestion([{ question: 'A', answer: 'uno' }, { question: 'B', answer: 'dos' }], 'A', 'B');
    expect(a).toEqual([{ question: 'B', answer: 'dos\nuno' }]);
  });

  it('is a no-op when the question had no answer', () => {
    const a = [{ question: 'X', answer: '1' }];
    expect(renameAnsweredQuestion(a, 'Otra', 'Nueva')).toBe(a);
  });
});

describe('questions asked only in this interview', () => {
  it('adds a new one, ready to describe', () => {
    const r = addInterviewQuestion(BANK, [], 'Vi que duraste 2 meses en X, ¿qué pasó?');
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.answers).toEqual([{ question: 'Vi que duraste 2 meses en X, ¿qué pasó?', answer: '' }]);
  });

  it('selects the bank question instead of creating a near-duplicate', () => {
    const r = addInterviewQuestion(BANK, [], '¿que haces cuando cometes un error?');
    if ('error' in r) throw new Error(r.error);
    expect(r.answers[0].question).toBe(BANK[1]);
  });

  it('rejects empty and repeated questions', () => {
    expect(addInterviewQuestion(BANK, [], '   ')).toEqual({ error: 'Escribe la pregunta.' });
    expect(addInterviewQuestion(BANK, [{ question: 'Q', answer: '' }], 'q')).toEqual({ error: 'Esa pregunta ya está en esta entrevista.' });
  });

  it('can be removed again', () => {
    expect(removeAnsweredQuestion([{ question: 'Q', answer: 'x' }, { question: 'R', answer: '' }], 'q')).toEqual([{ question: 'R', answer: '' }]);
  });
});

describe('editing the shared bank', () => {
  it('adds, refusing blanks and duplicates', () => {
    expect(addToBank(BANK, 'Nueva pregunta')).toEqual({ bank: [...BANK, 'Nueva pregunta'] });
    expect(addToBank(BANK, '  ')).toEqual({ error: 'Escribe la pregunta.' });
    expect(addToBank(BANK, BANK[0].toLowerCase())).toEqual({ error: 'Esa pregunta ya está en el banco.' });
  });

  it('rewords in place, keeping the order', () => {
    expect(renameInBank(BANK, BANK[0], 'Reformulada')).toEqual({ bank: ['Reformulada', BANK[1]] });
  });

  it('allows fixing only the casing/spacing of the same question', () => {
    expect(renameInBank(BANK, BANK[1], '¿Qué haces cuando cometes UN error?')).toEqual({ bank: [BANK[0], '¿Qué haces cuando cometes UN error?'] });
  });

  it('refuses a rewording that duplicates another question or empties it', () => {
    expect(renameInBank(BANK, BANK[0], BANK[1])).toEqual({ error: 'Esa pregunta ya está en el banco.' });
    expect(renameInBank(BANK, BANK[0], ' ')).toEqual({ error: 'La pregunta no puede quedar vacía.' });
  });

  it('appends the new wording if a colleague removed the original meanwhile', () => {
    expect(renameInBank([BANK[1]], BANK[0], 'Reformulada')).toEqual({ bank: [BANK[1], 'Reformulada'] });
  });

  it('removes by identity, not by exact text', () => {
    expect(removeFromBank(BANK, BANK[0].toUpperCase())).toEqual([BANK[1]]);
  });

  it('removing a bank question keeps the answer it already had in this interview', () => {
    const answers = [{ question: BANK[0], answer: 'Buscaba crecer' }];
    const rows = buildQuestionRows(removeFromBank(BANK, BANK[0]), answers);
    expect(rows.find(r => r.question === BANK[0])).toEqual({ question: BANK[0], inBank: false, selected: true, answer: 'Buscaba crecer' });
  });
});

describe('answersForSave / answeredOnly', () => {
  it('trims, keeps one entry per question and keeps selected-but-empty ones', () => {
    const saved = answersForSave([
      { question: '  Q1  ', answer: '  resp  ' },
      { question: 'q1', answer: 'duplicada' },
      { question: 'Q2', answer: '' },
      { question: '   ', answer: 'sin pregunta' },
    ]);
    expect(saved).toEqual([{ question: 'Q1', answer: 'resp' }, { question: 'Q2', answer: '' }]);
  });

  it('bounds how many answers a single interview stores', () => {
    const many = Array.from({ length: MAX_INTERVIEW_ANSWERS + 10 }, (_, i) => ({ question: `Q${i}`, answer: 'x' }));
    expect(answersForSave(many)).toHaveLength(MAX_INTERVIEW_ANSWERS);
  });

  it('the AI only reads answers that were actually described', () => {
    expect(answeredOnly([{ question: 'Q1', answer: 'algo' }, { question: 'Q2', answer: '   ' }])).toEqual([{ question: 'Q1', answer: 'algo' }]);
    expect(answeredOnly(undefined)).toEqual([]);
  });
});

describe('hasInterviewEvidence', () => {
  it('an untouched scorecard saved as-is is not something to analyze', () => {
    const untouched = { ...blankScorecard(DEFAULT_SCORECARD), answers: [{ question: 'Q', answer: '' }] };
    expect(hasInterviewEvidence(untouched)).toBe(false);
    expect(hasInterviewEvidence(undefined, { score: 0, notes: '  ' })).toBe(false);
  });

  it('any real observation counts', () => {
    const blank = blankScorecard(DEFAULT_SCORECARD);
    expect(hasInterviewEvidence({ ...blank, answers: [{ question: 'Q', answer: 'Dijo X' }] })).toBe(true);
    expect(hasInterviewEvidence({ ...blank, redFlags: ['Arrogancia'] })).toBe(true);
    expect(hasInterviewEvidence({ ...blank, metrics: { ...blank.metrics, Energía: 45 } })).toBe(true);
    expect(hasInterviewEvidence(null, { score: 4 })).toBe(true);
    expect(hasInterviewEvidence(null, { notes: 'Llegó tarde' })).toBe(true);
  });
});
