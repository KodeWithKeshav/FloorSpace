import { useCallback, useMemo, useRef, useState } from "react";
import type { Catalog, Layout, Placement } from "../../../shared/types";
import { clampScale, newPlacementId, normDeg } from "../../../shared/edit";

export interface LayoutEditor {
  placements: Placement[];
  selectedId: string | null;
  /** Live copy of the selected piece; differs from `placements` only while it is being dragged. */
  draft: Placement | null;
  canUndo: boolean;
  canRedo: boolean;
  changed: boolean;
  select: (id: string | null) => void;
  /** Change the draft without recording history (used continuously while dragging). */
  drag: (patch: Partial<Placement>) => void;
  /** Record the draft as a finished edit. */
  commit: () => void;
  /** Change the selected piece and record it at once (buttons, keys). */
  apply: (patch: (p: Placement) => Partial<Placement>) => void;
  remove: () => void;
  duplicate: () => void;
  add: (itemId: string, x: number, y: number, facingDeg: number) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

/** Undoable edits to a layout's furniture: move, rotate, resize, duplicate, delete, add. */
export function useLayoutEditor(initial: Layout, catalog: Catalog): LayoutEditor {
  const original = useRef(initial.placements);
  const [placements, setPlacements] = useState<Placement[]>(initial.placements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Placement | null>(null);
  const past = useRef<Placement[][]>([]);
  const future = useRef<Placement[][]>([]);
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);

  const push = useCallback((prev: Placement[]) => {
    past.current.push(prev);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
  }, []);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setDraft(id ? (placements.find((p) => p.id === id) ?? null) : null);
    },
    [placements],
  );

  const drag = useCallback((patch: Partial<Placement>) => setDraft((d) => (d ? { ...d, ...patch } : d)), []);

  const commit = useCallback(() => {
    if (!draft) return;
    const current = placements.find((p) => p.id === draft.id);
    if (current && current.position[0] === draft.position[0] && current.position[1] === draft.position[1] && current.rotationDeg === draft.rotationDeg && (current.scale ?? 1) === (draft.scale ?? 1)) return;
    push(placements);
    setPlacements(placements.map((p) => (p.id === draft.id ? draft : p)));
    refresh();
  }, [draft, placements, push]);

  const apply = useCallback(
    (fn: (p: Placement) => Partial<Placement>) => {
      if (!draft) return;
      const next = { ...draft, ...fn(draft) };
      push(placements);
      setPlacements(placements.map((p) => (p.id === next.id ? next : p)));
      setDraft(next);
      refresh();
    },
    [draft, placements, push],
  );

  const remove = useCallback(() => {
    if (!selectedId) return;
    push(placements);
    setPlacements(placements.filter((p) => p.id !== selectedId));
    setSelectedId(null);
    setDraft(null);
    refresh();
  }, [selectedId, placements, push]);

  const duplicate = useCallback(() => {
    if (!draft) return;
    const copy: Placement = { ...draft, id: newPlacementId(), position: [draft.position[0] + 0.6, draft.position[1] - 0.6] };
    push(placements);
    setPlacements([...placements, copy]);
    setSelectedId(copy.id);
    setDraft(copy);
    refresh();
  }, [draft, placements, push]);

  const add = useCallback(
    (itemId: string, x: number, y: number, facingDeg: number) => {
      if (!catalog.items.some((i) => i.id === itemId)) return;
      const p: Placement = { id: newPlacementId(), itemId, zoneId: "edited", position: [Math.round(x * 100) / 100, Math.round(y * 100) / 100], rotationDeg: normDeg(facingDeg), scale: 1 };
      push(placements);
      setPlacements([...placements, p]);
      setSelectedId(p.id);
      setDraft(p);
      refresh();
    },
    [catalog, placements, push],
  );

  const restore = useCallback(
    (next: Placement[]) => {
      setPlacements(next);
      const keep = selectedId ? next.find((p) => p.id === selectedId) : null;
      setSelectedId(keep ? keep.id : null);
      setDraft(keep ?? null);
      refresh();
    },
    [selectedId],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(placements);
    restore(prev);
  }, [placements, restore]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(placements);
    restore(next);
  }, [placements, restore]);

  const reset = useCallback(() => {
    push(placements);
    setPlacements(original.current);
    setSelectedId(null);
    setDraft(null);
    refresh();
  }, [placements, push]);

  return useMemo(
    () => ({
      placements, selectedId, draft,
      canUndo: past.current.length > 0, canRedo: future.current.length > 0,
      changed: placements !== original.current,
      select, drag, commit, apply, remove, duplicate, add, undo, redo, reset,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placements, selectedId, draft, select, drag, commit, apply, remove, duplicate, add, undo, redo, reset],
  );
}

export { clampScale, normDeg };
