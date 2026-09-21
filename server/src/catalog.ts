import fs from "node:fs";
import path from "node:path";
import type { Catalog } from "../../shared/types";
import { DATA_DIR } from "./paths";

let cached: Catalog | null = null;

export function loadCatalog(): Catalog {
  if (!cached) {
    const file = path.join(DATA_DIR, "catalog.json");
    if (!fs.existsSync(file)) throw new Error("data/catalog.json is missing. Run: npm run catalog");
    cached = JSON.parse(fs.readFileSync(file, "utf8")) as Catalog;
  }
  return cached;
}
