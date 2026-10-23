/**
 * Names the way people write them.
 *
 * CVs often arrive in ALL CAPS ("MARIA DE LOS ANGELES PEREZ") and forms in all lowercase;
 * echoing that back in a WhatsApp message ("Hola MARIA DE LOS ANGELES PEREZ") reads like
 * a bulk sender wrote it — exactly what recipients report as spam. Mixed-case names are
 * left exactly as typed (McDonald, DeLeón): someone chose that casing.
 */

// Lowercase connectors inside Spanish (and a few foreign) surnames. Exportadas porque
// comparar dos nombres (¿es la misma persona?) tiene que ignorarlas igual que el
// formateo: "Ana de la Cruz" y "Ana Cruz" se escriben distinto y son la misma.
export const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'van', 'von', 'di']);

export function prettifyName(raw: string): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const letters = s.replace(/[^\p{L}]/gu, '');
  const allUpper = letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  const allLower = letters === letters.toLowerCase() && letters !== letters.toUpperCase();
  if (!allUpper && !allLower) return s;
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && PARTICLES.has(w)
      ? w
      : w.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())))
    .join(' ');
}

/** The placeholder a bulk-uploaded candidate carries while the AI still reads the CV
 * ("Procesando: cv.pdf") — never a name to greet anyone with. */
export function isPlaceholderName(raw: string): boolean {
  return /^procesando\b/i.test(String(raw ?? '').trim());
}

/** "MARÍA JOSÉ PÉREZ" → "María". Empty when there is no usable name. */
export function firstNameOf(raw: string): string {
  if (isPlaceholderName(raw)) return '';
  return prettifyName(raw).split(' ')[0] || '';
}

/**
 * "JUAN CARLOS PÉREZ RODRÍGUEZ" → "Juan C. P. R.": the first name plus the initials of
 * the rest. Enough for a person to recognize themselves (and to tell two Juans apart) on
 * a page anyone with the link can open, without publishing their surname there. Empty
 * when there is no usable name ("⚠️ Error de lectura…" and the like are not names).
 */
export function shortNameOf(raw: string): string {
  if (isPlaceholderName(raw)) return '';
  const [first, ...rest] = prettifyName(raw).split(' ');
  if (!first || !/^\p{L}/u.test(first)) return '';
  const initials = rest
    .filter(w => !PARTICLES.has(w.toLowerCase()))
    .map(w => w.match(/\p{L}/u)?.[0]?.toUpperCase())
    .filter(Boolean)
    .slice(0, 3)
    .map(c => `${c}.`);
  return [first, ...initials].join(' ');
}
