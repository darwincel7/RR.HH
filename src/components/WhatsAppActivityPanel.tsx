import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageCircle, CheckCheck, Check, Clock, AlertCircle, RotateCcw, X, ChevronRight, ChevronLeft,
  Loader2, Hand, Zap, Wrench, Send,
} from 'lucide-react';
import { useWhatsAppActivity } from '../contexts/WhatsAppActivityContext';
import {
  describeWait, whatLabel, deliveryLabel, whenLabel, dayLabel, formatClock, deliveryAttention,
  type ActivityData, type ActivityMessage,
} from '../lib/whatsappActivity';

/**
 * "Mensajes de WhatsApp" — always on the right edge of the staff app. Subtle on purpose:
 * small type, muted colors, red only for what didn't go out. Answers, per message, to
 * WHOM (name → profile), WHAT (which notification, automatic or typed by hand) and WHEN
 * (sent at, delivered/read, or roughly when it will go out).
 *
 * Desktop: a column that folds into a thin rail with the three counts. Phone: a small
 * pill in the corner that opens the same list as a drawer.
 */
export default function WhatsAppActivityPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const activity = useWhatsAppActivity();
  const [mobileOpen, setMobileOpen] = useState(false);
  const data = activity?.data;
  if (!activity || !data?.enabled) return null;

  const sentToday = data.sentToday ?? 0;
  const pendingCount = data.pending.length;
  const failedCount = data.failed.length;

  return (
    <>
      {/* ---- Desktop ---- */}
      <aside
        className={`hidden lg:flex fixed top-4 right-4 bottom-4 z-[40] flex-col rounded-3xl glass-panel bg-white/70 transition-all duration-300 ${open ? 'w-[300px]' : 'w-14'}`}
        aria-label="Mensajes de WhatsApp"
      >
        {open ? (
          <PanelBody data={data} onClose={onToggle} closeIcon={<ChevronRight className="w-4 h-4" />} />
        ) : (
          <button
            type="button"
            onClick={onToggle}
            title="Ver mensajes de WhatsApp"
            className="flex-1 flex flex-col items-center gap-4 py-5 rounded-3xl hover:bg-white/60 transition-colors"
          >
            <span className="relative">
              <MessageCircle className="w-5 h-5 text-slate-500" />
              <ConnectionDot connection={data.connection} suspended={data.suspended} className="absolute -top-0.5 -right-0.5" />
            </span>
            <ChevronLeft className="w-4 h-4 text-slate-300" />
            <RailCount icon={<CheckCheck className="w-4 h-4" />} value={sentToday} tone="text-emerald-600" title={`${sentToday} enviados hoy`} />
            <RailCount icon={<Clock className="w-4 h-4" />} value={pendingCount} tone="text-slate-500" title={`${pendingCount} en cola`} />
            {failedCount > 0 && (
              <RailCount icon={<AlertCircle className="w-4 h-4" />} value={failedCount} tone="text-rose-600" title={`${failedCount} no se pudieron enviar`} />
            )}
          </button>
        )}
      </aside>

      {/* ---- Phone / tablet ---- */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed bottom-4 right-4 z-[55] flex items-center gap-2.5 px-3 py-2 rounded-full bg-white/90 backdrop-blur border border-slate-200 shadow-lg text-xs font-bold"
        title="Mensajes de WhatsApp"
      >
        <MessageCircle className="w-4 h-4 text-slate-500" />
        <span className="flex items-center gap-1 text-emerald-600"><CheckCheck className="w-3.5 h-3.5" />{sentToday}</span>
        <span className="flex items-center gap-1 text-slate-500"><Clock className="w-3.5 h-3.5" />{pendingCount}</span>
        {failedCount > 0 && <span className="flex items-center gap-1 text-rose-600"><AlertCircle className="w-3.5 h-3.5" />{failedCount}</span>}
      </button>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-[90]">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-[88vw] max-w-sm bg-white shadow-2xl flex flex-col">
            <PanelBody data={data} onClose={() => setMobileOpen(false)} closeIcon={<X className="w-4 h-4" />} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

function RailCount({ icon, value, tone, title }: { icon: React.ReactNode; value: number; tone: string; title: string }) {
  return (
    <span title={title} className={`flex flex-col items-center gap-0.5 ${tone}`}>
      {icon}
      <span className="text-[11px] font-bold">{value}</span>
    </span>
  );
}

function ConnectionDot({ connection, suspended, className = '' }: { connection?: string; suspended?: boolean; className?: string }) {
  const ok = connection === 'connected' && !suspended;
  const connecting = !suspended && (connection === 'connecting' || connection === 'reconnecting');
  const color = ok ? 'bg-emerald-500' : connecting ? 'bg-amber-400' : 'bg-rose-500';
  return <span className={`inline-block w-2 h-2 rounded-full ring-2 ring-white ${color} ${className}`} />;
}

function PanelBody({ data, onClose, closeIcon, onNavigate }: {
  data: ActivityData; onClose: () => void; closeIcon: React.ReactNode; onNavigate?: () => void;
}) {
  const now = Date.now();
  const ok = data.connection === 'connected' && !data.suspended;
  const sentByDay: Array<{ day: string; items: ActivityMessage[] }> = [];
  for (const m of data.sent) {
    const day = m.sentAt ? dayLabel(Date.parse(m.sentAt), now) : '';
    const last = sentByDay[sentByDay.length - 1];
    if (last && last.day === day) last.items.push(m);
    else sentByDay.push({ day, items: [m] });
  }

  return (
    <>
      <div className="px-4 pt-4 pb-3 border-b border-slate-200/60">
        <div className="flex items-center justify-between">
          <p className="flex items-center text-sm font-bold text-slate-700">
            <MessageCircle className="w-4 h-4 mr-2 text-slate-400" /> Mensajes de WhatsApp
          </p>
          <button type="button" onClick={onClose} title="Ocultar" className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/70">
            {closeIcon}
          </button>
        </div>
        <p className="mt-1.5 flex items-center text-[11px] text-slate-500">
          <ConnectionDot connection={data.connection} suspended={data.suspended} className="mr-1.5 ring-0" />
          {ok ? 'Conectado' : (
            <Link to="/settings" onClick={onNavigate} className="text-rose-600 font-semibold hover:underline">Desconectado — los mensajes esperan</Link>
          )}
          <span className="mx-1.5 text-slate-300">·</span>
          Hoy {data.sentToday ?? 0}{data.dailyLimit ? ` de ${data.dailyLimit}` : ''} enviados
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {data.failed.length > 0 && (
          <Section title="No se enviaron" count={data.failed.length} tone="text-rose-600">
            {data.failed.map(m => <React.Fragment key={m.id}><FailedRow m={m} now={now} onNavigate={onNavigate} /></React.Fragment>)}
          </Section>
        )}

        <Section title="En cola" count={data.pending.length} tone="text-slate-500">
          {data.pending.length === 0
            ? <Empty>No hay mensajes esperando.</Empty>
            : data.pending.map(m => <React.Fragment key={m.id}><PendingRow m={m} now={now} onNavigate={onNavigate} /></React.Fragment>)}
        </Section>

        <Section title="Enviados" count={null} tone="text-emerald-700">
          {data.sent.length === 0
            ? <Empty>Todavía no se ha enviado ningún mensaje.</Empty>
            : sentByDay.map(g => (
              <div key={g.day} className="space-y-1">
                <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.day}</p>
                {g.items.map(m => <React.Fragment key={m.id}><SentRow m={m} now={now} onNavigate={onNavigate} /></React.Fragment>)}
              </div>
            ))}
        </Section>
      </div>

      <div className="px-4 py-2.5 border-t border-slate-200/60 text-center">
        <Link to="/settings" onClick={onNavigate} className="text-[11px] font-medium text-slate-400 hover:text-violet-600">
          Ritmo, límites y cola completa →
        </Link>
      </div>
    </>
  );
}

function Section({ title, count, tone, children }: { title: string; count: number | null; tone: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className={`px-1 mb-1.5 text-[11px] font-bold uppercase tracking-wider ${tone}`}>
        {title}{count !== null ? ` (${count})` : ''}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1 text-[11px] text-slate-400">{children}</p>;
}

/** Name (→ profile) + what, shared by every row. Click the row to read the message. */
function RowShell({ m, icon, children, onNavigate, className = '', expandedExtra }: {
  m: ActivityMessage; icon: React.ReactNode; children?: React.ReactNode; onNavigate?: () => void; className?: string;
  /** Shown under the message text when the row is open. */
  expandedExtra?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = m.candidateName || m.phone || 'Sin nombre';
  return (
    <div className={`rounded-xl px-2.5 py-2 hover:bg-white/80 transition-colors ${className}`}>
      <div className="flex items-start gap-2 cursor-pointer" onClick={() => setExpanded(v => !v)} title="Ver el mensaje">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-800 truncate">
            {m.candidateId ? (
              <Link to={`/candidates/${m.candidateId}`} onClick={(e) => { e.stopPropagation(); onNavigate?.(); }} className="hover:text-violet-700 hover:underline">
                {name}
              </Link>
            ) : name}
          </p>
          <p className="flex items-center text-[11px] text-slate-500 truncate">
            {m.origin === 'manual'
              ? <Hand className="w-3 h-3 mr-1 shrink-0 text-slate-400" />
              : <Zap className="w-3 h-3 mr-1 shrink-0 text-slate-400" />}
            <span className="truncate">{whatLabel(m)}</span>
          </p>
          {children}
        </div>
      </div>
      {expanded && (
        <p className="mt-1.5 ml-6 text-[11px] leading-snug text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5 whitespace-pre-line">
          {m.preview || '(sin texto)'}{m.preview.length >= 220 ? '…' : ''}
          {m.phone && <span className="block mt-1 text-slate-400">Para: {m.phone}</span>}
        </p>
      )}
      {expanded && expandedExtra}
    </div>
  );
}

function SentRow({ m, now, onNavigate }: { m: ActivityMessage; now: number; onNavigate?: () => void }) {
  const delivery = deliveryLabel(m);
  const attention = deliveryAttention(m, now);
  const icon = delivery === 'Enviado'
    ? <Check className={`w-3.5 h-3.5 ${attention ? 'text-amber-500' : 'text-emerald-500'}`} />
    : <CheckCheck className={`w-3.5 h-3.5 ${delivery === 'Leído' ? 'text-sky-500' : 'text-emerald-500'}`} />;
  const when = delivery === 'Leído' ? m.readAt : delivery === 'Entregado' ? m.deliveredAt : m.sentAt;
  return (
    <RowShell
      m={m} icon={icon} onNavigate={onNavigate}
      // Any message not read yet can be repaired from its open row — the candidate may
      // call to say "me sale esperando mensaje" before any signal reaches us.
      expandedExtra={!attention && !m.readAt ? <div className="ml-6"><StuckHelp m={m} now={now} /></div> : null}
    >
      <p className="text-[11px] text-slate-400">
        {/* The day is the group's heading — the row only needs the time. */}
        Enviado {m.sentAt ? formatClock(Date.parse(m.sentAt)) : ''}
        {delivery !== 'Enviado' && <> · <span className={delivery === 'Leído' ? 'text-sky-600' : 'text-emerald-600'}>{delivery}</span>{when && when !== m.sentAt ? ` ${whenLabel(when, now)}` : ''}</>}
      </p>
      {attention && <StuckHelp m={m} now={now} attention={attention} />}
    </RowShell>
  );
}

/**
 * "Esperando el mensaje. Esto puede tomar tiempo": the candidate's phone got a message
 * it couldn't decrypt. Says what we know and offers the two ways out.
 */
function StuckHelp({ m, now, attention }: { m: ActivityMessage; now: number; attention?: 'retry' | 'unconfirmed' }) {
  const activity = useWhatsAppActivity();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const busy = !!activity?.busy.has(m.id);
  const run = async (mode: 'repair' | 'resend') => {
    if (!activity) return;
    setError(null);
    setDone(null);
    const err = await activity.repair(m.id, mode);
    if (err) setError(err);
    else setDone(mode === 'repair' ? 'Listo: se reenvió con una sesión nueva.' : 'Copia nueva en cola: sale en un momento.');
  };
  return (
    <div className="mt-1 space-y-1" onClick={(e) => e.stopPropagation()}>
      {attention === 'retry' && (
        <p className="text-[11px] text-amber-700">
          Su teléfono no pudo abrirlo y pidió reenviarlo{m.lastRetryRequestAt ? ` (${whenLabel(m.lastRetryRequestAt, now)})` : ''}; se reenvió solo.
        </p>
      )}
      {attention === 'unconfirmed' && (
        <p className="text-[11px] text-amber-700">Sin confirmación de entrega: teléfono apagado o mensaje atascado.</p>
      )}
      {!attention && <p className="text-[11px] text-slate-500">¿Le sale «Esperando el mensaje»?</p>}
      {m.lastRepairAt && <p className="text-[10px] text-slate-400">Reparado {whenLabel(m.lastRepairAt, now)}</p>}
      {m.resentAt && <p className="text-[10px] text-slate-400">Copia nueva enviada {whenLabel(m.resentAt, now)}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
        ) : (
          <>
            {m.canRepair && (
              <button
                type="button"
                onClick={() => run('repair')}
                title="Renueva el cifrado con su teléfono y reenvía ESTE mismo mensaje: el «Esperando el mensaje» se convierte en el texto (no le llega duplicado)."
                className="inline-flex items-center px-2 py-1 text-[11px] font-bold rounded-lg bg-white border border-amber-200 text-amber-800 hover:bg-amber-50 transition-colors"
              >
                <Wrench className="w-3 h-3 mr-1" /> Reparar entrega
              </button>
            )}
            <button
              type="button"
              onClick={() => run('resend')}
              title="Envía una copia nueva del mensaje, empezando con un cifrado nuevo."
              className="inline-flex items-center px-2 py-1 text-[11px] font-medium rounded-lg text-slate-500 hover:text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 transition-colors"
            >
              <Send className="w-3 h-3 mr-1" /> Enviar de nuevo
            </button>
          </>
        )}
      </div>
      {done && <p className="text-[11px] text-emerald-700">{done}</p>}
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}

function PendingRow({ m, now, onNavigate }: { m: ActivityMessage; now: number; onNavigate?: () => void }) {
  const icon = m.waitReason === 'sending'
    ? <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin" />
    : <Clock className="w-3.5 h-3.5 text-slate-400" />;
  return (
    <RowShell m={m} icon={icon} onNavigate={onNavigate}>
      <p className={`text-[11px] ${m.waitReason === 'disconnected' ? 'text-amber-600' : 'text-slate-400'}`}>{describeWait(m, now)}</p>
    </RowShell>
  );
}

function FailedRow({ m, now, onNavigate }: { m: ActivityMessage; now: number; onNavigate?: () => void }) {
  const activity = useWhatsAppActivity();
  const [error, setError] = useState<string | null>(null);
  const busy = !!activity?.busy.has(m.id);
  const run = async (action: 'retry' | 'dismiss') => {
    if (!activity) return;
    setError(null);
    const err = action === 'retry' ? await activity.retry(m.id) : await activity.dismiss(m.id);
    if (err) setError(err);
  };
  return (
    <RowShell m={m} icon={<AlertCircle className="w-3.5 h-3.5 text-rose-500" />} onNavigate={onNavigate} className="bg-rose-50/70 hover:bg-rose-50 border border-rose-100">
      <p className="text-[11px] font-medium text-rose-600">{m.reason || 'No se pudo enviar'}</p>
      {m.hint && <p className="text-[11px] text-slate-500">{m.hint}</p>}
      {m.failedAt && <p className="text-[10px] text-slate-400">{whenLabel(m.failedAt, now)}</p>}
      <div className="mt-1.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
        ) : (
          <>
            {m.retryable !== false && (
              <button
                type="button"
                onClick={() => run('retry')}
                className="inline-flex items-center px-2 py-1 text-[11px] font-bold rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors"
              >
                <RotateCcw className="w-3 h-3 mr-1" /> Reintentar
              </button>
            )}
            <button
              type="button"
              onClick={() => run('dismiss')}
              title="Quitar de la lista (no se enviará)"
              className="inline-flex items-center px-2 py-1 text-[11px] font-medium rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition-colors"
            >
              <X className="w-3 h-3 mr-0.5" /> Quitar
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
    </RowShell>
  );
}
