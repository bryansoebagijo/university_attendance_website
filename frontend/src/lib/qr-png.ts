// Turn an on-screen QR (canvas or SVG from qrcode.react) into a labelled PNG and download it.
// Used by the admin "Unduh QR" dialog and the kiosk screen's download button.

export const fmtJakartaTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);

/** YYYYMMDDHHmmss in Jakarta time, for file names. */
function stamp(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(/[^0-9]/g, "");
}

/** An <svg> drawn as an image (so it can be painted onto a canvas). */
async function svgToImage(svg: SVGSVGElement, size: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(size));
  clone.setAttribute("height", String(size));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadQrPng(
  source: HTMLCanvasElement | SVGSVGElement,
  opts: { locationId: string; title: string; subtitle: string },
) {
  const W = 600;
  const QR = 500;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = 720;
  const ctx = out.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  // SVG is rendered at full size (sharp); a canvas is scaled without smoothing to keep modules crisp.
  const image = source instanceof SVGSVGElement ? await svgToImage(source, QR) : source;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, (W - QR) / 2, 40, QR, QR);
  ctx.textAlign = "center";
  ctx.fillStyle = "#0e3028";
  ctx.font = "bold 30px Arial, sans-serif";
  ctx.fillText(opts.title, W / 2, 600);
  ctx.fillStyle = "#5f7465";
  ctx.font = "22px Arial, sans-serif";
  ctx.fillText(opts.subtitle, W / 2, 645);
  const a = document.createElement("a");
  a.href = out.toDataURL("image/png");
  a.download = `qr-${opts.locationId}-${stamp()}.png`;
  a.click();
}
