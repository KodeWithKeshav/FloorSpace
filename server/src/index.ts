import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { ErrorRequestHandler } from "express";
import { CLIENT_DIST, ROOT } from "./paths";
import { getSample, getSampleRequirements, listSamples } from "./samples";
import { validateFloorPlan } from "./validation/floorplan";
import { SCHEMA_NAMES, schemaPath } from "./validation/schemas";
import type { SchemaName } from "./validation/schemas";
import { getValidator } from "./validation/schemas";
import { humanise } from "./validation/errors";
import { loadCatalog } from "./catalog";
import { checkFeasibility, generateCached } from "./pipeline/feasibility";
import { exportGodotProject } from "./godot/exportProject";
import { phoneRouter } from "./phone";
import { anyVisionProvider } from "./llm";
import { buildFromExtraction, importPlanFromImage } from "./planimport";
import { parseExtraction } from "./planimport/extraction";
import { findGodot, launchGodot, zipDirectory } from "./godot/launch";
import type { FloorPlan, Requirements } from "../../shared/types";

// Load .env from the repo root when present (Node 20.12+). Missing file is fine: offline mode needs no keys.
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  /* no .env */
}

const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "spaceplanner-server",
    version: "0.1.0",
    providers: {
      groq: Boolean(process.env.GROQ_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    },
  });
});

app.get("/api/samples", (_req, res) => {
  res.json(listSamples());
});

app.get("/api/samples/:id", (req, res) => {
  const sample = getSample(req.params.id);
  if (!sample) return void res.status(404).json({ error: `No sample floor plan called "${req.params.id}"` });
  res.json(sample);
});

app.post("/api/floorplans/validate", (req, res) => {
  const body = req.body as { plan?: unknown } | undefined;
  if (!body || !("plan" in body)) {
    return void res.status(400).json({ error: 'Send a JSON body shaped like { "plan": { ... } }' });
  }
  res.json(validateFloorPlan(body.plan));
});

// ── Catalog, requirements, feasibility, generation ─────────────────────────────

app.get("/api/catalog", (_req, res) => res.json(loadCatalog()));

app.get("/api/samples/:id/requirements", (req, res) => {
  const set = getSampleRequirements(req.params.id);
  if (!set) return void res.status(404).json({ error: "No suggested brief for this floor plan" });
  res.json(set);
});

/** Validates the plan and the brief, or answers with 422 and readable issues. */
function readInputs(body: any, res: express.Response): { plan: FloorPlan; req: Requirements } | null {
  const planResult = validateFloorPlan(body?.plan);
  if (!planResult.valid || !planResult.plan) {
    res.status(422).json({ error: "The floor plan has errors", issues: planResult.issues });
    return null;
  }
  const check = getValidator("requirements");
  const requirements = { schemaVersion: "1.0", ...(body?.requirements ?? {}) };
  if (!check(requirements)) {
    res.status(422).json({ error: "The requirements have errors", issues: (check.errors ?? []).map(humanise) });
    return null;
  }
  return { plan: planResult.plan, req: requirements as Requirements };
}

app.post("/api/feasibility", (req, res) => {
  const inp = readInputs(req.body, res);
  if (!inp) return;
  res.json(checkFeasibility(inp.plan, inp.req, loadCatalog()));
});

app.post("/api/generate", (req, res) => {
  const inp = readInputs(req.body, res);
  if (!inp) return;
  res.json(generateCached(inp.plan, inp.req, loadCatalog()));
});

app.use(phoneRouter());

// ── Plan from an image (AI reads it; code rebuilds it from the printed dimensions) ──

app.post("/api/floorplans/from-image", async (req, res) => {
  const b = req.body as { image?: string; width?: number; height?: number; ceilingHeightM?: number; longestWallMeters?: number } | undefined;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(b?.image ?? "");
  if (!m || !b?.width || !b?.height) return void res.status(400).json({ error: "Send { image: data URL (png/jpeg/webp), width, height }" });
  if (!anyVisionProvider()) return void res.status(503).json({ error: "AI is not set up. Add GEMINI_API_KEY (or OPENROUTER_API_KEY / GROQ_API_KEY) to .env and restart." });
  try {
    res.json(await importPlanFromImage({ base64: m[2], mimeType: m[1], width: b.width, height: b.height }, { ceilingHeightM: b.ceilingHeightM, longestWallMeters: b.longestWallMeters }));
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

/** Re-run the rebuild with corrected numbers. No AI call, so it is instant and free. */
app.post("/api/floorplans/from-extraction", (req, res) => {
  const b = req.body as { extraction?: unknown; width?: number; height?: number; ceilingHeightM?: number; longestWallMeters?: number } | undefined;
  if (!b?.extraction || !b.width || !b.height) return void res.status(400).json({ error: "Send { extraction, width, height }" });
  res.json(buildFromExtraction(parseExtraction(b.extraction), { width: b.width, height: b.height, ceilingHeightM: b.ceilingHeightM, longestWallMeters: b.longestWallMeters }));
});

// ── Godot export ───────────────────────────────────────────────────────────────

const EXPORTS_DIR = path.join(ROOT, "exports");

function stageProject(body: any, res: express.Response) {
  const planResult = validateFloorPlan(body?.plan);
  if (!planResult.valid || !planResult.plan || !body?.layout?.placements) {
    res.status(422).json({ error: "Send { plan, layout } from a generated layout" });
    return null;
  }
  const slug = `${planResult.plan.id}`.replace(/[^a-z0-9-_]/gi, "_");
  return { ...exportGodotProject(planResult.plan, body.layout, loadCatalog(), path.join(EXPORTS_DIR, `${slug}-godot`)), slug };
}

app.get("/api/godot/status", (_req, res) => {
  const g = findGodot();
  res.json({ installed: Boolean(g), path: g });
});

app.post("/api/export/godot", async (req, res) => {
  const staged = stageProject(req.body, res);
  if (!staged) return;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${staged.slug}-godot-project.zip"`);
  res.send(zipDirectory(staged.dir, `${staged.slug}-godot`));
});

app.post("/api/export/godot/open", async (req, res) => {
  const godot = findGodot();
  if (!godot) return void res.status(404).json({ error: "Godot was not found on this computer. Download the project instead, or set GODOT_PATH in .env." });
  const staged = stageProject(req.body, res);
  if (!staged) return;
  try {
    await launchGodot(godot, staged.dir);
    res.json({ ok: true, dir: staged.dir, models: staged.models, items: staged.items });
  } catch (e) {
    res.status(500).json({ error: `Could not start Godot: ${(e as Error).message}` });
  }
});

app.get("/api/schemas/:name", (req, res) => {
  const name = req.params.name as SchemaName;
  if (!SCHEMA_NAMES.includes(name)) return void res.status(404).json({ error: "Unknown schema" });
  res.type("application/schema+json").sendFile(schemaPath(name));
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Serve the built client when it exists (npm run build && npm start).
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (_req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
}

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "Request body is not valid JSON" });
  if (err?.type === "entity.too.large") return void res.status(413).json({ error: "File is too large (limit 5 MB)" });
  console.error(err);
  res.status(500).json({ error: "Unexpected server error" });
};
app.use(onError);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`[spaceplanner] API listening on http://localhost:${port}`));
