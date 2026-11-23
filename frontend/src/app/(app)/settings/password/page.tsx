"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeading } from "@/components/ui";
import { ApiError, meApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/me";
import { useStore } from "@/lib/store";

const meetsRules = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

export default function PasswordPage() {
  const { t } = useI18n();
  const { user, setUser } = useSession();
  const { notify } = useStore();
  const router = useRouter();
  const forced = user.mustChangePassword;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!meetsRules(next)) return setError(t.password.weak);
    if (next !== confirm) return setError(t.password.mismatch);
    setBusy(true);
    try {
      const { user: updated } = await meApi.changePassword(current, next);
      setUser(updated);
      notify(t.password.saved);
      router.replace(forced ? "/dashboard" : "/settings");
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(code === "WRONG_PASSWORD" ? t.password.wrong : code === "SAME_PASSWORD" ? t.password.same : code === "VALIDATION" ? t.password.weak : t.errors.generic);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[520px]">
      <PageHeading eyebrow={t.password.eyebrow} title={forced ? t.password.forcedTitle : t.password.title} sub={forced ? undefined : t.password.sub} />
      {forced && (
        <div className="notice mb-5 flex items-start gap-3">
          <KeyRound size={18} className="mt-0.5 shrink-0" />
          {t.password.forcedBody}
        </div>
      )}
      <form className="card space-y-4" onSubmit={submit} noValidate>
        {/* Hidden username helps password managers save the right account. */}
        <input type="email" autoComplete="username" value={user.email} readOnly hidden />
        <label className="field">
          {forced ? t.password.currentTemp : t.password.current}
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="field">
          {t.password.new}
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          <span className={`mt-1.5 block text-[11px] ${next && !meetsRules(next) ? "text-danger" : "text-muted-2"}`}>{t.password.rules}</span>
        </label>
        <label className="field">
          {t.password.confirm}
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {error && (
          <div className="notice notice-bad" role="alert">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          {!forced && (
            <button type="button" className="btn" onClick={() => router.back()}>
              {t.common.cancel}
            </button>
          )}
          <button className="btn btn-primary" disabled={busy || !current || !next || !confirm}>
            {t.password.submit}
          </button>
        </div>
      </form>
    </div>
  );
}
