import type { FloorPlan, Obstacle, Opening, Pt, PlanStats, ValidationIssue, ValidationResult } from "../../../shared/types";
import {
  area, bbox, centroid, dist, isRectilinear, nearestEdge, perimeter, pointInPolygon, pointOnBoundary,
  segmentsProperlyCross, signedArea, simplePolygonProblem,
} from "../../../shared/geometry";
import { getValidator } from "./schemas";
import { humanise } from "./errors";

/** How far an opening's end points may sit from the boundary line (metres). */
export const WALL_TOLERANCE = 0.05;

const DEFAULT_CIRCULATION = { mainCorridorWidth: 1.5, secondaryCorridorWidth: 1.2, minClearanceToWall: 0.6 };
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const fmtPt = (p: Pt) => `[${fmt(p[0])}, ${fmt(p[1])}]`;

export function validateFloorPlan(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  // ── 1. Structure (JSON Schema) ────────────────────────────────────────────
  const validate = getValidator("floorplan");
  if (!validate(raw)) {
    for (const err of validate.errors ?? []) issues.push(humanise(err));
    return { valid: false, issues: dedupe(issues), plan: null, stats: null };
  }

  // ── 2. Geometry (only meaningful once the structure is sound) ─────────────
  const plan = structuredClone(raw) as unknown as FloorPlan;
  plan.obstacles ??= [];
  plan.openings ??= [];
  plan.circulation = { ...DEFAULT_CIRCULATION, ...(plan.circulation ?? {}) };

  normaliseBoundary(plan, issues);
  if (!issues.some((i) => i.path.startsWith("floor.boundary") && i.severity === "error")) {
    checkObstacles(plan, issues);
    checkOpenings(plan, issues);
  }
  checkIds(plan, issues);

  const valid = !issues.some((i) => i.severity === "error");
  return {
    valid,
    issues: dedupe(issues).sort(bySeverity),
    plan: valid ? plan : null,
    stats: valid ? computeStats(plan) : null,
  };
}

const order = { error: 0, warning: 1, info: 2 } as const;
const bySeverity = (a: ValidationIssue, b: ValidationIssue) => order[a.severity] - order[b.severity];

function dedupe(list: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = `${i.severity}|${i.path}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function normaliseBoundary(plan: FloorPlan, issues: ValidationIssue[]) {
  const b = plan.floor.boundary;

  // A repeated closing point is common in CAD exports; drop it quietly.
  if (b.length > 3 && dist(b[0], b[b.length - 1]) < 1e-9) {
    b.pop();
    issues.push({ severity: "info", path: "floor.boundary", message: "The last point repeated the first, so it was removed." });
  }
  if (b.length < 3) {
    issues.push({ severity: "error", path: "floor.boundary", message: "needs at least 3 distinct points" });
    return;
  }

  const problem = simplePolygonProblem(b);
  if (problem) {
    issues.push({ severity: "error", path: "floor.boundary", message: `is not a simple outline: ${problem}` });
    return;
  }
  if (area(b) < 1e-6) {
    issues.push({ severity: "error", path: "floor.boundary", message: "encloses no area (all points are in a line)" });
    return;
  }
  if (signedArea(b) < 0) {
    b.reverse();
    issues.push({ severity: "info", path: "floor.boundary", message: "Points were listed clockwise; they were reordered counter-clockwise automatically." });
  }
  if (area(b) < 20) {
    issues.push({ severity: "warning", path: "floor.boundary", message: `is only ${fmt(area(b))} m², which is very small for a floor plan. Check the units are metres.` });
  }
}

function checkObstacles(plan: FloorPlan, issues: ValidationIssue[]) {
  const boundary = plan.floor.boundary;
  plan.obstacles.forEach((o, i) => {
    const base = `obstacles[${i}]`;
    const problem = simplePolygonProblem(o.polygon);
    if (problem) {
      issues.push({ severity: "error", path: `${base}.polygon`, message: `is not a simple shape: ${problem}` });
      return;
    }
    if (area(o.polygon) < 1e-6) {
      issues.push({ severity: "error", path: `${base}.polygon`, message: "encloses no area" });
      return;
    }
    if (!polygonInside(o.polygon, boundary)) {
      issues.push({
        severity: "error",
        path: `${base}.polygon`,
        message: `"${o.id}" is not fully inside the floor boundary`,
      });
    }
    if (o.height !== undefined && o.height > plan.floor.ceilingHeight + 1e-9) {
      issues.push({ severity: "warning", path: `${base}.height`, message: `is ${fmt(o.height)} m, taller than the ${fmt(plan.floor.ceilingHeight)} m ceiling` });
    }
  });

  for (let i = 0; i < plan.obstacles.length; i++) {
    for (let j = i + 1; j < plan.obstacles.length; j++) {
      if (polygonsOverlap(plan.obstacles[i].polygon, plan.obstacles[j].polygon)) {
        issues.push({
          severity: "warning",
          path: `obstacles[${j}].polygon`,
          message: `"${plan.obstacles[j].id}" overlaps "${plan.obstacles[i].id}"`,
        });
      }
    }
  }
}

function polygonInside(inner: Pt[], outer: Pt[]): boolean {
  for (const p of inner) if (!pointInPolygon(p, outer)) return false;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i], b = inner[(i + 1) % inner.length];
    if (!pointInPolygon([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], outer)) return false;
    for (let j = 0; j < outer.length; j++) {
      if (segmentsProperlyCross(a, b, outer[j], outer[(j + 1) % outer.length])) return false;
    }
  }
  return true;
}

function polygonsOverlap(a: Pt[], b: Pt[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsProperlyCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  const strictlyInside = (p: Pt, poly: Pt[]) => pointInPolygon(p, poly) && !pointOnBoundary(p, poly, 1e-6);
  return strictlyInside(centroid(a), b) || strictlyInside(centroid(b), a);
}

function checkOpenings(plan: FloorPlan, issues: ValidationIssue[]) {
  const boundary = plan.floor.boundary;
  const ceiling = plan.floor.ceilingHeight;
  const spans = new Map<number, { id: string; from: number; to: number }[]>();

  plan.openings.forEach((o, i) => {
    const base = `openings[${i}]`;
    const [a, b] = o.wall;
    const width = dist(a, b);

    if (width < 0.05) {
      issues.push({ severity: "error", path: `${base}.wall`, message: "has zero length (both end points are the same)" });
      return;
    }

    const ea = nearestEdge(a, boundary);
    const eb = nearestEdge(b, boundary);
    const onA = ea.distance <= WALL_TOLERANCE;
    const onB = eb.distance <= WALL_TOLERANCE;

    if (!onA || !onB) {
      const off = !onA ? { p: a, d: ea.distance } : { p: b, d: eb.distance };
      issues.push({
        severity: "error",
        path: `${base}.wall`,
        message: `does not lie on the floor boundary: ${fmtPt(off.p)} is ${fmt(off.d)} m from the nearest wall (limit ${WALL_TOLERANCE * 100} cm)`,
      });
    } else {
      // Both end points must sit on the same straight wall run, not on either side of a corner.
      const shared = edgesNear(a, boundary).find((idx) => edgesNear(b, boundary).includes(idx));
      if (shared === undefined) {
        issues.push({
          severity: "error",
          path: `${base}.wall`,
          message: "runs around a corner. Split it into one opening per wall",
        });
      } else {
        const list = spans.get(shared) ?? [];
        const s = boundary[shared], e = boundary[(shared + 1) % boundary.length];
        const len = dist(s, e);
        const t = (p: Pt) => ((p[0] - s[0]) * (e[0] - s[0]) + (p[1] - s[1]) * (e[1] - s[1])) / len;
        const from = Math.min(t(a), t(b)), to = Math.max(t(a), t(b));
        for (const other of list) {
          if (from < other.to - 0.02 && to > other.from + 0.02) {
            issues.push({ severity: "warning", path: `${base}.wall`, message: `overlaps "${other.id}" on the same wall` });
          }
        }
        list.push({ id: o.id, from, to });
        spans.set(shared, list);
      }
    }

    if (o.height > ceiling + 1e-9) {
      issues.push({ severity: "error", path: `${base}.height`, message: `is ${fmt(o.height)} m, taller than the ${fmt(ceiling)} m ceiling` });
    } else if (o.type === "window" && (o.sillHeight ?? 0) + o.height > ceiling + 1e-9) {
      issues.push({ severity: "error", path: `${base}.sillHeight`, message: `sill ${fmt(o.sillHeight ?? 0)} m + height ${fmt(o.height)} m rises above the ${fmt(ceiling)} m ceiling` });
    }

    if (o.type === "door" && (width < 0.7 || width > 3.6)) {
      issues.push({ severity: "warning", path: `${base}.wall`, message: `door is ${fmt(width)} m wide; expected between 0.7 m and 3.6 m` });
    }
    if (o.type === "window" && width < 0.3) {
      issues.push({ severity: "warning", path: `${base}.wall`, message: `window is only ${fmt(width)} m wide` });
    }
  });

  if (!plan.openings.some((o) => o.type === "door" && o.isEntry)) {
    issues.push({
      severity: "warning",
      path: "openings",
      message: "No door is marked as the entry (isEntry: true). Reception placement will fall back to the first door.",
    });
  }
}

/** Indices of every boundary edge within tolerance of a point (a corner point touches two). */
function edgesNear(p: Pt, boundary: Pt[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    if (distToSeg(p, a, b) <= WALL_TOLERANCE) out.push(i);
  }
  return out;
}

function distToSeg(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function checkIds(plan: FloorPlan, issues: ValidationIssue[]) {
  const seen = new Map<string, string>();
  const visit = (list: (Obstacle | Opening)[], key: string) =>
    list.forEach((item, i) => {
      const prior = seen.get(item.id);
      if (prior) {
        issues.push({ severity: "error", path: `${key}[${i}].id`, message: `"${item.id}" is already used by ${prior}` });
      } else seen.set(item.id, `${key}[${i}]`);
    });
  visit(plan.obstacles, "obstacles");
  visit(plan.openings, "openings");
}

export function computeStats(plan: FloorPlan): PlanStats {
  const b = plan.floor.boundary;
  const floorArea = area(b);
  const obstacleArea = plan.obstacles.reduce((s, o) => s + area(o.polygon), 0);
  const box = bbox(b);
  const rectilinear = isRectilinear(b);
  const shape = b.length === 4 && rectilinear ? "Rectangular" : b.length === 6 && rectilinear ? "L-shaped" : "Non-rectangular";
  return {
    floorAreaSqM: round(floorArea),
    obstacleAreaSqM: round(obstacleArea),
    usableAreaSqM: round(Math.max(0, floorArea - obstacleArea)),
    perimeterM: round(perimeter(b)),
    bbox: { ...box },
    vertexCount: b.length,
    shape,
    cores: plan.obstacles.filter((o) => o.type !== "column").length,
    columns: plan.obstacles.filter((o) => o.type === "column").length,
    doors: plan.openings.filter((o) => o.type === "door").length,
    windows: plan.openings.filter((o) => o.type === "window").length,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
