"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Role, SessionUser } from "./types";

interface SessionCtxValue {
  userId: string;
  role: Role;
  user: SessionUser;
  /** Replace the cached user after an API call returns a fresh copy (photo, preferences). */
  setUser: (u: SessionUser) => void;
}

const SessionCtx = createContext<SessionCtxValue | null>(null);

export function SessionProvider({ user: initial, children }: { user: SessionUser; children: ReactNode }) {
  const [user, setUser] = useState(initial);
  const value = useMemo(() => ({ userId: user.id, role: user.role, user, setUser }), [user]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}

/** The signed-in user from the backend. */
export function useMe(): SessionUser {
  return useSession().user;
}
