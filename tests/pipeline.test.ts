import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { area, pointInPolygon, signedArea, simplePolygonProblem } from "../shared/geometry";
import { validateFloorPlan } from "../server/src/validation/floorplan";
import { getValidator } from "../server/src/validation/schemas";
import { generateLayout } from "../server/src/pipeline/generator";
import { checkFeasibility } from "../server/src/pipeline/feasibility";
import { footprintCorners } from "../server/src/pipeline/validate";
import { checkWalkable } from "../server/src/pipeline/walkable";
import type { Catalog, FloorPlan, Layout, Requirements } from "../shared/types";

const catalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8")) as Catalog;
const sets = (JSON.parse(fs.readFileSync("data/samples/requirements.json", "utf8")) as { sets: Requirements[] }).sets;
const load = (id: string): FloorPlan => validateFloorPlan(JSON.parse(fs.readFileSync(path.join("data/samples", `${id}.json`), "utf8"))).plan!;
const brief = (id: string): Requirements => ({ ...sets.find((s) => s.floorPlanId === id)!, schemaVersion: "1.0" });
const byId = new Map(catalog.items.map((i) => [i.id, i]));

const bounds = (poly: [number, number][]) => ({ x0: Math.min(...poly.map((p) => p[0])), x1: Math.max(...poly.map((p) => p[0])), y0: Math.min(...poly.map((p) => p[1])), y1: Math.max(...poly.map((p) => p[1])) });

describe("geometry", () => {
  it("measures area and winding", () => {
    const sq: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]];
    assert.equal(area(sq), 12);
    assert.ok(signedArea(sq) > 0);
    assert.ok(signedArea([...sq].reverse()) < 0);
  });
  it("handles concave polygons", () => {
    const L: [number, number][] = [[0, 0], [30, 0], [30, 12], [16, 12], [16, 20], [0, 20]];
    assert.ok(pointInPolygon([5, 18], L));
    assert.ok(!pointInPolygon([25, 18], L));
    assert.equal(simplePolygonProblem(L), null);
    assert.ok(simplePolygonProblem([[0, 0], [10, 10], [10, 0], [0, 10]]));
  });
});

describe("floor plan validation", () => {
  for (const id of ["small-office", "l-shaped-floor", "large-open-floor", "tight-floor"]) {
    it(`accepts ${id}`, () => {
      const r = validateFloorPlan(JSON.parse(fs.readFileSync(`data/samples/${id}.json`, "utf8")));
      assert.ok(r.valid, JSON.stringify(r.issues));
    });
  }
  it("rejects a window that is not on the boundary, with a readable path", () => {
    const raw = JSON.parse(fs.readFileSync("data/samples/small-office.json", "utf8"));
    raw.openings[2].wall = [[2, 11], [8, 11]];
    const r = validateFloorPlan(raw);
    assert.ok(!r.valid);
    assert.equal(r.issues[0].path, "openings[2].wall");
  });
  it("corrects clockwise winding instead of rejecting", () => {
    const raw = JSON.parse(fs.readFileSync("data/samples/small-office.json", "utf8"));
    raw.floor.boundary.reverse();
    const r = validateFloorPlan(raw);
    assert.ok(r.valid);
    assert.ok(signedArea(r.plan!.floor.boundary) > 0);
  });
});

describe("layout generation", () => {
  for (const id of ["small-office", "l-shaped-floor", "large-open-floor", "tight-floor"]) {
    describe(id, () => {
      const plan = load(id);
      const layout: Layout = generateLayout(plan, brief(id), catalog);

      it("conforms to the layout schema", () => {
        const v = getValidator("layout");
        assert.ok(v(layout), JSON.stringify(v.errors?.slice(0, 3)));
      });

      it("keeps every zone inside the outline and off the cores", () => {
        for (const z of layout.zones) {
          for (const p of z.polygon) assert.ok(pointInPolygon(p, plan.floor.boundary, 1e-4), `${z.label} leaves the floor`);
          const b = bounds(z.polygon);
          for (const o of plan.obstacles) {
            const ob = bounds(o.polygon);
            const overlap = b.x0 < ob.x1 - 1e-6 && b.x1 > ob.x0 + 1e-6 && b.y0 < ob.y1 - 1e-6 && b.y1 > ob.y0 + 1e-6;
            assert.ok(!overlap, `${z.label} overlaps ${o.id}`);
          }
        }
      });

      it("has no overlapping zones", () => {
        for (let i = 0; i < layout.zones.length; i++) {
          for (let j = i + 1; j < layout.zones.length; j++) {
            const a = bounds(layout.zones[i].polygon), c = bounds(layout.zones[j].polygon);
            assert.ok(!(a.x0 < c.x1 - 1e-6 && a.x1 > c.x0 + 1e-6 && a.y0 < c.y1 - 1e-6 && a.y1 > c.y0 + 1e-6), `${layout.zones[i].label} overlaps ${layout.zones[j].label}`);
          }
        }
      });

      it("keeps each item inside its own zone", () => {
        const zones = new Map(layout.zones.map((z) => [z.id, z]));
        for (const p of layout.placements) {
          const it = byId.get(p.itemId)!;
          if (it.elevation > 0) continue;
          const b = bounds(zones.get(p.zoneId)!.polygon);
          for (const c of footprintCorners(p, it.footprint.width, it.footprint.depth)) {
            assert.ok(c[0] >= b.x0 - 0.06 && c[0] <= b.x1 + 0.06 && c[1] >= b.y0 - 0.06 && c[1] <= b.y1 + 0.06, `${it.name} sticks out of ${zones.get(p.zoneId)!.label}`);
          }
        }
      });

      it("never puts a room on top of a door", () => {
        for (const o of plan.openings.filter((x) => x.type === "door")) {
          const mx = (o.wall[0][0] + o.wall[1][0]) / 2, my = (o.wall[0][1] + o.wall[1][1]) / 2;
          for (const z of layout.zones) {
            const b = bounds(z.polygon);
            assert.ok(!(mx > b.x0 + 1e-6 && mx < b.x1 - 1e-6 && my > b.y0 + 1e-6 && my < b.y1 - 1e-6), `${z.label} sits on door ${o.id}`);
          }
        }
      });

      it("is fully walkable from the entrance, every room enterable", () => {
        const r = checkWalkable(plan, layout, catalog);
        assert.deepEqual(r.unreachableStops, []);
        assert.deepEqual(r.sealedRooms, []);
        assert.ok(r.reachablePct >= 90, `only ${r.reachablePct}% reachable`);
      });

      it("accounts for every square metre", () => {
        const m = layout.metrics;
        assert.ok(Math.abs(m.occupiedAreaSqM + m.freeAreaSqM - m.floorAreaSqM) < 0.6);
        assert.ok(Math.abs(m.circulationAreaSqM + m.unassignedAreaSqM - m.freeAreaSqM) < 0.6);
      });
    });
  }

  it("places all 100 seats on the hero floor", () => {
    const l = generateLayout(load("large-open-floor"), brief("large-open-floor"), catalog);
    assert.equal(l.metrics.seatsProvided, 100);
    assert.ok(l.report.feasible);
  });
});

describe("feasibility", () => {
  it("passes the hero brief", () => {
    assert.equal(checkFeasibility(load("large-open-floor"), brief("large-open-floor"), catalog).status, "ok");
  });
  it("refuses the tight floor, states a maximum and offers alternatives", () => {
    const f = checkFeasibility(load("tight-floor"), brief("tight-floor"), catalog);
    assert.equal(f.status, "infeasible");
    assert.ok(f.maxSeats > 0 && f.maxSeats < 100);
    assert.ok(f.alternatives.length >= 2);
    for (const a of f.alternatives) assert.ok(a.seatsAfter > 0);
  });
});
