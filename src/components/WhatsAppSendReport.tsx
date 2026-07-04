import { AlertTriangle, CheckCircle, RefreshCw, X } from 'lucide-react';
import Modal from './ui/Modal';

export interface FailedSend {
  /** Application id (unique per row). */
  id: string;
  name: string;
  phone: string;
}

interface Props {
  /** null = hidden. */
  report: { stage: string; sent: number; failed: FailedSend[] } | null;
  retrying: boolean;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * Post-bulk-move delivery report. Shown ONLY when at least one automated WhatsApp
 * message failed, so the recruiter knows exactly WHO was not notified and can retry
 * those sends without re-moving anyone.
 */
export default function WhatsAppSendReport({ report, retrying, onRetry, onClose }: Props) {
  return (
    <Modal isOpen={!!report} onClose={retrying ? undefined : onClose} overlayClassName="bg-slate-900/50 z-[120]">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center mb-4">
          <div className="p-2 bg-amber-100 text-amber-600 rounded-xl mr-3">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Mensajes de WhatsApp pendientes</h2>
            <p className="text-xs text-slate-500">Etapa: {report?.stage}</p>
          </div>
        </div>

        {report && report.sent > 0 && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 mb-3 flex items-center">
            <CheckCircle className="w-4 h-4 mr-2 shrink-0" /> {report.sent} mensaje(s) enviados correctamente.
          </p>
        )}

        <p className="text-sm text-slate-600 mb-2">
          Los candidatos se movieron de etapa, pero a <strong>{report?.failed.length}</strong> no les llegó el
          mensaje automático:
        </p>
        <ul className="max-h-40 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-100 mb-4">
          {report?.failed.map(f => (
            <li key={f.id} className="px-3 py-2 text-sm text-slate-700 flex justify-between gap-2">
              <span className="font-medium truncate">{f.name}</span>
              <span className="text-slate-400 shrink-0">{f.phone}</span>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={retrying}
            className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4 inline mr-1" /> Cerrar
          </button>
          <button
            onClick={onRetry}
            disabled={retrying}
            className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm disabled:opacity-50 flex items-center"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Reenviando…' : 'Reintentar envíos fallidos'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
