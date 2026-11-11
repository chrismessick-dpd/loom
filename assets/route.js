// Wire routing (Chris, 2026-11-10): wires walk around the parts in straight runs at right angles,
// joined by rounded corners, and every straight run in the middle can be dragged to shape them.
//
// A route runs from terminal A to terminal B. A terminal is a point where the route leaves or
// arrives level (along x): `out` is the way it leaves A (+1 right, -1 left), `in` the way it arrives
// at B. So a route is always level at both ends, and its shape is the list of its middle runs'
// positions, `v`: the first vertical run's x, the next level run's y, the next vertical run's x, and
// so on, ending with a vertical run's x (an odd count). An empty list is a straight level route.
//   v = [x1]          A ─ (x1, A.y) │ (x1, B.y) ─ B
//   v = [x1, y2, x3]  A ─ (x1, A.y) │ (x1, y2) ─ (x3, y2) │ (x3, B.y) ─ B
// Moving a part moves its terminal: the end runs follow it and the middle runs stay put.
//
// `auto` finds a route on a grid (A*: length, a cost per bend, and a cost for running along or
// across routes laid down before it, so trunks spread out instead of lying on each other), around
// rectangles it may not enter. `shape` draws a route with rounded corners as samples along it, each
// with its arc length s and the normal on its left (nx, ny), the form conn.js's paths take.
(function (LM) {
  'use strict';

  // ── Values and corners ──
  // The corners of a route, A and B included, in order. Zero-length runs are kept, so run j of the
  // result is always the run between corners j and j + 1, and run j (1 to v.length) is set by v[j - 1].
  function corners(A, B, v) {
    const out = [{ x: A.x, y: A.y }];
    let x = A.x, y = A.y;
    v.forEach((val, k) => { if (k % 2 === 0) x = +val; else y = +val; out.push({ x, y }); });
    if (v.length) out.push({ x, y: B.y });
    out.push({ x: B.x, y: B.y });
    return out;
  }
  // The runs of a route: { j, axis ('h' level, 'v' vertical), a, b, k (its index in v, or -1 for
  // the two end runs, which belong to the terminals) }.
  function runs(A, B, v) {
    const C = corners(A, B, v), out = [];
    for (let j = 0; j < C.length - 1; j++) {
      const a = C[j], b = C[j + 1], end = j === 0 || j === C.length - 2;
      out.push({ j, axis: j % 2 === 0 ? 'h' : 'v', a, b, k: end ? -1 : j - 1 });
    }
    return out;
  }
  // Whether a stored route still fits its terminals: an odd count of runs (or none, when A and B
  // are level), and its first and last vertical runs at least `stub` out from A and B the way they
  // leave and arrive, so a route never doubles back into a part.
  function fits(A, B, v, stub) {
    if (!Array.isArray(v) || v.some(x => !isFinite(+x))) return false;
    if (!v.length) return Math.abs(A.y - B.y) < 0.5 && (B.x - A.x) * A.out > 0 && A.out === B.in;
    if (v.length % 2 === 0) return false;
    return (v[0] - A.x) * A.out >= stub - 0.5 && (B.x - v[v.length - 1]) * B.in >= stub - 0.5;
  }
  // Tidy a route after an edit: a run that has shrunk to nothing goes, and the runs either side of
  // it, now in line, become one (Chris: drag a run flush with its neighbor to remove that bend).
  function tidy(A, B, v) {
    v = v.map(Number);
    const near = (p, q) => Math.abs(p - q) < 0.5;
    for (let again = true; again;) {
      again = false;
      const m = v.length;
      for (let k = 0; k < m; k++) {
        if (k % 2 === 0) {
          // A vertical run with level runs at the same height either side.
          const y0 = k === 0 ? A.y : v[k - 1], y1 = k === m - 1 ? B.y : v[k + 1];
          if (!near(y0, y1)) continue;
          if (m === 1) v = [];
          else if (k === m - 1) v.splice(k - 1, 2);
          else v.splice(k, 2);
          again = true; break;
        } else {
          // A level run with vertical runs at the same x either side.
          if (!near(v[k - 1], v[k + 1])) continue;
          v.splice(k, 2);
          again = true; break;
        }
      }
    }
    return v;
  }
  // A bend added where run j is clicked (at p): a zero-length jog in it, so the new piece can be
  // dragged out. Returns the new v and the index in it of the run to drag.
  function addBend(A, B, v, j, p) {
    v = v.slice();
    const R = runs(A, B, v)[j];
    if (!R) return null;
    if (R.axis === 'h') {
      const y = R.a.y;
      if (j === 0) { v.splice(0, 0, p.x, y); return { v, k: 1 }; }
      if (j === v.length + 1) { v.splice(v.length, 0, y, p.x); return { v, k: v.length - 2 }; }
      v.splice(j, 0, p.x, y);
      return { v, k: j + 1 };
    }
    const x = R.a.x;
    v.splice(j, 0, p.y, x);
    return { v, k: j + 1 };
  }

  // ── Drawing a route ──
  // Samples along the route with rounded corners. Each corner's radius is r, less where its runs
  // are short: up to half a middle run, or all of an end run (a terminal has no corner of its own).
  function shape(A, B, v, r) {
    const raw = corners(A, B, v), C = [];
    raw.forEach(p => { const q = C[C.length - 1]; if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.01) C.push(p); });
    // Drop points in line with their neighbors (a zero-length run leaves two runs in line).
    for (let i = 1; i < C.length - 1;) {
      const a = C[i - 1], b = C[i], c = C[i + 1];
      if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 0.01) C.splice(i, 1); else i++;
    }
    const pts = [];
    const push = (x, y, tx, ty) => {
      const q = pts[pts.length - 1];
      if (q && Math.hypot(x - q.x, y - q.y) < 0.01) return;
      pts.push({ x, y, nx: -ty, ny: tx });
    };
    const dirOf = (a, b) => { const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / L, y: (b.y - a.y) / L, L }; };
    if (C.length < 2) { const d = { x: A.out || 1, y: 0 }; push(A.x, A.y, d.x, d.y); push(A.x + d.x, A.y, d.x, d.y); }
    else {
      const d0 = dirOf(C[0], C[1]);
      push(C[0].x, C[0].y, d0.x, d0.y);
      for (let i = 1; i < C.length - 1; i++) {
        const a = C[i - 1], c = C[i], b = C[i + 1], d1 = dirOf(a, c), d2 = dirOf(c, b);
        const rr = Math.max(0, Math.min(r, d1.L * (i === 1 ? 1 : 0.5), d2.L * (i === C.length - 2 ? 1 : 0.5)));
        const turn = d1.x * d2.y - d1.y * d2.x, dot = d1.x * d2.x + d1.y * d2.y;
        if (rr < 0.5 || Math.abs(turn) < 1e-6) { push(c.x, c.y, d1.x, d1.y); push(c.x, c.y, d2.x, d2.y); continue; }
        // An arc from S (rr before the corner) to E (rr after it), about O.
        const S = { x: c.x - d1.x * rr, y: c.y - d1.y * rr }, O = { x: S.x + d2.x * rr, y: S.y + d2.y * rr };
        const a0 = Math.atan2(S.y - O.y, S.x - O.x), sweep = Math.sign(turn) * Math.acos(Math.max(-1, Math.min(1, dot)));
        const n = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 16)));
        for (let s = 0; s <= n; s++) {
          const t = a0 + sweep * s / n, px = O.x + rr * Math.cos(t), py = O.y + rr * Math.sin(t);
          // The tangent turns with the arc: d1 at the start, d2 at the end.
          const tx = -Math.sin(t) * Math.sign(sweep), ty = Math.cos(t) * Math.sign(sweep);
          push(px, py, tx, ty);
        }
      }
      const z = C[C.length - 1], dz = dirOf(C[C.length - 2], z);
      push(z.x, z.y, dz.x, dz.y);
    }
    let s = 0;
    pts.forEach((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y); p.s = s; });
    return { pts, S: s };
  }

  // ── Finding a route ──
  // A grid over the drawing (step g), the rectangles no route may enter, and what the routes laid
  // down so far cover (each cell: 1 level, 2 vertical).
  function grid(bounds, g) {
    const x0 = Math.floor(bounds.x0 / g) * g, y0 = Math.floor(bounds.y0 / g) * g;
    const W = Math.ceil((bounds.x1 - x0) / g) + 1, H = Math.ceil((bounds.y1 - y0) / g) + 1;
    return { g, x0, y0, W, H, occ: new Uint8Array(W * H), stamp: new Uint32Array(W * H * 4), gen: 0, dist: new Float32Array(W * H * 4), prev: new Int32Array(W * H * 4) };
  }
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const cellOf = (G, p) => ({ i: Math.max(0, Math.min(G.W - 1, Math.round((p.x - G.x0) / G.g))), j: Math.max(0, Math.min(G.H - 1, Math.round((p.y - G.y0) / G.g))) });
  // A binary heap of [priority, state].
  function heap() {
    const P = [], V = [];
    return {
      get size() { return V.length; },
      push(p, s) { P.push(p); V.push(s); let i = V.length - 1; while (i) { const u = (i - 1) >> 1; if (P[u] <= P[i]) break; [P[u], P[i]] = [P[i], P[u]]; [V[u], V[i]] = [V[i], V[u]]; i = u; } },
      pop() {
        const top = V[0], lp = P.pop(), lv = V.pop();
        if (V.length) {
          P[0] = lp; V[0] = lv;
          for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < V.length && P[l] < P[m]) m = l; if (r < V.length && P[r] < P[m]) m = r; if (m === i) break; [P[m], P[i]] = [P[i], P[m]]; [V[m], V[i]] = [V[i], V[m]]; i = m; }
        }
        return top;
      },
    };
  }
  // A route from A to B. blocks: rectangles { x0, y0, x1, y1 } to keep the route's line out of
  // (inflate them first for the route's width). stub: how far it runs level out of A and into B.
  // Returns v, or null when there's no way through.
  const COST = { bend: 4, along: 6, across: 1.5 };
  function auto(G, A, B, blocks, stub) {
    const g = G.g, W = G.W, H = G.H, N = W * H;
    const blocked = new Uint8Array(N);
    blocks.forEach(b => {
      const i0 = Math.max(0, Math.ceil((b.x0 - G.x0) / g)), i1 = Math.min(W - 1, Math.floor((b.x1 - G.x0) / g));
      const j0 = Math.max(0, Math.ceil((b.y0 - G.y0) / g)), j1 = Math.min(H - 1, Math.floor((b.y1 - G.y0) / g));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * W + i] = 1;
    });
    const ta = { x: A.x + A.out * stub, y: A.y }, tb = { x: B.x - B.in * stub, y: B.y };
    const s = cellOf(G, ta), t = cellOf(G, tb);
    blocked[s.j * W + s.i] = 0; blocked[t.j * W + t.i] = 0;
    const sd = A.out > 0 ? 0 : 2, td = B.in > 0 ? 0 : 2;
    G.gen++;
    const gen = G.gen, st = G.stamp, dist = G.dist, prev = G.prev, q = heap();
    const hcost = (i, j) => Math.abs(i - t.i) + Math.abs(j - t.j);
    const start = (s.j * W + s.i) * 4 + sd;
    st[start] = gen; dist[start] = 0; prev[start] = -1;
    q.push(hcost(s.i, s.j), start);
    let found = -1, n = 0;
    while (q.size && n++ < 400000) {
      const cur = q.pop(), d = cur & 3, c = cur >> 2, i = c % W, j = (c - i) / W;
      if (c === t.j * W + t.i && d === td) { found = cur; break; }
      const base = dist[cur];
      for (const nd of [d, (d + 1) & 3, (d + 3) & 3]) {
        const ni = i + DX[nd], nj = j + DY[nd];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nc = nj * W + ni;
        if (blocked[nc]) continue;
        const o = G.occ[nc];
        const cost = base + 1 + (nd !== d ? COST.bend : 0) + (o ? (o & (nd % 2 ? 2 : 1) ? COST.along : COST.across) : 0);
        const ns = nc * 4 + nd;
        if (st[ns] === gen && dist[ns] <= cost) continue;
        st[ns] = gen; dist[ns] = cost; prev[ns] = cur;
        q.push(cost + hcost(ni, nj), ns);
      }
    }
    if (found < 0) return null;
    // Back to the start: the cells, then the runs (a run per change of direction).
    const path = [];
    for (let x = found; x >= 0; x = prev[x]) path.push(x);
    path.reverse();
    const runsOf = [];
    path.forEach((x, k) => {
      const d = x & 3, c = x >> 2, i = c % W, j = (c - i) / W, p = { x: G.x0 + i * g, y: G.y0 + j * g };
      if (!k) { runsOf.push({ d, a: p, b: p }); return; }
      const r = runsOf[runsOf.length - 1];
      if (r.d === d) r.b = p; else runsOf.push({ d, a: r.b, b: p });
    });
    // v from the vertical runs: each one's x, and between two of them the height of the level run
    // joining them (where the second starts). Level runs at either end belong to the terminals.
    const out = [];
    runsOf.filter(r => r.d % 2).forEach((r, k) => { if (k) out.push(r.a.y); out.push(r.a.x); });
    // A grid point is up to half a step off a terminal's height, so a straight grid route between
    // terminals at slightly different heights still needs one vertical run.
    if (!out.length && Math.abs(A.y - B.y) > 0.5) out.push(Math.round((ta.x + tb.x) / 2 / g) * g);
    return out;
  }
  // Mark what a route covers, so routes after it keep clear of it: cells within `half` of each
  // run, level runs as 1 and vertical runs as 2.
  function occupy(G, A, B, v, half) {
    const g = G.g, W = G.W, H = G.H, k = Math.max(0, Math.round(half / g));
    runs(A, B, v).forEach(R => {
      const a = cellOf(G, R.a), b = cellOf(G, R.b), bit = R.axis === 'h' ? 1 : 2;
      const i0 = Math.min(a.i, b.i), i1 = Math.max(a.i, b.i), j0 = Math.min(a.j, b.j), j1 = Math.max(a.j, b.j);
      for (let j = Math.max(0, j0 - (bit === 1 ? k : 0)); j <= Math.min(H - 1, j1 + (bit === 1 ? k : 0)); j++)
        for (let i = Math.max(0, i0 - (bit === 2 ? k : 0)); i <= Math.min(W - 1, i1 + (bit === 2 ? k : 0)); i++) G.occ[j * W + i] |= bit;
    });
  }
  // The point on a route's runs nearest p: { j (the run), d (distance), at }.
  function nearestRun(A, B, v, p) {
    let best = null;
    runs(A, B, v).forEach(R => {
      const dx = R.b.x - R.a.x, dy = R.b.y - R.a.y, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((p.x - R.a.x) * dx + (p.y - R.a.y) * dy) / L2)) : 0;
      const at = { x: R.a.x + dx * t, y: R.a.y + dy * t }, d = Math.hypot(p.x - at.x, p.y - at.y);
      if (!best || d < best.d) best = { j: R.j, k: R.k, axis: R.axis, d, at };
    });
    return best;
  }

  LM.route = { corners, runs, fits, tidy, addBend, shape, grid, auto, occupy, nearestRun, COST };
})(window.LM = window.LM || {});
