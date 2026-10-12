import { describe, it, expect } from 'vitest';
import { prettifyName, firstNameOf, isPlaceholderName } from './personName';

describe('prettifyName', () => {
  it('fixes names shouted in ALL CAPS, keeping surname particles lowercase', () => {
    expect(prettifyName('MARIA DE LOS ANGELES PEREZ')).toBe('Maria de los Angeles Perez');
    expect(prettifyName('JOSÉ   ÁLVAREZ')).toBe('José Álvarez');
  });

  it('fixes names typed all in lowercase', () => {
    expect(prettifyName('ana maría-josé de la cruz')).toBe('Ana María-José de la Cruz');
  });

  it('leaves a name with deliberate mixed casing exactly as typed', () => {
    expect(prettifyName('Juan McDonald')).toBe('Juan McDonald');
    expect(prettifyName('maría DeLeón')).toBe('maría DeLeón');
  });

  it('copes with empty and odd input', () => {
    expect(prettifyName('')).toBe('');
    expect(prettifyName(undefined as any)).toBe('');
    expect(prettifyName('  123  ')).toBe('123');
  });
});

describe('firstNameOf', () => {
  it('greets people by their first name', () => {
    expect(firstNameOf('MARIA DE LOS ANGELES PEREZ')).toBe('Maria');
    expect(firstNameOf('Luis Ángel Martínez')).toBe('Luis');
  });

  it('never greets anyone with the "Procesando: cv.pdf" placeholder', () => {
    expect(isPlaceholderName('Procesando: cv_juan.pdf')).toBe(true);
    expect(firstNameOf('Procesando: cv_juan.pdf')).toBe('');
    expect(firstNameOf('')).toBe('');
  });
});
