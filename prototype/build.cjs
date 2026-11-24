// Builds prototype/ISTA_Presensi_Prototipe.html — ONE self-contained file for the client to click through.
//   node prototype/build.cjs
// Embeds a downsized logo and pre-rendered QR codes (same library as the real kiosk) so the file works
// offline with no server. Uses packages already installed in frontend/ and backend/.
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const root = path.join(__dirname, "..");
const fe = createRequire(path.join(root, "frontend", "package.json"));
const be = createRequire(path.join(root, "backend", "package.json"));
const React = fe("react");
const { renderToStaticMarkup } = fe("react-dom/server");
const { QRCodeSVG } = fe("qrcode.react");
const sharp = be("sharp");

(async () => {
  // Logo: 308 KB original → small PNG for embedding.
  const logo = await sharp(path.join(root, "frontend", "public", "logo-ista.png"))
    .resize(220, 220, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const logoUri = `data:image/png;base64,${logo.toString("base64")}`;

  // 8 sample codes; the kiosk cycles through them every 30 s (real app: a new signed code each slot).
  const frames = Array.from({ length: 8 }, (_, i) => {
    const sig = Buffer.from(`prototype-${i}-ista-al-kamal`).toString("base64url").slice(0, 22);
    const token = `ISTA2.gedung-a.${59700000 + i}.${sig}`;
    return renderToStaticMarkup(React.createElement(QRCodeSVG, { value: token, size: 300, level: "M", fgColor: "#0e3028", marginSize: 0 }));
  });

  const src = fs.readFileSync(path.join(__dirname, "src.html"), "utf8");
  const out = src.replaceAll("__LOGO_URI__", logoUri).replace("__QR_FRAMES__", JSON.stringify(frames));
  const file = path.join(__dirname, "ISTA_Presensi_Prototipe.html");
  fs.writeFileSync(file, out);
  console.log(`wrote ${path.relative(root, file)} (${Math.round(out.length / 1024)} KB)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
