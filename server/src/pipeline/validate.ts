import type { Catalog, FloorPlan, Layout, LayoutZone, Placement, Pt } from "../../../shared/types";
import { pointInPolygon } from "../../../shared/geometry";
import { rectIntersectsPolygon } from "./grid";
import type { Grid } from "./grid";
import { inwardNormal } from "./entry";

/** Cells from which a zone is entered; the zone is reachable if walking from the entrance can reach any of them. */
export interface AccessCell {
  zoneId: string;
  cells: [number, number][];
}

export interface ValidationOutcome {
  badZones: Set<string>;
  messages: string[];
}

const TOL = 0.06;

const bounds = (poly: Pt[]) => ({
  x0: Math.min(...poly.map((p) => p[0])), x1: Math.max(...poly.map((p) => p[0])),
  y0: Math.min(...poly.map((p) => p[1])), y1: Math.max(...poly.map((p) => p[1])),
});

/** Corner points of a placement's footprint in plan space. */
export function footprintCorners(p: Placement, w: number, d: number): Pt[] {
  const t = (p.rotationDeg * Math.PI) / 180;
  const u: Pt = [-Math.sin(t), Math.cos(t)], f: Pt = [Math.cos(t), Math.sin(t)];
  const c = (a: number, b: number): Pt => [p.position[0] + a * u[0] * w / 2 + b * f[0] * d / 2, p.position[1] + a * u[1] * w / 2 + b * f[1] * d / 2];
  return [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
}

/**
 * Hard gate: nothing overlaps, nothing sits outside the outline or inside a core, every door has a clear approach,
 * and every room can actually be walked to from the entry. Returns the zones that broke a rule.
 */
export function validateLayout(plan: FloorPlan, layout: Layout, catalog: Catalog, grid: Grid, entry: Pt | null, access: AccessCell[]): ValidationOutcome {
  const bad = new Set<string>();
  const messages: string[] = [];
  const zoneName = (id: string) => layout.zones.find((z) => z.id === id)?.label ?? id;
  const fail = (id: string, why: string) => {
    if (!bad.has(id)) messages.push(`${zoneName(id)} was removed: ${why}.`);
    bad.add(id);
  };

  // 1. Inside the outline, clear of cores and columns.
  for (const z of layout.zones) {
    const b = bounds(z.polygon);
    const inside = z.polygon.every((p) => pointInPolygon(p, plan.floor.boundary, 1e-4));
    if (!inside) fail(z.id, "it extends outside the floor outline");
    else if (plan.obstacles.some((o) => rectIntersectsPolygon(b.x0 + 0.01, b.y0 + 0.01, b.x1 - 0.01, b.y1 - 0.01, o.polygon))) fail(z.id, "it overlaps a core or column");
  }

  // 2. No two zones overlap.
  for (let i = 0; i < layout.zones.length; i++) {
    for (let j = i + 1; j < layout.zones.length; j++) {
      const a = bounds(layout.zones[i].polygon), c = bounds(layout.zones[j].polygon);
      if (a.x0 < c.x1 - 1e-6 && a.x1 > c.x0 + 1e-6 && a.y0 < c.y1 - 1e-6 && a.y1 > c.y0 + 1e-6) fail(layout.zones[j].id, `it overlaps ${zoneName(layout.zones[i].id)}`);
    }
  }

  // 3. Every item stays inside its own zone rectangle.
  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  const zoneById = new Map(layout.zones.map((z) => [z.id, z]));
  for (const p of layout.placements) {
    const it = byId.get(p.itemId), z = zoneById.get(p.zoneId);
    if (!it || !z) continue;
    if (it.elevation > 0) continue; // wall boards
    const b = bounds(z.polygon);
    const out = footprintCorners(p, it.footprint.width, it.footprint.depth).some((c) => c[0] < b.x0 - TOL || c[0] > b.x1 + TOL || c[1] < b.y0 - TOL || c[1] > b.y1 + TOL);
    if (out) fail(z.id, `${it.name} sticks out of its area`);
  }

  // 4. Clear approach (1.2 m) in front of every door, both the building's and each room's.
  const overlapsAnyZone = (x0: number, y0: number, x1: number, y1: number, ignore?: string) =>
    layout.zones.filter((z) => z.id !== ignore && !bad.has(z.id)).filter((z) => {
      const b = bounds(z.polygon);
      return x0 < b.x1 - 1e-6 && x1 > b.x0 + 1e-6 && y0 < b.y1 - 1e-6 && y1 > b.y0 + 1e-6;
    });

  for (const o of plan.openings.filter((x) => x.type === "door")) {
    const mid: Pt = [(o.wall[0][0] + o.wall[1][0]) / 2, (o.wall[0][1] + o.wall[1][1]) / 2];
    const n = inwardNormal(mid, plan.floor.boundary);
    const hw = 0.5;
    const along: Pt = [-n[1], n[0]];
    const corners = [[mid[0] - along[0] * hw, mid[1] - along[1] * hw], [mid[0] + along[0] * hw + n[0] * 1.2, mid[1] + along[1] * hw + n[1] * 1.2]];
    const x0 = Math.min(corners[0][0], corners[1][0]), x1 = Math.max(corners[0][0], corners[1][0]);
    const y0 = Math.min(corners[0][1], corners[1][1]), y1 = Math.max(corners[0][1], corners[1][1]);
    for (const z of overlapsAnyZone(x0, y0, x1, y1)) fail(z.id, `it blocks the approach to door "${o.id}"`);
  }
  for (const z of layout.zones.filter((q) => q.door && !bad.has(q.id))) {
    const d = z.door!;
    const f: Pt = [Math.round(Math.cos((d.facingDeg * Math.PI) / 180)), Math.round(Math.sin((d.facingDeg * Math.PI) / 180))];
    const half = 0.5;
    const cx = d.center[0], cy = d.center[1];
    const x0 = f[0] !== 0 ? Math.min(cx, cx + f[0] * 1.2) : cx - half, x1 = f[0] !== 0 ? Math.max(cx, cx + f[0] * 1.2) : cx + half;
    const y0 = f[1] !== 0 ? Math.min(cy, cy + f[1] * 1.2) : cy - half, y1 = f[1] !== 0 ? Math.max(cy, cy + f[1] * 1.2) : cy + half;
    for (const other of overlapsAnyZone(x0 + 0.001, y0 + 0.001, x1 - 0.001, y1 - 0.001, z.id)) fail(other.id, `it blocks the door of ${z.label}`);
  }

  // 5. Everything can be reached on foot from the entry.
  if (entry) {
    const n = inwardNormal(entry, plan.floor.boundary);
    const [sx, sy] = grid.toCell(entry[0] + n[0] * 0.9, entry[1] + n[1] * 0.9);
    const seen = grid.flood(sx, sy);
    if (process.env.SP_DEBUG) {
      let n = 0;
      for (const v of seen) n += v;
      console.log(`[flood] start cell ${sx},${sy} hardBlocked=${grid.hardBlocked(sx, sy)} reached ${n} cells`);
      for (let y = grid.ny - 1; y >= 0; y -= 2) {
        let line = "";
        for (let x = 0; x < grid.nx; x += 2) line += !grid.inside[grid.idx(x, y)] ? " " : grid.structural[grid.idx(x, y)] ? "#" : grid.solid[grid.idx(x, y)] ? "S" : seen[grid.idx(x, y)] ? (grid.reserved[grid.idx(x, y)] ? "r" : ".") : "X";
        console.log(line);
      }
    }
    for (const a of access) {
      if (bad.has(a.zoneId)) continue;
      const reachable = a.cells.some(([x, y]) => grid.inRange(x, y) && seen[grid.idx(x, y)] === 1);
      if (!reachable) fail(a.zoneId, "it cannot be reached from the entrance");
    }
  }
  return { badZones: bad, messages };
}

export type { LayoutZone };
