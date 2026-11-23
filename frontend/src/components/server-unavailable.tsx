"use client";

import { RefreshCw, ServerCrash } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

export function ServerUnavailable() {
  const { t } = useI18n();
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="card max-w-[440px] text-center">
        <div className="result-icon bad">
          <ServerCrash size={38} strokeWidth={1.6} />
        </div>
        <h1 className="mt-6 font-display text-[20px] font-extrabold text-ink">{t.errors.serverTitle}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t.errors.serverBody}</p>
        <button className="btn btn-primary mt-6" onClick={() => window.location.reload()}>
          <RefreshCw size={15} /> {t.errors.retry}
        </button>
      </div>
    </main>
  );
}
