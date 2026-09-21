import type { CatalogItem, LayoutZone, Pt, ZoneType } from "../../../shared/types";
import { dist, distPointToSegment } from "../../../shared/geometry";

/**
 * A "unit" is one self-contained block of the layout (a cabin, a meeting room, the reception, a cafeteria...).
 * It is described in its own frame: +z is the unit's front (the way its door / visitors face), +x runs along its
 * width. The packer only ever decides where a rectangle goes and which way it faces; everything inside is fixed
 * by the templates here, so furniture is always correctly oriented relative to the room.
 */
export interface Frame {
  cx: number;
  cy: number;
  /** Direction the unit's front faces, degrees CCW from +x (always a multiple of 90). */
  theta: number;
  u: Pt; // local +x in plan space
  f: Pt; // local +z (front) in plan space
  W: number;
  D: number;
}

export interface UnitItem {
  itemId: string;
  position: Pt;
  rotationDeg: number;
}

export interface UnitWall {
  a: Pt;
  b: Pt;
  glass: boolean;
}

export interface UnitContent {
  items: UnitItem[];
  walls: UnitWall[];
  seats: number;
  door?: LayoutZone["door"];
}

export type UnitKind = "cabin" | "meeting" | "phonebooth" | "storage" | "pantry" | "cafeteria" | "lounge" | "reception";

export interface UnitParams {
  capacity?: number; // meeting
  seats?: number; // cafeteria
  style?: string;
}

export const zoneTypeOf = (k: UnitKind): ZoneType => k;
export const isEnclosed = (k: UnitKind) => k === "cabin" || k === "meeting" || k === "phonebooth" || k === "storage";

export function makeFrame(cx: number, cy: number, theta: number, W: number, D: number): Frame {
  const t = (theta * Math.PI) / 180;
  return { cx, cy, theta, u: [round(-Math.sin(t)), round(Math.cos(t))], f: [round(Math.cos(t)), round(Math.sin(t))], W, D };
}
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export const toPlan = (fr: Frame, dx: number, dz: number): Pt => [fr.cx + dx * fr.u[0] + dz * fr.f[0], fr.cy + dx * fr.u[1] + dz * fr.f[1]];
const norm = (d: number) => ((d % 360) + 360) % 360;

type Cat = (id: string) => CatalogItem;

interface Sizes {
  W: number;
  D: number;
}

export function unitSize(kind: UnitKind, p: UnitParams, cat: Cat): Sizes {
  switch (kind) {
    case "cabin":
      return { W: 3.0, D: 3.2 };
    case "meeting": {
      const big = (p.capacity ?? 8) > 6;
      const t = cat(big ? "table-meeting-8" : "table-meeting-6").footprint;
      return { W: t.width + 1.8, D: t.depth + 2.2 };
    }
    case "phonebooth":
      return { W: 1.5, D: 1.5 };
    case "storage":
      return { W: 2.5, D: 1.8 };
    case "pantry":
      return { W: 3.8, D: 2.2 };
    case "lounge":
      return { W: 4.8, D: 3.4 };
    case "reception":
      return { W: 4.6, D: 4.0 };
    case "cafeteria": {
      const c = cafeGrid(p.seats ?? 20);
      return { W: Math.max(c.cols * 2.0, 6.6), D: c.rows * 2.0 + 2.2 };
    }
  }
}

function cafeGrid(seats: number) {
  const clusters = Math.max(1, Math.ceil(seats / 4));
  const cols = Math.max(2, Math.ceil(Math.sqrt(clusters * 1.5)));
  return { clusters, cols, rows: Math.ceil(clusters / cols) };
}

/**
 * Builds a unit's furniture and partitions. `onBoundary(a,b)` tells whether a wall edge already coincides
 * with the building's outer wall (no partition needed there).
 */
export function buildUnit(kind: UnitKind, p: UnitParams, fr: Frame, cat: Cat, onBoundary: (a: Pt, b: Pt) => boolean): UnitContent {
  const items: UnitItem[] = [];
  let seats = 0;
  const add = (itemId: string, dx: number, dz: number, rot = 0) => {
    items.push({ itemId, position: toPlan(fr, dx, dz), rotationDeg: norm(fr.theta + rot) });
  };
  const W = fr.W, D = fr.D, back = -D / 2, front = D / 2;

  switch (kind) {
    case "cabin": {
      // Executive faces the door across the desk; visitors face the executive.
      add("desk-workstation", 0, back + 1.3, 180);
      add("chair-exec-brown", 0, back + 0.45, 0);
      add("chair-task-blue", -0.45, back + 2.3, 180);
      add("chair-task-blue", 0.45, back + 2.3, 180);
      add("cabinet", -W / 2 + 0.4, back + 0.4, 0);
      add("plant-fiddle", W / 2 - 0.4, back + 0.4, 0);
      seats = 1;
      break;
    }
    case "meeting": {
      const cap = p.capacity ?? 8;
      const big = cap > 6;
      const table = cat(big ? "table-meeting-8" : "table-meeting-6");
      add(table.id, 0, 0, 0);
      const ends = cap >= 4 ? 2 : 0;
      const perSide = Math.ceil((cap - ends) / 2);
      const pitch = 0.75;
      const zOff = table.footprint.depth / 2 + 0.3;
      for (let i = 0; i < perSide; i++) {
        const x = (i - (perSide - 1) / 2) * pitch;
        add("chair-task-blue", x, zOff, 180);
        add("chair-task-blue", x, -zOff, 0);
      }
      if (ends) {
        add("chair-exec-brown", table.footprint.width / 2 + 0.4, 0, -90);
        add("chair-exec-brown", -table.footprint.width / 2 - 0.4, 0, 90);
      }
      add("whiteboard-wall", 0, back + 0.06, 0);
      add("plant-agave", W / 2 - 0.4, back + 0.4, 0);
      seats = perSide * 2 + ends;
      break;
    }
    case "phonebooth":
      add("armchair-blue", 0, back + 0.42, 0);
      break;
    case "storage":
      add("cabinet", -0.75, back + 0.4, 0);
      add("cabinet", 0, back + 0.4, 0);
      add("cabinet", 0.75, back + 0.4, 0);
      break;
    case "pantry":
      add("counter-cafe", -W / 2 + 1.3, back + 0.5, 0);
      add("vending-2", W / 2 - 0.7, back + 0.4, 0);
      add("water-cooler", W / 2 - 1.5, back + 0.2, 0);
      add("plant-agave", -W / 2 + 0.45, front - 0.45, 0);
      break;
    case "lounge": {
      add("sofa-white-2", -0.5, back + 0.55, 0);
      add("table-coffee", -0.5, back + 1.75, 0);
      add("armchair-dark", 1.5, back + 1.75, -90);
      add("armchair-blue", -1.95, back + 1.75, 90);
      add("plant-agave", W / 2 - 0.4, back + 0.4, 0);
      seats = 4;
      break;
    }
    case "reception": {
      add("reception-desk", 0, back + 1.4, 0);
      add("chair-exec-brown", 0, back + 1.4, 0);
      add("sofa-blue-2", -W / 2 + 1.1, front - 0.5, 180);
      add("armchair-dark", -W / 2 + 2.9, front - 0.5, 180);
      add("plant-fiddle", W / 2 - 0.45, front - 0.45, 0);
      add("plant-agave", W / 2 - 0.45, back + 0.4, 0);
      break;
    }
    case "cafeteria": {
      const { clusters, cols } = cafeGrid(p.seats ?? 20);
      const want = p.seats ?? 20;
      // Service counters and vending machines along the back wall.
      add("counter-cafe", -W / 2 + 1.4, back + 0.5, 0);
      add("counter-cafe", -W / 2 + 3.8, back + 0.5, 0);
      add("vending-1", W / 2 - 0.5, back + 0.4, 0);
      if (W >= 7.4) add("vending-2", W / 2 - 1.6, back + 0.4, 0);
      let placed = 0;
      for (let k = 0; k < clusters && placed < want; k++) {
        const col = k % cols, row = Math.floor(k / cols);
        const x = -W / 2 + (W / cols) * (col + 0.5);
        const z = back + 2.2 + 2.0 * (row + 0.5);
        add("table-round", x, z, 0);
        const spots: [number, number, number][] = [[0.62, 0, -90], [-0.62, 0, 90], [0, 0.62, 180], [0, -0.62, 0]];
        for (const [ox, oz, rot] of spots) {
          if (placed >= want) break;
          add("chair-task-grey", x + ox, z + oz, rot);
          placed++;
        }
      }
      seats = placed;
      break;
    }
  }

  // Partitions for enclosed rooms.
  let door: UnitContent["door"];
  const walls: UnitWall[] = [];
  if (isEnclosed(kind)) {
    const doorW = kind === "phonebooth" ? 0.8 : kind === "storage" ? 0.9 : 1.2;
    const glassAll = kind === "meeting" || kind === "phonebooth";
    const glassFront = kind === "cabin" || glassAll;
    const P = (dx: number, dz: number) => toPlan(fr, dx, dz);
    const edge = (a: Pt, b: Pt, glass: boolean) => {
      if (dist(a, b) < 0.05 || onBoundary(a, b)) return;
      walls.push({ a, b, glass });
    };
    edge(P(-W / 2, back), P(W / 2, back), glassAll);
    edge(P(-W / 2, back), P(-W / 2, front), glassAll);
    edge(P(W / 2, back), P(W / 2, front), glassAll);
    edge(P(-W / 2, front), P(-doorW / 2, front), glassFront);
    edge(P(doorW / 2, front), P(W / 2, front), glassFront);
    door = { center: P(0, front), width: doorW, facingDeg: fr.theta };
  }

  return { items, walls, seats, door };
}

/** Wall edge lies along the building outline (both ends and the middle within a few cm). */
export function edgeOnPolyline(a: Pt, b: Pt, boundary: Pt[]): boolean {
  const near = (p: Pt) => {
    for (let i = 0; i < boundary.length; i++) if (distPointToSegment(p, boundary[i], boundary[(i + 1) % boundary.length]) < 0.06) return true;
    return false;
  };
  return near(a) && near(b) && near([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
}
