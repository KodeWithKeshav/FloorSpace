import type { CatalogItem, Placement, Pt } from "./types";
import type { Collider } from "./scene";
import { pointInPolygon } from "./geometry";

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;

export const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(s * 100) / 100));
export const normDeg = (d: number) => ((Math.round(d * 10) / 10 % 360) + 360) % 360;
export const snapTo = (v: number, step: number) => (step > 0 ? Math.round((Math.round(v / step) * step) * 1e6) / 1e6 : v);

/** Corners of an oriented box in plan space. `angleDeg` is the direction of the box's local x axis. */
export function obbCorners(cx: number, cy: number, hx: number, hy: number, angleDeg: number): Pt[] {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return ([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]] as Pt[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Pt);
}

/** Corners of a placed item's footprint (width runs along plan direction rotation + 90). */
export function placementCorners(p: Placement, it: CatalogItem): Pt[] {
  const k = p.scale ?? 1;
  return obbCorners(p.position[0], p.position[1], (it.footprint.width * k) / 2, (it.footprint.depth * k) / 2, p.rotationDeg + 90);
}

/** Separating-axis test for two convex quads. Returns the smallest overlap depth (0 when apart). */
export function overlapDepth(a: Pt[], b: Pt[]): number {
  let depth = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      let nx = q[1] - p[1], ny = p[0] - q[0];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of a) { const d = v[0] * nx + v[1] * ny; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
      for (const v of b) { const d = v[0] * nx + v[1] * ny; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
      const o = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (o <= 0) return 0;
      depth = Math.min(depth, o);
    }
  }
  return depth === Infinity ? 0 : depth;
}

export type PlacementIssue = "outside" | "wall" | "item";

/**
 * What is wrong with an item's current spot: outside the building, through a wall or core, or on top of other
 * furniture. Chairs may tuck under desks and wall boards hang on walls, so they are exempt where it makes sense.
 */
export function checkPlacement(
  p: Placement,
  it: CatalogItem,
  boundary: Pt[],
  fixed: Collider[],
  others: { p: Placement; it: CatalogItem }[],
): PlacementIssue[] {
  const issues = new Set<PlacementIssue>();
  const corners = placementCorners(p, it);
  if (corners.some((c) => !pointInPolygon(c, boundary, 0.03))) issues.add("outside");
  if (it.elevation === 0) {
    for (const c of fixed) {
      if (overlapDepth(corners, obbCorners(c.cx, c.cy, c.hx, c.hy, c.angleDeg)) > 0.03) {
        issues.add("wall");
        break;
      }
    }
  }
  if (it.category !== "chair" && it.elevation === 0) {
    for (const o of others) {
      if (o.p.id === p.id || o.it.category === "chair" || o.it.elevation > 0) continue;
      if (overlapDepth(corners, placementCorners(o.p, o.it)) > 0.05) {
        issues.add("item");
        break;
      }
    }
  }
  return [...issues];
}

let counter = 0;
/** A fresh placement id that cannot clash with generated `p123` ids. */
export const newPlacementId = () => `e${Date.now().toString(36)}${(counter++).toString(36)}`;
