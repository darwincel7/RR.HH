import { describe, it, expect } from 'vitest';
import { buildPhotoQueue, isSalesVacancy, stageWeight, needsPhoto } from './serverPhotoBackfill';

const d = (iso: string) => new Date(iso);
const cand = (id: string, extra: Record<string, any> = {}) => ({ id, cvUrl: 'https://firebasestorage.googleapis.com/x', ...extra });

describe('isSalesVacancy', () => {
  it.each([
    ['Vendedora', true],
    ['Vendedor de mostrador', true],
    ['Asesor de Ventas y Soporte', true],
    ['VENTAS BANÍ', true],
    ['Técnico de Reparación', false],
    ['Cajero/a', false],
    [undefined, false],
  ])('%s → %s', (title, expected) => {
    expect(isSalesVacancy(title)).toBe(expected);
  });
});

describe('stageWeight', () => {
  it('más avanzado en el embudo pesa más; descartados al final', () => {
    expect(stageWeight('Finalista')).toBeGreaterThan(stageWeight('Nuevo'));
    expect(stageWeight('Descartado')).toBeLessThan(stageWeight('Nuevo'));
    expect(stageWeight('Banco de talento')).toBeLessThan(stageWeight('Nuevo'));
  });
});

describe('needsPhoto', () => {
  it('solo los que nunca se revisaron y tienen CV', () => {
    expect(needsPhoto(cand('a'))).toBe(true);
    expect(needsPhoto(cand('a', { aiStatus: 'pending' }))).toBe(true); // CV aún sin analizar: igual vale
    expect(needsPhoto(cand('a', { photoUrl: 'u' }))).toBe(false);
    expect(needsPhoto(cand('a', { photoStatus: 'none' }))).toBe(false);
    expect(needsPhoto(cand('a', { photoStatus: 'removed' }))).toBe(false);
    expect(needsPhoto(cand('a', { aiStatus: 'processing' }))).toBe(false);
    expect(needsPhoto({ id: 'a' })).toBe(false);
  });
});

describe('buildPhotoQueue', () => {
  const vacancies = [{ id: 'ventas', title: 'Vendedora' }, { id: 'tec', title: 'Técnico' }];

  it('primero el embudo de ventas, luego el resto y al final quien no tiene postulación', () => {
    const q = buildPhotoQueue({
      vacancies,
      applications: [
        { id: '1', candidateId: 'tecnico', vacancyId: 'tec', stage: 'Finalista', submittedAt: d('2026-10-01') },
        { id: '2', candidateId: 'vendedora', vacancyId: 'ventas', stage: 'Nuevo', submittedAt: d('2026-01-01') },
      ],
      candidates: [cand('tecnico'), cand('vendedora'), cand('suelto')],
    });
    expect(q).toEqual(['vendedora', 'tecnico', 'suelto']);
  });

  it('dentro de ventas: más avanzado primero, descartados al final, empate → más reciente', () => {
    const q = buildPhotoQueue({
      vacancies,
      applications: [
        { id: '1', candidateId: 'nuevo-viejo', vacancyId: 'ventas', stage: 'Nuevo', submittedAt: d('2026-01-01') },
        { id: '2', candidateId: 'nuevo-reciente', vacancyId: 'ventas', stage: 'Nuevo', submittedAt: d('2026-09-01') },
        { id: '3', candidateId: 'entrevista', vacancyId: 'ventas', stage: 'Entrevista presencial', submittedAt: d('2026-02-01') },
        { id: '4', candidateId: 'descartado', vacancyId: 'ventas', stage: 'Descartado', submittedAt: d('2026-10-01') },
      ],
      candidates: [cand('nuevo-viejo'), cand('nuevo-reciente'), cand('entrevista'), cand('descartado')],
    });
    expect(q).toEqual(['entrevista', 'nuevo-reciente', 'nuevo-viejo', 'descartado']);
  });

  it('un candidato en ventas y en otra vacante cuenta como de ventas, una sola vez', () => {
    const q = buildPhotoQueue({
      vacancies,
      applications: [
        { id: '1', candidateId: 'ambos', vacancyId: 'tec', stage: 'Finalista' },
        { id: '2', candidateId: 'ambos', vacancyId: 'ventas', stage: 'Nuevo' },
        { id: '3', candidateId: 'otro', vacancyId: 'tec', stage: 'Oferta' },
      ],
      candidates: [cand('ambos'), cand('otro')],
    });
    expect(q).toEqual(['ambos', 'otro']);
  });

  it('salta a quien ya tiene foto o ya fue revisado', () => {
    const q = buildPhotoQueue({
      vacancies,
      applications: [
        { id: '1', candidateId: 'con-foto', vacancyId: 'ventas' },
        { id: '2', candidateId: 'revisado', vacancyId: 'ventas' },
        { id: '3', candidateId: 'pendiente', vacancyId: 'ventas' },
      ],
      candidates: [cand('con-foto', { photoUrl: 'u' }), cand('revisado', { photoStatus: 'none' }), cand('pendiente')],
    });
    expect(q).toEqual(['pendiente']);
  });
});
