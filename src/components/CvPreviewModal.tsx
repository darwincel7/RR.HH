import React from 'react';
import { FileText, X } from 'lucide-react';
import Modal from './ui/Modal';

export interface CvPreview { url: string; name: string; fileType?: string }

/**
 * The candidate's CV in a floating window over the same tab (Embudo, Ranking). Closes on
 * X, Escape or a click outside. Word files go through Google's viewer; PDFs open as is.
 */
export default function CvPreviewModal({ cv, onClose }: { cv: CvPreview | null; onClose: () => void }) {
  return (
    <Modal isOpen={!!cv} onClose={onClose} closeOnBackdrop overlayClassName="bg-slate-900/60 z-[110]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-scale-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-5 h-5 text-indigo-600 shrink-0" />
            <h3 className="font-bold text-slate-800 truncate">Currículum — {cv?.name}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <a
              href={cv?.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              Abrir aparte
            </a>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              title="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-slate-100 min-h-0">
          {cv && (
            <iframe
              src={cv.fileType?.includes('word') || cv.fileType === 'application/msword'
                ? `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(cv.url)}`
                : cv.url}
              title="Currículum"
              className="w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
