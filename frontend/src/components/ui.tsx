"use client";

import { Paperclip, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { leaveAttachmentUrl } from "@/lib/api";
import type { AttendanceStatus, LeaveRequest, LeaveStatus, LeaveType } from "@/lib/types";

export function PageHeading({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  unit,
  foot,
  icon,
  tone = "green",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  foot?: string;
  icon?: ReactNode;
  tone?: "green" | "gold" | "red" | "plain";
}) {
  const iconTone = {
    green: "bg-ok-soft text-ok",
    gold: "bg-warn-soft text-warn",
    red: "bg-danger-soft text-danger",
    plain: "bg-subtle text-muted",
  }[tone];
  const valueTone = { green: "text-ok", gold: "text-warn", red: "text-danger", plain: "" }[tone];
  return (
    <div className="card">
      <div className="stat-label">
        {label}
        {icon && <span className={`stat-icon ${iconTone}`}>{icon}</span>}
      </div>
      <div className={`stat-value ${valueTone}`}>
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

const attendanceTone: Record<AttendanceStatus, string> = {
  COMPLETE: "",
  CLOCKED_IN: "tag-blue",
  MISSING_CLOCK_OUT: "tag-warn",
  FIXED: "tag-gray",
  DEDUCTED: "tag-bad",
};
const leaveTone: Record<LeaveStatus, string> = { PENDING: "tag-warn", APPROVED: "", REJECTED: "tag-bad" };

export function StatusTag({ status }: { status: AttendanceStatus | LeaveStatus }) {
  const { t } = useI18n();
  const tone =
    status in attendanceTone ? attendanceTone[status as AttendanceStatus] : leaveTone[status as LeaveStatus];
  return <span className={`tag ${tone}`}>{t.status[status]}</span>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-[19px] font-bold text-ink">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-[13px] text-muted-2">{children}</div>;
}

export function Skeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true">
      <div className="h-6 w-40 rounded bg-subtle" />
      <div className="h-9 w-72 rounded bg-subtle" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-xl bg-subtle" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-subtle" />
    </div>
  );
}

export const AVATAR_PLACEHOLDER = "/avatar-placeholder.svg";

/**
 * Profile picture. `photoUrl` comes from the backend (login / me response).
 * Falls back to the placeholder image when there is no photo or it fails to load.
 */
export function ProfilePhoto({
  name,
  photoUrl,
  className = "",
  style,
}: {
  name: string;
  photoUrl?: string | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  const src = photoUrl && !failed ? photoUrl : AVATAR_PLACEHOLDER;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} className={`object-cover ${className}`} style={style} onError={() => setFailed(true)} />
  );
}

export function Avatar({ name, photoUrl, size = 35 }: { name: string; photoUrl?: string | null; size?: number }) {
  return (
    <ProfilePhoto
      name={name}
      photoUrl={photoUrl}
      className="shrink-0 rounded-[10px] border border-line bg-subtle"
      style={{ width: size, height: size }}
    />
  );
}

/** Shown when an API request fails (server down, network). */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="card text-center">
      <p className="text-[13px] text-muted">{t.errors.generic}</p>
      <button className="btn btn-sm mt-3" onClick={onRetry}>
        {t.errors.retry}
      </button>
    </div>
  );
}

/** Marks a clock-in/out that came from an uploaded QR image (for admin review). */
export function UploadTag() {
  const { t } = useI18n();
  return (
    <span className="tag tag-warn ml-1.5 !px-1.5 !py-0.5 !text-[10px]" title={t.admin.viaUploadTitle}>
      {t.admin.viaUpload}
    </span>
  );
}

/** Annual vs sick leave. */
export function LeaveTypeTag({ type }: { type: LeaveType }) {
  const { t } = useI18n();
  return <span className={`tag ${type === "SICK" ? "tag-blue" : "tag-gray"}`}>{type === "SICK" ? t.sick.tagSick : t.sick.tagAnnual}</span>;
}

/** Opens the doctor's note (image or PDF) in a new tab. Renders nothing when there is none. */
export function AttachmentLink({ request, compact = false }: { request: Pick<LeaveRequest, "id" | "attachment">; compact?: boolean }) {
  const { t } = useI18n();
  if (!request.attachment) return null;
  return (
    <a
      className={compact ? "inline-flex items-center gap-1 text-[12px] font-semibold text-brand underline-offset-2 hover:underline" : "btn btn-sm"}
      href={leaveAttachmentUrl(request.id)}
      target="_blank"
      rel="noopener"
      title={request.attachment.fileName}
    >
      <Paperclip size={13} /> {t.sick.viewNote}
    </a>
  );
}
