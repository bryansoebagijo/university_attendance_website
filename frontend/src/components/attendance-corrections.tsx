"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { ApiError, correctionsApi, paths, useApi } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { useStore } from "@/lib/store";
import type { Attendance, Location } from "@/lib/types";
import { Modal } from "./ui";

type Person = { id: string; name: string };

/** After any correction: refresh admin lists, recaps, dashboards and the person's own views. */
function useRefreshAll() {
  const { mutate } = useSWRConfig();
  return () => void mutate((key) => typeof key === "string" && (key.startsWith("/admin/") || key.startsWith("/attendance/") || key.startsWith("/leave")));
}

function useErrorText() {
  const { t } = useI18n();
  return (err: unknown) => {
    const code = err instanceof ApiError ? err.code : "";
    return (t.corrections.errors as Record<string, string>)[code] ?? (code === "VALIDATION" ? t.corrections.reasonShort : t.errors.generic);
  };
}

function ReasonField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useI18n();
  return (
    <label className="field mt-4 block">
      {t.corrections.reason}
      <textarea className="input min-h-[70px]" placeholder={placeholder ?? t.corrections.reasonPh} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Add a missing record or correct an existing one (times in WIB). */
export function AttendanceForm({ user, date, record, onClose }: { user: Person; date: string; record: Attendance | null; onClose: () => void }) {
  const { t, f, locale } = useI18n();
  const { notify } = useStore();
  const refreshAll = useRefreshAll();
  const errorText = useErrorText();
  const { data: locs } = useApi<{ locations: Location[] }>(paths.adminLocations);
  const [clockIn, setClockIn] = useState(record ? fmtTime(record.clockIn) : "08:00");
  const [clockOut, setClockOut] = useState(record?.clockOut ? fmtTime(record.clockOut) : "");
  const [locationId, setLocationId] = useState(record?.inLocation.id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outBad = !!clockOut && clockOut <= clockIn;
  const valid = !!clockIn && !outBad && reason.trim().length >= 5;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await correctionsApi.saveAttendance(user.id, date, { clockIn, clockOut: clockOut || null, reason: reason.trim(), locationId: locationId || undefined });
      notify(t.corrections.saved);
      refreshAll();
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={f(record ? t.corrections.editTitle : t.corrections.addTitle, { name: user.name })}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>
            {t.common.save}
          </button>
        </>
      }
    >
      <p className="page-sub !mt-0 mb-4">{fmtDate(date, locale)}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="field">
          {t.common.clockIn}
          <input className="input" type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} />
        </label>
        <label className="field">
          {t.common.clockOut}
          <input className="input" type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
          <span className="tiny mt-1 block font-normal">{t.corrections.clockOutEmpty}</span>
        </label>
        <label className="field">
          {t.corrections.location}
          <select className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">—</option>
            {(locs?.locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {outBad && <div className="notice notice-bad mt-3">{t.corrections.errors.CLOCK_OUT_BEFORE_IN}</div>}
      <ReasonField value={reason} onChange={setReason} />
      {error && <div className="notice notice-bad mt-3">{error}</div>}
    </Modal>
  );
}

export function DeleteAttendance({ user, record, onClose }: { user: Person; record: Attendance; onClose: () => void }) {
  const { t, f, locale } = useI18n();
  const { notify } = useStore();
  const refreshAll = useRefreshAll();
  const errorText = useErrorText();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await correctionsApi.deleteAttendance(record.id, reason.trim());
      notify(t.corrections.deleted);
      refreshAll();
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={f(t.corrections.deleteTitle, { name: user.name })}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn btn-danger" disabled={reason.trim().length < 5 || busy} onClick={() => void remove()}>
            {t.corrections.deleteBtn}
          </button>
        </>
      }
    >
      <div className="notice notice-bad">
        {f(t.corrections.deleteHint, { in: fmtTime(record.clockIn), out: fmtTime(record.clockOut), date: fmtDate(record.date, locale) })}
      </div>
      <ReasonField value={reason} onChange={setReason} placeholder={t.corrections.deletePh} />
      {error && <div className="notice notice-bad mt-3">{error}</div>}
    </Modal>
  );
}

/** "Bebaskan": the scheduled day doesn't count as absent and costs no leave. */
export function ExemptDay({ user, date, onClose }: { user: Person; date: string; onClose: () => void }) {
  const { t, f, locale } = useI18n();
  const { notify } = useStore();
  const refreshAll = useRefreshAll();
  const errorText = useErrorText();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await correctionsApi.exempt(user.id, date, reason.trim());
      notify(t.corrections.exempted);
      refreshAll();
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t.corrections.exemptTitle}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn btn-primary" disabled={reason.trim().length < 5 || busy} onClick={() => void save()}>
            {t.corrections.exempt}
          </button>
        </>
      }
    >
      <div className="notice notice-ok">{f(t.corrections.exemptHint, { name: user.name, date: fmtDate(date, locale) })}</div>
      <ReasonField value={reason} onChange={setReason} placeholder={t.corrections.exemptPh} />
      {error && <div className="notice notice-bad mt-3">{error}</div>}
    </Modal>
  );
}

export function useUnexempt() {
  const { t } = useI18n();
  const { notify } = useStore();
  const refreshAll = useRefreshAll();
  return async (id: string) => {
    try {
      await correctionsApi.unexempt(id);
      notify(t.corrections.unexempted);
      refreshAll();
    } catch {
      notify(t.errors.generic);
    }
  };
}
