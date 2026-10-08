import { PIPELINE_STAGES } from './src/constants/stages';

/**
 * Order in which existing candidates get their CV photo, little by little, in the
 * background (see photoBackfillPass in server.ts).
 *
 *  1. Candidates of SALES vacancies first ("Vendedor/a", "Asesor de Ventas"…): that is
 *     the funnel the team works the most.
 *  2. Then everyone else with an application, then candidates with no application.
 *  3. Within each group: further along the funnel first (those are the profiles being
 *     looked at), "Descartado"/"Banco de talento" last; ties → most recent first.
 *
 * Only candidates never checked are queued: any photoStatus (found, none, manual,
 * removed, error) means a decision already exists. Whether the CV was analyzed or not
 * doesn't matter — the photo only needs the CV file. Pure, pinned by tests.
 */

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function isSalesVacancy(title: unknown): boolean {
  return /vend|venta/.test(norm(title));
}

const CLOSED_STAGES = new Set(['Descartado', 'Banco de talento']);

/** Higher = further along the active funnel; closed stages rank below everything. */
export function stageWeight(stage: unknown): number {
  if (typeof stage !== 'string') return 0;
  if (CLOSED_STAGES.has(stage)) return -1;
  const i = PIPELINE_STAGES.indexOf(stage);
  return i === -1 ? 0 : i;
}

const ms = (t: any): number =>
  t?.toMillis ? t.toMillis() : t?._seconds ? t._seconds * 1000 : t instanceof Date ? t.getTime() : (typeof t === 'string' ? Date.parse(t) || 0 : 0);

export interface QueueInputs {
  vacancies: Array<{ id: string; title?: string }>;
  applications: Array<{ id: string; candidateId?: string; vacancyId?: string; stage?: string; submittedAt?: any }>;
  candidates: Array<{ id: string; cvUrl?: string; photoUrl?: string; photoStatus?: string; aiStatus?: string }>;
}

export function needsPhoto(c: QueueInputs['candidates'][number]): boolean {
  return !!c.cvUrl && !c.photoUrl && !c.photoStatus && c.aiStatus !== 'processing';
}

export function buildPhotoQueue({ vacancies, applications, candidates }: QueueInputs): string[] {
  const sales = new Set(vacancies.filter(v => isSalesVacancy(v.title)).map(v => v.id));
  const eligible = new Map(candidates.filter(needsPhoto).map(c => [c.id, c]));

  // Best (lowest) group / furthest stage / newest date seen for each candidate.
  const best = new Map<string, { group: number; stage: number; time: number }>();
  for (const a of applications) {
    if (!a.candidateId || !eligible.has(a.candidateId)) continue;
    const entry = { group: sales.has(a.vacancyId || '') ? 0 : 1, stage: stageWeight(a.stage), time: ms(a.submittedAt) };
    const cur = best.get(a.candidateId);
    if (!cur || entry.group < cur.group
      || (entry.group === cur.group && (entry.stage > cur.stage || (entry.stage === cur.stage && entry.time > cur.time)))) {
      best.set(a.candidateId, entry);
    }
  }
  for (const id of eligible.keys()) {
    if (!best.has(id)) best.set(id, { group: 2, stage: 0, time: 0 });
  }

  return [...best.entries()]
    .sort(([, a], [, b]) => a.group - b.group || b.stage - a.stage || b.time - a.time)
    .map(([id]) => id);
}
