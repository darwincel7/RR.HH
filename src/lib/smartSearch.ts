import { normalizePhone } from './phone';

/**
 * Smart search over candidates: name, phone, email, where they live, the vacancy, the
 * CV analysis and — most importantly — the notes the team wrote about them.
 *
 * What makes it "smart" (and why each piece exists):
 *  - Accent/case-insensitive: "bani" finds "Baní", "jose" finds "José".
 *  - Every word must match, but each one may match in a DIFFERENT field:
 *    "maria bani" finds María who lives in Baní.
 *  - Phone-aware: "8095551234", "809-555-1234" and "1 809 555 1234" are the same
 *    number; partial digits ("5551234") also match.
 *  - "Quoted phrases" match as a whole.
 *  - Optional fuzzy mode for typos and Dominican spelling variants
 *    ("Rodrigues" ~ "Rodríguez", "Yoselin" ~ "Joselin", "Vladimir" ~ "Bladimir").
 *  - Reports WHERE it matched (with a snippet) so the recruiter sees why a candidate
 *    came up — e.g. a hit inside a note.
 *
 * Pure module: no Firestore, no React — pinned by smartSearch.test.ts.
 */

export interface SearchField {
  /** Human label shown in the "matched in" hint (e.g. "Notas", "Teléfono"). */
  label: string;
  /** One or many texts. Empty values are ignored. */
  value: string | number | null | undefined | Array<string | number | null | undefined>;
  /** Phone fields compare digit-by-digit with Dominican/NANP normalization. */
  kind?: 'text' | 'phone';
}

export interface SearchHit {
  label: string;
  /** Snippet split around the first match, ready to render with a highlight. */
  before: string;
  match: string;
  after: string;
}

export interface SearchResult {
  matched: boolean;
  hits: SearchHit[];
}

const DIACRITICS = /[̀-ͯ]/g;

/** Lowercase + strip accents. "Baní" → "bani", "PEÑA" → "pena". */
export function normalizeText(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

/**
 * Normalizes while remembering, for every output char, which input char it came from,
 * so a match found in the normalized text can be cut out of the ORIGINAL text (with its
 * accents) for the snippet.
 */
function normalizeWithMap(s: string): { norm: string; map: number[] } {
  // Fast path for plain ASCII (most emails, phones, many notes): 1:1 positions.
  if (/^[\x00-\x7f]*$/.test(s)) return { norm: s.toLowerCase(), map: Array.from({ length: s.length }, (_, i) => i) };
  const out: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 128) {
      // ASCII needs no accent stripping — skip the (slow) per-char normalize().
      out.push(code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : s[i]);
      map.push(i);
      continue;
    }
    const n = s[i].normalize('NFD').replace(DIACRITICS, '').toLowerCase();
    for (let k = 0; k < n.length; k++) { out.push(n[k]); map.push(i); }
  }
  return { norm: out.join(''), map };
}

/** Splits the query into words, keeping "quoted phrases" together. */
export function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const t = normalizeText((m[1] ?? m[2]).trim()).replace(/\s+/g, ' ');
    // Lone punctuation ("-", ",") is noise, not a search term.
    if (t && /[\p{L}\p{N}]/u.test(t)) tokens.push(t);
  }
  return tokens;
}

/** A token that looks like (part of) a phone number: ≥4 digits and only phone chars. */
function phoneDigits(token: string): string | null {
  if (!/^[\d\s()+.\-]+$/.test(token)) return null;
  const digits = token.replace(/\D/g, '');
  return digits.length >= 4 ? digits : null;
}

/**
 * Spelling-variant key for fuzzy matching. Collapses the letters Dominican names and
 * places are most often written with interchangeably: z/s/c(e,i), v/b, ll/y, j/y at the
 * start, silent h, qu/k/c(a,o,u), w/u, and doubled letters.
 */
export function phoneticKey(word: string): string {
  return normalizeText(word)
    .replace(/[^a-z0-9ñ]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/ch/g, '§')        // protect "ch" before dropping silent h
    .replace(/h/g, '')
    .replace(/§/g, 'ch')
    .replace(/qu/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/w/g, 'u')
    .replace(/ll/g, 'y')
    .replace(/^j/, 'y')
    .replace(/x/g, 'ks')
    .replace(/(.)\1+/g, '$1');
}

/**
 * Edit distance counting a swap of two adjacent letters as ONE edit ("maira" → "maria"),
 * the most common typing slip. Exits early once it exceeds `max`.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      }
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

function fuzzyKeyMatch(tk: string, wk: string): boolean {
  if (tk.length < 4 || wk.length < 2) return false;
  if (wk.startsWith(tk) && tk.length >= 4) return true;
  const allowed = tk.length >= 8 ? 2 : 1;
  return editDistance(tk, wk, allowed) <= allowed;
}

const SNIPPET_RADIUS = 40;

function makeHit(label: string, original: string, start: number, end: number): SearchHit {
  const from = Math.max(0, start - SNIPPET_RADIUS);
  const to = Math.min(original.length, end + SNIPPET_RADIUS);
  return {
    label,
    before: (from > 0 ? '…' : '') + original.slice(from, start).replace(/\s+/g, ' '),
    match: original.slice(start, end),
    after: original.slice(end, to).replace(/\s+/g, ' ') + (to < original.length ? '…' : ''),
  };
}

export interface PreparedText {
  label: string;
  kind: 'text' | 'phone';
  original: string;
  norm: string;
  map: number[];
  /** The text's digits, in order (numbers separated by '|'), with their position in `original`. */
  digits: string;
  digitMap: number[];
  /** Phone fields only: canonical form (leading "1" for DR numbers). */
  canonical: string;
  /** Fuzzy mode only, built on first use and then reused: each word's phonetic key. */
  words?: { key: string; start: number; end: number }[];
}

/**
 * Pre-normalizes a record's fields. Do it once per record and pass the result to
 * smartMatch so typing in the search box doesn't re-normalize thousands of notes.
 */
export function prepareSearch(fields: SearchField[]): PreparedText[] {
  const out: PreparedText[] = [];
  for (const f of fields) {
    const values = Array.isArray(f.value) ? f.value : [f.value];
    for (const v of values) {
      if (v === null || v === undefined) continue;
      const original = String(v);
      if (!original.trim()) continue;
      const { norm, map } = normalizeWithMap(original);
      let digits = '';
      const digitMap: number[] = [];
      for (let i = 0; i < original.length; i++) {
        const ch = original[i];
        if (ch >= '0' && ch <= '9') { digits += ch; digitMap.push(i); }
        // Only phone separators may sit inside a number; anything else (a letter, a
        // comma) ends it, so "2 hijos, 809…" never fuses into "2809…".
        else if (!' -.()+'.includes(ch) && !digits.endsWith('|')) { digits += '|'; digitMap.push(-1); }
      }
      const kind = f.kind ?? 'text';
      // Phone fields also index the canonical form so both "8095551234" and
      // "18095551234" find the same candidate.
      const canonical = kind === 'phone' ? normalizePhone(original) : '';
      out.push({ label: f.label, kind, original, norm, map, digits, digitMap, canonical });
    }
  }
  return out;
}

function isPrepared(f: SearchField[] | PreparedText[]): f is PreparedText[] {
  return f.length > 0 && typeof (f[0] as PreparedText).norm === 'string';
}

/** Finds `token` in one prepared text; returns the original-text span or null. */
function findIn(t: PreparedText, token: string, fuzzy: boolean): [number, number] | null {
  const idx = t.norm.indexOf(token);
  if (idx !== -1) {
    const start = t.map[idx];
    const end = t.map[idx + token.length - 1] + 1;
    return [start, end];
  }

  const pd = phoneDigits(token);
  if (pd) {
    // "1 809…" typed with the country code must still find a number stored without it.
    const variants = pd.length === 11 && pd.startsWith('1') ? [pd, pd.slice(1)] : [pd];
    for (const v of variants) {
      // Digits may be split by separators in the text ("809 555-1234"): match on the
      // digit sequence and map back to the original span for the highlight.
      const di = t.digits.indexOf(v);
      if (di !== -1) return [t.digitMap[di], t.digitMap[di + v.length - 1] + 1];
      if (t.canonical.includes(v)) return [0, t.original.length];
    }
  }

  if (fuzzy && !token.includes(' ') && token.length >= 4) {
    if (!t.words) {
      t.words = [];
      const wordRe = /[\p{L}\p{N}]+/gu;
      let m: RegExpExecArray | null;
      while ((m = wordRe.exec(t.norm)) !== null) {
        if (m[0].length < 3) continue;
        t.words.push({ key: phoneticKey(m[0]), start: t.map[m.index], end: t.map[m.index + m[0].length - 1] + 1 });
      }
    }
    const tk = phoneticKey(token);
    for (const w of t.words) {
      if (fuzzyKeyMatch(tk, w.key)) return [w.start, w.end];
    }
  }
  return null;
}

/**
 * Matches a query against a record's fields. Every token must be found in at least one
 * field (AND across tokens, OR across fields). An empty query matches everything.
 */
export function smartMatch(
  fields: SearchField[] | PreparedText[],
  query: string,
  opts: { fuzzy?: boolean } = {},
): SearchResult {
  const tokens = tokenize(query);
  if (tokens.length === 0) return { matched: true, hits: [] };

  const texts = isPrepared(fields) ? fields : prepareSearch(fields as SearchField[]);
  const hits: SearchHit[] = [];
  const hitKeys = new Set<string>();

  for (const token of tokens) {
    let found = false;
    for (const t of texts) {
      const span = findIn(t, token, !!opts.fuzzy);
      if (!span) continue;
      found = true;
      // One hit per field label is enough to explain the match.
      if (!hitKeys.has(t.label)) {
        hitKeys.add(t.label);
        hits.push(makeHit(t.label, t.original, span[0], span[1]));
      }
    }
    if (!found) return { matched: false, hits: [] };
  }
  return { matched: true, hits };
}
