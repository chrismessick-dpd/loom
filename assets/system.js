// Loom systems (docs/system.md): a second kind of document that places boards and devices, marks which
// of their connectors are used and for what, and plugs Loom harnesses into them. A cable is one use of
// a harness: each of the harness's ends plugs into one connector on one block, or is not plugged yet.
// Plugging is kept here, on the placed block, never on the EE board or the harness (Chris, 2026-11-07:
// copies of one board may use different cables). Systems keep their own store and undo; the app hands
// over #page while one is open (LM.app hooks, `init`).
(function (LM) {
  'use strict';
  const U = LM.util, esc = U.esc, M = LM.model;
  const DEMO = /[?&]demo\b/.test(location.search);
  const NS = DEMO ? 'loom.demo.' : 'loom.v1.';
  const TAB = { w: 7, h: 4.5 };          // a connector tab on a block, mm
  const STUB = 14;                       // an unplugged cable end's stub, mm
  const S = { store: {}, cur: null, sel: null, past: [], future: [], cam: null, boards: null, boardsErr: '', busy: '', adding: null, picking: null };
  let A = null;                          // the app's hooks

  // ── Model ──
  const now = () => Date.now();
  function blank(project) {
    return { schema: 1, kind: 'system', id: U.uid('s'), title: 'New system', project: project || '', rev: 'A', blocks: [], cables: [], updated: now() };
  }
  function normalize(s) {
    if (!s || s.kind !== 'system' || !s.id) throw new Error('not a system');
    s.blocks = Array.isArray(s.blocks) ? s.blocks : [];
    s.cables = Array.isArray(s.cables) ? s.cables : [];
    s.blocks.forEach(b => { b.conns = Array.isArray(b.conns) ? b.conns : []; b.conns.forEach(c => { c.pins = Array.isArray(c.pins) ? c.pins : []; }); });
    s.cables.forEach(c => { c.ends = c.ends && typeof c.ends === 'object' ? c.ends : {}; });
    return s;
  }
  function nextRef(list, prefix) {
    let n = 1;
    const used = new Set(list.map(x => x.ref));
    while (used.has(prefix + n)) n++;
    return prefix + n;
  }
  const block = (s, id) => s.blocks.find(b => b.id === id);
  const conn = (b, id) => b && b.conns.find(c => c.id === id);
  const cable = (s, id) => s.cables.find(c => c.id === id);
  const pinsOf = n => (n.pins || []).map(p => p.pin);
  // Populated: set by hand, else from the package (a connector only the netlist placed isn't fitted in
  // the pick-and-place's build variant). An unpopulated connector is drawn faint, can't be clicked, and
  // can't be used, so alternates in one place don't get in each other's way (Chris, 2026-11-11).
  const fitted = c => (c.fitted != null ? !!c.fitted : c.placed !== 'netlist');
  function mkConn(b, ref, count, at) {
    const c = { id: U.uid('c'), ref: ref || nextRef(b.conns, 'J'), pins: Array.from({ length: count || 4 }, (_, i) => ({ pin: String(i + 1), net: '', label: '' })),
      x: 0, y: 0, side: 'top', used: true, fn: '', placed: 'hand', mpn: '', mfr: '', desc: '' };
    if (at) { c.x = at.x; c.y = at.y; } else {
      // Down the block's right edge, one tab apart.
      const k = b.conns.length;
      c.x = b.w; c.y = Math.min(b.h - TAB.h, 4 + k * (TAB.h + 3));
    }
    b.conns.push(c);
    return c;
  }
  function addDrawn(s, kind, at) {
    const dev = kind === 'device';
    const b = { id: U.uid('b'), ref: nextRef(s.blocks, dev ? 'D' : 'A'), kind: dev ? 'device' : 'board', name: dev ? 'Device' : 'Board', source: null,
      x: at ? at.x : 0, y: at ? at.y : 0, w: dev ? 30 : 80, h: dev ? 20 : 60, conns: [] };
    if (dev) mkConn(b, 'J1', 2, { x: 0, y: b.h / 2 - TAB.h / 2 });
    s.blocks.push(b);
    return b;
  }
  // A Signoff EE board from its stored package (boards.js): the outline is the pick-and-place's extent,
  // each connector sits where the PnP puts it (y up there, down here), and connectors the PnP doesn't
  // list (not fitted in that build variant) wait along the bottom edge, placed by hand.
  function addBoard(s, board, pkg, at) {
    const o = pkg.outline || { x0: 0, y0: 0, x1: 80, y1: 60 };
    const b = { id: U.uid('b'), ref: nextRef(s.blocks, 'A'), kind: 'board', name: board.name,
      source: { tool: 'ee', id: board.id, name: board.name, client: board.client || '', label: pkg.source ? pkg.source.label : '' },
      x: at ? at.x : 0, y: at ? at.y : 0, w: +(o.x1 - o.x0).toFixed(2), h: +(o.y1 - o.y0).toFixed(2), conns: [] };
    let loose = 0;
    pkg.connectors.forEach(pc => {
      const c = mkConn(b, pc.ref, 0, { x: 0, y: 0 });
      c.pins = pc.pins.map(p => ({ pin: p.pin, net: p.net || '', label: p.label || '' }));
      c.mpn = pc.mpn || ''; c.mfr = pc.mfr || ''; c.desc = pc.desc || ''; c.used = false;
      if (pc.at) { c.x = +(pc.at.x - o.x0 - TAB.w / 2).toFixed(2); c.y = +(o.y1 - pc.at.y - TAB.h / 2).toFixed(2); c.side = pc.at.side; c.placed = pc.at.from === 'netlist' ? 'netlist' : 'pnp'; }
      else { c.x = 2 + (loose++) * (TAB.w + 2); c.y = b.h - TAB.h; c.placed = 'hand'; }
    });
    s.blocks.push(b);
    return b;
  }
  // Every cable end plugged into a connector: [{ cable, node }].
  const pluggedAt = (s, bid, cid) => s.cables.flatMap(c => Object.keys(c.ends).filter(k => { const e = c.ends[k]; return e && e.block === bid && e.conn === cid; }).map(k => ({ cable: c, node: k })));
  const harnessEnds = h => h ? h.nodes.filter(M.isConn) : [];
  // The harness end that best fits a connector: one filled from this board's connector (From a board),
  // then one with as many pins, then any end not plugged yet.
  function bestEnd(s, cab, h, b, c) {
    const free = harnessEnds(h).filter(n => !cab || !cab.ends[n.id]);
    const src = b.source && b.source.id;
    return free.find(n => n.board && src && n.board.project === src && n.board.ref === c.ref)
      || free.find(n => M.pinList(n).length === c.pins.length) || free[0] || null;
  }
  // ○ placeholder (no wires), ● wired with errors, ◉ wired with no errors.
  function status(h) {
    if (!h) return { key: 'missing', glyph: '✕', text: 'Harness missing' };
    if (!h.wires.length) return { key: 'placeholder', glyph: '○', text: 'Placeholder, no wires yet' };
    const e = M.checks(h).filter(x => x.sev === 'error').length;
    return e ? { key: 'progress', glyph: '●', text: `In progress, ${e} error${e > 1 ? 's' : ''}` } : { key: 'wired', glyph: '◉', text: 'Wired, no errors' };
  }
  // A placed cable may override its harness's length (Chris, 2026-11-11): it's then the variant
  // <harness PN>-<length in mm>, the same harness at another length.
  const pnOf = (h, cab) => { const base = (h && h.pn) || ''; return cab.lengthMm ? (base || '(no PN)') + '-' + Math.round(cab.lengthMm) : base; };
  const endName = (s, e) => { const b = e && block(s, e.block), c = b && conn(b, e.conn); return b && c ? `${b.ref} ${c.ref}` : ''; };

  function checks(s, get) {
    const out = [];
    const add = (sev, text, sel) => out.push({ sev, text, sel });
    s.blocks.forEach(b => b.conns.forEach(c => {
      const at = pluggedAt(s, b.id, c.id), where = `${b.ref} ${c.ref}`;
      if (!fitted(c) && at.length) { add('error', `${where} isn't populated, but a cable is plugged into it.`, { kind: 'conn', block: b.id, conn: c.id }); return; }
      if (!fitted(c)) return;
      if (c.used && !at.length) add('warn', `${where}${c.fn ? ' (' + c.fn + ')' : ''} is used, but nothing is plugged into it.`, { kind: 'conn', block: b.id, conn: c.id });
      if (!c.used && at.length) add('warn', `${where} has a cable but isn't marked used.`, { kind: 'conn', block: b.id, conn: c.id });
      if (at.length > 1) add('error', `${where} has ${at.length} cables plugged into it.`, { kind: 'conn', block: b.id, conn: c.id });
    }));
    s.cables.forEach(cab => {
      const h = get(cab.harness), sel = { kind: 'cable', id: cab.id };
      if (!h) { add('error', `Cable ${cab.label || cab.id} names a harness that isn't here.`, sel); return; }
      harnessEnds(h).forEach(n => {
        const e = cab.ends[n.id], b = e && block(s, e.block), c = b && conn(b, e.conn);
        if (!c) { add('warn', `${h.title}: ${n.ref} isn't plugged in.`, sel); return; }
        const where = `${h.title} ${n.ref} → ${b.ref} ${c.ref}`;
        const hp = M.pinList(n);
        if (hp.length !== c.pins.length) add('error', `${where}: the harness end has ${hp.length} pins, the connector ${c.pins.length}.`, sel);
        const bad = [];
        c.pins.forEach(p => { const l = (n.pinLabels || {})[p.pin] || ''; if (l && p.label && l !== p.label) bad.push(`${p.pin} ${l} ≠ ${p.label}`); });
        if (bad.length) add('warn', `${where}: pin labels don't match the board's nets (${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', …' : ''}).`, sel);
        if (n.board && b.source && n.board.project === b.source.id && n.board.source && b.source.label && n.board.source !== b.source.label)
          add('warn', `${where}: the end was filled from ${n.board.source}; this block is ${b.source.label}.`, sel);
      });
    });
    return out;
  }
  // What a reader of the stored file sees (Signoff PL, phase 4).
  function summarize(sys, get) {
    const c = checks(sys, get), qty = {};
    sys.cables.forEach(cab => { const h = get(cab.harness), k = cab.harness + '|' + (cab.lengthMm || ''); qty[k] = qty[k] || { harness: cab.harness, pn: pnOf(h, cab), name: h ? h.title : '', qty: 0 }; qty[k].qty++; });
    return { v: 1, tool: 'loom', kind: 'system', name: sys.title, project: sys.project || '', revision: sys.rev || '', archived: !!sys.deleted,
      blocks: sys.blocks.map(b => ({ ref: b.ref, name: b.name, kind: b.kind, ee: b.source && b.source.id || '', used: b.conns.filter(x => x.used).length })),
      harnesses: Object.values(qty), errors: c.filter(x => x.sev === 'error').length, warnings: c.filter(x => x.sev === 'warn').length };
  }

  // ── Storage ──
  function load() {
    try { S.store = JSON.parse(localStorage.getItem(NS + 'systems') || '{}') || {}; } catch (e) { S.store = {}; }
    Object.keys(S.store).forEach(id => { try { normalize(S.store[id]); } catch (e) { delete S.store[id]; } });
    let c = null;
    try { c = localStorage.getItem(NS + 'currentSystem'); } catch (e) { /* storage blocked */ }
    const want = new URLSearchParams(location.search).get('system');
    S.cur = want && S.store[want] ? want : null;
    return S.cur || (c && S.store[c] && !S.store[c].deleted && !new URLSearchParams(location.search).get('project') ? c : null);
  }
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(NS + 'systems', JSON.stringify(S.store)); localStorage.setItem(NS + 'currentSystem', S.cur || ''); }
      catch (e) { A.toast("Couldn't keep this in the browser: " + e.message, 'error'); }
    }, 200);
  }
  const live = () => Object.values(S.store).filter(s => !s.deleted);
  const cur = () => S.store[S.cur] || null;

  // ── Changes and undo (its own, apart from the harness editor's) ──
  function change(fn) {
    const s = cur();
    if (!s) return null;
    S.past.push(JSON.stringify(s)); if (S.past.length > 120) S.past.shift(); S.future = [];
    const r = fn(s);
    s.updated = now();
    if (A.login()) s.updatedBy = A.login();
    persist(); A.refresh();
    return r;
  }
  function swap(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(cur()));
    S.store[S.cur] = JSON.parse(from.pop());
    if (S.sel && !selValid()) S.sel = null;
    persist(); A.refresh();
  }
  function selValid() {
    const s = cur(), t = S.sel;
    if (!s || !t) return false;
    if (t.kind === 'block') return !!block(s, t.block);
    if (t.kind === 'conn') return !!conn(block(s, t.block), t.conn);
    if (t.kind === 'cable') return !!cable(s, t.id);
    return false;
  }

  function open(id) { S.cur = id; S.pending = null; S.pair = null; S.sel = null; S.past = []; S.future = []; S.cam = null; S.adding = null; S.picking = null; persist(); }
  function create(project) { const s = blank(project); S.store[s.id] = s; open(s.id); return s; }

  // ── Drawing ──
  // The canvas is drawn in the harness editor's units (K per mm), so it takes the editor's look as it
  // is: wires with an edge and gloss (.w-edge, .w-base, .w-gloss), the selection's pulse (.w-pulse),
  // the wiring ghost (.ghost-w), and draggable runs (.cv-run). Cables route at right angles round the
  // blocks between them (route.js, as the editor's wires do); a dragged run or an added bend is kept
  // per cable and end (cab.routes), until Reset route.
  const K = 4, STUB_U = 24, GRID = 4, RADIUS = 14, CLEAR = 12;
  const RT = () => LM.route;
  // A tab on the canvas, and where a cable leaves it (Chris, 2026-11-11: out of any side, by default the
  // side of the board edge it's nearest): the exit point (ex, ey) in the middle of that side of the tab,
  // and its direction (dx, dy). A connector's panel can set the side (c.exit). tx and cy alias the exit.
  const SIDES = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
  function exitSide(b, c) {
    if (c.exit && SIDES[c.exit]) return c.exit;
    const d = { left: c.x, right: b.w - c.x - TAB.w, top: c.y, bottom: b.h - c.y - TAB.h };
    return Object.keys(d).sort((p, q) => d[p] - d[q])[0];
  }
  function tabGeom(b, c) {
    const x = (b.x + c.x) * K, y = (b.y + c.y) * K, w = TAB.w * K, h = TAB.h * K, cx = x + w / 2, cy = y + h / 2;
    const side = exitSide(b, c), [dx, dy] = SIDES[side];
    const ex = dx ? (dx < 0 ? x : x + w) : cx, ey = dy ? (dy < 0 ? y : y + h) : cy;
    // A cable leaving up or down runs out past the block's edge, then turns level (route.js routes
    // level from there): the lead point.
    const ly = dy ? (dy < 0 ? b.y * K : (b.y + b.h) * K) + dy * STUB_U : ey;
    return { x, y, w, h, cx, cy: ey, mid: cy, side, dx, dy, ex, ey, tx: ex, out: dx, lead: dy ? { x: ex, y: ly } : null };
  }
  // A rounded path through right-angle corners, and the point halfway along it.
  function rounded(C0, r) {
    const C = [];
    C0.forEach(p => { const q = C[C.length - 1]; if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.01) C.push(p); });
    for (let i = 1; i < C.length - 1;) { const a = C[i - 1], b = C[i], c = C[i + 1]; if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 0.01) C.splice(i, 1); else i++; }
    let d = `M${C[0].x} ${C[0].y}`, total = 0;
    const L = C.slice(1).map((p, i) => Math.hypot(p.x - C[i].x, p.y - C[i].y));
    for (let i = 1; i < C.length; i++) {
      const p = C[i];
      if (i === C.length - 1) { d += `L${p.x} ${p.y}`; break; }
      const a = C[i - 1], c = C[i + 1], rr = Math.min(r, L[i - 1] / 2, L[i] / 2);
      const u = { x: (p.x - a.x) / L[i - 1], y: (p.y - a.y) / L[i - 1] }, v = { x: (c.x - p.x) / L[i], y: (c.y - p.y) / L[i] };
      d += `L${(p.x - u.x * rr).toFixed(1)} ${(p.y - u.y * rr).toFixed(1)}Q${p.x} ${p.y} ${(p.x + v.x * rr).toFixed(1)} ${(p.y + v.y * rr).toFixed(1)}`;
    }
    L.forEach(l => { total += l; });
    let half = total / 2, mid = C[0];
    for (let i = 0; i < L.length; i++) {
      if (half <= L[i]) { const t = L[i] ? half / L[i] : 0; mid = { x: C[i].x + (C[i + 1].x - C[i].x) * t, y: C[i].y + (C[i + 1].y - C[i].y) * t }; break; }
      half -= L[i];
    }
    return { d, mid };
  }
  function cableEnds(s, cab, h) {
    return harnessEnds(h).map(n => { const e = cab.ends[n.id], b = e && block(s, e.block), c = b && conn(b, e.conn); return { n, b, c, g: c ? tabGeom(b, c) : null }; });
  }
  const pathOf = pts => 'M' + pts.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('L');
  // Every cable's routes: from its first plugged end to each other plugged end.
  // Routing is the slow part (a system the size of a machine has dozens of cables over a big grid), so
  // the layout is kept until the blocks, connectors, cables, or harness ends change, not redone for a
  // selection; and a big system routes on a coarser grid (about 300k cells at most).
  let memo = { key: '', lo: null };
  function layout(s) {
    const key = JSON.stringify([s.id, s.blocks.map(b => [b.id, b.x, b.y, b.w, b.h, b.conns.map(c => [c.id, c.x, c.y, c.exit || '', c.fitted])]), s.cables, s.cables.map(c => { const h = A.harness(c.harness); return h ? [h.id, h.wires.length, harnessEnds(h).map(n => n.id), h.wires.length ? M.checks(h).filter(x => x.sev === 'error').length : 0] : null; })]);
    if (memo.key === key && memo.lo) return memo.lo;
    const lo = layoutNow(s);
    memo = { key, lo };
    return lo;
  }
  // route.js's search buffers, shared by every route (a fresh set per route was most of the time): its
  // generation stamps mean they never need clearing.
  const POOL = { n: 0, stamp: null, dist: null, prev: null, gen: 0 };
  const RCACHE = new Map();
  function gridFor(lb, g) {
    const x0 = Math.floor(lb.x0 / g) * g, y0 = Math.floor(lb.y0 / g) * g;
    const W = Math.ceil((lb.x1 - x0) / g) + 1, H = Math.ceil((lb.y1 - y0) / g) + 1, N = W * H * 4;
    if (POOL.n < N || POOL.gen > 4e9) { POOL.n = N; POOL.stamp = new Uint32Array(N); POOL.dist = new Float32Array(N); POOL.prev = new Int32Array(N); POOL.gen = 0; }
    return { g, x0, y0, W, H, occ: new Uint8Array(W * H), stamp: POOL.stamp, dist: POOL.dist, prev: POOL.prev, gen: POOL.gen };
  }
  function layoutNow(s) {
    const out = new Map();
    if (!s.blocks.length) return out;
    const rects = s.blocks.map(x => ({ id: x.id, x0: x.x * K - CLEAR, y0: x.y * K - CLEAR, x1: (x.x + x.w) * K + CLEAR, y1: (x.y + x.h) * K + CLEAR }));
    s.cables.forEach(cab => {
      const h = A.harness(cab.harness), ends = cableEnds(s, cab, h), at = ends.filter(x => x.g), routes = [];
      for (let i = 1; i < at.length; i++) {
        const a = at[0], b = at[i];
        // Level terminals for route.js: the exit itself for a side exit, else the lead point past the
        // block's edge, leaving toward the other end.
        const pa = a.g.lead || { x: a.g.ex, y: a.g.ey }, pb = b.g.lead || { x: b.g.ex, y: b.g.ey }, toward = Math.sign(pb.x - pa.x) || 1;
        const T1 = { x: pa.x, y: pa.y, out: a.g.dx || toward }, T2 = { x: pb.x, y: pb.y, in: b.g.dx ? -b.g.dx : toward };
        // Each cable routes on its own grid round its two ends (fast enough to redo while a block is
        // dragged): their box, plus room to walk round what's between, at most about 25k cells.
        const m = Math.max(160, 0.35 * Math.max(Math.abs(T1.x - T2.x), Math.abs(T1.y - T2.y)));
        const lb = { x0: Math.min(T1.x, T2.x) - m, y0: Math.min(T1.y, T2.y) - m, x1: Math.max(T1.x, T2.x) + m, y1: Math.max(T1.y, T2.y) + m };
        const g = Math.max(GRID, Math.ceil(Math.sqrt((lb.x1 - lb.x0) * (lb.y1 - lb.y0) / 25000) / GRID) * GRID);
        // Its own two blocks aren't in the way: an end inside its board would otherwise search far
        // to get out (its exit already leaves the board's side).
        const blocks = rects.filter(r => r.id !== a.b.id && r.id !== b.b.id && r.x1 > lb.x0 && r.x0 < lb.x1 && r.y1 > lb.y0 && r.y0 < lb.y1);
        const kept = cab.routes && cab.routes[b.n.id];
        let v = kept && RT().fits(T1, T2, kept, STUB_U) ? kept.map(Number) : null;
        if (!v) {
          // A route found before for the same ends among the same blocks is reused, so a drag re-routes
          // only the cables it moves or crosses.
          const rk = JSON.stringify([T1, T2, blocks.map(r => [r.x0, r.y0, r.x1, r.y1])]);
          v = RCACHE.get(rk);
          if (!v) { const G = gridFor(lb, g); v = RT().auto(G, T1, T2, blocks, STUB_U, 0) || [Math.round((T1.x + T2.x) / 2)]; POOL.gen = G.gen; if (RCACHE.size > 4000) RCACHE.clear(); RCACHE.set(rk, v); }
        }
        const C = (a.g.lead ? [{ x: a.g.ex, y: a.g.ey }] : []).concat(RT().corners(T1, T2, v), b.g.lead ? [{ x: b.g.ex, y: b.g.ey }] : []);
        const rp = rounded(C, RADIUS);
        routes.push({ key: b.n.id, A: T1, B: T2, v: Array.from(v), d: rp.d, mid: rp.mid });
      }
      out.set(cab.id, { cab, h, ends, at, routes });
    });
    return out;
  }
  const midOf = r => r.mid;
  function svgHtml(s, Lo) {
    const sel = S.sel;
    const isSel = (k, a, b2) => sel && sel.kind === k && (k === 'cable' ? sel.id === a : sel.block === a && (k === 'block' || sel.conn === b2));
    let html = '<g class="sys-blocks">';
    s.blocks.forEach(b => {
      const bs = isSel('block', b.id) || (sel && sel.kind === 'conn' && sel.block === b.id);
      const X = b.x * K, Y = b.y * K;
      html += `<g class="sys-block ${b.kind}${bs ? ' sel' : ''}" data-block="${b.id}">` +
        `<rect class="sys-body" x="${X}" y="${Y}" width="${b.w * K}" height="${b.h * K}" rx="${b.kind === 'device' ? 12 : 8}"/>` +
        `<text class="sys-ref" x="${X + 10}" y="${Y + 22}">${esc(b.ref)}</text>` +
        `<text class="sys-name" x="${X + 10}" y="${Y + 40}">${esc(b.name)}</text>`;
      b.conns.filter(c => !fitted(c)).concat(b.conns.filter(fitted)).forEach(c => {
        const at = pluggedAt(s, b.id, c.id).length, g = tabGeom(b, c), fit = fitted(c);
        const pend = S.pending && S.pending.block === b.id && S.pending.conn === c.id;
        const cls = ['sys-tab', !fit ? 'unfitted' : '', pend ? 'pending' : S.pending && fit ? 'can' : '', c.used ? 'used' : 'unused', at ? 'plugged' : '', c.used && !at ? 'open' : '', c.side === 'bottom' ? 'bottom' : '', isSel('conn', b.id, c.id) ? 'sel' : ''].filter(Boolean).join(' ');
        html += `<g class="${cls}" data-conn="${c.id}" data-block="${b.id}"><title>${esc(`${b.ref} ${c.ref}${c.fn ? ' · ' + c.fn : ''} · ${c.pins.length} pins${c.side === 'bottom' ? ' · bottom side' : ''}${c.placed === 'hand' && b.source ? ' · placed by hand' : c.placed === 'netlist' ? ' · not in the pick-and-place: placed at its pads in the netlist' : ''}${fit ? ' · click, then click another connector, to run a cable' : ' · not populated'}`)}</title>` +
          `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="3"/><text x="${g.cx}" y="${g.cy + 3.5}">${esc(c.ref)}</text></g>`;
      });
      html += '</g>';
    });
    html += '</g><g class="sys-cables">';
    let labels = '', handles = '';
    (Lo || layout(s)).forEach(({ cab, h, ends, at, routes }) => {
      const st = status(h), on = isSel('cable', cab.id);
      const color = st.key === 'wired' ? 'var(--accent)' : st.key === 'placeholder' ? 'var(--text-3)' : 'var(--issue)';
      const wire = (d, extra) => `<path class="sys-hit" d="${d}"/><path class="w-edge" d="${d}"/><path class="w-base" style="stroke:${color}" d="${d}"/>` +
        (st.key === 'placeholder' || extra === 'open' ? '' : `<path class="w-gloss" d="${d}"/>`) + (on ? `<path class="w-pulse" pathLength="1" d="${d}"/>` : '');
      html += `<g class="w sys-w st-${st.key}${on ? ' sel' : ''}" data-cable="${cab.id}">`;
      let mid = null, ring = null;
      routes.forEach(r => { html += wire(r.d); });
      if (routes.length) mid = midOf(routes[0]);
      // Ends not plugged in yet: a dashed stub ending in a ring, off the one plugged end or the middle.
      const open = ends.length - at.length;
      if (at.length === 1) {
        const g = at[0].g, x2 = g.ex + g.dx * STUB_U * 2.2, y2 = g.ey + g.dy * STUB_U * 2.2;
        html += `<g class="sys-open">${wire(`M${g.ex} ${g.ey}L${x2} ${y2}`, 'open')}<circle class="sys-ring" cx="${x2}" cy="${y2}" r="5"/></g>`;
        mid = { x: x2, y: y2 }; ring = { x: x2, y: y2, ax: g.ex, ay: g.ey };
      } else if (open && mid) {
        html += `<g class="sys-open">${wire(`M${mid.x} ${mid.y}l0 ${STUB_U * 1.6}`, 'open')}<circle class="sys-ring" cx="${mid.x}" cy="${mid.y + STUB_U * 1.6}" r="5"/></g>`;
        ring = { x: mid.x, y: mid.y + STUB_U * 1.6, ax: mid.x, ay: mid.y };
      }
      html += '</g>';
      const anchorOf = x => { const o = at.find(y => y !== x); return o ? o.g : x.g; };
      at.forEach(x => {
        const a = anchorOf(x);
        handles += `<circle class="cv-end sys-end" cx="${x.g.tx}" cy="${x.g.cy}" r="4.5"/><circle class="cv-hitend" data-cend="${cab.id}|${x.n.id}" data-from='${esc(JSON.stringify({ block: x.b.id, conn: x.c.id }))}' data-x="${a.tx}" data-y="${a.cy}" cx="${x.g.tx}" cy="${x.g.cy}" r="10"><title>Drag this end to another connector, or off to leave it open</title></circle>`;
      });
      const loose = ends.find(x => !x.g);
      if (loose && ring) handles += `<circle class="cv-hitend" data-cend="${cab.id}|${loose.n.id}" data-x="${ring.ax}" data-y="${ring.ay}" cx="${ring.x}" cy="${ring.y}" r="10"><title>${esc(loose.n.ref)} isn't plugged in: drag it onto a connector</title></circle>`;
      if (mid) labels += `<text class="sys-clabel${on ? ' sel' : ''}" x="${mid.x + 8}" y="${mid.y - 9}">${esc(`${st.glyph} ${h ? h.title : 'Missing harness'}${pnOf(h, cab) ? ' · ' + pnOf(h, cab) : ''}`)}</text>`;
      // The selected cable's middle runs drag, as the editor's do.
      if (on) routes.forEach(r => RT().runs(r.A, r.B, r.v).forEach(R => {
        if (R.k < 0) return;
        const mx = (R.a.x + R.b.x) / 2, my = (R.a.y + R.b.y) / 2, v = R.axis === 'v';
        handles += `<g class="cv-run ${v ? 'v' : 'h'}" data-run="${cab.id}|${r.key}|${R.k}"><rect class="cv-run-hit" x="${mx - (v ? 8 : 14)}" y="${my - (v ? 14 : 8)}" width="${v ? 16 : 28}" height="${v ? 28 : 16}"/>` +
          `<rect class="cv-run-bar" x="${mx - (v ? 2.5 : 9)}" y="${my - (v ? 9 : 2.5)}" width="${v ? 5 : 18}" height="${v ? 18 : 5}" rx="2.5"/></g>`;
      }));
    });
    return html + '</g><g class="sys-labels">' + labels + '</g><g class="sys-handles">' + handles + '</g><g id="sys-ghost"></g>';
  }
  function bounds(s) {
    if (!s.blocks.length) return { x: -80, y: -80, w: 800, h: 480 };
    const x0 = Math.min(...s.blocks.map(b => b.x)), y0 = Math.min(...s.blocks.map(b => b.y));
    const x1 = Math.max(...s.blocks.map(b => b.x + b.w)), y1 = Math.max(...s.blocks.map(b => b.y + b.h));
    const m = 16;
    return { x: (x0 - m) * K, y: (y0 - m) * K, w: (x1 - x0 + 2 * m) * K, h: (y1 - y0 + 2 * m) * K };
  }

  // ── The panel ──
  const fld = (label, inner, hint) => `<div class="field"><label>${label}</label>${inner}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const inp = (f, v, attrs) => `<input class="input" data-sf="${f}" value="${esc(v == null ? '' : v)}"${attrs || ''}>`;
  const btn = (act, label, extra, cls) => `<button class="btn${cls ? ' ' + cls : ''}" data-sact="${act}"${extra || ''}>${label}</button>`;
  function panelHtml(s) {
    const t = S.sel, get = A.harness;
    if (S.adding) return addingHtml();
    if (t && t.kind === 'conn') return connHtml(s, block(s, t.block), conn(block(s, t.block), t.conn));
    if (t && t.kind === 'block') return blockHtml(s, block(s, t.block));
    if (t && t.kind === 'cable') return cableHtml(s, cable(s, t.id));
    const c = checks(s, get);
    return `<div class="rail-head"><div class="eyebrow">System</div><div class="rail-title">${esc(s.title)}</div></div>` +
      fld('Title', inp('title', s.title)) + fld('Client project', inp('project', s.project, ' list="sys-projects"') + `<datalist id="sys-projects">${A.projects().map(p => `<option value="${esc(p)}">`).join('')}</datalist>`) + fld('Rev', inp('rev', s.rev)) +
      `<div class="sys-actions">${btn('add-board', 'Add a board from Signoff EE', '', 'btn-primary')}${btn('add-drawn', 'Draw a board')}${btn('add-device', 'Add a device')}</div>` +
      `<h4 class="sys-h">Cables <span class="count">${s.cables.length}</span></h4>` +
      (s.cables.length ? `<div class="sys-list">${s.cables.map(cab => { const h = get(cab.harness), st = status(h); return `<button class="sys-row" data-ssel="cable:${cab.id}"><span class="sys-st st-${st.key}" title="${esc(st.text)}">${st.glyph}</span><span>${esc(h ? h.title : 'Missing harness')}<small>${esc([pnOf(h, cab), harnessEnds(h).map(n => endName(s, cab.ends[n.id]) || n.ref + ' not plugged').join(' · ')].filter(Boolean).join(' · '))}</small></span></button>`; }).join('')}</div>` : '<p class="hint">Click a connector on a board, mark it used, and plug a harness into it.</p>') +
      `<h4 class="sys-h">Checks <span class="count">${c.length}</span></h4>` + checksHtml(c) +
      `<div class="sys-actions">${btn('delete-system', 'Delete system', '', 'btn-danger')}</div>`;
  }
  function checksHtml(c) {
    if (!c.length) return '<p class="hint">No problems found.</p>';
    return `<div class="sys-checks">${c.map((x, i) => `<button class="sys-check ${x.sev}" data-scheck="${i}"><span class="sev">${x.sev === 'error' ? '■' : '▲'}</span>${esc(x.text)}</button>`).join('')}</div>`;
  }
  function addingHtml() {
    const head = `<div class="rail-head"><div class="eyebrow">Add a board</div><div class="rail-title">From Signoff EE</div></div>`;
    if (S.busy) return head + `<p class="hint">${esc(S.busy)}</p>`;
    if (S.boardsErr) return head + `<p class="hint">${esc(S.boardsErr)}</p>` + btn('cancel-add', 'Back');
    if (!S.boards) return head + '<p class="hint">Reading the boards…</p>';
    const groups = new Map();
    S.boards.forEach(b => { const k = b.client || 'No project'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
    return head + '<p class="hint">Its connectors come from the tagged revision’s package (or the latest stored Fabcheck run), placed where its pick-and-place puts them.</p>' +
      [...groups].map(([k, list]) => `<h4 class="sys-h">${esc(k)}</h4><div class="sys-list">${list.map(b => `<button class="sys-row" data-sact="pick-board" data-board="${esc(b.id)}"><span class="sys-st">▭</span><span>${esc(b.name)}</span></button>`).join('')}</div>`).join('') +
      btn('cancel-add', 'Cancel');
  }
  function blockHtml(s, b) {
    const used = b.conns.filter(c => fitted(c) && c.used).length, pop = b.conns.filter(fitted).length;
    return `<div class="rail-head"><div class="eyebrow">${b.kind === 'device' ? 'Device' : 'Board'} ${esc(b.ref)}</div><div class="rail-title">${esc(b.name)}</div></div>` +
      fld('Ref', inp('b.ref', b.ref)) + fld('Name', inp('b.name', b.name)) +
      (b.source ? `<p class="hint">From Signoff EE: ${esc(b.source.name)}${b.source.label ? ' · ' + esc(b.source.label) : ''}. ${esc(String(b.w))} × ${esc(String(b.h))} mm, from its pick-and-place and netlist.</p><div class="sys-actions">${btn('refresh-board', S.busy ? 'Reading…' : 'Refresh from Signoff EE', S.busy ? ' disabled' : '')}${btn('open-ee', 'Open in Signoff EE')}</div>`
        : `<div class="field-row">${fld('Width, mm', inp('b.w', b.w, ' type="number" min="5"'))}${fld('Height, mm', inp('b.h', b.h, ' type="number" min="5"'))}</div>`) +
      `<h4 class="sys-h">Connectors <span class="count">${pop} populated, ${used} used, of ${b.conns.length}</span></h4>` +
      `<div class="sys-ctab"><div class="sys-crow sys-chead"><span>Connector</span><span>Populated</span><span>Used</span><span></span></div>${b.conns.map(c => `<div class="sys-crow${fitted(c) ? '' : ' off'}"><button class="sys-link" data-ssel="conn:${b.id}:${c.id}">${esc(c.ref)}</button>` +
        `<input type="checkbox" data-sfit="${c.id}" title="Populated (fitted on this board)"${fitted(c) ? ' checked' : ''}><input type="checkbox" data-sused="${c.id}" title="Used"${fitted(c) && c.used ? ' checked' : ''}${fitted(c) ? '' : ' disabled'}>` +
        `<span class="sys-cfn">${esc(c.fn || (c.placed === 'netlist' && c.fitted == null ? 'not in the pick-and-place' : '') || c.desc || c.pins.length + ' pins')}</span></div>`).join('')}</div>` +
      `<div class="sys-actions">${btn('add-conn', 'Add a connector')}${btn('dup-block', 'Copy this block')}${btn('delete-block', 'Delete', '', 'btn-danger')}</div>`;
  }
  function connHtml(s, b, c) {
    const at = pluggedAt(s, b.id, c.id), get = A.harness;
    const pick = S.picking && S.picking.block === b.id && S.picking.conn === c.id;
    return `<div class="rail-head"><div class="eyebrow">${esc(b.ref)} · ${esc(b.name)}</div><div class="rail-title">${esc(c.ref)}</div></div>` +
      `<div class="sys-flags"><label class="tick sys-used"><input type="checkbox" data-sfit="${c.id}"${fitted(c) ? ' checked' : ''}> Populated</label>` +
      `<label class="tick sys-used"><input type="checkbox" data-sused="${c.id}"${fitted(c) && c.used ? ' checked' : ''}${fitted(c) ? '' : ' disabled'}> Used</label></div>` +
      (fitted(c) ? '' : `<p class="hint">Not populated${c.placed === 'netlist' && c.fitted == null ? ': it isn’t in the pick-and-place, so it isn’t fitted in that build variant' : ''}. It’s drawn faint and can’t take a cable.</p>`) +
      fld('Function', inp('c.fn', c.fn, ' placeholder="What it connects to: Fan, Display, 24 VAC in…"')) +
      (b.source ? '' : `<div class="field-row">${fld('Ref', inp('c.ref', c.ref))}${fld('Pins', inp('c.pins', c.pins.length, ' type="number" min="1" max="200"'))}</div>`) +
      (!b.source || c.placed === 'hand' ? `<div class="field-row">${fld('X on the block, mm', inp('c.x', c.x, ' type="number" step="0.5"'))}${fld('Y, mm', inp('c.y', c.y, ' type="number" step="0.5"'))}</div>` : '') +
      (c.mpn || c.desc ? `<p class="hint">${esc([c.mfr, c.mpn, c.desc].filter(Boolean).join(' · '))}${c.side === 'bottom' ? ' · bottom side' : ''}${c.placed === 'hand' && b.source ? ' · not in the pick-and-place or the netlist, placed by hand' : c.placed === 'netlist' ? ' · not in the pick-and-place (not fitted in its build variant?), placed at its pads in the netlist' : ''}</p>` : '') +
      `<h4 class="sys-h">Plugged in</h4>` +
      (at.length ? `<div class="sys-list">${at.map(x => { const h = get(x.cable.harness), n = h && M.node(h, x.node), st = status(h); return `<button class="sys-row" data-ssel="cable:${x.cable.id}"><span class="sys-st st-${st.key}" title="${esc(st.text)}">${st.glyph}</span><span>${esc(h ? h.title : 'Missing harness')}<small>${esc(n ? 'its end ' + n.ref : '')}</small></span></button>`; }).join('')}</div>` : '<p class="hint">Nothing yet.</p>') +
      (pick ? pickHtml(s, b, c) : `<div class="sys-actions">${btn('new-harness', 'New harness here', '', 'btn-primary')}${btn('pick-harness', 'Plug in a harness…')}</div>`) +
      (S.pair && S.pair.block !== b.id || S.pair && S.pair.conn !== c.id ? '' : '') +
      fld('Cables leave from', `<select class="input" data-sexit="${c.id}">${[['', 'The nearest board edge (' + exitSide(b, Object.assign({}, c, { exit: '' })) + ')'], ['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']].map(([v, l]) => `<option value="${v}"${(c.exit || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`) +
      pinoutHtml(b, c) +
      (b.source ? '' : `<div class="sys-actions">${btn('delete-conn', 'Delete connector', '', 'btn-danger')}</div>`);
  }
  // The pinout: each pin and its net name, from a Signoff EE board's netlist (Chris, 2026-11-11: pin and
  // net name only, for checking connections later). A drawn block's pins take net names by hand.
  function pinoutHtml(b, c) {
    const rows = c.pins.map((p, i) => {
      const net = p.label || p.net || '';
      const cell = b.source ? (net ? esc(net) : '<span class="sys-none">no net</span>') : `<input class="input sys-pinnet" data-spin="${c.id}|${i}" value="${esc(net)}" placeholder="Net name">`;
      return `<tr><td class="sys-pin">${esc(p.pin)}</td><td class="sys-net">${cell}</td></tr>`;
    }).join('');
    const src = b.source ? `From ${esc(b.source.name)}’s netlist${b.source.label ? ', ' + esc(b.source.label) : ''}.` : 'Name each pin’s net, as the far end calls it.';
    return `<h4 class="sys-h">Pinout <span class="count">${c.pins.length} pins</span></h4><p class="hint">${src}</p>` +
      `<div class="sys-pinwrap"><table class="sys-pintab"><thead><tr><th>Pin</th><th>Net</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function pickHtml(s, b, c) {
    const list = A.harnesses().filter(h => harnessEnds(h).length);
    const score = h => { const n = bestEnd(s, null, h, b, c); return n && n.board && b.source && n.board.project === b.source.id && n.board.ref === c.ref ? 0 : n && M.pinList(n).length === c.pins.length ? 1 : 2; };
    list.sort((x, y) => score(x) - score(y) || String(x.title).localeCompare(String(y.title)));
    return `<h4 class="sys-h">Plug in</h4><div class="sys-list">${list.map(h => { const sc = score(h); return `<button class="sys-row" data-sact="plug" data-harness="${h.id}"><span class="sys-st">${sc === 0 ? '★' : sc === 1 ? '=' : '·'}</span><span>${esc(h.title)}<small>${esc([h.pn, sc === 0 ? 'made from this connector' : sc === 1 ? 'same pin count' : '', h.project].filter(Boolean).join(' · '))}</small></span></button>`; }).join('') || '<p class="hint">No harnesses yet.</p>'}</div>${btn('cancel-pick', 'Cancel')}`;
  }
  function cableHtml(s, cab) {
    const h = A.harness(cab.harness), st = status(h);
    const opts = cur => `<option value="">Not plugged</option>` + s.blocks.map(b => b.conns.map(c => `<option value="${b.id}|${c.id}"${cur && cur.block === b.id && cur.conn === c.id ? ' selected' : ''}>${esc(`${b.ref} ${c.ref}${c.fn ? ' · ' + c.fn : ''}`)}</option>`).join('')).join('');
    return `<div class="rail-head"><div class="eyebrow">Cable</div><div class="rail-title">${esc(h ? h.title : 'Missing harness')}</div></div>` +
      `<p class="hint"><span class="sys-st st-${st.key}">${st.glyph}</span> ${esc(st.text)}${h && h.pn ? ' · ' + esc(h.pn) : ''}</p>` +
      (h ? harnessEnds(h).map(n => fld(`${esc(n.ref)}${n.name ? ' · ' + esc(n.name) : ''} plugs into`, `<select class="input" data-send="${n.id}">${opts(cab.ends[n.id])}</select>`)).join('') : '') +
      fld('Length here, mm', inp('cab.len', cab.lengthMm || '', ' type="number" min="1" placeholder="The harness’s own"'), cab.lengthMm ? `A variant at this length: <b>${esc(pnOf(h, cab))}</b>.` : 'Set it to use this harness at another length, as a variant part number.') +
      `<div class="sys-actions">${h ? btn('open-harness', 'Open the harness', '', 'btn-primary') : ''}${cab.routes && Object.keys(cab.routes).length ? btn('reset-route', 'Reset route') : ''}${btn('delete-cable', 'Remove from the system', '', 'btn-danger')}</div>`;
  }

  // ── Render ──
  function render(page) {
    const s = cur();
    if (!s) return;
    page.classList.add('sys-on');
    if (!page.querySelector('.sys-view')) {
      page.innerHTML = `<div class="sys-view"><div class="sys-canvas-wrap canvas-wrap cv-paper"><svg class="lm-canvas sys-canvas" id="sys-canvas" xmlns="http://www.w3.org/2000/svg"></svg>
        <div class="board-hud glass sys-hud"><button class="icon-btn" data-sact="undo" title="Undo (Ctrl+Z)">↶</button><button class="icon-btn" data-sact="redo" title="Redo (Ctrl+Shift+Z)">↷</button><button class="icon-btn" data-sact="fit" title="Fit (F)">⤢</button><span class="sys-hint" id="sys-hint"></span></div></div>
        <aside class="rail sys-panel" id="sys-panel"></aside></div>`;
      wire(page);
    }
    const svg = page.querySelector('#sys-canvas');
    if (!S.cam) S.cam = bounds(s);
    svg.setAttribute('viewBox', `${S.cam.x} ${S.cam.y} ${S.cam.w} ${S.cam.h}`);
    redraw(svg);
    page.querySelector('[data-sact="undo"]').disabled = !S.past.length;
    page.querySelector('[data-sact="redo"]').disabled = !S.future.length;
    page.querySelector('#sys-hint').textContent = S.pending ? `From ${endName(s, S.pending)}: click another connector to run a cable to it (Esc cancels)` : s.blocks.length ? 'Click a connector, then another, to run a cable · drag a cable’s ends · drag a selected cable’s runs · double-click to add a bend' : 'Add a board from the panel';
    const panel = page.querySelector('#sys-panel'), keep = panel.scrollTop;
    panel.innerHTML = panelHtml(s);
    panel.scrollTop = keep;
  }
  function leave(page) { page.classList.remove('sys-on'); }

  // ── Interaction ──
  // Exactly the harness editor's gestures, with connectors as its pins, boards and devices as its
  // connector cards, and cables as its wires (app.js onDown, click, finishWire, drawGhost):
  // - a click on a connector starts a cable (S.pending); the ghost follows the pointer and snaps to
  //   the connector under it; a click on another connector finishes it, on the same one or anywhere
  //   else cancels it (Esc too);
  // - a drag on a block, or on one of its connectors, moves the block;
  // - a cable end's dot drags onto another connector (re-plug) or empty canvas (left open), and an
  //   open end's ring drags onto a connector to plug it;
  // - a click selects a cable; a selected cable's straight runs drag, and a double-click adds a bend;
  // - the right or middle button pans (the left button too, on empty canvas), the wheel zooms.
  function toWorld(svg, e) {
    const r = svg.getBoundingClientRect(), k = Math.max(S.cam.w / r.width, S.cam.h / r.height);
    const ox = S.cam.x + (S.cam.w - r.width * k) / 2, oy = S.cam.y + (S.cam.h - r.height * k) / 2;
    return { x: ox + (e.clientX - r.left) * k, y: oy + (e.clientY - r.top) * k, k };
  }
  const snap = v => Math.round(v);
  const snapU = v => Math.round(v / GRID) * GRID;
  let drag = null, lastLo = null;
  function redraw(svg) { lastLo = layout(cur()); svg.innerHTML = svgHtml(cur(), lastLo); svg.classList.toggle('wiring', !!S.pending); }
  const tabAt = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.closest && el.closest('#sys-canvas [data-conn]'); };
  const tabRef = el => ({ block: el.dataset.block, conn: el.dataset.conn });
  const sameTab = (a, b) => !!a && !!b && a.block === b.block && a.conn === b.conn;
  // The run of a cable nearest a point: { r (its route), n (route.nearestRun) }.
  function runNear(cabId, p) {
    const L = lastLo && lastLo.get(cabId);
    if (!L) return null;
    let best = null;
    L.routes.forEach(r => { const n = RT().nearestRun(r.A, r.B, r.v, p); if (n && (!best || n.d < best.n.d)) best = { r, n }; });
    return best;
  }
  function keepRoute(cab, key, v) { cab.routes = Object.assign({}, cab.routes, { [key]: v }); }
  // The cable being drawn: from the connector's terminal, leaving level as a cable would, sagging a
  // little; over another connector it snaps onto that one's terminal.
  function ghost(svg, from, p, snapped) {
    const s0 = cur(), b = block(s0, from.block), c = b && conn(b, from.conn);
    if (!c) return;
    const g = tabGeom(b, c), s = p.x >= g.ex ? 1 : -1, dd = Math.max(40, Math.hypot(p.x - g.ex, p.y - g.ey) * 0.5);
    const sag = Math.min(60, Math.abs(p.x - g.ex) * 0.08 + Math.abs(p.y - g.ey) * 0.05);
    const d = `M${g.ex} ${g.ey}C${g.ex + g.dx * dd} ${g.ey + g.dy * dd + (g.dy ? 0 : sag)} ${p.x - s * Math.max(40, Math.abs(p.x - g.ex) * 0.5)} ${p.y + sag} ${p.x} ${p.y}`;
    const gh = svg.querySelector('#sys-ghost');
    if (gh) gh.innerHTML = `<g class="ghost-w${snapped ? ' snapped' : ''}" style="color:var(--accent)"><path class="ghost-glow" d="${d}"/><path class="ghost-edge" d="${d}"/><path class="ghost-base" d="${d}"/><path class="ghost-flow" d="${d}"/>` +
      `<circle class="ghost-end" cx="${p.x}" cy="${p.y}" r="${snapped ? 6 : 4.5}"/></g>`;
  }
  // The ghost for the pointer: snapped to a connector under it (not the one it starts from).
  function ghostAt(svg, from, e) {
    const t = tabAt(e);
    svg.querySelectorAll('.sys-tab.land').forEach(x => x.classList.remove('land'));
    if (t && !sameTab(tabRef(t), from)) {
      t.classList.add('land');
      const b = block(cur(), t.dataset.block), g = tabGeom(b, conn(b, t.dataset.conn));
      ghost(svg, from, { x: g.tx, y: g.cy }, true);
      return tabRef(t);
    }
    ghost(svg, from, toWorld(svg, e), false);
    return null;
  }
  function cancelWire() { S.pending = null; A.refresh(); }
  // A click on a connector, as on a pin: start, finish, or cancel a cable.
  function clickTab(ref) {
    if (!S.pending) { S.pending = ref; S.sel = Object.assign({ kind: 'conn' }, ref); S.picking = null; A.refresh(); return; }
    if (sameTab(S.pending, ref)) { cancelWire(); return; }
    S.pair = S.pending; S.pending = null;
    S.sel = Object.assign({ kind: 'conn' }, ref);
    act('new-harness');
  }
  function wire(page) {
    const svg = page.querySelector('#sys-canvas');
    svg.addEventListener('contextmenu', e => e.preventDefault());
    svg.addEventListener('pointerdown', e => {
      if (e.button > 2) return;
      const p = toWorld(svg, e), t = e.target, s = cur();
      const base = { x: e.clientX, y: e.clientY, p, t, moved: false, button: e.button };
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* not an active pointer */ }
      if (e.button !== 0) { drag = Object.assign(base, { kind: 'pan', cam: Object.assign({}, S.cam), k: p.k }); return; }
      const endEl = !S.pending && t.closest('[data-cend]'), run = !S.pending && t.closest('[data-run]'), bl = t.closest('[data-block]'), cb = t.closest('[data-cable]');
      if (endEl) {
        const [cid, node] = endEl.dataset.cend.split('|');
        drag = Object.assign(base, { kind: 'end', cab: cid, node, from: endEl.dataset.from ? JSON.parse(endEl.dataset.from) : null, anchor: { x: +endEl.dataset.x, y: +endEl.dataset.y } });
      } else if (run) {
        const [cid, key, k] = run.dataset.run.split('|'), r = lastLo.get(cid).routes.find(x => x.key === key);
        const R = RT().runs(r.A, r.B, r.v).find(x => x.k === +k);
        drag = Object.assign(base, { kind: 'run', cab: cable(s, cid), r, k: +k, axis: R && R.axis, v0: r.v.slice() });
      } else if (bl && !S.pending) {
        const b = block(s, bl.dataset.block);
        drag = Object.assign(base, { kind: 'block', bx: b.x, by: b.y, b });
      } else if (cb && !S.pending && S.sel && S.sel.kind === 'cable' && S.sel.id === cb.dataset.cable) {
        // A drag on a selected cable's line moves the run under it, as in the editor.
        const near = runNear(cb.dataset.cable, p);
        drag = near && near.n.k >= 0 ? Object.assign(base, { kind: 'run', cab: cable(s, cb.dataset.cable), r: near.r, k: near.n.k, axis: near.n.axis, v0: near.r.v.slice() }) : Object.assign(base, { kind: 'click' });
      } else drag = Object.assign(base, { kind: bl || cb ? 'click' : 'pan', cam: Object.assign({}, S.cam), k: p.k });
    });
    svg.addEventListener('pointermove', e => {
      const d = drag;
      if (!d) { if (S.pending) ghostAt(svg, S.pending, e); return; }
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.moved = true;
      const p = toWorld(svg, e);
      if (d.kind === 'pan') { S.cam.x = d.cam.x - (e.clientX - d.x) * d.k; S.cam.y = d.cam.y - (e.clientY - d.y) * d.k; svg.setAttribute('viewBox', `${S.cam.x} ${S.cam.y} ${S.cam.w} ${S.cam.h}`); return; }
      if (d.kind === 'click') return;
      if (d.kind === 'end') {
        svg.classList.add('dragging-end');
        if (!d.ghostFrom) d.ghostFrom = true;
        // The end's line follows the pointer from where it's held (its other end), snapping to connectors.
        const t = tabAt(e), gh = svg.querySelector('#sys-ghost');
        svg.querySelectorAll('.sys-tab.land').forEach(x => x.classList.remove('land'));
        let q = p, snapped = false;
        if (t) { const b = block(cur(), t.dataset.block), g = tabGeom(b, conn(b, t.dataset.conn)); q = { x: g.tx, y: g.cy }; snapped = true; t.classList.add('land'); }
        const a = d.anchor, s2 = q.x >= a.x ? 1 : -1, dx = Math.max(40, Math.abs(q.x - a.x) * 0.5);
        const path = `M${a.x} ${a.y}C${a.x + s2 * dx} ${a.y} ${q.x - s2 * dx} ${q.y} ${q.x} ${q.y}`;
        if (gh) gh.innerHTML = `<g class="ghost-w${snapped ? ' snapped' : ''}" style="color:var(--accent)"><path class="ghost-glow" d="${path}"/><path class="ghost-edge" d="${path}"/><path class="ghost-base" d="${path}"/><path class="ghost-flow" d="${path}"/><circle class="ghost-end" cx="${q.x}" cy="${q.y}" r="${snapped ? 6 : 4.5}"/></g>`;
        return;
      }
      if (d.kind === 'run') {
        if (!d.snap) { S.past.push(JSON.stringify(cur())); S.future = []; d.snap = true; }
        const v = d.v0.slice();
        v[d.k] = snapU(d.axis === 'v' ? p.x : p.y);
        keepRoute(d.cab, d.r.key, v);
        redraw(svg);
        return;
      }
      if (d.kind === 'block') {
        if (!d.snap) { S.past.push(JSON.stringify(cur())); S.future = []; d.snap = true; svg.classList.add('dragging'); }
        d.b.x = snap(d.bx + (p.x - d.p.x) / K); d.b.y = snap(d.by + (p.y - d.p.y) / K);
        redraw(svg);
      }
    });
    const up = e => {
      const d = drag;
      drag = null;
      svg.classList.remove('dragging', 'dragging-end');
      if (!d) return;
      if (d.kind === 'end' && d.moved) {
        const t = e && e.type === 'pointerup' ? tabAt(e) : null, to = t ? tabRef(t) : null;
        const gh = svg.querySelector('#sys-ghost');
        if (gh) gh.innerHTML = '';
        if (sameTab(to, d.from)) { A.refresh(); return; }
        change(s => { const cab = cable(s, d.cab); cab.ends[d.node] = to; if (to) conn(block(s, to.block), to.conn).used = true; if (cab.routes) delete cab.routes[d.node]; S.sel = { kind: 'cable', id: cab.id }; });
        return;
      }
      if (d.kind === 'run' && d.moved) { const v = d.cab.routes[d.r.key]; keepRoute(d.cab, d.r.key, RT().tidy(d.r.A, d.r.B, v)); cur().updated = now(); persist(); A.refresh(); return; }
      if (d.kind === 'block' && d.moved) { cur().updated = now(); persist(); A.refresh(); return; }
      if (d.moved || d.button !== 0) return;
      // A click: as the editor's click().
      const t = d.t, tab = t.closest('[data-conn]');
      if (tab) { clickTab(tabRef(tab)); return; }
      if (S.pending) { cancelWire(); return; }
      const cb = t.closest('[data-cable]'), bl = t.closest('[data-block]');
      S.pair = null; S.picking = null;
      if (cb) S.sel = { kind: 'cable', id: cb.dataset.cable };
      else if (bl) S.sel = { kind: 'block', block: bl.dataset.block };
      else S.sel = null;
      A.refresh();
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('dblclick', e => {
      const cb = e.target.closest('[data-cable]');
      if (!cb || S.pending) return;
      const p = toWorld(svg, e), near = runNear(cb.dataset.cable, p);
      if (!near) return;
      const r = near.n.axis === 'h' ? { x: snapU(p.x), y: near.n.at.y } : { x: near.n.at.x, y: snapU(p.y) };
      const got = RT().addBend(near.r.A, near.r.B, near.r.v, near.n.j, r);
      if (!got) return;
      change(s => { keepRoute(cable(s, cb.dataset.cable), near.r.key, got.v); S.sel = { kind: 'cable', id: cb.dataset.cable }; });
    });
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const p = toWorld(svg, e), m = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      S.cam = { x: p.x - (p.x - S.cam.x) * m, y: p.y - (p.y - S.cam.y) * m, w: S.cam.w * m, h: S.cam.h * m };
      svg.setAttribute('viewBox', `${S.cam.x} ${S.cam.y} ${S.cam.w} ${S.cam.h}`);
    }, { passive: false });
    if (page.sysWired) return;
    page.sysWired = true;
    page.addEventListener('click', e => {
      const t = e.target;
      const a = t.closest('[data-sact]');
      if (a && !a.disabled) { act(a.dataset.sact, a); return; }
      const sl = t.closest('[data-ssel]');
      if (sl) { const [k, x, y] = sl.dataset.ssel.split(':'); S.sel = k === 'cable' ? { kind: 'cable', id: x } : { kind: 'conn', block: x, conn: y }; S.picking = null; A.refresh(); return; }
      const ck = t.closest('[data-scheck]');
      if (ck) { const c = checks(cur(), A.harness)[+ck.dataset.scheck]; if (c && c.sel) { S.sel = c.sel; A.refresh(); } }
    });
    page.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.sfit) { const id = t.dataset.sfit, on = t.checked; change(s => { s.blocks.forEach(b => b.conns.forEach(c => { if (c.id === id) { c.fitted = on; if (!on) c.used = false; } })); }); return; }
      if (t.dataset.sexit) { const id = t.dataset.sexit, v = t.value; change(s => { s.blocks.forEach(b => b.conns.forEach(c => { if (c.id === id) { if (v) c.exit = v; else delete c.exit; } })); s.cables.forEach(cab => { delete cab.routes; }); }); return; }
      if (t.dataset.spin) { const [id, i] = t.dataset.spin.split('|'), v = t.value.trim(); change(s => { s.blocks.forEach(b => b.conns.forEach(c => { if (c.id === id && c.pins[+i]) { c.pins[+i].net = v; c.pins[+i].label = v; } })); }); return; }
      if (t.dataset.sused) { const id = t.dataset.sused, on = t.checked; change(s => { s.blocks.forEach(b => b.conns.forEach(c => { if (c.id === id) c.used = on; })); }); return; }
      if (t.dataset.send) { const [bid, cid] = t.value ? t.value.split('|') : []; const node = t.dataset.send; change(s => { const cab = cable(s, S.sel.id); cab.ends[node] = bid ? { block: bid, conn: cid } : null; }); return; }
      if (t.dataset.sf) setField(t.dataset.sf, t.value);
    });
  }
  function setField(f, v) {
    change(s => {
      const b = S.sel && S.sel.block && block(s, S.sel.block), c = b && S.sel.conn && conn(b, S.sel.conn);
      if (f === 'title') s.title = v.trim() || 'Untitled system';
      else if (f === 'project') s.project = v.trim();
      else if (f === 'rev') s.rev = v.trim();
      else if (f === 'b.ref' && b) b.ref = v.trim() || b.ref;
      else if (f === 'b.name' && b) b.name = v.trim() || b.name;
      else if (f === 'b.w' && b && +v >= 5) b.w = +v;
      else if (f === 'b.h' && b && +v >= 5) b.h = +v;
      else if (f === 'c.fn' && c) c.fn = v.trim();
      else if (f === 'c.ref' && c) c.ref = v.trim() || c.ref;
      else if ((f === 'c.x' || f === 'c.y') && c && v !== '' && isFinite(+v)) { const k = f.slice(2), lim = k === 'x' ? b.w - TAB.w / 2 : b.h - TAB.h / 2; c[k] = Math.max(-TAB.w / 2, Math.min(lim, +v)); }
      else if (f === 'c.pins' && c && +v >= 1) { const n = Math.min(200, Math.round(+v)); c.pins = Array.from({ length: n }, (_, i) => c.pins[i] || { pin: String(i + 1), net: '', label: '' }); }
      else if (f === 'cab.len') { const cab = cable(s, S.sel.id); cab.lengthMm = +v > 0 ? Math.round(+v) : null; }
    });
  }
  // A clear spot for a new block: right of everything.
  function freeSpot(s) { return s.blocks.length ? { x: Math.max(...s.blocks.map(b => b.x + b.w)) + 40, y: Math.min(...s.blocks.map(b => b.y)) } : { x: 0, y: 0 }; }
  async function act(a, el) {
    const s = cur();
    switch (a) {
      case 'undo': swap(S.past, S.future); break;
      case 'redo': swap(S.future, S.past); break;
      case 'fit': S.cam = bounds(s); A.refresh(); break;
      case 'add-drawn': case 'add-device': { const b = change(x => addDrawn(x, a === 'add-device' ? 'device' : 'board', freeSpot(x))); S.sel = { kind: 'block', block: b.id }; S.cam = null; A.refresh(); break; }
      case 'add-board':
        S.adding = true; S.boardsErr = ''; A.refresh();
        if (!S.boards) {
          try { S.boards = await LM.boards.listBoards(); }
          catch (e) { S.boardsErr = e.code === 'signin' ? 'Sign in to GitHub in Settings to read Signoff EE’s boards.' : e.message; }
          A.refresh();
        }
        break;
      case 'cancel-add': S.adding = null; A.refresh(); break;
      case 'refresh-board': {
        const b0 = block(s, S.sel.block);
        if (!b0 || !b0.source) break;
        S.busy = 'Reading ' + b0.source.name + '…'; A.refresh();
        try {
          LM.boards.reset();
          const bd = (await LM.boards.listBoards()).find(x => x.id === b0.source.id);
          if (!bd) throw new Error(`${b0.source.name} isn't in Signoff EE any more, or this sign-in can't read it.`);
          const pkg = await LM.boards.loadBoard(bd);
          const fresh = addBoard(blank(''), bd, pkg, { x: 0, y: 0 });
          let added = 0;
          change(x => {
            const b = block(x, b0.id);
            b.w = fresh.w; b.h = fresh.h; b.name = b.name || fresh.name; b.source = fresh.source;
            fresh.conns.forEach(f => {
              const c = b.conns.find(k => k.ref.toUpperCase() === f.ref.toUpperCase());
              if (!c) { b.conns.push(f); added++; return; }
              Object.assign(c, { pins: f.pins, x: f.x, y: f.y, side: f.side, placed: f.placed, mpn: f.mpn, mfr: f.mfr, desc: f.desc });
            });
            x.cables.forEach(cab => { delete cab.routes; });
          });
          A.toast(`${b0.ref} refreshed from ${pkg.source ? pkg.source.label : 'its package'}${added ? `, with ${added} new connector${added > 1 ? 's' : ''}` : ''}.`);
        } catch (e) { A.toast(e.code === 'signin' ? 'Sign in to GitHub in Settings to read Signoff EE’s boards.' : e.message, 'error'); }
        S.busy = ''; A.refresh();
        break;
      }
      case 'pick-board': {
        const bd = S.boards.find(b => b.id === el.dataset.board);
        S.busy = `Reading ${bd.name}’s package…`; A.refresh();
        try {
          const pkg = await LM.boards.loadBoard(bd);
          const b = change(x => { if (!x.project && bd.client) x.project = bd.client; return addBoard(x, bd, pkg, freeSpot(x)); });
          S.adding = null; S.sel = { kind: 'block', block: b.id }; S.cam = null;
          A.toast(`Added ${b.ref}: ${bd.name}, ${b.conns.length} connectors${pkg.pnp ? '' : ' (no pick-and-place in its package, so they wait along the bottom edge)'}. Tick the ones it uses.`);
        } catch (e) { A.toast(e.message, 'error'); }
        S.busy = ''; A.refresh();
        break;
      }
      case 'add-conn': { const c = change(x => mkConn(block(x, S.sel.block))); S.sel = { kind: 'conn', block: S.sel.block, conn: c.id }; A.refresh(); break; }
      case 'dup-block': {
        const b2 = change(x => { const b = block(x, S.sel.block), c = JSON.parse(JSON.stringify(b)); c.id = U.uid('b'); c.ref = nextRef(x.blocks, b.kind === 'device' ? 'D' : 'A'); c.x = b.x + 20; c.y = b.y + b.h + 20; c.conns.forEach(k => { k.id = U.uid('c'); }); x.blocks.push(c); return c; });
        S.sel = { kind: 'block', block: b2.id }; A.refresh(); break;
      }
      case 'delete-block': change(x => { const id = S.sel.block; x.blocks = x.blocks.filter(b => b.id !== id); x.cables.forEach(c => Object.keys(c.ends).forEach(k => { if (c.ends[k] && c.ends[k].block === id) c.ends[k] = null; })); S.sel = null; }); break;
      case 'delete-conn': change(x => { const b = block(x, S.sel.block), id = S.sel.conn; b.conns = b.conns.filter(c => c.id !== id); x.cables.forEach(c => Object.keys(c.ends).forEach(k => { if (c.ends[k] && c.ends[k].conn === id) c.ends[k] = null; })); S.sel = { kind: 'block', block: b.id }; }); break;
      case 'reset-route': change(x => { delete cable(x, S.sel.id).routes; }); break;
      case 'delete-cable': change(x => { const id = S.sel.id; x.cables = x.cables.filter(c => c.id !== id); S.sel = null; }); break;
      case 'pick-harness': S.picking = { block: S.sel.block, conn: S.sel.conn }; A.refresh(); break;
      case 'cancel-pick': S.picking = null; A.refresh(); break;
      case 'plug': {
        const h = A.harness(el.dataset.harness), b = block(s, S.sel.block), c = conn(b, S.sel.conn);
        const n = bestEnd(s, null, h, b, c);
        if (!n) break;
        const id = change(x => { const cab = { id: U.uid('k'), harness: h.id, ends: {}, lengthMm: null }; harnessEnds(h).forEach(e => { cab.ends[e.id] = null; }); cab.ends[n.id] = { block: b.id, conn: c.id }; const k = conn(block(x, b.id), c.id); k.used = true; x.cables.push(cab); return cab.id; });
        S.picking = null; S.sel = { kind: 'cable', id }; A.refresh();
        A.toast(`${h.title}'s end ${n.ref} plugs into ${b.ref} ${c.ref}. Pick where its other ends go.`);
        break;
      }
      case 'new-harness': {
        const b = block(s, S.sel.block), c = conn(b, S.sel.conn);
        const pb = S.pair && block(s, S.pair.block), pc = pb && conn(pb, S.pair.conn);
        const two = pc && pc !== c ? [{ b: pb, c: pc }, { b, c }] : [{ b, c }];
        const made = A.newHarness(s, two);
        change(x => {
          const cab = { id: U.uid('k'), harness: made.h.id, ends: {}, lengthMm: null };
          made.ends.forEach((nodeId, i) => { if (two[i]) { cab.ends[nodeId] = { block: two[i].b.id, conn: two[i].c.id }; conn(block(x, two[i].b.id), two[i].c.id).used = true; } else cab.ends[nodeId] = null; });
          x.cables.push(cab);
          S.sel = { kind: 'cable', id: cab.id };
        });
        S.pair = null;
        A.toast(two.length > 1 ? `Made ${made.h.title} between ${two[0].b.ref} ${two[0].c.ref} and ${b.ref} ${c.ref}${made.suggested ? `, with ${made.suggested} wires from shared nets` : ''}.` : `Made ${made.h.title}, a placeholder plugged into ${b.ref} ${c.ref}. Open it to wire the far end.`);
        break;
      }
      case 'open-harness': { const cab = cable(s, S.sel.id); A.openHarness(cab.harness); break; }
      case 'open-ee': { const b = block(s, S.sel.block); location.href = `../ee_design_review/index.html?project=${encodeURIComponent(b.source.id)}${DEMO ? '&demo' : ''}`; break; }
      case 'delete-system':
        if (!confirm(`Delete ${s.title}? Its harnesses stay.`)) break;
        s.deleted = true; s.updated = now(); S.cur = null; persist(); A.home(); break;
    }
  }
  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? swap(S.future, S.past) : swap(S.past, S.future); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); swap(S.future, S.past); return; }
    if (e.key === 'Escape') { if (S.pending) { S.pending = null; A.refresh(); return; } S.sel = null; S.pair = null; S.picking = null; S.adding = null; A.refresh(); return; }
    if (e.key.toLowerCase() === 'f' && !mod) { S.cam = bounds(cur()); A.refresh(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) {
      e.preventDefault();
      act(S.sel.kind === 'block' ? 'delete-block' : S.sel.kind === 'cable' ? 'delete-cable' : (block(cur(), S.sel.block) || {}).source ? '' : 'delete-conn');
    }
  }
  // Where a harness end plugs in, across every system (the harness editor's rail shows it).
  function plugsOf(hid, nodeId) {
    const out = [];
    live().forEach(s => s.cables.forEach(c => { if (c.harness !== hid) return; const e = c.ends[nodeId]; const where = endName(s, e); if (where) { const b = block(s, e.block); out.push({ system: s, text: `${b.name} ${conn(b, e.conn).ref} in ${s.title}` }); } }));
    return out;
  }

  // ── The demo: the Smart Thermostat's two boards and its wall wiring ──
  const DEMO_V = 4;
  async function demo(stay) {
    const s = blank('Smart Thermostat');
    s.id = 'sdemo1'; s.title = 'Smart Thermostat system'; s.demoVersion = DEMO_V;
    S.store[s.id] = s;
    try {
      const bs = await LM.boards.listBoards();
      for (const bd of bs) { const pkg = await LM.boards.loadBoard(bd); addBoard(s, bd, pkg, freeSpot(s)); }
    } catch (e) { A.toast("Couldn't read the demo boards: " + e.message, 'error'); }
    const wall = addDrawn(s, 'device', { x: -70, y: 10 });
    wall.name = 'Wall wiring (24 VAC, heat, cool)'; wall.conns[0].ref = 'TB'; wall.conns[0].fn = 'Wall wires';
    const main = s.blocks.find(b => b.source && b.source.id === 'pdemo7'), j1 = main && main.conns.find(c => c.ref === 'J1');
    if (j1) { j1.used = true; j1.fn = '24 VAC in'; }
    if (stay) persist(); else open(s.id);
    return s;
  }

  function init(hooks) {
    A = hooks;
    const c = load();
    if (DEMO && (!S.store.sdemo1 || S.store.sdemo1.demoVersion !== DEMO_V)) setTimeout(() => demo(true).then(() => A.refresh()), 0);
    return c;
  }
  LM.system = { fitted, init, render, leave, open, create, demo, onKey, live, get: id => S.store[id], current: () => S.cur, close: () => { S.cur = null; persist(); },
    store: () => S.store, persist, act, select: t => { S.sel = t; S.pair = null; S.picking = null; A.refresh(); }, pair: t => { S.pair = t; }, checks, summarize, status, plugsOf, normalize, blank, addBoard, addDrawn, bestEnd, pnOf, TAB };
})(window.LM = window.LM || {});
