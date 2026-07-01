import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** Called when the user requests to close (Escape key). Pass undefined to disable. */
  onClose?: () => void;
  /** The modal card content (the white panel). Rendered as-is, centered. */
  children: ReactNode;
  /**
   * Backdrop tint + z-index utility classes, e.g. "bg-slate-900/50 z-50".
   * `fixed inset-0`, `backdrop-blur-sm` and scrolling are always applied.
   */
  overlayClassName?: string;
}

/**
 * Accessible, scroll-safe modal rendered through a React Portal into <body>.
 *
 * Rendering into <body> is essential: animated ancestors in this app use
 * `animation: ... forwards`, which leaves a persistent `transform` on the
 * element. A `transform` establishes a containing block, so any
 * `position: fixed` descendant is positioned relative to that ancestor
 * instead of the viewport — which clipped modals ("recortado"). The Portal
 * escapes those ancestors so `fixed inset-0` truly covers the viewport, and
 * the inner `min-h-full` flex wrapper lets tall modals scroll instead of
 * being cut off.
 */
export default function Modal({
  isOpen,
  onClose,
  children,
  overlayClassName = 'bg-slate-900/50 z-50',
}: ModalProps) {
  // Keep the latest onClose without re-running the effect on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('keydown', handleKey);

    // Prevent the page behind the modal from scrolling.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className={`fixed inset-0 backdrop-blur-sm overflow-y-auto ${overlayClassName}`}>
      <div className="flex min-h-full items-center justify-center p-4">{children}</div>
    </div>,
    document.body
  );
}
