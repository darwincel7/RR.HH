import { PIPELINE_STAGES } from '../constants/stages';
import { normalizeText } from './smartSearch';

/**
 * Unificar dos perfiles del MISMO postulante.
 *
 * Por qué hay duplicados: `/api/apply` usa el UID de la sesión anónima como id del
 * candidato. Quien aplica otro día, desde otro teléfono o en otro navegador, nace como
 * un perfil nuevo — y si además escribió el número distinto, el deduplicado por
 * teléfono/correo no lo ve. Así es como la misma persona termina con un test en un
 * perfil y otro test en el otro.
 *
 * Reglas de la unificación, en una línea cada una:
 *  - Manda el perfil PRINCIPAL: del duplicado solo se toma lo que al principal le falta.
 *  - Nada se pierde. Lo que el principal ya tenía se conserva, y lo del duplicado que no
 *    cabe queda archivado en la postulación (`mergedEvidence`) para poder consultarlo.
 *  - Una postulación a una vacante donde el principal NO está, se MUEVE tal cual (mismo
 *    id, así los links /eval y /test ya enviados siguen funcionando).
 *  - Dos postulaciones a la MISMA vacante se combinan en una: la del principal se queda
 *    con la etapa más avanzada de las dos y con la evidencia que le faltaba.
 *  - El perfil duplicado no se borra: queda marcado con `mergedInto`, así ningún link
 *    viejo muere y el rastro de la unificación es auditable.
 *
 * Este módulo es PURO a propósito (sin Firestore): lo usan igual la pantalla, para
 * mostrar la vista previa antes de confirmar, y el servidor, para ejecutar la escritura.
 */

/** Datos del candidato que se completan desde el duplicado si en el principal están vacíos. */
export const CANDIDATE_FILL_FIELDS = [
  'fullName', 'email', 'phone', 'phoneNormalized', 'city',
  'cvUrl', 'cvFileType', 'photoUrl', 'photoStatus', 'photoSource',
  'aiExtraction', 'aiStatus', 'source',
];

/** Etapas que son un desenlace, no un avance: nunca ganan a una etapa activa. */
export const TERMINAL_STAGES = ['Descartado', 'Banco de talento'];

/**
 * La evidencia del proceso, por grupos. Se mueve en bloque: tomar las respuestas de un
 * test sin su puntuación (o al revés) dejaría una postulación que se contradice.
 */
export interface EvidenceGroup {
  key: string;
  label: string;
  fields: string[];
}

export const EVIDENCE_GROUPS: EvidenceGroup[] = [
  { key: 'stage2', label: 'Formulario de etapa 2', fields: ['stage2Answers', 'stage2Scoring', 'stage2SubmittedAt'] },
  { key: 'test', label: 'Test situacional', fields: ['testAnswers', 'testResults', 'testSubmittedAt'] },
  { key: 'interview', label: 'Entrevista (scorecard, notas y análisis IA)', fields: ['interviewScorecard', 'interviewObservation', 'interviewAiEvaluation'] },
  { key: 'personality', label: 'Test de personalidad', fields: ['personalityTest'] },
  { key: 'attendance', label: 'Asistencia a la entrevista', fields: ['interviewAttendance', 'interviewAttendanceLog', 'interviewInvitedAt', 'interviewLastInvitedAt', 'interviewInviteCount'] },
  { key: 'cv', label: 'CV y puntuación del CV', fields: ['cvUrl', 'cvFileType', 'scoreSummary', 'scoreSource', 'recommendation'] },
];

/** Vacío = no hay dato: null, undefined, '' o una lista/objeto sin nada dentro. */
export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (v instanceof Date) return false;
  // Solo un objeto PLANO puede estar vacío. Un Timestamp de Firestore (o cualquier
  // instancia de clase) no tiene claves propias enumerables y pasaría por "sin dato":
  // la fecha de un test se habría tratado como inexistente.
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    const plain = proto === Object.prototype || proto === null;
    return plain ? Object.keys(v as any).length === 0 : false;
  }
  return false;
}

/** ¿Este documento tiene algo de este grupo de evidencia? */
export function hasEvidence(doc: any, group: EvidenceGroup): boolean {
  return group.fields.some(f => !isEmptyValue(doc?.[f]));
}

/** Lo que el duplicado puede aportar a un campo vacío del principal. */
export function fillEmpty(primary: any, duplicate: any, fields: string[]): { fields: Record<string, any>; filled: string[] } {
  const out: Record<string, any> = {};
  const filled: string[] = [];
  for (const f of fields) {
    if (isEmptyValue(primary?.[f]) && !isEmptyValue(duplicate?.[f])) {
      out[f] = duplicate[f];
      filled.push(f);
    }
  }
  return { fields: out, filled };
}

/**
 * La más avanzada de dos etapas. Un descarte NO es un avance: entre una etapa activa y
 * una terminal gana la activa — unificar no puede resucitar un "Descartado" encima de
 * alguien que iba camino a la oferta, ni descartar a quien sigue en carrera.
 */
export function furthestStage(a: string, b: string): string {
  if (!a) return b || '';
  if (!b) return a;
  const activeA = !TERMINAL_STAGES.includes(a);
  const activeB = !TERMINAL_STAGES.includes(b);
  if (activeA !== activeB) return activeA ? a : b;
  return PIPELINE_STAGES.indexOf(a) >= PIPELINE_STAGES.indexOf(b) ? a : b;
}

export interface ApplicationMergePlan {
  /** La postulación del principal que sobrevive. */
  intoAppId: string;
  /** La del duplicado, que se absorbe y desaparece. */
  fromAppId: string;
  vacancyId: string;
  vacancyTitle: string;
  /** Campos a escribir en la postulación que sobrevive. */
  fields: Record<string, any>;
  /** Etiquetas de la evidencia que llega del duplicado. */
  taken: string[];
  /** Etiquetas de la evidencia que el duplicado traía pero el principal ya tenía: se archiva. */
  archived: string[];
  /** Esa evidencia archivada, tal cual, para guardarla en `mergedEvidence`. */
  archivedData: Record<string, any>;
  /** La etapa con la que queda la postulación unificada. */
  stage: string;
  /** La etapa cambió respecto a la que tenía el principal. */
  stageChanged: boolean;
}

/**
 * Combinar dos postulaciones a la MISMA vacante. La del principal se queda con la etapa
 * más avanzada y con la evidencia que le faltaba; la que el principal ya tenía se
 * conserva y la del duplicado se archiva en `mergedEvidence` (nada se borra en silencio).
 */
export function planApplicationMerge(
  primaryApp: any,
  dupApp: any,
  vacancyTitle = '',
): ApplicationMergePlan {
  const fields: Record<string, any> = {};
  const taken: string[] = [];
  const archived: string[] = [];
  const archivedData: Record<string, any> = {};

  for (const group of EVIDENCE_GROUPS) {
    if (!hasEvidence(dupApp, group)) continue;
    if (hasEvidence(primaryApp, group)) {
      // Los dos hicieron esta parte del proceso: se queda la del principal y la otra
      // se guarda, que es justo el caso de "un test en cada perfil".
      // El grupo entero se archiva y NO se mezcla nada suelto: la nota del principal
      // con las respuestas del duplicado dejaría una postulación que se contradice —
      // quien audite el Ranking leería respuestas que no producen esa puntuación.
      archived.push(group.label);
      group.fields.forEach(f => { if (!isEmptyValue(dupApp?.[f])) archivedData[f] = dupApp[f]; });
      continue;
    }
    taken.push(group.label);
    group.fields.forEach(f => { if (!isEmptyValue(dupApp?.[f])) fields[f] = dupApp[f]; });
  }

  const stage = furthestStage(primaryApp?.stage || '', dupApp?.stage || '');
  const stageChanged = !!stage && stage !== (primaryApp?.stage || '');
  if (stageChanged) fields.stage = stage;

  return {
    intoAppId: primaryApp?.id,
    fromAppId: dupApp?.id,
    vacancyId: primaryApp?.vacancyId || dupApp?.vacancyId || '',
    vacancyTitle,
    fields,
    taken,
    archived,
    archivedData,
    stage,
    stageChanged,
  };
}

export interface CandidateMergePlan {
  /** Campos del candidato principal que se completan con los del duplicado. */
  candidateFields: Record<string, any>;
  filled: string[];
  /** Teléfonos/correos distintos del duplicado: se guardan para que el buscador los encuentre. */
  alternatePhones: string[];
  alternateEmails: string[];
  /** Postulaciones que cambian de dueño tal cual (el principal no tenía esa vacante). */
  moves: Array<{ appId: string; vacancyId: string; vacancyTitle: string; stage: string }>;
  /** Postulaciones a la misma vacante que se combinan en una. */
  combines: ApplicationMergePlan[];
  /** Nada que unificar: son el mismo perfil o el duplicado está vacío. */
  empty: boolean;
}

/**
 * Qué va a pasar exactamente al unificar. La pantalla lo muestra antes de confirmar y el
 * servidor ejecuta esto mismo: una sola definición, así la vista previa no puede mentir.
 */
export function planCandidateMerge(args: {
  primary: any;
  primaryApps: any[];
  duplicate: any;
  duplicateApps: any[];
  vacancyTitles?: Record<string, string>;
}): CandidateMergePlan {
  const { primary, duplicate } = args;
  const primaryApps = args.primaryApps || [];
  const duplicateApps = args.duplicateApps || [];
  const titles = args.vacancyTitles || {};
  const titleOf = (vacancyId: string) => titles[vacancyId] || (vacancyId === 'bulk_upload' ? 'Subida masiva de CVs' : 'Vacante');

  const { fields: candidateFields, filled } = fillEmpty(primary, duplicate, CANDIDATE_FILL_FIELDS);

  // Un teléfono o correo distinto es casi siempre la RAZÓN del duplicado: se conserva
  // para que la próxima búsqueda por ese número encuentre a la persona.
  //
  // Incluidos los que el duplicado ya tenía guardados como alternativos: si no, unificar
  // dos veces (A→B y luego B→C) perdía el contacto de A, y la persona volvía a duplicarse
  // al aplicar con el número por el que nació el primer duplicado.
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const alternatePhones = [duplicate?.phone, duplicate?.phoneNormalized, ...list(duplicate?.alternatePhones)]
    .filter(p => !isEmptyValue(p))
    .map(p => String(p).trim())
    .filter(p => p !== String(primary?.phone || '').trim() && p !== String(primary?.phoneNormalized || '').trim());
  const alternateEmails = [duplicate?.email, ...list(duplicate?.alternateEmails)]
    .filter(e => !isEmptyValue(e))
    .map(e => String(e).trim())
    .filter(e => e.toLowerCase() !== String(primary?.email || '').trim().toLowerCase());

  // Una sola postulación del principal por vacante: la más avanzada, para no partir la
  // evidencia entre dos cuando el principal ya traía duplicados internos.
  const primaryByVacancy = new Map<string, any>();
  for (const app of primaryApps) {
    const key = app?.vacancyId || '';
    const current = primaryByVacancy.get(key);
    if (!current || furthestStage(current.stage || '', app.stage || '') === (app.stage || '')) {
      primaryByVacancy.set(key, app);
    }
  }

  const moves: CandidateMergePlan['moves'] = [];
  const combines: ApplicationMergePlan[] = [];
  for (const dupApp of duplicateApps) {
    const vacancyId = dupApp?.vacancyId || '';
    const target = primaryByVacancy.get(vacancyId);
    if (target) {
      combines.push(planApplicationMerge(target, dupApp, titleOf(vacancyId)));
    } else {
      moves.push({ appId: dupApp.id, vacancyId, vacancyTitle: titleOf(vacancyId), stage: dupApp?.stage || '' });
      // Dos postulaciones del duplicado a la misma vacante: la primera se muda y la
      // siguiente se combina con ella, nunca dos dueñas de la misma vacante.
      primaryByVacancy.set(vacancyId, dupApp);
    }
  }

  return {
    candidateFields,
    filled,
    alternatePhones: Array.from(new Set(alternatePhones)),
    alternateEmails: Array.from(new Set(alternateEmails)),
    moves,
    combines,
    empty: filled.length === 0 && moves.length === 0 && combines.length === 0
      && alternatePhones.length === 0 && alternateEmails.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Encontrar al duplicado
// ---------------------------------------------------------------------------

/**
 * Nombre comparable: sin acentos, sin mayúsculas, sin espacios de más. Usa el mismo
 * `normalizeText` que el buscador — con dos copias de la regla, un día el buscador y
 * este detector dejarían de estar de acuerdo en si dos nombres son la misma persona.
 */
export function normalizeName(name: unknown): string {
  return normalizeText(name).replace(/\s+/g, ' ').trim();
}

export type DuplicateReason = 'phone' | 'email' | 'name';

export interface DuplicateCandidate {
  id: string;
  /** Por qué se parece. El teléfono es la señal más fuerte; el nombre, la más débil. */
  reasons: DuplicateReason[];
  candidate: any;
}

/**
 * Los perfiles que podrían ser la misma persona: mismo teléfono normalizado, mismo
 * correo o mismo nombre. Se ordenan por fuerza de la señal, y el nombre solo entra si
 * coincide completo — "Ana" no sugiere unificar a todas las Anas.
 */
export function findDuplicateCandidates(
  target: { id: string; phoneNormalized?: string; phone?: string; email?: string; fullName?: string; name?: string },
  all: Array<any>,
): DuplicateCandidate[] {
  const phone = String(target.phoneNormalized || target.phone || '').trim();
  const email = String(target.email || '').trim().toLowerCase();
  const name = normalizeName(target.fullName || target.name);

  const out: DuplicateCandidate[] = [];
  for (const c of all || []) {
    if (!c?.id || c.id === target.id) continue;
    // Un perfil ya unificado en otro no se vuelve a ofrecer.
    if (c.mergedInto) continue;
    const reasons: DuplicateReason[] = [];
    const cPhone = String(c.phoneNormalized || c.phone || '').trim();
    if (phone && cPhone && cPhone === phone) reasons.push('phone');
    if (email && String(c.email || '').trim().toLowerCase() === email) reasons.push('email');
    if (name && name.length >= 5 && normalizeName(c.fullName || c.name) === name) reasons.push('name');
    if (reasons.length > 0) out.push({ id: c.id, reasons, candidate: c });
  }

  const weight = (r: DuplicateReason[]) =>
    (r.includes('phone') ? 4 : 0) + (r.includes('email') ? 2 : 0) + (r.includes('name') ? 1 : 0);
  return out.sort((a, b) => weight(b.reasons) - weight(a.reasons));
}

export const DUPLICATE_REASON_LABEL: Record<DuplicateReason, string> = {
  phone: 'mismo teléfono',
  email: 'mismo correo',
  name: 'mismo nombre',
};
