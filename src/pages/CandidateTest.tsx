import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Loader2, CheckCircle, Send, Building2, AlertTriangle, UserCheck, Smartphone } from 'lucide-react';
import SubmitOverlay from '../components/SubmitOverlay';
import { masterTestQuestions, Question } from '../data/testQuestions';
import { shortNameOf } from '../lib/personName';
import { isPastedInsert } from '../lib/testIntegrity';
import type { StationEmbed } from '../lib/stations';

// The test is graded on spelling too: the field must not fix it for the candidate. These
// switch off the browser's checker and, on most phone keyboards, autocorrect and
// suggestions (the keyboard's own settings remain the sure way).
const NO_WRITING_AIDS = { spellCheck: false, autoCorrect: 'off', autoCapitalize: 'off', autoComplete: 'off' } as const;

/** What the page counts while the test is answered (src/lib/testIntegrity.ts). Saved
 * with the progress, so reloading the page doesn't wipe it. */
interface IntegrityState {
  exits: number;
  awayMs: number;
  pasteBlocked: number;
  /** When "Comenzar" was pressed (0 = not yet). */
  startedAt: number;
  /** When the screen stopped being visible (0 = it is visible). */
  hiddenAt: number;
}

export default function CandidateTest({ applicationId: embeddedId, station }: { applicationId?: string; station?: StationEmbed } = {}) {
  const params = useParams();
  const applicationId = embeddedId ?? params.applicationId;
  // The parent re-renders with fresh callbacks; handlers read the latest from here.
  const stationRef = useRef(station);
  stationRef.current = station;
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
  // "Este test es para: Juan C. P." — the phone is the company's, so the candidate
  // confirms the test is theirs before starting.
  const [candidateShortName, setCandidateShortName] = useState('');
  // Shown when they come back from another app or a paste was blocked.
  const [notice, setNotice] = useState('');
  const integrityRef = useRef<IntegrityState>({ exits: 0, awayMs: 0, pasteBlocked: 0, startedAt: 0, hiddenAt: 0 });
  // Leaving only counts while the test is being answered (not on the intro or once sent).
  const answeringRef = useRef(false);
  answeringRef.current = currentQuestionIndex >= 0 && !success && !submitting;

  const storageKey = `aura_test_${applicationId}`;

  // Read-modify-write: called from event handlers, where the state may be stale.
  const persistIntegrity = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      localStorage.setItem(storageKey, JSON.stringify({ ...saved, integrity: integrityRef.current }));
    } catch { /* storage blocked: the counters still travel with the answers */ }
  };

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
          if (parsed.integrity && typeof parsed.integrity === 'object') {
            const it = { ...integrityRef.current, ...parsed.integrity };
            // The page was closed or reloaded while it was hidden: the time until it was
            // opened again was spent outside the test.
            if (it.hiddenAt > 0) {
              it.awayMs += Math.max(0, Date.now() - it.hiddenAt);
              it.hiddenAt = 0;
            }
            integrityRef.current = it;
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
        currentIndex: currentQuestionIndex,
        integrity: integrityRef.current,
      }));
    }
  }, [answers, currentQuestionIndex, applicationId]);

  // Every time the test screen stops being visible (another app or tab, the phone
  // locked, the page reloaded) counts as an exit, with the time spent away.
  useEffect(() => {
    const onVisibility = () => {
      const it = integrityRef.current;
      if (document.visibilityState === 'hidden') {
        if (!answeringRef.current || it.hiddenAt) return;
        it.exits += 1;
        it.hiddenAt = Date.now();
      } else {
        if (!it.hiddenAt) return;
        it.awayMs += Math.max(0, Date.now() - it.hiddenAt);
        it.hiddenAt = 0;
        setNotice('Saliste de la pantalla del test. Cada salida queda registrada.');
        reportProgress();
      }
      persistIntegrity();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  // Station mode: the panel follows the question on screen and the exits.
  const progressRef = useRef({ index: -1, total: 0 });
  const reportProgress = () => {
    const { index, total } = progressRef.current;
    if (total > 0) stationRef.current?.onProgress({ index, total, exits: integrityRef.current.exits });
  };
  useEffect(() => {
    if (!station || loading || questions.length === 0) return;
    progressRef.current = { index: Math.min(currentQuestionIndex, questions.length - 1), total: questions.length };
    reportProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestionIndex, questions.length, loading]);

  const firstNameOf = (shortName: string) => shortName.split(' ')[0] || '';

  const blockPaste = () => {
    integrityRef.current.pasteBlocked += 1;
    persistIntegrity();
    setNotice('No se permite pegar ni dictar texto: escribe tu respuesta.');
  };

  // Typed answers only: a block of text arriving at once (pasted from the keyboard's own
  // clipboard, dictated) is refused and counted, like a paste.
  const setTypedAnswer = (qId: string, next: string) => {
    const prev = typeof answers[qId] === 'string' ? (answers[qId] as string) : '';
    if (isPastedInsert(prev, next)) {
      blockPaste();
      return;
    }
    setAnswers({ ...answers, [qId]: next });
  };

  const noPaste = {
    onPaste: (e: React.ClipboardEvent) => { e.preventDefault(); blockPaste(); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); blockPaste(); },
  };

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
      // FAST PATH: one warm server call — no client Firestore cold-start, no auth.
      try {
        const res = await fetch(`/api/public/form-data/test/${encodeURIComponent(applicationId)}`);
        if (res.ok) {
          const data = await res.json();
          if (!data.valid) {
            setErrorMsg(stationRef.current ? 'No se encontró este test. Avisa a quien te entregó el teléfono.' : 'El link del test no es válido.');
          } else {
            if (data.company) setCompany({ name: data.company.name || 'AuraATS', logoUrl: data.company.logoUrl || '' });
            const shortName = typeof data.candidateShortName === 'string' ? data.candidateShortName : '';
            setCandidateShortName(shortName);
            setApplication({ testResults: data.completed ? true : undefined });
            if (data.completed) {
              setSuccess(true);
              stationRef.current?.onDone({ firstName: firstNameOf(shortName), alreadyAnswered: true });
            }
            // null → use the bundled master question set (kept off the wire).
            setQuestions(Array.isArray(data.questions) && data.questions.length > 0 ? data.questions : masterTestQuestions);
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
          setCandidateShortName(shortNameOf(String(appData.candidateName || '')));
          if (appData.testResults) {
            setSuccess(true);
            stationRef.current?.onDone({ firstName: firstNameOf(shortNameOf(String(appData.candidateName || ''))), alreadyAnswered: true });
          }
        } else {
          setErrorMsg(stationRef.current ? 'No se encontró este test. Avisa a quien te entregó el teléfono.' : 'El link del test no es válido.');
        }
        const settingsSnap = await getDoc(doc(db, 'settings', 'forms'));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  const handleNext = () => {
    setNotice('');
    if (currentQuestionIndex === -1 && !integrityRef.current.startedAt) {
      integrityRef.current.startedAt = Date.now();
    }
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
    setNotice('');
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
      const it = integrityRef.current;
      const integrity = {
        exits: it.exits,
        awayMs: it.awayMs,
        pasteBlocked: it.pasteBlocked,
        durationMs: it.startedAt ? Math.max(0, Date.now() - it.startedAt) : 0,
      };
      const response = await fetch('/api/evaluate-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, questions, answers, integrity, ...(station ? { stationId: station.stationId } : {}) })
      });
      if (!response.ok) {
        throw new Error(`evaluate-test respondió ${response.status}`);
      }

      localStorage.removeItem(`aura_test_${applicationId}`);
      setSuccess(true);
      stationRef.current?.onDone({ firstName: firstNameOf(candidateShortName), alreadyAnswered: false });
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
            {...NO_WRITING_AIDS}
            {...noPaste}
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            rows={4}
            value={answers[q.id] || ''}
            onChange={e => setTypedAnswer(q.id, e.target.value)}
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
            {...NO_WRITING_AIDS}
            {...noPaste}
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            value={answers[q.id] || ''}
            onChange={e => setTypedAnswer(q.id, e.target.value)}
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

  // RENDER-SAFE index: never past the loaded question set. The state-clamp effect runs
  // only AFTER render, so without this a restored index that outlives a now-shorter test
  // would evaluate questions[i].id on undefined and white-screen the candidate for good.
  const qIndex = questions.length > 0
    ? Math.min(Math.max(currentQuestionIndex, -1), questions.length - 1)
    : currentQuestionIndex;
  const currentQuestion = qIndex >= 0 ? questions[qIndex] : null;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <SubmitOverlay
        show={submitting}
        title="Enviando tu test…"
        subtitle="Estamos evaluando tus respuestas con IA. Esto puede tardar unos segundos — no cierres esta página."
      />
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md p-8">
        {/* Company Header */}
        <div className={`flex items-center mb-8 pb-6 border-b border-gray-100 ${station ? 'justify-between gap-3' : 'justify-center'}`}>
          {company.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-10 max-w-[150px] object-contain" />
          ) : (
            <div className="flex items-center text-xl font-display font-bold text-gray-800">
              <Building2 className="w-6 h-6 text-blue-600 mr-2" />
              {company.name}
            </div>
          )}
          {station && (
            <span className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 flex items-center">
              <Smartphone className="w-3.5 h-3.5 mr-1" /> {station.name}
            </span>
          )}
        </div>

        {errorMsg && <p className="text-red-600 mb-4 bg-red-50 p-4 rounded-md">{errorMsg}</p>}

        {(errorMsg && !application) || questions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {!errorMsg && <p>Cargando el test…</p>}
          </div>
        ) : qIndex === -1 ? (
          <div className="text-center space-y-6">
            <h1 className="text-2xl font-bold text-gray-900">Test de Juicio Situacional</h1>
            {candidateShortName && (
              <div className="border-2 border-blue-100 p-5 rounded-lg">
                <p className="text-sm text-gray-500">Este test es para</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{candidateShortName}</p>
                <p className="text-xs text-gray-500 mt-2">¿No eres tú? No lo empieces y avisa a quien te entregó el teléfono.</p>
              </div>
            )}
            <div className="bg-blue-50 p-6 rounded-lg text-blue-800 text-left">
              <p className="font-medium text-lg mb-2">Instrucciones:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>No hay respuestas correctas o incorrectas; responde con honestidad lo que harías o piensas en cada situación.</li>
                <li>Escribe con tus propias palabras: no se puede pegar ni dictar texto.</li>
                <li>Quédate en esta pantalla hasta terminar: si sales a otra aplicación, queda registrado.</li>
              </ul>
            </div>
            <button
              onClick={handleNext}
              className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              {candidateShortName ? (
                <><UserCheck className="w-4 h-4 mr-2" /> Sí, soy {candidateShortName.replace(/\.$/, '')}. Comenzar test</>
              ) : 'Comenzar Test'}
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

            {notice && (
              <p role="alert" className="flex items-start text-sm font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 shrink-0" /> {notice}
              </p>
            )}

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
                  {currentQuestion && (currentQuestion.id === 'A11' || currentQuestion.id === 'C11')
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
                disabled={submitting || showMemoryWords || !currentQuestion || (Array.isArray(answers[currentQuestion.id]) ? (answers[currentQuestion.id] as any[]).length === 0 : !answers[currentQuestion.id])}
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
