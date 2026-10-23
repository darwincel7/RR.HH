import { describe, it, expect } from 'vitest';
import { prettifyName, firstNameOf, isPlaceholderName, shortNameOf } from './personName';

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

describe('shortNameOf', () => {
  it('keeps the first name and only the initials of the rest', () => {
    expect(shortNameOf('JUAN CARLOS PÉREZ RODRÍGUEZ')).toBe('Juan C. P. R.');
    expect(shortNameOf('Ana')).toBe('Ana');
  });

  it('skips surname particles and stops at three initials', () => {
    expect(shortNameOf('maría de los ángeles pérez')).toBe('María Á. P.');
    expect(shortNameOf('Luis Ángel José Martínez Gómez')).toBe('Luis Á. J. M.');
  });

  it('has no name for placeholders or text that is not a name', () => {
    expect(shortNameOf('Procesando: cv_juan.pdf')).toBe('');
    expect(shortNameOf('⚠️ Error de lectura: Juan')).toBe('');
    expect(shortNameOf('')).toBe('');
  });
});
