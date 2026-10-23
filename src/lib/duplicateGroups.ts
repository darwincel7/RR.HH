import { normalizeName, type DuplicateReason } from './mergeCandidates';
import { normalizePhone } from './phone';

/**
 * Los grupos de perfiles que parecen ser la misma persona, en TODA la base.
 *
 * El detector del perfil responde "¿este candidato está duplicado?". Esto responde la
 * pregunta que de verdad hace falta para limpiar: "¿cuántos duplicados tengo y cuáles
 * son?". Sin esta vista, un duplicado solo se descubre si alguien abre por casualidad
 * uno de los dos perfiles.
 *
 * Agrupa de forma TRANSITIVA (union-find): si A y B comparten el teléfono y B y C
 * comparten el correo, los tres son el mismo grupo. Tratarlos como dos parejas
 * independientes haría unificar dos veces lo mismo y dejaría a C fuera.
 */

export interface DuplicateGroup {
  /** Los perfiles del grupo, el más completo primero (el candidato natural a principal). */
  members: any[];
  /** Por qué quedaron juntos. El teléfono es la señal más fuerte; el nombre, la más débil. */
  reasons: DuplicateReason[];
}

/**
 * TODAS las claves de teléfono de un candidato, en forma canónica: la principal y las
 * alternativas que dejó una unificación. Sin las alternativas, un tercer perfil que use
 * como número principal el que quedó guardado como alternativo en otro no se agruparía
 * nunca — y es justo el número por el que nació el duplicado.
 */
const phoneKeysOf = (c: any): string[] => {
  const raw = [c?.phoneNormalized, c?.phone, ...(Array.isArray(c?.alternatePhones) ? c.alternatePhones : [])];
  return raw
    .filter(Boolean)
    .map(p => normalizePhone(String(p)))
    .filter(Boolean)
    .map(p => `phone:${p}`);
};

const emailKeysOf = (c: any): string[] => {
  const raw = [c?.email, ...(Array.isArray(c?.alternateEmails) ? c.alternateEmails : [])];
  return raw
    .filter(Boolean)
    .map(e => String(e).trim().toLowerCase())
    .filter(Boolean)
    .map(e => `email:${e}`);
};

/**
 * El nombre solo agrupa si está completo (nombre y apellido): con "Ana" o "José" se
 * juntarían personas distintas, y una unificación equivocada no se deshace con un botón.
 */
const nameKeysOf = (c: any): string[] => {
  const name = normalizeName(c?.fullName || c?.name);
  if (name.length < 6 || !name.includes(' ')) return [];
  return [`name:${name}`];
};

/** Cuánta información tiene un perfil: el más completo es el mejor candidato a principal. */
export function profileRichness(c: any): number {
  let score = 0;
  if (c?.fullName || c?.name) score += 1;
  if (c?.phone) score += 2;
  if (c?.email) score += 2;
  if (c?.city) score += 1;
  if (c?.cvUrl) score += 3;
  if (c?.aiExtraction) score += 3;
  if (c?.photoUrl) score += 1;
  return score;
}

const REASON_WEIGHT: Record<DuplicateReason, number> = { phone: 4, email: 2, name: 1 };

/**
 * Agrupa una lista de candidatos (`{ id, ...datos }`). Los perfiles ya unificados
 * (`mergedInto`) quedan fuera: su contenido ya vive en otro.
 *
 * Los grupos salen ordenados por fuerza de la señal y, dentro de cada uno, el perfil más
 * completo primero.
 */
export function groupDuplicates(candidates: any[]): DuplicateGroup[] {
  const pool = (candidates || []).filter(c => c?.id && !c.mergedInto);

  // Union-find sobre los índices del pool.
  const parent = pool.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Cada clave compartida une a sus dueños, y se recuerda QUÉ clave los unió.
  const byKey = new Map<string, number[]>();
  pool.forEach((c, i) => {
    [...phoneKeysOf(c), ...emailKeysOf(c), ...nameKeysOf(c)].forEach(key => {
      const list = byKey.get(key) || [];
      // Un mismo perfil puede aportar la misma clave dos veces (phone y phoneNormalized).
      if (list[list.length - 1] !== i) list.push(i);
      byKey.set(key, list);
    });
  });

  const reasonsByRoot = new Map<number, Set<DuplicateReason>>();
  byKey.forEach((indexes, key) => {
    if (new Set(indexes).size < 2) return;
    for (let i = 1; i < indexes.length; i++) union(indexes[0], indexes[i]);
    const reason = key.split(':')[0] as DuplicateReason;
    const root = find(indexes[0]);
    const set = reasonsByRoot.get(root) || new Set<DuplicateReason>();
    set.add(reason);
    reasonsByRoot.set(root, set);
  });

  // Las raíces pueden haber cambiado al unir: se reagrupan las razones al final.
  const membersByRoot = new Map<number, any[]>();
  pool.forEach((c, i) => {
    const root = find(i);
    const list = membersByRoot.get(root) || [];
    list.push(c);
    membersByRoot.set(root, list);
  });
  const finalReasons = new Map<number, Set<DuplicateReason>>();
  reasonsByRoot.forEach((set, root) => {
    const real = find(root);
    const merged = finalReasons.get(real) || new Set<DuplicateReason>();
    set.forEach(r => merged.add(r));
    finalReasons.set(real, merged);
  });

  const groups: DuplicateGroup[] = [];
  membersByRoot.forEach((members, root) => {
    if (members.length < 2) return;
    groups.push({
      members: [...members].sort((a, b) => profileRichness(b) - profileRichness(a)),
      reasons: Array.from(finalReasons.get(root) || []).sort((a, b) => REASON_WEIGHT[b] - REASON_WEIGHT[a]),
    });
  });

  return groups.sort((a, b) => {
    const wa = Math.max(0, ...a.reasons.map(r => REASON_WEIGHT[r]));
    const wb = Math.max(0, ...b.reasons.map(r => REASON_WEIGHT[r]));
    if (wa !== wb) return wb - wa;
    return b.members.length - a.members.length;
  });
}

/** Cuántos perfiles sobran en total (lo que se eliminaría de la base al unificar todo). */
export function countRedundantProfiles(groups: DuplicateGroup[]): number {
  return groups.reduce((n, g) => n + g.members.length - 1, 0);
}
