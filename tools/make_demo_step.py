"""Write the made-up demo connector STEP files (AP214, planar B-rep solids) into demo/.

    python tools/make_demo_step.py

Each solid is a 2D polygon, with holes, extruded along Z. Curved parts are many-sided prisms, so
the sketch's tangent-edge filter and silhouettes get exercised. The mating face looks toward +Z.
"""
import math, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "demo"


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]  # counter-clockwise


def circle(cx, cy, r, n=48):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def extrude(outer, holes, z0, z1):
    """Planar faces of a prism; each face is (normal, [outer loop, hole loops...]) with outward normals."""
    faces = []
    top = [[(x, y, z1) for x, y in outer]] + [[(x, y, z1) for x, y in reversed(h)] for h in holes]
    bot = [[(x, y, z0) for x, y in reversed(outer)]] + [[(x, y, z0) for x, y in h] for h in holes]
    faces.append(((0, 0, 1), top))
    faces.append(((0, 0, -1), bot))
    for loop in [outer] + [list(reversed(h)) for h in holes]:
        for i, a in enumerate(loop):
            b = loop[(i + 1) % len(loop)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            l = math.hypot(dx, dy)
            faces.append(((dy / l, -dx / l, 0), [[(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)]]))
    return faces


class Step:
    def __init__(self):
        self.lines, self.n = [], 0
        self.points, self.verts, self.edges = {}, {}, {}

    def add(self, text):
        self.n += 1
        self.lines.append(f"#{self.n}={text};")
        return self.n

    @staticmethod
    def r(v):
        s = f"{v:.6f}".rstrip("0")
        return s if not s.endswith("-0.") else "0."

    def point(self, p):
        k = tuple(round(c, 6) for c in p)
        if k not in self.points:
            self.points[k] = self.add(f"CARTESIAN_POINT('',({','.join(self.r(c) for c in k)}))")
        return self.points[k]

    def direction(self, d):
        l = math.sqrt(sum(c * c for c in d))
        return self.add(f"DIRECTION('',({','.join(self.r(c / l) for c in d)}))")

    def vertex(self, p):
        k = tuple(round(c, 6) for c in p)
        if k not in self.verts:
            self.verts[k] = self.add(f"VERTEX_POINT('',#{self.point(k)})")
        return self.verts[k]

    def oriented_edge(self, a, b):
        ka, kb = tuple(round(c, 6) for c in a), tuple(round(c, 6) for c in b)
        key = (ka, kb) if ka < kb else (kb, ka)
        if key not in self.edges:
            p, q = key
            d = [q[i] - p[i] for i in range(3)]
            l = math.sqrt(sum(c * c for c in d))
            vec = self.add(f"VECTOR('',#{self.direction(d)},{self.r(l)})")
            line = self.add(f"LINE('',#{self.point(p)},#{vec})")
            self.edges[key] = self.add(f"EDGE_CURVE('',#{self.vertex(p)},#{self.vertex(q)},#{line},.T.)")
        same = ".T." if key[0] == ka else ".F."
        return self.add(f"ORIENTED_EDGE('',*,*,#{self.edges[key]},{same})")

    def face(self, normal, loops):
        bounds = []
        for i, loop in enumerate(loops):
            oes = [self.oriented_edge(loop[j], loop[(j + 1) % len(loop)]) for j in range(len(loop))]
            el = self.add(f"EDGE_LOOP('',({','.join('#%d' % e for e in oes)}))")
            bounds.append(self.add(f"{'FACE_OUTER_BOUND' if i == 0 else 'FACE_BOUND'}('',#{el},.T.)"))
        o = loops[0][0]
        e = [loops[0][1][k] - o[k] for k in range(3)]
        ax = self.add(f"AXIS2_PLACEMENT_3D('',#{self.point(o)},#{self.direction(normal)},#{self.direction(e)})")
        plane = self.add(f"PLANE('',#{ax})")
        return self.add(f"ADVANCED_FACE('',({','.join('#%d' % b for b in bounds)}),#{plane},.T.)")

    def solid(self, name, faces):
        ids = [self.face(nrm, loops) for nrm, loops in faces]
        shell = self.add(f"CLOSED_SHELL('',({','.join('#%d' % f for f in ids)}))")
        return self.add(f"MANIFOLD_SOLID_BREP('{name}',#{shell})")

    def write(self, path, product, solids):
        head = [
            "APPLICATION_CONTEXT('automotive design')",
            "APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#1)",
            "PRODUCT_CONTEXT('',#1,'mechanical')",
            f"PRODUCT('{product}','{product}','',(#3))",
            "PRODUCT_DEFINITION_FORMATION('','',#4)",
            "PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design')",
            "PRODUCT_DEFINITION('design','',#5,#6)",
            "PRODUCT_DEFINITION_SHAPE('','',#7)",
            "SHAPE_DEFINITION_REPRESENTATION(#8,#20)",
            "(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))",
            "(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))",
            "(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())",
            "UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#10,'distance_accuracy_value','')",
            "(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#13))GLOBAL_UNIT_ASSIGNED_CONTEXT((#10,#11,#12))REPRESENTATION_CONTEXT('',''))",
            "CARTESIAN_POINT('',(0.,0.,0.))",
            "DIRECTION('',(0.,0.,1.))",
            "DIRECTION('',(1.,0.,0.))",
            "AXIS2_PLACEMENT_3D('',#15,#16,#17)",
            "PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#4))",
        ]
        rep = f"#20=ADVANCED_BREP_SHAPE_REPRESENTATION('{product}',(#18,{','.join('#%d' % s for s in solids)}),#14);"
        body = [f"#{i + 1}={t};" for i, t in enumerate(head)] + [rep] + self.lines
        text = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Loom demo connector, made up'),'2;1');\n"
                f"FILE_NAME('{path.name}','2026-11-02T00:00:00',('Dovetail'),('Dovetail'),'Loom','Loom','');\n"
                "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n"
                + "\n".join(body) + "\nENDSEC;\nEND-ISO-10303-21;\n")
        path.write_text(text, encoding="ascii", newline="\n")
        print(f"wrote {path.relative_to(ROOT)} ({len(text) // 1024} kB)")


def numbered(step):
    # Entity numbers 1-20 are the header block written above; ours start at 21.
    step.n = 20
    return step


def housing():
    """A 2.0 mm pitch, 4-position receptacle housing (made up): cavities with recessed contacts,
    a latch on top and two polarizing ribs underneath."""
    s = numbered(Step())
    cav = [rect(x - 0.6, -0.95, x + 0.6, 0.55) for x in (-3, -1, 1, 3)]
    solids = [s.solid("body", extrude(rect(-4.95, -2.25, 4.95, 2.25), cav, 0, 6))]
    solids.append(s.solid("latch", extrude(rect(-1.6, 2.25, 1.6, 3.0), [], 1.5, 5.6)))
    solids.append(s.solid("latch-ramp", extrude(rect(-1.1, 3.0, 1.1, 3.45), [], 4.2, 5.6)))
    for x in (-4.1, 4.1):
        solids.append(s.solid("rib", extrude(rect(x - 0.35, -2.7, x + 0.35, -2.25), [], 0, 6)))
    for x in (-3, -1, 1, 3):
        solids.append(s.solid("contact", extrude(rect(x - 0.32, -0.55, x + 0.32, 0.15), [], 0.4, 4.5)))
    s.write(OUT / "demo-housing-2mm-4p.step", "DEMO-HOUSING-2MM-4P", solids)


def circular():
    """An M8-style 4-pin plug face (made up): a round body with a keyway, a coupling nut, and four
    pins standing proud of the face."""
    s = numbered(Step())
    body = circle(0, 0, 3.6)
    key = [p for p in body if not (abs(p[0]) < 0.6 and p[1] > 0)]  # flatten a notch at the top
    solids = [s.solid("insert", extrude(key, [], 0, 8))]
    solids.append(s.solid("nut", extrude(circle(0, 0, 5.2, 6), [circle(0, 0, 3.9, 48)[::-1]], 0, 6)))
    for i in range(4):
        a = math.radians(45 + 90 * i)
        solids.append(s.solid("pin", extrude(circle(1.8 * math.cos(a), 1.8 * math.sin(a), 0.5, 24), [], 4, 9.5)))
    s.write(OUT / "demo-m8-4p-plug.step", "DEMO-M8-4P-PLUG", solids)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    housing()
    circular()
