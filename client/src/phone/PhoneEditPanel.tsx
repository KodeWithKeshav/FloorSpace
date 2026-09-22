import { Copy, Hand, Magnet, Minus, Plus, Redo2, RotateCcw, RotateCw, Shapes, Trash2, TriangleAlert, Undo2, X } from "lucide-react";
import type { Catalog } from "../../../shared/types";
import { clampScale, normDeg } from "../../../shared/edit";
import type { PlacementIssue } from "../../../shared/edit";
import type { LayoutEditor } from "../walk/useLayoutEditor";
import { Palette } from "../walk/EditPanel";

const ISSUE_TEXT: Record<PlacementIssue, string> = {
  outside: "Sticks outside the building",
  wall: "Overlaps a wall, core or column",
  item: "Overlaps other furniture",
};

interface Props {
  editor: LayoutEditor;
  catalog: Catalog;
  hoverId: string | null;
  holding: boolean;
  issues: PlacementIssue[];
  snapOn: boolean;
  paletteOpen: boolean;
  onGrab: () => void;
  onSnap: () => void;
  onPalette: () => void;
  onAdd: (itemId: string) => void;
}

/** The phone's edit controls. Big touch targets; the crosshair in the middle of the screen is the pointer. */
export default function PhoneEditPanel({ editor, catalog, hoverId, holding, issues, snapOn, paletteOpen, onGrab, onSnap, onPalette, onAdd }: Props) {
  const nameOf = (id: string | null) => {
    const p = id ? editor.placements.find((x) => x.id === id) : null;
    return p ? (catalog.items.find((i) => i.id === p.itemId)?.name ?? null) : null;
  };
  const d = editor.draft;
  const selName = d ? (catalog.items.find((i) => i.id === d.itemId)?.name ?? "") : "";
  const hoverName = nameOf(hoverId);
  const k = d?.scale ?? 1;

  const status = holding
    ? `Carrying ${selName}: look where it should go, then put it down`
    : hoverName
      ? `Aiming at ${hoverName}`
      : d
        ? `Selected: ${selName}`
        : "Point the + at a piece of furniture";

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-[9.5rem] flex flex-col items-center gap-2 px-3">
      {paletteOpen && (
        <div className="max-w-full">
          <Palette catalog={catalog} onAdd={onAdd} onClose={onPalette} />
        </div>
      )}
      <div className="w-full max-w-[460px] rounded-2xl bg-black/65 p-2.5 text-white shadow-pop backdrop-blur">
        <div className="flex items-center gap-1.5 px-1 pb-2 text-[12.5px] leading-tight">
          {issues.length > 0 && !holding ? (
            <>
              <TriangleAlert size={14} className="shrink-0 text-[#ff9b9b]" />
              <span className="text-[#ffb4b4]">{issues.map((i) => ISSUE_TEXT[i]).join(" · ")}</span>
            </>
          ) : (
            <span className="text-white/85">{status}</span>
          )}
          {holding && issues.length > 0 && <TriangleAlert size={14} className="ml-auto shrink-0 text-[#ff9b9b]" />}
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={onGrab} disabled={!holding && !hoverId && !d} className={"flex h-11 min-w-[7.6rem] flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl text-[14px] font-semibold transition active:scale-[0.98] disabled:opacity-40 " + (holding ? "bg-white text-black" : "bg-brand text-white")}>
            <Hand size={17} /> {holding ? "Put down" : "Pick up"}
          </button>
          <Btn label="Add furniture" on={paletteOpen} onClick={onPalette}><Shapes size={17} /></Btn>
          <Btn label="Undo" onClick={editor.undo} disabled={!editor.canUndo}><Undo2 size={17} /></Btn>
          <Btn label="Redo" onClick={editor.redo} disabled={!editor.canRedo}><Redo2 size={17} /></Btn>
          <Btn label={snapOn ? "Snap 10 cm on" : "Snap off"} on={snapOn} onClick={onSnap}><Magnet size={17} /></Btn>
        </div>

        {d && !holding && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <Btn label="Rotate left 90°" onClick={() => editor.apply((p) => ({ rotationDeg: normDeg(p.rotationDeg + 90) }))}><RotateCcw size={16} /><small className="text-[10px]">90</small></Btn>
            <Btn label="Rotate left 15°" onClick={() => editor.apply((p) => ({ rotationDeg: normDeg(p.rotationDeg + 15) }))}><RotateCcw size={16} /><small className="text-[10px]">15</small></Btn>
            <Btn label="Rotate right 15°" onClick={() => editor.apply((p) => ({ rotationDeg: normDeg(p.rotationDeg - 15) }))}><RotateCw size={16} /><small className="text-[10px]">15</small></Btn>
            <Btn label="Rotate right 90°" onClick={() => editor.apply((p) => ({ rotationDeg: normDeg(p.rotationDeg - 90) }))}><RotateCw size={16} /><small className="text-[10px]">90</small></Btn>
            <span className="mx-0.5 h-6 w-px bg-white/25" />
            <Btn label="Smaller" onClick={() => editor.apply((p) => ({ scale: clampScale((p.scale ?? 1) - 0.05) }))}><Minus size={16} /></Btn>
            <span className="w-9 text-center text-[11px] tabular-nums text-white/80">{Math.round(k * 100)}%</span>
            <Btn label="Larger" onClick={() => editor.apply((p) => ({ scale: clampScale((p.scale ?? 1) + 0.05) }))}><Plus size={16} /></Btn>
          </div>
        )}
        {d && !holding && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <button onClick={editor.duplicate} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/15 text-[13px] font-medium active:bg-white/25"><Copy size={15} /> Duplicate</button>
            <button onClick={editor.remove} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#d64545]/85 text-[13px] font-medium active:brightness-90"><Trash2 size={15} /> Delete</button>
            <Btn label="Deselect" onClick={() => editor.select(null)}><X size={16} /></Btn>
          </div>
        )}
      </div>
    </div>
  );
}

function Btn({ children, label, on, ...rest }: { children: React.ReactNode; label: string; on?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button aria-label={label} title={label} {...rest} className={"flex h-11 min-w-[2.6rem] flex-1 items-center justify-center gap-0.5 rounded-xl transition active:scale-[0.97] disabled:opacity-35 " + (on ? "bg-white text-black" : "bg-white/15 text-white active:bg-white/25")}>
      {children}
    </button>
  );
}
