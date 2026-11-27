import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config, isProd } from "./config.js";
import { errorHandler } from "./lib/http.js";
import { adminRouter } from "./routes/admin.js";
import { attendanceRouter } from "./routes/attendance.js";
import { authRouter } from "./routes/auth.js";
import { devRouter } from "./routes/dev.js";
import { kioskRouter } from "./routes/kiosk.js";
import { adminHolidaysRouter, holidaysRouter } from "./routes/holidays.js";
import { leaveRouter } from "./routes/leave.js";
import { reportsRouter } from "./routes/reports.js";
import { staffRouter } from "./routes/staff.js";
import { correctionsRouter } from "./routes/corrections.js";
import { syncRouter } from "./routes/sync.js";
import { meRouter } from "./routes/me.js";
import { usersRouter } from "./routes/users.js";
import { licenseRouter } from "./routes/license.js";
import { licenseGuard } from "./services/license.js";

export function createApp() {
  const app = express();
  // The Next.js frontend proxies /api/* to this server; trust its X-Forwarded-For for rate limiting.
  app.set("trust proxy", config.TRUST_PROXY);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // Read-only mode when the license is missing, invalid or expired (production only).
  app.use(licenseGuard);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "absen-backend", time: new Date().toISOString() });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/license", licenseRouter);
  app.use("/api/me", meRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/attendance", attendanceRouter);
  app.use("/api/kiosk", kioskRouter);
  app.use("/api/leave", leaveRouter);
  app.use("/api/holidays", holidaysRouter);
  // Specific admin sub-routers first, then the general admin router.
  app.use("/api/admin/sync", syncRouter); // teacher sync with the client's database
  app.use("/api/admin", correctionsRouter); // schedules, day roster, attendance corrections
  app.use("/api/admin/users", staffRouter);
  app.use("/api/admin/holidays", adminHolidaysRouter);
  app.use("/api/admin/reports", reportsRouter);
  app.use("/api/admin", adminRouter);
  if (!isProd) app.use("/api/dev", devRouter); // never in production

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });
  app.use(errorHandler);
  return app;
}
