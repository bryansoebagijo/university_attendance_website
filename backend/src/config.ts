import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  /** Shared with the frontend middleware, which verifies the session token. */
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  SESSION_HOURS: z.coerce.number().positive().default(12),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  /**
   * Number of proxies in front of the backend whose X-Forwarded-For can be trusted (for the real client IP in
   * rate limiting). Development: 1 (Next.js). Docker behind the client web server: 2 (web server + Next.js).
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid backend environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";
