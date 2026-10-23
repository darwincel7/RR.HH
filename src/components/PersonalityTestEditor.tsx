import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Copy, GripVertical, Plus, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DEFAULT_PERSONALITY_TEST, defaultPersonalityTest, templateIssues, newItemId, QUESTION_TYPE_LABEL, LIKERT_OPTIONS,
  NAME_MAX_LENGTH, INSTRUCTIONS_MAX_LENGTH, DIMENSION_NAME_MAX_LENGTH, DIMENSION_TEXT_MAX_LENGTH,
  QUESTION_MAX_LENGTH, OPTION_MAX_LENGTH, MAX_OPTIONS, MAX_DIMENSIONS, MAX_QUESTIONS,
  type PersonalityTemplate, type PersonalityQuestion, type PersonalityDimension, type PersonalityQuestionType,
} from '../lib/personalityTest';

/**
 * Editor del Test de Personalidad (en Formularios): nombre, instrucciones, rasgos que mide
 * y preguntas —añadir, cambiar, reordenar arrastrando o quitar—. Se guarda con el botón
 * "Guardar Cambios" de la página. Lo que ya respondió un candidato no cambia: cada
 * postulación guarda la versión del test que se le aplicó.
 */
interface Props {
  value: PersonalityTemplate;
  onChange: (next: PersonalityTemplate) => void;
}

/** Segundos aproximados por tipo de pregunta, para estimar la duración. */
const SECONDS_PER_TYPE: Record<PersonalityQuestionType, number> = { likert: 12, choice: 15, text: 60 };

interface QuestionCardProps {
  question: PersonalityQuestion;
  index: number;
  dimensions: PersonalityDimension[];
  onUpdate: (patch: Partial<PersonalityQuestion>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

const QuestionCard: React.FC<QuestionCardProps> = ({ question: q, index, dimensions, onUpdate, onRemove, onDuplicate }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : 1,
  };
  const assigned = q.type === 'likert' && !!q.dimensionId && dimensions.some(d => d.id === q.dimensionId);
  const options = q.options || [];

  const changeType = (type: PersonalityQuestionType) => {
    if (type === 'choice' && options.length < 2) onUpdate({ type, options: ['Opción 1', 'Opción 2'] });
    else onUpdate({ type });
  };

  return (
    <div ref={setNodeRef} style={style} className="p-4 border border-slate-200 rounded-xl bg-white relative">
      <div className="flex items-start gap-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Mover la pregunta ${index + 1}`}
          className="mt-6 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 touch-none"
        >
          <GripVertical className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label htmlFor={`pq-${q.id}`} className="block text-xs font-bold text-slate-500">Pregunta {index + 1}</label>
              {q.type === 'likert' && !assigned && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700">No puntúa</span>
              )}
            </div>
            <textarea
              id={`pq-${q.id}`}
              className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 text-sm"
              rows={2}
              maxLength={QUESTION_MAX_LENGTH}
              value={q.text}
              placeholder={q.type === 'likert' ? 'Una frase en primera persona, p. ej. "Llego a tiempo a mis compromisos."' : 'Escribe la pregunta'}
              onChange={e => onUpdate({ text: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Tipo de respuesta</label>
              <select
                className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                value={q.type}
                onChange={e => changeType(e.target.value as PersonalityQuestionType)}
              >
                {(Object.keys(QUESTION_TYPE_LABEL) as PersonalityQuestionType[]).map(t => (
                  <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
            {q.type === 'likert' && (
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Rasgo al que suma</label>
                <select
                  className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                  value={assigned ? q.dimensionId : ''}
                  onChange={e => onUpdate({ dimensionId: e.target.value || undefined })}
                >
                  <option value="">Ninguno (no puntúa)</option>
                  {dimensions.map(d => <option key={d.id} value={d.id}>{d.name || '(rasgo sin nombre)'}</option>)}
                </select>
              </div>
            )}
          </div>

          {q.type === 'likert' && (
            <label
              className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none w-fit"
              title='Ejemplo: estar de acuerdo con "Me pongo de mal humor con facilidad" resta a Estabilidad emocional.'
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded text-violet-600"
                checked={!!q.reverse}
                onChange={e => onUpdate({ reverse: e.target.checked || undefined })}
              />
              <span><span className="font-bold">Frase invertida</span> (estar de acuerdo <b>resta</b> al rasgo)</span>
            </label>
          )}
          {q.type === 'text' && (
            <p className="text-[11px] text-slate-400">No puntúa: la respuesta se muestra en el perfil y la lee la IA.</p>
          )}

          {q.type === 'choice' && (
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
              <label className="block text-xs font-bold text-slate-500 mb-2">Opciones (no puntúan: se muestran en el perfil y las lee la IA)</label>
              <div className="space-y-2">
                {options.map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />
                    <input
                      type="text"
                      className="flex-1 min-w-0 p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                      value={opt}
                      maxLength={OPTION_MAX_LENGTH}
                      placeholder={`Opción ${oi + 1}`}
                      onChange={e => {
                        const next = [...options];
                        next[oi] = e.target.value;
                        onUpdate({ options: next });
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`Quitar la opción ${oi + 1}`}
                      onClick={() => onUpdate({ options: options.filter((_, i) => i !== oi) })}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {options.length < MAX_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => onUpdate({ options: [...options, ''] })}
                    className="text-sm font-bold text-violet-600 hover:text-violet-700 flex items-center mt-2 px-2 py-1 hover:bg-violet-50 rounded-md transition-colors"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Añadir opción
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 mt-5">
          <button
            type="button"
            onClick={onDuplicate}
            title="Duplicar pregunta"
            aria-label={`Duplicar la pregunta ${index + 1}`}
            className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-md"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Quitar pregunta"
            aria-label={`Quitar la pregunta ${index + 1}`}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default function PersonalityTestEditor({ value, onChange }: Props) {
  const [showDimensions, setShowDimensions] = useState(false);
  const t = value;
  const issues = templateIssues(t);
  const blocking = issues.filter(i => i.blocking);
  const warnings = issues.filter(i => !i.blocking);
  const likertCount = t.questions.filter(q => q.type === 'likert').length;
  const minutes = Math.max(1, Math.round(t.questions.reduce((s, q) => s + SECONDS_PER_TYPE[q.type], 0) / 60));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const set = (patch: Partial<PersonalityTemplate>) => onChange({ ...t, ...patch });
  const updateQuestion = (id: string, patch: Partial<PersonalityQuestion>) =>
    set({ questions: t.questions.map(q => (q.id === id ? { ...q, ...patch } : q)) });
  const updateDimension = (id: string, patch: Partial<PersonalityDimension>) =>
    set({ dimensions: t.dimensions.map(d => (d.id === id ? { ...d, ...patch } : d)) });

  const addQuestion = (type: PersonalityQuestionType) => {
    const q: PersonalityQuestion = { id: newItemId('q'), text: '', type };
    if (type === 'likert' && t.dimensions[0]) q.dimensionId = t.dimensions[0].id;
    if (type === 'choice') q.options = ['Opción 1', 'Opción 2'];
    set({ questions: [...t.questions, q] });
  };

  const duplicateQuestion = (index: number) => {
    const copy = { ...JSON.parse(JSON.stringify(t.questions[index])), id: newItemId('q') };
    const next = [...t.questions];
    next.splice(index + 1, 0, copy);
    set({ questions: next });
  };

  const removeQuestion = (index: number) => {
    const q = t.questions[index];
    if (q.text.trim() && !window.confirm(`¿Quitar la pregunta ${index + 1}?\n\n"${q.text.trim().slice(0, 140)}"`)) return;
    set({ questions: t.questions.filter((_, i) => i !== index) });
  };

  const addDimension = () => {
    set({ dimensions: [...t.dimensions, { id: newItemId('r'), name: 'Nuevo rasgo', description: '', high: '', low: '' }] });
    setShowDimensions(true);
  };

  const removeDimension = (d: PersonalityDimension) => {
    const used = t.questions.filter(q => q.type === 'likert' && q.dimensionId === d.id).length;
    const msg = used > 0
      ? `¿Quitar el rasgo "${d.name}"?\n\nSus ${used} pregunta(s) se quedan en el test, pero dejarán de puntuar hasta que les asignes otro rasgo.`
      : `¿Quitar el rasgo "${d.name}"?`;
    if (!window.confirm(msg)) return;
    set({
      dimensions: t.dimensions.filter(x => x.id !== d.id),
      questions: t.questions.map(q => (q.dimensionId === d.id ? { ...q, dimensionId: undefined } : q)),
    });
  };

  const restoreDefault = () => {
    const d = DEFAULT_PERSONALITY_TEST;
    if (!window.confirm(`¿Reemplazar este test por el test recomendado (${d.dimensions.length} rasgos, ${d.questions.length} preguntas)?\n\nSe pierden los cambios que hayas hecho aquí. Los tests que ya respondieron los candidatos no cambian.`)) return;
    onChange(defaultPersonalityTest());
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = t.questions.findIndex(q => q.id === active.id);
    const to = t.questions.findIndex(q => q.id === over.id);
    if (from < 0 || to < 0) return;
    set({ questions: arrayMove(t.questions, from, to) });
  };

  return (
    <div className="space-y-6">
      <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 text-sm text-violet-900">
        <p className="font-bold mb-1">¿Cómo se aplica?</p>
        <p>
          En persona y cuando tú decidas: en el perfil del candidato, pulsa <b>Aplicar test ahora</b> y ábrelo en esta
          pantalla, en una tableta o en el teléfono del candidato (con el QR). El resultado aparece en el perfil en cuanto
          termina. Los cambios que hagas aquí aplican a los tests que se activen después; lo ya respondido no cambia.
        </p>
      </div>

      {/* Nombre e instrucciones */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
        <div>
          <label htmlFor="pt-name" className="block text-xs font-bold text-slate-500 mb-1">Nombre del test</label>
          <input
            id="pt-name"
            type="text"
            maxLength={NAME_MAX_LENGTH}
            className="w-full p-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            value={t.name}
            onChange={e => set({ name: e.target.value })}
            placeholder="Test de Personalidad"
          />
        </div>
        <div>
          <label htmlFor="pt-instructions" className="block text-xs font-bold text-slate-500 mb-1">Instrucciones para el candidato</label>
          <textarea
            id="pt-instructions"
            rows={3}
            maxLength={INSTRUCTIONS_MAX_LENGTH}
            className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            value={t.instructions}
            onChange={e => set({ instructions: e.target.value })}
          />
        </div>
        <p className="text-xs text-slate-500">
          {t.questions.length} preguntas ({likertCount} de escala) · {t.dimensions.length} rasgos · unos {minutes} min
        </p>
      </div>

      {/* Problemas y avisos */}
      {(blocking.length > 0 || warnings.length > 0) && (
        <div className="space-y-2">
          {blocking.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-800">
              <p className="font-bold flex items-center mb-1"><XCircle className="w-4 h-4 mr-1.5" /> Corrige esto para poder guardar:</p>
              <ul className="list-disc pl-6 space-y-0.5">{blocking.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
              <p className="font-bold flex items-center mb-1"><AlertTriangle className="w-4 h-4 mr-1.5" /> Conviene revisar:</p>
              <ul className="list-disc pl-6 space-y-0.5">{warnings.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {/* Rasgos */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowDimensions(v => !v)}
          aria-expanded={showDimensions}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
        >
          <div>
            <h4 className="font-bold text-slate-800">Rasgos que mide ({t.dimensions.length})</h4>
            <p className="text-xs text-slate-500">
              {t.dimensions.map(d => d.name).filter(Boolean).join(' · ') || 'Sin rasgos: ninguna pregunta puntúa.'}
            </p>
          </div>
          {showDimensions ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </button>
        {showDimensions && (
          <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
            <p className="text-xs text-slate-500">
              Cada pregunta de escala suma al rasgo que le asignes. Los textos de "alto" y "bajo" son la guía que verá la
              entrevistadora junto al resultado (el candidato nunca ve los rasgos).
            </p>
            {t.dimensions.map(d => {
              const used = t.questions.filter(q => q.type === 'likert' && q.dimensionId === d.id).length;
              return (
                <div key={d.id} className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      aria-label="Nombre del rasgo"
                      maxLength={DIMENSION_NAME_MAX_LENGTH}
                      className="flex-1 min-w-0 p-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                      value={d.name}
                      onChange={e => updateDimension(d.id, { name: e.target.value })}
                      placeholder="Nombre del rasgo"
                    />
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md whitespace-nowrap">{used} preg.</span>
                    <button
                      type="button"
                      onClick={() => removeDimension(d)}
                      aria-label={`Quitar el rasgo ${d.name}`}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    aria-label="Qué mide"
                    maxLength={DIMENSION_TEXT_MAX_LENGTH}
                    className="w-full p-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                    value={d.description}
                    onChange={e => updateDimension(d.id, { description: e.target.value })}
                    placeholder="Qué mide (una frase)"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <textarea
                      aria-label="Si sale alto"
                      rows={2}
                      maxLength={DIMENSION_TEXT_MAX_LENGTH}
                      className="w-full p-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                      value={d.high}
                      onChange={e => updateDimension(d.id, { high: e.target.value })}
                      placeholder="Si sale ALTO significa…"
                    />
                    <textarea
                      aria-label="Si sale bajo"
                      rows={2}
                      maxLength={DIMENSION_TEXT_MAX_LENGTH}
                      className="w-full p-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                      value={d.low}
                      onChange={e => updateDimension(d.id, { low: e.target.value })}
                      placeholder="Si sale BAJO significa…"
                    />
                  </div>
                </div>
              );
            })}
            {t.dimensions.length < MAX_DIMENSIONS && (
              <button
                type="button"
                onClick={addDimension}
                className="flex items-center text-sm font-bold text-violet-600 hover:text-violet-700 bg-violet-50 px-3 py-1.5 rounded-lg"
              >
                <Plus className="w-4 h-4 mr-1" /> Añadir rasgo
              </button>
            )}
          </div>
        )}
      </div>

      {/* Preguntas */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h4 className="font-bold text-slate-800">Preguntas ({t.questions.length})</h4>
          <button
            type="button"
            onClick={restoreDefault}
            className="flex items-center text-xs font-bold text-slate-500 hover:text-slate-700 bg-white border border-slate-200 px-3 py-1.5 rounded-lg"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restaurar test recomendado
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Arrastra <GripVertical className="inline w-3.5 h-3.5 -mt-0.5" /> para reordenar. En las frases de escala el candidato elige entre:{' '}
          {LIKERT_OPTIONS.map(o => o.label).join(' · ')}.
        </p>
        <div className="space-y-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={t.questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
              {t.questions.map((q, i) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  index={i}
                  dimensions={t.dimensions}
                  onUpdate={patch => updateQuestion(q.id, patch)}
                  onRemove={() => removeQuestion(i)}
                  onDuplicate={() => duplicateQuestion(i)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {t.questions.length === 0 && <p className="text-center text-slate-400 py-4 text-sm">No hay preguntas. Añade la primera.</p>}
        </div>
        {t.questions.length < MAX_QUESTIONS && (
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="button" onClick={() => addQuestion('likert')} className="flex items-center text-sm font-bold text-violet-600 hover:text-violet-700 bg-violet-50 px-3 py-1.5 rounded-lg">
              <Plus className="w-4 h-4 mr-1" /> Frase de escala
            </button>
            <button type="button" onClick={() => addQuestion('choice')} className="flex items-center text-sm font-bold text-violet-600 hover:text-violet-700 bg-violet-50 px-3 py-1.5 rounded-lg">
              <Plus className="w-4 h-4 mr-1" /> Opción múltiple
            </button>
            <button type="button" onClick={() => addQuestion('text')} className="flex items-center text-sm font-bold text-violet-600 hover:text-violet-700 bg-violet-50 px-3 py-1.5 rounded-lg">
              <Plus className="w-4 h-4 mr-1" /> Pregunta abierta
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
