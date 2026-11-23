import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell";
import { ServerUnavailable } from "@/components/server-unavailable";
import { SessionProvider } from "@/lib/me";
import { getSessionUser } from "@/lib/server-session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser();
  if (session.status === "none") redirect("/logout?expired=1");
  if (session.status === "unreachable") return <ServerUnavailable />;
  return (
    <SessionProvider user={session.user}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
