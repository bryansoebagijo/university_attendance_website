import { createApp } from "./app.js";
import { config } from "./config.js";
import { startScheduler } from "./jobs/scheduler.js";
import { applyMigrations } from "./lib/migrate.js";
import { checkSchemaVersion } from "./lib/schema-version.js";
import { startLicenseWatch } from "./services/license.js";

async function main() {
  // Own database (offline release): create or update the tables first.
  if (config.AUTO_MIGRATE) {
    const applied = await applyMigrations();
    console.log(applied.length ? `Database updated: ${applied.length} migration(s) applied` : "Database up to date");
  }
  // Refuse to run against a database that hasn't been set up or is behind the code.
  if (!config.SKIP_SCHEMA_CHECK) {
    const version = await checkSchemaVersion();
    console.log(`Database schema version ${version} OK`);
  }
  await startLicenseWatch();
  createApp().listen(config.PORT, () => {
    console.log(`Backend listening on http://localhost:${config.PORT}`);
    startScheduler();
  });
}

main().catch((e) => {
  console.error(`Backend not started: ${(e as Error).message}`);
  process.exit(1);
});
