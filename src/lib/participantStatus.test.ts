import { describe, it, expect, vi } from 'vitest';

// Solo se prueba la parte pura; el bootstrap de Firebase se sustituye para que importar
// el módulo no abra conexiones.
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), getDocs: vi.fn(), limit: vi.fn(), query: vi.fn(), where: vi.fn(),
}));

import { latestByApplication } from './participantStatus';

const ts = (iso: string) => ({ toDate: () => new Date(iso) });

describe('la última cita de cada postulación', () => {
  it('manda la más reciente, no la primera', () => {
    // Quien no vino a la cita de enero y sí a la de marzo cuenta como que asistió: la
    // cita vieja ya pasó y su resultado quedó archivado.
    const latest = latestByApplication([
      { id: 'p1', applicationId: 'a1', status: 'no_show', addedAt: ts('2026-01-10') },
      { id: 'p2', applicationId: 'a1', status: 'attended', addedAt: ts('2026-03-10') },
    ]);
    expect(latest.get('a1')?.status).toBe('attended');
    expect(latest.get('a1')?.id).toBe('p2');
  });

  it('la que aún no tiene fecha del servidor es la que se acaba de crear', () => {
    const latest = latestByApplication([
      { id: 'p1', applicationId: 'a1', status: 'attended', addedAt: ts('2026-01-10') },
      { id: 'p2', applicationId: 'a1', status: 'pending' },
    ]);
    expect(latest.get('a1')?.id).toBe('p1');
    // Con las dos sin fecha gana la última de la lista, nunca un empate indefinido.
    const sinFecha = latestByApplication([
      { id: 'p1', applicationId: 'a2', status: 'attended' },
      { id: 'p2', applicationId: 'a2', status: 'no_show' },
    ]);
    expect(sinFecha.get('a2')?.id).toBe('p2');
  });

  it('separa por postulación y descarta las citas sin postulación', () => {
    const latest = latestByApplication([
      { id: 'p1', applicationId: 'a1', status: 'attended' },
      { id: 'p2', applicationId: 'a2', status: 'no_show' },
      { id: 'p3', status: 'attended' },
    ]);
    expect(latest.size).toBe(2);
    expect(latest.get('a1')?.status).toBe('attended');
    expect(latest.get('a2')?.status).toBe('no_show');
  });

  it('tolera una lista vacía', () => {
    expect(latestByApplication([]).size).toBe(0);
    expect(latestByApplication(null as any).size).toBe(0);
  });
});
