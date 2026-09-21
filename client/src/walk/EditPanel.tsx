import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Magnet, Minus, Plus, RotateCcw, RotateCw, Trash2, Undo2, Redo2, X, Shapes, TriangleAlert, RefreshCcw } from "lucide-react";
import { useMemo, useState } from "react";
import type { Catalog, CatalogCategory } from "../../../shared/types";
import { MAX_SCALE, MIN_SCALE, clampScale, normDeg } from "../../../shared/edit";
import type { PlacementIssue } from "../../../shared/edit";
import type { LayoutEditor } from "./useLayoutEditor";

const CATEGORY_LABEL: Record<CatalogCategory, string> = {
  workstation: "Desks", chair: "Chairs", meeting: "Tables", reception: "Reception", cafeteria: "Cafe", lounge: "Lounge",
  storage: "Storage", equipment: "Equipment", decor: "Plants & decor",
};
const CATEGORY_ORDER: CatalogCategory[] = ["workstation", "chair", "meeting", "lounge", "reception", "cafeteria", "storage", "equipment", "decor"];

interface ToolbarProps {
  editor: LayoutEditor;
  snapOn: boolean;
  onSnap: () => void;
  paletteOpen: boolean;
  onPalette: () => void;
}

/** Undo / redo / snap / add / reset. */
export function EditToolbar({ editor, snapOn, onSnap, paletteOpen, onPalette }: ToolbarProps) {
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2">
      <Group>
        <IconBtn label="Undo (Ctrl+Z)" onClick={editor.undo} disabled={!editor.canUndo}><Undo2 size={16} /></IconBtn>
        <IconBtn label="Redo (Ctrl+Shift+Z)" onClick={editor.redo} disabled={!editor.canRedo}><Redo2 size={16} /></IconBtn>
      </Group>
      <button onClick={onSnap} aria-pressed={snapOn} title="Snap positions to a 10 cm grid" className={"flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13.5px] font-medium shadow-pop backdrop-blur transition " + (snapOn ? "bg-brand text-white" : "bg-surface/95 text-ink hover:bg-surface")}>
        <Magnet size={15} /> Snap {snapOn ? "10 cm" : "off"}
      </button>
      <button onClick={onPalette} aria-pressed={paletteOpen} className={"flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13.5px] font-medium shadow-pop backdrop-blur transition " + (paletteOpen ? "bg-brand text-white" : "bg-surface/95 text-ink hover:bg-surface")}>
        <Shapes size={15} /> Add furniture
      </button>
      <button onClick={editor.reset} disabled={!editor.changed} className="flex items-center gap-2 rounded-xl bg-surface/95 px-3.5 py-2 text-[13.5px] font-medium text-ink shadow-pop backdrop-blur transition hover:bg-surface disabled:opacity-40">
        <RefreshCcw size={15} /> Reset
      </button>
    </div>
  );
}

const Group = ({ children }: { children: React.ReactNode }) => <div className="flex overflow-hidden rounded-xl bg-surface/95 shadow-pop backdrop-blur">{children}</div>;

function IconBtn({ children, label, ...rest }: { children: React.ReactNode; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button aria-label={label} title={label} {...rest} className="flex h-9 w-10 items-center justify-center text-ink-2 transition hover:bg-canvas hover:text-ink disabled:opacity-35">
      {children}
    </button>
  );
}

/** Catalogue drawer: click a piece to drop it in front of you. */
export function Palette({ catalog, onAdd, onClose }: { catalog: Catalog; onAdd: (id: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState<CatalogCategory>("workstation");
  const items = useMemo(() => catalog.items.filter((i) => i.category === cat), [catalog, cat]);
  const present = useMemo(() => CATEGORY_ORDER.filter((c) => catalog.items.some((i) => i.category === c)), [catalog]);
  return (
    <div className="pointer-events-auto w-[300px] overflow-hidden rounded-2xl bg-surface/97 shadow-pop backdrop-blur">
      <div className="flex items-center justify-between px-4 pt-3.5">
        <div className="text-[14px] font-semibold text-ink">Add furniture</div>
        <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-canvas"><X size={16} /></button>
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        {present.map((c) => (
          <button key={c} onClick={() => setCat(c)} className={"rounded-full px-2.5 py-1 text-[12px] font-medium transition " + (cat === c ? "bg-brand text-white" : "bg-canvas text-ink-2 hover:text-ink")}>
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <ul className="max-h-[42vh] space-y-1.5 overflow-y-auto p-3">
        {items.map((i) => (
          <li key={i.id}>
            <button onClick={() => onAdd(i.id)} className="flex w-full items-center justify-between rounded-xl border border-line-2 bg-paper px-3 py-2.5 text-left transition hover:border-brand hover:bg-brand-soft/50">
              <span>
                <span className="block text-[13.5px] font-medium text-ink">{i.name}</span>
                <span className="block text-[12px] text-muted">{i.footprint.width.toFixed(1)} × {i.footprint.depth.toFixed(1)} m</span>
              </span>
              <Plus size={16} className="text-brand" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ISSUE_TEXT: Record<PlacementIssue, string> = {
  outside: "Sticks outside the building",
  wall: "Overlaps a wall, core or column",
  item: "Overlaps other furniture",
};

/** Details and controls for the selected piece. */
export function Inspector({ editor, catalog, issues }: { editor: LayoutEditor; catalog: Catalog; issues: PlacementIssue[] }) {
  const d = editor.draft;
  const item = d ? catalog.items.find((i) => i.id === d.itemId) : null;
  if (!d || !item) return null;
  const k = d.scale ?? 1;
  const nudge = (dx: number, dy: number) => editor.apply((p) => ({ position: [Math.round((p.position[0] + dx) * 100) / 100, Math.round((p.position[1] + dy) * 100) / 100] }));
  return (
    <div className="pointer-events-auto w-[268px] rounded-2xl bg-surface/97 p-4 shadow-pop backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[14.5px] font-semibold leading-tight text-ink">{item.name}</div>
          <div className="mt-0.5 text-[12px] text-muted">{(item.footprint.width * k).toFixed(2)} × {(item.footprint.depth * k).toFixed(2)} × {(item.height * k).toFixed(2)} m</div>
        </div>
        <button onClick={() => editor.select(null)} aria-label="Deselect" className="rounded-lg p-1 text-muted hover:bg-canvas"><X size={16} /></button>
      </div>

      {issues.length > 0 && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-[12.5px] leading-snug text-danger">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>{issues.map((i) => ISSUE_TEXT[i]).join(" · ")}</span>
        </div>
      )}

      <Section label="Move" hint="or drag it">
        <div className="grid w-[112px] grid-cols-3 gap-1">
          <span />
          <Key label="North 10 cm" onClick={() => nudge(0, 0.1)}><ArrowUp size={14} /></Key>
          <span />
          <Key label="West 10 cm" onClick={() => nudge(-0.1, 0)}><ArrowLeft size={14} /></Key>
          <span className="flex items-center justify-center text-[10px] text-muted">10 cm</span>
          <Key label="East 10 cm" onClick={() => nudge(0.1, 0)}><ArrowRight size={14} /></Key>
          <span />
          <Key label="South 10 cm" onClick={() => nudge(0, -0.1)}><ArrowDown size={14} /></Key>
          <span />
        </div>
      </Section>

      <Section label="Rotate" hint={`${Math.round(d.rotationDeg)}°   ·  R or wheel`}>
        <div className="flex gap-1">
          <Key wide label="Rotate left 90°" onClick={() => editor.apply((p) => ({ rotationDeg: normDeg(p.rotationDeg + 90) }))}><RotateCcw size={14} /> 90°</Key>
          <Key wide label="Rotate left 15°" onClick={() => editor.apply((p) => ({ rotationDeg: normDeg(p.rotationDeg + 15) }))}><RotateCcw size={14} /> 15°</Key>
          <Key wide label="Rotate right 15°" onClick={() => editor.apply((p) => ({ rotationDeg: normDeg(p.rotationDeg - 15) }))}>15° <RotateCw size={14} /></Key>
          <Key wide label="Rotate right 90°" onClick={() => editor.apply((p) => ({ rotationDeg: normDeg(p.rotationDeg - 90) }))}>90° <RotateCw size={14} /></Key>
        </div>
      </Section>

      <Section label="Size" hint={`${Math.round(k * 100)}%   ·  [ ]`}>
        <div className="flex items-center gap-2">
          <Key label="Smaller" onClick={() => editor.apply((p) => ({ scale: clampScale((p.scale ?? 1) - 0.05) }))}><Minus size={14} /></Key>
          <input
            type="range"
            min={MIN_SCALE * 100}
            max={MAX_SCALE * 100}
            step={5}
            value={Math.round(k * 100)}
            onChange={(e) => editor.drag({ scale: clampScale(Number(e.target.value) / 100) })}
            onPointerUp={editor.commit}
            onKeyUp={editor.commit}
            className="h-1.5 flex-1 accent-[#0f6b5c]"
            aria-label="Size"
          />
          <Key label="Larger" onClick={() => editor.apply((p) => ({ scale: clampScale((p.scale ?? 1) + 0.05) }))}><Plus size={14} /></Key>
        </div>
      </Section>

      <div className="mt-3.5 flex gap-2 border-t border-line-2 pt-3">
        <button onClick={editor.duplicate} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-canvas px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-line-2"><Copy size={14} /> Duplicate</button>
        <button onClick={editor.remove} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger transition hover:brightness-95"><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-3.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">{label}</span>
        {hint && <span className="whitespace-pre text-[11.5px] text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Key({ children, label, wide, ...rest }: { children: React.ReactNode; label: string; wide?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button aria-label={label} title={label} {...rest} className={"flex h-8 items-center justify-center gap-1 rounded-lg bg-canvas text-[12px] font-medium text-ink-2 transition hover:bg-brand-soft hover:text-brand-600 " + (wide ? "flex-1 px-1" : "w-8")}>
      {children}
    </button>
  );
}
