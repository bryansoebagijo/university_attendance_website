"use client";

import { Camera, KeyRound, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { ThemeSwitch } from "@/components/theme-switch";
import { Avatar, PageHeading } from "@/components/ui";
import { ApiError, meApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n/provider";
import { useMe, useSession } from "@/lib/me";
import { useStore } from "@/lib/store";
import type { SessionUser } from "@/lib/types";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function SettingsPage() {
  const { t } = useI18n();
  const me = useMe();
  const { setUser } = useSession();
  const { notify } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  /** Runs an API call that returns the updated user, then refreshes the session copy. */
  const run = async (call: () => Promise<{ user: SessionUser }>, ok: string) => {
    setBusy(true);
    try {
      const { user } = await call();
      setUser(user);
      notify(ok);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      notify(code === "UNSUPPORTED_IMAGE" || code === "FILE_TOO_LARGE" ? t.settings.photoInvalid : t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    // Quick check here; the server re-checks, crops to a square and resizes.
    if (!TYPES.includes(file.type) || file.size > MAX_BYTES) {
      notify(t.settings.photoInvalid);
      return;
    }
    void run(() => meApi.uploadPhoto(file), t.settings.photoSaved);
  };

  return (
    <div className="max-w-[760px]">
      <PageHeading eyebrow={t.settings.eyebrow} title={t.settings.title} sub={t.settings.sub} />

      <div className="card mb-5">
        <h2 className="card-title mb-4">{t.settings.profile}</h2>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar name={me.name} photoUrl={me.photoUrl} size={96} />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[17px] font-bold text-ink">{me.name}</div>
            <div className="text-[13px] text-muted">{me.email}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Camera size={14} /> {me.photoUrl ? t.settings.photoChange : t.settings.photoUpload}
              </button>
              {me.photoUrl && (
                <button
                  className="btn btn-sm btn-danger"
                  disabled={busy}
                  onClick={() => void run(() => meApi.deletePhoto(), t.settings.photoRemoved)}
                >
                  <Trash2 size={14} /> {t.settings.photoRemove}
                </button>
              )}
            </div>
            <p className="tiny mt-2">{t.settings.photoHint}</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <dl className="mt-6 grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
          <Row k={t.admin.nip} v={me.nip} />
          <Row k={t.admin.role} v={t.roles[me.role]} />
          <Row k={t.admin.unit} v={me.unit} />
          <Row k={t.admin.quota} v={`${me.annualQuota} ${t.common.days}`} />
        </dl>
      </div>

      <div className="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="card-title">{t.settings.language}</h2>
          <p className="card-sub">{t.settings.languageSub}</p>
        </div>
        <LanguageSwitch onChange={(locale) => void run(() => meApi.savePreferences({ locale }), t.settings.saved)} />
      </div>

      <div className="card mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="card-title">{t.password.title}</h2>
          <p className="card-sub">{t.password.cardSub}</p>
        </div>
        <Link href="/settings/password" className="btn">
          <KeyRound size={14} /> {t.password.title}
        </Link>
      </div>

      <div className="card mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="card-title">{t.settings.theme}</h2>
          <p className="card-sub">{t.settings.themeSub}</p>
        </div>
        <ThemeSwitch onChange={(theme) => void run(() => meApi.savePreferences({ theme }), t.settings.saved)} />
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-b border-line-soft pb-2">
      <dt className="text-[11px] uppercase tracking-[0.7px] text-muted-2">{k}</dt>
      <dd className="mt-1 font-medium text-ink-2">{v}</dd>
    </div>
  );
}
