import type { Catalog, CatalogCategory, Layout, ZoneType } from "../../../shared/types";
import { centroid } from "../../../shared/geometry";
import PlanPreview from "./PlanPreview";
import type { LayerContext, PreviewOptions } from "./PlanPreview";
import type { DrawPlan } from "../lib/plan";

export const ZONE_FILL: Record<ZoneType, string> = {
  workstation: "#dfe7ef", cabin: "#efe6d3", meeting: "#dbe8f4", cafeteria: "#f5e4cd", reception: "#d8ede5",
  phonebooth: "#e3def2", lounge: "#f2dfe8", storage: "#e6e6e3", pantry: "#f3e7c9",
};

const ITEM_FILL: Record<CatalogCategory, string> = {
  workstation: "#3b4656", chair: "#8a98ab", meeting: "#8b6b4e", reception: "#0f6b5c", cafeteria: "#c98a4d",
  lounge: "#b56f8c", storage: "#7c8593", equipment: "#7c8593", decor: "#5f9a5f",
};

interface Props {
  plan: DrawPlan;
  layout: Layout;
  catalog: Catalog;
  options: PreviewOptions;
  showFurniture?: boolean;
  onZone?: (zoneId: string | null) => void;
  highlightType?: ZoneType | null;
}

/** Furnished 2D plan: zone tints, corridors, partitions, furniture footprints, room doors and labels. */
export default function LayoutPlan({ plan, layout, catalog, options, showFurniture = true, highlightType }: Props) {
  const items = new Map(catalog.items.map((i) => [i.id, i]));

  const underlay = ({ maxY, wall }: LayerContext) => (
    <g>
      {layout.corridors.map((c, i) => (
        <path key={`c${i}`} d={c.polygon.map((p, k) => `${k ? "L" : "M"}${p[0]} ${maxY - p[1]}`).join(" ") + "Z"} fill="#0f6b5c" fillOpacity={0.06} />
      ))}
      {layout.zones
        .filter((z) => z.label !== "Planting" && z.label !== "Print station")
        .map((z) => {
          const xs = z.polygon.map((p) => p[0]), ys = z.polygon.map((p) => p[1]);
          const dim = highlightType && highlightType !== z.type;
          return (
            <rect key={z.id} x={Math.min(...xs)} y={maxY - Math.max(...ys)} width={Math.max(...xs) - Math.min(...xs)} height={Math.max(...ys) - Math.min(...ys)} fill={ZONE_FILL[z.type]} fillOpacity={dim ? 0.25 : 0.95} />
          );
        })}
      {showFurniture &&
        layout.placements.map((p) => {
          const it = items.get(p.itemId);
          if (!it || it.elevation > 0) return null;
          const dim = highlightType && layout.zones.find((z) => z.id === p.zoneId)?.type !== highlightType;
          const w = it.footprint.width, d = it.footprint.depth;
          // local x axis points along plan angle (theta + 90); SVG's y axis is flipped, so the rotation is negated.
          const rot = -(p.rotationDeg + 90);
          const round = it.category === "chair" || it.procedural?.shape === "cylinder";
          return (
            <g key={p.id} transform={`translate(${p.position[0]} ${maxY - p.position[1]}) rotate(${rot})`} opacity={dim ? 0.3 : 1}>
              <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={round ? Math.min(w, d) / 2 : 0.05} fill={ITEM_FILL[it.category]} fillOpacity={it.category === "chair" ? 0.85 : 0.92} stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.02} />
              {(it.category === "workstation" || it.category === "reception" || it.category === "lounge" || it.category === "cafeteria") && (
                <line x1={-w / 2 + 0.06} x2={w / 2 - 0.06} y1={d / 2 - 0.05} y2={d / 2 - 0.05} stroke="#fff" strokeOpacity={0.55} strokeWidth={0.04} strokeLinecap="round" />
              )}
            </g>
          );
        })}
      {/* partitions */}
      {layout.partitions.map((p) => (
        <line key={p.id} x1={p.a[0]} y1={maxY - p.a[1]} x2={p.b[0]} y2={maxY - p.b[1]} stroke={p.glass ? "#4d8fc7" : "#2a3242"} strokeWidth={p.glass ? wall * 0.35 : wall * 0.5} strokeLinecap="square" strokeOpacity={p.glass ? 0.85 : 1} />
      ))}
    </g>
  );

  const overlay = ({ maxY, fs }: LayerContext) => (
    <g>
      {options.labels &&
        layout.zones
          .filter((z) => z.enclosed || ["reception", "cafeteria", "lounge", "pantry"].includes(z.type))
          .filter((z) => z.label !== "Planting" && z.label !== "Print station")
          .map((z) => {
            const c = centroid(z.polygon);
            const xs = z.polygon.map((p) => p[0]);
            const w = Math.max(...xs) - Math.min(...xs);
            const size = Math.min(fs * 0.85, (w / Math.max(6, z.label.length)) * 1.5);
            return (
              <text key={`l-${z.id}`} x={c[0]} y={maxY - c[1]} fontSize={size} fontWeight={700} textAnchor="middle" dominantBaseline="middle" fill="#1b2333" style={{ paintOrder: "stroke" }} stroke="#ffffff" strokeWidth={size * 0.3} strokeOpacity={0.85}>
                {z.label}
              </text>
            );
          })}
    </g>
  );

  return <PlanPreview plan={plan} options={{ ...options, labels: options.labels }} underlay={underlay} overlay={overlay} />;
}
