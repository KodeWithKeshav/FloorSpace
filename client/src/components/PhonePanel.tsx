import { Loader2, QrCode, RefreshCw, Smartphone, TriangleAlert } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { FloorPlan, Layout } from "../../../shared/types";

interface Info {
  addresses: string[];
  port: number;
  serverUp: boolean;
}

/** Publishes the current layout for a phone and shows the link + QR code to open it. */
export default function PhonePanel({ plan, layout }: { plan: FloorPlan; layout: Layout }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addr, setAddr] = useState(0);

  const load = async () => setInfo(await (await fetch("/api/phone/info")).json());
  useEffect(() => {
    load().catch(() => setInfo(null));
  }, []);

  const url = code && info?.addresses[addr] ? `https://${info.addresses[addr]}:${info.port}/phone?code=${code}` : null;
  useEffect(() => {
    if (!url) return setQr(null);
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: "#1b2333", light: "#ffffff" } }).then(setQr).catch(() => setQr(null));
  }, [url]);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/phone/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, layout, code }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Could not start the phone session");
      setCode(((await res.json()) as { code: string }).code);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="fade-up rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand"><Smartphone size={17} /></span>
        <h3 className="text-[15px] font-semibold text-ink">Walk it with your phone</h3>
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed text-ink-2">
        Open this layout on a phone on the same Wi-Fi and physically walk through it: the phone tracks your movement and the office moves with you.
      </p>

      {!code ? (
        <button onClick={publish} disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[#2a3346] disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />} Connect a phone
        </button>
      ) : (
        <div className="mt-4">
          {info && !info.serverUp && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-snug text-warn">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>The phone server isn't running. Stop this app and start it with <code className="rounded bg-white/70 px-1 font-mono">npm run dev:phone</code>, then reload.</span>
            </div>
          )}
          {info && info.addresses.length === 0 && <p className="mb-3 text-[12.5px] text-danger">No network address found. Connect this computer to Wi-Fi.</p>}
          <div className="flex items-start gap-4">
            {qr && <img src={qr} alt="QR code to open the office on a phone" className="h-[132px] w-[132px] rounded-xl border border-line" />}
            <div className="min-w-0">
              <div className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Code</div>
              <div className="font-mono text-[26px] font-semibold tracking-[0.18em] text-ink">{code}</div>
              {info && info.addresses.length > 1 && (
                <select value={addr} onChange={(e) => setAddr(Number(e.target.value))} className="mt-1 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink">
                  {info.addresses.map((a, i) => <option key={a} value={i}>{a}</option>)}
                </select>
              )}
            </div>
          </div>
          {url && <p className="mt-3 break-all font-mono text-[11.5px] text-ink-2">{url}</p>}
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12.5px] leading-snug text-ink-2">
            <li>Scan the code with the phone camera (same Wi-Fi as this computer).</li>
            <li>The browser warns about the certificate: choose <strong>Advanced</strong> → <strong>Proceed</strong>. It's your own laptop.</li>
            <li>Tap <strong>Walk it in AR</strong> and allow the camera.</li>
          </ol>
          <button onClick={publish} disabled={busy} className="mt-3 flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition hover:border-[#cfcabd] hover:text-ink disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Send latest edits to the phone
          </button>
        </div>
      )}
      {error && <p className="mt-2.5 text-[12.5px] text-danger">{error}</p>}
    </section>
  );
}
