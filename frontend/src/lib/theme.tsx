"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { THEME_COOKIE, type Theme } from "./theme-config";

const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void } | null>(null);

/** The server reads the cookie and puts the class on <html>, so the first paint already has the right theme. */
export function ThemeProvider({ initial, children }: { initial: Theme; children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initial);
  const setTheme = useCallback((t: Theme) => {
    // Phase 2: also saved to the user's profile via the API, like the language.
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    document.documentElement.classList.toggle("dark", t === "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0c1613" : "#123e32");
    setThemeState(t);
  }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used inside ThemeProvider");
  return v;
}
