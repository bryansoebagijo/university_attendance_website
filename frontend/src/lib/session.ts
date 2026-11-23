// Session = httpOnly JWT cookie issued by the Express backend (POST /api/auth/login).
// The browser can't read it; the middleware verifies it with the shared JWT_SECRET.
import type { Role } from "./types";

export const SESSION_COOKIE = "absen_session";

/** Which roles may open which route prefixes. The backend enforces the same rules on its API. */
export function canAccess(role: Role, pathname: string): boolean {
  if (pathname.startsWith("/admin")) return role === "ADMIN";
  if (pathname.startsWith("/approvals")) return role === "APPROVER" || role === "ADMIN";
  return true;
}
