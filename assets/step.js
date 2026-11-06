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
  function readStep(bytes) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      const copy = bytes.slice();
      cadWorker().postMessage({ id, lib: OCCT, kind: 'step', bytes: copy, params: { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0015, angularDeflection: 0.25 } }, [copy.buffer]);
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
    const q = diag * 1e-6, map = new Map(), wid = new Uint32Array(nv), wpos = [];
    for (let v = 0; v < nv; v++) {
      const k = Math.round(pos[v * 3] / q) + ',' + Math.round(pos[v * 3 + 1] / q) + ',' + Math.round(pos[v * 3 + 2] / q);
      let w = map.get(k);
      if (w === undefined) { w = wpos.length / 3; map.set(k, w); wpos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
      wid[v] = w;
    }
    const nrm = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
      nrm[t * 3] = x / l; nrm[t * 3 + 1] = y / l; nrm[t * 3 + 2] = z / l;
    }
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

  // The visible edges of a view as one path, in sketch units: the longer side is 1000.
  function sketch(mesh, viewKey, rot, res) {
    prepare(mesh);
    const V = VIEWS[viewKey] || VIEWS['+Z'], RES = res || 1400;
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
      let run = -1;
      for (let i = 0; i <= n; i++) {
        let vis = false;
        if (i < n) {
          const t = (i + 0.5) / n;
          vis = Z0 + (Z1 - Z0) * t >= zAt(X0 + (X1 - X0) * t, Y0 + (Y1 - Y0) * t) - eps;
        }
        if (vis && run < 0) run = i;
        if (!vis && run >= 0) {
          const ta = run / n, tb = i / n;
          segs.push([X0 + (X1 - X0) * ta, Y0 + (Y1 - Y0) * ta, X0 + (X1 - X0) * tb, Y0 + (Y1 - Y0) * tb]);
          run = -1;
        }
      }
    }
    const lines = chain(segs, 0.35);
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
    lines.forEach(l => {
      l.forEach((p, i) => { const [x, y] = tf(p[0], p[1]); d += (i ? 'L' : 'M') + (Math.round(x * 10) / 10) + ' ' + (Math.round(y * 10) / 10); });
    });
    if (turn === 90 || turn === 270) [W, H] = [H, W];
    return { view: viewKey, rot: turn, w: Math.round(W * 10) / 10, h: Math.round(H * 10) / 10, mm: Math.max(w, h), d, lines: lines.length };
  }

  // Join segments that share ends into polylines, then drop points that don't bend the line.
  function chain(segs, tol) {
    const key = (x, y) => Math.round(x * 4) + ',' + Math.round(y * 4);
    const ends = new Map(), used = new Uint8Array(segs.length);
    segs.forEach((s, i) => { [key(s[0], s[1]), key(s[2], s[3])].forEach(k => { const l = ends.get(k); l ? l.push(i) : ends.set(k, [i]); }); });
    const next = (x, y) => { const l = ends.get(key(x, y)) || []; for (const i of l) if (!used[i]) return i; return -1; };
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const line = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]];
      for (const fwd of [true, false]) {
        for (;;) {
          const p = fwd ? line[line.length - 1] : line[0];
          const j = next(p[0], p[1]);
          if (j < 0) break;
          used[j] = 1;
          const s = segs[j], same = key(s[0], s[1]) === key(p[0], p[1]);
          const q = same ? [s[2], s[3]] : [s[0], s[1]];
          fwd ? line.push(q) : line.unshift(q);
        }
      }
      out.push(simplify(line, tol));
    }
    return out;
  }
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
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

  // Read a STEP file into a prepared mesh.
  async function load(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await readStep(bytes);
    if (!res.success) throw new Error("OpenCascade couldn't read this STEP file.");
    return prepare(toMesh(res));
  }

  LM.step = { load, sketch, prepare, VIEWS, OCCT };
})(window.LM = window.LM || {});
