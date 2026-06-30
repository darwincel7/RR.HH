import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot, deleteField } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { PIPELINE_STAGES } from '../constants/stages';
import { sendWhatsAppAutomation } from '../lib/whatsapp';
import { Loader2, ArrowLeft, Mail, Phone, MapPin, AlertTriangle, CheckCircle, Star, StarHalf, MessageSquare, Send, User, BrainCircuit, Briefcase, FileText, Copy, Eye, X, ExternalLink } from 'lucide-react';

export default function CandidateProfile() {
  const { candidateId } = useParams();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<any>(null);
  const [application, setApplication] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updatingStage, setUpdatingStage] = useState(false);
  
  const [wsStatus, setWsStatus] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [interviewObs, setInterviewObs] = useState({ score: 0, notes: '', redFlags: '' });
  const [savingObs, setSavingObs] = useState(false);
  const [showCVModal, setShowCVModal] = useState(false);
  const [showScorecardModal, setShowScorecardModal] = useState(false);
  const [analyzingCV, setAnalyzingCV] = useState(false);
  
  // Scorecard State
  const [scorecardData, setScorecardData] = useState({
    positiveSignals: [] as string[],
    redFlags: [] as string[],
    metrics: {
      'Puntualidad': 30,
      'Presentación personal': 30,
      'Contacto visual': 30,
      'Claridad al hablar': 30,
      'Energía': 30,
      'Cortesía y escucha activa': 30
    } as Record<string, number>
  });
  const [savingScorecard, setSavingScorecard] = useState(false);

  const [scorecardTemplate, setScorecardTemplate] = useState<any>(null);

  useEffect(() => {
    async function fetchCandidate() {
      if (!candidateId) return;
      try {
        const candRef = doc(db, 'candidates', candidateId);
        const candSnap = await getDoc(candRef);
        if (candSnap.exists()) {
          setCandidate(candSnap.data());
        }

        const q = query(collection(db, 'applications'), where('candidateId', '==', candidateId));
        const appSnap = await getDocs(q);
        if (!appSnap.empty) {
          const appData = { id: appSnap.docs[0].id, ...appSnap.docs[0].data() } as any;
          setApplication(appData);
          if (appData.interviewObservation) {
            setInterviewObs(appData.interviewObservation);
          }
          if (appData.interviewScorecard) {
            setScorecardData(appData.interviewScorecard);
          }
        }

        // Fetch Scorecard Template
        const settingsRef = doc(db, 'settings', 'forms');
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists() && settingsSnap.data().scorecard) {
          const template = settingsSnap.data().scorecard;
          setScorecardTemplate(template);
          
          // If no existing scorecard data, initialize metrics from template
          if (!appSnap.empty && !appSnap.docs[0].data().interviewScorecard && template.metrics) {
            const initialMetrics: Record<string, number> = {};
            template.metrics.forEach((m: string) => {
              initialMetrics[m] = 30;
            });
            setScorecardData(prev => ({ ...prev, metrics: initialMetrics }));
          }
        }

        // Fetch WhatsApp messages in real-time
        const msgRef = collection(db, 'whatsapp_messages');
        const msgQ = query(msgRef, where('candidateId', '==', candidateId));
        
        const unsubscribe = onSnapshot(msgQ, (snapshot) => {
          const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          msgs.sort((a: any, b: any) => {
            const timeA = a.sentAt?.toMillis() || 0;
            const timeB = b.sentAt?.toMillis() || 0;
            return timeA - timeB;
          });
          setChatMessages(msgs);
        });

        // Store unsubscribe function if needed, but for now we'll just let it run
        // since the component lifecycle is simple enough.

      } catch (error) {
        console.error("Error fetching candidate:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchCandidate();

    // Check WhatsApp status
    fetch('/api/whatsapp/status')
      .then(res => {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          return res.json();
        }
        throw new Error("Received non-JSON response");
      })
      .then(setWsStatus)
      .catch(err => console.error("Error fetching WhatsApp status:", err));
  }, [candidateId]);

  const analyzeCVWithAI = async () => {
    if (!candidate || !candidate.cvUrl) return;
    setAnalyzingCV(true);
    try {
      // Call backend directly with the URL to bypass CORS issues
      const response = await fetch('/api/parse-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fileUrl: candidate.cvUrl, 
          mimeType: candidate.cvFileType || 'application/pdf' 
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        if (errData && errData.error && errData.error.includes('API key not valid')) {
          throw new Error('API key not valid');
        }
        throw new Error('Error en el servidor al analizar CV');
      }

      const text = await response.text();
      let parsedData;
      try {
        parsedData = JSON.parse(text);
      } catch (e) {
        throw new Error('El servidor se está reiniciando (recibió HTML). Por favor, intenta de nuevo en unos segundos.');
      }

      // Update Candidate
      await updateDoc(doc(db, 'candidates', candidateId!), {
        aiExtraction: parsedData,
        aiStatus: 'completed'
      });

      // Update Application
      if (application) {
        await updateDoc(doc(db, 'applications', application.id), {
          scoreSummary: parsedData.initial_score_1_to_5,
          recommendation: parsedData.recommendation,
          stage: 'Precalificado'
        });
        setApplication({ ...application, scoreSummary: parsedData.initial_score_1_to_5, recommendation: parsedData.recommendation, stage: 'Precalificado' });
      }

      setCandidate({ ...candidate, aiExtraction: parsedData, aiStatus: 'completed' });
      setAnalyzingCV(false);
      alert('Análisis completado con éxito');
    } catch (error: any) {
      console.error("Error analyzing CV:", error);
      if (error.message && error.message.includes('API key not valid')) {
        alert('Error: La clave de API de Gemini no es válida. Por favor, actualízala en la configuración (Settings) de AI Studio.');
      } else {
        alert('Hubo un error al analizar el CV. Revisa la consola para más detalles.');
      }
      setAnalyzingCV(false);
    }
  };

  const handleSendWhatsApp = async () => {
    if (!message || !candidate.phone) return;
    setSendingMsg(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: candidate.phone, message })
      });
      if (res.ok) {
        // Log message in Firestore
        await addDoc(collection(db, 'whatsapp_messages'), {
          candidateId,
          text: message,
          sentAt: serverTimestamp(),
          direction: 'outbound'
        });
        setMessage('');
        alert('Mensaje enviado con éxito');
      } else {
        alert('Error al enviar mensaje. ¿Está conectado WhatsApp?');
      }
    } catch (error) {
      console.error("Error sending WhatsApp:", error);
    } finally {
      setSendingMsg(false);
    }
  };

  const handleStageChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!application) return;
    const newStage = e.target.value;
    const previousStage = application.stage;
    setUpdatingStage(true);
    
    // Optimistic UI update
    setApplication({ ...application, stage: newStage });

    try {
      await updateDoc(doc(db, 'applications', application.id), { 
        stage: newStage,
        lastStageUpdate: serverTimestamp()
      });

      // Trigger Automation
      let link = '';
      if (newStage === 'Pruebas técnicas' || newStage === 'Tests presenciales') {
        link = `${window.location.origin}/test/${application.id}`;
      } else if (newStage === 'Formulario etapa 2 enviado') {
        link = `${window.location.origin}/eval/${application.id}`;
      }

      await sendWhatsAppAutomation(candidate.phone, newStage, {
        nombre: candidate.fullName || candidate.name,
        vacante: 'la vacante', // We don't have the title here directly, but we can default it
        link,
        email: candidate.email
      });
    } catch (error) {
      console.error("Error updating stage:", error);
      setApplication({ ...application, stage: previousStage }); // Revert UI
      alert("Error al actualizar la etapa. Verifica tus permisos.");
    } finally {
      setUpdatingStage(false);
    }
  };

  const saveInterviewObservation = async () => {
    if (!application) return;
    setSavingObs(true);
    try {
      await updateDoc(doc(db, 'applications', application.id), {
        interviewObservation: interviewObs
      });
      alert('Observación guardada');
    } catch (error) {
      console.error("Error saving observation:", error);
    } finally {
      setSavingObs(false);
    }
  };

  const saveScorecard = async () => {
    if (!application) return;
    setSavingScorecard(true);
    try {
      await updateDoc(doc(db, 'applications', application.id), {
        interviewScorecard: scorecardData
      });
      alert('Scorecard guardado con éxito');
      setShowScorecardModal(false);
    } catch (error) {
      console.error("Error saving scorecard:", error);
      alert('Error al guardar el scorecard');
    } finally {
      setSavingScorecard(false);
    }
  };

  const copyTestLink = () => {
    if (!application) return;
    const url = `${window.location.origin}/test/${application.id}`;
    navigator.clipboard.writeText(url);
    alert('Link de test copiado');
  };

  const [reEvaluatingTest, setReEvaluatingTest] = useState(false);
  const [reEvaluatingStage2, setReEvaluatingStage2] = useState(false);
  const [showStageGuide, setShowStageGuide] = useState(false);

  const handleReEvaluateTest = async () => {
    if (!application?.testResults?.answers) return;
    setReEvaluatingTest(true);
    try {
      const response = await fetch('/api/evaluate-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          questions: Object.keys(application.testResults.answers), 
          answers: application.testResults.answers 
        })
      });

      if (!response.ok) {
        throw new Error('Error en la evaluación de IA');
      }

      const text = await response.text();
      let aiEvaluation;
      try {
        aiEvaluation = JSON.parse(text);
      } catch (e) {
        throw new Error('Respuesta inválida del servidor al evaluar. Intenta de nuevo.');
      }
      
      const updatedTestResults = {
        ...application.testResults,
        score: aiEvaluation.score,
        customer_service_score: aiEvaluation.customer_service_score,
        practical_intelligence_score: aiEvaluation.practical_intelligence_score,
        behavioral_fit_score: aiEvaluation.behavioral_fit_score,
        stability_responsibility_score: aiEvaluation.stability_responsibility_score,
        improvement_desire_score: aiEvaluation.improvement_desire_score,
        orthography_score: aiEvaluation.orthography_score,
        aiFeedback: aiEvaluation.justification,
        redFlags: aiEvaluation.red_flags,
        positiveSignals: aiEvaluation.positive_signals,
        spellingMistakes: aiEvaluation.spelling_mistakes,
        incorrectAnswers: aiEvaluation.incorrect_answers,
        status: 'completed'
      };

      await updateDoc(doc(db, 'applications', application.id), {
        testResults: updatedTestResults
      });
      
      alert('Test reevaluado con éxito');
    } catch (error) {
      console.error("Error reevaluating test:", error);
      alert('Error al reevaluar el test con IA');
    } finally {
      setReEvaluatingTest(false);
    }
  };

  const handleReEvaluateStage2 = async () => {
    if (!application?.stage2Answers) return;
    setReEvaluatingStage2(true);
    try {
      const res = await fetch('/api/score-stage2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: application.id, answers: application.stage2Answers })
      });

      if (!res.ok) {
        throw new Error('Error en la evaluación de IA');
      }

      const text = await res.text();
      let scoringData;
      try {
        scoringData = JSON.parse(text);
      } catch (e) {
        throw new Error('Respuesta inválida del servidor al reevaluar la etapa 2. Intenta de nuevo.');
      }
      
      await updateDoc(doc(db, 'applications', application.id), {
        stage2Scoring: scoringData
      });
      
      alert('Etapa 2 reevaluada con éxito');
    } catch (error) {
      console.error("Error reevaluating stage 2:", error);
      alert('Error al reevaluar la etapa 2 con IA');
    } finally {
      setReEvaluatingStage2(false);
    }
  };

  const handleDeleteTest = async () => {
    if (!application?.id || !window.confirm("¿Estás seguro de que quieres eliminar las respuestas del Test? El candidato tendrá que hacerlo de nuevo.")) return;
    
    try {
      await updateDoc(doc(db, 'applications', application.id), {
        testAnswers: deleteField(),
        testResults: deleteField(),
        testSubmittedAt: deleteField()
      });
      setApplication({
        ...application,
        testAnswers: undefined,
        testResults: undefined,
        testSubmittedAt: undefined
      });
      alert('Respuestas del Test eliminadas con éxito. El candidato puede usar el mismo link para volver a realizarlo.');
    } catch (error) {
      console.error("Error deleting test answers:", error);
      alert('Error al eliminar las respuestas del Test.');
    }
  };

  const handleDeleteStage2 = async () => {
    if (!application?.id || !window.confirm("¿Estás seguro de que quieres eliminar las respuestas de la Etapa 2? El candidato tendrá que hacerlo de nuevo.")) return;
    
    try {
      await updateDoc(doc(db, 'applications', application.id), {
        stage2Answers: deleteField(),
        stage2Scoring: deleteField(),
        stage2SubmittedAt: deleteField()
      });
      setApplication({
        ...application,
        stage2Answers: undefined,
        stage2Scoring: undefined,
        stage2SubmittedAt: undefined
      });
      alert('Respuestas de la Etapa 2 eliminadas con éxito. El candidato puede usar el mismo link para volver a realizarlo.');
    } catch (error) {
      console.error("Error deleting stage 2 answers:", error);
      alert('Error al eliminar las respuestas de la Etapa 2.');
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-violet-600" /></div>;
  if (!candidate) return <div className="p-8 text-center text-slate-500 font-display text-xl">Candidato no encontrado</div>;

  const ai = candidate.aiExtraction || {};

  return (
    <div className="max-w-6xl mx-auto pb-12 animate-fade-in px-4 lg:px-0">
      <button 
        onClick={() => navigate(-1)}
        className="flex items-center text-sm font-bold text-slate-500 hover:text-violet-600 mb-4 lg:mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Volver
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        
        {/* Left Column: Profile & Actions */}
        <div className="space-y-4 lg:space-y-6">
          <div className="glass-card rounded-2xl lg:rounded-3xl p-6 lg:p-8 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-24 lg:h-32 bg-gradient-ai opacity-10"></div>
            <div className="w-20 h-20 lg:w-24 lg:h-24 bg-white rounded-full mx-auto mb-4 flex items-center justify-center shadow-xl border-4 border-white relative z-10">
              <User className="w-8 h-8 lg:w-10 lg:h-10 text-violet-300" />
            </div>
            <h1 className="text-xl lg:text-2xl font-display font-bold text-slate-900 relative z-10">{candidate.fullName || candidate.name}</h1>
            <p className="text-sm lg:text-base text-slate-500 font-medium mb-4 lg:mb-6 relative z-10">{ai.currentRole || 'Candidato'}</p>
            
            <div className="flex flex-col space-y-2 lg:space-y-3 text-xs lg:text-sm text-left relative z-10">
              <div className="flex items-center text-slate-600 bg-slate-50 p-2.5 lg:p-3 rounded-xl">
                <Mail className="w-4 h-4 mr-3 text-violet-500 flex-shrink-0" /> <span className="truncate">{candidate.email}</span>
              </div>
              <div className="flex items-center text-slate-600 bg-slate-50 p-2.5 lg:p-3 rounded-xl">
                <Phone className="w-4 h-4 mr-3 text-violet-500 flex-shrink-0" /> {candidate.phone}
              </div>
              {ai.location && (
                <div className="flex items-center text-slate-600 bg-slate-50 p-2.5 lg:p-3 rounded-xl">
                  <MapPin className="w-4 h-4 mr-3 text-violet-500 flex-shrink-0" /> <span className="truncate">{ai.location}</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2 mt-2">
                {candidate.cvUrl && (
                  <button 
                    onClick={() => setShowCVModal(true)}
                    className="flex items-center justify-center p-2.5 bg-violet-100 text-violet-700 rounded-xl font-bold hover:bg-violet-200 transition-colors text-xs lg:text-sm"
                  >
                    <Eye className="w-4 h-4 lg:w-5 lg:h-5 mr-2" /> Ver CV
                  </button>
                )}
                <button 
                  onClick={() => setShowScorecardModal(true)}
                  className="flex items-center justify-center p-2.5 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 transition-colors text-xs lg:text-sm"
                >
                  <FileText className="w-4 h-4 lg:w-5 lg:h-5 mr-2" /> Evaluar Entrevista
                </button>
                {candidate.aiStatus === 'pending' && (
                  <button 
                    onClick={analyzeCVWithAI}
                    disabled={analyzingCV}
                    className="flex items-center justify-center p-2.5 bg-gradient-ai text-white rounded-xl font-bold hover:opacity-90 transition-opacity disabled:opacity-50 text-xs lg:text-sm"
                  >
                    {analyzingCV ? <Loader2 className="w-4 h-4 lg:w-5 lg:h-5 mr-2 animate-spin" /> : <BrainCircuit className="w-4 h-4 lg:w-5 lg:h-5 mr-2" />}
                    {analyzingCV ? 'Analizando...' : 'Analizar IA'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {application && (
            <div className="glass-card rounded-2xl lg:rounded-3xl p-5 lg:p-6">
              <div className="flex items-center justify-between mb-3 lg:mb-4">
                <h3 className="text-[10px] lg:text-sm font-display font-bold text-slate-400 uppercase tracking-widest">Gestión de Etapa</h3>
                <button 
                  onClick={() => setShowStageGuide(true)}
                  className="text-[10px] font-bold bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded-md flex items-center transition-colors"
                >
                  <FileText className="w-3 h-3 mr-1" />
                  Guía de Etapas
                </button>
              </div>
              <div className="flex items-center space-x-3">
                <select
                  value={application.stage}
                  onChange={handleStageChange}
                  disabled={updatingStage}
                  className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 text-sm focus:ring-2 focus:ring-violet-500 outline-none transition-all"
                >
                  {PIPELINE_STAGES.map(stage => (
                    <option key={stage} value={stage}>{stage}</option>
                  ))}
                </select>
                {updatingStage && <Loader2 className="w-4 h-4 animate-spin text-violet-600" />}
              </div>
            </div>
          )}

          {/* WhatsApp Chat Box */}
          <div className="glass-card rounded-2xl lg:rounded-3xl p-5 lg:p-6 flex flex-col h-[350px] lg:h-[400px]">
            <h3 className="text-[10px] lg:text-sm font-display font-bold text-slate-400 uppercase tracking-widest mb-3 lg:mb-4 flex items-center justify-between">
              <span className="flex items-center">
                <div className={`w-2 h-2 rounded-full mr-2 ${wsStatus?.connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
                Chat WhatsApp
              </span>
            </h3>
            <div className="flex-1 bg-slate-50 rounded-2xl p-3 lg:p-4 mb-3 lg:mb-4 overflow-y-auto border border-slate-100 flex flex-col space-y-3">
              <p className="text-[10px] text-center text-slate-400 font-medium my-2">Inicio de la conversación</p>
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex flex-col ${msg.direction === 'outbound' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] p-3 rounded-2xl text-xs lg:text-sm ${
                    msg.direction === 'outbound' 
                      ? 'bg-emerald-500 text-white rounded-br-none shadow-md shadow-emerald-500/20' 
                      : 'bg-white border border-slate-200 text-slate-700 rounded-bl-none shadow-sm'
                  }`}>
                    {msg.text}
                  </div>
                  <span className="text-[9px] text-slate-400 mt-1 px-1">
                    {msg.sentAt ? new Date(msg.sentAt.toMillis()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}
                    {msg.isAutomated && ' • Automático'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex space-x-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Escribe..."
                className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                onKeyPress={(e) => e.key === 'Enter' && handleSendWhatsApp()}
              />
              <button
                onClick={handleSendWhatsApp}
                disabled={sendingMsg || !message.trim() || wsStatus?.status !== 'connected'}
                className="p-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-all shadow-lg shadow-emerald-500/30"
              >
                {sendingMsg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: AI Analysis & Details (Bento Grid) */}
        <div className="lg:col-span-2 space-y-4 lg:space-y-6">
          
          {candidate.aiStatus === 'pending' || candidate.aiStatus === 'error' ? (
            <div className="glass-card rounded-2xl lg:rounded-3xl p-8 lg:p-12 text-center flex flex-col items-center justify-center border border-dashed border-violet-200 min-h-[200px]">
              <BrainCircuit className="w-12 h-12 lg:w-16 lg:h-16 text-violet-200 mb-4" />
              <h2 className="text-lg lg:text-xl font-display font-bold text-slate-700 mb-2">
                {candidate.aiStatus === 'error' ? 'Error al procesar el CV' : 'Análisis Pendiente'}
              </h2>
              <p className="text-xs lg:text-sm text-slate-500 max-w-md mx-auto">
                {candidate.aiStatus === 'error' 
                  ? 'Hubo un problema al leer el PDF del currículum o conectarse con la IA. Puedes reintentar.' 
                  : 'El currículum aún no ha sido procesado. Haz clic en "Analizar IA" para extraer información.'
                }
              </p>
            </div>
          ) : (
            <>
              {/* AI Summary Banner */}
              <div className="glass-card rounded-2xl lg:rounded-3xl p-6 lg:p-8 relative overflow-hidden border border-violet-100">
                <div className="absolute top-0 right-0 w-48 h-48 lg:w-64 lg:h-64 bg-gradient-ai opacity-10 blur-3xl rounded-full -mr-16 -mt-16 lg:-mr-20 lg:-mt-20"></div>
                <div className="flex flex-col sm:flex-row items-start justify-between relative z-10 gap-4">
                  <div className="flex-1">
                    <h2 className="text-lg lg:text-2xl font-display font-bold text-slate-900 flex items-center mb-2">
                      <BrainCircuit className="w-5 h-5 lg:w-6 lg:h-6 mr-3 text-violet-500" />
                      Análisis de IA del Curriculum
                    </h2>
                    <p className="text-xs lg:text-sm text-slate-600 leading-relaxed font-medium">{ai.summary || ai.relevant_experience_summary || 'No hay resumen disponible.'}</p>
                  </div>
                  <div className="text-center flex-shrink-0 self-center sm:self-start">
                    <div className="flex flex-col items-center justify-center bg-white/50 backdrop-blur-sm rounded-2xl p-3 lg:p-4 border border-violet-100 shadow-sm">
                      <div className="flex items-center mb-1">
                        {[1, 2, 3, 4, 5].map((star) => {
                          const score = ai.initial_score_1_to_5 || application?.scoreSummary || 0;
                          if (score >= star) {
                            return <Star key={star} className="w-4 h-4 lg:w-6 lg:h-6 fill-yellow-400 text-yellow-400" />;
                          } else if (score >= star - 0.5) {
                            return <StarHalf key={star} className="w-4 h-4 lg:w-6 lg:h-6 fill-yellow-400 text-yellow-400" />;
                          } else {
                            return <Star key={star} className="w-4 h-4 lg:w-6 lg:h-6 text-slate-200" />;
                          }
                        })}
                      </div>
                      <span className="text-lg lg:text-xl font-black text-slate-800">{ai.initial_score_1_to_5 || application?.scoreSummary || 0}</span>
                      <span className="text-[8px] lg:text-[10px] font-bold text-slate-400 uppercase">Estrellas CV</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6">
                {/* Experience */}
                <div className="glass-card rounded-2xl lg:rounded-3xl p-5 lg:p-6">
                  <h3 className="text-[10px] lg:text-sm font-display font-bold text-slate-400 uppercase tracking-widest mb-3 lg:mb-4 flex items-center">
                    <Briefcase className="w-4 h-4 mr-2 text-blue-400" /> Experiencia detectada
                  </h3>
                  <p className="text-2xl lg:text-3xl font-display font-black text-slate-800">
                    {ai.yearsOfExperience || 0} <span className="text-sm lg:text-lg text-slate-400 font-medium">años</span>
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Interview & Test Section (ALWAYS VISIBLE) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
            {/* Interview Observation */}
            <div className="glass-card rounded-2xl lg:rounded-3xl p-5 lg:p-6">
                  <h3 className="text-[10px] lg:text-sm font-display font-bold text-slate-400 uppercase tracking-widest mb-3 lg:mb-4 flex items-center">
                    <User className="w-4 h-4 mr-2 text-fuchsia-500" /> Entrevista
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-2">Puntuación (1-5)</label>
                      <div className="flex space-x-1.5 lg:space-x-2">
                        {[1,2,3,4,5].map(num => (
                          <button
                            key={num}
                            onClick={() => setInterviewObs({...interviewObs, score: num})}
                            className={`w-8 h-8 lg:w-10 lg:h-10 rounded-lg lg:rounded-xl text-xs lg:text-sm font-bold transition-all ${interviewObs.score === num ? 'bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/30' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                          >
                            {num}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-2">Notas</label>
                      <textarea
                        value={interviewObs.notes}
                        onChange={e => setInterviewObs({...interviewObs, notes: e.target.value})}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm focus:ring-2 focus:ring-fuchsia-500 outline-none"
                        rows={3}
                      />
                    </div>
                    <button
                      onClick={saveInterviewObservation}
                      disabled={savingObs}
                      className="w-full py-2 lg:py-2.5 bg-slate-900 text-white text-xs lg:text-sm font-bold rounded-xl hover:bg-slate-800 transition-all shadow-md"
                    >
                      {savingObs ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                </div>

                {/* Test Results */}
                <div className="glass-card rounded-2xl lg:rounded-3xl p-5 lg:p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-3 lg:mb-4">
                    <h3 className="text-[10px] lg:text-sm font-display font-bold text-slate-400 uppercase tracking-widest flex items-center">
                      <FileText className="w-4 h-4 mr-2 text-violet-500" /> Resultados Test
                    </h3>
                    {application?.testResults && (
                      <div className="flex gap-2">
                        <button 
                          onClick={handleDeleteTest}
                          className="text-[10px] font-bold bg-rose-100 text-rose-700 hover:bg-rose-200 px-2 py-1 rounded-md flex items-center transition-colors"
                        >
                          <X className="w-3 h-3 mr-1" />
                          Eliminar Test
                        </button>
                        {application?.testResults?.answers && (
                           <button 
                             onClick={handleReEvaluateTest}
                             disabled={reEvaluatingTest}
                             className="text-[10px] font-bold bg-violet-100 text-violet-700 hover:bg-violet-200 px-2 py-1 rounded-md flex items-center transition-colors disabled:opacity-50"
                           >
                             {reEvaluatingTest ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <BrainCircuit className="w-3 h-3 mr-1" />}
                             Reevaluar IA
                           </button>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {application?.testResults ? (
                    <div className="flex-1 flex flex-col">
                      <div className="flex flex-col gap-2 mb-4">
                        <div className="flex items-center justify-between bg-violet-50 p-3 lg:p-4 rounded-xl lg:rounded-2xl border border-violet-100">
                          <span className="text-xs lg:text-sm font-bold text-violet-900">Puntuación IA</span>
                          <span className="text-xl lg:text-2xl font-black text-violet-600">{application.testResults.score}/100</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {application.testResults.customer_service_score !== undefined && (
                            <div className="flex flex-col bg-slate-50 p-2 rounded-lg border border-slate-200">
                              <span className="text-[9px] font-bold text-slate-500">Servicio al Cliente</span>
                              <span className="text-xs font-black text-slate-700">{application.testResults.customer_service_score}/20</span>
                            </div>
                          )}
                          {application.testResults.practical_intelligence_score !== undefined && (
                            <div className="flex flex-col bg-slate-50 p-2 rounded-lg border border-slate-200">
                              <span className="text-[9px] font-bold text-slate-500">Inteligencia Práctica</span>
                              <span className="text-xs font-black text-slate-700">{application.testResults.practical_intelligence_score}/20</span>
                            </div>
                          )}
                          {application.testResults.behavioral_fit_score !== undefined && (
                            <div className="flex flex-col bg-slate-50 p-2 rounded-lg border border-slate-200">
                              <span className="text-[9px] font-bold text-slate-500">Ajuste Conductual</span>
                              <span className="text-xs font-black text-slate-700">{application.testResults.behavioral_fit_score}/20</span>
                            </div>
                          )}
                          {application.testResults.stability_responsibility_score !== undefined && (
                            <div className="flex flex-col bg-slate-50 p-2 rounded-lg border border-slate-200">
                              <span className="text-[9px] font-bold text-slate-500">Estabilidad y Resp.</span>
                              <span className="text-xs font-black text-slate-700">{application.testResults.stability_responsibility_score}/20</span>
                            </div>
                          )}
                          {application.testResults.improvement_desire_score !== undefined && (
                            <div className="flex flex-col bg-slate-50 p-2 rounded-lg border border-slate-200">
                              <span className="text-[9px] font-bold text-slate-500">Deseo de Mejora</span>
                              <span className="text-xs font-black text-slate-700">{application.testResults.improvement_desire_score}/10</span>
                            </div>
                          )}
                          {application.testResults.orthography_score !== undefined && (
                            <div className="flex flex-col bg-slate-50 p-2 rounded-lg border border-slate-200">
                              <span className="text-[9px] font-bold text-slate-500">Ortografía y Redacción</span>
                              <span className="text-xs font-black text-slate-700">{application.testResults.orthography_score}/10</span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {application.testResults.aiFeedback && (
                        <div className="mb-4">
                          <p className="text-xs text-slate-600 italic bg-slate-50 p-3 rounded-lg border border-slate-100">
                            "{application.testResults.aiFeedback}"
                          </p>
                        </div>
                      )}

                      {(application.testResults.positiveSignals?.length > 0 || application.testResults.redFlags?.length > 0 || application.testResults.spellingMistakes?.length > 0 || application.testResults.incorrectAnswers?.length > 0) && (
                        <div className="mb-4 space-y-3">
                          {application.testResults.positiveSignals?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {application.testResults.positiveSignals.map((sig: string, i: number) => (
                                <span key={i} className="px-2 py-0.5 bg-green-100 text-green-800 text-[10px] font-bold rounded-md">+{sig}</span>
                              ))}
                            </div>
                          )}
                          {application.testResults.redFlags?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {application.testResults.redFlags.map((flag: string, i: number) => (
                                <span key={i} className="px-2 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-bold rounded-md">-{flag}</span>
                              ))}
                            </div>
                          )}
                          {application.testResults.spellingMistakes?.length > 0 && (
                            <div className="mt-2">
                              <h4 className="text-[10px] font-bold text-rose-500 uppercase mb-1">Errores de Ortografía / Puntuación</h4>
                              <div className="flex flex-wrap gap-1">
                                {application.testResults.spellingMistakes.map((mistake: string, i: number) => (
                                  <span key={i} className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-medium rounded-md">{mistake}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {application.testResults.incorrectAnswers?.length > 0 && (
                            <div className="mt-2">
                              <h4 className="text-[10px] font-bold text-rose-500 uppercase mb-1">Respuestas Incorrectas / Negativas</h4>
                              <div className="space-y-1">
                                {application.testResults.incorrectAnswers.map((ans: string, i: number) => (
                                  <div key={i} className="p-2 bg-rose-50 border border-rose-100 rounded-md text-[10px] text-rose-800">
                                    {ans}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[150px]">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Respuestas Originales</h4>
                        {Object.entries(application.testResults.answers).map(([qText, answer]: any, idx) => (
                          <div key={idx} className="bg-slate-50 p-2 lg:p-3 rounded-lg lg:rounded-xl border border-slate-100">
                            <p className="text-[9px] lg:text-xs font-bold text-slate-400 mb-0.5">{qText.startsWith('q') ? `Pregunta ${qText}` : qText}</p>
                            <p className="text-xs lg:text-sm font-medium text-slate-800 whitespace-pre-wrap">
                              {Array.isArray(answer) ? answer.join(', ') : answer}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3 py-4">
                      <div className="w-12 h-12 lg:w-16 lg:h-16 bg-slate-50 rounded-full flex items-center justify-center">
                        <AlertTriangle className="w-6 h-6 lg:w-8 lg:h-8 text-slate-300" />
                      </div>
                      <p className="text-[10px] lg:text-sm font-medium text-slate-500">Test pendiente.</p>
                      <button
                        onClick={copyTestLink}
                        className="flex items-center px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-[10px] lg:text-xs font-bold rounded-lg hover:bg-slate-50 transition-all shadow-sm"
                      >
                        <Copy className="w-3 h-3 lg:w-4 lg:h-4 mr-2" /> Copiar Link
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Formulario Etapa 2 Section */}
              <div className="glass-card rounded-2xl lg:rounded-3xl p-5 lg:p-6">
                <div className="flex items-center justify-between mb-3 lg:mb-4">
                  <h3 className="text-[10px] lg:text-sm font-display font-bold text-slate-400 uppercase tracking-widest flex items-center">
                    <FileText className="w-4 h-4 mr-2 text-blue-500" /> Formulario Etapa 2
                  </h3>
                  {application?.stage2Answers && (
                    <div className="flex gap-2">
                      <button 
                        onClick={handleDeleteStage2}
                        className="text-[10px] font-bold bg-rose-100 text-rose-700 hover:bg-rose-200 px-2 py-1 rounded-md flex items-center transition-colors"
                      >
                        <X className="w-3 h-3 mr-1" />
                        Eliminar Respuestas
                      </button>
                      <button 
                        onClick={handleReEvaluateStage2}
                        disabled={reEvaluatingStage2}
                        className="text-[10px] font-bold bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded-md flex items-center transition-colors disabled:opacity-50"
                      >
                        {reEvaluatingStage2 ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <BrainCircuit className="w-3 h-3 mr-1" />}
                        Reevaluar IA
                      </button>
                    </div>
                  )}
                </div>
                
                {application?.stage2Answers ? (
                  <div className="flex flex-col lg:flex-row gap-6">
                    {/* Scoring Summary */}
                    {application.stage2Scoring && (
                      <div className="lg:w-1/3 flex flex-col space-y-4">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between bg-blue-50 p-3 lg:p-4 rounded-xl lg:rounded-2xl border border-blue-100">
                            <span className="text-xs lg:text-sm font-bold text-blue-900">Puntuación IA</span>
                            <span className="text-xl lg:text-2xl font-black text-blue-600">{application.stage2Scoring.total_score}/100</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {application.stage2Scoring.stability_motivation_score !== undefined && (
                              <div className="flex flex-col bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <span className="text-[9px] font-bold text-slate-500">Estabilidad y Motivación</span>
                                <span className="text-xs font-black text-slate-700">{application.stage2Scoring.stability_motivation_score}/20</span>
                              </div>
                            )}
                            {application.stage2Scoring.problem_solving_score !== undefined && (
                              <div className="flex flex-col bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <span className="text-[9px] font-bold text-slate-500">Resolución de Problemas</span>
                                <span className="text-xs font-black text-slate-700">{application.stage2Scoring.problem_solving_score}/20</span>
                              </div>
                            )}
                            {application.stage2Scoring.integrity_ethics_score !== undefined && (
                              <div className="flex flex-col bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <span className="text-[9px] font-bold text-slate-500">Integridad y Ética</span>
                                <span className="text-xs font-black text-slate-700">{application.stage2Scoring.integrity_ethics_score}/25</span>
                              </div>
                            )}
                            {application.stage2Scoring.behavioral_attitude_score !== undefined && (
                              <div className="flex flex-col bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <span className="text-[9px] font-bold text-slate-500">Ajuste Conductual</span>
                                <span className="text-xs font-black text-slate-700">{application.stage2Scoring.behavioral_attitude_score}/25</span>
                              </div>
                            )}
                            {application.stage2Scoring.orthography_score !== undefined && (
                              <div className="flex flex-col bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <span className="text-[9px] font-bold text-slate-500">Ortografía y Redacción</span>
                                <span className="text-xs font-black text-slate-700">{application.stage2Scoring.orthography_score}/10</span>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="bg-slate-50 p-3 lg:p-4 rounded-xl border border-slate-100">
                          <p className="text-xs font-bold text-slate-700 mb-2">Recomendación:</p>
                          <span className={`px-2 py-1 text-[10px] font-bold uppercase rounded-md ${
                            application.stage2Scoring.recommended_next_step === 'contratar' ? 'bg-emerald-100 text-emerald-800' :
                            application.stage2Scoring.recommended_next_step === 'muy_recomendable' ? 'bg-blue-100 text-blue-800' :
                            application.stage2Scoring.recommended_next_step === 'considerar_con_reservas' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-rose-100 text-rose-800'
                          }`}>
                            {application.stage2Scoring.recommended_next_step?.replace(/_/g, ' ')}
                          </span>
                        </div>

                        {application.stage2Scoring.summary_for_recruiter && (
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                            <p className="text-xs text-slate-600 italic">"{application.stage2Scoring.summary_for_recruiter}"</p>
                          </div>
                        )}

                        {(application.stage2Scoring.positive_signals?.length > 0 || application.stage2Scoring.risk_signals?.length > 0 || application.stage2Scoring.spelling_mistakes?.length > 0 || application.stage2Scoring.incorrect_answers?.length > 0) && (
                          <div className="space-y-3">
                            {application.stage2Scoring.positive_signals?.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {application.stage2Scoring.positive_signals.map((sig: string, i: number) => (
                                  <span key={i} className="px-2 py-0.5 bg-green-100 text-green-800 text-[10px] font-bold rounded-md">+{sig}</span>
                                ))}
                              </div>
                            )}
                            {application.stage2Scoring.risk_signals?.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {application.stage2Scoring.risk_signals.map((flag: string, i: number) => (
                                  <span key={i} className="px-2 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-bold rounded-md">-{flag}</span>
                                ))}
                              </div>
                            )}
                            {application.stage2Scoring.spelling_mistakes?.length > 0 && (
                              <div className="mt-2">
                                <h4 className="text-[10px] font-bold text-rose-500 uppercase mb-1">Errores de Ortografía / Puntuación</h4>
                                <div className="flex flex-wrap gap-1">
                                  {application.stage2Scoring.spelling_mistakes.map((mistake: string, i: number) => (
                                    <span key={i} className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-medium rounded-md">{mistake}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {application.stage2Scoring.incorrect_answers?.length > 0 && (
                              <div className="mt-2">
                                <h4 className="text-[10px] font-bold text-rose-500 uppercase mb-1">Respuestas Incorrectas / Negativas</h4>
                                <div className="space-y-1">
                                  {application.stage2Scoring.incorrect_answers.map((ans: string, i: number) => (
                                    <div key={i} className="p-2 bg-rose-50 border border-rose-100 rounded-md text-[10px] text-rose-800">
                                      {ans}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Answers List */}
                    <div className="flex-1 overflow-y-auto space-y-3 max-h-[300px] pr-2">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Respuestas Originales</h4>
                      {Object.entries(application.stage2Answers).map(([qText, answer]: any, idx) => (
                        <div key={idx} className="bg-slate-50 p-3 lg:p-4 rounded-xl border border-slate-100">
                          <p className="text-[10px] lg:text-xs font-bold text-slate-500 mb-1">{qText}</p>
                          <p className="text-xs lg:text-sm font-medium text-slate-800 whitespace-pre-wrap">{answer}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center space-y-3 py-6">
                    <div className="w-12 h-12 lg:w-16 lg:h-16 bg-slate-50 rounded-full flex items-center justify-center">
                      <AlertTriangle className="w-6 h-6 lg:w-8 lg:h-8 text-slate-300" />
                    </div>
                    <p className="text-[10px] lg:text-sm font-medium text-slate-500">Formulario pendiente.</p>
                    <button
                      onClick={() => {
                        const url = `${window.location.origin}/eval/${application.id}`;
                        navigator.clipboard.writeText(url);
                        alert('Link del formulario copiado al portapapeles');
                      }}
                      className="flex items-center px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-[10px] lg:text-xs font-bold rounded-lg hover:bg-slate-50 transition-all shadow-sm"
                    >
                      <Copy className="w-3 h-3 lg:w-4 lg:h-4 mr-2" /> Copiar Link Formulario
                    </button>
                  </div>
                )}
              </div>

        </div>
      </div>

      {/* CV Modal */}
      {showCVModal && candidate.cvUrl && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-slide-up">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-display font-bold text-slate-800 flex items-center">
                <FileText className="w-5 h-5 mr-2 text-violet-500" />
                Currículum Original
              </h3>
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => window.open(candidate.cvUrl, '_blank')}
                  className="flex items-center px-3 py-1.5 text-sm font-bold text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-4 h-4 mr-1.5" />
                  Abrir en nueva pestaña
                </button>
                <button onClick={() => setShowCVModal(false)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-100 overflow-auto flex items-center justify-center p-4 relative">
              {candidate.cvFileType?.startsWith('image/') ? (
                <img src={candidate.cvUrl} alt="CV" className="max-w-full max-h-full object-contain rounded-lg shadow-md" />
              ) : (
                <iframe 
                  src={`https://docs.google.com/gview?url=${encodeURIComponent(candidate.cvUrl)}&embedded=true`} 
                  className="w-full h-full rounded-lg shadow-md bg-white" 
                  title="CV Document" 
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scorecard Modal */}
      {showScorecardModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-slide-up">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-display font-bold text-slate-800 flex items-center">
                <FileText className="w-5 h-5 mr-2 text-blue-500" />
                Scorecard de Entrevista Estructurada
              </h3>
              <button onClick={() => setShowScorecardModal(false)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                  <h4 className="font-bold text-blue-900 mb-2">Banco de Preguntas Recomendadas</h4>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-blue-800">
                    {(scorecardTemplate?.recommendedQuestions || [
                      'Cuéntame de una vez que atendiste a un cliente difícil. ¿Qué pasó y cómo lo resolviste?',
                      '¿Qué haces cuando un cliente tiene razón, pero te habla mal?',
                      '¿Qué significa para ti dar un excelente servicio?',
                      'Háblame de una ocasión en la que un supervisor te corrigió. ¿Cómo reaccionaste?',
                      '¿Cómo te manejas trabajando con normas, políticas o procesos definidos?',
                      'Si no estás de acuerdo con una instrucción, ¿qué haces?',
                      '¿Cuál ha sido el trabajo en el que más has durado y por qué?',
                      '¿Por qué saliste de tus últimos dos trabajos?',
                      '¿Qué tendría que ofrecerte una empresa para que quieras durar mucho tiempo en ella?',
                      '¿Qué fue lo último importante que aprendiste en un trabajo?',
                      '¿Qué haces cuando cometes un error?',
                      '¿En qué aspecto te gustaría mejorar más dentro del trabajo?'
                    ]).map((q: string, i: number) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-green-50 p-4 rounded-xl border border-green-100">
                    <h4 className="font-bold text-green-900 mb-2">Señales Positivas a Marcar</h4>
                    <div className="space-y-2 text-sm">
                      {(scorecardTemplate?.positiveSignals || ['Sonrisa natural', 'Tono amable', 'Empatía genuina', 'Seguridad sin arrogancia', 'Respeto', 'Facilidad para aprender', 'Interés real en el trabajo', 'Madurez emocional']).map((signal: string) => (
                        <label key={signal} className="flex items-center space-x-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={scorecardData.positiveSignals.includes(signal)}
                            onChange={(e) => {
                              const newSignals = e.target.checked 
                                ? [...scorecardData.positiveSignals, signal]
                                : scorecardData.positiveSignals.filter(s => s !== signal);
                              setScorecardData({...scorecardData, positiveSignals: newSignals});
                            }}
                            className="rounded text-green-600 focus:ring-green-500" 
                          />
                          <span className="text-green-800">{signal}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="bg-rose-50 p-4 rounded-xl border border-rose-100">
                    <h4 className="font-bold text-rose-900 mb-2">Red Flags a Marcar</h4>
                    <div className="space-y-2 text-sm">
                      {(scorecardTemplate?.redFlags || ['Habla mal de todos sus jefes', 'Se contradice mucho', 'Culpa siempre a otros', 'Poca paciencia', 'Arrogancia', 'Actitud conflictiva', 'Poca estabilidad', 'Resistencia a correcciones', 'Respuestas vacías o muy ensayadas', 'Baja energía o apatía']).map((flag: string) => (
                        <label key={flag} className="flex items-center space-x-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={scorecardData.redFlags.includes(flag)}
                            onChange={(e) => {
                              const newFlags = e.target.checked 
                                ? [...scorecardData.redFlags, flag]
                                : scorecardData.redFlags.filter(f => f !== flag);
                              setScorecardData({...scorecardData, redFlags: newFlags});
                            }}
                            className="rounded text-rose-600 focus:ring-rose-500" 
                          />
                          <span className="text-rose-800">{flag}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <h4 className="font-bold text-slate-900 mb-4">Métricas de Evaluación (1.0 a 5.0)</h4>
                  <div className="space-y-4">
                    {(scorecardTemplate?.metrics || ['Puntualidad', 'Presentación personal', 'Contacto visual', 'Claridad al hablar', 'Energía', 'Cortesía y escucha activa']).map((metric: string) => (
                      <div key={metric}>
                        <div className="flex justify-between text-sm font-medium text-slate-700 mb-1">
                          <span>{metric}</span>
                          <span>{((scorecardData.metrics[metric] || 30) / 10).toFixed(1)}</span>
                        </div>
                        <input 
                          type="range" 
                          min="10" max="50" 
                          value={scorecardData.metrics[metric] || 30}
                          onChange={(e) => {
                            setScorecardData({
                              ...scorecardData,
                              metrics: {
                                ...scorecardData.metrics,
                                [metric]: parseInt(e.target.value)
                              }
                            });
                          }}
                          className="w-full" 
                        />
                        <div className="flex justify-between text-xs text-slate-400 mt-1">
                          <span>1.0</span><span>2.0</span><span>3.0</span><span>4.0</span><span>5.0</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button 
                onClick={saveScorecard}
                disabled={savingScorecard}
                className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center"
              >
                {savingScorecard ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Guardar Evaluación
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Stage Guide Modal */}
      {showStageGuide && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-slide-up">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-display font-bold text-slate-800 flex items-center">
                <FileText className="w-5 h-5 mr-2 text-blue-500" />
                Guía de Etapas del Proceso
              </h3>
              <button onClick={() => setShowStageGuide(false)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <p className="text-sm text-slate-600 mb-4">
                Esta guía detalla cada una de las etapas del proceso de selección, qué significa cada una y qué acciones automáticas (como mensajes de WhatsApp) se disparan al seleccionar ciertas etapas.
              </p>

              <div className="space-y-4">
                {/* Etapas Iniciales */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-100 px-4 py-2 font-bold text-slate-700">Etapas Iniciales</div>
                  <div className="p-4 space-y-4">
                    <div>
                      <h4 className="font-bold text-sm text-slate-800">Nuevo / Aplicó / CV recibido</h4>
                      <p className="text-xs text-slate-600 mt-1">Etapas iniciales cuando el candidato ingresa al sistema. No disparan mensajes automáticos. Sirven para organizar a los candidatos recién llegados.</p>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-800">Precalificado / Revisión humana</h4>
                      <p className="text-xs text-slate-600 mt-1">El CV ha sido analizado (por IA o manualmente) y el candidato cumple con los requisitos básicos. Listo para ser contactado.</p>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-800">Contacto WhatsApp 1</h4>
                      <p className="text-xs text-slate-600 mt-1">Se ha iniciado el contacto manual con el candidato vía WhatsApp para validar interés o disponibilidad.</p>
                    </div>
                  </div>
                </div>

                {/* Etapa 2 */}
                <div className="border border-blue-200 rounded-xl overflow-hidden">
                  <div className="bg-blue-50 px-4 py-2 font-bold text-blue-800">Evaluación - Etapa 2</div>
                  <div className="p-4 space-y-4">
                    <div>
                      <h4 className="font-bold text-sm text-blue-900 flex items-center">
                        Formulario etapa 2 enviado
                        <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] rounded-full">Mensaje Automático</span>
                      </h4>
                      <p className="text-xs text-slate-600 mt-1 mb-2">Al seleccionar esta etapa, se envía automáticamente un WhatsApp al candidato con el link al formulario de la Etapa 2.</p>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap font-mono">
                        Hola {'{nombre}'} 👋\n\nRecientemente aplicaste para la vacante de {'{vacante}'} y hemos revisado tu perfil con mucho interés. ✅\n\nNos complace informarte que has sido preseleccionado(a) para avanzar a la siguiente etapa del proceso de entrevistas. 🎉\n\nSi deseas continuar, por favor completa el siguiente formulario:\n\n🔗 {'{link}'}\n\n🗓️ Fecha límite de respuesta: {'{fecha}'}\n\nAgradecemos tu interés y tu tiempo. ¡Estamos emocionados de conocerte mejor y descubrir si esta oportunidad es para ti! 🙌
                      </div>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-800">Formulario etapa 2 completado / Evaluación IA etapa 2</h4>
                      <p className="text-xs text-slate-600 mt-1">El candidato ha llenado el formulario y la IA ha generado su puntuación. Revisa los resultados en el perfil.</p>
                    </div>
                  </div>
                </div>

                {/* Entrevistas y Tests */}
                <div className="border border-violet-200 rounded-xl overflow-hidden">
                  <div className="bg-violet-50 px-4 py-2 font-bold text-violet-800">Entrevistas y Tests</div>
                  <div className="p-4 space-y-4">
                    <div>
                      <h4 className="font-bold text-sm text-violet-900 flex items-center">
                        Convocado a entrevista
                        <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] rounded-full">Mensaje Automático</span>
                      </h4>
                      <p className="text-xs text-slate-600 mt-1 mb-2">Envía una invitación para una entrevista virtual.</p>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap font-mono">
                        🎉 ¡Felicitaciones {'{nombre}'}!\n\nHas sido preseleccionado(a) para avanzar a la siguiente etapa del proceso para el puesto de {'{vacante}'}.\n\nNos encantaría coordinar una entrevista virtual contigo para conocerte mejor.\n\n🗓️ Fecha: {'{fecha}'}\n🕒 Hora: {'{hora}'}\n📍 Modalidad: Virtual ({'{ubicacion}'})\n\nPor favor, responde a este mensaje para confirmar tu disponibilidad ✅\n\n¡Gracias por tu interés y entusiasmo!\n\nSaludos.
                      </div>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-violet-900 flex items-center">
                        Entrevista presencial
                        <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] rounded-full">Mensaje Automático</span>
                      </h4>
                      <p className="text-xs text-slate-600 mt-1 mb-2">Envía una invitación para una entrevista presencial.</p>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap font-mono">
                        🎉 ¡Felicidades, {'{nombre}'}!\n\nHas sido seleccionado/a para avanzar a la etapa final del proceso para el puesto de {'{vacante}'} 👏\n\nNos encantaría coordinar una entrevista presencial contigo para conocerte mejor.\n\n🗓️ Fecha: {'{fecha}'}\n🕒 Hora: {'{hora}'}\n📍 Modalidad: Presencial ({'{ubicacion}'})\n\nPor favor, responde a este mensaje para confirmar tu disponibilidad ✅\n\n¡Gracias por tu interés y entusiasmo!\n\nSaludos.
                      </div>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-violet-900 flex items-center">
                        Tests presenciales
                        <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] rounded-full">Mensaje Automático</span>
                      </h4>
                      <p className="text-xs text-slate-600 mt-1">Al seleccionar esta etapa, se envía el link para que el candidato realice el Test Psicométrico/Cognitivo.</p>
                    </div>
                  </div>
                </div>

                {/* Cierre de Proceso */}
                <div className="border border-emerald-200 rounded-xl overflow-hidden">
                  <div className="bg-emerald-50 px-4 py-2 font-bold text-emerald-800">Cierre de Proceso</div>
                  <div className="p-4 space-y-4">
                    <div>
                      <h4 className="font-bold text-sm text-emerald-900 flex items-center">
                        Oferta
                        <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] rounded-full">Mensaje Automático</span>
                      </h4>
                      <p className="text-xs text-slate-600 mt-1 mb-2">Envía un mensaje informando que ha sido seleccionado y coordinando la firma de contrato.</p>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap font-mono">
                        🎉 ¡Felicitaciones, {'{nombre}'}!\n\nHas sido seleccionado/a para incorporarte a nuestro equipo en el puesto de {'{vacante}'} 👏✨\n\nQueremos coordinar una reunión presencial para revisar detalles y formalizar el acuerdo de inicio laboral.\n\n🗓️ Fecha: {'{fecha}'}\n🕒 Hora: {'{hora}'}\n📍 Lugar: {'{ubicacion}'}\n\nPor favor, confirma tu asistencia respondiendo a este mensaje ✅\n\n¡Estamos muy emocionados por tenerte en nuestro equipo! 🚀
                      </div>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-emerald-900">Contratado</h4>
                      <p className="text-xs text-slate-600 mt-1">El candidato ya forma parte de la empresa. Fin del proceso exitoso.</p>
                    </div>
                  </div>
                </div>

                {/* Rechazos */}
                <div className="border border-rose-200 rounded-xl overflow-hidden">
                  <div className="bg-rose-50 px-4 py-2 font-bold text-rose-800">Rechazos y Banco de Talento</div>
                  <div className="p-4 space-y-4">
                    <div>
                      <h4 className="font-bold text-sm text-rose-900 flex items-center">
                        Descartado
                        <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] rounded-full">Mensaje Automático</span>
                      </h4>
                      <p className="text-xs text-slate-600 mt-1 mb-2">Envía un mensaje de agradecimiento y rechazo formal.</p>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap font-mono">
                        Hola {'{nombre}'} 👋,\n\nGracias por participar en nuestro proceso para la vacante de {'{vacante}'}. 🙏\n\nTras revisar todos los perfiles, hemos decidido continuar con otros candidatos en esta etapa. Agradecemos tu tiempo y el interés que mostraste. 🌟\n\n¡Te deseamos muchos éxitos!
                      </div>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-rose-900 flex items-center">
                        Banco de talento
                        <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] rounded-full">Mensaje Automático</span>
                      </h4>
                      <p className="text-xs text-slate-600 mt-1 mb-2">Rechazo suave, pidiendo permiso para guardar sus datos para futuras vacantes.</p>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap font-mono">
                        Hola {'{nombre}'} 👋\n\nQueremos agradecerte sinceramente por tu tiempo, disposición y la excelente participación que tuviste en la última etapa del proceso para el puesto de {'{vacante}'} 🙌\n\nEn esta ocasión, el proceso ha concluido con la selección de otro perfil, pero valoramos mucho tus capacidades y el potencial que demostraste.\n\n📌 Con tu permiso, nos gustaría conservar tus datos en nuestra base de talento para considerarte en futuras oportunidades que se alineen con tu perfil.\n\n¿Estarías de acuerdo? Solo debes responder “Sí, autorizo” ✅\n\n¡Gracias nuevamente por tu interés en formar parte de nuestro equipo!\n\nTe deseamos muchos éxitos en tus próximos pasos 🚀\n\nSaludos cordiales.
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
