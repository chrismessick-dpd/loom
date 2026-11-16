# Formboard: routing a system's harnesses over a drawing or a model (2026-11-15)

Chris's idea: a new tab in Loom that takes a whole system, drops its blocks as squares (2D) or boxes
(3D) onto a canvas with a reference (a DXF or PNG for 2D, a STEP for 3D) that sets the real scale, lets
the blocks be dragged or snapped into place, lets routing channels be drawn with parameters (high
voltage, drag chain, and so on), and then auto-routes every unpinned connection through the channels its
constraints allow, shortest first, giving each one a length. The canvas is PL's Exploded view: one main
view, with Four views as an option.

This note checks how sound that is, what in the suite it can reuse, how other tools do it, and what to
simplify; Chris's decisions follow each part. What's built is in *Built* below.

## Built (2026-11-15, Chris: "start all steps")

A third tab on a system, **Formboard**, beside System and List. Files:

| File | What |
| --- | --- |
| `assets/fbroute.js` (`LM.fbroute`) | The router, pure: `build(channels)` (the network, junctions derived), `route`, `routeAll` (with fill), `buildLength`. Tested by `tests/fbroute-cases.js`, which runs in Node (`node tests/fbroute-cases.js`) and in `tests/test.html`; the cases include Chris's cube. |
| `assets/stage.js` (`LM.stage`) | The 3D stage: one view or Four views (Top, 3D, Front, Right), per-view cameras, Link views, drag in a plane, orbit, pan, zoom, R to turn 90°, and feature snapping (PL's `featureAt`). Driven by a host; it knows nothing of Loom. |
| `assets/formboard.js` (`LM.formboard`) | The tab: its documents, the reference (STEP, DXF, PNG or JPEG), blocks, channels, Route, Apply lengths, Save to base part, the panel, and the demo. |
| `assets/vendor/model3d.js` | Signoff PL's renderer, STEP reader, and snapping, vendored by `tools/sync_vendor.py`. |
| `assets/system.js` | `flatten(rootId, keep)` and `setLengths(list)`; the tab hands the page to the formboard. |
| `assets/app.js` | The tab button, the formboard's own Undo and Redo in the toolbar, and `editHarness` for Save to base part. |

- **Order changed from *Suggested order*:** the stage is a new file in Loom built from PL's Exploded code,
  not lifted out of PL first (rewriting PL's Exploded while Chris arranges real data in it was the riskier
  path). PL can move onto `stage.js` later as its own step.
- **The reference** is read in the browser and kept in IndexedDB (`loom-fbref`) by its hash; the document
  names it. A STEP becomes a simplified mesh (80k triangles at most). A picture or DXF is drawn onto a thin
  plane at z = 0; a DXF's `$INSUNITS` sets its scale (unset: mm, flagged), and **Calibrate** (two clicks,
  the real distance) scales a picture or DXF. DXF blocks (`INSERT`), splines, and ellipses aren't read yet.
- **Blocks** are boxes (boards 1.6 mm thick, devices 20 mm, kept systems 30 mm, device ends 10 mm) at their
  start spots, faded until moved; moved, `blocks[path] = { at, rot }`. Drag in any flat view, or in 3D once
  selected; X, Y, and Z fields; Turn 90° about Z, X, or Y (or R); **Snap block** is PL's two-step align
  (corners, edges, hole axes, flat faces). *Keep <system> as one block* and *Open into its boards and
  devices* set `keep`.
- **Channels:** Draw channel clicks point to point (snapping to the model, standing off its face by half
  the height; joining an existing channel's point within 8 px), double-click or Enter to finish. Selected,
  its points drag, a double-click on a run adds a point, and the panel has Name, Width, Height, Classes,
  Exclusive, Extra mm per meter, and each run's length (typing one moves the points after it).
- **Entering the network:** each end drops to its nearest allowed channel. When the nearest channels at
  the two ends don't connect (a stub that joins nothing), pairs of entry channels are tried in order of
  their two drops together (six at each end at most), so a far drop is taken only when nothing nearer
  connects.
- **Route** routes every unpinned cable and stores each route (legs, points, lengths, and the breakdown)
  with a key of its end points, so a route whose ends have moved since is drawn dashed and marked. Routes
  are drawn over the views; Not routed is dashed and labeled.
- **Apply lengths** and **Save to base part** as decided under *Lengths*, each one undo step in the
  formboard's own history (which puts the system's or harness's values back).
- **The demo** (`?demo`, the thermostat system): a made-up bracket (built in, no file; `bracketMesh`), one closed
  L-shaped solid: a 300 × 200 × 10 mm base and a 10 mm wall at its back, 150 mm tall (Chris, 2026-11-15, after the
  first wall plate). Each flat face is its own face id, so it snaps as a STEP would. The boards sit on the base, with a
  Low voltage channel and an exclusive 24 VAC raceway, and the wall wiring tagged 24 VAC.
- **STL snapping (2026-11-15, Chris: channel points didn't snap to edges and corners on his STL).** An STL has no CAD
  faces, so `readStl` gives every triangle face id 0, and `model3d.features` read the whole model as one face with no
  edges. `stage.js` `featsOf` now reads a mesh whose triangles all share one face id as facets (neighbors under 30°
  join, sharper creases are edges), with no change to stored files. While drawing a channel, the corner or edge a
  click would snap to is drawn and named by the pointer (or *Join channel*).
  Then (Chris: the point dropped off the highlight, and the rubber band didn't follow it): a channel point goes exactly
  on the highlighted corner, edge, or face (it used to stand off half the section's height along the face normal, or
  straight up), and a corner or edge counts only where nothing is in front of it, the part itself included (a corner
  behind its own wall was picked in the Top view); of two that line up on screen, the nearer wins.
- **Glass channels (2026-11-15, Chris: the solid channels hid the model and the cables; translucent, wireframe).**
  Channels are no longer rasterized (model3d has no transparency; they're `hidden` scene objects, so not in Fit
  either). `drawGlass` draws each run's box in the overlay under the cables: sides filled at 8% of the class color
  (untagged: steel blue), edges solid where nothing is in front of them and faint and dashed where the model or a
  block is (sampled against the view's depth buffer), hovered and selected ones stronger, the selected one in the
  accent. `overHit` picks a channel for the stage (`host.overHit` in `stage.js` `info`): inside a run's outline and not
  buried. A cable's line under the pointer wins over the channel it runs in.
- **Dragging a channel's point snaps (2026-11-15, Chris)** as drawing does: another channel's point (not its own),
  else the corner, edge, or face highlighted and named by the pointer, else the view's plane at the point's height.
- **A formboard per system (2026-11-15, Chris: view the whole system and its formboards, or a lower system and its
  own).** The Formboard tab follows the system picked, as List does (`listSys`: a system picked in the menu or the
  breadcrumb, or the system holding a picked harness; the open system when nothing is picked), and a pick keeps the
  tab (`setFocus`). Each system has its own formboards (`f.system`), any number. A formboard imports only its own
  system: `flatten` walks that system down (placed systems opened inside it, unless kept as one block), so cables
  plugged into it from the systems above stay out. Only the demo's own system gets the made-up bracket.

- **Sync (2026-11-15, Chris: "Build sync next").** `store.js` `syncFormboards` runs after the systems in every
  sync (on opening signed in, the Sync button, Ctrl+S). Each formboard is `loom_data/formboards/projects/<id>.json`
  (envelope `{ schema, id, meta, summary, formboard }`; the summary is counts only), merged as systems are:
  edited means its stamp moved off its own `syncBase`, an unedited copy takes GitHub's and writes nothing,
  edited on both sides keeps the newer and a "(conflict copy)" of the other. Demo formboards never sync.
  Its reference goes up first, once, in its own commit: `formboards/refs/<hash>.plm.gz` (a STEP's simplified
  mesh), `.dxf`, or `.png`/`.jpg`/`.webp`, split into `.001`, `.002`, … over 4 MB; the reference records `file`,
  `parts`, `sha256`, and `bytes`. A reference that isn't in this browser to upload fails the formboard sync, so
  a document never names a missing file. Another browser reads it back when it first draws the formboard
  (`readFormboardRef`, joined and checked against its SHA-256) and keeps it in IndexedDB. The sync pill counts
  unsynced formboards. Tests: 4 against the fake GitHub (paths, upload and read-back, parts, a missing
  reference, conflict copy and an unedited stale copy). Not tried signed in: the first real sync creates
  `formboards/` in `loom_data`.

- **Reference size (measured 2026-11-15, Chris: a 53 MB machine assembly loaded nothing).** A STEP is read in
  the browser by OpenCascade (occt-import-js 0.0.23, PL's mesh settings), in a worker: a 1.9 MB part took 1.9 s,
  a 5.8 MB part 1.3 s, an 11 MB board assembly 21 s, a 23 MB assembly 62 s, and the 53 MB assembly (2,468 parts)
  about 4 minutes, after which every part came back with no geometry at all (coarser meshing didn't help; the
  time goes into reading). So: **about 25 MB of STEP is the practical limit.** Over 25 MB Formboard asks first and
  suggests an STL; a STEP whose parts come back empty says so instead of loading nothing. **STL** (binary or
  ASCII, read as mm) needs no CAD kernel: a 9.5 MB, 200,000-triangle STL imports in 2.4 s. Every 3D reference is
  simplified to 80,000 triangles at most. Only one reference is read at a time in a tab; the bar shows the
  seconds so far.

**Not built yet:**
- Dragging a channel's side edge to change its width (the Width field does it), PL's turn ring (R and the
  Turn buttons do it), a linked library part's size for a device end, fill kept after a reload, and caching
  the reference's picture between camera moves (drawing speed with a machine-sized STEP is unmeasured).
- **Measured (2026-11-15):** the made-up 30-board, 60-cable system (`tests/fixture-system.js`) flattens in
  under 1 ms and routes through a 13-channel grid (42 junctions) in 9 ms, all 60 routed.
- **A route goes stale** (dashed, *Route again*, skipped by Apply) when its ends move, or when the channels,
  classes, settings, or the cable's own classes, vias, or end allowances change after it was routed.
- **Apply lengths and Save to base part edit real systems and harnesses** (they sync on the next sync);
  their undo is the formboard's history in this page only, gone after a reload. Persisting it is a follow-up.

## Verdict

Sound, and worth building. Every decision below was settled with Chris on 2026-11-15. The suite already has most of the expensive parts: a 3D renderer with STEP
import and feature snapping (PL), real board sizes and connector positions (Loom systems, from Fabcheck's
pick-and-place), a DXF reader (Partcheck), and a document with blocks, connectors, and cables (the Loom
system). The router itself is the cheapest part, as long as channels become a graph (below), not a
volume to search.

Three things need changing or deciding before it's built:
1. **Channels should become a graph of centerlines.** (Decided: they're drawn as polylines.)
2. **"No Constraints = point to point" needed pinning down.** Read literally, an unconstrained cable in
   the cube picture cuts straight through the solid. (Decided: see *Constraints*.)
3. **PL's Exploded UI isn't reusable as it stands.** Its renderer is; its four-view stage has to be
   lifted out of PL's `app.js` first, the way History was made one engine.

## How other tools do it

Harness tools that route in 2D or 3D (the big electrical CAD suites, the routing add-ins of the
mechanical CAD packages, and the harness tools built around a 2D layout) mostly share one approach:
- **A routing network.** The designer lays out a network of bundle segments (centerlines with a
  diameter) and junction points, in 2D or in the 3D model, and wires are routed along it by shortest
  path. The volume around a segment is drawn, not searched.
- **Separation classes.** Segments and wires carry classes (power, signal, high voltage, and so on);
  a wire may only use segments that accept its class. This is Chris's green and yellow.
- **Fill.** Each segment's bundle diameter is computed from the wires in it and checked against the
  segment's size (a fill ratio), as a check or as a limit.
- **Allowances.** Lengths get termination allowances and a slack or service-loop percentage on top of
  the path length.
- **Flattening.** The routed 3D harness is then flattened into a 1:1 build drawing, the
  **formboard** (nail board) the harness is built on, with the routed segment lengths.

So the industry word "formboard" means the 1:1 build board that comes *after* routing. What's described
here is the routing step (often called harness routing or installation). Chris kept the name (*Decisions*, 5); the flatten-to-1:1 output will earn it outright, since Loom's
harness drawing already holds segments with lengths.

## What can be reused

| Piece | Where | Reuse |
| --- | --- | --- |
| Software 3D renderer, pick buffer, `project`/`point`, slab with texture, orbit | `signoff_pl/assets/model3d.js` | As is (vendor into Loom, as Partcheck's `me-send` does) |
| STEP → simplified, gzipped mesh (`prepare`, `simplify`, `encode`) | `model3d.js` + an `occt-worker.js` (Loom has its own) | As is |
| Feature snapping: corners, edges, hole axes, flat faces (`features`, `alignMove`) | `model3d.js` | As is; the blocks are boxes, so they snap face to face |
| Four views, per-view cameras, Link views, flat-view drag, turn ring, snap hover, back and forward | PL `app.js`, about lines 1009–1700 | **Not as is.** It reads `current()`, `P.tree`, `p.nodes[id].place`, `ui.cam`, `ui.flatCams`, `placeStep`, and `touch` directly. Lift it into a shared `stage.js` with an adapter (objects, read and write a place, history), PL first with its tests unchanged, then vendor into Loom: the History-engine pattern. Roughly 700 lines plus its CSS; the biggest single job here |
| Blocks with real sizes, connectors at their pick-and-place spots (`conns[].x, y, side`) | Loom system document | As is: route from each **connector**, not the block's middle |
| Board pictures (Fabcheck renders) on a slab | Loom `boards.js`, PL's board slabs | As is: a board block can be a textured slab, as in PL |
| DXF lines, arcs, circles, polylines | `partcheck/assets/drawing.js` `readDxf` | Needs work: it reads only ENTITIES (no HEADER, so no `$INSUNITS`), skips layers named like text or notes, and has no blocks (`INSERT`), splines, or ellipses, which machine layouts use a lot |
| History, version tags, comparison | `history.js` engine | Free, if the formboard lives in a document Loom already syncs |
| Large file storage | PL's `models/` (gzipped mesh), `GitHubStore.splitParts` for files over 4 MB | As is, for a machine-sized reference model |
| Segments with lengths, breakouts, and coverings | Loom harness model (`h.segments`; the old 2D formboard view, `render.js`, was removed 2026-11-06 but the model kept them "so a Layout view can come back") | Where routed lengths and branch points land in a harness, and what a 1:1 board would draw |
| Length override as a variant PN `<harness PN>-<mm>` | `docs/system.md`, *Decisions* | The place routed lengths would land (see *Lengths*) |
| `connect.js` router | Loom | **Not reused.** It's a 2D grid search around rectangles, built for drawings. Routing through channels is a graph problem, far simpler and faster |

## Simplifications and improvements

### One 3D model; 2D is a plane in it
Keep every coordinate in 3D (mm) from day one. A PNG or DXF reference is a textured plane at z = 0
(`slab` + `texture`, as PL draws a board), blocks are boxes of the block's size, and 2D mode is just the
Top view, locked. There's then no second code path for 2D: a flat formboard and a 3D install are the
same document, and a 2D layout can be lifted onto a STEP later.

### Channels are a graph
A channel is a **polyline** (its centerline) with one width and height, drawn as a rectangular section
swept along it. Where two channels touch or cross, a junction joins them. Then:
- the network has a few hundred nodes at most;
- routing one connection is Dijkstra over the edges its constraints allow, weighted by length: well
  under a millisecond each, so Route all for 150 cables is instant;
- the result is a list of segments, which is exactly what fill, lengths, and a later flatten need.

In the cube picture, the green L-shaped path down the front is one polyline, and each yellow strip
another; where they meet at the top edge, junctions join them. The shortest allowed path from 1 to 2 is
then found exactly, with no volume search.

**Decided (Chris, 2026-11-15):**
- **Polylines, not boxes.** Click point to point along the path, double-click (or Enter) to finish; Esc
  cancels. Each run between two points is straight; the channel turns at its points. Properties has
  Width, Height, and its classes and Exclusive; Length is read out (the sum of its runs) and per-run
  lengths can be typed, moving the next point along the run. On the canvas, a point drags (moving the
  corner), a side edge drags (changing Width for the whole channel), and a double-click on a run adds a
  point. This replaces the first idea's boxes with edges that drag to resize.
- **Placing in 3D: both.** A click over the model snaps to it (a face, an edge, or a corner, with PL's
  `features` and `alignMove`), and the channel stands its height off that face, like a tray on a wall
  (its section's up is the face's normal at the first snapped point). Off the model, a point is placed
  in the plane of the flat view clicked (Top, Front, or Right), or in 3D on a point already placed. In
  2D everything is on the plane, so only the Top view applies.
- **Joining is automatic.** Where two channels touch or overlap (their sections within each other's
  width), a junction is made at the nearest points of their centerlines, and the network is rebuilt
  whenever a channel changes. An end or a point snapped onto another channel makes a clean T or
  end-to-end join there. Junctions are derived, never stored, so two channels crossing apart (one
  bridging over the other, sections clear) stay separate.

### Ends join the network by a drop
A connector usually isn't on a channel. Each end joins the network by a straight drop to the nearest
point of an allowed channel, counted in the length. A drop longer than a set distance (say 300 mm) is
flagged rather than trusted.

### Constraints
First proposed: a connection starts as *No Constraints* and routes point to point; adding tags that
match a channel's parameters lets it route through that channel.

**Decided (Chris, 2026-11-15):**
- **A tag is permission.** A cable's classes let it into channels of those classes; it still takes
  the shortest allowed path, which may not use them.
- **Channels can be Exclusive** (a tick box). An exclusive channel takes only cables sharing one of its
  classes; any other channel takes every cable.
- **An untagged cable** (the default) may use every channel that isn't exclusive.
- **No allowed path:** the cable draws as a straight dashed line, is flagged **Not routed** in the
  List and Checks, and shows its straight-line length.

**Tags on the system cable (Chris, 2026-11-15).** A cable's classes are its **tags**, kept on the cable in the
system (`cab.tags`, a list of names), not in the formboard: the system drawing always shows them as pills after
the cable's label (and after a device harness's caption), even with Cable labels off, and its panel has a tag
editor (badges with ×, and a + offering every tag used in Loom). Formboard's cable panel edits the same tags
(one step of the formboard's undo, as Apply lengths). A channel's class lets a cable in when a tag has the
class's name, matched without case; renaming a class renames that tag on the formboard's cables. A tag's color
is a formboard class's of that name, else a fixed palette color. Code: `assets/tags.js` (`LM.tags`),
`LM.system.setTags`.

So a cable may use a channel when the channel isn't exclusive, or when they share a class. Tags only
make a difference on exclusive channels. In the cube example the yellow channels are exclusive: a
cable tagged yellow may take the shorter way through them, and any other cable stays in the green.

### Per cable, with a trunk for many ends
A system connection is a cable (a harness), not a wire: its wires share one path. Lengths are per cable
end-to-end; per-wire lengths differ only by where each wire terminates, which Loom's harness already
handles with segments and breakouts. A cable with three or more ends routes from its first end to each
other one, as `system.js` already does on the drawing; a true shortest branching tree (a Steiner tree)
is a later refinement.

### Pinned, and vias
Pinned keeps a cable's route through Route all. A cheaper middle ground worth adding early: **vias**,
channels a cable must pass through, which steer one cable without pinning its whole path.

### Fill, shown before it's enforced
Loom knows each wire's gauge (and mm² per AWG), so each channel segment can show its bundle diameter and
fill percentage from the cables routed through it. Enforcing a limit makes the result depend on the
order cables are routed in; show it first, enforce later (Chris already said "later").

### Lengths
**Decided (Chris, 2026-11-15):**
- **The build length** = (drop + path through the channels + drop) × (1 + slack %) + each channel's
  extra × the length run in it + each end's allowance, **rounded up to the next 10 mm**.
  - Drops (connector to the nearest allowed channel) count.
  - Slack % and the end allowance are formboard settings; an end's allowance can be changed per cable end.
  - A channel can add length per meter (a drag chain's loop, a coiled run): `extraPerM`, mm per meter.
  - The breakdown (path, drops, slack, extras, and allowances) shows in the cable's panel, so the
    number can be checked.
- **Report, then Apply.** Route shows each cable's length in the List and its panel, and writes nothing
  outside the formboard. Two explicit actions then use it:
  - **Apply lengths** (all routed cables, or one from its panel) writes the placed cable's length in
    the system (`lengthMm`). It's a variant (`<PN>-<mm>`) only where it differs from the base part's own
    length; where it equals it, the override is cleared.
  - **Save to base part** (per cable, Chris: "PN-001 is connected but has no length in Loom; the
    formboard routes it; apply that length to PN-001") writes the length into the part itself, so the
    base PN carries it and the placed cable needs no override:
    - a Loom harness: its segment between those two ends, when the run between them is one segment;
      with breakouts it waits for branch routing (the trunk's split points give each segment);
    - a purchased cable: its `length`;
    - a generic connection has no part, so only Apply lengths applies.
    The confirm lists the harness's other uses (other cables, other systems) and their lengths when
    they differ, since the base length changes for all of them: those then become variants, or match.
    It's one undoable edit to the harness, synced like any other.

### Scale
A PNG has no scale: it needs two-point calibration (click two points, type the distance). A DXF has
`$INSUNITS` in its header, which the reader must learn to read, with calibration as a fallback when it's
missing or 0. A STEP is in mm.

### Nested systems
A placed system is an abstract 150 × 150 mm block. Physical routing needs the boards and devices inside
it, at their real connectors.

**Decided (Chris, 2026-11-15):**
- **Leaves, with a choice.** Every placed system opens down to its boards and devices by default, and
  every cable at every level comes with them. Any one placed system can be kept as a single block
  (*Keep as one block* in its panel, `keep: true` under its path), for a sub-assembly that sits as one
  physical box with its inside cabling done: its size is its drawing's extent, its external connectors
  are where its tabs sit, and cables wholly inside it aren't routed.
- **Start spots as the system draws them.** Each leaf starts flat on the floor (z = 0) beside the
  reference, where its system's drawing puts it, in mm. A placed system's contents are laid at their own
  true scale, centered on where its 150 mm block sits in the parent, and pushed apart in rows where two
  such groups would overlap (the parent's blocks aren't to scale, so this is the one adjustment). These
  spots are view state, never stored: a block is stored only once you move it (`blocks[path].at`), and
  until then it's drawn faded and listed **Not placed**. Lengths of cables with an unplaced end are
  marked provisional, and Apply lengths skips them.
- **Device ends become small blocks.** A harness built onto its device (*Is its device*: a motor, a
  sensor, or flying leads) gets a small block at its far end (`<cable path>/<end id>`, about 30 mm, or a
  part's size when it's linked to one in the library) to place where the device sits, so it routes and
  gets a length like any cable.
- **Follow the system automatically.** Each time the formboard opens it reads the system: new blocks and
  device ends start Not placed, removed ones are dropped from view (their stored place stays until the
  next real edit, then goes), and a cable whose ends changed is marked for re-routing. Reading never
  writes; only a move, a channel edit, Route, or Apply does (see *Derived data and sync*).

### Derived data and sync
Routes and lengths are derived. Write them only on an explicit Route (or a drag), never while drawing:
the false conflict copies of 2026-11-14 (*Sync guards* in `loom/CLAUDE.md`) came from a drawing pass
writing derived sizes into a system and making every open tab look edited. The same holds for fitted cameras and auto-placed blocks: keep them in
view state, as PL now does.

### Speed
`model3d.js` was measured at about 30–40 ms per quick frame for PL-sized scenes. A machine-frame STEP
may be several times larger, and Four views draws it four times; that's unmeasured. Before any WebGL:
cap the reference mesh with `simplify`, and cache the reference model's color and depth for each view
while its camera holds still, drawing only the blocks, channels, and routes over it (they're a few
hundred boxes and lines). Moving a block then costs almost nothing. If that still isn't enough, three.js
is already vendored in the hub (`signoff/assets/vendor/three.min.js`).

### Possibly: start from PL's arrangement
When a product is already arranged in PL's Exploded (boards and enclosure STEPs placed), the formboard
could take PL's places and models as its starting reference instead of re-placing everything. Not needed
for a machine that has no PL project.

## Storage

**Decided (Chris, 2026-11-15): its own file**, `loom_data/formboards/projects/<id>.json` (the engine's
layout under a data path, as systems use `systems/projects/`, so PL never reads it as a harness),
naming its system. The system stays light, a system can have several formboards (a 2D layout and a 3D
one, or one per machine variant), and each gets its own History and version tags. A system's Formboard
tab lists its formboards, with New formboard. The reference goes beside it, as PL stores models: a
gzipped mesh (and optionally the gzipped STEP), the PNG, or the DXF, split over 4 MB. The sync guards
apply as for systems: stamped on edit, three-way against `syncBase`, no write without an edit.

```
{ schema, id, meta: { name, system, units: 'mm' },
  reference: { kind: 'step' | 'dxf' | 'png', file, scale, at },   // scale from calibration for PNG and DXF
  blocks:   { <block path>: { at: [x, y, z], rot, keep } },       // leaves, kept systems, device ends; only once moved
  channels: [{ id, pts: [[x, y, z]…], up: [x, y, z], w, h, classes: [], exclusive, extraPerM, name }],
  cables:   { <cable path>: { classes: [], pinned, vias: [], endMm: { <end>: mm }, route: { pts, length, channels } } },
  settings: { dropMax, endMm, slackPct, roundMm: 10 } }
```

## Suggested order

1. **Lift the stage out of PL** into a shared `stage.js` with an adapter; PL's tests unchanged; vendor
   into Loom. Measure render speed on a large made-up STEP.
2. **Formboard tab, placing only:** import a system (flattened), blocks as boxes (boards as textured
   slabs), straight lines between connectors, a STEP, DXF, or PNG reference with calibration, drag and
   snap, saved.
3. **Channels:** draw, size, classes, properties panel.
4. **Route:** the graph, Dijkstra, drops, Not routed, pinned, vias, lengths in the List tab.
5. **Fill and allowances**, then Apply lengths and Save to base part (see *Lengths*).
6. Later: flatten a routed harness to a 1:1 formboard drawing.

## Decisions for Chris

1. ~~**Constraint rule**~~: decided 2026-11-15 (see *Constraints*).
2. ~~**Nested systems**~~: decided 2026-11-15 (see *Nested systems*).
3. ~~**Lengths**~~: decided 2026-11-15 (see *Lengths*).
4. ~~**Channels**~~: decided 2026-11-15 (see *Channels are a graph*).
5. ~~**Name**~~: decided 2026-11-15: **Formboard**. The later 1:1 build drawing goes in the same tab,
   so the name grows into its industry meaning.
6. ~~**Storage**~~: decided 2026-11-15 (see *Storage*).
