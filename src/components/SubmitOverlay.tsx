import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Full-screen animated progress shown during a slow operation (form submit + AI
 * evaluation, CV upload). The bar creeps continuously toward ~93% so the candidate
 * always sees motion and never assumes the page froze; it never claims 100% until the
 * caller unmounts it (operation actually finished).
 */
export default function SubmitOverlay({
  show,
  title,
  subtitle,
}: {
  show: boolean;
  title: string;
  subtitle?: string;
}) {
  const [pct, setPct] = useState(6);

  useEffect(() => {
    if (!show) return;
    setPct(6);
    const id = setInterval(() => {
      setPct((p) => {
        if (p >= 93) return 93; // hold near-complete until the real op resolves
        const step = p < 45 ? 5 : p < 70 ? 2.2 : p < 85 ? 1 : 0.4;
        return Math.min(93, p + step);
      });
    }, 350);
    return () => clearInterval(id);
  }, [show]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm text-center">
        <Loader2 className="w-10 h-10 text-violet-600 animate-spin mx-auto mb-4" />
        <h3 className="text-lg font-bold text-slate-900 mb-1">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 mb-5">{subtitle}</p>}
        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-gradient-to-r from-violet-500 to-indigo-600 h-2.5 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-slate-400 mt-3">{Math.round(pct)}%</p>
      </div>
    </div>
  );
}
