import fs from "node:fs";
import path from "node:path";
import type { SampleSummary, SampleDetail } from "../../shared/types";
import { SAMPLES_DIR } from "./paths";
import { validateFloorPlan } from "./validation/floorplan";

interface RequirementsSet {
  id: string;
  floorPlanId: string;
  projectName: string;
  expectedOutcome: "feasible" | "infeasible";
  zones: { type: string; seats?: number }[];
}

const REQUIREMENTS_FILE = "requirements.json";

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, file), "utf8"));
}

function requirementSets(): RequirementsSet[] {
  try {
    const doc = readJson(REQUIREMENTS_FILE) as { sets?: RequirementsSet[] };
    return Array.isArray(doc.sets) ? doc.sets : [];
  } catch {
    return [];
  }
}

/** File names (without extension) of every sample floor plan on disk. */
export function listSampleIds(): string[] {
  if (!fs.existsSync(SAMPLES_DIR)) return [];
  return fs
    .readdirSync(SAMPLES_DIR)
    .filter((f) => f.endsWith(".json") && f !== REQUIREMENTS_FILE)
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

// Show the easy case first and the infeasible demo last, whatever the file names are.
const ORDER = ["small-office", "l-shaped-floor", "large-open-floor", "tight-floor"];

export function listSamples(): SampleSummary[] {
  const sets = requirementSets();
  const ids = listSampleIds().sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  return ids.map((id) => {
    const raw = readJson(`${id}.json`) as { id?: string; name?: string; description?: string };
    const result = validateFloorPlan(raw);
    const set = sets.find((s) => s.floorPlanId === (raw.id ?? id));
    return {
      id,
      name: raw.name ?? id,
      description: raw.description ?? "",
      valid: result.valid,
      stats: result.stats,
      brief: set
        ? {
            id: set.id,
            projectName: set.projectName,
            workstationSeats: set.zones.filter((z) => z.type === "workstation").reduce((n, z) => n + (z.seats ?? 0), 0),
            expectedOutcome: set.expectedOutcome,
          }
        : null,
    };
  });
}

export function getSampleRequirements(id: string) {
  if (!listSampleIds().includes(id)) return null;
  const raw = readJson(`${id}.json`) as { id?: string };
  const set = requirementSets().find((s) => s.floorPlanId === (raw.id ?? id));
  return set ? { schemaVersion: "1.0", ...set } : null;
}

export function getSample(id: string): SampleDetail | null {
  if (!listSampleIds().includes(id)) return null; // whitelist: never build a path from user input
  const raw = readJson(`${id}.json`);
  return { raw, validation: validateFloorPlan(raw) };
}
