"use client";

import { CalendarDays, Clock, LogIn } from "lucide-react";
import { useMemo, useState } from "react";
import { Empty, LoadError, PageHeading, Skeleton, StatCard, StatusTag } from "@/components/ui";
import { paths, useApi, type MonthResponse } from "@/lib/api";
import { addMonths, fmtDate, fmtDuration, fmtMonth, fmtTime, fmtWeekday, jakartaDate, minutesBetween } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";

export default function HistoryPage() {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(jakartaDate().slice(0, 7));
  // The last 12 months, newest first.
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(`${jakartaDate().slice(0, 7)}-01`, -i).slice(0, 7)), []);
  const { data, error, mutate } = useApi<MonthResponse>(paths.myMonth(month));
  const rows = data?.records ?? [];
  const totalMins = rows.reduce((s, a) => s + (a.clockOut ? minutesBetween(a.clockIn, a.clockOut) : 0), 0);
  const avgInMins = rows.length
    ? Math.round(
        rows.reduce((s, a) => {
          const [h, m] = fmtTime(a.clockIn).split(":").map(Number);
          return s + h * 60 + m;
        }, 0) / rows.length,
      )
    : 0;
  const avgIn = rows.length ? `${String(Math.floor(avgInMins / 60)).padStart(2, "0")}:${String(avgInMins % 60).padStart(2, "0")}` : "—";

  return (
    <>
      <PageHeading
        eyebrow={t.history.eyebrow}
        title={t.history.title}
        sub={t.history.sub}
        actions={
          <label className="flex items-center gap-2 text-[12px] text-muted">
            {t.history.month}
            <select className="input input-inline" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {fmtMonth(m, locale)}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label={t.history.totalDays} value={rows.length} unit={t.common.days} icon={<CalendarDays size={15} />} />
        <StatCard label={t.history.totalHours} value={Math.round(totalMins / 60)} unit={locale === "id" ? "jam" : "hrs"} icon={<Clock size={15} />} tone="plain" />
        <StatCard label={t.history.avgIn} value={avgIn} icon={<LogIn size={15} />} tone="gold" />
      </div>

      <div className="card !p-0">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.date}</th>
                <th>{t.common.clockIn}</th>
                <th>{t.common.clockOut}</th>
                <th>{t.common.duration}</th>
                <th>{t.common.location}</th>
                <th>{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td data-label={t.common.date}>
                    <strong>{fmtDate(a.date, locale)}</strong>
                    <small>{fmtWeekday(a.date, locale)}</small>
                  </td>
                  <td data-label={t.common.clockIn}>{fmtTime(a.clockIn)}</td>
                  <td data-label={t.common.clockOut}>
                    {fmtTime(a.clockOut)}
                    {a.status === "FIXED" && <small title={a.fixReason ?? undefined}>✎ {a.fixReason}</small>}
                  </td>
                  <td data-label={t.common.duration}>{a.clockOut ? fmtDuration(minutesBetween(a.clockIn, a.clockOut), locale) : "—"}</td>
                  <td data-label={t.common.location}>
                    {a.inLocation.name}
                  </td>
                  <td data-label={t.common.status}>
                    <StatusTag status={a.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error ? (
            <div className="p-4">
              <LoadError onRetry={() => mutate()} />
            </div>
          ) : !data ? (
            <div className="p-4">
              <Skeleton />
            </div>
          ) : (
            !rows.length && <Empty>{t.common.noData}</Empty>
          )}
        </div>
      </div>
    </>
  );
}
