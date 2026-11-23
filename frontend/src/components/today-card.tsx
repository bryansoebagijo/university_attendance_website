"use client";

import { CheckCircle2, LogIn, LogOut, QrCode } from "lucide-react";
import Link from "next/link";
import { fmtDateLong, fmtDuration, fmtTime, jakartaDate, minutesBetween } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import type { Attendance } from "@/lib/types";

export function TodayCard({ record }: { record: Attendance | null | undefined }) {
  const { t, f, locale } = useI18n();
  const today = jakartaDate();
  const state: "none" | "in" | "done" = !record ? "none" : record.clockOut ? "done" : "in";

  return (
    <div className="card flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      <div className="flex shrink-0 justify-center py-2">
        {state === "done" ? (
          <div className="clock-done">
            <div className="text-center">
              <CheckCircle2 size={44} strokeWidth={1.5} className="mx-auto" />
              <div className="mt-2 font-display text-[15px] font-bold">{t.status.COMPLETE}</div>
            </div>
          </div>
        ) : (
          <Link href={`/scan?action=${state === "none" ? "in" : "out"}`} className={`clock-btn ${state === "in" ? "out" : ""}`}>
            <QrCode size={34} strokeWidth={1.5} />
            <span className="label">{state === "none" ? t.dashboard.btnClockIn : t.dashboard.btnClockOut}</span>
            <span className="hint">{t.dashboard.btnHint}</span>
          </Link>
        )}
      </div>

      <div className="w-full min-w-0 flex-1">
        <div className="eyebrow">{t.dashboard.todayTitle}</div>
        <h2 className="mt-2 font-display text-[19px] font-bold text-ink">{fmtDateLong(today, locale)}</h2>

        <ol className="mt-5 space-y-3">
          <TimelineRow
            icon={<LogIn size={15} />}
            done={!!record}
            label={t.common.clockIn}
            text={record ? f(t.dashboard.clockedInAt, { time: fmtTime(record.clockIn), location: record.inLocation.name }) : t.dashboard.notClockedIn}
          />
          <TimelineRow
            icon={<LogOut size={15} />}
            done={!!record?.clockOut}
            label={t.common.clockOut}
            text={
              record?.clockOut
                ? f(t.dashboard.clockedOutAt, { time: fmtTime(record.clockOut), location: record.outLocation?.name ?? "—" })
                : "—"
            }
          />
        </ol>

        {state === "done" && record?.clockOut && (
          <div className="notice notice-ok mt-5">
            {t.dashboard.doneToday} · {f(t.dashboard.workedFor, { duration: fmtDuration(minutesBetween(record.clockIn, record.clockOut), locale) })}
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineRow({ icon, done, label, text }: { icon: React.ReactNode; done: boolean; label: string; text: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
          done ? "bg-ok-soft text-ok" : "bg-subtle text-muted-2"
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.7px] text-muted-2">{label}</div>
        <div className={`truncate text-[13px] ${done ? "font-semibold text-ink-2" : "text-muted"}`}>{text}</div>
      </div>
    </li>
  );
}
