import type { Pt } from "../../../shared/types";
import { nearestEdge, signedArea } from "../../../shared/geometry";

/** Loosely-typed shape the renderer can draw even when the plan has validation errors. */
export interface DrawPlan {
  name: string;
  boundary: Pt[];
  ceilingHeight: number;
  obstacles: { index: number; id: string; type: string; polygon: Pt[]; label?: string; height?: number }[];
  openings: { index: number; id: string; type: "door" | "window"; wall: [Pt, Pt]; height?: number; sillHeight?: number; isEntry?: boolean }[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPt = (v: unknown): v is Pt => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const isPts = (v: unknown, min: number): v is Pt[] => Array.isArray(v) && v.length >= min && v.every(isPt);

/** Best-effort read of an arbitrary parsed JSON value into something drawable, or null if there is no usable outline. */
export function coercePlan(raw: unknown): DrawPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const floor = r.floor;
  if (!floor || !isPts(floor.boundary, 3)) return null;

  let boundary = (floor.boundary as Pt[]).map((p) => [p[0], p[1]] as Pt);
  const first = boundary[0], last = boundary[boundary.length - 1];
  if (boundary.length > 3 && first[0] === last[0] && first[1] === last[1]) boundary.pop();
  if (signedArea(boundary) < 0) boundary = boundary.reverse();

  const obstacles: DrawPlan["obstacles"] = [];
  (Array.isArray(r.obstacles) ? r.obstacles : []).forEach((o: any, index: number) => {
    if (o && isPts(o.polygon, 3)) {
      obstacles.push({ index, id: String(o.id ?? `obstacle-${index}`), type: String(o.type ?? "core"), polygon: o.polygon, label: typeof o.label === "string" ? o.label : undefined, height: isNum(o.height) ? o.height : undefined });
    }
  });

  const openings: DrawPlan["openings"] = [];
  (Array.isArray(r.openings) ? r.openings : []).forEach((o: any, index: number) => {
    if (o && Array.isArray(o.wall) && o.wall.length === 2 && isPt(o.wall[0]) && isPt(o.wall[1])) {
      openings.push({
        index,
        id: String(o.id ?? `opening-${index}`),
        type: o.type === "window" ? "window" : "door",
        wall: [o.wall[0], o.wall[1]],
        height: isNum(o.height) ? o.height : undefined,
        sillHeight: isNum(o.sillHeight) ? o.sillHeight : undefined,
        isEntry: o.isEntry === true,
      });
    }
  });

  return { name: typeof r.name === "string" ? r.name : "Untitled plan", boundary, ceilingHeight: isNum(floor.ceilingHeight) ? floor.ceilingHeight : 3, obstacles, openings };
}

/** Unit vector pointing into the room from the boundary edge nearest to a point (boundary must be CCW). */
export function inwardNormal(p: Pt, boundary: Pt[]): Pt {
  const { index } = nearestEdge(p, boundary);
  const a = boundary[index], b = boundary[(index + 1) % boundary.length];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len]; // left of travel direction = interior for a CCW polygon
}

/** Turns "openings[2].wall" into a key like "openings:2" for highlight lookups. */
export function issueTarget(path: string): string | null {
  const m = /^(openings|obstacles)\[(\d+)\]/.exec(path);
  return m ? `${m[1]}:${m[2]}` : null;
}
