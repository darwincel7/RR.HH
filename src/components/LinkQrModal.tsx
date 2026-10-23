import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from './ui/Modal';

/**
 * El QR de un link de candidato (test situacional, test de personalidad) para abrirlo en
 * un teléfono sin escribir nada ni pasar por WhatsApp: se apunta la cámara y listo.
 * El QR se genera al abrirse, solo una vez por link.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  url: string;
  title: string;
  /** Una línea bajo el título: quién lo escanea y con qué teléfono. */
  hint: string;
  /** Nombre accesible del diálogo. */
  label: string;
}

export default function LinkQrModal({ isOpen, onClose, url, title, hint, label }: Props) {
  // '' = no se pudo generar; null mientras se genera.
  const [qr, setQr] = useState<{ url: string; image: string } | null>(null);

  useEffect(() => {
    if (!isOpen || qr?.url === url) return;
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import('qrcode')).default;
        const image = await QRCode.toDataURL(url, { width: 280, margin: 1 });
        if (!cancelled) setQr({ url, image });
      } catch (e) {
        console.error('No se pudo generar el QR:', e);
        if (!cancelled) setQr({ url, image: '' });
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, url, qr?.url]);

  const image = qr?.url === url ? qr.image : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} closeOnBackdrop>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm text-center" role="dialog" aria-modal="true" aria-label={label}>
        <h3 className="text-lg font-bold text-slate-900 mb-1">{title}</h3>
        <p className="text-xs text-slate-500 mb-4">{hint}</p>
        <div className="flex items-center justify-center min-h-[280px]">
          {image === null ? <Loader2 className="w-8 h-8 animate-spin text-fuchsia-600" />
            : image ? <img src={image} alt={`Código ${label}`} className="w-[280px] h-[280px]" />
            : <p className="text-xs text-rose-700">No se pudo generar el QR. Usa "Copiar link".</p>}
        </div>
        <p className="mt-3 text-[11px] text-slate-400 break-all">{url}</p>
        <button
          onClick={onClose}
          className="mt-4 w-full py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800"
        >
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
