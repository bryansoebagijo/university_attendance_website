import type { Metadata, Viewport } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/provider";
import { StoreProvider } from "@/lib/store";
import { ThemeProvider } from "@/lib/theme";
import { DEFAULT_THEME, isTheme, THEME_COOKIE } from "@/lib/theme-config";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", weight: ["400", "500", "600", "700"] });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "ISTA — Presensi & SDM",
  description: "Portal presensi dan administrasi kehadiran ISTA Al-Kamal Jakarta.",
  icons: { icon: "/logo-ista.png" },
};

export const viewport: Viewport = {
  themeColor: "#123e32",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const c = jar.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(c) ? c : DEFAULT_LOCALE;
  const th = jar.get(THEME_COOKIE)?.value;
  const theme = isTheme(th) ? th : DEFAULT_THEME;
  return (
    <html lang={locale} className={`${dmSans.variable} ${manrope.variable} ${theme === "dark" ? "dark" : ""}`}>
      <body>
        <ThemeProvider initial={theme}>
          <I18nProvider initial={locale}>
            <StoreProvider>{children}</StoreProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
