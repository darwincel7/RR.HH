import { useEffect, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Photo URLs for a set of candidates, for screens that only hold applications or
 * interview participants (Ranking, Entrevistas) and never loaded the candidate docs.
 *
 * Reads candidates 30 at a time (Firestore's `in` limit) and caches the answer for the
 * session, so moving between screens doesn't re-read the same people.
 */
const cache = new Map<string, string>(); // candidateId → photoUrl ('' = no photo)

export function useCandidatePhotos(candidateIds: Array<string | undefined | null>): Record<string, string> {
  const ids = Array.from(new Set(candidateIds.filter(Boolean) as string[])).sort();
  const key = ids.join('|');
  const [photos, setPhotos] = useState<Record<string, string>>(() => fromCache(ids));

  useEffect(() => {
    let cancelled = false;
    const missing = ids.filter(id => !cache.has(id));
    setPhotos(fromCache(ids));
    if (missing.length === 0) return;
    (async () => {
      for (let i = 0; i < missing.length; i += 30) {
        const chunk = missing.slice(i, i + 30);
        try {
          const snap = await getDocs(query(collection(db, 'candidates'), where(documentId(), 'in', chunk)));
          chunk.forEach(id => cache.set(id, ''));
          snap.docs.forEach(d => cache.set(d.id, (d.data() as any).photoUrl || ''));
        } catch (e) {
          console.warn('No se pudieron cargar las fotos de candidatos:', e);
        }
      }
      if (!cancelled) setPhotos(fromCache(ids));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return photos;
}

function fromCache(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  ids.forEach(id => { const url = cache.get(id); if (url) out[id] = url; });
  return out;
}
