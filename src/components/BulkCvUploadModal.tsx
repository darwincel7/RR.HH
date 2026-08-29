import React, { useRef, useState } from 'react';
import Modal from './ui/Modal';
import { UploadCloud, Upload, X, FileText, Plus, Sparkles, Loader2 } from 'lucide-react';

/**
 * Shared bulk-CV upload modal (used by CandidatesList and KanbanBoard).
 *
 * Adds a REVIEW step the old flow lacked: after picking files, each CV gets its own
 * optional fields (name, phone, email, city) so the recruiter can type what they
 * already know — a phone taken over the counter, a corrected name. Anything left
 * blank keeps the old behavior: the AI reads the CV and fills it in.
 *
 * The upload itself stays in each page (they differ: vacancy binding, refresh); it
 * receives the entries plus a progress callback.
 */

export interface BulkEntry {
  file: File;
  name: string;
  phone: string;
  email: string;
  city: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  subtitle: string;
  /** CandidatesList also accepts photographed CVs; the kanban is stricter. */
  acceptImages?: boolean;
  maxFiles?: number;
  uploadEntries: (entries: BulkEntry[], onProgress: (pct: number) => void) => Promise<void>;
}

const DOC_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function BulkCvUploadModal({ isOpen, onClose, subtitle, acceptImages, maxFiles = 50, uploadEntries }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<BulkEntry[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const accept = acceptImages
    ? '.pdf,.doc,.docx,image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const allowed = acceptImages ? [...DOC_TYPES, ...IMG_TYPES] : DOC_TYPES;
    // Some browsers hand over an empty MIME type; fall back to the extension.
    const byExt = (f: File) => /\.(pdf|docx?|jpe?g|png|webp)$/i.test(f.name);
    const valid = (Array.from(list) as File[]).filter(f => allowed.includes(f.type) || (!f.type && byExt(f)));
    if (valid.length === 0) {
      alert(acceptImages ? 'Sube archivos PDF, Word o imagen (JPG/PNG).' : 'Por favor selecciona archivos PDF o Word.');
      return;
    }
    setEntries(prev => {
      // Skip files already on the list (same name+size), so "add more" can't duplicate.
      const seen = new Set(prev.map(e => `${e.file.name}|${e.file.size}`));
      const fresh = valid.filter(f => !seen.has(`${f.name}|${f.size}`));
      const merged = [...prev, ...fresh.map(file => ({ file, name: '', phone: '', email: '', city: '' }))];
      if (merged.length > maxFiles) {
        alert(`Máximo ${maxFiles} archivos por tanda para no saturar el sistema. Se tomaron los primeros ${maxFiles}.`);
        return merged.slice(0, maxFiles);
      }
      return merged;
    });
  };

  const setField = (i: number, field: 'name' | 'phone' | 'email' | 'city', value: string) => {
    setEntries(prev => prev.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)));
  };

  const removeEntry = (i: number) => setEntries(prev => prev.filter((_, idx) => idx !== i));

  const reset = () => {
    setEntries([]);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    if (isUploading) return;
    reset();
    onClose();
  };

  const startUpload = async () => {
    if (entries.length === 0 || isUploading) return;
    setIsUploading(true);
    setUploadProgress(0);
    try {
      await uploadEntries(entries, pct => setUploadProgress(Math.min(100, Math.round(pct))));
      // Give the 100% bar a beat before closing, like the old flow did.
      setTimeout(() => {
        setIsUploading(false);
        reset();
        onClose();
      }, 800);
    } catch (err) {
      console.error('Bulk upload error:', err);
      alert('Error al subir los CVs. Revisa tu conexión e inténtalo de nuevo.');
      setIsUploading(false);
    }
  };

  const inputCls = 'w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white';

  return (
    <Modal isOpen={isOpen} onClose={isUploading ? undefined : handleClose} overlayClassName="bg-slate-900/40 z-[100]">
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-xl relative">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
          disabled={isUploading}
        >
          <X className="w-6 h-6" />
        </button>

        <div className="flex items-center mb-5">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl mr-3">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Subida Masiva de CVs</h2>
            <p className="text-sm text-slate-500">{subtitle}</p>
          </div>
        </div>

        {isUploading ? (
          <div className="py-8 text-center">
            <div className="w-12 h-12 mb-4 bg-indigo-100 rounded-full flex items-center justify-center mx-auto">
              <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
            </div>
            <h3 className="font-bold text-slate-800 mb-1">Subiendo {entries.length} CV(s)...</h3>
            <p className="text-sm text-slate-500 mb-4">Por favor no cierres esta ventana</p>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div className="bg-indigo-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
            <span className="text-xs font-bold text-indigo-600 mt-2 inline-block">{uploadProgress}%</span>
          </div>
        ) : entries.length === 0 ? (
          <div
            className="border-2 border-dashed border-indigo-200 rounded-xl p-8 hover:bg-indigo-50/50 transition-colors cursor-pointer text-center group"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="p-4 bg-indigo-100/50 text-indigo-600 rounded-full group-hover:scale-110 transition-transform">
                <Upload className="w-8 h-8" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Haz clic para buscar los archivos</p>
                <p className="text-xs text-slate-500 mt-1">
                  {acceptImages ? 'Soporta PDF, Word e imágenes (JPG/PNG)' : 'Soporta PDF y Word'} · hasta {maxFiles} a la vez
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xs text-slate-600 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 mb-3 flex items-start">
              <Sparkles className="w-4 h-4 mr-2 text-violet-500 shrink-0 mt-0.5" />
              <span>
                Si conoces algún dato, escríbelo aquí — ese dato manda. <strong>Lo que dejes vacío lo
                completa la IA</strong> leyendo el CV.
              </span>
            </p>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {entries.map((e, i) => (
                <div key={`${e.file.name}|${e.file.size}`} className="border border-slate-200 rounded-xl p-3 bg-slate-50/60">
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center text-xs font-bold text-slate-700 truncate">
                      <FileText className="w-3.5 h-3.5 mr-1.5 text-indigo-500 shrink-0" />
                      <span className="truncate">{e.file.name}</span>
                    </span>
                    <button onClick={() => removeEntry(i)} className="text-slate-400 hover:text-rose-500 shrink-0 ml-2" title="Quitar este CV">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className={inputCls} placeholder="Nombre completo (opcional)" value={e.name} onChange={ev => setField(i, 'name', ev.target.value)} />
                    <input className={inputCls} placeholder="Teléfono (opcional)" value={e.phone} onChange={ev => setField(i, 'phone', ev.target.value)} />
                    <input className={inputCls} placeholder="Correo (opcional)" value={e.email} onChange={ev => setField(i, 'email', ev.target.value)} />
                    <input className={inputCls} placeholder="Ciudad (opcional)" value={e.city} onChange={ev => setField(i, 'city', ev.target.value)} />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center text-sm font-bold text-indigo-600 hover:text-indigo-800"
              >
                <Plus className="w-4 h-4 mr-1" /> Añadir más archivos
              </button>
              <button
                onClick={startUpload}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl shadow-sm transition-colors flex items-center"
              >
                <UploadCloud className="w-4 h-4 mr-2" /> Subir {entries.length} CV{entries.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}

        <input
          type="file"
          multiple
          accept={accept}
          ref={fileInputRef}
          className="hidden"
          onChange={ev => { addFiles(ev.target.files); if (fileInputRef.current) fileInputRef.current.value = ''; }}
          disabled={isUploading}
        />
      </div>
    </Modal>
  );
}
