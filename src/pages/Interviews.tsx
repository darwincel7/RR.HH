import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, getDocs, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Calendar, Clock, User, MapPin, Plus, Loader2, CheckCircle, XCircle, Send, Users, Video } from 'lucide-react';
import { sendWhatsAppAutomation } from '../lib/whatsapp';
import Modal from '../components/ui/Modal';

export default function Interviews() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [participants, setParticipants] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  
  // Create Session Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSession, setNewSession] = useState({ title: '', date: '', time: '', location: '', type: 'virtual', vacancyId: '' });
  const [vacancies, setVacancies] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  // Add Participant Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [availableCandidates, setAvailableCandidates] = useState<any[]>([]);
  const [addingParticipant, setAddingParticipant] = useState(false);

  useEffect(() => {
    // Fetch vacancies for the dropdown
    const fetchVacancies = async () => {
      const vSnap = await getDocs(collection(db, 'vacancies'));
      setVacancies(vSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    };
    fetchVacancies();

    // Listen to sessions
    const qSessions = query(collection(db, 'interview_sessions'));
    const unsubSessions = onSnapshot(qSessions, (snapshot) => {
      const sessData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort by date and time
      sessData.sort((a: any, b: any) => {
        const dateA = new Date(`${a.date}T${a.time}`);
        const dateB = new Date(`${b.date}T${b.time}`);
        return dateA.getTime() - dateB.getTime();
      });
      setSessions(sessData);
      setLoading(false);
    });

    // Listen to participants
    const qParts = query(collection(db, 'interview_participants'));
    const unsubParts = onSnapshot(qParts, (snapshot) => {
      const partsBySession: Record<string, any[]> = {};
      snapshot.docs.forEach(d => {
        const data = { id: d.id, ...d.data() } as any;
        if (!partsBySession[data.sessionId]) partsBySession[data.sessionId] = [];
        partsBySession[data.sessionId].push(data);
      });
      setParticipants(partsBySession);
    });

    return () => {
      unsubSessions();
      unsubParts();
    };
  }, []);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const vacancy = vacancies.find(v => v.id === newSession.vacancyId);
      await addDoc(collection(db, 'interview_sessions'), {
        ...newSession,
        vacancyTitle: vacancy ? vacancy.title : 'General',
        createdAt: serverTimestamp()
      });
      setShowCreateModal(false);
      setNewSession({ title: '', date: '', time: '', location: '', type: 'virtual', vacancyId: '' });
    } catch (error) {
      console.error("Error creating session:", error);
      alert("Error al crear la sesión");
    } finally {
      setCreating(false);
    }
  };

  const openAddParticipantModal = async (sessionId: string, vacancyId: string) => {
    setSelectedSessionId(sessionId);
    setShowAddModal(true);
    // Clear the PREVIOUS session's list while loading (it showed stale entries).
    setAvailableCandidates([]);

    // Fetch candidates in "Convocado a entrevista" stage
    let qApps;
    if (vacancyId) {
      qApps = query(collection(db, 'applications'), where('stage', '==', 'Convocado a entrevista'), where('vacancyId', '==', vacancyId));
    } else {
      qApps = query(collection(db, 'applications'), where('stage', '==', 'Convocado a entrevista'));
    }

    const snap = await getDocs(qApps);
    // Exclude candidates ALREADY in this session — re-opening the modal used to offer
    // them again, creating duplicate participants and duplicate WhatsApp invitations.
    const alreadyIn = new Set((participants[sessionId] || []).map((p: any) => p.applicationId));
    setAvailableCandidates(snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(c => !alreadyIn.has(c.id)));
  };

  const handleAddParticipant = async (appId: string, candidateId: string, candidateName: string) => {
    setAddingParticipant(true);
    try {
      // Get candidate phone
      const candSnap = await getDoc(doc(db, 'candidates', candidateId));
      const phone = candSnap.exists() ? candSnap.data().phone : '';

      await addDoc(collection(db, 'interview_participants'), {
        sessionId: selectedSessionId,
        candidateId,
        applicationId: appId,
        candidateName,
        candidatePhone: phone,
        status: 'pending',
        addedAt: serverTimestamp()
      });

      // Remove from available list
      setAvailableCandidates(prev => prev.filter(c => c.id !== appId));

      // Send the interview invitation WITH the scheduled date/time/place. This is the
      // correct place for it (the session has the data) — the Kanban stage change no
      // longer sends a blank "Fecha: / Hora: ()" message.
      const session = sessions.find(s => s.id === selectedSessionId);
      if (session && phone) {
        const stageTemplate = session.type === 'presencial' ? 'Entrevista presencial' : 'Convocado a entrevista';
        const r = await sendWhatsAppAutomation(phone, stageTemplate, {
          nombre: candidateName,
          vacante: session.vacancyTitle,
          fecha: session.date,
          hora: session.time,
          ubicacion: session.location,
        });
        alert(r.status === 'sent'
          ? `Candidato añadido. Invitación enviada por WhatsApp para el ${session.date} a las ${session.time}.`
          : 'Candidato añadido, pero NO se pudo enviar la invitación por WhatsApp. Revisa la conexión de WhatsApp en Configuración.');
      } else if (session && !phone) {
        alert('Candidato añadido. No tiene teléfono registrado, así que no se envió la invitación.');
      }
    } catch (error) {
      console.error("Error adding participant:", error);
      alert('Error al añadir el candidato.');
    } finally {
      setAddingParticipant(false);
    }
  };

  const updateParticipantStatus = async (participantId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'interview_participants', participantId), { status: newStatus });
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  const sendReminder = async (participant: any, session: any) => {
    if (!participant.candidatePhone) {
      alert("El candidato no tiene número de teléfono registrado.");
      return;
    }
    
    try {
      const r = await sendWhatsAppAutomation(participant.candidatePhone, "Recordatorio de entrevista", {
        nombre: participant.candidateName,
        vacante: session.vacancyTitle,
        fecha: session.date,
        hora: session.time,
        ubicacion: session.location
      });

      if (r.status === 'sent') {
        alert("Recordatorio enviado con éxito.");
      } else {
        alert("No se pudo enviar el recordatorio por WhatsApp. Revisa la conexión de WhatsApp en Configuración.");
      }
    } catch (error) {
      console.error("Error sending reminder:", error);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-blue-600 w-8 h-8" /></div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agenda de Entrevistas</h1>
          <p className="text-slate-500">Organiza bloques horarios y registra la asistencia.</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="w-5 h-5 mr-2" />
          Nueva Sesión
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <Calendar className="w-16 h-16 mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-bold text-slate-700 mb-2">No hay entrevistas programadas</h3>
          <p className="text-slate-500 mb-6">Crea una nueva sesión para empezar a agendar candidatos.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg font-bold hover:bg-blue-100 transition-colors inline-flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" /> Crear Sesión
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {sessions.map(session => {
            const sessionParts = participants[session.id] || [];
            return (
              <div key={session.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                {/* Session Header */}
                <div className="p-5 border-b border-slate-100 bg-slate-50">
                  <div className="flex justify-between items-start mb-3">
                    <h2 className="text-lg font-bold text-slate-800">{session.title}</h2>
                    <span className="px-2.5 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full">
                      {session.vacancyTitle}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 text-sm text-slate-600">
                    <div className="flex items-center">
                      <Calendar className="w-4 h-4 mr-2 text-slate-400" />
                      {session.date}
                    </div>
                    <div className="flex items-center">
                      <Clock className="w-4 h-4 mr-2 text-slate-400" />
                      {session.time}
                    </div>
                    <div className="flex items-center col-span-2">
                      {session.type === 'virtual' ? <Video className="w-4 h-4 mr-2 text-slate-400" /> : <MapPin className="w-4 h-4 mr-2 text-slate-400" />}
                      <span className="truncate" title={session.location}>{session.location}</span>
                    </div>
                  </div>
                </div>

                {/* Participants List */}
                <div className="p-5 flex-1">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-slate-700 flex items-center">
                      <Users className="w-4 h-4 mr-2 text-slate-400" />
                      Candidatos ({sessionParts.length})
                    </h3>
                    <button
                      onClick={() => openAddParticipantModal(session.id, session.vacancyId)}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center"
                    >
                      <Plus className="w-3 h-3 mr-1" /> Añadir
                    </button>
                  </div>

                  {sessionParts.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4 italic">Sin candidatos asignados</p>
                  ) : (
                    <div className="space-y-3">
                      {sessionParts.map(part => (
                        <div key={part.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                          <div className="flex items-center">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs mr-3">
                              {part.candidateName.charAt(0)}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-800">{part.candidateName}</p>
                              <select
                                value={part.status}
                                onChange={(e) => updateParticipantStatus(part.id, e.target.value)}
                                className={`text-xs font-bold bg-transparent outline-none cursor-pointer mt-0.5 ${
                                  part.status === 'attended' ? 'text-emerald-600' : 
                                  part.status === 'no_show' ? 'text-rose-600' : 'text-amber-600'
                                }`}
                              >
                                <option value="pending" className="text-slate-800">⏳ Pendiente</option>
                                <option value="attended" className="text-slate-800">✅ Asistió</option>
                                <option value="no_show" className="text-slate-800">❌ No asistió</option>
                              </select>
                            </div>
                          </div>
                          <button
                            onClick={() => sendReminder(part, session)}
                            title="Enviar recordatorio por WhatsApp"
                            className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Session Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} overlayClassName="bg-slate-900/50 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">Nueva Sesión de Entrevistas</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleCreateSession} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Título</label>
                <input required type="text" value={newSession.title} onChange={e => setNewSession({...newSession, title: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Ej. Entrevistas Técnicas Frontend" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Vacante Asociada</label>
                <select value={newSession.vacancyId} onChange={e => setNewSession({...newSession, vacancyId: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">General (Todas)</option>
                  {vacancies.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Fecha</label>
                  <input required type="date" value={newSession.date} onChange={e => setNewSession({...newSession, date: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Hora</label>
                  <input required type="time" value={newSession.time} onChange={e => setNewSession({...newSession, time: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Tipo</label>
                  <select value={newSession.type} onChange={e => setNewSession({...newSession, type: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="virtual">Virtual</option>
                    <option value="presencial">Presencial</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Ubicación / Link</label>
                  <input required type="text" value={newSession.location} onChange={e => setNewSession({...newSession, location: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Meet, Zoom, o Dirección" />
                </div>
              </div>
              <button disabled={creating} type="submit" className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors mt-6 flex justify-center items-center">
                {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Crear Sesión'}
              </button>
            </form>
          </div>
      </Modal>

      {/* Add Participant Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} overlayClassName="bg-slate-900/50 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">Añadir Candidato</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <p className="text-sm text-slate-500 mb-4">Mostrando candidatos en etapa "Convocado a entrevista".</p>
              {availableCandidates.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  No hay candidatos disponibles en esta etapa.
                </div>
              ) : (
                <div className="space-y-3">
                  {availableCandidates.map(cand => (
                    <div key={cand.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:border-blue-300 transition-colors">
                      <span className="font-bold text-slate-700 text-sm">{cand.candidateName}</span>
                      <button
                        onClick={() => handleAddParticipant(cand.id, cand.candidateId, cand.candidateName)}
                        disabled={addingParticipant}
                        className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-md hover:bg-blue-100 transition-colors"
                      >
                        Añadir
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
      </Modal>
    </div>
  );
}