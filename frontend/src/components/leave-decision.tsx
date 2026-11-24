"use client";

import { AlertTriangle, Check, X } from "lucide-react";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { ApiError, leaveApi } from "@/lib/api";
import { fmtDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/me";
import { useStore } from "@/lib/store";
import type { PendingLeave } from "@/lib/types";
import { AttachmentLink, Avatar, LeaveTypeTag, Modal } from "./ui";

/** Shared approve/reject dialog (approvers and admins). Balance and overlaps come from GET /api/leave/pending. */
export function LeaveDecisionModal({ request, onClose }: { request: PendingLeave; onClose: () => void }) {
  const { t, f, locale } = useI18n();
  const { userId } = useSession();
  const { notify } = useStore();
  const { mutate } = useSWRConfig();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const user = request.user;
  const bal = request.balance;
  const sick = request.type === "SICK";
  // Sick leave never uses the annual quota, so the balance can't block it.
  const after = sick ? bal.remaining : bal.remaining - request.days;
  const own = request.userId === userId;

  const decide = async (approve: boolean) => {
    if (!approve && !note.trim()) {
      setError(t.approvals.rejectNoteRequired);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await leaveApi.decide(request.id, approve, note.trim());
      notify(approve ? t.approvals.approved : t.approvals.rejected);
      // Refresh every list that shows leave.
      void mutate((key) => typeof key === "string" && (key.startsWith("/leave") || key.startsWith("/admin/")));
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(
        { OWN_REQUEST: t.approvals.errOwn, NOT_PENDING: t.approvals.errNotPending, INSUFFICIENT_BALANCE: t.approvals.errBalance, NOTE_REQUIRED: t.approvals.rejectNoteRequired }[code] ??
          t.errors.generic,
      );
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t.approvals.title}
      footer={
        <>
          <button className="btn btn-danger" onClick={() => void decide(false)} disabled={busy || own}>
            <X size={15} /> {t.approvals.reject}
          </button>
          <button className="btn btn-primary" onClick={() => void decide(true)} disabled={busy || own || after < 0}>
            <Check size={15} /> {t.approvals.approve}
          </button>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <Avatar name={user.name} photoUrl={user.photoUrl} size={42} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink-2">{user.name}</div>
          <div className="tiny">
            {user.unit} · {user.nip}
          </div>
        </div>
        <LeaveTypeTag type={request.type} />
      </div>
      <div className="mt-5 grid gap-3 rounded-xl bg-surface-2 p-4 text-[13px] sm:grid-cols-2">
        <div>
          <div className="tiny uppercase tracking-[0.7px]">{t.leave.period}</div>
          <b className="text-ink-2">
            {fmtDate(request.start, locale)}
            {request.end !== request.start && ` – ${fmtDate(request.end, locale)}`}
          </b>
          <div className="tiny">
            {request.days} {t.common.days}
          </div>
        </div>
        {sick ? (
          <div>
            <div className="tiny uppercase tracking-[0.7px]">{t.sick.sickThisYear}</div>
            <b className="text-ink-2">
              {bal.sickDays} {t.common.days}
            </b>
            <div className="tiny">{t.sick.notCounted}</div>
          </div>
        ) : (
          <div>
            <div className="tiny uppercase tracking-[0.7px]">{t.leave.remaining}</div>
            <b className={after < 0 ? "text-danger" : "text-ink-2"}>
              {bal.remaining} {t.common.days}
            </b>
            <div className="tiny">{f(t.approvals.balanceAfter, { count: after })}</div>
          </div>
        )}
        <div className="sm:col-span-2">
          <div className="tiny uppercase tracking-[0.7px]">{t.common.reason}</div>
          <p className="text-[13px] text-ink-2">{request.reason}</p>
        </div>
        {sick && (
          <div className="sm:col-span-2">
            <div className="tiny mb-1.5 uppercase tracking-[0.7px]">{t.sick.note}</div>
            {request.attachment ? <AttachmentLink request={request} /> : <span className="tiny">{t.sick.noNoteAttached}</span>}
          </div>
        )}
      </div>
      {request.overlaps.length > 0 && (
        <div className="notice mt-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            {f(t.approvals.overlap, { count: request.overlaps.length })}: {request.overlaps.map((o) => o.name).join(", ")}
          </div>
        </div>
      )}
      {own && <div className="notice notice-bad mt-3">{t.approvals.errOwn}</div>}
      {!own && after < 0 && <div className="notice notice-bad mt-3">{t.approvals.errBalance}</div>}
      <label className="field mt-4">
        {t.approvals.decisionNote}
        <textarea
          className="input min-h-[70px]"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
        />
      </label>
      {error && <div className="notice notice-bad mt-2">{error}</div>}
    </Modal>
  );
}

