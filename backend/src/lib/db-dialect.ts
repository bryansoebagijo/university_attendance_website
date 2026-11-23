// Small differences between PostgreSQL and MySQL, picked from DATABASE_URL.
import { config } from "../config.js";

export const dbProvider: "postgresql" | "mysql" = config.DATABASE_URL.startsWith("mysql://") ? "mysql" : "postgresql";

/**
 * Case-insensitive "contains" filter for searches.
 * PostgreSQL needs mode: "insensitive"; MySQL's default collation already ignores case
 * (and Prisma's MySQL client rejects the mode option).
 */
export function containsIgnoreCase(q: string): { contains: string } {
  const filter: { contains: string; mode?: "insensitive" } =
    dbProvider === "postgresql" ? { contains: q, mode: "insensitive" } : { contains: q };
  return filter;
}
