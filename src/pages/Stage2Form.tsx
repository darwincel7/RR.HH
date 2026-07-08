import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Loader2, CheckCircle, Send, Building2 } from 'lucide-react';
import SubmitOverlay from '../components/SubmitOverlay';

type QuestionType = 'text' | 'textarea' | 'multiple_choice' | 'scale';

interface Question {
  id: string;
  text: string;
  type: QuestionType;
  options?: string[];
}

export default function Stage2Form() {
  const { applicationId } = useParams();
  const [application, setApplication] = useState<any>(null);
  const [company, setCompany] = useState({ name: 'AuraATS', logoUrl: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentStep, setCurrentStep] = useState(0);

  // Built-in fallback question set (used when settings has no custom stage-2 questions).
  const FALLBACK_QUESTIONS: Question[] = [
    { id: 'q1', text: '👤 Nombre y Apellido', type: 'text' },
    { id: 'q2', text: '📱 Número de Teléfono (Whatsapp)', type: 'text' },
    { id: 'q3', text: '🏆 Menciona dos logros importantes y por qué te enorgullecen', type: 'textarea' },
    { id: 'q4', text: '🔄 Si pudieras cambiar algo de tu trabajo anterior ¿Qué sería y por qué?', type: 'textarea' },
    { id: 'q5', text: '🎯 ¿Hacia dónde te gustaría que fuera tu carrera en cinco años?', type: 'textarea' },
    { id: 'q6', text: '🧗 Cuéntame sobre algún reto difícil que hayas enfrentado en el trabajo y cómo lo superaste.', type: 'textarea' },
    { id: 'q7', text: '⚖️ ¿Qué harías si ves a un compañero haciendo trampa o un acto anti ético, como cogerse un artículo de la tienda?', type: 'textarea' },
  ];

  useEffect(() => {
    async function fetchAppAndSettings() {
      if (!applicationId) return;
      // FAST PATH: one warm server call — no client Firestore cold-start, no auth.
      try {
        const res = await fetch(`/api/public/form-data/eval/${encodeURIComponent(applicationId)}`);
        if (res.ok) {
          const data = await res.json();
          if (!data.valid) {
            setErrorMsg('El link de evaluación no es válido.');
          } else {
            if (data.company) setCompany({ name: data.company.name || 'AuraATS', logoUrl: data.company.logoUrl || '' });
            setApplication({ stage2Answers: data.completed ? true : undefined });
            if (data.completed) setSuccess(true);
            setQuestions(Array.isArray(data.questions) && data.questions.length > 0 ? data.questions : FALLBACK_QUESTIONS);
          }
          setLoading(false);
          return;
        }
      } catch (err) {
        console.warn('form-data endpoint failed, falling back to Firestore:', err);
      }

      // FALLBACK: direct Firestore reads (e.g. server restarting).
      try {
        const companySnap = await getDoc(doc(db, 'settings', 'company'));
        if (companySnap.exists()) {
          setCompany({ name: companySnap.data().name || 'AuraATS', logoUrl: companySnap.data().logoUrl || '' });
        }
        const docSnap = await getDoc(doc(db, 'applications', applicationId));
        if (docSnap.exists()) {
          const appData = docSnap.data();
          setApplication(appData);
          if (appData.stage2Answers) setSuccess(true);
        } else {
          setErrorMsg('El link de evaluación no es válido.');
        }
        const settingsSnap = await getDoc(doc(db, 'settings', 'forms'));
        if (settingsSnap.exists() && settingsSnap.data().stage2Questions && settingsSnap.data().stage2Questions.length > 0) {
          setQuestions(settingsSnap.data().stage2Questions);
        } else {
          setQuestions(FALLBACK_QUESTIONS);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        setErrorMsg('No pudimos cargar el formulario. Por favor, recarga la página en unos segundos.');
      } finally {
        setLoading(false);
      }
    }
    fetchAppAndSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevent premature submission if user presses Enter on an earlier step
    if (currentStep < questions.length - 1) {
      handleNext();
      return;
    }

    setSubmitting(true);
    try {
      // Format answers to use question text as keys for better readability in DB and AI
      const formattedAnswers: Record<string, string> = {};
      questions.forEach(q => {
        if (q) {
          let val = answers[q.id];
          // Default untouched scale values to 3
          if (q.type === 'scale' && !val) {
            val = '3';
          }
          if (val) {
            formattedAnswers[q.text] = val;
          }
        }
      });

      // Submit answers to the backend, which computes AND persists the score via the
      // Admin SDK (server-authoritative — the candidate never writes their own score).
      const res = await fetch('/api/score-stage2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, answers: formattedAnswers })
      });
      if (!res.ok) {
        throw new Error(`score-stage2 respondió ${res.status}`);
      }

      setSuccess(true);
    } catch (error) {
      console.error("Error submitting stage 2:", error);
      setErrorMsg('Error al enviar tus respuestas. Por favor, intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    const currentQ = questions[currentStep];
    let answerValue = answers[currentQ.id];
    
    if (currentQ.type === 'scale' && !answerValue) {
      answerValue = '3';
    }

    if (!answerValue || answerValue.trim() === '') {
      alert("Por favor, responde la pregunta antes de continuar.");
      return;
    }
    if (currentStep < questions.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const renderInput = (q: Question) => {
    switch (q.type) {
      case 'textarea':
        return (
          <textarea
            required
            className="w-full p-4 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 min-h-[200px] resize-y"
            rows={8}
            value={answers[q.id] || ''}
            onChange={e => setAnswers({...answers, [q.id]: e.target.value})}
            placeholder="Escribe tu respuesta aquí con todo el detalle necesario..."
          />
        );
      case 'multiple_choice':
        return (
          <div className="space-y-2">
            {q.options?.map((opt) => (
              <label key={opt} className="flex items-center space-x-3 p-3 border rounded-md hover:bg-gray-50 cursor-pointer">
                <input 
                  type="radio" 
                  name={q.id} 
                  value={opt} 
                  required 
                  checked={answers[q.id] === opt}
                  onChange={e => setAnswers({...answers, [q.id]: e.target.value})} 
                  className="h-4 w-4 text-blue-600" 
                />
                <span className="text-sm text-gray-700">{opt}</span>
              </label>
            ))}
          </div>
        );
      case 'scale':
        return (
          <div>
            <input
              type="range"
              min="1" max="5"
              value={answers[q.id] || '3'}
              onChange={e => setAnswers({...answers, [q.id]: e.target.value})}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1</span>
              <span>Valor: {answers[q.id] || '3'}</span>
              <span>5</span>
            </div>
          </div>
        );
      case 'text':
      default:
        return (
          <input
            type="text"
            required
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            value={answers[q.id] || ''}
            onChange={e => setAnswers({...answers, [q.id]: e.target.value})}
          />
        );
    }
  };

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
      <Loader2 className="w-10 h-10 animate-spin text-violet-600" />
      <p className="text-sm text-slate-500 font-medium">Cargando tu formulario…</p>
    </div>
  );
  if (success) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white p-8 rounded-lg shadow-md text-center max-w-md">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">¡Gracias por completar la evaluación!</h2>
        <p className="text-gray-600">Tus respuestas han sido recibidas y serán evaluadas por nuestro equipo.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <SubmitOverlay
        show={submitting}
        title="Enviando tus respuestas…"
        subtitle="Estamos procesando y evaluando tu formulario. Esto puede tardar unos segundos — no cierres esta página."
      />
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md p-8">
        {/* Company Header */}
        <div className="flex items-center justify-center mb-8 pb-6 border-b border-gray-100">
          {company.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-10 max-w-[150px] object-contain" />
          ) : (
            <div className="flex items-center text-xl font-display font-bold text-gray-800">
              <Building2 className="w-6 h-6 text-blue-600 mr-2" />
              {company.name}
            </div>
          )}
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Formulario de la siguiente etapa</h1>
        <p className="text-gray-600 mb-8 italic">¡Felicidades por avanzar en el proceso! Responde estas preguntas con calma y honestidad: nos ayudan a conocer mejor tu perfil, experiencia y motivaciones.</p>

        {errorMsg && <p className="text-red-600 mb-4 bg-red-50 p-4 rounded-md">{errorMsg}</p>}

        {application && questions.length > 0 && (
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Progress indicator */}
            <div className="mb-8">
              <div className="flex justify-between text-sm font-medium text-gray-500 mb-2">
                <span>Paso {currentStep + 1} de {questions.length}</span>
                <span>{Math.round(((currentStep + 1) / questions.length) * 100)}% Completado</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out" 
                  style={{ width: `${((currentStep + 1) / questions.length) * 100}%` }}
                ></div>
              </div>
            </div>

            {/* Current Question */}
            <div className="bg-white border text-blue-950 border-gray-200 p-6 rounded-lg shadow-sm">
              <label className="block text-lg font-bold text-gray-900 mb-4">
                {questions[currentStep].text} <span className="text-red-500">*</span>
              </label>
              {renderInput(questions[currentStep])}
            </div>

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between mt-8 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 0 || submitting}
                className={`py-3 px-6 border border-gray-300 rounded-md text-sm font-medium shadow-sm transition-colors ${
                  currentStep === 0 ? 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed' : 'text-gray-700 bg-white hover:bg-gray-50'
                }`}
              >
                Anterior
              </button>

              {currentStep < questions.length - 1 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="py-3 px-8 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                >
                  Siguiente
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting}
                  className="py-3 px-8 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-green-400 transition-colors flex items-center"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin mr-2 w-4 h-4" />
                      Evaluando...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Enviar Evaluación
                    </>
                  )}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
