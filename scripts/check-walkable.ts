import fs from "node:fs";
import path from "node:path";
import { validateFloorPlan } from "../server/src/validation/floorplan";
import { generateLayout } from "../server/src/pipeline/generator";
import { checkWalkable } from "../server/src/pipeline/walkable";
import type { Catalog, Requirements } from "../shared/types";

const catalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8")) as Catalog;
const sets = (JSON.parse(fs.readFileSync("data/samples/requirements.json", "utf8")) as { sets: Requirements[] }).sets;
let failures = 0;
for (const set of sets) {
  const plan = validateFloorPlan(JSON.parse(fs.readFileSync(path.join("data/samples", `${set.floorPlanId}.json`), "utf8"))).plan!;
  const layout = generateLayout(plan, { ...set, schemaVersion: "1.0" }, catalog);
  const r = checkWalkable(plan, layout, catalog);
  console.log(`${set.floorPlanId.padEnd(18)} ${r.reachablePct}% reachable; unreachable stops: ${r.unreachableStops.join(", ") || "none"}; sealed rooms: ${r.sealedRooms.join(", ") || "none"}`);
  if (r.unreachableStops.length || r.sealedRooms.length || r.reachablePct < 90) failures++;
}
process.exit(failures ? 1 : 0);
