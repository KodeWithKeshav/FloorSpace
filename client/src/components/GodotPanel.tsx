import { Download, ExternalLink, Glasses, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { FloorPlan, Layout } from "../../../shared/types";
import { downloadGodotProject, getGodotStatus, openInGodot } from "../lib/api";

export default function GodotPanel({ plan, layout }: { plan: FloorPlan; layout: Layout }) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"open" | "zip" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getGodotStatus().then((s) => setInstalled(s.installed)).catch(() => setInstalled(false));
  }, []);

  const open = async () => {
    setBusy("open");
    setMsg(null);
    try {
      const r = await openInGodot(plan, layout);
      setMsg({ ok: true, text: `Opened in Godot: ${r.items} furniture pieces, ${r.models} models. Press F5 there to walk it in first person.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const zip = async () => {
    setBusy("zip");
    setMsg(null);
    try {
      await downloadGodotProject(plan, layout);
      setMsg({ ok: true, text: "Godot project downloaded. Unzip it, then import project.godot in Godot 4.3+." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="fade-up rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand"><Glasses size={17} /></span>
        <h3 className="text-[15px] font-semibold text-ink">Explore it in Godot</h3>
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed text-ink-2">
        Builds a complete Godot 4 project of this exact layout: walls, windows, furniture, and a first-person player (a VR rig is included but off by default).
      </p>
      <div className="mt-4 grid gap-2.5">
        <button
          onClick={open}
          disabled={busy !== null || installed === false}
          className="flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[#2a3346] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy === "open" ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
          {busy === "open" ? "Importing models…" : "Open in Godot on this computer"}
        </button>
        <button onClick={zip} disabled={busy !== null} className="flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[14px] font-medium text-ink transition hover:border-[#cfcabd] disabled:opacity-50">
          {busy === "zip" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download project (.zip)
        </button>
      </div>
      {installed === false && <p className="mt-2.5 text-[12.5px] text-warn">Godot was not found on this computer. Download the project and open it wherever Godot is installed, or set GODOT_PATH in .env.</p>}
      {msg && <p className={"mt-2.5 text-[12.5px] leading-snug " + (msg.ok ? "text-brand-600" : "text-danger")}>{msg.text}</p>}
    </section>
  );
}
