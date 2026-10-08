import {
  collection, doc, getDoc, getDocs, query, where, writeBatch, serverTimestamp,
  deleteField, arrayUnion, Timestamp,
} from 'firebase/firestore';
import { db, auth } from './firebase';

/**
 * Moving (or copying) a candidate's application from one vacancy to another.
 *
 * MOVE updates the application IN PLACE (same document id): the evaluation/test links
 * already sent to the candidate (/eval/<id>, /test/<id>), the interview-session
 * participants and every score keep working, and the move is recorded in
 * `vacancyHistory`. The id still reads "<candidate>_<oldVacancy>" — ids are opaque, and
 * /api/apply checks the vacancyId FIELD (not the id) for duplicates.
 *
 * COPY creates a fresh application in the target vacancy (the CV and its AI score come
 * along; per-vacancy evaluations do not) and leaves the original where it was.
 *
 * Neither sends WhatsApp messages: changing vacancies is internal housekeeping.
 */

export type MoveMode = 'move' | 'copy';

/** Keep the application's current stage, or put it in this one. */
export const KEEP_STAGE = '__keep__';

export interface MovableApp {
  id: string;
  candidateId: string;
  vacancyId: string;
  candidateName?: string;
  stage?: string;
  [k: string]: any;
}

export interface MovePlan<T extends MovableApp> {
  /** Will be moved/copied. */
  ready: T[];
  /** Already in the target vacancy — nothing to do. */
  alreadyThere: T[];
  /** The same candidate already has ANOTHER application in the target vacancy. */
  conflicts: T[];
}

/**
 * Decides what happens to each selected application. `targetVacanciesByCandidate` maps a
 * candidateId to the vacancies that candidate already has applications in.
 * Pure — pinned by moveApplication.test.ts.
 */
export function planVacancyMove<T extends MovableApp>(
  apps: T[],
  targetVacancyId: string,
  targetVacanciesByCandidate: Map<string, Set<string>>,
): MovePlan<T> {
  const plan: MovePlan<T> = { ready: [], alreadyThere: [], conflicts: [] };
  // Two selected applications of the same person must not both land in the target.
  const claimed = new Set<string>();
  for (const app of apps) {
    if (app.vacancyId === targetVacancyId) { plan.alreadyThere.push(app); continue; }
    const existing = targetVacanciesByCandidate.get(app.candidateId);
    if (existing?.has(targetVacancyId) || claimed.has(app.candidateId)) { plan.conflicts.push(app); continue; }
    claimed.add(app.candidateId);
    plan.ready.push(app);
  }
  return plan;
}

/** Which vacancies each of these candidates already has an application in. */
export async function fetchVacanciesByCandidate(candidateIds: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  const ids = Array.from(new Set(candidateIds.filter(Boolean)));
  // Firestore 'in' accepts up to 30 values per query.
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(query(collection(db, 'applications'), where('candidateId', 'in', ids.slice(i, i + 30))));
    snap.docs.forEach(d => {
      const { candidateId, vacancyId } = d.data() as any;
      if (!candidateId) return;
      const set = map.get(candidateId) || new Set<string>();
      set.add(vacancyId);
      map.set(candidateId, set);
    });
  }
  return map;
}

// Fields that travel with a COPY: who the person is and their CV-level screening.
// Per-vacancy work (stage-2 answers, tests, interview scorecards) stays with the original.
const COPY_FIELDS = ['candidateId', 'candidateName', 'cvUrl', 'cvFileType', 'scoreSummary', 'recommendation'];

export async function executeVacancyMove<T extends MovableApp>(
  apps: T[],
  opts: {
    mode: MoveMode;
    targetVacancyId: string;
    targetVacancyTitle: string;
    vacancyTitles: Record<string, string>;
    /** KEEP_STAGE or a pipeline stage. */
    stage: string;
  },
): Promise<void> {
  const by = auth.currentUser?.displayName || auth.currentUser?.email || 'Equipo';
  const now = Timestamp.now();

  // Batches cap at 500 writes; stay well under.
  for (let i = 0; i < apps.length; i += 200) {
    const chunk = apps.slice(i, i + 200);
    const batch = writeBatch(db);

    for (const app of chunk) {
      const historyEntry = {
        action: opts.mode,
        fromVacancyId: app.vacancyId,
        fromVacancyTitle: opts.vacancyTitles[app.vacancyId] || app.vacancyId,
        toVacancyId: opts.targetVacancyId,
        toVacancyTitle: opts.targetVacancyTitle,
        at: now, // serverTimestamp() is not allowed inside arrays
        by,
      };
      const newStage = opts.stage === KEEP_STAGE ? (app.stage || 'Nuevo') : opts.stage;

      if (opts.mode === 'move') {
        batch.update(doc(db, 'applications', app.id), {
          vacancyId: opts.targetVacancyId,
          stage: newStage,
          lastStageUpdate: serverTimestamp(),
          // Its hand-placed position belonged to the old board; fall back to date order.
          kanbanOrder: deleteField(),
          vacancyHistory: arrayUnion(historyEntry),
        });
      } else {
        // Conventional id for the target; if that slot is taken by an application that
        // was itself moved elsewhere, fall back to an auto id rather than overwrite it.
        let ref = doc(db, 'applications', `${app.candidateId}_${opts.targetVacancyId}`);
        if ((await getDoc(ref)).exists()) ref = doc(collection(db, 'applications'));
        const data: Record<string, any> = {};
        COPY_FIELDS.forEach(f => { if (app[f] !== undefined && app[f] !== null) data[f] = app[f]; });
        batch.set(ref, {
          ...data,
          vacancyId: opts.targetVacancyId,
          stage: newStage,
          submittedAt: serverTimestamp(),
          lastStageUpdate: serverTimestamp(),
          copiedFrom: { applicationId: app.id, vacancyId: app.vacancyId, vacancyTitle: historyEntry.fromVacancyTitle },
          vacancyHistory: [historyEntry],
        });
      }
    }
    await batch.commit();
  }
}
