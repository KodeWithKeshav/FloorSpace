import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { checkPlacement, clampScale, normDeg, obbCorners, overlapDepth, placementCorners, snapTo } from "../shared/edit";
import { buildScene } from "../shared/scene";
import { validateFloorPlan } from "../server/src/validation/floorplan";
import { generateLayout } from "../server/src/pipeline/generator";
import type { Catalog, Placement, Requirements } from "../shared/types";

const catalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8")) as Catalog;
const item = (id: string) => catalog.items.find((i) => i.id === id)!;
const boundary: [number, number][] = [[0, 0], [10, 0], [10, 8], [0, 8]];
const at = (id: string, x: number, y: number, rot = 0, scale = 1): Placement => ({ id: `t-${x}-${y}`, itemId: id, zoneId: "z", position: [x, y], rotationDeg: rot, scale });

describe("edit maths", () => {
  it("clamps size and normalises angles", () => {
    assert.equal(clampScale(5), 2);
    assert.equal(clampScale(0.1), 0.5);
    assert.equal(normDeg(-15), 345);
    assert.equal(normDeg(375), 15);
    assert.equal(snapTo(1.234, 0.1), 1.2);
    assert.equal(snapTo(1.234, 0), 1.234);
  });

  it("detects overlapping and separate boxes", () => {
    const a = obbCorners(0, 0, 1, 1, 0);
    assert.ok(overlapDepth(a, obbCorners(1.5, 0, 1, 1, 0)) > 0.4);
    assert.equal(overlapDepth(a, obbCorners(3, 0, 1, 1, 0)), 0);
    assert.ok(overlapDepth(a, obbCorners(1.2, 0, 1, 1, 45)) > 0);
  });

  it("scales footprints", () => {
    const d = item("desk-workstation");
    const one = placementCorners(at("desk-workstation", 5, 4), d);
    const two = placementCorners(at("desk-workstation", 5, 4, 0, 2), d);
    const span = (c: [number, number][]) => Math.max(...c.map((p) => p[0])) - Math.min(...c.map((p) => p[0]));
    assert.ok(Math.abs(span(two) - 2 * span(one)) < 1e-9);
  });

  it("flags furniture outside the building, through walls, and on top of other furniture", () => {
    const d = item("desk-workstation");
    assert.deepEqual(checkPlacement(at("desk-workstation", 5, 4), d, boundary, [], []), []);
    assert.ok(checkPlacement(at("desk-workstation", 11, 4), d, boundary, [], []).includes("outside"));
    const wall = [{ src: "wall" as const, cx: 5, cy: 4, hx: 2, hy: 0.1, angleDeg: 0 }];
    assert.ok(checkPlacement(at("desk-workstation", 5, 4), d, boundary, wall, []).includes("wall"));
    const other = { p: at("desk-workstation", 5.3, 4), it: d };
    assert.ok(checkPlacement({ ...at("desk-workstation", 5, 4), id: "me" }, d, boundary, [], [other]).includes("item"));
    // a chair tucked under a desk is fine
    const chair = item("chair-task-grey");
    assert.ok(!checkPlacement({ ...at("chair-task-grey", 5, 4), id: "c" }, chair, boundary, [], [other]).includes("item"));
  });
});

describe("edited layouts reach the 3D scene", () => {
  const sets = (JSON.parse(fs.readFileSync("data/samples/requirements.json", "utf8")) as { sets: Requirements[] }).sets;
  const plan = validateFloorPlan(JSON.parse(fs.readFileSync("data/samples/small-office.json", "utf8"))).plan!;
  const layout = generateLayout(plan, { ...sets[0], schemaVersion: "1.0" }, catalog);

  it("carries size and position into items and colliders", () => {
    const base = buildScene(plan, layout, catalog);
    const target = layout.placements.find((p) => item(p.itemId).category === "workstation")!;
    const edited = { ...layout, placements: layout.placements.map((p) => (p.id === target.id ? { ...p, scale: 1.5, position: [5, 5] as [number, number] } : p)) };
    const s = buildScene(plan, edited, catalog);
    const it = s.items.find((i) => i.id === target.id)!;
    assert.equal(it.scale, 1.5);
    assert.equal(it.x, 5);
    assert.equal(base.items.find((i) => i.id === target.id)!.scale, 1);
    const grew = s.colliders.filter((c) => c.src === "item").some((c) => Math.abs(c.hx - (item("desk-workstation").footprint.width * 1.5) / 2) < 1e-6 || Math.abs(c.hy - (item("desk-workstation").footprint.depth * 1.5) / 2) < 1e-6);
    assert.ok(grew);
  });
});
