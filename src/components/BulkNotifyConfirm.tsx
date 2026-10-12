import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRightLeft, Loader2, Mail, MessageSquare, Moon, ShieldCheck, Shuffle, Timer, WifiOff, X } from 'lucide-react';
import Modal from './ui/Modal';
import { getWhatsAppStatus, getStageTemplate, type WhatsAppStatus } from '../lib/whatsapp';
import { countVariations } from '../lib/messageVariation';
import { estimateBulkDelivery, describeBulkEta } from '../lib/whatsappPacing';
import { formatWindowHour } from '../lib/sendWindow';

/**
 * Before a BULK move to a stage that messages candidates: how many WhatsApp messages
 * that is, how long they take at the protective pace, whether the stage's template
 * varies per candidate — and the choice to notify by email only, or not at all.
 *
 * Many near-identical messages to strangers at once is the riskiest thing this app can
 * do to the company number (it's what got numbers banned); the recruiter now makes that
 * call knowingly instead of it happening as a side effect of a stage change.
 */

/** 'whatsapp' = WhatsApp + email (as always); 'email' = email only; 'none' = just move. */
export type BulkNotifyChoice = 'whatsapp' | 'email' | 'none';

interface NotifyRequest {
  stage: string;
  count: number;
  /** How many of them have an email (for the email-only option). */
  withEmail: number;
}

export function useBulkNotifyConfirm() {
  const [request, setRequest] = useState<(NotifyRequest & { resolve: (c: BulkNotifyChoice | null) => void }) | null>(null);

  /** Resolves with the recruiter's choice, or null if they cancelled the move. */
  const ask = async (stage: string, count: number, withEmail: number): Promise<BulkNotifyChoice | null> => {
    // A stage without a template sends nothing: no reason to ask.
    try {
      if (!(await getStageTemplate(stage))) return 'whatsapp';
    } catch { /* can't tell — ask anyway */ }
    return new Promise(resolve => setRequest({ stage, count, withEmail, resolve }));
  };

  const finish = (choice: BulkNotifyChoice | null) => {
    request?.resolve(choice);
    setRequest(null);
  };

  return { ask, element: <BulkNotifyConfirmModal request={request} onDone={finish} /> };
}

function BulkNotifyConfirmModal({ request, onDone }: { request: NotifyRequest | null; onDone: (c: BulkNotifyChoice | null) => void }) {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [variants, setVariants] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [choice, setChoice] = useState<BulkNotifyChoice>('whatsapp');

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setLoading(true);
    setChoice('whatsapp');
    setStatus(null);
    setVariants(null);
    Promise.all([getWhatsAppStatus(), getStageTemplate(request.stage).catch(() => '')])
      .then(([st, tpl]) => {
        if (cancelled) return;
        setStatus(st);
        setVariants(tpl ? countVariations(tpl) : null);
        // WhatsApp can't deliver at all (no connection AND no queue): don't preselect it.
        if (!st.connected && !st.outbox) setChoice(request.withEmail > 0 ? 'email' : 'none');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [request]);

  if (!request) return null;
  const { stage, count, withEmail } = request;
  const now = Date.now();
  const eta = status ? estimateBulkDelivery(count, status.pending, status.pacing, now) : null;
  const win = status?.pacing?.sendWindow;
  const windowClosed = !!win && win.open === false;
  // No durable queue (dev) and no connection: WhatsApp messages would simply be lost.
  const whatsappImpossible = !!status && !status.connected && !status.outbox;

  const option = (value: BulkNotifyChoice, icon: ReactNode, title: string, detail: ReactNode, disabled = false) => (
    <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
      choice === value ? 'border-indigo-400 bg-indigo-50/60' : 'border-slate-200 hover:bg-slate-50'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <input type="radio" name="bulk-notify" className="mt-1 text-indigo-600 focus:ring-indigo-500" checked={choice === value}
        disabled={disabled} onChange={() => setChoice(value)} />
      <span className="text-indigo-600 mt-0.5">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-800">{title}</span>
        <span className="block text-xs text-slate-500 mt-0.5">{detail}</span>
      </span>
    </label>
  );

  return (
    <Modal isOpen={!!request} onClose={() => onDone(null)} overlayClassName="bg-slate-900/50 z-[120]">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="flex items-start">
            <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl mr-3 shrink-0">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Mover {count === 1 ? '1 candidato' : `${count} candidatos`} a «{stage}»
              </h2>
              <p className="text-xs text-slate-500">Esta etapa les avisa por WhatsApp (y por correo a quien lo tenga). ¿Cómo quieres avisarles?</p>
            </div>
          </div>
          <button onClick={() => onDone(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg" aria-label="Cancelar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-slate-500 flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Revisando WhatsApp…</p>
          ) : (
            <>
              {status && !status.connected && (
                <p className={`text-xs font-medium rounded-lg px-3 py-2 flex items-start border ${whatsappImpossible ? 'text-rose-700 bg-rose-50 border-rose-100' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
                  <WifiOff className="w-4 h-4 mr-2 shrink-0" />
                  {whatsappImpossible
                    ? 'WhatsApp está desconectado y este servidor no tiene cola: los mensajes de WhatsApp NO se enviarán. Conéctalo en Configuración o avisa solo por correo.'
                    : status.suspended
                      ? 'WhatsApp está en pausa (requiere "Forzar Reconexión" en Configuración). Los mensajes quedan en cola y saldrán al reconectar: no se pierde ninguno.'
                      : 'WhatsApp está desconectado en este momento. Los mensajes quedan en cola y saldrán solos al reconectar: no se pierde ninguno.'}
                </p>
              )}

              {option('whatsapp', <MessageSquare className="w-4 h-4" />, 'WhatsApp y correo, poco a poco',
                'Uno a uno, con pausas y una redacción distinta para cada candidato, para proteger el número.', whatsappImpossible)}

              {choice === 'whatsapp' && !whatsappImpossible && (
                <div className="ml-2 pl-3 border-l-2 border-indigo-100 space-y-2 text-xs text-slate-600">
                  {eta && (
                    <p className="flex items-start"><Timer className="w-3.5 h-3.5 mr-1.5 mt-0.5 text-indigo-500 shrink-0" />
                      <span>
                        {describeBulkEta(eta, status?.pacing, now)}
                        {status && status.pending > 0 ? ` Ya hay ${status.pending === 1 ? '1 mensaje' : `${status.pending} mensajes`} en cola antes que estos.` : ''}
                        {eta.later > 0 ? ` Los que no alcancen a salir en ${status?.pacing?.maxQueueHours || 48} h vencen y no se envían (para no mandar información vieja).` : ''}
                      </span>
                    </p>
                  )}
                  {windowClosed && win && (
                    <p className="flex items-start"><Moon className="w-3.5 h-3.5 mr-1.5 mt-0.5 text-indigo-500 shrink-0" />
                      <span>Ahora es fuera del horario de envío ({formatWindowHour(win.start)} – {formatWindowHour(win.end)}): los mensajes esperan a la mañana.</span>
                    </p>
                  )}
                  {variants !== null && (variants > 1 ? (
                    <p className="flex items-start"><Shuffle className="w-3.5 h-3.5 mr-1.5 mt-0.5 text-emerald-600 shrink-0" />
                      <span>La plantilla tiene {variants >= 1000 ? 'más de 1.000' : variants} versiones: ningún candidato recibe el mismo texto que otro.</span>
                    </p>
                  ) : (
                    <p className="flex items-start text-amber-700 font-medium"><AlertTriangle className="w-3.5 h-3.5 mr-1.5 mt-0.5 shrink-0" />
                      <span>
                        La plantilla de esta etapa no tiene variaciones: todos recibirán exactamente el mismo texto (mayor riesgo de bloqueo).{' '}
                        <Link to="/settings" className="underline" onClick={() => onDone(null)}>Agregar variaciones</Link>
                      </span>
                    </p>
                  ))}
                </div>
              )}

              {option('email', <Mail className="w-4 h-4" />, 'Solo por correo',
                <>Sin ningún riesgo para el número de WhatsApp. {withEmail === count ? 'Todos tienen correo.' : `${withEmail} de ${count} tienen correo; los demás no recibirán aviso.`}</>,
                withEmail === 0)}
              {option('none', <ShieldCheck className="w-4 h-4" />, 'Solo mover, sin avisar',
                'No se envía nada. Podrás escribirles después desde su perfil.')}
            </>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button onClick={() => onDone(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onDone(choice)}
            disabled={loading}
            className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            Mover {count === 1 ? '1 candidato' : `${count} candidatos`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
