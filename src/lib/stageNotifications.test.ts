import { describe, it, expect, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }));
const { stageHasMessage, isStageMuted } = await import('./stageNotifications');

describe('stageHasMessage', () => {
  it('only stages that can send something get a switch', () => {
    expect(stageHasMessage('Formulario etapa 2 enviado')).toBe(true);
    expect(stageHasMessage('Descartado')).toBe(true);
    expect(stageHasMessage('Nuevo')).toBe(false);          // no template
    expect(stageHasMessage('Contratado')).toBe(false);     // handled in person
  });

  it('follows the templates configured in Configuración', () => {
    expect(stageHasMessage('Contacto WhatsApp 1', { 'Contacto WhatsApp 1': 'Hola {{nombre}}' })).toBe(true);
    expect(stageHasMessage('Descartado', { Descartado: '   ' })).toBe(true); // blank → the default still goes out
    expect(stageHasMessage('Tests presenciales', { 'Tests presenciales': 'Hola' })).toBe(false);
  });
});

describe('isStageMuted', () => {
  it('is ON unless explicitly switched off', () => {
    expect(isStageMuted(null, 'Descartado')).toBe(false);
    expect(isStageMuted({}, 'Descartado')).toBe(false);
    expect(isStageMuted({ off: { Descartado: false } }, 'Descartado')).toBe(false);
    expect(isStageMuted({ off: { Descartado: true } }, 'Descartado')).toBe(true);
    expect(isStageMuted({ off: { Descartado: true } }, 'Oferta')).toBe(false);
  });
});
