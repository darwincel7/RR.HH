import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc, updateDoc, getDoc, serverTimestamp, setDoc, writeBatch, documentId } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { db, storage, auth } from '../lib/firebase';
import { PIPELINE_STAGES, STAGE_INFO } from '../constants/stages';
import { Loader2, User, Star, Clock, Sparkles, X, Check, UploadCloud, FileText, Calendar, AlertTriangle, CheckCircle, ArrowRightLeft, Search, ListOrdered, Trophy } from 'lucide-react';
import { HistoryNavButtons } from '../components/layout/TopBar';

import { sendWhatsAppAutomation, stageMayAutoSend, stageNeedsScheduling, sleep, SEND_SPACING_MS } from '../lib/whatsapp';
import { useBulkNotifyConfirm, type BulkNotifyChoice } from '../components/BulkNotifyConfirm';
import CvPreviewModal, { type CvPreview } from '../components/CvPreviewModal';
import WhatsAppSendReport from '../components/WhatsAppSendReport';
import { requestCvWorkerRun } from '../lib/api';
import { getKanbanOrder, computeDropOrder } from '../lib/kanbanOrder';
import BulkCvUploadModal, { type BulkEntry } from '../components/BulkCvUploadModal';
import { normalizePhone } from '../lib/phone';
import { smartMatch } from '../lib/smartSearch';
import { loadAllNotesByCandidate, type CandidateNote } from '../lib/notes';
import MoveVacancyModal from '../components/MoveVacancyModal';
import CandidateAvatar from '../components/CandidateAvatar';
import CandidateWhatsAppState from '../components/CandidateWhatsAppState';
import StageNotifyToggle from '../components/StageNotifyToggle';
import { useStageNotifications } from '../lib/useStageNotifications';
import InterviewAttendanceButton from '../components/InterviewAttendanceButton';
import { interviewInviteStamp, isInterviewStage } from '../lib/interviewAttendance';
import { useParticipantStatuses } from '../lib/participantStatus';
import { useScrollMemory } from '../lib/useScrollMemory';

export default function KanbanBoard() {
  const { vacancyId } = useParams();
  const navigate = useNavigate();
  const [vacancy, setVacancy] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  // Back from a profile = same horizontal spot on the board and same spot in each column.
  useScrollMemory(!loading);
  // The search lives in the URL (?q=) so "Atrás" from a profile brings it back too.
  const [searchParams, setSearchParams] = useSearchParams();
  const searchTerm = searchParams.get('q') || '';
  const setSearchTerm = (value: string) => setSearchParams(prev => {
    const next = new URLSearchParams(prev);
    if (value) next.set('q', value); else next.delete('q');
    return next;
  }, { replace: true });
  const searchRef = React.useRef<HTMLInputElement>(null);
  // Notes are searchable from the board too (loaded once; optional).
  const [notesByCandidate, setNotesByCandidate] = useState<Map<string, CandidateNote[]>>(new Map());
  const [showMoveVacancy, setShowMoveVacancy] = useState(false);
  // Per-stage "notify on move" switches (one click on each column header).
  const stageNotify = useStageNotifications();
  // Lo marcado en la agenda de Entrevistas: así el botón ✅/❌ de la tarjeta no dice
  // "sin registrar" de alguien que el Dashboard ya cuenta como asistido.
  const participants = useParticipantStatuses({ all: true });
  useEffect(() => {
    loadAllNotesByCandidate().then(setNotesByCandidate).catch(e => console.warn('Notas no disponibles para la búsqueda:', e));
  }, []);
  // CV preview modal (floating window) — shown in-place instead of a new tab.
  const [cvPreview, setCvPreview] = useState<CvPreview | null>(null);

  // Bulk selection state
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  // Post-bulk-move WhatsApp delivery report (who did NOT get the automated message).
  const [sendReport, setSendReport] = useState<{ stage: string; sent: number; failed: any[] } | null>(null);
  const [retryingSends, setRetryingSends] = useState(false);
  // "How do we notify this batch?" — asked before a bulk move to a messaging stage.
  const { ask: askBulkNotify, element: bulkNotifyModal } = useBulkNotifyConfirm();

  // Non-blocking floating notices (replace the old alert() popups): they appear at the
  // right-middle edge, never intercept clicks elsewhere, and fade out on their own —
  // so the recruiter can keep dragging card after card without dismissing anything.
  type Toast = { id: number; kind: 'success' | 'error' | 'warning'; text: string; leaving: boolean };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = React.useRef(0);
  const showToast = (kind: Toast['kind'], text: string, ms = 3200) => {
    const id = ++toastSeq.current;
    setToasts(prev => [...prev, { id, kind, text, leaving: false }]);
    window.setTimeout(() => setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t)), ms);
    window.setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), ms + 400);
  };
  const dismissToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  // Bulk upload state
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false);

  // Interview schedule for THIS vacancy (date + time + place). Set here once, then used
  // to build the WhatsApp invitation and to block convoking with a past date.
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [schedLocation, setSchedLocation] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  // These stages send a dated interview invitation built from the schedule above, and
  // are the ones that stamp the invitation on the application (interviewAttendance.ts —
  // one definition, shared with the attendance button and the Dashboard metrics).

  const scheduleDateTime = (): Date | null => {
    if (!schedDate || !schedTime) return null;
    const dt = new Date(`${schedDate}T${schedTime}`);
    return isNaN(dt.getTime()) ? null : dt;
  };
  const scheduleStatus = () => {
    const dt = scheduleDateTime();
    if (!dt) return { isSet: false, isPast: false, valid: false, dt: null as Date | null };
    const isPast = dt.getTime() <= Date.now();
    return { isSet: true, isPast, valid: !isPast, dt };
  };
  const fmtFecha = (dt: Date) => dt.toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtHora = (dt: Date) => dt.toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit', hour12: true });
  const fmtFechaCorta = (dt: Date) => dt.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' });
  const todayStr = new Date().toISOString().split('T')[0];

  useEffect(() => {
    const s = vacancy?.interviewSchedule;
    if (s) {
      setSchedDate(s.date || '');
      setSchedTime(s.time || '');
      setSchedLocation(s.location || '');
    }
  }, [vacancy]);

  const saveSchedule = async () => {
    if (!vacancyId) return;
    setSavingSchedule(true);
    try {
      const interviewSchedule = { date: schedDate, time: schedTime, location: schedLocation };
      await updateDoc(doc(db, 'vacancies', vacancyId), { interviewSchedule });
      setVacancy((v: any) => ({ ...(v || {}), interviewSchedule }));
    } catch (e) {
      console.error('No se pudo guardar la agenda:', e);
      alert('No se pudo guardar la agenda de entrevista.');
    } finally {
      setSavingSchedule(false);
    }
  };

  // Interview-schedule variables for the invitation message (empty for non-interview stages).
  const interviewVarsFor = (stage: string) => {
    if (!isInterviewStage(stage)) return {};
    const st = scheduleStatus();
    if (!st.dt) return {};
    return { fecha: fmtFecha(st.dt), hora: fmtHora(st.dt), ubicacion: schedLocation };
  };

  useEffect(() => {
    if (!vacancyId) return;

    // Fetch vacancy details
    const fetchVacancy = async () => {
      const docRef = doc(db, 'vacancies', vacancyId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setVacancy(docSnap.data());
      }
    };
    fetchVacancy();

    // Listen to applications for this vacancy
    const q = query(collection(db, 'applications'), where('vacancyId', '==', vacancyId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const apps = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as any[];
      setApplications(apps);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [vacancyId]);

  // Candidate docs (photo, phone, CV…) — LIVE. A photo the background backfill or a
  // colleague adds shows up on the card without reloading. One listener per 30 ids
  // (Firestore's `in` limit); it used to re-read every candidate on each card move.
  const candidateIdsKey = Array.from(new Set(applications.map(a => a.candidateId).filter(Boolean))).sort().join('|');
  useEffect(() => {
    const ids = candidateIdsKey ? candidateIdsKey.split('|') : [];
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      unsubs.push(onSnapshot(
        query(collection(db, 'candidates'), where(documentId(), 'in', chunk)),
        (snap) => {
          setCandidates(prev => {
            const next = { ...prev };
            snap.docs.forEach(d => { next[d.id] = d.data(); });
            return next;
          });
        },
        (e) => console.error('candidates snapshot error:', e),
      ));
    }
    return () => unsubs.forEach(u => u());
  }, [candidateIdsKey]);

  // "/" focuses this board's search, like the global one it replaces on this page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Changing the search clears the selection: otherwise cards selected under a
  // previous search stay silently selected while INVISIBLE, and a bulk move would
  // move (and WhatsApp-message) candidates the recruiter can't see.
  useEffect(() => {
    setSelectedApps(new Set());
  }, [searchTerm]);

  const toggleSelection = (appId: string) => {
    setSelectedApps(prev => {
      const next = new Set(prev);
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
      }
      return next;
    });
  };

  const handleBulkMove = async (targetStage: string) => {
    if (!targetStage || selectedApps.size === 0) return;
    setBulkActionLoading(true);

    const appsToMove = applications.filter(a => selectedApps.has(a.id) && a.stage !== targetStage);
    if (appsToMove.length === 0) { setBulkActionLoading(false); return; }

    // This stage's notification is switched OFF: just move, nobody is notified (so no
    // schedule is needed and there's nothing to ask).
    const muted = stageNotify.isMuted(targetStage);

    // PRE-FLIGHT: convoking to an interview requires a future schedule set above.
    if (isInterviewStage(targetStage) && !muted) {
      const st = scheduleStatus();
      if (!st.valid) {
        showToast('warning', st.isPast
          ? '⚠️ La fecha de entrevista de arriba YA PASÓ. Ponla a futuro antes de convocar.'
          : '📅 Antes de convocar, indica arriba la fecha, hora y lugar de la entrevista.', 6000);
        setBulkActionLoading(false);
        return;
      }
    }

    // PRE-FLIGHT: a stage that messages candidates asks HOW to notify this batch — with
    // the WhatsApp state, the delivery estimate at the protective pace and the template's
    // variation in view — before moving anyone (never a half-notified batch).
    let notify: BulkNotifyChoice = muted ? 'none' : 'whatsapp';
    if (!muted && (stageMayAutoSend(targetStage) || isInterviewStage(targetStage))) {
      const withEmail = appsToMove.filter(a => !!candidates[a.candidateId]?.email).length;
      const choice = await askBulkNotify(targetStage, appsToMove.length, withEmail);
      if (!choice) { setBulkActionLoading(false); return; }
      notify = choice;
    }

    let movedCount = 0;
    let sentCount = 0;
    let queuedCount = 0;
    let emailedCount = 0;
    const failedSends: any[] = [];
    const failed: string[] = [];

    // Process each candidate independently so one failure doesn't abort the whole batch.
    for (const movedApp of appsToMove) {
      try {
        // 1. Update the stage in Firestore (this is the source of truth for the move).
        const appRef = doc(db, 'applications', movedApp.id);
        await updateDoc(appRef, {
          stage: targetStage,
          lastStageUpdate: serverTimestamp(),
          // Convocar a entrevista deja su sello: es el denominador de las métricas de
          // asistencia y debe sobrevivir a que la persona avance o se descarte.
          ...interviewInviteStamp(movedApp, movedApp.stage, targetStage),
        });
        movedCount++;

        // "Solo mover, sin avisar": nothing else to do for this candidate.
        if (notify === 'none') continue;

        // 2. Trigger automation as best-effort: a failed WhatsApp/email must NOT undo the move.
        try {
          const candSnap = await getDoc(doc(db, 'candidates', movedApp.candidateId));
          if (candSnap.exists()) {
            const phone = candSnap.data().phone;

            let link = '';
            if (targetStage === 'Pruebas técnicas' || targetStage === 'Tests presenciales') {
              link = `${window.location.origin}/test/${movedApp.id}`;
            } else if (targetStage === 'Formulario etapa 2 enviado') {
              link = `${window.location.origin}/eval/${movedApp.id}`;
            }

            const vars = {
              nombre: movedApp.candidateName,
              vacante: vacancy?.title,
              link,
              email: candSnap.data().email,
              ...interviewVarsFor(targetStage)
            };
            const r = await sendWhatsAppAutomation(phone, targetStage, vars, { channels: { whatsapp: notify === 'whatsapp' } });
            if (r.status === 'sent') sentCount++;
            if (r.status === 'queued') queuedCount++;
            if (r.reason === 'solo_correo') emailedCount++;
            // The report offers a WhatsApp retry — only for a batch that chose WhatsApp.
            if (r.status === 'failed' && notify === 'whatsapp') {
              failedSends.push({ id: movedApp.id, name: movedApp.candidateName || 'Sin nombre', phone: phone || '—', vars, emailed: !!r.emailed });
            }
            // Direct (dev) sends need client-side spacing; queued ones are paced by the
            // server's drain, so enqueueing can go fast.
            if (phone && r.status === 'sent') await sleep(SEND_SPACING_MS);
          }
        } catch (autoErr) {
          console.error(`Automation failed for ${movedApp.id} (stage saved anyway):`, autoErr);
          // Keep the real phone (from the already-loaded candidates map) so the
          // report's retry can actually resend instead of failing on '—' forever.
          const knownPhone = candidates[movedApp.candidateId]?.phone || '';
          if (notify === 'whatsapp') failedSends.push({ id: movedApp.id, name: movedApp.candidateName || 'Sin nombre', phone: knownPhone || '—', vars: { nombre: movedApp.candidateName, vacante: vacancy?.title, link: '', email: candidates[movedApp.candidateId]?.email || '' }, emailed: false });
        }
      } catch (err) {
        console.error(`Error moving application ${movedApp.id}:`, err);
        failed.push(movedApp.candidateName || movedApp.id);
      }
    }

    setSelectedApps(new Set()); // Clear selection
    setBulkActionLoading(false);

    if (failed.length > 0) {
      showToast('error', `Movidos ${movedCount}. No se pudieron mover ${failed.length}: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}. Revisa tus permisos.`, 7000);
    }
    if (failedSends.length > 0) {
      // Show exactly WHO didn't get the message, with one-click retry.
      setSendReport({ stage: targetStage, sent: sentCount, failed: failedSends });
    } else if (failed.length === 0) {
      const parts = [
        sentCount > 0 ? `${sentCount} WhatsApp enviados` : '',
        queuedCount > 0 ? `${queuedCount} WhatsApp en cola (salen poco a poco)` : '',
        emailedCount > 0 ? `${emailedCount} avisados por correo` : '',
        notify === 'none' ? (muted ? 'sin avisos (apagados en esta etapa)' : 'sin avisos') : '',
      ].filter(Boolean).join(' · ');
      showToast('success', `${movedCount} candidato(s) movidos a "${targetStage}"${parts ? ` · ${parts}` : ''}`, 4500);
      if (!muted && stageNeedsScheduling(targetStage) && !isInterviewStage(targetStage)) {
        showToast('warning', '📅 Para enviarles la invitación con fecha y hora, agéndala en la página Entrevistas.', 6500);
      }
    }
  };

  // Re-attempts ONLY the failed sends from the last bulk move (no re-moving).
  const retryFailedSends = async () => {
    if (!sendReport) return;
    setRetryingSends(true);
    const still: any[] = [];
    let sentNow = sendReport.sent;
    for (const f of sendReport.failed) {
      try {
        // Never the same email twice: only if it didn't go out on an earlier attempt.
        const r = await sendWhatsAppAutomation(f.phone, sendReport.stage, f.vars, { channels: { email: !f.emailed } });
        if (r.status === 'failed') still.push({ ...f, emailed: f.emailed || !!r.emailed });
        else if (r.status === 'sent' || r.status === 'queued') sentNow++;
      } catch {
        still.push(f);
      }
      await sleep(SEND_SPACING_MS);
    }
    setRetryingSends(false);
    if (still.length === 0) {
      setSendReport(null);
      alert('✅ Todos los mensajes pendientes fueron enviados.');
    } else {
      setSendReport({ stage: sendReport.stage, sent: sentNow, failed: still });
    }
  };

  // Bulk upload with per-CV data: whatever the recruiter typed (name/phone/email/city)
  // is written as-is and the AI only fills what was left BLANK (source:'bulk' tells the
  // worker to complete empty fields without overwriting manual ones).
  const uploadBulkEntries = async (entries: BulkEntry[], onProgress: (pct: number) => void) => {
    if (!vacancyId) return;
    let completed = 0;
    // Upload in chunks of 5 to dramatically speed up the process without hitting rate limits
    const chunkSize = 5;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);

      await Promise.all(chunk.map(async ({ file, name, phone, email, city }) => {
        // 1. Create a candidate record
        const candidateId = doc(collection(db, 'candidates')).id;

        // 2. Upload file to storage (folder = uploading recruiter's uid)
        const fileExt = file.name.split('.').pop() || 'pdf';
        const uploaderUid = auth.currentUser?.uid || candidateId;
        const storageRef = ref(storage, `cvs/${uploaderUid}/${candidateId}_bulk_${Date.now()}.${fileExt}`);
        await uploadBytes(storageRef, file);
        const cvUrl = await getDownloadURL(storageRef);

        const displayName = name.trim() || `Procesando: ${file.name}`;

        // 3 & 4. Save candidate shell + application atomically so a failure never
        // leaves an orphaned candidate without its application (or vice versa).
        const applicationId = `${candidateId}_${vacancyId}`;
        const batch = writeBatch(db);
        batch.set(doc(db, 'candidates', candidateId), {
          fullName: displayName,
          email: email.trim(),
          phone: phone.trim(),
          ...(phone.trim() ? { phoneNormalized: normalizePhone(phone) } : {}),
          city: city.trim(),
          source: 'bulk', // the AI completes only the EMPTY fields on bulk docs
          cvUrl,
          cvFileType: file.type || 'application/pdf',
          aiStatus: 'pending', // This triggers our background CV processor cron
          createdAt: serverTimestamp()
        });
        batch.set(doc(db, 'applications', applicationId), {
          candidateId,
          vacancyId: vacancyId,
          vacancyTitle: vacancy?.title || '',
          candidateName: displayName,
          stage: 'Nuevo',
          cvUrl,
          cvFileType: file.type || 'application/pdf',
          submittedAt: serverTimestamp(),
          lastStageUpdate: serverTimestamp()
        });
        await batch.commit();

        completed++;
      }));

      onProgress((completed / entries.length) * 100);
    }

    // Every CV is queued now — start the analysis immediately.
    requestCvWorkerRun();
  };

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newStage = destination.droppableId;
    const sameColumn = destination.droppableId === source.droppableId;
    const movedApp = applications.find(a => a.id === draggableId);
    if (!movedApp) return;

    // Notification switched OFF for this stage: the move notifies nobody.
    const muted = stageNotify.isMuted(newStage);

    // BLOCK convoking to an interview when the schedule above is missing or already past.
    // Returning before the optimistic update makes the card snap back to its origin.
    // (Not when the stage doesn't notify: there's no invitation to build.)
    if (!sameColumn && isInterviewStage(newStage) && !muted) {
      const st = scheduleStatus();
      if (!st.valid) {
        showToast('warning', st.isPast
          ? '⚠️ La fecha de entrevista de arriba YA PASÓ. Ponla a futuro antes de convocar.'
          : '📅 Antes de convocar, indica arriba la fecha, hora y lugar de la entrevista.', 6000);
        return;
      }
    }

    // The card takes the exact slot where it was dropped: its new order is the
    // midpoint between its two neighbors in the destination column AS RENDERED
    // (filteredApplications — same list the Draggables index against — without the
    // dragged card, matching how the library reports destination.index).
    // Columns render NEWEST FIRST (descending order), so the card above the drop slot
    // has the HIGHER order and the one below has the LOWER one — the mirror of an
    // ascending board.
    const destItems = filteredApplications
      .filter(app => app.stage === newStage && app.id !== draggableId)
      .sort((a, b) => getKanbanOrder(b) - getKanbanOrder(a));
    const newOrder = computeDropOrder(destItems, destination.index, Date.now());

    // Optimistic UI update
    const previousApps = [...applications];
    setApplications(prev => prev.map(app =>
      app.id === draggableId ? { ...app, stage: newStage, kanbanOrder: newOrder } : app
    ));

    // Instant green check — the Firestore write and WhatsApp automation continue in the
    // background, so the recruiter can immediately drag the next card.
    if (!sameColumn) showToast('success', `${movedApp.candidateName} → ${newStage}${muted && stageNotify.hasMessage(newStage) ? ' · sin aviso (apagado en esta etapa)' : ''}`, 2600);

    // Update in Firestore
    try {
      const appRef = doc(db, 'applications', draggableId);

      // Reorder INSIDE the same column: only the position changes — no stage write,
      // no lastStageUpdate, and crucially NO automation (previously this re-fired
      // the stage's WhatsApp template on a simple reorder).
      if (sameColumn) {
        await updateDoc(appRef, { kanbanOrder: newOrder });
        return;
      }

      await updateDoc(appRef, {
        stage: newStage,
        kanbanOrder: newOrder,
        lastStageUpdate: serverTimestamp(),
        // Ver handleBulkMove: la convocatoria se sella aquí, no en la etapa actual.
        ...interviewInviteStamp(movedApp, movedApp.stage, newStage),
      });

      // Trigger Automation
      if (movedApp) {
        const candSnap = await getDoc(doc(db, 'candidates', movedApp.candidateId));
        if (candSnap.exists()) {
          const phone = candSnap.data().phone;
          
          let link = '';
          if (newStage === 'Pruebas técnicas' || newStage === 'Tests presenciales') {
            link = `${window.location.origin}/test/${movedApp.id}`;
          } else if (newStage === 'Formulario etapa 2 enviado') {
            link = `${window.location.origin}/eval/${movedApp.id}`;
          }

          const r = await sendWhatsAppAutomation(phone, newStage, {
            nombre: movedApp.candidateName,
            vacante: vacancy?.title,
            link,
            email: candSnap.data().email,
            ...interviewVarsFor(newStage)
          });
          // The move already succeeded; only warn (don't revert) if the message failed.
          if (r.status === 'failed') {
            showToast('error', `${movedApp.candidateName} se movió, pero NO se envió el WhatsApp. Revisa la conexión en Configuración.`, 6500);
          } else if (r.status === 'sent' && isInterviewStage(newStage)) {
            const st = scheduleStatus();
            showToast('success', `📩 Invitación enviada a ${movedApp.candidateName}${st.dt ? ` · ${fmtFecha(st.dt)}, ${fmtHora(st.dt)}` : ''}${schedLocation ? ` · ${schedLocation}` : ''}`, 5000);
          } else if (r.status === 'sent') {
            showToast('success', `📩 WhatsApp de "${newStage}" enviado a ${movedApp.candidateName}`, 3600);
          }
        }
      }

      // "Oferta" still schedules from the Entrevistas page (a different meeting).
      if (!muted && stageNeedsScheduling(newStage) && !isInterviewStage(newStage)) {
        showToast('warning', `📅 ${movedApp.candidateName} está en "${newStage}": agenda la cita en la página Entrevistas para enviarle la invitación.`, 6500);
      }
    } catch (error) {
      console.error("Error updating stage:", error);
      setApplications(previousApps); // Revert UI
      showToast('error', `No se pudo mover a ${movedApp.candidateName}. Verifica tu conexión o permisos.`, 6500);
    }
  };

  // When the application ARRIVED (short form for the card chip + full form for its tooltip).
  const toJsDate = (t: any): Date | null => {
    const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null);
    return d && !isNaN(d.getTime()) ? d : null;
  };
  const fmtArrivalShort = (t: any) => {
    const d = toJsDate(t);
    return d ? d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short' }) : null;
  };
  const fmtArrivalFull = (t: any) => {
    const d = toJsDate(t);
    return d ? d.toLocaleString('es-DO', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  };

  const getDaysInStage = (lastUpdate: any, submittedAt: any) => {
    const targetDate = lastUpdate || submittedAt;
    if (!targetDate) return 0;
    const updateDate = targetDate?.toDate ? targetDate.toDate() : new Date(targetDate);
    const diffTime = Math.abs(new Date().getTime() - updateDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-violet-600" /></div>;

  // Filter applications based on search term
  // Same smart search as the candidate list: accents, phone formats, notes, multi-word.
  const filteredApplications = applications.filter(app => {
    if (!searchTerm.trim()) return true;
    const candidate = candidates[app.candidateId] || {};
    const ai = candidate.aiExtraction || {};
    return smartMatch([
      { label: 'Nombre', value: app.candidateName },
      { label: 'Teléfono', value: candidate.phone, kind: 'phone' },
      // El número con el que se registró el perfil duplicado antes de unificarlo.
      { label: 'Otro teléfono', value: candidate.alternatePhones, kind: 'phone' },
      { label: 'Correo', value: candidate.email },
      { label: 'Otro correo', value: candidate.alternateEmails },
      { label: 'Ubicación', value: [candidate.city, ai.city, ai.location] },
      { label: 'Notas', value: (notesByCandidate.get(app.candidateId) || []).map(n => n.text) },
      { label: 'Notas de entrevista', value: [app.interviewObservation?.notes, app.interviewObservation?.redFlags] },
      { label: 'CV', value: [ai.relevant_experience_summary, ...(ai.strengths_detected || [])] },
    ], searchTerm).matched;
  });

  // Group applications by stage, ordered by their in-column position (kanbanOrder)
  // so a card stays exactly where the recruiter dropped it.
  const columns = PIPELINE_STAGES.map(stage => ({
    id: stage,
    title: stage,
    items: filteredApplications
      .filter(app => app.stage === stage)
      // NEWEST FIRST: the most recent CVs sit at the top of every column.
      .sort((a, b) => getKanbanOrder(b) - getKanbanOrder(a))
  })); // ALL stages render (even empty) — hiding empty columns made it impossible to drag a card into them

  return (
    <div className="@container flex-1 min-h-0 flex flex-col animate-fade-in relative">
      {/* One row: arrows, title, actions. The layout hides its own top bar on this page
          so the columns below get the height. Sizes follow the board's own width (@…),
          not the screen's: the sidebar and the WhatsApp panel can each take 300px. */}
      <div className="mb-2 flex flex-wrap @xl:flex-nowrap items-center gap-2">
        <HistoryNavButtons compact />
        <h1
          className="min-w-0 flex-1 flex items-center text-base lg:text-xl font-display font-bold text-slate-900 tracking-tight"
          title="Arrastra las tarjetas o usa la selección múltiple para moverlas de etapa."
        >
          <Sparkles className="w-4 h-4 lg:w-5 lg:h-5 text-violet-500 mr-1.5 shrink-0" />
          <span className="truncate">Embudo: {vacancy?.title}</span>
        </h1>
        <div className="flex items-center gap-2 w-full @xl:w-auto @xl:shrink-0">
          <button
            onClick={() => setIsBulkUploadModalOpen(true)}
            title="Subir CVs a esta vacante"
            className="h-9 shrink-0 flex items-center justify-center px-3 bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold rounded-xl hover:bg-indigo-100 transition-colors shadow-sm"
          >
            <UploadCloud className="w-4 h-4" />
            <span className="hidden @5xl:inline ml-1.5">Subir CVs</span>
          </button>
          <div className="relative flex-1 @xl:flex-none">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar: nombre, teléfono, notas…"
              aria-label="Buscar en este embudo por nombre, teléfono, lugar o notas"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 w-full @xl:w-40 @4xl:w-52 @6xl:w-64 pl-9 pr-8 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none transition-all shadow-sm"
            />
            {searchTerm ? (
              <button type="button" onClick={() => { setSearchTerm(''); searchRef.current?.focus(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700" aria-label="Limpiar búsqueda">
                <X className="w-4 h-4" />
              </button>
            ) : (
              <kbd className="hidden md:block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">/</kbd>
            )}
          </div>
          <Link
            to={`/vacancies/${vacancyId}/ranking`}
            title="Ver a todos en una tabla: puntajes de cada evaluación, pros y contras"
            className="h-9 shrink-0 flex items-center px-3 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-sm whitespace-nowrap"
          >
            <Trophy className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
            Ranking
          </Link>
        </div>
      </div>

      {/* Interview schedule for this vacancy, in one slim row — the invitation sent when
          convoking a candidate uses this date/time/place, and a past date blocks the move. */}
      {(() => {
        const st = scheduleStatus();
        const saved = vacancy?.interviewSchedule || {};
        const dirty = (saved.date || '') !== schedDate || (saved.time || '') !== schedTime || (saved.location || '') !== schedLocation;
        const field = 'h-8 px-2 bg-white border rounded-lg text-xs lg:text-sm focus:ring-2 focus:ring-violet-500 outline-none';
        return (
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 bg-white rounded-xl border border-slate-200 px-2.5 py-1.5 shadow-sm">
            <span
              className="flex items-center text-xs font-bold text-slate-600 whitespace-nowrap cursor-help"
              title="Agenda de entrevista de esta vacante: se usa en la invitación al convocar candidatos a entrevista."
            >
              <Calendar className="w-3.5 h-3.5 text-violet-600 mr-1.5" /> Entrevista
            </span>
            <input type="date" min={todayStr} value={schedDate} onChange={(e) => setSchedDate(e.target.value)}
              aria-label="Fecha de la entrevista" title="Fecha de la entrevista"
              className={`${field} w-[8.75rem] ${st.isPast ? 'border-rose-300 text-rose-700' : 'border-slate-200'}`} />
            <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)}
              aria-label="Hora de la entrevista" title="Hora de la entrevista"
              className={`${field} w-[7.25rem] ${st.isPast ? 'border-rose-300 text-rose-700' : 'border-slate-200'}`} />
            <input type="text" value={schedLocation} onChange={(e) => setSchedLocation(e.target.value)}
              aria-label="Lugar o modalidad de la entrevista" title="Lugar o modalidad de la entrevista"
              placeholder="Lugar: Tienda Baní, o Google Meet"
              className={`${field} flex-1 min-w-[9rem] border-slate-200`} />
            {/* Only when there is something to save. */}
            {(dirty || savingSchedule) && (
              <button onClick={saveSchedule} disabled={savingSchedule}
                className="h-8 px-3 bg-violet-600 text-white text-xs font-bold rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 whitespace-nowrap">
                {savingSchedule ? 'Guardando…' : 'Guardar'}
              </button>
            )}
            {st.isSet && (
              st.isPast ? (
                <span className="text-xs font-bold text-rose-600 flex items-center" title="No podrás convocar candidatos con una fecha vencida.">
                  <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" /> Ya pasó: ponla a futuro
                </span>
              ) : (
                <span className="text-xs font-medium text-emerald-600 flex items-center whitespace-nowrap"
                  title={`Entrevista: ${st.dt && fmtFecha(st.dt)} · ${st.dt && fmtHora(st.dt)}${schedLocation ? ` · ${schedLocation}` : ''}`}>
                  <CheckCircle className="w-3.5 h-3.5 mr-1 shrink-0" /> {st.dt && `${fmtFechaCorta(st.dt)} · ${fmtHora(st.dt)}`}
                </span>
              )
            )}
          </div>
        );
      })()}

      {/* The global search isn't on this page: when nobody here matches, offer it. */}
      {searchTerm.trim() && filteredApplications.length === 0 && (
        <p className="mb-2 px-1 text-xs text-slate-500">
          Nadie en este embudo coincide con «{searchTerm.trim()}».{' '}
          <Link to={`/candidates?q=${encodeURIComponent(searchTerm.trim())}`} className="font-bold text-violet-600 hover:underline">
            Buscar en todos los candidatos →
          </Link>
        </p>
      )}

      {/* The board takes exactly the height left under the header; each column scrolls
          on its own, and its drop zone still covers the whole column. */}
      <div data-scroll-key="board" className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden pb-2">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex h-full space-x-3 min-w-max px-1">
            {columns.map(column => (
              <div key={column.id} className="flex-shrink-0 w-64 lg:w-72 flex flex-col h-full">
                <div className="mb-1 flex justify-between items-center gap-2 px-1">
                  <h3 className="min-w-0 truncate font-display font-bold text-slate-700 text-[10px] lg:text-xs uppercase tracking-widest" title={`${column.title}: ${STAGE_INFO[column.id] || ''}`}>{column.title}</h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {column.items.length > 0 && <button
                      onClick={() => {
                        const allSelected = column.items.every(item => selectedApps.has(item.id));
                        if(allSelected) {
                          setSelectedApps(prev => {
                            const next = new Set(prev);
                            column.items.forEach(item => next.delete(item.id));
                            return next;
                          });
                        } else {
                          setSelectedApps(prev => {
                            const next = new Set(prev);
                            column.items.forEach(item => next.add(item.id));
                            return next;
                          });
                        }
                      }}
                      className="text-[9px] text-violet-600 bg-violet-50 hover:bg-violet-100 font-bold px-2 py-0.5 rounded-full transition-colors"
                    >
                      {column.items.every(item => selectedApps.has(item.id)) ? 'Desmarcar' : 'Seleccionar'}
                    </button>}
                    <span className="bg-white border border-slate-200 text-slate-600 py-0.5 px-2 rounded-full text-[10px] font-bold shadow-sm">
                      {column.items.length}
                    </span>
                    {column.items.length > 0 && (
                      <Link
                        to={`/vacancies/${vacancyId}/ranking?etapas=${encodeURIComponent(column.id)}`}
                        title={`Ver "${column.title}" en el ranking: puntajes, pros y contras en una línea`}
                        className="p-0.5 rounded text-slate-400 hover:text-violet-700 hover:bg-violet-50 transition-colors"
                      >
                        <ListOrdered className="w-3.5 h-3.5" />
                      </Link>
                    )}
                  </div>
                </div>

                {/* One slim line: the notify switch (does moving someone here notify them,
                    WhatsApp + email?) and what this stage means — full text on hover. */}
                <div className="mb-1.5 px-1 flex items-start gap-1.5 min-w-0">
                  {stageNotify.hasMessage(column.id) && (
                    <StageNotifyToggle
                      stage={column.id}
                      muted={stageNotify.isMuted(column.id)}
                      saving={stageNotify.saving === column.id}
                      onToggle={stageNotify.toggle}
                    />
                  )}
                  <p className="min-w-0 truncate py-0.5 text-[9px] lg:text-[10px] text-slate-400 leading-snug" title={STAGE_INFO[column.id]}>
                    {STAGE_INFO[column.id]}
                  </p>
                </div>

                <Droppable droppableId={column.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      data-scroll-key={`col:${column.id}`}
                      className={`flex-1 overflow-y-auto p-1.5 lg:p-2 min-h-[120px] rounded-2xl transition-all duration-300 ${
                        snapshot.isDraggingOver ? 'bg-violet-50/50 border-2 border-dashed border-violet-300' : 'bg-slate-100/50 border-2 border-transparent'
                      }`}
                    >
                      {column.items.map((item, index) => {
                        const daysInStage = getDaysInStage(item.lastStageUpdate, item.submittedAt);
                        const isStale = daysInStage > 5;
                        const isSelected = selectedApps.has(item.id);
                        // El CV de ESTA postulación primero: quien volvió a aplicar con un
                        // CV nuevo no puede dejar sin CV visible a la postulación que envió
                        // con el anterior. url y tipo salen juntos de la misma fuente:
                        // mezclarlos abriría un .doc con el visor de otro formato.
                        const cand = candidates[item.candidateId];
                        const cv = item.cvUrl
                          ? { url: item.cvUrl, fileType: item.cvFileType }
                          : { url: cand?.cvUrl, fileType: cand?.cvFileType };

                        return (
                          // @ts-ignore - React 18 types issue with @hello-pangea/dnd
                          <Draggable draggableId={item.id} index={index} key={item.id}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                onClick={() => navigate(`/candidates/${item.candidateId}`)}
                                className={`relative glass-card p-2.5 lg:p-3 rounded-xl mb-2 transition-all duration-300 cursor-pointer hover:ring-2 hover:ring-violet-300 ${
                                  snapshot.isDragging ? 'shadow-2xl ring-2 ring-violet-500 scale-105 rotate-2' : ''
                                } ${isStale ? 'border-l-4 border-l-orange-500' : ''} ${isSelected ? 'ring-2 ring-violet-500 bg-violet-50/30' : ''}`}
                              >
                                
                                {/* Selection checkbox: generous hit area (~44px) with a clear
                                    hover highlight so "select" is visually distinct from
                                    "open profile". mousedown is stopped so aiming at the
                                    checkbox never starts a card drag. */}
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleSelection(item.id);
                                  }}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onTouchStart={(e) => e.stopPropagation()}
                                  title={isSelected ? 'Quitar selección' : 'Seleccionar candidato'}
                                  className="absolute top-0 right-0 z-10 p-2.5 cursor-pointer rounded-tr-xl rounded-bl-2xl hover:bg-violet-100/80 transition-colors group/check"
                                >
                                  <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all shadow-sm ${
                                    isSelected
                                      ? 'bg-violet-500 border-violet-500 text-white'
                                      : 'bg-white border-slate-300 text-transparent group-hover/check:border-violet-500 group-hover/check:scale-110'
                                  }`}>
                                    <Check className="w-4 h-4" />
                                  </div>
                                </div>

                                <div className="flex justify-between items-start gap-2 pr-9">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <CandidateAvatar
                                      photoUrl={candidates[item.candidateId]?.photoUrl}
                                      name={item.candidateName}
                                      size={36}
                                      className="ring-2 ring-white shadow-sm"
                                    />
                                    <h4 className="text-sm font-display font-bold text-slate-900 line-clamp-2 leading-tight">{item.candidateName}</h4>
                                  </div>
                                  {item.scoreSummary && (
                                    <span className="flex items-center text-[10px] font-black text-white bg-gradient-ai px-1.5 py-0.5 rounded-md shadow-sm">
                                      <Star className="w-2.5 h-2.5 mr-1 fill-current" />
                                      {item.scoreSummary}
                                    </span>
                                  )}
                                </div>
                                
                                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                                  <div className="flex space-x-1.5 items-center">
                                    {item.recommendation === 'advance' && <span className="w-2 h-2 rounded-full bg-emerald-500" title="Recomendado"></span>}
                                    {item.recommendation === 'review' && <span className="w-2 h-2 rounded-full bg-amber-500" title="Revisar"></span>}
                                    {item.recommendation === 'low_priority' && <span className="w-2 h-2 rounded-full bg-rose-500" title="Baja prioridad"></span>}
                                    
                                    <div
                                      title={`Lleva ${daysInStage} día(s) en la etapa "${item.stage}"`}
                                      className={`flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md ${isStale ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}
                                    >
                                      <Clock className="w-2.5 h-2.5 mr-1" />
                                      {daysInStage}d aquí
                                    </div>
                                    {fmtArrivalShort(item.submittedAt) && (
                                      <div
                                        title={`Postulación recibida el ${fmtArrivalFull(item.submittedAt)}`}
                                        className="flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-600"
                                      >
                                        <Calendar className="w-2.5 h-2.5 mr-1" />
                                        {fmtArrivalShort(item.submittedAt)}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {/* Open the candidate's CV in a floating window, right from the card. */}
                                    <button
                                      type="button"
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (cv.url) setCvPreview({ url: cv.url, name: item.candidateName || 'Candidato', fileType: cv.fileType });
                                      }}
                                      disabled={!cv.url}
                                      title={cv.url ? 'Ver el currículum en una ventana' : 'CV aún no disponible'}
                                      className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${
                                        cv.url
                                          ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                      }`}
                                    >
                                      <FileText className="w-3 h-3" />
                                      {cv.url ? 'Ver CV' : 'Sin CV'}
                                    </button>
                                    {/* The whole card opens the profile; this is just the hint. */}
                                    <span title="Abrir el perfil" className="text-violet-600 bg-violet-50 p-1 rounded-md">
                                      <User className="w-3 h-3" />
                                    </span>
                                  </div>
                                </div>

                                {/* This stage's WhatsApp: red notice + "Reintentar" if it couldn't
                                    go out, or a quiet "en cola" line while it waits. */}
                                <CandidateWhatsAppState
                                  compact
                                  candidateId={item.candidateId}
                                  phone={candidates[item.candidateId]?.phone || item.phone}
                                  stage={item.stage}
                                  vacancy={vacancy?.title}
                                />

                                {/* ¿Vino a la entrevista? Solo aparece en quien fue convocado.
                                    El clic no abre el perfil ni arrastra la tarjeta. */}
                                <InterviewAttendanceButton
                                  app={item}
                                  participantStatus={participants.get(item.id)?.status}
                                  compact
                                  onMarked={(status) => setApplications(prev => prev.map(a => (
                                    a.id === item.id
                                      ? { ...a, interviewAttendance: status ? { ...(a.interviewAttendance || {}), status } : null }
                                      : a
                                  )))}
                                />

                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
          </div>
        </DragDropContext>
      </div>

      {/* Bulk Action Bar */}
      {selectedApps.size > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white px-5 py-3 lg:px-6 lg:py-4 rounded-2xl shadow-2xl z-50 flex flex-col sm:flex-row items-center gap-3 lg:gap-5 animate-fade-in-up border border-slate-800">
          <div className="flex items-center gap-2">
            <div className="bg-violet-500 text-white w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs">
              {selectedApps.size}
            </div>
            <span className="font-medium text-sm text-slate-200">
              candidatos
            </span>
          </div>
          
          <div className="h-4 w-px bg-slate-700 hidden sm:block"></div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto text-sm">
            <span className="text-slate-400">Mover a:</span>
            <select 
              className="bg-slate-800 text-white border border-slate-700 rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-500 w-full sm:w-auto font-medium disabled:opacity-50"
              onChange={(e) => handleBulkMove(e.target.value)}
              value=""
              disabled={bulkActionLoading}
            >
              <option value="" disabled>{bulkActionLoading ? 'Procesando...' : 'Selecciona etapa...'}</option>
              {PIPELINE_STAGES.map(stage => (
                <option key={stage} value={stage}>{stage}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowMoveVacancy(true)}
            disabled={bulkActionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-xl text-sm font-bold disabled:opacity-50 whitespace-nowrap"
          >
            <ArrowRightLeft className="w-4 h-4" /> Otra vacante
          </button>

          <button 
            onClick={() => setSelectedApps(new Set())}
            disabled={bulkActionLoading}
            className="hidden sm:flex p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <MoveVacancyModal
        isOpen={showMoveVacancy}
        onClose={() => setShowMoveVacancy(false)}
        apps={applications.filter(a => selectedApps.has(a.id))}
        onDone={() => setSelectedApps(new Set())}
      />

      {/* Bulk Upload Modal */}
      <BulkCvUploadModal
        isOpen={isBulkUploadModalOpen}
        onClose={() => setIsBulkUploadModalOpen(false)}
        subtitle="Sube múltiples CVs para esta vacante y añade los datos que ya conozcas; la IA completa el resto."
        uploadEntries={uploadBulkEntries}
      />

      {bulkNotifyModal}

      {/* WhatsApp delivery report after a bulk move — who didn't get the message + retry. */}
      <WhatsAppSendReport
        report={sendReport}
        retrying={retryingSends}
        onRetry={retryFailedSends}
        onClose={() => setSendReport(null)}
      />

      {/* CV preview — floating window in the same tab. */}
      <CvPreviewModal cv={cvPreview} onClose={() => setCvPreview(null)} />

      {/* Floating notices: right-middle, never block clicks elsewhere (pointer-events-none
          on the rail), fade out on their own; click one to dismiss it early. */}
      <div className="fixed right-3 lg:right-5 top-1/2 -translate-y-1/2 z-[120] flex flex-col items-end gap-2 pointer-events-none max-w-[85vw] sm:max-w-sm">
        {toasts.map(t => (
          <div
            key={t.id}
            onClick={() => dismissToast(t.id)}
            role="status"
            className={`pointer-events-auto cursor-pointer flex items-start gap-2.5 pl-3.5 pr-4 py-3 rounded-xl shadow-xl border text-xs lg:text-sm font-semibold transition-all duration-300 ${
              t.leaving ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'
            } ${
              t.kind === 'success' ? 'bg-white border-emerald-200 text-slate-700'
              : t.kind === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            {t.kind === 'success' && <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />}
            {t.kind === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />}
            {t.kind === 'error' && <X className="w-5 h-5 text-rose-500 shrink-0" />}
            <span className="leading-snug">{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
