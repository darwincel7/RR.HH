import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Plus, Briefcase, Link as LinkIcon, ExternalLink, Sparkles, Trash2, AlertTriangle, Edit3, ChevronDown, CheckCircle, Star } from 'lucide-react';

export default function Vacancies() {
  const navigate = useNavigate();
  const [vacancies, setVacancies] = useState<any[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState<any>(null);
  
  // Form fields
  const [newTitle, setNewTitle] = useState('Asesor de Ventas y Soporte');
  const [newCode, setNewCode] = useState('BANI-001');
  const [location, setLocation] = useState('Presencial / BANI');
  const [schedule, setSchedule] = useState('9:00AM A 7:00PM - 5 dias a la semana (disponibilidad de horario rotativo)');
  const [functions, setFunctions] = useState('Atender consultas y requerimientos del área de ventas.\nGestionar procesos internos y seguimiento de tareas.\nSeguimiento de clientes para maximizar ventas.\nCumplir metas y reportar resultados.');
  const [requirements, setRequirements] = useState('Experiencia previa o no en el área (preferible).\nManejo básico de herramientas digitales.\nExcelente comunicación y capacidad de resolución.\nResponsable, puntual y orientado a resultados.\nIndispensable excelente ortografía.');
  const [offers, setOffers] = useState('Sueldo competitivo de $20.000 a $30.000\nCapacitación inicial y continua.\nOportunidad de crecimiento dentro de la empresa.\nCrecimiento profesional con capacitaciones externas constantes.');
  
  const [vacancyToDelete, setVacancyToDelete] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null); // which vacancy's details are open
  const [newCounts, setNewCounts] = useState<Record<string, number>>({}); // vacancyId -> # of "Nuevo" applicants

  useEffect(() => {
    const q = query(collection(db, 'vacancies'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const v = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setVacancies(v);
    }, (error) => {
      console.error("Error fetching vacancies:", error);
    });

    return () => unsubscribe();
  }, []);

  // LIVE count of applicants sitting in the first stage ("Nuevo") per vacancy — the
  // badge updates the moment a new candidate applies, no refresh needed.
  useEffect(() => {
    const qNew = query(collection(db, 'applications'), where('stage', '==', 'Nuevo'));
    const unsub = onSnapshot(qNew, (snapshot) => {
      const counts: Record<string, number> = {};
      snapshot.docs.forEach(d => {
        const vid = d.data().vacancyId;
        if (vid) counts[vid] = (counts[vid] || 0) + 1;
      });
      setNewCounts(counts);
    }, (error) => console.error('Error contando nuevos:', error));
    return () => unsub();
  }, []);

  const resetForm = () => {
    setNewTitle('Asesor de Ventas y Soporte');
    setNewCode('BANI-001');
    setLocation('Presencial / BANI');
    setSchedule('9:00AM A 7:00PM - 5 dias a la semana (disponibilidad de horario rotativo)');
    setFunctions('Atender consultas y requerimientos del área de ventas.\nGestionar procesos internos y seguimiento de tareas.\nSeguimiento de clientes para maximizar ventas.\nCumplir metas y reportar resultados.');
    setRequirements('Experiencia previa o no en el área (preferible).\nManejo básico de herramientas digitales.\nExcelente comunicación y capacidad de resolución.\nResponsable, puntual y orientado a resultados.\nIndispensable excelente ortografía.');
    setOffers('Sueldo competitivo de $20.000 a $30.000\nCapacitación inicial y continua.\nOportunidad de crecimiento dentro de la empresa.\nCrecimiento profesional con capacitaciones externas constantes.');
  };

  const openEditModal = (vacancy: any) => {
    setIsEditing(vacancy);
    setNewTitle(vacancy.title || '');
    setNewCode(vacancy.code || '');
    setLocation(vacancy.location || 'Remoto / Presencial');
    setSchedule(vacancy.schedule || '9:00AM A 6:00PM - Lunes a Viernes');
    setFunctions(vacancy.functions || 'Atender consultas y requerimientos del área.\nGestionar procesos internos y seguimiento de tareas.\nCumplir metas y reportar resultados.');
    setRequirements(vacancy.requirements || 'Experiencia previa en el área (preferible).\nManejo básico de herramientas digitales.\nExcelente comunicación y capacidad de resolución.\nResponsable, puntual y orientado a resultados.');
    setOffers(vacancy.offers || 'Sueldo base competitivo.\nCapacitación inicial y continua.\nOportunidad de crecimiento dentro de la empresa.');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newCode) return;

    try {
      if (isEditing) {
        await updateDoc(doc(db, 'vacancies', isEditing.id), {
          title: newTitle,
          code: newCode,
          location,
          schedule,
          functions,
          requirements,
          offers
        });
        setIsEditing(null);
      } else {
        const newDocRef = doc(collection(db, 'vacancies'));
        await setDoc(newDocRef, {
          id: newDocRef.id,
          title: newTitle,
          code: newCode,
          location,
          schedule,
          functions,
          requirements,
          offers,
          active: true,
          createdAt: serverTimestamp()
        });
        setIsCreating(false);
      }
      resetForm();
    } catch (error) {
      console.error("Error saving vacancy", error);
      alert("Error al guardar la vacante");
    }
  };

  const handleDelete = async () => {
    if (!vacancyToDelete) return;
    try {
      await deleteDoc(doc(db, 'vacancies', vacancyToDelete));
      setVacancyToDelete(null);
    } catch (error) {
      console.error("Error deleting vacancy:", error);
      alert("Error al eliminar la vacante");
    }
  };

  return (
    <div className="animate-slide-up">
      <div className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900 tracking-tight">Vacantes</h1>
          <p className="text-slate-500 mt-1">Gestiona los embudos de contratación y publica nuevas posiciones. Toca la etiqueta Activa/Inactiva para publicarla u ocultarla del portal.</p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="bg-slate-900 text-white px-6 py-3 rounded-xl hover:bg-slate-800 transition-all duration-300 flex items-center font-medium shadow-lg shadow-slate-900/20 hover:shadow-slate-900/40 hover:-translate-y-0.5"
        >
          <Plus className="w-5 h-5 mr-2" />
          Nueva Vacante
        </button>
      </div>

      <div className="flex flex-col space-y-4">
        {vacancies.map((vacancy) => (
          <div
            key={vacancy.id}
            className="glass-card rounded-2xl p-5 group relative overflow-hidden hover:shadow-xl transition-all duration-300 flex flex-col gap-4"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-ai opacity-5 blur-3xl group-hover:opacity-20 transition-opacity duration-500 rounded-full -mr-10 -mt-10"></div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer" onClick={() => navigate(`/vacancies/${vacancy.id}/kanban`)}>
            <div className="flex items-center gap-4 relative z-10 flex-1">
              <div className="relative p-3 bg-violet-50 text-violet-600 rounded-2xl shrink-0">
                <Briefcase className="w-6 h-6" />
                {newCounts[vacancy.id] > 0 && (
                  <span
                    title={`${newCounts[vacancy.id]} candidato(s) nuevo(s) sin revisar`}
                    className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1 bg-rose-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center shadow-md ring-2 ring-white animate-fade-in"
                  >
                    {newCounts[vacancy.id] > 99 ? '99+' : newCounts[vacancy.id]}
                  </span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-lg font-display font-bold text-slate-900 group-hover:text-violet-600 transition-colors">{vacancy.title}</h3>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await updateDoc(doc(db, 'vacancies', vacancy.id), { active: !vacancy.active });
                      } catch (err) {
                        console.error('No se pudo cambiar el estado de la vacante:', err);
                        alert('No se pudo cambiar el estado de la vacante.');
                      }
                    }}
                    title={vacancy.active ? 'Clic para desactivar (se oculta del portal público)' : 'Clic para activar (se publica en el portal)'}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider transition-colors cursor-pointer ${vacancy.active ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {vacancy.active ? 'Activa' : 'Inactiva'}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 font-medium">
                  <span>Código: {vacancy.code}</span>
                  {vacancy.location && (
                    <>
                      <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-slate-300"></span>
                      <span>{vacancy.location}</span>
                    </>
                  )}
                  {vacancy.schedule && (
                    <>
                      <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-slate-300"></span>
                      <span>{vacancy.schedule}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            
            <div className="relative z-10 flex items-center gap-4 md:border-l md:border-slate-100 md:pl-6" onClick={e => e.stopPropagation()}>
              <div className="flex space-x-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === vacancy.id ? null : vacancy.id); }}
                  className="text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors flex items-center bg-slate-100 px-3 py-1.5 rounded-lg hover:bg-slate-200"
                  title="Ver la descripción completa del puesto"
                >
                  Detalles <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform ${expandedId === vacancy.id ? 'rotate-180' : ''}`} />
                </button>
                <button
                  onClick={() => navigate(`/vacancies/${vacancy.id}/kanban`)}
                  className="text-sm font-bold text-violet-600 hover:text-violet-800 transition-colors flex items-center bg-violet-50 px-3 py-1.5 rounded-lg hover:bg-violet-100"
                >
                  Embudo <ExternalLink className="w-3 h-3 ml-1.5" />
                </button>
                <button 
                  onClick={() => navigate(`/vacancies/${vacancy.id}/ranking`)}
                  className="text-sm font-bold text-orange-500 hover:text-orange-700 transition-colors bg-orange-50 px-3 py-1.5 rounded-lg hover:bg-orange-100"
                >
                  Ranking
                </button>
              </div>
              <div className="flex space-x-1 border-l border-slate-100 pl-4">
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/apply/${vacancy.id}`;
                    navigator.clipboard.writeText(url);
                    alert('Link copiado al portapapeles');
                  }}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                  title="Copiar link público"
                >
                  <LinkIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => openEditModal(vacancy)}
                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                  title="Editar vacante"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setVacancyToDelete(vacancy.id)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                  title="Eliminar vacante"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            </div>

            {/* Expandable full description of the position (view + quick edit). */}
            {expandedId === vacancy.id && (
              <div className="relative z-10 border-t border-slate-100 pt-4 grid grid-cols-1 md:grid-cols-3 gap-5 text-sm animate-fade-in">
                <div>
                  <h4 className="font-bold text-slate-700 mb-2 text-[11px] uppercase tracking-wider flex items-center"><Briefcase className="w-3.5 h-3.5 mr-1.5 text-violet-500" />Funciones</h4>
                  <ul className="space-y-1 text-slate-600 list-disc list-inside">
                    {(vacancy.functions || '').split('\n').map((s: string) => s.trim()).filter(Boolean).map((l: string, i: number) => <li key={i}>{l}</li>)}
                    {!(vacancy.functions || '').trim() && <li className="list-none text-slate-400 italic">Sin descripción</li>}
                  </ul>
                </div>
                <div>
                  <h4 className="font-bold text-slate-700 mb-2 text-[11px] uppercase tracking-wider flex items-center"><CheckCircle className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />Requisitos</h4>
                  <ul className="space-y-1 text-slate-600 list-disc list-inside">
                    {(vacancy.requirements || '').split('\n').map((s: string) => s.trim()).filter(Boolean).map((l: string, i: number) => <li key={i}>{l}</li>)}
                    {!(vacancy.requirements || '').trim() && <li className="list-none text-slate-400 italic">Sin requisitos</li>}
                  </ul>
                </div>
                <div>
                  <h4 className="font-bold text-slate-700 mb-2 text-[11px] uppercase tracking-wider flex items-center"><Star className="w-3.5 h-3.5 mr-1.5 text-amber-500" />Ofrecemos</h4>
                  <ul className="space-y-1 text-slate-600 list-disc list-inside">
                    {(vacancy.offers || '').split('\n').map((s: string) => s.trim()).filter(Boolean).map((l: string, i: number) => <li key={i}>{l}</li>)}
                    {!(vacancy.offers || '').trim() && <li className="list-none text-slate-400 italic">Sin beneficios</li>}
                  </ul>
                </div>
                <div className="md:col-span-3 flex flex-wrap gap-3 justify-between items-center pt-3 border-t border-slate-100">
                  <span className="text-xs text-slate-400">📍 {vacancy.location || '—'}  ·  🕒 {vacancy.schedule || '—'}</span>
                  <button
                    onClick={() => openEditModal(vacancy)}
                    className="flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    <Edit3 className="w-4 h-4 mr-1.5" /> Editar estos detalles
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {vacancies.length === 0 && !isCreating && (
          <div className="text-center py-16 glass-card rounded-3xl border-dashed">
            <Briefcase className="mx-auto h-16 w-16 text-slate-300 mb-4" />
            <h3 className="text-xl font-display font-bold text-slate-900">No hay vacantes</h3>
            <p className="mt-2 text-slate-500">Comienza creando una nueva vacante para reclutar.</p>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(isCreating || isEditing) && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 animate-fade-in overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-8 w-full max-w-5xl shadow-2xl animate-slide-up">
            <div className="flex items-center mb-6">
              <div className="p-2 bg-violet-100 text-violet-600 rounded-xl mr-3">
                {isEditing ? <Edit3 className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
              </div>
              <h2 className="text-2xl font-display font-bold text-slate-900">
                {isEditing ? 'Editar Vacante' : 'Crear Vacante'}
              </h2>
            </div>
            
            <form onSubmit={handleSave} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Título del puesto</label>
                  <input
                    type="text"
                    required
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-all outline-none"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Ej. Desarrollador Frontend"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Código interno</label>
                  <input
                    type="text"
                    required
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-all outline-none"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder="Ej. DEV-001"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Ubicación</label>
                  <input
                    type="text"
                    required
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-all outline-none"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Ej. Remoto / Presencial"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Horario</label>
                  <input
                    type="text"
                    required
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-all outline-none"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    placeholder="Ej. 9:00AM A 6:00PM"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Funciones principales (una por línea)</label>
                <textarea
                  required
                  rows={9}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-all outline-none resize-y min-h-[190px]"
                  value={functions}
                  onChange={(e) => setFunctions(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Requisitos (uno por línea)</label>
                <textarea
                  required
                  rows={9}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-all outline-none resize-y min-h-[190px]"
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Ofrecemos (uno por línea)</label>
                <textarea
                  required
                  rows={9}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-all outline-none resize-y min-h-[190px]"
                  value={offers}
                  onChange={(e) => setOffers(e.target.value)}
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setIsEditing(null);
                    resetForm();
                  }}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-ai rounded-xl hover:opacity-90 transition-opacity shadow-lg shadow-violet-500/30"
                >
                  {isEditing ? 'Guardar Cambios' : 'Publicar Vacante'}
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Delete Confirmation Modal */}
      {vacancyToDelete && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl animate-slide-up">
            <div className="flex items-center mb-4">
              <div className="p-3 bg-red-100 text-red-600 rounded-2xl mr-4">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-display font-bold text-slate-900">Eliminar Vacante</h2>
            </div>
            <p className="text-slate-600 mb-8">
              ¿Estás seguro de que deseas eliminar esta vacante? Esta acción no se puede deshacer y los candidatos asociados podrían perder su referencia.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setVacancyToDelete(null)}
                className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-lg shadow-red-500/30"
              >
                Sí, Eliminar
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}
