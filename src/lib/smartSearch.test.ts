import { describe, it, expect } from 'vitest';
import { smartMatch, normalizeText, tokenize, phoneticKey, editDistance, type SearchField } from './smartSearch';

const maria: SearchField[] = [
  { label: 'Nombre', value: 'María Rodríguez Peña' },
  { label: 'Teléfono', value: '(809) 555-1234', kind: 'phone' },
  { label: 'Correo', value: 'maria.rp@gmail.com' },
  { label: 'Ubicación', value: ['Baní, Peravia', null, ''] },
  { label: 'Notas', value: ['Llamada: dice que vive cerca del parque central y tiene moto propia.', 'Referencia de Juan: muy puntual.'] },
];

const hit = (q: string, fields = maria, fuzzy = false) => smartMatch(fields, q, { fuzzy });

describe('normalizeText / tokenize', () => {
  it('quita acentos y mayúsculas', () => {
    expect(normalizeText('Baní PEÑA José')).toBe('bani pena jose');
  });
  it('separa palabras y respeta "frases"', () => {
    expect(tokenize('  maria  "parque central" bani ')).toEqual(['maria', 'parque central', 'bani']);
  });
  it('ignora signos sueltos', () => {
    expect(tokenize('maria - ,')).toEqual(['maria']);
  });
});

describe('smartMatch', () => {
  it('una búsqueda vacía coincide con todo', () => {
    expect(hit('').matched).toBe(true);
  });

  it('no distingue acentos: "bani" encuentra "Baní"', () => {
    const r = hit('bani');
    expect(r.matched).toBe(true);
    expect(r.hits[0]).toMatchObject({ label: 'Ubicación', match: 'Baní' });
  });

  it('cada palabra puede coincidir en un campo distinto', () => {
    const r = hit('maria bani');
    expect(r.matched).toBe(true);
    expect(r.hits.map(h => h.label)).toEqual(['Nombre', 'Correo', 'Ubicación']);
  });

  it('todas las palabras deben coincidir', () => {
    expect(hit('maria santiago').matched).toBe(false);
  });

  it('busca dentro de las notas y devuelve el fragmento', () => {
    const r = hit('moto');
    expect(r.matched).toBe(true);
    expect(r.hits[0].label).toBe('Notas');
    expect(r.hits[0].match).toBe('moto');
    expect(r.hits[0].before).toContain('tiene');
  });

  it('las frases entre comillas deben aparecer juntas', () => {
    expect(hit('"parque central"').matched).toBe(true);
    expect(hit('"central parque"').matched).toBe(false);
  });

  describe('teléfonos', () => {
    it.each([
      '8095551234',
      '809-555-1234',
      '18095551234',
      '1 809 555 1234',
      '5551234',
      '555-1234',
    ])('"%s" encuentra (809) 555-1234', (q) => {
      expect(hit(q).matched).toBe(true);
      expect(hit(q).hits[0].label).toBe('Teléfono');
    });

    it('un número distinto no coincide', () => {
      expect(hit('8295551234').matched).toBe(false);
    });

    it('encuentra un número escrito dentro de una nota y lo resalta', () => {
      const fields: SearchField[] = [{ label: 'Notas', value: 'Su mamá: 829 444 7788, llamar en la tarde' }];
      const r = hit('8294447788', fields);
      expect(r.matched).toBe(true);
      expect(r.hits[0].match).toBe('829 444 7788');
    });

    it('no fusiona números separados por palabras', () => {
      const fields: SearchField[] = [{ label: 'Notas', value: 'tiene 2 hijos, 809 555' }];
      expect(hit('2809', fields).matched).toBe(false);
    });
  });

  describe('modo tolerante a errores (fuzzy)', () => {
    it('sin fuzzy, un error de escritura no coincide', () => {
      expect(hit('rodrigues').matched).toBe(false);
    });
    it.each([
      ['rodrigues', 'Rodríguez'],
      ['maira', 'María'],
      ['peravya', 'Peravia'],
    ])('"%s" encuentra "%s"', (q, expected) => {
      const r = hit(q, maria, true);
      expect(r.matched).toBe(true);
      expect(r.hits[0].match).toBe(expected);
    });
    it('variantes dominicanas: Yoselin ~ Joselyn, Bladimir ~ Vladimir', () => {
      expect(hit('yoselin', [{ label: 'Nombre', value: 'Joselyn Pérez' }], true).matched).toBe(true);
      expect(hit('bladimir', [{ label: 'Nombre', value: 'Vladimir Santos' }], true).matched).toBe(true);
    });
    it('no inventa coincidencias con palabras cortas', () => {
      expect(hit('ana', [{ label: 'Nombre', value: 'Juan Pérez' }], true).matched).toBe(false);
    });
  });
});

describe('phoneticKey / editDistance', () => {
  it('agrupa variantes de escritura', () => {
    expect(phoneticKey('Rodríguez')).toBe(phoneticKey('Rodriguez'));
    expect(phoneticKey('Hernández')).toBe(phoneticKey('Ernandes'));
    expect(phoneticKey('Yennifer')).toBe(phoneticKey('Jenifer'));
  });
  it('mide la distancia de edición', () => {
    expect(editDistance('casa', 'casa')).toBe(0);
    expect(editDistance('casa', 'cosa')).toBe(1);
    expect(editDistance('maira', 'maria')).toBe(1);
    expect(editDistance('abcdef', 'x', 2)).toBe(3);
  });
});

describe('prepareSearch', () => {
  it('un índice precalculado da el mismo resultado que los campos crudos', async () => {
    const { prepareSearch } = await import('./smartSearch');
    const idx = prepareSearch(maria);
    for (const q of ['bani', 'maria bani', '8095551234', 'moto', 'santiago']) {
      expect(smartMatch(idx, q)).toEqual(smartMatch(maria, q));
    }
  });
});
