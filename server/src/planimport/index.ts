import type { PlanExtraction, PlanImportResult } from "../../../shared/types";
import { completeVision } from "../llm";
import { validateFloorPlan } from "../validation/floorplan";
import { EXTRACTION_SCHEMA, EXTRACTION_SYSTEM, EXTRACTION_USER, parseExtraction } from "./extraction";
import { reconstructPlan } from "./reconstruct";
import { detectOpenings, mergeOpenings } from "./gaps";
import { alignToInk, findColumns, refineCores } from "./align";
import type { ReconstructOptions } from "./reconstruct";

/** Rebuild + validate: pure code, no AI. Used after the AI reads the image and again when the user corrects a number. */
export function buildFromExtraction(extraction: PlanExtraction, opt: ReconstructOptions): PlanImportResult {
  const r = reconstructPlan(extraction, opt);
  const validation = r.plan ? validateFloorPlan(r.plan) : null;
  return {
    ok: Boolean(r.plan) && !r.needsScale && Boolean(validation?.valid),
    needsScale: r.needsScale,
    plan: validation?.plan ?? r.plan,
    validation,
    extraction,
    edges: r.edges,
    notes: [...r.notes, ...extraction.warnings.map((w) => `AI note: ${w}`)],
  };
}

/** Read a plan image with a vision model, then rebuild it exactly from the dimensions it printed. */
export async function importPlanFromImage(img: { base64: string; mimeType: string; width: number; height: number }, opt: Omit<ReconstructOptions, "width" | "height">): Promise<PlanImportResult> {
  const llm = await completeVision({
    system: EXTRACTION_SYSTEM,
    user: EXTRACTION_USER,
    imageBase64: img.base64,
    mimeType: img.mimeType,
    schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0,
    maxTokens: 8192,
  });
  let extraction = parseExtraction(llm.json);
  const notes: string[] = [];

  // The AI is rough about *where* things are on the page: snap the outline onto the real wall lines first.
  let aligned = false;
  if (img.mimeType === "image/jpeg") {
    const al = alignToInk(Buffer.from(img.base64, "base64"), extraction);
    extraction = al.extraction;
    aligned = al.aligned;
    if (al.note) notes.push(al.note);
  }

  // Doors and windows: trust a pixel scan of the wall lines over the AI's guesses when the drawing is clean.
  if (aligned) extraction = refineCores(Buffer.from(img.base64, "base64"), extraction);

  // Columns are solid black squares: take their exact positions from the pixels when the outline was snapped.
  if (aligned) {
    const cols = findColumns(Buffer.from(img.base64, "base64"), extraction.vertices);
    if (cols.length > 0 && cols.length <= 200) {
      extraction.obstacles = [...extraction.obstacles.filter((o) => o.type !== "column"), ...cols.map((polygon) => ({ type: "column" as const, label: null, polygon }))];
      notes.push(`${cols.length} structural column${cols.length === 1 ? "" : "s"} located from the drawing.`);
    }
  }

  // The scan needs exact wall positions, so it only runs once the outline has been snapped onto the drawing.
  if (aligned && extraction.vertices.length >= 3) {
    const printed = extraction.edgeDimensions.find((d) => d.meters);
    let mpp: number | undefined;
    if (printed) {
      const a = extraction.vertices[printed.edge % extraction.vertices.length], b = extraction.vertices[(printed.edge + 1) % extraction.vertices.length];
      const px = Math.hypot((b[0] - a[0]) * img.width, (b[1] - a[1]) * img.height);
      if (px > 0) mpp = (printed.meters as number) / px;
    }
    const scan = detectOpenings(Buffer.from(img.base64, "base64"), extraction.vertices, mpp);
    if (scan.skipped) notes.push(`Wall scan skipped: ${scan.skipped}. Doors and windows are the AI's reading only.`);
    else {
      const merged = mergeOpenings(scan.openings, extraction.openings);
      extraction.openings = merged.openings;
      if (merged.note) notes.push(merged.note);
    }
  }
  const result = buildFromExtraction(extraction, { ...opt, width: img.width, height: img.height });
  return { ...result, notes: [...notes, ...result.notes], provider: llm.provider, model: llm.model, latencyMs: llm.latencyMs };
}
