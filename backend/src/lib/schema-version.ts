import { prisma } from "../db.js";

/**
 * The database script version this code needs. Bump it together with a new deploy/mysql/NNN_*.sql file
 * (and the matching Prisma migration, which inserts the same row).
 */
export const REQUIRED_SCHEMA_VERSION = 2;

/** Throws a readable error when the database hasn't been set up, or is older than the code. */
export async function checkSchemaVersion(): Promise<number> {
  let installed: number | null;
  try {
    const row = await prisma.schemaVersion.aggregate({ _max: { version: true } });
    installed = row._max.version;
  } catch (e) {
    throw new Error(
      `Database is not set up (cannot read the SchemaVersion table: ${(e as Error).message.split("\n").pop()}). ` +
        "Run the SQL files in deploy/mysql/ first (see DEPLOY.md).",
    );
  }
  if (installed === null || installed < REQUIRED_SCHEMA_VERSION) {
    throw new Error(
      `Database scripts are older than this version of the app (installed: ${installed ?? "none"}, required: ${REQUIRED_SCHEMA_VERSION}). ` +
        "Ask the DBA to run the newer deploy/mysql/*.sql files, then restart.",
    );
  }
  return installed;
}
