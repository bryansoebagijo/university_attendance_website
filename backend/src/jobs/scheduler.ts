import cron from "node-cron";
import { config } from "../config.js";
import { TZ } from "../lib/time.js";
import { runDailyRules } from "../services/attendance.js";
import { licenseStatus } from "../services/license.js";
import { prisma } from "../db.js";
import { runTeacherSync, syncConfigured } from "../services/teacher-sync.js";

/** In read-only mode (license) nothing changes data, the scheduled jobs included. */
const readOnly = () => {
  try {
    return licenseStatus().readOnly;
  } catch {
    return false;
  }
};

async function dailyRules(label: string) {
  if (readOnly()) return console.warn(`[daily-rules:${label}] skipped: license read-only mode`);
  try {
    const r = await runDailyRules();
    console.log(`[daily-rules:${label}] marked missing: ${r.markedMissing}, deducted: ${r.deducted}`);
  } catch (e) {
    console.error(`[daily-rules:${label}] failed`, e);
  }
}

async function sync(trigger: "NIGHTLY" | "STARTUP") {
  if (readOnly()) return console.warn("[teacher-sync] skipped: license read-only mode");
  try {
    const r = await runTeacherSync({ trigger });
    const line = `[teacher-sync:${trigger.toLowerCase()}] ${r.status}: +${r.added} ~${r.updated} -${r.deactivated} photos ${r.photos} skipped ${r.skipped}${r.message ? ` (${r.message})` : ""}`;
    if (r.status === "OK") console.log(line);
    else console.warn(line);
  } catch (e) {
    console.error("[teacher-sync] failed", e);
  }
}

/**
 * A new, empty database fills itself: until one sync has succeeded, the app tries an import at every
 * start (the admin can also click "Sinkronkan sekarang"). If the HR database can't be reached, nothing
 * changes and the admin can add staff by hand.
 */
async function firstImport() {
  if (!syncConfigured()) return;
  const done = await prisma.syncRun.count({ where: { status: "OK" } }).catch(() => 1);
  if (done === 0) await sync("STARTUP");
}

/**
 * 00:05 WIB every day: teacher sync first (so deactivations are current), then the attendance rules.
 * The attendance rules also run once at startup to catch up after downtime.
 */
export function startScheduler() {
  void dailyRules("startup");
  void firstImport();
  cron.schedule(
    "5 0 * * *",
    async () => {
      if (syncConfigured() && config.SYNC_NIGHTLY) await sync("NIGHTLY");
      await dailyRules("nightly");
    },
    { timezone: TZ },
  );
}
