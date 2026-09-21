import type { FloorPlan, ImportEdge, Obstacle, Opening, PlanExtraction, Pt } from "../../../shared/types";
import { area, dist } from "../../../shared/geometry";

export interface ReconstructOptions {
  /** Pixel size of the image the normalised coordinates refer to (only the aspect ratio matters). */
  width: number;
  height: number;
  ceilingHeightM?: number;
  /** Real length of the longest outer wall, when the drawing prints no usable dimensions. */
  longestWallMeters?: number;
}

export interface Reconstruction {
  plan: FloorPlan | null;
  edges: ImportEdge[];
  needsScale: boolean;
  notes: string[];
}

const AXIS_TOL_DEG = 12;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Solve  min Σ wp (X_i - p_i)² + Σ wc (X_j - X_i - d)²  for one axis (dense normal equations, n is small). */
function solveAxis(prior: number[], cons: { i: number; j: number; d: number }[]): number[] {
  const n = prior.length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  const wp = 1e-3, wc = 1;
  for (let i = 0; i < n; i++) {
    A[i][i] += wp;
    b[i] += wp * prior[i];
  }
  for (const { i, j, d } of cons) {
    A[i][i] += wc;
    A[j][j] += wc;
    A[i][j] -= wc;
    A[j][i] -= wc;
    b[j] += wc * d;
    b[i] -= wc * d;
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    const piv = A[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / piv;
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / (A[r][r] || 1e-12);
  }
  return x;
}

/** Least-squares line  m = a*px + b  (falls back to scale-only when the points don't spread). */
function fitLine(px: number[], m: number[], fallbackScale: number): (v: number) => number {
  const n = px.length;
  const mx = px.reduce((s, v) => s + v, 0) / n, my = m.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) (sxx += (px[i] - mx) ** 2, sxy += (px[i] - mx) * (m[i] - my));
  if (sxx < 1e-9) return (v) => my + (v - mx) * fallbackScale;
  const a = sxy / sxx;
  return (v) => my + (v - mx) * a;
}

/**
 * Turn what the AI read (normalised, approximate) into exact metres.
 *
 * Every wall that is nearly horizontal or vertical is forced to be exactly so; every printed dimension becomes a
 * hard length; walls without one are sized from the scale the printed ones imply. All of that is solved together,
 * so the outline always closes and the printed numbers win over the pixels.
 */
export function reconstructPlan(ex: PlanExtraction, opt: ReconstructOptions): Reconstruction {
  const notes: string[] = [];
  const W = opt.width, H = opt.height;

  // Drop repeated corners, remembering which old edge each new edge came from.
  const raw = ex.vertices.map(([x, y]) => [x * W, y * H] as Pt);
  const keep: number[] = [];
  raw.forEach((p, i) => {
    if (keep.length === 0 || dist(p, raw[keep[keep.length - 1]]) > 0.002 * Math.max(W, H)) keep.push(i);
  });
  if (keep.length > 1 && dist(raw[keep[0]], raw[keep[keep.length - 1]]) <= 0.002 * Math.max(W, H)) keep.pop();
  const n = keep.length;
  if (n < 3) return { plan: null, edges: [], needsScale: false, notes: ["The AI did not find a usable floor outline in this image."] };
  const px = keep.map((i) => raw[i]);
  const newEdgeOf = (oldEdge: number) => {
    let idx = -1;
    keep.forEach((k, ni) => k <= ((oldEdge % raw.length) + raw.length) % raw.length && (idx = ni));
    return idx < 0 ? 0 : idx;
  };

  // Which walls are axis-aligned, and what each printed dimension says.
  const dir = px.map((p, i) => {
    const q = px[(i + 1) % n];
    return { dx: q[0] - p[0], dy: q[1] - p[1], len: Math.hypot(q[0] - p[0], q[1] - p[1]) };
  });
  const orient = dir.map((d) => {
    const ang = (Math.abs((Math.atan2(d.dy, d.dx) * 180) / Math.PI) + 360) % 180;
    if (Math.min(ang, 180 - ang) < AXIS_TOL_DEG) return "H" as const;
    if (Math.abs(ang - 90) < AXIS_TOL_DEG) return "V" as const;
    return "free" as const;
  });
  const printed = new Map<number, { text: string; meters: number }>();
  for (const d of ex.edgeDimensions) {
    if (d.meters === null) continue;
    const e = newEdgeOf(d.edge);
    if (dir[e].len > 0) printed.set(e, { text: d.text, meters: d.meters });
  }

  // Scale (metres per pixel) from the printed walls; robust to a misread one via the median.
  let scale: number | null = null;
  const ratios = [...printed.entries()].map(([e, p]) => p.meters / dir[e].len).sort((a, b) => a - b);
  if (ratios.length) scale = ratios[Math.floor(ratios.length / 2)];
  let needsScale = false;
  if (scale === null) {
    if (opt.longestWallMeters && opt.longestWallMeters > 0) {
      const longest = Math.max(...dir.map((d) => d.len));
      scale = opt.longestWallMeters / longest;
      notes.push(`No dimensions were readable, so the drawing was scaled so its longest wall is ${opt.longestWallMeters} m.`);
    } else {
      needsScale = true;
      scale = 1 / Math.max(W, H); // placeholder so the shape is still shown
      notes.push("No printed dimensions could be read. Enter the real length of the longest wall to size the plan.");
    }
  }

  // Solve each axis: axis-aligned walls stay straight, printed walls get their printed length.
  const priorX = px.map((p) => p[0] * scale!), priorY = px.map((p) => p[1] * scale!);
  const consX: { i: number; j: number; d: number }[] = [], consY: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = printed.get(i);
    if (orient[i] === "V") consX.push({ i, j, d: 0 });
    if (orient[i] === "H") consY.push({ i, j, d: 0 });
    if (p && orient[i] === "H") consX.push({ i, j, d: Math.sign(dir[i].dx) * p.meters });
    if (p && orient[i] === "V") consY.push({ i, j, d: Math.sign(dir[i].dy) * p.meters });
  }
  const X = solveAxis(priorX, consX), Y = solveAxis(priorY, consY);

  // Image space (y down) -> plan space (y up), origin at the bottom-left corner.
  const minX = Math.min(...X), maxY = Math.max(...Y);
  const boundary: Pt[] = X.map((x, i) => [r2(x - minX), r2(maxY - Y[i])] as Pt);

  // Mapping for everything else drawn on the page (pixels -> metres), fitted to the solved corners.
  const mapX = fitLine(px.map((p) => p[0]), X, scale);
  const mapY = fitLine(px.map((p) => p[1]), Y, scale);
  const toPlan = (nx: number, ny: number): Pt => [r2(mapX(nx * W) - minX), r2(maxY - mapY(ny * H))];

  // Report every wall: printed vs built.
  const edges: ImportEdge[] = boundary.map((p, i) => {
    const built = dist(p, boundary[(i + 1) % n]);
    const pr = printed.get(i);
    const mismatch = pr ? Math.abs(built - pr.meters) > Math.max(0.05, pr.meters * 0.01) : false;
    return { index: i, printed: pr?.text ?? null, printedMeters: pr?.meters ?? null, builtMeters: r2(built), source: pr ? ("printed" as const) : ("estimated" as const), mismatch };
  });
  if (edges.some((e) => e.mismatch)) notes.push("Some printed dimensions disagree with each other or the drawing. They are marked below: check those numbers.");
  const a = area(boundary);
  if (!needsScale && (a < 15 || a > 60000)) notes.push(`The rebuilt floor is ${Math.round(a)} m², which looks wrong. Check the units and dimensions.`);

  // Openings sit on the walls at the fractions the AI gave, with printed widths when there are any.
  const openings: Opening[] = [];
  const counters = { door: 0, window: 0 };
  const ceilingH = opt.ceilingHeightM ?? ex.ceilingHeightM ?? 3.0;
  // Each opening is placed by the wall it lies on: nearest outline edge (in image pixels) to its middle.
  const wallOf = (mx: number, my: number) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const a = px[i], b = px[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((mx - a[0]) * dx + (my - a[1]) * dy) / l2));
      const d = Math.hypot(mx - (a[0] + t * dx), my - (a[1] + t * dy));
      if (d < bestD) (bestD = d, best = i);
    }
    return { edge: best, distPx: bestD };
  };
  const tOn = (i: number, x: number, y: number) => {
    const a = px[i], b = px[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  };
  const opRefs: typeof ex.openings = [];
  for (const o of ex.openings) {
    const mx = ((o.x0 + o.x1) / 2) * W, my = ((o.y0 + o.y1) / 2) * H;
    const { edge: e, distPx } = wallOf(mx, my);
    if (distPx > 0.06 * Math.max(W, H)) {
      notes.push(`An opening the AI reported does not touch any outer wall, so it was skipped.`);
      continue;
    }
    const A = boundary[e], B = boundary[(e + 1) % n];
    const len = dist(A, B);
    if (len < 0.3) continue;
    let ta = tOn(e, o.x0 * W, o.y0 * H), tb = tOn(e, o.x1 * W, o.y1 * H);
    let t0 = Math.min(ta, tb), t1 = Math.max(ta, tb);
    if (t1 - t0 < 0.004) continue;
    if (o.widthMeters && o.widthMeters < len) {
      const mid = (t0 + t1) / 2, half = o.widthMeters / len / 2;
      t0 = Math.max(0, mid - half);
      t1 = Math.min(1, mid + half);
    }
    const at = (t: number): Pt => [r2(A[0] + (B[0] - A[0]) * t), r2(A[1] + (B[1] - A[1]) * t)];
    counters[o.type]++;
    opRefs.push(o); // kept parallel to `openings` so the entry door can be matched up below
    openings.push(
      o.type === "door"
        ? { id: `door-${counters.door}`, type: "door", wall: [at(t0), at(t1)], height: Math.min(2.1, ceilingH - 0.1), isEntry: false }
        : { id: `win-${counters.window}`, type: "window", wall: [at(t0), at(t1)], height: Math.min(1.5, ceilingH - 1.0), sillHeight: 0.9 },
    );
  }
  // Exactly one entry: the one the AI marked (largest wins), else the widest door.
  const doors = openings.filter((o) => o.type === "door");
  if (doors.length) {
    // Openings were created in the same order as the door entries of opRefs that survived.
    const doorRefs = opRefs.filter((o) => o.type === "door");
    const markedAt = doorRefs.findIndex((o) => o.isEntry);
    const widest = (list: Opening[]) => [...list].sort((p, q) => dist(q.wall[0], q.wall[1]) - dist(p.wall[0], p.wall[1]))[0];
    const entry = markedAt >= 0 && doors[markedAt] ? doors[markedAt] : widest(doors);
    entry.isEntry = true;
    if (markedAt < 0) notes.push("No entrance was marked on the drawing, so the widest door was chosen. Change it if that is wrong.");
  } else {
    notes.push("No doors were found in the outer walls. Add an entrance before generating a layout.");
  }

  // Obstacles: rectangles are squared up; columns get a sensible size.
  const obstacles: Obstacle[] = [];
  const oc = { core: 0, column: 0, shaft: 0, stair: 0 };
  for (const b of ex.obstacles) {
    const pts = b.polygon.map(([x, y]) => toPlan(x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    if (b.type === "column") {
      const side = Math.max(0.3, Math.min(1.0, Math.max(maxx - minx, maxy - miny)));
      const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
      [minx, maxx, miny, maxy] = [cx - side / 2, cx + side / 2, cy - side / 2, cy + side / 2];
    }
    if (maxx - minx < 0.2 || maxy - miny < 0.2) continue;
    // Cores hug walls: pull an edge that is within 0.4 m of an outer wall onto it, then keep the block inside.
    for (let i = 0; i < n; i++) {
      const A = boundary[i], B = boundary[(i + 1) % n];
      if (Math.abs(A[0] - B[0]) < 0.01) {
        const wx = A[0], lo = Math.min(A[1], B[1]), hi = Math.max(A[1], B[1]);
        if (maxy > lo && miny < hi) {
          if (Math.abs(minx - wx) < 0.4) minx = wx;
          if (Math.abs(maxx - wx) < 0.4) maxx = wx;
        }
      } else if (Math.abs(A[1] - B[1]) < 0.01) {
        const wy = A[1], lo = Math.min(A[0], B[0]), hi = Math.max(A[0], B[0]);
        if (maxx > lo && minx < hi) {
          if (Math.abs(miny - wy) < 0.4) miny = wy;
          if (Math.abs(maxy - wy) < 0.4) maxy = wy;
        }
      }
    }
    oc[b.type]++;
    obstacles.push({
      id: `${b.type === "column" ? "col" : b.type}-${oc[b.type]}`,
      type: b.type,
      polygon: [[r2(minx), r2(miny)], [r2(maxx), r2(miny)], [r2(maxx), r2(maxy)], [r2(minx), r2(maxy)]],
      height: ceilingH,
      ...(b.label ? { label: b.label.slice(0, 80) } : {}),
    });
  }

  const slug = (ex.name ?? "imported-plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "imported-plan";
  const plan: FloorPlan = {
    schemaVersion: "1.0",
    id: slug,
    name: ex.name?.trim() || "Imported floor plan",
    description: "Read from a plan image by AI, then rebuilt from its printed dimensions.",
    units: "meters",
    floor: { boundary, ceilingHeight: ceilingH },
    obstacles,
    openings,
    circulation: { mainCorridorWidth: 1.5, secondaryCorridorWidth: 1.2, minClearanceToWall: 0.6 },
  };
  return { plan, edges, needsScale, notes };
}
