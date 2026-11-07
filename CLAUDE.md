# Loom: notes for Claude

Loom is a **prototype** harness drawing tool, standalone like Fabcheck. You add the ends, click pin to
pin to run wires, and group wires into cables. Loom then draws the sheet a tech builds from:
- a wiring diagram in the style of WireViz;
- connector face views;
- the wire list and the BOM;
- notes and a title block.

Read `../CLAUDE.md` first for the suite's hard rules. The name is final (Chris, 2026-11-06, after
briefly trying "Lacing"). Repo: `chrismessick-dpd/loom` (public, Pages from `main`); only the hub
links to it so far. Before every commit:
1. Run `python tools/stamp_version.py` (`--check` verifies). It puts `?v=<hash>` on the asset URLs
   and writes the hash to `assets/version.js`. Open pages update themselves from that file, as in
   the other tools: they check 5 s after opening, every 5 minutes and on focus, reload when idle,
   and say "Tool updated" (`checkForUpdate` in `app.js`).
2. Grep the diff for client names and part numbers (`../CLAUDE.md`).

## Status (2026-11-06)

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
    5, 10 (default) or 20, set in the Grid control over the canvas. Ctrl places freely. Every port
    (pin rows, box wire rows) is on one pitch, `G.PITCH` = 20, and a drag snaps a part's first port
    (`sz.port0`), not its top edge, so ports on different parts share grid lines and wires run
    straight. Grid steps must divide the pitch (an old 40 reads as 20). Auto layout also puts ports
    on the pitch.
    **Auto layout** clears `h.place`. A click without movement still selects, or starts a wire
    on a pin.
  - The right pane has two tabs, **Parts** (the parts list and Add palette) and **Properties** (the
    selection's fields and its Delete button). A new selection switches to Properties, and clearing
    it goes back to Parts (`renderParts`, `propsHtml`). The left rail shows only the harness, except
    under 860 px, where the right pane is hidden and the rail shows the selection.
  - Boxes follow option (b): one box per cable group, and other wires are bundled per end pair
    (`B1`, `B2`…).
  - The canvas and the drawing sheet use the same diagram. The sheet stays a plain paper diagram;
    the canvas adds a finish (see *Canvas finish* below).
  - The formboard renderer (`render.js`), breakouts in the UI, coverings in the UI and the
    Formboard/Wiring sheet toggle are gone. The model still has segments, breakouts and coverings,
    so a Layout view can come back.
- **Diagram look (2026-11-06, Chris):**
  - A connector table's header shows a small sketch of the connector beside its ref (`sketchOf`,
    the view the drawing prints; the front when it prints both).
  - A cable's wire rows sit under a dark, see-through sheath with rounded ends, and a bundle's
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
    A bundle that is nothing but one twisted set (`b.twistOnly`) gets no bands, and its twist
    runs nearly the box's width; a cable keeps its sheath.
  - A bundle's label table (B1, count, gauge, length) sits under its wires; a cable's stays on top
    (`sz.headY`, `sz.rowsBot`). Bundle positions dragged before that change move down by
    `BUNDLE_SHIFT` so their wires stay put; entries saved since carry `v: 2`.
  - A twisted wire's row gets a thin leader (`.cv-lead`) from the left of its text to where its
    twist starts (`twistStart`). Boxes with twisted wires, other than a bundle that is one twisted
    set, get `LEAD` more room left of the text for it.
  - Selecting exactly one bundle's wires (a click on its label) titles Properties **Wire bundle**.
- **Canvas finish (2026-11-06, branch `sleek-build`, not merged):** the Build canvas is meant to be
  fun to use (Chris: Apple, liquid glass). The reference audit and the rules are in
  `docs/look-2026-11.md`.
  - **The diagram.** `conn.render(…, { fx: true })` adds the finish, and only `renderCanvas` passes
    it: rounded, lit cards (`cardOpen`, clip ids `lmfx-*`), wire shade and gloss, metal contacts
    where wires land (`.cv-contact`), and pin targets while wiring (`.can`). Without `fx` the output
    is byte-identical to before, and the sheet never passes it.
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
  - storing harnesses in a private repo;
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
CDNs with the same pinned integrity hashes as Fabcheck. GitHub (read only) is the only other network
use, and the CSP in `index.html` allows just those.

| File | What |
| --- | --- |
| `assets/model.js` | The graph: nodes (connector, splice, breakout), segments (length, covering), wires (pin to pin, routed through segments) and groups (twist, shield, cable). Also `analyze`, `checks`, `fromTo` and `bom`. |
| `assets/conn.js` | The connection diagram: boxes, column layout and SVG, for the canvas and the sheet. |
| `assets/boards.js` | Board connectors from Signoff EE's stored fab packages (GitHub, read only) or the demo packages. |
| `assets/vendor/` | Fabcheck's `ipc356.js` and `assembly.js`. Don't edit; run `tools/sync_vendor.py`. |
| `assets/library.js` | Parametric connector families. Housing part numbers are suggested only where the series names them by pin count. |
| `assets/shapes.js` | Face views, labeled with the side shown, with a pin-1 mark. |
| `assets/sheet.js` | The paper sheet, a self-contained SVG with its own `.lm-sheet` styles. |
| `assets/app.js` | The UI. |
| `assets/demo.js` | The Smart Thermostat demo harness. |
| `assets/suite.css` | EE's `styles.css`, copied by `python tools/sync_suite_css.py`. Don't edit it here. |

- **Storage.** localStorage `loom.v1.*` (`loom.demo.*` in demo mode), plus `.loom.json` files.
  Lengths are stored in mm.
- **Encoding.** Edit files with Python or the editor, not PowerShell `Set-Content`. That adds a BOM,
  and reading with `Get-Content` mangles UTF-8.
- **Running it.** Serve the tools folder (preview `signoff-suite-alt`, port 8774) and open
  `/loom/?demo`. After editing, the browser may serve cached scripts: run
  `fetch(f, { cache: 'reload' })` on each changed file, then reload.
