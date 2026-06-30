import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Loader2, Save, FileText, CheckCircle, Plus, Trash2, ArrowUp, ArrowDown, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { masterTestQuestions } from '../data/testQuestions';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type QuestionType = 'text' | 'textarea' | 'multiple_choice' | 'scale' | 'multiple_selection';

interface Question {
  id: string;
  text: string;
  type: QuestionType;
  options?: string[];
}

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

interface SortableQuestionProps {
  id: string;
  question: Question;
  index: number;
  form: 'stage2' | 'test';
  total: number;
  updateQuestion: (form: 'stage2' | 'test', index: number, field: keyof Question, value: any) => void;
  removeQuestion: (form: 'stage2' | 'test', index: number) => void;
}

const SortableQuestion: React.FC<SortableQuestionProps> = ({ id, question: q, index, form, total, updateQuestion, removeQuestion }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="p-4 border border-slate-200 rounded-xl bg-white space-y-3 relative group">
      <div className="flex justify-between items-start gap-4">
        {/* Drag Handle */}
        <div {...attributes} {...listeners} className="mt-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500">
          <GripVertical className="w-5 h-5" />
        </div>
        
        <div className="flex-1 space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Pregunta {index + 1}</label>
            <textarea
              className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              rows={2}
              value={q.text}
              onChange={e => updateQuestion(form, index, 'text', e.target.value)}
            />
          </div>
          <div className="flex gap-4">
            <div className="w-full md:w-1/2">
              <label className="block text-xs font-bold text-slate-500 mb-1">Tipo de respuesta</label>
              <select
                className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                value={q.type}
                onChange={e => updateQuestion(form, index, 'type', e.target.value as QuestionType)}
              >
                <option value="text">Texto corto</option>
                <option value="textarea">Texto largo (Párrafo)</option>
                <option value="multiple_choice">Opción múltiple</option>
                <option value="multiple_selection">Selección múltiple (Casillas)</option>
                <option value="scale">Escala (1 al 5)</option>
              </select>
            </div>
          </div>

          {(q.type === 'multiple_choice' || q.type === 'multiple_selection') && (
            <div className="mt-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
              <label className="block text-xs font-bold text-slate-500 mb-2">Opciones de Respuesta</label>
              <div className="space-y-2">
                {(q.options || []).map((opt, optIndex) => (
                  <div key={optIndex} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0"></div>
                    <input
                      type="text"
                      className="flex-1 p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={opt}
                      onChange={e => {
                        const newOpts = [...(q.options || [])];
                        newOpts[optIndex] = e.target.value;
                        updateQuestion(form, index, 'options', newOpts);
                      }}
                      placeholder={`Opción ${optIndex + 1}`}
                    />
                    <button
                      onClick={() => {
                        const newOpts = [...(q.options || [])];
                        newOpts.splice(optIndex, 1);
                        updateQuestion(form, index, 'options', newOpts);
                      }}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const newOpts = [...(q.options || []), 'Nueva opción'];
                    updateQuestion(form, index, 'options', newOpts);
                  }}
                  className="text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center mt-2 px-2 py-1 hover:bg-blue-50 rounded-md transition-colors"
                >
                  <Plus className="w-4 h-4 mr-1" /> Añadir Opción
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => removeQuestion(form, index)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md mt-2">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FormsSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'stage2' | 'test' | 'scorecard' | null>(null);

  const [stage2Questions, setStage2Questions] = useState<Question[]>([]);
  const [testQuestions, setTestQuestions] = useState<Question[]>([]);
  const [scorecard, setScorecard] = useState<ScorecardSettings>(defaultScorecard);

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
            setStage2Questions([
              { id: 'q1', text: 'Cuéntanos más sobre tu experiencia previa relevante para este puesto.', type: 'textarea' },
              { id: 'q2', text: 'Describe una situación de conflicto en el trabajo y cómo la resolviste.', type: 'textarea' },
              { id: 'q3', text: 'Expectativa Salarial (Mensual)', type: 'text' },
              { id: 'q4', text: 'Disponibilidad para iniciar', type: 'text' }
            ]);
          }

          // Handle Test Form
          if (data.testQuestions && Array.isArray(data.testQuestions) && !data.testQuestions.some((q: any) => q.id === 'C1')) {
            setTestQuestions(data.testQuestions);
          } else {
            // Force load the new 62 question test from the database/master list since it's updated
            const mappedQuestions = masterTestQuestions.map(q => ({
              id: q.id,
              text: q.text,
              type: q.type,
              options: q.options || undefined
            }));
            setTestQuestions(mappedQuestions);
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
          setStage2Questions([
            { id: 'q1', text: 'Cuéntanos más sobre tu experiencia previa relevante para este puesto.', type: 'textarea' },
            { id: 'q2', text: 'Describe una situación de conflicto en el trabajo y cómo la resolviste.', type: 'textarea' },
            { id: 'q3', text: 'Expectativa Salarial (Mensual)', type: 'text' },
            { id: 'q4', text: 'Disponibilidad para iniciar', type: 'text' }
          ]);
          const mappedQuestions = masterTestQuestions.map(q => ({
            id: q.id,
            text: q.text,
            type: q.type,
            options: q.options || undefined
          }));
          setTestQuestions(mappedQuestions);
        }
      } catch (error) {
        console.error("Error fetching form settings:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      // Create a clean payload with no undefined values to prevent Firestore crashes
      const payload = JSON.parse(JSON.stringify({
        stage2Questions,
        testQuestions,
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

  const addQuestion = (form: 'stage2' | 'test') => {
    const newQ: Question = { id: generateId(), text: 'Nueva pregunta', type: 'text' };
    if (form === 'stage2') {
      setStage2Questions([...stage2Questions, newQ]);
    } else {
      setTestQuestions([...testQuestions, newQ]);
    }
  };

  const removeQuestion = (form: 'stage2' | 'test', index: number) => {
    if (form === 'stage2') {
      const newQs = [...stage2Questions];
      newQs.splice(index, 1);
      setStage2Questions(newQs);
    } else {
      const newQs = [...testQuestions];
      newQs.splice(index, 1);
      setTestQuestions(newQs);
    }
  };

  const updateQuestion = (form: 'stage2' | 'test', index: number, field: keyof Question, value: any) => {
    const qs = form === 'stage2' ? [...stage2Questions] : [...testQuestions];
    qs[index] = { ...qs[index], [field]: value };
    if (form === 'stage2') setStage2Questions(qs);
    else setTestQuestions(qs);
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

  const handleDragEnd = (event: DragEndEvent, form: 'stage2' | 'test') => {
    const { active, over } = event;
    if (!over) return;

    if (active.id !== over.id) {
      const items = form === 'stage2' ? [...stage2Questions] : [...testQuestions];
      const oldIndex = items.findIndex(item => item.id === active.id);
      const newIndex = items.findIndex(item => item.id === over.id);
      
      const newItems = arrayMove(items, oldIndex, newIndex);
      if (form === 'stage2') {
        setStage2Questions(newItems);
      } else {
        setTestQuestions(newItems);
      }
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

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Formularios y Evaluaciones</h1>
          <p className="text-slate-500">Configura las preguntas y evaluaciones de cada etapa del proceso.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-400"
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
            onClick={() => setExpandedSection(expandedSection === 'stage2' ? null : 'stage2')}
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
          >
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">2</div>
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
                <button onClick={() => addQuestion('stage2')} className="flex items-center text-sm font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg">
                  <Plus className="w-4 h-4 mr-1" /> Añadir Pregunta
                </button>
              </div>
              <div className="space-y-3">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(e, 'stage2')}>
                  <SortableContext items={stage2Questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
                    {stage2Questions.map((q, i) => (
                      <SortableQuestion
                        key={q.id}
                        id={q.id}
                        question={q}
                        index={i}
                        form="stage2"
                        total={stage2Questions.length}
                        updateQuestion={updateQuestion}
                        removeQuestion={removeQuestion}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
                {stage2Questions.length === 0 && <p className="text-center text-slate-400 py-4 text-sm">No hay preguntas configuradas.</p>}
              </div>
            </div>
          )}
        </div>

        {/* Test Form (Etapa 3) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <button 
            onClick={() => setExpandedSection(expandedSection === 'test' ? null : 'test')}
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
          >
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center font-bold">3</div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Test de Conocimientos (Etapa 3)</h2>
                <p className="text-sm text-slate-500">Enviado automáticamente al mover a "Test". Contiene {testQuestions.length} preguntas.</p>
              </div>
            </div>
            {expandedSection === 'test' ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
          </button>
          
          {expandedSection === 'test' && (
            <div className="p-4 border-t border-slate-200 bg-slate-50">
              <div className="flex justify-end mb-4">
                <button onClick={() => addQuestion('test')} className="flex items-center text-sm font-bold text-violet-600 hover:text-violet-700 bg-violet-50 px-3 py-1.5 rounded-lg">
                  <Plus className="w-4 h-4 mr-1" /> Añadir Pregunta
                </button>
              </div>
              <div className="space-y-3">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(e, 'test')}>
                  <SortableContext items={testQuestions.map(q => q.id)} strategy={verticalListSortingStrategy}>
                    {testQuestions.map((q, i) => (
                      <SortableQuestion
                        key={q.id}
                        id={q.id}
                        question={q}
                        index={i}
                        form="test"
                        total={testQuestions.length}
                        updateQuestion={updateQuestion}
                        removeQuestion={removeQuestion}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
                {testQuestions.length === 0 && <p className="text-center text-slate-400 py-4 text-sm">No hay preguntas configuradas.</p>}
              </div>
            </div>
          )}
        </div>

        {/* Scorecard (Etapa 4) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <button 
            onClick={() => setExpandedSection(expandedSection === 'scorecard' ? null : 'scorecard')}
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
          >
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold">4</div>
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
