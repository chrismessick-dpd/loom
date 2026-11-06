# Loom: notes for Claude

Loom is a **prototype** harness drawing tool, standalone like Fabcheck. You add the ends, click pin to
pin to run wires, and group wires into cables. Loom then draws the sheet a tech builds from:
- a wiring diagram in the style of WireViz;
- connector face views;
- the wire list and the BOM;
- notes and a title block.

Read `../CLAUDE.md` first for the suite's hard rules. The name is final (Chris, 2026-11-06, after
briefly trying "Lacing"). Repo: `chrismessick-dpd/loom` (public, Pages from `main`); only the hub
links to it so far. Before pushing, grep the diff for client names and part numbers (`../CLAUDE.md`).

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
    5, 10 (default), 20 or 40, set in the Grid control over the canvas. Ctrl places freely.
    **Auto layout** clears `h.place`. A click without movement still selects, or starts a wire
    on a pin.
  - Boxes follow option (b): one box per cable group, and other wires are bundled per end pair
    (`B1`, `B2`…).
  - The canvas is a paper diagram that follows the theme. The drawing sheet uses the same diagram.
  - The formboard renderer (`render.js`), breakouts in the UI, coverings in the UI and the
    Formboard/Wiring sheet toggle are gone. The model still has segments, breakouts and coverings,
    so a Layout view can come back.
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
