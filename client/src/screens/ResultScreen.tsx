import { ArrowLeft, Box, Download, Grid3x3, Layers, Ruler, Tag, TriangleAlert, Info } from "lucide-react";
import { useMemo, useState } from "react";
import type { Catalog, FloorPlan, Layout, ZoneType } from "../../../shared/types";
import { coercePlan } from "../lib/plan";
import { ZONE_META } from "../lib/requirements";
import LayoutPlan, { ZONE_FILL } from "../components/LayoutPlan";
import SpaceUsage from "../components/SpaceUsage";
import GodotPanel from "../components/GodotPanel";
import type { PreviewOptions } from "../components/PlanPreview";

interface Props {
  plan: FloorPlan;
  layout: Layout;
  catalog: Catalog;
  projectName?: string;
  onBack: () => void;
  onWalk: () => void;
}

export default function ResultScreen({ plan, layout, catalog, projectName, onBack, onWalk }: Props) {
  const [options, setOptions] = useState<PreviewOptions>({ dimensions: false, grid: false, labels: true });
  const [furniture, setFurniture] = useState(true);
  const [highlight, setHighlight] = useState<ZoneType | null>(null);
  const draw = useMemo(() => coercePlan(plan), [plan]);
  const m = layout.metrics;
  if (!draw) return null;

  const types = [...new Set(layout.zones.map((z) => z.type))] as ZoneType[];
  const short = m.seatsRequested > 0 && m.seatsProvided < m.seatsRequested;

  return (
    <div>
      <main className="mx-auto grid max-w-[1480px] gap-8 px-6 pb-28 pt-8 lg:grid-cols-[minmax(0,1fr)_404px]">
        <div className="min-w-0 space-y-5">
          <section className="fade-up overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-4 px-6 pb-4 pt-5">
              <div>
                <h1 className="text-[22px] font-semibold tracking-tight text-ink">{projectName || plan.name}</h1>
                <p className="mt-1 text-[13.5px] text-ink-2">
                  {plan.name} · <span className="tabular-nums">{m.seatsProvided}</span> desk seats · {layout.zones.filter((z) => z.enclosed).length} enclosed {layout.zones.filter((z) => z.enclosed).length === 1 ? "room" : "rooms"}
                  {layout.edited && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[11.5px] font-semibold text-brand-600" title="Furniture was moved, resized or added in the 3D editor. Room outlines and areas are as generated.">Edited in 3D</span>}
                  <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 text-[11.5px] font-medium text-ink-2" title="Layouts are produced by the built-in rule-based engine, so they work offline">
                    {layout.mode === "rule-based" ? "Rule-based engine · offline" : layout.mode}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Toggle on={furniture} onClick={() => setFurniture((v) => !v)} icon={<Layers size={14} />} label="Furniture" />
                <Toggle on={options.labels} onClick={() => setOptions((o) => ({ ...o, labels: !o.labels }))} icon={<Tag size={14} />} label="Labels" />
                <Toggle on={options.dimensions} onClick={() => setOptions((o) => ({ ...o, dimensions: !o.dimensions }))} icon={<Ruler size={14} />} label="Dimensions" />
                <Toggle on={options.grid} onClick={() => setOptions((o) => ({ ...o, grid: !o.grid }))} icon={<Grid3x3 size={14} />} label="Grid" />
              </div>
            </div>
            <div className="mx-3 mb-3 h-[min(68vh,700px)] min-h-[420px] rounded-xl bg-canvas p-3">
              <LayoutPlan plan={draw} layout={layout} catalog={catalog} options={options} showFurniture={furniture} highlightType={highlight} />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line-2 px-5 py-3">
              {types.map((t) => (
                <button
                  key={t}
                  onMouseEnter={() => setHighlight(t)}
                  onMouseLeave={() => setHighlight(null)}
                  onFocus={() => setHighlight(t)}
                  onBlur={() => setHighlight(null)}
                  className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12.5px] font-medium text-ink-2 transition hover:border-[#cfcabd]"
                >
                  <span className="h-3 w-3 rounded-[3px] border border-black/10" style={{ background: ZONE_FILL[t] }} />
                  {ZONE_META[t].label}
                </button>
              ))}
            </div>
          </section>

          {(layout.report.warnings.length > 0 || short) && (
            <section className="fade-up rounded-2xl border border-warn/25 bg-warn-soft p-5">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-warn"><TriangleAlert size={17} /> Worth knowing</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[13.5px] text-ink-2">
                {layout.report.warnings.map((w, i) => <li key={i}>{w}</li>)}
                {layout.report.suggestions.map((w, i) => <li key={`s${i}`}>{w}</li>)}
              </ul>
            </section>
          )}

          <section className="fade-up rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Info size={16} className="text-brand" /> How this layout works</div>
            <p className="mt-2 max-w-[80ch] text-[14px] leading-relaxed text-ink-2">{layout.report.explanation}</p>
          </section>
        </div>

        <aside className="space-y-5">
          <button onClick={onWalk} className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-brand px-5 py-4 text-[15px] font-semibold text-white shadow-card transition hover:bg-brand-600">
            <Box size={19} /> Walk through it in 3D
          </button>

          <SpaceUsage m={m} />

          <section className="fade-up rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h3 className="text-[15px] font-semibold text-ink">Key numbers</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <Big label="Desk seats" value={`${m.seatsProvided}`} sub={m.seatsRequested ? `of ${m.seatsRequested} asked` : undefined} bad={short} />
              <Big label="Floor per seat" value={m.areaPerSeat ? `${m.areaPerSeat.toFixed(1)} m²` : "n/a"} sub="usable ÷ desk seats" />
              <Big label="Occupied" value={`${Math.round(m.utilization * 100)}%`} sub="of the floor" />
              <Big label="Circulation" value={`${Math.round(m.circulationRatio * 100)}%`} sub="corridors & aisles" />
            </dl>
          </section>

          <section className="fade-up rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h3 className="text-[15px] font-semibold text-ink">By zone</h3>
            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-[0.06em] text-muted">
                  <th className="pb-2 font-medium">Zone</th><th className="pb-2 text-right font-medium">Count</th><th className="pb-2 text-right font-medium">Area</th><th className="pb-2 text-right font-medium">Seats</th>
                </tr>
              </thead>
              <tbody>
                {m.zoneBreakdown.map((r) => (
                  <tr key={r.type} className="border-t border-line-2">
                    <td className="py-2 text-ink"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: ZONE_FILL[r.type] }} />{r.label}</td>
                    <td className="py-2 text-right tabular-nums text-ink-2">{r.count}</td>
                    <td className="py-2 text-right tabular-nums text-ink">{r.areaSqM.toFixed(1)} m²</td>
                    <td className="py-2 text-right tabular-nums text-ink-2">{r.seats || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <GodotPanel plan={plan} layout={layout} />

          <button
            onClick={() => download(layout, `${plan.id}-layout.json`)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[14px] font-medium text-ink-2 transition hover:border-[#cfcabd] hover:text-ink"
          >
            <Download size={16} /> Download layout JSON
          </button>
        </aside>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1480px] items-center justify-between px-6">
          <button onClick={onBack} className="flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[14px] font-medium text-ink-2 transition hover:border-[#cfcabd] hover:text-ink">
            <ArrowLeft size={16} /> Change the brief
          </button>
          <button onClick={onWalk} className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-brand-600">
            <Box size={16} /> Walk through it
          </button>
        </div>
      </footer>
    </div>
  );
}

function Toggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={"flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition " + (on ? "border-brand/30 bg-brand-soft text-brand-600" : "border-line text-muted hover:text-ink-2")}>
      {icon}
      {label}
    </button>
  );
}

function Big({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-canvas px-4 py-3">
      <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{label}</dt>
      <dd className={"mt-1 text-[22px] font-semibold leading-none tabular-nums " + (bad ? "text-danger" : "text-ink")}>{value}</dd>
      {sub && <div className="mt-1 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

function download(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
