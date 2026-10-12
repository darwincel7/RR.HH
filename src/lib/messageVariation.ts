import { prettifyName, isPlaceholderName } from './personName';

/**
 * Message variation for WhatsApp templates ("spintax").
 *
 * A template offers alternatives between braces, separated by "|":
 *   "{Hola|Saludos|Buenas} {{primer_nombre}}, te escribimos de {{empresa}}…"
 * and each candidate gets one combination. Why it matters: the SAME text sent to many
 * strangers within minutes is the textbook bulk-spam fingerprint WhatsApp screens for —
 * and the reports that kind of message attracts are what gets a number banned.
 *
 * The choice is DETERMINISTIC per recipient (seeded by phone + stage + vacancy): a retry,
 * a double click or a re-dragged card renders the exact same text, so the server's
 * "identical message already queued for this phone" dedupe keeps working.
 */

/** FNV-1a (32-bit): a stable number from any text. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny and plenty good to pick a phrasing. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// {{variables}} are shielded while choosing, so an option may contain one
// ("{Hola {{primer_nombre}}|Buenas}") and a variable is never mistaken for a group.
const VAR_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;
const shield = (t: string) => t.replace(VAR_RE, (_m, name: string) => `\u0001${name}\u0002`);
const unshield = (t: string) => t.replace(/\u0001([a-zA-Z_]+)\u0002/g, '{{$1}}');

// An innermost group: braces holding at least one "|" and no other braces.
const GROUP_RE = /\{([^{}]*\|[^{}]*)\}/;
const MAX_GROUPS = 500;

/** Resolves every {a|b|c} group (innermost first, so groups can nest). */
export function expandVariations(template: string, random: () => number = Math.random): string {
  let out = shield(String(template ?? ''));
  for (let i = 0; i < MAX_GROUPS; i++) {
    const m = GROUP_RE.exec(out);
    if (!m) break;
    const options = m[1].split('|');
    const pick = options[Math.min(options.length - 1, Math.floor(random() * options.length))];
    out = out.slice(0, m.index) + pick + out.slice(m.index + m[0].length);
  }
  return unshield(out);
}

/** How many different texts a template can produce (capped, for display). */
export function countVariations(template: string, cap = 1_000_000): number {
  let out = shield(String(template ?? ''));
  const combos = new Map<string, number>();
  const combosOf = (text: string): number => {
    let product = 1;
    for (const tok of text.match(/\u0003\d+\u0004/g) || []) product = Math.min(product * (combos.get(tok) || 1), cap);
    return product;
  };
  for (let i = 0; i < MAX_GROUPS; i++) {
    const m = GROUP_RE.exec(out);
    if (!m) break;
    let total = 0;
    for (const opt of new Set(m[1].split('|'))) total += combosOf(opt);
    const token = `\u0003${i}\u0004`;
    combos.set(token, Math.min(total, cap));
    out = out.slice(0, m.index) + token + out.slice(m.index + m[0].length);
  }
  return combosOf(out);
}

/** A brace left over after resolving the groups (e.g. an unclosed "{Hola|Buenas") would
 * reach the candidate verbatim — the editor warns about it before anyone saves. */
export function variationProblem(template: string): string | null {
  let out = shield(String(template ?? ''));
  for (let i = 0; i < MAX_GROUPS; i++) {
    const m = GROUP_RE.exec(out);
    if (!m) break;
    out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
  }
  return /[{}]/.test(out)
    ? 'Hay una llave { o } sin pareja: revisa las variaciones (formato: {opción 1|opción 2}) y las variables ({{nombre}}).'
    : null;
}

export interface MessageVars {
  nombre?: string;
  vacante?: string;
  empresa?: string;
  link?: string;
  fecha?: string;
  hora?: string;
  ubicacion?: string;
}

/**
 * The final text for one candidate: variations resolved with `random`, then variables.
 * Names are written the way people write them ("MARIA PEREZ" → "Maria Perez"), and the
 * "Procesando: cv.pdf" placeholder of a CV still being read is never used as a name.
 */
export function renderMessage(template: string, vars: MessageVars, random: () => number = Math.random): string {
  const rawName = vars.nombre || '';
  const name = isPlaceholderName(rawName) ? '' : prettifyName(rawName);
  const values: Record<string, string> = {
    nombre: name,
    primer_nombre: name.split(' ')[0] || '',
    vacante: vars.vacante || 'la vacante',
    empresa: vars.empresa || '',
    link: vars.link || '',
    fecha: vars.fecha || '',
    hora: vars.hora || '',
    ubicacion: vars.ubicacion || '',
  };
  return expandVariations(template, random)
    .replace(VAR_RE, (m, key: string) => (key in values ? values[key] : m))
    // An empty name must not leave "Hola , te escribimos…".
    .replace(/[ \t]+,/g, ',')
    .replace(/(\S)[ \t]{2,}/g, '$1 ');
}

/** The seed for one recipient of one notification: same inputs → same wording. */
export function messageSeed(phoneDigits: string, stage: string, vars: MessageVars): number {
  return hashSeed([phoneDigits, stage, vars.vacante || '', vars.fecha || '', vars.hora || ''].join('|'));
}
