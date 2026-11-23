import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Clears the session cookie and goes to /login.
 * `?expired=1` is added when the backend rejected a token the middleware still accepted
 * (e.g. the user was deactivated), so the login page can say why.
 */
export function GET(req: NextRequest) {
  const expired = req.nextUrl.searchParams.has("expired");
  const res = NextResponse.redirect(new URL(expired ? "/login?expired=1" : "/login", req.url));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
