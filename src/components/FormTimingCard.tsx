import React, { useMemo, useState } from 'react';
import { Timer, Send, CheckCheck, Eye, MousePointerClick, FileCheck2, Wrench, Loader2, AlertTriangle } from 'lucide-react';
import {
  computeStage2Timing, formatDuration, STAGE2_STATUS_LABEL, type Stage2Status,
} from '../lib/formTiming';
import { whenLabel } from '../lib/whatsappActivity';
import { repairWhatsAppMessage } from '../lib/whatsapp';

/**
 * Formulario de etapa 2 en el perfil: cuándo se le envió el link, cuándo le llegó, lo
 * leyó y lo abrió, cuándo lo completó — cuánto tardó y si fue a tiempo.
 *
 * Los colores acompañan a una etiqueta escrita, nunca la sustituyen. El verde y el rojo
 * son emerald / rose-700, como en el panel de asistencia (distinguibles en deuteranopía).
 */

export const STATUS_STYLE: Record<Stage2Status, string> = {
  a_tiempo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  tarde: 'bg-rose-50 text-rose-700 border-rose-200',
  pendiente: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  vencido: 'bg-rose-50 text-rose-700 border-rose-200',
  completado_sin_envio: 'bg-slate-50 text-slate-600 border-slate-200',
  sin_envio: 'bg-slate-50 text-slate-500 border-slate-200',
};

const DR_TZ = 'America/Santo_Domingo';
const iso = (ms: number) => new Date(ms).toISOString();
/** "jueves 15 de octubre". */
export const dueLabel = (ms: number) =>
  `${new Date(ms).toLocaleDateString('es-DO', { weekday: 'long', timeZone: DR_TZ })} ${new Date(ms).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', timeZone: DR_TZ })}`;

export default function FormTimingCard({ application }: { application: any }) {
  const now = Date.now();
  const t = useMemo(() => computeStage2Timing(application, now), [application, now]);
  const [busy, setBusy] = useState<'repair' | 'resend' | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  if (t.status === 'sin_envio' && !t.openedAtMs) return null;

  const channels = [
    t.whatsappSentAtMs ? `WhatsApp${t.whatsappSends > 1 ? ` ×${t.whatsappSends}` : ''}` : '',
    t.emailSentAtMs ? `correo${t.emailSends > 1 ? ` ×${t.emailSends}` : ''}` : '',
  ].filter(Boolean).join(' y ');

  const steps: Array<{ icon: React.ReactNode; label: string; ms: number; detail?: string }> = [
    { icon: <Send className="w-3.5 h-3.5" />, label: 'Enviado', ms: t.sentAtMs, detail: [channels, t.approximate ? 'fecha aproximada (cambio de etapa)' : ''].filter(Boolean).join(' · ') },
    { icon: <CheckCheck className="w-3.5 h-3.5" />, label: 'Le llegó', ms: t.deliveredAtMs },
    { icon: <Eye className="w-3.5 h-3.5" />, label: 'Lo leyó', ms: t.readAtMs },
    { icon: <MousePointerClick className="w-3.5 h-3.5" />, label: 'Abrió el link', ms: t.openedAtMs },
    { icon: <FileCheck2 className="w-3.5 h-3.5" />, label: 'Completado', ms: t.submittedAtMs },
  ];

  let summary = '';
  if (t.status === 'a_tiempo') summary = `Tardó ${formatDuration(t.elapsedMs)} desde que se le envió.`;
  else if (t.status === 'tarde') summary = `Tardó ${formatDuration(t.elapsedMs)}: lo completó ${formatDuration(t.lateByMs)} después del plazo.`;
  else if (t.status === 'pendiente') summary = `Se le envió hace ${formatDuration(t.elapsedMs)} y aún no lo completa.`;
  else if (t.status === 'vencido') summary = `Se le envió hace ${formatDuration(t.elapsedMs)}; el plazo venció hace ${formatDuration(t.lateByMs)}.`;
  else if (t.status === 'completado_sin_envio') summary = 'Lo completó, pero no hay registro de cuándo se le envió el link (p. ej. se copió a mano).';

  const repair = async (mode: 'repair' | 'resend') => {
    if (!t.outboxId) return;
    setBusy(mode);
    setNote(null);
    const err = await repairWhatsAppMessage(t.outboxId, mode);
    setBusy(null);
    setNote(err
      ? { ok: false, text: err }
      : { ok: true, text: mode === 'repair' ? 'Listo: se reenvió el mismo mensaje con un cifrado nuevo. Pídele que revise el chat.' : 'Se puso en cola una copia nueva del mensaje; sale en un momento.' });
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white/70 p-3 lg:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <p className="flex items-center text-[11px] font-bold uppercase tracking-widest text-slate-500">
          <Timer className="w-3.5 h-3.5 mr-1.5 text-blue-500" /> Tiempos del formulario
        </p>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${STATUS_STYLE[t.status]}`}>
          {STAGE2_STATUS_LABEL[t.status]}
        </span>
      </div>

      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-3 gap-y-1.5">
        {steps.map(s => (
          <li key={s.label} className={`flex items-start gap-1.5 text-[11px] ${s.ms ? 'text-slate-700' : 'text-slate-300'}`}>
            <span className={`mt-0.5 shrink-0 ${s.ms ? 'text-blue-500' : 'text-slate-300'}`}>{s.icon}</span>
            <span className="min-w-0">
              <span className="block font-bold">{s.label}</span>
              <span className="block">{s.ms ? whenLabel(iso(s.ms), now) : '—'}</span>
              {s.ms > 0 && s.detail && <span className="block text-slate-400">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>

      {summary && (
        <p className={`mt-2.5 text-xs font-semibold ${t.status === 'tarde' || t.status === 'vencido' ? 'text-rose-700' : 'text-slate-700'}`}>
          {summary}
          {t.dueAtMs > 0 && t.status !== 'completado_sin_envio' && (
            <span className="font-normal text-slate-500"> Plazo: hasta el {dueLabel(t.dueAtMs)}.</span>
          )}
        </p>
      )}

      {t.deliveryIssue && (
        <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <p className="flex items-start font-bold">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5 mt-0.5 shrink-0" />
            {t.deliveryIssue === 'retry_requested'
              ? 'Su teléfono no pudo abrir el mensaje y pidió que se lo reenviaran (se le reenvió solo).'
              : 'WhatsApp no confirma que el mensaje le llegó, y no ha abierto el link.'}
          </p>
          <p className="mt-0.5 text-amber-800">
            Si el candidato ve <b>«Esperando el mensaje. Esto puede tomar tiempo»</b>, pulsa <b>Reparar entrega</b>: se renueva el
            cifrado con su teléfono y el mismo mensaje se le vuelve a entregar (no le llega duplicado).
          </p>
        </div>
      )}

      {/* Un acuse de leído o abrir el link prueban que el mensaje se pudo descifrar:
          entonces no hay nada que reparar. */}
      {t.outboxId && !t.submittedAtMs && !application?.stage2Answers && !t.readAtMs && !t.openedAtMs && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => repair('repair')}
            disabled={!!busy}
            className="inline-flex items-center px-2.5 py-1 text-[11px] font-bold rounded-lg bg-white border border-amber-200 text-amber-800 hover:bg-amber-50 disabled:opacity-50 transition-colors"
          >
            {busy === 'repair' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Wrench className="w-3 h-3 mr-1" />}
            Reparar entrega
          </button>
          <button
            type="button"
            onClick={() => repair('resend')}
            disabled={!!busy}
            className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium rounded-lg text-slate-500 hover:text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 disabled:opacity-50 transition-colors"
          >
            {busy === 'resend' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
            Enviar de nuevo
          </button>
          {t.repairedAtMs > 0 && <span className="text-[10px] text-slate-400">Reparado {whenLabel(iso(t.repairedAtMs), now)}</span>}
        </div>
      )}
      {note && <p className={`mt-1.5 text-[11px] ${note.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{note.text}</p>}
    </div>
  );
}

const CHIP_STAGES = ['Formulario etapa 2 enviado', 'Formulario etapa 2 completado', 'Evaluación IA etapa 2'];

/** One line on the Kanban card: how long the form has been out, or how long it took. */
export function FormTimingChip({ app }: { app: any }) {
  if (!CHIP_STAGES.includes(app?.stage)) return null;
  const t = computeStage2Timing(app, Date.now());
  let text = '';
  let tone = 'text-slate-500';
  if (t.status === 'pendiente') text = `Formulario enviado hace ${formatDuration(t.elapsedMs)}${t.approximate ? ' (aprox.)' : ''}`;
  else if (t.status === 'vencido') { text = `Formulario vencido: +${formatDuration(t.lateByMs)} del plazo`; tone = 'text-rose-700'; }
  else if (t.status === 'a_tiempo') { text = `Completó el formulario en ${formatDuration(t.elapsedMs)}`; tone = 'text-emerald-700'; }
  else if (t.status === 'tarde') { text = `Completó en ${formatDuration(t.elapsedMs)} (fuera de plazo)`; tone = 'text-rose-700'; }
  if (!text) return null;
  return (
    <p className={`mt-1.5 flex items-center text-[10px] font-semibold ${tone}`} title={t.dueAtMs ? `Plazo: hasta el ${dueLabel(t.dueAtMs)}` : undefined}>
      <Timer className="w-3 h-3 mr-1 shrink-0" />
      <span className="truncate">{text}</span>
      {t.deliveryIssue && <span className="ml-1.5 shrink-0 text-amber-700" title="WhatsApp no confirma la entrega o su teléfono pidió reenviarlo: puede que vea «Esperando el mensaje». Ábrelo para repararlo.">⚠ ¿atascado?</span>}
    </p>
  );
}
