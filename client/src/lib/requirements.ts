import type { Requirements, ZoneRequest, ZoneType } from "../../../shared/types";

export const ZONE_META: Record<ZoneType, { label: string; hint: string; unit: "seats" | "count"; color: string }> = {
  workstation: { label: "Workstations", hint: "Desk seats in open plan", unit: "seats", color: "#5b7c99" },
  cabin: { label: "Cabins", hint: "Private offices", unit: "count", color: "#b08d57" },
  meeting: { label: "Meeting rooms", hint: "Enclosed, glass fronted", unit: "count", color: "#4d8fc7" },
  cafeteria: { label: "Cafeteria", hint: "Counter, tables and vending", unit: "seats", color: "#d08a4a" },
  reception: { label: "Reception", hint: "Desk and waiting area at the entry", unit: "count", color: "#0f6b5c" },
  phonebooth: { label: "Phone booths", hint: "Single-person call pods", unit: "count", color: "#7a6fb0" },
  lounge: { label: "Lounge", hint: "Sofas and informal seating", unit: "count", color: "#b86b8d" },
  storage: { label: "Storage", hint: "Cabinet room", unit: "count", color: "#8b94a5" },
  pantry: { label: "Pantry", hint: "Coffee point and water", unit: "count", color: "#c9a24b" },
};

export const ZONE_ORDER: ZoneType[] = ["workstation", "cabin", "meeting", "reception", "cafeteria", "pantry", "lounge", "phonebooth", "storage"];

export const PREFERENCES: { value: NonNullable<ZoneRequest["preference"]>; label: string }[] = [
  { value: "none", label: "No preference" },
  { value: "window", label: "By a window" },
  { value: "core_adjacent", label: "Near the core" },
  { value: "entry_adjacent", label: "Near the entry" },
  { value: "quiet", label: "Quiet, away from entry" },
];

export const STYLES = [
  { value: "linear_4pack", label: "4-desk pods" },
  { value: "linear_6pack", label: "6-desk pods" },
  { value: "linear_8pack", label: "8-desk pods" },
];

export function defaultRequirements(): Requirements {
  return {
    schemaVersion: "1.0",
    projectName: "New fit-out",
    zones: [
      { type: "reception", count: 1, preference: "entry_adjacent" },
      { type: "workstation", seats: 20, preferredStyle: "linear_6pack" },
      { type: "meeting", count: 1, capacityEach: 6, preference: "core_adjacent" },
    ],
    constraints: { minAreaPerSeat: 4.5, targetUtilization: 0.75, accessibleRoutes: true },
  };
}

export function defaultZone(type: ZoneType): ZoneRequest {
  switch (type) {
    case "workstation": return { type, seats: 20, preferredStyle: "linear_6pack" };
    case "cafeteria": return { type, count: 1, seats: 16 };
    case "meeting": return { type, count: 1, capacityEach: 6, preference: "core_adjacent" };
    case "cabin": return { type, count: 1, seatsEach: 1, preference: "window" };
    default: return { type, count: 1 };
  }
}
