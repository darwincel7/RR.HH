import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, doc, getDoc, onSnapshot, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Loader2, Save, CheckCircle, Plus, Trash2, ChevronDown, ChevronUp, Copy, Pencil, Briefcase, AlertTriangle } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import QuestionCard from '../components/QuestionCard';
import { useTestTemplates } from '../lib/useTestTemplates';
import { DEFAULT_TEST_ID, TEST_TEMPLATES_COLLECTION, vacanciesByTest, type TestQuestion, type TestTemplate } from '../lib/testTemplates';

type Question = TestQuestion;

interface ScorecardSettings {
  recommendedQuestions: string[];
  positiveSignals: string[];
  redFlags: string[];
  metrics: string[];
}

const defaultScorecard: ScorecardSettings = {
  recommendedQuestions: [
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
  ],
  positiveSignals: ['Sonrisa natural', 'Tono amable', 'Empatía genuina', 'Seguridad sin arrogancia', 'Respeto', 'Facilidad para aprender', 'Interés real en el trabajo', 'Madurez emocional'],
  redFlags: ['Habla mal de todos sus jefes', 'Se contradice mucho', 'Culpa siempre a otros', 'Poca paciencia', 'Arrogancia', 'Actitud conflictiva', 'Poca estabilidad', 'Resistencia a correcciones', 'Respuestas vacías o muy ensayadas', 'Baja energía o apatía'],
  metrics: ['Puntualidad', 'Presentación personal', 'Contacto visual', 'Claridad al hablar', 'Energía', 'Cortesía y escucha activa']
};

const DEFAULT_STAGE2_QUESTIONS: Question[] = [
  { id: 'q1', text: 'Cuéntanos más sobre tu experiencia previa relevante para este puesto.', type: 'textarea' },
  { id: 'q2', text: 'Describe una situación de conflicto en el trabajo y cómo la resolviste.', type: 'textarea' },
  { id: 'q3', text: 'Expectativa Salarial (Mensual)', type: 'text' },
  { id: 'q4', text: 'Disponibilidad para iniciar', type: 'text' }
];

type Section = 'stage2' | 'tests' | 'scorecard';

export default function FormsSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  // ?seccion=tests opens the tests library (where the test editor's "Volver" lands).
  const [expandedSection, setExpandedSection] = useState<Section | null>(() => {
    const s = searchParams.get('seccion');
    return s === 'stage2' || s === 'tests' || s === 'scorecard' ? s : null;
  });

  const [stage2Questions, setStage2Questions] = useState<Question[]>([]);
  const [scorecard, setScorecard] = useState<ScorecardSettings>(defaultScorecard);

  const { templates, loading: testsLoading, error: testsError } = useTestTemplates();
  const [vacancies, setVacancies] = useState<any[]>([]);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const docRef = doc(db, 'settings', 'forms');
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          
          // Handle Stage 2 Form
          if (data.stage2Questions && Array.isArray(data.stage2Questions)) {
            setStage2Questions(data.stage2Questions);
          } else if (data.stage2Form) {
            setStage2Questions([
              { id: 'q1', text: data.stage2Form.q1 || '', type: 'textarea' },
              { id: 'q2', text: data.stage2Form.q2 || '', type: 'textarea' },
              { id: 'q3', text: data.stage2Form.q3 || '', type: 'text' },
              { id: 'q4', text: data.stage2Form.q4 || '', type: 'text' }
            ]);
          } else {
            setStage2Questions(DEFAULT_STAGE2_QUESTIONS);
          }

          // Handle Scorecard
          if (data.scorecard) {
            setScorecard({
              recommendedQuestions: data.scorecard.recommendedQuestions || defaultScorecard.recommendedQuestions,
              positiveSignals: data.scorecard.positiveSignals || defaultScorecard.positiveSignals,
              redFlags: data.scorecard.redFlags || defaultScorecard.redFlags,
              metrics: data.scorecard.metrics || defaultScorecard.metrics
            });
          }
        } else {
          // Defaults if no document exists
          setStage2Questions(DEFAULT_STAGE2_QUESTIONS);
        }
      } catch (error) {
        console.error("Error fetching form settings:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  // LIVE vacancies: which ones use each test (a test in use can't be deleted).
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'vacancies'),
      snap => setVacancies(snap.docs.map(d => ({ ...d.data(), id: d.id }))),
      err => console.error('Error cargando vacantes:', err));
    return () => unsub();
  }, []);
  const usage = vacanciesByTest(vacancies);

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      // Create a clean payload with no undefined values to prevent Firestore crashes.
      // The test presencial is no longer saved here: each test is its own document
      // (test_templates), edited on its own page.
      const payload = JSON.parse(JSON.stringify({
        stage2Questions,
        scorecard
      }));
      
      await setDoc(doc(db, 'settings', 'forms'), payload, { merge: true });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error("Error saving form settings:", error);
      alert("Error al guardar la configuración");
    } finally {
      setSaving(false);
    }
  };

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const addStage2Question = () => {
    setStage2Questions([...stage2Questions, { id: generateId(), text: 'Nueva pregunta', type: 'text' }]);
  };

  const removeStage2Question = (id: string) => {
    setStage2Questions(stage2Questions.filter(q => q.id !== id));
  };

  const updateStage2Question = (id: string, patch: Partial<Question>) => {
    setStage2Questions(stage2Questions.map(q => (q.id === id ? { ...q, ...patch } : q)));
  };

  const addScorecardItem = (field: keyof ScorecardSettings) => {
    setScorecard({
      ...scorecard,
      [field]: [...scorecard[field], 'Nuevo elemento']
    });
  };

  const updateScorecardItem = (field: keyof ScorecardSettings, index: number, value: string) => {
    const newArray = [...scorecard[field]];
    newArray[index] = value;
    setScorecard({ ...scorecard, [field]: newArray });
  };

  const removeScorecardItem = (field: keyof ScorecardSettings, index: number) => {
    const newArray = [...scorecard[field]];
    newArray.splice(index, 1);
    setScorecard({ ...scorecard, [field]: newArray });
  };

  const renderScorecardList = (title: string, field: keyof ScorecardSettings, colorClass: string) => (
    <div className={`p-4 rounded-xl border ${colorClass} bg-white`}>
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-bold text-slate-800">{title}</h4>
        <button onClick={() => addScorecardItem(field)} className="text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center">
          <Plus className="w-4 h-4 mr-1" /> Añadir
        </button>
      </div>
      <div className="space-y-2">
        {scorecard[field].map((item, index) => (
          <div key={index} className="flex items-start gap-2 group">
            <textarea
              className="flex-1 p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={field === 'recommendedQuestions' ? 2 : 1}
              value={item}
              onChange={(e) => updateScorecardItem(field, index, e.target.value)}
            />
            <button 
              onClick={() => removeScorecardItem(field, index)}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {scorecard[field].length === 0 && (
          <p className="text-sm text-slate-400 text-center py-2">No hay elementos configurados.</p>
        )}
      </div>
    </div>
  );

  const handleStage2DragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = stage2Questions.findIndex(item => item.id === active.id);
    const newIndex = stage2Questions.findIndex(item => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setStage2Questions(arrayMove(stage2Questions, oldIndex, newIndex));
  };

  // "Deleting" a test archives it: candidates who already took it keep their results,
  // and a re-evaluation still grades them with that test's criteria.
  const deleteTest = async (t: TestTemplate) => {
    if (t.id === DEFAULT_TEST_ID) return;
    const users = usage.get(t.id) || [];
    if (users.length > 0) {
      const names = users.map(v => `• ${v.title || 'Vacante sin título'}`).join('\n');
      alert(`No se puede eliminar "${t.name}" porque ${users.length === 1 ? 'esta vacante lo usa' : 'estas vacantes lo usan'}:\n\n${names}\n\nElige otro test en ${users.length === 1 ? 'esa vacante' : 'esas vacantes'} (Vacantes → Editar) y vuelve a intentarlo.`);
      return;
    }
    if (!window.confirm(`¿Eliminar el test "${t.name}"?\n\nYa no se podrá elegir en las vacantes. Los candidatos que ya lo hicieron conservan sus resultados.`)) return;
    try {
      await updateDoc(doc(db, TEST_TEMPLATES_COLLECTION, t.id), {
        archived: true,
        archivedAt: serverTimestamp(),
        archivedBy: auth.currentUser?.displayName || auth.currentUser?.email || 'Equipo',
      });
    } catch (error) {
      console.error('Error eliminando el test:', error);
      alert('No se pudo eliminar el test. Inténtalo de nuevo.');
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // The open section lives in the URL too, so coming back from a test (Atrás) finds it open.
  const toggle = (section: Section) => {
    const next = expandedSection === section ? null : section;
    setExpandedSection(next);
    setSearchParams(next ? { seccion: next } : {}, { replace: true });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Formularios y Evaluaciones</h1>
          <p className="text-slate-500">Configura las preguntas y evaluaciones de cada etapa del proceso.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          title="Guarda el formulario de la etapa 2 y el scorecard. Cada test presencial se guarda en su propia página."
          className="flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-400"
        >
          {saving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
          Guardar Cambios
        </button>
      </div>

      {success && (
        <div className="bg-green-50 text-green-700 p-4 rounded-lg flex items-center">
          <CheckCircle className="w-5 h-5 mr-2" />
          Configuración guardada exitosamente.
        </div>
      )}

      <div className="space-y-4">
        {/* Stage 2 Form (Etapa 2) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <button 
            onClick={() => toggle('stage2')}
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
          >
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold shrink-0">2</div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Formulario de Filtro (Etapa 2)</h2>
                <p className="text-sm text-slate-500">Enviado automáticamente al mover a "Etapa 2". Contiene {stage2Questions.length} preguntas.</p>
              </div>
            </div>
            {expandedSection === 'stage2' ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
          </button>
          
          {expandedSection === 'stage2' && (
            <div className="p-4 border-t border-slate-200 bg-slate-50">
              <div className="flex justify-end mb-4">
                <button onClick={addStage2Question} className="flex items-center text-sm font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg">
                  <Plus className="w-4 h-4 mr-1" /> Añadir Pregunta
                </button>
              </div>
              <div className="space-y-3">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleStage2DragEnd}>
                  <SortableContext items={stage2Questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
                    {stage2Questions.map((q, i) => (
                      <QuestionCard
                        key={q.id}
                        question={q}
                        index={i}
                        onChange={patch => updateStage2Question(q.id, patch)}
                        onRemove={() => removeStage2Question(q.id)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
                {stage2Questions.length === 0 && <p className="text-center text-slate-400 py-4 text-sm">No hay preguntas configuradas.</p>}
              </div>
            </div>
          )}
        </div>

        {/* Tests presenciales: a library — each vacancy picks the one its candidates take */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <button 
            onClick={() => toggle('tests')}
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
          >
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center font-bold shrink-0">3</div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Tests Presenciales</h2>
                <p className="text-sm text-slate-500">
                  Cada vacante elige su test, con sus propias preguntas y criterios de evaluación. Se aplican en persona: abre o copia el link desde el perfil del candidato.
                  {!testsLoading && ` ${templates.length} ${templates.length === 1 ? 'test' : 'tests'}.`}
                </p>
              </div>
            </div>
            {expandedSection === 'tests' ? <ChevronUp className="w-5 h-5 text-slate-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" />}
          </button>

          {expandedSection === 'tests' && (
            <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500 max-w-xl">
                  Crea un test por posición (técnicos, caja, redes…) o duplica uno existente para adaptarlo. Luego elígelo en <Link to="/vacancies" className="font-bold text-violet-600 hover:underline">Vacantes → Editar</Link>.
                </p>
                <Link to="/forms/tests/new" className="flex items-center text-sm font-bold text-violet-600 hover:text-violet-700 bg-violet-50 px-3 py-1.5 rounded-lg">
                  <Plus className="w-4 h-4 mr-1" /> Nuevo test
                </Link>
              </div>

              {testsError && (
                <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-sm flex items-start">
                  <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 shrink-0" /> {testsError}
                </div>
              )}
              {testsLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-violet-600" /></div>
              ) : (
                templates.map(t => {
                  const isDefault = t.id === DEFAULT_TEST_ID;
                  const users = usage.get(t.id) || [];
                  return (
                    <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-slate-800">{t.name}</h3>
                          {isDefault && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full" title="Se aplica en las vacantes que no tienen otro test elegido">
                              General · por defecto
                            </span>
                          )}
                        </div>
                        {t.description && <p className="text-sm text-slate-500 mt-0.5">{t.description}</p>}
                        <p className="text-xs text-slate-500 mt-1">
                          {t.questions.length} preguntas · {t.dimensions.length} {t.dimensions.length === 1 ? 'criterio' : 'criterios'} de evaluación
                        </p>
                        <p className="text-xs text-slate-500 mt-1 flex items-start gap-1">
                          <Briefcase className="w-3.5 h-3.5 mt-px shrink-0" />
                          <span>
                            {users.length > 0
                              ? <>Lo usa{users.length === 1 ? '' : 'n'}: <span className="font-medium text-slate-700">{users.map(v => v.title || 'Vacante sin título').join(', ')}</span></>
                              : isDefault ? 'Se aplica en las vacantes que no eligen otro test.' : 'Ninguna vacante lo usa todavía.'}
                          </span>
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <Link to={`/forms/tests/${t.id}`} className="flex items-center text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 px-3 py-1.5 rounded-lg">
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Editar
                        </Link>
                        <Link to={`/forms/tests/new?from=${encodeURIComponent(t.id)}`} className="flex items-center text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg" title="Crear un test nuevo a partir de este">
                          <Copy className="w-3.5 h-3.5 mr-1" /> Duplicar
                        </Link>
                        {!isDefault && (
                          <button onClick={() => deleteTest(t)} className="flex items-center text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg">
                            <Trash2 className="w-3.5 h-3.5 mr-1" /> Eliminar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Scorecard (Etapa 4) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <button 
            onClick={() => toggle('scorecard')}
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
          >
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold shrink-0">4</div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Scorecard de Entrevista (Etapa 4)</h2>
                <p className="text-sm text-slate-500">Guía de evaluación utilizada por el reclutador durante la entrevista presencial/virtual.</p>
              </div>
            </div>
            {expandedSection === 'scorecard' ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
          </button>
          
          {expandedSection === 'scorecard' && (
            <div className="p-6 border-t border-slate-200 bg-slate-50 space-y-6">
              {renderScorecardList('Banco de Preguntas Recomendadas', 'recommendedQuestions', 'border-blue-200')}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {renderScorecardList('Señales Positivas a Marcar', 'positiveSignals', 'border-emerald-200')}
                {renderScorecardList('Red Flags a Marcar', 'redFlags', 'border-rose-200')}
              </div>
              {renderScorecardList('Métricas de Presencia y Comunicación (1 al 5)', 'metrics', 'border-slate-300')}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
