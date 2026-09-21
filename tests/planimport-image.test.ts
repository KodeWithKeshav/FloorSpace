import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { alignToInk, findColumns, refineCores } from "../server/src/planimport/align";
import { detectOpenings, mergeOpenings } from "../server/src/planimport/gaps";
import { buildFromExtraction } from "../server/src/planimport";
import type { FloorPlan, PlanExtraction } from "../shared/types";

const W = 2000, H = 1500;
const load = (n: string) => fs.readFileSync(`tests/fixtures/${n}.jpg`);
const truth = (n: string) => JSON.parse(fs.readFileSync(`data/samples/${n}.json`, "utf8")) as FloorPlan;

/**
 * What a real AI returned for small-office.jpg: the right structure and dimensions, but corner positions that are
 * far off the page (it put the building at y 0.11-0.51 when it is really at 0.15-0.67).
 */
const skewed = (base: Partial<PlanExtraction>): PlanExtraction => ({
  name: null, units: "mm", ceilingHeightM: null, vertices: [], edgeDimensions: [], openings: [], obstacles: [], warnings: [], ...base,
});

const smallAi = skewed({
  vertices: [[0.21, 0.11], [0.79, 0.11], [0.79, 0.51], [0.21, 0.51]],
  edgeDimensions: [{ edge: 0, text: "18000", meters: 18 }, { edge: 1, text: "12000", meters: 12 }, { edge: 2, text: "18000", meters: 18 }, { edge: 3, text: "12000", meters: 12 }],
  openings: [{ type: "door", x0: 0.45, y0: 0.51, x1: 0.55, y1: 0.51, isEntry: true }],
  obstacles: [{ type: "core", label: "LIFT", polygon: [[0.69, 0.36], [0.79, 0.36], [0.79, 0.51], [0.69, 0.51]] }],
});

const lAi = skewed({
  vertices: [[0.2, 0.5], [0.78, 0.5], [0.78, 0.35], [0.5, 0.35], [0.5, 0.1], [0.2, 0.1]],
  edgeDimensions: [[0, 30], [1, 12], [2, 14], [3, 8], [4, 16], [5, 20]].map(([edge, m]) => ({ edge, text: String(m * 1000), meters: m })),
  openings: [{ type: "door", x0: 0.5, y0: 0.5, x1: 0.55, y1: 0.5, isEntry: true }],
  obstacles: [
    { type: "core", label: "Lift", polygon: [[0.44, 0.42], [0.52, 0.42], [0.52, 0.5], [0.44, 0.5]] },
    { type: "column", polygon: [[0.3, 0.3], [0.31, 0.3], [0.31, 0.31], [0.3, 0.31]] },
  ],
});

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const mid = (o: { wall: [number, number][] }) => [(o.wall[0][0] + o.wall[1][0]) / 2, (o.wall[0][1] + o.wall[1][1]) / 2];

function run(name: string, ai: PlanExtraction) {
  const jpg = load(name);
  const al = alignToInk(jpg, ai);
  assert.ok(al.aligned, al.note);
  let ex = refineCores(jpg, al.extraction);
  const cols = findColumns(jpg, ex.vertices);
  if (cols.length) ex = { ...ex, obstacles: [...ex.obstacles.filter((o) => o.type !== "column"), ...cols.map((polygon) => ({ type: "column" as const, label: null, polygon }))] };
  const scan = detectOpenings(jpg, ex.vertices, 18 / (0.58 * W));
  assert.equal(scan.skipped, undefined);
  ex = { ...ex, openings: mergeOpenings(scan.openings, ex.openings).openings };
  return buildFromExtraction(ex, { width: W, height: H });
}

describe("plan import from a real drawing image (no AI needed)", () => {
  it("small office: snaps a badly placed outline, finds every door and window, and the core", () => {
    const res = run("small-office", smallAi);
    const t = truth("small-office");
    assert.ok(res.ok, JSON.stringify(res.validation?.issues));
    const p = res.plan!;
    assert.equal(p.openings.length, t.openings.length);
    for (const to of t.openings) {
      const m = mid(to);
      const got = p.openings.find((o) => o.type === to.type && near(mid(o)[0], m[0], 0.4) && near(mid(o)[1], m[1], 0.4));
      assert.ok(got, `missing ${to.type} near ${m}`);
    }
    assert.equal(p.openings.filter((o) => o.isEntry).length, 1);
    const core = p.obstacles.find((o) => o.type === "core")!;
    assert.ok(near(Math.min(...core.polygon.map((q) => q[0])), 14.5, 0.3) && near(Math.max(...core.polygon.map((q) => q[1])), 4.5, 0.3));
  });

  it("L-shaped floor: all 7 openings and the columns land where they truly are", () => {
    const res = run("l-shaped-floor", lAi);
    const t = truth("l-shaped-floor");
    assert.ok(res.ok, JSON.stringify(res.validation?.issues));
    const p = res.plan!;
    assert.equal(p.openings.length, t.openings.length);
    for (const to of t.openings) {
      const m = mid(to);
      assert.ok(p.openings.find((o) => o.type === to.type && near(mid(o)[0], m[0], 0.5) && near(mid(o)[1], m[1], 0.5)), `missing ${to.type} near ${m}`);
    }
    const cols = p.obstacles.filter((o) => o.type === "column");
    assert.equal(cols.length, 3);
    for (const tc of t.obstacles.filter((o) => o.type === "column")) {
      assert.ok(cols.some((c) => near(c.polygon[0][0], tc.polygon[0][0], 0.15) && near(c.polygon[0][1], tc.polygon[0][1], 0.15)), `column near ${tc.polygon[0]}`);
    }
  });

  it("leaves a non-drawing alone rather than inventing walls", () => {
    const blank = fs.readFileSync("tests/fixtures/small-office.jpg");
    const r = detectOpenings(blank, [[0.02, 0.02], [0.05, 0.02], [0.05, 0.04], [0.02, 0.04]]);
    assert.ok(r.openings.length === 0);
  });
});
