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
