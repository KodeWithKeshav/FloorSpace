import { Canvas } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import { AlertTriangle, Camera, Compass, Footprints, Loader2, LogOut, PencilRuler, Smartphone, Sparkles } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Catalog, FloorPlan, Layout } from "../../../shared/types";
import { buildScene } from "../../../shared/scene";
import Scene3D from "../walk/Scene3D";
import { toWorldItem } from "../walk/EditLayer";
import { useLayoutEditor } from "../walk/useLayoutEditor";
import type { PlacementIssue } from "../../../shared/edit";
import PhoneEditLayer from "./PhoneEditLayer";
import type { EditBridge } from "./PhoneEditLayer";
import PhoneEditPanel from "./PhoneEditPanel";
import Joystick from "./Joystick";
import PhoneRig from "./PhoneRig";
import type { PhoneControl, PhoneMode } from "./PhoneRig";

type XRNav = Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean>; requestSession: (m: string, o?: object) => Promise<XRSessionLike> } };
interface XRSessionLike extends EventTarget {
  end: () => Promise<void>;
  enabledFeatures?: string[];
}

/** The page a phone opens: fetches the layout published by the laptop and lets you walk through it. */
export default function PhoneApp() {
  const code = new URLSearchParams(window.location.search).get("code") ?? "";
  const [data, setData] = useState<{ plan: FloorPlan; layout: Layout } | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arSupported, setArSupported] = useState<boolean | null>(null);
  const [arWhy, setArWhy] = useState<string>("");
  useEffect(() => {
    (async () => {
      try {
        const [s, c] = await Promise.all([fetch(`/api/phone/session/${encodeURIComponent(code)}`), fetch("/api/catalog")]);
        if (!s.ok) throw new Error(((await s.json()) as { error?: string }).error ?? "Could not load the layout");
        setData(await s.json());
        setCatalog(await c.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reach the laptop");
      }
    })();
    // Work out, and say, exactly why AR is or isn't available: it decides whether walking moves you.
    const nav = navigator as XRNav;
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) {
      setArWhy("This is an iPhone/iPad: Safari has no WebXR, so walking can't be tracked in the browser. Use the gyro mode (look + stick).");
      setArSupported(false);
    } else if (!window.isSecureContext) {
      setArWhy("The page isn't a secure (HTTPS) origin, so AR is blocked. Open the https:// link from the QR code and accept the certificate warning.");
      setArSupported(false);
    } else if (!nav.xr) {
      setArWhy("This browser has no WebXR. Use Chrome on Android (not Samsung Internet or an in-app browser like WhatsApp/Instagram).");
      setArSupported(false);
    } else {
      nav.xr
        .isSessionSupported("immersive-ar")
        .then((ok) => {
          setArSupported(ok);
          if (!ok) setArWhy("Chrome has WebXR but reports AR as unavailable. Install or update \"Google Play Services for AR\" from the Play Store, make sure the phone supports ARCore, then reload.");
        })
        .catch(() => (setArWhy("Checking AR support failed. Reload the page."), setArSupported(false)));
    }
  }, [code]);

  if (error) return <Shell><Card><div className="flex items-start gap-3 text-danger"><AlertTriangle size={22} className="mt-0.5 shrink-0" /><div><h1 className="text-[17px] font-semibold">Can't load the office</h1><p className="mt-1 text-[14px] text-ink-2">{error}</p></div></div></Card></Shell>;
  if (!data || !catalog) return <Shell><Card><div className="flex items-center gap-3 text-ink-2"><Loader2 className="animate-spin" size={20} /> Loading the layout from your laptop…</div></Card></Shell>;
  return <PhoneStage plan={data.plan} layout={data.layout} catalog={catalog} arSupported={arSupported} arWhy={arWhy} />;
}

/** The walk-through itself, once the layout is loaded. Edits are kept here, on the phone, for the session. */
function PhoneStage({ plan, layout, catalog, arSupported, arWhy }: { plan: FloorPlan; layout: Layout; catalog: Catalog; arSupported: boolean | null; arWhy: string }) {
  const [mode, setMode] = useState<PhoneMode>("idle");
  const [passthrough, setPassthrough] = useState(true);
  const [place, setPlace] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [gl, setGl] = useState<THREE.WebGLRenderer | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const session = useRef<XRSessionLike | null>(null);

  const ctl = useRef<PhoneControl>({
    mode: "idle", joy: { x: 0, y: 0 }, goto: null, passthrough: true, yOffset: 0,
    orientation: { alpha: 0, beta: 0, gamma: 0, screen: 0, live: false }, dragYaw: 0, dragPitch: 0,
    readout: { x: 0, y: 0, h: 0, tracking: false },
  });
  const [pos, setPos] = useState({ x: 0, y: 0, h: 0, tracking: false });
  useEffect(() => {
    const t = setInterval(() => setPos({ ...ctl.current.readout }), 250);
    return () => clearInterval(t);
  }, []);
  const joy = useMemo(() => ({ get current() { return ctl.current.joy; }, set current(v) { ctl.current.joy = v; } }), []);

  const editor = useLayoutEditor(layout, catalog);
  const editedLayout = useMemo<Layout>(() => ({ ...layout, placements: editor.placements, edited: layout.edited || editor.changed }), [layout, editor.placements, editor.changed]);
  const scene = useMemo(() => buildScene(plan, editedLayout, catalog), [plan, editedLayout, catalog]);
  const [editing, setEditing] = useState(false);
  const [holding, setHolding] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [issues, setIssues] = useState<PlacementIssue[]>([]);
  const [snapOn, setSnapOn] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const bridge = useRef<EditBridge>({ floor: null, facing: 0 });
  const draftItem = useMemo(() => {
    const d = editor.draft;
    const c = d ? catalog.items.find((i) => i.id === d.itemId) : null;
    return d && c ? toWorldItem(d, c) : null;
  }, [editor.draft, catalog]);

  const toggleEdit = () => {
    if (editing) {
      if (holding) editor.commit();
      editor.select(null);
      setHolding(false);
      setHoverId(null);
      setPaletteOpen(false);
    }
    setEditing(!editing);
  };
  const grab = () => {
    if (holding) {
      editor.commit();
      setHolding(false);
      return;
    }
    const id = hoverId ?? editor.selectedId;
    if (!id) return;
    if (editor.selectedId !== id) editor.select(id);
    setHolding(true);
  };
  // A new piece appears on the floor where the crosshair points (or 2 m ahead), facing you.
  const addPiece = (itemId: string) => {
    const b = bridge.current;
    const fp = b.floor;
    const yaw = (b.facing * Math.PI) / 180;
    const x = fp ? fp.x : scene.spawn.x - Math.cos(yaw) * 2;
    const y = fp ? fp.y : scene.spawn.y - Math.sin(yaw) * 2;
    editor.add(itemId, x, y, Math.round(b.facing / 15) * 15);
    setPaletteOpen(false);
  };

  useEffect(() => {
    ctl.current.mode = mode;
    ctl.current.passthrough = passthrough;
  }, [mode, passthrough]);

  const goto = useCallback(
    (i: number) => {
      if (!scene) return;
      setPlace(i);
      ctl.current.goto = scene.teleports[i];
    },
    [scene],
  );

  // Phone orientation for gyro mode.
  useEffect(() => {
    const on = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      ctl.current.orientation = { alpha: e.alpha, beta: e.beta, gamma: e.gamma, screen: screen.orientation?.angle ?? 0, live: true };
    };
    window.addEventListener("deviceorientation", on);
    return () => window.removeEventListener("deviceorientation", on);
  }, []);

  const startAR = async () => {
    const nav = navigator as XRNav;
    if (!nav.xr || !gl) return;
    setNote(null);
    setMode("ar");
    try {
      const s = await nav.xr.requestSession("immersive-ar", {
        optionalFeatures: ["local-floor", "dom-overlay"],
        domOverlay: { root: overlay.current },
      });
      session.current = s;
      const hasFloor = s.enabledFeatures?.includes("local-floor") ?? false;
      ctl.current.yOffset = hasFloor ? 0 : -1.4;
      gl.xr.enabled = true;
      gl.xr.setReferenceSpaceType(hasFloor ? "local-floor" : "local");
      await (gl.xr as unknown as { setSession: (s: unknown) => Promise<void> }).setSession(s);
      s.addEventListener("end", () => {
        session.current = null;
        setMode("idle");
      });
      ctl.current.goto = scene?.teleports[place] ?? null;
    } catch (e) {
      setMode("idle");
      setNote(`Could not start AR: ${e instanceof Error ? e.message : String(e)}. You can still use the gyro mode below.`);
    }
  };

  const startGyro = async () => {
    setNote(null);
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof D.requestPermission === "function") {
      try {
        if ((await D.requestPermission()) !== "granted") setNote("Motion access was refused, so you'll look around by dragging.");
      } catch {
        setNote("Motion access was refused, so you'll look around by dragging.");
      }
    }
    ctl.current.orientation.live = false;
    setMode("gyro");
    ctl.current.goto = scene?.teleports[place] ?? null;
  };

  const exit = () => {
    if (mode === "ar") void session.current?.end();
    else setMode("idle");
  };

  // Drag to look (gyro mode, and as the desktop fallback).
  const drag = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#cfe2f3]" style={{ touchAction: "none" }}>
      <div
        className="absolute inset-0"
        onPointerDown={(e) => mode === "gyro" && (drag.current = { x: e.clientX, y: e.clientY })}
        onPointerMove={(e) => {
          if (!drag.current || mode !== "gyro") return;
          ctl.current.dragYaw -= (e.clientX - drag.current.x) * 0.005;
          if (!ctl.current.orientation.live) ctl.current.dragPitch = Math.max(-1.3, Math.min(1.3, ctl.current.dragPitch - (e.clientY - drag.current.y) * 0.005));
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <Canvas dpr={[1, 1.5]} camera={{ fov: 70, near: 0.05, far: 500, position: [scene.spawn.x, 1.6, -scene.spawn.y] }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }} onCreated={({ gl: r }) => setGl(r)}>
          <PhoneRig scene={scene} ctl={ctl} mode={mode}>
            <Suspense fallback={null}>
              <Scene3D scene={scene} catalog={catalog} hideCeiling={mode === "ar" && passthrough} editing={editing} hiddenId={editing ? editor.selectedId : null} draftItem={editing ? draftItem : null} hoverId={editing ? hoverId : null} />
              {editing && <PhoneEditLayer scene={scene} catalog={catalog} editor={editor} snap={snapOn ? 0.1 : 0} holding={holding} bridge={bridge} onHover={setHoverId} onIssues={setIssues} />}
            </Suspense>
          </PhoneRig>
        </Canvas>
      </div>

      {/* HUD: also the WebXR dom-overlay root, so it stays on screen inside an AR session */}
      <div ref={overlay} className={"pointer-events-none fixed inset-0 " + (mode === "idle" ? "opacity-0 [&_*]:!pointer-events-none" : "")}>
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 [padding-top:max(0.75rem,env(safe-area-inset-top))]">
          <button onClick={exit} className="pointer-events-auto flex items-center gap-1.5 rounded-xl bg-black/55 px-3 py-2 text-[14px] font-medium text-white backdrop-blur"><LogOut size={15} /> Exit</button>
          <select value={place} onChange={(e) => goto(Number(e.target.value))} aria-label="Go to" className="pointer-events-auto max-w-[46vw] rounded-xl bg-black/55 px-3 py-2 text-[14px] font-medium text-white backdrop-blur">
            {scene.teleports.map((t, i) => <option key={t.id} value={i} className="text-black">{t.label}</option>)}
          </select>
        </div>
        {mode === "ar" && (
          <div className="absolute inset-x-0 top-16 flex justify-center">
            <div className="rounded-full bg-black/55 px-3 py-1 font-mono text-[12px] text-white backdrop-blur">
              {pos.tracking ? `x ${pos.x.toFixed(1)}  y ${pos.y.toFixed(1)}  ·  eye ${pos.h.toFixed(2)} m` : "waiting for tracking…"}
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
          <Joystick value={joy} label="Walk" />
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            {mode === "ar" && (
              <button onClick={() => setPassthrough((v) => !v)} className="flex items-center gap-1.5 rounded-xl bg-black/55 px-3 py-2 text-[13px] font-medium text-white backdrop-blur"><Camera size={15} /> {passthrough ? "Real sky" : "Virtual sky"}</button>
            )}
            <button onClick={toggleEdit} aria-pressed={editing} className={"flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-medium backdrop-blur " + (editing ? "bg-white text-black" : "bg-black/55 text-white")}><PencilRuler size={15} /> {editing ? "Done editing" : "Edit furniture"}</button>
            <button onClick={() => goto(place)} className="flex items-center gap-1.5 rounded-xl bg-black/55 px-3 py-2 text-[13px] font-medium text-white backdrop-blur"><Compass size={15} /> Recentre here</button>
          </div>
        </div>
        {editing && mode !== "idle" && (
          <>
            <Crosshair active={Boolean(hoverId) || holding} />
            <PhoneEditPanel editor={editor} catalog={catalog} hoverId={hoverId} holding={holding} issues={issues} snapOn={snapOn} paletteOpen={paletteOpen} onGrab={grab} onSnap={() => setSnapOn((v) => !v)} onPalette={() => setPaletteOpen((v) => !v)} onAdd={addPiece} />
          </>
        )}
      </div>

      {mode === "idle" && (
        <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/40 to-transparent p-4 sm:items-center">
          <Landing plan={plan} layout={layout} arSupported={arSupported} arWhy={arWhy} note={note} ready={Boolean(gl)} onAR={startAR} onGyro={startGyro} />
        </div>
      )}
      <LoadBar />
    </div>
  );
}

function Landing({ plan, layout, arSupported, arWhy, note, ready, onAR, onGyro }: { plan: FloorPlan; layout: Layout; arSupported: boolean | null; arWhy: string; note: string | null; ready: boolean; onAR: () => void; onGyro: () => void }) {
  return (
    <div className="w-full max-w-[440px] rounded-3xl bg-surface p-5 shadow-pop">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Smartphone size={22} /></span>
        <div>
          <h1 className="text-[18px] font-semibold leading-tight text-ink">{plan.name}</h1>
          <p className="text-[13px] text-ink-2">{layout.metrics.seatsProvided} desk seats · {layout.zones.filter((z) => z.enclosed).length} rooms{layout.edited ? " · edited" : ""}</p>
        </div>
      </div>

      <button onClick={onAR} disabled={!arSupported || !ready} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3.5 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40">
        <Footprints size={18} /> Walk it in AR
      </button>
      <p className="mt-2 text-[12.5px] leading-snug text-ink-2">
        {arSupported === null ? "Checking what this phone supports…" : arSupported ? "Uses the phone's tracking: walk around a clear space and the office moves with you at real size." : arWhy}
      </p>

      <button onClick={onGyro} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-[14.5px] font-semibold text-ink transition active:scale-[0.99]">
        <Sparkles size={17} className="text-brand" /> Look around with the gyro
      </button>
      <p className="mt-2 text-[12.5px] leading-snug text-ink-2">Turn your phone to look; walk with the on-screen stick. <strong>Physical steps are not tracked in this mode</strong>, only turning.</p>

      {note && <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-[12.5px] text-warn">{note}</p>}
      <p className="mt-4 border-t border-line-2 pt-3 text-[12px] leading-snug text-muted">Clear the space around you before you start, and keep an eye on your surroundings while you walk.</p>
    </div>
  );
}

/** The pointer for edit mode: whatever it sits on is what you can pick up. */
function Crosshair({ active }: { active: boolean }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <div className={"flex h-9 w-9 items-center justify-center rounded-full border-2 transition " + (active ? "border-[#3ddc97] bg-[#3ddc97]/20" : "border-white/80")}>
        <div className={"h-1.5 w-1.5 rounded-full " + (active ? "bg-[#3ddc97]" : "bg-white")} />
      </div>
    </div>
  );
}

function LoadBar() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-black/10">
      <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(4, progress)}%` }} />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full items-center justify-center bg-canvas p-5">{children}</div>;
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[420px] rounded-3xl border border-line bg-surface p-6 shadow-card">{children}</div>;
}
