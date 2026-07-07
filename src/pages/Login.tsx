import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ShieldCheck, Loader2, ArrowLeft } from 'lucide-react';

export default function Login() {
  const { loginWithGoogle, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [signingIn, setSigningIn] = useState(false);
  const [company, setCompany] = useState<{ name: string; logoUrl: string }>({ name: '', logoUrl: '' });

  const from = location.state?.from?.pathname || '/';

  // Consume the post-logout flag here (not during DashboardLayout's render, which must
  // stay pure). Reaching /login is the terminal step of a staff logout, so this is the
  // right place to clear it.
  useEffect(() => {
    try { sessionStorage.removeItem('staffLoggedOut'); } catch { /* storage disabled */ }
  }, []);

  // Company branding from the cached public endpoint (no Firestore reads per visit).
  useEffect(() => {
    let alive = true;
    fetch('/api/public/careers-data')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (alive && data?.company) {
          setCompany({ name: data.company.name || '', logoUrl: data.company.logoUrl || '' });
        }
      })
      .catch(() => { /* branding is optional */ });
    return () => { alive = false; };
  }, []);

  // A real (non-anonymous) staff member who is already signed in shouldn't see the
  // login form — send them into the panel. Anonymous applicant sessions are ignored
  // so a staff member can still sign in on a browser where someone applied.
  if (user && !user.isAnonymous) {
    return <Navigate to={from} replace />;
  }

  const handleLogin = async () => {
    try {
      setSigningIn(true);
      await loginWithGoogle();
      navigate(from, { replace: true });
    } catch (error) {
      console.error('Failed to login', error);
      setSigningIn(false);
      alert('Error al iniciar sesión. Por favor, intenta de nuevo.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Ambient brand glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-violet-600/20 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex flex-col items-center">
          {company.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-14 max-w-[220px] object-contain mb-4" />
          ) : (
            <div className="w-14 h-14 bg-violet-600 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-600/30 mb-4">
              <ShieldCheck className="w-8 h-8 text-white" />
            </div>
          )}
          <h2 className="text-center text-2xl font-display font-bold text-white">
            Panel del equipo
          </h2>
          <p className="mt-2 text-center text-sm text-slate-400">
            {company.name || 'Sistema de reclutamiento'} · acceso solo para personal autorizado
          </p>
        </div>

        <div className="mt-8 bg-white/5 backdrop-blur-sm border border-white/10 py-8 px-6 shadow-2xl rounded-3xl">
          <button
            onClick={handleLogin}
            disabled={signingIn}
            className="w-full flex justify-center items-center gap-2 py-3.5 px-4 rounded-xl shadow-sm text-sm font-bold text-slate-800 bg-white hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-violet-500 transition-colors disabled:opacity-60"
          >
            {signingIn ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Iniciando sesión…</>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                  <path fill="#FBBC05" d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84Z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
                </svg>
                Iniciar sesión con Google
              </>
            )}
          </button>

          <p className="mt-4 text-center text-[11px] text-slate-500">
            Si tu cuenta es nueva, un administrador debe aprobar tu acceso.
          </p>
        </div>

        {/* Escape hatch for a candidate who lands here by mistake. */}
        <div className="mt-6 text-center">
          <Link to="/careers" className="inline-flex items-center text-sm font-medium text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            ¿Buscas empleo? Ver vacantes
          </Link>
        </div>
      </div>
    </div>
  );
}
