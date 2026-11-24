"use client";

import { AlertTriangle, ArrowRight, CalendarDays, Clock, FileText, ShieldCheck, UserCheck, Users } from "lucide-react";
import Link from "next/link";
import { TodayCard } from "@/components/today-card";
import { LoadError, PageHeading, ProfilePhoto, Skeleton, StatCard, StatusTag } from "@/components/ui";
import { paths, useApi, type AdminOverview, type AttendanceOverview, type MyLeaveResponse, type PendingLeaveResponse } from "@/lib/api";
import { fmtDate, fmtDateLong, fmtTime, jakartaDate, jakartaHour } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { useMe, useSession } from "@/lib/me";
import type { Attendance, SessionUser } from "@/lib/types";

export default function DashboardPage() {
  const { role } = useSession();
  return role === "ADMIN" ? <AdminDashboard /> : <TeacherDashboard />;
}

function greeting(t: ReturnType<typeof useI18n>["t"]) {
  const h = jakartaHour();
  if (h < 11) return t.dashboard.greetingMorning;
  if (h < 15) return t.dashboard.greetingAfternoon;
  if (h < 18) return t.dashboard.greetingEvening;
  return t.dashboard.greetingNight;
}

function WelcomePanel({ user }: { user: SessionUser }) {
  const { t } = useI18n();
  const { name } = user;
  return (
    <section className="welcome-panel mb-5">
      <div className="welcome-copy">
        <span className="welcome-label">INSTITUT SAINS DAN TEKNOLOGI AL-KAMAL</span>
        <h2>
          {greeting(t)},
          <br />
          {name}
        </h2>
        <p>{t.dashboard.welcomeBody}</p>
        <div className="welcome-meta">
          <span>
            <i /> Asia/Jakarta (WIB)
          </span>
          <span>{t.app.workspace}</span>
        </div>
      </div>
      <div className="welcome-art">
        <div className="orbit" />
        <div className="orbit orbit-two" />
        <ProfilePhoto name={name} photoUrl={user.photoUrl} className="logo-seal" />
        <span className="art-caption">
          {t.roles[user.role].toUpperCase()} · {user.unit.toUpperCase()}
        </span>
      </div>
    </section>
  );
}

/** `missing` comes from the API sorted oldest first, so [0] has the nearest deadline. */
function MissingAlert({ missing }: { missing: Attendance[] }) {
  const { t, f, locale } = useI18n();
  if (!missing.length) return null;
  return (
    <div className="notice mb-5 flex flex-col gap-3 sm:flex-row sm:items-center" role="alert">
      <AlertTriangle size={20} className="shrink-0 text-warn" />
      <div className="flex-1">
        <b className="text-[13px] text-warn">{f(t.dashboard.missingTitle, { count: missing.length })}</b>
        <div>{f(t.dashboard.missingBody, { deadline: fmtDate(missing[0].fixDeadline ?? missing[0].date, locale) })}</div>
      </div>
      <Link href="/attendance/fix" className="btn btn-sm">
        {t.dashboard.missingCta} <ArrowRight size={14} />
      </Link>
    </div>
  );
}

function TeacherDashboard() {
  const { t, f, locale } = useI18n();
  const { role } = useSession();
  const me = useMe();
  const { data: ov, error, mutate } = useApi<AttendanceOverview>(paths.overview);
  const leave = useApi<MyLeaveResponse>(paths.myLeave);
  // Approvers also see how many requests are waiting for them.
  const approvals = useApi<PendingLeaveResponse>(role === "APPROVER" ? paths.pendingLeave : null);
  if (!ov || !leave.data)
    return error || leave.error ? <LoadError onRetry={() => void Promise.all([mutate(), leave.mutate()])} /> : <Skeleton />;
  const bal = leave.data.balance;
  const monthCount = ov.monthCount;
  const pendingMine = leave.data.requests.filter((l) => l.status === "PENDING");
  const pendingAll = (approvals.data?.requests ?? []).filter((l) => l.userId !== me.id);

  return (
    <>
      <div className="hidden sm:block">
        <WelcomePanel user={me} />
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(290px,1fr)]">
        <TodayCard record={ov.today} />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-1">
          <StatCard
            label={t.dashboard.leaveBalance}
            value={bal.remaining}
            unit={t.common.days}
            foot={f(t.dashboard.leaveBalanceFoot, { quota: bal.quota, year: bal.year })}
            icon={<CalendarDays size={15} />}
            tone={bal.remaining <= 2 ? "red" : "green"}
          />
          <StatCard
            label={t.dashboard.monthAttendance}
            value={monthCount}
            unit={t.common.days}
            foot={t.dashboard.monthAttendanceFoot}
            icon={<UserCheck size={15} />}
            tone="plain"
          />
        </div>
      </div>

      <MissingAlert missing={ov.missing} />

      {role === "APPROVER" && pendingAll.length > 0 && (
        <div className="card">
          <div className="task">
            <div className="task-icon">
              <ShieldCheck size={16} />
            </div>
            <div className="flex-1">
              <b className="text-[13px] font-semibold text-ink-2">{f(t.dashboard.approvalsTask, { count: pendingAll.length })}</b>
              <small className="block text-[12px] text-muted">{t.dashboard.approvalsTaskSub}</small>
            </div>
            <Link href="/approvals" className="btn btn-sm btn-primary">
              {t.nav.approvals} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.75fr)_minmax(290px,1fr)]">
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="card-title">{t.dashboard.recentTitle}</h2>
            <Link href="/history" className="btn btn-sm">
              {t.dashboard.seeAll}
            </Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.common.date}</th>
                  <th>{t.common.clockIn}</th>
                  <th>{t.common.clockOut}</th>
                  <th>{t.common.status}</th>
                </tr>
              </thead>
              <tbody>
                {ov.recent.map((a) => (
                  <tr key={a.id}>
                    <td data-label={t.common.date}>
                      <strong>{fmtDate(a.date, locale)}</strong>
                    </td>
                    <td data-label={t.common.clockIn}>{fmtTime(a.clockIn)}</td>
                    <td data-label={t.common.clockOut}>{fmtTime(a.clockOut)}</td>
                    <td data-label={t.common.status}>
                      <StatusTag status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2 className="card-title mb-2">{t.nav.leave}</h2>
          <div className="task">
            <div className="task-icon">
              <FileText size={16} />
            </div>
            <div className="flex-1">
              <b className="text-[13px] font-semibold text-ink-2">
                {pendingMine.length} {t.dashboard.pendingLeave.toLowerCase()}
              </b>
              <small className="block text-[12px] text-muted">{t.dashboard.pendingLeaveFoot}</small>
            </div>
          </div>
          <div className="task">
            <div className="task-icon">
              <CalendarDays size={16} />
            </div>
            <div className="flex-1">
              <b className="text-[13px] font-semibold text-ink-2">
                {bal.remaining} / {bal.quota} {t.common.days}
              </b>
              <small className="block text-[12px] text-muted">{t.dashboard.leaveBalance}</small>
            </div>
          </div>
          <Link href="/leave" className="btn btn-primary mt-3 w-full">
            {t.leave.new}
          </Link>
        </div>
      </div>
    </>
  );
}

function AdminDashboard() {
  const { t, f, locale } = useI18n();
  const me = useMe();
  const today = jakartaDate();
  const { data: ov, error, mutate } = useApi<AdminOverview>(paths.adminOverview);
  const { data: mine, mutate: mutateMine } = useApi<AttendanceOverview>(paths.overview);
  if (!ov || !mine) return error ? <LoadError onRetry={() => void Promise.all([mutate(), mutateMine()])} /> : <Skeleton />;
  const onLeaveToday = ov.onLeaveToday;
  const pendingLeave = ov.pendingLeave;
  const late = ov.lateToday;
  const done = ov.doneToday;
  const working = ov.workingNow;
  const absent = Math.max(0, ov.activeStaff - ov.presentToday - onLeaveToday);
  const segs = [
    { label: t.dashboard.legendPresent, n: done, color: "#268369" },
    { label: t.dashboard.legendWorking, n: working, color: "#7ca6a3" },
    { label: t.dashboard.legendLeave, n: onLeaveToday, color: "#d6bc72" },
    { label: t.dashboard.legendAbsent, n: absent, color: "#cb9d86" },
  ];

  return (
    <>
      <PageHeading
        eyebrow={t.dashboard.eyebrow}
        title={t.dashboard.adminTitle}
        sub={t.dashboard.adminSub}
        actions={
          <>
            <Link href="/admin/attendance" className="btn">
              {t.nav.adminAttendance}
            </Link>
            <Link href="/admin/locations" className="btn btn-primary">
              {t.admin.openKiosk}
            </Link>
          </>
        }
      />
      <WelcomePanel user={me} />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t.dashboard.statTotal} value={ov.activeStaff} unit={t.dashboard.people} foot={t.dashboard.statTotalFoot} icon={<Users size={15} />} tone="plain" />
        <StatCard label={t.dashboard.statPresent} value={ov.presentToday} unit={t.dashboard.people} foot={f(t.dashboard.statPresentFoot, { late })} icon={<UserCheck size={15} />} tone="green" />
        <StatCard label={t.dashboard.statLeave} value={onLeaveToday} unit={t.dashboard.people} foot={ov.sickToday ? f(t.sick.onLeaveSick, { count: ov.sickToday }) : t.dashboard.statLeaveFoot} icon={<CalendarDays size={15} />} tone="gold" />
        <StatCard label={t.dashboard.statFollowUp} value={pendingLeave + ov.missingCount} foot={t.dashboard.statFollowUpFoot} icon={<Clock size={15} />} tone="red" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.75fr)_minmax(290px,1fr)]">
        <div className="card">
          <div className="mb-5">
            <h2 className="card-title">{t.dashboard.summaryTitle}</h2>
            <p className="card-sub">{f(t.dashboard.summarySub, { date: fmtDateLong(today, locale), count: ov.activeStaff })}</p>
          </div>
          <div className="progress">
            {segs.map((s) => (
              <span key={s.label} style={{ background: s.color, width: `${ov.activeStaff ? (s.n / ov.activeStaff) * 100 : 0}%` }} />
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-muted">
            {segs.map((s) => (
              <span key={s.label} className="flex items-center">
                <i className="mr-2 inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                {s.label} <b className="ml-1.5 font-semibold text-ink-2">{s.n}</b>
              </span>
            ))}
          </div>
        </div>
        <div className="card">
          <h2 className="card-title mb-1">{t.dashboard.attentionTitle}</h2>
          <AttentionRow href="/approvals" icon={<FileText size={16} />} title={f(t.dashboard.approvalsTask, { count: pendingLeave })} sub={t.dashboard.approvalsTaskSub} />
          <AttentionRow
            href="/admin/attendance?status=MISSING_CLOCK_OUT"
            icon={<Clock size={16} />}
            title={f(t.dashboard.missingTask, { count: ov.missingCount })}
            sub={t.dashboard.missingTaskSub}
          />
        </div>
      </div>

      <h2 className="card-title mb-3 mt-7">{t.dashboard.myAttendance}</h2>
      <MissingAlert missing={mine.missing} />
      <TodayCard record={mine.today} />
    </>
  );
}

function AttentionRow({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="task">
      <div className="task-icon">{icon}</div>
      <div className="flex-1">
        <b className="text-[13px] font-semibold text-ink-2">{title}</b>
        <small className="block text-[12px] text-muted">{sub}</small>
      </div>
      <Link href={href} className="btn btn-sm btn-ghost" aria-label={title}>
        <ArrowRight size={15} />
      </Link>
    </div>
  );
}
