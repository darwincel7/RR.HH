import { describe, it, expect } from 'vitest';
import { computeOverallScore, interviewStageScore } from './candidateScore';

/** The number the Ranking sorts by — a wrong weight silently reorders who gets hired. */
describe('computeOverallScore', () => {
  it('averages the stages that have a score', () => {
    expect(computeOverallScore({ scoreSummary: 4, stage2Scoring: { total_score: 70 }, testResults: { score: 90 } })).toBe(80);
    expect(computeOverallScore({})).toBe(0);
  });

  it('counts the interview once even when the interviewer and the AI both scored it', () => {
    const app = { stage2Scoring: { total_score: 80 }, interviewObservation: { score: 5 }, interviewAiEvaluation: { score: 60 } };
    // interview = (100 + 60) / 2 = 80 → (80 + 80) / 2
    expect(computeOverallScore(app)).toBe(80);
  });

  it('a filled-in scorecard now counts through its AI analysis', () => {
    expect(computeOverallScore({ stage2Scoring: { total_score: 60 }, interviewAiEvaluation: { score: 90 } })).toBe(75);
  });

  it('an unrated interview (0, saved along with comments) does not drag the total down', () => {
    expect(computeOverallScore({ stage2Scoring: { total_score: 80 }, interviewObservation: { score: 0, notes: 'Llegó tarde' } })).toBe(80);
  });

  it('keeps accepting numeric strings from older documents', () => {
    expect(computeOverallScore({ scoreSummary: '3.5' })).toBe(70);
  });
});

describe('interviewStageScore', () => {
  it('is null when the interview has no score at all', () => {
    expect(interviewStageScore({})).toBeNull();
    expect(interviewStageScore({ interviewObservation: { score: 0 } })).toBeNull();
  });

  it('uses whichever of the two scores exists', () => {
    expect(interviewStageScore({ interviewObservation: { score: 3 } })).toBe(60);
    expect(interviewStageScore({ interviewAiEvaluation: { score: 72 } })).toBe(72);
  });
});
