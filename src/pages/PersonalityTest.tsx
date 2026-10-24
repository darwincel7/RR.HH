import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Building2, CheckCircle, Loader2, Lock, RefreshCw, Smartphone } from 'lucide-react';
import SubmitOverlay from '../components/SubmitOverlay';
import { LIKERT_OPTIONS, TEXT_ANSWER_MAX_LENGTH, isAnswered, type PersonalityQuestion, type PersonalityAnswer } from '../lib/personalityTest';
import type { StationEmbed } from '../lib/stations';

/**
 * Lo que responde el candidato, en persona: una pregunta por pantalla, botones grandes
 * (pensado para tableta o teléfono) y avance automático al elegir una opción.
 *
 * Solo muestra preguntas mientras la entrevistadora lo tenga habilitado; si lo abren antes,
 * espera y se activa solo en cuanto lo habilite. El progreso se guarda en este navegador
 * por intento: si se recarga la página no se pierde nada, y si se reinicia el test no se
 * recuperan respuestas del intento anterior. Al terminar NO muestra el resultado.
 */

type PublicQuestion = Pick<PersonalityQuestion, 'id' | 'text' | 'type' | 'options'>;
interface PublicTest { name: string; instructions: string; attemptId: string; questions: PublicQuestion[] }
type Phase = 'loading' | 'error' | 'invalid' | 'not_started' | 'completed' | 'intro' | 'question' | 'review' | 'done';

const POLL_MS = 5000;
const ADVANCE_DELAY_MS = 280;

/** En un teléfono de la empresa (modo estación) va embebido: ver StationEmbed. */
export default function PersonalityTest({ applicationId: embeddedId, station }: { applicationId?: string; station?: StationEmbed } = {}) {
  const params = useParams();
  const applicationId = embeddedId ?? params.applicationId;
  const stationRef = useRef(station);
  stationRef.current = station;
  const [phase, setPhase] = useState<Phase>('loading');
  const [company, setCompany] = useState({ name: '', logoUrl: '' });
  const [firstName, setFirstName] = useState('');
  const [test, setTest] = useState<PublicTest | null>(null);
  const [answers, setAnswers] = useState<Record<string, PersonalityAnswer>>({});
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [restarted, setRestarted] = useState(false);
  const advanceTimer = useRef<number | null>(null);

  const draftKey = test ? `personality_${applicationId}_${test.attemptId}` : '';

  const load = useCallback(async (quiet = false) => {
    if (!applicationId) return;
    if (!quiet) setPhase('loading');
    try {
      const res = await fetch(`/api/public/personality/${encodeURIComponent(applicationId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.company) setCompany({ name: data.company.name || '', logoUrl: data.company.logoUrl || '' });
      if (!data.valid) { setPhase('invalid'); return; }
      if (data.status !== 'open' || !data.test) {
        setPhase(data.status === 'completed' ? 'completed' : 'not_started');
        if (data.status === 'completed') stationRef.current?.onDone({ firstName: '', alreadyAnswered: true });
        return;
      }
      setFirstName(data.candidateFirstName || '');
      setTest(data.test);
      // Progreso guardado de ESTE intento (si lo hay).
      let restored = false;
      try {
        const saved = JSON.parse(localStorage.getItem(`personality_${applicationId}_${data.test.attemptId}`) || 'null');
        if (saved?.answers && typeof saved.answers === 'object') {
          setAnswers(saved.answers);
          if (Number.isInteger(saved.index)) setIndex(Math.min(Math.max(saved.index, 0), data.test.questions.length - 1));
          restored = Object.keys(saved.answers).length > 0;
        }
      } catch { /* almacenamiento no disponible: se empieza de cero */ }
      setPhase(restored ? 'question' : 'intro');
    } catch (e) {
      console.warn('No se pudo cargar el test de personalidad:', e);
      if (!quiet) setPhase('error');
    }
  }, [applicationId]);

  useEffect(() => { load(); }, [load]);

  // Abierto antes de que lo habiliten: se activa solo en cuanto la entrevistadora lo aplique.
  useEffect(() => {
    if (phase !== 'not_started') return;
    const t = window.setInterval(() => load(true), POLL_MS);
    return () => window.clearInterval(t);
  }, [phase, load]);

  useEffect(() => {
    if (!draftKey || phase === 'done') return;
    try { localStorage.setItem(draftKey, JSON.stringify({ answers, index })); } catch { /* sin almacenamiento */ }
  }, [answers, index, draftKey, phase]);

  useEffect(() => () => { if (advanceTimer.current) window.clearTimeout(advanceTimer.current); }, []);

  const questions = test?.questions || [];
  const q = questions[Math.min(index, Math.max(questions.length - 1, 0))];
  const answeredCount = questions.filter(x => isAnswered(x, answers[x.id])).length;
  const isLast = index >= questions.length - 1;

  const goNext = useCallback(() => {
    if (advanceTimer.current) { window.clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    if (index >= questions.length - 1) setPhase('review');
    else setIndex(i => i + 1);
  }, [index, questions.length]);

  const choose = (value: PersonalityAnswer) => {
    if (!q) return;
    setAnswers(a => ({ ...a, [q.id]: value }));
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(goNext, ADVANCE_DELAY_MS);
  };

  // Teclado (en laptop): 1–5 en la escala, Enter para seguir.
  useEffect(() => {
    if (phase !== 'question' || !q) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (q.type === 'likert' && /^[1-5]$/.test(e.key)) choose(Number(e.key));
      else if (e.key === 'Enter' && isAnswered(q, answers[q.id])) goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = async () => {
    if (!applicationId || !test) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch('/api/public/personality/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, attemptId: test.attemptId, answers, ...(station ? { stationId: station.stationId } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.restarted) setRestarted(true);
        if (Array.isArray(data?.missing) && data.missing.length > 0) {
          const first = questions.findIndex(x => x.id === data.missing[0]);
          if (first >= 0) { setIndex(first); setPhase('question'); }
        }
        throw new Error(data?.error || 'No se pudieron enviar tus respuestas. Intenta de nuevo.');
      }
      try { localStorage.removeItem(draftKey); } catch { /* sin almacenamiento */ }
      setPhase('done');
      stationRef.current?.onDone({ firstName, alreadyAnswered: !!data?.alreadyCompleted });
    } catch (e: any) {
      setSubmitError(e?.message || 'No se pudieron enviar tus respuestas. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  // Modo estación: el panel sigue por qué pregunta va (-1 = la portada).
  useEffect(() => {
    const total = test?.questions.length || 0;
    if (!station || !total) return;
    const at = phase === 'intro' ? -1 : phase === 'question' ? Math.min(index, total - 1) : phase === 'review' ? total - 1 : null;
    if (at !== null) stationRef.current?.onProgress({ index: at, total, exits: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, test]);

  const shell = (children: ReactNode) => (
    <div className="min-h-screen bg-slate-50 py-6 sm:py-10 px-4">
      <SubmitOverlay show={submitting} title="Enviando tus respuestas…" subtitle="Un momento, no cierres esta página." />
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-md p-5 sm:p-8">
        <div className={`flex items-center mb-6 pb-5 border-b border-slate-100 ${station ? 'justify-between gap-3' : 'justify-center'}`}>
          {company.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-10 max-w-[160px] object-contain" />
          ) : (
            <div className="flex items-center text-xl font-display font-bold text-slate-800">
              <Building2 className="w-6 h-6 text-fuchsia-600 mr-2" />
              {company.name || 'Recursos Humanos'}
            </div>
          )}
          {station && (
            <span className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-full bg-fuchsia-50 text-fuchsia-700 flex items-center">
              <Smartphone className="w-3.5 h-3.5 mr-1" /> {station.name}
            </span>
          )}
        </div>
        {children}
      </div>
    </div>
  );

  if (phase === 'loading') {
    return shell(
      <div className="flex flex-col items-center gap-3 py-10">
        <Loader2 className="w-10 h-10 animate-spin text-fuchsia-600" />
        <p className="text-sm text-slate-500">Cargando el test…</p>
      </div>,
    );
  }

  if (phase === 'invalid' || phase === 'error') {
    return shell(
      <div className="text-center py-8 space-y-4">
        <p className="text-slate-700">
          {phase === 'error' ? 'No pudimos cargar el test.' : station ? 'No se encontró este test. Avisa a quien te entregó el teléfono.' : 'Este link no es válido.'}
        </p>
        {phase === 'error' && (
          <button onClick={() => load()} className="inline-flex items-center px-4 py-2 bg-fuchsia-600 text-white rounded-xl font-bold">
            <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
          </button>
        )}
      </div>,
    );
  }

  if (phase === 'not_started') {
    return shell(
      <div className="text-center py-8 space-y-4">
        <Lock className="w-12 h-12 text-slate-300 mx-auto" />
        <h1 className="text-xl font-bold text-slate-900">El test aún no está habilitado</h1>
        <p className="text-slate-600">La entrevistadora lo activará en el momento indicado. Esta pantalla se actualizará sola.</p>
        <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" />
      </div>,
    );
  }

  if (phase === 'completed' || phase === 'done') {
    return shell(
      <div className="text-center py-8 space-y-3">
        <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto" />
        <h1 className="text-2xl font-bold text-slate-900">¡Gracias{phase === 'done' && firstName ? `, ${firstName}` : ''}!</h1>
        <p className="text-slate-600">Tus respuestas quedaron guardadas.</p>
        {phase === 'done' && <p className="text-slate-600 font-medium">Ya puedes entregar el dispositivo a la entrevistadora.</p>}
      </div>,
    );
  }

  if (!test) return null;

  if (phase === 'intro') {
    return shell(
      <div className="space-y-6 text-center">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{test.name}</h1>
          {firstName && <p className="text-slate-500 mt-1">Para: <span className="font-bold text-slate-700">{firstName}</span></p>}
        </div>
        {test.instructions && (
          <div className="bg-fuchsia-50 border border-fuchsia-100 p-5 rounded-xl text-fuchsia-900 text-left whitespace-pre-line">
            {test.instructions}
          </div>
        )}
        <p className="text-sm text-slate-500">{questions.length} preguntas</p>
        <button
          onClick={() => { setIndex(0); setPhase('question'); }}
          className="w-full py-4 rounded-xl text-lg font-bold text-white bg-fuchsia-600 hover:bg-fuchsia-700 shadow-md"
        >
          {firstName ? `Sí, soy ${firstName}. Comenzar` : 'Comenzar'}
        </button>
      </div>,
    );
  }

  if (phase === 'review') {
    const missing = questions.filter(x => !isAnswered(x, answers[x.id]));
    return shell(
      <div className="space-y-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900">¿Listo para enviar?</h1>
        <p className="text-slate-600">Respondiste {answeredCount} de {questions.length} preguntas.</p>
        {missing.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-sm">
            <p className="font-bold mb-2">Te falta responder {missing.length === 1 ? 'una pregunta' : `${missing.length} preguntas`}:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {missing.slice(0, 20).map(m => (
                <button
                  key={m.id}
                  onClick={() => { setIndex(questions.indexOf(m)); setPhase('question'); }}
                  className="px-3 py-1.5 bg-white border border-amber-300 rounded-lg font-bold"
                >
                  {questions.indexOf(m) + 1}
                </button>
              ))}
            </div>
          </div>
        )}
        {submitError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-800 text-sm space-y-2">
            <p>{submitError}</p>
            {restarted && (
              <button onClick={() => { setRestarted(false); setSubmitError(''); setAnswers({}); setIndex(0); load(); }} className="font-bold underline">
                Recargar el test
              </button>
            )}
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={() => { setIndex(questions.length - 1); setPhase('question'); }}
            className="flex-1 py-3 rounded-xl font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50"
          >
            Revisar
          </button>
          <button
            onClick={submit}
            disabled={submitting || missing.length > 0}
            className="flex-1 py-3 rounded-xl font-bold text-white bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50"
          >
            Enviar respuestas
          </button>
        </div>
      </div>,
    );
  }

  // phase === 'question'
  if (!q) return null;
  const value = answers[q.id];
  const progress = Math.round(((index + 1) / questions.length) * 100);
  return shell(
    <div className="space-y-6">
      <div>
        <div className="flex justify-between items-center text-sm text-slate-500 mb-2">
          <span>Pregunta {index + 1} de {questions.length}</span>
          <span>{answeredCount} respondidas</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="bg-fuchsia-600 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <h2 className="text-xl sm:text-2xl font-bold text-slate-900 leading-snug min-h-[4rem]">{q.text}</h2>

      {q.type === 'likert' && (
        <div className="space-y-2" role="radiogroup" aria-label={q.text}>
          {LIKERT_OPTIONS.map(o => {
            const selected = value === o.value;
            return (
              <button
                key={o.value}
                role="radio"
                aria-checked={selected}
                onClick={() => choose(o.value)}
                className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left font-medium transition-colors ${selected ? 'border-fuchsia-600 bg-fuchsia-50 text-fuchsia-900' : 'border-slate-200 hover:border-fuchsia-300 text-slate-700'}`}
              >
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${selected ? 'bg-fuchsia-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{o.value}</span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      {q.type === 'choice' && (
        <div className="space-y-2" role="radiogroup" aria-label={q.text}>
          {(q.options || []).map(opt => {
            const selected = value === opt;
            return (
              <button
                key={opt}
                role="radio"
                aria-checked={selected}
                onClick={() => choose(opt)}
                className={`w-full p-4 rounded-xl border-2 text-left font-medium transition-colors ${selected ? 'border-fuchsia-600 bg-fuchsia-50 text-fuchsia-900' : 'border-slate-200 hover:border-fuchsia-300 text-slate-700'}`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {q.type === 'text' && (
        <textarea
          aria-label={q.text}
          rows={5}
          maxLength={TEXT_ANSWER_MAX_LENGTH}
          autoFocus
          value={typeof value === 'string' ? value : ''}
          onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
          className="w-full p-4 border-2 border-slate-200 rounded-xl text-base focus:border-fuchsia-500 focus:ring-0 outline-none"
          placeholder="Escribe tu respuesta"
        />
      )}

      <div className="flex justify-between gap-3 pt-2">
        <button
          onClick={() => (index === 0 ? setPhase('intro') : setIndex(i => i - 1))}
          className="px-5 py-3 rounded-xl font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50"
        >
          Anterior
        </button>
        <button
          onClick={goNext}
          disabled={!isAnswered(q, value)}
          className="px-6 py-3 rounded-xl font-bold text-white bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40"
        >
          {isLast ? 'Terminar' : 'Siguiente'}
        </button>
      </div>
    </div>,
  );
}
