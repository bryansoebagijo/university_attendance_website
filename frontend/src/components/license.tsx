"use client";

import { KeyRound, ShieldAlert } from "lucide-react";
import { paths, useApi } from "@/lib/api";
import { fmtDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/me";

export type LicenseState = "VALID" | "EXPIRING" | "GRACE" | "EXPIRED" | "MISSING" | "INVALID" | "CLOCK_BACK" | "DEV";
export interface LicenseInfo {
  state: LicenseState;
  readOnly: boolean;
  enforced: boolean;
  expiresAt: string | null;
  graceUntil: string | null;
  daysLeft: number | null;
  // administrators only:
  id?: string | null;
  customer?: string | null;
  issuedAt?: string | null;
  reason?: string | null;
}

export function useLicense() {
  // Re-checked every 10 minutes; the server re-reads the license file every minute.
  return useApi<LicenseInfo>(paths.license, { refreshInterval: 600_000 });
}

/** Top-of-page banner: reminder for admins before expiry, warning for everyone in grace and read-only. */
export function LicenseBanner() {
  const { t, f, locale } = useI18n();
  const { role } = useSession();
  const { data } = useLicense();
  if (!data) return null;
  const admin = role === "ADMIN";
  const date = (d: string | null) => (d ? fmtDate(d, locale) : "—");
  let tone = "";
  let text = "";
  switch (data.state) {
    case "EXPIRING":
      if (!admin) return null;
      tone = "notice";
      text = f(t.license.bannerExpiring, { date: date(data.expiresAt), days: data.daysLeft ?? 0 });
      break;
    case "GRACE":
      tone = "notice";
      text = f(t.license.bannerGrace, { date: date(data.expiresAt), until: date(data.graceUntil) });
      break;
    case "EXPIRED":
    case "MISSING":
    case "INVALID":
    case "CLOCK_BACK":
      tone = "notice notice-bad";
      text = `${t.license.bannerReadOnly} ${t.license.why[data.state]} ${admin ? t.license.adminHint : t.license.userHint}`;
      break;
    default:
      return null;
  }
  return (
    <div className={`${tone} mb-5 flex items-start gap-3`} role="alert">
      <ShieldAlert size={17} className="mt-0.5 shrink-0" />
      <div className="text-[13px] leading-[1.6]">{text}</div>
    </div>
  );
}

/** Settings → Lisensi (administrators). */
export function LicenseCard() {
  const { t, locale } = useI18n();
  const { role } = useSession();
  const { data } = useLicense();
  if (role !== "ADMIN" || !data) return null;
  const date = (d: string | null | undefined) => (d ? fmtDate(d, locale) : "—");
  const tone: Record<LicenseState, string> = {
    VALID: "",
    EXPIRING: "tag-warn",
    GRACE: "tag-warn",
    EXPIRED: "tag-bad",
    MISSING: "tag-bad",
    INVALID: "tag-bad",
    CLOCK_BACK: "tag-bad",
    DEV: "tag-gray",
  };
  return (
    <div className="card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="card-title flex items-center gap-2">
            <KeyRound size={16} /> {t.license.title}
          </h2>
          <p className="card-sub">{t.license.sub}</p>
        </div>
        <span className={`tag ${tone[data.state]}`}>{t.license.states[data.state]}</span>
      </div>
      <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
        <Item k={t.license.customer} v={data.customer ?? "—"} />
        <Item k={t.license.number} v={data.id ?? "—"} />
        <Item k={t.license.validUntil} v={`${date(data.expiresAt)}${data.daysLeft !== null && data.daysLeft >= 0 ? ` (${data.daysLeft} ${t.common.days})` : ""}`} />
        <Item k={t.license.graceUntil} v={date(data.graceUntil)} />
      </dl>
      {data.readOnly && <div className="notice notice-bad mt-4 text-[12.5px]">{t.license.why[data.state]} {t.license.adminHint}</div>}
      {data.state === "DEV" && <p className="tiny mt-3">{t.license.devNote}</p>}
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-b border-line-soft pb-2">
      <dt className="text-[11px] uppercase tracking-[0.7px] text-muted-2">{k}</dt>
      <dd className="mt-1 font-medium text-ink-2">{v}</dd>
    </div>
  );
}
