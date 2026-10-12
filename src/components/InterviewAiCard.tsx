import { AlertTriangle, BrainCircuit, CheckCircle, FileText, HelpCircle, Loader2, MessageSquareText, RefreshCw } from 'lucide-react';
import { answeredOnly, hasInterviewEvidence } from '../lib/interviewScorecard';

/**
 * The AI's reading of the in-person interview, in the candidate profile: score and
 * recommendation, what stood out (and what worries), answer by answer, consistency with
 * earlier stages and questions to validate the doubts. Also lists the answers the
 * interviewer described, so anyone reviewing the profile later sees what the AI saw.
 */
interface Props {
  application: any;
  analyzing: boolean;
  error?: string | null;
  onAnalyze: () => void;
  onOpenScorecard: () => void;
}

const REC_LABEL: Record<string, string> = {
  contratar: 'Contratar',
  muy_recomendable: 'Muy recomendable',
  considerar_con_reservas: 'Considerar con reservas',
  no_recomendable: 'No recomendable',
};
const REC_STYLE: Record<string, string> = {
  contratar: 'bg-emerald-100 text-emerald-800',
  muy_recomendable: 'bg-blue-100 text-blue-800',
  considerar_con_reservas: 'bg-yellow-100 text-yellow-800',
  no_recomendable: 'bg-rose-100 text-rose-800',
};
const SIGNAL_DOT: Record<string, string> = {
  positiva: 'bg-emerald-500',
  neutral: 'bg-slate-300',
  alerta: 'bg-rose-500',
};

const toMs = (t: any): number => (t?.toMillis ? t.toMillis() : (t ? new Date(t).getTime() || 0 : 0));
const fmtDate = (t: any): string => {
  const ms = toMs(t);
  return ms ? new Date(ms).toLocaleString('es-DO', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};

export default function InterviewAiCard({ application, analyzing, error, onAnalyze, onOpenScorecard }: Props) {
  const ev = application?.interviewAiEvaluation;
  const scorecard = application?.interviewScorecard;
  const described = answeredOnly(scorecard?.answers);
  const canAnalyze = hasInterviewEvidence(scorecard, application?.interviewObservation);
  // The scorecard or the interviewer's rating/comments changed after this analysis (and
  // the automatic re-analysis didn't land).
  const changedAt = Math.max(toMs(scorecard?.updatedAt), toMs(application?.interviewObservation?.updatedAt));
  const stale = !!ev && changedAt > toMs(ev.evaluatedAt) + 1000;

  return (
    <div id="interview-ai-card" className="glass-card rounded-2xl lg:rounded-3xl p-5 lg:p-6 border border-violet-100">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 lg:mb-4">
        <h3 className="text-[10px] lg:text-sm font-display font-bold text-slate-400 uppercase tracking-widest flex items-center">
          <BrainCircuit className="w-4 h-4 mr-2 text-violet-500" /> Análisis IA de la entrevista
        </h3>
        <div className="flex gap-2">
          <button
            onClick={onOpenScorecard}
            className="text-[10px] font-bold bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded-md flex items-center transition-colors"
          >
            <FileText className="w-3 h-3 mr-1" /> {scorecard ? 'Ver scorecard' : 'Evaluar entrevista'}
          </button>
          {canAnalyze && (
            <button
              onClick={onAnalyze}
              disabled={analyzing}
              className="text-[10px] font-bold bg-violet-100 text-violet-700 hover:bg-violet-200 px-2 py-1 rounded-md flex items-center transition-colors disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              {ev ? 'Reevaluar IA' : 'Analizar con IA'}
            </button>
          )}
        </div>
      </div>

      {analyzing && (
        <p className="mb-3 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 flex items-center">
          <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin shrink-0" />
          La IA está analizando la entrevista (señales, métricas y respuestas descritas)…
        </p>
      )}
      {!analyzing && error && (
        <p className="mb-3 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 flex items-start">
          <AlertTriangle className="w-3.5 h-3.5 mr-2 mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {!analyzing && stale && (
        <p className="mb-3 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          La entrevista cambió después de este análisis. Pulsa "Reevaluar IA" para actualizarlo.
        </p>
      )}

      {ev ? (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center justify-between sm:flex-col sm:justify-center bg-violet-50 p-3 lg:p-4 rounded-xl lg:rounded-2xl border border-violet-100 sm:min-w-[130px]">
              <span className="text-xs font-bold text-violet-900">Entrevista (IA)</span>
              <span className="text-xl lg:text-2xl font-black text-violet-600">{ev.score}/100</span>
            </div>
            <div className="flex-1 bg-slate-50 p-3 rounded-xl border border-slate-100">
              {ev.recommendation && (
                <span className={`inline-block mb-2 px-2 py-1 text-[10px] font-bold uppercase rounded-md ${REC_STYLE[ev.recommendation] || 'bg-slate-100 text-slate-700'}`}>
                  {REC_LABEL[ev.recommendation] || ev.recommendation}
                </span>
              )}
              {ev.summary && <p className="text-xs lg:text-sm text-slate-700 italic">"{ev.summary}"</p>}
            </div>
          </div>

          {(ev.strengths?.length > 0 || ev.concerns?.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ev.strengths?.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Fortalezas</h4>
                  <div className="flex flex-wrap gap-1">
                    {ev.strengths.map((s: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-green-100 text-green-800 text-[10px] font-bold rounded-md">+{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {ev.concerns?.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-rose-500 uppercase mb-1">Dudas / alertas</h4>
                  <div className="flex flex-wrap gap-1">
                    {ev.concerns.map((c: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-bold rounded-md">-{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {ev.answer_insights?.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Respuesta por respuesta</h4>
              <ul className="space-y-2">
                {ev.answer_insights.map((ins: any, i: number) => (
                  <li key={i} className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 flex gap-2">
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${SIGNAL_DOT[ins.signal] || SIGNAL_DOT.neutral}`} title={`Señal ${ins.signal || 'neutral'}`} />
                    <div className="min-w-0">
                      <p className="text-[10px] lg:text-xs font-bold text-slate-500">{ins.question}</p>
                      <p className="text-xs text-slate-700">{ins.assessment}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ev.consistency_notes && (
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-1">Consistencia con etapas anteriores</h4>
              <p className="text-xs text-slate-700">{ev.consistency_notes}</p>
            </div>
          )}

          {ev.follow_up_questions?.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-1 flex items-center">
                <HelpCircle className="w-3 h-3 mr-1" /> Preguntas para validar las dudas
              </h4>
              <ul className="list-disc pl-5 space-y-0.5 text-xs text-slate-700">
                {ev.follow_up_questions.map((q: string, i: number) => <li key={i}>{q}</li>)}
              </ul>
            </div>
          )}

          <p className="text-[10px] text-slate-400 flex items-center">
            <CheckCircle className="w-3 h-3 mr-1" />
            Analizado {fmtDate(ev.evaluatedAt) || 'recientemente'}
            {typeof ev.answersUsed === 'number' ? ` · ${ev.answersUsed === 1 ? '1 respuesta descrita' : `${ev.answersUsed} respuestas descritas`}` : ''}
          </p>
        </div>
      ) : !analyzing && (
        <p className="text-xs lg:text-sm text-slate-500 text-center py-3">
          {canAnalyze
            ? 'Esta entrevista aún no tiene análisis de IA. Pulsa "Analizar con IA".'
            : 'Abre "Evaluar entrevista": marca señales, ajusta las métricas y describe las respuestas del candidato. La IA las analizará al guardar.'}
        </p>
      )}

      {described.length > 0 && (
        <details className="mt-4 group">
          <summary className="text-[11px] font-bold text-slate-500 cursor-pointer hover:text-violet-700 flex items-center select-none">
            <MessageSquareText className="w-3.5 h-3.5 mr-1.5" />
            Respuestas descritas por el entrevistador ({described.length})
          </summary>
          <div className="mt-2 space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {described.map((a, i) => (
              <div key={i} className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                <p className="text-[10px] lg:text-xs font-bold text-slate-500 mb-0.5">{a.question}</p>
                <p className="text-xs lg:text-sm text-slate-800 whitespace-pre-wrap">{a.answer}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
