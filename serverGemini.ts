import { GoogleGenAI } from "@google/genai";

/**
 * Everything the server needs to talk to Gemini, in one place: client construction,
 * the model choice, and the resilient call wrapper. Extracted from server.ts so the
 * AI plumbing has a home of its own instead of living between the WhatsApp socket
 * state and the Express routes.
 */

// The Gemini model every AI feature uses (CV parsing, stage-2 scoring, test grading).
// Overridable via GEMINI_MODEL because the default is a *preview* build: Google retires
// those on its own schedule, and when that happens every AI feature fails at once. With
// this, recovering is an env-var change and a restart — not a code edit and a redeploy.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

export function getAI(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.replace(/['"]/g, '').trim() : undefined;

  if (apiKey === "MY_GEMINI_API_KEY") {
    return null; // Signals that we have a bad configured key
  }

  return new GoogleGenAI({ apiKey });
}

// Reject if a promise takes longer than `ms` — so a hung Gemini call can't hold a
// Cloud Run concurrency slot open indefinitely.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Gemini timeout tras ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ---------------------------------------------------------------------------
// AI budget: when Google says "monthly spending cap reached" (or the free quota is
// used up), EVERY call fails until a human raises the cap or the month rolls over.
// Retrying is pointless and each feature used to fail on its own — on 13-oct-2026 the
// stage-2 form rejected every candidate for hours because of it. Now the first such
// error opens a short "don't even try" window (callers fail fast and keep their work
// queued), and the staff app shows a banner saying why and what to do.
// ---------------------------------------------------------------------------
const AI_BUDGET_RE = /spending cap|spend cap|exceeded your current quota|billing/i;

/** Is this the "no budget left" kind of failure (as opposed to a passing hiccup)? */
export function isAiBudgetError(err: unknown): boolean {
  const e: any = err;
  return e?.code === 'ai_sin_saldo' || AI_BUDGET_RE.test(String(e?.message || e || ''));
}

const AI_BUDGET_BLOCK_MS = 10 * 60_000;
const aiBudget = { exhaustedSince: 0, blockedUntil: 0, lastError: '' };

/** Automatic re-scoring gives up after this many NON-budget failures (the recruiter's
 * "Reevaluar IA" button still works afterwards). Budget failures never count. */
export const AI_SCORING_MAX_ATTEMPTS = 8;

/** Wait before retrying a pending scoring: no budget → 30 min (it won't come back in
 * seconds); any other failure → 2, 4, 8… min, up to 6 h. */
export function aiRetryDelayMs(attempts: number, budget: boolean): number {
  if (budget) return 30 * 60_000;
  return Math.min(6 * 3_600_000, 60_000 * Math.pow(2, Math.max(1, attempts)));
}

/** For the staff banner: is the AI out of budget right now (as far as we know)? */
export function aiBudgetStatus(): { exhausted: boolean; since: number | null; lastError: string } {
  return { exhausted: !!aiBudget.exhaustedSince, since: aiBudget.exhaustedSince || null, lastError: aiBudget.lastError };
}

/** True while calls should not even be attempted (they'd fail the same way). */
export function isAiBudgetBlocked(now = Date.now()): boolean {
  return aiBudget.blockedUntil > now;
}

function aiUnavailableError(): Error {
  const err: any = new Error('La IA no tiene saldo disponible (límite de gasto mensual de Google alcanzado).');
  err.code = 'ai_sin_saldo';
  return err;
}

// Wraps ai.models.generateContent with a hard timeout + bounded exponential backoff
// on transient errors (429/5xx/timeout). Prevents thundering-herd during AI spikes.
// A budget error is NOT transient: it fails at once and opens the fast-fail window.
// `bypassBudgetBlock` lets a recruiter's explicit "Reevaluar IA" test whether the cap
// was raised without waiting for the window to close.
export async function generateContentResilient(ai: GoogleGenAI, params: any, opts: { timeoutMs?: number; retries?: number; bypassBudgetBlock?: boolean } = {}): Promise<any> {
  if (!opts.bypassBudgetBlock && isAiBudgetBlocked()) throw aiUnavailableError();
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const retries = opts.retries ?? 2;
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await withTimeout(ai.models.generateContent(params), timeoutMs);
      if (aiBudget.exhaustedSince) {
        console.log('[gemini] la IA vuelve a responder: el saldo se restableció.');
        aiBudget.exhaustedSince = 0;
        aiBudget.blockedUntil = 0;
        aiBudget.lastError = '';
      }
      return result;
    } catch (err: any) {
      lastErr = err;
      if (isAiBudgetError(err)) {
        if (!aiBudget.exhaustedSince) {
          console.error('[gemini] SIN SALDO: Google rechaza las llamadas por el límite de gasto. Lo pendiente queda en espera.');
          aiBudget.exhaustedSince = Date.now();
        }
        aiBudget.blockedUntil = Date.now() + AI_BUDGET_BLOCK_MS;
        aiBudget.lastError = String(err?.message || err).slice(0, 300);
        throw err;
      }
      const msg = String(err?.message || err);
      const status = Number(err?.status || err?.code || 0);
      const retriable = [429, 500, 503].includes(status) || /timeout|deadline|unavailable|overloaded|rate.?limit|429|503|500/i.test(msg);
      if (attempt < retries && retriable) {
        const backoff = 600 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
        console.warn(`[gemini] intento ${attempt + 1} falló (${msg.slice(0, 90)}); reintento en ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
