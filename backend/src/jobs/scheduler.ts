import cron from "node-cron";
import { runDailyRules } from "../services/attendance.js";
import { TZ } from "../lib/time.js";

async function run(label: string) {
  try {
    const r = await runDailyRules();
    console.log(`[daily-rules:${label}] marked missing: ${r.markedMissing}, deducted: ${r.deducted}`);
  } catch (e) {
    console.error(`[daily-rules:${label}] failed`, e);
  }
}

/** Runs the attendance rules at 00:05 WIB every day, and once at startup to catch up after downtime. */
export function startScheduler() {
  void run("startup");
  cron.schedule("5 0 * * *", () => void run("nightly"), { timezone: TZ });
}
