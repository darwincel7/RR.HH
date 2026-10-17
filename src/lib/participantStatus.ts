import { useEffect, useState } from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from './firebase';

/**
 * El estado de asistencia que vive en las SESIONES de la página Entrevistas
 * (`interview_participants`), leído por postulación.
 *
 * Hace falta porque una misma postulación puede estar en varias sesiones (se le dio una
 * cita, no vino, se le dio otra). La que manda es la ÚLTIMA: la cita anterior ya pasó y
 * su resultado quedó archivado. Marcar o leer cualquier otra haría que el Kanban, el
 * perfil y la agenda dijeran cosas distintas de la misma persona.
 */

export interface ParticipantRow {
  id: string;
  applicationId?: string;
  candidateId?: string;
  status?: string;
  addedAt?: any;
  sessionId?: string;
}

const addedMs = (row: ParticipantRow): number => {
  const t: any = row?.addedAt;
  const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null);
  return d && !isNaN(d.getTime()) ? d.getTime() : 0;
};

/**
 * La última cita de cada postulación. Sin fecha (`addedAt` lo escribe el servidor y
 * tarda un instante en llegar) se considera la más reciente: es la que se acaba de crear.
 */
export function latestByApplication(rows: ParticipantRow[]): Map<string, ParticipantRow> {
  const out = new Map<string, ParticipantRow>();
  for (const row of rows || []) {
    const appId = row?.applicationId;
    if (!appId) continue;
    const current = out.get(appId);
    if (!current || addedMs(row) >= addedMs(current)) out.set(appId, row);
  }
  return out;
}

/** Tope de seguridad: la colección es pequeña, pero crece con los años. */
const MAX_PARTICIPANTS = 2000;

/**
 * Las citas de un candidato (una consulta indexada) o de todos (una sola lectura
 * acotada, para el tablero). Devuelve la ÚLTIMA cita por postulación.
 */
export function useParticipantStatuses(opts: { candidateId?: string; all?: boolean }): Map<string, ParticipantRow> {
  const { candidateId, all } = opts;
  const [rows, setRows] = useState<Map<string, ParticipantRow>>(new Map());

  useEffect(() => {
    if (!candidateId && !all) { setRows(new Map()); return; }
    let alive = true;
    const q = candidateId
      ? query(collection(db, 'interview_participants'), where('candidateId', '==', candidateId))
      : query(collection(db, 'interview_participants'), limit(MAX_PARTICIPANTS));
    getDocs(q)
      .then(snap => {
        if (!alive) return;
        setRows(latestByApplication(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
      })
      // Es información de respaldo: sin ella el botón sigue funcionando con lo que
      // guarda la postulación.
      .catch(e => console.warn('No se pudieron leer las citas de entrevista:', e));
    return () => { alive = false; };
  }, [candidateId, all]);

  return rows;
}
