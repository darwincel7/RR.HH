/**
 * The Ranking view: every candidate of a vacancy (or of all of them) in one row, with
 * one column per evaluation and the pros/contras gathered from every stage.
 *
 * Pure — pinned by ranking.test.ts. Everything shown or sorted is on a 0–100 scale so
 * the columns read the same way, whatever scale each evaluation was saved in.
 */
import { PIPELINE_STAGES } from '../constants/stages';
import { computeOverallScore, interviewStageScore } from './candidateScore';
import { attendanceOf, type AttendanceStatus } from './interviewAttendance';
import { readIntegrity } from './testIntegrity';

/** One application with what the ranking needs around it. */
export interface RankingRow {
  app: any;
  /** The candidate doc (CV extraction, phone…), when loaded. */
  candidate?: any;
  /** Lo marcado en la página Entrevistas: respaldo de la asistencia. */
  participantStatus?: unknown;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const pct = (v: unknown, max: number): number | null => {
  const n = num(v);
  return n === null ? null : Math.max(0, Math.min(100, (n / max) * 100));
};

/** The table's score columns, left → right: one per evaluation, the total last. */
export const SCORE_COLUMNS: Array<{ key: string; label: string; name: string; hint: string }> = [
  { key: 'cv', label: 'CV', name: 'CV (IA)', hint: 'Análisis del CV con IA (1–5 llevado a 0–100)' },
  { key: 'form', label: 'Formulario', name: 'Formulario etapa 2', hint: 'Formulario de etapa 2 calificado por IA' },
  { key: 'test', label: 'Test', name: 'Test presencial', hint: 'Test presencial calificado por IA' },
  { key: 'interview', label: 'Entrevista', name: 'Entrevista', hint: 'Entrevistador (1–5) y análisis IA, promediados' },
  { key: 'total', label: 'Total', name: 'Puntaje total', hint: 'Promedio de CV, formulario, entrevista y test (los que tenga)' },
];

/** Sub-scores, with their maximum (how they are saved) to bring them to 0–100. */
export const TEST_PARTS: Array<[field: string, label: string, max: number]> = [
  ['customer_service_score', 'Servicio al cliente', 20],
  ['practical_intelligence_score', 'Inteligencia práctica', 20],
  ['behavioral_fit_score', 'Ajuste conductual', 20],
  ['stability_responsibility_score', 'Estabilidad y responsabilidad', 20],
  ['improvement_desire_score', 'Deseo de mejora', 10],
  ['orthography_score', 'Ortografía y redacción', 10],
];
export const FORM_PARTS: Array<[field: string, label: string, max: number]> = [
  ['stability_motivation_score', 'Estabilidad y motivación', 20],
  ['problem_solving_score', 'Resolución de problemas', 20],
  ['integrity_ethics_score', 'Integridad y ética', 25],
  ['behavioral_attitude_score', 'Ajuste conductual', 25],
  ['orthography_score', 'Ortografía y redacción', 10],
];

export interface PersonalityTrait { id: string; name: string; score: number; level: string }

export function personalityTraits(app: any): PersonalityTrait[] {
  const dims = app?.personalityTest?.results?.dimensions;
  if (!Array.isArray(dims)) return [];
  return dims
    .filter((d: any) => d && typeof d.id === 'string' && num(d.score) !== null)
    .map((d: any) => ({ id: d.id, name: String(d.name || d.id), score: num(d.score)!, level: String(d.level || '') }));
}

const toMillis = (t: any): number | null => {
  const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null);
  return d && !isNaN(d.getTime()) ? d.getTime() : null;
};

export function daysInStage(app: any, now = Date.now()): number | null {
  const ms = toMillis(app?.lastStageUpdate) ?? toMillis(app?.submittedAt);
  return ms === null ? null : Math.floor(Math.abs(now - ms) / 86_400_000);
}

const hasAnyScore = (app: any): boolean =>
  num(app?.scoreSummary) !== null || num(app?.stage2Scoring?.total_score) !== null
  || interviewStageScore(app) !== null || num(app?.testResults?.score) !== null;

/** The 0–100 value of a score column or sub-score; null = not evaluated (yet). */
export function scoreValue(key: string, row: RankingRow): number | null {
  const app = row.app;
  switch (key) {
    case 'total': return hasAnyScore(app) ? computeOverallScore(app) : null;
    case 'cv': { const v = num(app?.scoreSummary); return v === null ? null : v * 20; }
    case 'form': return num(app?.stage2Scoring?.total_score);
    case 'test': return num(app?.testResults?.score);
    case 'interview': return interviewStageScore(app);
    case 'interview:manual': {
      // 0 is the "not rated yet" state of the 1–5 buttons, not a rating.
      const v = num(app?.interviewObservation?.score);
      return v !== null && v > 0 ? v * 20 : null;
    }
    case 'interview:ai': return num(app?.interviewAiEvaluation?.score);
  }
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (kind === 'test') {
    const part = TEST_PARTS.find(p => p[0] === id);
    return part ? pct(app?.testResults?.[id], part[2]) : null;
  }
  if (kind === 'form') {
    const part = FORM_PARTS.find(p => p[0] === id);
    return part ? pct(app?.stage2Scoring?.[id], part[2]) : null;
  }
  // Interview scorecard criteria: saved as 10–50 (= 1.0–5.0).
  if (kind === 'card') return pct(app?.interviewScorecard?.metrics?.[id], 50);
  if (kind === 'pers') return personalityTraits(app).find(t => t.id === id)?.score ?? null;
  return null;
}

export type SortKind = 'score' | 'date' | 'days' | 'name' | 'stage';
export interface SortOption { key: string; label: string; group: string; kind: SortKind }

const GENERAL_SORTS: SortOption[] = [
  { key: 'total', label: 'Puntaje total', group: 'General', kind: 'score' },
  { key: 'cv', label: 'CV (IA)', group: 'General', kind: 'score' },
  { key: 'form', label: 'Formulario etapa 2', group: 'General', kind: 'score' },
  { key: 'test', label: 'Test presencial', group: 'General', kind: 'score' },
  { key: 'interview', label: 'Entrevista', group: 'General', kind: 'score' },
  { key: 'arrival', label: 'Fecha de llegada', group: 'General', kind: 'date' },
  { key: 'days', label: 'Días en la etapa', group: 'General', kind: 'days' },
  { key: 'stage', label: 'Etapa del embudo', group: 'General', kind: 'stage' },
  { key: 'name', label: 'Nombre', group: 'General', kind: 'name' },
];

/**
 * What the list can be ordered by: the general options plus every sub-score, interview
 * criterion and personality trait that at least one of these candidates has — so the
 * menu never offers an order that would leave everyone in "sin dato".
 */
export function sortOptions(rows: RankingRow[]): SortOption[] {
  const out = [...GENERAL_SORTS];
  const has = (key: string) => rows.some(r => scoreValue(key, r) !== null);
  TEST_PARTS.forEach(([f, label]) => { if (has(`test:${f}`)) out.push({ key: `test:${f}`, label, group: 'Test presencial (detalle)', kind: 'score' }); });
  FORM_PARTS.forEach(([f, label]) => { if (has(`form:${f}`)) out.push({ key: `form:${f}`, label, group: 'Formulario (detalle)', kind: 'score' }); });
  if (has('interview:manual')) out.push({ key: 'interview:manual', label: 'Nota del entrevistador', group: 'Entrevista (detalle)', kind: 'score' });
  if (has('interview:ai')) out.push({ key: 'interview:ai', label: 'Análisis IA de la entrevista', group: 'Entrevista (detalle)', kind: 'score' });
  const criteria = new Set<string>();
  rows.forEach(r => Object.keys(r.app?.interviewScorecard?.metrics || {}).forEach(k => criteria.add(k)));
  [...criteria].sort((a, b) => a.localeCompare(b, 'es')).forEach(c => {
    if (has(`card:${c}`)) out.push({ key: `card:${c}`, label: c, group: 'Entrevista (detalle)', kind: 'score' });
  });
  const traits = new Map<string, string>();
  rows.forEach(r => personalityTraits(r.app).forEach(t => { if (!traits.has(t.id)) traits.set(t.id, t.name); }));
  traits.forEach((name, id) => out.push({ key: `pers:${id}`, label: name, group: 'Personalidad', kind: 'score' }));
  return out;
}

export const findSortOption = (options: SortOption[], key: string): SortOption =>
  options.find(o => o.key === key) || GENERAL_SORTS[0];

/** How each direction reads for an option ("Mejor primero" / "Más reciente"…). */
export function directionLabels(kind: SortKind): { desc: string; asc: string } {
  switch (kind) {
    case 'date': return { desc: 'Más reciente primero', asc: 'Más antiguo primero' };
    case 'days': return { desc: 'Más días primero', asc: 'Menos días primero' };
    case 'name': return { desc: 'Z → A', asc: 'A → Z' };
    case 'stage': return { desc: 'Más avanzados primero', asc: 'Primeras etapas primero' };
    default: return { desc: 'Mejor primero', asc: 'Peor primero' };
  }
}

/** The natural direction when picking an option. */
export const defaultDirection = (kind: SortKind): 'asc' | 'desc' => (kind === 'name' ? 'asc' : 'desc');

const nameOf = (row: RankingRow): string =>
  String(row.app?.candidateName || row.candidate?.fullName || '').trim();

function sortValue(key: string, row: RankingRow): number | string | null {
  switch (key) {
    case 'arrival': return toMillis(row.app?.submittedAt);
    case 'days': return daysInStage(row.app);
    case 'name': return nameOf(row) || null;
    case 'stage': { const i = PIPELINE_STAGES.indexOf(row.app?.stage); return i < 0 ? null : i; }
    default: return scoreValue(key, row);
  }
}

/** Ties: best total first, then by name — so equal scores still come in a stable order. */
function tieBreak(a: RankingRow, b: RankingRow): number {
  const ta = scoreValue('total', a), tb = scoreValue('total', b);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  return nameOf(a).localeCompare(nameOf(b), 'es', { sensitivity: 'base' });
}

/**
 * Orders by one option. Whoever has NO value for it (no test yet, no interview…) always
 * goes after the rest, in both directions: "peor primero" must show the worst RESULTS,
 * not the people who haven't been evaluated.
 */
export function sortRanking(rows: RankingRow[], key: string, dir: 'asc' | 'desc'): { ranked: RankingRow[]; missing: RankingRow[] } {
  const sign = dir === 'asc' ? 1 : -1;
  const valued = rows.map(r => ({ r, v: sortValue(key, r) }));
  const ranked = valued.filter(x => x.v !== null).sort((a, b) => {
    const c = typeof a.v === 'string' && typeof b.v === 'string'
      ? a.v.localeCompare(b.v, 'es', { sensitivity: 'base' })
      : (a.v as number) - (b.v as number);
    return c !== 0 ? c * sign : tieBreak(a.r, b.r);
  }).map(x => x.r);
  const missing = valued.filter(x => x.v === null).map(x => x.r).sort(tieBreak);
  return { ranked, missing };
}

export interface Signal { text: string; source: string }

const texts = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').map(s => s.trim()).filter(Boolean) : [];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The pros and contras of a candidate, gathered from every stage — the most informed
 * stages first (interview, test, form), the CV last. Repeated phrases appear once.
 */
export function prosAndCons(row: RankingRow): { pros: Signal[]; cons: Signal[] } {
  const app = row.app || {};
  const ai = row.candidate?.aiExtraction || {};
  const pros: Signal[] = [];
  const cons: Signal[] = [];
  const add = (list: Signal[], items: string[], source: string) => items.forEach(text => list.push({ text, source }));

  const attendance: AttendanceStatus | null = attendanceOf(app, row.participantStatus);
  if (attendance === 'no_show') cons.push({ text: 'No vino a la entrevista', source: 'Asistencia' });

  add(pros, texts(app.interviewAiEvaluation?.strengths), 'Entrevista (IA)');
  add(cons, texts(app.interviewAiEvaluation?.concerns), 'Entrevista (IA)');
  add(pros, texts(app.interviewScorecard?.positiveSignals), 'Entrevista');
  add(cons, texts(app.interviewScorecard?.redFlags), 'Entrevista');
  if (typeof app.interviewObservation?.redFlags === 'string') add(cons, texts([app.interviewObservation.redFlags]), 'Entrevista');

  add(pros, texts(app.testResults?.positiveSignals), 'Test');
  add(cons, texts(app.testResults?.redFlags), 'Test');
  const wrongTest = texts(app.testResults?.incorrectAnswers).length;
  if (wrongTest > 0) cons.push({ text: plural(wrongTest, 'respuesta incorrecta', 'respuestas incorrectas'), source: 'Test' });
  const integrity = readIntegrity(app.testIntegrity);
  if (integrity && !integrity.clean) add(cons, integrity.lines, 'Integridad del test');

  add(pros, texts(app.stage2Scoring?.positive_signals), 'Formulario');
  add(cons, texts(app.stage2Scoring?.risk_signals), 'Formulario');
  const wrongForm = texts(app.stage2Scoring?.incorrect_answers).length;
  if (wrongForm > 0) cons.push({ text: plural(wrongForm, 'respuesta incorrecta', 'respuestas incorrectas'), source: 'Formulario' });

  add(pros, texts(app.personalityTest?.aiInterpretation?.strengths), 'Personalidad');
  add(cons, texts(app.personalityTest?.aiInterpretation?.watch_outs), 'Personalidad');
  add(cons, texts(app.personalityTest?.results?.warnings), 'Personalidad');

  add(pros, texts(ai.strengths_detected), 'CV');
  add(cons, texts(ai.risk_flags), 'CV');

  const dedupe = (list: Signal[]) => {
    const seen = new Set<string>();
    return list.filter(s => {
      const k = s.text.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return { pros: dedupe(pros), cons: dedupe(cons) };
}

/** Stages still in play: the "En proceso" preset of the stage filter. */
export const CLOSED_STAGES = ['Contratado', 'Descartado', 'Banco de talento'];
export const IN_PROCESS_STAGES = PIPELINE_STAGES.filter(s => !CLOSED_STAGES.includes(s));

/** `?etapas=` ⇄ list. Unknown names are dropped; empty = every stage. */
export function parseStages(param: string | null): string[] {
  if (!param) return [];
  return param.split(',').map(s => s.trim()).filter(s => PIPELINE_STAGES.includes(s));
}
export const formatStages = (stages: string[]): string =>
  PIPELINE_STAGES.filter(s => stages.includes(s)).join(',');
