import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reconstructPlan } from "../server/src/planimport/reconstruct";
import { buildFromExtraction } from "../server/src/planimport";
import { parseExtraction } from "../server/src/planimport/extraction";
import { area } from "../shared/geometry";
import type { PlanExtraction, Pt } from "../shared/types";

const W = 1600, H = 1200, PXM = 40, OX = 120, OY = 1050; // 40 px per metre, plan origin at (120, 1050) in the image
const toNorm = (p: Pt): [number, number] => [(OX + p[0] * PXM) / W, (OY - p[1] * PXM) / H];
// deterministic wobble of a few pixels, like a real trace
const jit = (p: [number, number], k: number): [number, number] => [p[0] + Math.sin(k * 12.9) * 0.006, p[1] + Math.cos(k * 7.7) * 0.006];

const L: Pt[] = [[0, 0], [30, 0], [30, 12], [16, 12], [16, 20], [0, 20]];
const lengths = L.map((p, i) => Math.hypot(L[(i + 1) % L.length][0] - p[0], L[(i + 1) % L.length][1] - p[1]));

function extraction(over: Partial<PlanExtraction> = {}): PlanExtraction {
  return {
    name: "L Office",
    units: "m",
    ceilingHeightM: null,
    vertices: L.map((p, i) => jit(toNorm(p), i)),
    edgeDimensions: L.map((_, i) => ({ edge: i, text: String(lengths[i]), meters: lengths[i] })),
    openings: [
      // entry door on the bottom wall (y = 0) from x 17 to 18.5; window on the right wall (x = 30) from y 3 to 9
      { type: "door", x0: toNorm([17, 0])[0], y0: toNorm([17, 0])[1], x1: toNorm([18.5, 0])[0], y1: toNorm([18.5, 0])[1], isEntry: true },
      { type: "window", x0: toNorm([30, 3])[0], y0: toNorm([30, 3])[1], x1: toNorm([30, 9])[0], y1: toNorm([30, 9])[1] },
    ],
    obstacles: [
      { type: "core", label: "Lift", polygon: [toNorm([12.5, 0]), toNorm([16.5, 0]), toNorm([16.5, 4.5]), toNorm([12.5, 4.5])] },
      { type: "column", polygon: [toNorm([8, 6]), toNorm([8.5, 6]), toNorm([8.5, 6.5]), toNorm([8, 6.5])] },
    ],
    warnings: [],
    ...over,
  };
}

describe("plan import: rebuilding from printed dimensions", () => {
  it("recovers an L-shape exactly from a wobbly trace", () => {
    const r = reconstructPlan(extraction(), { width: W, height: H });
    const b = r.plan!.floor.boundary;
    assert.equal(b.length, 6);
    assert.ok(Math.abs(area(b) - 488) < 0.2, `area ${area(b)}`);
    for (const e of r.edges) assert.ok(Math.abs(e.builtMeters - lengths[e.index]) < 0.02, `edge ${e.index}: ${e.builtMeters} vs ${lengths[e.index]}`);
    assert.ok(r.edges.every((e) => !e.mismatch));
  });

  it("produces a plan that passes validation, with openings on the walls and one entry", () => {
    const res = buildFromExtraction(extraction(), { width: W, height: H });
    assert.ok(res.validation!.valid, JSON.stringify(res.validation!.issues));
    assert.equal(res.plan!.openings.filter((o) => o.isEntry).length, 1);
    const door = res.plan!.openings.find((o) => o.type === "door")!;
    assert.ok(door.wall.every((p) => Math.abs(p[1]) < 0.05), "the entry door lies on the bottom wall");
    assert.ok(Math.abs(Math.abs(door.wall[1][0] - door.wall[0][0]) - 1.5) < 0.1, "and is about 1.5 m wide");
    const win = res.plan!.openings.find((o) => o.type === "window")!;
    assert.ok(win.wall.every((p) => Math.abs(p[0] - 30) < 0.05) && Math.abs(Math.abs(win.wall[1][1] - win.wall[0][1]) - 6) < 0.15, "the window is 6 m on the right wall");
    assert.ok(res.plan!.obstacles.some((o) => o.type === "core") && res.plan!.obstacles.some((o) => o.type === "column"));
  });

  it("sizes unlabelled walls from the scale the printed ones imply", () => {
    const partial = extraction({ edgeDimensions: [0, 1].map((i) => ({ edge: i, text: String(lengths[i]), meters: lengths[i] })) });
    const r = reconstructPlan(partial, { width: W, height: H });
    for (const e of r.edges) assert.ok(Math.abs(e.builtMeters - lengths[e.index]) < 0.3, `edge ${e.index}: ${e.builtMeters} vs ${lengths[e.index]}`);
    assert.equal(r.edges.filter((e) => e.source === "estimated").length, 4);
  });

  it("lets a printed number win over the pixels, and flags a contradiction", () => {
    const wrong = extraction();
    wrong.edgeDimensions[0] = { edge: 0, text: "31", meters: 31 };
    const r = reconstructPlan(wrong, { width: W, height: H });
    assert.ok(r.edges[0].builtMeters > 30.5, "printed length should be honoured");
    assert.ok(r.edges.some((e) => e.mismatch), "a conflicting dimension chain must be reported");
  });

  it("asks for a scale when nothing is printed, and accepts one", () => {
    const bare = extraction({ edgeDimensions: [] });
    const first = reconstructPlan(bare, { width: W, height: H });
    assert.ok(first.needsScale);
    const sized = reconstructPlan(bare, { width: W, height: H, longestWallMeters: 30 });
    assert.ok(!sized.needsScale);
    assert.ok(Math.abs(Math.max(...sized.edges.map((e) => e.builtMeters)) - 30) < 0.4);
  });

  it("copes with junk from the model", () => {
    const ex = parseExtraction({ units: "furlongs", vertices: [[0.1, 0.1], "x", [2, 3], [0.9, 0.1], [0.9, 0.9]], edgeDimensions: [{ edge: "a" }, { edge: 1, text: "5", meters: -3 }], openings: [{ type: "gate" }, { type: "door", x0: 0.1, y0: 0.1 }], obstacles: [{ polygon: [[0, 0]] }] });
    assert.equal(ex.units, "unknown");
    assert.equal(ex.vertices.length, 4);
    assert.equal(ex.edgeDimensions[0].meters, null);
    assert.equal(ex.openings.length, 0);
    assert.equal(ex.obstacles.length, 0);
  });
});
