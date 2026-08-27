import { describe, it, expect } from 'vitest';
import { stageMayAutoSend, stageNeedsScheduling } from './whatsapp';
import { PIPELINE_STAGES } from '../constants/stages';

/**
 * These two predicates decide whether moving a candidate fires a WhatsApp message.
 * Both have already caused real incidents:
 *  - invitations went out with an empty "Fecha: / Hora: ()" because a plain Kanban move
 *    sent a message that needed appointment data;
 *  - bulk moves warned "messages won't be sent" for stages that never send anything.
 */
describe('stageMayAutoSend', () => {
  it('is true only for stages that actually have a message template', () => {
    expect(stageMayAutoSend('Contacto WhatsApp 1')).toBe(true);
    expect(stageMayAutoSend('Formulario etapa 2 enviado')).toBe(true);
    expect(stageMayAutoSend('Descartado')).toBe(true);
    expect(stageMayAutoSend('Banco de talento')).toBe(true);
  });

  it('is false for the stages that send nothing', () => {
    // Returning true here is what produced the pointless "WhatsApp offline" warning
    // during a bulk move, for stages with no template at all.
    expect(stageMayAutoSend('Nuevo')).toBe(false);
    expect(stageMayAutoSend('Aplicó')).toBe(false);
    expect(stageMayAutoSend('CV recibido')).toBe(false);
    expect(stageMayAutoSend('Revisión humana')).toBe(false);
  });

  it('is false for in-person stages, which the recruiter handles face to face', () => {
    expect(stageMayAutoSend('Tests presenciales')).toBe(false);
    expect(stageMayAutoSend('Contratado')).toBe(false);
  });

  it('is false for an unknown stage', () => {
    expect(stageMayAutoSend('')).toBe(false);
    expect(stageMayAutoSend('Etapa Inventada')).toBe(false);
  });
});

describe('stageNeedsScheduling', () => {
  it('flags the stages whose message needs a real date and time', () => {
    expect(stageNeedsScheduling('Convocado a entrevista')).toBe(true);
    expect(stageNeedsScheduling('Entrevista presencial')).toBe(true);
    expect(stageNeedsScheduling('Oferta')).toBe(true);
  });

  it('does not flag stages that send immediately', () => {
    expect(stageNeedsScheduling('Contacto WhatsApp 1')).toBe(false);
    expect(stageNeedsScheduling('Descartado')).toBe(false);
    expect(stageNeedsScheduling('Nuevo')).toBe(false);
  });
});

describe('invariante entre ambas', () => {
  it('no stage both auto-sends and requires scheduling', () => {
    // If a stage were in both lists, a plain Kanban move would fire the invitation
    // WITHOUT the appointment — exactly the "Fecha: / Hora: ()" bug.
    const enAmbas = PIPELINE_STAGES.filter(s => stageMayAutoSend(s) && stageNeedsScheduling(s));
    expect(enAmbas).toEqual([]);
  });

  it('every scheduling stage is a real stage of the funnel', () => {
    // A typo here would silently disable the guard for that stage.
    for (const stage of ['Convocado a entrevista', 'Entrevista presencial', 'Oferta']) {
      expect(PIPELINE_STAGES).toContain(stage);
    }
  });
});
