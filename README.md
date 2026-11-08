# Loom

Loom is a harness drawing tool in the Dovetail Signoff suite, and a prototype. You add the ends,
click pin to pin to run wires, and group wires into cables. Loom draws the sheet a tech builds
from.

**Hosted:** https://chrismessick-dpd.github.io/loom/ (add `?demo` for a made-up Smart Thermostat
harness).

## Features

**Build**: a WireViz-style wiring diagram, laid out automatically.
- **Arranging.** Drag a connector, splice, or box to move it; it snaps to the grid. Hold Ctrl to
  place it anywhere. The grid size (or Off) is set over the canvas, and **Auto layout** forgets the
  dragged positions. Positions are saved with the harness and used on the drawing.
- **Navigating.** Drag with the right (or middle) mouse button to pan, and use the wheel to zoom.
  **Fit** (F) frames the diagram. A left drag on empty canvas does nothing.
- **Panels.** The harness panel (details, the selection's inspector, checks) is on the left. The
  parts pane (ends, splices, cables, Add) is on the right. The buttons at the canvas's top corners
  fold either one away, and the browser remembers it.
- **Connectors.** Each is a table with a header, its family, gender and pin count, and one row per
  pin with its label.
  - Families: JST, Molex, TE, D-sub, M8/M12, generic, flying leads, ring terminals, and ferrules.
    Housing part numbers are suggested where the series names them.
  - Pin labels are usually net names.
- **Wires.** Click a pin, then a pin on another end or a splice. Each wire has a color (IEC 60757
  codes, with stripes), a gauge and a signal. *Wire 1:1* runs pin *n* to pin *n* between two ends.
- **Cables and bundles.**
  - Shift-click wires to make a cable, a twisted pair, or a shield.
  - Each cable gets its own box (`4x · 0.13 mm² (26 AWG) · 300 mm`). Other wires are bundled by the
    two ends they join.
  - Lengths are set per box, face to face.
- **Selecting.** Selecting an end, wire, or cable dims everything unrelated.

**From a board**: add a connector from a Signoff EE board's stored fab package.
- Loom reads the latest tagged revision's package, or the latest stored Fabcheck run when none is
  tagged.
- It gets the board's pin names, with mounting and shield pads left out, and its nets as pin labels.
- It suggests the mating family from the board's part number.
- It offers wires between ends whose pins carry the same net.
- Reading is read-only and uses the GitHub access Signoff EE keeps in the browser.

**Drawing**: one printable sheet.
- **Contents:** the wiring diagram, a face view of each connector (with pin 1 and the side shown),
  the wire list, the BOM, numbered notes, and a title block.
- **Export:** SVG, PNG, or print and PDF.
- **Wires section:** under the sheet, it opens to the editable wire list. It has CSV export and
  paste from a spreadsheet (`P1.3, P2.3, I2C_SDA, BU, 28`).

**BOM**: housings, terminals per wired pin, splices, wire by gauge and color, cables, shields, and
coverings. Lengths include an allowance (5% by default). CSV export.

**Checks**:
- duplicate refs;
- wires on pins that don't exist, or two wires on one pin;
- gauges outside a terminal's range;
- missing colors, gauges, or lengths;
- unused pins and loose ends.

**Everything else**
- **Storage:** signed in to Signoff EE in this browser, harnesses sync with Loom's private repo
  (`loom_data`, one file per harness, `projects/<id>.json`): on opening, with the Sync button, or with
  Ctrl+S. A harness changed both here and elsewhere since the last sync keeps the newer version and
  saves the other as a "(conflict copy)". Signed out, they stay in this browser. Either way you can
  save a `.loom.json` file, and open one or drop it on the page.
- **Signoff PL:** give a harness its client project (Project, in the harness panel) and it waits in
  that Signoff PL project's tray, to be placed in the product like a board. Its name and part number
  can then be edited in either tool; the latest edit wins.
- **Shortcuts:** undo and redo (Ctrl+Z, Ctrl+Shift+Z), Sync (Ctrl+S; Save file when signed out), add a connector (C), fit the
  diagram (F), cancel (Esc) and Delete.
- **Look:** light and dark themes, shared with the rest of Signoff. Lengths are stored in mm and
  shown in mm and in.

## Running it

It's a static site of classic scripts with no build step.
- **Libraries:** JSZip and SheetJS load from CDNs with pinned integrity hashes.
- **Locally:** serve the folder above Loom, so `../pcb_dfm` and `../ee_design_review` resolve, and
  open `loom/?demo`.
- **Before committing:** run `tools/stamp_version.py`. It stamps `?v=` on asset URLs and writes the
  build hash that open pages watch to update themselves.
- **Copied files:**
  - `assets/suite.css` comes from Signoff EE, through `tools/sync_suite_css.py`.
  - `assets/vendor/` holds Fabcheck's netlist and BOM parsers, copied by `tools/sync_vendor.py`.

See `CLAUDE.md` for the code layout, and `docs/direction-2026-11.md` for the design direction, the
harness software audit and the feature options list.
