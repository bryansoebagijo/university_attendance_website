"use client";

import { Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { use, useEffect, useRef, useState } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { ApiError, kioskApi, type KioskToken } from "@/lib/api";
import { fmtDateLong, jakartaDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { downloadQrPng, fmtJakartaTime } from "@/lib/qr-png";

const SLOT_SECONDS = 30;
const storageKey = (id: string) => `absen_kiosk_key:${id}`;

function readStored(id: string) {
  try {
    return localStorage.getItem(storageKey(id));
  } catch {
    return null;
  }
}

/**
 * Kiosk screen shown on a monitor/tablet at a campus location.
 * The screen is paired once by an admin (QR locations → Open kiosk screen), which opens
 * /kiosk/<id>#key=<key>. The key is kept in this browser and sent as X-Kiosk-Key; the server
 * signs a fresh QR token every 30 seconds.
 */
export default function KioskPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = use(params);
  const { t, f, locale } = useI18n();
  const [now, setNow] = useState<number | null>(null);
  const [key, setKey] = useState<string | null | undefined>(undefined); // undefined = not read yet
  const [info, setInfo] = useState<KioskToken | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const qrRef = useRef<SVGSVGElement>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "unpaired" | "offline">("loading");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clock tick.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Read the key from the pairing link (then hide it from the address bar) or from storage.
  useEffect(() => {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("key");
    if (fromHash) {
      try {
        localStorage.setItem(storageKey(locationId), fromHash);
      } catch {
        /* storage blocked: the key still works for this page view */
      }
      history.replaceState(null, "", window.location.pathname);
      setKey(fromHash);
    } else setKey(readStored(locationId));
  }, [locationId]);

  // Fetch a token now and again when it rotates.
  useEffect(() => {
    if (key === undefined) return;
    if (!key) {
      setStatus("unpaired");
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await kioskApi.token(locationId, key);
        if (cancelled) return;
        setInfo(res);
        setStatus("ok");
        const left = res.secondsLeft ?? SLOT_SECONDS;
        setExpiresAt(Date.now() + left * 1000);
        timer.current = setTimeout(load, left * 1000 + 300);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          // Key was replaced or never valid: forget it so the screen asks to be paired again.
          try {
            localStorage.removeItem(storageKey(locationId));
          } catch {
            /* ignore */
          }
          setStatus("unpaired");
          return;
        }
        setStatus("offline"); // keep showing the last code (valid up to 60 s) and retry
        timer.current = setTimeout(load, 5000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, locationId]);

  if (now === null || status === "loading") return <div className="min-h-screen bg-forest-900" />;

  const location = info?.location;
  const token = info?.token ?? null;
  const secs = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const showQr = (status === "ok" || status === "offline") && !!location?.active && !!token;
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
  const R = 22;
  const C = 2 * Math.PI * R;
  const SLOT_MS = SLOT_SECONDS * 1000;

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[linear-gradient(150deg,#194d36,#0e3028)] px-4 py-14 text-white md:px-12">
      <div className="pointer-events-none absolute h-[620px] w-[620px] rounded-full border border-[#b7be7b14]" />
      <div className="pointer-events-none absolute h-[860px] w-[860px] rounded-full border border-[#b7be7b10]" />
      <div className="absolute right-4 top-4 opacity-80">
        <LanguageSwitch />
      </div>

      {/* Portrait (phones, portrait tablets): one column. Landscape tablets / monitors: QR left, info right. */}
      <div className="relative z-10 grid w-full max-w-[520px] justify-items-center gap-6 text-center md:landscape:max-w-[1100px] md:landscape:grid-cols-[auto_1fr] md:landscape:items-center md:landscape:gap-14 md:landscape:text-left">
        {!showQr || !location || !token ? (
          <div className="flex flex-col items-center gap-10 md:landscape:col-span-2">
            <Brand tagline={t.app.tagline} />
            {status === "unpaired" ? (
              <div className="max-w-[440px]">
                <p className="font-display text-[22px] font-bold text-[#fff9e9]">{t.kiosk.notPaired}</p>
                <p className="mt-2 text-[14px] leading-relaxed text-[#a4bdab]">{t.kiosk.notPairedBody}</p>
              </div>
            ) : (
              <p className="text-[18px] text-[#cfe0d3]">{t.scan.errLocation}</p>
            )}
            <Clock clock={clock} date={fmtDateLong(jakartaDate(new Date(now)), locale)} />
          </div>
        ) : (
          <>
            <div className="contents md:landscape:flex md:landscape:flex-col md:landscape:items-start md:landscape:order-2">
              <Brand tagline={t.app.tagline} />
              <div className="md:landscape:mt-10">
                <div className="text-[11px] uppercase tracking-[2px] text-[#d3bc72]">{location.building}</div>
                <h1 className="mt-1 font-display text-[clamp(24px,4vw,40px)] font-extrabold leading-tight text-[#fff9e9]">{location.name}</h1>
              </div>
              <div className="order-last md:landscape:order-none md:landscape:mt-6">
                <h2 className="font-display text-[20px] font-bold">{t.kiosk.title}</h2>
                <p className="mt-1 max-w-[420px] text-[13px] leading-relaxed text-[#a4bdab]">{t.kiosk.sub}</p>
              </div>
              <div className="order-last md:landscape:order-none md:landscape:mt-8">
                <Clock clock={clock} date={fmtDateLong(jakartaDate(new Date(now)), locale)} />
              </div>
            </div>

            <div className="flex flex-col items-center md:landscape:order-1">
              <div className="rounded-[22px] bg-white p-4 shadow-[0_0_0_10px_#d2c17b14,0_30px_80px_#021a1760] sm:p-6">
                <QRCodeSVG
                  ref={qrRef}
                  value={token}
                  size={420}
                  level="M"
                  fgColor="#0e3028"
                  className="h-auto w-[min(400px,72vw,40vh)] md:landscape:w-[min(420px,58vh,42vw)]"
                />
              </div>
              <div className="mt-5 flex items-center gap-3 text-[14px] text-[#cfe0d3]">
                <svg width="52" height="52" viewBox="0 0 52 52" className="-rotate-90" aria-hidden>
                  <circle cx="26" cy="26" r={R} fill="none" stroke="#ffffff1a" strokeWidth="4" />
                  <circle
                    cx="26"
                    cy="26"
                    r={R}
                    fill="none"
                    stroke="#d8b757"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={C}
                    strokeDashoffset={C * (1 - secs / (SLOT_MS / 1000))}
                    style={{ transition: "stroke-dashoffset 1s linear" }}
                  />
                </svg>
                <span>{f(t.kiosk.refresh, { seconds: secs })}</span>
                {status === "offline" && <span className="tag tag-warn ml-1">offline</span>}
              </div>
              {/* Saves the code on screen as a labelled PNG. It expires like the on-screen code (~60 s). */}
              <button
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-[#cfe0d3] transition-colors hover:bg-white/10"
                onClick={() => {
                  if (!qrRef.current) return;
                  void downloadQrPng(qrRef.current, {
                    locationId: location.id,
                    title: location.name,
                    // Accepted for the rest of this slot plus the next 30 s.
                    subtitle: f(t.admin.validUntilPng, { time: fmtJakartaTime(new Date(expiresAt + SLOT_MS)) }),
                  });
                }}
              >
                <Download size={13} /> {t.admin.downloadQr}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Brand({ tagline }: { tagline: string }) {
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-ista.png" alt="" className="h-14 w-14 rounded-full bg-white object-contain p-1" />
      <div className="text-left">
        <div className="font-display text-[24px] font-extrabold tracking-[2px]">ISTA</div>
        <div className="text-[9px] tracking-[1.5px] text-[#d8bd69]">{tagline}</div>
      </div>
    </div>
  );
}

function Clock({ clock, date }: { clock: string; date: string }) {
  return (
    <div>
      <div className="font-display text-[clamp(32px,5vw,56px)] font-bold tabular-nums leading-none tracking-tight">{clock}</div>
      <div className="mt-2 text-[13px] text-[#a4bdab]">{date} · WIB</div>
    </div>
  );
}
