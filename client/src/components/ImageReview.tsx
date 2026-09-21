import { Check, CircleAlert, DoorOpen, Info, Loader2, RefreshCw, Square, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { PlanExtraction, PlanImportResult } from "../../../shared/types";
import { rebuildPlan } from "../lib/api";
import { coercePlan } from "../lib/plan";
import type { PreparedImage } from "../lib/planImage";
import PlanPreview from "./PlanPreview";

interface Props {
  image: PreparedImage;
  initial: PlanImportResult;
  ceilingHeightM?: number;
  onCancel: () => void;
  onUse: (planJson: string, name: string) => void;
}

/** Full-screen check: what the AI saw drawn on your image, the rebuilt plan, and every wall's length to correct. */
export default function ImageReview({ image, initial, ceilingHeightM, onCancel, onUse }: Props) {
  const [res, setRes] = useState(initial);
  const [dims, setDims] = useState<Record<number, string>>({});
  const [longest, setLongest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAi, setShowAi] = useState(true);

  const ex = res.extraction;
  const draw = useMemo(() => (res.plan ? coercePlan(res.plan) : null), [res.plan]);
  const errors = res.validation?.issues.filter((i) => i.severity === "error") ?? [];
  const canUse = res.ok && !res.needsScale;

  const recompute = async () => {
    setBusy(true);
    setError(null);
    try {
      // Keep the AI's readings, but let the user's numbers replace the printed ones for the walls they touched.
      const changed = Object.entries(dims).filter(([, v]) => parseFloat(v) > 0);
      const kept = ex.edgeDimensions.filter((d) => !changed.some(([e]) => Number(e) === d.edge));
      const merged = [...kept, ...changed.map(([e, v]) => ({ edge: Number(e), text: `${v} (edited)`, meters: parseFloat(v) }))];
      const lw = parseFloat(longest);
      setRes(await rebuildPlan({ extraction: { ...ex, edgeDimensions: merged }, width: image.width, height: image.height, ceilingHeightM, longestWallMeters: lw > 0 ? lw : undefined }));
      setDims({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Change the AI's openings (door <-> window, which door is the entry, delete) and rebuild straight away.
  const editOpenings = async (next: PlanExtraction["openings"]) => {
    setBusy(true);
    setError(null);
    try {
      setRes(await rebuildPlan({ extraction: { ...ex, openings: next }, width: image.width, height: image.height, ceilingHeightM }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Metres per image pixel, from the first rebuilt wall, to show each opening's rough width.
  const mpp = useMemo(() => {
    const e0 = res.edges[0];
    if (!e0 || ex.vertices.length < 2) return 0;
    const a = ex.vertices[0], b = ex.vertices[1 % ex.vertices.length];
    const px = Math.hypot((b[0] - a[0]) * image.width, (b[1] - a[1]) * image.height);
    return px > 0 ? e0.builtMeters / px : 0;
  }, [res.edges, ex.vertices, image.width, image.height]);
  const wallOf = (x: number, y: number) => {
    let best = 0, bd = Infinity;
    ex.vertices.forEach((p, i) => {
      const q = ex.vertices[(i + 1) % ex.vertices.length];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(x - (p[0] + t * dx), y - (p[1] + t * dy));
      if (d < bd) (bd = d, best = i);
    });
    return best + 1;
  };

  const vx = (i: number) => ex.vertices[((i % ex.vertices.length) + ex.vertices.length) % ex.vertices.length];

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center bg-ink/55 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label="Check the plan">
      <div className="flex w-full max-w-[1400px] flex-col overflow-hidden rounded-3xl bg-canvas shadow-pop">
        <div className="flex items-center justify-between border-b border-line bg-surface px-6 py-4">
          <div>
            <h2 className="text-[18px] font-semibold text-ink">Check what the AI read</h2>
            <p className="text-[13px] text-ink-2">Compare the outline on your drawing with the rebuilt plan. Fix any wall length that is wrong, then use it.</p>
          </div>
          <button onClick={onCancel} aria-label="Close" className="rounded-lg p-2 text-muted hover:bg-canvas"><X size={18} /></button>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* Your drawing with the detection on top */}
          <section className="min-w-0">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-muted">Your drawing</h3>
              <label className="flex items-center gap-2 text-[12.5px] text-ink-2"><input type="checkbox" checked={showAi} onChange={(e) => setShowAi(e.target.checked)} className="accent-[#0f6b5c]" /> Show what the AI found</label>
            </div>
            <div className="overflow-auto rounded-2xl border border-line bg-white">
              <div className="relative mx-auto" style={{ aspectRatio: `${image.width} / ${image.height}`, maxHeight: "68vh" }}>
                <img src={image.dataUrl} alt="Uploaded plan" className="absolute inset-0 h-full w-full" />
                {showAi && (
                  <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                    {ex.obstacles.map((o, i) => (
                      <polygon key={`o${i}`} points={o.polygon.map((p) => p.join(",")).join(" ")} fill={o.type === "column" ? "#1b2333" : "#f59e0b"} fillOpacity={0.35} stroke="#b45309" strokeWidth={0.0025} vectorEffect="non-scaling-stroke" />
                    ))}
                    <polygon points={ex.vertices.map((p) => p.join(",")).join(" ")} fill="#0f6b5c" fillOpacity={0.07} stroke="#0f6b5c" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                    {ex.openings.map((o, i) => (
                      <line key={`p${i}`} x1={o.x0} y1={o.y0} x2={o.x1} y2={o.y1} stroke={o.type === "door" ? (o.isEntry ? "#16a34a" : "#84cc16") : "#2563eb"} strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    ))}
                    {ex.vertices.map((p, i) => (
                      <g key={`v${i}`}>
                        <circle cx={p[0]} cy={p[1]} r={0.006} fill="#0f6b5c" />
                      </g>
                    ))}
                  </svg>
                )}
                {showAi &&
                  ex.vertices.map((p, i) => {
                    const q = vx(i + 1);
                    return (
                      <span key={`l${i}`} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-bold leading-none text-white shadow" style={{ left: `${((p[0] + q[0]) / 2) * 100}%`, top: `${((p[1] + q[1]) / 2) * 100}%` }}>
                        {i + 1}
                      </span>
                    );
                  })}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
              <Key color="#0f6b5c" label="Outline (numbers = walls)" /><Key color="#16a34a" label="Entry door" /><Key color="#84cc16" label="Door" /><Key color="#2563eb" label="Window" /><Key color="#f59e0b" label="Core / column" />
            </div>
          </section>

          {/* Rebuilt plan and corrections */}
          <section className="min-w-0 space-y-4">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-muted">Rebuilt plan</h3>
                {res.provider && <span className="text-[11.5px] text-muted">{res.provider} · {res.model} · {((res.latencyMs ?? 0) / 1000).toFixed(0)}s</span>}
              </div>
              <div className="mt-2 h-[300px] rounded-xl bg-canvas p-2">
                {draw ? <PlanPreview plan={draw} options={{ dimensions: true, grid: false, labels: true }} /> : <p className="p-6 text-[13.5px] text-ink-2">No outline could be built yet.</p>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip ok={canUse} text={canUse ? "Ready to use" : res.needsScale ? "Needs a scale" : "Needs a fix"} />
                {res.plan && <span className="text-[12.5px] text-ink-2">{ex.units !== "unknown" ? `Drawing units: ${ex.units}. ` : ""}{res.plan.obstacles.length} obstacles · {res.plan.openings.length} openings</span>}
              </div>
            </div>

            {res.needsScale && (
              <div className="rounded-2xl border border-warn/30 bg-warn-soft p-4">
                <div className="text-[13.5px] font-semibold text-warn">No dimensions could be read</div>
                <p className="mt-1 text-[12.5px] text-ink-2">Tell us how long the longest outer wall really is and the rest is sized from the drawing.</p>
                <div className="mt-2 flex items-center gap-2">
                  <input value={longest} onChange={(e) => setLongest(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 18" className="w-28 rounded-lg border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:border-brand" /> <span className="text-[13px] text-ink-2">metres</span>
                </div>
              </div>
            )}

            {(res.notes.length > 0 || errors.length > 0) && (
              <div className="space-y-1.5 rounded-2xl border border-line bg-surface p-4">
                {errors.map((e, i) => (
                  <p key={`e${i}`} className="flex items-start gap-2 text-[12.5px] leading-snug text-danger"><CircleAlert size={14} className="mt-0.5 shrink-0" /><span><code className="mr-1 rounded bg-danger-soft px-1 font-mono text-[11.5px]">{e.path}</code>{e.message}</span></p>
                ))}
                {res.notes.map((n, i) => (
                  <p key={`n${i}`} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-2"><Info size={14} className="mt-0.5 shrink-0 text-info" />{n}</p>
                ))}
              </div>
            )}

            <div className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-muted">Doors & windows</h3>
              <p className="mt-1 text-[12.5px] text-ink-2">Check these against your drawing. Change a type, pick the entrance, or remove one that isn't real.</p>
              {ex.openings.length === 0 ? (
                <p className="mt-2 text-[12.5px] text-muted">None were found.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {ex.openings.map((o, i) => {
                    const len = Math.hypot((o.x1 - o.x0) * image.width, (o.y1 - o.y0) * image.height) * mpp;
                    const set = (patch: Partial<typeof o>) => editOpenings(ex.openings.map((q, k) => (k === i ? { ...q, ...patch } : patch.isEntry ? { ...q, isEntry: false } : q)));
                    return (
                      <li key={i} className="flex items-center gap-2 rounded-lg border border-line-2 bg-paper px-2.5 py-1.5 text-[12.5px]">
                        <span className={"inline-flex h-2.5 w-2.5 rounded-full " + (o.type === "door" ? (o.isEntry ? "bg-[#16a34a]" : "bg-[#84cc16]") : "bg-[#2563eb]")} />
                        <span className="w-16 font-medium text-ink">{o.type === "door" ? (o.isEntry ? "Entrance" : "Door") : "Window"}</span>
                        <span className="text-ink-2">wall {wallOf((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2)}{len > 0 ? ` · ${len.toFixed(1)} m` : ""}</span>
                        <span className="ml-auto flex items-center gap-1">
                          <button disabled={busy} onClick={() => set({ type: o.type === "door" ? "window" : "door", isEntry: false })} title={o.type === "door" ? "Make it a window" : "Make it a door"} className="rounded-md p-1.5 text-ink-2 hover:bg-canvas">{o.type === "door" ? <Square size={14} /> : <DoorOpen size={14} />}</button>
                          {o.type === "door" && !o.isEntry && <button disabled={busy} onClick={() => set({ isEntry: true })} className="rounded-md px-1.5 py-1 text-[11.5px] font-semibold text-brand-600 hover:bg-brand-soft">Make entrance</button>}
                          <button disabled={busy} onClick={() => editOpenings(ex.openings.filter((_, k) => k !== i))} title="Remove" className="rounded-md p-1.5 text-danger hover:bg-danger-soft"><Trash2 size={14} /></button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-muted">Wall lengths</h3>
              <p className="mt-1 text-[12.5px] text-ink-2">Numbers on the drawing are used exactly. Change one if it was misread, then recompute.</p>
              <table className="mt-2 w-full text-[13px]">
                <thead><tr className="text-left text-[11.5px] uppercase tracking-[0.06em] text-muted"><th className="pb-1.5 font-medium">Wall</th><th className="pb-1.5 font-medium">On the drawing</th><th className="pb-1.5 text-right font-medium">Length (m)</th></tr></thead>
                <tbody>
                  {res.edges.map((e) => (
                    <tr key={e.index} className="border-t border-line-2">
                      <td className="py-1.5"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">{e.index + 1}</span></td>
                      <td className="py-1.5 text-ink-2">
                        {e.printed ?? <span className="text-muted">not printed, estimated</span>}
                        {e.mismatch && <span className="ml-2 rounded bg-danger-soft px-1.5 py-0.5 text-[11px] font-semibold text-danger">doesn't fit</span>}
                      </td>
                      <td className="py-1.5 text-right">
                        <input
                          value={dims[e.index] ?? String(e.builtMeters)}
                          onChange={(ev) => setDims((d) => ({ ...d, [e.index]: ev.target.value.replace(/[^0-9.]/g, "") }))}
                          className={"w-20 rounded-lg border bg-paper px-2 py-1 text-right tabular-nums outline-none focus:border-brand " + (dims[e.index] !== undefined ? "border-brand" : "border-line")}
                          aria-label={`Length of wall ${e.index + 1}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={recompute} disabled={busy || (Object.keys(dims).length === 0 && !longest)} className="mt-3 flex items-center gap-2 rounded-xl border border-line px-3.5 py-2 text-[13px] font-medium text-ink transition hover:border-[#cfcabd] disabled:opacity-40">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Recompute
              </button>
              {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line bg-surface px-6 py-4">
          <button onClick={onCancel} className="rounded-xl border border-line px-4 py-2.5 text-[14px] font-medium text-ink-2 transition hover:text-ink">Cancel</button>
          <button
            disabled={!canUse || !res.plan}
            onClick={() => res.plan && onUse(JSON.stringify(res.plan), res.plan.name)}
            className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check size={16} /> Use this plan
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const Key = ({ color, label }: { color: string; label: string }) => (
  <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm" style={{ background: color }} />{label}</span>
);

function Chip({ ok, text }: { ok: boolean; text: string }) {
  return <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold " + (ok ? "bg-brand-soft text-brand-600" : "bg-warn-soft text-warn")}>{ok ? <Check size={13} /> : <CircleAlert size={13} />}{text}</span>;
}
