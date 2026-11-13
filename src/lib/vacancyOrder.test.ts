import { describe, it, expect } from 'vitest';
import { sortVacanciesForDisplay, moveVacancy } from './vacancyOrder';

describe('sortVacanciesForDisplay', () => {
  it('ordena por displayOrder ascendente', () => {
    const out = sortVacanciesForDisplay([
      { id: 'a', displayOrder: 2 }, { id: 'b', displayOrder: 0 }, { id: 'c', displayOrder: 1 },
    ]);
    expect(out.map(v => v.id)).toEqual(['b', 'c', 'a']);
  });

  it('pone primero las que nunca se ordenaron, de la más nueva a la más vieja', () => {
    const out = sortVacanciesForDisplay([
      { id: 'ordenada', displayOrder: 0 },
      { id: 'vieja', createdAt: { seconds: 100 } },
      { id: 'nueva', createdAt: { _seconds: 200 } }, // formato JSON del Admin SDK
    ]);
    expect(out.map(v => v.id)).toEqual(['nueva', 'vieja', 'ordenada']);
  });

  it('no modifica el arreglo original', () => {
    const input = [{ id: 'a', displayOrder: 1 }, { id: 'b', displayOrder: 0 }];
    sortVacanciesForDisplay(input);
    expect(input.map(v => v.id)).toEqual(['a', 'b']);
  });
});

describe('moveVacancy', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('sube una vacante y renumera toda la lista', () => {
    expect(moveVacancy(list, 'c', -1)).toEqual([
      { id: 'a', displayOrder: 0 }, { id: 'c', displayOrder: 1 }, { id: 'b', displayOrder: 2 },
    ]);
  });

  it('baja una vacante', () => {
    expect(moveVacancy(list, 'a', 1)?.map(v => v.id)).toEqual(['b', 'a', 'c']);
  });

  it('no mueve más allá de los extremos', () => {
    expect(moveVacancy(list, 'a', -1)).toBeNull();
    expect(moveVacancy(list, 'c', 1)).toBeNull();
    expect(moveVacancy(list, 'x', 1)).toBeNull();
  });
});
