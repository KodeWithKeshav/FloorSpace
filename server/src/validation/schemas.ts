import fs from "node:fs";
import path from "node:path";
import AjvModule from "ajv";
import type { ValidateFunction } from "ajv";
import { SCHEMAS_DIR } from "../paths";

// ajv ships CommonJS; unwrap the default export under native ESM.
const Ajv = ((AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule) as unknown as new (
  opts: Record<string, unknown>,
) => {
  compile: (schema: object) => ValidateFunction;
};

export const SCHEMA_NAMES = ["floorplan", "requirements", "layout"] as const;
export type SchemaName = (typeof SCHEMA_NAMES)[number];

const ajv = new Ajv({ allErrors: true, verbose: true, strict: true });
const cache = new Map<SchemaName, ValidateFunction>();

export function schemaPath(name: SchemaName) {
  return path.join(SCHEMAS_DIR, `${name}.schema.json`);
}

export function getValidator(name: SchemaName): ValidateFunction {
  let v = cache.get(name);
  if (!v) {
    v = ajv.compile(JSON.parse(fs.readFileSync(schemaPath(name), "utf8")));
    cache.set(name, v);
  }
  return v;
}
