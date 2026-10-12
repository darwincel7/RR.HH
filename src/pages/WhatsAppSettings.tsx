import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, CheckCircle, XCircle, RefreshCw, Save, MessageSquare, Building2, Image as ImageIcon, Upload, ShieldCheck, UserCheck, UserX, Clock, Inbox, RotateCcw, Trash2, Shuffle, Eye, EyeOff, Moon, Timer } from 'lucide-react';
import { DEFAULT_WA_TEMPLATES } from '../lib/whatsappTemplates';
import { countVariations, variationProblem, renderMessage, seededRandom } from '../lib/messageVariation';
import { formatWindowHour } from '../lib/sendWindow';

export default function WhatsAppSettings() {
  const { isAdmin, user } = useAuth();
  const [teamUsers, setTeamUsers] = useState<any[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [teamBusy, setTeamBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  
  const [companyName, setCompanyName] = useState('');
  const [companyLogoUrl, setCompanyLogoUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [careersImageUrl, setCareersImageUrl] = useState('');
  const [uploadingCareersImage, setUploadingCareersImage] = useState(false);
  const careersFileInputRef = useRef<HTMLInputElement>(null);

  // Defaults (with {a|b} variations) come from the same module the sender uses, so the
  // editor and what actually goes out can never drift apart again.
  const [templates, setTemplates] = useState<Record<string, string>>({ ...DEFAULT_WA_TEMPLATES });
  // Last saved version, to tell the recruiter when edits are still unsaved.
  const savedTemplatesRef = useRef<string>(JSON.stringify(DEFAULT_WA_TEMPLATES));
  // Per-stage preview: absent = hidden; a number = the seed of the example shown.
  const [previewSeeds, setPreviewSeeds] = useState<Record<string, number>>({});

  const fetchStatus = async () => {
    try {
      // watch=qr marks a human present on THIS page (where the QR shows): the server
      // then keeps regenerating expired QRs instead of pausing after 3 unattended ones.
      const res = await apiFetch('/api/whatsapp/status?watch=qr');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await res.json();
        setStatus(data);
      } else {
        throw new Error("Received non-JSON response");
      }
    } catch (error) {
      console.error("Error fetching WhatsApp status:", error);
      setStatus({ status: 'disconnected', qr: null });
    }
  };

  const fetchSettings = async () => {
    try {
      // Fetch WhatsApp templates
      const docRef = doc(db, 'settings', 'whatsapp_templates');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists() && docSnap.data().templates) {
        const merged = { ...DEFAULT_WA_TEMPLATES, ...docSnap.data().templates };
        setTemplates(merged);
        savedTemplatesRef.current = JSON.stringify(merged);
      }
      
      // Fetch Company Profile
      const companyRef = doc(db, 'settings', 'company');
      const companySnap = await getDoc(companyRef);
      if (companySnap.exists()) {
        setCompanyName(companySnap.data().name || '');
        setCompanyLogoUrl(companySnap.data().logoUrl || '');
        setCareersImageUrl(companySnap.data().careersImageUrl || '');
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleReconnect = async () => {
    try {
      setStatus({ status: 'disconnected', qr: null });
      await apiFetch('/api/whatsapp/reconnect', { method: 'POST' });
      fetchStatus();
    } catch (error) {
      console.error("Error reconnecting:", error);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm("¿Seguro que deseas cerrar la sesión de WhatsApp? Tendrás que volver a escanear el código QR.")) return;
    try {
      setStatus({ status: 'disconnected', qr: null });
      await apiFetch('/api/whatsapp/logout', { method: 'POST' });
      fetchStatus();
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  // ---- Message queue viewer ----
  const [outbox, setOutbox] = useState<{
    pending: any[]; failed: any[];
    maxQueueHours?: number;
    previousQueue?: { cutoff: string; discarded: number };
  } | null>(null);
  const [outboxLoading, setOutboxLoading] = useState(false);
  const [outboxBusy, setOutboxBusy] = useState<string | null>(null);

  const fetchOutbox = async () => {
    setOutboxLoading(true);
    try {
      const res = await apiFetch('/api/whatsapp/outbox');
      if (res.ok) setOutbox(await res.json());
    } catch (e) {
      console.error('Error cargando la cola de mensajes:', e);
    } finally {
      setOutboxLoading(false);
    }
  };

  const outboxAction = async (id: string, action: 'retry' | 'dismiss') => {
    setOutboxBusy(id);
    try {
      const res = await apiFetch('/api/whatsapp/outbox/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as any));
        alert(d?.error || 'No se pudo completar la acción.');
      }
      await fetchOutbox();
    } catch {
      alert('No se pudo completar la acción.');
    } finally {
      setOutboxBusy(null);
    }
  };

  // Refresh the queue view whenever the server-side pending count changes (it only
  // changes when the queue actually moves, so this stays cheap) — plus the manual
  // refresh button in the card.
  useEffect(() => {
    if (status) fetchOutbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.pending]);

  // Row label for a pending message's state.
  const pendingLabel = (m: any): string => {
    if (m.status === 'sending') return 'Enviando…';
    if (m.nextAttemptAt && new Date(m.nextAttemptAt).getTime() > Date.now()) {
      return `Reintenta ${fmtDate(m.nextAttemptAt) || 'pronto'}`;
    }
    return 'En cola';
  };

  // ---- Team access management (admin only) ----
  const fetchTeam = async () => {
    setLoadingTeam(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      // Only real staff accounts belong here. Anonymous applicants (public candidates)
      // have no email — filter out that legacy pollution so the list shows real people.
      const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setTeamUsers(all.filter((u: any) => u.email && String(u.email).trim() !== ''));
    } catch (e) {
      console.error('Error loading team:', e);
    } finally {
      setLoadingTeam(false);
    }
  };

  useEffect(() => {
    if (isAdmin) fetchTeam();
  }, [isAdmin]);

  const isRecruiterUser = (u: any) => Array.isArray(u.roleIds) && (u.roleIds.includes('recruiter') || u.roleIds.includes('admin'));

  // Friendly date+time for when a person requested access (createdAt). Older accounts
  // created before this was tracked simply have no date.
  const fmtDate = (ts: any): string | null => {
    try {
      const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      if (!d || isNaN(d.getTime())) return null;
      return d.toLocaleString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    } catch { return null; }
  };

  const approveUser = async (id: string) => {
    setTeamBusy(id);
    try {
      await updateDoc(doc(db, 'users', id), { roleIds: ['recruiter'], status: 'active' });
      await fetchTeam();
    } catch (e) {
      console.error(e); alert('No se pudo aprobar. Intenta de nuevo.');
    } finally { setTeamBusy(null); }
  };

  // Block durably (roleIds cleared + status 'blocked') instead of deleting the doc,
  // so the person cannot simply sign in again to reappear as "pending".
  const revokeUser = async (id: string) => {
    if (!confirm('¿Quitar el acceso de esta persona? No podrá entrar al panel.')) return;
    setTeamBusy(id);
    try {
      await updateDoc(doc(db, 'users', id), { roleIds: [], status: 'blocked' });
      await fetchTeam();
    } catch (e) {
      console.error(e); alert('No se pudo revocar. Intenta de nuevo.');
    } finally { setTeamBusy(null); }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert("El logo es demasiado grande. Por favor, sube una imagen de menos de 2MB.");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      setUploadingLogo(true);
      // Upload to Cloud Storage via the backend (same as the team photo) and keep only
      // the URL. Embedding the base64 in the settings doc bloated every page load and
      // broke the DB migration (fields >1500 bytes are rejected on import).
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch('/api/company/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setCompanyLogoUrl(data.url);
    } catch (error) {
      console.error("Error uploading logo:", error);
      alert("Error al subir el logo. Por favor, inténtalo de nuevo.");
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleCareersImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Team photos can be large; upload to Firebase Storage (not Firestore) up to 5MB.
    if (file.size > 5 * 1024 * 1024) {
      alert("La imagen es demasiado grande. Por favor, sube una foto de menos de 5MB.");
      if (careersFileInputRef.current) careersFileInputRef.current.value = '';
      return;
    }

    try {
      setUploadingCareersImage(true);
      // Read as base64 and let the backend store it via the Admin SDK (bypasses
      // Storage security rules — no public-write rule needed on the bucket).
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch('/api/company/careers-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setCareersImageUrl(data.url);
    } catch (error) {
      console.error("Error uploading careers image:", error);
      alert("Error al subir la imagen. Por favor, inténtalo de nuevo.");
    } finally {
      setUploadingCareersImage(false);
      if (careersFileInputRef.current) careersFileInputRef.current.value = '';
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      // Save templates
      await setDoc(doc(db, 'settings', 'whatsapp_templates'), { templates }, { merge: true });
      savedTemplatesRef.current = JSON.stringify(templates);
      
      // Save company profile
      await setDoc(doc(db, 'settings', 'company'), {
        name: companyName,
        logoUrl: companyLogoUrl,
        careersImageUrl: careersImageUrl
      }, { merge: true });
      
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Error al guardar la configuración");
    } finally {
      setSaving(false);
    }
  };

  const templatesDirty = JSON.stringify(templates) !== savedTemplatesRef.current;

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Configuración General</h1>
          <p className="text-slate-500">Gestiona el perfil de tu empresa y la conexión de WhatsApp.</p>
        </div>
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="flex items-center px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm"
        >
          {saving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
          Guardar Cambios
        </button>
      </div>
      
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl flex items-center">
          <CheckCircle className="w-5 h-5 mr-2" />
          Configuración guardada correctamente.
        </div>
      )}

      {/* Team access (admin only) */}
      {isAdmin && (() => {
        const decorated = teamUsers.map(u => ({
          ...u,
          isSelf: u.id === user?.uid,
          isOwnerAdmin: (u.email || '').toLowerCase() === 'daruingmejia@gmail.com',
        })).map(u => ({ ...u, hasAccess: isRecruiterUser(u) || u.isOwnerAdmin }));
        const reqMs = (u: any) => (u.createdAt?.toMillis ? u.createdAt.toMillis() : 0);
        const pending = decorated
          .filter(u => !u.hasAccess && u.status !== 'blocked')
          .sort((a, b) => reqMs(b) - reqMs(a)); // newest requests first
        const blocked = decorated.filter(u => !u.hasAccess && u.status === 'blocked');
        const active = decorated.filter(u => u.hasAccess);
        return (
          <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <div className="p-2 bg-violet-50 text-violet-600 rounded-lg mr-3"><ShieldCheck className="w-5 h-5" /></div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Equipo y Accesos</h2>
                  <p className="text-sm text-slate-500">Aprueba quién puede entrar al panel. Los nuevos quedan pendientes hasta que los apruebes.</p>
                </div>
              </div>
              <button onClick={fetchTeam} disabled={loadingTeam} className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors" title="Actualizar">
                {loadingTeam ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
              </button>
            </div>

            {/* Pending approvals */}
            <div className="mb-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-3 flex items-center">
                <Clock className="w-4 h-4 mr-1.5" /> Pendientes de aprobación ({pending.length})
              </h3>
              {pending.length === 0 ? (
                <p className="text-sm text-slate-400">No hay solicitudes pendientes.</p>
              ) : (
                <div className="space-y-2">
                  {pending.map(u => (
                    <div key={u.id} className="flex items-center justify-between p-3 rounded-xl border border-amber-200 bg-amber-50/50">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{u.name || 'Sin nombre'}</p>
                        <p className="text-xs text-slate-500 truncate">{u.email}</p>
                        <p className="text-[11px] text-amber-600 font-medium flex items-center mt-1">
                          <Clock className="w-3 h-3 mr-1 shrink-0" />
                          {fmtDate(u.createdAt) ? `Solicitó acceso: ${fmtDate(u.createdAt)}` : 'Fecha no registrada'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => approveUser(u.id)} disabled={teamBusy === u.id}
                          className="flex items-center px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50">
                          {teamBusy === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserCheck className="w-4 h-4 mr-1" /> Aprobar</>}
                        </button>
                        <button onClick={() => revokeUser(u.id)} disabled={teamBusy === u.id}
                          className="flex items-center px-3 py-1.5 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors disabled:opacity-50">
                          <UserX className="w-4 h-4 mr-1" /> Rechazar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active team */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center">
                <UserCheck className="w-4 h-4 mr-1.5" /> Con acceso ({active.length})
              </h3>
              <div className="space-y-2">
                {active.map(u => (
                  <div key={u.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {u.name || 'Sin nombre'}
                        {u.isSelf && <span className="ml-2 text-xs font-medium text-slate-400">(tú)</span>}
                        {u.isOwnerAdmin && <span className="ml-2 px-2 py-0.5 text-[10px] font-bold bg-violet-100 text-violet-700 rounded-full">ADMIN</span>}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{u.email}</p>
                      {fmtDate(u.createdAt) && (
                        <p className="text-[11px] text-slate-400 flex items-center mt-1">
                          <Clock className="w-3 h-3 mr-1 shrink-0" /> Se unió: {fmtDate(u.createdAt)}
                        </p>
                      )}
                    </div>
                    {!u.isSelf && !u.isOwnerAdmin && (
                      <button onClick={() => revokeUser(u.id)} disabled={teamBusy === u.id}
                        className="flex items-center px-3 py-1.5 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors disabled:opacity-50 shrink-0">
                        {teamBusy === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserX className="w-4 h-4 mr-1" /> Quitar acceso</>}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Blocked */}
            {blocked.length > 0 && (
              <div className="mt-6 pt-6 border-t border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center">
                  <UserX className="w-4 h-4 mr-1.5" /> Bloqueados ({blocked.length})
                </h3>
                <div className="space-y-2">
                  {blocked.map(u => (
                    <div key={u.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50 opacity-90">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-500 line-through truncate">{u.name || 'Sin nombre'}</p>
                        <p className="text-xs text-slate-400 truncate">{u.email}</p>
                      </div>
                      <button onClick={() => approveUser(u.id)} disabled={teamBusy === u.id}
                        className="flex items-center px-3 py-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50 shrink-0">
                        {teamBusy === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserCheck className="w-4 h-4 mr-1" /> Re-aprobar</>}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Company Profile */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-6">
        <div className="flex items-center mb-6">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg mr-3">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">Perfil de la Empresa (Branding)</h2>
            <p className="text-sm text-slate-500">Esta información será visible para los candidatos en el portal de empleo.</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Nombre de la Empresa</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Ej. TechCorp Solutions"
              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">URL del Logo (Opcional)</label>
            <div className="flex flex-col space-y-3">
              <div className="flex items-center">
                <div className="relative flex-1">
                  <ImageIcon className="w-5 h-5 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={companyLogoUrl}
                    onChange={(e) => setCompanyLogoUrl(e.target.value)}
                    placeholder="https://ejemplo.com/logo.png"
                    className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                  />
                </div>
                {companyLogoUrl && (
                  <div className="ml-4 w-12 h-12 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center flex-shrink-0">
                    <img src={companyLogoUrl} alt="Logo" className="max-w-full max-h-full object-contain" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  </div>
                )}
              </div>
              <div className="flex items-center">
                <span className="text-sm text-slate-500 mr-3">O sube un archivo:</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  ref={fileInputRef}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingLogo}
                  className="flex items-center px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {uploadingLogo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  {uploadingLogo ? 'Subiendo...' : 'Subir Logo'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Foto del equipo (Portal público de empleo) */}
        <div className="mt-6 pt-6 border-t border-slate-100">
          <label className="block text-sm font-bold text-slate-700 mb-1">Foto del equipo (Portal público de empleo)</label>
          <p className="text-xs text-slate-500 mb-3">
            Se muestra como imagen principal en la página pública de vacantes (<span className="font-mono">/careers</span>). Recomendado: horizontal, mínimo 1200px de ancho. Máx 5MB.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <ImageIcon className="w-5 h-5 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={careersImageUrl}
                  onChange={(e) => setCareersImageUrl(e.target.value)}
                  placeholder="https://ejemplo.com/equipo.jpg  (o sube un archivo)"
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
              </div>
              <div className="mt-3 flex items-center">
                <span className="text-sm text-slate-500 mr-3">O sube una foto:</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleCareersImageUpload}
                  ref={careersFileInputRef}
                  className="hidden"
                />
                <button
                  onClick={() => careersFileInputRef.current?.click()}
                  disabled={uploadingCareersImage}
                  className="flex items-center px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {uploadingCareersImage ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  {uploadingCareersImage ? 'Subiendo...' : 'Subir Foto'}
                </button>
              </div>
            </div>
            {careersImageUrl && (
              <div className="w-full sm:w-64 aspect-video rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex-shrink-0">
                <img src={careersImageUrl} alt="Foto del equipo" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Estado de la conexión</h2>
            <p className="text-sm text-slate-500">Conecta tu cuenta para enviar mensajes automáticos.</p>
          </div>
          <div className="flex items-center">
            {status?.status === 'connected' ? (
              <span className="flex items-center text-green-600 font-bold bg-green-50 px-3 py-1 rounded-full text-sm">
                <CheckCircle className="w-4 h-4 mr-2" /> Conectado
              </span>
            ) : status?.status === 'qr' ? (
              <span className="flex items-center text-yellow-600 font-bold bg-yellow-50 px-3 py-1 rounded-full text-sm">
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Esperando escaneo
              </span>
            ) : (
              <span className="flex items-center text-red-600 font-bold bg-red-50 px-3 py-1 rounded-full text-sm">
                <XCircle className="w-4 h-4 mr-2" /> Desconectado
              </span>
            )}
          </div>
        </div>

        {status?.status === 'qr' && status.qr && (
          <div className="flex flex-col items-center p-8 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
            <p className="mb-4 text-sm font-bold text-slate-700">Escanea este código con tu WhatsApp:</p>
            <img src={status.qr} alt="WhatsApp QR Code" className="w-64 h-64 shadow-lg rounded-xl" />
            <p className="mt-6 text-xs text-slate-500 text-center max-w-xs font-medium">
              Abre WhatsApp en tu teléfono {'>'} Dispositivos vinculados {'>'} Vincular un dispositivo.
            </p>
          </div>
        )}

        {status?.status === 'connected' && (
          <div className="bg-green-50 border border-green-100 p-4 rounded-xl flex items-start justify-between">
            <div className="flex items-start">
              <CheckCircle className="text-green-500 mt-0.5 mr-3 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-green-800">¡Todo listo!</p>
                <p className="text-sm text-green-700 mt-1 font-medium">
                  La aplicación está vinculada a tu WhatsApp. Ya puedes enviar mensajes desde los perfiles de los candidatos.
                </p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="ml-4 px-4 py-2 border border-red-200 text-red-600 bg-white rounded-lg hover:bg-red-50 text-sm font-medium transition-colors whitespace-nowrap"
            >
              Cerrar Sesión
            </button>
          </div>
        )}

        {status?.status === 'disconnected' && !status.qr && (
          <div className="text-center p-8">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600 mb-4" />
            <p className="text-slate-600 font-medium mb-2">La conexión de WhatsApp está suspendida o en conflicto.</p>
            <p className="text-slate-400 text-sm mb-5">Si "Forzar Reconexión" no muestra el QR, usa "Desvincular y generar QR nuevo" para empezar de cero.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleReconnect}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4 mr-2" /> Forzar Reconexión
              </button>
              <button
                onClick={handleLogout}
                className="inline-flex items-center px-4 py-2 border border-red-200 text-red-600 bg-white rounded-lg hover:bg-red-50 font-medium transition-colors"
              >
                <XCircle className="w-4 h-4 mr-2" /> Desvincular y generar QR nuevo
              </button>
            </div>
          </div>
        )}

        {/* Anti-ban pacing: surface what the engine already enforces, so a waiting
            queue reads as "protection working" instead of "something is broken". */}
        {status?.pacing && (
          <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center mb-3">
              <ShieldCheck className="w-4 h-4 text-emerald-600 mr-2" />
              <h3 className="text-sm font-bold text-slate-700">Protección anti-bloqueo del número</h3>
            </div>
            {status.pacing.quarantineUntil && (
              <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3 font-medium">
                ⏳ Número recién vinculado: los mensajes automáticos están en <b>pausa preventiva</b> hasta
                {' '}{fmtDate(status.pacing.quarantineUntil) || 'dentro de unas horas'}. El chat manual sí funciona.
                Los mensajes en cola saldrán solos — no hay que hacer nada.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <p className="text-xs text-slate-500 font-medium">Enviados hoy</p>
                <p className="text-lg font-bold text-slate-800">
                  {status.pacing.sentToday}
                  <span className="text-sm font-medium text-slate-400"> / {status.pacing.dailyLimit}</span>
                </p>
                <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.round((100 * (status.pacing.sentToday || 0)) / Math.max(1, status.pacing.dailyLimit || 1)))}%` }}
                  />
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <p className="text-xs text-slate-500 font-medium">En cola ahora</p>
                <p className="text-lg font-bold text-slate-800">{status.pending || 0}</p>
                <p className="text-[11px] text-slate-400 mt-1">máx. {status.pacing.hourlyLimit}/hora</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <p className="text-xs text-slate-500 font-medium">Número vinculado</p>
                <p className="text-sm font-bold text-slate-800 mt-1">{fmtDate(status.pacing.linkedAt) || '—'}</p>
              </div>
            </div>
            {(status.pacing.sendWindow || status.pacing.autoPerHour) && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {status.pacing.autoPerHour && (
                  <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-start">
                    <Timer className="w-4 h-4 text-indigo-500 mr-2 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-500 font-medium">Ritmo de los mensajes automáticos</p>
                      <p className="text-sm font-bold text-slate-800">
                        ~1 por minuto, con pausas irregulares (≈{status.pacing.autoPerHour}/hora)
                      </p>
                      {status.pacing.nextAutoSendAt && (
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Próximo automático: {new Date(status.pacing.nextAutoSendAt).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {status.pacing.sendWindow && (
                  <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-start">
                    <Moon className="w-4 h-4 text-indigo-500 mr-2 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-500 font-medium">Horario de envío (hora de RD)</p>
                      <p className="text-sm font-bold text-slate-800">
                        {status.pacing.sendWindow.start === 0 && status.pacing.sendWindow.end === 24
                          ? 'Todo el día'
                          : `${formatWindowHour(status.pacing.sendWindow.start)} – ${formatWindowHour(status.pacing.sendWindow.end)}`}
                      </p>
                      <p className={`text-[11px] mt-0.5 font-medium ${status.pacing.sendWindow.open ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {status.pacing.sendWindow.open
                          ? 'Ahora: dentro del horario'
                          : `Ahora: fuera de horario — los automáticos salen desde ${fmtDate(status.pacing.sendWindow.opensAt) || 'la mañana'}`}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-3">
              El límite diario sube solo a medida que el número gana antigüedad. Los mensajes automáticos salen uno a uno,
              con una redacción distinta para cada candidato y solo dentro del horario; el chat manual no espera. Si la cola
              espera, es la protección trabajando — no una falla: nada se pierde.
            </p>
          </div>
        )}
      </div>

      {/* Message queue */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <div className="flex items-center">
            <Inbox className="w-5 h-5 text-blue-600 mr-2" />
            <h2 className="text-lg font-bold text-slate-800">Cola de mensajes</h2>
          </div>
          <button
            onClick={fetchOutbox}
            disabled={outboxLoading}
            className="inline-flex items-center px-3 py-1.5 border border-slate-200 text-slate-600 bg-white rounded-lg hover:bg-slate-50 text-sm font-medium transition-colors"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${outboxLoading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        </div>
        <div className="p-6 space-y-5">
          {outbox && (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              Los mensajes del pasado no se envían: lo que estaba en cola antes del {fmtDate(outbox.previousQueue?.cutoff) || '12 oct 2026'} se
              descartó{outbox.previousQueue?.discarded ? ` (${outbox.previousQueue.discarded} mensaje(s))` : ''}, y un mensaje que no logra salir
              en {outbox.maxQueueHours || 48} h vence y aparece abajo en "Fallidos" (con Reintentar, por si todavía aplica).
            </p>
          )}
          {!outbox ? (
            <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
          ) : outbox.pending.length === 0 && outbox.failed.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">
              No hay mensajes en espera ni fallidos. Todo lo encolado ya se entregó. ✅
            </p>
          ) : (
            <>
              {outbox.pending.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-slate-700 mb-2">En espera ({outbox.pending.length})</h3>
                  <ul className="border border-slate-100 rounded-lg divide-y divide-slate-100">
                    {outbox.pending.map((m: any) => (
                      <li key={m.id} className="px-3 py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">
                            {m.candidateName || m.phone}
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">{m.origin === 'manual' ? 'Manual' : 'Automático'}{m.stage ? ` · ${m.stage}` : ''}</span>
                          </p>
                          <p className="text-xs text-slate-500 truncate">{m.preview}</p>
                        </div>
                        <span className="shrink-0 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 px-2 py-1 rounded-full">
                          {pendingLabel(m)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {outbox.failed.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-rose-700 mb-2">Fallidos ({outbox.failed.length})</h3>
                  <ul className="border border-rose-100 rounded-lg divide-y divide-rose-50">
                    {outbox.failed.map((m: any) => (
                      <li key={m.id} className="px-3 py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">
                            {m.candidateName || m.phone}
                            <span className="ml-2 text-[10px] text-slate-400">{fmtDate(m.createdAt) || ''}</span>
                          </p>
                          <p className="text-xs text-slate-500 truncate">{m.preview}</p>
                          <p className="text-xs text-rose-600 font-medium mt-0.5">{m.lastError || 'Falló el envío'}{m.attempts ? ` · ${m.attempts} intento(s)` : ''}</p>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          {outboxBusy === m.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                          ) : (
                            <>
                              <button
                                onClick={() => outboxAction(m.id, 'retry')}
                                title="Volver a intentar el envío"
                                className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium border border-slate-200 text-slate-700 bg-white rounded-lg hover:bg-slate-50 transition-colors"
                              >
                                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reintentar
                              </button>
                              <button
                                onClick={() => outboxAction(m.id, 'dismiss')}
                                title="Quitar de la lista (no se enviará)"
                                className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium border border-rose-200 text-rose-600 bg-white rounded-lg hover:bg-rose-50 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-1" /> Descartar
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-slate-400 mt-2">
                    "El candidato pidió no recibir mensajes" y "El número no tiene WhatsApp" no se resuelven reintentando:
                    contacta por correo o corrige el teléfono en el perfil y envía desde ahí.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Templates */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex flex-wrap gap-3 justify-between items-center bg-slate-50">
          <div className="flex items-center">
            <MessageSquare className="w-5 h-5 text-green-600 mr-2" />
            <h2 className="text-lg font-bold text-slate-800">Plantillas por Etapa</h2>
          </div>
          {templatesDirty && (
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Guardar plantillas
            </button>
          )}
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg">
            <h3 className="text-sm font-bold text-blue-900 mb-2">Variables dinámicas disponibles:</h3>
            <div className="flex flex-wrap gap-2">
              {['{{primer_nombre}}', '{{nombre}}', '{{empresa}}', '{{vacante}}', '{{link}}', '{{fecha}}', '{{hora}}', '{{ubicacion}}'].map(v => (
                <span key={v} className="px-2 py-1 bg-white border border-blue-200 text-blue-700 text-xs font-mono rounded shadow-sm">{v}</span>
              ))}
            </div>
            <p className="text-xs text-blue-800/80 mt-2">
              <span className="font-mono">{'{{primer_nombre}}'}</span> saluda solo por el nombre ("Hola María"), como lo haría una persona.
            </p>
          </div>

          <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-lg">
            <h3 className="text-sm font-bold text-emerald-900 mb-1 flex items-center">
              <Shuffle className="w-4 h-4 mr-1.5" /> Variaciones: que ningún mensaje salga idéntico
            </h3>
            <p className="text-xs text-emerald-800 leading-relaxed">
              Escribe opciones entre llaves separadas por <span className="font-mono font-bold">|</span> y el sistema elige una
              distinta para cada candidato. Ejemplo: <span className="font-mono bg-white px-1 rounded">{'{Hola|Saludos|Buenas} {{primer_nombre}}'}</span>.
              Enviar exactamente el mismo texto a muchas personas a la vez es una de las señales que WhatsApp usa para bloquear
              números; con variaciones, cada mensaje sale con una redacción diferente.
            </p>
          </div>

          {(Object.entries(templates) as [string, string][]).map(([stage, template]) => {
            const variants = countVariations(template);
            const problem = variationProblem(template);
            const recommended = DEFAULT_WA_TEMPLATES[stage];
            const seed = previewSeeds[stage];
            return (
              <div key={stage}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <label className="block text-sm font-bold text-slate-700">{stage}</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {variants > 1 ? (
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                        ✓ {variants >= 1000 ? 'Más de 1.000' : variants} versiones distintas
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                        ⚠️ Todos reciben el mismo texto
                      </span>
                    )}
                    <button
                      onClick={() => setPreviewSeeds(prev => {
                        const next = { ...prev };
                        if (stage in next) delete next[stage]; else next[stage] = Date.now();
                        return next;
                      })}
                      className="inline-flex items-center px-2 py-1 text-xs font-medium border border-slate-200 text-slate-600 bg-white rounded-lg hover:bg-slate-50"
                    >
                      {seed !== undefined ? <EyeOff className="w-3.5 h-3.5 mr-1" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
                      {seed !== undefined ? 'Ocultar vista previa' : 'Vista previa'}
                    </button>
                    {recommended && template !== recommended && (
                      <button
                        onClick={() => {
                          if (window.confirm(`¿Reemplazar la plantilla de "${stage}" por la versión recomendada (con variaciones)?\n\nLuego pulsa "Guardar plantillas".`)) {
                            setTemplates({ ...templates, [stage]: recommended });
                          }
                        }}
                        className={`inline-flex items-center px-2 py-1 text-xs font-bold rounded-lg ${variants > 1 ? 'border border-slate-200 text-slate-600 bg-white hover:bg-slate-50' : 'text-white bg-emerald-600 hover:bg-emerald-700'}`}
                      >
                        <Shuffle className="w-3.5 h-3.5 mr-1" /> Usar versión recomendada
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm"
                  rows={5}
                  value={template}
                  onChange={e => setTemplates({ ...templates, [stage]: e.target.value })}
                />
                {problem && <p className="text-xs font-medium text-rose-600 mt-1">{problem}</p>}
                {seed !== undefined && (
                  <div className="mt-2 bg-emerald-50/60 border border-emerald-100 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold text-slate-500">Así le llegaría a un candidato (ejemplo)</span>
                      {variants > 1 && (
                        <button
                          onClick={() => setPreviewSeeds(prev => ({ ...prev, [stage]: (prev[stage] || 0) + 1 }))}
                          className="inline-flex items-center text-[11px] font-bold text-emerald-700 hover:text-emerald-900"
                        >
                          <Shuffle className="w-3.5 h-3.5 mr-1" /> Otra versión
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-slate-800 whitespace-pre-wrap">
                      {renderMessage(template, {
                        nombre: 'MARÍA PÉREZ',
                        vacante: 'Vendedor(a) de tienda',
                        empresa: companyName || 'Darwin Cell',
                        link: `${window.location.origin}/eval/ejemplo`,
                        fecha: 'jueves 15 de octubre',
                        hora: '10:00 a. m.',
                        ubicacion: 'Calle Duarte #10, Baní',
                      }, seededRandom(seed))}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
