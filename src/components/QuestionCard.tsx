import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2, ChevronDown, KeyRound } from 'lucide-react';
import { QUESTION_TYPES, QUESTION_TYPE_LABELS, type TestQuestion, type TestQuestionType } from '../lib/testTemplates';

interface QuestionCardProps {
  /** Declared because this project has no @types/react (JSX wouldn't accept `key`). */
  key?: string;
  question: TestQuestion;
  index: number;
  onChange: (patch: Partial<TestQuestion>) => void;
  onRemove: () => void;
  /** Test presencial extras: the private expected answer and the section. */
  withTestFields?: boolean;
  /** Sections already used in this test, offered as suggestions. */
  sections?: string[];
}

const isChoice = (type: TestQuestionType) => type === 'multiple_choice' || type === 'multiple_selection';

/**
 * One editable question of a form or test, draggable to reorder (dnd-kit). Used by the
 * stage-2 form and by the test presencial editor; the latter adds the private expected
 * answer (only the team and the AI see it) and the section.
 */
export default function QuestionCard({ question: q, index, onChange, onRemove, withTestFields, sections = [] }: QuestionCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const [showExtras, setShowExtras] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  const changeType = (type: TestQuestionType) => {
    // A choice question with no options can't be answered: start it with two to edit.
    if (isChoice(type) && !(q.options || []).length) onChange({ type, options: ['Opción 1', 'Opción 2'] });
    else onChange({ type });
  };

  const setOption = (i: number, value: string) => {
    const options = [...(q.options || [])];
    options[i] = value;
    onChange({ options });
  };
  const removeOption = (i: number) => {
    const options = [...(q.options || [])];
    options.splice(i, 1);
    onChange({ options });
  };

  const hasExpected = !!q.expectedAnswer?.trim();
  const listId = `sections-${q.id}`;

  return (
    <div ref={setNodeRef} style={style} className="p-4 border border-slate-200 rounded-xl bg-white space-y-3 relative">
      <div className="flex justify-between items-start gap-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 touch-none"
          title="Arrastra para reordenar"
          aria-label={`Mover la pregunta ${index + 1}`}
        >
          <GripVertical className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-bold text-slate-500">
                Pregunta {index + 1}
                {withTestFields && q.block && <span className="ml-2 font-medium text-slate-400">· {q.block}</span>}
              </label>
              {withTestFields && hasExpected && (
                <span className="inline-flex items-center text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                  <KeyRound className="w-3 h-3 mr-1" /> Con respuesta esperada
                </span>
              )}
            </div>
            <textarea
              className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              rows={2}
              value={q.text}
              placeholder="Escribe la pregunta…"
              onChange={e => onChange({ text: e.target.value })}
            />
          </div>
          <div className="w-full md:w-1/2">
            <label className="block text-xs font-bold text-slate-500 mb-1">Tipo de respuesta</label>
            <select
              className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
              value={q.type}
              onChange={e => changeType(e.target.value as TestQuestionType)}
            >
              {QUESTION_TYPES.map(t => <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>)}
            </select>
          </div>

          {isChoice(q.type) && (
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
              <label className="block text-xs font-bold text-slate-500 mb-2">Opciones de respuesta</label>
              <div className="space-y-2">
                {(q.options || []).map((opt, optIndex) => (
                  <div key={optIndex} className="flex items-center gap-2">
                    <div className={`w-4 h-4 border-2 border-slate-300 flex-shrink-0 ${q.type === 'multiple_selection' ? 'rounded' : 'rounded-full'}`}></div>
                    <input
                      type="text"
                      className="flex-1 min-w-0 p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={opt}
                      onChange={e => setOption(optIndex, e.target.value)}
                      placeholder={`Opción ${optIndex + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(optIndex)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                      title="Quitar opción"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => onChange({ options: [...(q.options || []), 'Nueva opción'] })}
                  className="text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center mt-2 px-2 py-1 hover:bg-blue-50 rounded-md transition-colors"
                >
                  <Plus className="w-4 h-4 mr-1" /> Añadir Opción
                </button>
              </div>
            </div>
          )}

          {withTestFields && (
            <div>
              <button
                type="button"
                onClick={() => setShowExtras(s => !s)}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center"
                aria-expanded={showExtras}
              >
                <ChevronDown className={`w-4 h-4 mr-1 transition-transform ${showExtras ? 'rotate-180' : ''}`} />
                Respuesta esperada y sección (opcional)
              </button>
              {showExtras && (
                <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3 bg-emerald-50/50 border border-emerald-100 rounded-lg p-3">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-600 mb-1">Respuesta esperada o criterio</label>
                    <textarea
                      rows={2}
                      className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      value={q.expectedAnswer || ''}
                      onChange={e => onChange({ expectedAnswer: e.target.value })}
                      placeholder={isChoice(q.type) ? 'Ej.: la correcta es "Verifico la información antes de responder"' : 'Ej.: 745 pesos de cambio / debe mencionar desconectar la batería primero'}
                    />
                    <p className="text-[11px] text-slate-500 mt-1">Privada: el candidato nunca la ve. La IA la usa para saber si la respuesta es correcta.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Sección</label>
                    <input
                      type="text"
                      list={listId}
                      className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      value={q.block || ''}
                      onChange={e => onChange({ block: e.target.value })}
                      placeholder="Ej.: Conocimientos técnicos"
                    />
                    <datalist id={listId}>
                      {sections.map(s => <option key={s} value={s} />)}
                    </datalist>
                    <p className="text-[11px] text-slate-500 mt-1">Agrupa preguntas; le da contexto a la IA.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-md mt-1 transition-colors"
          title="Eliminar pregunta"
          aria-label={`Eliminar la pregunta ${index + 1}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
