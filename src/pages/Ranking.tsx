import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { collection, query, where, getDocs, doc, updateDoc, getDoc, serverTimestamp, documentId } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  Trophy, CheckCircle, XCircle, GitCompare, X, ChevronDown, ChevronRight, ArrowDownWideNarrow,
  ArrowUpNarrowWide, Search, FileText, ThumbsUp, AlertTriangle, Download, Filter, Medal, UserCheck, UserX,
} from 'lucide-react';

import { sendWhatsAppAutomation } from '../lib/whatsapp';
import Modal from '../components/ui/Modal';
import CandidateAvatar from '../components/CandidateAvatar';
import CvPreviewModal, { type CvPreview } from '../components/CvPreviewModal';
import { HistoryNavButtons } from '../components/layout/TopBar';
import { PIPELINE_STAGES } from '../constants/stages';
import { useParticipantStatuses } from '../lib/participantStatus';
import { attendanceOf } from '../lib/interviewAttendance';
import { smartMatch } from '../lib/smartSearch';
import { useScrollMemory } from '../lib/useScrollMemory';
import {
  SCORE_COLUMNS, TEST_PARTS, FORM_PARTS, IN_PROCESS_STAGES, scoreValue, sortOptions, findSortOption,
  sortRanking, directionLabels, defaultDirection, prosAndCons, personalityTraits, daysInStage,
  parseStages, formatStages, type RankingRow, type Signal,
} from '../lib/ranking';

/** Score pill colors: the same bands everywhere on the page. */
const band = (v: number) => (v >= 75 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  : v >= 50 ? 'bg-amber-50 text-amber-700 ring-amber-200'
  : 'bg-rose-50 text-rose-700 ring-rose-200');
const barColor = (v: number) => (v >= 75 ? 'bg-emerald-500' : v >= 50 ? 'bg-amber-400' : 'bg-rose-400');

const STAGE_BADGE = (stage: string) => (stage === 'Contratado' ? 'bg-emerald-100 text-emerald-800'
  : stage === 'Descartado' ? 'bg-rose-100 text-rose-800'
  : stage === 'Banco de talento' ? 'bg-slate-100 text-slate-700'
  : 'bg-blue-50 text-blue-700');

const MIN_OPTIONS = [0, 50, 60, 70, 80, 90];

function ScoreCell({ value, title, pending }: { value: number | null; title?: string; pending?: boolean }) {
  if (value === null) {
    return <span className="text-slate-300 text-xs" title={pending ? 'Evaluándose con IA…' : 'Sin resultado todavía'}>{pending ? '…' : '—'}</span>;
  }
  return (
    <span title={title} className={`inline-flex min-w-[2.5rem] justify-center px-1.5 py-0.5 rounded-md text-xs font-black ring-1 ${band(value)}`}>
      {Math.round(value)}
    </span>
  );
}

function SignalList({ items, kind }: { items: Signal[]; kind: 'pro' | 'con' }) {
  if (items.length === 0) return <p className="text-xs text-slate-400">Nada registrado todavía.</p>;
  return (
    <ul className="space-y-1">
      {items.map((s, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700">
          {kind === 'pro'
            ? <ThumbsUp className="w-3 h-3 mt-0.5 text-emerald-500 shrink-0" />
            : <AlertTriangle className="w-3 h-3 mt-0.5 text-rose-500 shrink-0" />}
          <span>{s.text} <span className="text-[10px] text-slate-400">· {s.source}</span></span>
        </li>
      ))}
    </ul>
  );
}

function PartBars({ title, parts }: { title: string; parts: Array<{ label: string; value: number | null }> }) {
  const shown = parts.filter(p => p.value !== null) as Array<{ label: string; value: number }>;
  if (shown.length === 0) return null;
  return (
    <div>
      <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{title}</h5>
      <div className="space-y-1">
        {shown.map(p => (
          <div key={p.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-40 truncate text-slate-600" title={p.label}>{p.label}</span>
            <span className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <span className={`block h-full rounded-full ${barColor(p.value)}`} style={{ width: `${p.value}%` }} />
            </span>
            <span className="w-7 text-right font-bold text-slate-700">{Math.round(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Ranking() {
  const { vacancyId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [vacancies, setVacancies] = useState<Record<string, any>>({});
  const [apps, setApps] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const participants = useParticipantStatuses({ all: true });
  // Back from a profile = same spot in the list, same filters (they live in the URL).
  useScrollMemory(!loading);

  const [decisionModal, setDecisionModal] = useState<{ isOpen: boolean; candidateId: string; appId: string; type: 'Contratado' | 'Descartado' | null }>({ isOpen: false, candidateId: '', appId: '', type: null });
  const [decisionReason, setDecisionReason] = useState('');
  const [selectedForComparison, setSelectedForComparison] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const [cvPreview, setCvPreview] = useState<CvPreview | null>(null);
  const [stagesOpen, setStagesOpen] = useState(false);
  const stagesRef = useRef<HTMLDivElement>(null);

  // ---- What's on screen lives in the URL: shareable, and "Atrás" brings it back. ----
  const stages = parseStages(params.get('etapas'));
  const q = params.get('q') || '';
  const minScore = Number(params.get('min')) || 0;
  const hideMissing = params.get('solo') === '1';
  const expanded = new Set((params.get('abiertos') || '').split(',').filter(Boolean));
  const update = (changes: Record<string, string | null>) => setParams(prev => {
    const next = new URLSearchParams(prev);
    Object.entries(changes).forEach(([k, v]) => { if (v) next.set(k, v); else next.delete(k); });
    return next;
  }, { replace: true });
  const toggleExpanded = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    update({ abiertos: [...next].join(',') || null });
  };

  useEffect(() => {
    if (!stagesOpen) return;
    const close = (e: MouseEvent) => { if (!stagesRef.current?.contains(e.target as Node)) setStagesOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [stagesOpen]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [vacSnap, appSnap] = await Promise.all([
          getDocs(collection(db, 'vacancies')),
          getDocs(vacancyId
            ? query(collection(db, 'applications'), where('vacancyId', '==', vacancyId))
            : collection(db, 'applications')),
        ]);
        const vacs: Record<string, any> = {};
        vacSnap.docs.forEach(d => { vacs[d.id] = d.data(); });
        const loadedApps = appSnap.docs.map(d => ({ ...d.data(), id: d.id })) as any[];

        // Candidate docs: CV extraction (pros/contras), photo, phone. One vacancy reads
        // only its people (30 per query, Firestore's `in` limit); all vacancies, everyone.
        const cands: Record<string, any> = {};
        if (vacancyId) {
          const ids = Array.from(new Set(loadedApps.map(a => a.candidateId).filter(Boolean))) as string[];
          const chunks: string[][] = [];
          for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
          const snaps = await Promise.all(chunks.map(c => getDocs(query(collection(db, 'candidates'), where(documentId(), 'in', c)))));
          snaps.forEach(s => s.docs.forEach(d => { cands[d.id] = d.data(); }));
        } else {
          (await getDocs(collection(db, 'candidates'))).docs.forEach(d => { cands[d.id] = d.data(); });
        }
        if (cancelled) return;
        setVacancies(vacs);
        setApps(loadedApps);
        setCandidates(cands);
      } catch (e) {
        console.error('No se pudo cargar el ranking:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vacancyId]);

  const rows: RankingRow[] = useMemo(() => apps.map(app => ({
    app,
    candidate: candidates[app.candidateId],
    participantStatus: participants.get(app.id)?.status,
  })), [apps, candidates, participants]);

  const options = useMemo(() => sortOptions(rows), [rows]);
  const option = findSortOption(options, params.get('orden') || 'total');
  const dirParam = params.get('dir');
  const dir: 'asc' | 'desc' = dirParam === 'asc' || dirParam === 'desc' ? dirParam : defaultDirection(option.kind);
  const dirLabels = directionLabels(option.kind);
  const isScoreSort = option.kind === 'score';
  // Ordered by a detail (a trait, a test section, days waiting…): its value gets its own
  // highlighted column next to the total, so the order can be read, not just trusted.
  const extraCol = SCORE_COLUMNS.some(c => c.key === option.key) || option.kind === 'name' || option.kind === 'stage' ? null : option;

  const stageCounts = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => m.set(r.app.stage, (m.get(r.app.stage) || 0) + 1));
    return m;
  }, [rows]);

  const signals = useMemo(() => new Map(rows.map(r => [r.app.id, prosAndCons(r)])), [rows]);

  const { ranked, missing } = useMemo(() => {
    const inScope = rows.filter(r => {
      if (stages.length > 0 && !stages.includes(r.app.stage)) return false;
      if (!q.trim()) return true;
      const s = signals.get(r.app.id);
      return smartMatch([
        { label: 'Nombre', value: r.app.candidateName },
        { label: 'Teléfono', value: r.candidate?.phone, kind: 'phone' },
        { label: 'Correo', value: r.candidate?.email },
        { label: 'Vacante', value: vacancies[r.app.vacancyId]?.title || r.app.vacancyTitle },
        { label: 'Pros y contras', value: [...(s?.pros || []), ...(s?.cons || [])].map(x => x.text) },
      ], q).matched;
    });
    const sorted = sortRanking(inScope, option.key, dir);
    // The minimum applies to what the list is ordered by (the total for name/date orders).
    const minKey = isScoreSort ? option.key : 'total';
    const passes = (r: RankingRow) => minScore <= 0 || (scoreValue(minKey, r) ?? -1) >= minScore;
    return {
      ranked: sorted.ranked.filter(passes),
      missing: hideMissing || minScore > 0 ? [] : sorted.missing,
    };
  }, [rows, signals, vacancies, stages.join('|'), q, option.key, dir, minScore, hideMissing, isScoreSort]);

  const allShown = [...ranked, ...missing];
  const traitsInView = new Map<string, string>();
  allShown.forEach(r => personalityTraits(r.app).forEach(t => { if (!traitsInView.has(t.id)) traitsInView.set(t.id, t.name); }));

  const sortBy = (key: string) => {
    const opt = findSortOption(options, key);
    // Same column again = flip the direction; a new one starts in its natural direction.
    if (opt.key === option.key) update({ orden: key, dir: dir === 'desc' ? 'asc' : 'desc' });
    else update({ orden: key, dir: defaultDirection(opt.kind) });
  };

  const handleDecision = async () => {
    if (!decisionModal.type || !decisionReason) return;
    try {
      await updateDoc(doc(db, 'applications', decisionModal.appId), {
        stage: decisionModal.type,
        decisionReason,
        decisionDate: new Date().toISOString(),
        lastStageUpdate: serverTimestamp(),
      });
      setApps(prev => prev.map(c => c.id === decisionModal.appId ? { ...c, stage: decisionModal.type, decisionReason } : c));

      let waFailed = false;
      const candSnap = await getDoc(doc(db, 'candidates', decisionModal.candidateId));
      if (candSnap.exists()) {
        const app = apps.find(a => a.id === decisionModal.appId);
        const r = await sendWhatsAppAutomation(candSnap.data().phone, decisionModal.type!, {
          nombre: candSnap.data().fullName || candSnap.data().name,
          vacante: vacancies[app?.vacancyId]?.title || app?.vacancyTitle,
          email: candSnap.data().email,
        });
        waFailed = r.status === 'failed';
      }
      setDecisionModal({ isOpen: false, candidateId: '', appId: '', type: null });
      setDecisionReason('');
      // The decision was already saved; only warn if the WhatsApp notice failed.
      if (waFailed) alert('La decisión se guardó, pero NO se pudo enviar el WhatsApp. Revisa la conexión de WhatsApp en Configuración.');
    } catch (error) {
      console.error('Error saving decision:', error);
      alert('Error al guardar la decisión');
    }
  };

  const toggleComparison = (appId: string) => {
    setSelectedForComparison(prev => {
      if (prev.includes(appId)) return prev.filter(id => id !== appId);
      if (prev.length >= 3) {
        alert('Puedes comparar un máximo de 3 candidatos a la vez.');
        return prev;
      }
      return [...prev, appId];
    });
  };

  const vacancyTitle = (app: any) => vacancies[app.vacancyId]?.title || app.vacancyTitle || '';
  const cvOf = (r: RankingRow) => (r.app.cvUrl
    ? { url: r.app.cvUrl, fileType: r.app.cvFileType }
    : { url: r.candidate?.cvUrl, fileType: r.candidate?.cvFileType });

  const exportToCSV = () => {
    // Proper CSV escaping: wrap in quotes and double any embedded quote.
    const cell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const score = (key: string, r: RankingRow) => { const v = scoreValue(key, r); return v === null ? '' : Math.round(v); };
    const headers = ['Posición', 'Candidato', 'Vacante', 'Etapa', ...SCORE_COLUMNS.map(c => c.label), 'Pros', 'Contras', 'Motivo de decisión'];
    const lines = allShown.map((r, i) => {
      const s = signals.get(r.app.id);
      return [
        i < ranked.length ? i + 1 : '',
        cell(r.app.candidateName || 'Sin nombre'),
        cell(vacancyTitle(r.app)),
        cell(r.app.stage),
        ...SCORE_COLUMNS.map(c => score(c.key, r)),
        cell((s?.pros || []).map(x => x.text).join(' | ')),
        cell((s?.cons || []).map(x => x.text).join(' | ')),
        cell(r.app.decisionReason || ''),
      ].join(',');
    });
    const blob = new Blob(['﻿' + [headers.map(cell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ranking_${vacancyId ? vacancies[vacancyId]?.title || 'vacante' : 'todas'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const stageSummary = stages.length === 0 ? 'Todas las etapas'
    : stages.length === 1 ? stages[0]
    : formatStages(stages) === formatStages(IN_PROCESS_STAGES) ? 'En proceso'
    : `${stages.length} etapas`;
  const toggleStage = (s: string) => {
    const next = stages.includes(s) ? stages.filter(x => x !== s) : [...stages, s];
    update({ etapas: formatStages(next) || null });
  };

  const showVacancyColumn = !vacancyId;
  // candidato, pros/contras (corto y largo) · puntajes (+ el del orden) · personalidad, decisión
  const colCount = 3 + SCORE_COLUMNS.length + (extraCol ? 1 : 0) + 2;
  const comparisonRows = allShown.filter(r => selectedForComparison.includes(r.app.id));
  const ctl = 'h-9 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 shadow-sm focus:ring-2 focus:ring-violet-500 outline-none';

  const renderRow = (r: RankingRow, position: number | null) => {
    const app = r.app;
    const s = signals.get(app.id) || { pros: [], cons: [] };
    const isOpen = expanded.has(app.id);
    const attendance = attendanceOf(app, r.participantStatus);
    const days = daysInStage(app);
    const traits = personalityTraits(app);
    const decided = app.stage === 'Contratado' || app.stage === 'Descartado';
    const selected = selectedForComparison.includes(app.id);
    const interviewTitle = [
      scoreValue('interview:manual', r) !== null ? `Entrevistador: ${app.interviewObservation.score}/5` : '',
      scoreValue('interview:ai', r) !== null ? `Análisis IA: ${app.interviewAiEvaluation.score}` : '',
    ].filter(Boolean).join(' · ');
    const cv = cvOf(r);
    const arrival = app.submittedAt?.toDate ? app.submittedAt.toDate() : (app.submittedAt ? new Date(app.submittedAt) : null);
    const evaluated = SCORE_COLUMNS.filter(c => c.key !== 'total' && scoreValue(c.key, r) !== null).map(c => c.name);
    const decisionButtons = !decided && (
      <span className="inline-flex gap-1">
        <button
          onClick={() => setDecisionModal({ isOpen: true, candidateId: app.candidateId, appId: app.id, type: 'Contratado' })}
          title="Contratar"
          className="p-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg"
        >
          <CheckCircle className="w-4 h-4" />
        </button>
        <button
          onClick={() => setDecisionModal({ isOpen: true, candidateId: app.candidateId, appId: app.id, type: 'Descartado' })}
          title="Descartar"
          className="p-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </span>
    );

    return (
      <React.Fragment key={app.id}>
        <tr
          onClick={() => toggleExpanded(app.id)}
          className={`group cursor-pointer ${selected ? 'bg-indigo-50/60' : isOpen ? 'bg-violet-50/40' : 'hover:bg-slate-50'}`}
        >
          {/* Candidate: sticky on the left when the table scrolls sideways. */}
          <td className={`sticky left-0 z-10 border-b border-slate-100 px-2 py-2 ${selected ? 'bg-indigo-50' : isOpen ? 'bg-violet-50' : 'bg-white group-hover:bg-slate-50'}`}>
            <div className="flex items-center gap-2 min-w-[13rem] max-w-[16rem]">
              <input
                type="checkbox"
                checked={selected}
                onClick={e => e.stopPropagation()}
                onChange={() => toggleComparison(app.id)}
                title="Marcar para comparar (hasta 3)"
                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer shrink-0"
              />
              <span className="w-6 text-center text-xs font-black text-slate-400 shrink-0">
                {position !== null && isScoreSort && dir === 'desc' && position <= 3
                  ? <Medal className={`w-4 h-4 mx-auto ${position === 1 ? 'text-amber-500' : position === 2 ? 'text-slate-400' : 'text-orange-700'}`} />
                  : position ?? '·'}
              </span>
              {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-violet-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 shrink-0" />}
              <CandidateAvatar photoUrl={r.candidate?.photoUrl} name={app.candidateName} size={32} />
              <div className="min-w-0">
                <Link
                  to={`/candidates/${app.candidateId}`}
                  onClick={e => e.stopPropagation()}
                  className="block truncate text-sm font-bold text-slate-800 hover:text-violet-700"
                  title="Abrir el perfil"
                >
                  {app.candidateName || 'Sin nombre'}
                </Link>
                <div className="flex items-center gap-1 mt-0.5 min-w-0">
                  <span className={`px-1.5 py-px rounded text-[10px] font-bold truncate ${STAGE_BADGE(app.stage)}`} title={`Etapa: ${app.stage}${days !== null ? ` · ${days} día(s) aquí` : ''}`}>
                    {app.stage}
                  </span>
                  {attendance === 'attended' && <span title="Asistió a la entrevista"><UserCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" /></span>}
                  {attendance === 'no_show' && <span title="No vino a la entrevista"><UserX className="w-3.5 h-3.5 text-rose-500 shrink-0" /></span>}
                  {showVacancyColumn && <span className="text-[10px] text-slate-400 truncate" title={vacancyTitle(app)}>· {vacancyTitle(app)}</span>}
                </div>
              </div>
            </div>
          </td>

          {/* Pros / contras: one line each where it fits, just the counts where it doesn't
              (the scores must stay in view); the full lists open with the row. */}
          <td className="@5xl:hidden border-b border-slate-100 px-1.5 py-2 text-[11px] font-bold"
            title={[...s.pros.map(x => `+ ${x.text}`), ...s.cons.map(x => `− ${x.text}`)].join('\n') || 'Sin pros ni contras todavía'}>
            <span className="flex items-center gap-1 text-emerald-700"><ThumbsUp className="w-3 h-3" />{s.pros.length}</span>
            <span className="flex items-center gap-1 text-rose-700"><AlertTriangle className="w-3 h-3" />{s.cons.length}</span>
          </td>
          <td className="hidden @5xl:table-cell border-b border-slate-100 px-2 py-2">
            <div className="min-w-[14rem] max-w-[24rem] space-y-0.5">
              <p className="flex items-center gap-1 text-[11px] text-emerald-800 min-w-0" title={s.pros.map(x => `+ ${x.text}`).join('\n')}>
                <ThumbsUp className="w-3 h-3 text-emerald-500 shrink-0" />
                <span className="truncate">{s.pros.length ? s.pros.slice(0, 3).map(x => x.text).join(' · ') : <span className="text-slate-300">—</span>}</span>
                {s.pros.length > 3 && <span className="shrink-0 text-[10px] font-bold text-emerald-600">+{s.pros.length - 3}</span>}
              </p>
              <p className="flex items-center gap-1 text-[11px] text-rose-800 min-w-0" title={s.cons.map(x => `− ${x.text}`).join('\n')}>
                <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                <span className="truncate">{s.cons.length ? s.cons.slice(0, 3).map(x => x.text).join(' · ') : <span className="text-slate-300">—</span>}</span>
                {s.cons.length > 3 && <span className="shrink-0 text-[10px] font-bold text-rose-600">+{s.cons.length - 3}</span>}
              </p>
            </div>
          </td>

          {/* Scores, one aligned column each, on the right. */}
          {SCORE_COLUMNS.map(c => (
            <React.Fragment key={c.key}>
            {c.key === 'total' && extraCol && (
              <td className="border-b border-l border-slate-100 px-1 py-2 text-center bg-violet-50/50 text-xs font-bold text-slate-700">
                {extraCol.kind === 'score' ? <ScoreCell value={scoreValue(extraCol.key, r)} />
                  : extraCol.kind === 'days' ? (days !== null ? `${days} d` : '—')
                  : (arrival ? arrival.toLocaleDateString('es-DO', { day: 'numeric', month: 'short' }) : '—')}
              </td>
            )}
            <td className={`border-b border-slate-100 px-1 py-2 text-center ${c.key === option.key ? 'bg-violet-50/50' : ''} ${c.key === 'total' ? 'border-l border-slate-100' : ''}`}>
              <ScoreCell
                value={scoreValue(c.key, r)}
                pending={(c.key === 'test' && app.testResults?.status === 'pending_ai') || (c.key === 'form' && app.stage2ScoringStatus === 'pending')}
                title={c.key === 'interview' ? interviewTitle : c.key === 'cv' ? `CV: ${app.scoreSummary}/5`
                  : c.key === 'total' && evaluated.length ? `Promedio de ${evaluated.join(', ')}` : undefined}
              />
              {/* A total from the CV alone isn't the same as one from four evaluations. */}
              {c.key === 'total' && evaluated.length > 0 && (
                <span className="block mt-0.5 text-[9px] font-bold text-slate-400" title={`Promedio de ${evaluated.join(', ')}`}>
                  {evaluated.length} de 4
                </span>
              )}
            </td>
            </React.Fragment>
          ))}

          {/* Personality: one mini bar per trait (no single "good" number exists). */}
          <td className="border-b border-slate-100 px-1.5 py-2 text-center">
            {traits.length > 0 ? (
              <span className="inline-flex items-end gap-0.5 h-6" title={traits.map(t => `${t.name}: ${Math.round(t.score)}`).join('\n')}>
                {traits.map(t => (
                  <span key={t.id} className="w-1.5 bg-slate-100 rounded-sm h-full flex items-end">
                    <span className={`block w-full rounded-sm ${t.score >= 70 ? 'bg-violet-500' : t.score >= 40 ? 'bg-violet-300' : 'bg-slate-300'}`} style={{ height: `${Math.max(8, t.score)}%` }} />
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-slate-300 text-xs" title={app.personalityTest?.status === 'open' ? 'Test de personalidad pendiente' : 'Sin test de personalidad'}>
                {app.personalityTest?.status === 'open' ? '…' : '—'}
              </span>
            )}
          </td>

          {/* Narrow: these move into the opened row, so the scores keep the room. */}
          <td className="hidden @4xl:table-cell border-b border-slate-100 px-2 py-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
            {!decided ? (
              <span className="opacity-60 group-hover:opacity-100 transition-opacity">{decisionButtons}</span>
            ) : (
              <span className="text-[10px] text-slate-400" title={app.decisionReason ? `Motivo: ${app.decisionReason}` : 'Decisión tomada'}>
                {app.decisionReason ? 'Ver motivo' : 'Decidido'}
              </span>
            )}
          </td>
        </tr>

        {isOpen && (
          <tr className="bg-violet-50/30">
            <td colSpan={colCount} className="border-b border-violet-100 p-0">
              {/* Pinned to the visible width while the table scrolls sideways. */}
              <div className="sticky left-0 w-[calc(100cqw-2px)] max-w-full p-3 lg:p-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3" onClick={e => e.stopPropagation()}>
                <div className="space-y-3">
                  <div>
                    <h5 className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">Pros ({s.pros.length})</h5>
                    <SignalList items={s.pros} kind="pro" />
                  </div>
                  <div>
                    <h5 className="text-[10px] font-bold text-rose-600 uppercase tracking-wider mb-1.5">Contras ({s.cons.length})</h5>
                    <SignalList items={s.cons} kind="con" />
                  </div>
                </div>
                <div className="space-y-3">
                  <PartBars title="Test presencial" parts={TEST_PARTS.map(([f, label]) => ({ label, value: scoreValue(`test:${f}`, r) }))} />
                  <PartBars title="Formulario etapa 2" parts={FORM_PARTS.map(([f, label]) => ({ label, value: scoreValue(`form:${f}`, r) }))} />
                  <PartBars title="Entrevista" parts={[
                    { label: 'Nota del entrevistador', value: scoreValue('interview:manual', r) },
                    { label: 'Análisis IA', value: scoreValue('interview:ai', r) },
                    ...Object.keys(app.interviewScorecard?.metrics || {}).map(k => ({ label: k, value: scoreValue(`card:${k}`, r) })),
                  ]} />
                  <PartBars title="Personalidad" parts={traits.map(t => ({ label: t.name, value: t.score }))} />
                </div>
                <div className="space-y-2 text-xs text-slate-600">
                  {[
                    ['Entrevista (IA)', app.interviewAiEvaluation?.summary],
                    ['Notas del entrevistador', app.interviewObservation?.notes],
                    ['Test', app.testResults?.aiFeedback],
                    ['Formulario', app.stage2Scoring?.summary_for_recruiter],
                    ['Personalidad', app.personalityTest?.aiInterpretation?.role_fit || app.personalityTest?.aiInterpretation?.summary],
                    ['CV', r.candidate?.aiExtraction?.relevant_experience_summary || r.candidate?.aiExtraction?.justification],
                  ].filter(([, t]) => typeof t === 'string' && t.trim()).map(([label, t]) => (
                    <p key={label as string}><span className="font-bold text-slate-700">{label}:</span> {t as string}</p>
                  ))}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link to={`/candidates/${app.candidateId}`} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-700 hover:bg-slate-50">
                      Abrir perfil
                    </Link>
                    {cv.url && (
                      <button
                        onClick={() => setCvPreview({ url: cv.url, name: app.candidateName || 'Candidato', fileType: cv.fileType })}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700"
                      >
                        <FileText className="w-3.5 h-3.5" /> Ver CV
                      </button>
                    )}
                    {decisionButtons && <span className="@4xl:hidden">{decisionButtons}</span>}
                  </div>
                </div>
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  const vacancyOptions = (Object.entries(vacancies) as Array<[string, any]>).sort((a, b) => String(a[1].title || '').localeCompare(String(b[1].title || ''), 'es'));

  return (
    <div className="@container flex-1 min-h-0 flex flex-col animate-fade-in">
      {/* Header: one row, like the Embudo. */}
      <div className="mb-2 flex flex-wrap @3xl:flex-nowrap items-center gap-2">
        <HistoryNavButtons compact />
        <h1 className="flex items-center text-base lg:text-xl font-display font-bold text-slate-900 tracking-tight shrink-0">
          <Trophy className="w-4 h-4 lg:w-5 lg:h-5 mr-1.5 text-amber-500" /> Ranking
        </h1>
        <select
          value={vacancyId || ''}
          onChange={e => {
            const qs = params.toString();
            navigate(`${e.target.value ? `/vacancies/${e.target.value}/ranking` : '/ranking'}${qs ? `?${qs}` : ''}`);
          }}
          className={`${ctl} min-w-0 px-2 order-last w-full @lg:order-none @lg:w-auto @lg:flex-1 @3xl:flex-none @3xl:w-60`}
          title="Vacante"
        >
          <option value="">Todas las vacantes</option>
          {vacancyOptions.map(([id, v]) => <option key={id} value={id}>{v.title || 'Sin título'}</option>)}
        </select>
        <div className="flex items-center gap-2 ml-auto">
          {selectedForComparison.length > 1 && (
            <button onClick={() => setShowComparison(true)} className="h-9 flex items-center px-3 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-sm">
              <GitCompare className="w-4 h-4 mr-1.5" /> Comparar ({selectedForComparison.length})
            </button>
          )}
          <button onClick={exportToCSV} title="Descargar lo que ves en una hoja de cálculo (CSV)" className="h-9 flex items-center px-3 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 shadow-sm">
            <Download className="w-4 h-4 @4xl:mr-1.5" /><span className="hidden @4xl:inline">CSV</span>
          </button>
          {vacancyId && (
            <Link to={`/vacancies/${vacancyId}/kanban`} className="h-9 flex items-center px-3 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 shadow-sm whitespace-nowrap">
              Embudo
            </Link>
          )}
        </div>
      </div>

      {/* Filters and order. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative" ref={stagesRef}>
          <button onClick={() => setStagesOpen(o => !o)} className={`${ctl} flex items-center gap-1.5 px-3 ${stages.length ? 'border-violet-300 text-violet-700 bg-violet-50' : ''}`}>
            <Filter className="w-3.5 h-3.5" /> {stageSummary} <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {stagesOpen && (
            <div className="absolute z-30 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl p-2">
              <div className="flex gap-1 mb-2">
                <button onClick={() => update({ etapas: null })} className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-bold ${stages.length === 0 ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Todas</button>
                <button onClick={() => update({ etapas: formatStages(IN_PROCESS_STAGES) })} title="Sin contratados, descartados ni banco de talento" className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-bold ${stageSummary === 'En proceso' ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>En proceso</button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {PIPELINE_STAGES.map(st => {
                  const n = stageCounts.get(st) || 0;
                  return (
                    <label key={st} className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs cursor-pointer hover:bg-slate-50 ${n === 0 ? 'text-slate-400' : 'text-slate-700'}`}>
                      <input type="checkbox" checked={stages.includes(st)} onChange={() => toggleStage(st)} className="w-3.5 h-3.5 rounded border-slate-300 text-violet-600" />
                      <span className="flex-1 truncate">{st}</span>
                      <span className="text-[10px] font-bold text-slate-400">{n}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <select
            value={option.key}
            onChange={e => { const o = findSortOption(options, e.target.value); update({ orden: o.key, dir: defaultDirection(o.kind) }); }}
            className={`${ctl} px-2 max-w-[13rem]`}
            title="Ordenar por"
          >
            {[...new Set(options.map(o => o.group))].map(g => (
              <optgroup key={g} label={g}>
                {options.filter(o => o.group === g).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
          <button
            onClick={() => update({ dir: dir === 'desc' ? 'asc' : 'desc' })}
            title="Cambiar el sentido del orden"
            className={`${ctl} flex items-center gap-1 px-2.5 whitespace-nowrap`}
          >
            {dir === 'desc' ? <ArrowDownWideNarrow className="w-3.5 h-3.5" /> : <ArrowUpNarrowWide className="w-3.5 h-3.5" />}
            {dir === 'desc' ? dirLabels.desc : dirLabels.asc}
          </button>
        </div>

        <select
          value={minScore}
          onChange={e => update({ min: e.target.value === '0' ? null : e.target.value })}
          className={`${ctl} px-2 ${minScore ? 'border-violet-300 text-violet-700 bg-violet-50' : ''}`}
          title={`Puntaje mínimo en «${isScoreSort ? option.label : 'Puntaje total'}»`}
        >
          {MIN_OPTIONS.map(m => (
            <option key={m} value={m}>{m === 0 ? 'Sin mínimo' : `${isScoreSort ? option.label : 'Total'} ≥ ${m}`}</option>
          ))}
        </select>

        {isScoreSort && (
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer select-none" title={`Ocultar a quienes aún no tienen resultado de «${option.label}»`}>
            <input type="checkbox" checked={hideMissing} onChange={e => update({ solo: e.target.checked ? '1' : null })} className="w-3.5 h-3.5 rounded border-slate-300 text-violet-600" />
            Solo con resultado
          </label>
        )}

        <div className="relative flex-1 min-w-[12rem] @4xl:flex-none @4xl:w-60 ml-auto">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={e => update({ q: e.target.value || null })}
            placeholder="Buscar: nombre, teléfono, pros, contras…"
            aria-label="Buscar en el ranking"
            className="h-9 w-full pl-9 pr-8 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none shadow-sm"
          />
          {q && (
            <button onClick={() => update({ q: null })} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700" aria-label="Limpiar búsqueda">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <span className="text-xs font-bold text-slate-400 whitespace-nowrap">{allShown.length} candidato(s)</span>
      </div>

      {/* The list: its own scroll (both ways), header and candidate column stay in view. */}
      <div data-scroll-key="ranking" className="flex-1 min-h-0 overflow-auto bg-white rounded-xl border border-slate-200 shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Cargando ranking…</div>
        ) : allShown.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Nadie coincide con estos filtros.{' '}
            <button onClick={() => update({ etapas: null, q: null, min: null, solo: null })} className="font-bold text-violet-600 hover:underline">Quitar filtros</button>
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="bg-slate-50 text-[11px] font-bold text-slate-500">
                <th className="sticky left-0 z-10 bg-slate-50 border-b border-slate-200 px-2 py-2 text-left">
                  <button onClick={() => sortBy('name')} className="ml-[4.25rem] hover:text-violet-700" title="Ordenar por nombre">Candidato</button>
                </th>
                <th className="@5xl:hidden border-b border-slate-200 px-1.5 py-2 text-left" title="Cuántos pros y contras tiene (pasa el ratón por la fila o ábrela para leerlos)">Pros / contras</th>
                <th className="hidden @5xl:table-cell border-b border-slate-200 px-2 py-2 text-left">Pros y contras</th>
                {SCORE_COLUMNS.map(c => (
                  <React.Fragment key={c.key}>
                  {c.key === 'total' && extraCol && (
                    <th className="border-b border-l border-slate-200 px-1 py-2 text-center w-20 text-violet-700 bg-violet-50">
                      <button onClick={() => sortBy(extraCol.key)} title={`Ordenado por «${extraCol.label}» (${extraCol.group}). Clic para invertir.`} className="inline-flex items-center gap-0.5 max-w-[5rem]">
                        <span className="truncate">{extraCol.label}</span>
                        {dir === 'desc' ? <ArrowDownWideNarrow className="w-3 h-3 shrink-0" /> : <ArrowUpNarrowWide className="w-3 h-3 shrink-0" />}
                      </button>
                    </th>
                  )}
                  <th className={`border-b border-slate-200 px-1 py-2 text-center w-16 ${c.key === 'total' ? 'border-l border-slate-200' : ''} ${c.key === option.key ? 'text-violet-700 bg-violet-50' : ''}`}>
                    <button onClick={() => sortBy(c.key)} title={`${c.hint}. Clic para ordenar.`} className="inline-flex items-center gap-0.5 hover:text-violet-700">
                      {c.label}
                      {c.key === option.key && (dir === 'desc' ? <ArrowDownWideNarrow className="w-3 h-3" /> : <ArrowUpNarrowWide className="w-3 h-3" />)}
                    </button>
                  </th>
                  </React.Fragment>
                ))}
                <th className="border-b border-slate-200 px-1 py-2 text-center w-20" title={traitsInView.size ? `Rasgos: ${[...traitsInView.values()].join(', ')}. Ordena por uno en «Ordenar por».` : 'Test de personalidad'}>
                  Personalidad
                </th>
                <th className="hidden @4xl:table-cell border-b border-slate-200 px-2 py-2 text-right w-20">Decisión</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => renderRow(r, i + 1))}
              {missing.length > 0 && (
                <tr>
                  <td colSpan={colCount} className="border-b border-slate-200 bg-slate-50 p-0">
                    <p className="sticky left-0 px-3 py-1.5 text-[11px] font-bold text-slate-500 w-[calc(100cqw-2px)] max-w-full">
                      Sin resultado de «{option.label}» ({missing.length}) — aún no tienen este dato
                    </p>
                  </td>
                </tr>
              )}
              {missing.map(r => renderRow(r, null))}
            </tbody>
          </table>
        )}
      </div>

      <CvPreviewModal cv={cvPreview} onClose={() => setCvPreview(null)} />

      {/* Comparison */}
      <Modal isOpen={showComparison} onClose={() => setShowComparison(false)} closeOnBackdrop overlayClassName="bg-slate-900/60 z-50">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
            <h2 className="text-lg font-black text-slate-800 flex items-center">
              <GitCompare className="w-5 h-5 mr-2 text-indigo-600" /> Comparación de candidatos
            </h2>
            <button onClick={() => setShowComparison(false)} className="text-slate-400 hover:text-slate-600"><X className="w-6 h-6" /></button>
          </div>
          <div className="p-5 overflow-y-auto flex-1 bg-slate-50/50">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {comparisonRows.map(r => {
                const s = signals.get(r.app.id) || { pros: [], cons: [] };
                return (
                  <div key={r.app.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                    <div className="p-4 border-b border-slate-100 bg-slate-50 text-center">
                      <CandidateAvatar photoUrl={r.candidate?.photoUrl} name={r.app.candidateName} size={64} className="mx-auto mb-2 ring-4 ring-white shadow-md" />
                      <h3 className="font-bold text-slate-800">{r.app.candidateName || 'Sin nombre'}</h3>
                      <p className="text-[11px] text-slate-500">{r.app.stage}</p>
                    </div>
                    <div className="p-4 space-y-4 flex-1">
                      <div className="space-y-1.5">
                        {SCORE_COLUMNS.map(c => (
                          <div key={c.key} className={`flex items-center justify-between text-sm ${c.key === 'total' ? 'pt-1.5 border-t border-slate-100 font-bold' : ''}`}>
                            <span className="text-slate-600">{c.name}</span>
                            <ScoreCell value={scoreValue(c.key, r)} />
                          </div>
                        ))}
                      </div>
                      <PartBars title="Personalidad" parts={personalityTraits(r.app).map(t => ({ label: t.name, value: t.score }))} />
                      <div>
                        <h5 className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">Pros</h5>
                        <SignalList items={s.pros.slice(0, 6)} kind="pro" />
                      </div>
                      <div>
                        <h5 className="text-[10px] font-bold text-rose-600 uppercase tracking-wider mb-1.5">Contras</h5>
                        <SignalList items={s.cons.slice(0, 6)} kind="con" />
                      </div>
                    </div>
                    <div className="p-3 border-t border-slate-100 bg-slate-50">
                      <Link to={`/candidates/${r.app.candidateId}`} className="block w-full py-2 text-center bg-white border border-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-50 text-sm">
                        Ver perfil completo
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>

      {/* Decision */}
      <Modal isOpen={decisionModal.isOpen} onClose={() => setDecisionModal({ isOpen: false, candidateId: '', appId: '', type: null })} overlayClassName="bg-slate-900/50 z-50">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h2 className={`text-xl font-bold flex items-center ${decisionModal.type === 'Contratado' ? 'text-emerald-700' : 'text-rose-700'}`}>
              {decisionModal.type === 'Contratado' ? <CheckCircle className="w-6 h-6 mr-2" /> : <XCircle className="w-6 h-6 mr-2" />}
              Confirmar {decisionModal.type}
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600">
              Estás a punto de marcar a este candidato como <strong>{decisionModal.type}</strong>.
              {decisionModal.type === 'Descartado'
                ? ' Se enviará un mensaje automático de WhatsApp notificándole la decisión.'
                : ' No se enviará ningún mensaje automático; podrás contactarlo personalmente.'}
            </p>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Motivo de la decisión (Obligatorio para auditoría)</label>
              <textarea
                value={decisionReason}
                onChange={(e) => setDecisionReason(e.target.value)}
                className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                rows={3}
                placeholder={decisionModal.type === 'Contratado' ? 'Ej. Excelente fit cultural y técnico...' : 'Ej. Falta de experiencia en React...'}
              />
            </div>
            <div className="flex space-x-3 pt-4">
              <button
                onClick={() => setDecisionModal({ isOpen: false, candidateId: '', appId: '', type: null })}
                className="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDecision}
                disabled={!decisionReason}
                className={`flex-1 py-2.5 text-white rounded-xl font-bold transition-colors disabled:opacity-50 ${
                  decisionModal.type === 'Contratado' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
