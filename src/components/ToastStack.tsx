import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useAppStore } from '../store';

export function ToastStack() {
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismissToast);

  if (!toasts.length) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <span className={`toast-icon ${toast.kind}`}>
            {toast.kind === 'success' ? (
              <CheckCircle2 size={16} />
            ) : toast.kind === 'error' ? (
              <AlertCircle size={16} />
            ) : (
              <Info size={16} />
            )}
          </span>
          <div className="toast-main">
            <div className="toast-title">{toast.title}</div>
            {toast.description ? <div className="toast-desc">{toast.description}</div> : null}
            {toast.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.action?.();
                  dismiss(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="关闭提示"
            onClick={() => dismiss(toast.id)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
