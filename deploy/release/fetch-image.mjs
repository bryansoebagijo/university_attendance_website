// Downloads a container image (linux/amd64) without Docker and writes an archive that `docker load`
// accepts: OCI layout (index.json, blobs/) plus Docker's manifest.json, layers kept gzip-compressed.
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { createTar, download } from "./lib.mjs";

const REGISTRIES = {
  "docker.io": {
    url: "https://registry-1.docker.io",
    token: (repo) => `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`,
  },
  "gcr.io": { url: "https://gcr.io", token: (repo) => `https://gcr.io/v2/token?scope=repository:${repo}:pull` },
};
const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

async function token(registry, repo) {
  const r = await fetch(REGISTRIES[registry].token(repo));
  if (!r.ok) throw new Error(`${registry} auth failed (${r.status})`);
  return (await r.json()).token;
}

async function getJson(url, auth, accept = ACCEPT) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${auth}`, Accept: accept } });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return await r.json();
}

/**
 * Writes `outFile` (a .tar for `docker load`) for registry/image:tag, tagged `localName` once loaded.
 * Blobs are cached in cacheDir and verified by digest.
 */
export async function fetchImage({ registry = "docker.io", image, tag, localName, cacheDir, outFile }) {
  const base = REGISTRIES[registry].url;
  const auth = await token(registry, image);
  const top = await getJson(`${base}/v2/${image}/manifests/${tag}`, auth);
  let manifest = top;
  let platformDigest = null;
  if (top.manifests) {
    const m = top.manifests.find((x) => x.platform?.os === "linux" && x.platform?.architecture === "amd64" && !x.platform?.variant);
    if (!m) throw new Error("no linux/amd64 image");
    platformDigest = m.digest;
    manifest = await getJson(`${base}/v2/${image}/manifests/${m.digest}`, auth, m.mediaType);
  }
  mkdirSync(cacheDir, { recursive: true });
  const blob = async (digest) => {
    const file = path.join(cacheDir, digest.replace(":", "_"));
    await download(`${base}/v2/${image}/blobs/${digest}`, file, { headers: { Authorization: `Bearer ${auth}` }, sha256: digest.split(":")[1] });
    return file;
  };
  const configFile = await blob(manifest.config.digest);
  const layers = [];
  for (const l of manifest.layers) layers.push({ digest: l.digest, file: await blob(l.digest), size: l.size });

  const hex = (d) => d.split(":")[1];
  const ociManifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: manifest.config.digest, size: manifest.config.size },
      layers: manifest.layers.map((l) => ({ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: l.digest, size: l.size })),
    }),
  );
  const ociDigest = "sha256:" + createHash("sha256").update(ociManifest).digest("hex");
  const [repo, ref] = localName.split(":");
  const index = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: ociDigest,
        size: ociManifest.length,
        annotations: { "io.containerd.image.name": `docker.io/library/${repo}:${ref}`, "org.opencontainers.image.ref.name": ref },
      },
    ],
  };
  const dockerManifest = [{ Config: `blobs/sha256/${hex(manifest.config.digest)}`, RepoTags: [localName], Layers: layers.map((l) => `blobs/sha256/${hex(l.digest)}`) }];

  const tar = createTar(outFile);
  await tar.add("oci-layout", Buffer.from(JSON.stringify({ imageLayoutVersion: "1.0.0" })));
  await tar.add("index.json", Buffer.from(JSON.stringify(index)));
  await tar.add("manifest.json", Buffer.from(JSON.stringify(dockerManifest)));
  await tar.add(`blobs/sha256/${hex(ociDigest)}`, ociManifest);
  await tar.add(`blobs/sha256/${hex(manifest.config.digest)}`, { file: configFile });
  for (const l of layers) await tar.add(`blobs/sha256/${hex(l.digest)}`, { file: l.file });
  await tar.end();
  writeFileSync(`${outFile}.source`, `${registry}/${image}:${tag}\n${platformDigest ?? manifest.config.digest}\n`);
  return { layers, platformDigest, configFile };
}

/** Paths inside gzip-compressed layer tars that match `regex` (to check what an image contains). */
export async function findInLayers(layers, regex) {
  const found = [];
  const str = (b) => b.toString("utf8").replace(/\0.*$/s, "");
  for (const l of layers) {
    let buf = Buffer.alloc(0);
    let skip = 0;
    for await (const chunk of createReadStream(l.file).pipe(createGunzip())) {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 512) {
        if (skip > 0) {
          const n = Math.min(skip, buf.length);
          buf = buf.subarray(n);
          skip -= n;
          continue;
        }
        const h = buf.subarray(0, 512);
        buf = buf.subarray(512);
        if (h.every((b) => b === 0)) continue;
        const prefix = str(h.subarray(345, 500));
        const name = (prefix ? prefix + "/" : "") + str(h.subarray(0, 100));
        const size = parseInt(str(h.subarray(124, 136)).trim() || "0", 8);
        if (regex.test(name)) found.push(name);
        skip = Math.ceil(size / 512) * 512;
      }
    }
  }
  return found;
}
