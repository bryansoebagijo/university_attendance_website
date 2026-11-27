"use client";

import { AlertTriangle, Download, KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { ApiError, syncApi, useApi, type IssuedPassword, type SyncRun, type SyncStatus } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n/provider";
import { useStore } from "@/lib/store";
import { Modal } from "./ui";

const tone: Record<SyncRun["status"], string> = { OK: "", ERROR: "tag-bad", ABORTED: "tag-warn", RUNNING: "tag-blue" };

/** Admin: teacher sync with the campus database — status, "Sinkronkan sekarang", and one-time passwords for new accounts. */
export function SyncPanel() {
  const { t, f, locale } = useI18n();
  const { notify } = useStore();
  const { mutate } = useSWRConfig();
  const { data, mutate: refresh } = useApi<SyncStatus>(syncApi.status);
  const [busy, setBusy] = useState(false);
  const [askForce, setAskForce] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedPassword[] | null>(null);
  if (!data) return null;
  const last = data.runs[0];
  const fmt = (iso: string) => new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
  const errorText = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : "";
    return (t.sync.errors as Record<string, string>)[code] ?? t.errors.generic;
  };

  const run = async (force = false) => {
    setBusy(true);
    setAskForce(null);
    try {
      const { run } = await syncApi.run(force);
      await refresh();
      // Staff lists, dashboards and recaps may have changed.
      void mutate((key) => typeof key === "string" && key.startsWith("/admin/"));
      if (run.status === "ABORTED" && !force && run.deactivated === 0 && run.sourceRows > 0) setAskForce(run.message ?? "");
      else notify(run.status === "OK" ? t.sync.done : `${t.sync.status[run.status]}: ${run.message ?? ""}`);
    } catch (err) {
      notify(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    setBusy(true);
    try {
      const { accounts } = await syncApi.issuePasswords();
      setIssued(accounts);
      await refresh();
      void mutate((key) => typeof key === "string" && key.startsWith("/admin/users"));
    } catch (err) {
      notify(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="card-title">{t.sync.title}</h2>
          <p className="card-sub">{data.configured ? (data.nightly ? t.sync.nightly : t.sync.manualOnly) : t.sync.notConfigured}</p>
          {data.configured && data.source && data.source !== "same-server" && <p className="tiny mt-1">{f(t.sync.sourceLabel, { source: data.source })}</p>}
        </div>
        <button className="btn btn-sm btn-primary" disabled={!data.configured || busy} onClick={() => void run()}>
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> {busy ? t.sync.running : t.sync.runNow}
        </button>
      </div>

      {data.configured && (
        <div className="mt-4 space-y-2 text-[12.5px]">
          {last ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`tag ${tone[last.status]}`}>{t.sync.status[last.status]}</span>
                <span className="text-muted">
                  {f(t.sync.lastRun, { date: fmt(last.startedAt) })} · {t.sync.trigger[last.trigger]}
                </span>
                <span className="tiny">· {f(t.sync.synced, { count: data.syncedAccounts })}</span>
              </div>
              <div className="text-ink-2">{f(t.sync.result, { added: last.added, updated: last.updated, deactivated: last.deactivated, reactivated: last.reactivated, photos: last.photos, skipped: last.skipped })}</div>
              {last.message && <div className="text-muted">{last.message}</div>}
              {last.problems.length > 0 && (
                <details className="text-muted">
                  <summary className="cursor-pointer text-warn">
                    <AlertTriangle size={12} className="mr-1 inline" />
                    {f(t.sync.problems, { count: last.problems.length })}
                  </summary>
                  <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5">
                    {last.problems.slice(0, 100).map((p, i) => (
                      <li key={i}>
                        {[p.externalId && `ID ${p.externalId}`, p.nip && `NIP ${p.nip}`].filter(Boolean).join(" · ")} — {p.error}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <div className="text-muted">{t.sync.never}</div>
          )}
        </div>
      )}

      {data.needPassword > 0 && (
        <div className="notice mt-4 flex flex-wrap items-center gap-3">
          <KeyRound size={15} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <b>{f(t.sync.needPassword, { count: data.needPassword })}</b>
            <div className="text-[12px]">{t.sync.needPasswordHint}</div>
          </div>
          <button className="btn btn-sm" disabled={busy} onClick={() => void issue()}>
            {t.sync.issue}
          </button>
        </div>
      )}

      {askForce !== null && (
        <Modal
          open
          onClose={() => setAskForce(null)}
          title={t.sync.forceTitle}
          footer={
            <>
              <button className="btn" onClick={() => setAskForce(null)}>
                {t.common.cancel}
              </button>
              <button className="btn btn-danger" onClick={() => void run(true)}>
                {t.sync.force}
              </button>
            </>
          }
        >
          <div className="notice notice-bad">{f(t.sync.forceBody, { message: askForce })}</div>
        </Modal>
      )}

      {issued && (
        <Modal
          open
          onClose={() => setIssued(null)}
          title={t.sync.issueTitle}
          footer={
            <>
              <button className="btn" onClick={() => setIssued(null)}>
                {t.common.close}
              </button>
              <button
                className="btn btn-primary"
                disabled={!issued.length}
                onClick={() =>
                  downloadCsv(`sandi-sementara-${new Date().toISOString().slice(0, 10)}.csv`, [
                    ["Nama", "NIP", "Email", "Unit", "Masuk dengan", "Kata sandi sementara"],
                    ...issued.map((a) => [a.name, a.nip, a.email ?? "", a.unit, a.email ?? a.nip, a.tempPassword]),
                  ])
                }
              >
                <Download size={14} /> {t.sync.issueDownload}
              </button>
            </>
          }
        >
          {issued.length ? (
            <>
              <p className="page-sub !mt-0 mb-3">{t.sync.issueBody}</p>
              <div className="max-h-[50vh] overflow-auto rounded-lg border border-line">
                <table className="table">
                  <tbody>
                    {issued.map((a) => (
                      <tr key={a.id}>
                        <td data-label={t.common.name}>
                          <strong>{a.name}</strong>
                          <small>{a.email ?? `NIP ${a.nip}`}</small>
                        </td>
                        <td data-label="" className="text-right">
                          <code className="font-mono text-[14px] font-semibold tracking-wider text-ink">{a.tempPassword}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="page-sub">{t.sync.issueNone}</p>
          )}
        </Modal>
      )}
    </div>
  );
}
