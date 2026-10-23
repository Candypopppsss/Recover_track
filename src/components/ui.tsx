import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Check, X, Inbox, LoaderCircle, ArrowUpRight } from "lucide-react";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <path
            d="M11.5 28.5V11.5h8.1c5.1 0 8.2 2.6 8.2 6.7s-3.1 6.7-8.2 6.7h-3.3L28 33"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="11.5" cy="33" r="2.2" fill="#d7ed9d" />
        </svg>
      </span>
      <span>RecoverTrack</span>
    </div>
  );
}
export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <LoaderCircle size={19} className="spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={26} />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-header">
      <div>
        <h2 className="card-title">{title}</h2>
        {subtitle && <p className="card-subtitle">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-subtitle">{description}</p>}
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      {status === "taken" && <Check size={12} />}
      <span>
        {status === "due"
          ? "Due now"
          : status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    </span>
  );
}
export function TextAction({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node
      ?.querySelector<HTMLElement>(
        'button,input,select,textarea,[tabindex="0"]',
      )
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab" && node) {
        const els = Array.from(
          node.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
          ),
        ).filter((el) => el.offsetParent !== null);
        if (!els.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={21} />
          </button>
        </div>
        <div className="modal-content">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
