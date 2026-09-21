import type { Collider } from "./scene";

/** Push a circle (plan space) out of every oriented box it overlaps. A few passes settle corners. */
export function resolveCollisions(pos: { x: number; y: number }, radius: number, colliders: Collider[]): void {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const c of colliders) {
      const a = (c.angleDeg * Math.PI) / 180;
      const cos = Math.cos(a), sin = Math.sin(a);
      const dx = pos.x - c.cx, dy = pos.y - c.cy;
      // into the box's own frame
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const qx = Math.max(-c.hx, Math.min(c.hx, lx));
      const qy = Math.max(-c.hy, Math.min(c.hy, ly));
      let nx = lx - qx, ny = ly - qy;
      let d = Math.hypot(nx, ny);
      if (d >= radius) continue;
      if (d < 1e-6) {
        // centre is inside the box: leave through the nearest face
        const px = c.hx - Math.abs(lx), py = c.hy - Math.abs(ly);
        if (px < py) (nx = Math.sign(lx) || 1, ny = 0, d = -px);
        else (nx = 0, ny = Math.sign(ly) || 1, d = -py);
      } else (nx /= d, ny /= d);
      const push = radius - d;
      const wx = nx * push, wy = ny * push;
      // back to plan space
      pos.x += wx * cos - wy * sin;
      pos.y += wx * sin + wy * cos;
      moved = true;
    }
    if (!moved) break;
  }
}
