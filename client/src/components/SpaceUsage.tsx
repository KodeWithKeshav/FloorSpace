import type { LayoutMetrics } from "../../../shared/types";

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

export default function SpaceUsage({ m }: { m: LayoutMetrics }) {
  const total = m.floorAreaSqM;
  const rooms = Math.max(0, m.occupiedAreaSqM - m.structureAreaSqM);
  const segments = [
    { key: "structure", label: "Cores & columns", value: m.structureAreaSqM, color: "#9aa3b2" },
    { key: "rooms", label: "Rooms, desks & zones", value: rooms, color: "#0f6b5c" },
    { key: "circulation", label: "Corridors & aisles", value: m.circulationAreaSqM, color: "#8fc9bb" },
    { key: "free", label: "Unassigned floor", value: m.unassignedAreaSqM, color: "#e3dfd4" },
  ];

  return (
    <section className="fade-up rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h3 className="text-[15px] font-semibold text-ink">Space usage</h3>
      <p className="mt-0.5 text-[12.5px] text-muted">Out of {fmt(total)} m² of floor</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-brand-soft px-4 py-3.5">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-brand-600">Occupied</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[28px] font-semibold leading-none tabular-nums text-ink">{fmt(m.occupiedAreaSqM)}</span>
            <span className="text-[13px] text-ink-2">m²</span>
          </div>
          <div className="mt-1 text-[12.5px] text-ink-2">{pct(m.occupiedAreaSqM, total)}% of the floor</div>
        </div>
        <div className="rounded-xl bg-canvas px-4 py-3.5">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-2">Free</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[28px] font-semibold leading-none tabular-nums text-ink">{fmt(m.freeAreaSqM)}</span>
            <span className="text-[13px] text-ink-2">m²</span>
          </div>
          <div className="mt-1 text-[12.5px] text-ink-2">{pct(m.freeAreaSqM, total)}% of the floor</div>
        </div>
      </div>

      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-canvas" role="img" aria-label="Breakdown of floor area">
        {segments.map((s) => (
          <div key={s.key} title={`${s.label}: ${fmt(s.value)} m²`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>

      <ul className="mt-3 space-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2 text-ink-2">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tabular-nums text-ink">
              <strong className="font-semibold">{fmt(s.value)} m²</strong> <span className="text-muted">· {pct(s.value, total)}%</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-line-2 pt-3 text-[12.5px] leading-relaxed text-muted">
        Free space is corridors, aisles, door clearances and any floor left unassigned. Furniture itself covers {fmt(m.furnitureFootprintSqM)} m² inside the occupied area.
      </p>
    </section>
  );
}
