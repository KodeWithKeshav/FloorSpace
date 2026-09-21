import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { SceneDescription } from "../../../shared/scene";
import { bbox } from "../../../shared/geometry";
import type { PlayerState } from "./Player";

const SIZE = 210;

/** Small plan in the corner with a live position and view cone. Drawn straight to a canvas each frame. */
export default function Minimap({ scene, state }: { scene: SceneDescription; state: MutableRefObject<PlayerState> }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const g = canvas.getContext("2d")!;
    const b = bbox(scene.boundary);
    const pad = 14;
    const k = (SIZE - pad * 2) / Math.max(b.width, b.height);
    const ox = (SIZE - b.width * k) / 2, oy = (SIZE - b.height * k) / 2;
    const px = (x: number) => (ox + (x - b.minX) * k) * dpr;
    const py = (y: number) => (oy + (b.maxY - y) * k) * dpr;

    // Static layer, drawn once.
    const base = document.createElement("canvas");
    base.width = canvas.width;
    base.height = canvas.height;
    const s = base.getContext("2d")!;
    s.fillStyle = "#fbfaf7";
    s.beginPath();
    scene.boundary.forEach((p, i) => (i ? s.lineTo(px(p[0]), py(p[1])) : s.moveTo(px(p[0]), py(p[1]))));
    s.closePath();
    s.fill();
    for (const z of scene.roomFloors) {
      const zb = bbox(z.polygon);
      s.fillStyle = z.color;
      s.fillRect(px(zb.minX), py(zb.maxY), zb.width * k * dpr, zb.height * k * dpr);
    }
    s.fillStyle = "#9aa1ad";
    for (const c of scene.colliders.filter((q) => q.src === "item")) {
      s.save();
      s.translate(px(c.cx), py(c.cy));
      s.rotate((-c.angleDeg * Math.PI) / 180);
      s.fillRect(-c.hx * k * dpr, -c.hy * k * dpr, c.hx * 2 * k * dpr, c.hy * 2 * k * dpr);
      s.restore();
    }
    s.fillStyle = "#2a3242";
    for (const c of scene.colliders.filter((q) => q.src !== "item")) {
      s.save();
      s.translate(px(c.cx), py(c.cy));
      s.rotate((-c.angleDeg * Math.PI) / 180);
      const w = Math.max(c.hx * 2 * k * dpr, 1.2 * dpr), h = Math.max(c.hy * 2 * k * dpr, 1.2 * dpr);
      s.fillRect(-w / 2, -h / 2, w, h);
      s.restore();
    }

    let raf = 0;
    const draw = () => {
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(base, 0, 0);
      const p = state.current;
      // facing in plan space: forward = (-sin yaw, cos yaw)
      const fx = -Math.sin(p.yaw), fy = Math.cos(p.yaw);
      const x = px(p.x), y = py(p.y);
      const ang = Math.atan2(-fy, fx); // canvas y is flipped
      g.fillStyle = "rgba(15,107,92,0.22)";
      g.beginPath();
      g.moveTo(x, y);
      g.arc(x, y, 34 * dpr * 0.6, ang - 0.6, ang + 0.6);
      g.closePath();
      g.fill();
      g.fillStyle = "#0f6b5c";
      g.strokeStyle = "#fff";
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.arc(x, y, 5 * dpr, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [scene, state]);

  return <canvas ref={ref} style={{ width: SIZE, height: SIZE }} className="rounded-2xl border border-line bg-surface/95 shadow-pop" aria-label="Minimap" />;
}
