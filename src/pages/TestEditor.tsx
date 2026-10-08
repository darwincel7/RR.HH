import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ArrowLeft, Loader2, Save, Plus, Trash2, AlertTriangle, CheckCircle, FlaskConical, Scale, Briefcase, Undo2 } from 'lucide-react';
import { db, auth } from '../lib/firebase';
import QuestionCard from '../components/QuestionCard';
import {
  DEFAULT_TEST_ID, TEST_TEMPLATES_COLLECTION, MAX_TEST_QUESTIONS,
  blankTestTemplate, buildDefaultTestTemplate, duplicateTestTemplate, normalizeTestTemplate,
  toTestTemplateDoc, validateTestTemplate, dimensionWeightTotal, vacanciesByTest,
  newQuestionId, newDimensionId,
  type TestTemplate, type TestQuestion, type TestDimension,
} from '../lib/testTemplates';

const FORMS_TESTS_PATH = '/forms?seccion=tests';

/** Comparable form of a test: what would be saved. */
const snapshotOf = (t: TestTemplate) => JSON.stringify(toTestTemplateDoc(t));

/**
 * Editor of one test presencial: what the candidate answers (questions) and what the AI
 * grades (perfil buscado + weighted criteria). /forms/tests/new creates one (blank, or a
 * copy with ?from=<id>); /forms/tests/<id> edits it. The general test ("default") can be
 * edited even before its document exists: saving creates it.
 */
export default function TestEditor() {
  const { testId = 'new' } = useParams();
  const [searchParams] = useSearchParams();
  const fromId = searchParams.get('from');
  const navigate = useNavigate();
  const isNew = testId === 'new';

  const [test, setTest] = useState<TestTemplate | null>(null);
  const [exists, setExists] = useState(false);
  const [loadError, setLoadError] = useState('');
  // Snapshot of the last saved state — for a new test, its starting point (blank or copy).
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [flash, setFlash] = useState('');
  const [vacancies, setVacancies] = useState<any[]>([]);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setTest(null);
    setLoadError('');
    setErrors([]);
    (async () => {
      try {
        const load = async (id: string): Promise<{ t: TestTemplate; exists: boolean } | null> => {
          const snap = await getDoc(doc(db, TEST_TEMPLATES_COLLECTION, id));
          if (snap.exists()) {
            const t = normalizeTestTemplate(snap.data(), id);
            return t.archived ? null : { t, exists: true };
          }
          if (id !== DEFAULT_TEST_ID) return null;
          // The general test before anyone edited it: built from settings/forms, like the server does.
          const forms = await getDoc(doc(db, 'settings', 'forms'));
          return { t: buildDefaultTestTemplate(forms.exists() ? forms.data() : undefined), exists: false };
        };
        let t: TestTemplate;
        let found = false;
        if (isNew) {
          const source = fromId ? await load(fromId) : null;
          if (fromId && !source) throw new Error('No se encontró el test que querías duplicar.');
          t = source ? duplicateTestTemplate(source.t) : blankTestTemplate();
        } else {
          const result = await load(testId);
          if (!result) throw new Error('Este test no existe o fue eliminado.');
          t = result.t;
          found = result.exists;
        }
        if (cancelled) return;
        setTest(t);
        setExists(found);
        setSaved(snapshotOf(t));
      } catch (e: any) {
        console.error('Error cargando el test:', e);
        if (!cancelled) setLoadError(e?.message || 'No se pudo cargar el test.');
      }
    })();
    return () => { cancelled = true; };
  }, [testId, fromId, isNew]);

  useEffect(() => {
    getDocs(collection(db, 'vacancies'))
      .then(s => setVacancies(s.docs.map(d => ({ ...d.data(), id: d.id }))))
      .catch(err => console.error('No se pudieron cargar las vacantes:', err));
  }, []);

  const usedBy = useMemo(
    () => (test && !isNew ? vacanciesByTest(vacancies).get(test.id) || [] : []),
    [vacancies, test?.id, isNew],
  );

  // Edited since loading/saving: what leaving would lose. A new test can be created untouched
  // (e.g. a copy kept as is), but leaving it untouched loses nothing worth a warning.
  const dirty = !!test && snapshotOf(test) !== saved;
  const canSave = isNew || dirty;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const patch = (p: Partial<TestTemplate>) => setTest(t => (t ? { ...t, ...p } : t));
  const updateQuestion = (id: string, p: Partial<TestQuestion>) =>
    setTest(t => (t ? { ...t, questions: t.questions.map(q => (q.id === id ? { ...q, ...p } : q)) } : t));
  const removeQuestion = (id: string) =>
    setTest(t => (t ? { ...t, questions: t.questions.filter(q => q.id !== id) } : t));
  const addQuestion = () =>
    setTest(t => (t ? { ...t, questions: [...t.questions, { id: newQuestionId(), text: '', type: 'textarea' }] } : t));
  const updateDimension = (id: string, p: Partial<TestDimension>) =>
    setTest(t => (t ? { ...t, dimensions: t.dimensions.map(d => (d.id === id ? { ...d, ...p } : d)) } : t));
  const removeDimension = (id: string) =>
    setTest(t => (t ? { ...t, dimensions: t.dimensions.filter(d => d.id !== id) } : t));
  const addDimension = () => setTest(t => {
    if (!t) return t;
    const left = 100 - dimensionWeightTotal(t.dimensions);
    return { ...t, dimensions: [...t.dimensions, { id: newDimensionId(), name: '', weight: left > 0 ? left : 10, description: '' }] };
  });
  // 100 points split as evenly as integers allow (the first criteria take the remainder).
  const splitEvenly = () => setTest(t => {
    if (!t || t.dimensions.length === 0) return t;
    const n = t.dimensions.length;
    const base = Math.floor(100 / n);
    return { ...t, dimensions: t.dimensions.map((d, i) => ({ ...d, weight: base + (i < 100 - base * n ? 1 : 0) })) };
  });

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setTest(t => {
      if (!t) return t;
      const from = t.questions.findIndex(q => q.id === active.id);
      const to = t.questions.findIndex(q => q.id === over.id);
      return from < 0 || to < 0 ? t : { ...t, questions: arrayMove(t.questions, from, to) };
    });
  };

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 5000);
  };

  const handleSave = async () => {
    if (!test) return;
    const problems = validateTestTemplate(test);
    setErrors(problems);
    if (problems.length > 0) {
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setSaving(true);
    try {
      const by = auth.currentUser?.displayName || auth.currentUser?.email || 'Equipo';
      const data: Record<string, any> = { ...toTestTemplateDoc(test), updatedAt: serverTimestamp(), updatedBy: by };
      if (isNew) {
        const ref = doc(collection(db, TEST_TEMPLATES_COLLECTION));
        await setDoc(ref, { ...data, createdAt: serverTimestamp(), createdBy: by });
        setSaved(snapshotOf(test));
        showFlash('Test creado. Ya puedes elegirlo en cualquier vacante (Vacantes → Editar).');
        navigate(`/forms/tests/${ref.id}`, { replace: true });
        return;
      }
      await setDoc(
        doc(db, TEST_TEMPLATES_COLLECTION, test.id),
        exists ? data : { ...data, createdAt: serverTimestamp(), createdBy: by },
        { merge: true },
      );
      setExists(true);
      setSaved(snapshotOf(test));
      showFlash('Test guardado. Quien abra el link del test desde ahora verá esta versión.');
    } catch (e) {
      console.error('Error guardando el test:', e);
      setErrors(['No se pudo guardar el test. Revisa tu conexión e inténtalo de nuevo.']);
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    if (!test) return;
    if (dirty && !window.confirm('¿Descartar los cambios sin guardar?')) return;
    if (isNew) { navigate(FORMS_TESTS_PATH); return; }
    setTest(normalizeTestTemplate(JSON.parse(saved), test.id));
    setErrors([]);
  };

  const goBack = () => {
    if (dirty && !window.confirm('Tienes cambios sin guardar en este test. ¿Salir sin guardar?')) return;
    navigate(FORMS_TESTS_PATH);
  };

  if (loadError) {
    return (
      <div className="max-w-4xl mx-auto">
        <button onClick={() => navigate(FORMS_TESTS_PATH)} className="text-sm font-bold text-slate-500 hover:text-slate-800 flex items-center mb-6">
          <ArrowLeft className="w-4 h-4 mr-1" /> Volver a los tests
        </button>
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <p className="text-slate-700 font-medium">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!test) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-violet-600" /></div>;
  }

  const total = dimensionWeightTotal(test.dimensions);
  const sections = Array.from(new Set(test.questions.map(q => q.block?.trim()).filter(Boolean))) as string[];
  const isDefault = test.id === DEFAULT_TEST_ID;
  const inputClass = 'w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500';

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-8" ref={topRef}>
      <button onClick={goBack} className="text-sm font-bold text-slate-500 hover:text-slate-800 flex items-center">
        <ArrowLeft className="w-4 h-4 mr-1" /> Volver a los tests
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2.5 bg-violet-100 text-violet-600 rounded-xl shrink-0">
            <FlaskConical className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-violet-600 uppercase tracking-wider">
              {isNew ? 'Nuevo test presencial' : isDefault ? 'Test presencial general' : 'Test presencial'}
            </p>
            <h1 className="text-2xl font-bold text-slate-900 break-words">{test.name.trim() || 'Sin nombre'}</h1>
            <p className="text-sm text-slate-500 mt-1 flex items-start gap-1.5">
              <Briefcase className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {isNew
                  ? 'Cuando lo guardes podrás elegirlo en cualquier vacante.'
                  : usedBy.length > 0
                    ? <>Lo usa{usedBy.length === 1 ? '' : 'n'}: {usedBy.map(v => v.title || 'Vacante sin título').join(', ')}</>
                    : isDefault
                      ? 'Se aplica en las vacantes que no tienen otro test elegido.'
                      : 'Ninguna vacante lo usa todavía: elígelo en Vacantes → Editar.'}
              </span>
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="shrink-0 flex items-center justify-center px-4 py-2.5 bg-violet-600 text-white font-bold rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
          {isNew ? 'Crear test' : 'Guardar test'}
        </button>
      </div>

      {flash && (
        <div className="bg-green-50 text-green-700 p-4 rounded-lg flex items-center text-sm font-medium">
          <CheckCircle className="w-5 h-5 mr-2 shrink-0" /> {flash}
        </div>
      )}
      {errors.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-lg text-sm" role="alert">
          <p className="font-bold flex items-center mb-1"><AlertTriangle className="w-4 h-4 mr-2" /> Revisa esto antes de guardar:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* 1. Información */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
        <h2 className="text-lg font-bold text-slate-800">1. Información del test</h2>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Nombre del test *</label>
          <input
            className={inputClass}
            value={test.name}
            maxLength={120}
            onChange={e => patch({ name: e.target.value })}
            placeholder="Ej.: Test Presencial — Técnicos de reparación"
          />
          <p className="text-[11px] text-slate-500 mt-1">Solo lo ve el equipo. El candidato ve "Test Presencial" y el nombre de la vacante.</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">¿Para qué posiciones es? (nota interna)</label>
          <input
            className={inputClass}
            value={test.description || ''}
            onChange={e => patch({ description: e.target.value })}
            placeholder="Ej.: Técnicos de reparación de celulares y tablets"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Instrucciones para el candidato</label>
          <textarea
            rows={3}
            className={inputClass}
            value={test.instructions || ''}
            onChange={e => patch({ instructions: e.target.value })}
            placeholder="Lo que lee el candidato antes de empezar."
          />
        </div>
      </section>

      {/* 2. Qué evalúa la IA */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">2. ¿Qué debe evaluar la IA?</h2>
          <p className="text-sm text-slate-500">Al terminar el test, la IA califica las respuestas con este perfil y estos criterios.</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Perfil buscado para esta posición</label>
          <textarea
            rows={4}
            className={inputClass}
            value={test.profile || ''}
            onChange={e => patch({ profile: e.target.value })}
            placeholder="Ej.: Buscamos técnicos cuidadosos, con método para diagnosticar fallas, honestos con el cliente sobre el costo y el tiempo de reparación…"
          />
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <label className="text-xs font-bold text-slate-600">Criterios de calificación (puntos que vale cada uno)</label>
            <span className={`text-xs font-black px-2 py-1 rounded-md ${total === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              Total: {total}/100
            </span>
          </div>
          <div className="space-y-2">
            {test.dimensions.map((d, i) => (
              <div key={d.id} className="flex flex-col md:flex-row gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <input
                  className={`${inputClass} md:w-1/3 bg-white`}
                  value={d.name}
                  maxLength={80}
                  onChange={e => updateDimension(d.id, { name: e.target.value })}
                  placeholder={`Criterio ${i + 1} (ej.: Conocimiento técnico)`}
                  aria-label={`Nombre del criterio ${i + 1}`}
                />
                <div className="flex items-center gap-1 md:w-28 shrink-0">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    className={`${inputClass} bg-white`}
                    value={Number.isFinite(d.weight) ? d.weight : ''}
                    onChange={e => updateDimension(d.id, { weight: e.target.value === '' ? NaN : parseInt(e.target.value, 10) })}
                    aria-label={`Puntos del criterio ${i + 1}`}
                  />
                  <span className="text-xs text-slate-500">pts</span>
                </div>
                <input
                  className={`${inputClass} flex-1 bg-white`}
                  value={d.description || ''}
                  onChange={e => updateDimension(d.id, { description: e.target.value })}
                  placeholder="Qué cuenta en este criterio"
                  aria-label={`Descripción del criterio ${i + 1}`}
                />
                <button
                  type="button"
                  onClick={() => removeDimension(d.id)}
                  className="self-end md:self-center p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md"
                  title="Quitar criterio"
                  aria-label={`Quitar el criterio ${i + 1}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={addDimension} className="flex items-center text-sm font-bold text-violet-600 hover:text-violet-700 bg-violet-50 px-3 py-1.5 rounded-lg">
              <Plus className="w-4 h-4 mr-1" /> Añadir criterio
            </button>
            {test.dimensions.length > 1 && (
              <button type="button" onClick={splitEvenly} className="flex items-center text-sm font-bold text-slate-600 hover:text-slate-800 bg-slate-100 px-3 py-1.5 rounded-lg">
                <Scale className="w-4 h-4 mr-1" /> Repartir 100 en partes iguales
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 3. Preguntas */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-800">3. Preguntas ({test.questions.length})</h2>
            <p className="text-sm text-slate-500">Arrastra para cambiar el orden. Máximo {MAX_TEST_QUESTIONS}.</p>
          </div>
          <button type="button" onClick={addQuestion} className="flex items-center text-sm font-bold text-violet-600 hover:text-violet-700 bg-violet-50 px-3 py-1.5 rounded-lg">
            <Plus className="w-4 h-4 mr-1" /> Añadir pregunta
          </button>
        </div>
        <div className="space-y-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={test.questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
              {test.questions.map((q, i) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  index={i}
                  withTestFields
                  sections={sections}
                  onChange={p => updateQuestion(q.id, p)}
                  onRemove={() => removeQuestion(q.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {test.questions.length === 0 && <p className="text-center text-slate-400 py-4 text-sm">Este test no tiene preguntas todavía.</p>}
        </div>
        {test.questions.length > 0 && (
          <button type="button" onClick={addQuestion} className="w-full flex items-center justify-center text-sm font-bold text-violet-600 hover:text-violet-700 border-2 border-dashed border-violet-200 hover:border-violet-300 py-3 rounded-xl">
            <Plus className="w-4 h-4 mr-1" /> Añadir pregunta
          </button>
        )}
      </section>

      {canSave && (
        <div className="sticky bottom-4 z-20">
          <div className="bg-slate-900 text-white rounded-xl shadow-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">{isNew ? 'Este test todavía no está guardado.' : 'Tienes cambios sin guardar.'}</span>
            <div className="flex gap-2">
              <button type="button" onClick={discardChanges} className="flex items-center text-sm font-bold text-slate-300 hover:text-white px-3 py-1.5 rounded-lg">
                <Undo2 className="w-4 h-4 mr-1" /> Descartar
              </button>
              <button type="button" onClick={handleSave} disabled={saving} className="flex items-center text-sm font-bold bg-violet-500 hover:bg-violet-400 px-4 py-1.5 rounded-lg disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                {isNew ? 'Crear test' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
