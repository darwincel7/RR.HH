import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, query, where, getDocs, doc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Trophy, CheckCircle, XCircle, AlertCircle, Star, GitCompare, X } from 'lucide-react';

import { sendWhatsAppAutomation } from '../lib/whatsapp';
import Modal from '../components/ui/Modal';

export default function Ranking() {
  const { vacancyId } = useParams();
  const [vacancy, setVacancy] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [decisionModal, setDecisionModal] = useState<{isOpen: boolean, candidateId: string, appId: string, type: 'Contratado' | 'Descartado' | null}>({ isOpen: false, candidateId: '', appId: '', type: null });
  const [decisionReason, setDecisionReason] = useState('');
  
  // Comparison state
  const [selectedForComparison, setSelectedForComparison] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  useEffect(() => {
    async function fetchData() {
      if (!vacancyId) return;
      
      // Fetch vacancy by document id (robust regardless of whether docs carry an `id` field)
      const vacDoc = await getDoc(doc(db, 'vacancies', vacancyId));
      if (vacDoc.exists()) setVacancy(vacDoc.data());

      // Fetch applications
      const q = query(collection(db, 'applications'), where('vacancyId', '==', vacancyId));
      const appSnap = await getDocs(q);
      
      const apps = appSnap.docs.map(doc => {
        const data = doc.data();
        let totalScore = 0;
        let stagesCompleted = 0;
        
        if (data.scoreSummary !== undefined && data.scoreSummary !== null) {
          totalScore += (data.scoreSummary * 20); // 1-5 to 20-100
          stagesCompleted++;
        }
        if (data.stage2Scoring?.total_score !== undefined && data.stage2Scoring?.total_score !== null) {
          totalScore += data.stage2Scoring.total_score;
          stagesCompleted++;
        }
        if (data.interviewObservation?.score !== undefined && data.interviewObservation?.score !== null) {
          totalScore += (data.interviewObservation.score * 20);
          stagesCompleted++;
        }
        if (data.testResults?.score !== undefined && data.testResults?.score !== null) {
          totalScore += data.testResults.score;
          stagesCompleted++;
        }
        
        const calculatedTotalScore = stagesCompleted > 0 ? Math.round(totalScore / stagesCompleted) : 0;
        
        return { ...data, id: doc.id, calculatedTotalScore };
      });

      // Sort by score descending
      apps.sort((a, b) => b.calculatedTotalScore - a.calculatedTotalScore);
      setCandidates(apps);
      setLoading(false);
    }
    fetchData();
  }, [vacancyId]);

  const handleDecision = async () => {
    if (!decisionModal.type || !decisionReason) return;
    
    try {
      await updateDoc(doc(db, 'applications', decisionModal.appId), {
        stage: decisionModal.type,
        decisionReason,
        decisionDate: new Date().toISOString(),
        lastStageUpdate: serverTimestamp()
      });
      
      setCandidates(prev => prev.map(c => c.id === decisionModal.appId ? { ...c, stage: decisionModal.type, decisionReason } : c));
      
      // Trigger Automation
      const candSnap = await getDoc(doc(db, 'candidates', decisionModal.candidateId));
      if (candSnap.exists()) {
        const phone = candSnap.data().phone;
        await sendWhatsAppAutomation(phone, decisionModal.type!, {
          nombre: candSnap.data().fullName || candSnap.data().name,
          vacante: vacancy?.title,
          email: candSnap.data().email
        });
      }

      setDecisionModal({ isOpen: false, candidateId: '', appId: '', type: null });
      setDecisionReason('');
    } catch (error) {
      console.error("Error saving decision:", error);
      alert("Error al guardar la decisión");
    }
  };

  const toggleComparison = (appId: string) => {
    setSelectedForComparison(prev => {
      if (prev.includes(appId)) return prev.filter(id => id !== appId);
      if (prev.length >= 3) {
        alert("Puedes comparar un máximo de 3 candidatos a la vez.");
        return prev;
      }
      return [...prev, appId];
    });
  };

  const exportToCSV = () => {
    const headers = ['Candidato', 'Score Total', 'Etapa Actual', 'Motivo de Decisión'];
    const csvContent = [
      headers.join(','),
      ...candidates.map(c => [
        `"${c.candidateName}"`,
        c.calculatedTotalScore,
        `"${c.stage}"`,
        `"${c.decisionReason || ''}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ranking_${vacancy?.title || 'vacante'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) return <div className="p-8 text-center">Cargando ranking...</div>;

  const comparisonCandidates = candidates.filter(c => selectedForComparison.includes(c.id));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center">
            <Trophy className="w-6 h-6 mr-2 text-amber-500" />
            Ranking y Decisión Final
          </h1>
          <p className="text-slate-500">{vacancy?.title}</p>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={exportToCSV}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
          >
            Exportar CSV
          </button>
          {selectedForComparison.length > 1 && (
            <button
              onClick={() => setShowComparison(true)}
              className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <GitCompare className="w-4 h-4 mr-2" />
              Comparar ({selectedForComparison.length})
            </button>
          )}
          <Link to={`/vacancies/${vacancyId}/kanban`} className="text-blue-600 hover:text-blue-800 text-sm font-bold bg-blue-50 px-4 py-2 rounded-lg transition-colors">
            Volver al Kanban
          </Link>
        </div>
      </div>

      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider w-10">
                  Comparar
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Candidato</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Score Total</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Etapa Actual</th>
                <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Acción Final</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {candidates.map((candidate, index) => (
                <tr key={candidate.id} className={`hover:bg-slate-50 transition-colors ${index === 0 ? 'bg-amber-50/50' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedForComparison.includes(candidate.id)}
                      onChange={() => toggleComparison(candidate.id)}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Link to={`/candidates/${candidate.candidateId}`} className="text-sm font-bold text-slate-800 hover:text-blue-600 transition-colors flex items-center">
                        {index === 0 && <Trophy className="w-4 h-4 mr-2 text-amber-500" />}
                        {index + 1}. {candidate.candidateName}
                      </Link>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-sm text-slate-800 font-black">
                      <Star className="w-4 h-4 text-amber-500 mr-1.5 fill-current" />
                      {candidate.calculatedTotalScore} / 100
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2.5 py-1 inline-flex text-xs font-bold rounded-full 
                      ${candidate.stage === 'Contratado' ? 'bg-emerald-100 text-emerald-800' : 
                        candidate.stage === 'Descartado' ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'}`}>
                      {candidate.stage}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {candidate.stage !== 'Contratado' && candidate.stage !== 'Descartado' ? (
                      <div className="flex justify-end space-x-2">
                        <button 
                          onClick={() => setDecisionModal({ isOpen: true, candidateId: candidate.candidateId, appId: candidate.id, type: 'Contratado' })}
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg font-bold transition-colors flex items-center"
                        >
                          <CheckCircle className="w-4 h-4 mr-1" /> Contratar
                        </button>
                        <button 
                          onClick={() => setDecisionModal({ isOpen: true, candidateId: candidate.candidateId, appId: candidate.id, type: 'Descartado' })}
                          className="px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg font-bold transition-colors flex items-center"
                        >
                          <XCircle className="w-4 h-4 mr-1" /> Descartar
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-500 text-xs font-medium">
                        {candidate.decisionReason ? `Motivo: ${candidate.decisionReason}` : 'Decisión tomada'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Comparison Modal */}
      <Modal isOpen={showComparison} onClose={() => setShowComparison(false)} overlayClassName="bg-slate-900/60 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-black text-slate-800 flex items-center">
                <GitCompare className="w-6 h-6 mr-2 text-indigo-600" />
                Comparación de Candidatos
              </h2>
              <button onClick={() => setShowComparison(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {comparisonCandidates.map(candidate => (
                  <div key={candidate.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                    <div className="p-5 border-b border-slate-100 bg-slate-50 text-center">
                      <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-2xl font-black mx-auto mb-3">
                        {candidate.candidateName.charAt(0)}
                      </div>
                      <h3 className="text-lg font-bold text-slate-800">{candidate.candidateName}</h3>
                      <div className="mt-2 inline-flex items-center px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-sm font-black">
                        <Star className="w-4 h-4 mr-1 fill-current" />
                        {candidate.calculatedTotalScore} / 100
                      </div>
                    </div>
                    
                    <div className="p-5 space-y-6 flex-1">
                      {/* CV Score */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Evaluación CV (IA)</h4>
                        <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-100">
                          <span className="text-sm font-medium text-slate-700">Puntuación</span>
                          <span className="font-black text-slate-800">{candidate.scoreSummary ? (candidate.scoreSummary * 20) : 'N/A'}</span>
                        </div>
                      </div>

                      {/* Stage 2 Score */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Formulario Etapa 2</h4>
                        <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-100">
                          <span className="text-sm font-medium text-slate-700">Puntuación</span>
                          <span className="font-black text-slate-800">{candidate.stage2Scoring?.total_score || 'N/A'}</span>
                        </div>
                      </div>

                      {/* Test Score */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Test Técnico/Psicométrico</h4>
                        <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-100">
                          <span className="text-sm font-medium text-slate-700">Puntuación</span>
                          <span className="font-black text-slate-800">{candidate.testResults?.score || 'N/A'}</span>
                        </div>
                      </div>

                      {/* Interview */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Entrevista</h4>
                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-700">Puntuación</span>
                            <span className="font-black text-slate-800">{candidate.interviewObservation?.score ? (candidate.interviewObservation.score * 20) : 'N/A'}</span>
                          </div>
                          {candidate.interviewObservation?.notes && (
                            <div className="pt-2 border-t border-slate-200 mt-2">
                              <span className="text-xs font-bold text-slate-500 block mb-1">Notas:</span>
                              <p className="text-sm text-slate-700 italic">"{candidate.interviewObservation.notes}"</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-4 border-t border-slate-100 bg-slate-50">
                      <Link 
                        to={`/candidates/${candidate.candidateId}`}
                        className="block w-full py-2 text-center bg-white border border-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-50 transition-colors text-sm"
                      >
                        Ver Perfil Completo
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
      </Modal>

      {/* Decision Modal */}
      <Modal isOpen={decisionModal.isOpen} onClose={() => setDecisionModal({ isOpen: false, candidateId: '', appId: '', type: null })} overlayClassName="bg-slate-900/50 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h2 className={`text-xl font-bold flex items-center ${decisionModal.type === 'Contratado' ? 'text-emerald-700' : 'text-rose-700'}`}>
                {decisionModal.type === 'Contratado' ? <CheckCircle className="w-6 h-6 mr-2" /> : <XCircle className="w-6 h-6 mr-2" />}
                Confirmar {decisionModal.type}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                Estás a punto de marcar a este candidato como <strong>{decisionModal.type}</strong>.
                {decisionModal.type === 'Descartado'
                  ? ' Se enviará un mensaje automático de WhatsApp notificándole la decisión.'
                  : ' No se enviará ningún mensaje automático; podrás contactarlo personalmente.'}
              </p>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Motivo de la decisión (Obligatorio para auditoría)
                </label>
                <textarea
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  rows={3}
                  placeholder={decisionModal.type === 'Contratado' ? 'Ej. Excelente fit cultural y técnico...' : 'Ej. Falta de experiencia en React...'}
                />
              </div>
              <div className="flex space-x-3 pt-4">
                <button
                  onClick={() => setDecisionModal({ isOpen: false, candidateId: '', appId: '', type: null })}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDecision}
                  disabled={!decisionReason}
                  className={`flex-1 py-2.5 text-white rounded-xl font-bold transition-colors disabled:opacity-50 ${
                    decisionModal.type === 'Contratado' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
      </Modal>
    </div>
  );
}
