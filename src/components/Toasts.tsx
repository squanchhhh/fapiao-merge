import type { ToastItem } from '../core/types';
import { AlertIcon, CheckIcon, CloseIcon, HelpIcon } from './Icons';

const TONE_ICON = {
  info: HelpIcon,
  success: CheckIcon,
  warning: AlertIcon,
  error: AlertIcon,
};

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = TONE_ICON[toast.tone];
        return (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <span className="toast-icon">
              <Icon width={16} height={16} />
            </span>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="关闭">
              <CloseIcon width={14} height={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
