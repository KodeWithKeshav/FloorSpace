import fs from "node:fs";
import path from "node:path";
import { validateFloorPlan } from "../server/src/validation/floorplan";
import { generateLayout } from "../server/src/pipeline/generator";
import { exportGodotProject } from "../server/src/godot/exportProject";
import type { Catalog, Requirements } from "../shared/types";

const id = process.argv[2] ?? "small-office";
const catalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8")) as Catalog;
const sets = (JSON.parse(fs.readFileSync("data/samples/requirements.json", "utf8")) as { sets: Requirements[] }).sets;
const set = sets.find((s) => s.floorPlanId === id)!;
const plan = validateFloorPlan(JSON.parse(fs.readFileSync(`data/samples/${id}.json`, "utf8"))).plan!;
const layout = generateLayout(plan, { ...set, schemaVersion: "1.0" }, catalog);
const r = exportGodotProject(plan, layout, catalog, path.resolve("exports", `test-${id}`));
console.log(r);
