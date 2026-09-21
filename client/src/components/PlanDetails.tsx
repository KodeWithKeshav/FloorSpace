import type { FloorPlan, PlanStats } from "../../../shared/types";

export default function PlanDetails({ stats, plan }: { stats: PlanStats; plan: FloorPlan }) {
  const rows: [string, string][] = [
    ["Floor area", `${fmt(stats.floorAreaSqM)} m²`],
    ["Fixed obstacles", `${fmt(stats.obstacleAreaSqM)} m²`],
    ["Usable before circulation", `${fmt(stats.usableAreaSqM)} m²`],
    ["Overall size", `${fmt(stats.bbox.width)} × ${fmt(stats.bbox.height)} m`],
    ["Perimeter", `${fmt(stats.perimeterM)} m`],
    ["Ceiling height", `${fmt(plan.floor.ceilingHeight)} m`],
    ["Cores & shafts", String(stats.cores)],
    ["Columns", String(stats.columns)],
    ["Doors · Windows", `${stats.doors} · ${stats.windows}`],
    ["Main corridor", `${fmt(plan.circulation.mainCorridorWidth)} m`],
  ];
  return (
    <section className="fade-up rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h3 className="text-[15px] font-semibold text-ink">Plan details</h3>
      <dl className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line-2 py-2 last:border-b-0">
            <dt className="text-[13px] text-ink-2">{k}</dt>
            <dd className="text-[13.5px] font-semibold tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
