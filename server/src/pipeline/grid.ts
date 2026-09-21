import type { FloorPlan, Pt } from "../../../shared/types";
import { bbox, dist, distPointToSegment, pointInPolygon, segmentsProperlyCross } from "../../../shared/geometry";

export const CELL = 0.25;

/** True when an axis-aligned rectangle overlaps a polygon (vertex containment, corner containment, or edge crossing). */
export function rectIntersectsPolygon(x0: number, y0: number, x1: number, y1: number, poly: Pt[]): boolean {
  for (const p of poly) if (p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1) return true;
  const corners: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const strict = (p: Pt) => pointInPolygon(p, poly) && !nearEdge(p, poly);
  if (corners.some(strict)) return true;
  if (strict([(x0 + x1) / 2, (y0 + y1) / 2])) return true;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < poly.length; j++) {
      if (segmentsProperlyCross(corners[i], corners[(i + 1) % 4], poly[j], poly[(j + 1) % poly.length])) return true;
    }
  }
  return false;
}

function nearEdge(p: Pt, poly: Pt[]) {
  for (let i = 0; i < poly.length; i++) if (distPointToSegment(p, poly[i], poly[(i + 1) % poly.length]) < 1e-6) return true;
  return false;
}

/**
 * The single source of truth for every placement decision: the floor rasterised into 0.25 m cells.
 * Rectangles are always whole cells, so nothing can ever land at a fractional overlap.
 */
export class Grid {
  readonly cell = CELL;
  readonly ox: number;
  readonly oy: number;
  readonly nx: number;
  readonly ny: number;
  inside: Uint8Array;
  structural: Uint8Array;
  solid: Uint8Array;
  reserved: Uint8Array;
  windowNear: Uint8Array;
  coreDist: Float32Array;
  entryDist: Float32Array;

  private satAll!: Int32Array;
  private satHard!: Int32Array;
  private dirty = true;

  constructor(plan: FloorPlan, entry: Pt | null, source?: Grid) {
    const box = bbox(plan.floor.boundary);
    this.ox = Math.floor(box.minX / CELL) * CELL;
    this.oy = Math.floor(box.minY / CELL) * CELL;
    this.nx = Math.ceil((box.maxX - this.ox) / CELL);
    this.ny = Math.ceil((box.maxY - this.oy) / CELL);
    const n = this.nx * this.ny;

    if (source) {
      this.inside = source.inside;
      this.structural = source.structural;
      this.windowNear = source.windowNear;
      this.coreDist = source.coreDist;
      this.entryDist = source.entryDist;
      this.solid = source.solid.slice();
      this.reserved = source.reserved.slice();
      return;
    }

    this.inside = new Uint8Array(n);
    this.structural = new Uint8Array(n);
    this.solid = new Uint8Array(n);
    this.reserved = new Uint8Array(n);
    this.windowNear = new Uint8Array(n);
    this.coreDist = new Float32Array(n).fill(99);
    this.entryDist = new Float32Array(n).fill(99);

    const boundary = plan.floor.boundary;
    const windows = plan.openings.filter((o) => o.type === "window");
    const cores = plan.obstacles.filter((o) => o.type !== "column");

    for (let cy = 0; cy < this.ny; cy++) {
      for (let cx = 0; cx < this.nx; cx++) {
        const x0 = this.ox + cx * CELL, y0 = this.oy + cy * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
        const i = cy * this.nx + cx;
        const pts: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, (y0 + y1) / 2]];
        this.inside[i] = pts.every((p) => pointInPolygon(p, boundary, 1e-6)) ? 1 : 0;
        if (!this.inside[i]) continue;

        const c = pts[4];
        for (const o of plan.obstacles) {
          const b = o.type === "column" ? 0.12 : 0.02;
          if (rectIntersectsPolygon(x0 - b, y0 - b, x1 + b, y1 + b, o.polygon)) {
            this.structural[i] = 1;
            break;
          }
        }
        for (const w of windows) {
          if (distPointToSegment(c, w.wall[0], w.wall[1]) < 1.1) {
            this.windowNear[i] = 1;
            break;
          }
        }
        let cd = 99;
        for (const o of cores) {
          const d = pointInPolygon(c, o.polygon) ? 0 : Math.min(...o.polygon.map((p, k) => distPointToSegment(c, p, o.polygon[(k + 1) % o.polygon.length])));
          if (d < cd) cd = d;
        }
        this.coreDist[i] = cd;
        if (entry) this.entryDist[i] = dist(c, entry);
      }
    }
  }

  clone(plan: FloorPlan, entry: Pt | null): Grid {
    return new Grid(plan, entry, this);
  }

  idx(cx: number, cy: number) {
    return cy * this.nx + cx;
  }
  inRange(cx: number, cy: number) {
    return cx >= 0 && cy >= 0 && cx < this.nx && cy < this.ny;
  }
  toCell(x: number, y: number): [number, number] {
    return [Math.floor((x - this.ox) / CELL + 1e-9), Math.floor((y - this.oy) / CELL + 1e-9)];
  }
  cx(cx: number) { return this.ox + cx * CELL; }
  cy(cy: number) { return this.oy + cy * CELL; }
  center(cx: number, cy: number): Pt {
    return [this.ox + (cx + 0.5) * CELL, this.oy + (cy + 0.5) * CELL];
  }

  /** Cell rect [cx0,cx1) x [cy0,cy1) in metres. */
  rectMetres(cx0: number, cy0: number, cx1: number, cy1: number): [number, number, number, number] {
    return [this.cx(cx0), this.cy(cy0), this.cx(cx1), this.cy(cy1)];
  }

  hardBlocked(cx: number, cy: number) {
    if (!this.inRange(cx, cy)) return true;
    const i = this.idx(cx, cy);
    return !this.inside[i] || this.structural[i] === 1 || this.solid[i] === 1;
  }
  blocked(cx: number, cy: number) {
    return this.hardBlocked(cx, cy) || this.reserved[this.idx(cx, cy)] === 1;
  }

  private rebuild() {
    const w = this.nx + 1;
    this.satAll = new Int32Array(w * (this.ny + 1));
    this.satHard = new Int32Array(w * (this.ny + 1));
    for (let y = 0; y < this.ny; y++) {
      let rowAll = 0, rowHard = 0;
      for (let x = 0; x < this.nx; x++) {
        const i = y * this.nx + x;
        const hard = !this.inside[i] || this.structural[i] || this.solid[i] ? 1 : 0;
        rowHard += hard;
        rowAll += hard || this.reserved[i] ? 1 : 0;
        this.satAll[(y + 1) * w + (x + 1)] = this.satAll[y * w + (x + 1)] + rowAll;
        this.satHard[(y + 1) * w + (x + 1)] = this.satHard[y * w + (x + 1)] + rowHard;
      }
    }
    this.dirty = false;
  }

  private sum(sat: Int32Array, cx0: number, cy0: number, cx1: number, cy1: number) {
    const w = this.nx + 1;
    return sat[cy1 * w + cx1] - sat[cy0 * w + cx1] - sat[cy1 * w + cx0] + sat[cy0 * w + cx0];
  }

  /** Whole rectangle inside the floor and not blocked by anything (including reserved corridor/aisle cells). */
  rectFree(cx0: number, cy0: number, cx1: number, cy1: number) {
    if (cx0 < 0 || cy0 < 0 || cx1 > this.nx || cy1 > this.ny || cx1 <= cx0 || cy1 <= cy0) return false;
    if (this.dirty) this.rebuild();
    return this.sum(this.satAll, cx0, cy0, cx1, cy1) === 0;
  }
  /** Like rectFree but corridor/aisle cells are allowed (used for door approaches). */
  rectHardFree(cx0: number, cy0: number, cx1: number, cy1: number) {
    if (cx0 < 0 || cy0 < 0 || cx1 > this.nx || cy1 > this.ny || cx1 <= cx0 || cy1 <= cy0) return false;
    if (this.dirty) this.rebuild();
    return this.sum(this.satHard, cx0, cy0, cx1, cy1) === 0;
  }

  markSolid(cx0: number, cy0: number, cx1: number, cy1: number) {
    for (let y = Math.max(0, cy0); y < Math.min(this.ny, cy1); y++)
      for (let x = Math.max(0, cx0); x < Math.min(this.nx, cx1); x++) this.solid[this.idx(x, y)] = 1;
    this.dirty = true;
  }
  unmarkSolid(cx0: number, cy0: number, cx1: number, cy1: number) {
    for (let y = Math.max(0, cy0); y < Math.min(this.ny, cy1); y++)
      for (let x = Math.max(0, cx0); x < Math.min(this.nx, cx1); x++) this.solid[this.idx(x, y)] = 0;
    this.dirty = true;
  }
  markReserved(cx0: number, cy0: number, cx1: number, cy1: number) {
    for (let y = Math.max(0, cy0); y < Math.min(this.ny, cy1); y++)
      for (let x = Math.max(0, cx0); x < Math.min(this.nx, cx1); x++) {
        const i = this.idx(x, y);
        if (this.inside[i] && !this.structural[i] && !this.solid[i]) this.reserved[i] = 1;
      }
    this.dirty = true;
  }

  /**
   * Cells a person can walk to from a start cell. A cell only counts if all eight neighbours are open too, which
   * leaves at least 0.375 m to the nearest solid: enough for a 0.28 m-radius body, so a "connected" gap is never
   * a slit nobody could squeeze through. Reserved (corridor/aisle) cells are walkable.
   */
  flood(startCx: number, startCy: number): Uint8Array {
    const n = this.nx * this.ny;
    const seen = new Uint8Array(n);
    // Passable = open cell whose whole 3x3 neighbourhood is open.
    const open = new Uint8Array(n);
    for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) open[y * this.nx + x] = this.hardBlocked(x, y) ? 0 : 1;
    const pass = new Uint8Array(n);
    for (let y = 0; y < this.ny; y++) {
      for (let x = 0; x < this.nx; x++) {
        if (!open[y * this.nx + x]) continue;
        let ok = 1;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
          const a = x + dx, b = y + dy;
          if (a < 0 || b < 0 || a >= this.nx || b >= this.ny || !open[b * this.nx + a]) { ok = 0; break; }
        }
        pass[y * this.nx + x] = ok;
      }
    }
    if (!this.inRange(startCx, startCy) || !pass[this.idx(startCx, startCy)]) return seen;
    const stack = [this.idx(startCx, startCy)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % this.nx, y = (i - x) / this.nx;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = x + dx, b = y + dy;
        if (a < 0 || b < 0 || a >= this.nx || b >= this.ny) continue;
        const j = b * this.nx + a;
        if (pass[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    return seen;
  }
}
