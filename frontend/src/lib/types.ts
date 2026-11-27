// Domain types. Attendance, Location and SessionUser mirror the backend API responses.

export type Role = "USER" | "APPROVER" | "ADMIN";

export interface User {
  id: string;
  name: string;
  email: string;
  nip: string;
  role: Role;
  unit: string;
  annualQuota: number;
  active: boolean;
  /** Profile picture. Phase 1: small data URL; later a URL from the backend's file storage. */
  photoUrl?: string;
}

/** QR location as returned by GET /api/admin/locations. */
export interface Location {
  id: string;
  name: string;
  building: string;
  active: boolean;
  /** A kiosk screen has a key for this location. */
  kioskPaired: boolean;
  scansToday?: number;
  lastScan?: string | null;
}

/** MANUAL = entered or corrected by an admin. */
export type ScanMethod = "CAMERA" | "UPLOAD" | "MANUAL";

/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface SchedulePeriod {
  id: string | null;
  from: string | null; // YYYY-MM-DD; null for the Monday–Friday default
  days: number[];
}
/** A person's work schedule: what applies today, the next change, and every period (oldest first). */
export interface Schedule {
  current: SchedulePeriod & { isDefault: boolean };
  next: SchedulePeriod | null;
  history: SchedulePeriod[];
}

/** A scheduled day an admin excused ("Dibebaskan"). */
export interface Exemption {
  id: string;
  date: string;
  reason: string;
  by: { id: string; name: string } | null;
  at: string;
}

export type AttendanceStatus =
  | "CLOCKED_IN" // clocked in today, not yet out
  | "COMPLETE" // in + out by scan
  | "MISSING_CLOCK_OUT" // day ended without clock-out, not fixed yet
  | "FIXED" // clock-out entered manually with a reason
  | "DEDUCTED"; // not fixed within 2 months → 1 day annual leave deducted

/** Attendance record as returned by the backend. */
export interface Attendance {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD (Asia/Jakarta)
  clockIn: string; // ISO
  clockOut: string | null; // ISO
  inLocation: { id: string; name: string };
  outLocation: { id: string; name: string } | null;
  status: AttendanceStatus;
  /** How the QR was read for clock-in / clock-out (null when not clocked out or fixed by hand). */
  inMethod: ScanMethod;
  outMethod: ScanMethod | null;
  fixReason: string | null;
  fixedAt: string | null;
  deductedAt: string | null;
  /** Only for MISSING_CLOCK_OUT: last day it can be fixed. */
  fixDeadline: string | null;
  /** Set when an admin added or changed the record. */
  edit: { by: { id: string; name: string } | null; at: string; reason: string | null } | null;
  /** In lists: false when the day was outside the person's schedule. */
  scheduled?: boolean;
}

/** Admin list rows also carry the person. */
export interface AdminAttendance extends Attendance {
  user: { id: string; name: string; nip: string; unit: string; photoUrl: string | null };
}

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";
/** ANNUAL uses the yearly quota; SICK needs approval too but never touches the quota. */
export type LeaveType = "ANNUAL" | "SICK";

/** Rules shared with the backend (services/leave.ts). */
export const SICK_BACKDATE_DAYS = 7;
export const SICK_NOTE_MIN_DAYS = 2;
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** Leave request as returned by the backend. */
export interface LeaveRequest {
  id: string;
  type: LeaveType;
  userId: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  days: number; // working days (Mon–Fri)
  reason: string;
  status: LeaveStatus;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedBy: { id: string; name: string } | null;
  /** Doctor's note (sick leave). The file itself: leaveAttachmentUrl(id). */
  attachment: { fileName: string; mimeType: string; size: number } | null;
  user: { id: string; name: string; nip: string; unit: string; photoUrl: string | null };
}

export interface LeaveBalance {
  year: number;
  quota: number;
  /** Approved days. */
  used: number;
  /** Days deducted for unfixed missing clock-outs. */
  deducted: number;
  /** Days in requests waiting for a decision. */
  pending: number;
  /** quota − used − deducted */
  remaining: number;
  /** remaining − pending: what can still be requested. */
  available: number;
  /** Approved sick-leave days this year (tracked only). */
  sickDays: number;
}

/** Pending request as shown to approvers. */
export interface PendingLeave extends LeaveRequest {
  balance: LeaveBalance;
  overlaps: { id: string; name: string; start: string; end: string; status: LeaveStatus }[];
}

/** The signed-in user as returned by the backend (POST /api/auth/login, GET /api/me). */
export interface SessionUser {
  id: string;
  /** Optional: teachers synced from the client's database may have none (they log in with their NIP). */
  email: string | null;
  name: string;
  nip: string;
  role: Role;
  unit: string;
  annualQuota: number;
  active: boolean;
  locale: "id" | "en";
  theme: "light" | "dark";
  /** e.g. /api/users/u1/photo?v=1700000000000, or null → placeholder image. */
  photoUrl: string | null;
  /** Signed in with a one-time password: must choose a new one before using the app. */
  mustChangePassword: boolean;
  /** Set for teachers synced from the client's database (name, NIP, unit, email and status come from there). */
  externalId: string | null;
  lastSyncedAt: string | null;
}

/** Staff list row (admin). */
export interface StaffUser extends SessionUser {
  /** False for accounts that can't log in yet (just imported by the sync). */
  hasPassword: boolean;
  balance: LeaveBalance | null;
  /** The schedule that applies today (default = Monday–Friday) and the next change. */
  schedule: { days: number[]; isDefault: boolean; next: SchedulePeriod | null };
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface MonthlyReportRow {
  user: { id: string; name: string; nip: string; unit: string };
  present: number;
  /** Scheduled days in the period. */
  scheduled: number;
  /** Attendance on unscheduled days. */
  outsideSchedule: number;
  /** Scheduled days an admin excused. */
  exempt: number;
  /** Records added or changed by an admin. */
  adminEdited: number;
  /** Approved annual-leave days. */
  leave: number;
  /** Approved sick-leave days. */
  sick: number;
  absent: number;
  missingClockOut: number;
  fixed: number;
  deducted: number;
  /** Days where clock-in or clock-out used an uploaded image. */
  uploads: number;
}

export interface MonthlyReport {
  month: string;
  from: string;
  to: string;
  workdays: number;
  holidays: number;
  rows: MonthlyReportRow[];
}
