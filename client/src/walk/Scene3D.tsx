import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import type { Catalog, CatalogItem } from "../../../shared/types";
import type { SceneDescription, WorldItem } from "../../../shared/scene";
import { bbox } from "../../../shared/geometry";

const rad = (d: number) => (d * Math.PI) / 180;

/** Matrix that places a catalog item: T(pos) * R(yaw) * T(-origin) * R(frontYaw) * S(scale). */
export function itemMatrix(c: CatalogItem, it: WorldItem): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeTranslation(it.x, it.elevation, -it.y);
  m.multiply(new THREE.Matrix4().makeRotationY(rad(it.yawDeg)));
  m.multiply(new THREE.Matrix4().makeScale(it.scale, it.scale, it.scale));
  m.multiply(new THREE.Matrix4().makeTranslation(-c.origin[0], -c.origin[1], -c.origin[2]));
  m.multiply(new THREE.Matrix4().makeRotationY(rad(c.frontYawDeg)));
  m.multiply(new THREE.Matrix4().makeScale(c.scale, c.scale, c.scale));
  return m;
}

function useFloorTexture() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#d9d5cb";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "rgba(90,86,76,0.16)";
    g.lineWidth = 3;
    g.strokeRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / 1.2, 1 / 1.2);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
}

const shapeOf = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));

interface SceneProps {
  scene: SceneDescription;
  catalog: Catalog;
  hideCeiling: boolean;
  /** Edit mode: furniture becomes pickable and the selected piece is drawn separately. */
  editing?: boolean;
  hiddenId?: string | null;
  /** Live (uncommitted) state of the selected piece, used for its pick box. */
  draftItem?: WorldItem | null;
  hoverId?: string | null;
}

/** Marks an object so the editor's raycaster (layer 1) can hit it. */
const pickable = (o: THREE.Object3D | null) => o?.layers.enable(1);

export default function Scene3D({ scene, catalog, hideCeiling, editing = false, hiddenId = null, draftItem = null, hoverId = null }: SceneProps) {
  const floorTex = useFloorTexture();
  const box = useMemo(() => bbox(scene.boundary), [scene]);
  const floorGeo = useMemo(() => new THREE.ShapeGeometry(shapeOf(scene.boundary)), [scene.boundary]);
  const ceilGeo = floorGeo;
  const span = Math.max(box.width, box.height);
  const cx = (box.minX + box.maxX) / 2, cz = -(box.minY + box.maxY) / 2;

  const byItem = useMemo(() => {
    const m = new Map<string, WorldItem[]>();
    for (const it of scene.items) {
      if (it.id === hiddenId) continue;
      (m.get(it.itemId) ?? m.set(it.itemId, []).get(it.itemId)!).push(it);
    }
    return m;
  }, [scene.items, hiddenId]);
  const catById = useMemo(() => new Map(catalog.items.map((i) => [i.id, i])), [catalog]);

  // Aim the sun (and its shadow frustum) at the middle of this building, wherever it sits.
  const sun = useRef<THREE.DirectionalLight>(null);
  const three = useThree();
  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    light.target.position.set(cx, 0, cz);
    three.scene.add(light.target);
    return () => {
      three.scene.remove(light.target);
    };
  }, [cx, cz, three.scene]);

  return (
    <>
      <color attach="background" args={["#cfe2f3"]} />
      <hemisphereLight args={["#ffffff", "#b9b3a6", 0.85]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        ref={sun}
        position={[cx + span * 0.5, span * 0.9 + 12, cz + span * 0.35]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-span * 0.75}
        shadow-camera-right={span * 0.75}
        shadow-camera-top={span * 0.75}
        shadow-camera-bottom={-span * 0.75}
        shadow-camera-near={1}
        shadow-camera-far={span * 3 + 40}
      />

      {/* ground outside the building */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.06, cz]} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#bfc6b9" roughness={1} />
      </mesh>

      {/* floor slab */}
      <mesh geometry={floorGeo} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial map={floorTex} roughness={0.85} />
      </mesh>

      {/* zone tints */}
      {scene.roomFloors.map((z) => {
        const b = bbox(z.polygon);
        return (
          <mesh key={z.zoneId} position={[(b.minX + b.maxX) / 2, 0.012, -(b.minY + b.maxY) / 2]} receiveShadow>
            <boxGeometry args={[b.width, 0.02, b.height]} />
            <meshStandardMaterial color={z.color} roughness={0.9} />
          </mesh>
        );
      })}

      {/* walls, partitions, glass */}
      {[...scene.walls, ...scene.partitions].map((w) => {
        const glass = w.kind === "glass" || w.kind === "partition-glass";
        return (
          <mesh key={w.id} ref={glass ? undefined : pickable} position={[w.cx, (w.y0 + w.y1) / 2, -w.cy]} rotation={[0, rad(w.angleDeg), 0]} castShadow={!glass} receiveShadow renderOrder={glass ? 2 : 0}>
            <boxGeometry args={[w.length, w.y1 - w.y0, w.thickness]} />
            {glass ? (
              <meshPhysicalMaterial color="#bfe0f2" transparent opacity={0.28} roughness={0.05} metalness={0} depthWrite={false} />
            ) : (
              <meshStandardMaterial color={w.kind === "wall" ? "#f3f0ea" : "#eae7e0"} roughness={0.92} />
            )}
          </mesh>
        );
      })}

      {/* cores and columns */}
      {scene.obstacles.map((o) => (
        <Obstacle key={o.id} polygon={o.polygon} height={o.height} column={o.type === "column"} />
      ))}

      {/* ceiling (hidden in the bird's-eye view) */}
      {!hideCeiling && (
        <mesh geometry={ceilGeo} rotation={[-Math.PI / 2, 0, 0]} position={[0, scene.ceilingHeight, 0]}>
          <meshStandardMaterial color="#fbfaf7" roughness={1} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* pick boxes for edit mode: invisible, but the editor's raycaster can hit them */}
      {editing &&
        scene.items.map((base) => {
          const it = draftItem && draftItem.id === base.id ? draftItem : base;
          const c = catById.get(it.itemId);
          if (!c) return null;
          const h = c.height * it.scale;
          return (
            <mesh key={`pick-${it.id}`} ref={pickable} userData={{ pickId: it.id }} position={[it.x, it.elevation + h / 2, -it.y]} rotation={[0, rad(it.yawDeg), 0]}>
              <boxGeometry args={[c.footprint.width * it.scale, h, c.footprint.depth * it.scale]} />
              <meshBasicMaterial colorWrite={false} depthWrite={false} />
            </mesh>
          );
        })}
      {editing && hoverId && hoverId !== hiddenId && <HoverRing item={scene.items.find((i) => i.id === hoverId) ?? null} catalog={catById} />}

      {/* furniture, one instanced draw per model part */}
      {[...byItem.entries()].map(([id, list]) => {
        const c = catById.get(id);
        if (!c) return null;
        return (
          <ItemBoundary key={id} fallback={<FallbackBoxes item={c} list={list} />}>
            <Suspense fallback={null}>{c.procedural ? <ProceduralItems item={c} list={list} /> : <ModelItems item={c} list={list} />}</Suspense>
          </ItemBoundary>
        );
      })}
    </>
  );
}

function HoverRing({ item, catalog }: { item: WorldItem | null; catalog: Map<string, CatalogItem> }) {
  const c = item ? catalog.get(item.itemId) : null;
  if (!item || !c) return null;
  return (
    <mesh position={[item.x, 0.03, -item.y]} rotation={[-Math.PI / 2, 0, rad(item.yawDeg)]}>
      <planeGeometry args={[c.footprint.width * item.scale + 0.12, c.footprint.depth * item.scale + 0.12]} />
      <meshBasicMaterial color="#0f6b5c" transparent opacity={0.28} depthWrite={false} />
    </mesh>
  );
}

function Obstacle({ polygon, height, column }: { polygon: [number, number][]; height: number; column: boolean }) {
  const geo = useMemo(() => new THREE.ExtrudeGeometry(shapeOf(polygon), { depth: height, bevelEnabled: false }), [polygon, height]);
  return (
    <mesh ref={pickable} geometry={geo} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <meshStandardMaterial color={column ? "#c9c5bb" : "#d7d3ca"} roughness={0.9} />
    </mesh>
  );
}

function ModelItems({ item, list }: { item: CatalogItem; list: WorldItem[] }) {
  const gltf = useGLTF(item.model);
  const parts = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrix: THREE.Matrix4 }[] = [];
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) out.push({ geometry: m.geometry, material: m.material, matrix: m.matrixWorld.clone() });
    });
    return out;
  }, [gltf]);

  const meshes = useMemo(() => {
    const mats = list.map((it) => itemMatrix(item, it));
    return parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, list.length);
      const tmp = new THREE.Matrix4();
      mats.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, p.matrix)));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      return im;
    });
  }, [parts, list, item]);

  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}</>;
}

function ProceduralItems({ item, list }: { item: CatalogItem; list: WorldItem[] }) {
  const proc = item.procedural!;
  return (
    <>
      {list.map((it) => (
        <mesh key={it.id} position={[it.x, it.elevation + (item.height * it.scale) / 2, -it.y]} rotation={[0, rad(it.yawDeg), 0]} scale={it.scale} castShadow receiveShadow>
          {proc.shape === "cylinder" ? <cylinderGeometry args={[item.footprint.width / 2, item.footprint.width / 2, item.height, 32]} /> : <boxGeometry args={[item.footprint.width, item.height, item.footprint.depth]} />}
          <meshStandardMaterial color={proc.color} roughness={0.6} />
        </mesh>
      ))}
    </>
  );
}

/** If a model file is missing or corrupt, show a correctly sized grey box instead of breaking the scene. */
function FallbackBoxes({ item, list }: { item: CatalogItem; list: WorldItem[] }) {
  return (
    <>
      {list.map((it) => (
        <mesh key={it.id} position={[it.x, it.elevation + (item.height * it.scale) / 2, -it.y]} rotation={[0, rad(it.yawDeg), 0]} scale={it.scale} castShadow>
          <boxGeometry args={[item.footprint.width, item.height, item.footprint.depth]} />
          <meshStandardMaterial color="#9aa1ad" roughness={0.8} />
        </mesh>
      ))}
    </>
  );
}

class ItemBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("[walkthrough] model failed to load, using a placeholder box", e);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
