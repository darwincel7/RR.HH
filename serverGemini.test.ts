import { describe, it, expect } from 'vitest';
import {
  isAiBudgetError, aiRetryDelayMs, AI_SCORING_MAX_ATTEMPTS,
  generateContentResilient, isAiBudgetBlocked, aiBudgetStatus,
} from './serverGemini';

// The exact message Google returned on 13-oct-2026, when every stage-2 form failed.
const SPEND_CAP = '{"error":{"code":429,"message":"Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap.","status":"RESOURCE_EXHAUSTED"}}';

const fakeAi = (impl: () => Promise<any>) => {
  let calls = 0;
  return { ai: { models: { generateContent: () => { calls++; return impl(); } } } as any, calls: () => calls };
};

describe('isAiBudgetError', () => {
  it('recognizes the spending-cap / exhausted-quota refusals', () => {
    expect(isAiBudgetError(new Error(SPEND_CAP))).toBe(true);
    expect(isAiBudgetError('You exceeded your current quota, please check your plan and billing details.')).toBe(true);
    expect(isAiBudgetError(Object.assign(new Error('x'), { code: 'ai_sin_saldo' }))).toBe(true);
  });
  it('does not confuse passing hiccups with a budget problem', () => {
    expect(isAiBudgetError(new Error('503 The model is overloaded'))).toBe(false);
    expect(isAiBudgetError(new Error('Gemini timeout tras 90000ms'))).toBe(false);
    expect(isAiBudgetError(null)).toBe(false);
  });
});

describe('aiRetryDelayMs', () => {
  it('waits long when there is no budget, and backs off otherwise', () => {
    expect(aiRetryDelayMs(0, true)).toBe(30 * 60_000);
    expect(aiRetryDelayMs(1, false)).toBe(2 * 60_000);
    expect(aiRetryDelayMs(3, false)).toBe(8 * 60_000);
    expect(aiRetryDelayMs(30, false)).toBe(6 * 3_600_000);
    expect(AI_SCORING_MAX_ATTEMPTS).toBeGreaterThan(3);
  });
});

describe('generateContentResilient with no budget', () => {
  it('fails at once (no pointless retries), then fails fast without calling Google', async () => {
    const first = fakeAi(() => Promise.reject(new Error(SPEND_CAP)));
    await expect(generateContentResilient(first.ai, {})).rejects.toThrow(/spending cap/);
    expect(first.calls()).toBe(1);
    expect(isAiBudgetBlocked()).toBe(true);
    expect(aiBudgetStatus().exhausted).toBe(true);

    const second = fakeAi(() => Promise.resolve({ text: '{}' }));
    await expect(generateContentResilient(second.ai, {})).rejects.toMatchObject({ code: 'ai_sin_saldo' });
    expect(second.calls()).toBe(0);
  });

  it('a recruiter retry may test the AI anyway, and success clears the state', async () => {
    const ok = fakeAi(() => Promise.resolve({ text: '{}' }));
    await expect(generateContentResilient(ok.ai, {}, { bypassBudgetBlock: true })).resolves.toEqual({ text: '{}' });
    expect(ok.calls()).toBe(1);
    expect(isAiBudgetBlocked()).toBe(false);
    expect(aiBudgetStatus().exhausted).toBe(false);
  });
});
