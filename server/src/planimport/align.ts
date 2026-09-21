import jpeg from "jpeg-js";
import type { PlanExtraction } from "../../../shared/types";

export interface AlignResult {
  extraction: PlanExtraction;
  aligned: boolean;
  note?: string;
}

interface Group {
  pos: number;
  weight: number;
}

/** Cluster a per-row (or per-column) weight profile into peaks: neighbouring rows merge into one wall. */
function peaks(profile: Float64Array): Group[] {
  const out: Group[] = [];
  let i = 0;
  while (i < profile.length) {
    if (profile[i] <= 0) { i++; continue; }
    let j = i, gap = 0, w = 0, wp = 0;
    while (j < profile.length && gap <= 3) {
      if (profile[j] > 0) { w += profile[j]; wp += profile[j] * j; gap = 0; } else gap++;
      j++;
    }
    out.push({ pos: wp / w, weight: w });
    i = j;
  }
  return out;
}

function levels(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const g = groups[groups.length - 1];
    if (g && v - g[g.length - 1] <= tol) g.push(v);
    else groups.push([v]);
  }
  return groups.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
}

/** Piecewise-linear map through matched anchor pairs, extended past the ends with the end slopes. */
function makeMap(from: number[], to: number[]): (v: number) => number {
  const n = from.length;
  return (v) => {
    let i = 0;
    while (i < n - 2 && v > from[i + 1]) i++;
    const a = from[i], b = from[i + 1], ta = to[i], tb = to[i + 1];
    return ta + ((v - a) / (b - a || 1)) * (tb - ta);
  };
}

/**
 * The AI is good at what a drawing says but rough about where things are on the page (it can be off by a fifth of
 * the image). Real wall lines, though, are the thickest strokes in a plan. This finds them in the pixels and slides
 * the AI's outline onto them, then moves the doors, windows and cores by the same amounts. Only for outlines whose
 * walls are all horizontal or vertical, on drawings where the walls show up clearly; otherwise it changes nothing.
 */
export function alignToInk(jpegBytes: Buffer, ex: PlanExtraction): AlignResult {
  const none = (note?: string): AlignResult => ({ extraction: ex, aligned: false, note });
  const V = ex.vertices;
  if (V.length < 4) return none();
  for (let i = 0; i < V.length; i++) {
    const a = V[i], b = V[(i + 1) % V.length];
    if (Math.abs(a[0] - b[0]) > 0.012 && Math.abs(a[1] - b[1]) > 0.012) return none("The outline has slanted walls, so it was not snapped to the drawing.");
  }

  let img: { width: number; height: number; data: Uint8Array };
  try {
    img = jpeg.decode(jpegBytes, { useTArray: true, formatAsRGBA: true }) as unknown as typeof img;
  } catch {
    return none();
  }
  const { width: W, height: H, data } = img;
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dark[i] = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) < 120 ? 1 : 0;

  const MIN_T = 5, MAX_T = 42, MIN_LEN = Math.max(24, Math.round(0.017 * Math.max(W, H)));
  // Horizontal walls: dark runs 5..42 px tall that stretch far sideways. Vertical walls: the same, turned.
  const markV = new Uint8Array(W * H), markH = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!dark[y * W + x]) { y++; continue; }
      let e = y;
      while (e < H && dark[e * W + x]) e++;
      if (e - y >= MIN_T && e - y <= MAX_T) for (let k = y; k < e; k++) markV[k * W + x] = 1;
      y = e;
    }
  }
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!dark[y * W + x]) { x++; continue; }
      let e = x;
      while (e < W && dark[y * W + e]) e++;
      if (e - x >= MIN_T && e - x <= MAX_T) for (let k = x; k < e; k++) markH[y * W + k] = 1;
      x = e;
    }
  }
  const rowSum = new Float64Array(H), colSum = new Float64Array(W);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!markV[y * W + x]) { x++; continue; }
      let e = x;
      while (e < W && markV[y * W + e]) e++;
      if (e - x >= MIN_LEN) rowSum[y] += e - x;
      x = e;
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!markH[y * W + x]) { y++; continue; }
      let e = y;
      while (e < H && markH[e * W + x]) e++;
      if (e - y >= MIN_LEN) colSum[x] += e - y;
      y = e;
    }
  }

  const aiX = levels(V.map((p) => p[0]), 0.03), aiY = levels(V.map((p) => p[1]), 0.03);
  const pick = (profile: Float64Array, k: number): number[] | null => {
    const g = peaks(profile).sort((a, b) => b.weight - a.weight);
    if (g.length < k) return null;
    if (g.length > k && g[k].weight > g[k - 1].weight * 0.5) return null; // not clearly the k strongest
    return g.slice(0, k).map((p) => p.pos).sort((a, b) => a - b);
  };
  if (process.env.SP_DEBUG) {
    console.log("[align] aiX", aiX.map((v) => v.toFixed(3)), "aiY", aiY.map((v) => v.toFixed(3)));
    console.log("[align] row peaks", peaks(rowSum).sort((a, b) => b.weight - a.weight).slice(0, 8).map((g) => [Math.round(g.pos), Math.round(g.weight)]));
    console.log("[align] col peaks", peaks(colSum).sort((a, b) => b.weight - a.weight).slice(0, 8).map((g) => [Math.round(g.pos), Math.round(g.weight)]));
  }
  const trueY = pick(rowSum, aiY.length), trueX = pick(colSum, aiX.length);
  if (!trueX || !trueY) return none("The wall lines could not be told apart clearly enough to snap the outline to your drawing.");

  const fx = makeMap(aiX, trueX.map((v) => v / W)), fy = makeMap(aiY, trueY.map((v) => v / H));
  const mapPt = (p: [number, number]): [number, number] => [fx(p[0]), fy(p[1])];
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const out: PlanExtraction = {
    ...ex,
    vertices: V.map((p) => [clamp(fx(p[0])), clamp(fy(p[1]))] as [number, number]),
    openings: ex.openings.map((o) => ({ ...o, x0: clamp(fx(o.x0)), y0: clamp(fy(o.y0)), x1: clamp(fx(o.x1)), y1: clamp(fy(o.y1)) })),
    obstacles: ex.obstacles.map((b) => ({ ...b, polygon: b.polygon.map((p) => mapPt(p)).map(([x, y]) => [clamp(x), clamp(y)] as [number, number]) })),
  };
  return { extraction: out, aligned: true, note: "The outline was snapped onto the wall lines found in your drawing." };
}

/**
 * Structural columns are solid dark squares. Find them exactly: connected blobs of dark pixels that are roughly
 * square, filled and small, inside the outline. Returns their boxes (normalised), or none if there aren't any.
 */
export function findColumns(jpegBytes: Buffer, outline: [number, number][]): [number, number][][] {
  let img: { width: number; height: number; data: Uint8Array };
  try {
    img = jpeg.decode(jpegBytes, { useTArray: true, formatAsRGBA: true }) as unknown as typeof img;
  } catch {
    return [];
  }
  const { width: W, height: H, data } = img;
  const xs = outline.map((p) => p[0] * W), ys = outline.map((p) => p[1] * H);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  const dark = (x: number, y: number) => (data[(y * W + x) * 4] * 0.3 + data[(y * W + x) * 4 + 1] * 0.59 + data[(y * W + x) * 4 + 2] * 0.11) < 90;
  const seen = new Uint8Array(W * H);
  const found: [number, number][][] = [];
  const stack: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (seen[i] || !dark(x, y)) continue;
      let minx = x, maxx = x, miny = y, maxy = y, count = 0, big = false;
      stack.length = 0;
      stack.push(i);
      seen[i] = 1;
      while (stack.length) {
        const k = stack.pop()!;
        const kx = k % W, ky = (k - kx) / W;
        count++;
        if (kx < minx) minx = kx; if (kx > maxx) maxx = kx;
        if (ky < miny) miny = ky; if (ky > maxy) maxy = ky;
        if (maxx - minx > 60 || maxy - miny > 60) big = true;
        if (big) continue; // walls, borders and text: not a column, stop growing cheaply
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = kx + dx, ny = ky + dy;
          if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
          const ni = ny * W + nx;
          if (!seen[ni] && dark(nx, ny)) (seen[ni] = 1, stack.push(ni));
        }
      }
      if (big) continue;
      const w = maxx - minx + 1, h = maxy - miny + 1;
      if (w < 10 || h < 10 || w > 55 || h > 55) continue;
      if (Math.max(w, h) / Math.min(w, h) > 1.5) continue;
      if (count / (w * h) < 0.85) continue;
      found.push([[minx / W, miny / H], [(maxx + 1) / W, miny / H], [(maxx + 1) / W, (maxy + 1) / H], [minx / W, (maxy + 1) / H]]);
    }
  }
  return found;
}

/**
 * Cores are drawn as a rectangle with a border. Slide each side of the AI's rectangle onto the long straight ink line
 * nearest to it (the border, or the wall it sits against). Leaves a side alone if no such line is found.
 */
export function refineCores(jpegBytes: Buffer, ex: PlanExtraction): PlanExtraction {
  let img: { width: number; height: number; data: Uint8Array };
  try {
    img = jpeg.decode(jpegBytes, { useTArray: true, formatAsRGBA: true }) as unknown as typeof img;
  } catch {
    return ex;
  }
  const { width: W, height: H, data } = img;
  const dark = (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return false;
    const i = (yi * W + xi) * 4;
    return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 120;
  };
  // Coverage of a straight line: fraction of positions along [a,b] with ink within one pixel of the line.
  const cover = (vertical: boolean, at: number, a: number, b: number) => {
    let hit = 0, tot = 0;
    for (let t = a; t <= b; t += 2) {
      tot++;
      const ink = vertical ? dark(at, t) || dark(at - 1, t) || dark(at + 1, t) : dark(t, at) || dark(t, at - 1) || dark(t, at + 1);
      if (ink) hit++;
    }
    return tot ? hit / tot : 0;
  };
  const best = (vertical: boolean, at: number, a: number, b: number) => {
    let bo: number | null = null;
    for (let o = 0; o <= 80; o++) {
      for (const sgn of o === 0 ? [1] : [1, -1]) {
        if (cover(vertical, at + o * sgn, a, b) >= 0.9) { bo = o * sgn; break; }
      }
      if (bo !== null) break;
    }
    return bo === null ? at : at + bo;
  };
  return {
    ...ex,
    obstacles: ex.obstacles.map((ob) => {
      if (ob.type === "column" || ob.polygon.length < 3) return ob;
      const xs = ob.polygon.map((p) => p[0] * W), ys = ob.polygon.map((p) => p[1] * H);
      let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const nx0 = best(true, x0, y0 + 12, y1 - 12), nx1 = best(true, x1, y0 + 12, y1 - 12);
      const ny0 = best(false, y0, x0 + 12, x1 - 12), ny1 = best(false, y1, x0 + 12, x1 - 12);
      [x0, x1, y0, y1] = [nx0, nx1, ny0, ny1];
      if (x1 - x0 < 8 || y1 - y0 < 8) return ob;
      return { ...ob, polygon: [[x0 / W, y0 / H], [x1 / W, y0 / H], [x1 / W, y1 / H], [x0 / W, y1 / H]] as [number, number][] };
    }),
  };
}
