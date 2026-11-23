"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, MinusCircle } from "lucide-react";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { Empty, LoadError, PageHeading, Skeleton, StatusTag } from "@/components/ui";
import { ApiError, attendanceApi, paths, useApi, type CorrectionsResponse } from "@/lib/api";
import { diffDays, fixDeadline, fmtDate, fmtDateLong, fmtTime, jakartaDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { useStore } from "@/lib/store";
import type { Attendance } from "@/lib/types";

export default function FixPage() {
  const { t, f, locale } = useI18n();
  const { data, error, mutate } = useApi<CorrectionsResponse>(paths.corrections);
  if (!data) return error ? <LoadError onRetry={() => mutate()} /> : <Skeleton />;
  const { missing, past } = data; // sorted by the API

  return (
    <>
      <PageHeading eyebrow={t.fix.eyebrow} title={t.fix.title} sub={t.fix.sub} />
      <div className="notice mb-5 flex items-center gap-3">
        <AlertTriangle size={18} className="shrink-0 text-warn" />
        {t.fix.rule}
      </div>

      {missing.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {missing.map((a) => (
            <FixCard key={a.id} record={a} />
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty>{t.fix.none}</Empty>
        </div>
      )}

      <div className="card mt-6 !p-0">
        <h2 className="card-title px-[21px] pb-3 pt-5">{t.fix.historyTitle}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.date}</th>
                <th>{t.common.clockIn}</th>
                <th>{t.common.clockOut}</th>
                <th>{t.common.reason}</th>
                <th>{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {past.map((a) => (
                <tr key={a.id}>
                  <td data-label={t.common.date}>
                    <strong>{fmtDate(a.date, locale)}</strong>
                  </td>
                  <td data-label={t.common.clockIn}>{fmtTime(a.clockIn)}</td>
                  <td data-label={t.common.clockOut}>{fmtTime(a.clockOut)}</td>
                  <td data-label={t.common.reason} className="max-w-[340px]">
                    {a.status === "FIXED" ? (
                      <>
                        {a.fixReason}
                        <small>{f(t.fix.fixedOn, { date: fmtDate(a.fixedAt!.slice(0, 10), locale) })}</small>
                      </>
                    ) : (
                      <span className="flex items-center gap-1.5 text-danger">
                        <MinusCircle size={14} /> {f(t.fix.deductedOn, { date: fmtDate((a.deductedAt ?? "").slice(0, 10) || a.date, locale) })}
                      </span>
                    )}
                  </td>
                  <td data-label={t.common.status}>
                    <StatusTag status={a.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!past.length && <Empty>{t.common.noData}</Empty>}
        </div>
      </div>
    </>
  );
}

function FixCard({ record }: { record: Attendance }) {
  const { t, f, locale } = useI18n();
  const { notify } = useStore();
  const { mutate } = useSWRConfig();
  const [time, setTime] = useState("16:00");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const deadline = record.fixDeadline ?? fixDeadline(record.date);
  const left = diffDays(deadline, jakartaDate());
  const inTime = fmtTime(record.clockIn);
  const timeBad = time <= inTime;
  const reasonBad = reason.trim().length < 10;

  const submit = async () => {
    setTouched(true);
    setServerError(null);
    if (timeBad || reasonBad) return;
    setBusy(true);
    try {
      await attendanceApi.fix(record.id, time, reason.trim());
      notify(t.fix.saved);
      void mutate(paths.corrections);
      void mutate(paths.overview);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setServerError(
        code === "CLOCK_OUT_BEFORE_IN"
          ? f(t.fix.timeInvalid, { time: inTime })
          : code === "CLOCK_OUT_IN_FUTURE"
            ? t.fix.timeFuture
            : code === "FIX_WINDOW_CLOSED"
              ? t.fix.windowClosed
              : t.errors.generic,
      );
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-[15px] font-bold text-ink">{fmtDateLong(record.date, locale)}</h3>
          <p className="card-sub">
            {t.common.clockIn} {inTime} · {t.common.clockOut} —
          </p>
        </div>
        <span className={`tag ${left <= 14 ? "tag-bad" : "tag-warn"}`}>
          <CalendarClock size={12} /> {left >= 0 ? f(t.fix.daysLeft, { count: left }) : t.fix.overdue}
        </span>
      </div>
      <p className="tiny mb-3">
        {t.fix.deadline}: <b className="text-ink-2">{fmtDate(deadline, locale)}</b>
      </p>
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <label className="field">
          {t.fix.clockOutTime}
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="field">
          {t.common.reason}
          <textarea
            className="input min-h-[46px]"
            rows={2}
            placeholder={t.fix.reasonPh}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      {touched && (timeBad || reasonBad) && (
        <div className="notice notice-bad mt-3">{timeBad ? f(t.fix.timeInvalid, { time: inTime }) : t.fix.reasonRequired}</div>
      )}
      {serverError && <div className="notice notice-bad mt-3">{serverError}</div>}
      <div className="mt-4 flex justify-end">
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          <CheckCircle2 size={15} /> {t.fix.fixBtn}
        </button>
      </div>
    </div>
  );
}
