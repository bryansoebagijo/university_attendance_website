"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { ApiError, authApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n/provider";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/demo-accounts";
import { useTheme } from "@/lib/theme";

// Demo accounts are a development aid only; they're hidden in production builds.
const SHOW_DEMO = process.env.NODE_ENV !== "production";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const { t, setLocale } = useI18n();
  const { setTheme } = useTheme();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("expired") ? t.login.expired : null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await authApi.login(email, password);
      // The user's saved preferences (from the database) win over this browser's.
      setLocale(user.locale);
      setTheme(user.theme);
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(
        code === "TOO_MANY_ATTEMPTS"
          ? t.login.tooMany
          : code === "NETWORK" || code === "SERVER" || code === "INTERNAL"
            ? t.login.network
            : t.login.error,
      );
      setBusy(false);
    }
  };


  return (
    <main className="min-h-screen px-4 py-6 sm:py-10">
      <div className="mx-auto mb-4 flex max-w-[660px] justify-end">
        <LanguageSwitch />
      </div>
      <section className="relative mx-auto max-w-[660px] overflow-hidden rounded-[20px] border border-line bg-card px-5 py-9 text-center shadow-[0_15px_60px_#1c432a06] sm:px-9 sm:py-12">
        <div className="absolute inset-x-0 top-0 h-[5px] bg-[linear-gradient(90deg,#2c7b47,#d6bc65)]" />
        <Image src="/logo-ista.png" alt="Logo ISTA Al-Kamal" width={110} height={110} className="mx-auto h-[95px] w-[95px] object-contain sm:h-[110px] sm:w-[110px]" priority />
        <div className="eyebrow mt-6 justify-center">{t.login.eyebrow}</div>
        <h1 className="page-title !mb-3 !text-[25px] sm:!text-[30px]">{t.login.title}</h1>
        <p className="mx-auto max-w-[420px] text-[13px] leading-[1.9] text-muted">{t.login.body}</p>

        <form onSubmit={submit} className="mx-auto mt-6 max-w-[360px] space-y-4 text-left" noValidate>
          <label className="field">
            {t.login.email}
            <input
              className="input"
              type="text"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              required
            />
          </label>
          <label className="field">
            {t.login.password}
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              required
            />
          </label>
          {error && (
            <div className="notice notice-bad" role="alert">
              {error}
            </div>
          )}
          <button className="btn btn-primary w-full !py-3.5 !text-[14px]" disabled={busy || !email || !password}>
            {t.login.submit}
          </button>
        </form>

        {SHOW_DEMO && (
        <div className="mx-auto mt-8 max-w-[420px] rounded-xl border border-dashed border-warn-line bg-warn-soft p-4 text-left">
          <b className="text-[12px] text-warn">{t.login.demoTitle}</b>
          <p className="mb-3 text-[11px] text-warn">
            {t.login.demoHint} Password: <code className="font-semibold">{DEMO_PASSWORD}</code>
          </p>
          <div className="grid gap-2">
            {DEMO_ACCOUNTS.map((u) => (
              <button
                key={u.email}
                type="button"
                className="btn btn-sm !justify-between"
                onClick={() => {
                  setEmail(u.email);
                  setPassword(DEMO_PASSWORD);
                  setError(null);
                }}
              >
                <span>{t.roles[u.role]}</span>
                <span className="font-normal text-muted">{u.email}</span>
              </button>
            ))}
          </div>
        </div>
        )}

        <div className="mt-8 border-t border-line-soft pt-6 text-[9px] leading-[1.9] tracking-[1.1px] text-muted-2">
          {t.login.caption}
        </div>
      </section>
    </main>
  );
}
