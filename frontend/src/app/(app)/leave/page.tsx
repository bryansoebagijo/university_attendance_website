"use client";

import { CalendarDays, CalendarMinus, FileText, Hourglass, Paperclip, Plus, Stethoscope, Wallet, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { AttachmentLink, Empty, LeaveTypeTag, LoadError, Modal, PageHeading, Skeleton, StatCard, StatusTag } from "@/components/ui";
import { ApiError, leaveApi, paths, useApi, type HolidaysResponse, type MyLeaveResponse } from "@/lib/api";
import { MySchedule, useFmtDays } from "@/components/schedule";
import { addDays, fmtDate, jakartaDate, scheduledDaysBetween } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { useStore } from "@/lib/store";
import { ATTACHMENT_MAX_BYTES, SICK_BACKDATE_DAYS, SICK_NOTE_MIN_DAYS, type LeaveType, type Schedule } from "@/lib/types";

export default function LeavePage() {
  const { t, f, locale } = useI18n();
  const { notify } = useStore();
  const { data, error, mutate } = useApi<MyLeaveResponse>(paths.myLeave);
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  if (!data) return error ? <LoadError onRetry={() => mutate()} /> : <Skeleton />;
  const { requests: mine, balance: bal, schedule } = data;

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

      <div className="mb-4">
        <MySchedule schedule={schedule} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label={t.leave.remaining} value={bal.remaining} unit={t.common.days} icon={<Wallet size={15} />} tone={bal.remaining <= 2 ? "red" : "green"} foot={`${t.leave.quota}: ${bal.quota}`} />
        <StatCard label={t.leave.used} value={bal.used} unit={t.common.days} icon={<CalendarDays size={15} />} tone="plain" />
        <StatCard label={t.dashboard.pendingLeave} value={bal.pending} unit={t.common.days} icon={<Hourglass size={15} />} tone="gold" />
        <StatCard label={t.leave.deducted} value={bal.deducted} unit={t.common.days} icon={<CalendarMinus size={15} />} tone="red" />
        <StatCard label={t.sick.sickThisYear} value={bal.sickDays} unit={t.common.days} icon={<Stethoscope size={15} />} tone="plain" foot={t.sick.sickFoot} />
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
                    <small className="flex flex-wrap items-center gap-2">
                      <LeaveTypeTag type={l.type} />
                      <AttachmentLink request={l} compact />
                    </small>
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

      {open && <LeaveForm available={bal.available} schedule={schedule} onClose={() => setOpen(false)} onCreated={() => mutate()} />}
    </>
  );
}

function LeaveForm({ available, schedule, onClose, onCreated }: { available: number; schedule: Schedule; onClose: () => void; onCreated: () => void }) {
  const fmtDays = useFmtDays();
  const { t, f, locale } = useI18n();
  const { notify } = useStore();
  const { mutate } = useSWRConfig();
  const today = jakartaDate();
  const tomorrow = addDays(today, 1);
  const [type, setType] = useState<LeaveType>("ANNUAL");
  const [start, setStart] = useState(tomorrow);
  const [end, setEnd] = useState(tomorrow);
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const sick = type === "SICK";
  // Annual leave starts tomorrow at the earliest; sick leave may start up to 7 days back.
  const minStart = sick ? addDays(today, -SICK_BACKDATE_DAYS) : tomorrow;
  // Same count as the server: weekends and holidays are skipped.
  const year = Number((start || tomorrow).slice(0, 4));
  const { data: hol } = useApi<HolidaysResponse>(paths.holidays(year));
  const holidays = useMemo(() => new Set((hol?.holidays ?? []).map((h) => h.date)), [hol]);
  const days = scheduledDaysBetween(start, end, schedule.history, holidays);
  const rangeBad = !!start && !!end && end < start;
  const yearBad = !!start && !!end && start.slice(0, 4) !== end.slice(0, 4);
  const tooEarly = !!start && start < minStart;
  const over = !sick && days > available;
  const noteNeeded = sick && days >= SICK_NOTE_MIN_DAYS;
  const noteMissing = noteNeeded && !file;
  const valid = !rangeBad && !yearBad && !tooEarly && days > 0 && !over && !noteMissing && reason.trim().length >= 5;

  const switchType = (next: LeaveType) => {
    setType(next);
    setServerError(null);
    // Sick leave usually starts today; annual leave tomorrow.
    const first = next === "SICK" ? today : tomorrow;
    setStart(first);
    setEnd(first);
    if (next === "ANNUAL") setFile(null);
  };

  const pickFile = (picked: File | undefined) => {
    setFileError(null);
    if (!picked) return;
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(picked.type)) return setFileError(t.sick.noteBadType);
    if (picked.size > ATTACHMENT_MAX_BYTES) return setFileError(t.sick.noteTooBig);
    setFile(picked);
  };

  // Quick checks run here for instant feedback; the server re-checks everything.
  const submit = async () => {
    setBusy(true);
    setServerError(null);
    try {
      await leaveApi.create({ type, start, end, reason: reason.trim(), attachment: sick ? file : null });
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
        SICK_TOO_LATE: f(t.sick.errTooLate, { days: SICK_BACKDATE_DAYS }),
        SICK_NOTE_REQUIRED: f(t.sick.noteMissing, { days: SICK_NOTE_MIN_DAYS }),
        UNSUPPORTED_ATTACHMENT: t.sick.noteBadType,
        FILE_TOO_LARGE: t.sick.noteTooBig,
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
      <div className="field mb-4">
        {t.sick.type}
        <div className="mt-[7px] grid grid-cols-2 gap-2" role="radiogroup" aria-label={t.sick.type}>
          {(["ANNUAL", "SICK"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={type === k}
              className={`btn justify-start ${type === k ? "btn-active" : ""}`}
              onClick={() => switchType(k)}
            >
              {k === "SICK" ? <Stethoscope size={15} /> : <CalendarDays size={15} />}
              {k === "SICK" ? t.sick.sick : t.sick.annual}
            </button>
          ))}
        </div>
        {sick && (
          <p className="tiny mt-2">
            {f(t.sick.backdateHint, { days: SICK_BACKDATE_DAYS })} {t.sick.noQuota}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          {t.leave.start}
          <input className="input" type="date" min={minStart} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          {t.leave.end}
          <input className="input" type="date" min={start || minStart} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="field sm:col-span-2">
          {t.common.reason}
          <textarea
            className="input min-h-[96px]"
            placeholder={sick ? t.sick.reasonPh : t.leave.reasonPh}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>

      {sick && (
        <div className="field mt-4">
          <span>
            {t.sick.note}{" "}
            <span className={noteNeeded ? "font-semibold text-danger" : "text-muted"}>
              · {noteNeeded ? f(t.sick.noteRequired, { days: SICK_NOTE_MIN_DAYS }) : t.sick.noteOptional}
            </span>
          </span>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {file ? (
            <div className="mt-[7px] flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
              {file.type === "application/pdf" ? <FileText size={18} className="shrink-0 text-muted" /> : <Paperclip size={18} className="shrink-0 text-muted" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink-2">{file.name}</div>
                <div className="tiny">{(file.size / 1024 / 1024).toFixed(file.size < 1024 * 1024 ? 2 : 1)} MB</div>
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFile(null)} aria-label={t.sick.noteRemove}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <button type="button" className="btn mt-[7px] w-full justify-center border-dashed" onClick={() => fileInput.current?.click()}>
              <Paperclip size={15} /> {t.sick.noteChoose}
            </button>
          )}
          <p className="tiny mt-1.5">{t.sick.noteHelp}</p>
          {fileError && <div className="notice notice-bad mt-2">{fileError}</div>}
        </div>
      )}

      <div className="mt-4 space-y-2">
        <p className="tiny">{f(t.schedule.leaveHint, { days: fmtDays(schedule.current.days, { isDefault: schedule.current.isDefault }) })}</p>
        {rangeBad ? (
          <div className="notice notice-bad">{t.leave.invalidRange}</div>
        ) : yearBad ? (
          <div className="notice notice-bad">{t.leave.errSpansYears}</div>
        ) : tooEarly ? (
          <div className="notice notice-bad">{sick ? f(t.sick.errTooLate, { days: SICK_BACKDATE_DAYS }) : t.leave.errPast}</div>
        ) : (
          <div className={`notice ${over || days === 0 ? "notice-bad" : "notice-ok"}`}>
            {f(t.schedule.workdays, { count: days })}
            {start && days > 0 && <> · {fmtDate(start, locale)}{end !== start && ` – ${fmtDate(end, locale)}`}</>}
            {over && <> · {f(t.leave.overBalance, { remaining: available })}</>}
          </div>
        )}
        {serverError && <div className="notice notice-bad">{serverError}</div>}
      </div>
    </Modal>
  );
}
