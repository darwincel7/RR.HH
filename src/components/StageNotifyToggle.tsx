import React, { useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';

/**
 * One-click switch: does moving a candidate to this stage notify them automatically
 * (WhatsApp + email)? Used on the Kanban column headers and in the template editor.
 */
export default function StageNotifyToggle({ stage, muted, saving, onToggle, size = 'sm' }: {
  stage: string;
  muted: boolean;
  saving?: boolean;
  onToggle: (stage: string) => Promise<string | null>;
  size?: 'sm' | 'md';
}) {
  const [error, setError] = useState<string | null>(null);
  const on = !muted;
  const title = on
    ? `Encendido: al mover un candidato a "${stage}" se le envía el mensaje automático (WhatsApp y correo). Clic para apagarlo.`
    : `Apagado: al mover un candidato a "${stage}" NO se le envía nada. Clic para encenderlo.`;

  const click = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    const err = await onToggle(stage);
    if (err) setError(err);
  };

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={click}
        disabled={saving}
        title={title}
        className={`inline-flex items-center gap-1.5 rounded-full border font-bold transition-colors disabled:opacity-60 ${
          size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
        } ${on
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
          : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'}`}
      >
        {saving
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : on ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
        {on ? 'Avisa al mover' : 'No avisa'}
        {/* the switch itself */}
        <span className={`relative inline-block rounded-full transition-colors ${size === 'md' ? 'w-7 h-4' : 'w-6 h-3.5'} ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
          <span className={`absolute top-0.5 rounded-full bg-white shadow transition-all ${size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5'} ${
            on ? (size === 'md' ? 'left-3.5' : 'left-3') : 'left-0.5'
          }`} />
        </span>
      </button>
      {error && <span className="mt-1 text-[10px] text-rose-600">{error}</span>}
    </span>
  );
}
