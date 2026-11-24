"use client";

import { CalendarCheck, Download, PencilLine, Plus, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AttendanceForm, DeleteAttendance, ExemptDay, useUnexempt } from "@/components/attendance-corrections";
import { EditedTag, OutsideTag } from "@/components/schedule";
import { Avatar, Empty, LoadError, PageHeading, Skeleton, StatusTag, UploadTag } from "@/components/ui";
import { paths, useApi, type AdminAttendanceResponse, type DayResponse, type DayRow, type DayState } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { fmtDate, fmtDuration, fmtTime, jakartaDate, minutesBetween } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import type { Attendance, AttendanceStatus } from "@/lib/types";

const STATUSES: AttendanceStatus[] = ["CLOCKED_IN", "COMPLETE", "MISSING_CLOCK_OUT", "FIXED", "DEDUCTED"];
const STATE_TONE: Record<DayState, string> = {
  PRESENT: "",
  LEAVE: "tag-warn",
  SICK: "tag-blue",
  EXEMPT: "tag-gray",
  ABSENT: "tag-bad",
  NOT_YET: "tag-gray",
  UPCOMING: "tag-gray",
};

type Person = { id: string; name: string };
type Dialog =
  | { kind: "edit"; user: Person; date: string; record: Attendance | null }
  | { kind: "delete"; user: Person; record: Attendance }
  | { kind: "exempt"; user: Person; date: string }
  | null;

export default function AdminAttendancePage() {
  return (
    <Suspense>
      <AdminAttendance />
    </Suspense>
  );
}

function AdminAttendance() {
  const { t } = useI18n();
  const params = useSearchParams();
  const initialStatus = (params.get("status") ?? "") as AttendanceStatus | "";
  // By date: everyone scheduled that day (with actions). By status: records across all dates.
  const [mode, setMode] = useState<"date" | "status">(initialStatus ? "status" : "date");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);
  const [dialog, setDialog] = useState<Dialog>(null);

  return (
    <>
      <PageHeading eyebrow={t.admin.attendanceEyebrow} title={t.admin.attendanceTitle} sub={t.admin.attendanceSub} />

      <div className="mb-4 flex flex-wrap gap-2">
        {(["date", "status"] as const).map((m) => (
          <button key={m} className={`btn btn-sm ${mode === m ? "btn-active" : ""}`} onClick={() => setMode(m)}>
            {m === "date" ? t.corrections.byDate : t.corrections.byStatus}
          </button>
        ))}
        <input className="input input-inline min-w-[200px] flex-1" placeholder={t.common.search} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {mode === "date" ? <DayRoster query={query} onDialog={setDialog} /> : <StatusList query={query} initialStatus={initialStatus} onDialog={setDialog} />}

      {dialog?.kind === "edit" && <AttendanceForm user={dialog.user} date={dialog.date} record={dialog.record} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && <DeleteAttendance user={dialog.user} record={dialog.record} onClose={() => setDialog(null)} />}
      {dialog?.kind === "exempt" && <ExemptDay user={dialog.user} date={dialog.date} onClose={() => setDialog(null)} />}
    </>
  );
}

function Times({ a }: { a: Attendance }) {
  return (
    <>
      {fmtTime(a.clockIn)}
      {a.inMethod === "UPLOAD" && <UploadTag />} – {fmtTime(a.clockOut)}
      {a.outMethod === "UPLOAD" && <UploadTag />}
    </>
  );
}

function DayRoster({ query, onDialog }: { query: string; onDialog: (d: Dialog) => void }) {
  const { t, f, locale } = useI18n();
  const today = jakartaDate();
  const [date, setDate] = useState(today);
  const { data, error, mutate, isLoading } = useApi<DayResponse>(paths.adminDay(date || today));
  const unexempt = useUnexempt();
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const needle = query.toLowerCase();
    return needle ? all.filter((r) => r.user.name.toLowerCase().includes(needle) || r.user.nip.includes(needle)) : all;
  }, [data, query]);
  const counts = useMemo(() => {
    const c: Partial<Record<DayState, number>> = {};
    for (const r of data?.rows ?? []) c[r.state] = (c[r.state] ?? 0) + 1;
    return c;
  }, [data]);

  const exportCsv = () =>
    downloadCsv(`kehadiran-${date}.csv`, [
      ["Tanggal", "NIP", "Nama", "Unit", "Terjadwal", "Keadaan", "Masuk", "Pulang", "Lokasi", "Status", "Diubah admin", "Keterangan"],
      ...rows.map((r) => [
        date,
        r.user.nip,
        r.user.name,
        r.user.unit,
        r.scheduled ? "Ya" : "Tidak",
        t.corrections.states[r.state],
        r.record ? fmtTime(r.record.clockIn) : "",
        r.record ? fmtTime(r.record.clockOut) : "",
        r.record?.inLocation.name ?? "",
        r.record?.status ?? "",
        r.record?.edit?.reason ?? "",
        r.exemption?.reason ?? r.record?.fixReason ?? "",
      ]),
    ]);

  const action = (r: DayRow) => {
    const person = { id: r.user.id, name: r.user.name };
    const canEdit = date <= today;
    return (
      <div className="flex flex-wrap justify-end gap-1.5">
        {r.record ? (
          <>
            <button className="btn btn-sm" onClick={() => onDialog({ kind: "edit", user: person, date, record: r.record })}>
              <PencilLine size={13} /> {t.corrections.editBtn}
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => onDialog({ kind: "delete", user: person, record: r.record! })} aria-label={t.corrections.deleteBtn}>
              <Trash2 size={13} />
            </button>
          </>
        ) : (
          <>
            {canEdit && (
              <button className="btn btn-sm" onClick={() => onDialog({ kind: "edit", user: person, date, record: null })}>
                <Plus size={13} /> {t.corrections.add}
              </button>
            )}
            {r.exemption ? (
              <button className="btn btn-sm" onClick={() => void unexempt(r.exemption!.id)}>
                <Undo2 size={13} /> {t.corrections.undoExempt}
              </button>
            ) : (
              r.scheduled &&
              !r.leave && (
                <button className="btn btn-sm btn-primary" onClick={() => onDialog({ kind: "exempt", user: person, date })}>
                  <ShieldCheck size={13} /> {t.corrections.exempt}
                </button>
              )
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input input-inline" type="date" value={date} onChange={(e) => setDate(e.target.value || today)} />
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(STATE_TONE) as DayState[])
            .filter((s) => counts[s])
            .map((s) => (
              <span key={s} className={`tag ${STATE_TONE[s]}`}>
                {t.corrections.states[s]} · {counts[s]}
              </span>
            ))}
        </div>
        <button className="btn btn-sm ml-auto" onClick={exportCsv} disabled={!rows.length}>
          <Download size={14} /> {t.common.exportCsv}
        </button>
      </div>
      <p className="tiny mb-3">{data?.holiday ? t.corrections.holiday : t.corrections.rosterSub}</p>

      <div className="card !p-0">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.name}</th>
                <th>{t.common.status}</th>
                <th>
                  {t.common.clockIn} – {t.common.clockOut}
                </th>
                <th>{t.common.location}</th>
                <th>{t.common.note}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user.id}>
                  <td data-label={t.common.name}>
                    <div className="flex items-center gap-3">
                      <Avatar name={r.user.name} photoUrl={r.user.photoUrl} size={32} />
                      <div>
                        <strong>{r.user.name}</strong>
                        <small>{r.user.unit}</small>
                      </div>
                    </div>
                  </td>
                  <td data-label={t.common.status}>
                    <span className={`tag ${STATE_TONE[r.state]}`}>{t.corrections.states[r.state]}</span>
                    {r.record && !r.scheduled && <OutsideTag />}
                    {r.record && r.record.status !== "COMPLETE" && (
                      <small>
                        <StatusTag status={r.record.status} />
                      </small>
                    )}
                  </td>
                  <td data-label={`${t.common.clockIn} – ${t.common.clockOut}`}>
                    {r.record ? (
                      <>
                        <Times a={r.record} />
                        <EditedTag record={r.record} />
                        {r.record.clockOut && <small>{fmtDuration(minutesBetween(r.record.clockIn, r.record.clockOut), locale)}</small>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label={t.common.location}>{r.record?.inLocation.name ?? "—"}</td>
                  <td data-label={t.common.note} className="max-w-[260px]">
                    {r.exemption ? (
                      <small className="!mt-0">{f(t.corrections.exemptedBy, { name: r.exemption.by?.name ?? "Admin", reason: r.exemption.reason })}</small>
                    ) : r.record?.edit ? (
                      <small className="!mt-0">{f(t.corrections.editedBy, { name: r.record.edit.by?.name ?? "Admin", reason: r.record.edit.reason ?? "" })}</small>
                    ) : r.record?.fixReason ? (
                      <small className="!mt-0">✎ {r.record.fixReason}</small>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="" className="text-right">
                    {action(r)}
                  </td>
                </tr>
              ))}
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
            !rows.length && (
              <Empty>
                <CalendarCheck size={18} className="mx-auto mb-2" />
                {t.common.noData}
              </Empty>
            )
          )}
        </div>
      </div>
    </>
  );
}

function StatusList({ query, initialStatus, onDialog }: { query: string; initialStatus: AttendanceStatus | ""; onDialog: (d: Dialog) => void }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<AttendanceStatus | "">(initialStatus);
  const [date, setDate] = useState("");
  // Filtering happens on the server; previous results stay visible while the next page loads.
  const { data, error, mutate, isLoading } = useApi<AdminAttendanceResponse>(paths.adminAttendance({ date, status, q: query }));
  const rows = data?.records ?? [];

  const exportCsv = () =>
    downloadCsv(`absensi-${status || date || "semua"}.csv`, [
      ["Tanggal", "NIP", "Nama", "Unit", "Masuk", "Cara masuk", "Pulang", "Cara pulang", "Lokasi", "Status", "Terjadwal", "Alasan perbaikan", "Diubah admin"],
      ...rows.map((a) => [
        a.date,
        a.user.nip,
        a.user.name,
        a.user.unit,
        fmtTime(a.clockIn),
        a.inMethod,
        fmtTime(a.clockOut),
        a.outMethod ?? "",
        a.inLocation.name,
        a.status,
        a.scheduled === false ? "Tidak" : "Ya",
        a.fixReason ?? "",
        a.edit?.reason ?? "",
      ]),
    ]);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input input-inline" value={status} onChange={(e) => setStatus(e.target.value as AttendanceStatus | "")}>
          <option value="">{t.common.allStatus}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.status[s]}
            </option>
          ))}
        </select>
        <input className="input input-inline" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn btn-sm ml-auto" onClick={exportCsv} disabled={!rows.length}>
          <Download size={14} /> {t.common.exportCsv}
        </button>
      </div>
      <div className="card !p-0">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.name}</th>
                <th>{t.common.date}</th>
                <th>
                  {t.common.clockIn} – {t.common.clockOut}
                </th>
                <th>{t.common.location}</th>
                <th>{t.common.status}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const u = a.user;
                const person = { id: u.id, name: u.name };
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
                    <td data-label={t.common.date}>
                      {fmtDate(a.date, locale)}
                      {a.scheduled === false && <OutsideTag />}
                    </td>
                    <td data-label={`${t.common.clockIn} – ${t.common.clockOut}`}>
                      <Times a={a} />
                      <EditedTag record={a} />
                      {a.fixReason && <small title={a.fixReason}>✎ {a.fixReason}</small>}
                    </td>
                    <td data-label={t.common.location}>{a.inLocation.name}</td>
                    <td data-label={t.common.status}>
                      <StatusTag status={a.status} />
                    </td>
                    <td data-label="" className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button className="btn btn-sm" onClick={() => onDialog({ kind: "edit", user: person, date: a.date, record: a })}>
                          <PencilLine size={13} /> {t.corrections.editBtn}
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => onDialog({ kind: "delete", user: person, record: a })} aria-label={t.corrections.deleteBtn}>
                          <Trash2 size={13} />
                        </button>
                      </div>
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
