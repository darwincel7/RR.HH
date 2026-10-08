import React, { useEffect, useState } from 'react';
import { X, ExternalLink } from 'lucide-react';
import Modal from './ui/Modal';

/**
 * The candidate's face everywhere in the panel: the photo taken from their CV (or one a
 * recruiter uploaded) or, when there is none, their initials on a colour derived from
 * the name — so the same person always gets the same colour.
 */

const PALETTE = [
  'bg-violet-100 text-violet-700', 'bg-indigo-100 text-indigo-700', 'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700',
  'bg-fuchsia-100 text-fuchsia-700', 'bg-teal-100 text-teal-700',
];

export function initialsOf(name?: string): string {
  // Placeholder names of CVs still being read ("Procesando: archivo.pdf") have no initials.
  if (/^(Procesando:|⚠️)/.test(name || '')) return '?';
  const clean = (name || '').trim();
  const words = clean.split(/\s+/).filter(w => /[\p{L}]/u.test(w));
  if (words.length === 0) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function colorFor(name?: string): string {
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

interface Props {
  photoUrl?: string | null;
  name?: string;
  /** Diameter in px. */
  size?: number;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}

export default function CandidateAvatar({ photoUrl, name, size = 40, className = '', onClick, title }: Props) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photoUrl]);
  const showPhoto = !!photoUrl && !broken;
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  const base = `rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center font-bold select-none ${onClick ? 'cursor-zoom-in' : ''} ${className}`;

  return showPhoto ? (
    <img
      src={photoUrl!}
      alt={name ? `Foto de ${name}` : 'Foto del candidato'}
      title={title}
      loading="lazy"
      draggable={false}
      onError={() => setBroken(true)}
      onClick={onClick}
      style={style}
      className={`${base} object-cover bg-slate-100`}
    />
  ) : (
    <div style={style} title={title} onClick={onClick} className={`${base} ${colorFor(name)}`} aria-hidden={!title}>
      {initialsOf(name)}
    </div>
  );
}

/** Full-size view of the photo (click the avatar in the profile). */
export function PhotoLightbox({ photoUrl, name, isOpen, onClose }: { photoUrl?: string | null; name?: string; isOpen: boolean; onClose: () => void }) {
  return (
    <Modal isOpen={isOpen && !!photoUrl} onClose={onClose} closeOnBackdrop overlayClassName="bg-slate-900/85 z-[130]">
      <figure className="relative max-w-[min(90vw,640px)] animate-slide-up">
        <img src={photoUrl || ''} alt={name ? `Foto de ${name}` : 'Foto del candidato'} className="w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl bg-white" />
        <figcaption className="mt-3 flex items-center justify-between gap-3 text-white">
          <span className="font-bold truncate">{name}</span>
          <span className="flex items-center gap-2">
            <a href={photoUrl || '#'} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-bold bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg">
              <ExternalLink className="w-3.5 h-3.5" /> Abrir original
            </a>
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25" aria-label="Cerrar">
              <X className="w-5 h-5" />
            </button>
          </span>
        </figcaption>
      </figure>
    </Modal>
  );
}
