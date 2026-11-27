"use client";

import { CalendarRange, Copy, KeyRound, Pencil, Plus, Trash2, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { DayChips, ScheduleEditor } from "@/components/schedule";
import { SyncPanel } from "@/components/sync-panel";
import { Avatar, Empty, LoadError, Modal, PageHeading, Skeleton } from "@/components/ui";
import { fmtDate } from "@/lib/date";
import { ApiError, paths, staffApi, useApi, type StaffInput, type StaffResponse } from "@/lib/api";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/me";
import { useStore } from "@/lib/store";
import type { Role, StaffUser } from "@/lib/types";

const ROLES: Role[] = ["USER", "APPROVER", "ADMIN"];

export default function AdminUsersPage() {
  const { t, f, locale } = useI18n();
  const { userId } = useSession();
  const [scheduling, setScheduling] = useState<StaffUser | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);
  const [role, setRole] = useState<Role | "">("");
  const { data, error, mutate, isLoading } = useApi<StaffResponse>(paths.staff({ q: query, role }));
  const [editing, setEditing] = useState<StaffUser | "new" | null>(null);
  const [resetting, setResetting] = useState<StaffUser | null>(null);
  const [deleting, setDeleting] = useState<StaffUser | null>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const rows = data?.users ?? [];

  return (
    <>
      <PageHeading
        eyebrow={t.admin.attendanceEyebrow}
        title={t.admin.usersTitle}
        sub={t.admin.usersSub}
        actions={
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus size={15} /> {t.admin.addUser}
          </button>
        }
      />
      <div className="mb-4">
        <SyncPanel />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input input-inline min-w-[220px] flex-1" placeholder={t.common.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input input-inline" value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
          <option value="">{t.admin.role}: —</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t.roles[r]}
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
                <th>{t.admin.nip}</th>
                <th>{t.schedule.column}</th>
                <th>{t.admin.role}</th>
                <th>{t.admin.quota}</th>
                <th>{t.admin.remaining}</th>
                <th>{t.common.status}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const b = u.balance;
                const self = u.id === userId;
                return (
                  <tr key={u.id}>
                    <td data-label={t.common.name}>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} photoUrl={u.photoUrl} size={32} />
                        <div className="min-w-0">
                          <strong>
                            {u.name} {self && <span className="tag tag-gray ml-1">{t.admin.you}</span>}
                            {u.externalId && (
                              <span className="tag tag-blue ml-1 !px-1.5 !py-0.5 !text-[10px]" title={t.sync.syncedTitle}>
                                {t.sync.syncedTag}
                              </span>
                            )}
                            {!u.hasPassword && <span className="tag tag-warn ml-1 !px-1.5 !py-0.5 !text-[10px]">{t.sync.noPasswordTag}</span>}
                          </strong>
                          <small>
                            {u.email ?? `NIP ${u.nip}`}
                            {u.unit && ` · ${u.unit}`}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td data-label={t.admin.nip}>{u.nip}</td>
                    <td data-label={t.schedule.column}>
                      <button className="text-left" onClick={() => setScheduling(u)} title={t.schedule.edit}>
                        <DayChips days={u.schedule.days} />
                        {u.schedule.next?.from && (
                          <small className="!mt-1">{f(t.schedule.nextChange, { date: fmtDate(u.schedule.next.from, locale), days: u.schedule.next.days.map((d) => t.schedule.short[d - 1]).join(", ") })}</small>
                        )}
                      </button>
                    </td>
                    <td data-label={t.admin.role}>
                      <span className={`tag ${u.role === "ADMIN" ? "tag-bad" : u.role === "APPROVER" ? "tag-warn" : "tag-gray"}`}>{t.roles[u.role]}</span>
                    </td>
                    <td data-label={t.admin.quota}>{u.annualQuota}</td>
                    <td data-label={t.admin.remaining}>
                      {b ? <strong className={b.remaining <= 2 ? "!text-danger" : ""}>{b.remaining}</strong> : "—"}
                    </td>
                    <td data-label={t.common.status}>
                      <span className={`tag ${u.active ? "" : "tag-gray"}`}>{u.active ? t.status.ACTIVE : t.status.INACTIVE}</span>
                      {u.mustChangePassword && <small>{t.admin.mustChange}</small>}
                    </td>
                    <td data-label="" className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button className="btn btn-sm" onClick={() => setEditing(u)}>
                          <Pencil size={13} /> {t.common.edit}
                        </button>
                        <button className="btn btn-sm" onClick={() => setScheduling(u)}>
                          <CalendarRange size={13} /> {t.schedule.edit}
                        </button>
                        {!self && (
                          <button className="btn btn-sm" onClick={() => setResetting(u)}>
                            <KeyRound size={13} /> {t.admin.resetPassword}
                          </button>
                        )}
                        {!self && (
                          <button className="btn btn-sm btn-danger" onClick={() => setDeleting(u)} aria-label={`${t.admin.delete} ${u.name}`}>
                            <Trash2 size={13} /> {t.admin.delete}
                          </button>
                        )}
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
      {editing && (
        <UserForm
          user={editing === "new" ? null : editing}
          self={editing !== "new" && editing.id === userId}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            void mutate();
            if (created) setTemp(created);
          }}
        />
      )}
      {resetting && (
        <ResetPassword
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={(password) => {
            setTemp({ name: resetting.name, password });
            void mutate();
          }}
        />
      )}
      {temp && <TempPassword name={temp.name} password={temp.password} onClose={() => setTemp(null)} />}
      {scheduling && <ScheduleEditor user={scheduling} onClose={() => setScheduling(null)} />}
      {deleting && <DeleteStaff user={deleting} onClose={() => setDeleting(null)} onDone={() => void mutate()} />}
    </>
  );
}

function UserForm({
  user,
  self,
  onClose,
  onSaved,
}: {
  user: StaffUser | null;
  self: boolean;
  onClose: () => void;
  onSaved: (created?: { name: string; password: string }) => void;
}) {
  const { t } = useI18n();
  const { notify } = useStore();
  const [u, setU] = useState<StaffInput>({
    name: user?.name ?? "",
    email: user?.email ?? "",
    nip: user?.nip ?? "",
    role: user?.role ?? "USER",
    unit: user?.unit ?? "",
    annualQuota: user?.annualQuota ?? 12,
    active: user?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof StaffInput>(k: K, v: StaffInput[K]) => setU((x) => ({ ...x, [k]: v }));
  const emailText = (u.email ?? "").trim();
  // Email is optional (teachers can log in with their NIP), but must look right when given.
  const valid = u.name.trim().length >= 3 && (!emailText || /\S+@\S+\.\S+/.test(emailText)) && u.nip.trim().length >= 3 && u.annualQuota >= 0;
  // Synced teachers: name, NIP, email, unit and status come from the client's database.
  const synced = !!user?.externalId;

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = { ...u, name: u.name.trim(), email: emailText ? emailText.toLowerCase() : null, nip: u.nip.trim(), unit: u.unit.trim() };
    try {
      if (user) {
        // Admins can't change their own role or status; don't send those fields.
        const { role, active, ...rest } = body;
        const { name: _n, email: _e, nip: _p, unit: _u, ...appOwned } = rest;
        const fields = synced ? appOwned : rest;
        await staffApi.update(user.id, self ? fields : synced ? { ...fields, role } : { ...fields, role, active });
        notify(t.admin.userSaved);
        onSaved();
      } else {
        const res = await staffApi.create(body);
        notify(t.admin.userSaved);
        onSaved({ name: res.user.name, password: res.tempPassword });
      }
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(
        { SYNCED_FIELD: t.sync.syncedHint, EMAIL_TAKEN: t.admin.emailTaken, NIP_TAKEN: t.admin.nipTaken, SELF_CHANGE: t.admin.selfChange, LAST_ADMIN: t.admin.lastAdmin }[code] ??
          t.errors.generic,
      );
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={user ? `${t.common.edit} — ${user.name}` : t.admin.addUser}
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
      {synced && <div className="notice mb-4 text-[12.5px]">{t.sync.syncedHint}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field sm:col-span-2">
          {t.common.name}
          <input className="input" value={u.name} disabled={synced} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="field">
          {t.admin.email} <span className="font-normal text-muted">({t.sync.optional})</span>
          <input className="input" type="email" value={u.email ?? ""} disabled={synced} onChange={(e) => set("email", e.target.value)} />
        </label>
        <label className="field">
          {t.admin.nip}
          <input className="input" value={u.nip} disabled={synced} onChange={(e) => set("nip", e.target.value)} />
        </label>
        <label className="field">
          {t.admin.unit}
          <input className="input" value={u.unit} disabled={synced} onChange={(e) => set("unit", e.target.value)} />
        </label>
        <label className="field">
          {t.admin.role}
          <select className="input" value={u.role} disabled={self} onChange={(e) => set("role", e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t.roles[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t.admin.quota} ({t.common.days})
          <input className="input" type="number" min={0} max={60} value={u.annualQuota} onChange={(e) => set("annualQuota", Number(e.target.value))} />
        </label>
        <label className="field flex items-center gap-2 self-end pb-3">
          <input type="checkbox" checked={u.active} disabled={self || synced} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4 accent-brand" />
          {t.status.ACTIVE}
        </label>
      </div>
      {self && <p className="tiny mt-3">{t.admin.selfChange}</p>}
      {error && <div className="notice notice-bad mt-3">{error}</div>}
    </Modal>
  );
}

function ResetPassword({ user, onClose, onDone }: { user: StaffUser; onClose: () => void; onDone: (password: string) => void }) {
  const { t, f } = useI18n();
  const { notify } = useStore();
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    try {
      const { tempPassword } = await staffApi.resetPassword(user.id);
      onClose();
      onDone(tempPassword);
    } catch {
      notify(t.errors.generic);
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t.admin.resetPassword}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void reset()}>
            <KeyRound size={14} /> {t.admin.resetPassword}
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted">{f(t.admin.resetConfirm, { name: user.name })}</p>
    </Modal>
  );
}

/** Shown once after creating an account or resetting a password. */
function TempPassword({ name, password, onClose }: { name: string; password: string; onClose: () => void }) {
  const { t, f } = useI18n();
  const { notify } = useStore();
  return (
    <Modal
      open
      onClose={onClose}
      title={t.admin.tempTitle}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          {t.common.close}
        </button>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted">{f(t.admin.tempBody, { name })}</p>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-3">
        <code className="flex-1 select-all font-mono text-[20px] font-semibold tracking-[2px] text-ink">{password}</code>
        <button
          className="btn btn-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(() => notify(t.admin.copied));
          }}
        >
          <Copy size={13} /> {t.admin.copy}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Permanent delete for accounts created by mistake. If the person has history, the server refuses
 * (HAS_HISTORY) and the dialog offers to deactivate the account instead.
 */
function DeleteStaff({ user, onClose, onDone }: { user: StaffUser; onClose: () => void; onDone: () => void }) {
  const { t, f } = useI18n();
  const { notify } = useStore();
  const [busy, setBusy] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await staffApi.remove(user.id);
      notify(t.admin.deleted);
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "HAS_HISTORY") setHasHistory(true);
      else setError(t.errors.generic);
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      await staffApi.update(user.id, { active: false });
      notify(t.admin.deactivated);
      onDone();
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(code === "LAST_ADMIN" ? t.admin.lastAdmin : t.errors.generic);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t.admin.deleteTitle}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          {hasHistory ? (
            user.active && (
              <button className="btn btn-primary" disabled={busy} onClick={() => void deactivate()}>
                <UserX size={14} /> {t.admin.deactivate}
              </button>
            )
          ) : (
            <button className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={14} /> {t.admin.delete}
            </button>
          )}
        </>
      }
    >
      <div className="flex items-center gap-3">
        <Avatar name={user.name} photoUrl={user.photoUrl} size={40} />
        <div className="min-w-0">
          <div className="font-semibold text-ink-2">{user.name}</div>
          <div className="tiny">
            {user.email ?? "—"} · {user.nip}
          </div>
        </div>
      </div>
      {hasHistory ? (
        <div className="notice mt-4">{f(t.admin.hasHistory, { name: user.name })}</div>
      ) : (
        <>
          <p className="mt-4 text-[13px] leading-relaxed text-ink-2">{f(t.admin.deleteConfirm, { name: user.name })}</p>
          <p className="tiny mt-2">{t.admin.deleteOnlyNoHistory}</p>
        </>
      )}
      {error && <div className="notice notice-bad mt-3">{error}</div>}
    </Modal>
  );
}
