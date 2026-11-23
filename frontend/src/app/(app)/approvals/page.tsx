"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import { useState } from "react";
import { LeaveDecisionModal } from "@/components/leave-decision";
import { Avatar, Empty, LoadError, PageHeading, Skeleton, StatusTag } from "@/components/ui";
import { paths, useApi, type LeaveListResponse, type PendingLeaveResponse } from "@/lib/api";
import { fmtDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/me";
import type { PendingLeave } from "@/lib/types";

export default function ApprovalsPage() {
  const { t, f, locale } = useI18n();
  const { userId } = useSession();
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const [open, setOpen] = useState<PendingLeave | null>(null);
  const p = useApi<PendingLeaveResponse>(paths.pendingLeave);
  const d = useApi<LeaveListResponse>(paths.decidedLeave);
  if (!p.data || !d.data)
    return p.error || d.error ? <LoadError onRetry={() => void Promise.all([p.mutate(), d.mutate()])} /> : <Skeleton />;

  const pending = p.data.requests; // sorted by start date on the server
  const decided = d.data.requests; // newest decision first

  return (
    <>
      <PageHeading eyebrow={t.approvals.eyebrow} title={t.approvals.title} sub={t.approvals.sub} />

      <div className="mb-4 flex gap-2">
        {(["pending", "decided"] as const).map((k) => (
          <button key={k} className={`btn btn-sm ${tab === k ? "btn-active" : ""}`} onClick={() => setTab(k)}>
            {k === "pending" ? t.approvals.pendingTab : t.approvals.decidedTab}
            <span className="tag tag-gray !px-1.5 !py-0.5">{k === "pending" ? pending.length : decided.length}</span>
          </button>
        ))}
      </div>

      {tab === "pending" ? (
        pending.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {pending.map((r) => {
              const u = r.user;
              const bal = r.balance;
              const ov = r.overlaps.length;
              return (
                <div key={r.id} className="card flex min-w-0 flex-col">
                  <div className="flex items-start gap-3">
                    <Avatar name={u.name} photoUrl={u.photoUrl} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-ink-2">{u.name}</div>
                      <div className="tiny">{u.unit}</div>
                    </div>
                    {r.userId === userId ? <span className="tag tag-gray">{t.approvals.own}</span> : <StatusTag status={r.status} />}
                  </div>
                  <div className="mt-4 text-[14px] font-semibold text-ink">
                    {fmtDate(r.start, locale)}
                    {r.end !== r.start && ` – ${fmtDate(r.end, locale)}`}{" "}
                    <span className="font-normal text-muted">
                      · {r.days} {t.common.days}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-muted">{r.reason}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="tag">
                      {t.leave.remaining}: {bal.remaining} {t.common.days}
                    </span>
                    {ov > 0 && (
                      <span className="tag tag-warn whitespace-normal">
                        <AlertTriangle size={11} /> {f(t.approvals.overlap, { count: ov })}
                      </span>
                    )}
                  </div>
                  <div className="mt-auto flex justify-end pt-4">
                    <button className="btn btn-primary btn-sm" onClick={() => setOpen(r)}>
                      {t.approvals.approve} / {t.approvals.reject} <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card">
            <Empty>{t.approvals.empty}</Empty>
          </div>
        )
      ) : (
        <div className="card !p-0">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.common.name}</th>
                  <th>{t.leave.period}</th>
                  <th>{t.common.days}</th>
                  <th>{t.common.status}</th>
                  <th>{t.common.note}</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id}>
                    <td data-label={t.common.name}>
                      <strong>{r.user.name}</strong>
                      <small>{r.user.unit}</small>
                    </td>
                    <td data-label={t.leave.period}>
                      {fmtDate(r.start, locale)}
                      {r.end !== r.start && ` – ${fmtDate(r.end, locale)}`}
                    </td>
                    <td data-label={t.common.days}>{r.days}</td>
                    <td data-label={t.common.status}>
                      <StatusTag status={r.status} />
                      <small>{f(t.leave.decidedBy, { name: r.decidedBy?.name ?? "—" })}</small>
                    </td>
                    <td data-label={t.common.note} className="max-w-[280px]">{r.decisionNote ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!decided.length && <Empty>{t.common.noData}</Empty>}
          </div>
        </div>
      )}

      {open && <LeaveDecisionModal request={open} onClose={() => setOpen(null)} />}
    </>
  );
}
