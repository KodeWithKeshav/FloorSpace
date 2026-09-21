import { ArrowRight, Download, Grid3x3, Ruler, Tag } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FloorPlan, SampleDetail, SampleSummary, ValidationResult } from "../../../shared/types";
import { area, dist } from "../../../shared/geometry";
import { getSample, getSamples, validatePlan } from "../lib/api";
import { coercePlan, issueTarget } from "../lib/plan";
import type { DrawPlan } from "../lib/plan";
import PlanPreview from "../components/PlanPreview";
import type { HoverTarget, PreviewOptions } from "../components/PlanPreview";
import PlanDetails from "../components/PlanDetails";
import SampleGallery from "../components/SampleGallery";
import UploadPanel from "../components/UploadPanel";
import ImagePlanPanel from "../components/ImagePlanPanel";
import ValidationPanel from "../components/ValidationPanel";

type Source = { kind: "sample"; id: string } | { kind: "custom"; name: string };
type ParseError = { message: string; line?: number; col?: number };

interface Props {
  visible: boolean;
  onPlan: (plan: FloorPlan | null, sampleId: string | null) => void;
  onContinue: () => void;
}

export default function PlanScreen({ visible, onPlan, onContinue }: Props) {
  const [samples, setSamples] = useState<SampleSummary[]>([]);
  const [details, setDetails] = useState<Record<string, SampleDetail>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const [source, setSource] = useState<Source | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [parseError, setParseError] = useState<ParseError | null>(null);
  const [busy, setBusy] = useState(false);

  const [options, setOptions] = useState<PreviewOptions>({ dimensions: true, grid: true, labels: true });
  const [hovered, setHovered] = useState<HoverTarget>(null);

  // Load the sample gallery and every sample's geometry (for thumbnails), then open the first one.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await getSamples();
        if (!alive) return;
        setSamples(list);
        const entries = await Promise.all(list.map(async (s) => [s.id, await getSample(s.id)] as const));
        if (!alive) return;
        const map = Object.fromEntries(entries);
        setDetails(map);
        const wanted = /sample=([\w-]+)/.exec(window.location.hash)?.[1];
        const first = list.find((s) => s.id === wanted) ?? list[0];
        if (first) {
          setSource({ kind: "sample", id: first.id });
          setRaw(map[first.id].raw);
          setResult(map[first.id].validation);
        }
      } catch (e) {
        if (alive) setLoadError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const thumbs = useMemo(() => Object.fromEntries(Object.entries(details).map(([id, d]) => [id, coercePlan(d.raw)])) as Record<string, DrawPlan | null>, [details]);

  const selectSample = useCallback(
    (id: string) => {
      const d = details[id];
      if (!d) return;
      setSource({ kind: "sample", id });
      setRaw(d.raw);
      setResult(d.validation);
      setParseError(null);
      setHovered(null);
      window.history.replaceState(null, "", `#sample=${id}`);
    },
    [details],
  );

  const handleText = useCallback(async (text: string, name: string) => {
    setBusy(true);
    setHovered(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setSource({ kind: "custom", name });
      setRaw(null);
      setResult(null);
      setParseError(explainJsonError(e as Error, text));
      setBusy(false);
      return;
    }
    try {
      const res = await validatePlan(parsed);
      setSource({ kind: "custom", name });
      setRaw(parsed);
      setResult(res);
      setParseError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const draw = useMemo(() => (result?.plan ? coercePlan(result.plan) : coercePlan(raw)), [raw, result]);
  const flagged = useMemo(() => {
    const s = new Set<string>();
    result?.issues.filter((i) => i.severity === "error").forEach((i) => {
      const t = issueTarget(i.path);
      if (t) s.add(t);
    });
    return s;
  }, [result]);

  const hoverFromKey = (key: string | null) => {
    if (!key) return setHovered(null);
    const [k, i] = key.split(":");
    setHovered({ kind: k === "openings" ? "opening" : "obstacle", index: Number(i) });
  };

  const sampleId = source?.kind === "sample" ? source.id : null;
  useEffect(() => {
    onPlan(result?.valid ? result.plan : null, sampleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, sampleId]);

  const title = draw?.name ?? (source?.kind === "custom" ? source.name : "Floor plan");
  const description = source?.kind === "sample" ? samples.find((s) => s.id === source.id)?.description : undefined;

  return (
    <div className={visible ? "" : "hidden"}>
      <main className="mx-auto grid max-w-[1480px] gap-8 px-6 pb-28 pt-8 lg:grid-cols-[372px_minmax(0,1fr)]">
        {/* ── Left: choose a plan ───────────────────────── */}
        <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7.5rem)] lg:overflow-y-auto lg:pr-1">
          <div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">Start with a floor plan</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">Pick a sample or bring your own bare-shell plan. We'll check the geometry before you go any further.</p>
          </div>

          <div>
            <SectionLabel>Sample floors</SectionLabel>
            {samples.length === 0 && !loadError && <SkeletonList />}
            <SampleGallery samples={samples} thumbs={thumbs} selectedId={source?.kind === "sample" ? source.id : null} onSelect={selectSample} />
          </div>

          <div>
            <SectionLabel>Your own plan</SectionLabel>
            <UploadPanel onText={handleText} active={source?.kind === "custom"} busy={busy} />
            <div className="mt-3"><ImagePlanPanel onUse={handleText} /></div>
          </div>
        </aside>

        {/* ── Right: preview + validation ───────────────── */}
        <div className="min-w-0 space-y-6">
          {loadError && (
            <div role="alert" className="rounded-2xl border border-danger/25 bg-danger-soft px-5 py-4 text-[14px] text-danger">
              {loadError}
            </div>
          )}

          <section className="fade-up overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-4 px-6 pb-4 pt-5">
              <div className="min-w-0">
                <h2 className="truncate text-[19px] font-semibold tracking-tight text-ink">{title}</h2>
                {description && <p className="mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-2">{description}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Toggle on={options.dimensions} onClick={() => setOptions((o) => ({ ...o, dimensions: !o.dimensions }))} icon={<Ruler size={14} />} label="Dimensions" />
                <Toggle on={options.grid} onClick={() => setOptions((o) => ({ ...o, grid: !o.grid }))} icon={<Grid3x3 size={14} />} label="Grid" />
                <Toggle on={options.labels} onClick={() => setOptions((o) => ({ ...o, labels: !o.labels }))} icon={<Tag size={14} />} label="Labels" />
                {raw != null && (
                  <button onClick={() => downloadJson(raw, `${(draw?.name ?? "floor-plan").toLowerCase().replace(/\W+/g, "-")}.json`)} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-ink-2 transition hover:border-[#cfcabd] hover:text-ink">
                    <Download size={14} /> JSON
                  </button>
                )}
              </div>
            </div>

            <div className="relative mx-3 mb-3 h-[min(62vh,640px)] min-h-[380px] rounded-xl bg-canvas p-4">
              {draw ? (
                <PlanPreview plan={draw} options={options} flagged={flagged} hovered={hovered} onHover={setHovered} />
              ) : (
                <EmptyPreview parseError={!!parseError} />
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line-2 px-6 py-3">
              <HoverCaption plan={draw} hovered={hovered} />
              <Legend />
            </div>
          </section>

          <ValidationPanel result={result} parseError={parseError} onHoverTarget={hoverFromKey} />

          {result?.valid && result.stats && result.plan && <PlanDetails stats={result.stats} plan={result.plan} />}
        </div>
      </main>

      {/* ── Footer action bar ───────────────────────────── */}
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1480px] items-center justify-between gap-4 px-6">
          <div className="min-w-0 text-[13.5px] text-ink-2">
            {result?.valid && result.stats ? (
              <span>
                <strong className="font-semibold text-ink">{title}</strong> · {Math.round(result.stats.floorAreaSqM).toLocaleString()} m² · ready for the brief
              </span>
            ) : (
              <span>Choose a valid floor plan to continue.</span>
            )}
          </div>
          <button
            disabled={!result?.valid}
            onClick={onContinue}
            className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Continue to requirements <ArrowRight size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{children}</h2>;
}

function SkeletonList() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[98px] animate-pulse rounded-2xl border border-line bg-surface" />
      ))}
    </div>
  );
}

function Toggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={"flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition " + (on ? "border-brand/30 bg-brand-soft text-brand-600" : "border-line text-muted hover:text-ink-2")}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyPreview({ parseError }: { parseError: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-muted shadow-card">
        <Grid3x3 size={22} />
      </div>
      <p className="text-[14.5px] font-medium text-ink">{parseError ? "Nothing to draw yet" : "No floor outline found"}</p>
      <p className="mt-1 max-w-sm text-[13px] text-ink-2">{parseError ? "Fix the JSON syntax and the plan will appear here." : "The plan needs floor.boundary with at least three [x, y] points."}</p>
    </div>
  );
}

function Legend() {
  const Item = ({ swatch, label }: { swatch: React.ReactNode; label: string }) => (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
  return (
    <div className="flex gap-4 text-[12px] text-ink-2">
      <Item swatch={<span className="h-2.5 w-3.5 rounded-[2px] border border-[#2a3242]" style={{ background: "repeating-linear-gradient(45deg,#eceae4,#eceae4 2px,#c9c6bc 2px,#c9c6bc 3px)" }} />} label="Core" />
      <Item swatch={<span className="h-2.5 w-2.5 rounded-[2px] bg-[#2a3242]" />} label="Column" />
      <Item swatch={<span className="h-[3px] w-4 rounded bg-[#4d8fc7]" />} label="Window" />
      <Item swatch={<span className="h-[3px] w-4 rounded bg-brand" />} label="Entry" />
    </div>
  );
}

function HoverCaption({ plan, hovered }: { plan: DrawPlan | null; hovered: HoverTarget }) {
  let text = "Hover a door, window or core for details.";
  if (plan && hovered) {
    if (hovered.kind === "opening") {
      const o = plan.openings.find((x) => x.index === hovered.index);
      if (o) {
        const w = dist(o.wall[0], o.wall[1]).toFixed(2);
        text =
          o.type === "window"
            ? `Window · ${o.id} · ${w} m wide · sill ${o.sillHeight ?? 0} m · ${o.height ?? "?"} m high`
            : `${o.isEntry ? "Entry door" : "Door"} · ${o.id} · ${w} m wide · ${o.height ?? "?"} m high`;
      }
    } else {
      const o = plan.obstacles.find((x) => x.index === hovered.index);
      if (o) {
        const kind = o.type === "column" ? "Column" : o.type === "core" ? "Core" : o.type[0].toUpperCase() + o.type.slice(1);
        text = `${kind} · ${o.label ?? o.id} · ${area(o.polygon).toFixed(2)} m²${o.height ? ` · ${o.height} m high` : ""}`;
      }
    }
  }
  return <div className="min-h-5 text-[13px] text-ink-2">{text}</div>;
}

function downloadJson(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** JSON.parse messages differ per engine; extract a position when present and map it to line/column. */
function explainJsonError(e: Error, text: string): ParseError {
  const m = /position (\d+)/.exec(e.message) ?? /line (\d+) column (\d+)/.exec(e.message);
  if (m && m.length === 3) return { message: e.message, line: Number(m[1]), col: Number(m[2]) };
  if (m) {
    const pos = Number(m[1]);
    const before = text.slice(0, pos);
    const line = before.split("\n").length;
    return { message: e.message, line, col: pos - before.lastIndexOf("\n") };
  }
  return { message: e.message };
}
