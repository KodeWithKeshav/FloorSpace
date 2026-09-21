import fs from "node:fs";
import path from "node:path";
import { validateFloorPlan } from "../server/src/validation/floorplan";
import { generateLayout } from "../server/src/pipeline/generator";
import type { Catalog, Requirements } from "../shared/types";

const dir = path.resolve("data/samples");
const catalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8")) as Catalog;
const sets = (JSON.parse(fs.readFileSync(path.join(dir, "requirements.json"), "utf8")) as { sets: Requirements[] }).sets;
const only = process.argv[2];

for (const set of sets) {
  if (only && set.floorPlanId !== only) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(dir, `${set.floorPlanId}.json`), "utf8"));
  const v = validateFloorPlan(raw);
  const t0 = Date.now();
  const layout = generateLayout(v.plan!, { ...set, schemaVersion: "1.0" }, catalog);
  const m = layout.metrics;
  console.log(`\n=== ${set.floorPlanId}  (${Date.now() - t0} ms)`);
  console.log(`seats ${m.seatsProvided}/${m.seatsRequested}  floor ${m.floorAreaSqM}  occupied ${m.occupiedAreaSqM}  free ${m.freeAreaSqM} (circ ${m.circulationAreaSqM}, unassigned ${m.unassignedAreaSqM})  m2/seat ${m.areaPerSeat}`);
  console.log("zones:", m.zoneBreakdown.map((z) => `${z.type}×${z.count}=${z.areaSqM}`).join("  "));
  console.log("feasible:", layout.report.feasible, "| warnings:", layout.report.warnings);

  // ASCII map, 0.5 m per char
  const b = v.plan!.floor.boundary;
  const maxX = Math.max(...b.map((p) => p[0])), maxY = Math.max(...b.map((p) => p[1]));
  const letters: Record<string, string> = { workstation: "w", cabin: "C", meeting: "M", cafeteria: "F", reception: "R", phonebooth: "b", lounge: "l", storage: "s", pantry: "p" };
  for (let y = maxY - 0.25; y >= 0; y -= 0.5) {
    let line = "";
    for (let x = 0.25; x < maxX; x += 0.5) {
      let ch = " ";
      const inside = v.plan!.obstacles.some((o) => o.polygon.length && x >= Math.min(...o.polygon.map((p) => p[0])) && x <= Math.max(...o.polygon.map((p) => p[0])) && y >= Math.min(...o.polygon.map((p) => p[1])) && y <= Math.max(...o.polygon.map((p) => p[1])));
      if (inside) ch = "#";
      for (const z of layout.zones) {
        const xs = z.polygon.map((p) => p[0]), ys = z.polygon.map((p) => p[1]);
        if (x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys)) ch = z.label === "Planting" ? "*" : z.label === "Print station" ? "P" : letters[z.type] ?? "?";
      }
      for (const c of []) {
        const xs = c.polygon.map((p) => p[0]), ys = c.polygon.map((p) => p[1]);
        if (ch === " " && x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys)) ch = ".";
      }
      line += ch;
    }
    console.log(line);
  }
}
