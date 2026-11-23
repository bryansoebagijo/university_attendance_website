import request from "supertest";
import { expect } from "vitest";
import { createApp } from "../src/app.js";

export const app = createApp();

/** Logs in with the seed password and returns a Cookie header value. */
export async function sessionCookie(email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: "demo123" });
  expect(res.status).toBe(200);
  return (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
}
