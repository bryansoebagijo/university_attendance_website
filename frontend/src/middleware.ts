import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, canAccess } from "./lib/session";
import type { Role } from "./lib/types";

const PUBLIC = ["/login", "/kiosk", "/logout"];
const key = new TextEncoder().encode(process.env.JWT_SECRET ?? "");

/** Verifies the backend-issued session token. Role checks here are for routing; the API enforces them too. */
async function readSession(req: NextRequest): Promise<{ userId: string; role: Role } | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    const role = payload.role;
    if (!payload.sub || (role !== "USER" && role !== "APPROVER" && role !== "ADMIN")) return null;
    return { userId: payload.sub, role };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await readSession(req);

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    if (pathname.startsWith("/login") && session) return NextResponse.redirect(new URL("/dashboard", req.url));
    return NextResponse.next();
  }
  if (!session) {
    const res = NextResponse.redirect(new URL("/login", req.url));
    if (req.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE); // expired or invalid
    return res;
  }
  if (!canAccess(session.role, pathname)) return NextResponse.redirect(new URL("/dashboard", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|logo-ista.png|avatar-placeholder.svg|api).*)"],
};
