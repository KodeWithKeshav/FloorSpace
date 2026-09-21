import type { Pt } from "../../../shared/types";
import { nearestEdge } from "../../../shared/geometry";

/** Unit vector pointing into the room from the boundary edge nearest to a point (boundary must be CCW). */
export function inwardNormal(p: Pt, boundary: Pt[]): Pt {
  const { index } = nearestEdge(p, boundary);
  const a = boundary[index], b = boundary[(index + 1) % boundary.length];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}
