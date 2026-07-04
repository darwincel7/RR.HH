import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc, updateDoc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { db, storage, auth } from '../lib/firebase';
import { PIPELINE_STAGES } from '../constants/stages';
import { Loader2, User, Star, Clock, Sparkles, X, Check, UploadCloud, Upload, FileText } from 'lucide-react';

import { sendWhatsAppAutomation, stageMayAutoSend, isWhatsAppConnected, sleep, SEND_SPACING_MS } from '../lib/whatsapp';
import Modal from '../components/ui/Modal';
import WhatsAppSendReport from '../components/WhatsAppSendReport';

export default function KanbanBoard() {
  const { vacancyId } = useParams();
  const navigate = useNavigate();
  const [vacancy, setVacancy] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  // CV preview modal (floating window) — shown in-place instead of a new tab.
  const [cvPreview, setCvPreview] = useState<{ url: string; name: string } | null>(null);

  // Bulk selection state
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  // Post-bulk-move WhatsApp delivery report (who did NOT get the automated message).
  const [sendReport, setSendReport] = useState<{ stage: string; sent: number; failed: any[] } | null>(null);
  const [retryingSends, setRetryingSends] = useState(false);

  // Bulk upload state
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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

    // PRE-FLIGHT: if this stage sends an automatic WhatsApp, verify the connection
    // BEFORE moving anyone. Better to stop the whole batch than to move candidates
    // whose messages will silently fail (a half-notified batch confuses the process).
    if (stageMayAutoSend(targetStage)) {
      const connected = await isWhatsAppConnected();
      if (!connected) {
        const proceed = window.confirm(
          `⚠️ WhatsApp está DESCONECTADO.\n\nSi mueves los ${appsToMove.length} candidato(s) ahora, los mensajes automáticos NO se enviarán.\n\nRecomendado: pulsa Cancelar, conecta WhatsApp en Configuración y vuelve a intentarlo.\n\n¿Mover de todas formas SIN enviar mensajes?`
        );
        if (!proceed) { setBulkActionLoading(false); return; }
      }
    }

    let movedCount = 0;
    let sentCount = 0;
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
              email: candSnap.data().email
            };
            const r = await sendWhatsAppAutomation(phone, targetStage, vars);
            if (r.status === 'sent') sentCount++;
            if (r.status === 'failed') {
              failedSends.push({ id: movedApp.id, name: movedApp.candidateName || 'Sin nombre', phone: phone || '—', vars });
            }
            // Space consecutive sends: gentler on WhatsApp and avoids burst-flagging.
            if (phone && r.status !== 'skipped') await sleep(SEND_SPACING_MS);
          }
        } catch (autoErr) {
          console.error(`Automation failed for ${movedApp.id} (stage saved anyway):`, autoErr);
          failedSends.push({ id: movedApp.id, name: movedApp.candidateName || 'Sin nombre', phone: '—', vars: { nombre: movedApp.candidateName, vacante: vacancy?.title, link: '', email: '' } });
        }
      } catch (err) {
        console.error(`Error moving application ${movedApp.id}:`, err);
        failed.push(movedApp.candidateName || movedApp.id);
      }
    }

    setSelectedApps(new Set()); // Clear selection
    setBulkActionLoading(false);

    if (failed.length > 0) {
      alert(`Movidos ${movedCount}. No se pudieron mover ${failed.length}: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}. Revisa tus permisos.`);
    }
    if (failedSends.length > 0) {
      // Show exactly WHO didn't get the message, with one-click retry.
      setSendReport({ stage: targetStage, sent: sentCount, failed: failedSends });
    } else if (failed.length === 0) {
      alert(`✅ ${movedCount} candidato(s) movidos exitosamente a "${targetStage}".${sentCount > 0 ? ` ${sentCount} mensaje(s) de WhatsApp enviados.` : ''}`);
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
        else if (r.status === 'sent') sentNow++;
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

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !vacancyId) return;

    const files = Array.from(e.target.files) as File[];
    const validFiles = files.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf') || f.type.includes('word') || f.name.endsWith('.docx'));
    
    if (validFiles.length === 0) {
      alert("Por favor selecciona archivos PDF o Word.");
      return;
    }

    if (validFiles.length > 50) {
      alert("Por favor no subas más de 50 archivos a la vez para no saturar el sistema.");
      return;
    }
    
    setIsUploading(true);
    setUploadProgress(0);

    try {
      let completed = 0;
      
      // Upload in chunks of 5 to dramatically speed up the process without hitting rate limits
      const chunkSize = 5;
      for (let i = 0; i < validFiles.length; i += chunkSize) {
        const chunk = validFiles.slice(i, i + chunkSize);
        
        await Promise.all(chunk.map(async (file) => {
          // 1. Create a candidate record
          const candidateId = doc(collection(db, 'candidates')).id;
          
          // 2. Upload file to storage (folder = uploading recruiter's uid)
          const fileExt = file.name.split('.').pop() || 'pdf';
          const uploaderUid = auth.currentUser?.uid || candidateId;
          const storageRef = ref(storage, `cvs/${uploaderUid}/${candidateId}_bulk_${Date.now()}.${fileExt}`);
          await uploadBytes(storageRef, file);
          const cvUrl = await getDownloadURL(storageRef);

          // 3 & 4. Save candidate shell + application atomically so a failure never
          // leaves an orphaned candidate without its application (or vice versa).
          const applicationId = `${candidateId}_${vacancyId}`;
          const batch = writeBatch(db);
          batch.set(doc(db, 'candidates', candidateId), {
            fullName: `Procesando: ${file.name}`,
            email: '',
            phone: '',
            city: '',
            cvUrl,
            cvFileType: file.type || 'application/pdf',
            aiStatus: 'pending', // This triggers our background CV processor cron
            createdAt: serverTimestamp()
          });
          batch.set(doc(db, 'applications', applicationId), {
            candidateId,
            vacancyId: vacancyId,
            vacancyTitle: vacancy?.title || '',
            candidateName: `Procesando: ${file.name}`,
            stage: 'Nuevo',
            cvUrl,
            cvFileType: file.type || 'application/pdf',
            submittedAt: serverTimestamp(),
            lastStageUpdate: serverTimestamp()
          });
          await batch.commit();

          completed++;
        }));
        
        setUploadProgress(Math.round((completed / validFiles.length) * 100));
      }
      
      // Close and clean
      setTimeout(() => {
        setIsUploading(false);
        setIsBulkUploadModalOpen(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }, 1000);

    } catch (error) {
      console.error("Bulk upload error:", error);
      alert("Error al subir los CVs. Revisa la consola o asegúrate de que tienes conexión.");
      setIsUploading(false);
    }
  };

  // Position of a card inside its column: an explicit kanbanOrder (set when the
  // recruiter drops a card at a specific spot) wins; otherwise fall back to the
  // application date so existing boards keep a stable, sensible order.
  const getKanbanOrder = (app: any): number => {
    if (typeof app.kanbanOrder === 'number') return app.kanbanOrder;
    const t: any = app.submittedAt;
    return t?.toMillis ? t.toMillis() : (t?.toDate ? t.toDate().getTime() : 0);
  };

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newStage = destination.droppableId;
    const sameColumn = destination.droppableId === source.droppableId;
    const movedApp = applications.find(a => a.id === draggableId);
    if (!movedApp) return;

    // The card takes the exact slot where it was dropped: its new order is the
    // midpoint between its two neighbors in the destination column AS RENDERED
    // (filteredApplications — same list the Draggables index against — without the
    // dragged card, matching how the library reports destination.index).
    const destItems = filteredApplications
      .filter(app => app.stage === newStage && app.id !== draggableId)
      .sort((a, b) => getKanbanOrder(a) - getKanbanOrder(b));
    const prevItem = destItems[destination.index - 1];
    const nextItem = destItems[destination.index];
    let newOrder: number;
    if (prevItem && nextItem) newOrder = (getKanbanOrder(prevItem) + getKanbanOrder(nextItem)) / 2;
    else if (prevItem) newOrder = getKanbanOrder(prevItem) + 100000;
    else if (nextItem) newOrder = getKanbanOrder(nextItem) - 100000;
    else newOrder = Date.now();

    // Optimistic UI update
    const previousApps = [...applications];
    setApplications(prev => prev.map(app =>
      app.id === draggableId ? { ...app, stage: newStage, kanbanOrder: newOrder } : app
    ));

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
            email: candSnap.data().email
          });
          // The move already succeeded; only warn (don't revert) if the message failed.
          if (r.status === 'failed') {
            alert('El candidato se movió, pero NO se pudo enviar el WhatsApp. Revisa la conexión de WhatsApp en Configuración.');
          }
        }
      }
    } catch (error) {
      console.error("Error updating stage:", error);
      setApplications(previousApps); // Revert UI
      alert("Error al mover el candidato. Verifica tus permisos.");
    }
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
      .sort((a, b) => getKanbanOrder(a) - getKanbanOrder(b))
  })).filter(col => col.items.length > 0 || ['Nuevo', 'Aplicó', 'Precalificado', 'Revisión humana', 'Entrevista presencial', 'Contratado', 'Descartado'].includes(col.id)); // Show populated columns + some default ones

  return (
    <div className="h-[calc(100vh-5rem)] lg:h-[calc(100vh-8rem)] flex flex-col animate-fade-in relative">
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

      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-2">
        <DragDropContext onDragEnd={onDragEnd}>
          {/* Columns stretch to full height so the drop zone covers the WHOLE column —
              a card can be dropped at the top, middle, bottom or on the empty area. */}
          <div className="flex h-full space-x-4 lg:space-x-6 min-w-max px-1">
            {columns.map(column => (
              <div key={column.id} className="flex-shrink-0 w-72 lg:w-80 flex flex-col h-full">
                <div className="mb-3 flex justify-between items-center px-1">
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
                                    
                                    <div className={`flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md ${isStale ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>
                                      <Clock className="w-2.5 h-2.5 mr-1" />
                                      {daysInStage}d
                                    </div>
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
                                        if (cvUrl) setCvPreview({ url: cvUrl, name: item.candidateName || 'Candidato' });
                                      }}
                                      disabled={!cvUrl}
                                      title={cvUrl ? 'Abrir currículum en una pestaña nueva' : 'CV aún no disponible'}
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
      <Modal isOpen={isBulkUploadModalOpen} onClose={isUploading ? undefined : () => setIsBulkUploadModalOpen(false)} overlayClassName="bg-slate-900/40 z-[100]">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl relative animate-scale-in">
            <button 
              onClick={() => setIsBulkUploadModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
              disabled={isUploading}
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-slate-800 mb-2 flex items-center">
              <UploadCloud className="w-6 h-6 mr-2 text-violet-600" />
              Subida Masiva de CVs
            </h2>
            <p className="text-slate-500 mb-6 text-sm">
              Sube múltiples currículums (PDF o Word) a la vez para analizarlos e integrarlos a esta vacante.
            </p>

            <div 
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${isUploading ? 'border-violet-300 bg-violet-50' : 'border-slate-300 hover:border-violet-400 hover:bg-slate-50'}`}
              onClick={() => !isUploading && fileInputRef.current?.click()}
            >
              {isUploading ? (
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 mb-4 bg-violet-100 rounded-full flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-violet-600 animate-spin" />
                  </div>
                  <h3 className="font-bold text-slate-800 mb-1">Subiendo y Procesando CVs...</h3>
                  <p className="text-sm text-slate-500 mb-4">Por favor no cierres esta ventana</p>
                  
                  <div className="w-full bg-slate-200 rounded-full h-2 mb-2">
                    <div 
                      className="bg-violet-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-bold text-violet-600">{uploadProgress}% Completado</span>
                </div>
              ) : (
                <div className="cursor-pointer">
                  <div className="w-12 h-12 mb-4 bg-violet-100 rounded-full flex items-center justify-center mx-auto">
                    <Upload className="w-6 h-6 text-violet-600" />
                  </div>
                  <h3 className="font-bold text-slate-800 mb-1">Haz clic para buscar los archivos</h3>
                  <p className="text-sm text-slate-500">Puedes seleccionar hasta 50 archivos a la vez</p>
                  <p className="text-xs text-slate-400 mt-2">Formatos sportados: .pdf, .doc, .docx</p>
                </div>
              )}
            </div>
            
            <input 
              type="file" 
              multiple 
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleBulkUpload}
              disabled={isUploading}
            />

          </div>
      </Modal>

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
              <iframe src={cvPreview.url} title="Currículum" className="w-full h-full border-0" />
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
