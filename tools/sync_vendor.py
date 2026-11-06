"""Copy Fabcheck's netlist and BOM parsers into assets/vendor/ so Loom reads fab packages the way
Fabcheck does. Don't edit the copies; change them in pcb_dfm and re-run this.

    python tools/sync_vendor.py           # copy
    python tools/sync_vendor.py --check   # exit 1 if a copy is stale
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "pcb_dfm" / "assets"
DST = ROOT / "assets" / "vendor"
FILES = ["ipc356.js", "assembly.js"]
HEADER = ("/* Vendored from pcb_dfm/assets/{name} (Fabcheck). Do not edit here: re-copy with tools/sync_vendor.py. */\n"
          "window.Fab = window.Fab || {{}};\n")

stale = []
for name in FILES:
    want = (HEADER.format(name=name) + (SRC / name).read_text(encoding="utf-8")).encode("utf-8")
    out = DST / name
    if "--check" in sys.argv:
        if not out.exists() or out.read_bytes() != want:
            stale.append(name)
        continue
    DST.mkdir(parents=True, exist_ok=True)
    out.write_bytes(want)
    print(f"Copied {SRC / name} -> {out}")
if stale:
    print("Stale: " + ", ".join(stale))
    sys.exit(1)
