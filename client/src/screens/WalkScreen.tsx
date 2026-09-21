import { Canvas } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Footprints, LocateFixed, Map as MapIcon, MousePointer2 } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Catalog, FloorPlan, Layout } from "../../../shared/types";
import { buildScene } from "../../../shared/scene";
import Scene3D from "../walk/Scene3D";
import Player, { yawFromLook } from "../walk/Player";
import type { PlayerState, WalkInput } from "../walk/Player";
import Minimap from "../walk/Minimap";

interface Props {
  plan: FloorPlan;
  layout: Layout;
  catalog: Catalog;
  onBack: () => void;
  initialTeleport?: number;
  initialTop?: boolean;
}

export default function WalkScreen({ plan, layout, catalog, onBack, initialTeleport, initialTop }: Props) {
  const scene = useMemo(() => buildScene(plan, layout, catalog), [plan, layout, catalog]);
  const [topView, setTopView] = useState(Boolean(initialTop));
  const [locked, setLocked] = useState(false);
  const [place, setPlace] = useState(initialTeleport ?? 0);
  const [ready, setReady] = useState(false);

  const state = useRef<PlayerState>({ x: scene.spawn.x, y: scene.spawn.y, yaw: yawFromLook(scene.spawn.lookDeg), pitch: 0, locked: false });
  const input = useRef<WalkInput>({ forward: false, back: false, left: false, right: false, turnLeft: false, turnRight: false, run: false });

  const teleport = useCallback(
    (i: number) => {
      const t = scene.teleports[i];
      if (!t) return;
      state.current.x = t.x;
      state.current.y = t.y;
      state.current.yaw = yawFromLook(t.lookDeg);
      state.current.pitch = 0;
      setPlace(i);
    },
    [scene],
  );

  useEffect(() => {
    if (initialTeleport !== undefined) teleport(initialTeleport);
  }, [initialTeleport, teleport]);

  const hold = (key: keyof WalkInput) => ({
    onPointerDown: () => (input.current[key] = true),
    onPointerUp: () => (input.current[key] = false),
    onPointerLeave: () => (input.current[key] = false),
    onPointerCancel: () => (input.current[key] = false),
  });

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 bg-[#cfe2f3]">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ fov: 72, near: 0.05, far: 600, position: [scene.spawn.x, 1.65, -scene.spawn.y] }}
        gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        onCreated={() => setTimeout(() => setReady(true), 0)}
      >
        <Suspense fallback={null}>
          <Scene3D scene={scene} catalog={catalog} hideCeiling={topView} />
        </Suspense>
        <Player scene={scene} state={state} input={input} topView={topView} onLockChange={setLocked} />
      </Canvas>

      <LoadingHint ready={ready} />

      {/* top-left: navigation */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2.5">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <button onClick={onBack} className="flex items-center gap-2 rounded-xl bg-surface/95 px-3.5 py-2 text-[13.5px] font-medium text-ink shadow-pop backdrop-blur transition hover:bg-surface">
            <ArrowLeft size={15} /> Layout
          </button>
          <label className="flex items-center gap-2 rounded-xl bg-surface/95 py-1 pl-3 pr-1.5 text-[13.5px] text-ink-2 shadow-pop backdrop-blur">
            <LocateFixed size={15} className="text-brand" />
            <span className="hidden sm:inline">Go to</span>
            <select value={place} onChange={(e) => teleport(Number(e.target.value))} className="rounded-lg bg-canvas px-2.5 py-1.5 text-[13.5px] font-medium text-ink outline-none">
              {scene.teleports.map((t, i) => <option key={t.id} value={i}>{t.label}</option>)}
            </select>
          </label>
          <button onClick={() => setTopView((v) => !v)} aria-pressed={topView} className={"flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13.5px] font-medium shadow-pop backdrop-blur transition " + (topView ? "bg-brand text-white" : "bg-surface/95 text-ink hover:bg-surface")}>
            <MapIcon size={15} /> {topView ? "Back to walking" : "Bird's-eye view"}
          </button>
        </div>
      </div>

      {/* top-right: minimap */}
      <div className="pointer-events-none absolute right-4 top-4">
        <Minimap scene={scene} state={state} />
      </div>

      {/* centre hint until the mouse is captured */}
      {!topView && !locked && ready && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-2xl bg-ink/85 px-5 py-3 text-[14px] text-white shadow-pop backdrop-blur">
            <MousePointer2 size={17} />
            <span>
              <strong className="font-semibold">Click to look around</strong> · <kbd>W A S D</kbd> walk · <kbd>Shift</kbd> run · <kbd>Esc</kbd> release the mouse
            </span>
          </div>
        </div>
      )}

      {/* on-screen controls: a fallback if the mouse cannot be captured (and for touch screens) */}
      {!topView && (
        <div className="absolute bottom-5 left-4 flex select-none flex-col items-center gap-1.5">
          <Pad {...hold("forward")} label="Walk forward"><ChevronUp size={20} /></Pad>
          <div className="flex gap-1.5">
            <Pad {...hold("turnLeft")} label="Turn left"><ChevronLeft size={20} /></Pad>
            <Pad {...hold("back")} label="Walk back"><ChevronDown size={20} /></Pad>
            <Pad {...hold("turnRight")} label="Turn right"><ChevronRight size={20} /></Pad>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-5 right-4 flex items-center gap-2 rounded-xl bg-surface/95 px-3.5 py-2 text-[12.5px] text-ink-2 shadow-pop backdrop-blur">
        <Footprints size={14} className="text-brand" /> Eye height 1.65 m · walking pace 1.4 m/s
      </div>
    </div>
  );
}

function Pad({ children, label, ...rest }: { children: React.ReactNode; label: string } & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button aria-label={label} {...rest} className="flex h-11 w-11 touch-none items-center justify-center rounded-xl bg-surface/90 text-ink-2 shadow-pop backdrop-blur transition active:bg-brand active:text-white">
      {children}
    </button>
  );
}

function LoadingHint({ ready }: { ready: boolean }) {
  const { active, progress } = useProgress();
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!ready || active) return;
    const t = setTimeout(() => setGone(true), 500);
    return () => clearTimeout(t);
  }, [ready, active]);
  if (gone) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="w-72 rounded-2xl bg-surface/95 px-6 py-4 text-center shadow-pop">
        <div className="text-[14px] font-medium text-ink">Loading furniture…</div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-canvas">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(6, progress)}%` }} />
        </div>
      </div>
    </div>
  );
}
