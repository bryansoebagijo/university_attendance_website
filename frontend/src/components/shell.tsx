"use client";

import {
  CalendarCheck,
  CalendarOff,
  BarChart3,
  ClipboardList,
  FileText,
  History,
  LayoutGrid,
  LogOut,
  MapPin,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { useMe, useSession } from "@/lib/me";
import { authApi } from "@/lib/api";
import type { Role } from "@/lib/types";
import { LicenseBanner } from "./license";
import { Avatar } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  group: "main" | "manage";
}

function useNav(): NavItem[] {
  const { t } = useI18n();
  const all: Role[] = ["USER", "APPROVER", "ADMIN"];
  return [
    { href: "/dashboard", label: t.nav.dashboard, icon: LayoutGrid, roles: all, group: "main" },
    { href: "/history", label: t.nav.history, icon: History, roles: all, group: "main" },
    { href: "/leave", label: t.nav.leave, icon: FileText, roles: all, group: "main" },
    { href: "/attendance/fix", label: t.nav.fix, icon: Wrench, roles: all, group: "main" },
    { href: "/approvals", label: t.nav.approvals, icon: ShieldCheck, roles: ["APPROVER", "ADMIN"], group: "manage" },
    { href: "/admin/attendance", label: t.nav.adminAttendance, icon: CalendarCheck, roles: ["ADMIN"], group: "manage" },
    { href: "/admin/leave", label: t.nav.adminLeave, icon: ClipboardList, roles: ["ADMIN"], group: "manage" },
    { href: "/admin/users", label: t.nav.adminUsers, icon: Users, roles: ["ADMIN"], group: "manage" },
    { href: "/admin/reports", label: t.nav.reports, icon: BarChart3, roles: ["ADMIN"], group: "manage" },
    { href: "/admin/locations", label: t.nav.adminLocations, icon: MapPin, roles: ["ADMIN"], group: "manage" },
    { href: "/admin/holidays", label: t.nav.holidays, icon: CalendarOff, roles: ["ADMIN"], group: "manage" },
    { href: "/settings", label: t.nav.settings, icon: Settings, roles: all, group: "manage" },
  ];
}

function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 text-white">
      <div
        className={`shrink-0 rounded-full border-4 border-white/15 bg-white p-1 shadow-[0_5px_18px_#0002] outline outline-1 outline-[#9cb88b50] ${
          compact ? "h-12 w-12" : "h-[60px] w-[60px]"
        }`}
      >
        <Image src="/logo-ista.png" alt="Logo ISTA Al-Kamal" width={60} height={60} className="h-full w-full object-contain" priority />
      </div>
      <div>
        <strong className="block font-display text-[25px] font-extrabold leading-tight tracking-[2px]">{t.app.name}</strong>
        <small className="block text-[9px] leading-[2] tracking-[1.5px] text-[#a4bdb2]">{t.app.campus}</small>
        <em className="mt-0.5 block text-[8px] not-italic tracking-[1.2px] text-[#d8bd69]">{t.app.tagline}</em>
      </div>
    </div>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const groups = [
    { key: "main", label: t.app.mainMenu },
    { key: "manage", label: t.app.manageMenu },
  ] as const;
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[254px] flex-col overflow-y-auto bg-[linear-gradient(170deg,#143f32,#0e3028)] px-[19px] pb-[22px] pt-[30px] lg:flex">
      <div className="mx-1.5 mb-8">
        <Brand />
      </div>
      {groups.map((g) => {
        const list = items.filter((i) => i.group === g.key);
        if (!list.length) return null;
        return (
          <div key={g.key} className="mb-4">
            <div className="mb-2 pl-4 text-[9px] tracking-[1.9px] text-[#6f9a85]">{g.label}</div>
            <nav className="space-y-1">
              {list.map((i) => {
                const on = isActive(pathname, i.href);
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`relative flex items-center gap-3 rounded-lg px-[15px] py-3 text-[13px] font-medium transition-colors ${
                      on
                        ? "bg-white/[0.07] text-white shadow-[inset_3px_0_#d8b757]"
                        : "text-[#b1c6b9] hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <i.icon size={18} strokeWidth={1.6} className={on ? "text-[#dfc574]" : "text-[#84ab93]"} />
                    {i.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        );
      })}
      <footer className="mt-auto rounded-xl bg-white/[0.025] px-3.5 py-4 text-[11px] leading-relaxed text-[#b6cbbb]">
        <div className="mb-3 grid h-7 w-7 place-items-center rounded-full bg-[#b9d3aa18] text-[#d4c16d]">✓</div>
        <b className="text-[#e4ebde]">{t.app.footerTitle}</b>
        <p className="mb-4 mt-1.5 text-[10px] leading-[1.8] text-[#91ac9c]">{t.app.footerBody}</p>
        <span className="block border-t border-white/5 pt-3 text-[9px] text-[#789c87]">{t.app.copyright}</span>
      </footer>
    </aside>
  );
}

/** Phone & tablet: brand + horizontal scrolling menu, as in the mockup. */
function MobileNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <div className="border-b-2 border-[#c4ad60] bg-[linear-gradient(170deg,#143f32,#0e3028)] px-4 pb-2 pt-4 lg:hidden">
      <div className="mb-3">
        <Brand compact />
      </div>
      <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]">
        {items.map((i) => {
          const on = isActive(pathname, i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2.5 text-[12px] font-medium ${
                on ? "bg-white/[0.07] text-white shadow-[inset_0_-2px_#cfba73]" : "text-[#b1c6b9]"
              }`}
            >
              <i.icon size={15} strokeWidth={1.6} className={on ? "text-[#dfc574]" : "text-[#84ab93]"} />
              {i.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Topbar({ crumb }: { crumb: string }) {
  const { t } = useI18n();
  const { role } = useSession();
  const me = useMe();
  const router = useRouter();
  const logout = async () => {
    await authApi.logout().catch(() => {}); // clear the cookie even if the call fails
    router.replace("/logout");
  };
  return (
    <header className="flex h-[70px] items-center justify-between gap-4 border-b border-line bg-card px-4 sm:px-[38px] lg:h-[82px]">
      <div className="hidden text-[12px] text-muted sm:block">
        {t.app.workspace} <span className="mx-3">/</span> <b className="font-medium text-ink-2">{crumb}</b>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className="mr-3 hidden items-center text-[11px] text-muted xl:flex">
          <i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#3f8f58]" /> {t.app.workspace}
        </span>
        <Link href="/settings" aria-label={t.nav.settings}>
          <Avatar name={me.name} photoUrl={me.photoUrl} />
        </Link>
        <div className="min-w-0 leading-tight">
          <strong className="block max-w-[160px] truncate text-[12px] text-ink sm:max-w-none">{me.name}</strong>
          <div className="tiny">{t.roles[role]}</div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={logout} title={t.app.logout} aria-label={t.app.logout}>
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}

const PASSWORD_PAGE = "/settings/password";

export function AppShell({ children }: { children: ReactNode }) {
  const { role, user } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  // One-time password: nothing else works until a new password is set (the API enforces this too).
  const mustChange = user.mustChangePassword && pathname !== PASSWORD_PAGE;
  useEffect(() => {
    if (mustChange) router.replace(PASSWORD_PAGE);
  }, [mustChange, router]);
  const { t } = useI18n();
  const items = useNav().filter((i) => i.roles.includes(role));
  const crumb =
    pathname === PASSWORD_PAGE
      ? t.password.title
      : (items.find((i) => isActive(pathname, i.href))?.label ?? (pathname.startsWith("/scan") ? t.scan.eyebrow.charAt(0) + t.scan.eyebrow.slice(1).toLowerCase() : ""));
  if (mustChange) return null;
  return (
    <>
      <Sidebar items={items} />
      <MobileNav items={items} />
      <main className="lg:ml-[254px]">
        <Topbar crumb={crumb} />
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-[38px] sm:py-[30px]">
          <LicenseBanner />
          {children}
          <PageFooter />
        </div>
      </main>
    </>
  );
}

function PageFooter() {
  const { t } = useI18n();
  return (
    <footer className="page-footer">
      <span>{t.app.copyright}</span>
      <span>{t.app.workspace} · v0.5 (fase 5)</span>
    </footer>
  );
}
