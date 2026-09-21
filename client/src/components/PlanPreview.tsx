import { useId, useMemo } from "react";
import type { Pt } from "../../../shared/types";
import { bbox, centroid, dist } from "../../../shared/geometry";
import { inwardNormal } from "../lib/plan";
import type { DrawPlan } from "../lib/plan";

export interface PreviewOptions {
  dimensions: boolean;
  grid: boolean;
  labels: boolean;
}

export type HoverTarget = { kind: "opening" | "obstacle"; index: number } | null;

interface Props {
  plan: DrawPlan;
  options?: PreviewOptions;
  /** Small thumbnail: no dimensions, grid, labels or interaction. */
  mini?: boolean;
  /** Keys like "openings:2" to draw in the error colour. */
  flagged?: Set<string>;
  hovered?: HoverTarget;
  onHover?: (t: HoverTarget) => void;
  /** Extra drawing between the floor grid and the structure (zones, furniture). */
  underlay?: (c: LayerContext) => React.ReactNode;
  /** Extra drawing above everything (labels). */
  overlay?: (c: LayerContext) => React.ReactNode;
}

export interface LayerContext {
  maxY: number;
  fs: number;
  span: number;
  wall: number;
}

const C = {
  paper: "#fdfcfa",
  ink: "#2a3242",
  ink2: "#5b6577",
  grid: "#ece9e1",
  gridMajor: "#ddd9ce",
  hatch: "#c9c6bc",
  core: "#eceae4",
  glass: "#4d8fc7",
  brand: "#0f6b5c",
  danger: "#c0392b",
};

const pt = (p: Pt, maxY: number): [number, number] => [p[0], maxY - p[1]];
const path = (poly: Pt[], maxY: number) => poly.map((p, i) => `${i ? "L" : "M"}${p[0]} ${maxY - p[1]}`).join(" ") + "Z";
const n2 = (v: number) => Math.round(v * 1000) / 1000;

export default function PlanPreview({ plan, options, mini = false, flagged, hovered, onHover, underlay, overlay }: Props) {
  const uid = useId().replace(/:/g, "");
  const opt: PreviewOptions = mini ? { dimensions: false, grid: false, labels: false } : (options ?? { dimensions: true, grid: true, labels: true });

  const g = useMemo(() => {
    const box = bbox(plan.boundary);
    const span = Math.max(box.width, box.height);
    const fs = span * 0.021; // text size in metres, scales with the plan
    const off = span * 0.034; // dimension line offset from the wall
    const wall = Math.max(0.25, span * 0.008);
    const pad = mini ? span * 0.04 : opt.dimensions ? off + fs * 2.6 + span * 0.02 : span * 0.05;
    const extraBottom = mini ? 0 : fs * 3.6;
    return { box, span, fs, off, wall, pad, extraBottom };
  }, [plan, mini, opt.dimensions]);

  const { box, span, fs, off, wall, pad, extraBottom } = g;
  const maxY = box.maxY;
  const vb = [box.minX - pad, -pad, box.width + pad * 2, box.height + pad * 2 + extraBottom].map(n2).join(" ");

  const isFlagged = (kind: string, i: number) => flagged?.has(`${kind}:${i}`) ?? false;
  const isHover = (kind: "opening" | "obstacle", i: number) => hovered?.kind === kind && hovered.index === i;

  const boundaryPath = path(plan.boundary, maxY);

  return (
    <svg viewBox={vb} className="block h-full w-full select-none" role="img" aria-label={`Floor plan of ${plan.name}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id={`clip-${uid}`}>
          <path d={boundaryPath} />
        </clipPath>
        <pattern id={`hatch-${uid}`} width="0.4" height="0.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="0.4" height="0.4" fill={C.core} />
          <line x1="0" y1="0" x2="0" y2="0.4" stroke={C.hatch} strokeWidth="0.09" />
        </pattern>
      </defs>

      {/* paper shadow + floor */}
      <path d={boundaryPath} transform={`translate(${wall * 0.6} ${wall * 0.8})`} fill="rgba(27,35,51,0.09)" />
      <path d={boundaryPath} fill={C.paper} />

      {opt.grid && (
        <g clipPath={`url(#clip-${uid})`} stroke={C.grid} strokeWidth={1} vectorEffect="non-scaling-stroke">
          {gridLines(box, maxY, 1, C.grid, 0.7)}
          {gridLines(box, maxY, 5, C.gridMajor, 1)}
        </g>
      )}

      {underlay?.({ maxY, fs, span, wall })}

      {/* obstacles */}
      {plan.obstacles.map((o) => {
        const bad = isFlagged("obstacles", o.index);
        const hot = isHover("obstacle", o.index);
        const isColumn = o.type === "column";
        return (
          <g key={`ob-${o.index}`}>
            <path
              d={path(o.polygon, maxY)}
              fill={isColumn ? C.ink : `url(#hatch-${uid})`}
              stroke={bad ? C.danger : hot ? C.brand : C.ink}
              strokeWidth={bad || hot ? 2.2 : 1.4}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="miter"
            />
            {!mini && (
              <path
                d={path(o.polygon, maxY)}
                fill="transparent"
                stroke="transparent"
                strokeWidth={14}
                vectorEffect="non-scaling-stroke"
                onMouseEnter={() => onHover?.({ kind: "obstacle", index: o.index })}
                onMouseLeave={() => onHover?.(null)}
                style={{ cursor: "help" }}
              />
            )}
          </g>
        );
      })}

      {/* walls */}
      <path d={boundaryPath} fill="none" stroke={C.ink} strokeWidth={wall} strokeLinejoin="miter" />

      {/* openings */}
      {plan.openings.map((o) => {
        const [a, b] = o.wall;
        const width = dist(a, b);
        if (width < 0.05) return null;
        const bad = isFlagged("openings", o.index);
        const hot = isHover("opening", o.index);
        const [ax, ay] = pt(a, maxY);
        const [bx, by] = pt(b, maxY);
        const color = bad ? C.danger : o.type === "door" ? (o.isEntry ? C.brand : C.ink2) : C.glass;
        const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const n = inwardNormal(mid, plan.boundary);
        const hitW = Math.max(wall * 3, span * 0.02);

        return (
          <g key={`op-${o.index}`}>
            {/* cut the wall */}
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke={bad ? "#fbe3e0" : C.paper} strokeWidth={wall * 1.5} />
            {o.type === "window" ? (
              <>
                <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={wall * 0.34} />
                <WallEdges a={a} b={b} n={n} wall={wall} maxY={maxY} color={C.ink} />
              </>
            ) : (
              <DoorSwing a={a} b={b} n={n} width={width} maxY={maxY} color={color} wall={wall} />
            )}
            {(hot || bad) && <line x1={ax} y1={ay} x2={bx} y2={by} stroke={bad ? C.danger : C.brand} strokeWidth={wall * 0.9} strokeOpacity={0.35} strokeLinecap="round" />}
            {opt.labels && o.type === "door" && o.isEntry && (
              <text
                x={n2(mid[0] + n[0] * width * 1.3)}
                y={n2(maxY - (mid[1] + n[1] * width * 1.3))}
                fontSize={fs * 0.95}
                fontWeight={700}
                letterSpacing={fs * 0.08}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={C.brand}
                style={{ paintOrder: "stroke" }}
                stroke={C.paper}
                strokeWidth={fs * 0.3}
              >
                ENTRY
              </text>
            )}
            {!mini && (
              <line
                x1={ax} y1={ay} x2={bx} y2={by}
                stroke="transparent"
                strokeWidth={hitW}
                strokeLinecap="round"
                onMouseEnter={() => onHover?.({ kind: "opening", index: o.index })}
                onMouseLeave={() => onHover?.(null)}
                style={{ cursor: "help" }}
              />
            )}
          </g>
        );
      })}

      {/* obstacle labels sit above everything else */}
      {opt.labels &&
        plan.obstacles
          .filter((o) => o.type !== "column" && o.label)
          .map((o) => {
            const c = centroid(o.polygon);
            const bb = bbox(o.polygon);
            const size = fs * 0.85;
            const lines = wrap(o.label!, Math.max(6, Math.floor(bb.width / (size * 0.56))));
            const fits = lines.length * size * 1.15 < bb.height + 0.01 && bb.width > size * 3;
            if (!fits) return null;
            return (
              <text key={`lb-${o.index}`} textAnchor="middle" fontSize={size} fontWeight={600} fill={C.ink2} style={{ paintOrder: "stroke" }} stroke={C.core} strokeWidth={size * 0.28}>
                {lines.map((ln, i) => (
                  <tspan key={i} x={n2(c[0])} y={n2(maxY - c[1] + (i - (lines.length - 1) / 2) * size * 1.15 + size * 0.34)}>
                    {ln}
                  </tspan>
                ))}
              </text>
            );
          })}

      {overlay?.({ maxY, fs, span, wall })}

      {/* dimensions */}
      {opt.dimensions &&
        plan.boundary.map((p, i) => {
          const q = plan.boundary[(i + 1) % plan.boundary.length];
          const len = dist(p, q);
          if (len < span * 0.09) return null;
          return <Dimension key={`dim-${i}`} a={p} b={q} offset={off} fs={fs} maxY={maxY} label={`${len.toFixed(len >= 10 ? 1 : 2)} m`} />;
        })}

      {!mini && <ScaleAndNorth box={box} maxY={maxY} fs={fs} span={span} dims={opt.dimensions} />}
    </svg>
  );
}

function gridLines(box: ReturnType<typeof bbox>, maxY: number, step: number, color: string, w: number) {
  const lines = [];
  const x0 = Math.floor(box.minX / step) * step;
  const y0 = Math.floor(box.minY / step) * step;
  for (let x = x0; x <= box.maxX + 1e-9; x += step) lines.push(<line key={`gx${step}-${x}`} x1={x} y1={maxY - box.minY + 1} x2={x} y2={maxY - box.maxY - 1} stroke={color} strokeWidth={w} vectorEffect="non-scaling-stroke" />);
  for (let y = y0; y <= box.maxY + 1e-9; y += step) lines.push(<line key={`gy${step}-${y}`} x1={box.minX - 1} y1={maxY - y} x2={box.maxX + 1} y2={maxY - y} stroke={color} strokeWidth={w} vectorEffect="non-scaling-stroke" />);
  return lines;
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/** Two thin lines either side of the wall thickness: the drafting convention for a window. */
function WallEdges({ a, b, n, wall, maxY, color }: { a: Pt; b: Pt; n: Pt; wall: number; maxY: number; color: string }) {
  const h = wall * 0.5;
  const seg = (s: number) => {
    const [x1, y1] = pt([a[0] + n[0] * h * s, a[1] + n[1] * h * s], maxY);
    const [x2, y2] = pt([b[0] + n[0] * h * s, b[1] + n[1] * h * s], maxY);
    return <line key={s} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={wall * 0.12} />;
  };
  return <>{seg(1)}{seg(-1)}</>;
}

/** Door leaf plus its swing arc, opening into the room. */
function DoorSwing({ a, b, n, width, maxY, color, wall }: { a: Pt; b: Pt; n: Pt; width: number; maxY: number; color: string; wall: number }) {
  const leafEnd: Pt = [a[0] + n[0] * width, a[1] + n[1] * width];
  const [ax, ay] = pt(a, maxY);
  const [bx, by] = pt(b, maxY);
  const [lx, ly] = pt(leafEnd, maxY);
  const v1 = [lx - ax, ly - ay];
  const v2 = [bx - ax, by - ay];
  const sweep = v1[0] * v2[1] - v1[1] * v2[0] > 0 ? 1 : 0;
  return (
    <>
      <path d={`M${lx} ${ly} A${width} ${width} 0 0 ${sweep} ${bx} ${by}`} fill="none" stroke={color} strokeWidth={wall * 0.16} strokeDasharray={`${wall * 0.5} ${wall * 0.4}`} strokeOpacity={0.85} />
      <line x1={ax} y1={ay} x2={lx} y2={ly} stroke={color} strokeWidth={wall * 0.3} strokeLinecap="round" />
      <circle cx={ax} cy={ay} r={wall * 0.36} fill={color} />
    </>
  );
}

function Dimension({ a, b, offset, fs, maxY, label }: { a: Pt; b: Pt; offset: number; fs: number; maxY: number; label: string }) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  // outward = right of travel for a CCW outline
  const nx = dy / len, ny = -dx / len;
  const p1: Pt = [a[0] + nx * offset, a[1] + ny * offset];
  const p2: Pt = [b[0] + nx * offset, b[1] + ny * offset];
  const [x1, y1] = pt(p1, maxY);
  const [x2, y2] = pt(p2, maxY);
  const [wx1, wy1] = pt(a, maxY);
  const [wx2, wy2] = pt(b, maxY);
  const tick = fs * 0.35;
  let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const stroke = "#8b94a5";
  const tw = label.length * fs * 0.62 + fs;
  const gap = Math.min(tw / 2, len / 2 - 0.1);
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  return (
    <g stroke={stroke} strokeWidth={fs * 0.06} fill="none">
      {/* extension lines */}
      <line x1={wx1} y1={wy1} x2={x1 + (x1 - wx1) * 0.12} y2={y1 + (y1 - wy1) * 0.12} strokeOpacity={0.6} />
      <line x1={wx2} y1={wy2} x2={x2 + (x2 - wx2) * 0.12} y2={y2 + (y2 - wy2) * 0.12} strokeOpacity={0.6} />
      {/* dimension line broken around the label */}
      <line x1={x1} y1={y1} x2={cx - ux * gap} y2={cy - uy * gap} />
      <line x1={cx + ux * gap} y1={cy + uy * gap} x2={x2} y2={y2} />
      {/* architectural ticks */}
      <line x1={x1 - tick} y1={y1 + tick} x2={x1 + tick} y2={y1 - tick} strokeWidth={fs * 0.09} stroke={C.ink2} />
      <line x1={x2 - tick} y1={y2 + tick} x2={x2 + tick} y2={y2 - tick} strokeWidth={fs * 0.09} stroke={C.ink2} />
      <text x={cx} y={cy} transform={`rotate(${angle} ${cx} ${cy})`} textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight={600} fill={C.ink2} stroke="none" style={{ fontVariantNumeric: "tabular-nums" }}>
        {label}
      </text>
    </g>
  );
}

function ScaleAndNorth({ box, maxY, fs, span, dims }: { box: ReturnType<typeof bbox>; maxY: number; fs: number; span: number; dims: boolean }) {
  const bar = span > 30 ? 10 : 5;
  const y = maxY - box.minY + (dims ? fs * 2.6 + span * 0.045 : fs * 1.6 + span * 0.01);
  const x = box.minX;
  const nx = box.maxX;
  return (
    <g fontSize={fs * 0.9} fill={C.ink2} fontWeight={600}>
      {/* scale bar */}
      <g transform={`translate(${x} ${y})`}>
        <rect x={0} y={-fs * 0.22} width={bar / 2} height={fs * 0.44} fill={C.ink} />
        <rect x={bar / 2} y={-fs * 0.22} width={bar / 2} height={fs * 0.44} fill="#fff" stroke={C.ink} strokeWidth={fs * 0.06} />
        <text x={0} y={fs * 1.35} textAnchor="middle">0</text>
        <text x={bar} y={fs * 1.35} textAnchor="middle">{bar} m</text>
      </g>
      {/* north arrow */}
      <g transform={`translate(${nx - fs * 0.6} ${y})`}>
        <path d={`M0 ${-fs * 1.1} L${fs * 0.55} ${fs * 0.7} L0 ${fs * 0.3} L${-fs * 0.55} ${fs * 0.7}Z`} fill={C.ink} />
        <text x={0} y={fs * 1.9} textAnchor="middle" fontSize={fs}>N</text>
      </g>
    </g>
  );
}


