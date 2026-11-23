"use client";

import { Download, ExternalLink, MapPin, MonitorCheck, MonitorX, Pencil, Plus, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoadError, Modal, PageHeading, Skeleton } from "@/components/ui";
import { locationsApi, paths, useApi } from "@/lib/api";
import { fmtTime } from "@/lib/date";
import { useI18n } from "@/lib/i18n/provider";
import { downloadQrPng, fmtJakartaTime } from "@/lib/qr-png";
import { useStore } from "@/lib/store";
import type { Location } from "@/lib/types";

export default function AdminLocationsPage() {
  const { t } = useI18n();
  const { data, error, mutate } = useApi<{ locations: Location[] }>(paths.adminLocations);
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const [pairing, setPairing] = useState<Location | null>(null);
  const [downloading, setDownloading] = useState<Location | null>(null);

  return (
    <>
      <PageHeading
        eyebrow={t.admin.attendanceEyebrow}
        title={t.admin.locationsTitle}
        sub={t.admin.locationsSub}
        actions={
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus size={15} /> {t.admin.addLocation}
          </button>
        }
      />
      {!data ? (
        error ? <LoadError onRetry={() => mutate()} /> : <Skeleton />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.locations.map((l) => (
            <div key={l.id} className="card flex min-w-0 flex-col">
              <div className="flex items-start gap-3">
                <span className="stat-icon !h-10 !w-10 shrink-0">
                  <MapPin size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-[15px] font-bold text-ink">{l.name}</h3>
                  <p className="tiny">
                    {l.building} · <code>{l.id}</code>
                  </p>
                </div>
                <span className={`tag ${l.active ? "" : "tag-gray"}`}>{l.active ? t.status.ACTIVE : t.status.INACTIVE}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3 text-[12px]">
                <div>
                  <div className="tiny">{t.admin.scansToday}</div>
                  <b className="text-ink-2">{l.scansToday ?? 0}</b>
                </div>
                <div>
                  <div className="tiny">{t.admin.lastScan}</div>
                  <b className="text-ink-2">{l.lastScan ? fmtTime(l.lastScan) : "—"}</b>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className={`tiny flex items-center gap-1.5 ${l.kioskPaired ? "!text-ok" : ""}`}>
                  {l.kioskPaired ? <MonitorCheck size={13} /> : <MonitorX size={13} />}
                  {l.kioskPaired ? t.admin.paired : t.admin.notPaired}
                </span>
                <span className="tiny flex items-center gap-1.5">
                  <RefreshCw size={12} /> {t.admin.rotate}
                </span>
              </div>
              <div className="mt-auto flex flex-wrap justify-end gap-2 pt-4">
                <button className="btn btn-sm" onClick={() => setEditing(l)}>
                  <Pencil size={13} /> {t.common.edit}
                </button>
                <button className="btn btn-sm" disabled={!l.active} onClick={() => setDownloading(l)}>
                  <Download size={13} /> {t.admin.downloadQr}
                </button>
                <button className="btn btn-sm btn-primary" disabled={!l.active} onClick={() => setPairing(l)}>
                  <ExternalLink size={13} /> {t.admin.openKiosk}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <LocationForm loc={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => mutate()} />}
      {pairing && <PairKiosk loc={pairing} onClose={() => setPairing(null)} onPaired={() => mutate()} />}
      {downloading && <DownloadQr loc={downloading} onClose={() => setDownloading(null)} />}
    </>
  );
}

function PairKiosk({ loc, onClose, onPaired }: { loc: Location; onClose: () => void; onPaired: () => void }) {
  const { t } = useI18n();
  const { notify } = useStore();
  const [busy, setBusy] = useState(false);

  const pair = async () => {
    // Open the tab now (inside the click) so popup blockers allow it, then point it at the kiosk.
    const tab = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      const { key } = await locationsApi.pairKiosk(loc.id);
      // The key travels in the #fragment, which browsers never send to servers or logs.
      const url = `/kiosk/${encodeURIComponent(loc.id)}#key=${encodeURIComponent(key)}`;
      if (tab) tab.location.href = url;
      else window.location.href = url;
      onPaired();
      onClose();
    } catch {
      tab?.close();
      notify(t.errors.generic);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t.admin.pairTitle} — ${loc.name}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn btn-primary" onClick={() => void pair()} disabled={busy}>
            <ExternalLink size={14} /> {t.admin.pairConfirm}
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted">{t.admin.pairBody}</p>
    </Modal>
  );
}

function LocationForm({ loc, onClose, onSaved }: { loc: Location | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { notify } = useStore();
  const [l, setL] = useState({ name: loc?.name ?? "", building: loc?.building ?? "", active: loc?.active ?? true });
  const [busy, setBusy] = useState(false);
  const valid = l.name.trim().length >= 3;

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: l.name.trim(), building: l.building.trim(), active: l.active };
      if (loc) await locationsApi.update(loc.id, body);
      else await locationsApi.create(body);
      notify(t.admin.locationSaved);
      onSaved();
      onClose();
    } catch {
      notify(t.errors.generic);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={loc ? `${t.common.edit} — ${loc.name}` : t.admin.addLocation}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>
            {t.common.save}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <label className="field">
          {t.admin.locationName}
          <input className="input" value={l.name} onChange={(e) => setL({ ...l, name: e.target.value })} />
        </label>
        <label className="field">
          {t.admin.building}
          <input className="input" value={l.building} onChange={(e) => setL({ ...l, building: e.target.value })} />
        </label>
        <label className="field flex items-center gap-2">
          <input type="checkbox" checked={l.active} onChange={(e) => setL({ ...l, active: e.target.checked })} className="h-4 w-4 accent-brand" />
          {t.status.ACTIVE}
        </label>
      </div>
    </Modal>
  );
}

/**
 * Shows the location's current rotating QR with a live countdown and lets the admin save it as PNG.
 * The code expires like any kiosk code (~60 s), so this is for immediate use, not printing.
 */
function DownloadQr({ loc, onClose }: { loc: Location; onClose: () => void }) {
  const { t, f } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const [qr, setQr] = useState<{ token: string; validUntil: number } | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setError(false);
    setQr(null);
    try {
      const res = await locationsApi.currentQr(loc.id);
      setQr({ token: res.token, validUntil: new Date(res.validUntil).getTime() });
    } catch {
      setError(true);
    }
  }, [loc.id]);

  useEffect(() => {
    void load();
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [load]);

  const secondsLeft = qr ? Math.max(0, Math.ceil((qr.validUntil - now) / 1000)) : 0;
  const expired = !!qr && secondsLeft === 0;

  const download = () => {
    if (!svgRef.current || !qr) return;
    void downloadQrPng(svgRef.current, {
      locationId: loc.id,
      title: loc.name,
      subtitle: f(t.admin.validUntilPng, { time: fmtJakartaTime(new Date(qr.validUntil)) }),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t.admin.downloadTitle} — ${loc.name}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.close}
          </button>
          {expired ? (
            <button className="btn btn-primary" onClick={() => void load()}>
              <RefreshCw size={14} /> {t.admin.newCode}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!qr} onClick={download}>
              <Download size={14} /> {t.admin.downloadPng}
            </button>
          )}
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted">{t.admin.downloadBody}</p>
      <div className="mt-4 flex flex-col items-center">
        <div className={`rounded-xl border border-line bg-white p-3 transition-opacity ${expired ? "opacity-30" : ""}`}>
          {qr ? (
            <QRCodeSVG ref={svgRef} value={qr.token} size={240} level="M" fgColor="#0e3028" marginSize={2} />
          ) : (
            <div className="grid h-[240px] w-[240px] place-items-center text-[12px] text-muted">{error ? t.errors.generic : "…"}</div>
          )}
        </div>
        {qr &&
          (expired ? (
            <div className="notice notice-bad mt-3 text-center">{t.admin.expiredQr}</div>
          ) : (
            <p className={`mt-3 text-[13px] font-semibold ${secondsLeft <= 15 ? "text-danger" : "text-ink-2"}`}>
              {f(t.admin.validFor, { seconds: secondsLeft, time: fmtJakartaTime(new Date(qr.validUntil)) })}
            </p>
          ))}
        {error && (
          <button className="btn btn-sm mt-3" onClick={() => void load()}>
            {t.errors.retry}
          </button>
        )}
      </div>
    </Modal>
  );
}
