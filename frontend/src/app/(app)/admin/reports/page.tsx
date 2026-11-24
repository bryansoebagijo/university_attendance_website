"use client";

import { CalendarDays, CalendarOff, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar, Empty, LoadError, PageHeading, Skeleton, StatCard } from "@/components/ui";
import { paths, useApi, type MonthlyReport } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { addMonths, fmtDate, fmtMonth, jakartaDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";

export default function MonthlyReportPage() {
  const { t, f, locale } = useI18n();
  const [month, setMonth] = useState(jakartaDate().slice(0, 7));
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(`${jakartaDate().slice(0, 7)}-01`, -i).slice(0, 7)), []);
  const { data, error, mutate, isLoading } = useApi<MonthlyReport>(paths.monthlyReport(month));
  const rows = data?.month === month ? data.rows : [];

  const exportCsv = () =>
    downloadCsv(`rekap-${month}.csv`, [
      ["NIP", "Nama", "Unit", "Hari jadwal", "Hadir", "Di luar jadwal", "Cuti", "Sakit", "Dibebaskan", "Tanpa keterangan", "Belum absen pulang", "Diperbaiki", "Dipotong", "Via unggahan", "Diubah admin"],
      ...rows.map((r) => [r.user.nip, r.user.name, r.user.unit, r.scheduled, r.present, r.outsideSchedule, r.leave, r.sick, r.exempt, r.absent, r.missingClockOut, r.fixed, r.deducted, r.uploads, r.adminEdited]),
    ]);

  const num = (n: number, tone?: "bad" | "warn") =>
    n > 0 && tone ? <span className={tone === "bad" ? "font-semibold text-danger" : "font-semibold text-warn"}>{n}</span> : n;

  return (
    <>
      <PageHeading
        eyebrow={t.reports.eyebrow}
        title={t.reports.title}
        sub={t.reports.sub}
        actions={
          <>
            <select className="input input-inline" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t.history.month}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {fmtMonth(m, locale)}
                </option>
              ))}
            </select>
            <button className="btn" onClick={exportCsv} disabled={!rows.length}>
              <Download size={15} /> {t.common.exportCsv}
            </button>
          </>
        }
      />

      {data && data.month === month && (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard label={t.reports.workdays} value={data.workdays} unit={t.common.days} icon={<CalendarDays size={15} />} tone="plain" foot={f(t.reports.period, { from: fmtDate(data.from, locale), to: fmtDate(data.to, locale) })} />
          <StatCard label={t.reports.holidaysCount} value={data.holidays} unit={t.common.days} icon={<CalendarOff size={15} />} tone="gold" />
        </div>
      )}

      <div className="card !p-0">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.name}</th>
                <th>{t.reports.scheduled}</th>
                <th>{t.reports.present}</th>
                <th>{t.reports.outside}</th>
                <th>{t.reports.leave}</th>
                <th>{t.reports.sick}</th>
                <th>{t.reports.exempt}</th>
                <th>{t.reports.absent}</th>
                <th>{t.reports.missing}</th>
                <th>{t.reports.fixed}</th>
                <th>{t.reports.deducted}</th>
                <th>{t.reports.uploads}</th>
                <th>{t.reports.adminEdited}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user.id}>
                  <td data-label={t.common.name}>
                    <div className="flex items-center gap-3">
                      <Avatar name={r.user.name} size={32} />
                      <div className="min-w-0">
                        <strong>{r.user.name}</strong>
                        <small>
                          {r.user.unit} · {r.user.nip}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td data-label={t.reports.scheduled}>{r.scheduled}</td>
                  <td data-label={t.reports.present}>
                    <strong>{r.present}</strong>
                  </td>
                  <td data-label={t.reports.outside}>{r.outsideSchedule}</td>
                  <td data-label={t.reports.leave}>{r.leave}</td>
                  <td data-label={t.reports.sick}>{r.sick}</td>
                  <td data-label={t.reports.exempt}>{r.exempt}</td>
                  <td data-label={t.reports.absent}>{num(r.absent, "bad")}</td>
                  <td data-label={t.reports.missing}>{num(r.missingClockOut, "warn")}</td>
                  <td data-label={t.reports.fixed}>{r.fixed}</td>
                  <td data-label={t.reports.deducted}>{num(r.deducted, "bad")}</td>
                  <td data-label={t.reports.uploads}>{num(r.uploads, "warn")}</td>
                  <td data-label={t.reports.adminEdited}>{num(r.adminEdited, "warn")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {error ? (
            <div className="p-4">
              <LoadError onRetry={() => mutate()} />
            </div>
          ) : isLoading || (data && data.month !== month) ? (
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
