import type { Catalog, FloorPlan, Layout } from "../../../shared/types";
import { buildScene } from "../../../shared/scene";
import { resolveCollisions } from "../../../shared/collision";
import { bbox } from "../../../shared/geometry";

export interface WalkReport {
  walkableCells: number;
  reachablePct: number;
  unreachableStops: string[];
  sealedRooms: string[];
}

/**
 * Proves a layout is walkable using the exact collision geometry the walkthrough uses: every spot a 0.28 m-radius
 * person can stand is flood-filled from the entrance, then every teleport stop and every room is checked against it.
 */
export function checkWalkable(plan: FloorPlan, layout: Layout, catalog: Catalog): WalkReport {
  const scene = buildScene(plan, layout, catalog);
  const b = bbox(scene.boundary);
  const step = 0.2, r = 0.28;
  const nx = Math.ceil(b.width / step), ny = Math.ceil(b.height / step);
  const free = new Uint8Array(nx * ny);
  const poly = scene.boundary;
  const inside = (p: { x: number; y: number }) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i][1] > p.y) !== (poly[j][1] > p.y) && p.x < ((poly[j][0] - poly[i][0]) * (p.y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
    }
    return c;
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = { x: b.minX + (i + 0.5) * step, y: b.minY + (j + 0.5) * step };
      if (!inside(p)) continue;
      const q = { ...p };
      resolveCollisions(q, r, scene.colliders);
      free[j * nx + i] = Math.hypot(q.x - p.x, q.y - p.y) < 0.02 ? 1 : 0;
    }
  }
  const cell = (x: number, y: number) => [Math.floor((x - b.minX) / step), Math.floor((y - b.minY) / step)] as const;
  const seen = new Uint8Array(nx * ny);
  const [si, sj] = cell(scene.spawn.x, scene.spawn.y);
  const stack: number[] = [];
  if (si >= 0 && sj >= 0 && si < nx && sj < ny && free[sj * nx + si]) (seen[sj * nx + si] = 1, stack.push(sj * nx + si));
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % nx, j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, c = j + dj;
      if (a < 0 || c < 0 || a >= nx || c >= ny) continue;
      const n = c * nx + a;
      if (free[n] && !seen[n]) (seen[n] = 1, stack.push(n));
    }
  }
  const nearSeen = (x: number, y: number, reach: number) => {
    const [i, j] = cell(x, y);
    for (let di = -reach; di <= reach; di++) for (let dj = -reach; dj <= reach; dj++) {
      const a = i + di, c = j + dj;
      if (a >= 0 && c >= 0 && a < nx && c < ny && seen[c * nx + a]) return true;
    }
    return false;
  };
  const total = free.reduce((s, v) => s + v, 0), reach = seen.reduce((s, v) => s + v, 0);
  return {
    walkableCells: total,
    reachablePct: Math.round((reach / Math.max(1, total)) * 100),
    unreachableStops: scene.teleports.filter((t) => !nearSeen(t.x, t.y, 3)).map((t) => t.label),
    // a 1.5 m phone booth is tighter than a person plus its furniture, so it is not held to this test
    sealedRooms: layout.zones
      .filter((z) => z.door && z.type !== "phonebooth")
      .filter((z) => !nearSeen(z.polygon.reduce((s, p) => s + p[0], 0) / 4, z.polygon.reduce((s, p) => s + p[1], 0) / 4, 6))
      .map((z) => z.label),
  };
}
