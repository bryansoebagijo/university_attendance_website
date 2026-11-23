"use client";

import { Camera, CheckCircle2, ImageUp, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PageHeading } from "@/components/ui";
import { fmtTime } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { useSWRConfig } from "swr";
import { ApiError, attendanceApi, devApi, paths } from "@/lib/api";

type ScanError = "invalid" | "expired" | "alreadyIn" | "notIn" | "done" | "location" | "noQr" | "generic";

/** Backend error codes → message keys. */
const ERROR_CODES: Record<string, ScanError> = {
  INVALID_QR: "invalid",
  EXPIRED_QR: "expired",
  ALREADY_CLOCKED_IN: "alreadyIn",
  NOT_CLOCKED_IN: "notIn",
  ALREADY_DONE: "done",
  LOCATION_INACTIVE: "location",
};

// Lets you try the flow without a camera. The backend refuses this in production anyway.
const SHOW_SIMULATE = process.env.NODE_ENV !== "production";

type Phase =
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "camera-error" }
  | { kind: "reading" } // decoding an uploaded image
  | { kind: "validating" }
  | { kind: "success"; time: string; location: string }
  | { kind: "error"; error: ScanError };

const READER_ID = "qr-reader";
const UPLOAD_READER_ID = "qr-upload-reader"; // hidden; used to decode uploaded images

export default function ScanPage() {
  return (
    <Suspense>
      <Scan />
    </Suspense>
  );
}

function Scan() {
  const { t, f } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const action = params.get("action") === "out" ? "out" : "in";
  const { mutate } = useSWRConfig();
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [attempt, setAttempt] = useState(0);
  const scannerRef = useRef<{ stop: () => Promise<void>; isScanning: boolean } | null>(null);
  const handledRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const stopCamera = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s?.isScanning) await s.stop().catch(() => {});
  }, []);

  const handleCode = useCallback(
    async (text: string, method: "camera" | "upload" = "camera") => {
      if (handledRef.current) return;
      handledRef.current = true;
      await stopCamera();
      setPhase({ kind: "validating" });
      try {
        // Validated on the server: signature, freshness (≤ 60 s), location, and today's state.
        const res = await attendanceApi.scan(text, action, method);
        setPhase({
          kind: "success",
          time: fmtTime(action === "in" ? res.record.clockIn : res.record.clockOut),
          location: res.location.name,
        });
        if (navigator.vibrate) navigator.vibrate(80);
        void mutate(paths.overview); // dashboard shows the new state right away
      } catch (err) {
        setPhase({ kind: "error", error: (err instanceof ApiError && ERROR_CODES[err.code]) || "generic" });
      }
    },
    [action, mutate, stopCamera],
  );

  /** Decode a QR from an uploaded photo/screenshot, then submit it like a camera scan (marked as upload). */
  const readImage = useCallback(
    async (file: File | undefined) => {
      if (!file || handledRef.current) return;
      setPhase({ kind: "reading" });
      let text: string;
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const reader = new Html5Qrcode(UPLOAD_READER_ID, { verbose: false });
        try {
          text = await reader.scanFile(file, false);
        } finally {
          reader.clear();
        }
      } catch {
        setPhase({ kind: "error", error: "noQr" });
        return;
      }
      await handleCode(text, "upload");
    },
    [handleCode],
  );

  // Start the camera.
  useEffect(() => {
    let cancelled = false;
    handledRef.current = false;
    setPhase({ kind: "starting" });
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(READER_ID, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, aspectRatio: 1 },
          (decoded) => void handleCode(decoded),
          () => {},
        );
        if (cancelled) await stopCamera();
        else setPhase({ kind: "scanning" });
      } catch {
        if (!cancelled) setPhase({ kind: "camera-error" });
      }
    })();
    return () => {
      cancelled = true;
      void stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const errText: Record<ScanError, string> = {
    invalid: t.scan.errInvalid,
    expired: t.scan.errExpired,
    alreadyIn: t.scan.errAlreadyIn,
    notIn: t.scan.errNotIn,
    done: t.scan.errDone,
    location: t.scan.errLocation,
    noQr: t.scan.errNoQr,
    generic: t.errors.generic,
  };

  const showCamera = phase.kind === "starting" || phase.kind === "scanning" || phase.kind === "camera-error";

  return (
    <div className="mx-auto max-w-[560px]">
      <PageHeading eyebrow={t.scan.eyebrow} title={action === "in" ? t.scan.titleIn : t.scan.titleOut} sub={t.scan.sub} />

      <div className="card">
        {/* The reader div must stay mounted while the camera runs. */}
        <div className={showCamera ? "" : "hidden"}>
          <div className="scanner-frame">
            <div id={READER_ID} className="h-full w-full" />
            {phase.kind === "scanning" && (
              <div className="scanner-overlay">
                <div className="scanner-box">
                  <div className="scan-line" />
                </div>
              </div>
            )}
            {phase.kind === "starting" && (
              <div className="absolute inset-0 grid place-items-center text-[#cfe0d3]">
                <div className="text-center">
                  <Loader2 className="mx-auto animate-spin" size={30} />
                  <p className="mt-3 text-[13px] text-[#cfe0d3]">{t.scan.requesting}</p>
                </div>
              </div>
            )}
            {phase.kind === "camera-error" && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-[#e8efe9]">
                <div>
                  <Camera className="mx-auto mb-3 opacity-70" size={34} />
                  <p className="text-[13px] leading-relaxed text-[#e8efe9]">{t.scan.cameraError}</p>
                  <p className="mt-2 text-[11px] text-[#a4bdab]">{t.scan.cameraHttps}</p>
                  <button className="btn btn-sm mt-4" onClick={() => setAttempt((n) => n + 1)}>
                    {t.scan.retry}
                  </button>
                </div>
              </div>
            )}
          </div>
          {phase.kind === "scanning" && <p className="mt-4 text-center text-[13px] text-muted">{t.scan.scanning}</p>}

          {/* Alternative to the camera: upload a photo or screenshot of the QR. */}
          <div className="mt-5 flex items-center gap-3 text-[11px] uppercase tracking-[1px] text-muted-2">
            <span className="h-px flex-1 bg-line" />
            {t.scan.or}
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="mt-4 text-center">
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <ImageUp size={16} /> {t.scan.upload}
            </button>
            <p className="tiny mx-auto mt-2 max-w-[380px] leading-relaxed">{t.scan.uploadHint}</p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void readImage(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div id={UPLOAD_READER_ID} className="hidden" />

        {phase.kind === "reading" && (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto animate-spin text-brand" size={40} />
            <p className="mt-4 text-[14px] text-muted">{t.scan.reading}</p>
          </div>
        )}

        {phase.kind === "validating" && (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto animate-spin text-brand" size={40} />
            <p className="mt-4 text-[14px] text-muted">{t.scan.validating}</p>
          </div>
        )}

        {phase.kind === "success" && (
          <div className="py-8 text-center">
            <div className="result-icon ok">
              <CheckCircle2 size={44} strokeWidth={1.6} />
            </div>
            <h2 className="mt-6 font-display text-[22px] font-extrabold text-ink">
              {action === "in" ? t.scan.successIn : t.scan.successOut}
            </h2>
            <p className="mt-2 text-[14px] text-muted">{f(t.scan.successBody, { time: phase.time, location: phase.location })}</p>
            <Link href="/dashboard" className="btn btn-primary mt-7">
              {t.scan.toDashboard}
            </Link>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="py-8 text-center">
            <div className="result-icon bad">
              <XCircle size={44} strokeWidth={1.6} />
            </div>
            <h2 className="mt-6 font-display text-[22px] font-extrabold text-ink">{t.scan.failed}</h2>
            <p className="mx-auto mt-2 max-w-[380px] text-[14px] leading-relaxed text-muted">{errText[phase.error]}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-2">
              <button className="btn" onClick={() => router.push("/dashboard")}>
                {t.common.back}
              </button>
              {(phase.error === "invalid" || phase.error === "expired" || phase.error === "noQr") && (
                <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
                  {t.scan.retry}
                </button>
              )}
              {phase.error === "noQr" && (
                <button className="btn" onClick={() => fileRef.current?.click()}>
                  <ImageUp size={15} /> {t.scan.tryAnother}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showCamera && SHOW_SIMULATE && (
        <div className="demo-bar mt-4">
          <span className="flex-1">{t.scan.simulateHint}</span>
          <button
            className="btn btn-sm"
            onClick={async () => {
              // Asks the backend's dev-only endpoint for a real signed token, then scans it.
              try {
                const { token } = await devApi.qrToken();
                void handleCode(token);
              } catch {
                setPhase({ kind: "error", error: "generic" });
              }
            }}
          >
            {t.scan.simulate}
          </button>
        </div>
      )}
    </div>
  );
}
