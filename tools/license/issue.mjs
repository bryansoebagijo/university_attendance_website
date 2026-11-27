// Issues a signed license file for a customer.
//   node tools/license/issue.mjs --customer "ISTA Al-Kamal" --expires 2027-12-31 [--grace 14] [--note "…"]
//                                [--out <file>] [--private <path>]   (default out: ~/.ista-license/issued/)
//
// The file is plain text: a readable header plus one signed line. Editing anything in the signed line
// breaks the signature. The app only reads the signed part; the header is for people.
// No domain or installation lock (licenses may get a "lock" later; the app rejects locks it doesn't know).
import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    customer: { type: "string" },
    expires: { type: "string" },
    grace: { type: "string", default: "14" },
    note: { type: "string" },
    out: { type: "string" },
    private: { type: "string" },
  },
});
const fail = (m) => {
  console.error(m);
  console.error('Usage: node tools/license/issue.mjs --customer "ISTA Al-Kamal" --expires 2027-12-31 [--grace 14] [--out license.key]');
  process.exit(1);
};
if (!values.customer?.trim()) fail("--customer is required");
if (!/^\d{4}-\d{2}-\d{2}$/.test(values.expires ?? "") || Number.isNaN(Date.parse(values.expires))) fail("--expires must be a date like 2027-12-31");
const grace = Number(values.grace);
if (!Number.isInteger(grace) || grace < 0 || grace > 90) fail("--grace must be 0–90 days");

const privatePath = path.resolve(values.private ?? path.join(os.homedir(), ".ista-license", "ista-license-private.pem"));
let key;
try {
  key = createPrivateKey(readFileSync(privatePath));
} catch {
  fail(`Cannot read the private key at ${privatePath} (create it once with: node tools/license/keygen.mjs)`);
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const payload = {
  v: 1,
  id: `LIC-${today.replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`,
  customer: values.customer.trim(),
  issuedAt: today,
  expiresAt: values.expires,
  graceDays: grace,
  ...(values.note ? { note: values.note } : {}),
};
const body = Buffer.from(JSON.stringify(payload));
const token = `${body.toString("base64url")}.${sign(null, body, key).toString("base64url")}`;
const text = `-----BEGIN ISTA PRESENSI LICENSE-----
License:   ${payload.id}
Customer:  ${payload.customer}
Issued:    ${payload.issuedAt}
Expires:   ${payload.expiresAt} (then ${grace} days grace, then read-only)
${token}
-----END ISTA PRESENSI LICENSE-----
`;
// Default: keep every issued license next to the private key (never inside the project folder).
const out = path.resolve(
  values.out ?? path.join(os.homedir(), ".ista-license", "issued", `${payload.customer.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${payload.expiresAt}.key`),
);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(text);
console.log(`Written to ${out}`);
