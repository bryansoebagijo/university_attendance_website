"use client";

import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Avatar, Empty, LoadError, PageHeading, Skeleton, StatusTag, UploadTag } from "@/components/ui";
import { paths, useApi, type AdminAttendanceResponse } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { fmtDate, fmtDuration, fmtTime, jakartaDate, minutesBetween } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import type { AttendanceStatus } from "@/lib/types";

const STATUSES: AttendanceStatus[] = ["CLOCKED_IN", "COMPLETE", "MISSING_CLOCK_OUT", "FIXED", "DEDUCTED"];

export default function AdminAttendancePage() {
  return (
    <Suspense>
      <AdminAttendance />
    </Suspense>
  );
}

function AdminAttendance() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const initialStatus = (params.get("status") ?? "") as AttendanceStatus | "";
  const [status, setStatus] = useState<AttendanceStatus | "">(initialStatus);
  // When filtering by an open problem status, look across all dates by default.
  const [date, setDate] = useState(initialStatus ? "" : jakartaDate());
  const [q, setQ] = useState("");
  // Wait until typing pauses before asking the server.
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  // Filtering happens on the server; previous results stay visible while the next page loads.
  const { data, error, mutate, isLoading } = useApi<AdminAttendanceResponse>(paths.adminAttendance({ date, status, q: query }));
  const rows = data?.records ?? [];

  const exportCsv = () =>
    downloadCsv(`absensi-${date || "semua"}.csv`, [
      ["Tanggal", "NIP", "Nama", "Unit", "Masuk", "Cara masuk", "Pulang", "Cara pulang", "Lokasi", "Status", "Alasan perbaikan"],
      ...rows.map((a) => [a.date, a.user.nip, a.user.name, a.user.unit, fmtTime(a.clockIn), a.inMethod, fmtTime(a.clockOut), a.outMethod ?? "", a.inLocation.name, a.status, a.fixReason ?? ""]),
    ]);

  return (
    <>
      <PageHeading
        eyebrow={t.admin.attendanceEyebrow}
        title={t.admin.attendanceTitle}
        sub={t.admin.attendanceSub}
        actions={
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>
            <Download size={15} /> {t.common.exportCsv}
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input input-inline min-w-[220px] flex-1" placeholder={t.common.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input input-inline" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select className="input input-inline" value={status} onChange={(e) => setStatus(e.target.value as AttendanceStatus | "")}>
          <option value="">{t.common.allStatus}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.status[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="card !p-0">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.name}</th>
                <th>{t.common.date}</th>
                <th>{t.common.clockIn}</th>
                <th>{t.common.clockOut}</th>
                <th>{t.common.duration}</th>
                <th>{t.common.location}</th>
                <th>{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const u = a.user;
                return (
                  <tr key={a.id}>
                    <td data-label={t.common.name}>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} photoUrl={u.photoUrl} size={32} />
                        <div>
                          <strong>{u.name}</strong>
                          <small>{u.unit}</small>
                        </div>
                      </div>
                    </td>
                    <td data-label={t.common.date}>{fmtDate(a.date, locale)}</td>
                    <td data-label={t.common.clockIn}>
                      {fmtTime(a.clockIn)}
                      {a.inMethod === "UPLOAD" && <UploadTag />}
                      {a.late && <small className="!text-danger">{locale === "id" ? "Terlambat" : "Late"}</small>}
                    </td>
                    <td data-label={t.common.clockOut}>
                      {fmtTime(a.clockOut)}
                      {a.outMethod === "UPLOAD" && <UploadTag />}
                      {a.fixReason && <small title={a.fixReason ?? undefined}>✎ {a.fixReason}</small>}
                    </td>
                    <td data-label={t.common.duration}>{a.clockOut ? fmtDuration(minutesBetween(a.clockIn, a.clockOut), locale) : "—"}</td>
                    <td data-label={t.common.location}>{a.inLocation.name}</td>
                    <td data-label={t.common.status}>
                      <StatusTag status={a.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {error ? (
            <div className="p-4">
              <LoadError onRetry={() => mutate()} />
            </div>
          ) : isLoading && !data ? (
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
