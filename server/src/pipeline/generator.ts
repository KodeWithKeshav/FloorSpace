import type {
  Catalog, CatalogItem, FloorPlan, Layout, LayoutZone, Partition, Placement, Pt, Requirements, ZoneRequest, ZoneType,
} from "../../../shared/types";
import { dist, distPointToSegment } from "../../../shared/geometry";
import { Grid, CELL } from "./grid";
import { buildUnit, edgeOnPolyline, isEnclosed, makeFrame, toPlan, unitSize } from "./units";
import type { Frame, UnitKind, UnitParams } from "./units";
import { computeMetrics } from "./metrics";
import { validateLayout } from "./validate";
import type { AccessCell } from "./validate";
import { inwardNormal } from "./entry";

export interface GenerateOptions {
  /** Attempt index: later attempts relax spacing so a stubborn floor still gets a valid result. */
  attempt?: number;
  /** Place as many workstation seats as fit, ignoring the requested number (used for feasibility). */
  unlimitedSeats?: boolean;
}

interface Ctx {
  plan: FloorPlan;
  cat: (id: string) => CatalogItem;
  grid: Grid;
  entry: Pt | null;
  entryNormal: Pt;
  zones: LayoutZone[];
  placements: Placement[];
  partitions: Partition[];
  corridors: Layout["corridors"];
  warnings: string[];
  unplaced: string[];
  accessCells: AccessCell[];
  nextZone: number;
  nextItem: number;
  aisle: number;
  cabinCenters: Pt[];
}

const cells = (m: number) => Math.ceil(m / CELL - 1e-6);

export interface GenerateResult {
  layout: Layout;
  /** False when a validation rule had to remove something. */
  clean: boolean;
}

/** Runs the pipeline up to three times, relaxing spacing, and keeps the first attempt that validates without removals. */
export function generateLayout(plan: FloorPlan, req: Requirements, catalog: Catalog, opts: GenerateOptions = {}): Layout {
  let last: GenerateResult | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = generateOnce(plan, req, catalog, { ...opts, attempt });
    if (last.clean) return last.layout;
  }
  return last!.layout;
}

function generateOnce(plan: FloorPlan, req: Requirements, catalog: Catalog, opts: GenerateOptions): GenerateResult {
  const attempt = opts.attempt ?? 0;
  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  const cat = (id: string) => {
    const it = byId.get(id);
    if (!it) throw new Error(`Catalog item "${id}" is missing`);
    return it;
  };

  const entryDoor = plan.openings.find((o) => o.type === "door" && o.isEntry) ?? plan.openings.find((o) => o.type === "door") ?? null;
  const entry: Pt | null = entryDoor ? [(entryDoor.wall[0][0] + entryDoor.wall[1][0]) / 2, (entryDoor.wall[0][1] + entryDoor.wall[1][1]) / 2] : null;
  const entryNormal = entry ? inwardNormal(entry, plan.floor.boundary) : ([0, 1] as Pt);

  const grid = new Grid(plan, entry);
  const ctx: Ctx = {
    plan, cat, grid, entry, entryNormal,
    zones: [], placements: [], partitions: [], corridors: [], warnings: [], unplaced: [],
    accessCells: [], nextZone: 1, nextItem: 1,
    aisle: attempt >= 1 ? 1.0 : plan.circulation.secondaryCorridorWidth,
    cabinCenters: [],
  };

  // Every door keeps a clear approach, whatever else happens.
  for (const o of plan.openings) if (o.type === "door") reserveDoorApproach(ctx, o.wall[0], o.wall[1]);

  carveCorridors(ctx, attempt);

  const wanted = expandRequests(req);
  const order: ZoneType[] = ["reception", "meeting", "cabin", "phonebooth", "storage", "pantry", "cafeteria", "lounge"];
  for (const type of order) {
    for (const z of wanted.filter((w) => w.type === type)) {
      for (let i = 0; i < z.count; i++) {
        const label = z.count > 1 || wanted.filter((w) => w.type === type).length > 1 ? `${labelOf(type)} ${i + 1}` : labelOf(type);
        const ok = placeRoom(ctx, type as UnitKind, { capacity: z.capacity, seats: z.seats, style: z.style }, z.preference, label);
        if (!ok) ctx.unplaced.push(`${labelOf(type)} ${i + 1}`);
      }
    }
  }

  const seatsWanted = opts.unlimitedSeats ? 100000 : wanted.filter((w) => w.type === "workstation").reduce((n, w) => n + (w.seats ?? 0), 0);
  const style = wanted.find((w) => w.type === "workstation")?.style ?? "linear_6pack";
  if (seatsWanted > 0) placeWorkstations(ctx, seatsWanted, style);

  placeAccents(ctx);

  return finish(ctx, req, catalog, opts);
}

// ───────────────────────── requirements → concrete requests ─────────────────────────

interface Wanted {
  type: ZoneType;
  count: number;
  seats?: number;
  capacity?: number;
  style?: string;
  preference?: ZoneRequest["preference"];
}

export function expandRequests(req: Requirements): Wanted[] {
  return req.zones.map((z) => ({
    type: z.type,
    count: z.type === "workstation" ? 1 : Math.max(1, z.count ?? 1),
    seats: z.type === "cafeteria" ? (z.seats ?? 20) : z.seats,
    capacity: z.capacityEach ?? (z.type === "meeting" ? 8 : undefined),
    style: z.preferredStyle,
    preference: z.preference,
  }));
}

const LABELS: Record<ZoneType, string> = {
  workstation: "Open plan", cabin: "Cabin", meeting: "Meeting room", cafeteria: "Cafeteria", reception: "Reception",
  phonebooth: "Phone booth", lounge: "Lounge", storage: "Storage", pantry: "Pantry",
};
export const labelOf = (t: ZoneType) => LABELS[t];

// ───────────────────────── corridors & door approaches ─────────────────────────

function reserveDoorApproach(ctx: Ctx, a: Pt, b: Pt) {
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = inwardNormal(mid, ctx.plan.floor.boundary);
  const half = Math.max(0.6, dist(a, b) / 2);
  const along: Pt = [-n[1], n[0]];
  const corners = [
    [mid[0] - along[0] * half, mid[1] - along[1] * half],
    [mid[0] + along[0] * half, mid[1] + along[1] * half],
    [mid[0] + along[0] * half + n[0] * 1.5, mid[1] + along[1] * half + n[1] * 1.5],
    [mid[0] - along[0] * half + n[0] * 1.5, mid[1] - along[1] * half + n[1] * 1.5],
  ];
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const [cx0, cy0] = ctx.grid.toCell(Math.min(...xs), Math.min(...ys));
  const [cx1, cy1] = ctx.grid.toCell(Math.max(...xs) - 1e-6, Math.max(...ys) - 1e-6);
  ctx.grid.markReserved(cx0, cy0, cx1 + 1, cy1 + 1);
}

/** Main corridor from the entry into the floor, plus a cross corridor on larger floors. */
function carveCorridors(ctx: Ctx, attempt: number) {
  const { grid, entry, entryNormal: n, plan } = ctx;
  if (!entry) return;
  const main = plan.circulation.mainCorridorWidth;
  const cross = plan.circulation.secondaryCorridorWidth;

  const ray = (from: Pt, dir: Pt, maxLen: number, ignoreColumns = false) => {
    let len = 0;
    for (let s = 0; s <= maxLen; s += CELL) {
      const x = from[0] + dir[0] * s, y = from[1] + dir[1] * s;
      const [cx, cy] = grid.toCell(x, y);
      if (!grid.inRange(cx, cy) || !grid.inside[grid.idx(cx, cy)]) break;
      if (grid.structural[grid.idx(cx, cy)] && !ignoreColumns) break;
      len = s;
    }
    return len;
  };

  const start: Pt = [entry[0] + n[0] * 0.3, entry[1] + n[1] * 0.3];
  const run = ray(start, n, 80);
  const floorArea = grid.inside.reduce((s, v) => s + v, 0) * CELL * CELL;
  const spineLen = Math.min(run, floorArea < 250 ? Math.max(3, run * 0.55) : run);
  stripe(ctx, start, n, spineLen, main);
  ctx.corridors.push(stripPoly(start, n, spineLen, main));

  if (floorArea >= 700 && attempt === 0) {
    // Cross corridor at mid-depth, nudged to dodge structural columns.
    const perp: Pt = [-n[1], n[0]];
    let best: { pos: Pt; cost: number } | null = null;
    for (let off = -4; off <= 4; off += CELL) {
      const t = spineLen * 0.5 + off;
      if (t < 2 || t > spineLen - 1.5) continue;
      const pos: Pt = [start[0] + n[0] * t, start[1] + n[1] * t];
      const a = ray(pos, perp, 60, true), b = ray(pos, [-perp[0], -perp[1]], 60, true);
      let cost = 0;
      for (let s = -b; s <= a; s += CELL) {
        const [cx, cy] = grid.toCell(pos[0] + perp[0] * s, pos[1] + perp[1] * s);
        if (grid.inRange(cx, cy) && grid.structural[grid.idx(cx, cy)]) cost++;
      }
      cost += Math.abs(off) * 0.2;
      if (!best || cost < best.cost) best = { pos, cost };
    }
    if (best) {
      const a = ray(best.pos, perp, 60, true), b = ray(best.pos, [-perp[0], -perp[1]], 60, true);
      const p0: Pt = [best.pos[0] - perp[0] * b, best.pos[1] - perp[1] * b];
      stripe(ctx, p0, perp, a + b, cross);
      ctx.corridors.push(stripPoly(p0, perp, a + b, cross));
    }
  }
}

function stripe(ctx: Ctx, from: Pt, dir: Pt, length: number, width: number) {
  const perp: Pt = [-dir[1], dir[0]];
  const to: Pt = [from[0] + dir[0] * length, from[1] + dir[1] * length];
  const h = width / 2;
  const xs = [from[0] - perp[0] * h, from[0] + perp[0] * h, to[0] - perp[0] * h, to[0] + perp[0] * h];
  const ys = [from[1] - perp[1] * h, from[1] + perp[1] * h, to[1] - perp[1] * h, to[1] + perp[1] * h];
  const [cx0, cy0] = ctx.grid.toCell(Math.min(...xs), Math.min(...ys));
  const [cx1, cy1] = ctx.grid.toCell(Math.max(...xs) - 1e-6, Math.max(...ys) - 1e-6);
  ctx.grid.markReserved(cx0, cy0, cx1 + 1, cy1 + 1);
}

function stripPoly(from: Pt, dir: Pt, length: number, width: number): { polygon: Pt[]; width: number } {
  const perp: Pt = [-dir[1], dir[0]];
  const to: Pt = [from[0] + dir[0] * length, from[1] + dir[1] * length];
  const h = width / 2;
  return {
    polygon: [
      [from[0] - perp[0] * h, from[1] - perp[1] * h], [to[0] - perp[0] * h, to[1] - perp[1] * h],
      [to[0] + perp[0] * h, to[1] + perp[1] * h], [from[0] + perp[0] * h, from[1] + perp[1] * h],
    ].map((p) => [round(p[0]), round(p[1])] as Pt),
    width,
  };
}
const round = (n: number) => Math.round(n * 100) / 100;

// ───────────────────────── rooms ─────────────────────────

const THETAS = [0, 90, 180, 270];

function defaultPreference(type: ZoneType): NonNullable<ZoneRequest["preference"]> {
  switch (type) {
    case "cabin": case "lounge": return "window";
    case "meeting": case "phonebooth": case "storage": case "pantry": return "core_adjacent";
    case "reception": return "entry_adjacent";
    case "cafeteria": return "core_adjacent";
    default: return "none";
  }
}

function placeRoom(ctx: Ctx, kind: UnitKind, params: UnitParams, pref: ZoneRequest["preference"], label: string): boolean {
  const { grid } = ctx;
  const size = unitSize(kind, params, ctx.cat);
  const preference = pref && pref !== "none" ? pref : defaultPreference(kind);
  const doorCells = kind === "cabin" || kind === "meeting" || kind === "phonebooth" || kind === "storage" ? 1.2 : 0;

  const candidates: { score: number; cx0: number; cy0: number; cx1: number; cy1: number; theta: number }[] = [];

  for (const theta of THETAS) {
    const swap = theta === 0 || theta === 180; // front along ±x: depth spans x
    const wc = cells(size.W), dc = cells(size.D);
    const px = swap ? dc : wc, py = swap ? wc : dc;
    const f: Pt = [Math.round(Math.cos((theta * Math.PI) / 180)), Math.round(Math.sin((theta * Math.PI) / 180))];

    for (let cy0 = 0; cy0 + py <= grid.ny; cy0++) {
      for (let cx0 = 0; cx0 + px <= grid.nx; cx0++) {
        const cx1 = cx0 + px, cy1 = cy0 + py;
        if (!grid.rectFree(cx0, cy0, cx1, cy1)) continue;

        // Door approach in front of the room must be clear of solid things.
        if (doorCells > 0) {
          const ap = approachRect(cx0, cy0, cx1, cy1, f, doorCells);
          if (!grid.rectHardFree(ap[0], ap[1], ap[2], ap[3])) continue;
        }

        const s = scoreRect(ctx, cx0, cy0, cx1, cy1, f, theta, preference, kind);
        // Rooms belong against a wall (or another room): a strong bonus keeps the middle of the floor clear for desks.
        candidates.push({ score: s + (backContact(ctx, cx0, cy0, cx1, cy1, f) >= 0.7 ? 6 : 0), cx0, cy0, cx1, cy1, theta });
      }
    }
  }

  // Best first, but only accept a spot that leaves every existing room (and this one) reachable on foot.
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates.slice(0, 60)) {
    const f: Pt = [Math.round(Math.cos((c.theta * Math.PI) / 180)), Math.round(Math.sin((c.theta * Math.PI) / 180))];
    grid.markSolid(c.cx0, c.cy0, c.cx1, c.cy1);
    const ap = approachRect(c.cx0, c.cy0, c.cx1, c.cy1, f, 1.2);
    const apCells = cellsOf(ap);
    if (staysConnected(ctx, apCells)) {
      commitUnit(ctx, kind, params, label, c.cx0, c.cy0, c.cx1, c.cy1, c.theta, size);
      return true;
    }
    grid.unmarkSolid(c.cx0, c.cy0, c.cx1, c.cy1);
  }
  return false;
}

/** Fraction of the cells just behind a rectangle (opposite its front) that are wall, structure or another room. */
function backContact(ctx: Ctx, cx0: number, cy0: number, cx1: number, cy1: number, f: Pt): number {
  const { grid } = ctx;
  const list: [number, number][] = [];
  if (f[1] !== 0) {
    const y = f[1] === 1 ? cy0 - 1 : cy1;
    for (let x = cx0; x < cx1; x++) list.push([x, y]);
  } else {
    const x = f[0] === 1 ? cx0 - 1 : cx1;
    for (let y = cy0; y < cy1; y++) list.push([x, y]);
  }
  return list.filter(([x, y]) => grid.hardBlocked(x, y)).length / Math.max(1, list.length);
}

/** The two layers of cells around a rectangle: a person standing there can step away from it. */
function ringCells(cx0: number, cy0: number, px: number, py: number): [number, number][] {
  const out: [number, number][] = [];
  for (const d of [1, 2]) {
    for (let x = cx0 - d; x <= cx0 + px + d - 1; x++) out.push([x, cy0 - d], [x, cy0 + py + d - 1]);
    for (let y = cy0 - d + 1; y <= cy0 + py + d - 2; y++) out.push([cx0 - d, y], [cx0 + px + d - 1, y]);
  }
  return out;
}

function cellsOf(r: [number, number, number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) out.push([x, y]);
  return out;
}

/** With the tentative solid cells already marked: can every existing access point, and the new one, still be walked to? */
function staysConnected(ctx: Ctx, newAccess: [number, number][]): boolean {
  const { grid, entry } = ctx;
  if (!entry) return true;
  const n = ctx.entryNormal;
  const [sx, sy] = grid.toCell(entry[0] + n[0] * 0.9, entry[1] + n[1] * 0.9);
  const seen = grid.flood(sx, sy);
  const ok = (cells: [number, number][]) => cells.some(([x, y]) => grid.inRange(x, y) && seen[grid.idx(x, y)] === 1);
  if (newAccess.length && !ok(newAccess)) return false;
  return ctx.accessCells.every((a) => ok(a.cells));
}

/** Cells just outside the front edge, where the door opens (about 1.2 m square). */
function approachRect(cx0: number, cy0: number, cx1: number, cy1: number, f: Pt, depthM: number): [number, number, number, number] {
  const d = cells(depthM), mid = (a: number, b: number) => Math.floor((a + b) / 2);
  const wHalf = 3; // 1.5 m wide: covers the door whatever the rounding of an odd-sized rectangle
  if (f[0] === 1) return [cx1, mid(cy0, cy1) - wHalf, cx1 + d, mid(cy0, cy1) + wHalf];
  if (f[0] === -1) return [cx0 - d, mid(cy0, cy1) - wHalf, cx0, mid(cy0, cy1) + wHalf];
  if (f[1] === 1) return [mid(cx0, cx1) - wHalf, cy1, mid(cx0, cx1) + wHalf, cy1 + d];
  return [mid(cx0, cx1) - wHalf, cy0 - d, mid(cx0, cx1) + wHalf, cy0];
}

function scoreRect(ctx: Ctx, cx0: number, cy0: number, cx1: number, cy1: number, f: Pt, theta: number, pref: string, kind: UnitKind): number {
  const { grid } = ctx;
  // Edge cells just outside the back, and the two sides.
  const backEdge: [number, number][] = [], sideEdge: [number, number][] = [];
  const horizontalBack = f[1] !== 0; // front along y => back edge is a row
  if (horizontalBack) {
    const yBack = f[1] === 1 ? cy0 - 1 : cy1;
    for (let x = cx0; x < cx1; x++) backEdge.push([x, yBack]);
    for (let y = cy0; y < cy1; y++) sideEdge.push([cx0 - 1, y], [cx1, y]);
  } else {
    const xBack = f[0] === 1 ? cx0 - 1 : cx1;
    for (let y = cy0; y < cy1; y++) backEdge.push([xBack, y]);
    for (let x = cx0; x < cx1; x++) sideEdge.push([x, cy0 - 1], [x, cy1]);
  }
  const frac = (list: [number, number][], test: (x: number, y: number) => boolean) => list.filter(([x, y]) => test(x, y)).length / Math.max(1, list.length);

  const wallBack = frac(backEdge, (x, y) => grid.hardBlocked(x, y));
  const wallSide = frac(sideEdge, (x, y) => grid.hardBlocked(x, y));
  let score = wallBack * 3 + wallSide * 4;

  const mx = Math.floor((cx0 + cx1) / 2), my = Math.floor((cy0 + cy1) / 2);
  const mi = grid.inRange(mx, my) ? grid.idx(mx, my) : 0;
  const centre = grid.center(mx, my);

  if (pref === "window") {
    const win = frac(backEdge, (x, y) => grid.inRange(x, y) ? grid.windowNear[grid.idx(x, y)] === 1 : false)
      + frac(sideEdge, (x, y) => grid.inRange(x, y) ? grid.windowNear[grid.idx(x, y)] === 1 : false) * 0.3;
    score += win * 3;
  } else if (pref === "core_adjacent") {
    score += (1 - Math.min(grid.coreDist[mi], 14) / 14) * 2.2;
  } else if (pref === "entry_adjacent") {
    score += (1 - Math.min(grid.entryDist[mi], 12) / 12) * 3;
  } else if (pref === "quiet") {
    score += Math.min(grid.entryDist[mi], 25) / 25 * 2;
  }

  if (kind === "reception" && ctx.entry) {
    const toEntry: Pt = [ctx.entry[0] - centre[0], ctx.entry[1] - centre[1]];
    const l = Math.hypot(toEntry[0], toEntry[1]) || 1;
    score += Math.max(0, (toEntry[0] * f[0] + toEntry[1] * f[1]) / l) * 1.2;
  }
  if (kind === "cafeteria" && ctx.cabinCenters.length) {
    const far = Math.min(...ctx.cabinCenters.map((c) => dist(c, centre)));
    score += Math.min(far, 20) / 20 * 1.5;
  }
  // Doors that open onto corridors are easier to reach.
  if (isEnclosed(kind)) {
    const ap = approachRect(cx0, cy0, cx1, cy1, f, 1.2);
    let touching = 0;
    for (let y = ap[1]; y < ap[3]; y++) for (let x = ap[0]; x < ap[2]; x++) if (grid.inRange(x, y) && grid.reserved[grid.idx(x, y)]) touching++;
    score += Math.min(touching / 6, 1) * 0.9;
  }
  return score - (cy0 * grid.nx + cx0) * 1e-7 - theta * 1e-9;
}

function commitUnit(ctx: Ctx, kind: UnitKind, params: UnitParams, label: string, cx0: number, cy0: number, cx1: number, cy1: number, theta: number, size: { W: number; D: number }) {
  const { grid } = ctx;
  const [x0, y0, x1, y1] = grid.rectMetres(cx0, cy0, cx1, cy1);
  const swap = theta === 0 || theta === 180;
  const W = swap ? y1 - y0 : x1 - x0;
  const D = swap ? x1 - x0 : y1 - y0;
  const fr = makeFrame((x0 + x1) / 2, (y0 + y1) / 2, theta, W, D);
  const content = buildUnit(kind, params, fr, ctx.cat, (a, b) => edgeOnPolyline(a, b, ctx.plan.floor.boundary));

  const zoneId = `z${ctx.nextZone++}`;
  ctx.zones.push({
    id: zoneId, type: kind, label,
    polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
    seats: content.seats, enclosed: isEnclosed(kind), door: content.door, facingDeg: theta,
  });
  for (const it of content.items) ctx.placements.push({ id: `p${ctx.nextItem++}`, zoneId, itemId: it.itemId, position: [round(it.position[0]), round(it.position[1])], rotationDeg: it.rotationDeg });
  content.walls.forEach((w, i) => ctx.partitions.push({ id: `${zoneId}-w${i}`, zoneId, a: w.a, b: w.b, glass: w.glass }));

  grid.markSolid(cx0, cy0, cx1, cy1);
  const f: Pt = [Math.round(Math.cos((theta * Math.PI) / 180)), Math.round(Math.sin((theta * Math.PI) / 180))];
  const ap = approachRect(cx0, cy0, cx1, cy1, f, 1.2);
  grid.markReserved(ap[0], ap[1], ap[2], ap[3]);
  const apCells: [number, number][] = [];
  for (let y = ap[1]; y < ap[3]; y++) for (let x = ap[0]; x < ap[2]; x++) apCells.push([x, y]);
  ctx.accessCells.push({ zoneId, cells: apCells });
  if (kind === "cabin") ctx.cabinCenters.push([(x0 + x1) / 2, (y0 + y1) / 2]);
  void size;
}

// ───────────────────────── workstations ─────────────────────────

const STYLE_DESKS: Record<string, number> = { linear_4pack: 2, linear_6pack: 3, linear_8pack: 4, linear_10pack: 5 };

function placeWorkstations(ctx: Ctx, seatsWanted: number, style: string) {
  const perRow = STYLE_DESKS[style] ?? 3;
  const desk = ctx.cat("desk-workstation").footprint;

  // Try both row directions and all four scan corners; stop as soon as one reaches the target, else keep the best.
  let best: { axis: "x" | "y"; order: number; seats: number } | null = null;
  outer: for (const axis of ["x", "y"] as const) {
    for (let order = 0; order < 4; order++) {
      const g = ctx.grid.clone(ctx.plan, ctx.entry);
      const sim: Ctx = { ...ctx, grid: g, zones: [], placements: [], partitions: [], accessCells: [...ctx.accessCells], nextZone: ctx.nextZone, nextItem: ctx.nextItem };
      const seats = packPods(sim, axis, order, perRow, seatsWanted, desk, ctx.aisle);
      if (!best || seats > best.seats) best = { axis, order, seats };
      if (seats >= seatsWanted) break outer;
    }
  }
  const got = packPods(ctx, best!.axis, best!.order, perRow, seatsWanted, desk, ctx.aisle);
  if (seatsWanted < 100000 && got < seatsWanted) ctx.warnings.push(`Only ${got} of ${seatsWanted} workstation seats fit on this floor.`);
}

/** Indices 0..n-1, ascending or descending. */
function* scan(n: number, descending: number) {
  if (descending) for (let i = n - 1; i >= 0; i--) yield i;
  else for (let i = 0; i < n; i++) yield i;
}

/** Raster-scan packing of back-to-back desk pods, with reserved aisles around each pod. */
function packPods(ctx: Ctx, axis: "x" | "y", order: number, perRow: number, want: number, desk: { width: number; depth: number }, aisle: number): number {
  const { grid } = ctx;
  let seats = 0;
  let podNo = 0;

  const rowDepth = desk.depth + 0.6; // desk plus chair
  const tryPack = (n: number): boolean => {
    let placedAny = false;
    const across = cells(n * desk.width), depth = cells(rowDepth * 2);
    const px = axis === "x" ? across : depth, py = axis === "x" ? depth : across;
    for (const cy0 of scan(grid.ny - py + 1, order & 1)) {
      for (const cx0 of scan(grid.nx - px + 1, order & 2)) {
        if (seats >= want) break;
        if (!grid.rectFree(cx0, cy0, cx0 + px, cy0 + py)) continue;
        grid.markSolid(cx0, cy0, cx0 + px, cy0 + py);
        const ring = ringCells(cx0, cy0, px, py);
        if (!staysConnected(ctx, ring)) {
          grid.unmarkSolid(cx0, cy0, cx0 + px, cy0 + py);
          continue;
        }
        const remaining = want - seats;
        const desksPerRow = Math.min(n, Math.ceil(remaining / 2));
        const built = commitPod(ctx, axis, cx0, cy0, px, py, n, desksPerRow, remaining, desk, rowDepth, podNo++);
        seats += built;
        placedAny = true;
        // Reserve aisles: long sides get a full aisle, short ends a cross-aisle.
        const endGap = cells(0.75), side = cells(aisle);
        if (axis === "x") {
          grid.markReserved(cx0 - endGap, cy0 - side, cx0 + px + endGap, cy0);
          grid.markReserved(cx0 - endGap, cy0 + py, cx0 + px + endGap, cy0 + py + side);
          grid.markReserved(cx0 - endGap, cy0, cx0, cy0 + py);
          grid.markReserved(cx0 + px, cy0, cx0 + px + endGap, cy0 + py);
        } else {
          grid.markReserved(cx0 - side, cy0 - endGap, cx0, cy0 + py + endGap);
          grid.markReserved(cx0 + px, cy0 - endGap, cx0 + px + side, cy0 + py + endGap);
          grid.markReserved(cx0, cy0 - endGap, cx0 + px, cy0);
          grid.markReserved(cx0, cy0 + py, cx0 + px, cy0 + py + endGap);
        }
      }
    }
    return placedAny;
  };

  tryPack(perRow);
  if (seats < want) tryPack(2);
  if (seats < want) tryPack(1);
  // Single rows of desks along walls fill the strips a full pod cannot use.
  if (seats < want) seats += fillRows(ctx, want - seats, order, desk, ctx.aisle, perRow);
  return seats;
}

/** Single desk rows with their backs to a wall, users facing into the room. */
function fillRows(ctx: Ctx, want: number, order: number, desk: { width: number; depth: number }, aisle: number, perRow: number): number {
  const { grid } = ctx;
  let seats = 0;
  const depthM = desk.depth + 0.6;
  for (const n of [perRow, 2, 1]) {
    for (const theta of THETAS) {
      const swap = theta === 0 || theta === 180;
      const ac = cells(n * desk.width), dc = cells(depthM);
      const px = swap ? dc : ac, py = swap ? ac : dc;
      const f: Pt = [Math.round(Math.cos((theta * Math.PI) / 180)), Math.round(Math.sin((theta * Math.PI) / 180))];
      for (const cy0 of scan(grid.ny - py + 1, order & 1)) {
        for (const cx0 of scan(grid.nx - px + 1, order & 2)) {
          if (seats >= want) break;
          if (!grid.rectFree(cx0, cy0, cx0 + px, cy0 + py)) continue;
          if (backContact(ctx, cx0, cy0, cx0 + px, cy0 + py, f) < 0.95) continue;
          grid.markSolid(cx0, cy0, cx0 + px, cy0 + py);
          const ring = ringCells(cx0, cy0, px, py);
          if (!staysConnected(ctx, ring)) {
            grid.unmarkSolid(cx0, cy0, cx0 + px, cy0 + py);
            continue;
          }
          const [x0, y0, x1, y1] = grid.rectMetres(cx0, cy0, cx0 + px, cy0 + py);
          const fr = makeFrame((x0 + x1) / 2, (y0 + y1) / 2, theta, swap ? y1 - y0 : x1 - x0, swap ? x1 - x0 : y1 - y0);
          const zoneId = `z${ctx.nextZone++}`;
          const take = Math.min(n, want - seats);
          const start = -(take * desk.width) / 2;
          const chair = ctx.nextZone % 2 === 0 ? "chair-task-grey" : "chair-task-blue";
          for (let k = 0; k < take; k++) {
            const dx = start + desk.width * (k + 0.5);
            const dP = toPlan(fr, dx, -fr.D / 2 + desk.depth / 2 + 0.01);
            const cP = toPlan(fr, dx, -fr.D / 2 + desk.depth + 0.25);
            ctx.placements.push({ id: `p${ctx.nextItem++}`, zoneId, itemId: "desk-workstation", position: [round(dP[0]), round(dP[1])], rotationDeg: theta });
            ctx.placements.push({ id: `p${ctx.nextItem++}`, zoneId, itemId: chair, position: [round(cP[0]), round(cP[1])], rotationDeg: (theta + 180) % 360 });
          }
          seats += take;
          ctx.zones.push({ id: zoneId, type: "workstation", label: "Open plan", polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], seats: take, enclosed: false });
          // Aisle in front of the row.
          const side = cells(aisle);
          const ap: [number, number, number, number] = f[1] === 1 ? [cx0, cy0 + py, cx0 + px, cy0 + py + side] : f[1] === -1 ? [cx0, cy0 - side, cx0 + px, cy0] : f[0] === 1 ? [cx0 + px, cy0, cx0 + px + side, cy0 + py] : [cx0 - side, cy0, cx0, cy0 + py];
          grid.markReserved(ap[0], ap[1], ap[2], ap[3]);
          ctx.accessCells.push({ zoneId, cells: ring });
        }
      }
    }
  }
  return seats;
}

function commitPod(ctx: Ctx, axis: "x" | "y", cx0: number, cy0: number, px: number, py: number, n: number, desksPerRow: number, remaining: number, desk: { width: number; depth: number }, rowDepth: number, podNo: number): number {
  const { grid } = ctx;
  const [x0, y0, x1, y1] = grid.rectMetres(cx0, cy0, cx0 + px, cy0 + py);
  const zoneId = `z${ctx.nextZone++}`;
  const chairId = podNo % 2 === 0 ? "chair-task-grey" : "chair-task-blue";
  let seats = 0;

  // Two rows back to back. Row A (low side) desks face away from the centre line; users sit beyond them.
  const rowsAlong = axis === "x";
  const centreLine = rowsAlong ? (y0 + y1) / 2 : (x0 + x1) / 2;
  const span = rowsAlong ? x1 - x0 : y1 - y0;
  const used = desksPerRow * desk.width;
  const start = (rowsAlong ? x0 : y0) + (span - used) / 2;

  for (let row = 0; row < 2; row++) {
    const dir = row === 0 ? -1 : 1; // side of the centre line
    const count = row === 0 ? desksPerRow : Math.min(desksPerRow, Math.max(0, remaining - desksPerRow));
    for (let k = 0; k < count && seats < remaining; k++) {
      const along = start + desk.width * (k + 0.5);
      const deskC = centreLine + dir * (desk.depth / 2 + 0.01);
      const chairC = centreLine + dir * (desk.depth + 0.25);
      // Desk front faces the user; user sits on the far side of the desk from the centre line.
      const deskTheta = rowsAlong ? (dir === -1 ? 270 : 90) : (dir === -1 ? 180 : 0);
      const chairTheta = (deskTheta + 180) % 360;
      const dPos: Pt = rowsAlong ? [along, deskC] : [deskC, along];
      const cPos: Pt = rowsAlong ? [along, chairC] : [chairC, along];
      ctx.placements.push({ id: `p${ctx.nextItem++}`, zoneId, itemId: "desk-workstation", position: [round(dPos[0]), round(dPos[1])], rotationDeg: deskTheta });
      ctx.placements.push({ id: `p${ctx.nextItem++}`, zoneId, itemId: chairId, position: [round(cPos[0]), round(cPos[1])], rotationDeg: chairTheta });
      seats++;
    }
  }
  void n; void rowDepth;

  ctx.zones.push({ id: zoneId, type: "workstation", label: "Open plan", polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], seats, enclosed: false });
  grid.markSolid(cx0, cy0, cx0 + px, cy0 + py);
  ctx.accessCells.push({ zoneId, cells: ringCells(cx0, cy0, px, py) });
  return seats;
}

// ───────────────────────── accents: print station and plants ─────────────────────────

function placeAccents(ctx: Ctx) {
  const { grid } = ctx;
  const area = grid.inside.reduce((s, v) => s + v, 0) * CELL * CELL;

  // Print station near a core: printer + cabinet + water cooler, front facing into the floor.
  const stations = area > 500 ? 2 : area > 100 ? 1 : 0;
  for (let s = 0; s < stations; s++) {
    const W = 2.25, D = 1.0;
    let best: { score: number; cx0: number; cy0: number; theta: number; px: number; py: number } | null = null;
    for (const theta of THETAS) {
      const swap = theta === 0 || theta === 180;
      const wc = cells(W), dc = cells(D);
      const px = swap ? dc : wc, py = swap ? wc : dc;
      const f: Pt = [Math.round(Math.cos((theta * Math.PI) / 180)), Math.round(Math.sin((theta * Math.PI) / 180))];
      for (let cy0 = 0; cy0 + py <= grid.ny; cy0++) {
        for (let cx0 = 0; cx0 + px <= grid.nx; cx0++) {
          if (!grid.rectFree(cx0, cy0, cx0 + px, cy0 + py)) continue;
          const ap = approachRect(cx0, cy0, cx0 + px, cy0 + py, f, 0.9);
          if (!grid.rectHardFree(ap[0], ap[1], ap[2], ap[3])) continue;
          const sc = scoreRect(ctx, cx0, cy0, cx0 + px, cy0 + py, f, theta, "core_adjacent", "storage");
          if (best && sc <= best.score) continue;
          grid.markSolid(cx0, cy0, cx0 + px, cy0 + py);
          const ok = staysConnected(ctx, cellsOf(ap));
          grid.unmarkSolid(cx0, cy0, cx0 + px, cy0 + py);
          if (ok) best = { score: sc, cx0, cy0, theta, px, py };
        }
      }
    }
    if (!best) break;
    const [x0, y0, x1, y1] = grid.rectMetres(best.cx0, best.cy0, best.cx0 + best.px, best.cy0 + best.py);
    const swap = best.theta === 0 || best.theta === 180;
    const fr = makeFrame((x0 + x1) / 2, (y0 + y1) / 2, best.theta, swap ? y1 - y0 : x1 - x0, swap ? x1 - x0 : y1 - y0);
    const zoneId = `z${ctx.nextZone++}`;
    const put = (id: string, dx: number, dz: number) => {
      const p: Pt = [fr.cx + dx * fr.u[0] + dz * fr.f[0], fr.cy + dx * fr.u[1] + dz * fr.f[1]];
      ctx.placements.push({ id: `p${ctx.nextItem++}`, zoneId, itemId: id, position: [round(p[0]), round(p[1])], rotationDeg: best!.theta });
    };
    put("printer", -0.7, -fr.D / 2 + 0.4);
    put("cabinet", 0.3, -fr.D / 2 + 0.37);
    put("water-cooler", 0.9, -fr.D / 2 + 0.15);
    ctx.zones.push({ id: zoneId, type: "storage", label: "Print station", polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], seats: 0, enclosed: false });
    grid.markSolid(best.cx0, best.cy0, best.cx0 + best.px, best.cy0 + best.py);
    const f2: Pt = [Math.round(Math.cos((best.theta * Math.PI) / 180)), Math.round(Math.sin((best.theta * Math.PI) / 180))];
    const ap = approachRect(best.cx0, best.cy0, best.cx0 + best.px, best.cy0 + best.py, f2, 0.9);
    grid.markReserved(ap[0], ap[1], ap[2], ap[3]);
  }

  // Plants against walls, spaced out.
  const target = Math.min(10, Math.floor(area / 70));
  const plants = ["plant-fiddle", "plant-agave"];
  const placed: Pt[] = [];
  const pc = cells(0.9);
  for (let n = 0; n < target; n++) {
    let best: { score: number; cx0: number; cy0: number } | null = null;
    for (let cy0 = 0; cy0 + pc <= grid.ny; cy0++) {
      for (let cx0 = 0; cx0 + pc <= grid.nx; cx0++) {
        if (!grid.rectFree(cx0, cy0, cx0 + pc, cy0 + pc)) continue;
        const c = grid.center(cx0 + pc / 2, cy0 + pc / 2);
        if (placed.some((p) => dist(p, c) < 7)) continue;
        let wall = 0;
        for (let k = 0; k < pc; k++) {
          if (grid.hardBlocked(cx0 - 1, cy0 + k)) wall++;
          if (grid.hardBlocked(cx0 + pc, cy0 + k)) wall++;
          if (grid.hardBlocked(cx0 + k, cy0 - 1)) wall++;
          if (grid.hardBlocked(cx0 + k, cy0 + pc)) wall++;
        }
        if (wall === 0) continue;
        const mi = grid.idx(Math.min(grid.nx - 1, cx0 + (pc >> 1)), Math.min(grid.ny - 1, cy0 + (pc >> 1)));
        const sc = grid.windowNear[mi] * 1.5 + wall * 0.1 - (cy0 * grid.nx + cx0) * 1e-7;
        if (best && sc <= best.score) continue;
        grid.markSolid(cx0, cy0, cx0 + pc, cy0 + pc);
        const ok = staysConnected(ctx, []);
        grid.unmarkSolid(cx0, cy0, cx0 + pc, cy0 + pc);
        if (ok) best = { score: sc, cx0, cy0 };
      }
    }
    if (!best) break;
    const [x0, y0, x1, y1] = grid.rectMetres(best.cx0, best.cy0, best.cx0 + pc, best.cy0 + pc);
    const zoneId = `z${ctx.nextZone++}`;
    const c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
    placed.push(c);
    ctx.placements.push({ id: `p${ctx.nextItem++}`, zoneId, itemId: plants[n % plants.length], position: [round(c[0]), round(c[1])], rotationDeg: 0 });
    ctx.zones.push({ id: zoneId, type: "lounge", label: "Planting", polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], seats: 0, enclosed: false });
    grid.markSolid(best.cx0, best.cy0, best.cx0 + pc, best.cy0 + pc);
  }
}

// ───────────────────────── finish: validate, measure, report ─────────────────────────

function finish(ctx: Ctx, req: Requirements, catalog: Catalog, opts: GenerateOptions): GenerateResult {
  const layout: Layout = {
    schemaVersion: "1.0",
    floorPlanId: ctx.plan.id,
    generatedAt: new Date().toISOString(),
    mode: "rule-based",
    zones: ctx.zones,
    placements: ctx.placements,
    partitions: ctx.partitions,
    corridors: ctx.corridors,
    metrics: undefined as never,
    report: undefined as never,
  };

  const problems = validateLayout(ctx.plan, layout, catalog, ctx.grid, ctx.entry, ctx.accessCells);
  if (problems.badZones.size) {
    const drop = problems.badZones;
    layout.zones = layout.zones.filter((z) => !drop.has(z.id));
    layout.placements = layout.placements.filter((p) => !drop.has(p.zoneId));
    layout.partitions = layout.partitions.filter((p) => !drop.has(p.zoneId));
    for (const msg of problems.messages) ctx.warnings.push(msg);
  }

  const requested = req.zones.filter((z) => z.type === "workstation").reduce((n, z) => n + (z.seats ?? 0), 0);
  layout.metrics = computeMetrics(ctx.plan, layout, catalog, requested, circulationArea(ctx));
  layout.report = buildReport(ctx, layout, req, opts);
  return { layout, clean: problems.badZones.size === 0 };
}

/** Reserved (walkable) cells that no zone took: corridors, aisles and door approaches. */
function circulationArea(ctx: Ctx): number {
  const g = ctx.grid;
  let n = 0;
  for (let i = 0; i < g.reserved.length; i++) if (g.reserved[i] && g.inside[i] && !g.solid[i] && !g.structural[i]) n++;
  return n * CELL * CELL;
}

function buildReport(ctx: Ctx, layout: Layout, req: Requirements, opts: GenerateOptions): Layout["report"] {
  const m = layout.metrics;
  const warnings = [...ctx.warnings];
  const suggestions: string[] = [];
  const minPerSeat = req.constraints?.minAreaPerSeat ?? 4.5;
  const workSeats = layout.zones.filter((z) => z.type === "workstation").reduce((n, z) => n + z.seats, 0);

  for (const name of ctx.unplaced) warnings.push(`${name} could not be placed: no room left on this floor.`);
  const seatShort = !opts.unlimitedSeats && m.seatsRequested > 0 && workSeats < m.seatsRequested;
  if (workSeats > 0 && m.areaPerSeat < minPerSeat) warnings.push(`Area per seat is ${m.areaPerSeat.toFixed(1)} m², below the ${minPerSeat} m² target; the layout is dense.`);

  const feasible = ctx.unplaced.length === 0 && !seatShort;
  if (!feasible) suggestions.push("Reduce the seat count or remove a room, then generate again.");

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const explanation =
    `${workSeats} workstation seats are arranged in back-to-back desk pods with ${ctx.aisle.toFixed(1)} m aisles. ` +
    `${layout.zones.filter((z) => z.enclosed).length} enclosed rooms sit against the walls, with doors opening onto the circulation routes; ` +
    `the entry leads straight into a main corridor. Rooms and zones occupy ${m.occupiedAreaSqM.toFixed(0)} m² (${pct(m.utilization)} of the floor), ` +
    `leaving ${m.freeAreaSqM.toFixed(0)} m² free for movement.`;
  void layout;
  return { feasible, warnings, suggestions, explanation };
}
