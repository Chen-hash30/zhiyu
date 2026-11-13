import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
  bodyClassName?: string;
  closeOnBackdrop?: boolean;
  busy?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 540,
  className = '',
  bodyClassName = '',
  closeOnBackdrop = true,
  busy = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active && panelRef.current?.contains(active)) return;
      const focusTarget =
        panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ||
        panelRef.current?.querySelector<HTMLElement>(
          'input, textarea, button, select, [tabindex]:not([tabindex="-1"])',
        ) ||
        panelRef.current;
      focusTarget?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busy) onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`modal ${className}`}
        style={{ ['--modal-w' as string]: `${width}px` }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {title ? (
          <div className="modal-head">
            <div className="modal-head-main">
              <div className="modal-title" id={titleId}>
                {title}
              </div>
              {subtitle ? <div className="modal-subtitle">{subtitle}</div> : null}
            </div>
            <button
              type="button"
              className="icon-btn modal-close"
              onClick={onClose}
              disabled={busy}
              aria-label="关闭"
            >
              <X size={15} />
            </button>
          </div>
        ) : null}
        <div className={`modal-body ${bodyClassName}`}>{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
