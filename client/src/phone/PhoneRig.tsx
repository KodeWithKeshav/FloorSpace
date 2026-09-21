import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { MutableRefObject, ReactNode } from "react";
import * as THREE from "three";
import type { SceneDescription, Teleport } from "../../../shared/scene";
import { resolveCollisions } from "../../../shared/collision";

export type PhoneMode = "idle" | "ar" | "gyro";

/** State shared between the page's controls (DOM) and the rig inside the canvas. */
export interface PhoneControl {
  mode: PhoneMode;
  joy: { x: number; y: number };
  /** Move to this stop next frame (also used to recentre). */
  goto: Teleport | null;
  /** See the real world behind the office (AR camera) instead of an opaque sky. */
  passthrough: boolean;
  /** Unused legacy field: the height is now set from where the phone is held when you place yourself. */
  yOffset: number;
  /** Live readout for the HUD: where you are in the office (plan metres) and how high the phone is above its floor. */
  readout: { x: number; y: number; h: number; tracking: boolean };
  orientation: { alpha: number; beta: number; gamma: number; screen: number; live: boolean };
  /** Extra look from dragging, radians. */
  dragYaw: number;
  dragPitch: number;
}

export const yawFromLook = (lookDeg: number) => ((lookDeg - 90) * Math.PI) / 180;

const ZEE = new THREE.Vector3(0, 0, 1);
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const EULER = new THREE.Euler();
const Q0 = new THREE.Quaternion();

/** Device orientation angles -> camera quaternion (the standard three.js mapping). */
function deviceQuaternion(q: THREE.Quaternion, o: PhoneControl["orientation"]) {
  EULER.set(THREE.MathUtils.degToRad(o.beta), THREE.MathUtils.degToRad(o.alpha), -THREE.MathUtils.degToRad(o.gamma), "YXZ");
  q.setFromEuler(EULER);
  q.multiply(Q1);
  q.multiply(Q0.setFromAxisAngle(ZEE, -THREE.MathUtils.degToRad(o.screen)));
}

const EYE = 1.6;
/** Eye height we put the phone at in the office when placing you, whatever height it is really held at. */
const AR_EYE = 1.55;

/**
 * Wraps the office and turns the phone's motion into movement through it.
 *
 * AR: the phone's own tracking moves the camera, so the office is the thing that is placed: its group is rotated
 * and shifted so the chosen spot in the office sits exactly where you are standing, facing the way you look.
 * Walking then moves you through the office 1:1. The joystick slides the office under you for long distances.
 *
 * Gyro: no tracking, so the camera is driven directly: the phone's compass/gyro turns the view, the joystick walks.
 */
const SKY = new THREE.Color("#cfe2f3");

export default function PhoneRig({ scene, ctl, mode, children }: { scene: SceneDescription; ctl: MutableRefObject<PhoneControl>; mode: PhoneMode; children: ReactNode }) {
  const { camera, gl, scene: three } = useThree();
  const world = useRef<THREE.Group>(null);
  const xr = useRef({ alpha: 0, px: 0, py: 0, pz: 0, placed: false });
  const gy = useRef({ x: scene.spawn.x, y: scene.spawn.y, yawOff: 0, calibrated: false, target: yawFromLook(scene.spawn.lookDeg) });
  const ground = useRef<THREE.Object3D | null>(null);
  const tick = useRef(0);
  const q = useRef(new THREE.Quaternion());
  const tmp = useRef(new THREE.Vector3());

  // Re-aim the rig when a session starts or the mode changes.
  useEffect(() => {
    const st = xr.current;
    st.placed = false;
    gy.current.calibrated = false;
  }, [mode]);

  useFrame((_, dtRaw) => {
    const c = ctl.current;
    const dt = Math.min(dtRaw, 0.05);

    // Real sky (camera feed) or a virtual one. A transparent canvas is what lets the AR camera show through.
    const wantClear = c.mode === "ar" && c.passthrough;
    three.background = wantClear ? null : SKY;
    if (++tick.current % 20 === 1 || !ground.current) {
      ground.current = null;
      world.current?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (m.geometry as THREE.PlaneGeometry).type === "PlaneGeometry" && (m.geometry as THREE.PlaneGeometry).parameters.width === 600) ground.current = m;
      });
    }
    if (ground.current) ground.current.visible = !wantClear;

    // AR photos come out washed out under the default filmic tone mapping on phone displays: darken a little.
    gl.toneMappingExposure = c.mode === "ar" ? 0.72 : 1;

    if (c.mode === "ar" && gl.xr.isPresenting) {
      const s = xr.current;
      const place = (t: Teleport) => {
        // Head pose in the tracking space (the camera has no parent, so world == tracking space).
        camera.getWorldPosition(tmp.current);
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const headYaw = Math.atan2(-dir.x, -dir.z);
        const alpha = headYaw - yawFromLook(t.lookDeg);
        const tx = t.x, tz = -t.y;
        const cs = Math.cos(alpha), sn = Math.sin(alpha);
        s.alpha = alpha;
        s.px = tmp.current.x - (cs * tx + sn * tz);
        s.pz = tmp.current.z - (-sn * tx + cs * tz);
        // Put the office floor exactly AR_EYE below wherever the phone is right now. The tracker's own idea of the
        // floor can be wrong (a bed, a table, no floor found yet), and that would leave you below the virtual floor.
        s.py = tmp.current.y - AR_EYE;
        s.placed = true;
      };
      if (c.goto) {
        place(c.goto);
        c.goto = null;
      } else if (!s.placed) {
        place(scene.teleports[0]);
      }
      // Joystick: slide the office opposite to the way you want to go.
      if (Math.abs(c.joy.x) + Math.abs(c.joy.y) > 0.05) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        dir.y = 0;
        dir.normalize();
        const right = new THREE.Vector3(-dir.z, 0, dir.x);
        const speed = 1.6 * dt;
        s.px -= (dir.x * c.joy.y + right.x * c.joy.x) * speed;
        s.pz -= (dir.z * c.joy.y + right.z * c.joy.x) * speed;
      }
      if (world.current) {
        world.current.rotation.set(0, s.alpha, 0);
        world.current.position.set(s.px, s.py, s.pz);
      }
      // Where you are in the office right now (inverse of the placement above).
      camera.getWorldPosition(tmp.current);
      const dx = tmp.current.x - s.px, dz = tmp.current.z - s.pz;
      const cs2 = Math.cos(s.alpha), sn2 = Math.sin(s.alpha);
      c.readout = { x: cs2 * dx - sn2 * dz, y: -(sn2 * dx + cs2 * dz), h: tmp.current.y - s.py, tracking: true };
      return;
    }

    // Everything below drives the camera directly (gyro mode and the idle preview).
    if (world.current) {
      world.current.rotation.set(0, 0, 0);
      world.current.position.set(0, 0, 0);
    }
    if (c.mode === "ar") return; // session requested but not presenting yet
    const g = gy.current;
    if (c.goto) {
      g.x = c.goto.x;
      g.y = c.goto.y;
      g.target = yawFromLook(c.goto.lookDeg);
      g.calibrated = false;
      c.dragYaw = 0;
      c.goto = null;
    }

    if (c.mode === "gyro" && c.orientation.live) {
      deviceQuaternion(q.current, c.orientation);
      if (!g.calibrated) {
        // Make "where the phone points right now" equal the stop's heading.
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q.current);
        g.yawOff = g.target - Math.atan2(-f.x, -f.z);
        g.calibrated = true;
      }
      camera.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.yawOff + c.dragYaw)).multiply(q.current);
    } else {
      // No sensors (desktop, or permission refused): look by dragging.
      camera.quaternion.setFromEuler(new THREE.Euler(c.dragPitch, g.target + c.dragYaw, 0, "YXZ"));
    }

    if (c.mode === "gyro" && Math.abs(c.joy.x) + Math.abs(c.joy.y) > 0.05) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const fx = dir.x, fy = -dir.z; // plan space
      const l = Math.hypot(fx, fy) || 1;
      const f = { x: fx / l, y: fy / l };
      const r = { x: f.y, y: -f.x };
      const speed = 1.4 * dt;
      g.x += (f.x * c.joy.y + r.x * c.joy.x) * speed;
      g.y += (f.y * c.joy.y + r.y * c.joy.x) * speed;
      resolveCollisions(g, 0.28, scene.colliders);
    }
    camera.position.set(g.x, EYE, -g.y);
  });

  return <group ref={world}>{children}</group>;
}
