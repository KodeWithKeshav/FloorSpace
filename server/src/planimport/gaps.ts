import jpeg from "jpeg-js";
import type { PlanExtraction } from "../../../shared/types";

type Opening = PlanExtraction["openings"][number];

/**
 * Finds doors and windows by looking at the pixels along each outer wall, not by asking an AI.
 *
 * A wall is drawn as a thick dark line. Where a door or window sits, that thick line stops: a door leaves a bare gap,
 * a window leaves a gap with thin parallel lines (one of them along the wall's centre). So: measure how thick the
 * dark stroke is along every wall, find the stretches where it thins out, and call a stretch a window when there is
 * still ink on the wall line inside it. Works on clean drawings; on anything else it says so and returns nothing.
 */
export interface GapResult {
  openings: Opening[];
  /** Why the scan was skipped or distrusted, if it was. */
  skipped?: string;
}

export function detectOpenings(jpegBytes: Buffer, vertices: [number, number][], metresPerPx?: number): GapResult {
  let img: { width: number; height: number; data: Uint8Array };
  try {
    img = jpeg.decode(jpegBytes, { useTArray: true, formatAsRGBA: true }) as unknown as typeof img;
  } catch {
    return { openings: [], skipped: "image could not be scanned" };
  }
  const { width: W, height: H, data } = img;
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) | 0;
  const dark = (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < W && yi < H && gray[yi * W + xi] < 120;
  };

  const n = vertices.length;
  const px = vertices.map(([x, y]) => [x * W, y * H] as [number, number]);
  interface Edge { P: [number, number]; d: [number, number]; nrm: [number, number]; len: number; t: number[]; ink: boolean[]; }
  const edges: Edge[] = [];

  for (let i = 0; i < n; i++) {
    const a = px[i], b = px[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 20) {
      edges.push({ P: a, d: [1, 0], nrm: [0, 1], len: 0, t: [], ink: [] });
      continue;
    }
    const d: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const nrm: [number, number] = [-d[1], d[0]];
    // The AI's corners are approximate: slide the line sideways to where the ink actually is.
    let bestO = 0, bestScore = -1;
    for (let o = -30; o <= 30; o++) {
      let sc = 0;
      for (let s = 0; s < len; s += 3) if (dark(a[0] + d[0] * s + nrm[0] * o, a[1] + d[1] * s + nrm[1] * o)) sc++;
      if (sc > bestScore) (bestScore = sc, bestO = o);
    }
    const P: [number, number] = [a[0] + nrm[0] * bestO, a[1] + nrm[1] * bestO];
    const t: number[] = [], ink: boolean[] = [];
    for (let s = 0; s <= len; s++) {
      const cx = P[0] + d[0] * s, cy = P[1] + d[1] * s;
      // seed: nearest dark pixel to the line within 3 px
      let seed: number | null = null;
      for (const o of [0, 1, -1, 2, -2, 3, -3]) if (dark(cx + nrm[0] * o, cy + nrm[1] * o)) { seed = o; break; }
      if (seed === null) { t.push(0); ink.push(false); continue; }
      let lo = seed, hi = seed;
      while (lo > -40 && dark(cx + nrm[0] * (lo - 1), cy + nrm[1] * (lo - 1))) lo--;
      while (hi < 40 && dark(cx + nrm[0] * (hi + 1), cy + nrm[1] * (hi + 1))) hi++;
      t.push(hi - lo + 1);
      ink.push(Math.abs(seed) <= 2);
    }
    edges.push({ P, d, nrm, len, t, ink });
  }

  // Typical wall thickness: the thick stroke that covers most of the outline.
  const all = edges.flatMap((e) => e.t.filter((v) => v > 0)).sort((p, q) => p - q);
  if (all.length < 50) return { openings: [], skipped: "no wall lines found to scan" };
  const T = all[Math.floor(all.length * 0.75)];
  if (T < 4) return { openings: [], skipped: "walls are drawn too thin to tell openings apart" };

  const gapFrac = all.filter((v) => v < T * 0.5).length / all.length;
  if (process.env.SP_DEBUG) console.log("[gaps] T", T, "samples", all.length);
  const totalLen = edges.reduce((s, e) => s + e.len, 0);
  const zeroFrac = edges.reduce((s, e) => s + e.t.filter((v) => v === 0).length, 0) / Math.max(1, totalLen);
  if (process.env.SP_DEBUG) console.log("[gaps] gapFrac", gapFrac.toFixed(2), "zeroFrac", zeroFrac.toFixed(2), "edges", edges.map((e) => [Math.round(e.len), e.t.filter((v) => v === 0).length]));
  if (gapFrac > 0.6 || zeroFrac > 0.6) return { openings: [], skipped: "the wall lines are not drawn as a thick stroke, so gaps can't be told from wall" };

  const minLenPx = metresPerPx ? Math.max(12, 0.55 / metresPerPx) : 0.025 * Math.max(W, H);
  const found: Opening[] = [];
  for (const e of edges) {
    if (e.len === 0) continue;
    const isGap = e.t.map((v) => v < T * 0.5);
    // bridge specks shorter than a few pixels
    for (let s = 1; s < isGap.length - 1; s++) if (!isGap[s] && isGap[s - 1]) {
      let k = s;
      while (k < isGap.length && !isGap[k]) k++;
      if (k < isGap.length && k - s <= 4) for (let m = s; m < k; m++) isGap[m] = true;
    }
    let s = 0;
    while (s < isGap.length) {
      if (!isGap[s]) { s++; continue; }
      let k = s;
      while (k < isGap.length && isGap[k]) k++;
      const start = s, end = k - 1;
      s = k;
      // ignore the corners themselves
      if (start < T * 1.2 || end > e.len - T * 1.2) continue;
      if (end - start < minLenPx) continue;
      const inkFrac = e.ink.slice(start, end + 1).filter(Boolean).length / (end - start + 1);
      const at = (u: number) => [(e.P[0] + e.d[0] * u) / W, (e.P[1] + e.d[1] * u) / H] as [number, number];
      const [x0, y0] = at(start), [x1, y1] = at(end);
      found.push({ type: inkFrac > 0.55 ? "window" : "door", x0, y0, x1, y1, widthMeters: null, isEntry: false });
    }
  }
  if (found.length > 24) return { openings: [], skipped: "too many gaps found: the drawing is probably not a clean plan" };
  return { openings: found };
}

/** Combine the pixel scan with the AI's list. Positions come from the scan; the AI supplies which door is the entry. */
export function mergeOpenings(scan: Opening[], ai: Opening[]): { openings: Opening[]; note: string | null } {
  if (scan.length === 0) return { openings: ai, note: null };
  const mid = (o: Opening) => [(o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2];
  const out = scan.map((o) => ({ ...o }));
  let aiDoorsUsed = 0;
  for (const a of ai) {
    const [ax, ay] = mid(a);
    const match = out.find((o) => o.type === "door" && a.type === "door" && Math.hypot(mid(o)[0] - ax, mid(o)[1] - ay) < 0.06);
    if (match) {
      match.isEntry = a.isEntry === true || match.isEntry;
      match.widthMeters = a.widthMeters ?? match.widthMeters;
      aiDoorsUsed++;
    } else if (!out.some((o) => Math.hypot(mid(o)[0] - ax, mid(o)[1] - ay) < 0.06)) {
      out.push({ ...a }); // the AI saw something the scan missed: keep it
    }
  }
  void aiDoorsUsed;
  const doors = out.filter((o) => o.type === "door").length, wins = out.filter((o) => o.type === "window").length;
  return { openings: out, note: `Doors and windows were found by scanning the wall lines on your drawing (${doors} doors, ${wins} windows).` };
}
