import { describe, it, expect, vi } from 'vitest';

// The planner is pure; stub the Firebase bootstrap so importing the module stays offline.
vi.mock('./firebase', () => ({ db: {}, auth: { currentUser: null } }));

import { planVacancyMove } from './moveApplication';

const app = (id: string, candidateId: string, vacancyId: string) => ({ id, candidateId, vacancyId });

describe('planVacancyMove', () => {
  it('mueve una postulación a una vacante donde el candidato no está', () => {
    const a = app('c1_v1', 'c1', 'v1');
    const plan = planVacancyMove([a], 'v2', new Map([['c1', new Set(['v1'])]]));
    expect(plan.ready).toEqual([a]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.alreadyThere).toEqual([]);
  });

  it('no hace nada si ya está en la vacante destino', () => {
    const a = app('c1_v2', 'c1', 'v2');
    const plan = planVacancyMove([a], 'v2', new Map([['c1', new Set(['v2'])]]));
    expect(plan.alreadyThere).toEqual([a]);
    expect(plan.ready).toEqual([]);
  });

  it('no duplica: si el candidato ya tiene otra postulación en el destino, es conflicto', () => {
    const a = app('c1_v1', 'c1', 'v1');
    const plan = planVacancyMove([a], 'v2', new Map([['c1', new Set(['v1', 'v2'])]]));
    expect(plan.conflicts).toEqual([a]);
    expect(plan.ready).toEqual([]);
  });

  it('dos postulaciones seleccionadas de la misma persona: solo una llega al destino', () => {
    const a = app('c1_v1', 'c1', 'v1');
    const b = app('c1_v3', 'c1', 'v3');
    const plan = planVacancyMove([a, b], 'v2', new Map([['c1', new Set(['v1', 'v3'])]]));
    expect(plan.ready).toEqual([a]);
    expect(plan.conflicts).toEqual([b]);
  });

  it('un candidato sin datos previos se mueve sin problema', () => {
    const a = app('c9_v1', 'c9', 'v1');
    expect(planVacancyMove([a], 'v2', new Map()).ready).toEqual([a]);
  });
});
