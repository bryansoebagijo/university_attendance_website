// Builds an OFFLINE release for servers with no internet access:
//   node deploy/release/make-release.mjs [--no-docker-installer]
// Output in release/ (git-ignored):
//   ista-absen-<version>.zip   everything the server needs (see below), inside one folder
//   deploy.sh                  the installer, to copy next to the zip
//   SHA256SUMS                 checksums, verified by deploy.sh
//
// The zip contains:
//   app/backend    compiled backend + its packages for Linux x64 (incl. Prisma's Linux engine for MySQL)
//   app/frontend   Next.js standalone server (built; no native modules) + launch.mjs
//   images/        the Node.js 22 runtime image as a `docker load` archive (Google distroless, Debian 12)
//   offline/docker optional: Docker Engine + Compose plugin (official static binaries) for servers without Docker
//   deploy/        deploy.sh, database SQL, config templates, web server examples, the PDF guide
//   docker-compose.yml, DEPLOY.md, VERSION
//
// Needs internet on THIS machine (npm registry, Prisma engines, gcr.io, download.docker.com, GitHub).
// Downloads are cached in release/.cache.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchImage, findInLayers } from "./fetch-image.mjs";
import { download, sha256File } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const cache = path.join(root, "release", ".cache");
const withDocker = !process.argv.includes("--no-docker-installer");
const DOCKER_VERSION = "29.10.1";
const COMPOSE_VERSION = "v5.8.0";
const IMAGE = { registry: "gcr.io", image: "distroless/nodejs22-debian12", tag: "latest", localName: "ista-absen-node:22-distroless" };
const PG_IMAGE = { registry: "docker.io", image: "library/postgres", tag: "17-alpine", localName: "ista-absen-postgres:17" };

const log = (m) => console.log(`• ${m}`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const sh = { shell: process.platform === "win32" };

// ---- Version -------------------------------------------------------------------------------------
const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  .format(new Date())
  .replace(/-/g, ".")
  .replace(" ", "-")
  .replace(":", "");
const commit = git("rev-parse", "--short", "HEAD");
const dirty = git("status", "--porcelain") !== "";
const version = `${stamp}-${commit}${dirty ? "-dirty" : ""}`;
const name = `ista-absen-${version}`;
const stage = path.join(os.tmpdir(), `ista-release-${process.pid}`);
const out = path.join(stage, name);
rmSync(stage, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
log(`Building ${name}`);

// ---- Backend: compile, Linux packages, Prisma client for MySQL with the Debian/OpenSSL 3 engine ----------
{
  const be = path.join(root, "backend");
  const dst = path.join(out, "app", "backend");
  log("backend: compiling TypeScript");
  rmSync(path.join(be, "dist"), { recursive: true, force: true });
  run(npx, ["tsc"], { cwd: be, ...sh });
  mkdirSync(dst, { recursive: true });
  cpSync(path.join(be, "dist"), path.join(dst, "dist"), { recursive: true });
  for (const f of ["package.json", "package-lock.json"]) cpSync(path.join(be, f), path.join(dst, f));

  log("backend: installing production packages for Linux x64 (glibc)");
  // --ignore-scripts: no postinstall (it would generate a Windows Prisma client); sharp ships prebuilt binaries.
  run(npm, ["ci", "--omit=dev", "--ignore-scripts", "--os=linux", "--cpu=x64", "--libc=glibc", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dst, ...sh });

  log("backend: generating the Prisma client (PostgreSQL, debian-openssl-3.0.x engine) + migrations");
  const schemaSrc = readFileSync(path.join(be, "prisma", "schema.prisma"), "utf8");
  if (!schemaSrc.includes('provider = "postgresql"')) throw new Error("prisma/schema.prisma is not the PostgreSQL schema");
  // The app creates/updates its own PostgreSQL from these at startup (AUTO_MIGRATE).
  cpSync(path.join(be, "prisma", "migrations"), path.join(dst, "prisma", "migrations"), { recursive: true });
  mkdirSync(path.join(dst, "prisma"), { recursive: true });
  writeFileSync(
    path.join(dst, "prisma", "schema.prisma"),
    schemaSrc.replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  binaryTargets = ["debian-openssl-3.0.x"]'),
  );
  run(process.execPath, [path.join(be, "node_modules", "prisma", "build", "index.js"), "generate", "--schema", "prisma/schema.prisma"], {
    cwd: dst,
    env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1", DATABASE_URL: "postgresql://u:p@localhost:5432/db" },
  });
  // The CLI and its engines aren't used at runtime (the DBA runs the SQL files): drop them.
  for (const p of ["node_modules/prisma", "node_modules/@prisma/engines", "node_modules/.bin"]) rmSync(path.join(dst, p), { recursive: true, force: true });
  const engine = path.join(dst, "node_modules", ".prisma", "client", "libquery_engine-debian-openssl-3.0.x.so.node");
  if (!existsSync(engine)) throw new Error("Prisma Linux engine missing");
  if (!readFileSync(path.join(dst, "node_modules", ".prisma", "client", "schema.prisma"), "utf8").includes('provider = "postgresql"')) throw new Error("generated client is not PostgreSQL");
  if (!existsSync(path.join(dst, "node_modules", "mysql2"))) throw new Error("mysql2 (HR connection) missing from the bundle");
}

// ---- Frontend: Next.js standalone build ---------------------------------------------------------------
{
  const fe = path.join(root, "frontend");
  const dist = ".next-release";
  const dst = path.join(out, "app", "frontend");
  log("frontend: building (Next.js standalone)");
  rmSync(path.join(fe, dist), { recursive: true, force: true });
  const tsconfig = readFileSync(path.join(fe, "tsconfig.json"));
  try {
    run(npx, ["next", "build"], {
      cwd: fe,
      ...sh,
      // JWT_SECRET is set (empty) so Next doesn't pick up a developer's .env.local value; the real one comes
      // from the server's secret file at runtime.
      env: { ...process.env, NEXT_OUTPUT: "standalone", NEXT_DIST_DIR: dist, API_URL: "http://backend:4000", JWT_SECRET: "", NEXT_TELEMETRY_DISABLED: "1" },
    });
  } finally {
    writeFileSync(path.join(fe, "tsconfig.json"), tsconfig); // next build adds its dist dir to "include"
  }
  const standalone = path.join(fe, dist, "standalone");
  // Next puts server.js at the root of standalone/, or under the project folder name when it traces from a parent.
  const serverDir = existsSync(path.join(standalone, "server.js")) ? standalone : path.join(standalone, "frontend");
  if (!existsSync(path.join(serverDir, "server.js"))) throw new Error("standalone server.js not found");
  cpSync(serverDir, dst, { recursive: true });
  if (serverDir !== standalone && existsSync(path.join(standalone, "node_modules"))) cpSync(path.join(standalone, "node_modules"), path.join(dst, "node_modules"), { recursive: true });
  cpSync(path.join(fe, dist, "static"), path.join(dst, dist, "static"), { recursive: true });
  cpSync(path.join(fe, "public"), path.join(dst, "public"), { recursive: true });
  mkdirSync(path.join(dst, dist, "cache"), { recursive: true });
  writeFileSync(path.join(dst, dist, "cache", ".keep"), "");
  cpSync(path.join(here, "launch.mjs"), path.join(dst, "launch.mjs"));
  for (const f of readdirSync(dst)) if (f.startsWith(".env")) rmSync(path.join(dst, f), { force: true });
  // Images are served unoptimized in releases, so the (platform-specific) sharp optimizer is never loaded.
  for (const p of ["node_modules/sharp", "node_modules/@img"]) rmSync(path.join(dst, p), { recursive: true, force: true });
}

// No Windows-only native modules may slip into the Linux bundle.
const natives = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(node|dll|exe)$/.test(e.name)) natives.push(p);
  }
};
walk(path.join(out, "app"));
for (const p of natives) {
  const head = readFileSync(p).subarray(0, 4);
  const elf = head[0] === 0x7f && head.toString("latin1", 1, 4) === "ELF";
  if (!elf) throw new Error(`Non-Linux binary in bundle: ${path.relative(out, p)}`);
}
log(`native modules (all Linux ELF): ${natives.map((p) => path.basename(p)).join(", ")}`);

// ---- Runtime image ----------------------------------------------------------------------------------
log(`image: ${IMAGE.registry}/${IMAGE.image}:${IMAGE.tag} (linux/amd64)`);
mkdirSync(path.join(out, "images"), { recursive: true });
const img = await fetchImage({ ...IMAGE, cacheDir: path.join(cache, "blobs"), outFile: path.join(out, "images", "ista-absen-node.tar") });
const libs = await findInLayers(img.layers, /(libssl\.so\.3|nodejs\/bin\/node)$/);
if (libs.length < 2) throw new Error(`runtime image lacks node or OpenSSL 3: ${libs.join(", ")}`);
log(`image: ${PG_IMAGE.image}:${PG_IMAGE.tag} (linux/amd64)`);
const pg = await fetchImage({ ...PG_IMAGE, cacheDir: path.join(cache, "blobs"), outFile: path.join(out, "images", "ista-absen-postgres.tar") });
if ((await findInLayers(pg.layers, /bin\/(pg_dump|pg_restore|pg_isready)$/)).length < 3) throw new Error("postgres image lacks pg_dump/pg_restore/pg_isready");

// ---- Optional offline Docker installer ------------------------------------------------------------------
if (withDocker) {
  log(`docker: static binaries ${DOCKER_VERSION} + compose ${COMPOSE_VERSION}`);
  const dir = path.join(out, "offline", "docker");
  mkdirSync(dir, { recursive: true });
  const dockerTgz = await download(`https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz`, path.join(cache, `docker-${DOCKER_VERSION}.tgz`));
  const composeUrl = `https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64`;
  const composeSha = (await (await fetch(`${composeUrl}.sha256`)).text()).trim().split(/\s+/)[0];
  const composeBin = await download(composeUrl, path.join(cache, `docker-compose-${COMPOSE_VERSION}`), { sha256: composeSha });
  cpSync(dockerTgz, path.join(dir, `docker-${DOCKER_VERSION}.tgz`));
  cpSync(composeBin, path.join(dir, "docker-compose-linux-x86_64"));
  writeFileSync(
    path.join(dir, "SHA256SUMS"),
    `${await sha256File(dockerTgz)}  docker-${DOCKER_VERSION}.tgz\n${composeSha}  docker-compose-linux-x86_64\n`,
  );
}

// ---- Deployment files ----------------------------------------------------------------------------------
log("deploy files");
const copy = (from, to = from) => cpSync(path.join(root, from), path.join(out, to), { recursive: true });
copy("deploy/release/docker-compose.yml", "docker-compose.yml");
copy("deploy/deploy.sh");
copy("deploy/mariadb");
copy("deploy/config.example");
copy("deploy/nginx.example.conf");
copy("deploy/apache.example.conf");
copy("deploy/ISTA_Presensi_Deployment_Guide.pdf");
copy("DEPLOY.md");
for (const f of ["deploy/deploy.sh"]) if (readFileSync(path.join(root, f), "utf8").includes("\r\n")) throw new Error(`${f} has Windows line endings`);
writeFileSync(
  path.join(out, "VERSION"),
  `version=${version}\ncommit=${git("rev-parse", "HEAD")}\nuncommitted_changes=${dirty}\nbuilt=${new Date().toISOString()}\nimage=${IMAGE.registry}/${IMAGE.image}@${img.platformDigest ?? ""}\ndb_image=${PG_IMAGE.registry}/${PG_IMAGE.image}:${PG_IMAGE.tag}@${pg.platformDigest ?? ""}\n`,
);

// ---- Zip ---------------------------------------------------------------------------------------------
const outDir = path.join(root, "release");
mkdirSync(outDir, { recursive: true });
const zip = path.join(outDir, `${name}.zip`);
rmSync(zip, { force: true });
log("zip");
const bsdtar = process.platform === "win32" ? "C:/Windows/System32/tar.exe" : "bsdtar";
try {
  execFileSync(bsdtar, ["-a", "-c", "-f", zip, name], { cwd: stage, stdio: "ignore" });
} catch {
  execFileSync("zip", ["-qr", zip, name], { cwd: stage, stdio: "ignore" });
}
cpSync(path.join(root, "deploy", "deploy.sh"), path.join(outDir, "deploy.sh"));
writeFileSync(path.join(outDir, "SHA256SUMS"), `${await sha256File(zip)}  ${path.basename(zip)}\n${await sha256File(path.join(outDir, "deploy.sh"))}  deploy.sh\n`);

const size = (p) => {
  let n = 0;
  const w = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) w(q);
      else n += statSync(q).size;
    }
  };
  if (statSync(p).isDirectory()) w(p);
  else n = statSync(p).size;
  return `${(n / 1048576).toFixed(0)} MB`;
};
console.log("\nContents (unpacked):");
for (const p of ["app/backend", "app/frontend", "images", ...(withDocker ? ["offline"] : [])]) console.log(`  ${p.padEnd(14)} ${size(path.join(out, p))}`);
rmSync(stage, { recursive: true, force: true });
console.log(`\nrelease/${path.basename(zip)}  (${size(zip)})\nrelease/deploy.sh\nrelease/SHA256SUMS`);
if (dirty) console.log("Note: built from uncommitted changes (version ends in -dirty). Commit first for a traceable release.");
