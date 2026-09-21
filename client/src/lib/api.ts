import type { SampleDetail, SampleSummary, ValidationResult } from "../../../shared/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Cannot reach the SpacePlanner server. Is it running (npm run dev)?");
  }
  if (!res.ok) {
    let msg = `Server error (${res.status})`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface Health {
  ok: boolean;
  version: string;
  providers: { groq: boolean; gemini: boolean; openrouter: boolean };
}

export const getHealth = () => request<Health>("/api/health");
export const getSamples = () => request<SampleSummary[]>("/api/samples");
export const getSample = (id: string) => request<SampleDetail>(`/api/samples/${encodeURIComponent(id)}`);
export const validatePlan = (plan: unknown) =>
  request<ValidationResult>("/api/floorplans/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });

import type { Catalog, FeasibilityResult, FloorPlan, Layout, Requirements } from "../../../shared/types";

export interface ApiIssue {
  path: string;
  message: string;
}

export const getCatalog = () => request<Catalog>("/api/catalog");
export const getSampleRequirements = (id: string) => request<Requirements>(`/api/samples/${encodeURIComponent(id)}/requirements`);

const post = <T,>(url: string, body: unknown) =>
  request<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const checkFeasibility = (plan: FloorPlan, requirements: Requirements) => post<FeasibilityResult>("/api/feasibility", { plan, requirements });
export const generateLayout = (plan: FloorPlan, requirements: Requirements) => post<Layout>("/api/generate", { plan, requirements });

export const getGodotStatus = () => request<{ installed: boolean; path: string | null }>("/api/godot/status");
export const openInGodot = (plan: FloorPlan, layout: Layout) => post<{ ok: boolean; dir: string; models: number; items: number }>("/api/export/godot/open", { plan, layout });

export async function downloadGodotProject(plan: FloorPlan, layout: Layout): Promise<void> {
  const res = await fetch("/api/export/godot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, layout }) });
  if (!res.ok) throw new Error("Could not build the Godot project");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${plan.id}-godot-project.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
