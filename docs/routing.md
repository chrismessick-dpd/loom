# Wire routing (branch `routing`, 2026-11-10)

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

- A short wire's label can run into the part at its end (the stretch is shorter than the label).
- A shape is kept by group: when a pair of parts gains a second wire (`s:` becomes `p:`), or a set is
  dissolved, its shape is forgotten.
- Before merging: the hub's tour and Loom's guide may ring box areas that routes no longer draw.
- Wires cross near a part whose pin order differs from the group's row order (at the other end).
- Breakout branches aren't routed.
- Not tried with a real harness or by Chris yet.

## Check it

`tests/fixture-fanout.js` holds two made-up harnesses (no client data). `fanout()` is shaped like a
generator's: a feed connector, three splices, and six loads above, beside, and below, each splice
fanning single wires to several. `directions()` has loads to the left of a splice and straight above
and below it, a connector wired from both edges, and a bundle splitting to two parts. Load one in the
demo (add it to `LM.app.state.store` and open it), or run `tests/test.html`, whose routing tests check
that every wire starts at its pin and that no route runs through a part, on the demo and on both.
