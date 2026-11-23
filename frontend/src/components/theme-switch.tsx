"use client";

import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme } from "@/lib/theme";
import type { Theme } from "@/lib/theme-config";

export function ThemeSwitch({ onChange }: { onChange?: (theme: Theme) => void }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t.settings.themeLight, icon: Sun },
    { value: "dark", label: t.settings.themeDark, icon: Moon },
  ];
  return (
    <div className="inline-flex rounded-lg border border-line bg-card p-1" role="radiogroup" aria-label={t.settings.theme}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={theme === o.value}
          onClick={() => {
            if (theme === o.value) return;
            setTheme(o.value);
            onChange?.(o.value);
          }}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
            theme === o.value ? "bg-brand text-white" : "text-muted hover:bg-hover"
          }`}
        >
          <o.icon size={14} /> {o.label}
        </button>
      ))}
    </div>
  );
}
