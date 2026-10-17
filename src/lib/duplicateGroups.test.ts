import { describe, it, expect } from 'vitest';

import { groupDuplicates, countRedundantProfiles, profileRichness } from './duplicateGroups';

const c = (id: string, fields: Record<string, any> = {}) => ({ id, ...fields });

describe('agrupar duplicados en toda la base', () => {
  it('agrupa por teléfono aunque esté escrito distinto', () => {
    const groups = groupDuplicates([
      c('a', { phone: '809-555-1234', fullName: 'Ana Pérez' }),
      c('b', { phone: '18095551234', fullName: 'Ana P.' }),
      c('z', { phone: '8299999999', fullName: 'Otro' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map(m => m.id).sort()).toEqual(['a', 'b']);
    expect(groups[0].reasons).toEqual(['phone']);
  });

  it('agrupa por correo sin importar mayúsculas', () => {
    const groups = groupDuplicates([
      c('a', { email: 'Ana@Mail.com' }),
      c('b', { email: 'ana@mail.com' }),
    ]);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].reasons).toEqual(['email']);
  });

  it('une de forma transitiva: A~B por teléfono y B~C por correo son UN grupo', () => {
    // Como dos parejas sueltas, se unificaría dos veces lo mismo y C quedaría fuera.
    const groups = groupDuplicates([
      c('a', { phone: '8095551234' }),
      c('b', { phone: '8095551234', email: 'ana@mail.com' }),
      c('c', { email: 'ana@mail.com' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map(m => m.id).sort()).toEqual(['a', 'b', 'c']);
    expect(groups[0].reasons).toEqual(['phone', 'email']);
  });

  it('un nombre suelto o demasiado corto no agrupa a nadie', () => {
    // Juntar a todas las "Ana" llevaría a unificar personas distintas, y eso no se
    // deshace con un botón.
    expect(groupDuplicates([c('a', { fullName: 'Ana' }), c('b', { fullName: 'ANA' })])).toEqual([]);
    expect(groupDuplicates([c('a', { fullName: 'José' }), c('b', { fullName: 'jose' })])).toEqual([]);
  });

  it('un nombre completo sí agrupa, acentos aparte', () => {
    const groups = groupDuplicates([
      c('a', { fullName: 'José María Rodríguez' }),
      c('b', { fullName: 'jose maria rodriguez' }),
    ]);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].reasons).toEqual(['name']);
  });

  it('deja fuera los perfiles ya unificados y los que no están duplicados', () => {
    const groups = groupDuplicates([
      c('a', { phone: '8095551234' }),
      c('b', { phone: '8095551234', mergedInto: 'a' }),
      c('solo', { phone: '8290000000' }),
    ]);
    expect(groups).toEqual([]);
  });

  it('pone primero el grupo con la señal más fuerte', () => {
    const groups = groupDuplicates([
      c('n1', { fullName: 'Pedro Antonio Gómez' }),
      c('n2', { fullName: 'pedro antonio gomez' }),
      c('p1', { phone: '8095551234' }),
      c('p2', { phone: '8095551234' }),
    ]);
    expect(groups[0].reasons).toEqual(['phone']);
    expect(groups[1].reasons).toEqual(['name']);
  });

  it('dentro del grupo, el perfil más completo va primero (el mejor principal)', () => {
    const flaco = c('flaco', { phone: '8095551234', fullName: 'Ana' });
    const completo = c('completo', { phone: '8095551234', fullName: 'Ana Pérez', email: 'a@b.c', cvUrl: 'x', aiExtraction: {} });
    const groups = groupDuplicates([flaco, completo]);
    expect(groups[0].members[0].id).toBe('completo');
    expect(profileRichness(completo)).toBeGreaterThan(profileRichness(flaco));
  });

  it('cuenta cuántos perfiles sobran, no cuántos grupos hay', () => {
    const groups = groupDuplicates([
      c('a', { phone: '8095551234' }), c('b', { phone: '8095551234' }), c('c', { phone: '8095551234' }),
      c('d', { email: 'x@y.z' }), c('e', { email: 'x@y.z' }),
    ]);
    // Un grupo de 3 deja 2 de más; uno de 2, uno de más.
    expect(countRedundantProfiles(groups)).toBe(3);
  });

  it('no se cae con una base vacía o con datos sueltos', () => {
    expect(groupDuplicates([])).toEqual([]);
    expect(groupDuplicates(null as any)).toEqual([]);
    expect(groupDuplicates([c('a'), c('b')])).toEqual([]);
  });
});
