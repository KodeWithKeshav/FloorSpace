import crypto from "node:crypto";
import type { Alternative, Catalog, FeasibilityResult, FloorPlan, Layout, Requirements, ZoneRequest } from "../../../shared/types";
import { generateLayout, expandRequests, labelOf } from "./generator";
import { unitSize } from "./units";
import type { UnitKind } from "./units";

const cache = new Map<string, Layout>();

const key = (plan: FloorPlan, req: Requirements, unlimited: boolean) =>
  crypto.createHash("sha1").update(JSON.stringify([plan, req, unlimited])).digest("hex");

/** Cached generation: repeated demo runs of the same floor and brief are instant. */
export function generateCached(plan: FloorPlan, req: Requirements, catalog: Catalog, unlimited = false): Layout {
  const k = key(plan, req, unlimited);
  let hit = cache.get(k);
  if (!hit) {
    hit = generateLayout(plan, req, catalog, { unlimitedSeats: unlimited });
    cache.set(k, hit);
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
  }
  return structuredClone(hit);
}

const seatsOf = (req: Requirements) => req.zones.filter((z) => z.type === "workstation").reduce((n, z) => n + (z.seats ?? 0), 0);
const workSeats = (l: Layout) => l.zones.filter((z) => z.type === "workstation").reduce((n, z) => n + z.seats, 0);

/** Rough area the brief needs before circulation: every room's footprint plus about 2.4 m² gross per workstation. */
export function estimateRequiredArea(req: Requirements, catalog: Catalog): number {
  const cat = (id: string) => catalog.items.find((i) => i.id === id)!;
  let total = 0;
  for (const w of expandRequests(req)) {
    if (w.type === "workstation") {
      total += (w.seats ?? 0) * 2.4;
      continue;
    }
    const s = unitSize(w.type as UnitKind, { capacity: w.capacity, seats: w.seats }, cat);
    total += s.W * s.D * w.count;
  }
  return Math.round(total * 10) / 10;
}

export function checkFeasibility(plan: FloorPlan, req: Requirements, catalog: Catalog): FeasibilityResult {
  const requested = seatsOf(req);
  const layout = generateCached(plan, req, catalog);
  const m = layout.metrics;
  const placedSeats = workSeats(layout);
  const unplaced = layout.report.warnings.filter((w) => /could not be placed/.test(w)).map((w) => w.replace(/ could not be placed.*/, ""));
  const fits = unplaced.length === 0 && placedSeats >= requested;

  let maxSeats = placedSeats;
  if (requested > 0 && !fits) maxSeats = workSeats(generateCached(plan, req, catalog, true));
  else if (requested > 0) maxSeats = Math.max(placedSeats, requested);

  const minPerSeat = req.constraints?.minAreaPerSeat ?? 4.5;
  const target = req.constraints?.targetUtilization ?? 0.8;
  let status: FeasibilityResult["status"] = "ok";
  if (!fits) status = "infeasible";
  else if (m.utilization > Math.max(target, 0.78) || (placedSeats > 0 && m.areaPerSeat < minPerSeat)) status = "tight";

  const required = estimateRequiredArea(req, catalog);
  const usable = m.usableAreaSqM;

  let headline: string;
  if (status === "infeasible") {
    const parts: string[] = [];
    if (requested > 0 && maxSeats < requested) parts.push(`only ${maxSeats} of the ${requested} requested seats fit`);
    if (unplaced.length) parts.push(`${unplaced.join(", ")} would not fit`);
    headline = `This brief does not fit: ${parts.join(" and ")}, once every room is placed with proper aisles and door clearances.`;
  } else if (status === "tight") {
    headline = `Fits, but tightly: ${Math.round(m.utilization * 100)}% of the floor is occupied.`;
  } else {
    headline = `Fits comfortably: ${Math.round(m.utilization * 100)}% of the floor is occupied.`;
  }

  const alternatives = status === "infeasible" ? buildAlternatives(plan, req, catalog, requested, maxSeats, unplaced) : [];
  return { status, floorAreaSqM: m.floorAreaSqM, usableAreaSqM: usable, requiredAreaSqM: required, requestedSeats: requested, maxSeats, unplaced, headline, alternatives };
}

function buildAlternatives(plan: FloorPlan, req: Requirements, catalog: Catalog, requested: number, maxSeats: number, unplaced: string[]): Alternative[] {
  const out: Alternative[] = [];
  const clone = (): Requirements => structuredClone(req);
  // Applying an alternative should give a brief that actually fits, so the seat count is capped at what it holds.
  const capSeats = (r: Requirements, seats: number) => {
    for (const z of r.zones) if (z.type === "workstation") z.seats = Math.min(z.seats ?? requested, Math.max(1, seats));
  };
  const evaluate = (r: Requirements): { seats: number; allPlaced: boolean } => {
    const l = generateCached(plan, r, catalog, true);
    const seats = workSeats(l);
    const missing = l.report.warnings.some((w) => /could not be placed/.test(w));
    return { seats, allPlaced: !missing };
  };

  // 1. Same brief, fewer seats: the honest maximum.
  if (maxSeats > 0 && maxSeats < requested && unplaced.length === 0) {
    const r = clone();
    for (const z of r.zones) if (z.type === "workstation") z.seats = maxSeats;
    out.push({ id: "fewer-seats", title: `Reduce to ${maxSeats} seats`, detail: `Keeps every room in the brief and uses the space that is left for desks.`, seatsAfter: maxSeats, requirements: r });
  }

  // 2. Denser benching.
  const ws = req.zones.find((z) => z.type === "workstation");
  if (ws && ws.preferredStyle !== "linear_8pack") {
    const r = clone();
    for (const z of r.zones) if (z.type === "workstation") z.preferredStyle = "linear_8pack";
    const e = evaluate(r);
    if (e.seats > maxSeats && e.allPlaced) {
      capSeats(r, e.seats);
      out.push({ id: "denser-benching", title: "Switch to 8-desk benching", detail: `Longer desk rows waste less floor on cross-aisles: ${e.seats} seats fit instead of ${maxSeats}.`, seatsAfter: e.seats, requirements: r });
    }
  }

  // 3. Essentials only: reception and a single meeting room, everything else becomes desks.
  {
    const r = clone();
    const keep = new Set(["workstation", "reception", "meeting"]);
    r.zones = r.zones.filter((z) => keep.has(z.type)).map((z) => (z.type === "meeting" ? { ...z, count: 1 } : z));
    const dropped = req.zones.length - r.zones.length;
    if (dropped > 0) {
      const e = evaluate(r);
      if (e.seats > maxSeats && e.allPlaced) {
        capSeats(r, e.seats);
        out.push({ id: "essentials", title: "Keep only the essentials", detail: `Reception, one meeting room and desks: ${e.seats} seats fit.`, seatsAfter: e.seats, requirements: r });
      }
    }
  }

  // 4. Drop one instance of the biggest optional rooms.
  const tryDrop = (type: ZoneRequest["type"], title: string, detail: string) => {
    const idx = req.zones.findIndex((z) => z.type === type);
    if (idx < 0) return;
    const r = clone();
    const z = r.zones[idx];
    if ((z.count ?? 1) > 1) z.count = (z.count ?? 1) - 1;
    else r.zones.splice(idx, 1);
    const e = evaluate(r);
    if (e.allPlaced && (e.seats > maxSeats || unplaced.length)) {
      capSeats(r, e.seats);
      out.push({ id: `drop-${type}`, title, detail: `${detail} ${e.seats} seats fit.`, seatsAfter: e.seats, requirements: r });
    }
  };
  tryDrop("meeting", "Remove one meeting room", "Frees a full room of floor for desks.");
  tryDrop("cafeteria", "Drop the cafeteria", "Use the pantry for refreshments instead.");
  tryDrop("cabin", "Remove one cabin", "Converts a private office into open-plan space.");

  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true))).sort((a, b) => b.seatsAfter - a.seatsAfter).slice(0, 4);
}

export { labelOf };
