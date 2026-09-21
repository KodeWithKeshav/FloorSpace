# SpacePlanner Web

Floor plan in, furnished layout out, then walk through it in first person, in the browser or in Godot.

1. **Floor plan**: pick a sample or upload a bare-shell plan (JSON). Geometry is validated with readable errors.
2. **Requirements**: rooms and seats. A live check tells you if the brief fits *before* anything is generated, and what would fit if it doesn't.
3. **Layout**: a furnished 2D plan with the area **occupied vs free**, per-zone breakdown, seats and floor-per-seat.
4. **Walkthrough**: first-person 3D at real scale (eye height 1.65 m, 1.4 m/s) with collision, minimap, room teleport and a bird's-eye view.
5. **Edit mode**: switch the walkthrough to *Edit* and reorganise the layout from inside it. Click furniture to select, drag to move, `R` or the wheel to rotate, `[` `]` to resize (50–200%), `Ctrl+D` to duplicate, `Del` to remove, `Ctrl+Z` to undo. **Add furniture** drops any catalogue piece in front of you. Pieces that leave the building or overlap walls or other furniture turn red. Edits carry through to the layout screen and to the Godot export.
6. **Godot**: one click builds a complete Godot 4 project of the layout, with a first-person player (a VR rig is included but switched off).

## Run

```bash
npm install
npm run dev        # API on :3001, web on http://localhost:5173
```

No API keys are needed. Everything runs offline with the built-in rule-based engine.

| Command | What it does |
| --- | --- |
| `npm test` | 39 tests: geometry, validation, no overlaps, door clearance, walkability, schema round-trip, feasibility |
| `npm run check:walk` | Walks the exact collision geometry from the entrance to prove every room is reachable |
| `npm run catalog` | Re-measures the models in `public/assets/models` and rewrites `data/catalog.json` |
| `npm run typecheck` | Type-checks server and client |
| `npm run build` / `npm start` | Production build, served by the API on :3001 |

Deep link for demos: `http://localhost:5173/#sample=large-open-floor&step=walk&tp=2` (steps: `requirements`, `result`, `walk`; `tp` = teleport stop; `view=top` for the bird's-eye view).

## How a layout is made

The model never invents coordinates. Geometry is deterministic:

1. **Grid**: the floor is rasterised into 0.25 m cells; everything snaps to it, so nothing lands at a fractional overlap.
2. **Corridors first**: a main corridor from the entry, a cross corridor on big floors, and a clear approach in front of every door.
3. **Rooms**: reception, meeting rooms, cabins, booths, storage, pantry, cafeteria and lounge are scored against walls, windows, cores and the entry (`preference` in the brief) and packed as rectangles with partitions and a door. A room is only accepted if everything already placed stays reachable on foot.
4. **Desks**: back-to-back pods (4, 6, 8 or 10 desks) fill the rest, then single desk rows along walls.
5. **Validation gate**: zones may not overlap or leave the outline, items stay inside their zone, doors keep their approach, and every room must be reachable from the entrance. Anything that fails is removed and reported, never rendered.

Area accounting: **occupied** = cores and columns + every room and zone footprint. **Free** = the rest, split into corridors/aisles/door clearances and unassigned floor. Furniture footprint is reported separately.

## The 3D assets

`public/assets/models` holds the subset of your Unity models that had a clear orientation and sensible file size. `data/catalog.json` records, per model, its measured size, the **scale correction** that brings it to real-world metres (several raw models were in centimetres or wildly off, and are flagged), the rotation that makes its front face +Z, and its footprint. Models that were skipped: `Cubicle_3` (100 MB), `Sofa_5`, `CEO_Office`, `Booth_1`, `foosball_1`, `Conf_desk_2` (40 MB+ or spec-gloss materials), the prefab rooms `Cabin_1` and `Meeting_Room_1` (they carry their own walls and roofs), and the other cubicles, whose open side is ambiguous. Rooms are built from partitions instead so doors and orientation are always right.

## Godot

`Enter 3D` is the quick look in the browser. For a standalone first-person app, the **Explore it in Godot** card on the layout screen:

- **Open in Godot on this computer** imports the models and opens the project in the editor (Godot is found at `/Applications/Godot.app`, or set `GODOT_PATH` in `.env`).
- **Download project (.zip)** gives the same project to open anywhere with Godot 4.3+.

In the project press **F5**. Desktop: click, WASD, Shift, `1`-`9`/Tab to jump between rooms, `B` for the bird's-eye view. A VR rig is included but switched off; to use it later, enable `xr/openxr/enabled` in Godot's Project Settings.

## Layout

| Path | What |
| --- | --- |
| `schemas/` | JSON Schemas: floor plan, requirements, layout |
| `data/samples/` | Four floor plans, a suggested brief for each, `catalog.json` in `data/` |
| `shared/` | Types, geometry, the 3D scene description and collision, used by server, client and the Godot export |
| `server/` | Express API, pipeline (`pipeline/`), Godot exporter (`godot/`) |
| `client/` | React + Vite + Tailwind + three.js |
| `tests/`, `scripts/` | Test suite, catalog builder, walkability check |
