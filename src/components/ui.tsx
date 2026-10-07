"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X, Coins, ChevronRight, ArrowLeft, Star } from "lucide-react";
import Link from "next/link";
export function IconButton({
  children,
  label,
  onClick,
  className = "",
  disabled = false,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function PageHeader({
  title,
  back = "/profile",
  action,
}: {
  title: string;
  back?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <Link href={back} className="icon-button" aria-label="Quay lại">
        <ArrowLeft size={20} />
      </Link>
      <h1>{title}</h1>
      <div className="header-action">{action}</div>
    </header>
  );
}
export function SectionHeader({
  title,
  href,
  action,
}: {
  title: string;
  href?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {href ? (
        <Link href={href}>
          Xem tất cả <ChevronRight size={12} />
        </Link>
      ) : (
        action
      )}
    </div>
  );
}
export function RatingBadge({ rating }: { rating: number }) {
  return (
    <span className="rating">
      <Star size={12} fill="currentColor" /> {rating.toFixed(1)}
    </span>
  );
}
export function Coin({ small = false }: { small?: boolean }) {
  return (
    <span className={`coin ${small ? "small" : ""}`}>
      <Coins size={small ? 12 : 21} strokeWidth={2.5} />
    </span>
  );
}
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}
export function LoadingScreen() {
  return (
    <div className="content loading-screen" role="status" aria-label="Đang tải">
      <Skeleton className="skeleton-title" />
      <Skeleton className="skeleton-hero" />
      <div className="movie-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton className="skeleton-poster" key={i} />
        ))}
      </div>
    </div>
  );
}
export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("button, input, a, select")?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const elements = ref.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input, select, [tabindex='0']",
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-heading">
          <h2 id="modal-title">{title}</h2>
          <IconButton label="Đóng" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
