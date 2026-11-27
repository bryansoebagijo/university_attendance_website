/**
 * Prints the installed license and its state (used by deploy.sh).
 *   node dist/cli/license-status.js      (in Docker: docker compose exec backend …)
 * Exit code 0 = the app can change data; 2 = read-only mode.
 */
import { prisma } from "../db.js";
import { refreshLicense } from "../services/license.js";

const s = await refreshLicense(true);
const line = (k: string, v: unknown) => console.log(`${k.padEnd(12)} ${v ?? "—"}`);
line("State", s.state + (s.readOnly ? "  (READ-ONLY MODE)" : ""));
line("License", s.id);
line("Customer", s.customer);
line("Issued", s.issuedAt);
line("Valid until", s.expiresAt);
line("Grace until", s.graceUntil);
line("Days left", s.daysLeft);
if (s.reason) line("Problem", s.reason);
await prisma.$disconnect();
process.exit(s.readOnly ? 2 : 0);
