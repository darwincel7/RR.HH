/**
 * The blended 0–100 score shown in Candidatos and in the Ranking: the average of every
 * stage the application has a score for (CV, stage-2 form, interview, test).
 *
 * The interview counts ONCE. When both the interviewer's own 1–5 rating and the AI
 * interview analysis exist, they're averaged into that single stage — the AI reads the
 * interviewer's observations, so counting both separately would weigh the interview
 * double. Before the AI analysis existed, a filled-in scorecard didn't count at all.
 */

/** A usable number (numeric strings included, as older docs may hold), else null. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** The interview stage on a 0–100 scale, or null when there's nothing to score. */
export function interviewStageScore(app: any): number | null {
  const manual = num(app?.interviewObservation?.score);
  const ai = num(app?.interviewAiEvaluation?.score);
  // 0 is the "not rated yet" state of the 1–5 buttons (saved along with comments), not
  // a real rating — counting it dragged the candidate's total down.
  const parts = [manual !== null && manual > 0 ? manual * 20 : null, ai].filter((v): v is number => v !== null);
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export function computeOverallScore(app: any): number {
  const parts: number[] = [];
  const cv = num(app?.scoreSummary);
  if (cv !== null) parts.push(cv * 20); // CV 1–5 → 20–100
  const stage2 = num(app?.stage2Scoring?.total_score);
  if (stage2 !== null) parts.push(stage2);
  const interview = interviewStageScore(app);
  if (interview !== null) parts.push(interview);
  const test = num(app?.testResults?.score);
  if (test !== null) parts.push(test);
  return parts.length > 0 ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
}
