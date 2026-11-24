import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { HttpError, route } from "../lib/http.js";
import { jakartaDate } from "../lib/time.js";
import { cancelRequest, createRequest, decide, getBalance, leaveInclude, overlapsFor, toLeaveDto, type NewAttachment } from "../services/leave.js";

export const leaveRouter = Router();
leaveRouter.use(requireAuth);

const thisYear = () => Number(jakartaDate().slice(0, 4));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---- My leave ---------------------------------------------------------------

leaveRouter.get(
  "/me",
  route(async (req, res) => {
    const userId = req.user!.id;
    const [rows, balance] = await Promise.all([
      prisma.leaveRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100, include: leaveInclude }),
      getBalance(userId, thisYear()),
    ]);
    res.json({ requests: rows.map(toLeaveDto), balance });
  }),
);

const createSchema = z.object({
  type: z.enum(["ANNUAL", "SICK"]).default("ANNUAL"),
  start: isoDate,
  end: isoDate,
  reason: z.string().trim().min(5).max(500),
});

// ---- Doctor's note upload ------------------------------------------------------

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 10 } });

/** Validates the upload: images are re-encoded (shrinks phone photos, strips EXIF, rejects fakes); PDFs must really be PDFs. */
async function readAttachment(file: Express.Multer.File | undefined): Promise<NewAttachment | undefined> {
  if (!file) return undefined;
  const base = (file.originalname || "lampiran").replace(/[^\w.\- ]+/g, "_").slice(0, 80).replace(/\.[^.]*$/, "") || "lampiran";
  if (file.mimetype === "application/pdf") {
    if (file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(415, "UNSUPPORTED_ATTACHMENT");
    return { data: file.buffer, mimeType: "application/pdf", fileName: `${base}.pdf` };
  }
  if (!IMAGE_TYPES.has(file.mimetype)) throw new HttpError(415, "UNSUPPORTED_ATTACHMENT");
  try {
    const data = await sharp(file.buffer, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { data, mimeType: "image/jpeg", fileName: `${base}.jpg` };
  } catch {
    throw new HttpError(415, "UNSUPPORTED_ATTACHMENT");
  }
}

/** JSON (annual leave) or multipart/form-data with an optional "attachment" file (sick leave + doctor's note). */
leaveRouter.post(
  "/",
  upload.single("attachment"),
  route(async (req, res) => {
    const { type, start, end, reason } = createSchema.parse(req.body);
    const attachment = await readAttachment(req.file);
    if (attachment && type !== "SICK") throw new HttpError(400, "ATTACHMENT_NOT_ALLOWED");
    res.status(201).json({ request: await createRequest(req.user!.id, { type, start, end, reason, attachment }) });
  }),
);

/** The doctor's note: visible to the requester, approvers and admins only. */
leaveRouter.get(
  "/:id/attachment",
  route(async (req, res) => {
    const me = req.user!;
    const row = await prisma.leaveRequest.findUnique({ where: { id: req.params.id }, select: { userId: true, attachment: true } });
    const allowed = row && (row.userId === me.id || me.role === "APPROVER" || me.role === "ADMIN");
    if (!allowed || !row.attachment) throw new HttpError(404, "NOT_FOUND");
    const a = row.attachment;
    res.setHeader("Content-Type", a.mimeType);
    res.setHeader("Content-Length", String(a.size));
    res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${a.fileName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.end(Buffer.from(a.data));
  }),
);

leaveRouter.delete(
  "/:id",
  route(async (req, res) => {
    await cancelRequest(req.user!.id, req.params.id);
    res.status(204).end();
  }),
);

// ---- Approvals (approver or admin) -------------------------------------------

const approvers = requireRole("APPROVER", "ADMIN");

/** Waiting requests, oldest start first, each with the person's balance and overlapping leave. */
leaveRouter.get(
  "/pending",
  approvers,
  route(async (_req, res) => {
    const rows = await prisma.leaveRequest.findMany({ where: { status: "PENDING" }, orderBy: { startDate: "asc" }, include: leaveInclude });
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...toLeaveDto(r),
        balance: await getBalance(r.userId, r.startDate.getUTCFullYear()),
        overlaps: await overlapsFor(r),
      })),
    );
    res.json({ requests: items });
  }),
);

leaveRouter.get(
  "/decided",
  approvers,
  route(async (_req, res) => {
    const rows = await prisma.leaveRequest.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: { decidedAt: "desc" },
      take: 100,
      include: leaveInclude,
    });
    res.json({ requests: rows.map(toLeaveDto) });
  }),
);

const decisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() });

leaveRouter.post(
  "/:id/decision",
  approvers,
  route(async (req, res) => {
    const { approve, note } = decisionSchema.parse(req.body);
    res.json({ request: await decide(req.user!.id, req.params.id, approve, note || undefined) });
  }),
);
