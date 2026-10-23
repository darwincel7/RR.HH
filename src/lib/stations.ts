/**
 * Modo estación: los teléfonos de la empresa donde los candidatos responden el test
 * situacional, sin que nadie les pase un link.
 *
 * Cada teléfono se vincula UNA vez con un código de 6 dígitos que genera el panel
 * (`station_codes/{código}`: vence en 10 minutos y sirve una sola vez) y queda como un
 * documento de `stations` cuyo id es secreto: es la llave del teléfono, la guarda su
 * navegador y solo el equipo la ve. El teléfono nunca toca Firestore: cada pocos
 * segundos le pregunta al servidor si tiene un test asignado y le informa por dónde va.
 * Desde el perfil, la reclutadora le asigna el test de un candidato (`assignment`); el
 * teléfono lo abre solo, sin link a la vista, y al enviarlo el servidor lo deja libre.
 *
 * Aquí viven las reglas que comparten el servidor, el teléfono y el panel; las que
 * deciden una escritura son funciones puras (se prueban sin base de datos).
 */

export const STATIONS = 'stations';
export const STATION_CODES = 'station_codes';

export const PAIRING_CODE_TTL_MS = 10 * 60_000;
/** Cada cuánto el teléfono pregunta si tiene test. */
export const STATION_POLL_MS = 3000;
/** Cada cuánto, como mucho, se anota que el teléfono sigue vivo (es una escritura). */
export const STATION_SEEN_EVERY_MS = 30_000;
/** Sin noticias del teléfono en este tiempo, el panel lo muestra "Sin conexión". */
export const STATION_OFFLINE_AFTER_MS = 2 * 60_000;
export const STATION_NAME_MAX = 40;

export interface StationProgress {
  /** Pregunta en pantalla (0 = la primera); -1 mientras está en la portada. */
  index: number;
  total: number;
  exits: number;
  /** Cuando el candidato tocó "Sí, soy …". */
  confirmedAt?: unknown;
  at?: unknown;
}

export interface StationAssignment {
  applicationId: string;
  /** Para el panel (el teléfono no los recibe: el test pide su propio nombre corto). */
  candidateId?: string;
  candidateName: string;
  kind: 'test';
  assignedAt: unknown;
  assignedBy: string;
  progress?: StationProgress;
}

export interface Station {
  id: string;
  name: string;
  createdAt?: unknown;
  lastSeenAt?: unknown;
  assignment?: StationAssignment | null;
  lastDoneAt?: unknown;
  /** Día (hora de RD) de `doneToday`, para contar los tests terminados hoy. */
  doneDay?: string;
  doneToday?: number;
}

/** Firestore Timestamp, Date, número o ISO → milisegundos (0 si no hay). */
export function toMs(t: unknown): number {
  if (!t) return 0;
  if (typeof (t as any).toMillis === 'function') return (t as any).toMillis();
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return t;
  if (typeof (t as any).seconds === 'number') return (t as any).seconds * 1000;
  const ms = new Date(t as any).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** La postulación que tiene asignada, o '' si está libre. */
export function assignedApplicationId(station: Partial<Station> | null | undefined): string {
  const id = station?.assignment?.applicationId;
  return typeof id === 'string' ? id : '';
}

export type StationState = 'busy' | 'free' | 'offline';

/** Sin conexión manda: un teléfono apagado no está ni libre ni respondiendo. */
export function stationState(station: Partial<Station>, now: number): StationState {
  const seen = toMs(station.lastSeenAt);
  if (!seen || now - seen > STATION_OFFLINE_AFTER_MS) return 'offline';
  return assignedApplicationId(station) ? 'busy' : 'free';
}

export function normalizeStationName(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, STATION_NAME_MAX);
}

export const isPairingCode = (v: unknown): v is string => typeof v === 'string' && /^\d{6}$/.test(v);

/** "482913" → "482 913". */
export const formatPairingCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

/** Un código de 6 dígitos al azar (con ceros a la izquierda si tocan). */
export function newPairingCode(randomInt: (max: number) => number): string {
  return String(randomInt(1_000_000)).padStart(6, '0');
}

/** La fecha en hora de República Dominicana, "2026-10-23". */
export function dayKey(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });
}

/** Tests terminados hoy en este teléfono (el contador es de su último día con uno). */
export function doneTodayOf(station: Partial<Station>, now: number): number {
  return station.doneDay === dayKey(now) ? Math.max(0, Number(station.doneToday) || 0) : 0;
}

// ---------------------------------------------------------------------------
// Decisiones del servidor: reciben el documento como está DENTRO de la transacción y
// devuelven lo que hay que escribir (merge), o null para no escribir nada.
// ---------------------------------------------------------------------------

/** ¿Sirve este código de vinculación? Devuelve el motivo si no. */
export function pairingCodeProblem(codeDoc: any, now: number): string | null {
  if (!codeDoc) return 'Ese código no existe o ya se usó. Genera otro en el panel.';
  if (toMs(codeDoc.expiresAt) < now) return 'Ese código venció. Genera otro en el panel.';
  return null;
}

/** Lo que el teléfono necesita saber en cada consulta, y nada más. */
export function pollView(station: Partial<Station>) {
  const applicationId = assignedApplicationId(station);
  return {
    name: normalizeStationName(station.name),
    assignment: applicationId ? { applicationId, assignedAt: toMs(station.assignment?.assignedAt) } : null,
  };
}

/** Anotar que sigue vivo solo de vez en cuando: cada consulta no puede ser una escritura. */
export function needsSeenWrite(station: Partial<Station>, now: number): boolean {
  return now - toMs(station.lastSeenAt) >= STATION_SEEN_EVERY_MS;
}

export interface ProgressReport { index: number; total: number; exits: number }

/** El avance que informa el teléfono, solo si sigue siendo el test que tiene asignado
 * (si la reclutadora lo canceló o lo pasó a otro teléfono, ya no le toca escribir). */
export function decideProgress(station: Partial<Station> | null, applicationId: string, p: ProgressReport, now: Date) {
  if (!station || assignedApplicationId(station) !== applicationId) return null;
  const confirmed = p.index >= 0 && !station.assignment?.progress?.confirmedAt;
  return {
    lastSeenAt: now,
    assignment: {
      progress: { index: p.index, total: p.total, exits: p.exits, at: now, ...(confirmed ? { confirmedAt: now } : {}) },
    },
  };
}

/** Test enviado (o ya respondido): el teléfono queda libre y se cuenta en el día. */
export function decideFinish(station: Partial<Station> | null, applicationId: string, now: Date) {
  if (!station || assignedApplicationId(station) !== applicationId) return null;
  const today = dayKey(now.getTime());
  return {
    assignment: null,
    lastSeenAt: now,
    lastDoneAt: now,
    doneDay: today,
    doneToday: doneTodayOf(station, now.getTime()) + 1,
  };
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/** ¿Se puede mandar el test de esta postulación a este teléfono? El motivo si no. */
export function assignProblem(target: Partial<Station> | null, applicationId: string): string | null {
  if (!target) return 'Ese teléfono ya no está vinculado.';
  const current = assignedApplicationId(target);
  if (current && current !== applicationId) return 'Ese teléfono está ocupado con otro candidato.';
  return null;
}

/** "Pregunta 7 de 20", "En la portada (confirmando su nombre)", o '' sin avance aún. */
export function progressLabel(progress: Partial<StationProgress> | undefined): string {
  if (!progress || !Number.isFinite(progress.index)) return '';
  if ((progress.index as number) < 0) return 'En la portada, confirmando su nombre';
  return `Pregunta ${(progress.index as number) + 1} de ${progress.total}`;
}
