"use client";

import { LOCALES, type Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";

export function LanguageSwitch({ onChange }: { onChange?: (locale: Locale) => void }) {
  const { locale, setLocale } = useI18n();
  return (
    <div className="inline-flex rounded-lg border border-line bg-card p-1" role="radiogroup" aria-label="Language">
      {LOCALES.map((l) => (
        <button
          key={l}
          role="radio"
          aria-checked={locale === l}
          onClick={() => {
            setLocale(l);
            onChange?.(l);
          }}
          className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
            locale === l ? "bg-brand text-white" : "text-muted hover:bg-hover"
          }`}
        >
          {l === "id" ? "Indonesia" : "English"}
        </button>
      ))}
    </div>
  );
}
