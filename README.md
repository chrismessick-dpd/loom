# Loom

Loom is a harness drawing tool in the Dovetail Signoff suite, and a prototype. You add the ends,
click pin to pin to run wires, and group wires into cables. Loom draws the wiring diagram, the
connector faces, the wire list, the BOM, the notes and the title block on one printable sheet.

- **Hosted:** https://chrismessick-dpd.github.io/loom/ (try `?demo`)
- **From a board:** a connector can come from a Signoff EE board's stored fab package. It gets the
  board's pin names, nets as pin labels, and suggested wires to other ends with matching nets.
  Reading uses the GitHub access Signoff EE keeps in the browser and is read-only.
- **Storage:** harnesses stay in the browser until you save a `.loom.json` file.

It is a static site with classic scripts and no build step. Serve the folder above it (so
`../pcb_dfm` and `../ee_design_review` resolve) and open `loom/?demo`. See `CLAUDE.md` for the
layout, and `docs/direction-2026-11.md` for the design direction and the harness software audit.
