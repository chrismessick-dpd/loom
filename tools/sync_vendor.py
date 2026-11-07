"""Copy what Loom borrows from its sibling tools into assets/vendor/. Don't edit the copies; change them
at the source and re-run this.

- ipc356.js, assembly.js   Fabcheck's netlist and BOM parsers (pcb_dfm), so Loom reads fab packages
                           the way Fabcheck does.
- model.js, github.js      the Signoff engine (ee_design_review): GitHubStore, which syncs Loom's
                           harnesses with its private data repo, and the merge helpers it needs.

    python tools/sync_vendor.py           # copy
    python tools/sync_vendor.py --check   # exit 1 if a copy is stale
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DST = ROOT / "assets" / "vendor"
FAB = ROOT.parent / "pcb_dfm" / "assets"
EE = ROOT.parent / "ee_design_review" / "assets"
FAB_HEADER = ("/* Vendored from pcb_dfm/assets/{name} (Fabcheck). Do not edit here: re-copy with tools/sync_vendor.py. */\n"
              "window.Fab = window.Fab || {{}};\n")
EE_HEADER = "/* Vendored from ee_design_review/assets/{name} (the Signoff engine). Do not edit here: re-copy with tools/sync_vendor.py. */\n"
FILES = [(FAB, "ipc356.js", FAB_HEADER), (FAB, "assembly.js", FAB_HEADER),
         (EE, "model.js", EE_HEADER), (EE, "github.js", EE_HEADER)]

stale = []
for src, name, header in FILES:
    if not (src / name).exists():
        print(f"{src / name} not found; skipped")
        continue
    body = (src / name).read_text(encoding="utf-8").replace("\r\n", "\n")
    want = (header.format(name=name) + body).encode("utf-8")
    out = DST / name
    if "--check" in sys.argv:
        if not out.exists() or out.read_bytes().replace(b"\r\n", b"\n") != want:   # git may check copies out CRLF
            stale.append(name)
        continue
    DST.mkdir(parents=True, exist_ok=True)
    out.write_bytes(want)
    print(f"Copied {src / name} -> {out}")
if stale:
    print("Stale: " + ", ".join(stale))
    sys.exit(1)
