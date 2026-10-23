import { describe, it, expect } from 'vitest';
import {
  scoreValue, sortRanking, sortOptions, prosAndCons, parseStages, formatStages, directionLabels,
  type RankingRow,
} from './ranking';

const row = (app: any, extra: Partial<RankingRow> = {}): RankingRow => ({ app, ...extra });
const names = (rows: RankingRow[]) => rows.map(r => r.app.candidateName);

describe('scoreValue', () => {
  it('brings every evaluation to 0–100', () => {
    const r = row({
      scoreSummary: 4,
      stage2Scoring: { total_score: 72, integrity_ethics_score: 20 },
      testResults: { score: 88, improvement_desire_score: 7 },
      interviewObservation: { score: 4 },
      interviewAiEvaluation: { score: 70 },
      interviewScorecard: { metrics: { Puntualidad: 40 } },
      personalityTest: { results: { dimensions: [{ id: 'responsabilidad', name: 'Responsabilidad', score: 82, level: 'alto' }] } },
    });
    expect(scoreValue('cv', r)).toBe(80);
    expect(scoreValue('form', r)).toBe(72);
    expect(scoreValue('form:integrity_ethics_score', r)).toBe(80); // 20 / 25
    expect(scoreValue('test', r)).toBe(88);
    expect(scoreValue('test:improvement_desire_score', r)).toBe(70); // 7 / 10
    expect(scoreValue('interview', r)).toBe(75); // (80 + 70) / 2
    expect(scoreValue('interview:manual', r)).toBe(80);
    expect(scoreValue('card:Puntualidad', r)).toBe(80); // 40 = 4.0 / 5
    expect(scoreValue('pers:responsabilidad', r)).toBe(82);
  });

  it('null when not evaluated — never a 0 that would rank as the worst', () => {
    const r = row({ interviewObservation: { score: 0 }, testResults: { status: 'pending_ai' } });
    expect(scoreValue('total', r)).toBeNull();
    expect(scoreValue('test', r)).toBeNull();
    expect(scoreValue('interview:manual', r)).toBeNull();
    expect(scoreValue('pers:apertura', r)).toBeNull();
  });
});

describe('sortRanking', () => {
  const rows = [
    row({ candidateName: 'Ana', testResults: { score: 60 }, scoreSummary: 5 }),
    row({ candidateName: 'Bea', scoreSummary: 3 }),
    row({ candidateName: 'Carla', testResults: { score: 90 }, scoreSummary: 2 }),
    row({ candidateName: 'Dina', testResults: { score: 40 } }),
  ];

  it('best first, and whoever has no result goes after the rest', () => {
    const { ranked, missing } = sortRanking(rows, 'test', 'desc');
    expect(names(ranked)).toEqual(['Carla', 'Ana', 'Dina']);
    expect(names(missing)).toEqual(['Bea']);
  });

  it('"peor primero" shows the worst RESULTS, not the people without one', () => {
    const { ranked, missing } = sortRanking(rows, 'test', 'asc');
    expect(names(ranked)).toEqual(['Dina', 'Ana', 'Carla']);
    expect(names(missing)).toEqual(['Bea']);
  });

  it('ties fall back to the best total, then the name', () => {
    const tied = [
      row({ candidateName: 'Zoe', testResults: { score: 70 }, scoreSummary: 2 }),
      row({ candidateName: 'Yara', testResults: { score: 70 }, scoreSummary: 5 }),
      row({ candidateName: 'Abril', testResults: { score: 70 }, scoreSummary: 5 }),
    ];
    expect(names(sortRanking(tied, 'test', 'desc').ranked)).toEqual(['Abril', 'Yara', 'Zoe']);
  });

  it('by name, by stage and by arrival', () => {
    expect(names(sortRanking(rows, 'name', 'asc').ranked)).toEqual(['Ana', 'Bea', 'Carla', 'Dina']);
    const staged = [row({ candidateName: 'X', stage: 'Finalista' }), row({ candidateName: 'Y', stage: 'Nuevo' }), row({ candidateName: 'Z', stage: '???' })];
    const s = sortRanking(staged, 'stage', 'desc');
    expect(names(s.ranked)).toEqual(['X', 'Y']);
    expect(names(s.missing)).toEqual(['Z']);
    const dated = [row({ candidateName: 'Vieja', submittedAt: '2026-01-01' }), row({ candidateName: 'Nueva', submittedAt: '2026-10-01' })];
    expect(names(sortRanking(dated, 'arrival', 'desc').ranked)).toEqual(['Nueva', 'Vieja']);
  });
});

describe('sortOptions', () => {
  it('only offers details that someone actually has', () => {
    const opts = sortOptions([
      row({ testResults: { score: 80, customer_service_score: 15 }, interviewScorecard: { metrics: { Energía: 30 } } }),
      row({ personalityTest: { results: { dimensions: [{ id: 'apertura', name: 'Apertura', score: 50 }] } } }),
    ]).map(o => o.key);
    expect(opts).toContain('test:customer_service_score');
    expect(opts).toContain('card:Energía');
    expect(opts).toContain('pers:apertura');
    expect(opts).not.toContain('test:orthography_score');
    expect(opts).not.toContain('form:problem_solving_score');
    expect(opts).not.toContain('interview:ai');
  });
});

describe('prosAndCons', () => {
  it('gathers every stage, most informed first, without repeating a phrase', () => {
    const { pros, cons } = prosAndCons(row({
      interviewAiEvaluation: { strengths: ['Buena comunicación'], concerns: ['Poca experiencia en caja'] },
      testResults: { positiveSignals: ['buena comunicación.'], redFlags: [], incorrectAnswers: ['a', 'b'] },
      testIntegrity: { exits: 2, awayMs: 60000 },
      stage2Scoring: { positive_signals: ['Puntual'], risk_signals: ['Cambia mucho de empleo'] },
      personalityTest: { aiInterpretation: { strengths: ['Responsable'], watch_outs: ['Impaciente'] } },
      interviewAttendance: { status: 'no_show' },
    }, { candidate: { aiExtraction: { strengths_detected: ['Bachiller'], risk_flags: ['Vive lejos'] } } }));
    expect(pros.map(p => p.text)).toEqual(['Buena comunicación', 'Puntual', 'Responsable', 'Bachiller']);
    expect(cons[0]).toEqual({ text: 'No vino a la entrevista', source: 'Asistencia' });
    expect(cons.map(c => c.source)).toEqual([
      'Asistencia', 'Entrevista (IA)', 'Test', 'Integridad del test', 'Formulario', 'Personalidad', 'CV',
    ]);
    expect(cons.find(c => c.source === 'Test')?.text).toBe('2 respuestas incorrectas');
  });

  it('empty for a candidate nobody has evaluated', () => {
    expect(prosAndCons(row({}))).toEqual({ pros: [], cons: [] });
  });
});

describe('stage filter in the URL', () => {
  it('round-trips in pipeline order and drops unknown names', () => {
    expect(parseStages('Finalista,Nuevo,Inventada')).toEqual(['Finalista', 'Nuevo']);
    expect(formatStages(['Finalista', 'Nuevo'])).toBe('Nuevo,Finalista');
    expect(parseStages(null)).toEqual([]);
  });
});

it('direction labels read naturally for each kind', () => {
  expect(directionLabels('score').desc).toBe('Mejor primero');
  expect(directionLabels('date').desc).toBe('Más reciente primero');
});
