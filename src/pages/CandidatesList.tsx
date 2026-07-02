import React, { useState, useEffect, useRef } from 'react';
import { collection, query, where, getDocs, getDoc, doc, writeBatch, setDoc, serverTimestamp, orderBy, limit, startAfter } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, auth } from '../lib/firebase';
import { sendWhatsAppAutomation } from '../lib/whatsapp';
import { Users, Search, Filter, Download, Star, ExternalLink, Trash2, AlertTriangle, MapPin, UploadCloud, CheckSquare, X, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import Modal from '../components/ui/Modal';
import { PIPELINE_STAGES } from '../constants/stages';

export default function CandidatesList() {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [expFilter, setExpFilter] = useState('');
  const [candidateToDelete, setCandidateToDelete] = useState<{id: string, name: string} | null>(null);

  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const PAGE_SIZE = 100;
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Once the whole base has been pulled (for search/filter/export) we stop paginating
  // and operate over the full in-memory set.
  const [fullyLoaded, setFullyLoaded] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);

  // Mirror of `candidates` readable synchronously inside loadAll's guard/fallback,
  // avoiding a stale closure without adding it to loadAll's dependencies.
  const candidatesRef = useRef<any[]>([]);
  useEffect(() => { candidatesRef.current = candidates; }, [candidates]);

  // Joins an application doc with its candidate + vacancy and computes the blended score.
  // Shared by the paginated fetch and the full-base load so both produce identical rows.
  const buildRows = (appDocs: any[], vacMap: Map<string, any>, candMap: Map<string, any>) =>
    appDocs.map(d => {
      const app = { id: d.id, ...d.data() } as any;
      const cData = candMap.get(app.candidateId) || {};

      let totalScore = 0;
      let stagesCompleted = 0;
      if (app.scoreSummary !== undefined && app.scoreSummary !== null) { totalScore += (app.scoreSummary * 20); stagesCompleted++; }
      if (app.stage2Scoring?.total_score !== undefined && app.stage2Scoring?.total_score !== null) { totalScore += app.stage2Scoring.total_score; stagesCompleted++; }
      if (app.interviewObservation?.score !== undefined && app.interviewObservation?.score !== null) { totalScore += (app.interviewObservation.score * 20); stagesCompleted++; }
      if (app.testResults?.score !== undefined && app.testResults?.score !== null) { totalScore += app.testResults.score; stagesCompleted++; }
      const calculatedTotalScore = stagesCompleted > 0 ? Math.round(totalScore / stagesCompleted) : 0;

      return {
        ...app,
        vacancyTitle: vacMap.get(app.vacancyId) || 'Desconocida',
        email: cData.email || '',
        phone: cData.phone || '',
        city: cData.city || '',
        aiExtraction: cData.aiExtraction || null,
        aiStatus: cData.aiStatus || null,
        calculatedTotalScore
      };
    });

  // Paginated: loads the most recent PAGE_SIZE applications and appends on "load more"
  // instead of downloading the entire collection. Contact info is fetched only for the
  // applications on the current page.
  const fetchCandidates = async (reset = true) => {
    try {
      reset ? setLoading(true) : setLoadingMore(true);

      // Vacancy titles (few docs)
      const vacSnap = await getDocs(collection(db, 'vacancies'));
      const vacMap = new Map();
      vacSnap.docs.forEach(d => vacMap.set(d.id, d.data().title));

      // One page of applications, newest first
      const appsCol = collection(db, 'applications');
      const cursor = reset ? null : lastDoc;
      const qy = cursor
        ? query(appsCol, orderBy('submittedAt', 'desc'), startAfter(cursor), limit(PAGE_SIZE))
        : query(appsCol, orderBy('submittedAt', 'desc'), limit(PAGE_SIZE));
      const appSnap = await getDocs(qy);
      const appDocs = appSnap.docs;
      setHasMore(appDocs.length === PAGE_SIZE);
      if (appDocs.length > 0) setLastDoc(appDocs[appDocs.length - 1]);

      // Contact info for THIS page's candidates only
      const candIds = Array.from(new Set(appDocs.map(d => d.data().candidateId).filter(Boolean)));
      const candSnaps = await Promise.all(candIds.map(id => getDoc(doc(db, 'candidates', id))));
      const candMap = new Map();
      candSnaps.forEach(s => { if (s.exists()) candMap.set(s.id, s.data()); });

      const combined = buildRows(appDocs, vacMap, candMap);

      // Already ordered by the query (submittedAt desc); append pages on "load more".
      setCandidates(prev => reset ? combined : [...prev, ...combined]);
    } catch (error) {
      console.error("Error fetching candidates:", error);
    } finally {
      reset ? setLoading(false) : setLoadingMore(false);
    }
  };

  // Pulls the ENTIRE base (all applications + candidates) in three collection reads so
  // search, filters and CSV export cover every historical candidate — not just the
  // paginated window. Runs once per page visit; subsequent calls are a no-op.
  const loadAll = async (force = false): Promise<any[]> => {
    if (fullyLoaded && !force) return candidatesRef.current;
    setLoadingAll(true);
    try {
      const [vacSnap, appSnap, candSnap] = await Promise.all([
        getDocs(collection(db, 'vacancies')),
        getDocs(query(collection(db, 'applications'), orderBy('submittedAt', 'desc'))),
        getDocs(collection(db, 'candidates')),
      ]);
      const vacMap = new Map();
      vacSnap.docs.forEach(d => vacMap.set(d.id, d.data().title));
      const candMap = new Map();
      candSnap.docs.forEach(d => candMap.set(d.id, d.data()));

      const combined = buildRows(appSnap.docs, vacMap, candMap);
      setCandidates(combined);
      setHasMore(false);
      setLastDoc(null);
      setFullyLoaded(true);
      return combined;
    } catch (error) {
      console.error("Error loading full base:", error);
      return candidatesRef.current;
    } finally {
      setLoadingAll(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
  }, []);

  const anyFilterActive = !!(searchTerm || stageFilter || cityFilter || expFilter);

  // Refresh after a mutation (delete / bulk move / bulk upload). If we were already
  // showing the full base (or a filter is active), re-pull everything so the view stays
  // consistent; otherwise just reload the first page.
  const refresh = () => {
    if (fullyLoaded || anyFilterActive) {
      loadAll(true);
    } else {
      fetchCandidates(true);
    }
  };

  // As soon as the recruiter starts searching or filtering, pull the whole base once so
  // the results span all history instead of only the loaded page(s).
  useEffect(() => {
    if (anyFilterActive && !fullyLoaded && !loadingAll) {
      loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyFilterActive]);

  const handleDelete = async () => {
    if (!candidateToDelete) return;
    
    try {
      // Delete the candidate AND all of its applications atomically in a single batch.
      // Query only the candidate's own applications instead of scanning the whole collection.
      const appSnap = await getDocs(
        query(collection(db, 'applications'), where('candidateId', '==', candidateToDelete.id))
      );
      const batch = writeBatch(db);
      batch.delete(doc(db, 'candidates', candidateToDelete.id));
      appSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();

      setCandidateToDelete(null);
      refresh(); // Refresh list
    } catch (error) {
      console.error("Error deleting candidate:", error);
      alert("Error al eliminar el candidato");
    }
  };

  const handleBulkMove = async (newStage: string) => {
    if (!newStage || selectedApps.length === 0) return;
    setBulkActionLoading(true);
    try {
      const batch = writeBatch(db);
      const appsToMove = candidates.filter(c => selectedApps.includes(c.id));

      for (const app of appsToMove) {
        const appRef = doc(db, 'applications', app.id);
        batch.update(appRef, { stage: newStage, lastStageUpdate: serverTimestamp() });
      }

      await batch.commit();

      // Trigger automation per candidate. Build the link that matches the target stage
      // (the eval form for stage 2, the test for presential tests) and keep each send
      // best-effort so one failure does not block the rest.
      let whatsappFailed = 0;
      for (const app of appsToMove) {
        if (!app.phone) continue;
        try {
          let link = '';
          if (newStage === 'Tests presenciales' || newStage === 'Pruebas técnicas') {
            link = `${window.location.origin}/test/${app.id}`;
          } else if (newStage === 'Formulario etapa 2 enviado') {
            link = `${window.location.origin}/eval/${app.id}`;
          }
          const r = await sendWhatsAppAutomation(app.phone, newStage, {
            nombre: app.candidateName,
            vacante: app.vacancyTitle,
            link,
            email: app.email
          });
          if (r.status === 'failed') whatsappFailed++;
        } catch (autoErr) {
          console.error(`Automation failed for ${app.id} (stage saved anyway):`, autoErr);
          whatsappFailed++;
        }
      }

      setSelectedApps([]);
      refresh();
      if (whatsappFailed > 0) {
        alert(`Candidatos movidos. ⚠️ ${whatsappFailed} mensaje(s) de WhatsApp no se enviaron (revisa la conexión de WhatsApp en Configuración).`);
      }
    } catch (error) {
      console.error("Error bulk moving candidates:", error);
      alert("Error al mover candidatos");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    // Only CV file types (matches the Storage rule application/.*|image/.*); skip
    // others so one unsupported file can't abort the whole batch with a rules error.
    const ALLOWED = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp'];
    const allSelected = Array.from(e.target.files) as File[];
    const files = allSelected.filter(f => ALLOWED.includes(f.type));
    if (files.length === 0) {
      alert('Sube archivos PDF, Word o imagen (JPG/PNG).');
      return;
    }
    if (files.length < allSelected.length) {
      alert(`Se omitieron ${allSelected.length - files.length} archivo(s) con formato no soportado. Solo PDF, Word o imagen.`);
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      let completed = 0;
      
      const chunkSize = 5;
      for (let i = 0; i < files.length; i += chunkSize) {
        const chunk = files.slice(i, i + chunkSize);
        
        await Promise.all(chunk.map(async (file) => {
          // 1. Create a dummy candidate ID
          const candidateId = doc(collection(db, 'candidates')).id;
          
          // 2. Upload file
          const fileExt = file.name.split('.').pop() || 'pdf';
          // Folder = the uploading recruiter's uid, so Storage rules allow the write/read.
          const uploaderUid = auth.currentUser?.uid || candidateId;
          const storageRef = ref(storage, `cvs/${uploaderUid}/${candidateId}_bulk_${Date.now()}.${fileExt}`);
          await uploadBytes(storageRef, file);
          const cvUrl = await getDownloadURL(storageRef);

          // 3 & 4. Save candidate shell + application atomically (no orphans on failure).
          const applicationId = `${candidateId}_bulk`;
          const batch = writeBatch(db);
          batch.set(doc(db, 'candidates', candidateId), {
            fullName: `Procesando: ${file.name}`,
            email: '',
            phone: '',
            city: '',
            cvUrl,
            cvFileType: file.type || 'application/pdf',
            aiStatus: 'pending', // Triggers cron job
            createdAt: serverTimestamp()
          });
          batch.set(doc(db, 'applications', applicationId), {
            candidateId,
            vacancyId: 'bulk_upload',
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
        
        setUploadProgress(Math.round((completed / files.length) * 100));
      }
      
      // Close and refresh
      setTimeout(() => {
        setIsUploading(false);
        setIsBulkUploadModalOpen(false);
        refresh();
      }, 1000);

    } catch (error) {
      console.error("Bulk upload error:", error);
      alert("Error al subir los CVs masivos.");
      setIsUploading(false);
    }
  };

  // Single source of truth for the active search + filters, applied to the on-screen list
  // and to the CSV export alike.
  function matchesFilters(c: any) {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      c.candidateName?.toLowerCase().includes(term) ||
      c.email?.toLowerCase().includes(term) ||
      c.phone?.toLowerCase().includes(term) ||
      c.aiExtraction?.relevant_experience_summary?.toLowerCase().includes(term) ||
      c.aiExtraction?.strengths_detected?.some((s: string) => s.toLowerCase().includes(term));

    const matchesStage = stageFilter ? c.stage === stageFilter : true;

    const matchesCity = cityFilter
      ? c.city?.toLowerCase().includes(cityFilter.toLowerCase()) || c.aiExtraction?.city?.toLowerCase().includes(cityFilter.toLowerCase())
      : true;

    const expYears = c.aiExtraction?.experience_total_years || 0;
    const matchesExp = expFilter ? expYears >= parseInt(expFilter) : true;

    return matchesSearch && matchesStage && matchesCity && matchesExp;
  }

  const [exporting, setExporting] = useState(false);

  const exportToCSV = async () => {
    setExporting(true);
    // Export the WHOLE base (respecting active filters), not just the loaded window.
    let rows: any[];
    try {
      const full = await loadAll();
      rows = full.filter(matchesFilters);
    } finally {
      setExporting(false);
    }

    const headers = ['Nombre', 'Email', 'Teléfono', 'Vacante', 'Etapa', 'Score Total', 'Fecha Aplicación'];
    const csvContent = [
      headers.join(','),
      ...rows.map(c => {
        const date = c.submittedAt?.toDate ? c.submittedAt.toDate().toLocaleDateString() : '';
        return [
          `"${c.candidateName}"`,
          `"${c.email}"`,
          `"${c.phone}"`,
          `"${c.vacancyTitle}"`,
          `"${c.stage}"`,
          c.calculatedTotalScore,
          `"${date}"`
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'base_candidatos.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredCandidates = candidates.filter(matchesFilters);

  // Stage options are the canonical pipeline (always complete, even before the full base
  // loads); cities are collected from whatever is currently in memory.
  const uniqueStages = [...new Set([...PIPELINE_STAGES, ...candidates.map(c => c.stage).filter(Boolean)])];
  const uniqueCities = [...new Set(candidates.map(c => c.city || c.aiExtraction?.city).filter(Boolean))];

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center">
            <Users className="w-6 h-6 mr-2 text-indigo-600" />
            Base de Candidatos Global
          </h1>
          <p className="text-slate-500">
            Talent Pool. Al buscar o filtrar se incluye todo el histórico.
            {fullyLoaded && <span className="text-slate-400"> · {candidates.length} candidatos</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsBulkUploadModalOpen(true)}
            className="flex items-center px-4 py-2 bg-indigo-50 border border-indigo-100 text-indigo-700 text-sm font-bold rounded-lg hover:bg-indigo-100 transition-colors shadow-sm"
          >
            <UploadCloud className="w-4 h-4 mr-2" />
            Subida Masiva CVs
          </button>
          <button
            onClick={exportToCSV}
            disabled={exporting}
            className="flex items-center px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4 mr-2" />
            {exporting ? 'Exportando…' : 'Exportar CSV'}
          </button>
        </div>
      </div>

      {loadingAll && (
        <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
          Cargando base completa para buscar en todo el histórico…
        </div>
      )}

      {selectedApps.length > 0 && (
        <div className="bg-indigo-600 text-white rounded-xl shadow-lg p-4 flex items-center justify-between sticky top-4 z-10 animate-fade-in">
          <div className="flex items-center">
            <CheckSquare className="w-5 h-5 mr-3" />
            <span className="font-medium">{selectedApps.length} candidatos seleccionados</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-indigo-200">Acción masiva:</span>
            <select
              onChange={(e) => {
                if(e.target.value) handleBulkMove(e.target.value);
                e.target.value = ''; // reset
              }}
              disabled={bulkActionLoading}
              className="bg-white text-slate-800 text-sm rounded-lg px-3 py-1.5 font-medium outline-none disabled:opacity-50"
            >
              <option value="">-- Mover a Etapa --</option>
              <option value="Formulario etapa 2 enviado">Formulario (Etapa 2)</option>
              <option value="Convocado a entrevista">Entrevista Virtual</option>
              <option value="Entrevista presencial">Entrevista Presencial</option>
              <option value="Descartado">Descartado</option>
              <option value="Banco de talento">Banco de Talento</option>
            </select>
            <button onClick={() => setSelectedApps([])} className="p-1 hover:bg-indigo-500 rounded-md transition-colors ml-2">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <div
        className="bg-white rounded-xl shadow-sm border border-slate-200 p-4"
        onFocusCapture={() => { if (!fullyLoaded && !loadingAll) loadAll(); }}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por nombre, email, habilidades..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          
          <div className="relative">
            <Filter className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
            >
              <option value="">Todas las etapas</option>
              {uniqueStages.map(stage => (
                <option key={stage} value={stage}>{stage}</option>
              ))}
            </select>
          </div>

          <div className="relative">
            <MapPin className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
            >
              <option value="">Cualquier ciudad</option>
              {uniqueCities.map(city => (
                <option key={city as string} value={city as string}>{city}</option>
              ))}
            </select>
          </div>

          <div className="relative">
            <Star className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
            <select
              value={expFilter}
              onChange={(e) => setExpFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
            >
              <option value="">Cualquier experiencia</option>
              <option value="1">+1 año</option>
              <option value="3">+3 años</option>
              <option value="5">+5 años</option>
              <option value="10">+10 años</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider w-12">
                  <input 
                    type="checkbox" 
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedApps(filteredCandidates.map(c => c.id));
                      } else {
                        setSelectedApps([]);
                      }
                    }}
                    checked={selectedApps.length > 0 && selectedApps.length === filteredCandidates.length}
                  />
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Candidato</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Contacto</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Vacante</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Etapa Actual</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Triage / CV</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Score</th>
                <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Acción</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {filteredCandidates.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                    No se encontraron candidatos que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                filteredCandidates.map((candidate) => (
                  <tr key={candidate.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input 
                        type="checkbox" 
                        value={candidate.id}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                        checked={selectedApps.includes(candidate.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedApps([...selectedApps, candidate.id]);
                          } else {
                            setSelectedApps(selectedApps.filter(id => id !== candidate.id));
                          }
                        }}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs mr-3">
                          {candidate.candidateName?.charAt(0) || 'U'}
                        </div>
                        <div className="text-sm font-bold text-slate-800">
                          {candidate.candidateName}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-xs text-slate-600">{candidate.email}</div>
                      <div className="text-xs text-slate-500">{candidate.phone}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-700">{candidate.vacancyTitle}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 inline-flex text-[10px] font-bold rounded-full uppercase tracking-wider
                        ${candidate.stage === 'Contratado' ? 'bg-emerald-100 text-emerald-800' : 
                          candidate.stage === 'Descartado' ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'}`}>
                        {candidate.stage}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col space-y-1">
                        {candidate.aiStatus === 'pending' || candidate.aiStatus === 'processing' ? (
                          <span className="px-2 py-0.5 inline-flex text-[10px] font-bold rounded-md w-max bg-slate-100 text-slate-500">
                            Procesando CV...
                          </span>
                        ) : candidate.aiStatus === 'error' ? (
                          <span className="px-2 py-0.5 inline-flex text-[10px] font-bold rounded-md w-max bg-red-100 text-red-700">
                            Error en CV
                          </span>
                        ) : candidate.aiExtraction?.recommendation ? (
                          <span className={`px-2 py-0.5 inline-flex text-[10px] font-bold rounded-md w-max
                            ${candidate.aiExtraction.recommendation === 'advance' ? 'bg-green-100 text-green-800' : 
                              candidate.aiExtraction.recommendation === 'review' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                            {candidate.aiExtraction.recommendation === 'advance' ? 'Interesa' : 
                             candidate.aiExtraction.recommendation === 'review' ? 'Tal vez' : 'No interesa'}
                          </span>
                        ) : null}
                        
                        {candidate.aiExtraction?.initial_score_1_to_5 && (
                          <div className="flex items-center text-xs text-amber-500">
                            <Star className="w-3 h-3 fill-current mr-1" />
                            {candidate.aiExtraction.initial_score_1_to_5.toFixed(1)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-slate-800 font-black">
                        <Star className="w-4 h-4 text-amber-500 mr-1.5 fill-current" />
                        {candidate.calculatedTotalScore}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <Link 
                          to={`/candidates/${candidate.candidateId}`}
                          className="inline-flex items-center text-indigo-600 hover:text-indigo-900 bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Ver Perfil <ExternalLink className="w-3 h-3 ml-1" />
                        </Link>
                        <button
                          onClick={() => setCandidateToDelete({ id: candidate.candidateId, name: candidate.candidateName })}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Eliminar candidato"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div className="p-4 text-center border-t border-slate-100">
            <button
              onClick={() => fetchCandidates(false)}
              disabled={loadingMore}
              className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors disabled:opacity-50"
            >
              {loadingMore ? 'Cargando…' : `Cargar ${PAGE_SIZE} más`}
            </button>
            <p className="text-xs text-slate-400 mt-2">Mostrando los {candidates.length} más recientes. Al buscar o filtrar se carga todo el histórico automáticamente.</p>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!candidateToDelete} onClose={() => setCandidateToDelete(null)} overlayClassName="bg-slate-900/40 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center mb-4">
              <div className="p-2 bg-red-100 text-red-600 rounded-xl mr-3">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">Eliminar Candidato</h2>
            </div>
            <p className="text-slate-600 mb-6 text-sm">
              ¿Estás seguro de que deseas eliminar permanentemente a <strong>{candidateToDelete?.name}</strong>?
              Se eliminarán todos sus datos y postulaciones. Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setCandidateToDelete(null)}
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm"
              >
                Sí, Eliminar
              </button>
            </div>
          </div>
      </Modal>

      {/* Bulk Upload Modal */}
      <Modal isOpen={isBulkUploadModalOpen} onClose={isUploading ? undefined : () => setIsBulkUploadModalOpen(false)} overlayClassName="bg-slate-900/40 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl relative">
            <button 
              onClick={() => setIsBulkUploadModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
              disabled={isUploading}
            >
              <X className="w-6 h-6" />
            </button>
            <div className="flex items-center mb-6">
              <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl mr-3">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Subida Masiva de CVs</h2>
                <p className="text-sm text-slate-500">Sube múltiples CVs. La IA los evaluará automáticamente.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div 
                className="border-2 border-dashed border-indigo-200 rounded-xl p-8 hover:bg-indigo-50/50 transition-colors cursor-pointer text-center group"
                onClick={() => !isUploading && fileInputRef.current?.click()}
              >
                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="p-4 bg-indigo-100/50 text-indigo-600 rounded-full group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700">Haz clic para buscar los archivos</p>
                    <p className="text-xs text-slate-500 mt-1">Soporta PDF, Word, JPG, etc.</p>
                  </div>
                </div>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleBulkUpload}
                  disabled={isUploading}
                />
              </div>

              {isUploading && (
                <div className="space-y-2 mt-4">
                  <div className="flex justify-between text-sm font-bold text-slate-700">
                    <span>Subiendo archivos y procesando...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
      </Modal>
    </div>
  );
}
