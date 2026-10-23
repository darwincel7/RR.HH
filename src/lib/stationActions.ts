import {
  collection, deleteDoc, doc, onSnapshot, runTransaction, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  STATIONS, STATION_CODES, PAIRING_CODE_TTL_MS, assignProblem, assignedApplicationId, newPairingCode,
  type Station,
} from './stations';

/**
 * Lo que el panel hace con los teléfonos de la empresa (modo estación, src/lib/stations.ts).
 * Las reglas de Firestore solo dejan hacerlo al equipo; el teléfono habla con el servidor.
 */

/** Los teléfonos vinculados, en vivo y ordenados por nombre ("Teléfono 2" antes que "Teléfono 10"). */
export function watchStations(onChange: (stations: Station[]) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    collection(db, STATIONS),
    snap => onChange(
      snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }) as Station)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es', { numeric: true })),
    ),
    err => onError?.(err),
  );
}

/**
 * Manda el test de una postulación a un teléfono. Si ya estaba en otro (`fromStationId`),
 * se lo quita en la misma transacción: "pasar a otro teléfono". Un teléfono ocupado con
 * otra persona lo rechaza, aunque la lista de la pantalla estuviera vieja.
 */
export async function sendTestToStation(opts: {
  stationId: string;
  fromStationId?: string;
  applicationId: string;
  candidateId: string;
  candidateName: string;
  by: string;
}): Promise<void> {
  const target = doc(db, STATIONS, opts.stationId);
  const from = opts.fromStationId && opts.fromStationId !== opts.stationId ? doc(db, STATIONS, opts.fromStationId) : null;
  await runTransaction(db, async tx => {
    const snap = await tx.get(target);
    const fromSnap = from ? await tx.get(from) : null;
    const problem = assignProblem(snap.exists() ? (snap.data() as any) : null, opts.applicationId);
    if (problem) throw new Error(problem);
    if (from && fromSnap?.exists() && assignedApplicationId(fromSnap.data() as any) === opts.applicationId) {
      tx.update(from, { assignment: null });
    }
    tx.update(target, {
      assignment: {
        applicationId: opts.applicationId,
        candidateId: opts.candidateId,
        candidateName: opts.candidateName,
        kind: 'test',
        assignedAt: serverTimestamp(),
        assignedBy: opts.by,
      },
    });
  });
}

/** Deja libre el teléfono. Con `applicationId`, solo si sigue teniendo ESE test (no se
 * cancela el del candidato siguiente por una pantalla vieja). */
export async function clearStation(stationId: string, applicationId?: string): Promise<void> {
  const ref = doc(db, STATIONS, stationId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    if (applicationId && assignedApplicationId(snap.data() as any) !== applicationId) return;
    tx.update(ref, { assignment: null });
  });
}

/** El teléfono deja de estar vinculado: su próxima consulta lo devuelve a "Vincular". */
export async function unlinkStation(stationId: string): Promise<void> {
  await deleteDoc(doc(db, STATIONS, stationId));
}

const randomInt = (max: number) => crypto.getRandomValues(new Uint32Array(1))[0] % max;

/** Un código de vinculación nuevo (6 dígitos, 10 minutos, un solo uso). */
export async function createPairingCode(by: string): Promise<{ code: string; expiresAt: number }> {
  const code = newPairingCode(randomInt);
  const expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
  await setDoc(doc(db, STATION_CODES, code), { createdBy: by, createdAt: serverTimestamp(), expiresAt: new Date(expiresAt) });
  return { code, expiresAt };
}

/** Descarta un código que ya no se va a usar (se generó otro). */
export async function discardPairingCode(code: string): Promise<void> {
  await deleteDoc(doc(db, STATION_CODES, code)).catch(() => { /* ya se usó o venció */ });
}
