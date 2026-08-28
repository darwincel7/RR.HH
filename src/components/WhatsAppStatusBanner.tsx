import React, { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';

export default function WhatsAppStatusBanner() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await apiFetch('/api/whatsapp/status');
        if (res.ok) {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await res.json();
            setStatus(data);
          }
        } else {
          setStatus({ status: 'disconnected' });
        }
      } catch (error) {
        console.error("Error checking WhatsApp status:", error);
        setStatus({ status: 'disconnected' });
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  if (!status || status.status === 'connected') {
    return null;
  }

  // With the durable outbox nothing is lost while disconnected — the banner says the
  // truth ("queued, will send on reconnect") instead of the old scary "won't be sent".
  const hasOutbox = !!status.outbox;
  const pending = Number(status.pending) || 0;
  return (
    <div className="bg-rose-500 text-white px-4 py-3 flex items-center justify-center shadow-md z-[50] relative rounded-xl mb-6">
      <AlertTriangle className="w-5 h-5 mr-3 flex-shrink-0" />
      <p className="text-sm font-medium">
        {hasOutbox
          ? <>WhatsApp está desconectado. {pending > 0 ? <><strong>{pending} mensaje(s) esperan en cola</strong> y se enviarán solos al reconectar.</> : 'Los mensajes nuevos quedarán en cola y se enviarán solos al reconectar.'}</>
          : <>WhatsApp está desconectado. Los mensajes automáticos no se enviarán.</>}{' '}
        <Link to="/settings" className="underline font-bold hover:text-rose-100 ml-2">
          {status.suspended ? 'Forzar Reconexión' : 'Conectar ahora'}
        </Link>
      </p>
    </div>
  );
}
