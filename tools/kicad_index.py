"""List the KiCad 3D library's connector and terminal block models into assets/kicad-models.json, for
Configure's Find a model (configure.js). Loom searches that list in the browser and fetches only the
STEP picked, from GitLab's API at the commit recorded here, so a pick always gets the same file.

    python tools/kicad_index.py            # rebuild from the library's current master
    python tools/kicad_index.py --check    # exit 1 if master has moved since the list was made

The library is https://gitlab.com/kicad/libraries/kicad-packages3D, CC-BY-SA 4.0 with an exception
for models used in a design (see its LICENSE.md). Only file names go in this repo, no models.
Unauthenticated GitLab API reads, about 60 of them; no token.
"""
import json
import pathlib
import sys
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "kicad-models.json"
PROJECT = "kicad/libraries/kicad-packages3D"
API = "https://gitlab.com/api/v4/projects/" + urllib.parse.quote(PROJECT, safe="")
# Folders worth searching for a harness end: connectors and terminal blocks.
PREFIXES = ("Connector", "TerminalBlock")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "loom-kicad-index"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r), r.headers


def tree(path, ref):
    out, page = [], 1
    while True:
        q = urllib.parse.urlencode({"path": path, "ref": ref, "per_page": 100, "page": page})
        rows, headers = get(API + "/repository/tree?" + q)
        out += rows
        nxt = headers.get("X-Next-Page")
        if not nxt:
            return out
        page = int(nxt)


def head():
    c, _ = get(API + "/repository/commits/master")
    return c["id"], c["committed_date"][:10]


def main():
    sha, date = head()
    if "--check" in sys.argv:
        cur = json.loads(OUT.read_text(encoding="utf-8")).get("sha") if OUT.exists() else None
        print("current" if cur == sha else "stale: master is " + sha[:10])
        return 0 if cur == sha else 1
    dirs = sorted(r["name"] for r in tree("", sha) if r["type"] == "tree" and r["name"].startswith(PREFIXES))
    lib = {}
    for d in dirs:
        names = sorted(r["name"][:-5] for r in tree(d, sha) if r["type"] == "blob" and r["name"].lower().endswith(".step"))
        if names:
            lib[d[: -len(".3dshapes")] if d.endswith(".3dshapes") else d] = names
        print(d, len(names))
    data = {
        "v": 1,
        "project": PROJECT,
        "sha": sha,
        "date": date,
        "license": "CC-BY-SA 4.0 with an exception for use in designs",
        "dirs": lib,
    }
    OUT.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print("wrote", OUT.relative_to(ROOT), sum(len(v) for v in lib.values()), "models,", OUT.stat().st_size // 1024, "KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
