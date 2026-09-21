import type { ErrorObject } from "ajv";
import type { ValidationIssue } from "../../../shared/types";

/** "/openings/2/wall" -> "openings[2].wall" */
export function toJsonPath(instancePath: string): string {
  return instancePath
    .split("/")
    .filter(Boolean)
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((acc, seg) => (/^\d+$/.test(seg) ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : seg), "");
}

const join = (base: string, key: string) => (base ? `${base}.${key}` : key);

function typeName(t: unknown): string {
  const name = Array.isArray(t) ? t.join(" or ") : String(t);
  return name === "array" ? "a list" : name === "object" ? "an object" : name === "number" ? "a number" : name === "string" ? "text" : name === "boolean" ? "true or false" : name;
}

/** Turn an Ajv error into something a person can act on. */
export function humanise(e: ErrorObject): ValidationIssue {
  const base = toJsonPath(e.instancePath);
  const p = e.params as Record<string, unknown>;
  const parent = (e as ErrorObject & { parentSchema?: Record<string, unknown> }).parentSchema;
  const isPair = parent?.minItems === 2 && parent?.maxItems === 2;

  let path = base;
  let message: string;

  switch (e.keyword) {
    case "required":
      path = join(base, String(p.missingProperty));
      message = `is required but missing`;
      break;
    case "additionalProperties":
      path = join(base, String(p.additionalProperty));
      message = `is not a recognised field (check the spelling)`;
      break;
    case "type":
      message = base === "" ? "The plan must be a JSON object" : `must be ${typeName(p.type)}`;
      break;
    case "const":
      message = `must be exactly ${JSON.stringify(p.allowedValue)}`;
      break;
    case "enum":
      message = `must be one of: ${(p.allowedValues as unknown[]).join(", ")}`;
      break;
    case "minimum":
      message = `must be at least ${p.limit}`;
      break;
    case "maximum":
      message = `must be at most ${p.limit}`;
      break;
    case "exclusiveMinimum":
      message = `must be greater than ${p.limit}`;
      break;
    case "minItems":
      message = isPair ? "must be an [x, y] coordinate pair" : `needs at least ${p.limit} entries`;
      break;
    case "maxItems":
      message = isPair ? "must be an [x, y] coordinate pair" : `has too many entries (max ${p.limit})`;
      break;
    case "minLength":
      message = "must not be empty";
      break;
    case "maxLength":
      message = `is too long (max ${p.limit} characters)`;
      break;
    case "pattern":
      message = "may only use lowercase letters, digits, '-' and '_' and must start with a letter or digit";
      break;
    default:
      message = e.message ?? "is invalid";
  }
  return { severity: "error", path, message };
}
