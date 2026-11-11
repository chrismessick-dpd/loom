# Loom systems: boards, connectors, and the harnesses between them (plan, 2026-11-11)

Status: phases 1 to 3 built 2026-11-11 (`assets/system.js`; see Loom's CLAUDE.md, *Systems*). Not built
yet: the board picture under the outline, the system sheet and harness BOM page, sharing, power and bus
checks, and phase 4.

## The idea

A **system** is a second kind of Loom document, beside a harness. It places **blocks** (EE boards,
drawn boards, and off-board devices) on a canvas, marks which of each block's connectors are used and
for what, and plugs **harnesses** into them. Board to device and board to board are the same thing: a
harness whose ends plug into connectors on blocks.

It generalizes a pattern proven in a client's own board configurator and cable tool: capture each
board's used connectors, give every used connector a placeholder harness, and draw and check the whole
interconnect. Ideas only; no code or data from those tools comes here.

Almost all of it exists already:

| Needed | Already in the suite |
| --- | --- |
| A board's connectors, pins, and nets | Loom's *From a board* (`boards.js`: the tagged revision's package, IPC-356 netlist, BOM) |
| Where the connectors sit on the board | The same package's pick-and-place; Fabcheck's `parsePnp` is already vendored in `assets/vendor/assembly.js` |
| The board's outline and picture | Fabcheck's stored `preview/` (`top` image, `board` w and h) |
| Board-to-board wires | `boards.matches` (suggested wires from shared net names) |
| Lines between parts that avoid them | `route.js` (right angles, around parts, draggable runs) |
| Placeholders waiting in a tray | *From Signoff PL* placeholders, and PL's tray |
| Sync, sharing, conflict copies, deep links | `store.js` with `loom_data` and `review-loom-*` |

The one new thing is the association: **this harness end plugs into that connector on that board**.

## Why in Loom, not PL or a new tool

`direction-2026-11.md` said a RapidHarness-style system view belongs in PL. This plan moves it to Loom:
- PL's Structure is a product tree (what is part of what). An interconnect is a graph (what plugs into
  what), and its edges are harnesses, which Loom owns.
- Loom already has the board reader, the canvas, routing, and sync. PL would have to grow all of it.
- PL is FTE only. A system's harness work should be shareable with a contractor the way a harness is.

PL keeps the product tree and later reads a system's summary (phase 4).

## The model

### Where plugging is recorded

On the **system**, against a placed board instance, never on the EE board or on the harness design.
Chris (2026-11-07): a harness belongs with a project, not a board, because copies of one board may use
different cables. So one harness design (one part number) can be plugged in several places: that is its
quantity. `node.board`, which From a board already writes on a harness end, becomes the *suggestion* for
which connector an end plugs into, not the link itself.

### The document

```
systems/<id>.json            (not projects/: see Storage)
{ schema, id, meta: { name, project, revision, ... }, summary, system: {
    blocks: [{
      id, ref,                       // A1, A2, D1… (designator in the system)
      kind: 'board' | 'device',
      source: { tool: 'ee', id, rev } // an EE board, pinned to a revision or 'latest'
            | { tool: 'pl', project, node } // a purchased Part (sensor, motor, PSU), later
            | null,                  // drawn by hand
      name, at: { x, y, rot }, size: { w, h },       // mm
      conns: [{ ref, pins, x, y, side, edge,         // from the PnP, or placed by hand
                used, function, note }],
    }],
    cables: [{
      id, harness,                   // a Loom harness id
      ends: { <harness end node id>: { block, conn } | null },  // null: not plugged yet
      route,                         // the drawn line's shape, as h.routes
    }],
} }
```

- A **board block** from EE reads its connectors (refs, pins, nets) from the package, and its connector
  positions from the package's pick-and-place.
- A **drawn block** is a rectangle with connector tabs placed by hand: for a board with no layout yet,
  or a generic device. Adding connectors works like adding pins.
- A **device** (sensor, motor, wall wiring) is a small drawn block with one or more connectors, or a
  flying-lead end. Later it can name a purchased PL Part.
- A **cable** is one use of a harness. A harness with three ends (a Y cable, or two board connectors
  merged into one plug) is one cable touching three connectors; nothing special is needed.

### Placeholder harnesses

On a used connector with nothing plugged in, **New harness here** makes a harness with that end already
filled by From a board (pins, nets as labels, *Mates with*), named "<board> <conn> harness", with no
wires, and plugs it in. That is the placeholder: it shows ○ until it has wires. Picking **two** connectors
(on two boards) makes a harness with both ends filled and the shared-net wires offered, so a
board-to-board cable starts as a list to review.

**Plug in a harness…** offers existing harnesses, best matches first: ends whose `node.board` names this
board and connector, then same pin count.

### Status

Each cable shows its harness's state, as the client tool's board list does:
○ placeholder (no wires), ● in progress, ◉ wired with no errors, ✅ released (harness revision set).
A block rolls up its connectors; the system rolls up its blocks. Status shapes and dots follow the
suite's hatch tokens, never hue alone.

## The System view

- A Loom document type picked under New (Harness, System), listed in the sidebar's client-project group
  above the harnesses.
- **Canvas.** Blocks drawn to scale: an EE board as Fabcheck's top picture, its connectors as labeled tabs
  at their PnP positions (unused ones faint, used ones solid, used and unplugged ones with a dashed stub
  ending in a ring). Cables as routed lines between tabs (`route.js`), labeled with the harness ref, part
  number, and wire count; a cable not fully plugged ends in a dashed stub.
- **Interaction**, all from the Build canvas: drag and turn blocks, grid snap, marquee, undo,
  copy and paste a block (a second copy of a board).
  - Click a connector tab: its Properties (Used, Function, the pins and nets, what's plugged in), with
    New harness here and Plug in a harness….
  - Click a cable: its harness's summary; double-click opens that harness in Build, which shows
    "Plugs into Main PCBA J1 in <system>" on each plugged end.
  - Double-click an EE board: opens it in Signoff EE (same tab).
- **Drawing.** A system sheet: the diagram, a cable list (cable, harness PN, from, to, length, status),
  and a BOM of harnesses with quantities. Print like a harness (sections on new pages).

## Checks

Derived at every edit, as a harness's checks are, and listed in the system's Checks tab:
- a used connector with nothing plugged in, and a cable end plugged nowhere;
- a connector with two cables;
- a harness end's pin count differing from the connector's;
- **net mismatch**: a wire's end pin label differing from the board net on that pin (the harness end was
  filled from an older revision, or plugged into the wrong connector);
- the harness end was filled from another revision of the board than the system's block (`node.board`
  needs the revision recorded);
- a board-to-board wire whose two ends carry different named nets;
- later, from net names: power rails meeting rails of another voltage, and a bus (CAN, RS-485) with a
  break or a branch.

## Storage

- Systems go in `loom_data/systems/<id>.json` with the same envelope as a harness. **Not in
  `projects/`**: PL's reader treats every `projects/*.json` in Loom's repo as a harness and would put the
  system in its tray. `store.js` learns a second folder; check `storeDrawings`, `dropGone`, the sidebar
  grouping, and the deep link (`?system=<id>`) for the same assumption.
- A cable names a harness by id. Deleting a harness that's plugged in somewhere asks first and leaves the
  cable as a placeholder with the harness's name.
- Sharing (PL's share): a system moves with its project into `review-loom-<slug>` like its harnesses.

## Board geometry: the traps

- **Origin.** PnP coordinates are relative to the board's origin, while the preview is cropped to the
  outline. Fabcheck's `preview/index.json` has `board` w and h but no origin. Fabcheck should add the
  outline's `bbox` (in the PnP's frame), an additive change to the *Board previews* contract in
  `ee_design_review/docs/fabcheck-link.md`. Until then, and for older runs, fall back to the PnP's own
  extents, and let the user nudge the picture under the tabs.
- **Revision.** `preview/` is whatever the latest Send wrote, while `boards.js` reads the tagged
  revision's package. Use the picture only when its `runId` is that revision's run, else draw the
  outline box alone.
- **Missing connectors.** A connector not fitted in the build variant has no PnP row: place it by hand
  (kept on the block, marked as placed by hand).
- **Bottom side.** Bottom connectors are mirrored in the top view and drawn dashed, with "bottom" in
  their tooltip.
- **No package yet.** A drawn block can later be swapped for the EE board (connectors matched by ref).

## Phases

Each ends in something to see.

1. **System document and blocks.** New › System; EE boards (outline, picture, connectors from the PnP)
   and drawn blocks; Used and Function per connector; sync to `systems/`. The demo: the Smart
   Thermostat's Main PCBA and Display & Sensor Board, with the wall wiring as a device.
2. **Plugging harnesses.** New harness here, Plug in a harness…, routed cables, placeholders, and status
   dots; the harness side shows where each end plugs in. Demo: the tour's J1 harness plugged into the
   Main PCBA, plus a placeholder.
3. **Board to board, and the checks.** Two-connector New harness with suggested wires, the checks above,
   the system sheet, and the harness BOM with quantities. Demo: the board-to-board cable.
4. **Signoff PL (stashed).** PL reads `summary.system` (blocks, cables, harness quantities, open counts,
   and a stored picture, as harness drawings are stored) to fill the *Harnesses* quantities, show the
   system on the product, and roll its status up. PL's Placeholders for Loom stay how PL asks for a
   harness; the system may also propose them.

## Decisions (Chris, 2026-11-11)

1. **Per instance.** Used and Function are set on each placed board; copies of one board may differ.
2. **No board configuration** (jumpers, fitted options) here; that is explored later, elsewhere.
3. **Length.** Two lengths are two part numbers. A placed cable may override its harness's length; it
   is then a variant, numbered `<harness PN>-<length in mm>` (same harness, another length).
4. **Several systems** per project.
5. **Devices from PL** wait for phase 4.

## The questions as asked

1. **Per instance or per configuration.** Are Used and Function set on each placed board (phase 1's
   default), or on a named board configuration shared by every copy, with harnesses shared by
   configuration the way the client's tool does it? A middle way: per instance, plus *Copy from A2*.
2. **Jumpers and board options.** Should a block also record solder jumpers and fitted options (a
   connector that is one part or another in the same place), or does that stay in EE?
3. **Length.** Is a cable's length per use in the system (the same harness design at two lengths would
   be two part numbers) or only on the harness design?
4. **One system per project?** Or several (variants, test fixtures), each listed under the project?
5. **Devices from PL.** Should a device block be able to name a purchased PL Part in phase 1, or wait
   for phase 4?
