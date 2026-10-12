import React, { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, BrainCircuit, Check, CheckCircle, FileText, Loader2, MessageSquareText, Pencil, Plus, Trash2, X, AlertTriangle } from 'lucide-react';
import Modal from './ui/Modal';
import {
  METRIC_DEFAULT_VALUE, QUESTION_MAX_LENGTH, ANSWER_MAX_LENGTH,
  buildQuestionRows, questionKey, cleanQuestion, selectQuestion, setAnswerText,
  renameAnsweredQuestion, removeAnsweredQuestion, addInterviewQuestion, addToBank, renameInBank,
  removeFromBank, answeredOnly,
  type ScorecardTemplate, type InterviewScorecardData, type QuestionRow, type BankEdit,
} from '../lib/interviewScorecard';
import { updateQuestionBank } from '../lib/questionBank';
import { firstNameOf } from '../lib/personName';

/**
 * "Evaluar Entrevista": the structured interview scorecard.
 *
 * Besides the signals, red flags and 1–5 metrics, the interviewer works the question
 * list here: ticks the questions they asked to describe what the candidate answered
 * (only ticked questions carry an answer), asks extra questions for this candidate only,
 * and edits the shared bank of suggested questions — reword, add or remove — without
 * leaving the interview. Everything described feeds the AI interview analysis.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  template: ScorecardTemplate;
  /** The shared bank changed here — the parent keeps its copy of the template in sync. */
  onBankChange: (bank: string[]) => void;
  data: InterviewScorecardData;
  onChange: React.Dispatch<React.SetStateAction<InterviewScorecardData>>;
  onSave: () => void;
  saving: boolean;
  candidateName?: string;
}

type Notice = { kind: 'ok' | 'error'; text: string };

export default function InterviewScorecardModal({ isOpen, onClose, template, onBankChange, data, onChange, onSave, saving, candidateName }: Props) {
  // Text written for a question the interviewer later un-ticked: restored if it's ticked
  // again, so an accidental click never throws away a description.
  const drafts = useRef(new Map<string, string>());
  const answerRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [saveToBank, setSaveToBank] = useState(true);
  const [bankBusy, setBankBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Fresh transient state every time it opens (the component stays mounted while the
  // recruiter moves between candidates — nothing typed for one may leak to the next).
  useEffect(() => {
    if (!isOpen) return;
    drafts.current.clear();
    setEditingKey(null);
    setNewQuestion('');
    setNotice(null);
  }, [isOpen]);

  // Success notices fade on their own; errors stay until the next action.
  useEffect(() => {
    if (notice?.kind !== 'ok') return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Put the cursor in the answer box of a question that was just ticked or added.
  useEffect(() => {
    if (!focusKey) return;
    const el = answerRefs.current.get(focusKey);
    if (el) {
      el.focus();
      setFocusKey(null);
    }
  });

  const firstName = firstNameOf(candidateName || '');
  const rows = buildQuestionRows(template.recommendedQuestions, data.answers);
  const bankRows = rows.filter(r => r.inBank);
  const extraRows = rows.filter(r => !r.inBank);
  const describedCount = answeredOnly(data.answers).length;

  const toggleSelected = (row: QuestionRow) => {
    const k = questionKey(row.question);
    if (row.selected) {
      if (row.answer.trim()) drafts.current.set(k, row.answer);
      onChange(d => ({ ...d, answers: selectQuestion(d.answers, row.question, false) }));
    } else {
      onChange(d => ({ ...d, answers: selectQuestion(d.answers, row.question, true, drafts.current.get(k) || '') }));
      setFocusKey(k);
    }
  };

  // One edit to the SHARED bank, applied in a transaction against the current bank.
  const runBankEdit = async (edit: (bank: string[]) => BankEdit, okText: string): Promise<string[] | null> => {
    setBankBusy(true);
    setNotice(null);
    try {
      const r = await updateQuestionBank(edit);
      // Sync even when refused: the bank may hold a colleague's changes by now.
      onBankChange(r.bank);
      if (r.error) {
        setNotice({ kind: 'error', text: r.error });
        return null;
      }
      setNotice({ kind: 'ok', text: okText });
      return r.bank;
    } catch (e) {
      console.error('No se pudo actualizar el banco de preguntas:', e);
      setNotice({ kind: 'error', text: 'No se pudo guardar el cambio en el banco de preguntas. Revisa tu conexión e inténtalo de nuevo.' });
      return null;
    } finally {
      setBankBusy(false);
    }
  };

  const startEdit = (row: QuestionRow) => {
    setEditingKey(questionKey(row.question));
    setEditText(row.question);
    setNotice(null);
  };

  const commitEdit = async (row: QuestionRow) => {
    const text = cleanQuestion(editText);
    if (text === row.question) { setEditingKey(null); return; }
    if (!text) { setNotice({ kind: 'error', text: 'La pregunta no puede quedar vacía.' }); return; }
    if (row.inBank) {
      // Stay in edit mode on failure so the new wording isn't lost.
      const bank = await runBankEdit(b => renameInBank(b, row.question, text), 'Pregunta actualizada en el banco.');
      if (!bank) return;
    }
    // The answer already written follows its question to the new wording.
    onChange(d => ({ ...d, answers: renameAnsweredQuestion(d.answers, row.question, text) }));
    setEditingKey(null);
  };

  const removeRow = async (row: QuestionRow) => {
    if (row.inBank) {
      if (!window.confirm('¿Quitar esta pregunta del banco de preguntas sugeridas?\n\nYa no aparecerá en las próximas entrevistas. Lo que los candidatos ya respondieron se conserva.')) return;
      // If THIS interview already has an answer for it, it stays here as an extra question.
      await runBankEdit(b => ({ bank: removeFromBank(b, row.question) }), 'Pregunta quitada del banco.');
      return;
    }
    if (row.answer.trim() && !window.confirm('¿Quitar esta pregunta y la respuesta que escribiste?')) return;
    onChange(d => ({ ...d, answers: removeAnsweredQuestion(d.answers, row.question) }));
  };

  const promoteToBank = async (row: QuestionRow) => {
    await runBankEdit(b => addToBank(b, row.question), 'Pregunta guardada en el banco para futuras entrevistas.');
  };

  const addQuestion = async () => {
    const text = cleanQuestion(newQuestion);
    if (!text || bankBusy) return;
    const k = questionKey(text);
    const existing = template.recommendedQuestions.find(b => questionKey(b) === k);
    if (existing) {
      // Already a suggested question: tick it instead of creating a near-duplicate.
      onChange(d => ({ ...d, answers: selectQuestion(d.answers, existing, true, drafts.current.get(k) || '') }));
      setNewQuestion('');
      setFocusKey(k);
      setNotice({ kind: 'ok', text: 'Esa pregunta ya estaba en el banco: quedó marcada para que describas la respuesta.' });
      return;
    }
    if (saveToBank) {
      const bank = await runBankEdit(b => addToBank(b, text), 'Pregunta añadida al banco.');
      if (!bank) return;
      const added = bank.find(b => questionKey(b) === k) || text;
      onChange(d => ({ ...d, answers: selectQuestion(d.answers, added, true) }));
    } else {
      const r = addInterviewQuestion(template.recommendedQuestions, data.answers, text);
      if ('error' in r) { setNotice({ kind: 'error', text: r.error }); return; }
      onChange(d => ({ ...d, answers: r.answers }));
    }
    setNewQuestion('');
    setFocusKey(k);
  };

  const renderRow = (row: QuestionRow, index: number) => {
    const k = questionKey(row.question);
    const isEditing = editingKey === k;
    return (
      <li key={k} className={`rounded-xl border transition-colors ${row.selected ? 'border-blue-300 bg-white shadow-sm' : 'border-blue-100 bg-white/70'}`}>
        <div className="flex items-start gap-2.5 p-2.5">
          {row.inBank ? (
            <input
              type="checkbox"
              checked={row.selected}
              onChange={() => toggleSelected(row)}
              title="Marcar para describir la respuesta del candidato"
              aria-label={`Describir la respuesta a: ${row.question}`}
              className="mt-1 rounded text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
            />
          ) : (
            <MessageSquareText className="w-4 h-4 mt-0.5 text-violet-500 shrink-0" aria-hidden="true" />
          )}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={editText}
                  maxLength={QUESTION_MAX_LENGTH}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(row); }
                    // Escape cancels the edit — it must not close the whole modal.
                    if (e.key === 'Escape') { e.stopPropagation(); setEditingKey(null); }
                  }}
                  className="flex-1 min-w-0 p-1.5 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button onClick={() => commitEdit(row)} disabled={bankBusy} title="Guardar" className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
                  {bankBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                </button>
                <button onClick={() => setEditingKey(null)} title="Cancelar" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <p
                onClick={row.inBank ? () => toggleSelected(row) : undefined}
                className={`text-sm text-slate-800 leading-snug ${row.inBank ? 'cursor-pointer' : ''}`}
              >
                {row.inBank && <span className="font-bold text-blue-400 mr-1">{index + 1}.</span>}
                {row.question}
                {!row.inBank && (
                  <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide text-violet-700 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded">
                    Solo esta entrevista
                  </span>
                )}
              </p>
            )}
          </div>
          {!isEditing && (
            <div className="flex items-center shrink-0 -mr-1">
              {!row.inBank && (
                <button onClick={() => promoteToBank(row)} disabled={bankBusy} title="Guardar en el banco para futuras entrevistas"
                  className="p-1.5 rounded-lg text-slate-300 hover:text-violet-600 hover:bg-violet-50 disabled:opacity-50">
                  <BookmarkPlus className="w-4 h-4" />
                </button>
              )}
              <button onClick={() => startEdit(row)} disabled={bankBusy} title={row.inBank ? 'Editar pregunta (en el banco)' : 'Editar pregunta'}
                className="p-1.5 rounded-lg text-slate-300 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => removeRow(row)} disabled={bankBusy} title={row.inBank ? 'Quitar del banco de preguntas' : 'Quitar de esta entrevista'}
                className="p-1.5 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
        {row.selected && (
          <div className="px-2.5 pb-2.5 sm:pl-9">
            <label className="block text-[11px] font-bold text-slate-500 mb-1">
              ¿Qué respondió {firstName || 'el candidato'}?
            </label>
            <textarea
              ref={el => { if (el) answerRefs.current.set(k, el); else answerRefs.current.delete(k); }}
              value={row.answer}
              maxLength={ANSWER_MAX_LENGTH}
              onChange={e => onChange(d => ({ ...d, answers: setAnswerText(d.answers, row.question, e.target.value) }))}
              rows={2}
              placeholder="Describe con tus palabras lo que respondió: ejemplos que dio, si fue concreto o evasivo, cómo lo dijo…"
              className="w-full p-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-y"
            />
          </div>
        )}
      </li>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="bg-slate-900/80 z-[100]">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-slide-up">
        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-display font-bold text-slate-800 flex items-center min-w-0">
            <FileText className="w-5 h-5 mr-2 text-blue-500 shrink-0" />
            <span className="truncate">Scorecard de Entrevista Estructurada{candidateName ? ` · ${candidateName}` : ''}</span>
          </h3>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Questions: tick → describe the answer; edit / add / remove the bank. */}
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
              <h4 className="font-bold text-blue-900">Preguntas de la entrevista</h4>
              <span className="text-xs font-bold text-blue-700">
                {describedCount === 1 ? '1 respuesta descrita' : `${describedCount} respuestas descritas`}
              </span>
            </div>
            <p className="text-xs text-blue-800/80 mb-3">
              Marca las preguntas que le hiciste para describir lo que respondió: solo las marcadas llevan respuesta,
              y la IA las toma en cuenta al analizar la entrevista. Con <Pencil className="w-3 h-3 inline" /> y{' '}
              <Trash2 className="w-3 h-3 inline" /> editas o quitas preguntas del banco (aplica a todas las entrevistas).
            </p>

            {bankRows.length === 0 ? (
              <p className="text-sm text-blue-700/70 bg-white/60 border border-dashed border-blue-200 rounded-xl p-3 text-center">
                El banco de preguntas está vacío. Añade la primera abajo.
              </p>
            ) : (
              <ol className="space-y-2">{bankRows.map((r, i) => renderRow(r, i))}</ol>
            )}

            {extraRows.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700 mb-2">Preguntas extra de esta entrevista</p>
                <ul className="space-y-2">{extraRows.map((r, i) => renderRow(r, i))}</ul>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-blue-100">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={newQuestion}
                  maxLength={QUESTION_MAX_LENGTH}
                  onChange={e => setNewQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addQuestion(); } }}
                  placeholder="Escribe otra pregunta que le hiciste…"
                  className="flex-1 min-w-0 p-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                />
                <button
                  onClick={addQuestion}
                  disabled={!cleanQuestion(newQuestion) || bankBusy}
                  className="flex items-center justify-center px-3 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4 mr-1" /> Añadir pregunta
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                <input type="checkbox" checked={saveToBank} onChange={e => setSaveToBank(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500" />
                Guardarla también en el banco de preguntas (aparecerá en las próximas entrevistas)
              </label>
              {(bankBusy || notice) && (
                <p className={`mt-2 text-xs font-medium flex items-center ${bankBusy ? 'text-slate-500' : notice?.kind === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {bankBusy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    : notice?.kind === 'ok' ? <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                    : <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />}
                  {bankBusy ? 'Guardando en el banco de preguntas…' : notice?.text}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-green-50 p-4 rounded-xl border border-green-100">
              <h4 className="font-bold text-green-900 mb-2">Señales Positivas a Marcar</h4>
              <div className="space-y-2 text-sm">
                {template.positiveSignals.map((signal: string) => (
                  <label key={signal} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={data.positiveSignals.includes(signal)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        onChange(d => ({
                          ...d,
                          positiveSignals: checked ? [...d.positiveSignals, signal] : d.positiveSignals.filter(s => s !== signal),
                        }));
                      }}
                      className="rounded text-green-600 focus:ring-green-500"
                    />
                    <span className="text-green-800">{signal}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="bg-rose-50 p-4 rounded-xl border border-rose-100">
              <h4 className="font-bold text-rose-900 mb-2">Red Flags a Marcar</h4>
              <div className="space-y-2 text-sm">
                {template.redFlags.map((flag: string) => (
                  <label key={flag} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={data.redFlags.includes(flag)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        onChange(d => ({
                          ...d,
                          redFlags: checked ? [...d.redFlags, flag] : d.redFlags.filter(f => f !== flag),
                        }));
                      }}
                      className="rounded text-rose-600 focus:ring-rose-500"
                    />
                    <span className="text-rose-800">{flag}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 className="font-bold text-slate-900 mb-4">Métricas de Evaluación (1.0 a 5.0)</h4>
            <div className="space-y-4">
              {template.metrics.map((metric: string) => {
                const value = data.metrics[metric] || METRIC_DEFAULT_VALUE;
                return (
                  <div key={metric}>
                    <div className="flex justify-between text-sm font-medium text-slate-700 mb-1">
                      <span>{metric}</span>
                      <span>{(value / 10).toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="10" max="50"
                      value={value}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        onChange(d => ({ ...d, metrics: { ...d.metrics, [metric]: v } }));
                      }}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-slate-400 mt-1">
                      <span>1.0</span><span>2.0</span><span>3.0</span><span>4.0</span><span>5.0</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs text-slate-500 flex items-center">
            <BrainCircuit className="w-4 h-4 mr-1.5 text-violet-500 shrink-0" />
            Al guardar, la IA analiza la entrevista con las señales, las métricas y las respuestas descritas.
          </p>
          <button
            onClick={onSave}
            disabled={saving || bankBusy}
            className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center shrink-0"
          >
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Guardar Evaluación
          </button>
        </div>
      </div>
    </Modal>
  );
}
