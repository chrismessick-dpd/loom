# Loom: notes for Claude

Loom is a **prototype** harness drawing tool, standalone like Fabcheck. You add the ends, click pin to
pin to run wires, and group wires into cables. Loom then draws the sheet a tech builds from:
- a wiring diagram in the style of WireViz;
- connector face views;
- the wire list and the BOM;
- notes and a title block.

**Serial comma** (Chris, 2026-11-08): use the Oxford comma in every list of three or more, in UI text, docs, demo data, checklists, and commit messages: "A, B, and C". Never change check ids or data keys to fit it.

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

- **Cable labels move (2026-11-12, Chris: as the harness editor's wire labels).** Each cable's label hangs from a
  small dot on the cable with a leader line. The dot drags along the cable's first route (or its stub),
  `cab.labelAt` 0 to 1, and the label comes along; the label drags anywhere, `cab.labelOff` `{ dx, dy }` in mm from
  the dot, and the dot stays. Either drag first fixes the other half; one undo each; a click selects the cable.
  Unset, a label sits where it always did. Label edits don't re-route (the layout key leaves them out). A
  **Cable labels** box at the canvas's bottom right (as the harness's Wire labels) hides them, kept in this browser
  (`<ns>sysLabels`).

- **Sync fixes (2026-11-12, Chris: "sync with problems" and a GitHub rate-limit warning after 90 harnesses arrived
  at once).** Drawings for Signoff PL go up at most 15 harnesses a sync (`DRAW_MAX` in `store.js`); the rest go at
  the next syncs (about 200 uploads at once tripped GitHub's limit on creating content, and every sync retried them
  all). A system's stored summary is built from its own file alone (`summarize` normalizes a copy and runs `checks`
  with `own`): a placed system's block lists which system it is but no used count, and cables into it aren't
  checked there. A first sync read a parent before its children, so its summary was dropped, then put back.

- **Device ends (2026-11-12, Chris: a harness built onto its device, a motor, sensor, or flying leads, is one
  Loom harness with that device as an end).** A connector's Properties has *In a system: Plugs in / Is its
  device* (`n.atDevice`). A system never asks for a device end (`harnessEnds` leaves it out, so no open-end
  warning), and draws such a harness as a stub out of each connector it plugs into, ending in a small device
  mark, its label along the stub, with no route between its connectors (`deviceEnds`, `lo.dev`, `.sys-dev`).
  Tests 61.

- **Systems of systems (2026-11-12, Chris).** *Make external* on a connector shows it on the block of every
  system that places this one; *Place a system* (by link, never a copy; no loops) adds a system block
  (`kind: 'system'`, `b.system`) whose tabs are the placed system's external connectors, derived and never
  stored (`resolveAll`; path ids `<block>/<conn>`, one step per level; the parent's spots, exits, and
  Function in `b.tabs`). Cables plug into tabs; checks and New harness here look through to the board
  connector inside (`look`, `c.leaf`). The sidebar is a tree (`LM.system.tree`): top systems, the systems
  they place, and the harnesses each uses (a harness under every system using it; the rest stay in the
  project list), folded by path (`fold.sysTree`). See `docs/system.md`, *Systems of systems*. Tests 60.
  Restructuring the imported real system into board systems is a separate data step, not done.

- **Cable colors (2026-11-12, Chris).** Every kind of cable has Color in its panel (before Length on a harness
  cable): its state's color (unset), one of Loom's twelve wire colors (`M.COLORS`, solid, no stripe), or Custom
  with a picker (`cab.color`, a code or `#rrggbb`; `colorOf`, `colorField`). Set, the cable draws in it whatever
  its state; the glyph and dashes still show the state.

- **System How it works card (2026-11-12, Chris: as the harness editor's).** A ? in the system panel's bottom
  right opens a card of the moves over the panel's bottom (`helpHtml`, the harness's `.pane-help` styles, in a
  `.sys-side` wrapper so it doesn't scroll with the panel); open the first time, then remembered in this
  browser (`<ns>sysHelp`). The floating hint at the canvas's top is gone, wiring and empty-system cases too.

- **System highlights (2026-11-12, Chris).** The one selected cable draws 1.5 times as wide with a soft accent
  glow and a larger bead while the rest fade to 18% (`.sys-w.solo`). A selected block glows (the harness's
  selected-connector frame), each of its cables glows and carries the harness's soft current (`.sys-w.linked`,
  `.w-pulse.soft`), and every other cable and label fades to 18%.

- **System drag-select and group move (2026-11-12, Chris: as in the harness).** A left drag on empty
  system canvas draws a box: left to right picks blocks and cables wholly inside, right to left what it
  touches (blocks by their turned outline, cables by their drawn line; `marqueePick`, `drawMarquee`, lit with
  the harness's `.mq`); Shift adds. Several things are `S.sel = { kind: 'multi', blocks, cables }` (one alone is
  selected as itself, `selOf`; Shift-click a block or cable to add or remove it, `toggleSel`, and on a connector, its
  block); the panel lists them, each opening its own, with Delete (`multiHtml`,
  `delete-multi`, the Delete key too). Dragging a selected block moves every selected block, and selected
  cables' stored shapes move with them; a cable with one end moving keeps its shape. Panning is the right or
  middle button now (a left drag on empty canvas used to pan).

- **System blocks: name in the middle, and 90° turns (2026-11-12, Chris).** Each block shows its name large
  and upright in its middle (`.sys-center`, sized to the block, down to 7 px for a long name on a small
  device) and only its ref at the top left, as tall as the two rows it shared. R turns the selected block 90°
  clockwise and Shift+R back; right-click a block for Rotate left and Rotate right. `b.rot` (0, 90, 180, 270);
  `b.w`, `b.h`, the connectors' spots, and a chosen exit stay in the block's own frame (`rotOf`, `sizeOf`,
  `tabSpot`, `turnSide`), and the exit menu shows sides as they look now. A turn keeps the block's middle and
  forgets its cables' shapes. Tabs and text stay upright.

- **System grid (2026-11-12, Chris: as the harness canvas).** The system canvas bar has the harness's Grid
  menu: spacing Off, 1, 5, or 10 mm, kept with the system (`s.grid`, 1 mm by default), and Dots or Lines,
  the harness's own setting (`fold.gridStyle`, through `sysHooks.gridStyle`/`setGridStyle`). The grid is
  drawn as the harness draws it, and blocks and cable runs snap to it (`snap`, `snapU`; the straight snap's
  step too). Off: nothing snaps. Ctrl places a block or run anywhere, as for harness parts.

- **Harness pane: Parts adds, Properties lists (2026-11-12, Chris).** The Parts tab holds only Add
  (Connector, From a board, Splice, Note, and Table). Properties with nothing selected lists the splices,
  notes, and wire sets (`overviewHtml`), each row selecting its item; with none, the old hint. Any change of
  selection, clearing it too, shows Properties. `S.keepTab` and the set tree's Edit button there are gone.

- **System panel: Back, and a selected cable stands out (2026-11-12, Chris).** While a cable is selected,
  however it was picked, it keeps its selection pulse and every other cable and its label fades
  (`.sys-w.dim`). Any panel but the system's own has **‹ Back** at the top left of its head, which goes
  straight to the system's panel (`back`). (First built as list picks only, with a browser-like Back; Chris
  changed both.)

- **System toolbar (2026-11-12, Chris: as a harness's, top right).** A system's top right has Undo, Redo,
  Discard changes, and Save file (`sysToolbar` in `app.js`); the canvas bar keeps Fit. Discard changes shows
  while the open system has changes since the last sync and this browser kept that sync's copy, needs no
  dialog, and Ctrl+Z brings the changes back (`LM.system.discardTo`). The copy is kept at every system sync
  in IndexedDB (`loom-sysbase`, one record per storage namespace: `store.js` `sysBase`, `hasSysBase`,
  `loadSysBase`), not localStorage, where a second copy of a big system would crowd out the systems. When
  this browser kept no copy (a sync on an older version), Discard reads the exact version the last sync saw
  from GitHub, by the blob sha in the sync cache (`canDiscard`, `discardCopy`; harnesses too, Chris: on
  whatever page is open). Never synced: no Discard. Never in the demo. Save file downloads the system as a `.loom.json`, and Open a file (or a drop) opens one
  again as a new copy (`openDoc`). Tests 54. Not tried signed in with a real sync.

- **One engine for every Connection (2026-11-11, Chris: "any object that connects two blocks is a
  Connection"; the harness's routing is the baseline).** `assets/connect.js` (`LM.connect`) routes,
  shapes, and drags harness wires and system cables alike: `routeAll` is the harness's route-set code
  moved out of `conn.js` unchanged, and `grab`, `slide`, `release`, `bend`, `menuHtml`, and `apply` are the
  editor's run drag, bend, and route menu, now called by both canvases. `tests/golden.js` checks the
  harness routes exactly as before (hashes in `golden-data.js`; regenerate only on purpose with
  `tests/golden.html`). Systems lost their copies (`rounded`, per-cable grids, `POOL`, `RCACHE`); a cable
  keeps the harness's record per end (`cab.routes[end] = { v, a, b, mode }`; a bare v is read as `{ v }`),
  searches on a 12-unit grid (coarser on a big drawing), and has the right-click menu. route.js's search
  heap no longer allocates per step (same order): a 37-board system first routes in 1.2 to 1.9 s. Cables have kinds: generic (`link`, what a
  drawn cable starts as; Chris chose that over a harness), purchased (`bought`), and Loom harness; *What it is* in the panel changes it
  (`rekind`). Dragging a straight wire's end no longer leaves a broken shape. A drag moves a whole straight run (an
  end run from a stub out of its part); Shift-drag breaks it at the grab; Ctrl is off the grid, as for parts; within 5 grid steps of straight
  it snaps straight and holds there (`STICK`), and a run next to a top or bottom exit snaps under it, so
  the cable drops straight out of the connector (Chris; parts don't snap). See `docs/routing.md`, *One
  engine*, and `docs/system.md`, *Connections*. Tests 49. Not the same yet: a cable with three or more
  ends routes as a star, not a breakout with branches.

- **Systems (2026-11-11, Chris: phases 1 to 3 of `docs/system.md`, on `main`).** A system is a second kind
  of document (`assets/system.js`, `LM.system`) that places blocks (Signoff EE boards, drawn boards, and
  devices) to scale in mm, marks each connector Used with a Function (per placed block; Chris: copies of a
  board may differ), and plugs harnesses in. A cable is one use of a harness: `{ harness, ends: { <harness
  end node id>: { block, conn } | null }, lengthMm }`; a length makes it the variant `<PN>-<mm>`. It has
  its own store (`loom.v1.systems`, `currentSystem`), undo, canvas, and panel, and takes `#page` while open
  (`renderAll` hands over; `sysHooks` in `app.js` is all it gets from the harness side; `boardEnd` and
  `newHarnessFor` make New harness here). A board block's connectors sit where its package's
  pick-and-place puts them (`boards.js` `readZip` now returns `c.at` and `outline`). A connector the PnP leaves
  out (not fitted in its build variant) is placed at the middle of its pads in the IPC-356 netlist (`place`,
  2026-11-11, Chris: they were lined up along the bottom edge): the netlist's unit scale and offset are fitted on
  the parts both files list (`fitScale`; a real board fitted 283 parts to 0.001 mm), and `c.at.from` says which;
  the outline is every part and pad plus 4 mm. Only a connector in neither waits on the bottom edge.
  Each connector also has **Populated** (`c.fitted`; Chris, 2026-11-11: alternates in one place overlapped):
  unset, it follows the package (`fitted`: a connector only the netlist placed isn't populated). An
  unpopulated connector is drawn faint and dashed under the rest, can't be clicked or take a cable, and can't be
  Used (unticking Populated clears Used); the checks skip it, except a cable on one, which is an error. The
  block's panel lists every connector with Populated and Used; the connector's panel has both.
  **Exits on every side** (Chris, 2026-11-11): a cable leaves a tab from the side facing its block's nearest edge
  (`exitSide`, `tabGeom` `dx`/`dy`, `ex`/`ey`), or the side picked in the connector's panel (`c.exit`). One
  leaving up or down runs to a lead point `STUB_U` past the block's edge, then route.js routes level from there;
  `rounded` draws the whole path. **Pinout**: the connector's panel lists each pin and its net name from the EE
  board's netlist (Chris, 2026-11-11: pin and net name only, not what else is on the net), for checking
  connections later; a drawn block's pins take net names by hand. The panel's sections don't shrink
  (`.sys-panel > *`), or the table squeezed to its header. **Refresh from Signoff EE** in a board's panel re-reads its
  package and updates pins, positions, and size by connector ref, keeping ids, Used, Function, Populated, and exit.
  Plugged tabs have dark bold labels (`#04252a` on the accent). Demo `DEMO_V` 4.
  **Speed** (2026-11-11, a 37-block, 60-cable system took 4 s a render): the layout is kept until blocks, connectors,
  cables, or harness ends change (`layout` memo); each cable routes on its own grid round its ends (about 25k cells,
  its own two blocks not in the way), with route.js's search buffers shared (`POOL`) and routes cached by their ends
  and obstacles (`RCACHE`), so a drag re-routes only what it touches. Then: first draw about 1.3 s, a drag about 0.5 s,
  a selection about 0.3 s (mostly the DOM). Routes no longer spread apart from each other (`occupy` is gone).
  Blocks are drawn as the editor's connector cards (2026-11-11, Chris: they blended into the stage): `.cv-conn`
  with `.cv-card`, a `.cv-headbg` header band, `.cv-glass`, `.cv-rim`, and `.cv-frame`, the gradients (`lmfx-conn-head`,
  `lmfx-glass`, `lmfx-head`) defined in the system's own SVG; a device's frame is dashed.
  **Cable runs drag as the editor's wires do** (2026-11-11, Chris: same engine, exact logic; a straight cable
  couldn't be pulled up): any cable's line grabs the run under it, selected or not (as `runUnder`), and a click
  without moving selects it; an end run first gets a bend at the grab, a stub clear of its connector, and the new
  section drags (as `dragRun`, via `route.addBend`); a straight cable (`v` empty) lifts from the grab to the far
  end's corner; the run moves by the pointer's travel, on the grid (Ctrl: free); let go, `route.tidy`. A dragged
  shape is kept, as in the editor, even past the stubs (an odd count of values). New harness here makes a
  placeholder (the board end plus a generic far end), or, with a second connector Shift-picked, a
  board-to-board harness with the shared-net wires (`boards.matches`). Plug in a harness… ranks harnesses
  made from that connector first. Checks: used and unplugged, plugged and not used, two cables on a
  connector, open ends, pin counts, pin labels against the board's nets, and an end filled from another
  package. The harness rail shows "Plugs into …" on a plugged end (`plugsOf`). Sync: `store.js`
  `syncSystems` after the harnesses, in the data repo under `systems/` (the engine's layout under a data
  path: `systems/projects/<id>.json`), never `projects/`, which PL reads as harnesses; FTE only, not
  shared yet. `?system=<id>` opens one; the demo's home page has Demo system (both thermostat boards and
  the wall wiring). Tests 41.
  Then (2026-11-11, Chris: exactly the harness editor, with connectors as pins, boards as connector cards, and
  cables as wires): a click on a connector starts a cable (`S.pending`, the editor's ghost following the pointer
  and snapping to the connector under it, `.can` targets); a click on another connector finishes it, on the same
  one or anywhere else cancels it, Esc too. A drag on a block or any of its connectors moves the block. Each
  plugged end has a dot (`data-cend`) that drags onto another connector (re-plug) or empty canvas (left open), and
  an open end's ring drags onto a connector. A selected cable's runs drag, a double-click adds a bend, and the
  shape is kept per cable and end (`cab.routes`) until *Reset route*. Cables route at right angles round every
  block with `route.js` (`layout`; `tabGeom`: a terminal leaves the tab's side facing its block's nearer side).
  The canvas is drawn in the editor's units (`K` = 4 per mm) with class `lm-canvas`, so wires, gloss, the pulse,
  and the ghost are the editor's. Connectors on drawn blocks are placed by X and Y in their panel. Right or middle
  drag pans (left on empty canvas too; no marquee yet). `?demo` builds the demo system on load (`DEMO_V`). Not done: the board picture under the outline (Fabcheck's preview has no
  origin), a system sheet and harness BOM page, sharing, PL reading `summary` (phase 4), and a live sync.

- **Project groups fold (2026-11-11, Chris: as in Signoff EE).** The sidebar's client-project groups
  have EE's heading buttons (`toggle-group`: chevron, name, count; suite.css `.side-group-head`),
  closed ones kept in this browser (`fold.closedGroups`, by lowercase name). The group holding the open
  harness stays open, and folding it goes home. The Harnesses heading has EE's fold-all button
  (`fold-groups`, `.side-fold`, beside New; Collapse or Expand all projects; collapsing all goes home),
  shown only when the list is grouped. From Signoff PL's heading doesn't fold (`.lm-group-head`).

- **Printing (2026-11-11, Chris: three sections, each from a new page).** Print or PDF prints
  `LM.sheet.printDoc`, not the sheet's one SVG: 1) the wiring diagram, fitted to one page (`.pr-diagram`,
  `max-height` the page); 2) the connectors, each its own card 58 mm wide (two for Both views; three across
  Letter or A4), wrapping, so pages break between rows; 3) the wire list as an HTML table (its header
  repeats on every page, rows never split), then the BOM, notes, and title block. Each section starts a
  new page (`break-before`), and each heading names the harness. The sheet's `STYLE` draws the SVG parts
  (`printStyle`); print CSS is in `styles.css` (`.print-sheet .pr-*`), which also turns the suite's
  `visibility: hidden` print rule back on for the printout and makes the page white. The Paper and
  Orientation pickers beside the button default to "set in the print dialog", and then Loom sets no
  `@page` size, so the dialog keeps its Layout (landscape) choice; a page that sets a size hides it. The
  SVG and PNG exports and the Drawing view still use the one sheet (`sheet`; `connRows`, `connRowSvg`,
  `WIRE_COLS`, and `BOM_COLS` are shared). Checked by printing to PDF with headless Edge (Letter
  portrait and 11 × 17 landscape, with the wire list and connectors repeated to run over pages).

- **Tables (2026-11-11, Chris: place a table like a note).** Add › Table, then a click puts a 2 × 2 table's
  top-left there, on the grid (`placeTable`). A table is a note (`h.callouts`, ref T1…) with `c.table =
  { w, minH, cols, cells }`: its width, a least height, each column's share of the width (summing to 1),
  and the cells' text by row; `at: { kind: 'table', node, x, y }` keeps it from the nearest connector or
  splice's top-left like an area note (it stays when that part goes, shifted). So selection, the marquee,
  Delete, and undo work as for notes; it has no part number, so no BOM line. `conn.js` `tableGeom` lays it
  out: text wraps to its column (`wrapCell`, measured in the sheet's font on a canvas, 6% to spare; a
  word wider than the column breaks), each row as tall as its most wrapped cell, and what `minH` adds
  over the text shared by the rows. On the canvas (`dragTable`) the body drags it (grid, Ctrl free), an
  inner column line (`data-tblcol`) moves between its neighbors (`TBL_MIN` 24 each), and the selected
  table's bottom-right corner (`data-tblcorner`) sets the width (columns keep their shares) and, only past
  the text's height, `minH`. Properties (`railTable`): Rows and Columns (`M.sizeTable`: the last ones go
  with their text; new columns take an even share), and every cell as a box in a grid shaped like the
  table (`tbl.cell.<r>.<c>`, saved on change). Double-clicking a cell selects the table and puts the cursor
  in its box. The sheet prints tables (`.cv-table-*` in `sheet.js`). Tests 37.

- **Wire routing (2026-11-10, Chris; built on branch `routing`, merged to `main` and pushed).** Every
  group of wires (an outermost set, or the loose wires joining two parts whose pins are neighbors at
  both ends) rides a route from one end's pins to the other's, at right angles with rounded corners,
  round every connector and splice, from either edge of a connector (`assets/route.js`, `LM.route`;
  conn.js `routeAll`, `it.path.routed`). A drag on a wire's or set's straight run moves it (`runUnder`,
  `dragRun` in app.js; handles `.cv-run` on a selection), a double-click adds a bend, right-click offers
  *Walk around parts* / *Go behind parts*, and the shape is kept in `h.routes[box key]` (`v`, edges `a`
  and `b`, `mode`, a bundle's dragged split `split0`/`split1`); *Reset route* and *Auto layout* forget
  it. Labels sit clear of parts; wide routes ease where their wires can't take a corner. Real
  proportions is unchanged. Leads, anchors, and the arranged view's box are gone. Everything, with the
  known gaps, is in `docs/routing.md`. Tests 35 then (37 with tables), with made-up harnesses in `tests/fixture-fanout.js`.
- **Tools switcher (2026-11-09, Chris; pushed `b960a66`):** signed in, the sidebar's Dovetail Signoff list adds Signoff
  EE, ME, FW, and PL (FTE only, `R.access() === 'fte'`) and folds to a row of icons like Signoff EE's (`renderTools`,
  `setupToolsFold` in `app.js`, a copy of the engine's); signed out it's Fabcheck and All tools as before.
- **PL drawings use tables again (2026-11-09, Chris: the faces left the wires ending short of them;
  pushed `0d2b07e`).** `LM.sheet.diagram` keeps each connector's pin table, as in Build; the face views in their place
  (entry below) are gone. The rest stays: no background, thicker wires, dark colors lifted. Redrawn once (`src`).
- **PL drawing contrast (2026-11-09, Chris: a black wire vanished on a dark page; drop the dark background;
  pushed `7ebcf08`).** `LM.sheet.diagram` draws no paper and no wire-box fill (`.cv-box`), so the PL tile shows
  through. Wires get thicker with the drawing's width (`s`, 1.6 to 4 times, as it's shrunk to the tile). In
  the dark one, wire and pin colors under 0.18 luminance (black, dark brown, dark blue) are lifted toward gray
  keeping their hue (`lift`), inside a light outline (`#d1d1d6`). Every stored drawing is redrawn once (`src`).
- **Spade and D-sub types (2026-11-09, Chris; pushed `da45ee9`):** Configure's Type tiles now include D-sub
  (moved from the Wire to wire series into the Generic group, so it's a tile; still `dsub`) and **Spade
  connector** (`spade`, one position: a female quick-disconnect drawn from above, lead, insulated barrel
  flaring to the receptacle with its rolled edges; `shapes.js` `spade`). A spade is a BOM line like a ring
  terminal or ferrule.
- **PL drawings, dark and faces (2026-11-09, Chris: light thumbnails glared on a dark page; show connectors
  as their configured graphic, not the pin table; pushed `da45ee9`).** `LM.sheet.diagram` now returns `svg`
  and `dark` (the sheet's style with its colors turned round, `STYLE_DARK`, the cable sheath toned down),
  and hides each connector's table (`.cv-conn`) for its face (`S.face`, first view), fitted into the
  table's place against the side its wires leave from, ref over it; side views (leads, ring, spade,
  ferrule) mirror when the wires leave right. Only this picture changes: Build and the sheet keep tables.
  `storeDrawings` writes `diagram-dark.png` beside `diagram.png` (index image key `diagram-dark`, the
  dark twin PL shows on a dark page); `src` hashes both, so every stored drawing is redrawn once.
- **Drawings in Signoff PL (2026-11-09, Chris: a harness with wires should show its drawing in PL, as EE
  boards show their pictures; pushed `6f25017`, with `signoff_pl` `edca05e`).** At each sync, every harness with one or more wires stores
  its wiring diagram (the Drawing's harness part only, `LM.sheet.diagram`: white paper, cropped) as a PNG
  in the repo it lives in, laid out like Fabcheck's board previews: `drawing/<id>/preview/diagram.png` and
  `index.json` (`{ v, tool, id, src, hero: 'diagram', images }`). `store.js` `storeDrawings` runs after the
  harness files sync (`opts.thumb`, from `app.js`: `svg` and `drawingPng`, at most 1600 px on the longer
  side, never over 2×). `src` hashes the SVG; `loom.v1.drawings` remembers what was put where by
  'owner/repo|id', so it redraws only when the diagram changes or the harness moves to a shared repo. No
  wires, or deleted: the files go. index.json has no time, so a second browser commits nothing new. A
  failure is in `errors` and never fails the sync. PL reads it through `previews: 'drawing/'` on its Loom
  tool. Sharing (PL `share.js`) doesn't move `drawing/<id>/`; the next Loom sync draws it into the new
  repo, and the old copy in `loom_data` is ignored. The demo harness's PNG is 1600 × 685, 224 KB.
  Tests: 26. Not tried with a real token.
- **Copy and paste parts (2026-11-09, Chris; pushed `fa701d8`):** a right click that doesn't move (a right
  drag still pans) opens a menu on the canvas (`openCtx` in `app.js`, `.menu.lm-ctx`). On a connector or
  splice it selects it (unless it's already in the selection) and offers *Copy P1* (or *Copy 3 parts* for
  every part selected); anywhere it offers *Paste P1 here*. Ctrl+C and Ctrl+V do the same, pasting under
  the pointer, else clear of every part (`placeClear`). A paste is an exact copy with no wires under the
  next free designator of its own prefix (J6 → J7; `M.copyPart` drops `id` and a splice's `ports`,
  `M.pastePart` gives a new id and `nextRef`); pin labels, board, face, and custom drawing stay. Several
  parts keep their spacing. The clipboard is localStorage `loom.clip`, so it pastes into another harness
  or tab. In Real proportions a paste goes to `placeClear`. One undo reverts a paste. Test: 24.

- **Marquee and mixed selection (2026-11-07, Chris):** a left drag that grabs nothing on the canvas
  (empty stage, or a wire's line; since 2026-11-10 a loose wire's line drags its anchor instead,
  unless Shift is held) draws a selection box (`drawMarquee`, `finishMarquee` in `app.js`;
  the rect goes in `#ghost`, `.cv-marquee`). Dragged right to left it's green and dashed and picks
  everything it touches; left to right it's light blue and picks what lies wholly inside it. It
  picks everything: connectors and splices, wires and notes (bubble and area). A wire counts by its
  line in the open: points within `MQ_MARGIN` (8) of a connector's or splice's card are left out
  (`marqueeTargets` samples the drawn `.w-hit` path every `MQ_STEP` units at the drag's start).
  Shift adds to the selection; a box that picks nothing clears it (not with Shift). What it would
  pick lights as it's drawn (`.mq`), and Esc cancels. A finger still pans, and the right or middle
  button pans as before.
  - **The selection** (`S.sel`) is one kind, `{ kind, ids }`, or a mix, `{ kind: 'mix', ids: Set of
    'kind:id', parts: { kind: Set } }` (`selParts`, `mkSel`, `selHas`; `conn.js` reads it through
    `pickOf`). Picked wires regroup: every set whose wires are all picked stands for them
    (`collapseSets`, outermost first). Only whole sets select the sets (several show the sets
    panel); sets and more wires stay a wire selection, so Properties can make one set of them all
    (the guide's Bundle step). Shift-click toggles anything in or out (`toggleSel`), across kinds.
  - **Scoped options** (Chris: gray out what doesn't apply). A mix, or several connectors or
    notes, shows `railMulti`: the items by kind as chips (a chip narrows to that one), and, when
    wires or sets are in it, the wire set ticks and Held as disabled. Several sets show `railSets`:
    *Each set* (Twist and Shield, half-ticked `.tick.part` when only some have it; Held as; applied
    to every set by `setFlag` and `set-holder`), *Together* (one bundle or cable of all of them,
    `setFlag(flag, on, together)`, i.e. `makeSet` over their wires) and Set color. Label, part
    number and lengths are edited one set at a time.
  - **Drag and delete.** Dragging a selected connector, splice, or box moves the whole selection
    (`selectedKeys`: `n:<node>` and the box of each selected set or wire; `g.parts` in `onMove`,
    one snapshot), in Real proportions up and down only. Delete deletes every kind in it
    (`deleteSel`: notes, sets dissolved, wires, nodes). No tests (the canvas has none).

- **Storage and Signoff PL (2026-11-07, Chris; branch `store`, merged to `main` with Configure and pushed, as was `signoff_pl` branch `loom`):** harnesses
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
  - **Sync** runs on opening, from the footer's Sync button, and on Ctrl+S (Save file is the toolbar
    button; Ctrl+S saves a file only with no sign-in or in the demo). It uses the token Signoff EE keeps
    (`signoff.token`) and the owner in `signoff.v1.settings`; repos can be changed under
    `loom.v1.repos`. A 404 says to ask for access or create the repo. The footer says where harnesses
    are (`#sync-pill`, Signoff EE's pill: dot, title, and sub line, with the build hash in its tooltip;
    2026-11-07, Chris: match EE's footer), and the sidebar groups them by client project and dots
    unsynced ones.
  - **Signoff PL.** A harness has a client project (`h.project`, the Project field in the harness rail,
    suggested from PL's projects and the boards' clients; From a board fills it when empty). PL offers it
    in that PL project's tray like an EE board, and the PL Part made from it (`source: 'loom'`) is the
    link of record and its place in the tree; Loom never writes PL's repo. Each sync reads PL's data repo
    (read only, cached by blob sha, `loom.v1.pl`) for the project list and the Parts linking each
    harness, shown under Project ("In Signoff PL as a Part of"). A token that can't read PL skips it.
    Chris (2026-11-07): keep the tray; adding a harness to a PL project should be deliberate, so PL never
    adds one by itself.
  - **Discard changes** (2026-11-10, Chris): each sync keeps the harnesses as the repo has them
    (`loom.v1.base`; `R.base(id)` returns a copy only when it matches the hash that sync recorded, and
    `forget` drops it). The toolbar shows *Discard changes* before Save file when the open harness has
    unsynced changes and such a copy exists (`canDiscard`); it puts that copy back as one undoable
    step (`discardChanges`). Never in the demo, where Reset demo does it, and not for a harness never
    synced. Test 27. Not yet seen on screen (it needs a sign-in).
  - **Name and part number both ways**, with no tool writing the other's repo: Loom stamps `h.identAt`
    when Title or Part number change, PL stamps the node's `identAt` when its Part sheet changes them,
    and the newer side wins (`adoptFromPl` here before each push; `pl.js adoptHarnesses` after PL reads
    designs). Rev stays Loom's. Chris (2026-11-07): newest-wins after each tool syncs is fine for now.
  - **From Signoff PL (2026-11-08, Chris: new things wait in a tray in the tool they belong to).** A PL Part
    marked as a Placeholder for Loom (`source: 'loom'`, no `ref`) is read by `slimPl` (`planned`) and listed
    in the sidebar under *From Signoff PL* (`fromPlHtml`, dashed icon and a Start pill; the home page says how
    many wait) until a harness here names it (`waiting`). Start (`pl-start`, `startFromPl`) makes the
    harness with the Part's name and number, its PL project's client project (`clientProject`, else the PL
    project's name, as PL matches), and `h.plPart = { project, node, at }` (`at`: when it was started; Duplicate and conflict copies drop it), which `summarize` writes as
    `summary.plPart`; PL links the Part to it at PL's next sync (`signoff_pl/assets/pl.js` `claimPlanned`).
    The rail's Project hint says so until then. The PL cache (`loom.v1.plCache`) is now `{ v, files }`:
    bump `PL_CACHE_V` whenever `slimPl` keeps something new. Not in the demo (no PL there); tests 23.
  - **Deep link:** `?project=<harness id>` (what PL's Open in Loom uses) or `?harness=`.
  - **Tests:** `tests/test.html` (23 as of 2026-11-08, title PASS/FAIL): the envelope, summary, merge (and `forget` for an edit made while a sync brought another change), `adoptFromPl`,
    `slimPl`, and sync against `tests/fake-hub.js` (copied from PL), in storage `loom.test.*`
    (`LM.store.setNamespace`).
  - **Not done:** the live sync with a real token; PL's demo has no harness Part yet (its snapshot
    generator would need Loom's demo summary).
    Demo `VERSION` 16 (2026-11-08): the demo harness is an example for a made-up "Zone Controller"
    (Controller J6, Display board J1, 2200430-001), not the Smart Thermostat, whose boards meet through
    an FFC and screw terminals; the suite tour has the visitor build the thermostat's harness from Main
    PCBA J1 beside it. The banner's Reset demo (`demo-reset`) brings back only the demo harness; the
    home page's Demo harness button (`demo`) rebuilds it alone. A new selection unfolds a folded parts
    pane (`unfoldForSelection`, not while wiring), and `LM.app.guide.focus()` folds the menu and the
    parts pane and fits, for the tour's first Loom step.
  - **Shared harnesses (2026-11-07, pushed `fa25c7d`, with `signoff_pl` `f3e2087`):** Signoff PL shares a
    product's harnesses when it shares the product (`signoff_pl/docs/sharing.md`): each moves into its
    own private `review-loom-<slug>` repo and `loom_data/users.json` (the engine's roster) records it in
    `shared`. `sync` now runs like EE's workspace: the data repo with the roster (`loom.v1.roster`,
    `homes`, `caches` per repo), then the repos in the shared map (an FTE) or the `review-loom-*` repos
    the token lists (a contractor, `who.access`); a shared harness is never pushed back to `loom_data`,
    a file in a shared repo counts only for the harness the map puts there, and a contractor's copy
    whose repo they lost is dropped unless edited. The pill's tooltip and the rail's Project field say
    where a harness is kept (`R.isShared`, `R.homeOf`). Loom writes no roster itself. Tests: 19.
- **Configure a connector (2026-11-07, Chris; merged to `main` from branch `connector-config` in `b7aa21d`, pushed):** a Configure button
  in a connector's Properties header (`.cfg-open`; the face tile and a custom part's Positions field open it
  too) opens `assets/configure.js` (`LM.configure`), a window over the app (`#cfg-modal`). It sets the ref,
  name and type: the Generic families as tiles with their faces, any series from a list, or **Custom**. The
  existing Properties fields still edit the same node. The window edits a draft, and Make part (Apply for a
  family) writes it as one change, so one undo reverts it; Esc steps back (assigning, tool, selection) and
  then closes, and Ctrl+Z inside undoes the draft only.
  - **Custom** is family `custom` (`style: 'custom'`) with its drawing in `n.custom`, all in mm:
    `{ kind, mark, src, sketch: { shapes, pins }, model: { name, d, w, h, k, view, pins } }`. `kind` is the
    description shown in place of a family name (`library.kindName`: the info row, the sheet, the BOM).
    `pins[i]` is the mark for `M.pinList(n)[i]` (so board pin names like A1 work; a board's count is locked).
    `shapes.js` `custom` draws the face from it: the sketch or the model's edges, and a cavity per mark
    filled with its wire's color, on the canvas header, the Properties tile, and the sheet. The back view
    mirrors it left to right; gender doesn't flip a drawing made by hand. Switching to a family keeps
    `n.custom`, and the Family list offers Custom again once one exists.
  - **3D model tab:** import (or drop) STEP, IGES, or STL. OpenCascade reads it in `occt-worker.js` and
    `step.js` makes the mesh (STL parsed in `step.js`); three.js r149 (Partcheck's pinned build, loaded
    on first use) shows it orthographic, turned like a trackball (one quaternion, `V3.q`). Clicking a face
    looks straight at it (area-weighted normal of its b-rep face; up the nearest world axis), with the
    face under the pointer lit; ±X/Y/Z buttons and 90° turns too. Make face view runs `step.sketch` with
    that view basis (it now takes any `{ look, right, up }`), and only that hidden-line path is kept: the
    model stays in memory for the session (`meshes`), so changing the view after a reload means importing
    again. Fixed in `step.js` on the way: closed loops collapsed to dots in `simplify`, and inside-out
    meshes (negative volume) now flip their normals.
  - **Sketch tab:** Select, Rectangle, Rounded rectangle, Circle or ellipse, and Line (V R U C L), drag to
    draw (a click places a typical size; Shift squares), move and resize by eight handles, X/Y/W/H/R
    fields and Fill for the selection, a snap grid (0.1 to 2.54 mm; Alt places freely), wheel zoom, pan by
    right drag or empty space, Trace model to sketch over the model's face view.
  - **Assign Y/N:** the Positions count, then Assign (A): each click drops the next mark in pin order, onto
    the center of the smallest cavity under the pointer (a closed loop of the model's face, or a small
    sketched circle or box), else the grid. Chips re-place one position, right-click removes a mark,
    marks drag. Make part stays disabled until every position has a mark. Mark size is auto (70% of the
    closest spacing) or set.
  - **Face quality (2026-11-07, Chris: rough edges on a real M12 STEP).** Coarse tessellation was the
    cause: 1 mm contacts came out near-octagons, a hole's front and back rims were polygons turned against
    each other (doubled, notched outlines). Now `step.js` reads finer (`MESH`: bounding-box ratio 0.0004,
    0.1 rad), welds across neighboring cells, despeckles visibility (`despeckle`), chains along the
    straightest continuation at junctions, and turns rims that go all the way round into true circles
    (`roundPart`, outliers such as a slit's tick set aside; `model.c`, drawn as `<circle>`). Arcs of one
    circle adding up to half of it or more are round cavities (`model.f`, not drawn). Short ticks across
    rings are real model edges (contact slits) and the 3D view shows them too. On that connector: 85k
    triangles, 3.7 s to read, 0.7 s per face view, 23 KB stored.
    **Wobbly loops in the stage (2026-11-07, Chris: a clean 3D view, a messy face view, better off-axis)**
    were not the projection: `shapes.js` `customSvg` rounds coordinates to a tenth (right in px on the tile
    and the sheet), and the stage calls it at s = 1, in mm, so every vertex snapped to a 0.1 mm grid. It
    now rounds to a thousandth below s = 10. Checked on an 8-position circular STEP: the app's view was an
    exact `[-1, 0, 0]` and `sketch` gave the same path as a lab run that looked clean. Views a fraction of a
    degree off axis genuinely double every rim (front and back rims no longer coincide) in any renderer,
    so looks snap to the model's axes: `step.axes` lists the normals of the planar b-rep faces (one per
    direction, biggest first, 1% of the biggest or more) and the world axes, and `snapLook` in
    `configure.js` turns a look within `SNAP_DEG` (3°) of one into exactly that axis, on a face click (a
    curved face's mean normal is never exact) and in Make face view (a trackball turn), where the 3D
    view follows. Checked: a 2.3° tilt gives the same path as the exact view; 6.9° is left alone.
  - **The ring (2026-11-07, Chris).** While looking straight at a face (after clicking one or a ±X/Y/Z
    button, and in the face view) a ring sits just outside the face, with a dot at its turn (12 o'clock
    unturned). Dragging the dot turns the model about the axis into the screen and shows the angle: 1°
    steps, Shift 15°, Alt free (`ringStart`, `ringMove`; `ringSvg` draws both). The ring itself is faint
    (accent at 22%; Chris, 2026-11-07: much more transparent), the dot solid. In 3D it rolls the camera
    (`V3.roll`, `V3.faced`, which a free orbit clears); in the face view it turns the drawing from a
    snapshot taken at the grab, one undo. Picking a face zooms to fit it (`fitFace`, `faceRadius`: the
    model's reach from the view axis). The dot works during Assign without dropping a mark. The 3D turns
    used to run backwards: three.js's camera z points at the viewer, so +θ about it turns the picture
    clockwise (`spin`, Shift-drag).
  - **Turning the face (Chris: the key at 4 o'clock had to go to 12).** In the face view: ±90° buttons, a
    degrees field (`model.rot`), `[` and `]` (1°, Shift 15°), and **Point up**: click a feature and it turns
    to 12 o'clock about the connector's axis (the center of the biggest circle at least 30% of the face,
    else the frame's middle; `rotCenter`). It turns the stored drawing, circles, cavities, and marks exactly
    and turns `model.view` to match, so no model is needed (`rotate`). In 3D, Shift-drag rolls about the
    view axis. Marks snap to fitted circles first (`snapMark`), other closed loops only where none is.
  - Positions edits apply as typed, and the window swaps its Assign block and toolbar only when they
    change: typing 8 then clicking Assign used to lose that click to the re-render (Chris: locked out
    after going from 4 to 8). Enter makes the part only from Ref, Name, or Description.
  - The CSP now allows `cdn.jsdelivr.net` for scripts and fetches, and `blob:` workers (three.js and
    OpenCascade, as Partcheck).
  - **Mirror** (2026-11-08, Chris): Mirror horizontally and Mirror vertically (`mirrorBtns`) after the turn
    buttons, in 3D and in the face view. In 3D the model is reflected about the screen's axis through its
    center (in `V3.group.matrix`, so three.js keeps winding and lighting; flipping the camera's frame lit the
    back faces), drags and the ring turn the right way on screen (`mirSign`), and Make face view negates the
    view's `right` or `up` and stores `model.mirror`. In the face view `mirror2d` flips the drawing,
    circles, cavities, and marks about the drawing's middle, like `rotate`, and Change view restores the
    flip in 3D.
  - **Load demo model** (2026-11-08, Chris; pushed `da4348b` with the guide's custom connector steps): in `?demo`, beside Import a model…, it reads
    `assets/demo/S11M0-P08M.stp.gz` (a vendor's 8-position circular connector, 632 KB of STEP gzipped to
    116 KB; `DecompressionStream`, then `importFile` as a `File`). The guide's Custom connector steps use it.
  - **Find a model** (2026-11-09, Chris: fetch connector models from online libraries inside the suite;
    pushed `64be995`). *Find a model…* beside Import (and *Find…* once a model is in) opens a search over
    the stage (`openFind`, `findHtml`, `drawFind`, `fetchKicad`; Esc or Back closes it). It searches the
    KiCad 3D library's connector and terminal block models, 3,497 names (about 2,800 are pin headers and
    sockets) listed at one commit in `assets/kicad-models.json` by `python tools/kicad_index.py`
    (`--check` says whether KiCad's master has moved; names only, no models in this repo). Every word
    must match; models with the draft's position count (`posOf`: `1x08`, `DSUB-9`) sort first, and a
    tick shows only those; 80 rows at most. A pick (or Enter for the top row) fetches that STEP from
    GitLab's API at the recorded commit, which sends `Access-Control-Allow-Origin: *` (the CSP allows
    `https://gitlab.com`), and reads it like an import. Below the list, links search TraceParts,
    SnapMagic, DigiKey, Octopart, and 3D ContentCentral for the typed text in a new tab; download there
    and drop the file here. KiCad's models are the board half: no cable-side crimp housings.
    - Why no vendor API (researched 2026-11-09): TraceParts has one (`api-gateway.traceparts.com`, CORS
      open), but it needs a key Chris applies for (days of validation, price unstated), a manufacturer
      catalog name per lookup, and a `userEmail` per file; its terms forbid passing files on and want a
      credit link; whether its file host allows browser reads is unknown. If added, the key would sit in
      Settings in this browser like the GitHub token (FTE only). SnapMagic, Ultra Librarian, SamacSys,
      PARTcommunity, and the connector makers have no public API; McMaster's needs a client certificate.
    - Tried in the browser on the demo: JST XH search, fetch, 3D view, Make face view, Find… again, Esc.
  - Not done: pinch zoom on the stage, no tests.

- **The guide (2026-11-07, Chris: an interactive getting started for new users):** `assets/guide.js`,
  `window.LoomGuide` (also `LM.guide`). 27 steps in seven chapters (Welcome, The canvas, Ends and wires,
  Wire sets, Views and notes, The drawing, Done), each a title, what the feature is, a *Try it*
  instruction, a `setup` (view, selection, panels shown, the How it works card closed), and a `spot`
  (selectors, first one shown wins; a list of selectors in a spot rings them as one box), ringed by
  `#lm-guide-spot`, moved every animation frame. 2026-11-08 (Chris): after *A connector from a board*,
  *A custom connector* (Connector, Configure, Custom, 3D model, Load demo model, each ringed in turn) and
  *Its face and positions* (Make face view, then Positions and Assign as one ring, then Make part; the
  card sits at the window's right middle, `at: 'right'`, or the bottom right where that would cover the
  Configure stage, below about 1950 px wide); *Running a wire* then wires to the custom connector and
  tries the sets. *How it works* is always the second to last step. The harness panel stays folded through the guide (`panels(false)`; Chris, 2026-11-08) except on *The harness panel*. *Adding parts* has no Try it (a
  step's `do` is optional), since the custom connector steps add the connector. The card takes the
  canvas corner (bottom left, bottom right, top right, top left) covering least: never the ring if it
  can help it, then the fewest connectors and splices, the newest weighted most (a new connector lands
  at the bottom left). It moves again when a part is added or removed or a window opens or closes
  (`watchLayout`), unless dragged. A new
  spot scrolled out of its pane (not just the window, `viewOf`) is scrolled into view, so *Sets inside
  sets* rings the Hierarchy and brings it up in Properties (2026-11-08, Chris). The card
  (`#lm-guide`) has Back/Next, a Contents list to jump anywhere, and drags by its top line. In a
  step's text, `{From a board}` names something on screen (drawn as a chip, `.lg-ui`) and `{k:Esc}` a
  key (`.lg-key`), so a button's name doesn't read as part of the sentence (Chris); the suite tour does
  the same with `{…}` (`.t-ui`). The demo opens with Real proportions off. Steps ring Properties in
  the parts pane, and the rail only on a phone (`props()`; on a wide screen the rail is the harness
  panel). Shift-click (Chris: a missed one cleared the selection and the left panel glowed): a wire's
  hit line is at least 12 px on screen (`--k`, the zoom, set in `setView`), a shift-click on empty
  canvas keeps the selection, and a shift or Ctrl mousedown on the canvas doesn't select page text. It sits at the
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
  WireViz, RapidHarness, Wirely), the EE → PL → Loom connector integration, and the harness software
  audit with its feature options list. Chris: strip it back to a clean interface and add features as
  needed; the first concept could be ripped out.
- **Rewritten 2026-11-06:**
  - The Build canvas is the connection diagram (`assets/conn.js`), laid out automatically, with no
    + handles.
  - Dragging came back the same day (Chris). Connectors, splices, and boxes drag by any part of them
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
  - A new connector or splice (Add, C, From a board) lands clear of every other part (2026-11-08,
    Chris: they landed on dragged ones, which the auto layout doesn't see). `placeClear` keeps the auto
    layout's spot when it's 30 units clear all round, else places the part (`h.place`) at the nearest
    free spot on the pitch, within the diagram and a part's width round it.
  - The harness panel (the left rail) starts folded (2026-11-08, Chris: `fold.rail` defaults to true),
    and clicking a harness in the menu opens it when folded. Folding or opening it by hand is kept.
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
  - The formboard renderer (`render.js`), breakouts in the UI, coverings in the UI, and the
    Formboard/Wiring sheet toggle are gone. The model still has segments, breakouts, and coverings,
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
    cable, shield, bundle, or twist has no leads. In Real proportions the path is the box.
    - Twists ride leads too (branch `wire-ends`, Chris): a twist packs its wires like a shield, and
      its helix runs by distance along the path (`twistSpan`: `ua`, `ub`), so it follows the curves.
    - **Anchors on loose wires** (2026-11-10) and the leads above are gone on branch `routing`: groups
      ride routes there (see *Wire routing* at the top).
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
    - A check moving P1, P2, and P4 to 54 spots, anchors pulled out, found no wire or band edge
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
  - **Cables, shields, and bundles pack their wires** (2026-11-07, Chris: look more like a cable;
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
    - Wire paths (`runPts`), lanes, twist leaders, and `wireAt` all go through the packing
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
    Each boxed wire's label (from, color, and to, in its box's shared columns, `sz.cols`,
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
    - In this view connectors, splices, sets, and stacks drag only up and down (2026-11-07, Chris),
      snapped like the arranged view (first port on the grid). The heights are kept in `h.propY`
      by item key (`n:<node id>`, `b:<box key>`), apart from `h.place`, and Auto layout here
      forgets only them. A box nobody moved whose end was moved centers its rows on its ends.
      Once anything was moved, what was moved goes first and stays put, and anything else that
      overlaps takes the nearest free height above or below (with nothing moved, the old top-down
      push stands). Set ends drag too, to the box's true scale (`g.prop` in `dragSetEnd`),
      between the set's other end and the wire ends.
  - **Notes** (`h.callouts`; Chris). Add › Note, then a click on a connector or splice, a wire's
    line, or a set pins a note there (`placeNote` in `app.js`, preferring them in that order). A
    note stores where it's pinned relative to that part (`at`: a node's or set's spot as
    fractions of its size, a wire's `t` along its run; `Lo.noteAt`, `wireT`, `setGeom`), so it
    follows the part in either view, and its bubble sits `dx`, `dy` from the pin, with a leader.
    Dragging the bubble (`data-notebox`) moves it; clicking it opens Text, Part number, and Qty in
    Properties (`railNote`). With a part number it's a BOM line. The sheet prints notes. A note
    goes with the part it's pinned to; one on a dissolved set moves to its first wire. Refs are
    N1, N2…; the drawing's numbered notes are still `h.notes`.
    **Area notes** (2026-11-07, Chris): in Add › Note, a drag (not a click) draws a light dashed
    rounded box (`at: { kind: 'area', node, x, y, w, h, e }`). x, y are from the top-left of the
    connector or splice nearest the box when drawn, so it follows that part between views
    (`areaRect` in `conn.js`; world coordinates when there was none). Its edge drags it
    (`data-areaedge`; the inside lets clicks through), its corners resize it when selected
    (`data-areah`), and its pin is the same dot, sliding round the edge (`data-areapin`, `e` 0–1
    clockwise from the top-left, `C.edgeAt`/`edgeT`) while the bubble stays put. `dragArea` and
    `placeArea` in `app.js`. An area note stays when its part is deleted (it then sits off by that
    part's old position).
  - **How it works** (Chris): a ? button in the right pane's bottom-right corner pops a card up over
    the bottom of the pane, in either tab (`renderParts`, `.pane-help`); open until closed, kept in
    this browser (`fold.help`).
  - **Properties.** Several wires or a set show the **Wire set** panel. Its header's label edits in place (`.title-edit`), with a pencil that always shows on an
    accent chip at the end of the row (`.title-pen`; Chris: more prominent). It has Twist and Shield tick
    boxes, a **Held as** radio choice of None, Cable, or Bundle (Chris: show the mutual exclusion), Label, Description, and Part number (cable or shield), the wire length,
    each end's overhang with the total (`coversField`), Set color, and a clickable **Hierarchy**
    tree (`setTree`). Delete on a set dissolves
    it (`dissolveSet`) and never deletes wires. A wire's chips link to its sets, and its Sets section
    (2026-11-08, Chris) lists the sets it sits in, outermost first, as an indented chain down to the
    wire itself, each with its chip and a description in words (`wireSetChain`, `setDesc`: "Shielded
    twisted pair", "2 wires", "1 set inside", a cable's or shield's description and part number);
    clicking a row selects that set. The Parts tab
    lists the wire sets as trees, and its Ends list is gone. A set clicked in that tree is selected without
    leaving Parts (`S.keepTab`), and its row shows an Edit chip (`.st-edit`, `edit-set`) that opens
    Properties (2026-11-07, Chris).
- **Diagram look (2026-11-06, Chris; the bundle, table, and Wire bundle notes predate wire sets):**
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
    takes a double-width cell. Leads, rings, and ferrules have no back view.
  - Twisted wires twist inside their box (`conn.js` `twist`): any run of two or more wires of one
    twist group on neighboring rows (a pair, three motor wires…) is drawn as a helix seen from the
    side, a whole number of turns of about 40 units per wire, easing level into and out of the
    straight runs. The near-side stretches (`over`, `.w-over`) are drawn over the other wires, so
    they alternate over and under. A group wire on a row apart from the rest stays straight.
    A bundle of more than two wires (not one twisted set) is laced instead of banded (`lacing`):
    at each end a tie loops round the wires, with more ties between about every `LACE_GAP` (75; Chris): a thin ellipse slanted like a
    wrapped cord, round at the bottom (`tieHalf`), tied off at the top in a knot of two crossed lobes,
    a wrap and two tails (`laceKnot`), its
    far side drawn under the wires (in `boxBack`) and its near side, knot, and tails over them.
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
  - **Ends and splices.** Every wire-end dot (pin ends, splice ports, and loose ends) is a metal
    contact ringed in its wire's color (`ring`, `--wc`), and it glows when grabbable. A splice's
    conductors are gold and meet in a silver crimp sleeve (`.cv-crimp`). A cable's cut end is a lit
    face (`lmfx-face`), and lacing is a light cord. While a wire end is dragged, its wire is lit
    (`carry`) and the pin it would land on fills in (`dropPin`, `.land`).
  - **The stage and the glass.** The stage is a lit gradient (`--cv-stage`). Glass capsules (`.glass`)
    hold the HUD, the zoom pill (`#coords`, `#zoom-val`), and the wiring tip.
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
  - WireViz import and export;
  - tests beyond sync (`tests/test.html` covers `store.js` only).
- A client's in-house harness tool inspired the twist, shield, and merged-leg ideas. Don't name it
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
CDNs with the same pinned integrity hashes as Fabcheck; three.js and OpenCascade (Configure's 3D tab)
from jsDelivr with Partcheck's. GitHub (`loom_data` read and write; Signoff EE's and PL's repos read
only) and GitLab (one KiCad STEP per Find a model pick, read only) are the only other network use, and
the CSP in `index.html` allows just those.

| File | What |
| --- | --- |
| `assets/model.js` | The graph: nodes (connector, splice, breakout), segments (length, covering), wires (pin to pin, routed through segments), and nested wire sets (twist, shield, cable, or bundle). Also `analyze`, `checks`, `fromTo`, and `bom`. |
| `assets/conn.js` | The connection diagram: boxes, column layout, and SVG, for the canvas and the sheet. |
| `assets/boards.js` | Board connectors from Signoff EE's stored fab packages (GitHub, read only) or the demo packages. |
| `assets/store.js` | Sync with `loom_data` and the read of Signoff PL (see *Storage and Signoff PL* above). |
| `assets/vendor/` | Fabcheck's `ipc356.js` and `assembly.js`, and the Signoff engine's `model.js` and `github.js` (from EE). Don't edit; run `tools/sync_vendor.py`. |
| `tests/` | `test.html` (open over http) and `fake-hub.js`. |
| `assets/library.js` | Parametric connector families. Housing part numbers are suggested only where the series names them by pin count. |
| `assets/shapes.js` | Face views, labeled with the side shown, with a pin-1 mark; custom faces from `n.custom`. |
| `assets/configure.js` | The Configure window: ref, name, type, and a custom face from a 3D model or a sketch with assigned positions; Find a model. |
| `assets/kicad-models.json`, `tools/kicad_index.py` | The KiCad library's connector and terminal block model names at one commit, for Find a model. |
| `assets/step.js`, `occt-worker.js` | STEP, IGES, and STL to a mesh, and a view's visible edges as one path. |
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
