import React, { useState } from 'react';
import { AlertCircle, Clock, Loader2, RotateCcw } from 'lucide-react';
import { useWhatsAppActivity } from '../contexts/WhatsAppActivityContext';
import { candidateStageState, describeWait, whatLabel } from '../lib/whatsappActivity';

/**
 * The WhatsApp state of ONE candidate in the stage they sit in, for the Kanban card and
 * the profile's stage card: a red notice with "Reintentar" when the stage's message
 * couldn't go out, or a quiet "en cola" line while it waits. Nothing when all is well.
 *
 * Clicks never reach the card underneath (it opens the profile and is draggable).
 */
export default function CandidateWhatsAppState({ candidateId, phone, stage, vacancy, compact = false }: {
  candidateId?: string | null;
  phone?: string | null;
  stage?: string | null;
  vacancy?: string | null;
  compact?: boolean;
}) {
  const activity = useWhatsAppActivity();
  const [error, setError] = useState<string | null>(null);
  const state = candidateStageState(activity?.data ?? null, { candidateId, phone }, stage, vacancy);
  if (!activity || !state) return null;

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const m = state.message;
  const now = Date.now();

  if (state.kind === 'pending') {
    return (
      <div
        className={`flex items-center text-[10px] font-medium text-slate-500 ${compact ? 'mt-2' : 'mt-3 text-xs'}`}
        title={`${whatLabel(m)} — ${describeWait(m, now)}`}
      >
        <Clock className="w-3 h-3 mr-1 shrink-0 text-slate-400" />
        <span className="truncate">WhatsApp en cola · {describeWait(m, now)}</span>
      </div>
    );
  }

  const busy = activity.busy.has(m.id);
  const retry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    const err = await activity.retry(m.id);
    if (err) setError(err);
  };

  return (
    <div
      onClick={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      className={`rounded-lg border border-rose-200 bg-rose-50 cursor-default ${compact ? 'mt-2 p-2' : 'mt-3 p-3'}`}
    >
      <p className={`flex items-center font-bold text-rose-700 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        <AlertCircle className="w-3.5 h-3.5 mr-1 shrink-0" /> WhatsApp no enviado
      </p>
      <p className={`text-rose-600 ${compact ? 'text-[10px]' : 'text-[11px]'} mt-0.5`} title={whatLabel(m)}>
        {m.reason || 'No se pudo enviar'}
      </p>
      {m.retryable === false ? (
        m.hint && <p className={`text-slate-500 ${compact ? 'text-[10px]' : 'text-[11px]'} mt-0.5`}>{m.hint}</p>
      ) : (
        <button
          type="button"
          onClick={retry}
          disabled={busy}
          className={`mt-1.5 w-full inline-flex items-center justify-center rounded-md bg-white border border-rose-200 font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60 transition-colors ${compact ? 'py-1 text-[11px]' : 'py-1.5 text-xs'}`}
        >
          {busy
            ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            : <RotateCcw className="w-3 h-3 mr-1" />}
          Reintentar envío
        </button>
      )}
      {error && <p className="mt-1 text-[10px] text-rose-600">{error}</p>}
    </div>
  );
}
