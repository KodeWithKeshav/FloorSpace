import type { Catalog, CatalogItem, FloorPlan, Layout, Pt, ZoneType } from "./types";
import { bbox, dist, distPointToSegment, nearestEdge, signedArea } from "./geometry";

/**
 * One description of the 3D world, built from a plan and a layout, consumed by both the browser walkthrough
 * (three.js) and the Godot exporter. Everything is in metres. World axes: x = plan x, y up, z = -plan y, so the
 * plan looks the same from above as it does on the page.
 */

export type BoxKind = "wall" | "glass" | "partition" | "partition-glass";

export interface WorldBox {
  id: string;
  kind: BoxKind;
  /** Centre in plan space. */
  cx: number;
  cy: number;
  /** Size along the wall direction and across it. */
  length: number;
  thickness: number;
  /** Plan-space angle of the length axis, degrees CCW from +x. */
  angleDeg: number;
  y0: number;
  y1: number;
}

export interface WorldItem {
  id: string;
  itemId: string;
  /** Plan-space centre of the footprint. */
  x: number;
  y: number;
  elevation: number;
  /** Rotation about the world Y axis (degrees) that turns the item's +Z front to the layout direction. */
  yawDeg: number;
}

export interface Collider {
  /** What produced it: building walls and partitions (the Godot export gives those their own bodies) or furniture. */
  src: "wall" | "item" | "obstacle";
  cx: number;
  cy: number;
  /** Half extents along and across `angleDeg`. */
  hx: number;
  hy: number;
  angleDeg: number;
}

export interface RoomFloor {
  zoneId: string;
  type: ZoneType;
  polygon: Pt[];
  color: string;
}

export interface Teleport {
  id: string;
  label: string;
  type: ZoneType;
  x: number;
  y: number;
  /** Plan-space direction to face on arrival, degrees CCW from +x. */
  lookDeg: number;
}

export interface SceneDescription {
  name: string;
  ceilingHeight: number;
  boundary: Pt[];
  walls: WorldBox[];
  partitions: WorldBox[];
  obstacles: { id: string; type: string; polygon: Pt[]; height: number; label?: string }[];
  roomFloors: RoomFloor[];
  items: WorldItem[];
  colliders: Collider[];
  spawn: { x: number; y: number; lookDeg: number };
  teleports: Teleport[];
}

export const WALL_THICKNESS = 0.2;
export const PARTITION_THICKNESS = 0.1;
export const PARTITION_HEIGHT = 2.7;

const FLOOR_COLORS: Record<ZoneType, string> = {
  workstation: "#dfe5ec", cabin: "#e6dfd0", meeting: "#dbe4ee", cafeteria: "#efe3cf", reception: "#d9e9e2",
  phonebooth: "#dbe4ee", lounge: "#ecdde4", storage: "#e0e0e0", pantry: "#efe3cf",
};

const deg = (rad: number) => (rad * 180) / Math.PI;

/** Yaw (degrees about world Y) for an item whose front should face plan direction `thetaDeg`. */
export const itemYawDeg = (thetaDeg: number) => thetaDeg + 90;

/** Plan point + elevation -> world (x, y, z). */
export const toWorld = (x: number, y: number, elevation = 0): [number, number, number] => [x, elevation, -y];

export function buildScene(plan: FloorPlan, layout: Layout, catalog: Catalog): SceneDescription {
  const H = plan.floor.ceilingHeight;
  const boundary = signedArea(plan.floor.boundary) < 0 ? [...plan.floor.boundary].reverse() : plan.floor.boundary;
  const byId = new Map(catalog.items.map((i) => [i.id, i]));

  const walls = boundaryWalls(plan, boundary, H);

  const partitions: WorldBox[] = layout.partitions.map((p) => {
    const len = dist(p.a, p.b);
    return {
      id: p.id, kind: p.glass ? "partition-glass" : "partition",
      cx: (p.a[0] + p.b[0]) / 2, cy: (p.a[1] + p.b[1]) / 2,
      length: len, thickness: PARTITION_THICKNESS,
      angleDeg: deg(Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0])),
      y0: 0, y1: Math.min(PARTITION_HEIGHT, H),
    };
  });

  const obstacles = plan.obstacles.map((o) => ({ id: o.id, type: o.type, polygon: o.polygon, height: o.height ?? H, label: o.label }));

  const roomFloors: RoomFloor[] = layout.zones
    .filter((z) => z.label !== "Planting" && z.label !== "Print station")
    .map((z) => ({ zoneId: z.id, type: z.type, polygon: z.polygon, color: FLOOR_COLORS[z.type] }));

  const items: WorldItem[] = [];
  const colliders: Collider[] = [];
  for (const p of layout.placements) {
    const it = byId.get(p.itemId);
    if (!it) continue;
    items.push({ id: p.id, itemId: p.itemId, x: p.position[0], y: p.position[1], elevation: it.elevation, yawDeg: itemYawDeg(p.rotationDeg) });
    if (it.elevation === 0 && it.height > 0.3 && it.category !== "chair") {
      const t = p.rotationDeg;
      // Footprint width runs along the item's local x, which in plan space is the direction t + 90.
      colliders.push({ src: "item", cx: p.position[0], cy: p.position[1], hx: it.footprint.width / 2, hy: it.footprint.depth / 2, angleDeg: t + 90 });
    }
  }
  for (const w of [...walls, ...partitions]) {
    if (w.kind === "glass" || w.y0 > 1.2 || w.y1 < 0.5) continue; // headers overhead never block
    colliders.push({ src: "wall", cx: w.cx, cy: w.cy, hx: w.length / 2, hy: w.thickness / 2, angleDeg: w.angleDeg });
  }
  for (const o of plan.obstacles) {
    const b = bbox(o.polygon);
    colliders.push({ src: "obstacle", cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, hx: b.width / 2, hy: b.height / 2, angleDeg: 0 });
  }
  // Glass panes in windows also block.
  for (const w of walls.filter((x) => x.kind === "glass")) colliders.push({ src: "wall", cx: w.cx, cy: w.cy, hx: w.length / 2, hy: Math.max(w.thickness, 0.1) / 2, angleDeg: w.angleDeg });

  // Spawn just inside the entry, looking in.
  const door = plan.openings.find((o) => o.type === "door" && o.isEntry) ?? plan.openings.find((o) => o.type === "door");
  let spawn = { x: bbox(boundary).minX + 2, y: bbox(boundary).minY + 2, lookDeg: 0 };
  if (door) {
    const mid: Pt = [(door.wall[0][0] + door.wall[1][0]) / 2, (door.wall[0][1] + door.wall[1][1]) / 2];
    const n = inward(mid, boundary);
    spawn = { x: mid[0] + n[0] * 1.3, y: mid[1] + n[1] * 1.3, lookDeg: deg(Math.atan2(n[1], n[0])) };
  }

  const teleports: Teleport[] = [{ id: "entry", label: "Entrance", type: "reception", x: spawn.x, y: spawn.y, lookDeg: spawn.lookDeg }];
  for (const z of layout.zones) {
    if (z.label === "Planting" || z.label === "Print station" || (z.type === "workstation" && z.label === "Open plan")) continue;
    const b = bbox(z.polygon);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    if (z.door) {
      const f = z.door.facingDeg;
      const fx = Math.cos((f * Math.PI) / 180), fy = Math.sin((f * Math.PI) / 180);
      teleports.push({ id: z.id, label: z.label, type: z.type, x: z.door.center[0] + fx * 1.0, y: z.door.center[1] + fy * 1.0, lookDeg: f + 180 });
    } else if (z.facingDeg !== undefined) {
      // Open zones: stand just outside the front edge, looking in.
      const fx = Math.cos((z.facingDeg * Math.PI) / 180), fy = Math.sin((z.facingDeg * Math.PI) / 180);
      const half = Math.abs(fx) > 0.5 ? b.width / 2 : b.height / 2;
      teleports.push({ id: z.id, label: z.label, type: z.type, x: cx + fx * (half + 0.8), y: cy + fy * (half + 0.8), lookDeg: z.facingDeg + 180 });
    } else {
      teleports.push({ id: z.id, label: z.label, type: z.type, x: cx, y: cy, lookDeg: spawn.lookDeg });
    }
  }
  // One open-plan stop.
  const bays = layout.zones.filter((z) => z.type === "workstation");
  if (bays.length) {
    const z = bays[Math.floor(bays.length / 2)];
    const b = bbox(z.polygon);
    teleports.push({ id: "open-plan", label: "Open plan", type: "workstation", x: (b.minX + b.maxX) / 2, y: b.minY - 0.7, lookDeg: 90 });
  }

  return { name: plan.name, ceilingHeight: H, boundary, walls, partitions, obstacles, roomFloors, items, colliders, spawn, teleports };
}

function inward(p: Pt, boundary: Pt[]): Pt {
  const { index } = nearestEdge(p, boundary);
  const a = boundary[index], b = boundary[(index + 1) % boundary.length];
  const len = dist(a, b) || 1;
  return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
}

/** Building walls: solid runs between openings, sills and headers around them, and glass in the window openings. */
function boundaryWalls(plan: FloorPlan, boundary: Pt[], H: number): WorldBox[] {
  const out: WorldBox[] = [];
  const n = boundary.length;
  const T = WALL_THICKNESS;

  for (let i = 0; i < n; i++) {
    const a = boundary[i], b = boundary[(i + 1) % n];
    const len = dist(a, b);
    if (len < 1e-6) continue;
    const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
    const ox = dy, oy = -dx; // outward (right of travel for a CCW outline)
    const prev = boundary[(i + n - 1) % n], next = boundary[(i + 2) % n];
    const convexStart = cross(prev, a, b) > 0, convexEnd = cross(a, b, next) > 0;
    const s0 = convexStart ? -T : 0, s1 = len + (convexEnd ? T : 0);
    const angle = deg(Math.atan2(dy, dx));

    const put = (id: string, kind: BoxKind, from: number, to: number, y0: number, y1: number, thick = T, shift = T / 2) => {
      if (to - from < 1e-3 || y1 - y0 < 1e-3) return;
      const mid = (from + to) / 2;
      out.push({
        id, kind,
        cx: a[0] + dx * mid + ox * shift, cy: a[1] + dy * mid + oy * shift,
        length: to - from, thickness: thick, angleDeg: angle, y0, y1,
      });
    };

    // Openings that belong to this edge.
    const ops = plan.openings
      .filter((o) => nearestEdge([(o.wall[0][0] + o.wall[1][0]) / 2, (o.wall[0][1] + o.wall[1][1]) / 2], boundary).index === i && distPointToSegment(o.wall[0], a, b) < 0.06 && distPointToSegment(o.wall[1], a, b) < 0.06)
      .map((o) => {
        const t0 = (o.wall[0][0] - a[0]) * dx + (o.wall[0][1] - a[1]) * dy;
        const t1 = (o.wall[1][0] - a[0]) * dx + (o.wall[1][1] - a[1]) * dy;
        return { o, from: Math.max(0, Math.min(t0, t1)), to: Math.min(len, Math.max(t0, t1)) };
      })
      .sort((p, q) => p.from - q.from);

    let cursor = s0;
    ops.forEach((op, k) => {
      put(`w${i}-s${k}`, "wall", cursor, op.from, 0, H);
      const h = Math.min(op.o.height, H);
      if (op.o.type === "door") {
        put(`w${i}-h${k}`, "wall", op.from, op.to, h, H);
      } else {
        const sill = op.o.sillHeight ?? 0.9;
        put(`w${i}-sill${k}`, "wall", op.from, op.to, 0, sill);
        put(`w${i}-h${k}`, "wall", op.from, op.to, Math.min(H, sill + h), H);
        put(`w${i}-g${k}`, "glass", op.from, op.to, sill, Math.min(H, sill + h), 0.04, T / 2);
      }
      cursor = op.to;
    });
    put(`w${i}-s${ops.length}`, "wall", cursor, s1, 0, H);
  }
  return out;
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

export type { CatalogItem };
