import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Link } from 'react-router-dom';
import { Briefcase, MapPin, Clock, ArrowRight, Sparkles, Building2 } from 'lucide-react';

export default function Careers() {
  const [vacancies, setVacancies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState({ name: 'AuraATS', logoUrl: '' });

  useEffect(() => {
    async function fetchData() {
      try {
        const companyRef = doc(db, 'settings', 'company');
        const q = query(collection(db, 'vacancies'), where('active', '==', true));

        const [companySnap, vacSnap] = await Promise.all([
          getDoc(companyRef),
          getDocs(q)
        ]);

        if (companySnap.exists()) {
          setCompany({
            name: companySnap.data().name || 'AuraATS',
            logoUrl: companySnap.data().logoUrl || ''
          });
        }

        setVacancies(vacSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error("Error fetching careers data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt={company.name} className="h-8 max-w-[150px] object-contain mr-3" />
            ) : (
              <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center mr-3">
                <Building2 className="w-5 h-5" />
              </div>
            )}
            <span className="text-xl font-display font-bold text-slate-800 tracking-tight">
              {company.name}
            </span>
          </div>
          <div className="text-sm font-medium text-slate-500">
            Portal de Empleo
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-slate-900 text-white py-20 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/20 to-purple-600/20"></div>
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <h1 className="text-4xl md:text-5xl font-display font-bold mb-6 tracking-tight">
            Únete a nuestro equipo
          </h1>
          <p className="text-lg text-slate-300 mb-8">
            Descubre las oportunidades que tenemos para ti y forma parte de nuestra misión.
          </p>
        </div>
      </div>

      {/* Vacancies List */}
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-slate-900">Vacantes Disponibles ({vacancies.length})</h2>
        </div>

        {vacancies.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-sm">
            <Briefcase className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-800 mb-2">No hay vacantes abiertas</h3>
            <p className="text-slate-500">Actualmente no tenemos posiciones abiertas. Vuelve a revisar pronto.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {vacancies.map(vacancy => (
              <div key={vacancy.id} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-all group flex flex-col">
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {vacancy.title}
                    </h3>
                    <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-lg">
                      {vacancy.code}
                    </span>
                  </div>
                  
                  <div className="space-y-2 mb-6">
                    {vacancy.location && (
                      <div className="flex items-center text-sm text-slate-600">
                        <MapPin className="w-4 h-4 mr-2 text-slate-400" />
                        {vacancy.location}
                      </div>
                    )}
                    {vacancy.schedule && (
                      <div className="flex items-center text-sm text-slate-600">
                        <Clock className="w-4 h-4 mr-2 text-slate-400" />
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
                  className="w-full py-3 bg-slate-50 text-indigo-600 font-bold rounded-xl text-center hover:bg-indigo-50 transition-colors flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white"
                >
                  Ver Detalles y Aplicar <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8 mt-12">
        <div className="max-w-5xl mx-auto px-4 text-center text-slate-500 text-sm">
          <p>&copy; {new Date().getFullYear()} {company.name}. Todos los derechos reservados.</p>
          <p className="mt-2 text-xs text-slate-400 flex items-center justify-center">
            Powered by AuraATS <Sparkles className="w-3 h-3 ml-1 text-violet-400" />
          </p>
        </div>
      </footer>
    </div>
  );
}
