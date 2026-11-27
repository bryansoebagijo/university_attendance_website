import sharp from "sharp";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

const app = createApp();
const PASSWORD = "demo123";

async function login(email: string, password = PASSWORD) {
  return request(app).post("/api/auth/login").send({ email, password });
}

/** Returns the Cookie header value from a successful login. */
async function sessionCookie(email = "siti@ista.ac.id") {
  const res = await login(email);
  expect(res.status).toBe(200);
  const raw = res.headers["set-cookie"] as unknown as string[];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

afterAll(() => prisma.$disconnect());

describe("health", () => {
  it("responds", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("POST /api/auth/login", () => {
  it("logs in and sets an httpOnly session cookie", async () => {
    const res = await login("SITI@ista.ac.id"); // email is case-insensitive
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: "u1", role: "USER", locale: "id", theme: "light", photoUrl: null });
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toMatch(/^absen_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("rejects a wrong password, an unknown email and an inactive user the same way", async () => {
    for (const res of [await login("siti@ista.ac.id", "wrong"), await login("nobody@ista.ac.id"), await login("hendra@ista.ac.id")]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("INVALID_CREDENTIALS");
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("validates the body", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/me", () => {
  it("requires a session", async () => {
    expect((await request(app).get("/api/me")).status).toBe(401);
  });

  it("rejects a tampered token", async () => {
    const cookie = await sessionCookie();
    // Change a character inside the signature. (Not the last one: in base64 its low bits are padding,
    // so swapping it can decode to the very same bytes and leave the token valid — a flaky test.)
    const i = cookie.length - 10;
    const tampered = cookie.slice(0, i) + (cookie[i] === "A" ? "B" : "A") + cookie.slice(i + 1);
    expect((await request(app).get("/api/me").set("Cookie", tampered)).status).toBe(401);
  });

  it("returns the signed-in user", async () => {
    const res = await request(app).get("/api/me").set("Cookie", await sessionCookie("admin@ista.ac.id"));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: "ad", role: "ADMIN", name: "Sri Dewanti" });
  });

  it("stops working as soon as the user is deactivated", async () => {
    const cookie = await sessionCookie("dewi@ista.ac.id");
    await prisma.user.update({ where: { id: "u3" }, data: { active: false } });
    try {
      expect((await request(app).get("/api/me").set("Cookie", cookie)).status).toBe(401);
    } finally {
      await prisma.user.update({ where: { id: "u3" }, data: { active: true } });
    }
  });
});

describe("PATCH /api/me/preferences", () => {
  it("saves language and theme", async () => {
    const cookie = await sessionCookie("ahmad@ista.ac.id");
    const res = await request(app).patch("/api/me/preferences").set("Cookie", cookie).send({ locale: "en", theme: "dark" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ locale: "en", theme: "dark" });
    const again = await login("ahmad@ista.ac.id");
    expect(again.body.user).toMatchObject({ locale: "en", theme: "dark" });
  });

  it("rejects unknown values and fields", async () => {
    const cookie = await sessionCookie("ahmad@ista.ac.id");
    expect((await request(app).patch("/api/me/preferences").set("Cookie", cookie).send({ theme: "blue" })).status).toBe(400);
    expect((await request(app).patch("/api/me/preferences").set("Cookie", cookie).send({ role: "ADMIN" })).status).toBe(400);
  });
});

describe("profile photo", () => {
  it("uploads, serves, and deletes a photo", async () => {
    const cookie = await sessionCookie("rina@ista.ac.id");
    const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: "#2f7b46" } }).png().toBuffer();

    const up = await request(app).put("/api/me/photo").set("Cookie", cookie).attach("photo", png, { filename: "me.png", contentType: "image/png" });
    expect(up.status).toBe(200);
    expect(up.body.user.photoUrl).toMatch(/^\/api\/users\/u5\/photo\?v=\d+$/);

    // The login response includes the photo URL too.
    expect((await login("rina@ista.ac.id")).body.user.photoUrl).toBe(up.body.user.photoUrl);

    const img = await request(app).get(up.body.user.photoUrl).set("Cookie", cookie).buffer(true);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
    const meta = await sharp(img.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([320, 320]); // cropped square

    const del = await request(app).delete("/api/me/photo").set("Cookie", cookie);
    expect(del.body.user.photoUrl).toBeNull();
    expect((await request(app).get("/api/users/u5/photo").set("Cookie", cookie)).status).toBe(404);
  });

  it("rejects files that aren't real images", async () => {
    const cookie = await sessionCookie("rina@ista.ac.id");
    const fake = await request(app)
      .put("/api/me/photo")
      .set("Cookie", cookie)
      .attach("photo", Buffer.from("definitely not a png"), { filename: "x.png", contentType: "image/png" });
    expect(fake.status).toBe(415);
    const pdf = await request(app)
      .put("/api/me/photo")
      .set("Cookie", cookie)
      .attach("photo", Buffer.from("%PDF-1.4"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(pdf.status).toBe(415);
  });

  it("requires a session to view photos", async () => {
    expect((await request(app).get("/api/users/u1/photo")).status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(204);
    expect((res.headers["set-cookie"] as unknown as string[])[0]).toMatch(/absen_session=;/);
  });
});
