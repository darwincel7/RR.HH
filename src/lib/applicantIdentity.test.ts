import { describe, it, expect } from 'vitest';

import { isSameApplicant, namesCompatible, nameTokens, preferredName } from './applicantIdentity';

const incoming = (fields: Partial<{ name: string; phoneNormalized: string; email: string }> = {}) => ({
  name: 'Ana Pérez',
  phoneNormalized: '18095551234',
  email: 'ana@mail.com',
  ...fields,
});

const existing = (fields: Record<string, any> = {}) => ({
  fullName: 'Ana Pérez',
  phoneNormalized: '18095551234',
  email: 'ana@mail.com',
  ...fields,
});

describe('reconocer al postulante que ya está en la base', () => {
  it('teléfono, correo y nombre coinciden: es la misma persona', () => {
    const m = isSameApplicant(existing(), incoming());
    expect(m.same).toBe(true);
    expect(m.reason).toBe('telefono+correo+nombre');
  });

  it('el teléfono se compara en forma canónica, escrito como sea', () => {
    expect(isSameApplicant(existing({ phoneNormalized: '', phone: '809-555-1234' }), incoming()).same).toBe(true);
    expect(isSameApplicant(existing(), incoming({ phoneNormalized: '8095551234' })).same).toBe(true);
  });

  it('el correo no distingue mayúsculas ni espacios', () => {
    expect(isSameApplicant(existing({ email: 'ANA@Mail.com ' }), incoming()).same).toBe(true);
  });

  it('con el teléfono igual pero OTRO correo, no se asume nada', () => {
    // Un celular compartido en la familia es normal; por eso el teléfono solo no basta.
    const m = isSameApplicant(existing({ email: 'otra@mail.com' }), incoming());
    expect(m.same).toBe(false);
    expect(m.reason).toBe('correo_distinto');
  });

  it('con el correo igual pero otro teléfono, tampoco', () => {
    expect(isSameApplicant(existing({ phoneNormalized: '18299999999', phone: '' }), incoming()).reason).toBe('telefono_distinto');
  });

  it('dos hermanas con el mismo teléfono y correo pero nombres distintos quedan separadas', () => {
    // Este es el caso que justifica exigir también el nombre.
    const m = isSameApplicant(existing({ fullName: 'Ana Gómez' }), incoming({ name: 'Ana Pérez' }));
    expect(m.same).toBe(false);
    expect(m.reason).toBe('nombre_distinto');
  });

  it('con un nombre de pila suelto en el perfil tampoco se reutiliza', () => {
    // La hermana que aplicó primero puso solo "Ana": su perfil no puede absorber a la
    // otra solo porque comparten el celular y el correo de la casa.
    expect(isSameApplicant(existing({ fullName: 'Ana' }), incoming({ name: 'Ana Gómez' })).reason).toBe('nombre_distinto');
  });

  it('reconoce el teléfono o el correo que quedó como alternativo tras unificar', () => {
    // Es justo el dato por el que nació el duplicado: volver a aplicar con él no puede
    // crear un tercer perfil.
    const perfil = existing({
      phoneNormalized: '18090000000',
      phone: '809-000-0000',
      email: 'otro@mail.com',
      alternatePhones: ['829-555-1234'],
      alternateEmails: ['ana@mail.com'],
    });
    expect(isSameApplicant(perfil, incoming({ phoneNormalized: '18295551234' })).same).toBe(true);
  });

  it('un perfil ya unificado en otro no recibe nada', () => {
    expect(isSameApplicant(existing({ mergedInto: 'otro' }), incoming()).same).toBe(false);
  });

  it('sin teléfono o sin correo no se reutiliza ningún perfil', () => {
    expect(isSameApplicant(existing(), incoming({ email: '' })).reason).toBe('sin_telefono_o_correo');
    expect(isSameApplicant(existing(), incoming({ phoneNormalized: '' })).reason).toBe('sin_telefono_o_correo');
    expect(isSameApplicant(null, incoming()).same).toBe(false);
  });
});

describe('cuándo dos nombres pueden ser la misma persona', () => {
  it('el mismo nombre, con acentos o mayúsculas distintas', () => {
    expect(namesCompatible('Ana Pérez', 'ANA PEREZ')).toBe(true);
    expect(namesCompatible('José María Rodríguez', 'jose maria rodriguez')).toBe(true);
  });

  it('uno contenido en el otro: la misma persona con más o menos detalle', () => {
    expect(namesCompatible('Ana Pérez', 'Ana María Pérez Gómez')).toBe(true);
    expect(namesCompatible('María Rodríguez', 'maria rodriguez perez')).toBe(true);
  });

  it('el nombre de pila solo NO basta', () => {
    // Si bastara, "Ana" estaría contenido en "Ana Gómez" y conociendo el teléfono, el
    // correo y el nombre de pila de alguien se podría caer dentro de SU perfil.
    expect(namesCompatible('Ana', 'Ana Pérez')).toBe(false);
    expect(namesCompatible('Ana Pérez', 'Ana')).toBe(false);
  });

  it('cada uno con un apellido propio: son dos personas', () => {
    expect(namesCompatible('Ana Pérez', 'Ana Gómez')).toBe(false);
    expect(namesCompatible('Juan Pérez', 'Luis Pérez')).toBe(false);
  });

  it('las partículas no cuentan: "de la Cruz" y "Cruz" es la misma', () => {
    expect(namesCompatible('Ana de la Cruz', 'Ana Cruz')).toBe(true);
    expect(nameTokens('Ana de los Santos')).toEqual(['ana', 'santos']);
  });

  it('sin nombre usable no se afirma nada', () => {
    expect(namesCompatible('', 'Ana Pérez')).toBe(false);
    expect(namesCompatible('Ana Pérez', null)).toBe(false);
    // El nombre provisional de una subida masiva no identifica a nadie.
    expect(namesCompatible('Procesando: cv.pdf', 'Ana Pérez')).toBe(false);
    expect(nameTokens('Procesando: cv.pdf')).toEqual([]);
  });
});

describe('qué nombre se conserva al volver a aplicar', () => {
  it('gana el que tiene más palabras', () => {
    expect(preferredName('Ana María Pérez Gómez', 'Ana Pérez')).toBe('Ana María Pérez Gómez');
    expect(preferredName('Ana', 'Ana Pérez')).toBe('Ana Pérez');
  });

  it('a igualdad de palabras, gana el más largo escrito', () => {
    // Las partículas no cuentan como palabra, así que estos dos empatan a dos: sin
    // desempate, volver a aplicar acortaba el nombre que mantenía el equipo.
    expect(preferredName('Ana de la Cruz', 'Ana Cruz')).toBe('Ana de la Cruz');
    expect(preferredName('Ana Cruz', 'Ana de la Cruz')).toBe('Ana de la Cruz');
  });

  it('empate real: se queda el que ya estaba (no se toca por tocar)', () => {
    expect(preferredName('Ana Pérez', 'ana perez')).toBe('Ana Pérez');
  });

  it('un nombre inservible cede ante uno de verdad', () => {
    expect(preferredName('Procesando: cv.pdf', 'Ana Pérez')).toBe('Ana Pérez');
    expect(preferredName('', 'Ana Pérez')).toBe('Ana Pérez');
    expect(preferredName('Ana Pérez', '')).toBe('Ana Pérez');
  });
});
