import { useFrame, useThree } from "@react-three/fiber";
import type { MutableRefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Catalog } from "../../../shared/types";
import type { SceneDescription } from "../../../shared/scene";
import { checkPlacement, snapTo } from "../../../shared/edit";
import type { PlacementIssue } from "../../../shared/edit";
import { Selected } from "../walk/EditLayer";
import type { LayoutEditor } from "../walk/useLayoutEditor";

/** What the canvas tells the page: where the crosshair meets the floor, and which way the viewer faces. */
export interface EditBridge {
  floor: { x: number; y: number } | null;
  /** Direction (degrees, plan space) a piece dropped here should face so that it looks back at the viewer. */
  facing: number;
}

interface Props {
  scene: SceneDescription;
  catalog: Catalog;
  editor: LayoutEditor;
  snap: number;
  /** True while a piece is being carried: it follows the crosshair across the floor. */
  holding: boolean;
  bridge: MutableRefObject<EditBridge>;
  onHover: (id: string | null) => void;
  onIssues: (issues: PlacementIssue[]) => void;
}

const REACH = 9;

/**
 * Edit mode for the phone. There is no mouse, so the centre of the screen is the pointer: the piece under the
 * crosshair is highlighted, and while one is being carried it follows where the crosshair meets the floor.
 * It renders inside the office group, so it works the same in AR (where that group is moved to sit on your room)
 * and in gyro mode: the view ray is converted into the office's own frame first.
 */
export default function PhoneEditLayer({ scene, catalog, editor, snap, holding, bridge, onHover, onIssues }: Props) {
  const { camera, raycaster } = useThree();
  const anchor = useRef<THREE.Group>(null);
  const byId = useMemo(() => new Map(catalog.items.map((i) => [i.id, i])), [catalog]);
  const fixed = useMemo(() => scene.colliders.filter((c) => c.src !== "item"), [scene.colliders]);
  const ed = useRef(editor);
  ed.current = editor;
  const opts = useRef({ snap, holding });
  opts.current = { snap, holding };
  const lastHover = useRef<string | null>(null);
  const o = useRef(new THREE.Vector3());
  const d = useRef(new THREE.Vector3());
  const inv = useRef(new THREE.Matrix4());

  const issues = useMemo<PlacementIssue[]>(() => {
    const dr = editor.draft;
    const c = dr ? byId.get(dr.itemId) : null;
    if (!dr || !c) return [];
    const others = editor.placements.filter((p) => p.id !== dr.id).map((p) => ({ p, it: byId.get(p.itemId)! })).filter((x) => x.it);
    return checkPlacement(dr, c, scene.boundary, fixed, others);
  }, [editor.draft, editor.placements, byId, fixed, scene.boundary]);
  useEffect(() => onIssues(issues), [issues, onIssues]);
  useEffect(() => () => onHover(null), [onHover]);

  useFrame(() => {
    const me = anchor.current;
    const world = me?.parent;
    if (!me || !world) return;
    world.updateWorldMatrix(true, false);
    inv.current.copy(world.matrixWorld).invert();
    camera.getWorldPosition(o.current).applyMatrix4(inv.current);
    camera.getWorldDirection(d.current).transformDirection(inv.current);

    // Where the crosshair meets the floor (office frame: x east, z = -y).
    if (d.current.y < -0.02) {
      const t = -o.current.y / d.current.y;
      if (t > 0 && t < 14) {
        bridge.current.floor = { x: o.current.x + d.current.x * t, y: -(o.current.z + d.current.z * t) };
      } else bridge.current.floor = null;
    } else bridge.current.floor = null;
    bridge.current.facing = (Math.atan2(d.current.z, -d.current.x) * 180) / Math.PI;

    if (opts.current.holding) {
      const fp = bridge.current.floor;
      if (fp && ed.current.draft) {
        const s = opts.current.snap;
        ed.current.drag({ position: [Math.round(snapTo(fp.x, s) * 1000) / 1000, Math.round(snapTo(fp.y, s) * 1000) / 1000] });
      }
      if (lastHover.current !== null) (lastHover.current = null, onHover(null));
      return;
    }

    raycaster.set(o.current, d.current);
    raycaster.far = REACH;
    raycaster.layers.set(1);
    const hits = raycaster.intersectObjects(world.children, true);
    const first = hits.find((h) => h.object.layers.isEnabled(1));
    const id = first ? ((first.object.userData.pickId as string | undefined) ?? null) : null;
    raycaster.far = Infinity;
    if (id !== lastHover.current) (lastHover.current = id, onHover(id));
  });

  const dr = editor.draft;
  const c = dr ? byId.get(dr.itemId) : null;
  return (
    <group ref={anchor}>
      {dr && c && <Selected placement={dr} item={c} bad={issues.length > 0} topView={false} />}
    </group>
  );
}
