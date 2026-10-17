import React from 'react';
import { Archive } from 'lucide-react';
import { EVIDENCE_GROUPS } from '../lib/mergeCandidates';

/**
 * Lo que traía el perfil duplicado y el principal ya tenía.
 *
 * Es el caso que motivó la unificación: la misma persona respondió un test en un perfil
 * y otro test en el otro. Al unificar se conserva el del perfil principal (una
 * postulación no puede tener dos puntuaciones oficiales sin mentir en el Ranking), y el
 * otro queda aquí — visible y consultable — en vez de desaparecer.
 */

const fmtDate = (t: any): string => {
  const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null);
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
};

/** Los números que resumen una evidencia archivada, para no hacer abrir todo el detalle. */
function scoreChips(data: any): Array<{ label: string; value: string }> {
  const chips: Array<{ label: string; value: string }> = [];
  if (typeof data?.testResults?.score === 'number') chips.push({ label: 'Test', value: `${data.testResults.score}/100` });
  if (typeof data?.stage2Scoring?.total_score === 'number') chips.push({ label: 'Etapa 2', value: `${data.stage2Scoring.total_score}/100` });
  if (typeof data?.interviewObservation?.score === 'number' && data.interviewObservation.score > 0) {
    chips.push({ label: 'Entrevista', value: `${data.interviewObservation.score}/5` });
  }
  if (typeof data?.interviewAiEvaluation?.score === 'number') chips.push({ label: 'Entrevista IA', value: `${data.interviewAiEvaluation.score}/100` });
  if (typeof data?.scoreSummary === 'number') chips.push({ label: 'CV', value: `${data.scoreSummary}/5` });
  return chips;
}

/** Las respuestas en crudo, para poder leerlas y compararlas a mano. */
function answerBlocks(data: any): Array<{ title: string; answers: Record<string, any> }> {
  const out: Array<{ title: string; answers: Record<string, any> }> = [];
  const test = data?.testResults?.answers || data?.testAnswers;
  if (test && typeof test === 'object') out.push({ title: 'Respuestas del test', answers: test });
  if (data?.stage2Answers && typeof data.stage2Answers === 'object') {
    out.push({ title: 'Respuestas del formulario de etapa 2', answers: data.stage2Answers });
  }
  return out;
}

/**
 * De la copia completa de la postulación absorbida, solo se destaca lo que CHOCABA (lo
 * que el principal ya tenía). El resto se copió a la postulación que sobrevive, y
 * mostrarlo aquí otra vez haría dudar de cuál es el dato oficial.
 */
function conflictingOnly(entry: any): any {
  const labels: string[] = Array.isArray(entry?.groups) ? entry.groups : [];
  if (labels.length === 0) return {};
  const fields = new Set(EVIDENCE_GROUPS.filter(g => labels.includes(g.label)).flatMap(g => g.fields));
  const out: Record<string, any> = {};
  Object.entries(entry?.data || {}).forEach(([k, v]) => { if (fields.has(k)) out[k] = v; });
  return out;
}

export default function MergedEvidenceCard({ entries }: { entries: any[] }) {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  return (
    <div className="glass-card rounded-2xl lg:rounded-3xl p-5 lg:p-6 border border-amber-100">
      <h3 className="text-[10px] lg:text-sm font-display font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center">
        <Archive className="w-4 h-4 mr-2 text-amber-500" /> De un perfil unificado
      </h3>
      <p className="text-[11px] text-slate-500 mb-4">
        Esta persona tenía otro perfil con lo mismo ya respondido. Se conservó lo de este perfil (es lo que cuenta en el
        Ranking) y aquí queda lo del otro, para poder consultarlo y compararlo.
      </p>

      <div className="space-y-4">
        {entries.map((entry: any, i: number) => {
          const conflicting = conflictingOnly(entry);
          const chips = scoreChips(conflicting);
          const blocks = answerBlocks(conflicting);
          return (
            <div key={i} className="bg-amber-50/50 border border-amber-100 rounded-xl p-3 lg:p-4">
              <p className="text-xs font-bold text-slate-700">
                {entry?.fullName || 'Perfil duplicado'}
                {fmtDate(entry?.at) && <span className="font-medium text-slate-400"> · unificado el {fmtDate(entry.at)}</span>}
                {entry?.by && <span className="font-medium text-slate-400"> · por {entry.by}</span>}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {Array.isArray(entry?.groups) && entry.groups.length > 0
                  ? `Lo que ya estaba respondido aquí: ${entry.groups.join(', ')}`
                  : 'Nada chocaba: su contenido pasó a esta postulación y aquí queda la copia de respaldo.'}
              </p>

              {entry?.omitted ? (
                <p className="mt-2 text-[11px] text-amber-800">
                  Su contenido era demasiado grande para guardarlo aquí; quedó en la postulación original
                  ({entry.fromApplicationId}).
                </p>
              ) : (
                <>
                  {chips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {chips.map(c => (
                        <span key={c.label} className="text-[10px] font-bold bg-white border border-amber-200 text-slate-700 px-2 py-0.5 rounded-md">
                          {c.label}: {c.value}
                        </span>
                      ))}
                    </div>
                  )}
                  {blocks.map(b => (
                    <details key={b.title} className="mt-2">
                      <summary className="text-[11px] font-bold text-amber-800 cursor-pointer">{b.title}</summary>
                      <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                        {Object.entries(b.answers).map(([q, a]: any, idx) => (
                          <div key={idx} className="bg-white border border-amber-100 rounded-lg p-2">
                            <p className="text-[9px] font-bold text-slate-400 mb-0.5">{q}</p>
                            <p className="text-[11px] text-slate-700 whitespace-pre-wrap">
                              {Array.isArray(a) ? a.join(', ') : String(a ?? '')}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
