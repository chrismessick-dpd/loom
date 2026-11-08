# Loom: notes for Claude

Loom is a **prototype** harness drawing tool, standalone like Fabcheck. You add the ends, click pin to
pin to run wires, and group wires into cables. Loom then draws the sheet a tech builds from:
- a wiring diagram in the style of WireViz;
- connector face views;
- the wire list and the BOM;
- notes and a title block.

Read `../CLAUDE.md` first for the suite's hard rules. Loom is in development (Chris, 2026-11-07): nothing
needs to fit existing structures or keep old saved harnesses working, so redesign cleanly as needed,
without compatibility shims or migrations. The name is final (Chris, 2026-11-06, after
briefly trying "Lacing"). Repo: `chrismessick-dpd/loom` (public, Pages from `main`); only the hub
links to it so far. Before every commit:
1. Run `python tools/stamp_version.py` (`--check` verifies). It puts `?v=<hash>` on the asset URLs
   and writes the hash to `assets/version.js`. Open pages update themselves from that file, as in
   the other tools: they check 5 s after opening, every 5 minutes and on focus, reload when idle,
   and say "Tool updated" (`checkForUpdate` in `app.js`).
2. Grep the diff for client names and part numbers (`../CLAUDE.md`).

## Status (2026-11-06)

- **Storage and Signoff PL (2026-11-07, Chris; branch `store`, with `signoff_pl` branch `loom`):** harnesses
  sync with one private repo for all of them, `loom_data` (`assets/store.js`, `LM.store`), through the
  Signoff engine's `GitHubStore`, vendored from EE into `assets/vendor/model.js` and `github.js`
  (`tools/sync_vendor.py`). `chrismessick-dpd/loom_data` was created 2026-11-07 (private, `main` with only a
  README); the first sync from a signed-in browser writes `projects/`.
  - **The file** is `projects/<harness id>.json`, an envelope shaped like a Signoff review so PL's reader
    reads it like any design: `{ schema, id, meta: { name, number, revision, project, deleted, updatedAt,
    updatedBy }, summary, harness }`. `harness` is the truth; `meta` and `summary` (`summarize`: `tool:
    'loom'`, `identAt`, `harness: { ends, splices, wires, cables, sets, wireMm, errors, warnings, boards }`,
    no checks) are rebuilt from it at every write, including when a merge picks the stored copy.
  - **Merging** is whole-harness: a harness is a graph, so record-by-record merging could break it. A copy
    with no edits since this browser's last sync (`loom.v1.synced`, a hash per harness) takes the stored
    one; when both changed, the newer `updated` wins and the other is kept as a new harness, "(conflict
    copy)". A harness edited while a sync runs keeps the edit (`before` hashes). Deleting a synced harness
    leaves a tombstone (`h.deleted`, `meta.deleted`; PL reads it as archived); a file deleted on GitHub
    drops an untouched local copy (`dropGone`).
  - **Sync** runs on opening, from the footer's Sync button and on Ctrl+S (Save file is the toolbar
    button; Ctrl+S saves a file only with no sign-in or in the demo). It uses the token Signoff EE keeps
    (`signoff.token`) and the owner in `signoff.v1.settings`; repos can be changed under
    `loom.v1.repos`. A 404 says to ask for access or create the repo. The footer says where harnesses
    are (`#store-state`), and the sidebar groups them by client project and dots unsynced ones.
  - **Signoff PL.** A harness has a client project (`h.project`, the Project field in the harness rail,
    suggested from PL's projects and the boards' clients; From a board fills it when empty). PL offers it
    in that PL project's tray like an EE board, and the PL Part made from it (`source: 'loom'`) is the
    link of record and its place in the tree; Loom never writes PL's repo. Each sync reads PL's data repo
    (read only, cached by blob sha, `loom.v1.pl`) for the project list and the Parts linking each
    harness, shown under Project ("In Signoff PL as a Part of"). A token that can't read PL skips it.
  - **Name and part number both ways**, with no tool writing the other's repo: Loom stamps `h.identAt`
    when Title or Part number change, PL stamps the node's `identAt` when its Part sheet changes them,
    and the newer side wins (`adoptFromPl` here before each push; `pl.js adoptHarnesses` after PL reads
    designs). Rev stays Loom's.
  - **Deep link:** `?project=<harness id>` (what PL's Open in Loom uses) or `?harness=`.
  - **Tests:** `tests/test.html` (16, title PASS/FAIL): the envelope, summary, merge (and `forget` for an edit made while a sync brought another change), `adoptFromPl`,
    `slimPl`, and sync against `tests/fake-hub.js` (copied from PL), in storage `loom.test.*`
    (`LM.store.setNamespace`).
  - **Not done:** the live sync with a real token; PL's demo has no harness Part yet (its snapshot
    generator would need Loom's demo summary, and `../loom` on `main` has no `store.js` until this merges).
    Demo `VERSION` 15 (the demo harness's client project).

- **The guide (2026-11-07, Chris: an interactive getting started for new users):** `assets/guide.js`,
  `window.LoomGuide` (also `LM.guide`). 25 steps in seven chapters (Welcome, The canvas, Ends and wires,
  Wire sets, Views and notes, The drawing, Done), each a title, what the feature is, a *Try it*
  instruction, a `setup` (view, selection, panels shown, the How it works card closed) and a `spot`
  (selectors, first one shown wins), ringed by `#lm-guide-spot`, moved every animation frame. The card
  (`#lm-guide`) has Back/Next, a Contents list to jump anywhere, and drags by its top line. It sits at the
  canvas's bottom left, or moves aside when it would cover the spot. It always runs on the demo harness:
  started outside `?demo`, it opens `?demo&guide` in the same tab and its last step offers Back to my
  harnesses. State is sessionStorage `loom.guide`. It opens from Guide in the menu, Take the guide on the
  home page and the How it works card (`data-act="guide"`). It reaches the app through `LM.app.guide`
  (`demo`, `view`, `select`, `panels`, `menu`, `help`, `wires`, `fit`) and finds demo parts by ref
  (P1, S1) and set label (B1, TP1, C1), since ids are made fresh. Update a step when the feature it
  describes changes. Loom also loads the suite's demo tour (`../signoff/assets/tour.js`), whose Loom step
  has an Open Loom's guide button; the guide hides the tour's card while it runs (`body.lm-guide-on`). On a phone the card docks at the top
  (the selection sheet rises from the bottom), and the four steps about the hidden parts pane show their
  `phone` text instead of Try it.

- **Animated mark:** `assets/mark.js` swaps the sidebar's static icon for a twisted pair that spins
  half a turn about its axis every 24 s and rests over-and-under (still with reduced motion). The
  strands shade from 15% toward the teal at the top to white at the bottom (`top`, `bottom`).
  Settings are `TOOL` in that file, tuned in the hub's `lab/logo-motion.html` (Loom tab), which
  loads it.

- **Direction:** `docs/direction-2026-11.md` covers the name options, the look (three references:
  WireViz, RapidHarness, Wirely), the EE → PL → Loom connector integration and the harness software
  audit with its feature options list. Chris: strip it back to a clean interface and add features as
  needed; the first concept could be ripped out.
- **Rewritten 2026-11-06:**
  - The Build canvas is the connection diagram (`assets/conn.js`), laid out automatically, with no
    + handles.
  - Dragging came back the same day (Chris). Connectors, splices and boxes drag by any part of them
    (`data-item`), and their positions are saved in `h.place` (`n:<node id>` or `b:<box key>`),
    which win over the auto layout on the canvas and the sheet. They snap to `h.grid`: 0 (off),
    5, 10 (default) or 20, set in the Grid control over the canvas, which also picks the grid's
    look, Dots or Lines (`fold.gridStyle`, kept in this browser). Ctrl places freely. Every port
    (pin rows, box wire rows) is on one pitch, `G.PITCH` = 20, and a drag snaps a part's first port
    (`sz.port0`), not its top edge, so ports on different parts share grid lines and wires run
    straight. Grid steps must divide the pitch (an old 40 reads as 20). Auto layout also puts ports
    on the pitch.
    **Auto layout** clears `h.place`. A click without movement still selects, or starts a wire
    on a pin.
  - The right pane has two tabs, **Parts** (the parts list and Add palette) and **Properties** (the
    selection's fields and its Delete button). A new selection switches to Properties, and clearing
    it goes back to Parts (`renderParts`, `propsHtml`). The left rail shows only the harness, except
    on a phone.
  - Phones (`PHONE` in app.js: under 860 px wide, or under 500 px tall held sideways; 2026-11-06):
    the canvas fills the screen, the sidebar slides in from a ☰ button (`nav-open`), the parts pane
    is hidden, and the rail is a sheet over the canvas showing the selection, else the harness: from
    the bottom upright, from the right sideways. It pops up for a new selection (not one made by
    tapping a pin to start a wire), goes when the selection clears, and the HUD's panel button and
    its × toggle it (`S.sheet`). Touch: one finger drags parts and pans empty canvas; two fingers
    pinch to zoom about their midpoint (`touches`, `pinch`).
  - Off phones the sidebar hides as in Signoff EE (2026-11-07, Chris): a button in its top-right
    corner (`.side-collapse`), the toolbar's ☰ button (`.menu-toggle`, shown while it's hidden) or
    `[`, kept in this browser (`fold.side`; `toggleSidebar`, `applySide`). On a phone the same
    buttons and key open and close the drawer. While the canvas changes size, a `ResizeObserver`
    keeps the picture where it is on screen.
  - Boxes: one per outermost wire set (`kind: 'set'`, key `g:<set id>`), and the wires in no set run
    in a plain stack per end pair (`kind: 'stack'`, key `p:<pair>`, or `s:<pair>` for a wire alone),
    with no badge or decoration. See *Wire sets* below. A stack nobody dragged follows its ends
    once one of them is dragged: it centers between them, rows level with their wires (Chris: a
    splice's output labels stayed put when P2 moved). A set's box doesn't, so it can't slide onto
    other parts.
  - The canvas and the drawing sheet use the same diagram. The sheet stays a plain paper diagram;
    the canvas adds a finish (see *Canvas finish* below).
  - The formboard renderer (`render.js`), breakouts in the UI, coverings in the UI and the
    Formboard/Wiring sheet toggle are gone. The model still has segments, breakouts and coverings,
    so a Layout view can come back.
- **Wire sets (2026-11-06, Chris; merged from branch `sets`):** `h.groups` became `h.sets`, a forest of nested
  sets (schema 2; `normalize` converts old groups, `fromGroups`).
  - **Model.** A set is `{ id, label, wires, sets, twist, shield, cable, bundle, length, note, pn }`.
    Its members are wires and child sets; a wire is in one set directly, and a set in one parent.
    Cable and bundle exclude each other, and a cable never holds a cable at any depth, though a bundle
    may (`noCable`: the Cable choice is disabled with the reason; 2026-11-07, Chris). A twist needs two or more wires of its own and no sets
    inside. A bundle needs two members. A set with no property dissolves (its members move up),
    and a set whose only member is a set merges into it (`tidySets`).
  - **Making sets** (`makeSet`). Ticking a property on selected wires makes a set. Each wire is
    lifted to the biggest set wholly inside the selection, so selecting a twisted pair and two
    more wires and ticking Bundle puts the pair inside the bundle. A selection that holds part of
    a set and also wires outside it is refused (`whyNot`, `crossing`). Two or more wires that are
    exactly one set's wires select that set (`wiresSel` in `app.js`).
  - **Labels.** C for a cable, B for a bundle, TP for twisted, SH for shielded. A label made from
    the prefix follows it when the prefix changes; one typed by hand stays (`relabel`).
  - **Lengths** (`setLength`, `reach`). Every set's ends are measured from what holds it:
    `s.over.l` and `s.over.r` say how far each end runs past it (Chris; negative stops inside).
    An outermost set is measured from its wires' ends (the run they share, `A.spans`), so a
    cable stripped back 20 mm at the left has `over.l` −20; a nested set from its parent's ends.
    A set covers what holds it plus both overhangs, and no end may run past the wire ends
    (`reach`; Checks warns). Moving a set's end (`M.setEnd`) leaves the sets
    inside it where they are. Tree edits keep sets in place: `dissolveSet` adds a parent's
    overhangs to its children's, and wrapping keeps them (the new set spans what held them). An
    old Covers value (`s.length`) converts in `normalize` to an overhang on the right, or stays
    while the run isn't known. The BOM uses `setLength`: a cable shorter than its wires leaves
    the rest as loose wire, and a shield braid is listed only outside any cable. The demo
    (`VERSION` 14): B1 covers 150 mm of the 250 mm run, 15 mm in from the left end and 85 mm
    from the right, and TP1 runs past it to both ends. The demo also places P2's left side at
    P3's right side, S1's middle at B1's right end (`Lo.setEndAt`), and the S1 → P2 labels' left sides a fifth
    of the way from S1 to P2 (by placing their stack's box), level with S1's output ports, taken
    from the auto layout (`demo.js`).
  - **Leads: sets along the curves** (2026-11-07, Chris; branch `curves`, the second try after
    `sets`). Every set box has a path (`it.path`): its straight run across the box at its rows'
    middle (`cy`) and, in the arranged view, a lead off each side toward the one part its wires run
    to there, ending a breakout (`BREAKOUT` 40, more for a tall spread of pins) short of it. `u` is
    the distance along the path. The wires' run maps onto the whole path at one scale (`sz.k`, mm
    per unit), and each set's ends sit where `M.reach` puts them (`sz.arc`: `u0`, `u1`), so a set
    reaching its wire ends is drawn out to the end of each lead. Its wires fan to their pins from
    wherever it ends, arriving along the lead's tangent (`joins`, `tanAt`). A box whose sets have no
    cable, shield, bundle or twist has no leads. In Real proportions the path is the box.
    - Twists ride leads too (branch `wire-ends`, Chris): a twist packs its wires like a shield, and
      its helix runs by distance along the path (`twistSpan`: `ua`, `ub`), so it follows the curves.
    - **Anchors on loose wires** (Chris: drag individual wires like cables). A stack (wires in no
      set) gets a path and leads too, and each of its wires a left and a right anchor
      (`w.anchors`: mm in from that side's wire end; `sz.warc`), a small dot in its wire's color
      (`.cv-anchor`, canvas only; Chris): a darker shade with a darker ring on a light wire, its own
      color with a light ring on a dark one (`dotFill`, `dotRing`). The wire rides the path between its anchors and fans to its pins
      from them. Unset, an anchor sits at the box's edge, so a wire curves to its pin as before
      until its anchor is dragged out along the curve (`dragAnchor` in `app.js`, as a set's end,
      snapped to 5 mm). A drawing handle, not a length. Later: a length between a cable's end and
      its wires' ends could build on them.
    - Lessons from `sets` (Chris: glitchy once ends crossed or parts moved): only packed wires ride
      a lead; there's no fixed breakout point the wires must meet; a lead is two circular arcs
      level at both ends, with a straight between when it climbs further than it runs (`biarc`),
      so its tightest radius is known. A lead bending tighter than its band needs first brings its
      breakout in toward the part (to `MIN_BRK`), and else that side has none (`leadSide`). Sets
      are placed by absolute reach, not relative to their parents (no `NEST`/`OUT` dead zones), so
      ends pass each other cleanly.
    - Leads leaving one part's side the same way nest: the one going furthest turns first and each
      next one's breakout is further out by both bands' widths (`stagger`), so they don't cross.
    - Every set drawing comes from its band along the path (`band`, `it.band(sp)`: samples with
      normals and edge offsets, `at(u)`): the sheath (`jacket`, `capOf`), braid, lacing, set
      areas (paths), end grips (square to the path) and badge leaders. Notes on a set use its band's
      bounds (`setGeom`).
    - A check moving P1, P2 and P4 to 54 spots, anchors pulled out, found no wire or band edge
      doubling back.
  - **Dragging a set's ends** (Chris). Every set has a grip at each end (`setEnds`,
    `data-setend`; it shows on hover and while selected). Dragging it slides that end along its
    box's path (`dragSetEnd` in `app.js`): the pointer, less where the end was grabbed, is
    projected onto the path (`conn.project`, `conn.pathAt`), and the reach there (at `sz.k`, or
    through `sz.prop` in Real proportions) sets the overhang from what holds it, snapped to 5 mm,
    and onto the parent's end within `SNAP` (10) units. Limits: the wire ends and `MIN_W` (12) from
    the set's other end. `#tip` reads the overhang and the total, and one undo reverts it.
  - **A set's box follows its parts** when they're moved so it no longer sits between them: it
    re-centers between them horizontally, even if it was dragged (Chris: P4 dragged past TP2's box
    made its wires loop back). Between them, it stays where it was put. The diagram is still
    schematic; where along the run a set sits needs a layout (formboard) view.
  - **Drawing** (`conn.js`). `arrange` orders a box's rows by the set tree, so each set's rows are
    contiguous (`sz.spans`, outermost first). Neighboring sets whose drawings would touch get an
    empty row on the pitch. Each set reaches `R` above its first wire and below its last. Each set draws its parts outermost first: lacing for a bundle
    (`lacing`), the sheath for a cable, and a crosshatch braid for a shield (`holders`; the braid
    goes over the sheath). The pattern ids are `lm-braid-canvas` and `lm-braid-sheet`. A twisted
    set's wires twist inside its stretch. The box's label table is gone. A shield's braid and a
    cable's sheath reaches `SET_R` (6) past its outer wires, a shield's braid `SHIELD_R` (4: snug, about 1.5 outside its wires' drawn edges), and a
    bundle `BUNDLE_R` (12). On the canvas a shield is metallic (Chris, 2026-11-07): its outline (1.2)
    and its 7.5-unit crosshatch in one steel gray, `#b4b9bf`, with nothing under them; selected, its
    outline goes to the selection blue.
  - **Cables, shields and bundles pack their wires** (2026-11-07, Chris: look more like a cable;
    shields and bundles from branch `curves`). Each wire eases into every packing set that holds
    it (its chain, `chainOf`, `packAt`), so a shielded pair running past its bundle stays packed.
    A set nested in a packing set packs at its real width, its wires plus its `R` each side, so its
    neighbors sit against its outside (Chris: a snug shield; `packLayout`, `packFn`).
    Across a cable's stretch its wires run `PACK` (5) apart, edges touching, round its middle, so the sheath is as
    thick as its conductors need (`SET_R` past the outer ones, more when it holds sets). Before it
    they fan in from grid spacing and after it back out, each over `fanLen` (24 to 90, longer for
    more wires; a smoothstep, `cover`). A cable inside another packs with it (`packSpans`; nested cables can't be made any more).
    - The box makes room (`sizeBox`): the fan-in before the cable (in `lx`, so the frame and a
      placed box's wires stay put), and after it the fan-out plus a straight run at grid spacing
      for the labels (`LABEL_PAD` either side). The labels default there (`labelX0`). In Real
      proportions a cable can fill its box; then its labels go before it if they fit, else they
      split round it until slid: rows above its middle sit just above it, rows below just under it,
      and the badges move down with them (`offLane`, `it.labelDrop`). That's also what happens
      when a packed set runs out along both leads.
    - Wire paths (`runPts`), lanes, twist leaders and `wireAt` all go through the packing
      (`packAt`), and every set's band is drawn round its packed wires, so a set running past its
      parent narrows inside it and widens as its wires fan out.
    - The canvas draws the sheath only just see-through (Chris: 90%): opaque colors at the tint the
      old smoked glass showed, at `fill-opacity` 0.9. The sheet keeps its see-through gray.
  - **Badges** (`badgeRow`, `badges`, `badgeLeaders`; Chris). Every set in a box gets a badge, in a
    row under the box from the outermost set's left end (so it follows that end when it's
    dragged), outermost first and then down the tree. A leader runs from
    each badge up to the bottom edge of its set, ending in a dot; leaders are drawn under the
    wires. On the canvas a badge is a lit pill like the cards, with a dot in its set's color (the
    Properties chip colors: cable blue, bundle gray, twist amber, shield violet). The sheet prints
    plain pills. Clicking a badge selects its set; the selected one and its leader glow. Hovering
    a badge lights its set's area as hovering the set does (`lightBadgeSet` in `app.js`).
    - **Dragging badges** (2026-11-07, Chris). A badge drags anywhere, kept as `s.badgeOff` from its
      leader's dot, with a straight leader back to it; its dot (`.cv-bdot-hit`) slides along the
      set's lower edge, kept as `s.badgeAt` (0 to 1 along its stretch), and the badge comes along
      (`dragBadge` in `app.js`, `conn.badgeOf`). Either drag first freezes the other half; a click
      still selects the set. Unmoved, a badge keeps its place in the row with its elbow leader. Auto
      layout forgets both.
  - **Wire labels** (2026-11-07, Chris: they size nothing and slide anywhere along their wires).
    Each boxed wire's label (from, color and to, in its box's shared columns, `sz.cols`,
    `sz.inner`) is drawn in its own layer over the parts, outside every `data-item`
    (`labelSvg`). Boxes no longer size to their text: a box gives its rows a nominal run,
    `ROW_W` (140).
    - **A dot and a leader** (2026-11-07, Chris). Each label hangs from a small white dot on its
      wire (`.cv-ldot`), with a thin line from the dot to the label's left side (`.cv-ldot-lead`),
      on the canvas and the sheet. The dot sits `w.labelAt` along the wire's lane (`lane`: its path
      from pin to pin, packed, without a twist's swing; on the helix where it's over a twist in the
      box, `wireAt`), 0 to 1. The label's left side sits `w.labelOff` (`{ dx, dy }`, to its
      baseline) from the dot, anywhere. Unset, the label is where it always defaulted (`labelX0`;
      split clear of a packed set that fills its box, `offLane`) and its dot just left of it, on the
      wire; with only `labelAt` set, the label sits just right of its dot (`DOT_GAP`). The old
      twist leaders are gone; the dot does their job.
    - **Dragging** (`app.js`). The dot slides along its wire (`slideDot`: the pointer, less where
      it was grabbed, projected onto the lane), and its label comes along at the same offset. The
      label moves anywhere (`moveLabel`, by its clear rect `.cv-lgrab`), and its dot stays put.
      Either drag first freezes the other half (`labelStart`), and one undo puts it back. A click on
      the label without moving goes to whatever is under it. Auto layout forgets `labelAt` and
      `labelOff`.
  - **Set areas** (`setAreas`, canvas only). Each set's bounds are a hit area over the wires,
    outermost first, so the innermost set under the pointer wins. Hovering an area tints it and
    titles it, a click selects that set, and shift-click adds its wires to the selection (or takes
    them out). A wire is picked by its line in the open, never by its label. A stack (wires in no
    set) has an invisible `.cv-grab` over each row's run so it still drags. The areas sit inside
    the box's `data-item`, so they drag it.
  - **Selection look** (Chris). A selected wire's pulse (`.w-pulse`) is half its first strength
    (opacity 0.5, a smaller glow). A selected set's wires carry one at half that (`.w-pulse.soft`,
    wire class `setsel`). What a selection isn't about dims half as much as before (`.dim` 0.6,
    wires 0.56, pins 0.65). On a light wire (white, yellow, pink, orange, turquoise: relative
    luminance over 0.3, `isLight`) the pulse is a dark bead (`.w-pulse.ink`), since a light one
    doesn't show (Chris).
  - **Real proportions** (Chris). A checkbox beside Wire labels (`#propview`, `fold.prop`, kept per
    browser) switches the canvas to a to-scale view (`conn.layout(h, A, { prop: true })`,
    `proportion`); unticking goes back to the arranged (casual) view, whose dragged positions
    (`h.place`) the proportional view ignores and never changes. The sheet stays casual.
    - Top-to-bottom order comes from the casual auto layout. x comes from lengths: one scale for
      the harness (the shortest run is `MIN_RUN` units), and in column order each part sits as
      far right as its longest incoming run puts it (a connector's left edge, a splice's middle).
      Parts nothing feeds from the left line up on their right edges.
    - A box spans exactly from the parts on its left to those on its right, wires fan from their
      pins to their rows over `FAN` inside it (`it.fan`), and its sets are drawn at their true
      positions (`M.reach`, clamped to the wire ends). `sz.prop` maps mm along its wires to x.
    - A run longer than `MAX_RUN` (or too long for its gap by more than `2 × FAN`) is drawn to
      scale at both ends with a break a third of the way along (`breakMark`: a paper band between
      two zigzags across its wires, with the run's length over it); labels default to the right
      of it (`sz.textC`). A run with no length is `NOMINAL` long.
    - Boxes can then reach into another column's parts, so anything that would overlap what's
      already placed moves down below it, top down.
    - In this view connectors, splices, sets and stacks drag only up and down (2026-11-07, Chris),
      snapped like the arranged view (first port on the grid). The heights are kept in `h.propY`
      by item key (`n:<node id>`, `b:<box key>`), apart from `h.place`, and Auto layout here
      forgets only them. A box nobody moved whose end was moved centers its rows on its ends.
      Once anything was moved, what was moved goes first and stays put, and anything else that
      overlaps takes the nearest free height above or below (with nothing moved, the old top-down
      push stands). Set ends drag too, to the box's true scale (`g.prop` in `dragSetEnd`),
      between the set's other end and the wire ends.
  - **Notes** (`h.callouts`; Chris). Add › Note, then a click on a connector or splice, a wire's
    line or a set pins a note there (`placeNote` in `app.js`, preferring them in that order). A
    note stores where it's pinned relative to that part (`at`: a node's or set's spot as
    fractions of its size, a wire's `t` along its run; `Lo.noteAt`, `wireT`, `setGeom`), so it
    follows the part in either view, and its bubble sits `dx`, `dy` from the pin, with a leader.
    Dragging the bubble (`data-notebox`) moves it; clicking it opens Text, Part number and Qty in
    Properties (`railNote`). With a part number it's a BOM line. The sheet prints notes. A note
    goes with the part it's pinned to; one on a dissolved set moves to its first wire. Refs are
    N1, N2…; the drawing's numbered notes are still `h.notes`.
  - **How it works** (Chris): a ? button in the right pane's bottom-right corner pops a card up over
    the bottom of the pane, in either tab (`renderParts`, `.pane-help`); open until closed, kept in
    this browser (`fold.help`).
  - **Properties.** Several wires or a set show the **Wire set** panel. Its header's label edits in place (`.title-edit`), with a pencil that always shows on an
    accent chip at the end of the row (`.title-pen`; Chris: more prominent). It has Twist and Shield tick
    boxes, a **Held as** radio choice of None, Cable or Bundle (Chris: show the mutual exclusion), Label, Description and Part number (cable or shield), the wire length,
    each end's overhang with the total (`coversField`), Set color, and a clickable **Hierarchy**
    tree (`setTree`). Delete on a set dissolves
    it (`dissolveSet`) and never deletes wires. A wire's chips link to its sets. The Parts tab
    lists the wire sets as trees, and its Ends list is gone. A set clicked in that tree is selected without
    leaving Parts (`S.keepTab`), and its row shows an Edit chip (`.st-edit`, `edit-set`) that opens
    Properties (2026-11-07, Chris).
- **Diagram look (2026-11-06, Chris; the bundle, table and Wire bundle notes predate wire sets):**
  - A connector table's header shows a small sketch of the connector beside its ref (`sketchOf`,
    the view the drawing prints; the front when it prints both). A circular connector's sketch is twice as tall, and its header grows to hold it (`sz.hh`; 2026-11-07). Chris tried the header as a band
    down the card's side (2026-11-07) and kept it on top. Under it, the info row has the
    same two columns as the pin rows (Chris): family and gender ("JST GH receptacle") over the
    labels, and the count ("8-pins", "2-leads") over the pin numbers (`connInfo`).
  - A cable's wire rows sit under a dark, see-through sheath drawn as a cylinder: its right end is
    a full, lighter ellipse (`sheathFace`, drawn under the wires so they come out of it) and the
    jacket over the wires stops at that ellipse's near rim (`holder`, `sheathGeom`). The sheath
    leaves as much room under the last wire as over the first (cable `rowsBot` + 8), and a bundle's
    under a shrink-tube band at each end (`holder`), in place of the solid and dashed frames. Both
    are drawn over the wires, so row text has a paper halo. `BOX_END` widens boxes to make room.
    Only the header and info rows keep a frame.
  - Each housed connector (rect, D-sub, circular) has **Views: Front, Back, Both** in Properties,
    stored as `n.faceView` (unset means front). Back is the wire side, the mirror of the face
    (`shapes.js` `face(h, n, view)`, `views`, `fitViews`). The sheet prints the chosen views; Both
    takes a double-width cell. Leads, rings and ferrules have no back view.
  - Twisted wires twist inside their box (`conn.js` `twist`): any run of two or more wires of one
    twist group on neighboring rows (a pair, three motor wires…) is drawn as a helix seen from the
    side, a whole number of turns of about 40 units per wire, easing level into and out of the
    straight runs. The near-side stretches (`over`, `.w-over`) are drawn over the other wires, so
    they alternate over and under. A group wire on a row apart from the rest stays straight.
    A bundle of more than two wires (not one twisted set) is laced instead of banded (`lacing`):
    at each end a tie loops round the wires, with more ties between about every `LACE_GAP` (75; Chris): a thin ellipse slanted like a
    wrapped cord, round at the bottom (`tieHalf`), tied off at the top in a knot of two crossed lobes,
    a wrap and two tails (`laceKnot`), its
    far side drawn under the wires (in `boxBack`) and its near side, knot and tails over them.
    A bundle that is nothing but one twisted set (`b.twistOnly`) gets no bands, and its twist
    runs nearly the box's width; a cable keeps its sheath.
  - A box's label table (B1 or C1, count, gauge, length) sits under its wires, and a cable's note
    under its table (`sz.headY`, `sz.rowsBot`). Positions dragged before that move down so their
    wires stay put (`tableShift`): a bundle's unless its `h.place` entry has `v` ≥ 2, a cable's
    unless `v` ≥ 3. Entries saved now carry `v: 3`.
  - Selecting exactly one bundle's wires (a click on its label) titles Properties **Wire bundle**.
- **Canvas finish (2026-11-06, merged):** the Build canvas is meant to be
  fun to use (Chris: Apple, liquid glass). The reference audit and the rules are in
  `docs/look-2026-11.md`.
  - **The diagram.** `conn.render(…, { fx: true })` adds the finish, and only `renderCanvas` passes
    it: rounded, lit cards (`cardOpen`, clip ids `lmfx-*`), wire shade and gloss, metal contacts
    where wires land (`.cv-contact`), and pin targets while wiring (`.can`). Without `fx` the output
    is byte-identical to before, and the sheet never passes it.
  - **Connectors and splices stand out** from the cable drawings (Chris): a darker edge
    (`--cv-conn-edge`, 1.3), a lit header (`lmfx-conn-head`), a stronger shadow
    (`--cv-conn-shadow`), and glass: a faint shade down the card (`.cv-glass`, `lmfx-glass`) and a
    bright inner rim (`.cv-rim`), in both themes.
  - **Ends and splices.** Every wire-end dot (pin ends, splice ports and loose ends) is a metal
    contact ringed in its wire's color (`ring`, `--wc`), and it glows when grabbable. A splice's
    conductors are gold and meet in a silver crimp sleeve (`.cv-crimp`). A cable's cut end is a lit
    face (`lmfx-face`), and lacing is a light cord. While a wire end is dragged, its wire is lit
    (`carry`) and the pin it would land on fills in (`dropPin`, `.land`).
  - **The stage and the glass.** The stage is a lit gradient (`--cv-stage`). Glass capsules (`.glass`)
    hold the HUD, the zoom pill (`#coords`, `#zoom-val`) and the wiring tip.
  - **Motion:**
    - The camera only changes the viewBox (`setView`), and Fit and zoom glide (`glide`).
    - The intro runs once per harness.
    - A new wire draws itself in (`S.fresh`), and a dragged part lifts (`S.lift`).
    - A selected wire carries a pulse, phase-locked by `--phase` so a re-render doesn't restart it.
    - The wire being drawn is an elastic curve that snaps to the pin under the cursor (`drawGhost`).
    - Keys: F fits, + and − zoom, 0 shows actual size. Reduce Motion and Reduce Transparency are
      honored.
- **Splice ports and wire-end drags (2026-11-06, Chris):**
  - A splice is a box with a port (a circle on its edge) per wire, on the side the wire comes in,
    and lines inside from each side's ports to the ref, where they join (`spliceSvg`). Ports are one pitch
    apart, so wires leave parallel into the next block, and both sides are centered on the junction
    line, where the ref sits (Chris). A lone wire runs straight in. With an even count, the port
    just above the middle sits on the junction (two outputs: the top runs straight through). The box
    wraps its outermost ports with the same margin above and below (Chris) (`spliceSize`: `port0` is the
    junction, `dy` a port's offset from it). Drops slot in by the ports above the pointer.
    `n.ports` (`{ l, r }`, wire ids)
    holds the order a drag left; wires not listed go on the side facing their other end, sorted
    by where their wires go (`sides` in `layout`).
  - Every wire end has a dot to drag it by: a splice's ports, loose ends, and a small dot where a
    wire meets a pin (canvas only, `.cv-end`), each with an invisible r 9 grab circle (`.cv-hitend`). Drop it on a splice (side and slot under the
    pointer; the box grows), on a pin row, or on empty canvas, which leaves a **loose end**
    (`kind: 'loose'`, a dot snapped to the grid; the wire curves to it, in no box, and Checks warns).
    Dragging a splice port up or down reorders its side. The canvas previews the drop on a copy of
    the harness (`previewEnd`); hit tests use the layout from the drag's start (`dropTarget`).
  - `M.moveEnd(h, wireId, which, to)` does every end move, field edits included: it joins the new
    end with a segment when no route exists, drops unused segments without a length behind the old
    end, and removes a loose end no wire uses (`tidyLoose`, also on deleting wires).
- **From a board (2026-11-06):** Add › From a board lists Signoff EE boards and reads one's stored fab
  package (`assets/boards.js`).
  - **Which package:** the latest tagged revision's package (picked as EE's `latestRevision`
    does). If no revision is tagged, the latest stored Fabcheck run's package is used. The
    SHA-256 is checked.
  - **Parsing:** the package is unzipped with JSZip. Its IPC-356 netlist and BOM are read with
    Fabcheck's own parsers, vendored into `assets/vendor/` by `python tools/sync_vendor.py`
    (`--check` to verify).
  - **What an end gets:** the board's real pin names (`node.pinNames`), nets as pin labels
    (unnamed nets blank), the board part as *Mates with*, a family guessed from that part
    (`library.guessFamily`), and `node.board`.
  - **Pads left out:** mounting and shield pads (`MH1`, `S1`…).
  - **Suggested wires:** a connector's rail offers wires to any end with the same named nets on
    free pins (`boards.matches`).
  - **Access:** reading uses the token Signoff EE keeps in this browser (`signoff.token`). With no
    token, the modal asks you to sign in to EE.
  - **Demo:** `?demo` reads Fabcheck's made-up thermostat packages instead. Main PCBA J2 and
    Display J1 match on 6 nets.
  - **Tested** on a real project's stored package through the same reader in the browser (all
    connectors found, USB-C pin names kept, mounting and shield pads dropped). The live GitHub read
    with a real token hasn't been run in a browser.
- **Not built yet:**
  - the rest of the integration (Fabcheck connectors → EE summary → PL *Connectors & harnesses*;
    see the direction doc);
  - a revision table on the sheet;
  - connector sketches from STEP (paused; `step.js` and `occt-worker.js` are unused);
  - WireViz import and export;
  - tests.
- A client's in-house harness tool inspired the twist, shield and merged-leg ideas. Don't name it
  here (this repo is public), and no code or data from it goes in.

## Model and diagram

- **Wires and segments.** A wire needs a path through segments. `M.addWire` adds a direct segment
  (length unset) when its ends aren't joined yet, so wiring point to point needs no layout step.
- **Lengths.** A length is a segment length.
  - The rail edits it (`len.<segId>`) when every selected wire runs along that one segment.
  - Otherwise it shows the routed total.
- **Pin labels.** `node.pinLabels[pin]` holds the label, which is usually the board's net name. An
  empty label shows the wire's signal.
- **Columns** (`conn.js` `ranks`):
  - breadth-first from the busiest connector;
  - at equal distance a splice comes first, so it sits between the ends it joins;
  - each end goes one column past the furthest end feeding it;
  - boxes sit in the odd columns, and each column is ordered by the height of what feeds it.
- **The demo** (`?demo`) rebuilds whenever `LM.demo.VERSION` changes (stored as `demoVersion`).

## Layout

All files are classic scripts sharing `window.LM`, with no build step. JSZip and SheetJS load from
CDNs with the same pinned integrity hashes as Fabcheck. GitHub (`loom_data` read and write; Signoff EE's and PL's repos read only) is the only other network
use, and the CSP in `index.html` allows just those.

| File | What |
| --- | --- |
| `assets/model.js` | The graph: nodes (connector, splice, breakout), segments (length, covering), wires (pin to pin, routed through segments) and nested wire sets (twist, shield, cable or bundle). Also `analyze`, `checks`, `fromTo` and `bom`. |
| `assets/conn.js` | The connection diagram: boxes, column layout and SVG, for the canvas and the sheet. |
| `assets/boards.js` | Board connectors from Signoff EE's stored fab packages (GitHub, read only) or the demo packages. |
| `assets/store.js` | Sync with `loom_data` and the read of Signoff PL (see *Storage and Signoff PL* above). |
| `assets/vendor/` | Fabcheck's `ipc356.js` and `assembly.js`, and the Signoff engine's `model.js` and `github.js` (from EE). Don't edit; run `tools/sync_vendor.py`. |
| `tests/` | `test.html` (open over http) and `fake-hub.js`. |
| `assets/library.js` | Parametric connector families. Housing part numbers are suggested only where the series names them by pin count. |
| `assets/shapes.js` | Face views, labeled with the side shown, with a pin-1 mark. |
| `assets/sheet.js` | The paper sheet, a self-contained SVG with its own `.lm-sheet` styles. |
| `assets/app.js` | The UI. |
| `assets/demo.js` | The Smart Thermostat demo harness. |
| `assets/suite.css` | EE's `styles.css`, copied by `python tools/sync_suite_css.py`. Don't edit it here. |

- **Storage.** localStorage `loom.v1.*` (`loom.demo.*` in demo mode; the demo never syncs), the
  private repo `loom_data` when signed in, plus `.loom.json` files.
  Lengths are stored in mm.
- **Encoding.** Edit files with Python or the editor, not PowerShell `Set-Content`. That adds a BOM,
  and reading with `Get-Content` mangles UTF-8.
- **Running it.** Serve the tools folder (preview `signoff-suite-alt`, port 8774) and open
  `/loom/?demo`. After editing, the browser may serve cached scripts: run
  `fetch(f, { cache: 'reload' })` on each changed file, then reload.
