# Wire routing (branch `routing`, 2026-11-10)

Chris, 2026-11-10: "I want to be able to place a line point to point, … assume any direction from any
point. … What I really want is the ability to shape those wires afterward, change and maybe add
curves. … if we had the wires walk around objects … all the straight parts of the wires could be
dragged around to fine tune."

His choices: right angles with rounded corners; loose wires and sets together; no box between parts
for loose wires; built on a branch, with `main` put back to `72f9253` (the morning's drawing) while
this is tried.

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
