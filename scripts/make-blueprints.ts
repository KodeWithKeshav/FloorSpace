/**
 * Draws dimensioned "blueprint" images from the sample floor plans (dimensions in millimetres, door swings,
 * hatched cores, title block). They are demo inputs for the plan-from-image feature and, because the true plan is
 * known, a way to measure how accurately an AI reads a drawing.
 *
 *   npx tsx scripts/make-blueprints.ts        (writes public/blueprints/*.svg, then renders PNGs with Chrome)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { FloorPlan, Pt } from "../shared/types";
import { bbox, dist, signedArea } from "../shared/geometry";

const OUT = path.resolve("public/blueprints");
const W = 2000, H = 1500;
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const f = (n: number) => Math.round(n * 10) / 10;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function draw(plan: FloorPlan, title: string): string {
  const b = plan.floor.boundary;
  const box = bbox(b);
  const margin = 260, titleH = 190;
  const k = Math.min((W - margin * 2) / box.width, (H - margin * 2 - titleH) / box.height);
  const ox = (W - box.width * k) / 2, oy = margin - 40;
  const X = (x: number) => ox + (x - box.minX) * k;
  const Y = (y: number) => oy + (box.maxY - y) * k;
  const wallW = Math.max(9, k * 0.2);
  const ccw = signedArea(b) > 0 ? b : [...b].reverse();
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">
<defs><pattern id="h" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="14" stroke="#444" stroke-width="2"/></pattern></defs>
<rect width="${W}" height="${H}" fill="#fff"/>
<rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="none" stroke="#111" stroke-width="3"/>`;

  const poly = (pts: Pt[]) => pts.map((p) => `${f(X(p[0]))},${f(Y(p[1]))}`).join(" ");
  // light room fill + walls
  s += `<polygon points="${poly(ccw)}" fill="#fafafa" stroke="none"/>`;
  for (const o of plan.obstacles) {
    if (o.type === "column") s += `<polygon points="${poly(o.polygon)}" fill="#111"/>`;
    else {
      s += `<polygon points="${poly(o.polygon)}" fill="url(#h)" stroke="#111" stroke-width="3"/>`;
      if (o.label) {
        const bb = bbox(o.polygon);
        s += `<text x="${f(X((bb.minX + bb.maxX) / 2))}" y="${f(Y((bb.minY + bb.maxY) / 2))}" font-size="17" font-weight="700" text-anchor="middle" fill="#111" stroke="#fff" stroke-width="4" paint-order="stroke">${esc(o.label.toUpperCase())}</text>`;
      }
    }
  }
  s += `<polygon points="${poly(ccw)}" fill="none" stroke="#111" stroke-width="${f(wallW)}" stroke-linejoin="miter"/>`;

  // openings
  for (const o of plan.openings) {
    const [a, c] = o.wall;
    const len = dist(a, c);
    const dx = (c[0] - a[0]) / len, dy = (c[1] - a[1]) / len;
    const X1 = X(a[0]), Y1 = Y(a[1]), X2 = X(c[0]), Y2 = Y(c[1]);
    s += `<line x1="${f(X1)}" y1="${f(Y1)}" x2="${f(X2)}" y2="${f(Y2)}" stroke="#fff" stroke-width="${f(wallW + 4)}"/>`;
    if (o.type === "window") {
      for (const off of [-wallW * 0.32, 0, wallW * 0.32]) {
        s += `<line x1="${f(X1 - dy * off)}" y1="${f(Y1 + dx * off)}" x2="${f(X2 - dy * off)}" y2="${f(Y2 + dx * off)}" stroke="#111" stroke-width="2"/>`;
      }
    } else {
      // swing into the room: leaf perpendicular from the hinge, arc to the other jamb
      const mid: Pt = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      let bestI = 0, bestD = 1e9;
      ccw.forEach((p, i) => { const q = ccw[(i + 1) % ccw.length]; const t = Math.max(0, Math.min(1, ((mid[0] - p[0]) * (q[0] - p[0]) + (mid[1] - p[1]) * (q[1] - p[1])) / (dist(p, q) ** 2))); const d = Math.hypot(mid[0] - (p[0] + t * (q[0] - p[0])), mid[1] - (p[1] + t * (q[1] - p[1]))); if (d < bestD) (bestD = d, bestI = i); });
      const p = ccw[bestI], q = ccw[(bestI + 1) % ccw.length];
      const el = dist(p, q);
      const nx = -(q[1] - p[1]) / el, ny = (q[0] - p[0]) / el; // inward (CCW)
      const lx = X(a[0] + nx * len), ly = Y(a[1] + ny * len);
      const sweep = ((lx - X1) * (Y2 - Y1) - (ly - Y1) * (X2 - X1)) > 0 ? 1 : 0;
      s += `<line x1="${f(X1)}" y1="${f(Y1)}" x2="${f(lx)}" y2="${f(ly)}" stroke="#111" stroke-width="3"/>`;
      s += `<path d="M${f(lx)} ${f(ly)} A${f(len * k)} ${f(len * k)} 0 0 ${sweep} ${f(X2)} ${f(Y2)}" fill="none" stroke="#111" stroke-width="1.6"/>`;
      if (o.isEntry) s += `<text x="${f((X1 + X2) / 2 + nx * 0 + 0)}" y="${f(Y(mid[1] + ny * 1.6) + 5)}" font-size="17" font-weight="700" text-anchor="middle" fill="#111">ENTRY</text>`;
    }
  }

  // dimension chains, in millimetres, outside every wall
  ccw.forEach((p, i) => {
    const q = ccw[(i + 1) % ccw.length];
    const len = dist(p, q);
    const ex = (q[0] - p[0]) / len, ey = (q[1] - p[1]) / len;
    const ox2 = ey, oy2 = -ex; // outward (right of travel for CCW), plan space
    const off = 1.6 * k / 1 * 0.6 + 34;
    const sx = X(p[0]) + ox2 * off, sy = Y(p[1]) - oy2 * off, tx = X(q[0]) + ox2 * off, ty = Y(q[1]) - oy2 * off;
    s += `<line x1="${f(X(p[0]) + ox2 * 14)}" y1="${f(Y(p[1]) - oy2 * 14)}" x2="${f(sx + ox2 * 10)}" y2="${f(sy - oy2 * 10)}" stroke="#555" stroke-width="1.2"/>`;
    s += `<line x1="${f(X(q[0]) + ox2 * 14)}" y1="${f(Y(q[1]) - oy2 * 14)}" x2="${f(tx + ox2 * 10)}" y2="${f(ty - oy2 * 10)}" stroke="#555" stroke-width="1.2"/>`;
    s += `<line x1="${f(sx)}" y1="${f(sy)}" x2="${f(tx)}" y2="${f(ty)}" stroke="#111" stroke-width="1.6"/>`;
    for (const [tx1, ty1] of [[sx, sy], [tx, ty]]) s += `<line x1="${f(tx1 - 7)}" y1="${f(ty1 + 7)}" x2="${f(tx1 + 7)}" y2="${f(ty1 - 7)}" stroke="#111" stroke-width="2.4"/>`;
    const mx = (sx + tx) / 2, my = (sy + ty) / 2;
    let ang = (Math.atan2(ty - sy, tx - sx) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang <= -90) ang += 180;
    s += `<text x="${f(mx)}" y="${f(my - 7)}" transform="rotate(${f(ang)} ${f(mx)} ${f(my)})" font-size="20" text-anchor="middle" fill="#111" stroke="#fff" stroke-width="5" paint-order="stroke">${Math.round(len * 1000)}</text>`;
  });

  // room label, north arrow, title block
  const cx = X((box.minX + box.maxX) / 2), cy = Y((box.minY + box.maxY) / 2);
  s += `<text x="${f(cx)}" y="${f(cy)}" font-size="26" font-weight="700" text-anchor="middle" fill="#888" letter-spacing="6">OPEN OFFICE AREA</text>`;
  s += `<g transform="translate(${W - 130} 110)"><circle r="34" fill="none" stroke="#111" stroke-width="2"/><path d="M0 -30 L10 14 L0 6 L-10 14Z" fill="#111"/><text y="58" text-anchor="middle" font-size="20" font-weight="700">N</text></g>`;
  s += `<g transform="translate(${W - 760} ${H - titleH - 30})"><rect width="730" height="${titleH}" fill="none" stroke="#111" stroke-width="2.5"/>
<line x1="0" y1="62" x2="730" y2="62" stroke="#111" stroke-width="1.5"/><line x1="0" y1="124" x2="730" y2="124" stroke="#111" stroke-width="1.5"/><line x1="440" y1="62" x2="440" y2="${titleH}" stroke="#111" stroke-width="1.5"/>
<text x="20" y="42" font-size="26" font-weight="700">${esc(title)}</text>
<text x="20" y="98" font-size="18">DRAWING: FIRST FLOOR PLAN</text><text x="20" y="160" font-size="18">ALL DIMENSIONS IN MILLIMETRES</text>
<text x="460" y="98" font-size="18">SCALE 1:100 @ A1</text><text x="460" y="160" font-size="18">SHEET A-101   REV B</text></g>`;
  return s + "</svg>";
}

fs.mkdirSync(OUT, { recursive: true });
for (const [id, title] of [["small-office", "SMALL OFFICE FLOOR"], ["l-shaped-floor", "L-SHAPED CORPORATE FLOOR"]] as const) {
  const plan = JSON.parse(fs.readFileSync(`data/samples/${id}.json`, "utf8")) as FloorPlan;
  const svg = path.join(OUT, `${id}.svg`), png = path.join(OUT, `${id}.png`);
  fs.writeFileSync(svg, draw(plan, title));
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${W},${H}`, `--screenshot=${png}`, `file://${svg}`], { stdio: "ignore" });
  fs.rmSync(svg);
  console.log("wrote", png);
}
