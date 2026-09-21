import type { Pt } from "./types";

export const EPS = 1e-6;

/** Signed area: positive when the polygon is counter-clockwise. */
export function signedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export const area = (poly: Pt[]) => Math.abs(signedArea(poly));

export function perimeter(poly: Pt[]): number {
  let p = 0;
  for (let i = 0; i < poly.length; i++) p += dist(poly[i], poly[(i + 1) % poly.length]);
  return p;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function bbox(points: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function centroid(poly: Pt[]): Pt {
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    const b = bbox(poly);
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function cross(o: Pt, a: Pt, b: Pt) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Segments cross at a single point strictly inside both (touching at endpoints does not count). */
export function segmentsProperlyCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
         ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/** Any contact at all between two segments: crossing, touching, or collinear overlap. */
export function segmentsTouch(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  if (segmentsProperlyCross(a, b, c, d)) return true;
  const tol = 1e-9;
  return distPointToSegment(c, a, b) < tol || distPointToSegment(d, a, b) < tol ||
         distPointToSegment(a, c, d) < tol || distPointToSegment(b, c, d) < tol;
}

export function pointOnBoundary(p: Pt, poly: Pt[], tol = 1e-6): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (distPointToSegment(p, poly[i], poly[(i + 1) % poly.length]) <= tol) return true;
  }
  return false;
}

/** Point in polygon; points on the boundary count as inside. */
export function pointInPolygon(p: Pt, poly: Pt[], tol = 1e-6): boolean {
  if (pointOnBoundary(p, poly, tol)) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A polygon is simple when no two non-adjacent edges touch and adjacent edges do not fold back on
 * each other. Returns a description of the first problem found, or null.
 */
export function simplePolygonProblem(poly: Pt[]): string | null {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if (dist(a, b) < 1e-9) return `vertices ${i} and ${(i + 1) % n} are the same point`;
    for (let j = i + 1; j < n; j++) {
      const c = poly[j], d = poly[(j + 1) % n];
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Shared vertex: only a problem if the two edges fold back along each other.
        const shared = j === i + 1 ? b : a;
        const p = j === i + 1 ? a : b;
        const q = j === i + 1 ? d : c;
        const cr = cross(shared, p, q);
        const dot = (p[0] - shared[0]) * (q[0] - shared[0]) + (p[1] - shared[1]) * (q[1] - shared[1]);
        if (Math.abs(cr) < 1e-9 && dot > 0) return `edges ${i} and ${j} fold back on each other`;
      } else if (segmentsTouch(a, b, c, d)) {
        return `edge ${i} crosses or touches edge ${j}`;
      }
    }
  }
  return null;
}

/** Nearest boundary edge to a point: index and distance. */
export function nearestEdge(p: Pt, poly: Pt[]): { index: number; distance: number } {
  let best = { index: 0, distance: Infinity };
  for (let i = 0; i < poly.length; i++) {
    const d = distPointToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < best.distance) best = { index: i, distance: d };
  }
  return best;
}

/** Polygon axis-aligned and every angle 90°/270° (covers rectangles, L/U/T shapes). */
export function isRectilinear(poly: Pt[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (Math.abs(a[0] - b[0]) > 1e-9 && Math.abs(a[1] - b[1]) > 1e-9) return false;
  }
  return true;
}
