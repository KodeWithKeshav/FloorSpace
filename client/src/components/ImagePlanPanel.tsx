import { ImageUp, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PlanImportResult } from "../../../shared/types";
import { readPlanImage } from "../lib/api";
import { prepareFromUrl, prepareImage } from "../lib/planImage";
import type { PreparedImage } from "../lib/planImage";
import ImageReview from "./ImageReview";

const SAMPLES = [
  { file: "/blueprints/small-office.png", name: "Small office", label: "Small office" },
  { file: "/blueprints/l-shaped-floor.png", name: "L-shaped floor", label: "L-shaped floor" },
];

/** "From a plan image": upload a drawing, let AI read it, review it over the original, use it. */
export default function ImagePlanPanel({ onUse }: { onUse: (planJson: string, name: string) => void }) {
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [ceiling, setCeiling] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanImportResult | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { providers: Record<string, boolean> }) => setAiReady(Object.values(h.providers).some(Boolean)))
      .catch(() => setAiReady(false));
  }, []);

  const load = async (make: () => Promise<PreparedImage>) => {
    setError(null);
    setResult(null);
    setBusy("Preparing the image…");
    try {
      setImg(await make());
    } catch (e) {
      setError(`Could not open that file: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const read = async () => {
    if (!img) return;
    setError(null);
    setBusy("Reading the plan… this takes 10 to 40 seconds");
    try {
      const c = parseFloat(ceiling);
      const r = await readPlanImage({ image: img.dataUrl, width: img.width, height: img.height, ceilingHeightM: c > 0 ? c : undefined });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line-2 px-4 py-3">
        <Sparkles size={15} className="text-brand" />
        <span className="text-[13.5px] font-semibold text-ink">From a plan image</span>
        <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-600">AI</span>
      </div>
      <div className="p-3">
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">Upload a floor plan or blueprint with dimensions (PNG, JPG or PDF). AI reads it; you check it against your drawing before it is used.</p>

        {aiReady === false && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-snug text-warn">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <span>AI isn't set up. Add <code className="rounded bg-white/70 px-1 font-mono">GEMINI_API_KEY</code> (or OpenRouter / Groq) to <code className="rounded bg-white/70 px-1 font-mono">.env</code> and restart.</span>
          </div>
        )}

        <button onClick={() => input.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-3 py-5 text-[13px] font-medium text-ink-2 transition hover:border-[#cfcabd] hover:bg-paper">
          <ImageUp size={17} /> {img ? `${img.name} (${img.width}×${img.height})` : "Choose a plan image or PDF"}
        </button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => (e.target.files?.[0] && load(() => prepareImage(e.target.files![0])), (e.target.value = ""))} />

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          Or try a sample:
          {SAMPLES.map((s) => (
            <button key={s.file} onClick={() => load(() => prepareFromUrl(s.file, s.name))} className="font-medium text-brand hover:underline">{s.label}</button>
          ))}
        </div>

        {img && (
          <div className="mt-3 flex items-end gap-2">
            <label className="flex-1 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">
              Ceiling height (m, optional)
              <input value={ceiling} onChange={(e) => setCeiling(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="3.0" className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-[13.5px] normal-case tracking-normal text-ink outline-none focus:border-brand" />
            </label>
            <button onClick={read} disabled={busy !== null || aiReady === false} className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-white transition hover:bg-[#2a3346] disabled:opacity-45">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Read the plan
            </button>
          </div>
        )}
        {busy && <p className="mt-2 text-[12.5px] text-ink-2">{busy}</p>}
        {error && <p className="mt-2 text-[12.5px] leading-snug text-danger">{error}</p>}
      </div>

      {result && img && (
        <ImageReview
          image={img}
          initial={result}
          ceilingHeightM={parseFloat(ceiling) > 0 ? parseFloat(ceiling) : undefined}
          onCancel={() => setResult(null)}
          onUse={(json, name) => {
            setResult(null);
            onUse(json, name);
          }}
        />
      )}
    </div>
  );
}
