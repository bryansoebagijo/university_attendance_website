import { en } from "./en";
import { id, type Dict } from "./id";

export type Locale = "id" | "en";
export const LOCALES: Locale[] = ["id", "en"];
export const DEFAULT_LOCALE: Locale = "id";
export const LOCALE_COOKIE = "absen_locale";

export const dictionaries: Record<Locale, Dict> = { id, en };
export type { Dict };

export function isLocale(v: unknown): v is Locale {
  return v === "id" || v === "en";
}

/** Replace {name} placeholders. */
export function fill(template: string, vars: Record<string, string | number> = {}) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
