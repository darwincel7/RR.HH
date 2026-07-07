import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Loader2, CheckCircle, Send, Building2 } from 'lucide-react';
import { masterTestQuestions, Question } from '../data/testQuestions';

export default function CandidateTest() {
  const { applicationId } = useParams();
  const [application, setApplication] = useState<any>(null);
  const [company, setCompany] = useState({ name: 'AuraATS', logoUrl: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(-1); // -1 means intro screen
  const [showMemoryWords, setShowMemoryWords] = useState(false);
  const [memoryWordsShown, setMemoryWordsShown] = useState(false); // only once per attempt
  const [memoryTimeLeft, setMemoryTimeLeft] = useState(8);

  // Load saved answers from localStorage
  useEffect(() => {
    if (applicationId) {
      // Clear legacy storage keys if present to avoid restoring old 62-question length
      localStorage.removeItem(`darwin_test_${applicationId}`);
      
      const saved = localStorage.getItem(`aura_test_${applicationId}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.answers) setAnswers(parsed.answers);
          // Only restore index if it fits within the new question array bounds
          if (parsed.currentIndex !== undefined && parsed.currentIndex >= -1) {
             setCurrentQuestionIndex(parsed.currentIndex);
          }
        } catch (e) {
          console.error("Error loading saved test progress", e);
        }
      }
    }
  }, [applicationId]);

  // Save progress to localStorage
  useEffect(() => {
    if (applicationId && currentQuestionIndex >= 0) {
      localStorage.setItem(`aura_test_${applicationId}`, JSON.stringify({
        answers,
        currentIndex: currentQuestionIndex
      }));
    }
  }, [answers, currentQuestionIndex, applicationId]);

  useEffect(() => {
    let timer: any;
    if (showMemoryWords && memoryTimeLeft > 0) {
      timer = setTimeout(() => setMemoryTimeLeft(prev => prev - 1), 1000);
    } else if (showMemoryWords && memoryTimeLeft === 0) {
      setShowMemoryWords(false);
    }
    return () => clearTimeout(timer);
  }, [showMemoryWords, memoryTimeLeft]);

  // A restored index may exceed the loaded question set (e.g. a shorter custom test):
  // clamp it so questions[currentQuestionIndex] can never be undefined (white screen).
  useEffect(() => {
    if (questions.length > 0 && currentQuestionIndex >= questions.length) {
      setCurrentQuestionIndex(questions.length - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions.length]);

  // Initialize default answers for specific question types
  useEffect(() => {
    if (currentQuestionIndex >= 0 && questions[currentQuestionIndex]) {
      const q = questions[currentQuestionIndex];
      if (q.type === 'scale' && answers[q.id] === undefined) {
        setAnswers(prev => ({ ...prev, [q.id]: '3' }));
      }
      if (q.type === 'multiple_selection' && answers[q.id] === undefined) {
        setAnswers(prev => ({ ...prev, [q.id]: [] }));
      }
    }
  }, [currentQuestionIndex, questions, answers]);

  useEffect(() => {
    async function fetchAppAndSettings() {
      if (!applicationId) return;
      try {
        // Fetch Company Branding
        const companyRef = doc(db, 'settings', 'company');
        const companySnap = await getDoc(companyRef);
        if (companySnap.exists()) {
          setCompany({
            name: companySnap.data().name || 'AuraATS',
            logoUrl: companySnap.data().logoUrl || ''
          });
        }

        const docRef = doc(db, 'applications', applicationId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const appData = docSnap.data();
          setApplication(appData);
          if (appData.testResults) {
            setSuccess(true); // Show success screen if already completed
          }
        } else {
          setErrorMsg('El link del test no es válido.');
        }

        const settingsRef = doc(db, 'settings', 'forms');
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists() && settingsSnap.data().testQuestions && !settingsSnap.data().testQuestions.some((q: any) => q.id === 'C1' || q.id === 'q1')) {
          setQuestions(settingsSnap.data().testQuestions);
        } else {
          setQuestions(masterTestQuestions);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        setErrorMsg('No pudimos cargar el test. Por favor, recarga la página en unos segundos.');
      } finally {
        setLoading(false);
      }
    }
    fetchAppAndSettings();
  }, [applicationId]);

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      const nextIndex = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIndex);
      // Show the memorization screen only ONCE per attempt: navigating back and
      // forth must not let the candidate re-view the words.
      if ((questions[nextIndex]?.id === 'A11' || questions[nextIndex]?.id === 'C11') && !memoryWordsShown) {
        setMemoryWordsShown(true);
        setShowMemoryWords(true);
        setMemoryTimeLeft(8);
      }
    } else {
      handleSubmit();
    }
  };

  const handlePrev = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const handleSubmit = async () => {
    if (!applicationId) {
      alert('Error: No se encontró el ID de la postulación.');
      return;
    }
    setSubmitting(true);
    try {
      // Submit to the backend, which evaluates AND persists testResults via the
      // Admin SDK (server-authoritative — the candidate never writes their own score).
      const response = await fetch('/api/evaluate-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, questions, answers })
      });
      if (!response.ok) {
        throw new Error(`evaluate-test respondió ${response.status}`);
      }

      localStorage.removeItem(`aura_test_${applicationId}`);
      setSuccess(true);
    } catch (error) {
      console.error("Error submitting test:", error);
      alert('Error al enviar el test. Por favor, intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderInput = (q: Question) => {
    switch (q.type) {
      case 'textarea':
        return (
          <textarea
            required
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            rows={4}
            value={answers[q.id] || ''}
            onChange={e => setAnswers({...answers, [q.id]: e.target.value})}
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
      case 'multiple_selection':
        let currentAnswers = answers[q.id];
        if (!Array.isArray(currentAnswers)) {
          currentAnswers = currentAnswers ? [currentAnswers as string] : [];
        }
        return (
          <div className="space-y-2">
            {q.options?.map((opt) => (
              <label key={opt} className="flex items-center space-x-3 p-3 border rounded-md hover:bg-gray-50 cursor-pointer">
                <input 
                  type="checkbox" 
                  value={opt} 
                  checked={(currentAnswers as string[]).includes(opt)}
                  onChange={e => {
                    const ansArr = currentAnswers as string[];
                    if (e.target.checked) {
                      setAnswers({...answers, [q.id]: [...ansArr, opt]});
                    } else {
                      setAnswers({...answers, [q.id]: ansArr.filter(a => a !== opt)});
                    }
                  }} 
                  className="h-4 w-4 text-blue-600 rounded" 
                />
                <span className="text-sm text-gray-700">{opt}</span>
              </label>
            ))}
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

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (success) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white p-8 rounded-lg shadow-md text-center max-w-md">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Test Completado</h2>
        <p className="text-gray-600">Tus respuestas han sido guardadas exitosamente.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
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

        {errorMsg && <p className="text-red-600 mb-4 bg-red-50 p-4 rounded-md">{errorMsg}</p>}

        {(errorMsg && !application) || questions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {!errorMsg && <p>Cargando el test…</p>}
          </div>
        ) : currentQuestionIndex === -1 ? (
          <div className="text-center space-y-6">
            <h1 className="text-2xl font-bold text-gray-900">Test de Juicio Situacional</h1>
            <div className="bg-blue-50 p-6 rounded-lg text-blue-800 text-left">
              <p className="font-medium text-lg mb-2">Instrucciones:</p>
              <p>No hay respuestas correctas o incorrectas; responde con honestidad lo que harías o piensas en cada situación.</p>
            </div>
            <button
              onClick={handleNext}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              Comenzar Test
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex justify-between items-center text-sm text-gray-500 mb-4">
              <span>Pregunta {currentQuestionIndex + 1} de {questions.length}</span>
              <div className="w-32 bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                  style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}
                ></div>
              </div>
            </div>

            {showMemoryWords ? (
              <div className="text-center space-y-6 py-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Memoriza estas palabras:</h2>
                <div className="flex flex-wrap justify-center gap-4 text-xl font-medium text-blue-600">
                  <span>cliente</span>
                  <span>cambio</span>
                  <span>orden</span>
                  <span>llamada</span>
                  <span>factura</span>
                </div>
                <div className="mt-8 text-gray-500">
                  La pregunta aparecerá en <span className="font-bold text-gray-900 text-lg">{memoryTimeLeft}</span> segundos...
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-lg font-medium text-gray-900 mb-4">
                  {(questions[currentQuestionIndex].id === 'A11' || questions[currentQuestionIndex].id === 'C11')
                    ? '¿Cuáles de estas palabras recuerdas haber visto? Selecciona las que viste.'
                    : questions[currentQuestionIndex].text}
                </label>
                {renderInput(questions[currentQuestionIndex])}
              </div>
            )}

            <div className="flex justify-between mt-8">
              <button
                type="button"
                onClick={handlePrev}
                disabled={currentQuestionIndex === 0 || showMemoryWords || submitting}
                className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={submitting || showMemoryWords || !questions[currentQuestionIndex] || (Array.isArray(answers[questions[currentQuestionIndex].id]) ? (answers[questions[currentQuestionIndex].id] as any[]).length === 0 : !answers[questions[currentQuestionIndex].id])}
                className="flex justify-center py-2 px-6 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin mr-2" />
                    Evaluando respuestas...
                  </>
                ) : (
                  currentQuestionIndex === questions.length - 1 ? 'Finalizar Test' : 'Siguiente'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
