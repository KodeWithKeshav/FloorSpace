/** Shared contract between server and client. Coordinates are metres in plan space (origin bottom-left, y up). */

export type Pt = [number, number];

export interface Circulation {
  mainCorridorWidth: number;
  secondaryCorridorWidth: number;
  minClearanceToWall: number;
}

export interface Obstacle {
  id: string;
  type: "core" | "column" | "shaft" | "stair";
  polygon: Pt[];
  height?: number;
  label?: string;
}

export interface Opening {
  id: string;
  type: "door" | "window";
  wall: [Pt, Pt];
  height: number;
  sillHeight?: number;
  isEntry?: boolean;
}

export interface FloorPlan {
  schemaVersion: "1.0";
  id: string;
  name: string;
  description?: string;
  units: "meters";
  floor: { boundary: Pt[]; ceilingHeight: number };
  obstacles: Obstacle[];
  openings: Opening[];
  circulation: Circulation;
  metadata?: Record<string, unknown>;
}

export type IssueSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  severity: IssueSeverity;
  /** JSON path of the offending value, e.g. "openings[2].wall". Empty string = whole document. */
  path: string;
  message: string;
}

export interface PlanStats {
  floorAreaSqM: number;
  obstacleAreaSqM: number;
  usableAreaSqM: number;
  perimeterM: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
  vertexCount: number;
  shape: "Rectangular" | "L-shaped" | "Non-rectangular";
  cores: number;
  columns: number;
  doors: number;
  windows: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  /** Normalised plan (CCW boundary, circulation defaults filled). Present only when valid. */
  plan: FloorPlan | null;
  stats: PlanStats | null;
}

export interface SampleSummary {
  id: string;
  name: string;
  description: string;
  valid: boolean;
  stats: PlanStats | null;
  /** Suggested brief for this floor plan, if one ships with the samples. */
  brief: {
    id: string;
    projectName: string;
    workstationSeats: number;
    expectedOutcome: "feasible" | "infeasible";
  } | null;
}

export interface SampleDetail {
  raw: unknown;
  validation: ValidationResult;
}

// ───────────────────────── Asset catalog ─────────────────────────

export type CatalogCategory =
  | "workstation" | "chair" | "meeting" | "reception" | "cafeteria" | "lounge"
  | "storage" | "equipment" | "decor";

export interface CatalogItem {
  id: string;
  name: string;
  category: CatalogCategory;
  /** URL under /assets/models */
  model: string;
  /** Real-world size in metres once scaled, in the model's own frame (width = X, depth = Z, front = +Z). */
  footprint: { width: number; depth: number };
  height: number;
  seats: number;
  /** Space that must stay free in front of the item (metres). */
  clearance: { front: number; back: number; left: number; right: number };
  /** Metres above the floor the item hangs (wall boards). */
  elevation: number;
  /** Uniform scale that converts the raw model to metres. */
  scale: number;
  /** Rotation about Y applied to the raw model so its front faces +Z (degrees). */
  frontYawDeg: number;
  /** Position (scaled, rotated frame) of the bbox bottom-centre; subtract it to sit the model on the origin. */
  origin: [number, number, number];
  /** Raw measured bounding box before correction. */
  raw: { size: [number, number, number]; triangles: number; bytes: number };
  /** Set when the raw model was far from real-world scale and had to be corrected. */
  scaleWarning?: string;
  /** Simple built-in shape drawn instead of a GLB (tables, etc.). `model` is empty for these. */
  procedural?: { shape: "cylinder" | "box"; color: string };
}

export interface Catalog {
  generatedAt: string;
  items: CatalogItem[];
}


// ───────────────────────── Requirements ─────────────────────────

export type ZoneType =
  | "workstation" | "cabin" | "meeting" | "cafeteria" | "reception"
  | "phonebooth" | "lounge" | "storage" | "pantry";

export type Preference = "window" | "core_adjacent" | "entry_adjacent" | "quiet" | "none";

export interface ZoneRequest {
  type: ZoneType;
  count?: number;
  seats?: number;
  seatsEach?: number;
  capacityEach?: number;
  preferredStyle?: string;
  preference?: Preference;
}

export interface Requirements {
  schemaVersion: "1.0";
  id?: string;
  floorPlanId?: string;
  projectName?: string;
  expectedOutcome?: "feasible" | "infeasible";
  expectedResponse?: string;
  freeTextEquivalent?: string;
  zones: ZoneRequest[];
  constraints?: { minAreaPerSeat?: number; targetUtilization?: number; accessibleRoutes?: boolean };
}

// ───────────────────────── Layout ─────────────────────────

export interface LayoutZone {
  id: string;
  type: ZoneType;
  label: string;
  /** Axis-aligned rectangle corners, counter-clockwise. */
  polygon: Pt[];
  seats: number;
  /** True for rooms with partition walls and a door. */
  enclosed: boolean;
  /** Door in the room's front wall. */
  door?: { center: Pt; width: number; facingDeg: number };
  /** Direction the unit's front faces (degrees CCW from +x). Rooms and open zones alike. */
  facingDeg?: number;
}

export interface Placement {
  id: string;
  itemId: string;
  zoneId: string;
  /** Centre of the item's footprint in plan space. */
  position: Pt;
  /** Direction the item's front faces in plan space: degrees counter-clockwise from +x. */
  rotationDeg: number;
  /** Uniform size multiplier set in edit mode (1 = as catalogued). */
  scale?: number;
}

export interface Partition {
  id: string;
  zoneId: string;
  a: Pt;
  b: Pt;
  glass: boolean;
}

export interface Corridor {
  polygon: Pt[];
  width: number;
}

export interface ZoneAreaRow {
  type: ZoneType;
  label: string;
  count: number;
  areaSqM: number;
  seats: number;
}

export interface LayoutMetrics {
  floorAreaSqM: number;
  /** Cores, shafts and columns. */
  structureAreaSqM: number;
  /** Floor minus structure. */
  usableAreaSqM: number;
  /** Structure plus every room and zone footprint. */
  occupiedAreaSqM: number;
  /** Floor minus occupied: circulation plus unassigned floor. */
  freeAreaSqM: number;
  circulationAreaSqM: number;
  unassignedAreaSqM: number;
  /** Sum of furniture footprints only. */
  furnitureFootprintSqM: number;
  utilization: number;
  seatsProvided: number;
  seatsRequested: number;
  /** Usable area per workstation seat. */
  areaPerSeat: number;
  circulationRatio: number;
  zoneBreakdown: ZoneAreaRow[];
}

export interface LayoutReport {
  feasible: boolean;
  warnings: string[];
  suggestions: string[];
  explanation: string;
}

export interface Layout {
  schemaVersion: "1.0";
  floorPlanId: string;
  generatedAt: string;
  mode: string;
  zones: LayoutZone[];
  placements: Placement[];
  partitions: Partition[];
  corridors: Corridor[];
  metrics: LayoutMetrics;
  report: LayoutReport;
  /** True once furniture has been moved, resized or changed in the 3D editor. */
  edited?: boolean;
}

// ───────────────────────── Feasibility ─────────────────────────

export interface Alternative {
  id: string;
  title: string;
  detail: string;
  /** Seats the floor can hold if this alternative is applied. */
  seatsAfter: number;
  requirements: Requirements;
}

export interface FeasibilityResult {
  status: "ok" | "tight" | "infeasible";
  floorAreaSqM: number;
  usableAreaSqM: number;
  /** Rough area the brief needs (rooms, zones and workstations, before circulation). */
  requiredAreaSqM: number;
  requestedSeats: number;
  /** Most workstation seats the floor can hold once every other requested zone is placed. */
  maxSeats: number;
  /** Requested zones that could not be placed at all. */
  unplaced: string[];
  headline: string;
  alternatives: Alternative[];
}
