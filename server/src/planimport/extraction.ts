import type { PlanExtraction } from "../../../shared/types";

/** JSON Schema of the AI's answer (also sent to the model as its output contract). */
export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", nullable: true },
    units: { type: "string", enum: ["m", "mm", "cm", "ft", "unknown"] },
    ceilingHeightM: { type: "number", nullable: true },
    vertices: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 } },
    edgeDimensions: {
      type: "array",
      items: {
        type: "object",
        properties: { edge: { type: "integer" }, text: { type: "string" }, meters: { type: "number", nullable: true } },
        required: ["edge", "text"],
      },
    },
    openings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["door", "window"] },
          x0: { type: "number" },
          y0: { type: "number" },
          x1: { type: "number" },
          y1: { type: "number" },
          widthMeters: { type: "number", nullable: true },
          isEntry: { type: "boolean" },
        },
        required: ["type", "x0", "y0", "x1", "y1"],
      },
    },
    obstacles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["core", "column", "shaft", "stair"] },
          label: { type: "string", nullable: true },
          polygon: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 } },
        },
        required: ["type", "polygon"],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["units", "vertices", "edgeDimensions", "openings", "obstacles", "warnings"],
} as const;

export const EXTRACTION_SYSTEM = `You are an expert at reading architectural floor plans and structural drawings. You are given one image of a floor plan. Read it and return ONLY the JSON described by the schema.

COORDINATES: every point is normalised to the FULL image you were given: x runs left to right and y runs TOP to BOTTOM, both from 0 to 1.

OUTLINE ("vertices"): the inside edge of the building's outer walls, as an ordered list of corner points going once around the building (either direction). Use only true corners: a plain rectangle has 4 points, an L-shape 6. Do not repeat the first point at the end. Ignore furniture, room subdivisions, hatching, title blocks, notes and other floors.

DIMENSIONS ("edgeDimensions"): edge i runs from vertices[i] to vertices[(i+1) % n]. For every outer wall that has a printed length (dimension line, or dimension chain segment that clearly covers that whole wall), give the text exactly as printed and "meters": the value converted to metres using the drawing's units (e.g. "18000" on a millimetre drawing = 18; "59'-0\\"" = 17.98; "12.50" on a metre drawing = 12.5). If several dimensions could apply, use the one that spans exactly that wall. If a wall has no printed length, leave it out. Never invent a dimension. If an overall dimension covers several walls together, do not assign it to one wall.

UNITS ("units"): the drawing's dimension unit if it can be told from the numbers or notes (m, mm, cm, ft), otherwise "unknown".

OPENINGS: every door and every window in the OUTER walls. Give each as its two END POINTS on the drawing, in the same normalised image coordinates: (x0, y0) is where the opening starts along the wall and (x1, y1) is where it ends, measured along the wall line itself. Do not use wall numbers. A DOOR is a gap in the thick wall line with a leaf line and a quarter-circle swing arc. A WINDOW is a section of the wall drawn as a gap filled with thin parallel lines (often three thin lines) instead of the thick wall. Look carefully along EVERY outer wall and list all of them: windows are usually the long ones. Set "isEntry": true on the main entrance only (labelled ENTRY/ENTRANCE/LOBBY/MAIN, or the obvious front door), false on the others. If a width is printed, put it in "widthMeters".

OBSTACLES: lift/elevator cores, stair cores, service shafts, toilet cores and other solid blocks that furniture cannot use ("core", "stair", "shaft"), and every structural column ("column"). Give each as a polygon (4 corner points for rectangles). Include every column you can see, even in a regular grid. "label" is its text if any.

OTHER: "ceilingHeightM" only if a ceiling or floor-to-floor height is written on the drawing. "name" is the drawing or project title if there is one. "warnings" lists anything you were unsure about (blurry text, dimensions you could not read, walls you were not certain of). Be honest in warnings rather than guessing.`;

export const EXTRACTION_USER = "Read this floor plan and return the JSON.";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const pt = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length >= 2 && num(v[0]) !== null && num(v[1]) !== null ? [clamp01(v[0] as number), clamp01(v[1] as number)] : null);

/** Defensive read of whatever the model returned: wrong types are dropped, coordinates clamped. */
export function parseExtraction(raw: unknown): PlanExtraction {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const units = ["m", "mm", "cm", "ft"].includes(String(o.units)) ? (o.units as PlanExtraction["units"]) : "unknown";
  const vertices = (Array.isArray(o.vertices) ? o.vertices : []).map(pt).filter((p): p is [number, number] => p !== null);
  const edgeDimensions = (Array.isArray(o.edgeDimensions) ? o.edgeDimensions : []).flatMap((d: any) => {
    const edge = num(d?.edge);
    if (edge === null || !Number.isInteger(edge)) return [];
    const m = num(d?.meters);
    return [{ edge, text: String(d?.text ?? ""), meters: m !== null && m > 0 ? m : null }];
  });
  const openings = (Array.isArray(o.openings) ? o.openings : []).flatMap((p: any) => {
    const x0 = num(p?.x0), y0 = num(p?.y0), x1 = num(p?.x1), y1 = num(p?.y1);
    if (x0 === null || y0 === null || x1 === null || y1 === null || (p?.type !== "door" && p?.type !== "window")) return [];
    if (Math.hypot(x1 - x0, y1 - y0) < 0.004) return [];
    const w = num(p?.widthMeters);
    return [{ type: p.type as "door" | "window", x0: clamp01(x0), y0: clamp01(y0), x1: clamp01(x1), y1: clamp01(y1), widthMeters: w !== null && w > 0 ? w : null, isEntry: p?.isEntry === true }];
  });
  const obstacles = (Array.isArray(o.obstacles) ? o.obstacles : []).flatMap((b: any) => {
    const poly = (Array.isArray(b?.polygon) ? b.polygon : []).map(pt).filter((p: unknown): p is [number, number] => p !== null);
    const type = ["core", "column", "shaft", "stair"].includes(String(b?.type)) ? (b.type as "core" | "column" | "shaft" | "stair") : "core";
    return poly.length >= 3 ? [{ type, label: typeof b?.label === "string" ? b.label : null, polygon: poly }] : [];
  });
  return {
    name: typeof o.name === "string" ? o.name : null,
    units,
    ceilingHeightM: num(o.ceilingHeightM),
    vertices,
    edgeDimensions,
    openings,
    obstacles,
    warnings: (Array.isArray(o.warnings) ? o.warnings : []).map(String).slice(0, 20),
  };
}
