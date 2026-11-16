# Blocks and Connections: one behavior for harnesses and systems (draft, 2026-11-15)

Chris, 2026-11-15: the harness editor is the standard. Loom has two kinds of object, **blocks** and
**Connections**, and both should act the same way on a harness and on a system.

- **A Connection** joins two points. It can be a wire (pin to pin) or a system cable (whole
  connector to whole connector), and a system cable can be generic, purchased, or a Loom harness.
- **A block** is what Connections attach to:
  - on a harness: connectors with their pins, flying-lead parts, and splices;
  - on a system: placed systems (their external ports), generic devices with ports, and specific
    devices such as boards.
- **Blocks rotate.** Their ports start at default spots round the perimeter and can be dragged.
- **Wires and cables drag and route the same way,** with the same keys to break a run. Each has labels
  along it: a dot on the line that drags along it, and a label that drags anywhere.

This page is the audit behind that: what is shared today, and what each canvas does on its own.

## Where they differ today

"Engine" means it goes through `assets/connect.js` and `route.js`. "Own" means a copy in one canvas.

| Behavior | Harness (`conn.js`, `app.js`) | System (`system.js`) | Shared? |
| --- | --- | --- | --- |
| Route search, stability, biggest first | `routeAll` | `routeAll`, on a 12-unit grid, coarser on a big drawing | Engine |
| Run drag; Shift breaks the run; Ctrl drags off the grid | `CN.grab`, `CN.slide` | `CN().grab`, `CN().slide` | Engine |
| Snap straight, merge on release | `CN.release` | `CN().release` | Engine |
| Double-click to add a bend | `LM.connect.bend` | `CN().bend` | Engine |
| Right-click: Walk around, Go behind, Reset | `menuHtml`, `apply` | `menuHtml`, `apply`, plus Remove | Engine |
| Gesture handling (what a press grabs) | its own state machine (`app.js` ~990–1352) | its own state machine (~2611–2830) | **Own, in both** |
| End of a route | a pin row on a connector's left or right edge, whichever is cheaper | a connector's exit: left, right, top, or bottom. Top and bottom add a lead-in out past the block | **Own** |
| Lead-in drag | — | `leadGrab`: no Shift break, no snap straight | **System only** |
| Exits that face their cable, port lines, side clearance | — | `autoExits`, `portLines`, `sideClear` | **System only** |
| A Connection with three or more ends | a split point (a diamond that drags), then a routed branch per end | a route from the first end to each of the others, no split point | **Different** |
| Cable built onto a device (motor, flying leads) | — (the harness itself) | drawn as a picture: `devLayout`, with its own router (`elbow`, `roundPts`, `roundBlock`). It goes round only its own block, has no draggable runs, and has no right-click menu | **Second router** |
| Label dot along the line | `w.labelAt`, along the whole route | `cab.labelAt`, along the first route only | **Own, in both** |
| Label dragged off the line | `w.labelOff`; a group's labels stack as a table with leaders, placed clear of parts | `cab.labelOff`, mm; one label per cable | **Own, in both** |
| Badges (set names) | `s.badgeAt`, `s.badgeOff` | — | Harness only |
| Rotate a block | — (connectors are tables; pins sit on the left or right edge) | R, Shift+R, ⟳ for the whole system | **System only** |
| Ports round the perimeter, draggable | — (pins are table rows) | Boards: connectors at their pick-and-place spots, exit picked in the panel. Placed systems: tabs round the edge, dragged round it | **System only, two kinds** |
| Placed system's tabs | — | a curved lead from the tab to its connector in the mini view (`leadPath`) | System only |

So the routing core is shared already. What diverged is everything around it:
- the gestures;
- the ends of a route (pin rows against exits and lead-ins);
- labels;
- three or more ends;
- device drawings, which have a router of their own;
- blocks: rotation and ports exist on one side only.

## Reference

- `tests/golden.js` pins the harness demo's routes. It stays the public pin and must not move by accident.
- The client harness Chris named is a second reference. A capture of it (its routes, labels, badges,
  and the drawn SVG) and of one system that plugs it in goes in a private place, never in this repo.
  Each step below is checked against both captures, and they must be byte-identical unless Chris has
  agreed to the change.

## Chris's decisions (2026-11-15)

- **Rotation and draggable perimeter ports are for system blocks only.** Harness connectors stay
  tables with pins on the left or right edge, so the reference drawings don't move.
- **Boards keep their pick-and-place spots.** Placed systems and generic devices use perimeter tabs.
- **Device harnesses become real Connections.** The engine routes them round every block, and they
  drag, bend, and break like cables, with the same right-click menu. Their far-end boxes stay
  draggable. `elbow`, `roundPts`, and `roundBlock` go.
- **Three or more ends take the harness model:** a split point that drags, a routed branch per end,
  and one label table per route.

## Steps

0. Capture the references.
1. **Bring the system onto the harness's own code, with no change to how the harness looks:**
   - one gesture module that both canvases call, for a press on a run, a lead-in, a label dot, a
     label, or a block;
   - a shared label model (dot along the whole Connection, label off it, leader);
   - a lead-in drag that is an ordinary run drag;
   - device drawings routed by the engine.
2. **Blocks (systems only).** One port model for placed systems and generic devices: default spots
   round the perimeter, dragged round it. Boards keep their pick-and-place spots, with a draggable
   exit.
3. **Three or more ends.** System cables get the harness's split point and routed branches.

## Progress (2026-11-15)

- **Step 0 done.** A private before/after page draws every harness and system in a local `loom_data`
  snapshot with the code frozen at the plan's start and with the working code, and lists what differs.
  It's kept outside this repo. Before any change: 190 harnesses and 37 systems, no differences.
- **Every selected connection carries the current** (Chris, mid-step): a selected connector's cables,
  every selected block's in a multi-selection, and device harness wires. The bead has the harness's look
  at the system's fixed size and speed, and a connection with its own color carries a lighter shade of it.
- **Labels, one model.** The lane helpers (`lane`, `laneAt`, `laneT`) are the engine's (`connect.js`).
  An unset cable label takes the first spot clear of blocks and other labels (`labelSpot`), as the
  harness's labels do. On the reference systems, labels overlapping a block went from 13 to 9, and
  overlapping each other from 4 to 2, on the largest one. Harnesses: no differences.
- **Lead-ins** already drag through the engine's `slide` and `release`, so they get its snap straight and
  merge. Shift-break doesn't apply: a lead-in is part of the port.
- **Device harnesses: first try shelved.** Routing each leg (connector or splice to far end) as its own
  Connection worked (drag, bend, break, all tests pass), but the legs crossed each other: on the reference
  harness the tidy trunk-and-fan became a tangle. The harness editor avoids this with one trunk route to a
  split point and ordered branches. So device harnesses are done with step 3, as one Connection with three
  or more ends. The shelved code is kept outside the repo.

- **Split points (step 3), and device harnesses with them.**
  - **Cables with three or more ends.** A cable with three or more ends runs a trunk from its first end to
    a split point, then a branch to each other end. All of them are Connections in the one `routeAll` with
    the rest. The split is a diamond on the selected cable that drags (grid, Ctrl free), kept as
    `cab.routes.split.split1` (canvas units, the harness's field). Unmoved, it sits at the middle of the
    ends' exits. *Reset route* forgets it.
  - **Device harnesses.** A device harness has a split per plugged connector (`cab.routes['t:<node>']`).
    Unmoved, the trunk runs straight out and fans as before, and on the reference systems nothing changed.
    Moved, the trunk is a Connection routed round the blocks, whose runs drag, bend, and break as a cable's.
    The wires ride it in their colors and fan from the split to their far ends.
  - Tests 119.
- **Block name and status (Chris, mid-step).** A block's name and its status pill stack in the middle of
  the block, the pill under the name. A board drawn with its picture centers its ref-and-name label there.

## Next

- Branches from a moved device split route as Connections when the far ends are far off. They still fan
  as elbows, as the harness's split does within 120 units of its pins.
- The shared gesture module.
