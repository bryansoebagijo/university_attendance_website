"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { dictionaries, fill, LOCALE_COOKIE, type Dict, type Locale } from "./index";

interface I18n {
  locale: Locale;
  t: Dict;
  f: typeof fill;
  setLocale: (l: Locale) => void;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const setLocale = useCallback((l: Locale) => {
    // Phase 2: also saved to the user's profile via the API.
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    document.documentElement.lang = l;
    setLocaleState(l);
  }, []);
  const value = useMemo(() => ({ locale, t: dictionaries[locale], f: fill, setLocale }), [locale, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}
