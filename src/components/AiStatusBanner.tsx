import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiFetch } from '../lib/api';

/**
 * Tells the team when Google's AI is refusing calls for lack of budget (monthly
 * spending cap reached). Nothing is lost meanwhile — forms, tests and CVs are saved and
 * get evaluated on their own once the AI answers again — but someone has to raise the
 * cap, and before this banner nobody knew why scores stopped appearing.
 */
export default function AiStatusBanner() {
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await apiFetch('/api/ai/status');
        if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return;
        const data = await res.json();
        if (alive) setExhausted(!!data.budgetExhausted);
      } catch { /* offline: keep the last answer */ }
    };
    check();
    const timer = window.setInterval(check, 120_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  if (!exhausted) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 flex items-start shadow-sm z-[50] relative rounded-xl mb-6">
      <AlertTriangle className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0 text-amber-600" />
      <p className="text-sm">
        <strong>La IA de Google está sin saldo</strong> (se alcanzó el límite de gasto del mes). Los formularios, tests y CV
        que lleguen <strong>se guardan igual</strong> y se evaluarán solos cuando vuelva.{' '}
        Para reactivarla, sube el límite de gasto en{' '}
        <a href="https://ai.studio/spend" target="_blank" rel="noopener noreferrer" className="underline font-bold">AI Studio → Gasto</a>.
      </p>
    </div>
  );
}
