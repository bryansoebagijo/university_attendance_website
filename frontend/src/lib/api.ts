// Browser-side API client. Requests go to /api/* on this origin (proxied to the backend).
import useSWR from "swr";
import type {
  AdminAttendance,
  Attendance,
  Holiday,
  LeaveBalance,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  Location,
  MonthlyReport,
  PendingLeave,
  Role,
  Schedule,
  SessionUser,
  StaffUser,
  Exemption,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: isForm ? init.headers : { "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw new ApiError(0, "NETWORK");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? (res.status >= 500 ? "SERVER" : "UNKNOWN"));
  return body as T;
}

export const authApi = {
  login: (email: string, password: string) =>
    api<{ user: SessionUser }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => api<void>("/auth/logout", { method: "POST" }),
};

export const meApi = {
  get: () => api<{ user: SessionUser }>("/me"),
  savePreferences: (prefs: Partial<Pick<SessionUser, "locale" | "theme">>) =>
    api<{ user: SessionUser }>("/me/preferences", { method: "PATCH", body: JSON.stringify(prefs) }),
  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return api<{ user: SessionUser }>("/me/photo", { method: "PUT", body: form });
  },
  deletePhoto: () => api<{ user: SessionUser }>("/me/photo", { method: "DELETE" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ user: SessionUser }>("/me/password", { method: "PUT", body: JSON.stringify({ currentPassword, newPassword }) }),
};

/** GET with caching and revalidation (SWR). Pass null to skip. */
export function useApi<T>(path: string | null) {
  return useSWR<T, ApiError>(path, (p: string) => api<T>(p), { revalidateOnFocus: true, keepPreviousData: true });
}

// ---- Attendance ---------------------------------------------------------------

export type ScanAction = "in" | "out";

export interface AttendanceOverview {
  today: Attendance | null;
  recent: Attendance[];
  monthCount: number;
  missing: Attendance[];
  deductedThisYear: number;
  schedule: Schedule;
  todayIsHoliday: boolean;
}

export const attendanceApi = {
  /** `method`: how the QR was read; uploads are marked for admin review. */
  scan: (token: string, action: ScanAction, method: "camera" | "upload" = "camera") =>
    api<{ record: Attendance; location: { id: string; name: string } }>("/attendance/scan", {
      method: "POST",
      body: JSON.stringify({ token, action, method }),
    }),
  fix: (id: string, time: string, reason: string) =>
    api<{ record: Attendance }>(`/attendance/${encodeURIComponent(id)}/fix`, {
      method: "PATCH",
      body: JSON.stringify({ time, reason }),
    }),
};

export const paths = {
  overview: "/attendance/me/overview",
  myMonth: (month: string) => `/attendance/me?month=${month}`,
  corrections: "/attendance/me/corrections",
  adminOverview: "/admin/overview",
  adminAttendance: (q: { date?: string; status?: string; q?: string }) =>
    `/admin/attendance?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`,
  adminLocations: "/admin/locations",
  myLeave: "/leave/me",
  pendingLeave: "/leave/pending",
  decidedLeave: "/leave/decided",
  adminLeave: (q: { status?: string; type?: string; q?: string }) =>
    `/admin/leave?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`,
  leaveBalances: "/admin/leave-balances",
  staff: (q: { q?: string; role?: string }) =>
    `/admin/users?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`,
  holidays: (year: number) => `/holidays?year=${year}`,
  monthlyReport: (month: string) => `/admin/reports/monthly?month=${month}`,
  adminDay: (date: string) => `/admin/day?date=${date}`,
  staffSchedule: (id: string) => `/admin/users/${encodeURIComponent(id)}/schedules`,
};

export type MonthResponse = { month: string; records: Attendance[]; exemptions: Exemption[] };
/** sickExcused: the day has approved sick leave, so it will not be deducted (fixing it is still allowed). */
export type CorrectionsResponse = { missing: (Attendance & { sickExcused?: boolean })[]; past: Attendance[] };
export type AdminAttendanceResponse = { records: AdminAttendance[] };
export type AdminOverview = {
  activeStaff: number;
  /** Active staff scheduled today. */
  expectedToday: number;
  /** Scheduled today, not here yet, not on leave or excused. */
  notYetToday: number;
  exemptToday: number;
  presentToday: number;
  doneToday: number;
  workingNow: number;
  missingCount: number;
  onLeaveToday: number;
  /** The sick-leave part of onLeaveToday. */
  sickToday: number;
  pendingLeave: number;
};

// ---- Admin: locations -----------------------------------------------------------

export const locationsApi = {
  create: (body: { name: string; building: string; active: boolean }) =>
    api<{ location: Location }>("/admin/locations", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Partial<{ name: string; building: string; active: boolean }>) =>
    api<{ location: Location }>(`/admin/locations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  /** The location's current rotating code (valid ~60 s), for downloading as an image. */
  currentQr: (id: string) =>
    api<{ location: { id: string; name: string; building: string }; token: string; secondsLeft: number; validUntil: string }>(
      `/admin/locations/${encodeURIComponent(id)}/qr`,
      { cache: "no-store" },
    ),
  /** Issues a new kiosk key (the previously paired screen stops working). */
  pairKiosk: (id: string) => api<{ key: string }>(`/admin/locations/${encodeURIComponent(id)}/kiosk-key`, { method: "POST" }),
};

// ---- Kiosk (no session; authenticated by the kiosk key) ------------------------

export type KioskToken = {
  location: { id: string; name: string; building: string; active: boolean };
  token: string | null;
  secondsLeft: number | null;
};

export const kioskApi = {
  token: (locationId: string, key: string) =>
    api<KioskToken>(`/kiosk/${encodeURIComponent(locationId)}/token`, { headers: { "X-Kiosk-Key": key }, cache: "no-store" }),
};

// ---- Development only ------------------------------------------------------------

/** Not available in production builds: the backend doesn't mount /api/dev there. */
export const devApi = {
  qrToken: () => api<{ locationId: string; token: string }>("/dev/qr"),
};

// ---- Leave ---------------------------------------------------------------------

export type MyLeaveResponse = { requests: LeaveRequest[]; balance: LeaveBalance; schedule: Schedule };
export type PendingLeaveResponse = { requests: PendingLeave[] };
export type LeaveListResponse = { requests: LeaveRequest[] };
export type LeaveBalancesResponse = { balances: Record<string, LeaveBalance> };
export type { LeaveStatus, LeaveType };

/** The doctor's note; opens inline (image/PDF) in a new tab. */
export const leaveAttachmentUrl = (id: string) => `/api/leave/${encodeURIComponent(id)}/attachment`;

export const leaveApi = {
  /** Sent as multipart so a doctor's note travels with the request in one step. */
  create: (input: { type: LeaveType; start: string; end: string; reason: string; attachment?: File | null }) => {
    const form = new FormData();
    form.append("type", input.type);
    form.append("start", input.start);
    form.append("end", input.end);
    form.append("reason", input.reason);
    if (input.attachment) form.append("attachment", input.attachment);
    return api<{ request: LeaveRequest }>("/leave", { method: "POST", body: form });
  },
  cancel: (id: string) => api<void>(`/leave/${encodeURIComponent(id)}`, { method: "DELETE" }),
  decide: (id: string, approve: boolean, note?: string) =>
    api<{ request: LeaveRequest }>(`/leave/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ approve, note: note || undefined }),
    }),
};

// ---- Admin: staff -------------------------------------------------------------------

export type StaffInput = { name: string; email: string; nip: string; role: Role; unit: string; annualQuota: number; active: boolean };

export const staffApi = {
  create: (body: StaffInput) => api<{ user: SessionUser; tempPassword: string }>("/admin/users", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Partial<StaffInput>) =>
    api<{ user: SessionUser }>(`/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  resetPassword: (id: string) => api<{ tempPassword: string }>(`/admin/users/${encodeURIComponent(id)}/reset-password`, { method: "POST" }),
  /** Permanent; refused with HAS_HISTORY when the person has attendance or leave records. */
  remove: (id: string) => api<void>(`/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
export type StaffResponse = { users: StaffUser[] };

// ---- Holidays & reports --------------------------------------------------------------

export type HolidaysResponse = { holidays: Holiday[] };
export const holidaysApi = {
  save: (date: string, name: string) => api<{ holiday: Holiday }>(`/admin/holidays/${date}`, { method: "PUT", body: JSON.stringify({ name }) }),
  remove: (date: string) => api<void>(`/admin/holidays/${date}`, { method: "DELETE" }),
};
export type { MonthlyReport };

// ---- Admin: schedules & attendance corrections ---------------------------------------

export type DayState = "PRESENT" | "LEAVE" | "SICK" | "EXEMPT" | "ABSENT" | "NOT_YET" | "UPCOMING";
export interface DayRow {
  user: { id: string; name: string; nip: string; unit: string; photoUrl: string | null };
  scheduled: boolean;
  state: DayState;
  record: Attendance | null;
  exemption: Exemption | null;
  leave: { id: string; type: LeaveType } | null;
}
export type DayResponse = { date: string; holiday: boolean; rows: DayRow[] };

const json = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const correctionsApi = {
  setSchedule: (userId: string, effectiveFrom: string, days: number[]) =>
    api<{ schedule: Schedule }>(paths.staffSchedule(userId), json("PUT", { effectiveFrom, days })),
  deleteSchedule: (userId: string, scheduleId: string) =>
    api<{ schedule: Schedule }>(`${paths.staffSchedule(userId)}/${encodeURIComponent(scheduleId)}`, json("DELETE")),
  /** Create or correct one person's record for one date (times are HH:mm, WIB). */
  saveAttendance: (userId: string, date: string, body: { clockIn: string; clockOut: string | null; reason: string; locationId?: string }) =>
    api<{ record: Attendance }>(`/admin/attendance/${encodeURIComponent(userId)}/${date}`, json("PUT", body)),
  deleteAttendance: (id: string, reason: string) => api<void>(`/admin/attendance/${encodeURIComponent(id)}`, json("DELETE", { reason })),
  exempt: (userId: string, date: string, reason: string) => api<{ exemption: Exemption }>("/admin/exemptions", json("POST", { userId, date, reason })),
  unexempt: (id: string) => api<void>(`/admin/exemptions/${encodeURIComponent(id)}`, json("DELETE")),
};
