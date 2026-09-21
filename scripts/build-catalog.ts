/**
 * Onboards 3D models into data/catalog.json.
 *
 *   npm run catalog
 *
 * Every entry in ASSETS names a .glb under public/assets/models, what it is, how big it should be in the real
 * world, and which way the raw model faces. The script measures each model's bounding box straight from the
 * GLB file, works out the scale correction and footprint, and flags any model whose raw size is wildly off
 * (a chair 40 units tall means the file was exported in centimetres, or worse).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGlbInfo } from "../server/src/glb";
import type { Catalog, CatalogCategory, CatalogItem } from "../shared/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = path.join(ROOT, "public/assets/models");

type Dim = "width" | "depth" | "height";
interface Spec {
  id: string;
  file: string;
  name: string;
  category: CatalogCategory;
  /** After frontYaw: which real-world dimension to pin, and its value in metres. */
  fit: [Dim, number];
  /** Rotation (deg about Y) that makes the raw model face +Z. Determined by looking at each model from above. */
  frontYaw?: number;
  seats?: number;
  elevation?: number;
  clearFront?: number;
}

const ASSETS: Spec[] = [
  // Chairs (front = the way the sitter faces)
  { id: "chair-task-grey", file: "office_chair_1", name: "Task Chair (Grey)", category: "chair", fit: ["height", 1.0], seats: 1 },
  { id: "chair-exec-brown", file: "office_chair_3", name: "Executive Chair", category: "chair", fit: ["height", 1.2], seats: 1 },
  { id: "chair-task-blue", file: "office_chair_4", name: "Task Chair (Blue)", category: "chair", fit: ["height", 1.0], seats: 1 },
  // Workstations & tables (front = the side the user sits on)
  { id: "desk-workstation", file: "conf_desk_1", name: "Workstation Desk", category: "workstation", fit: ["width", 1.2], seats: 1, clearFront: 0.6 },
  { id: "table-meeting-8", file: "conf_desk_4", name: "Conference Table (8-10)", category: "meeting", fit: ["width", 3.2] },
  { id: "table-meeting-6", file: "conf_desk_3", name: "Meeting Table (4-6)", category: "meeting", fit: ["width", 2.4], frontYaw: 90 },
  // Reception & cafeteria
  { id: "reception-desk", file: "recep_3", name: "Curved Reception Desk", category: "reception", fit: ["width", 2.6], frontYaw: 45, clearFront: 0.9 },
  { id: "counter-cafe", file: "cafe_counter", name: "Cafe Counter", category: "cafeteria", fit: ["width", 2.4], clearFront: 0.9 },
  { id: "vending-1", file: "vending_machine_1", name: "Vending Machine", category: "cafeteria", fit: ["height", 1.85], clearFront: 0.9 },
  { id: "vending-2", file: "vending_machine_2", name: "Snack Machine", category: "cafeteria", fit: ["height", 1.85], clearFront: 0.9 },
  // Lounge seating
  { id: "sofa-white-2", file: "sofa_2", name: "Two-Seat Sofa (White)", category: "lounge", fit: ["width", 1.9], seats: 2 },
  { id: "sofa-grey-3", file: "sofa_3", name: "Three-Seat Sofa (Grey)", category: "lounge", fit: ["width", 2.1], seats: 3, frontYaw: -90 },
  { id: "sofa-blue-2", file: "sofa_4", name: "Two-Seat Sofa (Blue)", category: "lounge", fit: ["width", 1.9], seats: 2 },
  { id: "armchair-dark", file: "couch_3", name: "Armchair (Dark)", category: "lounge", fit: ["width", 0.95], seats: 1 },
  { id: "armchair-blue", file: "couch_4", name: "Armchair (Blue)", category: "lounge", fit: ["width", 0.9], seats: 1 },
  { id: "pool-table", file: "pool_table_1", name: "Pool Table", category: "lounge", fit: ["width", 2.4] },
  // Storage & equipment
  { id: "cabinet", file: "cabinet_1", name: "Storage Cabinet", category: "storage", fit: ["height", 1.5], frontYaw: -90, clearFront: 0.6 },
  { id: "water-cooler", file: "water_unit_1", name: "Water Cooler", category: "equipment", fit: ["height", 1.1], clearFront: 0.6 },
  { id: "printer", file: "printer_3", name: "Multifunction Printer", category: "equipment", fit: ["height", 1.1], clearFront: 0.8 },
  { id: "whiteboard-stand", file: "white_board_2", name: "Mobile Whiteboard", category: "equipment", fit: ["height", 1.9], frontYaw: 90, clearFront: 0.6 },
  { id: "whiteboard-wall", file: "white_board_3", name: "Wall Whiteboard", category: "equipment", fit: ["width", 2.0], elevation: 0.9, clearFront: 0.6 },
  // Decor
  { id: "plant-fiddle", file: "plant_1", name: "Fiddle-leaf Fig", category: "decor", fit: ["height", 1.4] },
  { id: "plant-agave", file: "plant_2", name: "Potted Agave", category: "decor", fit: ["height", 0.9] },
  { id: "plant-monstera", file: "plant_3", name: "Monstera", category: "decor", fit: ["height", 0.9] },
  { id: "plant-rack", file: "plant_rack_1", name: "Plant Shelf", category: "decor", fit: ["height", 1.6] },
];

const r2 = (n: number) => Math.round(n * 1000) / 1000;

function build(): Catalog {
  const items: CatalogItem[] = [];
  for (const s of ASSETS) {
    const file = path.join(MODELS, `${s.file}.glb`);
    if (!fs.existsSync(file)) {
      console.warn(`! missing ${s.file}.glb, skipped`);
      continue;
    }
    const info = readGlbInfo(file);
    const yaw = ((s.frontYaw ?? 0) * Math.PI) / 180;
    const c = Math.cos(yaw), sn = Math.sin(yaw);

    // Bounding box of the raw model after rotating it about Y (all 8 corners).
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      const x = i & 1 ? info.max[0] : info.min[0];
      const z = i & 2 ? info.max[2] : info.min[2];
      const rx = c * x + sn * z, rz = -sn * x + c * z; // R_y(yaw)
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
      minZ = Math.min(minZ, rz); maxZ = Math.max(maxZ, rz);
    }
    const ext = { width: maxX - minX, height: info.size[1], depth: maxZ - minZ };
    const [dim, metres] = s.fit;
    const scale = metres / ext[dim];

    let scaleWarning: string | undefined;
    if (scale < 0.2 || scale > 5) {
      scaleWarning = `Raw model is ${ext[dim].toFixed(2)} units for a ${metres} m ${dim}; scaled by ${scale.toFixed(4)}. Check the export units.`;
      console.warn(`! ${s.file}: ${scaleWarning}`);
    }

    items.push({
      id: s.id,
      name: s.name,
      category: s.category,
      model: `/assets/models/${s.file}.glb`,
      footprint: { width: r2(ext.width * scale), depth: r2(ext.depth * scale) },
      height: r2(ext.height * scale),
      seats: s.seats ?? 0,
      clearance: { front: s.clearFront ?? 0, back: 0, left: 0.05, right: 0.05 },
      elevation: s.elevation ?? 0,
      scale: r2(scale * 10000) / 10000,
      frontYawDeg: s.frontYaw ?? 0,
      origin: [r2(((minX + maxX) / 2) * scale), r2(info.min[1] * scale), r2(((minZ + maxZ) / 2) * scale)],
      raw: { size: info.size.map(r2) as [number, number, number], triangles: info.triangles, bytes: info.bytes },
      scaleWarning,
    });
  }
  return { generatedAt: new Date().toISOString(), items };
}

/** Simple shapes the layout engine uses that have no GLB. */
const PROCEDURAL: CatalogItem[] = [
  proc("table-round", "Round Cafe Table", "cafeteria", 0.9, 0.9, 0.75, "cylinder", "#d9d2c3"),
  proc("table-coffee", "Coffee Table", "lounge", 1.0, 0.6, 0.4, "box", "#8a6a4d"),
];

function proc(id: string, name: string, category: CatalogCategory, w: number, d: number, h: number, shape: "cylinder" | "box", color: string): CatalogItem {
  return {
    id, name, category, model: "", footprint: { width: w, depth: d }, height: h, seats: 0,
    clearance: { front: 0, back: 0, left: 0, right: 0 }, elevation: 0, scale: 1, frontYawDeg: 0,
    origin: [0, 0, 0], raw: { size: [w, h, d], triangles: 0, bytes: 0 }, procedural: { shape, color },
  };
}

const catalog = build();
catalog.items.push(...PROCEDURAL);
fs.writeFileSync(path.join(ROOT, "data/catalog.json"), JSON.stringify(catalog, null, 2));
console.log(`catalog.json: ${catalog.items.length} items`);
for (const i of catalog.items) {
  console.log(`  ${i.id.padEnd(18)} ${i.footprint.width.toFixed(2)} x ${i.footprint.depth.toFixed(2)} x ${i.height.toFixed(2)} m  (${(i.raw.bytes / 1e6).toFixed(1)} MB)`);
}
