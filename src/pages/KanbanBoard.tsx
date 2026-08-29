import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc, updateDoc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { db, storage, auth } from '../lib/firebase';
import { PIPELINE_STAGES, STAGE_INFO } from '../constants/stages';
import { Loader2, User, Star, Clock, Sparkles, X, Check, UploadCloud, Upload, FileText, Calendar, MapPin, AlertTriangle, CheckCircle } from 'lucide-react';

import { sendWhatsAppAutomation, stageMayAutoSend, stageNeedsScheduling, getWhatsAppStatus, sleep, SEND_SPACING_MS } from '../lib/whatsapp';
import Modal from '../components/ui/Modal';
import WhatsAppSendReport from '../components/WhatsAppSendReport';
import { requestCvWorkerRun } from '../lib/api';
import { getKanbanOrder, computeDropOrder } from '../lib/kanbanOrder';
import BulkCvUploadModal, { type BulkEntry } from '../components/BulkCvUploadModal';
import { normalizePhone } from '../lib/phone';

export default function KanbanBoard() {
  const { vacancyId } = useParams();
  const navigate = useNavigate();
  const [vacancy, setVacancy] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  // CV preview modal (floating window) — shown in-place instead of a new tab.
  const [cvPreview, setCvPreview] = useState<{ url: string; name: string; fileType?: string } | null>(null);

  // Bulk selection state
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  // Post-bulk-move WhatsApp delivery report (who did NOT get the automated message).
  const [sendReport, setSendReport] = useState<{ stage: string; sent: number; failed: any[] } | null>(null);
  const [retryingSends, setRetryingSends] = useState(false);

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
  // These stages send a dated interview invitation built from the schedule above.
  const INTERVIEW_STAGES = ['Convocado a entrevista', 'Entrevista presencial'];
  const isInterviewStage = (s: string) => INTERVIEW_STAGES.includes(s);

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
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const apps = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as any[];
      setApplications(apps);
      
      // Fetch candidate details for all apps
      const candidateIds = [...new Set(apps.map(a => a.candidateId))];
      const candidatesData: Record<string, any> = {};
      
      await Promise.all(candidateIds.map(async (cId) => {
        if (!cId) return;
        const cSnap = await getDoc(doc(db, 'candidates', cId));
        if (cSnap.exists()) {
          candidatesData[cId] = cSnap.data();
        }
      }));
      
      setCandidates(prev => ({ ...prev, ...candidatesData }));
      setLoading(false);
    });

    return () => unsubscribe();
  }, [vacancyId]);

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

    // PRE-FLIGHT: convoking to an interview requires a future schedule set above.
    if (isInterviewStage(targetStage)) {
      const st = scheduleStatus();
      if (!st.valid) {
        showToast('warning', st.isPast
          ? '⚠️ La fecha de entrevista de arriba YA PASÓ. Ponla a futuro antes de convocar.'
          : '📅 Antes de convocar, indica arriba la fecha, hora y lugar de la entrevista.', 6000);
        setBulkActionLoading(false);
        return;
      }
    }

    // PRE-FLIGHT: if this stage sends an automatic WhatsApp, verify the connection
    // BEFORE moving anyone. Better to stop the whole batch than to move candidates
    // whose messages will silently fail (a half-notified batch confuses the process).
    if (stageMayAutoSend(targetStage)) {
      const wa = await getWhatsAppStatus();
      if (!wa.connected) {
        // With the durable outbox, a disconnected socket does NOT lose messages: they
        // queue server-side and go out on reconnection. Say so instead of scaring.
        const proceed = window.confirm(wa.outbox
          ? `📨 WhatsApp está desconectado en este momento.\n\nLos mensajes de los ${appsToMove.length} candidato(s) quedarán EN COLA y se enviarán solos en cuanto WhatsApp se reconecte. No se pierde ninguno.\n\n¿Continuar?`
          : `⚠️ WhatsApp está DESCONECTADO.\n\nSi mueves los ${appsToMove.length} candidato(s) ahora, los mensajes automáticos NO se enviarán.\n\nRecomendado: pulsa Cancelar, conecta WhatsApp en Configuración y vuelve a intentarlo.\n\n¿Mover de todas formas SIN enviar mensajes?`
        );
        if (!proceed) { setBulkActionLoading(false); return; }
      }
    }

    let movedCount = 0;
    let sentCount = 0;
    let queuedCount = 0;
    const failedSends: any[] = [];
    const failed: string[] = [];

    // Process each candidate independently so one failure doesn't abort the whole batch.
    for (const movedApp of appsToMove) {
      try {
        // 1. Update the stage in Firestore (this is the source of truth for the move).
        const appRef = doc(db, 'applications', movedApp.id);
        await updateDoc(appRef, {
          stage: targetStage,
          lastStageUpdate: serverTimestamp()
        });
        movedCount++;

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
            const r = await sendWhatsAppAutomation(phone, targetStage, vars);
            if (r.status === 'sent') sentCount++;
            if (r.status === 'queued') queuedCount++;
            if (r.status === 'failed') {
              failedSends.push({ id: movedApp.id, name: movedApp.candidateName || 'Sin nombre', phone: phone || '—', vars });
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
          failedSends.push({ id: movedApp.id, name: movedApp.candidateName || 'Sin nombre', phone: knownPhone || '—', vars: { nombre: movedApp.candidateName, vacante: vacancy?.title, link: '', email: candidates[movedApp.candidateId]?.email || '' } });
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
        queuedCount > 0 ? `${queuedCount} WhatsApp en cola (se envían solos)` : '',
      ].filter(Boolean).join(' · ');
      showToast('success', `${movedCount} candidato(s) movidos a "${targetStage}"${parts ? ` · ${parts}` : ''}`, 4500);
      if (stageNeedsScheduling(targetStage) && !isInterviewStage(targetStage)) {
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
        const r = await sendWhatsAppAutomation(f.phone, sendReport.stage, f.vars);
        if (r.status === 'failed') still.push(f);
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

    // BLOCK convoking to an interview when the schedule above is missing or already past.
    // Returning before the optimistic update makes the card snap back to its origin.
    if (!sameColumn && isInterviewStage(newStage)) {
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
    if (!sameColumn) showToast('success', `${movedApp.candidateName} → ${newStage}`, 2600);

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
        lastStageUpdate: serverTimestamp()
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
      if (stageNeedsScheduling(newStage) && !isInterviewStage(newStage)) {
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

  if (loading) return <div className="flex h-full items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-violet-600" /></div>;

  // Filter applications based on search term
  const filteredApplications = applications.filter(app => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const candidate = candidates[app.candidateId] || {};
    
    return (
      app.candidateName?.toLowerCase().includes(term) ||
      candidate.phone?.toLowerCase().includes(term) ||
      candidate.email?.toLowerCase().includes(term) ||
      candidate.city?.toLowerCase().includes(term) ||
      candidate.aiExtraction?.relevant_experience_summary?.toLowerCase().includes(term)
    );
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
    <div className="h-[calc(100vh-5rem)] lg:h-[calc(100vh-7rem)] flex flex-col animate-fade-in relative">
      <div className="mb-4 lg:mb-8 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-3xl font-display font-bold text-slate-900 tracking-tight flex items-center">
            <Sparkles className="w-5 h-5 lg:w-6 lg:h-6 text-violet-500 mr-2" />
            Embudo: {vacancy?.title}
          </h1>
          <p className="text-slate-500 text-xs lg:text-sm mt-0.5 font-medium">Arrastra tarjetas o usa la selección múltiple para mover.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <button
            onClick={() => setIsBulkUploadModalOpen(true)}
            className="flex items-center justify-center px-4 py-2 bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs lg:text-sm font-bold rounded-xl hover:bg-indigo-100 transition-colors shadow-sm"
          >
            <UploadCloud className="w-4 h-4 mr-2" />
            Subir CVs
          </button>
          <div className="relative flex-1 sm:flex-none">
            <input
              type="text"
              placeholder="Buscar candidato..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-48 lg:w-64 pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none transition-all shadow-sm"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <Link
            to={`/vacancies/${vacancyId}/ranking`}
            className="px-4 py-2 bg-slate-900 text-white text-xs lg:text-sm font-bold rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 hover:-translate-y-0.5 whitespace-nowrap text-center"
          >
            Ver Ranking Final
          </Link>
        </div>
      </div>

      {/* Interview schedule for this vacancy — the invitation sent when convoking a
          candidate uses this date/time/place, and a past date blocks the move. */}
      {(() => {
        const st = scheduleStatus();
        return (
          <div className="mb-4 bg-white rounded-2xl border border-slate-200 p-3 lg:p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2.5">
              <Calendar className="w-4 h-4 text-violet-600" />
              <h3 className="text-xs lg:text-sm font-bold text-slate-700">Agenda de entrevista para esta vacante</h3>
              <span className="text-[10px] text-slate-400 hidden sm:inline">— se usa al convocar candidatos a entrevista</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Fecha</label>
                <input type="date" min={todayStr} value={schedDate} onChange={(e) => setSchedDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Hora</label>
                <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Lugar / Modalidad</label>
                <input type="text" value={schedLocation} onChange={(e) => setSchedLocation(e.target.value)}
                  placeholder="Ej: Tienda Baní, o Google Meet"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
              </div>
              <div className="flex items-end">
                <button onClick={saveSchedule} disabled={savingSchedule}
                  className="w-full px-4 py-2 bg-violet-600 text-white text-sm font-bold rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50">
                  {savingSchedule ? 'Guardando…' : 'Guardar agenda'}
                </button>
              </div>
            </div>
            {st.isSet && (
              st.isPast ? (
                <p className="mt-2.5 text-xs font-bold text-rose-600 flex items-center">
                  <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> Esta fecha y hora YA PASARON. Ponla a futuro — no podrás convocar candidatos con una fecha vencida.
                </p>
              ) : (
                <p className="mt-2.5 text-xs font-medium text-emerald-600 flex items-center flex-wrap">
                  <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Entrevista: {st.dt && fmtFecha(st.dt)} · {st.dt && fmtHora(st.dt)}
                  {schedLocation && <span className="flex items-center ml-1"><MapPin className="w-3 h-3 mx-1" /> {schedLocation}</span>}
                </p>
              )
            )}
          </div>
        );
      })()}

      {/* Columns grow with their content and the PAGE scrolls vertically — no tiny
          per-column scrollbar. Sibling columns still stretch to the tallest one so
          the drop zone keeps covering the whole column. */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-2">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex h-full space-x-4 lg:space-x-6 min-w-max px-1">
            {columns.map(column => (
              <div key={column.id} className="flex-shrink-0 w-72 lg:w-80 flex flex-col h-full">
                <div className="mb-1.5 flex justify-between items-center px-1">
                  <h3 className="font-display font-bold text-slate-700 text-[10px] lg:text-xs uppercase tracking-widest">{column.title}</h3>
                  <div className="flex items-center gap-2">
                    <button
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
                    </button>
                    <span className="bg-white border border-slate-200 text-slate-600 py-0.5 px-2 rounded-full text-[10px] font-bold shadow-sm">
                      {column.items.length}
                    </span>
                  </div>
                </div>

                {/* Subtle one-liner: what this stage means and why it exists. */}
                <p className="mb-2.5 px-1 text-[9px] lg:text-[10px] text-slate-400 leading-snug" title={STAGE_INFO[column.id]}>
                  {STAGE_INFO[column.id]}
                </p>

                <Droppable droppableId={column.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 overflow-y-auto p-2 lg:p-3 min-h-[150px] rounded-2xl lg:rounded-3xl transition-all duration-300 ${
                        snapshot.isDraggingOver ? 'bg-violet-50/50 border-2 border-dashed border-violet-300' : 'bg-slate-100/50 border-2 border-transparent'
                      }`}
                    >
                      {column.items.map((item, index) => {
                        const daysInStage = getDaysInStage(item.lastStageUpdate, item.submittedAt);
                        const isStale = daysInStage > 5;
                        const isSelected = selectedApps.has(item.id);

                        return (
                          // @ts-ignore - React 18 types issue with @hello-pangea/dnd
                          <Draggable draggableId={item.id} index={index} key={item.id}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                onClick={() => navigate(`/candidates/${item.candidateId}`)}
                                className={`relative glass-card p-3 lg:p-5 rounded-xl lg:rounded-2xl mb-3 transition-all duration-300 cursor-pointer hover:ring-2 hover:ring-violet-300 ${
                                  snapshot.isDragging ? 'shadow-2xl ring-2 ring-violet-500 scale-105 rotate-2' : ''
                                } ${isStale ? 'border-l-4 border-l-orange-500' : ''} ${isSelected ? 'ring-2 ring-violet-500 bg-violet-50/30' : ''}`}
                              >
                                
                                {/* Selection checkbox: generous hit area (~48px) with a clear
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
                                  className="absolute top-0 right-0 z-10 p-3 cursor-pointer rounded-tr-xl rounded-bl-2xl hover:bg-violet-100/80 transition-colors group/check"
                                >
                                  <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all shadow-sm ${
                                    isSelected
                                      ? 'bg-violet-500 border-violet-500 text-white'
                                      : 'bg-white border-slate-300 text-transparent group-hover/check:border-violet-500 group-hover/check:scale-110'
                                  }`}>
                                    <Check className="w-4 h-4" />
                                  </div>
                                </div>

                                <div className="flex justify-between items-start mb-2 pr-10">
                                  <h4 className="text-sm lg:text-base font-display font-bold text-slate-900 line-clamp-1">{item.candidateName}</h4>
                                  {item.scoreSummary && (
                                    <span className="flex items-center text-[10px] font-black text-white bg-gradient-ai px-1.5 py-0.5 rounded-md shadow-sm">
                                      <Star className="w-2.5 h-2.5 mr-1 fill-current" />
                                      {item.scoreSummary}
                                    </span>
                                  )}
                                </div>
                                
                                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
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
                                  <div className="text-[10px] text-violet-600 font-bold flex items-center bg-violet-50 px-2 py-1 rounded-md">
                                    <User className="w-2.5 h-2.5 mr-1" />
                                    Perfil
                                  </div>
                                </div>

                                {/* Open the candidate's CV directly from the card. */}
                                {(() => {
                                  const cvUrl = candidates[item.candidateId]?.cvUrl || item.cvUrl;
                                  return (
                                    <button
                                      type="button"
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (cvUrl) setCvPreview({ url: cvUrl, name: item.candidateName || 'Candidato', fileType: candidates[item.candidateId]?.cvFileType || item.cvFileType });
                                      }}
                                      disabled={!cvUrl}
                                      title={cvUrl ? 'Ver el currículum en una ventana' : 'CV aún no disponible'}
                                      className={`mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-bold py-2 rounded-lg transition-colors ${
                                        cvUrl
                                          ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                      }`}
                                    >
                                      <FileText className="w-3.5 h-3.5" />
                                      {cvUrl ? 'Ver Currículum' : 'CV no disponible'}
                                    </button>
                                  );
                                })()}
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
            onClick={() => setSelectedApps(new Set())}
            disabled={bulkActionLoading}
            className="hidden sm:flex p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Bulk Upload Modal */}
      <BulkCvUploadModal
        isOpen={isBulkUploadModalOpen}
        onClose={() => setIsBulkUploadModalOpen(false)}
        subtitle="Sube múltiples CVs para esta vacante y añade los datos que ya conozcas; la IA completa el resto."
        uploadEntries={uploadBulkEntries}
      />

      {/* WhatsApp delivery report after a bulk move — who didn't get the message + retry. */}
      <WhatsAppSendReport
        report={sendReport}
        retrying={retryingSends}
        onRetry={retryFailedSends}
        onClose={() => setSendReport(null)}
      />

      {/* CV preview — floating window in the same tab. Closes on X, Escape, or click outside. */}
      <Modal isOpen={!!cvPreview} onClose={() => setCvPreview(null)} closeOnBackdrop overlayClassName="bg-slate-900/60 z-[110]">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-scale-in">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-5 h-5 text-indigo-600 shrink-0" />
              <h3 className="font-bold text-slate-800 truncate">Currículum — {cvPreview?.name}</h3>
            </div>
            <div className="flex items-center gap-1.5">
              <a
                href={cvPreview?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                Abrir aparte
              </a>
              <button
                onClick={() => setCvPreview(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                title="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 bg-slate-100 min-h-0">
            {cvPreview && (
              <iframe
                src={cvPreview.fileType?.includes('word') || cvPreview.fileType === 'application/msword'
                  ? `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(cvPreview.url)}`
                  : cvPreview.url}
                title="Currículum"
                className="w-full h-full border-0"
              />
            )}
          </div>
        </div>
      </Modal>

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
