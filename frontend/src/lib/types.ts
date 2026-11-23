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

export type ScanMethod = "CAMERA" | "UPLOAD";

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
  /** Clocked in after 08:00 WIB. */
  late: boolean;
  fixReason: string | null;
  fixedAt: string | null;
  deductedAt: string | null;
  /** Only for MISSING_CLOCK_OUT: last day it can be fixed. */
  fixDeadline: string | null;
}

/** Admin list rows also carry the person. */
export interface AdminAttendance extends Attendance {
  user: { id: string; name: string; nip: string; unit: string; photoUrl: string | null };
}

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";

/** Leave request as returned by the backend. */
export interface LeaveRequest {
  id: string;
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
}

/** Pending request as shown to approvers. */
export interface PendingLeave extends LeaveRequest {
  balance: LeaveBalance;
  overlaps: { id: string; name: string; start: string; end: string; status: LeaveStatus }[];
}

/** The signed-in user as returned by the backend (POST /api/auth/login, GET /api/me). */
export interface SessionUser {
  id: string;
  email: string;
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
}

/** Staff list row (admin). */
export interface StaffUser extends SessionUser {
  balance: LeaveBalance | null;
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface MonthlyReportRow {
  user: { id: string; name: string; nip: string; unit: string };
  present: number;
  late: number;
  leave: number;
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
