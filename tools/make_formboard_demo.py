# python tools/make_formboard_demo.py assets/demo
# Makes Loom's two made-up formboard demo references (Acme Climate's Smart Thermostat, nothing real):
# formboard-demo.dxf, a 2D layout board in mm, and formboard-demo.stl, an enclosure tray in mm.
import struct, sys, os
out = sys.argv[1]

# ---- DXF (R12-style ASCII, $INSUNITS 4 = mm). Only LINE, CIRCLE, and LWPOLYLINE, which Loom reads.
ents = []
def rect(x, y, w, h):
    ents.append(['LWPOLYLINE', (8, 'OUTLINE'), (90, 4), (70, 1)] + [p for (a, b) in [(x, y), (x + w, y), (x + w, y + h), (x, y + h)] for p in ((10, a), (20, b))])
def line(x0, y0, x1, y1, layer='GUIDE'):
    ents.append(['LINE', (8, layer), (10, x0), (20, y0), (11, x1), (21, y1)])
def circle(x, y, r, layer='PEGS'):
    ents.append(['CIRCLE', (8, layer), (10, x), (20, y), (40, r)])
rect(0, 0, 360, 220)                      # the layout board
for (x, y) in [(10, 10), (350, 10), (350, 210), (10, 210)]: circle(x, y, 4, 'HOLES')
rect(40, 110, 80, 50.7)                   # Main PCBA's place
rect(220, 110, 72, 45.8)                  # Display & Sensor Board's place
rect(40, 30, 30, 20)                      # the wall wiring terminal's place
# Guide lines for the harness paths, 20 mm wide, with pegs every 30 mm.
line(120, 125, 220, 125); line(120, 145, 220, 145)
for x in range(135, 220, 30): circle(x, 135, 2.5)
line(45, 50, 45, 110); line(65, 50, 65, 110)
for y in range(65, 110, 30): circle(55, y, 2.5)
def dxf():
    L = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES']
    for e in ents:
        L += ['0', e[0]]
        for c, v in e[1:]:
            L += [str(c), (('%.3f' % v).rstrip('0').rstrip('.') if isinstance(v, float) else str(v))]
    L += ['0', 'ENDSEC', '0', 'EOF']
    return '\r\n'.join(L) + '\r\n'
open(os.path.join(out, 'formboard-demo.dxf'), 'w', newline='').write(dxf())

# ---- STL (binary, mm): a tray 200 x 140 mm, 3 mm floor, 3 mm walls 35 mm tall, and 6 mm square standoffs
# 5 mm tall under each board's corners, flush with them, so a board placed over them sits with its corners on
# theirs. Separate closed boxes, as a quick CAD export might give.
tris = []
def box(x0, y0, z0, x1, y1, z1):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    for a, b, c in [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]:
        tris.append((v[a], v[b], v[c]))
W, D, T, H = 200, 140, 3, 35
box(0, 0, 0, W, D, T)
box(0, 0, T, W, T, H); box(0, D - T, T, W, D, H); box(0, T, T, T, D - T, H); box(W - T, T, T, W, D - T, H)
def standoffs(x, y, w, h):
    for cx, cy in [(x + 3, y + 3), (x + w - 3, y + 3), (x + w - 3, y + h - 3), (x + 3, y + h - 3)]:
        box(cx - 3, cy - 3, T, cx + 3, cy + 3, T + 5)
standoffs(12, 75, 80, 50.7)     # Main PCBA
standoffs(112, 75, 72, 45.8)    # Display & Sensor Board
def normal(a, b, c):
    u = [b[i] - a[i] for i in range(3)]; w = [c[i] - a[i] for i in range(3)]
    n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    l = sum(x * x for x in n) ** 0.5 or 1
    return [x / l for x in n]
with open(os.path.join(out, 'formboard-demo.stl'), 'wb') as f:
    f.write(b'Loom demo: made-up enclosure tray, mm'.ljust(80, b' '))
    f.write(struct.pack('<I', len(tris)))
    for t in tris:
        f.write(struct.pack('<3f', *normal(*t)))
        for p in t: f.write(struct.pack('<3f', *p))
        f.write(b'\0\0')
print(len(ents), 'DXF entities,', len(tris), 'STL triangles')
