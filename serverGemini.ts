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

// Wraps ai.models.generateContent with a hard timeout + bounded exponential backoff
// on transient errors (429/5xx/timeout). Prevents thundering-herd during AI spikes.
export async function generateContentResilient(ai: GoogleGenAI, params: any, opts: { timeoutMs?: number; retries?: number } = {}): Promise<any> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const retries = opts.retries ?? 2;
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(ai.models.generateContent(params), timeoutMs);
    } catch (err: any) {
      lastErr = err;
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
