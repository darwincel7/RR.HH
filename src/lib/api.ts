import { auth } from './firebase';

/**
 * fetch wrapper that attaches the current user's Firebase ID token as a
 * `Authorization: Bearer <token>` header, for calling recruiter-only API
 * endpoints. When no user is signed in, it behaves like a plain fetch.
 *
 * Use this for any /api/* call made from authenticated (recruiter) views.
 * Public candidate-facing endpoints (e.g. /api/score-stage2) should use plain fetch.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken();
      headers.set('Authorization', `Bearer ${token}`);
    } catch (e) {
      console.error('No se pudo obtener el token de autenticación:', e);
    }
  }
  return fetch(input, { ...init, headers });
}

/**
 * Asks the backend to process the pending-CV queue right now.
 *
 * The server worker also runs on a timer, but that timer only ticks while the process
 * has CPU — on Cloud Run CPU is throttled between requests, so a queue filled by a
 * recruiter action could sit idle until the next visitor. Calling this right after
 * queueing CVs makes them start parsing immediately.
 *
 * Fire-and-forget: never throws, never blocks the UI. The timer remains the safety net.
 */
export async function requestCvWorkerRun(): Promise<void> {
  try {
    await apiFetch('/api/cv-worker/run', { method: 'POST' });
  } catch (e) {
    // The background worker will pick these up on its next pass.
    console.warn('No se pudo avisar al worker de CV (se procesarán igualmente):', e);
  }
}
