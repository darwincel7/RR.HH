import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Link } from 'react-router-dom';
import { Briefcase, MapPin, Clock, ArrowRight, Sparkles, Building2, Users, Star, TrendingUp } from 'lucide-react';

export default function Careers() {
  const [vacancies, setVacancies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [company, setCompany] = useState({ name: 'AuraATS', logoUrl: '', careersImageUrl: '' });

  const applyCompany = (c: any) => {
    if (!c) return;
    setCompany({
      name: c.name || 'AuraATS',
      logoUrl: c.logoUrl || '',
      careersImageUrl: c.careersImageUrl || '',
    });
  };

  async function fetchData() {
    setLoading(true);
    setLoadError(false);
    // Primary source: the server's cached endpoint. The whole public traffic costs at
    // most one Firestore read per minute, so a visitor spike can never exhaust the
    // database quota again (which used to blank the portal into "no hay vacantes").
    try {
      const res = await fetch('/api/public/careers-data');
      if (res.status === 503) {
        // The server explicitly said "database unavailable and no cached copy".
        // Falling back to direct Firestore would just stampede the same dead DB.
        setLoadError(true);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`careers-data ${res.status}`);
      const data = await res.json();
      applyCompany(data.company);
      setVacancies(Array.isArray(data.vacancies) ? data.vacancies : []);
      setLoading(false);
      return;
    } catch (err) {
      console.warn('careers-data endpoint failed, falling back to Firestore:', err);
    }
    // Fallback: direct Firestore reads (the old path), e.g. if the server is restarting.
    try {
      const [companySnap, vacSnap] = await Promise.all([
        getDoc(doc(db, 'settings', 'company')),
        getDocs(query(collection(db, 'vacancies'), where('active', '==', true))),
      ]);
      if (companySnap.exists()) applyCompany(companySnap.data());
      setVacancies(vacSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (error) {
      // Both paths failed (e.g. Firestore quota exhausted). This is an ERROR state,
      // not "there are no vacancies" — show retry instead of a misleading empty state.
      console.error("Error fetching careers data:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600"></div>
      </div>
    );
  }

  const perks = [
    { icon: Users, title: 'Crecimiento', subtitle: 'profesional' },
    { icon: Star, title: 'Ambiente', subtitle: 'colaborativo' },
    { icon: TrendingUp, title: 'Desarrollo', subtitle: 'continuo' },
  ];

  // Rendered twice: inside the left column on desktop, and glued right under
  // the team photo on mobile.
  const perksPanel = (
    <div className="rounded-3xl bg-gradient-to-r from-indigo-950 via-indigo-900 to-violet-900 px-6 py-6 shadow-xl">
      <div className="grid grid-cols-3 gap-3 sm:gap-6">
        {perks.map(({ icon: Icon, title, subtitle }) => (
          <div key={title} className="flex flex-col items-center text-center">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border-2 border-violet-400/60 bg-white/5 flex items-center justify-center mb-2">
              <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-violet-200" />
            </div>
            <span className="text-white font-bold text-xs sm:text-sm leading-tight">{title}</span>
            <span className="text-violet-300 text-xs sm:text-sm leading-tight">{subtitle}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* ================= HERO ================= */}
      <section className="relative bg-white overflow-hidden">
        <div className="grid lg:grid-cols-2 lg:min-h-[560px]">
          {/* ---- Content (desktop: left column / mobile: header above the photo) ---- */}
          <div className="relative z-20 flex flex-col lg:justify-center px-6 sm:px-10 lg:px-16 pt-5 pb-6 lg:py-16">
            {/* Logo — anchored to the top corner on mobile */}
            <div className="flex items-center mb-5 lg:mb-10">
              {company.logoUrl ? (
                <img src={company.logoUrl} alt={company.name} className="h-11 max-w-[190px] object-contain" />
              ) : (
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-violet-100 text-violet-700 rounded-xl flex items-center justify-center mr-3">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <span className="text-xl font-display font-bold text-slate-800 tracking-tight">{company.name}</span>
                </div>
              )}
            </div>

            {/* Heading */}
            <h1 className="font-display font-black tracking-tight text-slate-900 leading-[1.05] text-4xl sm:text-5xl lg:text-6xl">
              Únete a<br />
              <span className="text-violet-700">nuestro equipo</span>
            </h1>

            <p className="mt-3 lg:mt-5 text-lg sm:text-xl text-slate-500 font-medium">
              Aplica a nuestras vacantes
            </p>

            {/* Red accent line */}
            <div className="mt-4 lg:mt-6 h-1.5 w-20 rounded-full bg-red-600"></div>

            {/* Perks panel — desktop only (mobile shows it glued under the photo) */}
            <div className="hidden lg:block mt-10">{perksPanel}</div>
          </div>

          {/* ---- Team photo (desktop: right column / mobile: right after the heading) ---- */}
          <div className="relative min-h-[300px] sm:min-h-[400px] lg:min-h-full">
            {company.careersImageUrl ? (
              <img
                src={company.careersImageUrl}
                alt="Nuestro equipo de trabajo"
                className="absolute inset-0 w-full h-full object-cover object-center"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-violet-600 via-indigo-700 to-indigo-950 flex items-center justify-center">
                <Users className="w-24 h-24 text-white/30" />
              </div>
            )}
            {/* Soft blend into the white content panel (desktop only) */}
            <div className="hidden lg:block absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-white to-transparent pointer-events-none"></div>
          </div>

          {/* ---- Perks panel — mobile only, hugging the bottom of the team photo ---- */}
          <div className="lg:hidden relative z-20 px-4 sm:px-6 -mt-6">
            {perksPanel}
          </div>
        </div>
      </section>

      {/* ============ VACANCIES — floating cards overlapping the hero ============ */}
      <div
        id="vacantes"
        className={`relative z-30 max-w-6xl mx-auto px-4 sm:px-6 pb-16 scroll-mt-24 ${
          vacancies.length > 0 ? 'mt-8 lg:-mt-16' : 'pt-14'
        }`}
      >
        {loadError ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-amber-200 shadow-2xl max-w-xl mx-auto">
            <Briefcase className="w-16 h-16 text-amber-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-800 mb-2">Estamos recibiendo muchas visitas</h3>
            <p className="text-slate-500 mb-6">No pudimos cargar las vacantes en este momento. Por favor, intenta de nuevo en unos segundos — tu aplicación sí nos interesa.</p>
            <button
              onClick={fetchData}
              className="px-6 py-3 bg-violet-700 text-white font-bold rounded-xl hover:bg-violet-800 transition-colors"
            >
              Reintentar
            </button>
          </div>
        ) : vacancies.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-2xl max-w-xl mx-auto">
            <Briefcase className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-800 mb-2">No hay vacantes abiertas</h3>
            <p className="text-slate-500">Actualmente no tenemos posiciones abiertas. Vuelve a revisar pronto.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {vacancies.map(vacancy => (
              <div
                key={vacancy.id}
                className="bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl hover:-translate-y-1 hover:border-violet-200 transition-all duration-200 group flex flex-col"
              >
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-4 gap-3">
                    <h3 className="text-xl font-bold text-slate-900 group-hover:text-violet-700 transition-colors">
                      {vacancy.title}
                    </h3>
                    {vacancy.code && (
                      <span className="shrink-0 px-2.5 py-1 bg-violet-50 text-violet-700 text-xs font-bold rounded-lg">
                        {vacancy.code}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 mb-6">
                    {vacancy.location && (
                      <div className="flex items-center text-sm text-slate-600">
                        <MapPin className="w-4 h-4 mr-2 text-red-500" />
                        {vacancy.location}
                      </div>
                    )}
                    {vacancy.schedule && (
                      <div className="flex items-center text-sm text-slate-600">
                        <Clock className="w-4 h-4 mr-2 text-red-500" />
                        {vacancy.schedule}
                      </div>
                    )}
                  </div>

                  <p className="text-sm text-slate-500 line-clamp-4 mb-6 whitespace-pre-wrap">
                    {vacancy.functions}
                  </p>
                </div>

                <Link
                  to={`/apply/${vacancy.id}`}
                  className="w-full py-3 bg-slate-50 text-violet-700 font-bold rounded-xl text-center hover:bg-violet-50 transition-colors flex items-center justify-center group-hover:bg-violet-700 group-hover:text-white"
                >
                  Ver Detalles y Aplicar <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ================= FOOTER ================= */}
      <footer className="bg-white border-t border-slate-200 py-8 mt-12">
        <div className="max-w-5xl mx-auto px-4 text-center text-slate-500 text-sm">
          <p>&copy; {new Date().getFullYear()} {company.name}. Todos los derechos reservados.</p>
          <p className="mt-2 text-xs text-slate-400 flex items-center justify-center">
            Powered by AuraATS <Sparkles className="w-3 h-3 ml-1 text-violet-400" />
          </p>
          {/* Staff-only entry point — candidates never need an account. */}
          <p className="mt-4 text-xs">
            <Link to="/login" className="text-slate-300 hover:text-slate-500 transition-colors">Acceso equipo</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
