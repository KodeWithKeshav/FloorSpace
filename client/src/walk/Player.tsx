import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import type { SceneDescription } from "../../../shared/scene";
import { bbox } from "../../../shared/geometry";
import { resolveCollisions } from "../../../shared/collision";

export interface PlayerState {
  /** Plan-space position. */
  x: number;
  y: number;
  /** World Y rotation (radians). */
  yaw: number;
  pitch: number;
  locked: boolean;
}

export interface WalkInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  run: boolean;
}

export const EYE_HEIGHT = 1.65;
const WALK = 1.4; // m/s
const RUN = 2.8;
const RADIUS = 0.28;

/** Plan look direction (degrees CCW from +x) -> world yaw. */
export const yawFromLook = (lookDeg: number) => ((lookDeg - 90) * Math.PI) / 180;

interface Props {
  scene: SceneDescription;
  state: MutableRefObject<PlayerState>;
  input: MutableRefObject<WalkInput>;
  topView: boolean;
  onLockChange: (locked: boolean) => void;
  /** Edit mode: no pointer lock. Hold the right mouse button to look; the left button belongs to the editor. */
  editing?: boolean;
}

/** First-person walker with pointer-lock look, WASD / arrow keys, sprint, wall and furniture collision. */
export default function Player({ scene, state, input, topView, onLockChange, editing = false }: Props) {
  const { camera, gl } = useThree();
  const box = bbox(scene.boundary);
  const span = Math.max(box.width, box.height);
  const cx = (box.minX + box.maxX) / 2, cz = -(box.minY + box.maxY) / 2;
  const drag = useRef<{ x: number; y: number } | null>(null);
  const controls = useRef<any>(null);

  useEffect(() => {
    camera.rotation.order = "YXZ";
  }, [camera]);

  // Mouse look (pointer lock) with a click-and-drag fallback, plus keyboard.
  useEffect(() => {
    const el = gl.domElement;
    const look = (dx: number, dy: number, k: number) => {
      state.current.yaw -= dx * k;
      state.current.pitch = Math.max(-1.35, Math.min(1.35, state.current.pitch - dy * k));
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement === el) look(e.movementX, e.movementY, 0.0022);
      else if (drag.current && (!topView || editing) && (!editing || e.buttons & 2)) {
        look(e.clientX - drag.current.x, e.clientY - drag.current.y, 0.004);
        drag.current = { x: e.clientX, y: e.clientY };
      }
    };
    const onDown = (e: MouseEvent) => {
      if (editing) {
        if (e.button === 2 && !topView) drag.current = { x: e.clientX, y: e.clientY };
        return;
      }
      if (topView) return;
      if (e.button === 0) {
        try {
          el.requestPointerLock();
        } catch {
          /* fall back to dragging */
        }
        drag.current = { x: e.clientX, y: e.clientY };
      }
    };
    const onUp = () => (drag.current = null);
    const onLock = () => {
      const locked = document.pointerLockElement === el;
      state.current.locked = locked;
      onLockChange(locked);
    };
    const key = (down: boolean) => (e: KeyboardEvent) => {
      const i = input.current;
      const t = e.target as HTMLElement | null;
      if (down && t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey) return;
      if (editing && (e.code === "KeyQ" || e.code === "KeyE")) return;
      switch (e.code) {
        case "KeyW": case "ArrowUp": i.forward = down; break;
        case "KeyS": case "ArrowDown": i.back = down; break;
        case "KeyA": i.left = down; break;
        case "KeyD": i.right = down; break;
        case "ArrowLeft": case "KeyQ": i.turnLeft = down; break;
        case "ArrowRight": case "KeyE": i.turnRight = down; break;
        case "ShiftLeft": case "ShiftRight": i.run = down; break;
        default: return;
      }
      if (e.code.startsWith("Arrow")) e.preventDefault();
    };
    const kd = key(true), ku = key(false);
    const noMenu = (e: Event) => editing && e.preventDefault();
    if (editing && document.pointerLockElement === el) document.exitPointerLock();
    el.addEventListener("contextmenu", noMenu);
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onLock);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      el.removeEventListener("contextmenu", noMenu);
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onLock);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }, [gl, state, input, topView, onLockChange, editing]);

  // Bird's-eye camera placement when switching views.
  useEffect(() => {
    if (!topView) return;
    camera.position.set(cx, span * 0.55 + 5, cz + 0.001);
    camera.up.set(0, 0, -1);
    camera.lookAt(cx, 0, cz);
    controls.current?.target.set(cx, 0, cz);
    controls.current?.update();
  }, [topView, camera, cx, cz, span]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = state.current;
    const i = input.current;

    if (topView) return;
    camera.up.set(0, 1, 0);

    // Turn with arrows / Q E
    const turn = (i.turnLeft ? 1 : 0) - (i.turnRight ? 1 : 0);
    s.yaw += turn * 1.8 * dt;

    // Movement in plan space: forward = (-sin yaw, cos yaw), right = (cos yaw, sin yaw)
    const fx = -Math.sin(s.yaw), fy = Math.cos(s.yaw);
    const rx = Math.cos(s.yaw), ry = Math.sin(s.yaw);
    let mx = 0, my = 0;
    const f = (i.forward ? 1 : 0) - (i.back ? 1 : 0);
    const r = (i.right ? 1 : 0) - (i.left ? 1 : 0);
    mx = fx * f + rx * r;
    my = fy * f + ry * r;
    const len = Math.hypot(mx, my);
    if (len > 0) {
      const speed = (i.run ? RUN : WALK) * dt;
      s.x += (mx / len) * speed;
      s.y += (my / len) * speed;
      resolveCollisions(s, RADIUS, scene.colliders);
    }

    camera.position.set(s.x, EYE_HEIGHT, -s.y);
    camera.rotation.set(s.pitch, s.yaw, 0, "YXZ");
  });

  return topView ? (
    <OrbitControls
      ref={controls}
      makeDefault
      maxPolarAngle={Math.PI / 2 - 0.05}
      enableDamping
      // While editing, the left button moves furniture: right button pans, middle rotates, wheel zooms.
      mouseButtons={editing ? { LEFT: -1 as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN } : undefined}
    />
  ) : null;
}

export { THREE };
