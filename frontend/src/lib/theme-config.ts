// Shared by the server layout and the client provider (no "use client" here).
export type Theme = "light" | "dark";
export const THEME_COOKIE = "absen_theme";
export const DEFAULT_THEME: Theme = "light";

export function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark";
}
