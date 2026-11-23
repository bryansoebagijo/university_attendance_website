"use client";

import { CalendarOff, Info, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Empty, LoadError, Modal, PageHeading, Skeleton } from "@/components/ui";
import { holidaysApi, paths, useApi, type HolidaysResponse } from "@/lib/api";
import { fmtDate, fmtWeekday, jakartaDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { useStore } from "@/lib/store";

export default function HolidaysPage() {
  const { t, locale } = useI18n();
  const { notify } = useStore();
  const thisYear = Number(jakartaDate().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const { data, error, mutate } = useApi<HolidaysResponse>(paths.holidays(year));
  const [adding, setAdding] = useState(false);
  const list = (data?.holidays ?? []).filter((h) => h.date.startsWith(String(year)));

  const remove = async (date: string) => {
    try {
      await holidaysApi.remove(date);
      notify(t.holidays.removed);
      void mutate();
    } catch {
      notify(t.errors.generic);
    }
  };

  return (
    <div className="max-w-[860px]">
      <PageHeading
        eyebrow={t.holidays.eyebrow}
        title={t.holidays.title}
        sub={t.holidays.sub}
        actions={
          <>
            <select className="input input-inline" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={t.holidays.year}>
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> {t.holidays.add}
            </button>
          </>
        }
      />
      <div className="notice mb-5 flex items-start gap-3">
        <Info size={16} className="mt-0.5 shrink-0" />
        {t.holidays.note}
      </div>
      {!data ? (
        error ? <LoadError onRetry={() => mutate()} /> : <Skeleton />
      ) : (
        <div className="card !p-0">
          {list.length ? (
            <ul>
              {list.map((h) => (
                <li key={h.date} className="flex items-center gap-4 border-b border-line-soft px-5 py-3.5 last:border-0">
                  <span className="task-icon">
                    <CalendarOff size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink-2">{h.name}</div>
                    <div className="tiny">
                      {fmtWeekday(h.date, locale)}, {fmtDate(h.date, locale)}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-danger" onClick={() => void remove(h.date)} aria-label={`${t.holidays.remove} ${h.name}`}>
                    <Trash2 size={13} /> <span className="hidden sm:inline">{t.holidays.remove}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{t.holidays.empty}</Empty>
          )}
        </div>
      )}
      {adding && <AddHoliday defaultYear={year} onClose={() => setAdding(false)} onSaved={() => mutate()} />}
    </div>
  );
}

function AddHoliday({ defaultYear, onClose, onSaved }: { defaultYear: number; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { notify } = useStore();
  const today = jakartaDate();
  const [date, setDate] = useState(today.startsWith(String(defaultYear)) ? today : `${defaultYear}-01-01`);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await holidaysApi.save(date, name.trim());
      notify(t.holidays.saved);
      onSaved();
      onClose();
    } catch {
      notify(t.errors.generic);
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t.holidays.add}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn btn-primary" disabled={busy || !date || name.trim().length < 2} onClick={() => void save()}>
            {t.common.save}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <label className="field">
          {t.holidays.date}
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          {t.holidays.name}
          <input className="input" placeholder={t.holidays.namePh} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
