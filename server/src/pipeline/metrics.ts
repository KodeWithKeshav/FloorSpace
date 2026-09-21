import type { Catalog, FloorPlan, Layout, LayoutMetrics, ZoneType } from "../../../shared/types";
import { area } from "../../../shared/geometry";

const LABELS: Record<ZoneType, string> = {
  workstation: "Open plan", cabin: "Cabins", meeting: "Meeting rooms", cafeteria: "Cafeteria", reception: "Reception",
  phonebooth: "Phone booths", lounge: "Lounge & planting", storage: "Storage & print", pantry: "Pantry",
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Area accounting for the finished layout.
 *  - occupied = structure (cores, columns) + every room and zone footprint
 *  - free     = floor - occupied, made of circulation (corridors, aisles, door approaches) and unassigned floor
 */
export function computeMetrics(plan: FloorPlan, layout: Layout, catalog: Catalog, requestedSeats: number, circulationArea = 0): LayoutMetrics {
  const floor = area(plan.floor.boundary);
  const structure = plan.obstacles.reduce((s, o) => s + area(o.polygon), 0);
  const zonesArea = layout.zones.reduce((s, z) => s + area(z.polygon), 0);
  const occupied = Math.min(floor, structure + zonesArea);
  const free = Math.max(0, floor - occupied);
  const circulation = Math.min(free, circulationArea);

  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  let furniture = 0;
  for (const p of layout.placements) {
    const it = byId.get(p.itemId);
    if (it && it.elevation === 0) furniture += it.footprint.width * it.footprint.depth;
  }

  const seats = layout.zones.filter((z) => z.type === "workstation").reduce((n, z) => n + z.seats, 0);
  const rows = new Map<ZoneType, { count: number; area: number; seats: number }>();
  for (const z of layout.zones) {
    if (z.label === "Planting" || z.label === "Print station") continue;
    const r = rows.get(z.type) ?? { count: 0, area: 0, seats: 0 };
    r.count += 1;
    r.area += area(z.polygon);
    r.seats += z.seats;
    rows.set(z.type, r);
  }

  return {
    floorAreaSqM: r1(floor),
    structureAreaSqM: r1(structure),
    usableAreaSqM: r1(floor - structure),
    occupiedAreaSqM: r1(occupied),
    freeAreaSqM: r1(free),
    circulationAreaSqM: r1(circulation),
    unassignedAreaSqM: r1(Math.max(0, free - circulation)),
    furnitureFootprintSqM: r1(furniture),
    utilization: Math.round((occupied / floor) * 1000) / 1000,
    seatsProvided: seats,
    seatsRequested: requestedSeats,
    areaPerSeat: seats > 0 ? r1((floor - structure) / seats) : 0,
    circulationRatio: Math.round((circulation / floor) * 1000) / 1000,
    zoneBreakdown: [...rows.entries()].map(([type, r]) => ({ type, label: LABELS[type], count: r.count, areaSqM: r1(r.area), seats: r.seats })),
  };
}
