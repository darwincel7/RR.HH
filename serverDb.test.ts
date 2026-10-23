import { describe, it, expect } from 'vitest';
import { contactLookupAttempts, exactContactLookups, followMergedInto, lookupDimension } from './serverDb';

/**
 * Buscar a una persona por su contacto es el paso del que depende reconocerla: si la
 * consulta no devuelve su perfil, `isSameApplicant` nunca llega a compararlo y la
 * postulación nueva nace como un duplicado. Estas pruebas fijan que se busque en las
 * formas en que el teléfono y el correo están REALMENTE guardados en la base, no solo
 * en la canónica.
 */
describe('las consultas para encontrar a alguien por su contacto', () => {
  const attempts = (phone: unknown, email: unknown) =>
    contactLookupAttempts(phone, email).map(([field, , value]) => `${field}=${value}`);

  it('busca el teléfono como lo escribió la persona y en su forma canónica', () => {
    // Un perfil viejo o de subida masiva puede no tener `phoneNormalized` y guardar
    // "809-555-1234" tal cual: comparar solo la forma canónica no lo encuentra nunca.
    const a = attempts('809-555-1234', '');
    expect(a).toContain('phoneNormalized=18095551234');
    expect(a).toContain('phone=809-555-1234');
    expect(a).toContain('phone=18095551234');
    expect(a).toContain('phone=8095551234'); // sin el 1 del país
  });

  it('busca también en los teléfonos y correos alternativos de una unificación', () => {
    const a = attempts('8095551234', 'Ana@Mail.com');
    expect(a).toContain('alternatePhones=18095551234');
    expect(a).toContain('alternateEmails=Ana@Mail.com');
    expect(a).toContain('alternateEmails=ana@mail.com');
  });

  it('busca el correo escrito y en minúsculas (Firestore no compara sin mayúsculas)', () => {
    const a = attempts('', 'Ana@Mail.com');
    expect(a).toContain('email=Ana@Mail.com');
    expect(a).toContain('email=ana@mail.com');
  });

  it('pone primero las consultas que más rinden: el campo canónico y el correo', () => {
    // Se corta en cuanto hay suficientes resultados, así que el orden importa.
    const first = contactLookupAttempts('809-555-1234', 'ana@mail.com')[0];
    expect(first).toEqual(['phoneNormalized', '==', '18095551234']);
  });

  it('no repite consultas ni busca valores vacíos', () => {
    const a = contactLookupAttempts('18095551234', 'ana@mail.com');
    expect(new Set(a.map(x => x.join('|'))).size).toBe(a.length);
    expect(a.every(([, , value]) => !!value)).toBe(true);
    // Sin teléfono, solo las del correo; sin nada, ninguna consulta.
    expect(contactLookupAttempts('', 'ana@mail.com').every(([f]) => f.toLowerCase().includes('mail'))).toBe(true);
    expect(contactLookupAttempts('', '')).toEqual([]);
  });
});

describe('las dos dimensiones del contacto se agotan por separado', () => {
  it('cada consulta sabe si es del teléfono o del correo', () => {
    expect(lookupDimension('phoneNormalized')).toBe('phone');
    expect(lookupDimension('phone')).toBe('phone');
    expect(lookupDimension('alternatePhones')).toBe('phone');
    expect(lookupDimension('email')).toBe('email');
    expect(lookupDimension('alternateEmails')).toBe('email');
  });

  it('con teléfono y correo hay consultas de las DOS', () => {
    // El tope es por dimensión: si diez perfiles comparten el teléfono (un número de
    // negocio), cortar ahí dejaba sin ejecutar las del correo, y el perfil que sí es
    // esta persona podía quedar fuera de ese grupo de diez.
    const dims = new Set(contactLookupAttempts('8095551234', 'ana@mail.com').map(([f]) => lookupDimension(f)));
    expect(dims).toEqual(new Set(['phone', 'email']));
  });
});

describe('seguir el rastro de una unificación', () => {
  const base: Record<string, any> = {
    A: { mergedInto: 'B' },
    B: { mergedInto: 'C' },
    C: { fullName: 'Ana' },
  };
  const read = (db: Record<string, any>) => async (id: string) => db[id] ?? null;

  it('llega hasta el perfil vivo aunque se haya unificado dos veces', async () => {
    expect(await followMergedInto(read(base), 'A')).toBe('C');
    expect(await followMergedInto(read(base), 'C')).toBe('C');
  });

  it('un ciclo corta en seco en vez de colgar el servidor', async () => {
    const ciclo = { X: { mergedInto: 'Y' }, Y: { mergedInto: 'X' } };
    expect(await followMergedInto(read(ciclo), 'X')).toBe('X');
  });

  it('sin `strict`, un fallo de lectura devuelve lo que se tenía', async () => {
    // Para ENCONTRAR a alguien: enlazar un WhatsApp al perfil unificado es peor que
    // enlazarlo bien, pero mucho mejor que perder el mensaje.
    const falla = async () => { throw new Error('firestore caído'); };
    expect(await followMergedInto(falla, 'A')).toBe('A');
  });

  it('con `strict`, el fallo se propaga', async () => {
    // Para ESCRIBIR: tratar un perfil muerto como vivo colgaría de él la postulación y
    // el CV, invisibles en el vivo. Mejor fallar y que la persona reintente.
    const falla = async () => { throw new Error('firestore caído'); };
    await expect(followMergedInto(falla, 'A', { strict: true })).rejects.toThrow('firestore caído');
  });

  it('sin id no hay nada que seguir', async () => {
    expect(await followMergedInto(read(base), null)).toBe(null);
  });
});

describe('la consulta que de verdad identifica: teléfono Y correo', () => {
  it('pide los dos datos en la misma consulta', () => {
    // Las consultas por un solo campo necesitan tope (un número de negocio compartido
    // haría leer la base entera en cada postulación) y un tope siempre deja fuera al
    // perfil número once. Pidiendo los dos juntos eso deja de importar.
    const [primera] = exactContactLookups('809-555-1234', 'Ana@Mail.com');
    expect(primera).toEqual([
      ['phoneNormalized', '==', '18095551234'],
      ['email', '==', 'Ana@Mail.com'],
    ]);
  });

  it('prueba el correo escrito y en minúsculas (Firestore compara exacto)', () => {
    const correos = exactContactLookups('8095551234', 'Ana@Mail.com').map(c => c[1][2]);
    expect(correos).toEqual(['Ana@Mail.com', 'ana@mail.com']);
    // Si ya venía en minúsculas, una sola consulta.
    expect(exactContactLookups('8095551234', 'ana@mail.com')).toHaveLength(1);
  });

  it('sin los dos datos no hay consulta precisa que hacer', () => {
    expect(exactContactLookups('', 'ana@mail.com')).toEqual([]);
    expect(exactContactLookups('8095551234', '')).toEqual([]);
  });
});
