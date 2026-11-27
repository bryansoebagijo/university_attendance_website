// Frontend entry point in the release (the runtime image has no shell).
// Loads the session secret from the Docker secret file, then starts the Next.js standalone server.
import { readFileSync } from "node:fs";

const file = process.env.JWT_SECRET_FILE;
if (file && !process.env.JWT_SECRET) {
  try {
    // Strip CR/LF so a file edited on Windows or ending in a newline still matches the backend.
    process.env.JWT_SECRET = readFileSync(file, "utf8").replace(/[\r\n]/g, "");
  } catch (e) {
    console.error(`Cannot read JWT_SECRET_FILE (${file}): ${e.message}. Check owner/permissions (chown 1000:1000, chmod 400).`);
    process.exit(1);
  }
}
if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET (or JWT_SECRET_FILE) is not set.");
  process.exit(1);
}
await import("./server.js");
