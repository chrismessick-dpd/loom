// A connector's real view from its STEP file. OpenCascade (occt-import-js, in the same worker as
// Partcheck) tessellates the STEP; we keep the model's own edges (boundaries between b-rep faces,
// minus tangent ones) and the silhouettes of curved faces, hide what's behind with a depth buffer,
// and chain what's left into one SVG path. The path is stored on the connector, so the STEP is read
// once; the mesh stays in memory only for this session, to try other views.
(function (LM) {
  'use strict';
  const JSD = 'https://cdn.jsdelivr.net/npm/';
  // Same pinned build and hashes as Partcheck's assets/libs.js.
  const OCCT = {
    js: JSD + 'occt-import-js@0.0.23/dist/occt-import-js.js', jsSri: 'sha384-Z8pO9JEhFZF+mvDKxMuLvPT85VP7nly8CqYjBatl0bMeW9OsaKCes4gEUPL4nihc',
    wasm: JSD + 'occt-import-js@0.0.23/dist/occt-import-js.wasm', wasmSri: 'sha384-6BbVZ7iPDgcRszsoavxGz4TaYCwC2EkeYCy1aR9XFwqMZYXDQP+0vZSTP6Yw35iD',
  };

  // Fine enough that a 1 mm contact is a smooth circle and a hole's front and back rims land on
  // each other (coarser, they were polygons turned against each other: doubled, notched outlines).
  const MESH = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0004, angularDeflection: 0.1 };
  let worker = null, seq = 0;
  const pending = new Map();
  function cadWorker() {
    if (!worker) {
      if (location.protocol === 'file:') throw new Error("Reading STEP needs the hosted page or a local server; a page opened from disk can't start the STEP reader.");
      worker = new Worker('assets/occt-worker.js');
      worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error)); };
      worker.onerror = e => { for (const p of pending.values()) p.reject(new Error('The STEP reader stopped: ' + (e.message || 'worker error'))); pending.clear(); worker = null; };
    }
    return worker;
  }
  function readStep(bytes, kind) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      const copy = bytes.slice();
      cadWorker().postMessage({ id, lib: OCCT, kind: kind || 'step', bytes: copy, params: MESH }, [copy.buffer]);
    });
  }

  // occt result → one mesh, with the b-rep face of every triangle.
  function toMesh(res) {
    let nv = 0, nt = 0;
    res.meshes.forEach(m => { nv += m.attributes.position.array.length / 3; nt += m.index.array.length / 3; });
    if (!nt) throw new Error('The STEP has no solid or surface geometry.');
    const pos = new Float32Array(nv * 3), idx = new Uint32Array(nt * 3), face = new Int32Array(nt);
    let vo = 0, to = 0, fo = 0;
    res.meshes.forEach(m => {
      const p = m.attributes.position.array, ix = m.index.array, n = ix.length / 3;
      pos.set(p, vo * 3);
      for (let i = 0; i < ix.length; i++) idx[to * 3 + i] = ix[i] + vo;
      const bf = m.brep_faces || [];
      if (bf.length) {
        bf.forEach((f, k) => { for (let t = f.first; t <= f.last; t++) face[to + t] = fo + k; });
        fo += bf.length;
      } else { face.fill(-1 - fo, to, to + n); fo++; } // no faces: the body counts as one, angles decide
      vo += p.length / 3; to += n;
    });
    return { pos, idx, face, tris: nt };
  }

  // Weld, normals and the edge list: view independent, so done once per mesh.
  function prepare(mesh) {
    if (mesh.edges) return mesh;
    const { pos, idx, face } = mesh, nv = pos.length / 3, nt = idx.length / 3;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
    const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    // Weld within q, looking in the neighboring cells too: two copies of a point (a seam's ends,
    // computed at 0 and 2π) can round into different cells, and an unwelded seam reads as an open
    // edge, drawn as a tick across the face.
    const q = diag * 2e-6, map = new Map(), wid = new Uint32Array(nv), wpos = [];
    for (let v = 0; v < nv; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const cx = Math.round(x / q), cy = Math.round(y / q), cz = Math.round(z / q);
      let w;
      for (let dx = -1; dx <= 1 && w === undefined; dx++) for (let dy = -1; dy <= 1 && w === undefined; dy++) for (let dz = -1; dz <= 1 && w === undefined; dz++) {
        const l = map.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz));
        if (l) for (const o of l) if (Math.abs(wpos[o * 3] - x) <= q && Math.abs(wpos[o * 3 + 1] - y) <= q && Math.abs(wpos[o * 3 + 2] - z) <= q) { w = o; break; }
      }
      if (w === undefined) {
        w = wpos.length / 3;
        wpos.push(x, y, z);
        const k = cx + ',' + cy + ',' + cz, l = map.get(k);
        l ? l.push(w) : map.set(k, [w]);
      }
      wid[v] = w;
    }
    const nrm = new Float32Array(nt * 3);
    let vol = 0;
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
      nrm[t * 3] = x / l; nrm[t * 3 + 1] = y / l; nrm[t * 3 + 2] = z / l;
      vol += pos[a] * x + pos[a + 1] * y + pos[a + 2] * z;
    }
    // Triangles wound inside out (a negative volume) would make every front face look away.
    if (vol < 0) for (let i = 0; i < nrm.length; i++) nrm[i] = -nrm[i];
    const W = wpos.length / 3, emap = new Map(), ea = [], eb = [], t1 = [], t2 = [], cnt = [];
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      let a = wid[idx[t * 3 + k]], b = wid[idx[t * 3 + (k + 1) % 3]];
      if (a === b) continue;
      if (a > b) [a, b] = [b, a];
      const key = a * W + b;
      let e = emap.get(key);
      if (e === undefined) { e = ea.length; emap.set(key, e); ea.push(a); eb.push(b); t1.push(t); t2.push(-1); cnt.push(1); }
      else { if (cnt[e] === 1) t2[e] = t; cnt[e]++; }
    }
    // Model edges: open edges, non-manifold edges, and face boundaries that aren't tangent.
    const COS_TAN = Math.cos(14 * Math.PI / 180), COS_FACETED = Math.cos(28 * Math.PI / 180);
    const model = new Uint8Array(ea.length);
    for (let e = 0; e < ea.length; e++) {
      if (cnt[e] !== 2) { model[e] = 1; continue; }
      const a = t1[e], b = t2[e];
      const dot = nrm[a * 3] * nrm[b * 3] + nrm[a * 3 + 1] * nrm[b * 3 + 1] + nrm[a * 3 + 2] * nrm[b * 3 + 2];
      if (face[a] >= 0 && face[b] >= 0) model[e] = face[a] !== face[b] && dot < COS_TAN ? 1 : 0;
      else model[e] = dot < COS_FACETED ? 1 : 0;
    }
    Object.assign(mesh, { wpos: new Float32Array(wpos), nrm, ea: Int32Array.from(ea), eb: Int32Array.from(eb), t1: Int32Array.from(t1), t2: Int32Array.from(t2), cnt: Uint8Array.from(cnt), model, diag, lo, hi, edges: ea.length });
    return mesh;
  }

  // The model's axes: the normals of its planar b-rep faces (unit vectors, one per direction, the
  // biggest faces first), then the world axes. A view a hair off one of these doubles every rim,
  // since a hole's front and back rims no longer coincide, so views snap to them (configure.js).
  function axes(mesh) {
    if (mesh.axes) return mesh.axes;
    const { idx, pos, face } = mesh, nt = idx.length / 3, F = new Map();
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, ar = Math.hypot(x, y, z) / 2;
      if (!ar) continue;
      let f = F.get(face[t]);
      if (!f) F.set(face[t], f = { area: 0, n: [0, 0, 0] });
      f.area += ar; f.n[0] += x / 2; f.n[1] += y / 2; f.n[2] += z / 2;
    }
    const COS_SAME = Math.cos(0.5 * Math.PI / 180), out = [];
    const add = (n, area) => {
      // One entry per direction, either sign: point it along its first nonzero component.
      const k = [0, 1, 2].find(i => Math.abs(n[i]) > 1e-9);
      if (k !== undefined && n[k] < 0) n = n.map(v => -v);
      const o = out.find(e => Math.abs(e.n[0] * n[0] + e.n[1] * n[1] + e.n[2] * n[2]) >= COS_SAME);
      if (o) o.area += area; else out.push({ n, area });
    };
    F.forEach(f => {
      const L = Math.hypot(f.n[0], f.n[1], f.n[2]);
      if (f.area > 0 && L > f.area * 0.999) add(f.n.map(v => v / L), f.area);
    });
    out.sort((a, b) => b.area - a.area);
    const top = out.length ? out[0].area : 0;
    const list = out.filter(e => e.area >= top * 0.01).map(e => e.n.map(v => (Math.abs(v) < 1e-9 ? 0 : v)));
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(w => { if (!list.some(n => Math.abs(n[0] * w[0] + n[1] * w[1] + n[2] * w[2]) >= COS_SAME)) list.push(w); });
    mesh.axes = list;
    return list;
  }

  // Six views, each looking at the model from one side: the direction we look, then screen right and up.
  const VIEWS = {
    '+Z': { look: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0], label: 'From +Z' },
    '-Z': { look: [0, 0, 1], right: [-1, 0, 0], up: [0, 1, 0], label: 'From −Z' },
    '+X': { look: [-1, 0, 0], right: [0, 1, 0], up: [0, 0, 1], label: 'From +X' },
    '-X': { look: [1, 0, 0], right: [0, -1, 0], up: [0, 0, 1], label: 'From −X' },
    '+Y': { look: [0, -1, 0], right: [-1, 0, 0], up: [0, 0, 1], label: 'From +Y' },
    '-Y': { look: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1], label: 'From −Y' },
  };
  const dot3 = (a, i, b) => a[i] * b[0] + a[i + 1] * b[1] + a[i + 2] * b[2];

  // The visible edges of a view as one path, in sketch units: the longer side is 1000. The view is
  // one of VIEWS by key, or any { look, right, up } (unit vectors, right × up = −look).
  function sketch(mesh, viewKey, rot, res) {
    prepare(mesh);
    const V = viewKey && typeof viewKey === 'object' ? viewKey : VIEWS[viewKey] || VIEWS['+Z'], RES = res || 1400;
    const { wpos, idx, pos, nrm, ea, eb, t1, t2, cnt, model } = mesh;
    const nw = wpos.length / 3, nt = idx.length / 3;
    // Project: x right, y up, z toward the viewer.
    const px = new Float32Array(nw), py = new Float32Array(nw), pz = new Float32Array(nw);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let v = 0; v < nw; v++) {
      const x = dot3(wpos, v * 3, V.right), y = dot3(wpos, v * 3, V.up);
      px[v] = x; py[v] = y; pz[v] = -dot3(wpos, v * 3, V.look);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const w = x1 - x0 || 1, h = y1 - y0 || 1, s = (RES - 4) / Math.max(w, h);
    const GW = Math.ceil(w * s) + 5, GH = Math.ceil(h * s) + 5;
    const zb = new Float32Array(GW * GH).fill(-Infinity);
    const gx = x => (x - x0) * s + 2, gy = y => (y1 - y) * s + 2;
    // Depth buffer from every triangle (raw positions: the same points as the welded ones).
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ax = gx(dot3(pos, a, V.right)), ay = gy(dot3(pos, a, V.up)), az = -dot3(pos, a, V.look);
      const bx = gx(dot3(pos, b, V.right)), by = gy(dot3(pos, b, V.up)), bz = -dot3(pos, b, V.look);
      const cx = gx(dot3(pos, c, V.right)), cy = gy(dot3(pos, c, V.up)), cz = -dot3(pos, c, V.look);
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(GW - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(GH - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let yy = minY; yy <= maxY; yy++) {
        const sy = yy + 0.5;
        for (let xx = minX; xx <= maxX; xx++) {
          const sx = xx + 0.5;
          const w0 = ((bx - sx) * (cy - sy) - (by - sy) * (cx - sx)) / area;
          const w1 = ((cx - sx) * (ay - sy) - (cy - sy) * (ax - sx)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const z = w0 * az + w1 * bz + w2 * cz, i = yy * GW + xx;
          if (z > zb[i]) zb[i] = z;
        }
      }
    }
    const eps = mesh.diag * 0.0025 + 2.5 / s;
    const zAt = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y); let m = Infinity; for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = xi + dx, Y = yi + dy; if (X >= 0 && Y >= 0 && X < GW && Y < GH) m = Math.min(m, zb[Y * GW + X]); } return m; };
    const facing = t => -(nrm[t * 3] * V.look[0] + nrm[t * 3 + 1] * V.look[1] + nrm[t * 3 + 2] * V.look[2]);
    // Visible runs of model edges and silhouettes, in grid pixels.
    const segs = [];
    for (let e = 0; e < ea.length; e++) {
      let keep = model[e];
      if (cnt[e] === 2) {
        const fa = facing(t1[e]), fb = facing(t2[e]);
        if (!keep && (fa > 1e-6) !== (fb > 1e-6)) keep = 1;
        if (keep && fa <= 1e-6 && fb <= 1e-6) keep = 0; // both sides face away: behind the solid
      }
      if (!keep) continue;
      const a = ea[e], b = eb[e];
      const X0 = gx(px[a]), Y0 = gy(py[a]), Z0 = pz[a], X1 = gx(px[b]), Y1 = gy(py[b]), Z1 = pz[b];
      const L = Math.hypot(X1 - X0, Y1 - Y0);
      if (L < 0.05) continue;
      const n = Math.max(1, Math.ceil(L / 0.7));
      const vis = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        vis[i] = Z0 + (Z1 - Z0) * t >= zAt(X0 + (X1 - X0) * t, Y0 + (Y1 - Y0) * t) - eps ? 1 : 0;
      }
      despeckle(vis);
      let run = -1;
      for (let i = 0; i <= n; i++) {
        const v = i < n && vis[i];
        if (v && run < 0) run = i;
        if (!v && run >= 0) {
          const ta = run / n, tb = i / n;
          segs.push([X0 + (X1 - X0) * ta, Y0 + (Y1 - Y0) * ta, X0 + (X1 - X0) * tb, Y0 + (Y1 - Y0) * tb]);
          run = -1;
        }
      }
    }
    // Rims that go all the way round become true circles, even with a slit's tick or a rib joined
    // on (those stay lines); copies of one (a hole's back rim seen through it, a run lying on a
    // circle) go. Arcs of one circle adding up to half of it or more are round cavities too: not
    // drawn as circles, but marks snap to their centers. The rest are polylines.
    const tolPx = 0.7, circles = [], polys = [], arcs = [];
    const sameC = (a, b, t) => Math.hypot(a.x - b.x, a.y - b.y) < t && Math.abs(a.r - b.r) < t;
    chain(segs).forEach(l => {
      const o = l.length >= 8 ? roundPart(l, tolPx) : null;
      if (o && o.gap < 0.2) {
        if (!circles.some(c => sameC(c, o, tolPx))) circles.push(o);
        outlierRuns(l, o.inl).forEach(r => polys.push(r));
        return;
      }
      polys.push(l);
      if (o && o.sweep >= Math.PI / 6) {
        const g = arcs.find(a => sameC(a, o, tolPx * 2));
        if (g) g.sweep += o.sweep; else arcs.push({ x: o.x, y: o.y, r: o.r, sweep: o.sweep });
      }
    });
    const onCircle = l => circles.some(c => l.every(p => Math.abs(Math.hypot(p[0] - c.x, p[1] - c.y) - c.r) < tolPx));
    const kept = polys.filter(l => !onCircle(l) && length(l) > 1.5);
    const lines = kept.map(l => simplify(l, 0.35));
    const holes = arcs.filter(a => a.sweep >= Math.PI && !circles.some(c => sameC(c, a, tolPx)));
    // Grid pixels → sketch units (longer side 1000), then the in-plane turn.
    const k = 1000 / Math.max(w, h) / s;
    let W = w / Math.max(w, h) * 1000, H = h / Math.max(w, h) * 1000;
    const turn = ((rot || 0) % 360 + 360) % 360;
    const tf = (x, y) => {
      x = (x - 2) * k; y = (y - 2) * k;
      if (turn === 90) return [H - y, x];
      if (turn === 180) return [W - x, H - y];
      if (turn === 270) return [y, W - x];
      return [x, y];
    };
    let d = '';
    const r1 = v => Math.round(v * 10) / 10;
    lines.forEach(l => {
      l.forEach((p, i) => { const [x, y] = tf(p[0], p[1]); d += (i ? 'L' : 'M') + r1(x) + ' ' + r1(y); });
    });
    const c = circles.map(o => { const [x, y] = tf(o.x, o.y); return [r1(x), r1(y), r1(o.r * k)]; });
    if (turn === 90 || turn === 270) [W, H] = [H, W];
    const f = holes.map(o => { const [x, y] = tf(o.x, o.y); return [r1(x), r1(y), r1(o.r * k)]; });
    return { view: viewKey, rot: turn, w: r1(W), h: r1(H), mm: Math.max(w, h), d, c, f, lines: lines.length + c.length };
  }

  // Visibility samples along an edge, cleaned: hidden gaps of up to two samples (0.7 px each) are
  // filled and visible runs shorter than three dropped, so an edge lying on a surface doesn't
  // flicker into dashes.
  function despeckle(v) {
    const n = v.length;
    for (let i = 1; i < n - 1; i++) if (!v[i]) { let j = i; while (j < n && !v[j]) j++; if (j < n && v[i - 1] && j - i <= 2) v.fill(1, i, j); i = j; }
    if (n < 3) return;
    for (let i = 0; i < n; i++) if (v[i]) { let j = i; while (j < n && v[j]) j++; if (j - i < 3 && !(i === 0 && j === n)) v.fill(0, i, j); i = j; }
  }
  // The circle most of a polyline lies on: fitted, outliers set aside (more than tol off), fitted
  // again. inl marks the points on it, gap is the widest angle they leave open, sweep the rest.
  function roundPart(l, tol) {
    let o = fitCircle(l);
    if (!o || o.r < 1.5) return null;
    const on = c => l.map(p => Math.abs(Math.hypot(p[0] - c.x, p[1] - c.y) - c.r) <= Math.max(tol, c.r * 0.006));
    let inl = on(o);
    if (inl.filter(Boolean).length < Math.max(8, l.length * 0.6)) return null;
    o = fitCircle(l.filter((_, i) => inl[i]));
    if (!o || o.r < 1.5) return null;
    inl = on(o);
    const angs = l.filter((_, i) => inl[i]).map(p => Math.atan2(p[1] - o.y, p[0] - o.x)).sort((a, b) => a - b);
    if (angs.length < 8) return null;
    let gap = angs[0] + 2 * Math.PI - angs[angs.length - 1];
    for (let i = 1; i < angs.length; i++) gap = Math.max(gap, angs[i] - angs[i - 1]);
    return { x: o.x, y: o.y, r: o.r, inl, gap, sweep: 2 * Math.PI - gap };
  }
  // The stretches of a polyline off its circle, each with the point it leaves the circle from.
  function outlierRuns(l, inl) {
    const out = [];
    for (let i = 0; i < l.length; i++) {
      if (inl[i]) continue;
      let j = i;
      while (j < l.length && !inl[j]) j++;
      const run = l.slice(Math.max(0, i - 1), Math.min(l.length, j + 1));
      if (run.length >= 2) out.push(run);
      i = j;
    }
    return out;
  }
  const length = l => { let s = 0; for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return s; };
  // A least-squares circle through points (Kåsa), with its worst radial error.
  function fitCircle(pts) {
    let mx = 0, my = 0;
    pts.forEach(p => { mx += p[0]; my += p[1]; });
    mx /= pts.length; my /= pts.length;
    let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
    pts.forEach(p => { const u = p[0] - mx, v = p[1] - my; suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u; });
    const det = suu * svv - suv * suv;
    if (Math.abs(det) < 1e-9) return null;
    const a = (suuu + suvv) / 2, b = (svvv + svuu) / 2;
    const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
    const x = uc + mx, y = vc + my, r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
    let err = 0;
    pts.forEach(p => { err = Math.max(err, Math.abs(Math.hypot(p[0] - x, p[1] - y) - r)); });
    return { x, y, r, err };
  }

  // Join segments that share ends into polylines.
  function chain(segs) {
    const key = (x, y) => Math.round(x * 4) + ',' + Math.round(y * 4);
    const ends = new Map(), used = new Uint8Array(segs.length);
    segs.forEach((s, i) => { [key(s[0], s[1]), key(s[2], s[3])].forEach(k => { const l = ends.get(k); l ? l.push(i) : ends.set(k, [i]); }); });
    // At a junction, go on along the segment that turns least, so a rim stays one loop and a
    // slit or rib meeting it breaks off as its own line.
    const next = (x, y, dx, dy) => {
      const l = ends.get(key(x, y)) || [], k0 = key(x, y);
      let best = -1, bd = -Infinity;
      for (const i of l) {
        if (used[i]) continue;
        const s = segs[i], from0 = key(s[0], s[1]) === k0;
        const ex = (from0 ? s[2] : s[0]) - x, ey = (from0 ? s[3] : s[1]) - y, L = Math.hypot(ex, ey) || 1;
        const d = (ex * dx + ey * dy) / L;
        if (d > bd) { bd = d; best = i; }
      }
      return best;
    };
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const line = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]];
      for (const fwd of [true, false]) {
        for (;;) {
          const p = fwd ? line[line.length - 1] : line[0], o = fwd ? line[line.length - 2] : line[1];
          const L = Math.hypot(p[0] - o[0], p[1] - o[1]) || 1;
          const j = next(p[0], p[1], (p[0] - o[0]) / L, (p[1] - o[1]) / L);
          if (j < 0) break;
          used[j] = 1;
          const s = segs[j], same = key(s[0], s[1]) === key(p[0], p[1]);
          const q = same ? [s[2], s[3]] : [s[0], s[1]];
          fwd ? line.push(q) : line.unshift(q);
        }
      }
      out.push(line);
    }
    return out;
  }
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    // A closed loop (its ends meet) has no chord to measure from: split it at its far point.
    const [sx, sy] = pts[0], [ex, ey] = pts[pts.length - 1];
    if (Math.hypot(ex - sx, ey - sy) < 1e-6) {
      let far = 1, fd = -1;
      pts.forEach((p, i) => { const d = Math.hypot(p[0] - sx, p[1] - sy); if (d > fd) { fd = d; far = i; } });
      if (far <= 0 || far >= pts.length - 1) return pts;
      return simplify(pts.slice(0, far + 1), tol).concat(simplify(pts.slice(far), tol).slice(1));
    }
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1e-9;
      let best = -1, bi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
        if (d > best) { best = d; bi = i; }
      }
      if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // An STL (binary or ASCII) as a mesh with no b-rep faces: angles find its edges.
  function fromStl(buf) {
    const dv = new DataView(buf), head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 512)));
    const tris = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
    let pos;
    if (tris && 84 + tris * 50 === buf.byteLength) {
      pos = new Float32Array(tris * 9);
      for (let t = 0; t < tris; t++) for (let k = 0; k < 9; k++) pos[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
    } else if (/^\s*solid/i.test(head)) {
      const nums = [], re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, txt = new TextDecoder().decode(buf);
      let m;
      while ((m = re.exec(txt))) nums.push(+m[1], +m[2], +m[3]);
      pos = Float32Array.from(nums);
    } else throw new Error("This doesn't read as an STL file.");
    const nt = Math.floor(pos.length / 9);
    if (!nt) throw new Error('The STL has no triangles.');
    const idx = new Uint32Array(nt * 3);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    return { pos, idx, face: new Int32Array(nt).fill(-1), tris: nt };
  }
  // The kinds of file a model can come from, by extension.
  const KINDS = { step: 'step', stp: 'step', iges: 'iges', igs: 'iges', stl: 'stl' };
  const kindOf = name => KINDS[(String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase()] || null;
  // Read a STEP, IGES or STL file into a prepared mesh.
  async function load(file) {
    const kind = kindOf(file.name || '') || 'step', buf = await file.arrayBuffer();
    if (kind === 'stl') return prepare(fromStl(buf));
    const res = await readStep(new Uint8Array(buf), kind);
    if (!res.success) throw new Error("OpenCascade couldn't read this " + kind.toUpperCase() + ' file.');
    return prepare(toMesh(res));
  }

  LM.step = { load, sketch, prepare, axes, kindOf, VIEWS, OCCT };
})(window.LM = window.LM || {});
