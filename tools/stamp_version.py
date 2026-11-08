"""Stamp Loom's asset URLs in index.html with ?v=<hash>, and assets/version.js with the same hash,
so browsers load fresh files after an update instead of mixing a new page with cached old scripts
(Pages caches about 10 minutes). The sidebar's sync pill shows the hash in its tooltip, "Build <hash>".

    python tools/stamp_version.py           # stamp
    python tools/stamp_version.py --check   # exit 1 if the stamp is stale

The hash covers index.html (without its ?v= stamps) and everything in assets/ except version.js.
Same scheme as the hub's tools/stamp_version.py. index.html keeps its line endings.
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
VERSION = ROOT / "assets" / "version.js"
ASSET_URL = re.compile(r'((?:src|href)="assets/[^"?]+)(\?v=[0-9a-f]*)?(")')


def read_html():
    with open(HTML, encoding="utf-8", newline="") as f:
        return f.read()


def content_hash(html):
    h = hashlib.sha256()
    h.update(ASSET_URL.sub(r"\1\3", html).replace("\r\n", "\n").encode("utf-8") + b"\0")
    for path in sorted(p for p in (ROOT / "assets").rglob("*") if p.is_file() and p != VERSION):
        data = path.read_bytes().replace(b"\r\n", b"\n")
        h.update(path.relative_to(ROOT).as_posix().encode() + b"\0" + data + b"\0")
    return h.hexdigest()[:12]


def main():
    html = read_html()
    digest = content_hash(html)
    stamped = ASSET_URL.sub(lambda m: m.group(1) + "?v=" + digest + m.group(3), html)
    version = "window.LM = window.LM || {}; window.LM.VERSION = '" + digest + "';\n"
    if "--check" in sys.argv:
        ok = stamped == html and VERSION.exists() and VERSION.read_text(encoding="utf-8") == version
        print(("up to date (" + digest + ")") if ok else "stale - run python tools/stamp_version.py")
        sys.exit(0 if ok else 1)
    with open(HTML, "w", encoding="utf-8", newline="") as f:
        f.write(stamped)
    VERSION.write_bytes(version.encode("utf-8"))
    print("stamped " + digest)


if __name__ == "__main__":
    main()
