"use client";

import { CalendarRange, PencilLine, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { ApiError, correctionsApi, paths, useApi } from "@/lib/api";
import { fmtDate, jakartaDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { useStore } from "@/lib/store";
import type { Attendance, Schedule } from "@/lib/types";
import { Modal, Skeleton } from "./ui";

/** "Selasa, Kamis" — or the Monday–Friday default label. */
export function useFmtDays() {
  const { t } = useI18n();
  return (days: number[], opts: { isDefault?: boolean; short?: boolean } = {}) => {
    if (opts.isDefault) return t.schedule.defaultDays;
    const names = opts.short ? t.schedule.short : t.schedule.long;
    return days.map((d) => names[d - 1]).join(", ");
  };
}

/** Compact weekday chips, e.g. for the staff list. */
export function DayChips({ days }: { days: number[] }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex flex-nowrap gap-[3px]">
      {[1, 2, 3, 4, 5, 6].map((d) => (
        <span
          key={d}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${days.includes(d) ? "bg-ok-soft text-ok" : "bg-subtle text-muted-2 line-through opacity-60"}`}
        >
          {t.schedule.short[d - 1]}
        </span>
      ))}
    </span>
  );
}

/** "Di luar jadwal": attended on a day that wasn't scheduled. */
export function OutsideTag() {
  const { t } = useI18n();
  return (
    <span className="tag tag-blue ml-1.5 !px-1.5 !py-0.5 !text-[10px]" title={t.schedule.outsideTitle}>
      {t.schedule.outside}
    </span>
  );
}

/** "Diubah admin" with the admin's name and reason on hover. */
export function EditedTag({ record }: { record: Pick<Attendance, "edit"> }) {
  const { t, f } = useI18n();
  if (!record.edit) return null;
  return (
    <span className="tag tag-warn ml-1.5 !px-1.5 !py-0.5 !text-[10px]" title={f(t.corrections.editedBy, { name: record.edit.by?.name ?? "Admin", reason: record.edit.reason ?? "" })}>
      <PencilLine size={10} /> {t.corrections.editedTag}
    </span>
  );
}

/** "Jadwal Anda: Selasa, Kamis" (+ the next change), for teachers. */
export function MySchedule({ schedule }: { schedule: Schedule }) {
  const { t, f, locale } = useI18n();
  const fmt = useFmtDays();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
      <CalendarRange size={14} className="shrink-0 text-brand" />
      <span>
        {t.schedule.mine}: <b className="text-ink-2">{fmt(schedule.current.days, { isDefault: schedule.current.isDefault })}</b>
      </span>
      {schedule.next && schedule.next.from && (
        <span className="tiny">· {f(t.schedule.nextChange, { date: fmtDate(schedule.next.from, locale), days: fmt(schedule.next.days, { short: true }) })}</span>
      )}
    </div>
  );
}

/** Admin: set a person's weekdays from a date on, and see/remove earlier periods. */
export function ScheduleEditor({ user, onClose }: { user: { id: string; name: string }; onClose: () => void }) {
  const { t, f, locale } = useI18n();
  const { notify } = useStore();
  const { mutate } = useSWRConfig();
  const fmt = useFmtDays();
  const { data, mutate: refresh } = useApi<{ schedule: Schedule }>(paths.staffSchedule(user.id));
  const today = jakartaDate();
  const [from, setFrom] = useState(today);
  const [days, setDays] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = data?.schedule.current.days ?? [1, 2, 3, 4, 5];
  const picked = days ?? current;

  const refreshAll = async (schedule: Schedule) => {
    await refresh({ schedule }, { revalidate: false });
    // Lists, dashboards and recaps all depend on schedules.
    void mutate((key) => typeof key === "string" && (key.startsWith("/admin/") || key.startsWith("/attendance/") || key.startsWith("/leave")));
  };

  const save = async () => {
    if (!picked.length) return setError(t.schedule.pickDay);
    setBusy(true);
    setError(null);
    try {
      const res = await correctionsApi.setSchedule(user.id, from, picked);
      await refreshAll(res.schedule);
      notify(t.schedule.saved);
      onClose();
    } catch {
      setError(t.errors.generic);
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const res = await correctionsApi.deleteSchedule(user.id, id);
      await refreshAll(res.schedule);
      setDays(null);
      notify(t.schedule.deleted);
    } catch (err) {
      setError(err instanceof ApiError ? t.errors.generic : t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={f(t.schedule.editTitle, { name: user.name })}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn btn-primary" disabled={busy || !data || !picked.length || !from} onClick={() => void save()}>
            {t.schedule.save}
          </button>
        </>
      }
    >
      {!data ? (
        <Skeleton />
      ) : (
        <>
          <div className="field">
            {t.schedule.title}
            <div className="mt-[7px] grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[1, 2, 3, 4, 5, 6].map((d) => {
                const on = picked.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={`btn !px-2 ${on ? "btn-active" : ""}`}
                    onClick={() => {
                      setError(null);
                      setDays(on ? picked.filter((x) => x !== d) : [...picked, d].sort());
                    }}
                  >
                    {t.schedule.short[d - 1]}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="field mt-4 block max-w-[240px]">
            {t.schedule.effectiveFrom}
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <p className="tiny mt-2">{t.schedule.hint}</p>
          {error && <div className="notice notice-bad mt-3">{error}</div>}

          <div className="mt-5 border-t border-line pt-4">
            <div className="tiny mb-2 uppercase tracking-[0.7px]">{t.schedule.history}</div>
            {data.schedule.history.length === 0 ? (
              <p className="text-[13px] text-muted">{t.schedule.noHistory}</p>
            ) : (
              <ul className="space-y-1.5">
                {[...data.schedule.history].reverse().map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
                    <span className="w-[110px] shrink-0 text-muted">{p.from ? fmtDate(p.from, locale) : "—"}</span>
                    <span className="flex-1 font-semibold text-ink-2">{fmt(p.days)}</span>
                    {p.id && (
                      <button className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={() => void remove(p.id!)} aria-label={t.schedule.deletePeriod} title={t.schedule.deletePeriod}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
