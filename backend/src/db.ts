import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";

// config builds DATABASE_URL from DB_* fields / secret files when needed, so pass it explicitly.
export const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
