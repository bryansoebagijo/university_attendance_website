// Development seed accounts, listed on the login page in development builds only.
// They exist only in a database seeded with `npm run db:seed` (backend/prisma/seed.ts).
import type { Role } from "./types";

export const DEMO_PASSWORD = "demo123";

export const DEMO_ACCOUNTS: { email: string; role: Role }[] = [
  { email: "siti@ista.ac.id", role: "USER" },
  { email: "bambang@ista.ac.id", role: "APPROVER" },
  { email: "admin@ista.ac.id", role: "ADMIN" },
];
