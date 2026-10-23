import { describe, it, expect } from 'vitest';
import {
  stationState, assignedApplicationId, normalizeStationName, isPairingCode, formatPairingCode, newPairingCode,
  dayKey, doneTodayOf, pairingCodeProblem, pollView, needsSeenWrite, decideProgress, decideFinish, assignProblem,
  progressLabel, toMs, STATION_OFFLINE_AFTER_MS, STATION_SEEN_EVERY_MS,
} from './stations';

const NOW = Date.UTC(2026, 9, 23, 15, 0, 0); // 11:00 a. m. en RD
const busy = { name: 'Teléfono 2', lastSeenAt: NOW - 5_000, assignment: { applicationId: 'app1', candidateName: 'Juan', kind: 'test' as const, assignedAt: NOW - 60_000, assignedBy: 'ana' } };

describe('estado de un teléfono', () => {
  it('libre, ocupado o sin conexión', () => {
    expect(stationState({ lastSeenAt: NOW - 1000 }, NOW)).toBe('free');
    expect(stationState(busy, NOW)).toBe('busy');
    expect(stationState({ ...busy, lastSeenAt: NOW - STATION_OFFLINE_AFTER_MS - 1 }, NOW)).toBe('offline');
    expect(stationState({}, NOW)).toBe('offline');
  });

  it('una asignación a medias (sin postulación) no lo ocupa', () => {
    expect(assignedApplicationId({ assignment: { progress: { index: 1 } } } as any)).toBe('');
    expect(assignedApplicationId({ assignment: null })).toBe('');
  });

  it('lee las fechas como vengan', () => {
    expect(toMs({ toMillis: () => 5 })).toBe(5);
    expect(toMs({ seconds: 2 })).toBe(2000);
    expect(toMs(new Date(7))).toBe(7);
    expect(toMs(undefined)).toBe(0);
  });
});

describe('vincular', () => {
  it('nombres limpios y cortos', () => {
    expect(normalizeStationName('  Teléfono   2 ')).toBe('Teléfono 2');
    expect(normalizeStationName('x'.repeat(80))).toHaveLength(40);
    expect(normalizeStationName(undefined)).toBe('');
  });

  it('códigos de 6 dígitos, con ceros a la izquierda', () => {
    expect(newPairingCode(() => 42)).toBe('000042');
    expect(isPairingCode('000042')).toBe(true);
    expect(isPairingCode('12345')).toBe(false);
    expect(isPairingCode(123456)).toBe(false);
    expect(formatPairingCode('482913')).toBe('482 913');
  });

  it('un código que no existe o venció no sirve', () => {
    expect(pairingCodeProblem(null, NOW)).toMatch(/no existe/);
    expect(pairingCodeProblem({ expiresAt: NOW - 1 }, NOW)).toMatch(/venció/);
    expect(pairingCodeProblem({ expiresAt: NOW + 60_000 }, NOW)).toBeNull();
  });
});

describe('lo que el teléfono pregunta y cuenta', () => {
  it('solo recibe su nombre y el test asignado', () => {
    expect(pollView(busy)).toEqual({ name: 'Teléfono 2', assignment: { applicationId: 'app1', assignedAt: NOW - 60_000 } });
    expect(pollView({ name: 'Teléfono 3', assignment: null })).toEqual({ name: 'Teléfono 3', assignment: null });
  });

  it('anota que sigue vivo cada tanto, no en cada consulta', () => {
    expect(needsSeenWrite({ lastSeenAt: NOW - 1000 }, NOW)).toBe(false);
    expect(needsSeenWrite({ lastSeenAt: NOW - STATION_SEEN_EVERY_MS }, NOW)).toBe(true);
    expect(needsSeenWrite({}, NOW)).toBe(true);
  });

  it('el avance se escribe solo si sigue siendo su test, y la confirmación una vez', () => {
    const now = new Date(NOW);
    const first = decideProgress(busy, 'app1', { index: 0, total: 20, exits: 0 }, now);
    expect(first?.assignment.progress).toEqual({ index: 0, total: 20, exits: 0, at: now, confirmedAt: now });
    const confirmed = { ...busy, assignment: { ...busy.assignment, progress: { index: 0, total: 20, exits: 0, confirmedAt: NOW } } };
    expect(decideProgress(confirmed, 'app1', { index: 3, total: 20, exits: 1 }, now)?.assignment.progress).not.toHaveProperty('confirmedAt');
    // En la portada aún no ha confirmado.
    expect(decideProgress(busy, 'app1', { index: -1, total: 20, exits: 0 }, now)?.assignment.progress).not.toHaveProperty('confirmedAt');
    // Cancelado o pasado a otro teléfono: no le toca escribir.
    expect(decideProgress(busy, 'otra', { index: 1, total: 20, exits: 0 }, now)).toBeNull();
    expect(decideProgress(null, 'app1', { index: 1, total: 20, exits: 0 }, now)).toBeNull();
  });

  it('al terminar queda libre y suma al día (hora de RD)', () => {
    const now = new Date(NOW);
    expect(decideFinish(busy, 'app1', now)).toEqual({
      assignment: null, lastSeenAt: now, lastDoneAt: now, doneDay: '2026-10-23', doneToday: 1,
    });
    expect(decideFinish({ ...busy, doneDay: '2026-10-23', doneToday: 4 }, 'app1', now)?.doneToday).toBe(5);
    expect(decideFinish({ ...busy, doneDay: '2026-10-22', doneToday: 9 }, 'app1', now)?.doneToday).toBe(1);
    expect(decideFinish(busy, 'otra', now)).toBeNull();
  });

  it('el día cambia a medianoche de RD, no de UTC', () => {
    expect(dayKey(Date.UTC(2026, 9, 24, 3, 30))).toBe('2026-10-23'); // 11:30 p. m. en RD
    expect(doneTodayOf({ doneDay: '2026-10-22', doneToday: 3 }, NOW)).toBe(0);
  });
});

describe('panel', () => {
  it('no se le manda un test a un teléfono ocupado con otra persona', () => {
    expect(assignProblem(busy, 'otra')).toMatch(/ocupado/);
    expect(assignProblem(busy, 'app1')).toBeNull(); // reenviar el mismo no estorba
    expect(assignProblem({ name: 'T3', assignment: null }, 'app1')).toBeNull();
    expect(assignProblem(null, 'app1')).toMatch(/ya no está vinculado/);
  });

  it('describe el avance', () => {
    expect(progressLabel({ index: 6, total: 20 })).toBe('Pregunta 7 de 20');
    expect(progressLabel({ index: -1, total: 20 })).toMatch(/portada/);
    expect(progressLabel(undefined)).toBe('');
  });
});
