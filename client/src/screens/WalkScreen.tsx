import { Canvas } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Footprints, Hand, LocateFixed, Map as MapIcon, MousePointer2, PencilRuler } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Catalog, FloorPlan, Layout } from "../../../shared/types";
import { buildScene } from "../../../shared/scene";
import Scene3D from "../walk/Scene3D";
import EditLayer, { toWorldItem } from "../walk/EditLayer";
import { EditToolbar, Inspector, Palette } from "../walk/EditPanel";
import { useLayoutEditor } from "../walk/useLayoutEditor";
import type { PlacementIssue } from "../../../shared/edit";
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
  initialMode?: "walk" | "edit";
  /** Called whenever furniture is edited, so the rest of the app (layout screen, Godot export) sees the changes. */
  onLayoutChange?: (layout: Layout) => void;
}

export default function WalkScreen({ plan, layout, catalog, onBack, initialTeleport, initialTop, initialMode, onLayoutChange }: Props) {
  // The parent's layout is replaced by every edit, so the generated layout is captured once, at mount.
  const base = useRef(layout).current;
  const editor = useLayoutEditor(base, catalog);
  const sent = useRef(false);
  const [mode, setMode] = useState<"walk" | "edit">(initialMode ?? "walk");
  const [snapOn, setSnapOn] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [issues, setIssues] = useState<PlacementIssue[]>([]);
  const editing = mode === "edit";

  // The layout as edited so far. Zones stay as generated; furniture positions, sizes and additions are live.
  const editedLayout = useMemo<Layout>(() => {
    const items = new Map(catalog.items.map((i) => [i.id, i]));
    let footprint = 0;
    for (const p of editor.placements) {
      const it = items.get(p.itemId);
      if (it && it.elevation === 0) footprint += it.footprint.width * it.footprint.depth * (p.scale ?? 1) ** 2;
    }
    return { ...base, placements: editor.placements, edited: base.edited || editor.changed, metrics: { ...base.metrics, furnitureFootprintSqM: Math.round(footprint * 10) / 10 } };
  }, [base, editor.placements, editor.changed, catalog]);
  const scene = useMemo(() => buildScene(plan, editedLayout, catalog), [plan, editedLayout, catalog]);

  useEffect(() => {
    if (editor.changed || sent.current) {
      sent.current = true;
      onLayoutChange?.(editedLayout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedLayout]);

  const draftItem = useMemo(() => {
    const d = editor.draft;
    const c = d ? catalog.items.find((i) => i.id === d.itemId) : null;
    return d && c ? toWorldItem(d, c) : null;
  }, [editor.draft, catalog]);
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

  // Drop a new piece in front of the viewer, facing them.
  const addPiece = useCallback(
    (itemId: string) => {
      const s = state.current;
      const fx = -Math.sin(s.yaw), fy = Math.cos(s.yaw);
      let x = s.x + fx * 2.2, y = s.y + fy * 2.2;
      if (topView) {
        const xs = scene.boundary.map((p) => p[0]), ys = scene.boundary.map((p) => p[1]);
        x = (Math.min(...xs) + Math.max(...xs)) / 2;
        y = (Math.min(...ys) + Math.max(...ys)) / 2;
      }
      const facing = (Math.atan2(-fy, -fx) * 180) / Math.PI;
      editor.add(itemId, x, y, Math.round(facing / 15) * 15);
    },
    [editor, topView, scene.boundary],
  );

  const chooseMode = (m: "walk" | "edit") => {
    setMode(m);
    if (m === "walk") {
      editor.select(null);
      setPaletteOpen(false);
      setHoverId(null);
    }
  };

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
          <Scene3D scene={scene} catalog={catalog} hideCeiling={topView} editing={editing} hiddenId={editing ? editor.selectedId : null} draftItem={editing ? draftItem : null} hoverId={editing ? hoverId : null} />
          {editing && <EditLayer scene={scene} catalog={catalog} editor={editor} snap={snapOn ? 0.1 : 0} topView={topView} hoverId={hoverId} onHover={setHoverId} onIssues={setIssues} />}
        </Suspense>
        <Player scene={scene} state={state} input={input} topView={topView} onLockChange={setLocked} editing={editing} />
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
          <div role="tablist" aria-label="Mode" className="flex overflow-hidden rounded-xl bg-surface/95 p-1 shadow-pop backdrop-blur">
            <ModeTab on={!editing} onClick={() => chooseMode("walk")} icon={<Footprints size={15} />} label="Walk" />
            <ModeTab on={editing} onClick={() => chooseMode("edit")} icon={<PencilRuler size={15} />} label="Edit" />
          </div>
          <button onClick={() => setTopView((v) => !v)} aria-pressed={topView} className={"flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13.5px] font-medium shadow-pop backdrop-blur transition " + (topView ? "bg-brand text-white" : "bg-surface/95 text-ink hover:bg-surface")}>
            <MapIcon size={15} /> {topView ? "Back to walking" : "Bird's-eye view"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="pointer-events-none absolute left-4 top-[68px] flex flex-col gap-2.5">
          <EditToolbar editor={editor} snapOn={snapOn} onSnap={() => setSnapOn((v) => !v)} paletteOpen={paletteOpen} onPalette={() => setPaletteOpen((v) => !v)} />
          {paletteOpen && <Palette catalog={catalog} onAdd={addPiece} onClose={() => setPaletteOpen(false)} />}
        </div>
      )}

      {/* top-right: minimap, and the inspector while editing */}
      <div className="pointer-events-none absolute right-4 top-4 flex flex-col items-end gap-3">
        <Minimap scene={scene} state={state} />
        {editing && <Inspector editor={editor} catalog={catalog} issues={issues} />}
      </div>

      {/* centre hint until the mouse is captured */}
      {editing && ready && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4">
          <div className="flex max-w-[860px] flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-2xl bg-ink/85 px-5 py-2.5 text-[13px] text-white shadow-pop backdrop-blur">
            <Hand size={15} />
            <span><strong className="font-semibold">Click</strong> furniture to select · <strong className="font-semibold">drag</strong> to move</span>
            <span><kbd>R</kbd> rotate · <kbd>[</kbd> <kbd>]</kbd> resize · <kbd>Del</kbd> remove · <kbd>Ctrl+D</kbd> copy · <kbd>Ctrl+Z</kbd> undo</span>
            <span>{topView ? "Right-drag pans · wheel zooms" : "Hold right mouse to look · WASD to move"}</span>
          </div>
        </div>
      )}

      {!editing && !topView && !locked && ready && (
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
      {!topView && !editing && (
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

function ModeTab({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button role="tab" aria-selected={on} onClick={onClick} className={"flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium transition " + (on ? "bg-brand text-white shadow-sm" : "text-ink-2 hover:text-ink")}>
      {icon}
      {label}
    </button>
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
