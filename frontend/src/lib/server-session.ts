import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./session";
import type { SessionUser } from "./types";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export type SessionResult = { status: "ok"; user: SessionUser } | { status: "none" } | { status: "unreachable" };

/** Server components: load the signed-in user from the backend (source of truth for role, photo, prefs). */
export async function getSessionUser(): Promise<SessionResult> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { status: "none" };
  try {
    const res = await fetch(`${API_URL}/api/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: "no-store",
    });
    if (res.status === 401) return { status: "none" };
    if (!res.ok) return { status: "unreachable" };
    const body = (await res.json()) as { user: SessionUser };
    return { status: "ok", user: body.user };
  } catch {
    return { status: "unreachable" };
  }
}
