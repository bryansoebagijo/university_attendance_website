"use client";

import { CalendarDays, CalendarMinus, Hourglass, Plus, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { Empty, LoadError, Modal, PageHeading, Skeleton, StatCard, StatusTag } from "@/components/ui";
import { ApiError, leaveApi, paths, useApi, type HolidaysResponse, type MyLeaveResponse } from "@/lib/api";
import { addDays, fmtDate, jakartaDate, workdaysBetween } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { useStore } from "@/lib/store";

export default function LeavePage() {
  const { t, f, locale } = useI18n();
  const { notify } = useStore();
  const { data, error, mutate } = useApi<MyLeaveResponse>(paths.myLeave);
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  if (!data) return error ? <LoadError onRetry={() => mutate()} /> : <Skeleton />;
  const { requests: mine, balance: bal } = data;

  const cancel = async (id: string) => {
    setCancelling(id);
    try {
      await leaveApi.cancel(id);
      notify(t.leave.cancelled);
      await mutate();
    } catch {
      notify(t.errors.generic);
    } finally {
      setCancelling(null);
    }
  };

  return (
    <>
      <PageHeading
        eyebrow={t.leave.eyebrow}
        title={t.leave.title}
        sub={t.leave.sub}
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={15} /> {t.leave.new}
          </button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t.leave.remaining} value={bal.remaining} unit={t.common.days} icon={<Wallet size={15} />} tone={bal.remaining <= 2 ? "red" : "green"} foot={`${t.leave.quota}: ${bal.quota}`} />
        <StatCard label={t.leave.used} value={bal.used} unit={t.common.days} icon={<CalendarDays size={15} />} tone="plain" />
        <StatCard label={t.dashboard.pendingLeave} value={bal.pending} unit={t.common.days} icon={<Hourglass size={15} />} tone="gold" />
        <StatCard label={t.leave.deducted} value={bal.deducted} unit={t.common.days} icon={<CalendarMinus size={15} />} tone="red" />
      </div>

      <div className="card !p-0">
        <h2 className="card-title px-[21px] pb-3 pt-5">{t.leave.myRequests}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.leave.period}</th>
                <th>{t.common.days}</th>
                <th>{t.common.reason}</th>
                <th>{t.common.status}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mine.map((l) => (
                <tr key={l.id}>
                  <td data-label={t.leave.period}>
                    <strong>
                      {fmtDate(l.start, locale)}
                      {l.end !== l.start && ` – ${fmtDate(l.end, locale)}`}
                    </strong>
                    <small>{f(t.leave.submittedAt, { date: fmtDate(l.createdAt.slice(0, 10), locale) })}</small>
                  </td>
                  <td data-label={t.common.days}>{l.days}</td>
                  <td data-label={t.common.reason} className="max-w-[320px]">
                    {l.reason}
                    {l.decisionNote && <small>💬 {l.decisionNote}</small>}
                  </td>
                  <td data-label={t.common.status}>
                    <StatusTag status={l.status} />
                    {l.decidedBy && <small>{f(t.leave.decidedBy, { name: l.decidedBy.name })}</small>}
                  </td>
                  <td data-label="" className="text-right">
                    {l.status === "PENDING" && (
                      <button className="btn btn-sm btn-danger" disabled={cancelling === l.id} onClick={() => void cancel(l.id)}>
                        {t.leave.cancelReq}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!mine.length && <Empty>{t.common.noData}</Empty>}
        </div>
      </div>

      {open && <LeaveForm available={bal.available} onClose={() => setOpen(false)} onCreated={() => mutate()} />}
    </>
  );
}

function LeaveForm({ available, onClose, onCreated }: { available: number; onClose: () => void; onCreated: () => void }) {
  const { t, f } = useI18n();
  const { notify } = useStore();
  const { mutate } = useSWRConfig();
  const tomorrow = addDays(jakartaDate(), 1);
  const [start, setStart] = useState(tomorrow);
  const [end, setEnd] = useState(tomorrow);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Same count as the server: weekends and holidays are skipped.
  const year = Number((start || tomorrow).slice(0, 4));
  const { data: hol } = useApi<HolidaysResponse>(paths.holidays(year));
  const holidays = useMemo(() => new Set((hol?.holidays ?? []).map((h) => h.date)), [hol]);
  const days = workdaysBetween(start, end, holidays);
  const rangeBad = !!start && !!end && end < start;
  const yearBad = !!start && !!end && start.slice(0, 4) !== end.slice(0, 4);
  const over = days > available;
  const valid = !rangeBad && !yearBad && days > 0 && !over && reason.trim().length >= 5;

  // Quick checks run here for instant feedback; the server re-checks everything.
  const submit = async () => {
    setBusy(true);
    setServerError(null);
    try {
      await leaveApi.create(start, end, reason.trim());
      notify(t.leave.submitted);
      onCreated();
      void mutate(paths.overview);
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      const msg: Record<string, string> = {
        OVERLAPS_EXISTING: t.leave.errOverlap,
        INSUFFICIENT_BALANCE: f(t.leave.overBalance, { remaining: available }),
        START_IN_PAST: t.leave.errPast,
        SPANS_YEARS: t.leave.errSpansYears,
        NO_WORKDAYS: t.leave.errNoWorkdays,
        INVALID_RANGE: t.leave.invalidRange,
      };
      setServerError(msg[code] ?? t.errors.generic);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t.leave.new}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void submit()}>
            {t.common.submit}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          {t.leave.start}
          <input className="input" type="date" min={tomorrow} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          {t.leave.end}
          <input className="input" type="date" min={start || tomorrow} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="field sm:col-span-2">
          {t.common.reason}
          <textarea className="input min-h-[96px]" placeholder={t.leave.reasonPh} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="mt-4 space-y-2">
        {rangeBad ? (
          <div className="notice notice-bad">{t.leave.invalidRange}</div>
        ) : yearBad ? (
          <div className="notice notice-bad">{t.leave.errSpansYears}</div>
        ) : (
          <div className={`notice ${over || days === 0 ? "notice-bad" : "notice-ok"}`}>
            {f(t.leave.workdays, { count: days })}
            {over && <> · {f(t.leave.overBalance, { remaining: available })}</>}
          </div>
        )}
        {serverError && <div className="notice notice-bad">{serverError}</div>}
      </div>
    </Modal>
  );
}
