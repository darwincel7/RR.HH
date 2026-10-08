import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, CheckCircle, Building2, RefreshCw } from 'lucide-react';
import SubmitOverlay from '../components/SubmitOverlay';
import {
  DEFAULT_TEST_ID, BLANK_TEST_INSTRUCTIONS, MEMORY_SECONDS, MEMORY_WORDS, isMemoryQuestion,
  type PublicTestQuestion,
} from '../lib/testTemplates';

type Answer = string | string[];

const progressKey = (applicationId: string) => `aura_test_${applicationId}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * The test presencial, as the candidate takes it (usually on a device the recruiter hands
 * them). Which test it is depends on the vacancy: the server resolves it and sends the
 * questions without anything private (expected answers).
 */
export default function CandidateTest() {
  const { applicationId } = useParams();
  const [company, setCompany] = useState({ name: 'AuraATS', logoUrl: '' });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [testId, setTestId] = useState('');
  const [vacancyTitle, setVacancyTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [questions, setQuestions] = useState<PublicTestQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(-1); // -1 means intro screen
  const [showMemoryWords, setShowMemoryWords] = useState(false);
  const [memoryWordsShown, setMemoryWordsShown] = useState(false); // only once per attempt
  const [memoryTimeLeft, setMemoryTimeLeft] = useState(MEMORY_SECONDS);

  // Progress saved in this browser belongs to ONE test. If the vacancy switched tests,
  // those answers would show up against other questions: start over instead. Progress saved
  // before tests per position carried no test id and was always the general test.
  const restoreProgress = (id: string, qs: PublicTestQuestion[]) => {
    if (!applicationId) return;
    try {
      const saved = localStorage.getItem(progressKey(applicationId));
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if ((parsed.testId ?? DEFAULT_TEST_ID) !== id) {
        localStorage.removeItem(progressKey(applicationId));
        return;
      }
      if (parsed.answers && typeof parsed.answers === 'object') setAnswers(parsed.answers);
      if (typeof parsed.currentIndex === 'number' && parsed.currentIndex >= -1 && qs.length > 0) {
        const index = Math.min(parsed.currentIndex, qs.length - 1);
        setCurrentQuestionIndex(index);
        // They already went through the memorization screen in the previous session.
        if (qs.slice(0, index + 1).some(q => isMemoryQuestion(q))) setMemoryWordsShown(true);
      }
    } catch (e) {
      console.error('Error loading saved test progress', e);
    }
  };

  useEffect(() => {
    if (!applicationId) return;
    let cancelled = false;
    // Progress key of an older version of this page (62-question format).
    try { localStorage.removeItem(`darwin_test_${applicationId}`); } catch { /* storage blocked */ }

    (async () => {
      setLoading(true);
      setLoadFailed(false);
      setErrorMsg('');
      // A few quick retries: a server that is restarting (a deploy) answers within seconds.
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const res = await fetch(`/api/public/form-data/test/${encodeURIComponent(applicationId)}`);
          if (res.ok) {
            const data = await res.json();
            if (cancelled) return;
            if (data.company) setCompany({ name: data.company.name || 'AuraATS', logoUrl: data.company.logoUrl || '' });
            if (!data.valid) {
              setErrorMsg('El link del test no es válido.');
            } else if (data.completed) {
              setSuccess(true);
            } else {
              const test = data.test || {};
              const qs: PublicTestQuestion[] = Array.isArray(test.questions) ? test.questions
                : Array.isArray(data.questions) ? data.questions : [];
              const id = typeof test.id === 'string' && test.id ? test.id : DEFAULT_TEST_ID;
              setTestId(id);
              setVacancyTitle(typeof data.vacancyTitle === 'string' ? data.vacancyTitle : '');
              setInstructions(typeof test.instructions === 'string' ? test.instructions : '');
              setQuestions(qs);
              restoreProgress(id, qs);
            }
            setLoading(false);
            return;
          }
          if (res.status === 400) {
            if (cancelled) return;
            setErrorMsg('El link del test no es válido.');
            setLoading(false);
            return;
          }
        } catch (err) {
          console.warn('No se pudo cargar el test:', err);
        }
        if (attempt < 2) await sleep(1500 * (attempt + 1));
      }
      if (!cancelled) {
        setLoadFailed(true);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, reloadKey]);

  // Save progress to localStorage
  useEffect(() => {
    if (applicationId && testId && currentQuestionIndex >= 0) {
      try {
        localStorage.setItem(progressKey(applicationId), JSON.stringify({
          testId,
          answers,
          currentIndex: currentQuestionIndex,
        }));
      } catch { /* storage blocked: progress just isn't kept */ }
    }
  }, [answers, currentQuestionIndex, applicationId, testId]);

  useEffect(() => {
    let timer: any;
    if (showMemoryWords && memoryTimeLeft > 0) {
      timer = setTimeout(() => setMemoryTimeLeft(prev => prev - 1), 1000);
    } else if (showMemoryWords && memoryTimeLeft === 0) {
      setShowMemoryWords(false);
    }
    return () => clearTimeout(timer);
  }, [showMemoryWords, memoryTimeLeft]);

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

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      const nextIndex = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIndex);
      // Show the memorization screen only ONCE per attempt: navigating back and
      // forth must not let the candidate re-view the words.
      if (isMemoryQuestion(questions[nextIndex]) && !memoryWordsShown) {
        setMemoryWordsShown(true);
        setShowMemoryWords(true);
        setMemoryTimeLeft(MEMORY_SECONDS);
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
      // Only the answers to THIS test's questions (restored progress may hold others).
      const testAnswers = Object.fromEntries(
        questions.filter(q => answers[q.id] !== undefined).map(q => [q.id, answers[q.id]])
      );
      // Submit to the backend, which evaluates AND persists testResults via the
      // Admin SDK (server-authoritative — the candidate never writes their own score).
      const response = await fetch('/api/evaluate-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationId,
          // The test the candidate answered — graded as such even if the vacancy switched tests.
          testTemplateId: testId,
          // The texts they saw, to label an answer whose question was edited meanwhile.
          questions: questions.map(q => ({ id: q.id, text: q.text })),
          answers: testAnswers,
        })
      });
      if (!response.ok) {
        throw new Error(`evaluate-test respondió ${response.status}`);
      }

      try { localStorage.removeItem(progressKey(applicationId)); } catch { /* storage blocked */ }
      setSuccess(true);
    } catch (error) {
      console.error("Error submitting test:", error);
      alert('Error al enviar el test. Por favor, intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderInput = (q: PublicTestQuestion) => {
    switch (q.type) {
      case 'textarea':
        return (
          <textarea
            required
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            rows={4}
            value={(answers[q.id] as string) || ''}
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
              value={(answers[q.id] as string) || '3'}
              onChange={e => setAnswers({...answers, [q.id]: e.target.value})}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1</span>
              <span>Valor: {(answers[q.id] as string) || '3'}</span>
              <span>5</span>
            </div>
          </div>
        );
      case 'multiple_selection': {
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
      }
      case 'text':
      default:
        return (
          <input
            type="text"
            required
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            value={(answers[q.id] as string) || ''}
            onChange={e => setAnswers({...answers, [q.id]: e.target.value})}
          />
        );
    }
  };

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
      <Loader2 className="w-10 h-10 animate-spin text-violet-600" />
      <p className="text-sm text-slate-500 font-medium">Cargando tu test…</p>
    </div>
  );
  if (success) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white p-8 rounded-lg shadow-md text-center max-w-md">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Test Completado</h2>
        <p className="text-gray-600">Tus respuestas han sido guardadas exitosamente.</p>
      </div>
    </div>
  );

  // RENDER-SAFE index: never past the loaded question set, even for one render.
  const qIndex = questions.length > 0
    ? Math.min(Math.max(currentQuestionIndex, -1), questions.length - 1)
    : currentQuestionIndex;
  const currentQuestion = qIndex >= 0 ? questions[qIndex] : null;
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;
  const answered = Array.isArray(currentAnswer) ? currentAnswer.length > 0 : !!String(currentAnswer ?? '').trim();

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <SubmitOverlay
        show={submitting}
        title="Enviando tu test…"
        subtitle="Estamos evaluando tus respuestas con IA. Esto puede tardar unos segundos — no cierres esta página."
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

        {errorMsg && <p className="text-red-600 mb-4 bg-red-50 p-4 rounded-md">{errorMsg}</p>}

        {loadFailed ? (
          <div className="text-center space-y-4 py-6">
            <p className="text-gray-700">No pudimos cargar el test. Revisa la conexión a internet e inténtalo de nuevo.</p>
            <button
              onClick={() => setReloadKey(k => k + 1)}
              className="inline-flex items-center py-2 px-5 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </button>
          </div>
        ) : errorMsg ? null : questions.length === 0 ? (
          <div className="text-center py-8 text-gray-600">
            Este test todavía no tiene preguntas. Avísale a la persona que te está evaluando.
          </div>
        ) : qIndex === -1 ? (
          <div className="text-center space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Test Presencial</h1>
              {vacancyTitle && <p className="text-gray-500 mt-1">Vacante: {vacancyTitle}</p>}
            </div>
            <div className="bg-blue-50 p-6 rounded-lg text-blue-800 text-left">
              <p className="font-medium text-lg mb-2">Instrucciones:</p>
              <p className="whitespace-pre-line">{instructions.trim() || BLANK_TEST_INSTRUCTIONS}</p>
              <p className="text-sm text-blue-700 mt-3">Son {questions.length} preguntas. Tu avance se guarda en este dispositivo.</p>
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
              <span>Pregunta {qIndex + 1} de {questions.length}</span>
              <div className="w-32 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${((qIndex + 1) / questions.length) * 100}%` }}
                ></div>
              </div>
            </div>

            {showMemoryWords ? (
              <div className="text-center space-y-6 py-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Memoriza estas palabras:</h2>
                <div className="flex flex-wrap justify-center gap-4 text-xl font-medium text-blue-600">
                  {MEMORY_WORDS.map(w => <span key={w}>{w}</span>)}
                </div>
                <div className="mt-8 text-gray-500">
                  La pregunta aparecerá en <span className="font-bold text-gray-900 text-lg">{memoryTimeLeft}</span> segundos...
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-lg font-medium text-gray-900 mb-4 whitespace-pre-line">
                  {isMemoryQuestion(currentQuestion)
                    ? '¿Cuáles de estas palabras recuerdas haber visto? Selecciona las que viste.'
                    : currentQuestion?.text}
                </label>
                {currentQuestion && renderInput(currentQuestion)}
              </div>
            )}

            <div className="flex justify-between mt-8">
              <button
                type="button"
                onClick={handlePrev}
                disabled={qIndex === 0 || showMemoryWords || submitting}
                className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={submitting || showMemoryWords || !currentQuestion || !answered}
                className="flex justify-center py-2 px-6 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin mr-2" />
                    Evaluando respuestas...
                  </>
                ) : (
                  qIndex === questions.length - 1 ? 'Finalizar Test' : 'Siguiente'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
