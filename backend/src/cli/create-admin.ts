/**
 * Create the first administrator on a fresh production database (there are no demo accounts there).
 *
 *   node dist/cli/create-admin.js --email admin@ista.ac.id --name "Sri Dewanti" --nip 1988092309 [--unit "Biro SDM"]
 *   (in Docker: docker compose exec backend node dist/cli/create-admin.js …)
 *
 * Prints a one-time password; the admin must choose a new one at first sign-in.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { prisma } from "../db.js";
import { hashPassword, temporaryPassword } from "../lib/password.js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    nip: { type: "string" },
    unit: { type: "string", default: "" },
  },
});

const input = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().min(3),
    nip: z.string().trim().min(3),
    unit: z.string().trim(),
  })
  .safeParse(values);

if (!input.success) {
  console.error('Usage: create-admin --email <email> --name "<full name>" --nip <staff id> [--unit "<unit>"]');
  console.error(input.error.flatten().fieldErrors);
  process.exit(1);
}

const { email, name, nip, unit } = input.data;
const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { nip }] }, select: { email: true } });
if (existing) {
  console.error(`An account with this email or NIP already exists (${existing.email ?? "no email"}). Use "Reset sandi" in the app instead.`);
  await prisma.$disconnect();
  process.exit(1);
}

const tempPassword = temporaryPassword();
await prisma.user.create({
  data: { email, name, nip, unit, role: "ADMIN", passwordHash: await hashPassword(tempPassword), mustChangePassword: true },
});
await prisma.$disconnect();

console.log(`\nAdministrator created: ${name} <${email}>`);
console.log(`One-time password:     ${tempPassword}`);
console.log("Sign in with it; the app will ask for a new password. This password is not shown again.\n");
