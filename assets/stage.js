// The 3D stage: one view, or Four views (Top, 3D, Front, Right, third angle), each flat view with its own
// camera, Link views to share one. Built for Formboard (docs/formboard.md) from Signoff PL's Exploded
// (signoff_pl/assets/app.js, 2026-11-14), over PL's renderer (vendor/model3d.js), and driven by a host, so
// PL can move onto it later. Nothing here knows about Loom's documents.
//
//   const st = LM.stage.create(host); st.mount(el); st.setObjs(objs); st.fit(); st.draw(true)
//
// objs: [{ id, mesh, R, pivot, T, tex, tint, hidden, ghost }]. The host:
//   selected() → id                  select(id | null)                 moved(id, T) (a drag let go)
//   turned(id, axis, deg)            overlay(view, g, k)               hint(text)
//   down(view, info, e) → { move(info, e), up(info, e) } | { tap() } | null: claims a press before the stage's own
//   (a tap claim lets the press turn or pan the view, and calls tap() only on a release without moving)
//   hover(view, info)                key(e, view) → true when handled  saved(state) (cameras, Four views)
// A view: { key: '3d' | 'top' | 'front' | 'right', flat, res, scale, cv, over }. info: { xy (CSS px), hit
// ({ obj, tri, depth, id } | null), world (the point under the pointer: on what's hit, else on the view's
// plane), plane(v) (the point on the plane where the view's fixed axis is v), view }.
(function (LM) {
  'use strict';
  const M3 = () => window.Signoff && window.Signoff.model3d;
  const DEG = Math.PI / 180;
  const FLAT = {
    top: { key: 'top', label: 'Top', axes: 'X Y', az: 0, el: 90 * DEG, h: 0, v: 1, fixed: 2 },
    front: { key: 'front', label: 'Front', axes: 'X Z', az: 0, el: 0, h: 0, v: 2, fixed: 1 },
    right: { key: 'right', label: 'Right', axes: 'Y Z', az: -90 * DEG, el: 0, h: 1, v: 2, fixed: 0 },
  };
  // Each flat view seen from its other side (Chris, 2026-11-16: a button in each to flip it): the same axes and
  // fixed axis, the camera turned round.
  const FLIP = {
    top: Object.assign({}, FLAT.top, { label: 'Bottom', el: -90 * DEG, flipped: true }),
    front: Object.assign({}, FLAT.front, { label: 'Back', az: 180 * DEG, flipped: true }),
    right: Object.assign({}, FLAT.right, { label: 'Left', az: 90 * DEG, flipped: true }),
  };
  const ISO = { az: -35 * DEG, el: 30 * DEG };
  const featCache = new WeakMap();
  // A mesh with no CAD faces (an STL: every triangle one face id) would read as one smooth face with no edges or
  // corners to snap to. Read it as facets instead, so neighbors meeting under 30° join and sharper creases are edges.
  const featsOf = mesh => {
    let f = featCache.get(mesh);
    if (!f) {
      const nt = mesh.idx.length / 3, fid = mesh.fid;
      let one = nt > 1;
      if (one && fid) for (let t = 1; t < nt; t++) if (fid[t] !== fid[0]) { one = false; break; }
      if (one) { const id = new Uint32Array(nt); for (let t = 0; t < nt; t++) id[t] = t; f = M3().features(Object.assign({}, mesh, { fid: id })); }
      else f = M3().features(mesh);
      featCache.set(mesh, f);
    }
    return f;
  };
  const vtx = (m, i) => [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
  function segDist(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1], l = vx * vx + vy * vy, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l)) : 0;
    return { d: Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t), t };
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function create(host) {
    const st = { objs: [], cam: null, flatCams: null, quad: false, link: true, flip: {}, el: null, views: [], drag: null, raf: 0, idle: 0 };
    const flatOf = key => (FLAT[key] ? (st.flip[key] ? FLIP : FLAT)[key] : null);

    function mount(el) {
      st.el = el;
      const pane = key => {
        const f = flatOf(key), other = (st.flip[key] ? FLAT : FLIP)[key];
        return `<div class="fb-pane"><canvas class="fb-cv" data-view="${key}" tabindex="0" aria-label="${f.label} view: drag a block to move it in ${f.axes}, drag empty space to pan, scroll to zoom"></canvas><canvas class="fb-over" aria-hidden="true"></canvas><div class="fb-tag">${f.label} <span>${f.axes}</span><button type="button" class="fb-flip" data-flip="${key}" title="Look from the other side: ${other.label}" aria-label="Look from the other side: ${other.label}">⇄ ${other.label}</button></div></div>`;
      };
      const main = `<div class="fb-pane fb-pane-3d"><canvas class="fb-cv" data-view="3d" tabindex="0" aria-label="3D view: drag to turn, Shift- or right-drag to pan, scroll to zoom, click a block to select it"></canvas><canvas class="fb-over" aria-hidden="true"></canvas>${st.quad ? '<div class="fb-tag">3D</div>' : ''}</div>`;
      el.innerHTML = `<div class="fb-stage${st.quad ? ' fb-quad' : ''}">${st.quad ? pane('top') + main + pane('front') + pane('right') : main}<div class="fb-hint glass" hidden></div></div>`;
      st.views = Array.from(el.querySelectorAll('canvas.fb-cv')).map(cv => {
        const key = cv.dataset.view;
        return { key, flat: flatOf(key), cv, over: cv.parentNode.querySelector('.fb-over'), res: null, scale: 1 };
      });
      el.querySelectorAll('.fb-flip').forEach(b => b.addEventListener('click', () => flip(b.dataset.flip)));
      st.views.forEach(bind);
      if (window.ResizeObserver) {
        if (st.ro) st.ro.disconnect();
        st.ro = new ResizeObserver(() => later());
        st.ro.observe(el);
      }
    }
    function setQuad(on) { st.quad = !!on; if (st.el) mount(st.el); save(); draw(true); }
    // Turns a flat view round to its other side (Top and Bottom, Front and Back, Right and Left), keeping its camera.
    function flip(key) { if (!FLAT[key]) return; st.flip[key] = !st.flip[key]; if (st.el) mount(st.el); save(); draw(true); }
    function hint(text) { const h = st.el && st.el.querySelector('.fb-hint'); if (h) { h.textContent = text || ''; h.hidden = !text; } if (host.hint) host.hint(text); }

    // ── Cameras ──
    function bounds() {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      st.objs.forEach(o => {
        if (o.hidden) return;
        const b = M3().placedBox(o);
        for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.lo[i]); hi[i] = Math.max(hi[i], b.hi[i]); }
      });
      if (!isFinite(lo[0])) return { lo: [-100, -100, -10], hi: [100, 100, 10], c: [0, 0, 0] };
      return { lo, hi, c: [0, 1, 2].map(i => (lo[i] + hi[i]) / 2) };
    }
    function fit(keepAngle) {
      const b = bounds(), d = Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]);
      const old = keepAngle && st.cam;
      st.cam = { az: old ? old.az : ISO.az, el: old ? old.el : ISO.el, zoom: 1, c: b.c, fit: Math.max(20, d * 1.1) };
      fitFlats(b);
      save();
    }
    function fitFlats(b) {
      b = b || bounds();
      st.flatCams = {};
      const all = Math.max(20, Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]) * 1.12);
      Object.keys(FLAT).forEach(k => {
        const f = FLAT[k];
        st.flatCams[k] = { c: b.c.slice(), zoom: 1, fit: st.link ? all : Math.max(20, Math.max(b.hi[f.h] - b.lo[f.h], b.hi[f.v] - b.lo[f.v]) * 1.12) };
      });
    }
    function fitView(v) { if (v.flat) { const b = bounds(), f = v.flat; st.flatCams[v.key] = { c: b.c.slice(), zoom: 1, fit: Math.max(20, Math.max(b.hi[f.h] - b.lo[f.h], b.hi[f.v] - b.lo[f.v]) * 1.12) }; if (st.link) fitFlats(b); } else fit(true); draw(true); save(); }
    const camOf = v => (v.flat ? Object.assign({ az: v.flat.az, el: v.flat.el }, st.flatCams[v.key]) : st.cam);
    const linked = key => (st.link ? Object.keys(FLAT).map(k => st.flatCams[k]) : [st.flatCams[key]]);
    function save() { if (host.saved) host.saved({ cam: st.cam, flatCams: st.flatCams, quad: st.quad, link: st.link, flip: st.flip }); }
    function load(s) {
      if (!s) return;
      if (s.cam && isFinite(s.cam.fit)) st.cam = s.cam;
      if (s.flatCams && s.flatCams.top) st.flatCams = s.flatCams;
      st.quad = !!s.quad; st.link = s.link !== false; st.flip = s.flip && typeof s.flip === 'object' ? Object.assign({}, s.flip) : {};
    }

    // ── Drawing ──
    function draw(fine) {
      if (!st.el || !M3() || !st.cam) return;
      const sel = host.selected ? host.selected() : null, si = st.objs.findIndex(o => o.id === sel);
      st.views.forEach(v => {
        if (!v.cv.isConnected) return;
        const w = v.cv.clientWidth, h = v.cv.clientHeight, dpr = fine ? Math.min(2, window.devicePixelRatio || 1) : 1;
        if (!w || !h) return;
        const W = Math.round(w * dpr), H = Math.round(h * dpr), cam = camOf(v);
        if (!cam) return;
        v.res = M3().renderScene(st.objs, cam, W, H, { ss: fine && dpr < 2 && W * H < 1600000 ? 2 : 1, sel: si });
        v.scale = W / w;
        v.cv.width = W; v.cv.height = H;
        const g = v.cv.getContext('2d');
        g.putImageData(v.res.image, 0, 0);
        if (v.flat) {
          const o = v.res.project([0, 0, 0]);
          g.save(); g.globalAlpha = 0.3; g.strokeStyle = getComputedStyle(v.cv).color || '#888'; g.lineWidth = dpr; g.setLineDash([6 * dpr, 5 * dpr]);
          g.beginPath(); g.moveTo(0, o[1]); g.lineTo(W, o[1]); g.moveTo(o[0], 0); g.lineTo(o[0], H); g.stroke(); g.restore();
        }
        overlay(v);
      });
    }
    function overlay(v) {
      if (!v.over || !v.res) return;
      v.over.width = v.cv.width; v.over.height = v.cv.height;
      const g = v.over.getContext('2d');
      g.clearRect(0, 0, v.over.width, v.over.height);
      if (host.overlay) host.overlay(v, g, v.scale);
      drawRing(v, g);
    }
    // ── The turn ring (Chris, 2026-11-16: as Signoff PL's Exploded) ──
    // In each flat view, a very light circle round the selected block with a dot to drag: it turns the block about
    // the axis toward the eye (Top about Z, Front about Y, Right about X), 15° steps, Alt for any angle. Its size
    // comes from the block's own extent, so it holds still while it turns. v.ring is kept in CSS px for the pointer.
    const RING_DOT = 6;
    const dark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); };
    function ringObj() {
      if (host.noRing && host.noRing()) return null;
      const id = host.selected ? host.selected() : null, o = id && st.objs.find(x => x.id === id);
      return o && !o.fixed && !o.hidden && o.mesh && o.mesh.idx.length ? o : null;
    }
    function drawRing(v, g) {
      v.ring = null;
      const o = ringObj();
      if (!v.flat || !o || !v.res) return;
      if (!o.rad) { const bb = M3().bbox(o.mesh.pos); o.rad = Math.hypot(bb.hi[0] - bb.lo[0], bb.hi[1] - bb.lo[1], bb.hi[2] - bb.lo[2]) / 2; }
      const pc = M3().place(o, o.pivot || [0, 0, 0]), c = v.res.project(pc), e = v.res.project(pc.map((x, i) => x + (i === v.flat.h ? 1 : 0)));
      const k = v.scale, r = Math.max(18 * k, Math.abs(e[0] - c[0]) * o.rad + 10 * k);
      const spin = st.drag && st.drag.kind === 'spin' && st.drag.v === v ? st.drag : null;
      // The dot rests at 12 o'clock, else the first of 3, 6, and 9 inside the view.
      const W = v.over.width, H = v.over.height, m = (RING_DOT + 2) * k;
      let a = spin ? spin.a : [-90, 0, 90, 180].map(d => d * DEG).find(t => { const x = c[0] + r * Math.cos(t), y = c[1] + r * Math.sin(t); return x >= m && y >= m && x <= W - m && y <= H - m; });
      if (a == null) a = -Math.PI / 2;
      const dot = [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], dk = dark();
      g.save();
      g.lineWidth = 1.5 * k; g.strokeStyle = dk ? 'rgba(225, 228, 232, 0.55)' : 'rgba(150, 155, 160, 0.55)';
      g.beginPath(); g.arc(c[0], c[1], r, 0, Math.PI * 2); g.stroke();
      if (spin) { g.setLineDash([4 * k, 4 * k]); g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(dot[0], dot[1]); g.stroke(); g.setLineDash([]); }
      g.fillStyle = dk ? '#e6e8eb' : '#f4f5f6'; g.strokeStyle = dk ? 'rgba(0, 0, 0, 0.55)' : 'rgba(90, 95, 100, 0.8)'; g.lineWidth = 1.2 * k;
      g.beginPath(); g.arc(dot[0], dot[1], RING_DOT * k, 0, Math.PI * 2); g.fill(); g.stroke();
      g.restore();
      v.ring = { id: o.id, c: [c[0] / k, c[1] / k], r: r / k, dot: [dot[0] / k, dot[1] / k] };
    }
    const onDot = (v, xy) => !!v.ring && Math.hypot(xy[0] - v.ring.dot[0], xy[1] - v.ring.dot[1]) <= RING_DOT + 5;
    // θ (radians, counterclockwise as seen) about the axis n, as a matrix; then the product, and back to degrees
    // about X, then Y, then Z (model3d.rotation).
    function axisTurn(n, t) {
      const c = Math.cos(t), s2 = Math.sin(t), C = 1 - c, x = n[0], y = n[1], z = n[2];
      return [c + x * x * C, x * y * C - z * s2, x * z * C + y * s2, y * x * C + z * s2, c + y * y * C, y * z * C - x * s2, z * x * C - y * s2, z * y * C + x * s2, c + z * z * C];
    }
    function mul3(A, B) { const out = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return out; }
    function eulerOf(R) {
      const clean = r => { let d = r / DEG; d = Math.round(d * 100) / 100; return Math.abs(d - Math.round(d)) < 0.02 ? Math.round(d) : d; };
      if (Math.abs(R[6]) > 0.99999) { const b = R[6] < 0 ? Math.PI / 2 : -Math.PI / 2; return [0, clean(b), clean(Math.atan2(-R[1], R[4]))]; }
      return [clean(Math.atan2(R[7], R[8])), clean(Math.asin(-R[6])), clean(Math.atan2(R[3], R[0]))];
    }
    function overlays() { st.views.forEach(overlay); }
    function later() {
      cancelAnimationFrame(st.raf); clearTimeout(st.idle);
      st.raf = requestAnimationFrame(() => draw(false));
      st.idle = setTimeout(() => draw(true), 240);
    }

    // ── Where the pointer is ──
    function info(v, e) {
      const r = v.cv.getBoundingClientRect(), xy = [e.clientX - r.left, e.clientY - r.top];
      const h = v.res ? v.res.pick(xy[0] * v.scale, xy[1] * v.scale) : null;
      let hit = h ? Object.assign({ id: st.objs[h.obj] && st.objs[h.obj].id }, h) : null;
      // Objects the host draws itself (hidden from the rasterizer, such as Formboard's glass channels) it picks too.
      const over = host.overHit && v.res ? host.overHit(v, xy, hit) : null;
      if (over) hit = over;
      const plane = val => {
        if (!v.res) return null;
        const f = v.res.cam.f, x = xy[0] * v.scale, y = xy[1] * v.scale;
        if (v.flat) { const k = v.flat.fixed, s = f[k] || 1; return v.res.point(x, y, val * s).map((c, i) => (i === k ? val : c)); }
        // 3D: where the ray under the pointer meets the floor z = val.
        const p0 = v.res.point(x, y, 0);
        if (Math.abs(f[2]) < 1e-6) return null;
        const t = (val - p0[2]) / f[2];
        return [p0[0] + f[0] * t, p0[1] + f[1] * t, val];
      };
      const world = hit ? v.res.point(xy[0] * v.scale, xy[1] * v.scale, hit.depth) : plane(v.flat ? (camOf(v).c[v.flat.fixed] || 0) : 0);
      return { xy, hit, world, plane, view: v };
    }

    // ── Pointer ──
    function bind(v) {
      const cv = v.cv;
      cv.addEventListener('contextmenu', e => e.preventDefault());
      cv.addEventListener('pointerdown', e => {
        if (!v.res) return;
        cv.focus({ preventScroll: true });
        const i = info(v, e);
        if (e.button === 0 && v.flat && onDot(v, i.xy)) {
          const o = st.objs.find(x => x.id === v.ring.id), a0 = Math.atan2(i.xy[1] - v.ring.c[1], i.xy[0] - v.ring.c[0]);
          if (o) { st.drag = { kind: 'spin', v, o, a0, a: a0, R0: (o.R || [1, 0, 0, 0, 1, 0, 0, 0, 1]).slice(), moved: false }; cv.setPointerCapture(e.pointerId); return; }
        }
        const claim = host.down && e.button === 0 && host.down(v, i, e);
        // A tap claim (a tool's click: a channel point, a snap pick): the press still turns or pans the view as
        // usual, and only a release without moving is the tool's click (Chris, 2026-11-16: no turning while snapping).
        if (claim && claim.tap) {
          st.drag = v.flat ? { kind: 'pan', v, x0: i.xy[0], y0: i.xy[1], cs: linked(v.key).map(c => c.c.slice()), hit: null, moved: false, tap: claim.tap }
            : { kind: 'orbit', v, x0: i.xy[0], y0: i.xy[1], az: st.cam.az, el: st.cam.el, hit: null, moved: false, tap: claim.tap };
          cv.setPointerCapture(e.pointerId);
          return;
        }
        if (claim) { st.drag = { kind: 'host', v, h: claim, moved: false, x0: i.xy[0], y0: i.xy[1] }; cv.setPointerCapture(e.pointerId); return; }
        const o = i.hit && st.objs[i.hit.obj], sel = host.selected ? host.selected() : null;
        const grab = e.button === 0 && !e.shiftKey && o && !o.fixed && (v.flat || o.id === sel);
        if (grab) st.drag = { kind: 'move', v, o, x0: i.xy[0], y0: i.xy[1], T0: o.T.slice(), picked: o.id !== sel, moved: false };
        else if (!v.flat && e.button === 0 && !e.shiftKey) st.drag = { kind: 'orbit', v, x0: i.xy[0], y0: i.xy[1], az: st.cam.az, el: st.cam.el, hit: o ? o.id : null, moved: false };
        else st.drag = { kind: 'pan', v, x0: i.xy[0], y0: i.xy[1], cs: v.flat ? linked(v.key).map(c => c.c.slice()) : [st.cam.c.slice()], hit: o ? o.id : null, moved: false };
        if (st.drag.kind === 'move' && st.drag.picked) { host.select(o.id); }
        cv.setPointerCapture(e.pointerId);
      });
      cv.addEventListener('pointermove', e => {
        const d = st.drag;
        if (!d) { const i0 = v.res ? info(v, e) : null; if (host.hover && i0) host.hover(v, i0); if (i0 && v.flat && onDot(v, i0.xy)) cv.style.cursor = 'grab'; return; }
        if (d.v !== v) return;
        if (d.kind === 'spin') {
          // On screen y runs down, so the screen angle grows clockwise; counterclockwise as seen is a positive turn
          // about the axis toward the eye. 15° steps; Alt for any angle.
          const p = info(v, e).xy, rg = v.ring || d, step = 15 * DEG;
          let t = -(Math.atan2(p[1] - rg.c[1], p[0] - rg.c[0]) - d.a0);
          t = Math.atan2(Math.sin(t), Math.cos(t));
          if (!e.altKey) t = Math.round(t / step) * step;
          d.a = d.a0 - t; d.moved = d.moved || Math.abs(t) > 1e-9; d.t = t;
          d.o.R = mul3(axisTurn(v.res.cam.f, t), d.R0);
          hint('Turn ' + (Math.round(t * v.res.cam.f[v.flat.fixed] / DEG * 10) / 10).toLocaleString() + '° about ' + 'XYZ'[v.flat.fixed]);
          later();
          return;
        }
        const i = info(v, e), dx = i.xy[0] - d.x0, dy = i.xy[1] - d.y0;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        if (d.kind === 'host') { if (d.h.move) d.h.move(i, e, d); return; }
        if (!d.moved) return;
        if (d.kind === 'orbit') { const t = M3().orbit(d.az, d.el, dx, dy); st.cam.az = t.az; st.cam.el = t.el; later(); return; }
        const mv = v.res.unproject(dx * v.scale, dy * v.scale);
        if (d.kind === 'pan') {
          if (v.flat) linked(v.key).forEach((c, j) => { c.c = [0, 1, 2].map(k => d.cs[j][k] - mv[k]); });
          else st.cam.c = [0, 1, 2].map(k => d.cs[0][k] - mv[k]);
          later(); return;
        }
        // A block moves in the flat view's plane; in 3D, across the floor seen from above, else sideways and
        // up or down. 1 mm steps (0.5 for a fine grid); Alt for any spot.
        // The host may have redrawn (a pick refreshes the page) and handed over new objects: follow it by id.
        const live = st.objs.find(x => x.id === d.o.id);
        if (live && live !== d.o) d.o = live;
        let m = mv;
        if (v.flat) m[v.flat.fixed] = 0;
        else if (Math.abs(st.cam.el) > 45 * DEG) m[2] = 0;
        else { const k = Math.hypot(...v.res.unproject(1, 0)) * v.scale; m = [v.res.cam.r[0] * dx * k, v.res.cam.r[1] * dx * k, -dy * k]; }
        const grid = e.altKey ? 0.01 : 1;
        d.o.T = d.T0.map((x, k) => (m[k] ? Math.round((x + m[k]) / grid) * grid : x));
        hint(d.o.T.map(x => (Math.round(x * 10) / 10).toLocaleString()).join(', ') + ' mm');
        if (host.live) host.live(d.o.id, d.o.T);
        later();
      });
      cv.addEventListener('pointerup', e => {
        const d = st.drag;
        if (!d || d.v !== v) return;
        st.drag = null;
        if (d.kind === 'host') { if (d.h.up) d.h.up(info(v, e), e, d); return; }
        if (d.kind === 'spin') {
          hint('');
          if (d.moved && host.rotated) { const live = st.objs.find(x => x.id === d.o.id) || d.o; host.rotated(live.id, eulerOf(d.o.R)); }
          else { d.o.R = d.R0; draw(true); }
          return;
        }
        if (d.kind === 'move') {
          hint('');
          const live = st.objs.find(x => x.id === d.o.id) || d.o;
          if (d.moved) host.moved(live.id, d.o.T); else if (!d.picked) host.select(live.id);
          return;
        }
        save();
        if (d.tap) { if (!d.moved) d.tap(); else draw(true); return; }
        if (!d.moved) { host.select(d.hit); return; }
        draw(true);
      });
      cv.addEventListener('wheel', e => {
        e.preventDefault();
        const f = Math.exp(-e.deltaY * 0.0015);
        if (v.flat) { const z = Math.max(0.05, Math.min(200, st.flatCams[v.key].zoom * f)); linked(v.key).forEach(c => { c.zoom = z; }); }
        else st.cam.zoom = Math.max(0.05, Math.min(200, st.cam.zoom * f));
        later(); save();
      }, { passive: false });
      // The host first (finishing a channel, adding a point), else a double-click on empty space fits the view.
      cv.addEventListener('dblclick', e => { const i = info(v, e); if (host.dbl && host.dbl(v, i, e)) return; if (!i.hit) fitView(v); });
      cv.addEventListener('keydown', e => {
        if (host.key && host.key(e, v)) { e.stopPropagation(); return; }
        const id = host.selected && host.selected(), o = st.objs.find(x => x.id === id);
        if (!o || o.fixed) return;
        const step = e.shiftKey ? 10 : 1, f = v.flat;
        const mv = f ? { ArrowLeft: [f.h, -step], ArrowRight: [f.h, step], ArrowUp: [f.v, step], ArrowDown: [f.v, -step] }[e.key]
          : { ArrowLeft: [0, -step], ArrowRight: [0, step], ArrowUp: [1, step], ArrowDown: [1, -step], PageUp: [2, step], PageDown: [2, -step] }[e.key];
        if (mv) { e.preventDefault(); e.stopPropagation(); const T = o.T.slice(); T[mv[0]] += mv[1]; host.moved(o.id, T); return; }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); e.stopPropagation(); host.turned(o.id, f ? f.fixed : 2, e.shiftKey ? -90 : 90); }
      });
    }

    // ── Snapping: the feature under the pointer on an object (corners, edges, hole axes, flat faces) ──
    // PL's featureAt, on any view. want(obj index) says which objects count.
    function featureAt(v, xy, want) {
      if (!v.res) return null;
      const s = v.scale, x = xy[0] * s, y = xy[1] * s, h = v.res.pick(x, y);
      const tol = ((camOf(v) || {}).fit || 100) * 0.01;
      // Seen: nothing in front of it, its own object included (a corner behind the part's own wall is hidden).
      const seen = q => { const p = v.res.pick(Math.min(Math.max(q[0], 0), v.cv.width - 1), Math.min(Math.max(q[1], 0), v.cv.height - 1)); return !p || q[2] >= p.depth - tol; };
      let found = null;
      st.objs.forEach((o, oi) => {
        if (o.hidden || !want(oi, o) || !o.mesh.idx.length) return;
        const F = featsOf(o.mesh), P = p => M3().place(o, p), S2 = p => v.res.project(P(p));
        let best = null, bestD = 9 * s, bestZ = -Infinity;
        // Corners one over another on screen (a top view): the nearer one.
        F.corners.forEach(c => { const p = vtx(o.mesh, c), q = S2(p), d = Math.hypot(q[0] - x, q[1] - y); if ((d < bestD - 0.5 * s || (d < bestD + 0.5 * s && q[2] > bestZ)) && d < 9 * s && seen(q, oi)) { bestD = d; bestZ = q[2]; best = { type: 'point', p: P(p), label: 'Corner', obj: oi, rank: 0, dist: d, draw: { dot: p } }; } });
        if (!best) {
          bestD = 7 * s;
          let hs = -1;
          let ez = -Infinity;
          // Edges one over another on screen (seen edge-on): the nearer one.
          F.segs.forEach((e, i) => { const a = S2(vtx(o.mesh, e.a)), b = S2(vtx(o.mesh, e.b)), r = segDist([x, y], a, b), z = a[2] + (b[2] - a[2]) * r.t; if ((r.d < bestD - 0.5 * s || (r.d < bestD + 0.5 * s && z > ez)) && r.d < 7 * s && seen([a[0] + (b[0] - a[0]) * r.t, a[1] + (b[1] - a[1]) * r.t, z], oi)) { bestD = r.d; ez = z; hs = i; } });
          if (hs >= 0) {
            const e = F.segs[hs];
            if (e.circle >= 0) { const c = F.circles[e.circle]; best = { type: 'line', p: P(c.c), d: M3().turn(o, c.n), label: 'Hole axis', obj: oi, rank: 1, dist: bestD, draw: { circle: e.circle, center: c.c } }; }
            else {
              const A = vtx(o.mesh, e.a), B = vtx(o.mesh, e.b), a = S2(A), b = S2(B), r = segDist([x, y], a, b);
              const on = P([A[0] + (B[0] - A[0]) * r.t, A[1] + (B[1] - A[1]) * r.t, A[2] + (B[2] - A[2]) * r.t]);
              best = { type: 'line', p: P(A), on, d: M3().turn(o, [B[0] - A[0], B[1] - A[1], B[2] - A[2]]), label: 'Edge', obj: oi, rank: 1, dist: bestD, draw: { group: e.g } };
            }
          }
        }
        if (!best && h && h.obj === oi && h.tri >= 0) {
          const fi = F.region[h.tri], pl = F.planes[fi];
          best = pl ? { type: 'plane', p: P(pl.p), n: M3().turn(o, pl.n), on: v.res.point(x, y, h.depth), label: 'Flat face', obj: oi, rank: 2, dist: 0, draw: { face: fi } }
            : { type: 'surface', on: v.res.point(x, y, h.depth), label: 'Surface', obj: oi, rank: 3, dist: 0, draw: {} };
        }
        if (best && (!found || best.rank < found.rank || (best.rank === found.rank && best.dist < found.dist))) found = best;
      });
      return found;
    }
    // Draws a feature (accent by default) in a view's overlay.
    function drawFeature(v, g, f, color) {
      if (!f || !v.res) return;
      const o = st.objs[f.obj];
      if (!o) return;
      const k = v.scale, P2 = p => { const q = v.res.project(M3().place(o, p)); return [q[0], q[1]]; };
      g.save(); g.strokeStyle = g.fillStyle = color || '#00a3b4'; g.lineWidth = 3 * k; g.lineCap = 'round';
      const F = featsOf(o.mesh);
      if (f.draw.dot) { const q = P2(f.draw.dot); g.beginPath(); g.arc(q[0], q[1], 5 * k, 0, 7); g.fill(); }
      if (f.draw.group != null || f.draw.circle != null) {
        g.beginPath();
        F.segs.forEach(e => { if (f.draw.group != null ? e.g !== f.draw.group : e.circle !== f.draw.circle) return; const a = P2(vtx(o.mesh, e.a)), b = P2(vtx(o.mesh, e.b)); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); });
        g.stroke();
      }
      if (f.draw.face != null) {
        g.globalAlpha = 0.3; g.beginPath();
        for (let t = 0; t < o.mesh.idx.length / 3; t++) {
          if (F.region[t] !== f.draw.face) continue;
          const a = P2(vtx(o.mesh, o.mesh.idx[t * 3])), b = P2(vtx(o.mesh, o.mesh.idx[t * 3 + 1])), c = P2(vtx(o.mesh, o.mesh.idx[t * 3 + 2]));
          g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath();
        }
        g.fill();
      }
      g.restore();
    }

    Object.assign(st, {
      mount, setQuad, flip, fit, fitView, draw, later, overlays, load, save, hint, featureAt, drawFeature,
      setObjs: objs => { st.objs = objs || []; },
      setLink: on => { st.link = !!on; if (st.link) fitFlats(); save(); draw(true); },
      busy: () => !!st.drag,
      destroy: () => { if (st.ro) st.ro.disconnect(); st.el = null; st.views = []; },
    });
    return st;
  }
  LM.stage = { create, FLAT, esc };
})(window.LM = window.LM || {});
