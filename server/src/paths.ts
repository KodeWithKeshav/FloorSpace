import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (server/src -> repo). */
export const ROOT = path.resolve(here, "../..");
export const DATA_DIR = path.join(ROOT, "data");
export const SAMPLES_DIR = path.join(DATA_DIR, "samples");
export const SCHEMAS_DIR = path.join(ROOT, "schemas");
export const CLIENT_DIST = path.join(ROOT, "client", "dist");
