// Formboard (docs/formboard.md; Chris, 2026-11-15): a system's boards and devices placed on a reference
// (a STEP model, a DXF, or a picture), routing channels drawn on it, and every cable routed through the
// channels its classes allow, with a build length for each. A tab beside System and List.
//
// A formboard is its own document (loom.v1.formboards here; loom_data/formboards/ when it syncs), naming
// its system. What it stores is only what was done to it: blocks moved (blocks[path]), placed systems kept
// whole (keep[path]), channels, classes, each cable's classes, vias, pin, and end allowances, the settings,
// and each cable's last route (written by Route, never while drawing). Start spots, the flattened system,
// and junctions are worked out every time.
(function (LM) {
  'use strict';
  const U = LM.util, esc = U.esc;
  const DEMO = new URLSearchParams(location.search).has('demo');
  const NS = DEMO ? 'loom.demo.' : 'loom.v1.';
  const M3 = () => window.Signoff && window.Signoff.model3d;
  const DEG = Math.PI / 180;
  const THICK = { board: 1.6, device: 20, kept: 30, 'device-end': 10 };
  const RGB = { board: [38, 96, 66], device: [120, 128, 140], kept: [96, 110, 150], 'device-end': [150, 120, 70] };
  const PALETTE = ['#2e9e5b', '#d4a514', '#2f6fd1', '#9a4fd1', '#d1662f', '#1aa3a3', '#8a8f98'];
  const DEFAULTS = { dropMax: 300, endMm: 0, slackPct: 0, roundMm: 10 };
  const CH = { w: 40, h: 20 };   // a new channel's section, mm

  const S = { store: {}, cur: null, sel: null, tool: 'select', draft: null, snap: null, cal: null, hover: null, past: [], future: [], ui: {}, meshes: {}, st: null, el: null, root: null, flat: null, flatKey: '', busy: '' };
  let A = null;

  // ── Store ──
  function load() {
    try { S.store = JSON.parse(localStorage.getItem(NS + 'formboards') || '{}') || {}; } catch (e) { S.store = {}; }
    try { S.ui = JSON.parse(localStorage.getItem(NS + 'fbui') || '{}') || {}; } catch (e) { S.ui = {}; }
    Object.values(S.store).forEach(normalize);
  }
  let saveTimer = 0;
  function writeNow() {
    saveTimer = 0;
    try { localStorage.setItem(NS + 'formboards', JSON.stringify(S.store)); } catch (e) { if (A) A.toast("Couldn't keep the formboard in the browser: " + e.message, 'error'); }
  }
  function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(writeNow, 200); }
  function flush() { if (saveTimer) { clearTimeout(saveTimer); writeNow(); } }
  let uiTimer = 0;
  function saveUi() { clearTimeout(uiTimer); uiTimer = setTimeout(() => { try { localStorage.setItem(NS + 'fbui', JSON.stringify(S.ui)); } catch (e) { /* storage blocked */ } }, 400); }
  function normalize(f) {
    f.blocks = f.blocks && typeof f.blocks === 'object' ? f.blocks : {};
    f.keep = f.keep && typeof f.keep === 'object' ? f.keep : {};
    f.channels = Array.isArray(f.channels) ? f.channels : [];
    f.cables = f.cables && typeof f.cables === 'object' ? f.cables : {};
    f.classes = Array.isArray(f.classes) ? f.classes : [];
    f.settings = Object.assign({}, DEFAULTS, f.settings || {});
    return f;
  }
  function blank(system, title) {
    return normalize({ schema: 1, kind: 'formboard', id: U.uid('f'), title: title || 'Formboard', system, reference: null, updated: Date.now() });
  }
  const live = () => Object.values(S.store).filter(f => !f.deleted);
  const forSystem = id => live().filter(f => f.system === id).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const cur = () => (S.cur && S.store[S.cur] && !S.store[S.cur].deleted ? S.store[S.cur] : null);

  // ── Changes and undo (the formboard's own; an outside edit, Apply lengths or Save to base part, adds its own undo) ──
  function change(fn, outside) {
    const f = cur();
    if (!f) return null;
    const before = JSON.stringify(f);
    const r = fn(f);
    f.updated = Date.now();
    if (A && A.login()) f.updatedBy = A.login();
    S.past.push({ id: f.id, before, after: JSON.stringify(f), outside: outside || null });
    if (S.past.length > 100) S.past.shift();
    S.future = [];
    persist(); refresh();
    return r;
  }
  function step(from, to, back) {
    const x = from.pop();
    if (!x) return;
    const f = S.store[x.id];
    if (!f) return;
    const base = f.syncBase;
    S.store[x.id] = normalize(JSON.parse(back ? x.before : x.after));
    if (base) S.store[x.id].syncBase = base; else delete S.store[x.id].syncBase;
    if (x.outside) (back ? x.outside.undo : x.outside.redo)();
    S.store[x.id].updated = Date.now();
    if (A && A.login()) S.store[x.id].updatedBy = A.login();
    to.push(x);
    S.sel = null;
    persist(); refresh();
  }
  const undo = () => step(S.past, S.future, true), redo = () => step(S.future, S.past, false);

  // ── The system, flattened, and where everything is ──
  function flat() {
    const f = cur();
    if (!f) return null;
    const key = JSON.stringify([f.system, f.keep, (LM.system.get(f.system) || {}).updated]);
    // Re-read every render: a placed system or harness edited elsewhere shows at once (Chris: follow the system).
    S.flat = LM.system.flatten(f.system, f.keep);
    S.flatKey = key;
    return S.flat;
  }
  const thick = b => THICK[b.kind] || 10;
  function slabMesh(w, h, t, rgb) {
    const k = [w, h, t, rgb].join('|');
    if (!S.meshes[k]) {
      const m = M3().slab(w, h, t);
      for (let i = 0; i < m.col.length; i += 3) { const top = m.tex[i / 3] === 1; m.col[i] = rgb[0] * (top ? 1 : 0.7); m.col[i + 1] = rgb[1] * (top ? 1 : 0.7); m.col[i + 2] = rgb[2] * (top ? 1 : 0.7); }
      m.tex = new Uint8Array(m.tex.length);
      S.meshes[k] = m;
    }
    return S.meshes[k];
  }
  // Start spots: the system drawings' own layout (mm, y down), beside the reference, flat on the floor.
  function startSpots(fl, refBox) {
    if (!fl.blocks.length) return {};
    const x0 = Math.min(...fl.blocks.map(b => b.x)), y0 = Math.min(...fl.blocks.map(b => b.y));
    const ox = refBox ? refBox.hi[0] + 60 : 0, oy = refBox ? refBox.hi[1] : 0, out = {};
    fl.blocks.forEach(b => { out[b.path] = [ox + (b.x - x0) + b.w / 2, oy - (b.y - y0) - b.h / 2, thick(b) / 2]; });
    return out;
  }
  // The scene: the reference, the blocks, and the channels, as the stage draws them.
  function scene() {
    const f = cur(), fl = flat(), objs = [], fm = LM.system.filterFlat(S.root);
    const ref = refObj(f);
    if (ref) objs.push(ref);
    const refBox = ref && ref.mesh ? M3().placedBox(ref) : null, spots = startSpots(fl, refBox);
    const blocks = {};
    fl.blocks.forEach(b => {
      const kept = f.blocks[b.path], rot = kept && kept.rot ? kept.rot : [0, 0, 0];
      const o = { id: 'b:' + b.path, b, mesh: slabMesh(b.w, b.h, thick(b), RGB[b.kind] || RGB.device), R: M3().rotation(rot[0], rot[1], rot[2]), rot, pivot: [0, 0, 0], T: kept && kept.at ? kept.at.slice() : spots[b.path], placed: !!(kept && kept.at) };
      if (!o.placed) o.tint = [235, 238, 242, 0.55];
      // The system's filter (Chris, 2026-11-15: as on the System and List tabs): what doesn't match fades to gray;
      // a match gets a dashed ring (drawOverlay).
      if (fm) { o.lit = fm.block(b); if (!o.lit) o.tint = [128, 133, 141, 0.78]; }
      blocks[b.path] = o; objs.push(o);
    });
    f.channels.forEach(c => { const m = channelMesh(c, f); if (m) objs.push({ id: 'c:' + c.id, ch: c, mesh: m, fixed: true, pivot: [0, 0, 0], T: [0, 0, 0] }); });
    return { objs, blocks, fl, refBox, fm };
  }
  // A connector's world point: on its block's top face, where the system drawing puts it.
  function connPoint(o, connId) {
    const b = o.b, c = b.conns.find(x => x.id === connId);
    if (!c) return null;
    return M3().place(o, [c.x - b.w / 2, b.h / 2 - c.y, thick(b) / 2]);
  }
  const classColor = (f, id) => { const c = f.classes.find(x => x.id === id); return c ? c.color : '#8a8f98'; };
  const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  // A channel's mesh: a box along each run, its section w across and h tall, standing on c.up.
  function channelMesh(c, f) {
    const P = (c.pts || []).filter(p => Array.isArray(p) && p.length === 3);
    if (P.length < 2) return null;
    const rgb = hexRgb(c.classes && c.classes.length ? classColor(f, c.classes[0]) : '#8a8f98');
    const pos = [], idx = [], col = [], fid = [];
    const up0 = c.up && c.up.length === 3 ? c.up : [0, 0, 1];
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1], d = norm(sub(b, a));
      let up = up0;
      if (Math.abs(dot(d, up)) > 0.95) up = Math.abs(d[2]) < 0.95 ? [0, 0, 1] : [0, 1, 0];
      const side = norm(cross(d, up)), u = norm(cross(side, d)), hw = (c.w || CH.w) / 2, hh = (c.h || CH.h) / 2;
      const corner = (p, s, t) => [p[0] + side[0] * s * hw + u[0] * t * hh, p[1] + side[1] * s * hw + u[1] * t * hh, p[2] + side[2] * s * hw + u[2] * t * hh];
      const ring = p => [corner(p, -1, -1), corner(p, 1, -1), corner(p, 1, 1), corner(p, -1, 1)];
      const ra = ring(a), rb = ring(b), o = pos.length / 3;
      ra.concat(rb).forEach(q => pos.push(q[0], q[1], q[2]));
      const quads = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [0, 3, 2, 1], [4, 5, 6, 7]];
      quads.forEach((q, qi) => {
        idx.push(o + q[0], o + q[1], o + q[2], o + q[0], o + q[2], o + q[3]);
        const k = qi === 2 ? 1 : 0.78;
        for (let t = 0; t < 2; t++) { col.push(rgb[0] * k, rgb[1] * k, rgb[2] * k); fid.push(i * 6 + qi); }
      });
    }
    return { pos: new Float32Array(pos), idx: new Uint32Array(idx), col: new Uint8Array(col), fid: new Uint32Array(fid) };
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mulv = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const r1 = v => Math.round(v * 10) / 10;

  // ── The reference: a STEP mesh, or a DXF or picture on a plane at z = 0 ──
  // The file's payload stays in this browser's IndexedDB (loom-fbref) by its hash; the document names it.
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const rq = indexedDB.open('loom-fbref', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('refs');
      rq.onerror = () => reject(rq.error);
      rq.onsuccess = () => { const tx = rq.result.transaction('refs', mode), os = tx.objectStore('refs'), r = fn(os); tx.oncomplete = () => resolve(r && r.result); tx.onerror = () => reject(tx.error); };
    });
  }
  const putRef = (k, v) => idb('readwrite', os => os.put(v, k));
  const getRef = k => idb('readonly', os => os.get(k));
  async function sha(bytes) { const h = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24); }
  const REF = {};   // sha → { mesh, tex, segs } once loaded
  function refObj(f) {
    const r = f && f.reference;
    if (!r) return null;
    // A made-up reference for the demo, built here (no file).
    if (r.kind === 'builtin' && r.shape === 'bracket') {
      if (!REF.bracket) REF.bracket = { mesh: bracketMesh(), T: [0, 0, 0] };
      return { id: 'ref', mesh: REF.bracket.mesh, R: null, pivot: [0, 0, 0], T: REF.bracket.T, fixed: true };
    }
    if (r.kind === 'builtin') {
      const k = 'builtin|' + r.size.join('x');
      if (!REF[k]) {
        const m = M3().slab(r.size[0], r.size[1], r.size[2]);
        for (let i = 0; i < m.col.length; i += 3) { const top = m.tex[i / 3] === 1; m.col[i] = top ? 214 : 170; m.col[i + 1] = top ? 217 : 174; m.col[i + 2] = top ? 222 : 180; }
        m.tex = new Uint8Array(m.tex.length);
        REF[k] = { mesh: m, T: [r.size[0] / 2, r.size[1] / 2, -r.size[2] / 2] };
      }
      return { id: 'ref', mesh: REF[k].mesh, R: null, pivot: [0, 0, 0], T: REF[k].T, fixed: true };
    }
    const got = REF[r.sha + '|' + (r.scale || 1)];
    if (!got) { loadRef(r); return null; }
    return { id: 'ref', mesh: got.mesh, tex: got.tex, R: null, pivot: [0, 0, 0], T: got.T || [0, 0, 0], fixed: true };
  }
  // The demo's made-up bracket, one closed solid: a 300 × 200 × 10 mm base (top at z 10) and a 10 mm wall at the
  // back, along y 190 to 200, up to z 150 (Chris: the back of the bracket at the back), the L profile in y and z run along x. Each flat face is its own face id, as a
  // STEP's would be; faces looking up are lighter.
  const BRACKET = { x: 300, y: 200, t: 10, h: 150 };
  function bracketMesh() {
    const { x: X, y: Y, t: T, h: H } = BRACKET, pos = [], idx = [], col = [], fid = [], seen = new Map();
    let face = 0;
    // Corners shared between faces are one vertex, so each edge is one edge between two faces.
    const vert = p => { const k = p.join(','); if (!seen.has(k)) { seen.set(k, pos.length / 3); pos.push(p[0], p[1], p[2]); } return seen.get(k); };
    // A triangle of the current face; faces looking up are lighter.
    const tri = (a, b, c) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], nz = u[0] * w[1] - u[1] * w[0];
      const g = nz > 1e-9 ? [214, 217, 222] : [170, 174, 180];
      [a, b, c].forEach(p => idx.push(vert(p)));
      col.push(g[0], g[1], g[2]); fid.push(face);
    };
    // The L profile, counterclockwise seen from +x: (y, z).
    const L = [[0, 0], [Y, 0], [Y, H], [Y - T, H], [Y - T, T], [0, T]];
    for (let i = 0; i < L.length; i++, face++) {
      const a = L[i], b = L[(i + 1) % L.length], A = [0, a[0], a[1]], B = [0, b[0], b[1]], C = [X, b[0], b[1]], D = [X, a[0], a[1]];
      tri(A, B, C); tri(A, C, D);
    }
    // The two ends: the L in four triangles using only its own six corners (no vertex partway along an edge).
    const TRI = [[0, 1, 4], [1, 2, 4], [2, 3, 4], [0, 4, 5]];
    TRI.forEach(t => tri(...t.map(i => [X, L[i][0], L[i][1]]))); face++;
    TRI.forEach(t => tri(...t.slice().reverse().map(i => [0, L[i][0], L[i][1]]))); face++;
    return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx), col: Uint8Array.from(col), fid: Uint32Array.from(fid) };
  }
  const loading = {};
  function loadRef(r) {
    const key = r.sha + '|' + (r.scale || 1);
    if (loading[key]) return;
    loading[key] = getRef(r.sha).then(async data => {
      if (!data && r.file && A && A.fetchRef) {
        S.busy = 'Reading the reference…'; refresh();
        const bytes = await A.fetchRef(r).catch(e => { A.toast('Couldn’t read the reference from GitHub: ' + e.message, 'error'); return null; });
        S.busy = '';
        if (bytes) { data = recordOf(r, bytes); await putRef(r.sha, data); }
      }
      if (!data) { if (A) A.toast('This formboard’s reference isn’t in this browser' + (r.file ? '' : ' and hasn’t been synced') + '. Import it again.', 'error'); refresh(); return; }
      if (r.kind === 'step') REF[key] = { mesh: await M3().decode(data.mesh) };
      else if (r.kind === 'image') REF[key] = await imagePlane(data.blob, r);
      else if (r.kind === 'dxf') REF[key] = await dxfPlane(data.text, r);
      refresh();
    }).catch(e => { if (A) A.toast('Couldn’t load the reference: ' + e.message, 'error'); }).finally(() => { delete loading[key]; });
  }
  // The stored record for a reference's bytes as uploaded (refBytes is the other way).
  function recordOf(r, bytes) {
    if (r.kind === 'step') return { mesh: bytes };
    if (r.kind === 'dxf') return { text: new TextDecoder().decode(bytes) };
    return { blob: new Blob([bytes], { type: /jpe?g$/i.test(r.name || '') ? 'image/jpeg' : /webp$/i.test(r.name || '') ? 'image/webp' : 'image/png' }) };
  }
  async function refBytes(r) {
    const data = await getRef(r.sha);
    if (!data) return null;
    if (r.kind === 'step') return data.mesh instanceof Uint8Array ? data.mesh : new Uint8Array(data.mesh);
    if (r.kind === 'dxf') return new TextEncoder().encode(data.text);
    return new Uint8Array(await data.blob.arrayBuffer());
  }
  function texFromCanvas(c) { return M3().texture(c.getContext('2d').getImageData(0, 0, c.width, c.height)); }
  async function imagePlane(blob, r) {
    const img = await createImageBitmap(blob), k = Math.min(1, 2048 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const mm = (r.mmPerPx || 1) * (r.scale || 1), w = img.width * mm, h = img.height * mm, m = M3().slab(w, h, 0.4);
    return { mesh: m, tex: { 1: texFromCanvas(c), 2: null }, T: [w / 2, h / 2, -0.2] };
  }
  // DXF: lines, arcs, circles, and polylines from ENTITIES, in the units $INSUNITS gives (1 in, 2 ft, 4 mm,
  // 5 cm, 6 m; unset: mm, and Calibrate fixes it). Blocks (INSERT) aren't read yet.
  const UNITS = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
  function readDxf(text) {
    const L = text.split(/\r?\n/), ents = [];
    let i = 0, sec = '', cur0 = null, units = 0;
    const flushE = () => { if (cur0) ents.push(cur0); cur0 = null; };
    while (i < L.length - 1) {
      const code = +L[i].trim(), val = L[i + 1].trim();
      i += 2;
      if (code === 0 && val === 'SECTION') { flushE(); sec = ''; continue; }
      if (code === 2 && !sec) { sec = val; continue; }
      if (code === 0 && val === 'ENDSEC') { flushE(); sec = ''; continue; }
      if (sec === 'HEADER' && code === 9 && val === '$INSUNITS') { units = +String(L[i + 1] || '').trim() || 0; continue; }
      if (sec !== 'ENTITIES') continue;
      if (code === 0) { flushE(); cur0 = { type: val, g: [] }; continue; }
      if (cur0) cur0.g.push([code, val]);
    }
    flushE();
    const segs = [], all = (e, c) => e.g.filter(g => g[0] === c).map(g => +g[1]), one = (e, c) => { const x = e.g.find(g => g[0] === c); return x ? +x[1] : 0; };
    const arc = (cx, cy, r, a0, a1) => { if (a1 < a0) a1 += 360; const n = Math.max(8, Math.ceil((a1 - a0) / 10)); for (let k = 0; k < n; k++) { const t0 = (a0 + (a1 - a0) * k / n) * DEG, t1 = (a0 + (a1 - a0) * (k + 1) / n) * DEG; segs.push([cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1)]); } };
    let verts = null;
    ents.forEach(e => {
      if (e.type === 'LINE') segs.push([one(e, 10), one(e, 20), one(e, 11), one(e, 21)]);
      else if (e.type === 'CIRCLE') arc(one(e, 10), one(e, 20), one(e, 40), 0, 360);
      else if (e.type === 'ARC') arc(one(e, 10), one(e, 20), one(e, 40), one(e, 50), one(e, 51));
      else if (e.type === 'LWPOLYLINE') {
        const xs = all(e, 10), ys = all(e, 20), closed = (one(e, 70) & 1) === 1;
        for (let k = 0; k + 1 < xs.length; k++) segs.push([xs[k], ys[k], xs[k + 1], ys[k + 1]]);
        if (closed && xs.length > 2) segs.push([xs[xs.length - 1], ys[ys.length - 1], xs[0], ys[0]]);
      } else if (e.type === 'POLYLINE') verts = { pts: [], closed: (one(e, 70) & 1) === 1 };
      else if (e.type === 'VERTEX' && verts) verts.pts.push([one(e, 10), one(e, 20)]);
      else if (e.type === 'SEQEND' && verts) {
        const p = verts.pts;
        for (let k = 0; k + 1 < p.length; k++) segs.push([p[k][0], p[k][1], p[k + 1][0], p[k + 1][1]]);
        if (verts.closed && p.length > 2) segs.push([p[p.length - 1][0], p[p.length - 1][1], p[0][0], p[0][1]]);
        verts = null;
      }
    });
    return { segs, units, unit: UNITS[units] || 1, known: !!UNITS[units] };
  }
  async function dxfPlane(text, r) {
    const d = readDxf(text), k = (d.unit || 1) * (r.scale || 1);
    if (!d.segs.length) throw new Error('No lines, arcs, circles, or polylines found in the DXF.');
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    d.segs.forEach(s => { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); y0 = Math.min(y0, s[1], s[3]); y1 = Math.max(y1, s[1], s[3]); });
    const pad = Math.max(x1 - x0, y1 - y0) * 0.02, W = (x1 - x0 + 2 * pad) * k, H = (y1 - y0 + 2 * pad) * k;
    const px = Math.min(4096, Math.max(512, Math.round(2048 * Math.max(W, H) / Math.max(W, H)))), sc = px / Math.max(W, H);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * sc)); c.height = Math.max(1, Math.round(H * sc));
    const g = c.getContext('2d');
    g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#2a2f36'; g.lineWidth = Math.max(1, c.width / 1400); g.beginPath();
    const X = x => (x - x0 + pad) * k * sc, Y = y => c.height - (y - y0 + pad) * k * sc;
    d.segs.forEach(s => { g.moveTo(X(s[0]), Y(s[1])); g.lineTo(X(s[2]), Y(s[3])); });
    g.stroke();
    // World: the drawing's own coordinates (scaled), its lower left at the pad.
    return { mesh: M3().slab(W, H, 0.4), tex: { 1: texFromCanvas(c), 2: null }, T: [(x0 - pad) * k + W / 2, (y0 - pad) * k + H / 2, -0.2], segs: d.segs.map(s => s.map(v => v * k)), known: d.known };
  }
  // An STL (binary or ASCII), as model3d's mesh: one gray, no CAD faces. Read in mm.
  function readStl(bytes) {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), dv = new DataView(buf);
    const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
    let pos;
    if (n && 84 + n * 50 === buf.byteLength) {
      pos = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) pos[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
    } else if (/^\s*solid/i.test(new TextDecoder().decode(bytes.subarray(0, 512)))) {
      const nums = [], re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, txt = new TextDecoder().decode(bytes);
      let m;
      while ((m = re.exec(txt))) nums.push(+m[1], +m[2], +m[3]);
      pos = Float32Array.from(nums);
    } else throw new Error('This doesn’t read as an STL file.');
    const nt = Math.floor(pos.length / 9);
    if (!nt) throw new Error('The STL has no triangles.');
    const idx = new Uint32Array(nt * 3);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    const col = new Uint8Array(nt * 3).fill(196), fid = new Uint32Array(nt);
    return { pos, idx, col, fid };
  }
  // A STEP is read in the browser by OpenCascade, which slows down sharply with size (measured 2026-11-15, see
  // docs/formboard.md, *Reference size*): over STEP_WARN, ask first and suggest an STL, which reads at once.
  const STEP_WARN = 25 * 1048576;
  async function importRef(file) {
    const f = cur();
    if (!f || !file) return;
    if (S.busy) { A.toast('A reference is still being read. Wait for it, or reload the page to stop it.'); return; }
    const name = file.name, ext = (name.split('.').pop() || '').toLowerCase();
    const mb = (file.size / 1048576).toFixed(1);
    if (/^(step|stp)$/.test(ext) && file.size > STEP_WARN && !confirm(`This STEP is ${mb} MB. Reading a STEP this big in the browser can take many minutes or not finish at all.\n\nFaster: export an STL from your CAD (coarse is fine) and use that, or a STEP of just the frame.\n\nRead the STEP anyway?`)) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = await sha(bytes);
    let ref = null, tick = 0;
    const busy = label => { const t0 = Date.now(); S.busy = label; refresh(); tick = setInterval(() => { S.busy = label + ' ' + Math.round((Date.now() - t0) / 1000) + ' s'; const el = document.querySelector('.fb-busy'); if (el) el.lastChild.textContent = S.busy; }, 1000); };
    try {
      if (/^(step|stp)$/.test(ext)) {
        busy(`Reading the STEP (${mb} MB)…`);
        const raw = await M3().readStep(bytes);
        // Too big for the browser's reader: it can report success with every part empty (a 53 MB assembly,
        // 2,468 parts, 2026-11-15).
        if (!raw.idx.length) throw new Error('The STEP reader found its parts but couldn’t make any geometry from them, which happens when a file is too big for the browser. Export an STL from your CAD instead (coarse is fine), or a STEP of just the frame.');
        const mesh = M3().simplify(raw, 80000), gz = await M3().encode(mesh);
        await putRef(id, { mesh: gz });
        ref = { kind: 'step', name, sha: id, tris: mesh.idx.length / 3, scale: 1 };
      } else if (ext === 'stl') {
        busy(`Reading the STL (${mb} MB)…`);
        await new Promise(r => setTimeout(r, 30));
        const raw = readStl(bytes), mesh = M3().simplify(raw, 80000), gz = await M3().encode(mesh);
        await putRef(id, { mesh: gz });
        ref = { kind: 'step', format: 'stl', name, sha: id, tris: mesh.idx.length / 3, scale: 1 };
        A.toast('The STL is read in mm. Export it in millimeters from your CAD.');
      } else if (ext === 'dxf') {
        const text = new TextDecoder().decode(bytes), d = readDxf(text);
        if (!d.segs.length) throw new Error('No lines, arcs, circles, or polylines found.');
        await putRef(id, { text });
        ref = { kind: 'dxf', name, sha: id, scale: 1, units: d.units, calibrated: d.known };
        if (!d.known) A.toast('The DXF doesn’t say its units, so it’s read as mm. Use Calibrate to set the scale.');
      } else if (/^(png|jpe?g|webp)$/.test(ext)) {
        await putRef(id, { blob: new Blob([bytes], { type: file.type || 'image/png' }) });
        const img = await createImageBitmap(new Blob([bytes]));
        ref = { kind: 'image', name, sha: id, px: [img.width, img.height], mmPerPx: 1, scale: 1, calibrated: false };
        A.toast('A picture has no scale: use Calibrate, click two points, and type the distance between them.');
      } else throw new Error('Formboard reads STEP, STL, DXF, PNG, or JPEG.');
    } catch (e) { clearInterval(tick); S.busy = ''; A.toast('Couldn’t read ' + name + ': ' + e.message, 'error'); refresh(); return; }
    clearInterval(tick);
    S.busy = '';
    change(x => { x.reference = ref; });
    if (S.st) { S.fitNext = true; }
  }

  // ── Routing ──
  // A cable's classes are its tags in the system (assets/tags.js, Chris, 2026-11-15): the ids of this
  // formboard's classes named the same, without case.
  const classIds = (f, tags) => f.classes.filter(k => LM.tags.has(tags, k.name)).map(k => k.id);
  function cableInputs(sc, f) {
    return sc.fl.cables.map(c => {
      const ends = c.ends.map(e => { const o = e.block && sc.blocks[e.block]; const p = o ? connPoint(o, e.conn) : null; return p ? { key: e.key, p, placed: o.placed } : null; }).filter(Boolean);
      const own = f.cables[c.path] || {};
      return { c, own, input: { id: c.path, classes: classIds(f, c.tags), vias: own.vias || [], pinned: !!own.pinned, route: own.route || null, endMm: own.endMm || {}, areaMm2: c.areaMm2, ends } };
    });
  }
  const endsKey = ends => ends.map(e => e.key + ':' + e.p.map(v => v.toFixed(1)).join(',')).join('|');
  // Everything else a route came from: the channels, the settings, the classes, and the cable's own classes,
  // vias, and end allowances. A route is stale when its ends or this have changed since Route.
  const fnv = str => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
  const inKey = (f, own, c) => fnv(JSON.stringify([f.channels, f.settings, f.classes, c ? classIds(f, c.tags) : [], own.vias || [], own.endMm || {}]));
  function routeAll() {
    const f = cur();
    if (!f) return;
    const sc = scene(), list = cableInputs(sc, f);
    const out = LM.fbroute.routeAll(f.channels, list.map(x => x.input), f.settings);
    let ok = 0, bad = 0, pinned = 0;
    change(x => {
      list.forEach(({ c, input }) => {
        const r = out.results[c.path];
        const own = x.cables[c.path] = Object.assign({}, x.cables[c.path] || {});
        if (input.pinned && own.route) { pinned++; return; }
        if (input.ends.length < 2) { delete own.route; return; }
        own.route = { ok: r.ok, length: r.length, flags: r.flags, at: Date.now(), ends: endsKey(input.ends), from: inKey(x, own, c), provisional: input.ends.some(e => !e.placed),
          legs: r.legs.map(l => ({ from: l.from, to: l.to, ok: l.ok, pts: l.pts.map(p => p.map(r1)), length: l.length, straight: l.straight != null ? r1(l.straight) : undefined,
            path: l.path != null ? r1(l.path) : undefined, drops: l.drops != null ? r1(l.drops) : undefined, channels: l.channels ? Object.fromEntries(Object.entries(l.channels).map(([k, v]) => [k, r1(v)])) : undefined, parts: l.parts })) };
        if (r.ok) ok++; else bad++;
      });
    });
    S.fill = out.fill;
    A.toast(`Routed ${ok} cable${ok === 1 ? '' : 's'}` + (bad ? `; ${bad} not routed` : '') + (pinned ? `; ${pinned} pinned, kept` : '') + '.');
  }
  // A cable's route as stored, and whether its ends have moved since.
  function routeOf(f, x) {
    const own = f.cables[x.c.path], r = own && own.route;
    if (!r) return null;
    const moved = x.input.ends.length >= 2 && r.ends !== endsKey(x.input.ends), changed = !own.pinned && r.from !== inKey(f, own, x.c);
    return Object.assign({}, r, { stale: moved || changed, moved, changed });
  }

  // Apply lengths (Chris, 2026-11-15): the routed length as the placed cable's length, a variant only where it
  // differs from the base part's own; equal, the override is cleared. Cables with an unplaced end are skipped.
  function baseLength(c) {
    if (c.kind === 'bought') return null;
    if (c.kind !== 'harness') return null;
    const h = A.harness(c.harness), seg = h && segBetween(h, c);
    return seg && seg.length ? seg.length : null;
  }
  function segBetween(h, c) {
    const keys = c.ends.filter(e => !e.device).map(e => e.key);
    if (keys.length !== 2) return null;
    const list = h.segments.filter(s => (s.a === keys[0] && s.b === keys[1]) || (s.a === keys[1] && s.b === keys[0]));
    return list.length === 1 && h.segments.filter(s => s.a === keys[0] || s.b === keys[0] || s.a === keys[1] || s.b === keys[1]).length === 1 ? list[0] : null;
  }
  function applyLengths(only) {
    const f = cur();
    if (!f) return;
    const sc = scene(), list = [];
    cableInputs(sc, f).forEach(x => {
      if (only && x.c.path !== only) return;
      const r = routeOf(f, x);
      if (!r || !r.ok || !r.length || r.stale || r.provisional) return;
      const base = baseLength(x.c);
      list.push({ system: x.c.system, cable: x.c.id, lengthMm: base && base === r.length ? null : r.length });
    });
    if (!list.length) { A.toast('Nothing to apply: route first, and place every end.'); return; }
    let was = null;
    const run = () => { was = LM.system.setLengths(list); A.refresh(); };
    run();
    const prev = was;
    change(() => {}, { undo: () => { LM.system.setLengths(prev); }, redo: () => { LM.system.setLengths(list); } });
    A.toast(`Applied ${list.length} length${list.length === 1 ? '' : 's'} to the system's cables.`);
  }
  // Tags written to the system's cables from here (the cable panel, a class renamed), with this formboard's own
  // change (fn, or none), as one step of the formboard's undo, as Apply lengths does.
  function tagsOutside(list, fn) {
    const prev = LM.system.setTags(list);
    A.refresh();
    return change(fn || (() => {}), { undo: () => { LM.system.setTags(prev); }, redo: () => { LM.system.setTags(list); } });
  }
  LM.tags.handle('fb', (path, tags) => {
    const c = S.flat && S.flat.cables.find(k => k.path === path);
    if (c) tagsOutside([{ system: c.system, cable: c.id, tags }]);
  });
  // Save to base part: the routed length into the part itself. A harness: its one segment between the two
  // ends; a purchased cable: its length (the placed cable's length is its own). The confirm names the
  // harness's other uses whose lengths differ.
  function saveBase(path) {
    const f = cur(), sc = scene(), x = cableInputs(sc, f).find(y => y.c.path === path), r = x && routeOf(f, x);
    if (!x || !r || !r.ok || !r.length) return;
    const c = x.c;
    if (c.kind === 'bought' || c.kind === 'link') { applyLengths(path); return; }
    const h = A.harness(c.harness), seg = h && segBetween(h, c);
    if (!seg) { A.toast('Only a harness with one segment between its two ends can take a length here.', 'error'); return; }
    const others = LM.system.live().flatMap(s => s.cables.filter(k => k.harness === c.harness && !(s.id === c.system && k.id === c.id)).map(k => ({ s, k })));
    const differ = others.filter(o => (o.k.lengthMm || r.length) !== r.length);
    if (!confirm(`Set ${h.title}${h.pn ? ' (' + h.pn + ')' : ''} to ${r.length} mm?` + (differ.length ? `\n\nIt’s used ${differ.length} other place${differ.length === 1 ? '' : 's'} at another length:\n` + differ.slice(0, 8).map(o => `• ${o.s.title}: ${o.k.lengthMm || seg.length || 'its own'} mm`).join('\n') + '\nThose become variants, or match.' : ''))) return;
    const old = seg.length == null ? null : seg.length, oldCab = LM.system.setLengths([{ system: c.system, cable: c.id, lengthMm: null }]);
    A.editHarness(c.harness, hh => { const sg = hh.segments.find(s => s.id === seg.id); if (sg) sg.length = r.length; });
    change(() => {}, {
      undo: () => { A.editHarness(c.harness, hh => { const sg = hh.segments.find(s => s.id === seg.id); if (sg) sg.length = old; }); LM.system.setLengths(oldCab); },
      redo: () => { A.editHarness(c.harness, hh => { const sg = hh.segments.find(s => s.id === seg.id); if (sg) sg.length = r.length; }); LM.system.setLengths([{ system: c.system, cable: c.id, lengthMm: null }]); },
    });
    A.toast(`${h.title} is ${r.length} mm now.`);
  }

  // ── The page ──
  function render(page, rootId) {
    S.root = rootId;
    let host = page.querySelector('.fb-host');
    if (!host) { host = document.createElement('div'); host.className = 'fb-host'; page.appendChild(host); }
    host.hidden = false;
    const list = forSystem(rootId);
    if (!cur() || cur().system !== rootId) S.cur = (list.find(f => f.id === (S.ui.last || {})[rootId]) || list[0] || {}).id || null;
    const f = cur();
    if (!f) {
      if (S.st) { S.st.destroy(); S.st = null; }
      host.innerHTML = `<div class="fb-empty card"><h2>Formboard</h2><p>Place this system’s boards and devices on a drawing or a 3D model, draw the channels its cables run in, and route them for their lengths.</p>` +
        `<button class="btn btn-primary" data-fb="new">New formboard</button></div>`;
      wire(host);
      return;
    }
    if (!host.querySelector('.fb-view') || host.dataset.fid !== f.id) {
      host.dataset.fid = f.id;
      host.innerHTML = `<div class="fb-view"><div class="fb-bar" id="fb-bar"></div><div class="fb-main"><div class="fb-stage-wrap" id="fb-stage"></div><div class="sys-fwrap fb-fwrap"></div><aside class="rail fb-panel" id="fb-panel"></aside></div></div>`;
      wire(host);
      if (S.st) S.st.destroy();
      S.st = LM.stage.create(stageHost());
      const ui = (S.ui.cams || {})[f.id];
      if (ui) S.st.load(ui);
      S.st.mount(host.querySelector('#fb-stage'));
      S.fitNext = !ui || !ui.cam;
    }
    host.querySelector('#fb-bar').innerHTML = barHtml(f, list);
    const sc = scene();
    S.sc = sc;
    S.st.setObjs(sc.objs);
    if (S.fitNext && (!f.reference || sc.objs.some(o => o.id === 'ref'))) { S.fitNext = false; S.st.fit(); }
    if (!S.st.cam) S.st.fit();
    S.st.draw(true);
    LM.system.filterUi();
    const ss = document.querySelector('#sys-stats'); if (ss) { const h = LM.system.statsStrip(); ss.innerHTML = h; ss.hidden = !h; }
    const panel = host.querySelector('#fb-panel'), keep = panel.scrollTop;
    panel.innerHTML = panelHtml(f, sc);
    panel.scrollTop = keep;
  }
  function leave(page) { const h = page.querySelector('.fb-host'); if (h) h.hidden = true; }
  function refresh() { if (A) A.refresh(); }
  const toolBtn = (t, label, tip) => `<button class="${S.tool === t ? 'on' : ''}" data-fb="tool" data-tool="${t}" title="${tip}">${label}</button>`;
  function barHtml(f, list) {
    const st = S.st || {};
    return `<select data-fbsel="pick" aria-label="Formboard">${list.map(x => `<option value="${esc(x.id)}"${x.id === f.id ? ' selected' : ''}>${esc(x.title)}</option>`).join('')}<option value="+new">New formboard…</option></select>` +
      `<span class="fb-sep"></span><label class="btn" title="A 3D model (STEP, or STL for a big assembly), a DXF, or a picture (PNG or JPEG) to place the system on">Reference…<input type="file" accept=".step,.stp,.stl,.dxf,.png,.jpg,.jpeg,.webp" data-fbfile hidden></label>` +
      (f.reference && (f.reference.kind === 'dxf' || f.reference.kind === 'image') ? `<button class="btn${S.tool === 'calibrate' ? ' on' : ''}" data-fb="tool" data-tool="calibrate" title="Click two points on the reference, then type the distance between them">Calibrate</button>` : '') +
      `<span class="fb-sep"></span><div class="seg" role="group" aria-label="Tool">${toolBtn('select', 'Select', 'Select and move blocks (Esc)')}${toolBtn('channel', 'Draw channel', 'Click point to point along the path; double-click or Enter to finish, Esc to cancel')}${toolBtn('snap', 'Snap block', 'Pick a corner, edge, hole, or face on the selected block, then where it goes')}</div>` +
      `<span class="fb-sep"></span><button class="btn${st.quad ? ' on' : ''}" data-fb="quad" aria-pressed="${!!st.quad}" title="Top, Front, and Right beside the 3D view">Four views</button>` +
      (st.quad ? `<label class="fb-link" title="A pan or zoom in one flat view moves the other two"><input type="checkbox" data-fbchk="link"${st.link ? ' checked' : ''}> Link views</label>` : '') +
      `<button class="btn" data-fb="fit" title="Fit every view (F)">Fit</button><span class="fb-grow"></span>` +
      (S.busy ? `<span class="fb-busy"><span class="spin" aria-hidden="true"></span>${esc(S.busy)}</span>` : '') +
      `<button class="btn btn-primary" data-fb="route" title="Route every cable that isn’t pinned through the channels its classes allow">Route</button>` +
      `<button class="btn" data-fb="apply" title="Write each routed length as its placed cable’s length in the system (a variant only where it differs from the part’s own)">Apply lengths</button>`;
  }

  // ── The panel ──
  const fld = (label, body, hint) => `<div class="field"><label class="field-label">${label}</label>${body}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const num = (name, v, extra) => `<input type="number" data-fbin="${name}" value="${v == null ? '' : esc(v)}"${extra || ''}>`;
  const fmt = v => (v == null || !isFinite(v) ? '—' : U.fmtLen(Math.round(v)));
  function panelHtml(f, sc) {
    const s = S.sel;
    if (S.tool === 'channel') return head('Draw a channel') + `<div class="rail-body"><p class="hint">Click point to point along the path: on the model a click snaps to its corners, edges, and faces, and the channel stands its height off the face. Off the model, points go on the view’s plane. Click an existing channel’s point to join it. Double-click or Enter finishes; Esc cancels.</p>${S.draft ? `<p>${S.draft.pts.length} point${S.draft.pts.length === 1 ? '' : 's'} so far.</p>` : ''}${fld('Width, mm', num('draft.w', (S.draft || {}).w || CH.w, ' min="1"'))}${fld('Height, mm', num('draft.h', (S.draft || {}).h || CH.h, ' min="1"'))}</div>`;
    if (S.tool === 'calibrate') return head('Calibrate') + `<div class="rail-body"><p class="hint">Click two points on the reference whose distance you know, then type it.</p>${S.cal && S.cal.length ? '<p>1 of 2 picked.</p>' : ''}</div>`;
    if (S.tool === 'snap') return head('Snap block') + `<div class="rail-body"><p class="hint">${!S.sel || S.sel.kind !== 'block' ? 'Select a block first.' : !S.snap ? 'Step 1 of 2: pick a corner, edge, hole, or face on the selected block.' : 'Step 2 of 2: pick where it goes, on the model or another block.'}</p></div>`;
    if (s && s.kind === 'block') { const o = sc.blocks[s.id]; if (o) return blockPanel(f, sc, o); }
    if (s && s.kind === 'channel') { const c = f.channels.find(x => x.id === s.id); if (c) return channelPanel(f, c); }
    if (s && s.kind === 'cable') { const x = cableInputs(sc, f).find(y => y.c.path === s.id); if (x) return cablePanel(f, sc, x); }
    return boardPanel(f, sc);
  }
  const head = (title, sub) => `<div class="rail-head">${S.sel ? '<button class="sys-back" data-fb="back" title="Back to the formboard">‹ Back</button>' : ''}<div class="rail-title">${esc(title)}</div>${sub ? `<div class="rail-sub">${sub}</div>` : ''}</div>`;
  function boardPanel(f, sc) {
    const xs = cableInputs(sc, f), unplaced = Object.values(sc.blocks).filter(o => !o.placed);
    const rows = xs.map(x => {
      const r = routeOf(f, x), st = !r ? '<span class="fb-st">Not routed yet</span>' : !r.ok && !r.stale ? '<span class="fb-st bad">Not routed</span>' : r.stale ? '<span class="fb-st">Route again</span>' : `<span class="fb-st ok">${fmt(r.length)}${r.provisional ? ' (provisional)' : ''}</span>`;
      return `<button class="fb-row" data-fb="sel" data-kind="cable" data-id="${esc(x.c.path)}"><span class="fb-sw" style="background:${esc(x.c.color || '#7d8590')}"></span><span class="fb-name">${esc(x.c.title)}${x.c.pn ? ` <span class="fb-pn">${esc(x.c.pn)}</span>` : ''}</span>${st}</button>`;
    }).join('');
    const classes = f.classes.map(c => `<div class="fb-class"><input type="color" value="${esc(c.color)}" data-fbin="class.color.${esc(c.id)}" aria-label="Color of ${esc(c.name)}"><input type="text" value="${esc(c.name)}" data-fbin="class.name.${esc(c.id)}" aria-label="Class name"><button class="icon-btn" data-fb="class-del" data-id="${esc(c.id)}" title="Remove this class" aria-label="Remove">×</button></div>`).join('');
    const ref = f.reference;
    return head(f.title, esc((sc.fl.title || '') + ' · ' + sc.fl.blocks.length + ' blocks, ' + sc.fl.cables.length + ' cables')) + `<div class="rail-body">` +
      fld('Title', `<input type="text" data-fbin="title" value="${esc(f.title)}">`) +
      fld('Reference', ref ? `${esc(ref.name)} <span class="hint">(${ref.kind === 'step' ? (ref.format === 'stl' ? 'STL, ' : 'STEP, ') + (ref.tris || 0).toLocaleString() + ' triangles' : ref.kind === 'builtin' ? 'built in' : ref.kind === 'dxf' ? 'DXF' + (ref.calibrated ? '' : ', not calibrated') : 'picture' + (ref.calibrated ? '' : ', not calibrated')})</span>` : '<span class="hint">None yet: Reference… in the bar.</span>') +
      `<div class="fb-h">Cables</div><div class="fb-list">${rows || '<p class="hint">This system has no cables yet.</p>'}</div>` +
      (unplaced.length ? `<div class="fb-h">Not placed <span class="count">${unplaced.length}</span></div><p class="hint">Faded until moved. Lengths to them are provisional, and Apply skips them.</p><div class="fb-list">${unplaced.map(o => `<button class="fb-row" data-fb="sel" data-kind="block" data-id="${esc(o.b.path)}"><span class="fb-name">${esc(blockName(o.b))}</span></button>`).join('')}</div>` : '') +
      `<div class="fb-h">Classes</div><p class="hint">A cable may use a channel when the channel isn’t exclusive, or when one of the cable’s tags (set on it here or in the system) names one of the channel’s classes.</p>${classes}<button class="btn" data-fb="class-add">Add a class</button>` +
      `<div class="fb-h">Lengths</div><div class="field-row">${fld('Slack, %', num('set.slackPct', f.settings.slackPct, ' min="0" step="0.5"'))}${fld('Each end, mm', num('set.endMm', f.settings.endMm, ' min="0"'))}</div>` +
      `<div class="field-row">${fld('Long drop over, mm', num('set.dropMax', f.settings.dropMax, ' min="0"'))}${fld('Round up to, mm', num('set.roundMm', f.settings.roundMm, ' min="1"'))}</div>` +
      `<div class="sys-actions"><button class="btn btn-danger" data-fb="delete">Delete formboard</button></div></div>`;
  }
  const blockName = b => [b.ref, b.name].filter(Boolean).join(' ') || (b.kind === 'device-end' ? 'Device' : 'Block');
  function groupOf(sc, path) {
    // The placed system this leaf came from (its first path step), for Keep as one block.
    const parts = path.split('/');
    return parts.length > 1 ? parts[0] : null;
  }
  function blockPanel(f, sc, o) {
    const b = o.b, T = o.T, g = groupOf(sc, b.path), root = LM.system.get(f.system), gb = g && root && root.blocks.find(x => x.id === g);
    const gs = gb && LM.system.get(gb.system);
    return head(blockName(b), esc({ board: 'Board', device: 'Device', kept: 'Placed system, kept as one block', 'device-end': 'Device at a harness’s end' }[b.kind] || 'Block') + (o.placed ? '' : ' · not placed')) + `<div class="rail-body">` +
      `<div class="field-row">${['X', 'Y', 'Z'].map((a, i) => fld(a + ', mm', num('pos.' + i, r1(T[i]), ' step="1"'))).join('')}</div>` +
      `<div class="sys-actions"><button class="btn" data-fb="turn" data-axis="2" title="R">Turn 90° about Z</button><button class="btn" data-fb="turn" data-axis="0">About X</button><button class="btn" data-fb="turn" data-axis="1">About Y</button></div>` +
      `<div class="sys-actions"><button class="btn" data-fb="tool" data-tool="snap">Snap to…</button>${o.placed ? '<button class="btn" data-fb="unplace" title="Back to its start spot, faded">Unplace</button>' : ''}</div>` +
      (b.kind === 'kept' ? `<div class="sys-actions"><button class="btn" data-fb="unkeep" data-id="${esc(b.path)}">Open into its boards and devices</button></div>` : '') +
      (gs && b.kind !== 'kept' ? `<div class="sys-actions"><button class="btn" data-fb="keep" data-id="${esc(g)}" title="For a sub-assembly that sits as one box with its inside cabling done: its cables inside aren’t routed">Keep ${esc(gs.title)} as one block</button></div>` : '') +
      `<p class="hint">${esc(b.path)}</p></div>`;
  }
  function classTicks(f, list, name) {
    if (!f.classes.length) return '<p class="hint">No classes yet: add them on the formboard’s panel (‹ Back).</p>';
    return `<div class="fb-ticks">${f.classes.map(c => `<label class="fb-tick"><input type="checkbox" data-fbchk="${name}.${esc(c.id)}"${list.includes(c.id) ? ' checked' : ''}><span class="fb-sw" style="background:${esc(c.color)}"></span>${esc(c.name)}</label>`).join('')}</div>`;
  }
  function channelPanel(f, c) {
    const runs = [];
    for (let i = 0; i + 1 < c.pts.length; i++) runs.push(dist(c.pts[i], c.pts[i + 1]));
    const total = runs.reduce((a, b) => a + b, 0), fill = S.fill && S.fill[c.id];
    return head(c.name || 'Channel', `${fmt(total)} long, ${c.pts.length} points`) + `<div class="rail-body">` +
      fld('Name', `<input type="text" data-fbin="ch.name" value="${esc(c.name || '')}">`) +
      `<div class="field-row">${fld('Width, mm', num('ch.w', c.w, ' min="1"'))}${fld('Height, mm', num('ch.h', c.h, ' min="1"'))}</div>` +
      fld('Classes', classTicks(f, c.classes || [], 'ch.class')) +
      `<label class="fb-tick"><input type="checkbox" data-fbchk="ch.exclusive"${c.exclusive ? ' checked' : ''}> Exclusive: only cables sharing a class</label>` +
      fld('Extra length, mm per meter', num('ch.extra', c.extraPerM || 0, ' min="0"'), 'A drag chain’s loop or a coiled run.') +
      fld('Runs', `<div class="fb-runs">${runs.map((l, i) => `<label>Run ${i + 1} <input type="number" data-fbin="ch.run.${i}" value="${Math.round(l)}" min="1"></label>`).join('')}</div>`, 'Typing a run’s length moves the point at its end along it. Drag points on the canvas; double-click a run to add one.') +
      (fill ? fld('Fill', `${fill.pct}% <span class="hint">(${fill.cables.length} cable${fill.cables.length === 1 ? '' : 's'}, ${r1(fill.area)} mm² of ${Math.round(fill.section)} mm²)</span>`) : '') +
      `<div class="sys-actions"><button class="btn btn-danger" data-fb="ch-del">Delete channel</button></div></div>`;
  }
  // Which of a cable's tags are this formboard's classes, and which aren't (they let it into nothing here).
  function tagHint(f, tags) {
    const none = (tags || []).filter(n => !f.classes.some(k => LM.tags.key(k.name) === LM.tags.key(n)));
    return 'Kept on the cable in the system, and shown there. A channel lets it in when they share a class name.' +
      (none.length ? ` No class here for ${none.map(esc).join(', ')}.` : '');
  }
  function cablePanel(f, sc, x) {
    const c = x.c, own = f.cables[c.path] || {}, r = routeOf(f, x);
    const ends = c.ends.map(e => { const o = e.block && sc.blocks[e.block]; const cn = o && o.b.conns.find(k => k.id === e.conn); return `<li>${o ? esc(blockName(o.b) + (cn && cn.ref && !e.device ? ' ' + cn.ref : '')) : '<span class="hint">not plugged</span>'}${o && !o.placed ? ' <span class="hint">(not placed)</span>' : ''}</li>`; }).join('');
    let res = '<p class="hint">Not routed yet.</p>';
    if (r) {
      if (!r.ok) res = `<p class="fb-st bad">Not routed</p><p class="hint">No path through the channels it may use. Straight: ${r.legs.map(l => fmt(l.straight)).join(', ')}.</p>`;
      else res = r.legs.map(l => { const p = l.parts || {}; return `<table class="fb-parts"><tr><td>Through the channels</td><td>${fmt(l.path)}</td></tr><tr><td>Drops at the ends</td><td>${fmt(l.drops)}</td></tr><tr><td>Slack</td><td>${fmt(p.slack)}</td></tr><tr><td>Channel extras</td><td>${fmt(p.extra)}</td></tr><tr><td>End allowances</td><td>${fmt(p.ends)}</td></tr><tr class="tot"><td>Build length</td><td>${fmt(l.length)}</td></tr></table>`; }).join('') +
        (r.flags && r.flags.includes('long-drop') ? `<p class="hint">An end is more than ${fmt(f.settings.dropMax)} from its nearest channel.</p>` : '');
      if (r.moved) res += '<p class="hint">Its ends have moved since: Route again.</p>';
      else if (r.changed) res += '<p class="hint">Its channels, classes, or settings have changed since: Route again.</p>';
      if (r.provisional) res += '<p class="hint">An end isn’t placed yet, so this length is provisional.</p>';
    }
    const canApply = r && r.ok && r.length && !r.stale && !r.provisional;
    const h = c.kind === 'harness' ? A.harness(c.harness) : null, seg = h && segBetween(h, c);
    const vias = f.channels.map(k => `<label class="fb-tick"><input type="checkbox" data-fbchk="cab.via.${esc(k.id)}"${(own.vias || []).includes(k.id) ? ' checked' : ''}>${esc(k.name || 'Channel')}</label>`).join('');
    return head(c.title, esc((c.pn || 'no part number') + ' · ' + ({ harness: 'Loom harness', bought: 'Purchased cable', link: 'Generic connection' }[c.kind] || ''))) + `<div class="rail-body">` +
      fld('Ends', `<ul class="fb-ends">${ends}</ul>`) +
      fld('Tags', LM.tags.editorHtml('fb:' + c.path, c.tags, { empty: 'No tags: any channel that isn’t exclusive.' }), tagHint(f, c.tags)) +
      `<label class="fb-tick"><input type="checkbox" data-fbchk="cab.pinned"${own.pinned ? ' checked' : ''}> Pinned: Route keeps its route</label>` +
      (f.channels.length ? fld('Must pass through', `<div class="fb-ticks">${vias}</div>`) : '') +
      `<div class="field-row">${c.ends.map(e => fld('End ' + esc(e.key.slice(0, 6)) + ', mm', num('cab.end.' + e.key, (own.endMm || {})[e.key] != null ? own.endMm[e.key] : '', ` min="0" placeholder="${f.settings.endMm}"`))).join('')}</div>` +
      `<div class="fb-h">Route</div>${res}` +
      `<div class="sys-actions"><button class="btn" data-fb="apply-one" data-id="${esc(c.path)}"${canApply ? '' : ' disabled'} title="Write it as this placed cable’s length in the system">Apply length</button>` +
      (c.kind === 'harness' ? `<button class="btn" data-fb="save-base" data-id="${esc(c.path)}"${canApply && seg ? '' : ' disabled'} title="${seg ? 'Set the harness’s own segment to this length, for every use' : 'Only a harness with one segment between its two ends'}">Save to base part</button>` : '') + `</div>` +
      (c.lengthMm ? `<p class="hint">In the system now: ${fmt(c.lengthMm)} (${esc(c.pn)}).</p>` : '') + `</div>`;
  }

  // ── Interaction ──
  function wire(host) {
    host.addEventListener('click', e => {
      const t = e.target.closest('[data-fb]');
      if (!t) return;
      act(t.dataset.fb, t);
    });
    host.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.fbfile != null && t.files && t.files[0]) { importRef(t.files[0]); t.value = ''; return; }
      if (t.dataset.fbsel === 'pick') { if (t.value === '+new') act('new'); else { S.cur = t.value; remember(); S.sel = null; refresh(); } return; }
      if (t.dataset.fbchk) return check(t.dataset.fbchk, t.checked);
      if (t.dataset.fbin) return input(t.dataset.fbin, t.value);
    });
  }
  function remember() { S.ui.last = S.ui.last || {}; if (S.cur && S.root) S.ui.last[S.root] = S.cur; saveUi(); }
  function act(a, t) {
    const f = cur(), sc = S.sc;
    switch (a) {
      case 'new': {
        const title = prompt('Name the new formboard', forSystem(S.root).length ? 'Formboard ' + (forSystem(S.root).length + 1) : 'Formboard');
        if (title == null) return;
        const x = blank(S.root, title.trim() || 'Formboard');
        S.store[x.id] = x; S.cur = x.id; remember(); persist(); refresh(); return;
      }
      case 'delete': if (f && confirm(`Delete “${f.title}”? Undo brings it back while this page is open.`)) { change(x => { x.deleted = true; }); S.cur = null; } return;
      case 'tool': S.tool = t.dataset.tool; S.draft = null; S.snap = null; S.cal = null; if (S.tool === 'snap' && (!S.sel || S.sel.kind !== 'block')) A.toast('Select a block first, then Snap block.'); refresh(); return;
      case 'quad': if (S.st) { S.st.setQuad(!S.st.quad); refresh(); } return;
      case 'fit': if (S.st) { S.st.fit(); S.st.draw(true); } return;
      case 'route': routeAll(); return;
      case 'apply': applyLengths(); return;
      case 'apply-one': applyLengths(t.dataset.id); return;
      case 'save-base': saveBase(t.dataset.id); return;
      case 'back': S.sel = null; refresh(); return;
      case 'sel': S.sel = { kind: t.dataset.kind, id: t.dataset.id }; refresh(); return;
      case 'class-add': change(x => { x.classes.push({ id: U.uid('k'), name: 'Class ' + (x.classes.length + 1), color: PALETTE[x.classes.length % PALETTE.length] }); }); return;
      case 'class-del': change(x => { const id = t.dataset.id; x.classes = x.classes.filter(c => c.id !== id); x.channels.forEach(c => { c.classes = (c.classes || []).filter(k => k !== id); }); }); return;
      case 'turn': if (S.sel && S.sel.kind === 'block' && sc.blocks[S.sel.id]) turnBlock(sc.blocks[S.sel.id], +t.dataset.axis, 90); return;
      case 'unplace': if (S.sel) change(x => { delete x.blocks[S.sel.id]; }); return;
      case 'keep': change(x => { x.keep[t.dataset.id] = true; }); S.sel = null; return;
      case 'unkeep': change(x => { delete x.keep[t.dataset.id]; delete x.blocks[t.dataset.id]; }); S.sel = null; return;
      case 'ch-del': if (S.sel) change(x => { x.channels = x.channels.filter(c => c.id !== S.sel.id); Object.values(x.cables).forEach(c => { if (c.vias) c.vias = c.vias.filter(v => v !== S.sel.id); }); }); S.sel = null; refresh(); return;
    }
  }
  function check(name, on) {
    const f = cur(), s = S.sel;
    if (name === 'link') { if (S.st) S.st.setLink(on); return; }
    const own = () => { const x = cur(); return (x.cables[s.id] = x.cables[s.id] || {}); };
    if (name.startsWith('ch.class.')) { const id = name.slice(9); change(x => { const c = x.channels.find(k => k.id === s.id); c.classes = (c.classes || []).filter(k => k !== id).concat(on ? [id] : []); }); return; }
    if (name === 'ch.exclusive') { change(x => { x.channels.find(k => k.id === s.id).exclusive = on; }); return; }
    if (name.startsWith('cab.via.')) { const id = name.slice(8); change(() => { const o = own(); o.vias = (o.vias || []).filter(k => k !== id).concat(on ? [id] : []); }); return; }
    if (name === 'cab.pinned') { change(() => { own().pinned = on; }); return; }
    if (f) refresh();
  }
  function input(name, v) {
    const s = S.sel;
    if (name === 'title') return change(x => { x.title = String(v).trim() || 'Formboard'; });
    if (name.startsWith('set.')) return change(x => { x.settings[name.slice(4)] = Math.max(0, +v || 0); });
    if (name.startsWith('class.')) {
      const [, what, id] = name.split('.'), f = cur(), was = f && f.classes.find(k => k.id === id);
      if (!was) return;
      const to = what === 'name' ? String(v).trim() || was.name : v;
      // A class renamed renames that tag on this formboard's cables in the system, so they keep their way in.
      if (what === 'name' && LM.tags.key(to) !== LM.tags.key(was.name) && S.flat) {
        const list = S.flat.cables.filter(c => LM.tags.has(c.tags, was.name)).map(c => ({ system: c.system, cable: c.id, tags: c.tags.map(n => (LM.tags.key(n) === LM.tags.key(was.name) ? to : n)) }));
        if (list.length) return tagsOutside(list, x => { x.classes.find(k => k.id === id).name = to; });
      }
      return change(x => { const c = x.classes.find(k => k.id === id); if (c) c[what] = to; });
    }
    if (name === 'draft.w' || name === 'draft.h') { S.draft = S.draft || { pts: [] }; S.draft[name.slice(6)] = Math.max(1, +v || 1); return; }
    if (name.startsWith('pos.') && s && s.kind === 'block') {
      const o = S.sc.blocks[s.id];
      if (!o) return;
      const T = o.T.slice(); T[+name.slice(4)] = +v || 0;
      return moveBlock(o, T);
    }
    if (name.startsWith('ch.') && s && s.kind === 'channel') {
      return change(x => {
        const c = x.channels.find(k => k.id === s.id);
        if (!c) return;
        if (name === 'ch.name') c.name = String(v).trim();
        else if (name === 'ch.w') c.w = Math.max(1, +v || 1);
        else if (name === 'ch.h') c.h = Math.max(1, +v || 1);
        else if (name === 'ch.extra') c.extraPerM = Math.max(0, +v || 0);
        else if (name.startsWith('ch.run.')) {
          const i = +name.slice(7), a = c.pts[i], b = c.pts[i + 1], l = dist(a, b), want = Math.max(1, +v || 1);
          if (!l) return;
          const d = mulv(sub(b, a), want / l - 1);
          for (let k = i + 1; k < c.pts.length; k++) c.pts[k] = addv(c.pts[k], d).map(r1);
        }
      });
    }
    if (name.startsWith('cab.end.') && s && s.kind === 'cable') {
      const key = name.slice(8);
      return change(x => { const o = (x.cables[s.id] = x.cables[s.id] || {}); o.endMm = Object.assign({}, o.endMm); if (v === '') delete o.endMm[key]; else o.endMm[key] = Math.max(0, +v || 0); });
    }
  }
  function moveBlock(o, T) { change(x => { const k = x.blocks[o.b.path] || {}; x.blocks[o.b.path] = { at: T.map(r1), rot: k.rot || o.rot || [0, 0, 0] }; }); }
  function turnBlock(o, axis, deg) {
    change(x => { const k = x.blocks[o.b.path] || {}, rot = (k.rot || o.rot || [0, 0, 0]).slice(); rot[axis] = ((rot[axis] + deg) % 360 + 360) % 360; x.blocks[o.b.path] = { at: (k.at || o.T).map(r1), rot }; });
  }

  // ── The stage's host ──
  const pick = id => {
    if (!id) return null;
    if (id.startsWith('b:')) return { kind: 'block', id: id.slice(2) };
    if (id.startsWith('c:')) return { kind: 'channel', id: id.slice(2) };
    return null;
  };
  function stageHost() {
    return {
      selected: () => (S.sel ? (S.sel.kind === 'block' ? 'b:' : S.sel.kind === 'channel' ? 'c:' : 'x:') + S.sel.id : null),
      select: id => {
        // A click on empty space: a cable's line under the pointer picks the cable.
        S.sel = pick(id) || (S.hoverCable ? { kind: 'cable', id: S.hoverCable } : null);
        refresh();
      },
      moved: (id, T) => { const o = S.sc.blocks[id.slice(2)]; if (o) moveBlock(o, T); },
      turned: (id, axis, deg) => { const o = S.sc.blocks[id.slice(2)]; if (o) turnBlock(o, axis, deg); },
      saved: st => { S.ui.cams = S.ui.cams || {}; if (S.cur) S.ui.cams[S.cur] = st; saveUi(); },
      overlay: drawOverlay,
      down: onDown,
      hover: onHover,
      dbl: (v, i) => { if (S.tool === 'channel' && S.draft) { finishDraft(); return true; } if (S.tool === 'select' && S.sel && S.sel.kind === 'channel') return addPointAt(v, i); return false; },
      key: (e, v) => onKey(e, v),
    };
  }
  // Where a click puts a channel point: an existing channel's point within 8 px (a clean join); else exactly on
  // the corner, edge, or face of the model or a block that's highlighted (Chris, 2026-11-15: the point and the
  // rubber band go where the highlight is; it used to stand off by half the section's height); else on the
  // view's plane.
  function pointAt(v, i, h) {
    const f = cur(), k = v.scale;
    for (const c of f.channels) for (const p of c.pts) { const q = v.res.project(p); if (Math.hypot(q[0] / k - i.xy[0], q[1] / k - i.xy[1]) < 8) return { p: p.slice(), join: true }; }
    if (S.draft) for (const p of S.draft.pts) { const q = v.res.project(p); if (Math.hypot(q[0] / k - i.xy[0], q[1] / k - i.xy[1]) < 8) return { p: p.slice(), join: true }; }
    const ft = S.st.featureAt(v, i.xy, (oi, o) => o.id === 'ref' || o.id.startsWith('b:'));
    if (ft && (ft.type === 'point' || ft.on)) {
      const base = ft.type === 'point' ? ft.p : ft.on, n = ft.n ? norm(ft.n) : null;
      return { p: base.slice(), n, ft };
    }
    const prev = S.draft && S.draft.pts.length ? S.draft.pts[S.draft.pts.length - 1] : null;
    const p = v.flat ? i.plane(prev ? prev[v.flat.fixed] : (v.flat.fixed === 2 ? h / 2 : 0)) : i.plane(prev ? prev[2] : h / 2);
    return p ? { p } : null;
  }
  function onDown(v, i, e) {
    const f = cur();
    if (S.tool === 'channel') {
      const d = S.draft = S.draft || { pts: [] }, h = d.h || CH.h, at = pointAt(v, i, h);
      if (!at) return { up() {} };
      const p = at.p.map(r1);
      if (!d.pts.length || dist(p, d.pts[d.pts.length - 1]) > 0.5) d.pts.push(p);
      if (d.pts.length === 1) d.up = at.n || [0, 0, 1];
      refresh();
      return { up() {} };
    }
    if (S.tool === 'calibrate') {
      const p = i.hit && i.hit.id === 'ref' ? i.world : (v.flat ? i.plane(0) : i.plane(0));
      if (!p) return { up() {} };
      S.cal = (S.cal || []).concat([p]);
      if (S.cal.length === 2) {
        const was = dist(S.cal[0], S.cal[1]), mm = was && +prompt(`These points are ${r1(was)} mm apart as drawn. How far apart are they really, in mm?`, String(r1(was)));
        S.cal = null; S.tool = 'select';
        if (mm > 0 && was > 0) { const k = mm / was; change(x => { x.reference = Object.assign({}, x.reference, { scale: r1((x.reference.scale || 1) * k * 1e4) / 1e4, calibrated: true }); }); S.fitNext = true; return { up() {} }; }
      }
      refresh();
      return { up() {} };
    }
    if (S.tool === 'snap') {
      if (!S.sel || S.sel.kind !== 'block') return null;
      const me = 'b:' + S.sel.id, ft = S.st.featureAt(v, i.xy, (oi, o) => (S.snap ? o.id !== me && (o.id === 'ref' || o.id.startsWith('b:')) : o.id === me));
      if (!ft || ft.type === 'surface') return { up() {} };
      if (!S.snap) { S.snap = ft; refresh(); return { up() {} }; }
      const o = S.sc.blocks[S.sel.id], mv = M3().alignMove(S.snap, ft);
      S.snap = null; S.tool = 'select';
      moveBlock(o, o.T.map((x, k) => x + mv[k]));
      A.toast('Snapped to the ' + ft.label.toLowerCase());
      return { up() {} };
    }
    // Select: a selected channel's points drag.
    if (S.sel && S.sel.kind === 'channel') {
      const c = f.channels.find(x => x.id === S.sel.id), k = v.scale;
      const pi = c ? c.pts.findIndex(p => { const q = v.res.project(p); return Math.hypot(q[0] / k - i.xy[0], q[1] / k - i.xy[1]) < 8; }) : -1;
      if (pi >= 0) {
        const p0 = c.pts[pi].slice();
        let live = null;
        return {
          move: (j) => { const p = v.flat ? j.plane(p0[v.flat.fixed]) : j.plane(p0[2]); if (p) { live = p.map(r1); c.pts[pi] = live; S.st.setObjs(scene().objs); S.st.later(); } },
          up: () => { c.pts[pi] = p0; if (live) change(x => { x.channels.find(y => y.id === c.id).pts[pi] = live; }); },
        };
      }
    }
    return null;
  }
  function addPointAt(v, i) {
    const f = cur(), c = f.channels.find(x => x.id === S.sel.id), k = v.scale;
    if (!c) return false;
    let best = -1, bd = 8, bp = null;
    for (let j = 0; j + 1 < c.pts.length; j++) {
      const a = v.res.project(c.pts[j]), b = v.res.project(c.pts[j + 1]), r = LM.fbroute.onSeg([i.xy[0] * k, i.xy[1] * k, 0], [a[0], a[1], 0], [b[0], b[1], 0]);
      if (r.d / k < bd) { bd = r.d / k; best = j; bp = c.pts[j].map((x, n) => x + (c.pts[j + 1][n] - x) * r.t); }
    }
    if (best < 0) return false;
    change(x => { x.channels.find(y => y.id === c.id).pts.splice(best + 1, 0, bp.map(r1)); });
    return true;
  }
  function finishDraft() {
    const d = S.draft;
    S.draft = null;
    if (!d || d.pts.length < 2) { refresh(); return; }
    const pts = d.pts.filter((p, i, a) => !i || dist(p, a[i - 1]) > 0.5);
    if (pts.length < 2) { refresh(); return; }
    const id = change(x => { const c = { id: U.uid('c'), name: 'Channel ' + (x.channels.length + 1), pts, up: d.up || [0, 0, 1], w: d.w || CH.w, h: d.h || CH.h, classes: x.classes.length ? [x.classes[0].id] : [], exclusive: false, extraPerM: 0 }; x.channels.push(c); return c.id; });
    S.tool = 'select'; S.sel = { kind: 'channel', id };
    refresh();
  }
  function onHover(v, i) {
    S.hover = { v: v.key, xy: i.xy };
    if (S.tool === 'channel') { const at = pointAt(v, i, (S.draft || {}).h || CH.h) || {}; S.hoverPt = at.p || null; S.hoverFt = at.ft && at.ft.type !== 'plane' ? at.ft : null; S.hoverJoin = !!at.join; }
    else if (S.tool === 'snap' && S.sel && S.sel.kind === 'block') { const me = 'b:' + S.sel.id; S.hoverFt = S.st.featureAt(v, i.xy, (oi, o) => (S.snap ? o.id !== me && (o.id === 'ref' || o.id.startsWith('b:')) : o.id === me)); S.hoverFt && (S.hoverFt.view = v.key); }
    else {
      // A cable's line under the pointer, for a click to pick it.
      S.hoverCable = null;
      const k = v.scale;
      let bd = 6;
      (S.lines || []).forEach(L => { if (L.view !== v.key) return; for (let j = 0; j + 1 < L.pts.length; j++) { const r = LM.fbroute.onSeg([i.xy[0] * k, i.xy[1] * k, 0], [L.pts[j][0], L.pts[j][1], 0], [L.pts[j + 1][0], L.pts[j + 1][1], 0]); if (r.d / k < bd) { bd = r.d / k; S.hoverCable = L.id; } } });
      v.cv.style.cursor = S.hoverCable ? 'pointer' : '';
    }
    S.st.overlays();
  }
  // Cables (straight until routed, the route once routed; dashed when not routed or stale), the channel being
  // drawn, the selected channel's points, and the snap or hover feature.
  function drawOverlay(v, g, k) {
    const f = cur(), sc = S.sc;
    if (!f || !sc) return;
    S.lines = (S.lines || []).filter(L => L.view !== v.key);
    const P = p => v.res.project(p);
    cableInputs(sc, f).forEach(x => {
      if (x.input.ends.length < 2) return;
      const r = routeOf(f, x), sel = S.sel && S.sel.kind === 'cable' && S.sel.id === x.c.path, hov = S.hoverCable === x.c.path;
      const legs = r && !r.stale && r.ok ? r.legs.map(l => l.pts) : x.input.ends.slice(1).map(e => [x.input.ends[0].p, e.p]);
      const dashed = !r || r.stale || !r.ok;
      g.save();
      g.lineJoin = 'round'; g.lineCap = 'round';
      const col = x.c.color || (r && !r.ok ? '#7d8590' : '#00a3b4');
      if (sc.fm && !sc.fm.cable(x.c)) g.globalAlpha = 0.15;
      legs.forEach(pts => {
        const q = pts.map(P);
        S.lines.push({ view: v.key, id: x.c.path, pts: q });
        if (sel || hov) { g.strokeStyle = 'rgba(0, 163, 180, 0.35)'; g.lineWidth = 9 * k; g.setLineDash([]); g.beginPath(); q.forEach((p, j) => (j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); }
        g.strokeStyle = col; g.lineWidth = (sel ? 3.2 : 2) * k; g.setLineDash(dashed ? [7 * k, 5 * k] : []);
        g.beginPath(); q.forEach((p, j) => (j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
      });
      g.setLineDash([]); g.fillStyle = col;
      x.input.ends.forEach(e => { const q = P(e.p); g.beginPath(); g.arc(q[0], q[1], 3.2 * k, 0, 7); g.fill(); });
      if (r && !r.ok && !r.stale) { const q = P(x.input.ends[0].p); g.font = `${11 * k}px system-ui, sans-serif`; g.fillStyle = '#5b636e'; g.fillText('Not routed', q[0] + 6 * k, q[1] - 6 * k); }
      g.restore();
    });
    // A dashed ring around each block the filter lights, on its outline as seen from this view.
    if (sc.fm) sc.objs.forEach(o => {
      if (!o.lit || !o.mesh) return;
      const bx = M3().placedBox(o), pts = [];
      [0, 1].forEach(i => [0, 1].forEach(j => [0, 1].forEach(l => pts.push(P([i ? bx.hi[0] : bx.lo[0], j ? bx.hi[1] : bx.lo[1], l ? bx.hi[2] : bx.lo[2]])))));
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), pad = 6 * k;
      const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad, w = Math.max(...xs) - x0 + pad, h = Math.max(...ys) - y0 + pad;
      g.save(); g.strokeStyle = '#00a3b4'; g.lineWidth = 2.5 * k; g.setLineDash([8 * k, 5 * k]);
      g.beginPath(); if (g.roundRect) g.roundRect(x0, y0, w, h, 8 * k); else g.rect(x0, y0, w, h); g.stroke(); g.restore();
    });
    // The channel being drawn, with a rubber band to the pointer.
    if (S.tool === 'channel' && S.draft && S.draft.pts.length) {
      const q = S.draft.pts.map(P), hp = S.hoverPt && S.hover && S.hover.v === v.key ? P(S.hoverPt) : null;
      g.save(); g.strokeStyle = '#d4a514'; g.lineWidth = 3 * k; g.beginPath(); q.forEach((p, j) => (j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
      if (hp) { g.setLineDash([5 * k, 4 * k]); g.beginPath(); g.moveTo(q[q.length - 1][0], q[q.length - 1][1]); g.lineTo(hp[0], hp[1]); g.stroke(); }
      g.setLineDash([]); g.fillStyle = '#d4a514'; q.forEach(p => { g.beginPath(); g.arc(p[0], p[1], 4 * k, 0, 7); g.fill(); });
      g.restore();
    } else if (S.tool === 'channel' && S.hoverPt && S.hover && S.hover.v === v.key) {
      const q = P(S.hoverPt); g.save(); g.fillStyle = '#d4a514'; g.beginPath(); g.arc(q[0], q[1], 4 * k, 0, 7); g.fill(); g.restore();
    }
    // Each channel's name, classes, and Exclusive at its middle (Chris is colorblind: never hue alone).
    g.save(); g.font = `600 ${10.5 * k}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    f.channels.forEach(c => {
      if (!c.pts || c.pts.length < 2) return;
      const runs = []; let tot = 0;
      for (let j = 0; j + 1 < c.pts.length; j++) { const l = dist(c.pts[j], c.pts[j + 1]); runs.push(l); tot += l; }
      let half = tot / 2, j = 0;
      while (j < runs.length - 1 && half > runs[j]) { half -= runs[j]; j++; }
      const t = runs[j] ? half / runs[j] : 0, mid = c.pts[j].map((x0, n) => x0 + (c.pts[j + 1][n] - x0) * t), q = P(mid);
      const cls = (c.classes || []).map(id => (f.classes.find(y => y.id === id) || {}).name).filter(Boolean).join(', ');
      const text = (c.name || 'Channel') + (cls ? ' · ' + cls : '') + (c.exclusive ? ' · exclusive' : '');
      const w = g.measureText(text).width + 10 * k;
      g.fillStyle = 'rgba(20, 22, 26, 0.72)'; g.fillRect(q[0] - w / 2, q[1] - 8 * k, w, 16 * k);
      g.fillStyle = '#fff'; g.fillText(text, q[0], q[1]);
    });
    g.restore();
    if (S.sel && S.sel.kind === 'channel') {
      const c = f.channels.find(x => x.id === S.sel.id);
      if (c) { g.save(); g.fillStyle = '#fff'; g.strokeStyle = '#00a3b4'; g.lineWidth = 2 * k; c.pts.forEach(p => { const q = P(p); g.beginPath(); g.arc(q[0], q[1], 5 * k, 0, 7); g.fill(); g.stroke(); }); g.restore(); }
    }
    // Drawing a channel: the corner or edge a click would snap to, and its name by the pointer.
    if (S.tool === 'channel' && S.hover && S.hover.v === v.key && S.hoverPt && (S.hoverFt || S.hoverJoin)) {
      if (S.hoverFt) S.st.drawFeature(v, g, S.hoverFt);
      const q = P(S.hoverPt), t = S.hoverJoin ? 'Join channel' : S.hoverFt.label;
      g.save(); g.font = `600 ${10.5 * k}px system-ui, sans-serif`; const w = g.measureText(t).width + 10 * k;
      g.fillStyle = 'rgba(20, 22, 26, 0.72)'; g.fillRect(q[0] + 8 * k, q[1] + 8 * k, w, 16 * k);
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(t, q[0] + 13 * k, q[1] + 16 * k); g.restore();
    }
    if (S.tool === 'snap') { if (S.snap) S.st.drawFeature(v, g, S.snap, '#e07800'); if (S.hoverFt) S.st.drawFeature(v, g, S.hoverFt); }
    if (S.tool === 'calibrate' && S.cal) S.cal.forEach(p => { const q = P(p); g.save(); g.strokeStyle = '#e07800'; g.lineWidth = 2 * k; g.beginPath(); g.arc(q[0], q[1], 6 * k, 0, 7); g.stroke(); g.restore(); });
  }
  function onKey(e) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (typing) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return true; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return true; }
    if (e.key === 'Escape') { if (S.draft || S.snap || S.cal || S.tool !== 'select') { S.draft = null; S.snap = null; S.cal = null; S.tool = 'select'; } else S.sel = null; refresh(); return true; }
    if (e.key === 'Enter' && S.tool === 'channel') { finishDraft(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel && S.sel.kind === 'channel') { act('ch-del'); return true; }
    if (!mod && e.key.toLowerCase() === 'f') { if (S.st) { S.st.fit(); S.st.draw(true); } return true; }
    return false;
  }

  // ── Demo (?demo): a made-up bracket for the thermostat (BRACKET), two classes, and two channels on its base ──
  function demo(systemId) {
    const f = blank(systemId, 'Bracket'), z = BRACKET.t;
    f.classes = [{ id: 'kcls1', name: 'Low voltage', color: '#2f6fd1' }, { id: 'kcls2', name: '24 VAC', color: '#d4a514' }];
    f.channels = [
      { id: 'cdemo1', name: 'Base channel', pts: [[30, 45, z + 8], [250, 45, z + 8]], up: [0, 0, 1], w: 25, h: 16, classes: ['kcls1'], exclusive: false, extraPerM: 0 },
      { id: 'cdemo2', name: '24 VAC raceway', pts: [[265, 45, z + 8], [265, 175, z + 8]], up: [0, 0, 1], w: 25, h: 16, classes: ['kcls2'], exclusive: true, extraPerM: 0 },
    ];
    f.reference = { kind: 'builtin', shape: 'bracket', name: 'Bracket (made up), 300 × 200 × 150 mm' };
    // The thermostat's boards on the base, the wall wiring's device beside the 24 VAC raceway.
    const fl = LM.system.flatten(systemId);
    let x = 40;
    (fl ? fl.blocks : []).forEach(b => {
      const t = THICK[b.kind] || 10, w = b.w, h = b.h;
      if (b.kind === 'device') { f.blocks[b.path] = { at: [285, 150, z + t / 2], rot: [0, 0, 0] }; return; }
      f.blocks[b.path] = { at: [x + w / 2, 125, z + t / 2], rot: [0, 0, 0] };
      x += w + 20;
    });
    // The wall wiring is tagged 24 VAC in the demo system, so it may use the raceway (exclusive) as well as the
    // base channel.
    f.demo = true; f.demoV = DEMO_V;
    return f;
  }
  const DEMO_V = 4;   // bump to rebuild the demo formboard in browsers that have an older one
  function ensureDemo(systemId) {
    if (!DEMO) return;
    live().filter(f => f.demo && f.demoV !== DEMO_V).forEach(f => { delete S.store[f.id]; if (S.cur === f.id) S.cur = null; });
    if (forSystem(systemId).length) return;
    const f = demo(systemId);
    S.store[f.id] = f;
    persist();
  }

  function init(hooks) { A = hooks; load(); }
  // After a sync (app.js): the documents GitHub's merge left, as plain objects, made whole again.
  function synced() {
    Object.keys(S.store).forEach(id => normalize(S.store[id]));
    if (S.cur && (!S.store[S.cur] || S.store[S.cur].deleted)) { S.cur = null; S.sel = null; }
    S.past = S.past.filter(x => S.store[x.id]); S.future = S.future.filter(x => S.store[x.id]);
    persist();
  }
  LM.formboard = {
    init, render, leave, flush, undo, redo, onKey, ensureDemo, readDxf, forSystem, synced, refBytes, store: () => S.store, persist,
    canUndo: () => S.past.length > 0, canRedo: () => S.future.length > 0,
    busy: () => !!(S.st && S.st.busy()) || !!S.draft || !!S.busy,
    current: cur, state: () => S, routeAll, applyLengths, scene: () => S.sc, select: x => { S.sel = x; refresh(); },
  };
})(window.LM = window.LM || {});
