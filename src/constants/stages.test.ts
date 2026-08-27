import { describe, it, expect } from 'vitest';
import { PIPELINE_STAGES, STAGE_INFO } from './stages';

/**
 * The funnel is defined in two places that must agree: the ordered list of columns and
 * the map of explanations shown under each header. Adding a stage to one and forgetting
 * the other is an easy, silent mistake — the column just renders with no description.
 */
describe('etapas del embudo', () => {
  it('every stage has an explanation', () => {
    const sinDescripcion = PIPELINE_STAGES.filter(stage => !STAGE_INFO[stage]);
    expect(sinDescripcion).toEqual([]);
  });

  it('has no explanation for a stage that no longer exists', () => {
    const huerfanas = Object.keys(STAGE_INFO).filter(stage => !PIPELINE_STAGES.includes(stage));
    expect(huerfanas).toEqual([]);
  });

  it('has no duplicate stages', () => {
    // A duplicate would render two identical columns and split the same candidates
    // across both.
    expect(new Set(PIPELINE_STAGES).size).toBe(PIPELINE_STAGES.length);
  });

  it("starts at 'Nuevo' — where every application lands", () => {
    // /api/apply and both bulk uploads hardcode stage: 'Nuevo'. If the first column
    // were renamed, new candidates would arrive into a column that isn't shown.
    expect(PIPELINE_STAGES[0]).toBe('Nuevo');
  });

  it("keeps 'Descartado' and 'Banco de talento' as the last two", () => {
    // They are outcomes, not steps: the board renders them at the end, after 'Contratado'.
    expect(PIPELINE_STAGES.slice(-2)).toEqual(['Descartado', 'Banco de talento']);
  });

  it('keeps the hiring stages in their real-world order', () => {
    // The ranking and the reports read progress from this order; shuffling it would make
    // a finalist look like they went backwards.
    const orden = ['Nuevo', 'Precalificado', 'Convocado a entrevista', 'Finalista', 'Oferta', 'Contratado'];
    const posiciones = orden.map(s => PIPELINE_STAGES.indexOf(s));
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
    expect(posiciones).not.toContain(-1);
  });
});
