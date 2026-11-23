import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Lets async route handlers throw; errors go to errorHandler. */
export const route =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "VALIDATION", issues: err.flatten().fieldErrors });
    return;
  }
  // Two serializable transactions collided (e.g. simultaneous leave requests): safe to retry.
  if (err && typeof err === "object" && "code" in err && err.code === "P2034") {
    res.status(409).json({ error: "CONFLICT_RETRY" });
    return;
  }
  // multer limit errors
  if (err && typeof err === "object" && "code" in err && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "FILE_TOO_LARGE" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "INTERNAL" });
}
