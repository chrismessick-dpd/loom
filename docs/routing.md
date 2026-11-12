# Wire routing (branch `routing`, 2026-11-10)

## One engine for harnesses and systems (2026-11-11)

Chris: anything that joins two blocks is a **Connection**: on a harness, a wire (between connectors and
splices); in a system, a cable (between connectors on boards and devices), whether a Loom harness, a
purchased cable, or a generic connection. Both route the same way, and the harness's routing is the
baseline ("I like how it is working").

- **`assets/connect.js`** (`LM.connect`) is the engine. `routeAll(docKey, rects, list, opts)` is the
  harness's route-set code moved out of `conn.js` unchanged: end pairs tried and the cheaper kept,
  shapes kept by key with the sides they were shaped on, Go behind, stability (a route is kept while its
  ends haven't moved and nothing changed on top of it), biggest first, and `occupy`. `grab`, `slide`,
  `release`, `bend`, `menuHtml`, and `apply` are the harness editor's run drag, double-click bend, and
  right-click route menu, which both canvases now call.
- **The harness** (`conn.js`) builds its boxes' terminals (pins on either edge, breakouts) and hands them
  over; branches, packing, and labels stay there. **`tests/golden.js`** pins every harness route on the
  demo and both routing checks through a fixed run of moves, a drag, a shaped run, and Go behind, as
  hashes taken before the move (`golden-data.js`). It must never change by accident; regenerate it only
  on purpose (`tests/golden.html`).
- **A system** (`system.js`) gives the engine its blocks as the parts and each cable end as a terminal:
  a connector leaving left or right runs level from its exit, with its own stub out past its board's
  edge; one leaving up or down runs to a lead point past the edge (`A.from`, `B.to`: route.js `shape`
  draws them) and may turn either way there, the cheaper winning, as a harness connector's two edges. A
  cable keeps the harness's record per end (`cab.routes[end id] = { v, a, b, mode }`).
- **Two differences, both parameters:** a system searches on a 12-unit grid (3 mm; a made-up 30-board,
  60-cable system, `tests/fixture-system.js`, routed in about 1.1 s against 1.7 s at 10, a drag step
  about 0.1 s), and a system terminal's stub reaches a grid line, since the search rounds its first
  corner to the grid and a corner rounded back short of the stub made the route give up and run
  straight (the harness has the same rounding; left as it is, as the baseline).
- **Fixed for both:** dragging the end of a straight wire (no middle runs) used to add a bend that left an
  even count of values, drawn wrong. It now lifts the piece from the grab to the far end's corner, as
  systems did.
- **Not the same yet:** a cable with three or more ends routes from its first end to each other one; a
  harness bundle with a breakout has a split point and routed branches.

Chris, 2026-11-10: "I want to be able to place a line point to point, … assume any direction from any
point. … What I really want is the ability to shape those wires afterward, change and maybe add
curves. … if we had the wires walk around objects … all the straight parts of the wires could be
dragged around to fine tune."

His choices: right angles with rounded corners; loose wires and sets together; no box between parts
for loose wires; built on a branch, with `main` put back to `72f9253` (the morning's drawing) while
this is tried.

## Second round (2026-11-10, after Chris tried it)

Chris: P3's pins jumped to its far edge when he placed it, so P2:4 → P3:4 wrapped round it; a kink
where a pair met its corner; drags shouldn't be stopped by parts ("try to walk around, but go behind
otherwise"); maybe a right-click choice of walk around, push, or ignore.

- **Either edge.** A connector end may leave from either edge: both are routed and the cheaper wins,
  the facing edges on a tie. P3 keeps its pins where P2:4 → P3:4 can walk round on one side. The pin
  numbers sit on the edge the routes use (`Lo.pinSides`). A shaped route stores its edges (`a`, `b`)
  and moves to a connector's other edge when its end run is dragged past it.
- **Behind parts.** Parts are expensive to cross rather than walls (route.js `COST.behind`, 30 a
  step), so a route walks round unless that's much longer, and a drag is never stopped: a run over a
  part draws behind it. Right-click a wire or set for *Walk around parts* or *Go behind parts*
  (`h.routes[key].mode = 'behind'` routes straight past everything), and *Reset route*. Push isn't
  built: it would move other parts.
- **No kinks.** Wires keep their pins' spacing and change it once, on the route's longest straight
  (`P.ease`), not at a corner. A route is as wide as its pins' spread when that's wider than its rows.
  A jog shorter than a step next to a pin folds into the end run (the grid rounding that hooked two
  wires into M6). A jog too short for two corners of the route's width is drawn as one S-curve along
  the runs either side (route.js `shape`), and a route's jogs are lined up where that keeps it clear of
  parts (`straighten`). A breakout too close to the other end goes level with it. A test now checks
  that no wire in the demo or the routing checks turns tighter than radius 6.
- **Demo.** S1 sat on P2 once routes ran B1 to P2's pins (it was placed at B1's right end): it's now
  two thirds of the way from P1 to P2 (demo `VERSION` 17).

## Third round (2026-11-10, Chris: "functioning very well … continue with the rest")

- **Labels clear of parts.** A group's labels try spots along every level stretch, longest first,
  right of their dots and then left, and for a lone wire beside a vertical run, and take the first
  where no label overlaps a connector or splice. Where none is clear (a label longer than the gap
  between two parts), they go under the wires as before; they can still be dragged.
- **Split points.** A bundle that splits to several parts has a diamond at its split point (on a
  selected bundle) that drags anywhere, snapped to the grid (`h.routes[key].split0` or `split1`). Each
  wire then runs on to its pin as a route of its own, at right angles round the parts (conn.js
  `routeBranches`; the pin from either edge of a connector). Within 120 units of its pins the split
  fans out instead, the wire going furthest turning first so none cross. Reset route forgets the split.
- **Shapes keep.** The loose wires between two parts are one group whatever their number
  (`p:<pair>`), so a shaped route stays when a second wire joins next to it.
- **Groups of neighbors only** (Chris: "all the black wires on the splice" in the demo). Loose wires
  between two parts share a route only while their pins are next to each other at both ends
  (conn.js `neighbors`); S1's wires to P2 pins 2 and 6 used to make one route four rows wide, with
  big corners and long S-bends. Each run of neighbors is its own group (`p:<pair>~<first wire id>`
  after the first). S-bends are only as long as the route's width needs. Labels keep clear of every
  set that packs or twists, not only the outermost (TP1's labels overlapped past B1).
- **Wide routes in small steps** (Chris: B1 dragged into steps of 30, 10, and 50 within about 100
  folded its outer wires). Where a route's corners and S-curves still bend tighter than its widest
  wire can follow (half-width + 4), route.js `shape` smooths the whole line (`ease`: Laplacian steps
  on samples 3 apart) until none does, its end runs held straight into the pins. The runs and their
  handles stay where they were dragged; only the drawing eases. Sets, lacing, shields, and twists
  ride the eased line, and a set's end grip still slides along it. Run handles now sit under set
  grips and badges (a handle covered B1's end grip). A test drags B1 into the same steps and checks
  that no route bends tighter than its half-width. Tests 35.
- Still: a shaped route whose end run ends up shorter than its stub (a part moved close) turns
  tightly into its pins.
- A route's end may carry its own stub (route.js `stubOf`): a split point needs room for its corner
  only, not a part's clearance.
- Guide: the shaping step mentions the split diamond and the right-click choices. The tour's Loom
  steps ring connectors only and are unaffected.
- Tests 34 (the shaped-route test also adds a second wire to a shaped pair).

## What it does

- **Every group of wires travels on a route.** A group is what conn.js calls a box: an outermost set
  (cable, bundle, shield, or twist), or the loose wires that join the same two parts. Its route runs
  from the pins at one end to the pins at the other in straight runs at right angles, with rounded
  corners, and goes round every connector and splice. Its wires ride it side by side at their row
  spacing, packed where their sets pack them (as before), easing over the last 50 units to their own
  pins where those are spread or ordered differently.
- **A side whose wires go to more than one part** ends at a breakout, 60 units short of the nearest
  of those parts' pins on the side facing the rest of the route, and its wires curve on to their pins
  from there. The breakout can't be dragged yet, and its branches aren't routed.
- **Shaping.** A drag on a straight run of a wire's line or a set's area moves that run sideways,
  snapped to the grid (Ctrl: anywhere). A selected wire or set shows a handle on each run it can move.
  Dragging an end run (the one that meets a part) first adds a bend in it, clear of the part, and
  drags the new piece. A double-click on a run adds a bend there. A run dragged flush with the next
  one merges into it. *Reset route* in Properties forgets one group's shape; *Auto layout* forgets
  them all. One undo puts each change back.
- **What a shape keeps.** `h.routes[box key] = { v }`: the middle runs' positions (route.js). When a
  part moves, the end runs follow it and the middle runs stay. A shape that no longer fits its ends
  (a part moved so the first or last vertical run would sit inside it) is set aside and the group
  routes itself, until it's shaped again.
- **Finding a route** (route.js `auto`): A* on a 10-unit grid with a cost per bend and a cost for
  running along (or across) routes laid down earlier, so groups spread out instead of lying on each
  other. Groups route biggest first, in one fixed order.
- **Stability** (Chris: lines he hadn't touched kept changing). A route found before is kept while its
  ends haven't moved, it doesn't now run through a part, and no route that changed earlier in the same
  pass lies on top of it. While a part is dragged only the groups whose ends moved route again.
  Measured on the fan-out check (15 groups): shaping one run moves no other route (the whole bundle
  jumped before); moving one load 60 units re-routes 0 to 3 groups it doesn't carry, about half of
  them because they'd now run through it.
- **Speed.** Three fan-outs side by side (48 wires, 30 parts): 65 ms to route everything, 6 ms when
  nothing changed, 8 to 17 ms per move while dragging a part. A load boxed in by four others: 100 ms.
- **Unchanged:** Real proportions keeps its straight boxes to scale; the sheet prints the routes.
- **Gone:** leads (`biarc`, `leadSide`, `curveLead`, `stagger`), anchors (`w.anchors`, `dragAnchor`),
  and the drawn box and its grab rows in the arranged view.

## Labels and badges on a route

A group's labels stack as a table at one spot on its longest level stretch, clear of the ends and of
packed sets; where a cable or twist fills the whole route they stack just under it, each with its
leader. Badges sit under the outermost set at its first level stretch. Both can still be dragged.

## Known gaps

- A label longer than the gap between two parts still overlaps one (it goes under its wire).
- A shape is kept by group: a set dissolved into loose wires starts fresh.
- Wires cross near a part whose pin order differs from the group's row order (at the other end).
- Push (moving parts out of a route's way) isn't built.
- Not tried with a real harness or by Chris yet.

## Check it

`tests/fixture-fanout.js` holds two made-up harnesses (no client data). `fanout()` is shaped like a
generator's: a feed connector, three splices, and six loads above, beside, and below, each splice
fanning single wires to several. `directions()` has loads to the left of a splice and straight above
and below it, a connector wired from both edges, and a bundle splitting to two parts. Load one in the
demo (add it to `LM.app.state.store` and open it), or run `tests/test.html`, whose routing tests check
that every wire starts at its pin and that no route runs through a part, on the demo and on both.
