import { Line, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import type { Catalog, CatalogItem, Placement } from "../../../shared/types";
import type { SceneDescription, WorldItem } from "../../../shared/scene";
import { itemYawDeg } from "../../../shared/scene";
import { checkPlacement, clampScale, normDeg, placementCorners, snapTo } from "../../../shared/edit";
import type { PlacementIssue } from "../../../shared/edit";
import type { LayoutEditor } from "./useLayoutEditor";
import { itemMatrix } from "./Scene3D";

const rad = (d: number) => (d * Math.PI) / 180;

export const toWorldItem = (p: Placement, c: CatalogItem): WorldItem => ({
  id: p.id, itemId: p.itemId, x: p.position[0], y: p.position[1], elevation: c.elevation, yawDeg: itemYawDeg(p.rotationDeg), scale: p.scale ?? 1,
});

interface Props {
  scene: SceneDescription;
  catalog: Catalog;
  editor: LayoutEditor;
  /** Position snapping in metres (0 = free). */
  snap: number;
  topView: boolean;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onIssues: (issues: PlacementIssue[]) => void;
}

const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * Everything that makes edit mode work inside the 3D canvas: picking furniture under the cursor, dragging it over
 * the floor, keyboard shortcuts, and drawing the selected piece with its footprint and facing arrow.
 */
export default function EditLayer({ scene, catalog, editor, snap, topView, hoverId, onHover, onIssues }: Props) {
  const { camera, gl, raycaster, scene: three } = useThree();
  const byId = useMemo(() => new Map(catalog.items.map((i) => [i.id, i])), [catalog]);
  const ed = useRef(editor);
  ed.current = editor;
  const opts = useRef({ snap, hoverId });
  opts.current = { snap, hoverId };
  const dragState = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const fixed = useMemo(() => scene.colliders.filter((c) => c.src !== "item"), [scene.colliders]);

  // Validity of the selected piece, recomputed as it moves.
  const issues = useMemo<PlacementIssue[]>(() => {
    const d = editor.draft;
    const c = d ? byId.get(d.itemId) : null;
    if (!d || !c) return [];
    const others = editor.placements.filter((p) => p.id !== d.id).map((p) => ({ p, it: byId.get(p.itemId)! })).filter((o) => o.it);
    return checkPlacement(d, c, scene.boundary, fixed, others);
  }, [editor.draft, editor.placements, byId, fixed, scene.boundary]);
  useEffect(() => onIssues(issues), [issues, onIssues]);

  useEffect(() => {
    const el = gl.domElement;
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();

    const setRay = (e: PointerEvent | MouseEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      raycaster.layers.set(1);
    };
    const pickId = (): string | null => {
      const hits = raycaster.intersectObjects(three.children, true);
      const first = hits.find((h) => h.object.layers.isEnabled(1));
      return first ? ((first.object.userData.pickId as string | undefined) ?? null) : null;
    };
    const floorPoint = (): { x: number; y: number } | null => {
      if (!raycaster.ray.intersectPlane(FLOOR, hit)) return null;
      return { x: hit.x, y: -hit.z };
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      setRay(e);
      const id = pickId();
      if (!id) {
        ed.current.select(null);
        return;
      }
      const placement = ed.current.placements.find((p) => p.id === id);
      if (!placement) return;
      if (ed.current.selectedId !== id) ed.current.select(id);
      const fp = floorPoint();
      if (fp) dragState.current = { id, dx: fp.x - placement.position[0], dy: fp.y - placement.position[1] };
      el.setPointerCapture?.(e.pointerId);
    };

    const move = (e: PointerEvent) => {
      setRay(e);
      const d = dragState.current;
      if (!d) {
        if (e.buttons === 0) {
          const id = pickId();
          if (id !== opts.current.hoverId) onHover(id);
          el.style.cursor = id ? "grab" : "default";
        }
        return;
      }
      const fp = floorPoint();
      if (!fp) return;
      const s = opts.current.snap;
      ed.current.drag({ position: [Math.round(snapTo(fp.x - d.dx, s) * 1000) / 1000, Math.round(snapTo(fp.y - d.dy, s) * 1000) / 1000] });
      el.style.cursor = "grabbing";
    };

    const up = (e: PointerEvent) => {
      if (dragState.current) {
        dragState.current = null;
        ed.current.commit();
        el.releasePointerCapture?.(e.pointerId);
        el.style.cursor = "grab";
      }
    };

    // Mouse wheel while holding a piece turns it.
    const wheel = (e: WheelEvent) => {
      if (!dragState.current) return;
      e.preventDefault();
      ed.current.drag({ rotationDeg: normDeg((ed.current.draft?.rotationDeg ?? 0) + (e.deltaY > 0 ? -15 : 15)) });
    };

    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      const E = ed.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === "KeyZ") return (e.preventDefault(), e.shiftKey ? E.redo() : E.undo());
      if (mod && e.code === "KeyY") return (e.preventDefault(), E.redo());
      if (mod && e.code === "KeyD") return (e.preventDefault(), E.duplicate());
      if (mod) return;
      if (e.code === "Escape") return E.select(null);
      if (!E.draft) return;
      const step = e.shiftKey ? 90 : 15;
      switch (e.code) {
        case "Delete": case "Backspace": e.preventDefault(); return E.remove();
        case "KeyR": return E.apply((p) => ({ rotationDeg: normDeg(p.rotationDeg + (e.altKey ? -step : step)) }));
        case "BracketRight": case "Equal": case "NumpadAdd": return E.apply((p) => ({ scale: clampScale((p.scale ?? 1) + 0.05) }));
        case "BracketLeft": case "Minus": case "NumpadSubtract": return E.apply((p) => ({ scale: clampScale((p.scale ?? 1) - 0.05) }));
      }
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
      el.style.cursor = "default";
    };
  }, [gl, camera, raycaster, three, onHover]);

  const d = editor.draft;
  const c = d ? byId.get(d.itemId) : null;
  return d && c ? <Selected placement={d} item={c} bad={issues.length > 0} topView={topView} /> : null;
}

/** The piece being edited: drawn live, with a footprint outline and a facing arrow. */
export function Selected({ placement, item, bad, topView }: { placement: Placement; item: CatalogItem; bad: boolean; topView: boolean }) {
  const w = toWorldItem(placement, item);
  const color = bad ? "#d64545" : "#0f6b5c";
  const corners = placementCorners(placement, item);
  const outline = [...corners, corners[0]].map((p) => new THREE.Vector3(p[0], 0.035, -p[1]));
  const k = placement.scale ?? 1;
  const theta = rad(placement.rotationDeg);
  const front = { x: Math.cos(theta), z: -Math.sin(theta) };
  const reach = (item.footprint.depth * k) / 2 + 0.22;
  const arrow = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.2);
    s.lineTo(-0.16, -0.06);
    s.lineTo(0.16, -0.06);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <LiveBoundary item={item} w={w}>
          {item.procedural ? <LiveProcedural item={item} w={w} /> : <LiveModel item={item} w={w} />}
        </LiveBoundary>
      </Suspense>
      <Line points={outline} color={color} lineWidth={topView ? 3 : 2.4} depthTest={false} renderOrder={5} />
      <mesh position={[w.x, 0.03, -w.y]} rotation={[-Math.PI / 2, 0, rad(w.yawDeg)]} renderOrder={4}>
        <planeGeometry args={[item.footprint.width * k, item.footprint.depth * k]} />
        <meshBasicMaterial color={color} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      {/* arrow on the floor pointing the way the piece faces */}
      <mesh geometry={arrow} position={[w.x + front.x * reach, 0.04, -w.y + front.z * reach]} rotation={[-Math.PI / 2, 0, theta - Math.PI / 2]} renderOrder={6}>
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
    </>
  );
}

function LiveModel({ item, w }: { item: CatalogItem; w: WorldItem }) {
  const gltf = useGLTF(item.model);
  const root = useMemo(() => {
    const o = gltf.scene.clone(true);
    o.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) (m.castShadow = true, m.receiveShadow = true);
    });
    return o;
  }, [gltf]);
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.matrixAutoUpdate = false;
    g.matrix.copy(itemMatrix(item, w));
    g.matrixWorldNeedsUpdate = true;
  });
  return (
    <group ref={ref}>
      <primitive object={root} />
    </group>
  );
}

function LiveProcedural({ item, w }: { item: CatalogItem; w: WorldItem }) {
  const proc = item.procedural!;
  return (
    <mesh position={[w.x, w.elevation + (item.height * w.scale) / 2, -w.y]} rotation={[0, rad(w.yawDeg), 0]} scale={w.scale} castShadow>
      {proc.shape === "cylinder" ? <cylinderGeometry args={[item.footprint.width / 2, item.footprint.width / 2, item.height, 32]} /> : <boxGeometry args={[item.footprint.width, item.height, item.footprint.depth]} />}
      <meshStandardMaterial color={proc.color} roughness={0.6} />
    </mesh>
  );
}

class LiveBoundary extends Component<{ children: ReactNode; item: CatalogItem; w: WorldItem }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    const { item, w } = this.props;
    if (!this.state.failed) return this.props.children;
    return (
      <mesh position={[w.x, w.elevation + (item.height * w.scale) / 2, -w.y]} rotation={[0, rad(w.yawDeg), 0]} scale={w.scale}>
        <boxGeometry args={[item.footprint.width, item.height, item.footprint.depth]} />
        <meshStandardMaterial color="#9aa1ad" />
      </mesh>
    );
  }
}
