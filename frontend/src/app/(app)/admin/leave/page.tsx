"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { LeaveDecisionModal } from "@/components/leave-decision";
import { AttachmentLink, Empty, LeaveTypeTag, LoadError, PageHeading, Skeleton, StatusTag } from "@/components/ui";
import { paths, useApi, type LeaveListResponse, type PendingLeaveResponse } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { fmtDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import type { LeaveStatus, LeaveType, PendingLeave } from "@/lib/types";

export default function AdminLeavePage() {
  const { t, f, locale } = useI18n();
  const [status, setStatus] = useState<LeaveStatus | "">("");
  const [type, setType] = useState<LeaveType | "">("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);
  const [open, setOpen] = useState<PendingLeave | null>(null);
  const { data, error, mutate, isLoading } = useApi<LeaveListResponse>(paths.adminLeave({ status, type, q: query }));
  // The decision dialog needs the balance + overlaps that only the pending endpoint computes.
  const pending = useApi<PendingLeaveResponse>(paths.pendingLeave);
  const rows = data?.requests ?? [];

  return (
    <>
      <PageHeading
        eyebrow={t.admin.attendanceEyebrow}
        title={t.admin.leaveTitle}
        sub={t.admin.leaveSub}
        actions={
          <button
            className="btn"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv("cuti.csv", [
                ["NIP", "Nama", "Jenis", "Mulai", "Selesai", "Hari", "Alasan", "Surat dokter", "Status", "Diputuskan oleh", "Catatan"],
                ...rows.map((l) => [
                  l.user.nip,
                  l.user.name,
                  l.type === "SICK" ? "Sakit" : "Tahunan",
                  l.start,
                  l.end,
                  l.days,
                  l.reason,
                  l.attachment ? "Ya" : "",
                  l.status,
                  l.decidedBy?.name ?? "",
                  l.decisionNote ?? "",
                ]),
              ])
            }
          >
            <Download size={15} /> {t.common.exportCsv}
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input input-inline min-w-[220px] flex-1" placeholder={t.common.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input input-inline" value={status} onChange={(e) => setStatus(e.target.value as LeaveStatus | "")}>
          <option value="">{t.common.allStatus}</option>
          {(["PENDING", "APPROVED", "REJECTED"] as const).map((s) => (
            <option key={s} value={s}>
              {t.status[s]}
            </option>
          ))}
        </select>
        <select className="input input-inline" value={type} onChange={(e) => setType(e.target.value as LeaveType | "")} aria-label={t.sick.type}>
          <option value="">{t.sick.filterAll}</option>
          <option value="ANNUAL">{t.sick.annual}</option>
          <option value="SICK">{t.sick.sick}</option>
        </select>
      </div>

      <div className="card !p-0">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.name}</th>
                <th>{t.leave.period}</th>
                <th>{t.common.days}</th>
                <th>{t.common.reason}</th>
                <th>{t.common.status}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td data-label={t.common.name}>
                    <strong>{l.user.name}</strong>
                    <small>{l.user.unit}</small>
                  </td>
                  <td data-label={t.leave.period}>
                    {fmtDate(l.start, locale)}
                    {l.end !== l.start && ` – ${fmtDate(l.end, locale)}`}
                    <small className="flex flex-wrap items-center gap-2">
                      <LeaveTypeTag type={l.type} />
                      <AttachmentLink request={l} compact />
                    </small>
                  </td>
                  <td data-label={t.common.days}>{l.days}</td>
                  <td data-label={t.common.reason} className="max-w-[300px]">
                    {l.reason}
                    {l.decisionNote && <small>💬 {l.decisionNote}</small>}
                  </td>
                  <td data-label={t.common.status}>
                    <StatusTag status={l.status} />
                    {l.decidedBy && <small>{f(t.leave.decidedBy, { name: l.decidedBy.name })}</small>}
                  </td>
                  <td data-label="" className="text-right">
                    {l.status === "PENDING" && (
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={!pending.data}
                        onClick={() => {
                          const p = pending.data?.requests.find((x) => x.id === l.id);
                          if (p) setOpen(p);
                          else void pending.mutate(); // list changed meanwhile; refresh
                        }}
                      >
                        {t.approvals.approve} / {t.approvals.reject}
                      </button>
                    )}
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
            !rows.length && <Empty>{t.common.noData}</Empty>
          )}
        </div>
      </div>

      {open && <LeaveDecisionModal request={open} onClose={() => setOpen(null)} />}
    </>
  );
}
