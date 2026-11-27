// Helpers for the release builder: downloads with caching, sha256, and a minimal tar writer.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/** Downloads url to file (skipped when it already exists and, if given, matches sha256). */
export async function download(url, file, { headers = {}, sha256 } = {}) {
  if (existsSync(file) && (!sha256 || (await sha256File(file)) === sha256)) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  if (sha256) {
    const got = await sha256File(tmp);
    if (got !== sha256) throw new Error(`Checksum mismatch for ${url}: expected ${sha256}, got ${got}`);
  }
  renameSync(tmp, file);
  return file;
}

/** Minimal ustar writer: tar.add(name, Buffer | {file}) … tar.end(). Names must be < 100 bytes. */
export function createTar(outFile) {
  const out = createWriteStream(outFile);
  let failed = null;
  out.on("error", (e) => (failed = e));
  const write = (buf) =>
    new Promise((res, rej) => {
      if (failed) return rej(failed);
      if (out.write(buf)) res();
      else out.once("drain", res);
    });
  const header = (name, size) => {
    if (Buffer.byteLength(name) >= 100) throw new Error(`tar name too long: ${name}`);
    const h = Buffer.alloc(512, 0);
    h.write(name, 0, "utf8");
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(size.toString(8).padStart(11, "0") + "\0", 124);
    h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136);
    h.write("        ", 148); // checksum placeholder
    h.write("0", 156); // regular file
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    return h;
  };
  const pad = (size) => (size % 512 ? Buffer.alloc(512 - (size % 512), 0) : null);
  return {
    async add(name, content) {
      if (Buffer.isBuffer(content)) {
        await write(header(name, content.length));
        await write(content);
        const p = pad(content.length);
        if (p) await write(p);
      } else {
        const size = statSync(content.file).size;
        await write(header(name, size));
        for await (const chunk of createReadStream(content.file)) await write(chunk);
        const p = pad(size);
        if (p) await write(p);
      }
    },
    async end() {
      await write(Buffer.alloc(1024, 0));
      await new Promise((res) => out.end(res));
    },
  };
}

export const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
