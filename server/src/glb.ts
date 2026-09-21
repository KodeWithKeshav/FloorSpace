import fs from "node:fs";

export interface GlbInfo {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  triangles: number;
  extensions: string[];
  bytes: number;
}

type Mat = number[]; // column-major 4x4, glTF convention

const IDENT: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Mat, b: Mat): Mat {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function nodeMatrix(n: any): Mat {
  if (n.matrix) return n.matrix as Mat;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
  return [r[0] * sx, r[1] * sx, r[2] * sx, 0, r[3] * sy, r[4] * sy, r[5] * sy, 0, r[6] * sz, r[7] * sz, r[8] * sz, 0, tx, ty, tz, 1];
}

/** Read the JSON chunk of a .glb and compute its world-space bounding box from accessor min/max (no mesh decoding). */
export function readGlbInfo(file: string): GlbInfo {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB file");
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;

  const visit = (idx: number, parent: Mat) => {
    const node = json.nodes[idx];
    const m = mul(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        if (!acc?.min || !acc?.max) continue;
        for (let i = 0; i < 8; i++) {
          const p = [i & 1 ? acc.max[0] : acc.min[0], i & 2 ? acc.max[1] : acc.min[1], i & 4 ? acc.max[2] : acc.min[2]];
          for (let a = 0; a < 3; a++) {
            const v = m[0 * 4 + a] * p[0] + m[1 * 4 + a] * p[1] + m[2 * 4 + a] * p[2] + m[3 * 4 + a];
            if (v < min[a]) min[a] = v;
            if (v > max[a]) max[a] = v;
          }
        }
        const ic = prim.indices !== undefined ? json.accessors[prim.indices].count : acc.count;
        triangles += Math.floor(ic / 3);
      }
    }
    for (const c of node.children ?? []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  for (const n of scene?.nodes ?? []) visit(n, IDENT);

  return {
    min, max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    triangles,
    extensions: json.extensionsUsed ?? [],
    bytes: buf.length,
  };
}
