import fs from "node:fs";
import path from "node:path";
import type { Catalog, FloorPlan, Layout, Pt } from "../../../shared/types";
import { buildScene, itemYawDeg } from "../../../shared/scene";
import type { WorldBox } from "../../../shared/scene";
import { bbox } from "../../../shared/geometry";
import { ROOT } from "../paths";
import { ICON_SVG, MAIN_GD, PLAYER_GD, PROJECT_README, XR_RIG_GD } from "./scripts";

const f = (n: number) => (Math.round(n * 10000) / 10000).toString();
const rad = (d: number) => (d * Math.PI) / 180;
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
/** Resource ids may only contain letters, digits and underscores. */
const rid = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");

/** Godot's Transform3D(...) takes the basis row by row, then the origin. */
const T = (m: number[], o: [number, number, number]) => `Transform3D(${[...m, ...o].map(f).join(", ")})`;
const rotY = (deg: number, k = 1): number[] => {
  const c = Math.cos(rad(deg)) * k, s = Math.sin(rad(deg)) * k;
  return [c, 0, s, 0, k, 0, -s, 0, c];
};
const col = (hex: string, a = 1) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `Color(${f(((n >> 16) & 255) / 255)}, ${f(((n >> 8) & 255) / 255)}, ${f((n & 255) / 255)}, ${a})`;
};

interface Mat {
  id: string;
  color: string;
  alpha?: number;
  rough?: number;
}

export interface ExportResult {
  dir: string;
  models: number;
  items: number;
}

/** Writes a complete, ready-to-open Godot 4 project for a plan + layout. */
export function exportGodotProject(plan: FloorPlan, layout: Layout, catalog: Catalog, outDir: string): ExportResult {
  const scene = buildScene(plan, layout, catalog);
  const byId = new Map(catalog.items.map((i) => [i.id, i]));

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "assets/models"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "scripts"), { recursive: true });

  // Only the models this layout actually uses.
  const usedModels = new Set<string>();
  for (const it of scene.items) {
    const c = byId.get(it.itemId);
    if (c?.model) usedModels.add(c.model);
  }
  for (const m of usedModels) {
    const src = path.join(ROOT, "public", m);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, "assets/models", path.basename(m)));
  }

  const ext: string[] = [];
  const sub: string[] = [];
  const nodes: string[] = [];
  const extIds = new Map<string, string>();
  const boxMeshes = new Map<string, string>();
  const boxShapes = new Map<string, string>();
  const mats = new Map<string, Mat>();

  const addExt = (type: string, p: string) => {
    let id = extIds.get(p);
    if (!id) {
      id = `e${extIds.size + 1}`;
      extIds.set(p, id);
      ext.push(`[ext_resource type="${type}" path="${p}" id="${id}"]`);
    }
    return id;
  };
  const mat = (id: string, color: string, alpha = 1, rough = 0.85) => {
    if (!mats.has(id)) mats.set(id, { id, color, alpha, rough });
    return `SubResource("${id}")`;
  };
  const boxMesh = (x: number, y: number, z: number) => {
    const k = `${f(x)}_${f(y)}_${f(z)}`;
    if (!boxMeshes.has(k)) {
      const id = `bm${boxMeshes.size + 1}`;
      boxMeshes.set(k, id);
      sub.push(`[sub_resource type="BoxMesh" id="${id}"]\nsize = Vector3(${f(x)}, ${f(y)}, ${f(z)})`);
    }
    return `SubResource("${boxMeshes.get(k)}")`;
  };
  const boxShape = (x: number, y: number, z: number) => {
    const k = `${f(x)}_${f(y)}_${f(z)}`;
    if (!boxShapes.has(k)) {
      const id = `bs${boxShapes.size + 1}`;
      boxShapes.set(k, id);
      sub.push(`[sub_resource type="BoxShape3D" id="${id}"]\nsize = Vector3(${f(x)}, ${f(y)}, ${f(z)})`);
    }
    return `SubResource("${boxShapes.get(k)}")`;
  };

  const group = (name: string) => nodes.push(`[node name="${name}" type="Node3D" parent="."]`);
  const polyStr = (p: Pt[]) => `PackedVector2Array(${p.map((q) => `${f(q[0])}, ${f(q[1])}`).join(", ")})`;

  // Environment
  sub.push(`[sub_resource type="ProceduralSkyMaterial" id="skymat"]
sky_top_color = Color(0.36, 0.58, 0.9, 1)
sky_horizon_color = Color(0.76, 0.83, 0.92, 1)
ground_horizon_color = Color(0.74, 0.78, 0.8, 1)
ground_bottom_color = Color(0.52, 0.57, 0.56, 1)`);
  sub.push(`[sub_resource type="Sky" id="sky"]\nsky_material = SubResource("skymat")`);
  sub.push(`[sub_resource type="Environment" id="env"]
background_mode = 2
sky = SubResource("sky")
ambient_light_source = 2
ambient_light_color = Color(1, 1, 1, 1)
ambient_light_energy = 0.6
tonemap_mode = 2`);
  sub.push(`[sub_resource type="CapsuleShape3D" id="capsule"]\nradius = 0.3\nheight = 1.8`);
  sub.push(`[sub_resource type="PlaneMesh" id="ground"]\nsize = Vector2(400, 400)`);

  const mainScript = addExt("Script", "res://scripts/main.gd");
  const playerScript = addExt("Script", "res://scripts/player.gd");
  const xrScript = addExt("Script", "res://scripts/xr_rig.gd");

  const tp = scene.teleports.map((t) => `{"label": "${t.label.replace(/"/g, "'")}", "x": ${f(t.x)}, "z": ${f(-t.y)}, "yaw": ${f(rad(t.lookDeg - 90))}}`).join(", ");
  nodes.push(`[node name="Main" type="Node3D"]\nscript = ExtResource("${mainScript}")\nteleports = Array[Dictionary]([${tp}])`);
  nodes.push(`[node name="WorldEnvironment" type="WorldEnvironment" parent="."]\nenvironment = SubResource("env")`);
  nodes.push(`[node name="Sun" type="DirectionalLight3D" parent="."]\ntransform = ${T(mul(rotY(35), rotX(-55)), [0, 12, 0])}\nlight_energy = 0.9\nshadow_enabled = true\ndirectional_shadow_max_distance = 90.0`);
  nodes.push(`[node name="Ground" type="MeshInstance3D" parent="."]\ntransform = ${T([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, -0.16, 0])}\nmesh = SubResource("ground")\nmaterial_override = ${mat("mat_ground", "#b9c0b4", 1, 1)}`);

  // Floor slab and ceiling (CSG polygons: any outline, concave included)
  const flat = [1, 0, 0, 0, 0, 1, 0, -1, 0];
  nodes.push(`[node name="Floor" type="CSGPolygon3D" parent="."]\ntransform = ${T(flat, [0, 0, 0])}\npolygon = ${polyStr(scene.boundary)}\ndepth = 0.15\nuse_collision = true\nmaterial = ${mat("mat_floor", "#d6d1c6", 1, 0.9)}`);
  nodes.push(`[node name="Ceiling" type="CSGPolygon3D" parent="."]\ntransform = ${T(flat, [0, scene.ceilingHeight, 0])}\npolygon = ${polyStr(scene.boundary)}\ndepth = 0.06\ncast_shadow = 0\nmaterial = ${mat("mat_ceiling", "#f7f6f2", 1, 0.95)}`);

  // Zone floors
  group("Zones");
  for (const z of scene.roomFloors) {
    const b = bbox(z.polygon);
    nodes.push(`[node name="F_${safe(z.zoneId)}" type="MeshInstance3D" parent="Zones"]\ntransform = ${T([1, 0, 0, 0, 1, 0, 0, 0, 1], [(b.minX + b.maxX) / 2, 0.006, -(b.minY + b.maxY) / 2])}\nmesh = ${boxMesh(b.width, 0.012, b.height)}\nmaterial_override = ${mat(`mat_zone_${z.type}`, z.color, 1, 0.95)}`);
  }

  // Structure: walls, partitions, glass
  group("Walls");
  const wallMats: Record<WorldBox["kind"], string> = {
    wall: mat("mat_wall", "#f1eee8", 1, 0.9),
    glass: mat("mat_glass", "#bcd8ea", 0.28, 0.05),
    partition: mat("mat_partition", "#e8e5de", 1, 0.9),
    "partition-glass": mat("mat_pglass", "#c5dfec", 0.3, 0.05),
  };
  for (const w of [...scene.walls, ...scene.partitions]) {
    const h = w.y1 - w.y0;
    const body = `Walls/B_${safe(w.id)}`;
    nodes.push(`[node name="B_${safe(w.id)}" type="StaticBody3D" parent="Walls"]\ntransform = ${T(rotY(w.angleDeg), [w.cx, (w.y0 + w.y1) / 2, -w.cy])}`);
    nodes.push(`[node name="Mesh" type="MeshInstance3D" parent="${body}"]\nmesh = ${boxMesh(w.length, h, w.thickness)}\nmaterial_override = ${wallMats[w.kind]}`);
    nodes.push(`[node name="Col" type="CollisionShape3D" parent="${body}"]\nshape = ${boxShape(w.length, h, w.thickness)}`);
  }

  group("Structure");
  for (const o of scene.obstacles) {
    nodes.push(`[node name="S_${safe(o.id)}" type="CSGPolygon3D" parent="Structure"]\ntransform = ${T(flat, [0, o.height, 0])}\npolygon = ${polyStr(o.polygon)}\ndepth = ${f(o.height)}\nuse_collision = true\nmaterial = ${mat(o.type === "column" ? "mat_column" : "mat_core", o.type === "column" ? "#bdb9b0" : "#cfccc4", 1, 0.9)}`);
  }

  // Furniture
  group("Furniture");
  let items = 0;
  for (const it of scene.items) {
    const c = byId.get(it.itemId);
    if (!c) continue;
    const name = `I_${safe(it.id)}`;
    if (c.procedural) {
      const m = mat(`mat_${rid(c.id)}`, c.procedural.color, 1, 0.6);
      if (c.procedural.shape === "cylinder") {
        sub.push(`[sub_resource type="CylinderMesh" id="cy_${rid(c.id)}"]\ntop_radius = ${f(c.footprint.width / 2)}\nbottom_radius = ${f(c.footprint.width / 2)}\nheight = ${f(c.height)}`);
        // declared once per catalog item below; guard duplicates
      }
      nodes.push(`[node name="${name}" type="MeshInstance3D" parent="Furniture"]\ntransform = ${T(rotY(it.yawDeg), [it.x, it.elevation + c.height / 2, -it.y])}\nmesh = ${c.procedural.shape === "cylinder" ? `SubResource("cy_${rid(c.id)}")` : boxMesh(c.footprint.width, c.height, c.footprint.depth)}\nmaterial_override = ${m}`);
      items++;
      continue;
    }
    const id = addExt("PackedScene", `res://assets/models/${path.basename(c.model)}`);
    const psi = it.yawDeg;
    // origin = pos + R(psi) * (-origin); basis = R(psi + frontYaw) * scale
    const ox = -c.origin[0], oy = -c.origin[1], oz = -c.origin[2];
    const cs = Math.cos(rad(psi)), sn = Math.sin(rad(psi));
    const pos: [number, number, number] = [it.x + cs * ox + sn * oz, it.elevation + oy, -it.y - sn * ox + cs * oz];
    nodes.push(`[node name="${name}" parent="Furniture" instance=ExtResource("${id}")]\ntransform = ${T(rotY(psi + c.frontYawDeg, c.scale), pos)}`);
    items++;
  }

  // Invisible collision for furniture so the player cannot walk through desks
  group("FurnitureColliders");
  scene.colliders.filter((c) => c.src === "item").forEach((c, i) => {
    const body = `FurnitureColliders/C${i}`;
    nodes.push(`[node name="C${i}" type="StaticBody3D" parent="FurnitureColliders"]\ntransform = ${T(rotY(c.angleDeg), [c.cx, 0.5, -c.cy])}`);
    nodes.push(`[node name="Col" type="CollisionShape3D" parent="${body}"]\nshape = ${boxShape(c.hx * 2, 1.0, c.hy * 2)}`);
  });

  // Player (desktop) and VR rig
  nodes.push(`[node name="Player" type="CharacterBody3D" parent="."]\ntransform = ${T(rotY(scene.spawn.lookDeg - 90), [scene.spawn.x, 0.05, -scene.spawn.y])}\nscript = ExtResource("${playerScript}")`);
  nodes.push(`[node name="Collision" type="CollisionShape3D" parent="Player"]\ntransform = ${T([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0.9, 0])}\nshape = SubResource("capsule")`);
  nodes.push(`[node name="Head" type="Node3D" parent="Player"]`);
  nodes.push(`[node name="Camera3D" type="Camera3D" parent="Player/Head"]\ncurrent = true\nfov = 75.0\nnear = 0.05\nfar = 400.0`);
  const bb = bbox(scene.boundary);
  const span = Math.max(bb.width, bb.height);
  nodes.push(`[node name="Overview" type="Camera3D" parent="."]\ntransform = ${T([1, 0, 0, 0, 0, 1, 0, -1, 0], [(bb.minX + bb.maxX) / 2, span * 0.98 + 4, -(bb.minY + bb.maxY) / 2])}\nfov = 55.0\nfar = 500.0`);
  nodes.push(`[node name="XRRig" type="XROrigin3D" parent="."]\nscript = ExtResource("${xrScript}")`);
  nodes.push(`[node name="XRCamera3D" type="XRCamera3D" parent="XRRig"]`);
  nodes.push(`[node name="LeftHand" type="XRController3D" parent="XRRig"]\ntracker = &"left_hand"`);
  nodes.push(`[node name="RightHand" type="XRController3D" parent="XRRig"]\ntracker = &"right_hand"`);

  // Materials last, so every id used above exists
  for (const m of mats.values()) {
    const transparent = (m.alpha ?? 1) < 1;
    sub.push(`[sub_resource type="StandardMaterial3D" id="${m.id}"]\nalbedo_color = ${col(m.color, m.alpha ?? 1)}\nroughness = ${m.rough ?? 0.85}${transparent ? "\ntransparency = 1\ncull_mode = 2" : ""}`);
  }

  // Sub-resources must be declared before use, and a cylinder mesh may be declared once per item: dedupe by id.
  const seen = new Set<string>();
  const subs = sub.filter((s) => {
    const id = /id="([^"]+)"/.exec(s)![1];
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const head = `[gd_scene load_steps=${ext.length + subs.length + 1} format=3]\n`;
  fs.writeFileSync(path.join(outDir, "main.tscn"), `${head}\n${ext.join("\n")}\n\n${subs.join("\n\n")}\n\n${nodes.join("\n\n")}\n`);

  const title = `SpacePlanner - ${plan.name}`.replace(/"/g, "'");
  fs.writeFileSync(
    path.join(outDir, "project.godot"),
    `; Engine configuration file. Generated by SpacePlanner Web.
config_version=5

[application]

config/name="${title}"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.3", "Forward Plus")
config/icon="res://icon.svg"

[display]

window/size/viewport_width=1600
window/size/viewport_height=900

[rendering]

environment/defaults/default_clear_color=Color(0.72, 0.82, 0.92, 1)
anti_aliasing/quality/msaa_3d=2

[xr]

; VR is off by default. Set this to true (and restart Godot) if you connect a headset.
openxr/enabled=false
openxr/startup_alert=false
shaders/enabled=true
`,
  );
  fs.writeFileSync(path.join(outDir, "icon.svg"), ICON_SVG);
  fs.writeFileSync(path.join(outDir, "scripts/main.gd"), MAIN_GD);
  fs.writeFileSync(path.join(outDir, "scripts/player.gd"), PLAYER_GD);
  fs.writeFileSync(path.join(outDir, "scripts/xr_rig.gd"), XR_RIG_GD);
  fs.writeFileSync(path.join(outDir, "README.md"), PROJECT_README(plan.name));

  return { dir: outDir, models: usedModels.size, items };
}

function rotX(deg: number): number[] {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function mul(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}

export { itemYawDeg };
