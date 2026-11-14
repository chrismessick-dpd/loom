// Loom systems (docs/system.md): a second kind of document that places boards and devices, marks which
// of their connectors are used and for what, and joins them with cables. A cable is a Connection
// (connect.js), routed exactly as a harness's wires are: one use of a Loom harness (each of the harness's
// ends plugs into one connector on one block, or is not plugged yet), a purchased cable, or a generic
// connection, each with ends that plug into connectors.
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
  // root: the system opened from the menu (Overview draws it); cur: the one drawn now, which Detail may
  // set to a system it places. tab: overview, detail, or wires. focus: what the menu picked inside root's
  // tree, { kind: 'system' | 'harness', id, path } (path: system ids from root, joined by '>'; for a
  // harness, the system holding it). hist: each system's undo and camera while another is drawn.
  const S = { store: {}, cur: null, root: null, tab: 'overview', focus: null, hist: {}, sel: null, past: [], future: [], cam: null, boards: null, boardsErr: '', busy: '', adding: null, picking: null };
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
    s.blocks.forEach(b => {
      if (b.kind === 'system') { b.tabs = b.tabs && typeof b.tabs === 'object' ? b.tabs : {}; setConns(b, []); return; }
      b.conns = Array.isArray(b.conns) ? b.conns : []; b.conns.forEach(c => { c.pins = Array.isArray(c.pins) ? c.pins : []; });
    });
    s.cables.forEach(c => {
      c.ends = c.ends && typeof c.ends === 'object' ? c.ends : {};
      if (!KINDS[c.kind]) c.kind = c.harness ? 'harness' : 'link';
      if (c.kind !== 'harness') TWO.forEach(e => { if (!(e.id in c.ends)) c.ends[e.id] = null; });
      // A route kept as a bare v (before cables kept the harness's record) becomes { v }.
      if (c.routes && typeof c.routes === 'object') Object.keys(c.routes).forEach(k => { const r = LM.connect.record(c.routes[k]); if (r) c.routes[k] = r; else delete c.routes[k]; });
    });
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

  // ── Systems of systems (Chris, 2026-11-12) ──
  // A connector marked external (c.external, Make external in its panel) shows on the block of every
  // system that places this one. A system block (kind 'system', b.system: the placed system's id) is a
  // link, not a copy: edits to the placed system show in every parent, and one system may be placed more
  // than once. A system block's connectors aren't stored: they're the placed system's external connectors,
  // made fresh (resolveAll) and kept off the stored file (b.conns is not enumerable), each under a path id
  // (the inner block's id / its connector's id, one more step per level), so a cable in the parent plugs
  // into one and stays plugged while the child is edited. What the parent sets on a tab (its spot, exit,
  // Function, or Make external again, to pass it up a level) is kept in b.tabs by that id (keepTabs).
  const DEPTH = 12;
  const setConns = (b, list) => Object.defineProperty(b, 'conns', { value: list, enumerable: false, writable: true, configurable: true });
  const childOf = b => (b && b.kind === 'system' && S.store[b.system] && !S.store[b.system].deleted ? S.store[b.system] : null);
  // Does system s place target, at any depth?
  function places(s, target, depth) {
    if (!s || (depth || 0) > DEPTH) return false;
    return s.blocks.some(b => b.kind === 'system' && (b.system === target || places(S.store[b.system], target, (depth || 0) + 1)));
  }
  const parentsOf = id => live().filter(s => s.id !== id && s.blocks.some(b => b.kind === 'system' && b.system === id));
  // Is the external connector at path id in s plugged from outside, at any depth? A parent plugs into its
  // tab, or makes that tab external again and a system above plugs it (Chris, 2026-11-13: a board's power
  // input passed up through two levels warned that nothing plugged it).
  const pluggedAbove = (s, id, depth) => depth <= DEPTH && parentsOf(s.id).some(p => p.blocks.some(pb => pb.kind === 'system' && pb.system === s.id &&
    (pluggedAt(p, pb.id, id).length > 0 || (!!pb.tabs && !!pb.tabs[id] && !!pb.tabs[id].external && pluggedAbove(p, pb.id + '/' + id, depth + 1)))));
  // A tab on a system block stands for a connector inside it: harness ends made from it, and the checks,
  // look through to that board's connector (c.leaf).
  const look = (b, c) => (c && c.leaf ? { b: { id: b.id, name: c.leaf.name, ref: c.leaf.block, source: c.leaf.source }, c: Object.assign({}, c, { ref: c.leaf.ref }) } : { b, c });
  // A tab is as wide as its label needs (a system block's tabs say which block's connector they are).
  const tabW = ref => Math.max(TAB.w, (String(ref).length * 5.6 + 8) / 4);
  const tw = c => c.tw || TAB.w;
  function extentOf(s) {
    if (!s || !s.blocks.length) return null;
    const x0 = Math.min(...s.blocks.map(b => b.x)), y0 = Math.min(...s.blocks.map(b => b.y));
    return { x: x0, y: y0, w: Math.max(1, Math.max(...s.blocks.map(b => b.x + sizeOf(b).W)) - x0), h: Math.max(1, Math.max(...s.blocks.map(b => b.y + sizeOf(b).H)) - y0) };
  }
  // A system's external connectors, as its block in a parent shows them: where each sits in the system
  // and which side it leaves from, so the block keeps their arrangement.
  function externals(s, trail) {
    trail = trail || [];
    if (!s || s.deleted || trail.includes(s.id) || trail.length > DEPTH) return [];
    const t = trail.concat(s.id), out = [];
    s.blocks.forEach(b => {
      if (b.kind === 'system') resolveBlock(b, t);
      (b.conns || []).forEach(c => {
        if (!c.external || !fitted(c)) return;
        const at = tabSpot(b, c);
        out.push({ id: b.id + '/' + c.id, bid: b.id, cid: c.id, ref: `${b.ref} ${c.ref}`, pins: c.pins.map(p => Object.assign({}, p)), fn: c.fn || '', mpn: c.mpn || '', mfr: c.mfr || '', desc: c.desc || '',
          leaf: c.leaf || { source: b.source || null, name: b.name, block: b.ref, ref: c.ref },
          inside: `${s.title} › ${c.inside || b.ref + ' ' + c.ref}`, side: exitSide(b, c), cx: b.x + at.x + tw(c) / 2, cy: b.y + at.y + TAB.h / 2 });
      });
    });
    return out;
  }
  // A system block's tabs: each external connector on the side it leaves its system from, as far along
  // as it sits there, spread so none overlap; the block grows to hold them. A tab the parent placed by hand
  // stays there.
  function resolveBlock(b, trail) {
    const ch = childOf(b), ext = ch ? externals(ch, trail) : [], bd = extentOf(ch) || { x: 0, y: 0, w: 1, h: 1 };
    if (ch) b.name = ch.title;
    b.tabs = b.tabs && typeof b.tabs === 'object' ? b.tabs : {};
    if (!(b.w >= 5)) b.w = 100;
    if (!(b.h >= 5)) b.h = Math.round(Math.max(40, Math.min(160, 100 * bd.h / bd.w)));
    // The mini view (Chris, 2026-11-13): the placed system's whole drawing, its boards and its harnesses,
    // shrunk to fit inside the block, and each tab where its connector sits in it (exiting the way it exits
    // there). The block keeps its size, and the spots aren't stored (b.mini and c.exit0 aren't enumerable).
    if (ch) fitMini(b, ch);
    const mf = ch ? miniFrame(b, ch) : null;
    Object.defineProperty(b, 'mini', { value: mf, enumerable: false, writable: true, configurable: true });
    if (mf) {
      setConns(b, ext.map(e => {
        const t = b.tabs[e.id] || {}, w = tabW(e.ref), x = +(mf.ox + (e.cx - mf.E.x) * mf.f - w / 2).toFixed(2), y = +(mf.oy + (e.cy - mf.E.y) * mf.f - TAB.h / 2).toFixed(2);
        const c = { id: e.id, ref: e.ref, pins: e.pins, fn: t.fn != null ? t.fn : e.fn, fn0: e.fn, used: true, fitted: true, placed: 'link', link: true,
          x, y, ax: x, ay: y, exit: t.exit || undefined, external: !!t.external, side: 'top', mpn: e.mpn, mfr: e.mfr, desc: e.desc, tw: w, leaf: e.leaf, inside: e.inside };
        if (!c.exit) delete c.exit;
        Object.defineProperty(c, 'exit0', { value: e.side, enumerable: false, writable: true, configurable: true });
        return c;
      }));
      return;
    }
    const sides = { left: [], right: [], top: [], bottom: [] };
    ext.forEach(e => sides[e.side].push(e));
    const gapV = TAB.h + 2, hd = Math.min(46, b.h * K / 2) / K + 1;
    // The block grows to hold the tabs it places itself (not ones the parent placed by hand).
    const auto = list => list.filter(e => !(b.tabs[e.id] && b.tabs[e.id].x != null));
    const across = list => auto(list).reduce((n, e) => n + tabW(e.ref) + 2, 2);
    b.h = Math.max(b.h, Math.ceil(Math.max(auto(sides.left).length, auto(sides.right).length) * gapV + hd + 2));
    b.w = Math.max(b.w, Math.ceil(Math.max(across(sides.top), across(sides.bottom))));
    const spot = {};
    Object.keys(sides).forEach(side => {
      const list = sides[side], vert = side === 'left' || side === 'right';
      if (!list.length) return;
      const u = e => Math.max(0, Math.min(1, vert ? (e.cy - bd.y) / bd.h : (e.cx - bd.x) / bd.w));
      list.sort((p, q) => u(p) - u(q));
      const size = e => (vert ? gapV : tabW(e.ref) + 2), lo = vert ? hd : 2, hi = vert ? b.h - TAB.h - 1 : b.w - 2;
      const pos = list.map(e => lo + u(e) * Math.max(0, hi - lo - (vert ? 0 : tabW(e.ref))));
      for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + size(list[i - 1]));
      const n = pos.length - 1;
      pos[n] = Math.min(pos[n], hi - (vert ? 0 : tabW(list[n].ref)));
      for (let i = n - 1; i >= 0; i--) pos[i] = Math.min(pos[i], pos[i + 1] - size(list[i]));
      list.forEach((e, i) => {
        const w = tabW(e.ref), p = +pos[i].toFixed(2);
        spot[e.id] = side === 'left' ? { x: -w, y: p } : side === 'right' ? { x: b.w, y: p } : side === 'top' ? { x: p, y: -TAB.h } : { x: p, y: b.h };
      });
    });
    setConns(b, ext.map(e => {
      const t = b.tabs[e.id] || {}, a = spot[e.id];
      return { id: e.id, ref: e.ref, pins: e.pins, fn: t.fn != null ? t.fn : e.fn, fn0: e.fn, used: true, fitted: true, placed: 'link', link: true,
        x: t.x != null ? t.x : a.x, y: t.y != null ? t.y : a.y, ax: a.x, ay: a.y, exit: t.exit || undefined, external: !!t.external, side: 'top',
        mpn: e.mpn, mfr: e.mfr, desc: e.desc, tw: tabW(e.ref), leaf: e.leaf, inside: e.inside };
    }).map(c => { if (!c.exit) delete c.exit; return c; }));
  }
  function resolveAll() { Object.values(S.store).forEach(s => s.blocks.forEach(b => { if (b.kind === 'system') resolveBlock(b, [s.id]); })); }
  // After a change, what the parent set on its system blocks' tabs goes back into b.tabs.
  function keepTabs(s) {
    s.blocks.forEach(b => {
      if (b.kind !== 'system' || !b.conns) return;
      const t = b.tabs || {};
      b.conns.forEach(c => {
        const o = {}, was = t[c.id] || {};
        // A mini view places the tabs itself; a spot the parent set by hand before stays stored as it was.
        if (b.mini) { if (was.x != null) { o.x = was.x; o.y = was.y; } }
        else if (Math.abs(c.x - c.ax) > 1e-6 || Math.abs(c.y - c.ay) > 1e-6) { o.x = c.x; o.y = c.y; }
        if (c.exit) o.exit = c.exit;
        if (c.external) o.external = true;
        if (c.fn !== c.fn0) o.fn = c.fn;
        if (Object.keys(o).length) t[c.id] = o; else delete t[c.id];
      });
      b.tabs = t;
    });
  }
  function addSystem(s, child, at) {
    const b = { id: U.uid('b'), ref: nextRef(s.blocks, 'S'), kind: 'system', system: child.id, name: child.title, source: null, x: at ? at.x : 0, y: at ? at.y : 0, w: 0, h: 0, tabs: {} };
    s.blocks.push(b);
    resolveBlock(b, [s.id]);
    return b;
  }
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
    // The board's real edge from its package's outline Gerber (Chris, 2026-11-13), in the block's own frame.
    if (pkg.shape && pkg.shape.pts) {
      const q = pkg.shape.pts, pts = [];
      for (let i = 0; i + 1 < q.length; i += 2) pts.push(+(q[i] - o.x0).toFixed(3), +(o.y1 - q[i + 1]).toFixed(3));
      b.shape = { pts, file: pkg.shape.file || '' };
    }
    s.blocks.push(b);
    return b;
  }
  // A board drawn as its outline: its edge as a path in the block's own frame (mm), and the turn that puts
  // that frame on the canvas (as tabSpot turns a connector): translate(X, Y) scale(K) matrix(...).
  const median = a => { const v = a.slice().sort((x, y) => x - y), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const shaped = b => b.kind === 'board' && b.shape && Array.isArray(b.shape.pts) && b.shape.pts.length >= 6;
  function shapeD(b) {
    const q = b.shape.pts;
    let d = '';
    for (let i = 0; i + 1 < q.length; i += 2) d += (i ? 'L' : 'M') + (+q[i]).toFixed(2) + ' ' + (+q[i + 1]).toFixed(2);
    return d + 'Z';
  }
  function shapeXf(b) {
    const r = rotOf(b), m = r === 90 ? [0, 1, -1, 0, b.h, 0] : r === 180 ? [-1, 0, 0, -1, b.w, b.h] : r === 270 ? [0, -1, 1, 0, 0, b.w] : [1, 0, 0, 1, 0, 0];
    return `translate(${b.x * K} ${b.y * K}) scale(${K}) matrix(${m.join(' ')})`;
  }
  // Fabcheck's picture of the board's top (boards.js picture), read once and drawn inside its edge: the
  // picture is the outline's extent 8% larger, centered (Fabcheck's fit). Not stored with the system; with
  // no sign-in, or no picture stored, the board is drawn plain.
  const pics = new Map();
  function picOf(b) {
    const id = b.source && b.source.id;
    if (!id || !LM.boards) return null;
    if (!pics.has(id)) {
      pics.set(id, 'loading');
      LM.boards.picture(id).then(r => { pics.set(id, r || null); if (r && A && A.refresh) A.refresh(); }, () => pics.set(id, null));
    }
    const r = pics.get(id);
    return r && r !== 'loading' ? r : null;
  }
  function shapeSvg(b, pic, cls) {
    const id = 'sysclip-' + b.id, d = shapeD(b);
    let o = `<g class="${cls}" transform="${shapeXf(b)}"><clipPath id="${id}"><path d="${d}"/></clipPath><path class="sys-board" d="${d}"/>`;
    // The picture is the latest Send's, which may be another revision than the package read: drawn only when
    // its proportions are the outline's (within 2%).
    if (pic && Math.abs(pic.w / pic.h - b.w / b.h) <= 0.02 * (b.w / b.h)) {
      const s0 = Math.min(pic.w / (1.08 * b.w), pic.h / (1.08 * b.h)), IW = pic.w / s0, IH = pic.h / s0;
      o += `<image clip-path="url(#${id})" href="${pic.url}" x="${(b.w / 2 - IW / 2).toFixed(3)}" y="${(b.h / 2 - IH / 2).toFixed(3)}" width="${IW.toFixed(3)}" height="${IH.toFixed(3)}" preserveAspectRatio="none"/>`;
    }
    return o + `<path class="sys-board-edge" d="${d}" vector-effect="non-scaling-stroke"/></g>`;
  }
  // Every cable end plugged into a connector: [{ cable, node }].
  const pluggedAt = (s, bid, cid) => s.cables.flatMap(c => Object.keys(c.ends).filter(k => { const e = c.ends[k]; return e && e.block === bid && e.conn === cid; }).map(k => ({ cable: c, node: k })));
  // A harness's ends that plug into a system's connectors. An end marked as its device (n.atDevice: the
  // motor, sensor, or flying leads the harness is built onto; Chris, 2026-11-12) ends in the harness, so a
  // system never asks for it: the cable is drawn as a stub out of each connector it plugs into.
  const harnessEnds = h => h ? h.nodes.filter(n => M.isConn(n) && !n.atDevice) : [];
  const deviceEnds = h => h ? h.nodes.filter(n => M.isConn(n) && n.atDevice) : [];
  // What a cable is (Chris, 2026-11-11: anything that joins two blocks is a Connection): one use of a Loom
  // harness ('harness': cab.harness, ends by the harness's end node ids), a purchased cable ('bought':
  // name, pn, mfr, mpn, ends a and b), or a generic connection ('link': a name, ends a and b). Drawing a
  // cable between two connectors makes a generic connection; its panel makes it one of the others.
  const KINDS = { link: 'Generic connection', bought: 'Purchased cable', harness: 'Loom harness' };
  const TWO = [{ id: 'a', ref: 'End A', name: '' }, { id: 'b', ref: 'End B', name: '' }];
  const kindOf = cab => cab.kind || (cab.harness ? 'harness' : 'link');
  const harnessOf = cab => (kindOf(cab) === 'harness' && A ? A.harness(cab.harness) : null);
  const endsOf = (cab, h) => (kindOf(cab) === 'harness' ? harnessEnds(h) : TWO);
  // The harness end that best fits a connector: one filled from this board's connector (From a board),
  // then one with as many pins, then any end not plugged yet.
  function bestEnd(s, cab, h, b0, c0) {
    const { b, c } = look(b0, c0);
    const free = harnessEnds(h).filter(n => !cab || !cab.ends[n.id]);
    const src = b.source && b.source.id;
    return free.find(n => n.board && src && n.board.project === src && n.board.ref === c.ref)
      || free.find(n => M.pinList(n).length === c.pins.length) || free[0] || null;
  }
  // ○ placeholder (no wires), ● wired with errors, ◉ wired with no errors; ◆ a purchased cable, ─ a
  // generic connection.
  function statusOf(cab, h) {
    const k = kindOf(cab);
    if (k === 'bought') return { key: 'bought', glyph: '◆', text: 'Purchased cable' };
    if (k === 'link') return { key: 'link', glyph: '─', text: 'Generic connection' };
    return status(h);
  }
  // A cable's own color (Chris, 2026-11-12): cab.color, one of Loom's wire color codes (M.COLORS) or a custom
  // #rrggbb. Set, the cable draws in it whatever its state (its glyph and dashes still show that).
  const HEX = /^#[0-9a-f]{6}$/i;
  const colorOf = cab => { const c = cab && cab.color; return !c ? '' : HEX.test(c) ? c : M.COLORS[c] ? M.COLORS[c][1] : ''; };
  const titleOf = (cab, h) => { const k = kindOf(cab); return k === 'harness' ? (h ? h.title : 'Missing harness') : cab.name || KINDS[k]; };
  function status(h) {
    if (!h) return { key: 'missing', glyph: '✕', text: 'Harness missing' };
    if (!h.wires.length) return { key: 'placeholder', glyph: '○', text: 'Placeholder, no wires yet' };
    const e = M.checks(h).filter(x => x.sev === 'error').length;
    return e ? { key: 'progress', glyph: '●', text: `In progress, ${e} error${e > 1 ? 's' : ''}` } : { key: 'wired', glyph: '◉', text: 'Wired, no errors' };
  }
  // A placed cable may override its harness's length (Chris, 2026-11-11): it's then the variant
  // <harness PN>-<length in mm>, the same harness at another length.
  const pnOf = (h, cab) => {
    if (kindOf(cab) === 'bought') return cab.pn || cab.mpn || '';
    if (kindOf(cab) === 'link') return '';
    const base = (h && h.pn) || ''; return cab.lengthMm ? (base || '(no PN)') + '-' + Math.round(cab.lengthMm) : base;
  };
  const endName = (s, e) => { const b = e && block(s, e.block), c = b && conn(b, e.conn); return b && c ? `${b.ref} ${c.ref}` : ''; };

  // own: only what the system's own file says, never the systems it places or that place it (the stored
  // summary: a first sync reads a parent before its children are here, and the summary must not change
  // with what this browser happens to hold).
  function checks(s, get, own) {
    const out = [];
    const add = (sev, text, sel) => out.push({ sev, text, sel });
    const ps = own ? [] : parentsOf(s.id);
    const linked = e => own && e && (block(s, e.block) || {}).kind === 'system';
    s.blocks.forEach(b => {
      if (b.kind !== 'system' || own) return;
      if (!childOf(b)) add('error', `${b.ref} places a system that isn't here any more.`, { kind: 'block', block: b.id });
      else if (b.system === s.id || places(childOf(b), s.id)) add('error', `${b.ref} places ${b.name}, which places this system: a loop.`, { kind: 'block', block: b.id });
    });
    s.blocks.forEach(b => (b.conns || []).forEach(c => {
      const at = pluggedAt(s, b.id, c.id), where = `${b.ref} ${c.ref}`;
      // An external connector is plugged from outside, in the systems that place this one.
      if (c.external && fitted(c)) {
        const id = b.id + '/' + c.id, outside = pluggedAbove(s, id, 0);
        if (at.length) add('warn', `${where} is external, but a cable here plugs into it too.`, { kind: 'conn', block: b.id, conn: c.id });
        else if (ps.length && !outside) add('warn', `${where} is external, but nothing plugs into it where ${s.title} is placed (${ps.map(p => p.title).join(', ')}).`, { kind: 'conn', block: b.id, conn: c.id });
        return;
      }
      if (!fitted(c) && at.length) { add('error', `${where} isn't populated, but a cable is plugged into it.`, { kind: 'conn', block: b.id, conn: c.id }); return; }
      if (!fitted(c)) return;
      if (c.used && !at.length) add('warn', `${where}${c.fn ? ' (' + c.fn + ')' : ''} is used, but nothing is plugged into it.`, { kind: 'conn', block: b.id, conn: c.id });
      if (!c.used && at.length) add('warn', `${where} has a cable but isn't marked used.`, { kind: 'conn', block: b.id, conn: c.id });
      if (at.length > 1) add('error', `${where} has ${at.length} cables plugged into it.`, { kind: 'conn', block: b.id, conn: c.id });
    }));
    // An end plugged into a connector that's gone: deleted, or no longer external in the system placed.
    const gone = (e, what) => {
      const b = block(s, e.block);
      add('error', `${what} was plugged into a connector that's gone${b ? ` from ${b.ref}${b.kind === 'system' ? ` (is it still external in ${b.name}?)` : ''}` : ''}.`, sel0);
    };
    let sel0 = null;
    s.cables.forEach(cab => {
      const sel = { kind: 'cable', id: cab.id };
      sel0 = sel;
      if (kindOf(cab) !== 'harness') {
        TWO.forEach(e => { const p = cab.ends[e.id]; if (linked(p)) return; if (!p) add('warn', `${cab.name || KINDS[kindOf(cab)]}: ${e.ref} isn't plugged in.`, sel); else if (!conn(block(s, p.block), p.conn)) gone(p, `${cab.name || KINDS[kindOf(cab)]}: ${e.ref}`); });
        return;
      }
      const h = get(cab.harness);
      if (!h) { add('error', `Cable ${cab.label || cab.id} names a harness that isn't here.`, sel); return; }
      harnessEnds(h).forEach(n => {
        const e = cab.ends[n.id], b = e && block(s, e.block), c = b && conn(b, e.conn);
        if (linked(e)) return;
        if (!c) { if (e) gone(e, `${h.title}: ${n.ref}`); else add('warn', `${h.title}: ${n.ref} isn't plugged in.`, sel); return; }
        const src = look(b, c).b.source;
        const where = `${h.title} ${n.ref} → ${b.ref} ${c.ref}`;
        const hp = M.pinList(n);
        if (hp.length !== c.pins.length) add('error', `${where}: the harness end has ${hp.length} pins, the connector ${c.pins.length}.`, sel);
        const bad = [];
        c.pins.forEach(p => { const l = (n.pinLabels || {})[p.pin] || ''; if (l && p.label && l !== p.label) bad.push(`${p.pin} ${l} ≠ ${p.label}`); });
        if (bad.length) add('warn', `${where}: pin labels don't match the board's nets (${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', …' : ''}).`, sel);
        if (n.board && src && n.board.project === src.id && n.board.source && src.label && n.board.source !== src.label)
          add('warn', `${where}: the end was filled from ${n.board.source}; ${b.kind === 'system' ? 'the board inside is' : 'this block is'} ${src.label}.`, sel);
      });
    });
    return out;
  }
  // What a reader of the stored file sees (Signoff PL, phase 4).
  // Built from the file alone (checks' own): a placed system's block lists which system it is, not how
  // many of its connectors are used, and cables into it aren't checked here (its own summary does that).
  function summarize(sys0, get) {
    const sys = normalize(JSON.parse(JSON.stringify(sys0)));
    const c = checks(sys, get, true), qty = {};
    const bought = {};
    sys.cables.forEach(cab => {
      if (kindOf(cab) === 'bought') { const k = (cab.pn || cab.mpn || cab.name || '').toLowerCase(); bought[k] = bought[k] || { name: cab.name || '', pn: cab.pn || '', mfr: cab.mfr || '', mpn: cab.mpn || '', qty: 0 }; bought[k].qty++; return; }
      if (kindOf(cab) !== 'harness') return;
      const h = get(cab.harness), k = cab.harness + '|' + (cab.lengthMm || ''); qty[k] = qty[k] || { harness: cab.harness, pn: pnOf(h, cab), name: h ? h.title : '', qty: 0 }; qty[k].qty++;
    });
    return { v: 1, tool: 'loom', kind: 'system', name: sys.title, project: sys.project || '', revision: sys.rev || '', archived: !!sys.deleted,
      blocks: sys.blocks.map(b => (b.kind === 'system' ? { ref: b.ref, name: b.name, kind: b.kind, ee: '', system: b.system } : { ref: b.ref, name: b.name, kind: b.kind, ee: b.source && b.source.id || '', used: b.conns.filter(x => x.used).length })),
      harnesses: Object.values(qty), cables: Object.values(bought), links: sys.cables.filter(c => kindOf(c) === 'link').length, errors: c.filter(x => x.sev === 'error').length, warnings: c.filter(x => x.sev === 'warn').length };
  }

  // ── Storage ──
  function load() {
    try { S.store = JSON.parse(localStorage.getItem(NS + 'systems') || '{}') || {}; } catch (e) { S.store = {}; }
    Object.keys(S.store).forEach(id => { try { normalize(S.store[id]); } catch (e) { delete S.store[id]; } });
    resolveAll();
    let c = null;
    try { c = localStorage.getItem(NS + 'currentSystem'); } catch (e) { /* storage blocked */ }
    const want = new URLSearchParams(location.search).get('system');
    S.cur = want && S.store[want] ? want : null;
    return S.cur || (c && S.store[c] && !S.store[c].deleted && !new URLSearchParams(location.search).get('project') && !new URLSearchParams(location.search).get('harness') ? c : null);
  }
  let saveTimer = null;
  function writeNow() {
    saveTimer = null;
    try { localStorage.setItem(NS + 'systems', JSON.stringify(S.store)); localStorage.setItem(NS + 'currentSystem', S.root || S.cur || ''); }
    catch (e) { A.toast("Couldn't keep this in the browser: " + e.message, 'error'); }
  }
  function persist() {
    resolveAll();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 200);
  }
  // Writes a save still waiting on its 200 ms timer, before a tool update's reload or the page closing.
  function flush() { if (saveTimer) { clearTimeout(saveTimer); writeNow(); } }
  const live = () => Object.values(S.store).filter(s => !s.deleted);
  const cur = () => S.store[S.cur] || null;

  // ── Changes and undo (its own, apart from the harness editor's) ──
  function change(fn) {
    const s = cur();
    if (!s) return null;
    S.past.push(JSON.stringify(s)); if (S.past.length > 120) S.past.shift(); S.future = [];
    const r = fn(s);
    keepTabs(s);
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
    if (t.kind === 'multi') return t.blocks.some(id => block(s, id)) || t.cables.some(id => cable(s, id));
    if (t.kind === 'wire' || t.kind === 'end') return !!A.harness(t.harness);
    return false;
  }
  // Several things selected (Chris, 2026-11-12: drag-select as in the harness): { kind: 'multi', blocks,
  // cables }. One thing alone is selected as itself.
  function selOf(blocks, cables) {
    if (blocks.length + cables.length === 0) return null;
    if (blocks.length === 1 && !cables.length) return { kind: 'block', block: blocks[0] };
    if (cables.length === 1 && !blocks.length) return { kind: 'cable', id: cables[0] };
    return { kind: 'multi', blocks, cables };
  }
  const selBlocks = t => (!t ? [] : t.kind === 'multi' ? t.blocks : t.kind === 'block' ? [t.block] : []);
  const selCables = t => (!t ? [] : t.kind === 'multi' ? t.cables : t.kind === 'cable' ? [t.id] : []);
  // Shift-click (as in the harness): a block or cable joins the selection, or leaves it if it's in.
  function toggleSel(kind, id) {
    const bs = selBlocks(S.sel).slice(), cs = selCables(S.sel).slice(), list = kind === 'block' ? bs : cs, i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    S.sel = selOf(bs, cs); S.pair = null; S.picking = null; S.adding = null;
  }

  function open(id) { S.cur = id; S.root = id; S.tab = 'overview'; S.focus = null; S.hist = {}; S.pending = null; S.pair = null; S.sel = null; S.past = []; S.future = []; S.cam = null; S.adding = null; S.picking = null; persist(); }

  // ── Overview, Detail, and Wires (Chris, 2026-11-12) ──
  // The tabs over the canvas. A pick in the menu inside the open system's tree is a focus, not a jump:
  // Overview selects it in the open system (the block placing it, which lights its cables, or a
  // harness's cables), Detail draws the system it is (a harness: the system holding it, its cables
  // selected), and Wires lists it and what it holds. Each system drawn keeps its own undo and camera.
  function show(id) {
    if (!id || !S.store[id] || id === S.cur) return;
    if (S.cur) S.hist[S.cur] = { past: S.past, future: S.future, cam: S.cam };
    const h = S.hist[id] || { past: [], future: [], cam: null };
    S.cur = id; S.past = h.past; S.future = h.future; S.cam = h.cam;
    S.sel = null; S.pending = null; S.pair = null; S.picking = null; S.adding = null;
  }
  const pathIds = f => (f && f.path ? String(f.path).split('>') : []);
  // The system a focus is drawn in on Detail: a system itself, or the one holding a harness.
  const focusSys = f => { const ids = pathIds(f); return ids.length ? ids[ids.length - 1] : null; };
  // What Detail draws for a focus (Chris, 2026-11-13): a system picked in the menu shows in the system placing
  // it, selected, with its Open button in the panel; only Open (f.open) draws the system itself. A harness
  // shows in the system holding it (its path).
  const drawnPath = f => {
    if (!f) return S.root;
    if (f.kind === 'system' && !f.open) { const ids = pathIds(f); return ids.length > 1 ? ids.slice(0, -1).join('>') : S.root; }
    return f.path;
  };
  const drawnSys = f => focusSys({ path: drawnPath(f) });
  const harnessCables = (s, hid) => s.cables.filter(c => kindOf(c) === 'harness' && c.harness === hid).map(c => c.id);
  // What Overview selects for a focus: in root, the block placing the first system on its path, or a
  // harness's own cables there. A harness only used deeper selects the block it's inside.
  function overviewSel(s, f) {
    const ids = pathIds(f);
    if (!s || !f || ids[0] !== s.id) return null;
    if (f.kind === 'harness' && ids.length === 1) return selOf([], harnessCables(s, f.id));
    if (ids.length < 2) return null;
    const b = s.blocks.find(x => x.kind === 'system' && x.system === ids[1]);
    return b ? { kind: 'block', block: b.id } : null;
  }
  // The path of the system drawn now, from root.
  const curPath = () => (S.cur === S.root ? S.root : S.focus && drawnSys(S.focus) === S.cur ? drawnPath(S.focus) : S.root);
  // A single placed system or harness cable selected on the canvas becomes the focus when the tab changes,
  // so a pick on the diagram carries to Detail and Wires as a pick in the menu does.
  function focusFromSel() {
    const s = cur(), t = S.sel;
    // Not the selection a tab made for the focus itself (a harness inside a placed system selects its block).
    if (!s || !t || JSON.stringify(t) === S.autoSel) return;
    if (t.kind === 'block') { const b = block(s, t.block); if (b && childOf(b)) S.focus = { kind: 'system', id: b.system, path: curPath() + '>' + b.system, open: true }; }
    else if (t.kind === 'cable') { const c = cable(s, t.id); if (c && kindOf(c) === 'harness' && c.harness) S.focus = { kind: 'harness', id: c.harness, path: curPath() }; }
  }
  // Moves the camera so the selected block shows, at the same zoom, when it's out of view.
  function reveal(s, t) {
    if (!S.cam || !t || t.kind !== 'block') return;
    const b = block(s, t.block);
    if (!b) return;
    const z = sizeOf(b), cx = (b.x + z.W / 2) * K, cy = (b.y + z.H / 2) * K, c = S.cam;
    if (cx > c.x && cx < c.x + c.w && cy > c.y && cy < c.y + c.h) return;
    S.cam = Object.assign({}, c, { x: cx - c.w / 2, y: cy - c.h / 2 });
  }
  // Draws what the tab and focus ask for, and selects it. Called when either changes, never on a plain
  // redraw, so a click on the canvas afterwards is the user's own.
  function applyTab() {
    const f = S.focus;
    if (S.tab === 'overview') { show(S.root); S.sel = overviewSel(cur(), f); reveal(cur(), S.sel); }
    else if (S.tab === 'detail') {
      const id = f && S.store[drawnSys(f)] ? drawnSys(f) : S.root;
      show(id);
      const s = cur(), b = f && f.kind === 'system' && !f.open ? s.blocks.find(x => x.kind === 'system' && x.system === f.id) : null;
      S.sel = f && f.kind === 'harness' ? selOf([], harnessCables(s, f.id)) : b ? { kind: 'block', block: b.id } : null;
      if (!S.cam) S.cam = bounds(s);
      reveal(s, S.sel);
    } else if (S.tab === 'list') { show(listSys(f)); S.sel = null; }
    S.autoSel = JSON.stringify(S.sel);
  }
  function setTab(tab) {
    if (!['overview', 'detail', 'list'].includes(tab) || !S.root) return;
    if (tab !== S.tab) focusFromSel();
    S.tab = tab; applyTab(); persist(); A.refresh();
  }
  // A pick in the menu (app.js, a row under the open system): kind system or harness, its id, and its
  // path (a harness's: the system holding it). The open system itself clears the focus. Off the List tab, the
  // pick shows where it's placed: Overview when that's the open system, else Detail (Chris, 2026-11-13).
  function setFocus(kind, id, path) {
    if (!S.root || pathIds({ path })[0] !== S.root) return;
    S.focus = kind === 'system' && id === S.root ? null : { kind, id, path };
    if (S.tab !== 'list') S.tab = drawnSys(S.focus) === S.root ? 'overview' : 'detail';
    applyTab(); A.refresh();
  }
  // The path from the open system to a system inside its tree: along the one drawn now first (its parents,
  // or a system it places), else the first found from the top. Null when it isn't in the tree.
  function pathTo(id) {
    if (!S.root) return null;
    if (id === S.root) return S.root;
    const cp = String(curPath()).split('>'), i = cp.indexOf(id);
    if (i >= 0) return cp.slice(0, i + 1).join('>');
    const c = cur();
    if (c && c.blocks.some(b => b.kind === 'system' && b.system === id && childOf(b))) return cp.concat(id).join('>');
    const walk = (sid, trail) => {
      if (trail.length > DEPTH) return null;
      for (const b of (S.store[sid] ? S.store[sid].blocks : [])) {
        const ch = childOf(b);
        if (!ch || trail.includes(ch.id)) continue;
        if (ch.id === id) return trail.concat(id).join('>');
        const r = walk(ch.id, trail.concat(ch.id));
        if (r) return r;
      }
      return null;
    };
    return walk(S.root, [S.root]);
  }
  // Open <system> in a panel (Chris, 2026-11-12: Overview always shows the top system): a system inside the
  // open one's tree becomes the pick and opens on Detail, and the open system itself goes back to Overview.
  // Only a system outside the tree is opened as the top one.
  function openSub(id) {
    const p = pathTo(id);
    if (!p) { A.openSystem(id); return; }
    if (id === S.root) { S.focus = null; S.tab = 'overview'; }
    else { S.focus = { kind: 'system', id, path: p, open: true }; S.tab = 'detail'; }
    applyTab(); A.refresh();
  }
  // Back (Chris, 2026-11-12): from any panel straight to the system's own.
  function back() { S.sel = null; S.pair = null; S.picking = null; S.adding = null; S.pending = null; A.refresh(); }

  function create(project) { const s = blank(project); S.store[s.id] = s; open(s.id); return s; }

  // ── Drawing ──
  // The canvas is drawn in the harness editor's units (K per mm), so it takes the editor's look as it
  // is: wires with an edge and gloss (.w-edge, .w-base, .w-gloss), the selection's pulse (.w-pulse),
  // the wiring ghost (.ghost-w), and draggable runs (.cv-run). Cables are Connections (connect.js): they
  // route, shape, and drag exactly as the harness editor's wires, by the same engine (Chris, 2026-11-11:
  // the harness's routing is the baseline). A dragged run or an added bend is kept per cable and end
  // (cab.routes[end id], the harness's record: v, a, b, mode), until Reset route.
  const K = 4, STUB_U = 24;
  // The grid (Chris, 2026-11-12: as the harness canvas has): spacing in mm, kept with the system (s.grid,
  // 1 mm unless set), drawn as the harness draws its grid (Dots or Lines, the harness's own setting), and
  // what blocks and cable runs snap to. Off: nothing snaps. Ctrl: anywhere.
  const GRIDS = [0, 1, 5, 10];
  const gridOf = s => (s && GRIDS.includes(s.grid) ? s.grid : 1);
  // A cable's line, as one harness wire's: half its drawn width (.sys-w .w-edge, 8.5), its corner
  // radius, and how far it runs out before its first corner (conn.js: half + 10, half + 20).
  const HALF = 4, RADIUS = HALF + 10, STUB_R = HALF + 20;
  const RT = () => LM.route, CN = () => LM.connect;
  // A tab on the canvas, and where a cable leaves it (Chris, 2026-11-11: out of any side, by default the
  // side of the board edge it's nearest): the exit point (ex, ey) in the middle of that side of the tab,
  // and its direction (dx, dy). A connector's panel can set the side (c.exit). tx and cy alias the exit.
  const SIDES = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
  // Turned blocks (Chris, 2026-11-12: 90 degree steps): b.rot is 0, 90, 180, or 270, clockwise. The block's
  // size (b.w, b.h), its connectors' spots (c.x, c.y), and a connector's chosen exit (c.exit) stay in the
  // block's own frame; b.x and b.y are the turned block's top left. Tabs and text stay upright.
  const rotOf = b => ((Math.round((+b.rot || 0) / 90) * 90) % 360 + 360) % 360;
  const sizeOf = b => (rotOf(b) % 180 ? { W: b.h, H: b.w } : { W: b.w, H: b.h });
  const TURN = { left: 'top', top: 'right', right: 'bottom', bottom: 'left' };
  const turnSide = (side, deg) => { let s0 = side; for (let i = 0; i < ((deg % 360) + 360) % 360 / 90; i++) s0 = TURN[s0]; return s0; };
  // A connector's tab, top left in the turned block (mm).
  function tabSpot(b, c) {
    const cx = c.x + tw(c) / 2, cy = c.y + TAB.h / 2, r = rotOf(b);
    const [x, y] = r === 90 ? [b.h - cy, cx] : r === 180 ? [b.w - cx, b.h - cy] : r === 270 ? [cy, b.w - cx] : [cx, cy];
    return { x: x - tw(c) / 2, y: y - TAB.h / 2 };
  }
  function exitSide(b, c) {
    const ex = c.exit || c.exit0;
    if (ex && SIDES[ex]) return turnSide(ex, rotOf(b));
    const t = tabSpot(b, c), { W, H } = sizeOf(b);
    const d = { left: t.x, right: W - t.x - tw(c), top: t.y, bottom: H - t.y - TAB.h };
    return Object.keys(d).sort((p, q) => d[p] - d[q])[0];
  }
  function tabGeom(b, c) {
    const t = tabSpot(b, c), { W, H } = sizeOf(b);
    const x = (b.x + t.x) * K, y = (b.y + t.y) * K, w = tw(c) * K, h = TAB.h * K, cx = x + w / 2, cy = y + h / 2;
    const side = exitSide(b, c), [dx, dy] = SIDES[side];
    const ex = dx ? (dx < 0 ? x : x + w) : cx, ey = dy ? (dy < 0 ? y : y + h) : cy;
    // How far the exit is inside its block's edge, the way it leaves.
    const inside = dx ? (dx < 0 ? ex - b.x * K : (b.x + W) * K - ex) : (dy < 0 ? ey - b.y * K : (b.y + H) * K - ey);
    return { x, y, w, h, cx, cy: ey, mid: cy, side, dx, dy, ex, ey, tx: ex, out: dx, inside: Math.max(0, inside) };
  }
  // A tab's terminals for the engine (route.js terminals are level): one leaving left or right runs
  // level from its exit, out past its block's edge before it turns (its own stub); one leaving up or
  // down runs to a lead point STUB_U past the block's edge and turns level there, either way (two
  // choices, the cheaper wins, as a harness connector's two edges). node is the block, whose rectangle
  // its end runs may cross. B terminals arrive (in) the way A terminals leave (out). A stub reaches a
  // line of the search grid (step), where the engine's search turns first: one rounded back toward the
  // connector would fall short of the stub, and the route would give up and run straight.
  const onGrid = (x, out, need, step) => Math.abs((out > 0 ? Math.ceil((x + need) / step) : Math.floor((x - need) / step)) * step - x);
  function terminals(g, b, end, toward, step) {
    const node = b.id;
    if (g.dx) {
      const T = { x: g.ex, y: g.ey, pins: true, node, side: g.dx > 0 ? 'r' : 'l', conn: false, stub: onGrid(g.ex, g.dx, g.inside + STUB_U, step) };
      T[end === 'A' ? 'out' : 'in'] = end === 'A' ? g.dx : -g.dx;
      return [T];
    }
    const ly = g.dy < 0 ? b.y * K - STUB_U : (b.y + sizeOf(b).H) * K + STUB_U, from = { x: g.ex, y: g.ey };
    const first = toward >= g.ex ? 1 : -1;
    return [first, -first].map(o => {
      const T = { x: g.ex, y: ly, pins: true, node, side: o > 0 ? 'r' : 'l', conn: true, stub: onGrid(g.ex, o, RADIUS, step) };
      if (end === 'A') { T.out = o; T.from = from; } else { T.in = -o; T.to = from; }
      return T;
    });
  }
  function cableEnds(s, cab, h) {
    return endsOf(cab, h).map(n => { const e = cab.ends[n.id], b = e && block(s, e.block), c = b && conn(b, e.conn); return { n, b, c, g: c ? tabGeom(b, c) : null }; });
  }
  const pathOf = pts => 'M' + pts.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('L');
  // The point halfway along a drawn route (route.js shape samples carry their arc length s).
  function midOfPts(pts) {
    const S = pts[pts.length - 1].s, half = S / 2;
    for (let i = 1; i < pts.length; i++) if (pts[i].s >= half) { const a = pts[i - 1], q = pts[i], t = (half - a.s) / Math.max(1e-6, q.s - a.s); return { x: a.x + (q.x - a.x) * t, y: a.y + (q.y - a.y) * t }; }
    return pts[0];
  }
  // Every cable's routes: from its first plugged end to each other plugged end.
  // The layout is kept until the blocks, connectors, cables, or harness ends change, not redone for a
  // selection (a system the size of a machine has dozens of cables over a big drawing).
  // One memo per system, so Overview and Detail switching back and forth don't re-route each other's.
  const memos = new Map();
  function layout(s, view) {
    const key = JSON.stringify([s.id, s.blocks.map(b => [b.id, b.x, b.y, b.w, b.h, rotOf(b), b.conns.map(c => [c.id, c.x, c.y, c.exit || '', c.fitted, c.tw || 0])]), s.cables.map(c => [c.id, c.kind, c.harness, c.ends, c.routes]), s.cables.map(c => { const h = harnessOf(c); return h ? [h.id, h.wires.length, harnessEnds(h).map(n => n.id), h.wires.length ? M.checks(h).filter(x => x.sev === 'error').length : 0] : null; })]);
    const memo = memos.get(s.id);
    if (memo && memo.key === key && memo.lo) return memo.lo;
    const lo = layoutNow(s, view);
    memos.set(s.id, { key, lo });
    return lo;
  }
  // The engine's search grid: 12 units (3 mm), a little coarser than a harness's 10 because a system is
  // drawn at board scale (fewer bends, and faster), and coarser still on a big drawing so the grid stays
  // about CELLS cells: a made-up 37-board, 60-cable system spread over 1.5 to 2.8 m first routes in 1.2 to
  // 1.9 s, a drag step about 0.1 s (2026-11-11).
  let CELLS = 100000;
  function gridStep(rects) {
    if (!rects.length) return 12;
    const x0 = Math.min(0, ...rects.map(r => r.x0)) - 300, x1 = Math.max(0, ...rects.map(r => r.x1)) + 300, y0 = Math.min(0, ...rects.map(r => r.y0)) - 300, y1 = Math.max(0, ...rects.map(r => r.y1)) + 300;
    return Math.max(12, Math.ceil(Math.sqrt((x1 - x0) * (y1 - y0) / CELLS) / 2) * 2);
  }
  // ── Device harnesses, drawn (Chris, 2026-11-13) ──
  // A harness built onto its device (its n.atDevice ends: a motor, a sensor, flying leads) is drawn in the
  // system as a simple picture of itself, in place of a stub: out of each connector it plugs into, its wires
  // run in their colors as one trunk, then fan out to its far ends, each a plain box with its name, or, for
  // flying leads, the wires ending in dots. Splices are small junction dots between the trunk and the far ends,
  // so a harness that splits through splices (several board connectors and motors) still reaches every device.
  // A caption over the far ends names the harness (with Cable labels). No tables. Loom lays it out off the
  // connector's exit, spreading the drawings out of one side of a block so they don't overlap; dragging the far
  // ends or the caption moves them (cab.devAt, mm, kept with the system). A harness with no wires yet draws a
  // dashed line to each device end. Lengths are in canvas units (K per mm), not to scale.
  const DW = { pitch: 5, trunk: 90, fan: 130, turn: 24, lead: 60, box: 34, gap: 16, font: 16, cap: 24, chars: 40 };
  const devMemo = new Map();
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
  const devLabel = n => n.name || n.ref || (n.family === 'flying' ? 'Flying leads' : 'Device');
  const pinIdx = (n, pin) => { const l = M.pinList(n).map(String), i = l.indexOf(String(pin)); return i < 0 ? 999 : i; };
  function devKey(s, cabs, hOf) {
    return JSON.stringify([labelsOn(), s.blocks.map(b => [b.id, b.x, b.y, b.w, b.h, rotOf(b), (b.conns || []).map(c => [c.id, c.x, c.y, c.exit || c.exit0 || ''])]),
      cabs.map(c => { const h = hOf(c); return [c.id, c.ends, c.devAt || null, c.kind || '', c.lengthMm || null, h.title, h.pn || '', h.nodes.map(n => [n.id, n.kind, n.ref, n.name || '', n.family || '', !!n.atDevice]), h.wires.map(w => [w.id, w.from, w.to, w.color || ''])]; })]);
  }
  // get: a harness by id, where the app's hooks aren't there (tests); else the app's.
  function devLayout(s, get) {
    const hOf = get ? c => (kindOf(c) === 'harness' ? get(c.harness) : null) : harnessOf;
    const cabs = s.cables.filter(c => deviceEnds(hOf(c)).length);
    const key = devKey(s, cabs, hOf), memo = devMemo.get(s.id);
    if (memo && memo.key === key) return memo.out;
    const caps = labelsOn(), drafts = [];
    cabs.forEach(cab => {
      const h = hOf(cab), at = cableEnds(s, cab, h).filter(x => x.g);
      if (!at.length) return;
      const plugged = new Map(at.map(x => [x.n.id, x])), nodes = new Map(h.nodes.map(n => [n.id, n]));
      const isJ = n => !!n && !M.isConn(n);
      const order = (x, pin) => at.indexOf(x) * 1000 + pin;
      // The wires as pieces: from a plugged connector (src) or a junction (jfrom), to a far connector (T) or a
      // junction (j). Junctions are reached from the plugged ends, then onward.
      const segs = [], jFirst = new Map(), seen = new Set(), queue = [];
      h.wires.forEach(w => {
        const a = plugged.get(w.from.node), b = plugged.get(w.to.node);
        if (!!a === !!b) return;
        const x = a || b, from = a ? w.from : w.to, to = a ? w.to : w.from, T = nodes.get(to.node);
        if (!T) return;
        seen.add(w.id);
        const src = { x, o: order(x, pinIdx(x.n, from.pin)) };
        if (isJ(T)) { segs.push({ w, src, j: T.id }); if (!jFirst.has(T.id)) queue.push(T.id); jFirst.set(T.id, Math.min(jFirst.has(T.id) ? jFirst.get(T.id) : Infinity, src.o)); }
        else segs.push({ w, src, T, tpin: pinIdx(T, to.pin) });
      });
      while (queue.length) {
        const jid = queue.shift();
        h.wires.forEach(w => {
          if (seen.has(w.id) || (w.from.node !== jid && w.to.node !== jid)) return;
          const to = w.from.node === jid ? w.to : w.from, U = nodes.get(to.node);
          if (!U || plugged.has(U.id)) return;
          seen.add(w.id);
          if (isJ(U)) { segs.push({ w, jfrom: jid, j: U.id }); if (!jFirst.has(U.id)) { jFirst.set(U.id, jFirst.get(jid)); queue.push(U.id); } }
          else segs.push({ w, jfrom: jid, T: U, tpin: pinIdx(U, to.pin) });
        });
      }
      const ghost = !segs.length;
      const keyOf = o => (o.src ? o.src.o : jFirst.get(o.jfrom));
      // The far ends, in the order their wires leave the plugged connectors, so the fan doesn't cross itself.
      const firstT = new Map();
      segs.forEach(o => { if (o.T) firstT.set(o.T, Math.min(firstT.has(o.T) ? firstT.get(o.T) : Infinity, keyOf(o))); });
      const targets = ghost ? deviceEnds(h) : [...firstT.keys()].sort((p, q) => firstT.get(p) - firstT.get(q));
      const g = at[0].g, d = [g.dx, g.dy], pv = g.dx ? [0, 1] : [1, 0], horiz = !!g.dx;
      const tg = targets.map(T => {
        const into = segs.filter(o => o.T === T).sort((p, q) => keyOf(p) - keyOf(q) || p.tpin - q.tpin);
        const nw = ghost ? 1 : into.length, leads = T.family === 'flying', full = devLabel(T), label = clip(full, DW.chars), tw0 = U.textW(label, DW.font);
        const Lp = horiz ? Math.max(leads ? 20 : DW.box, nw * DW.pitch + 14) : Math.max(tw0 + (leads ? 12 : 20), nw * DW.pitch + 14);
        const Ld = horiz ? (leads ? DW.lead + 10 + tw0 : tw0 + 20) : (leads ? DW.lead : DW.box);
        return { T, into, nw, leads, label, full, Lp, Ld };
      });
      const st = status(h), caption = caps ? clip(`${st.glyph} ${h.title}${pnOf(h, cab) ? ' · ' + pnOf(h, cab) : ''}`, 64) : '', capW = caption ? U.textW(caption, 13) : 0;
      let span = tg.reduce((n, t) => n + t.Lp, 0) + DW.gap * Math.max(0, tg.length - 1);
      const lane = caption && horiz ? DW.cap : 0;
      if (caption && !horiz) span = Math.max(span, capW);
      drafts.push({ cab, h, at, segs, tg, ghost, g, d, pv, horiz, span: span + lane, lane, caption, capW, st, keyOf, axis: horiz ? g.ey : g.ex, group: at[0].b.id + '|' + g.side });
    });
    // Drawings out of one side of a block, spread along it so none overlap, then shifted back so the spread
    // sits about the connectors it comes from.
    const groups = new Map();
    drafts.forEach(D => { if (!groups.has(D.group)) groups.set(D.group, []); groups.get(D.group).push(D); });
    groups.forEach(list => {
      list.sort((p, q) => p.axis - q.axis);
      let end = -Infinity;
      list.forEach(D => { D.c = Math.max(D.axis, end + DW.gap * 2 + D.span / 2); end = D.c + D.span / 2; });
      const back = list.reduce((n, D) => n + (D.c - D.axis), 0) / list.length;
      list.forEach(D => { D.c -= back; });
    });
    const out = new Map();
    const f1 = v => v.toFixed(1);
    drafts.forEach(D => {
      const { cab, g, d, pv, horiz, tg, segs, ghost, keyOf } = D, off = cab.devAt || { dx: 0, dy: 0 };
      const pt = (o, a, b) => ({ x: o.x + d[0] * a + pv[0] * b, y: o.y + d[1] * a + pv[1] * b });
      const ex = { x: g.ex, y: g.ey }, reach = DW.trunk + DW.fan;
      const B = { x: ex.x + d[0] * reach + pv[0] * (D.c - D.axis) + off.dx * K, y: ex.y + d[1] * reach + pv[1] * (D.c - D.axis) + off.dy * K };
      const boxes = [], leads = [], paths = [], juncs = [], pts = [ex], bare = new Set();
      let u = -D.span / 2 + D.lane;
      tg.forEach(t => {
        t.N = pt(B, 0, u + t.Lp / 2); u += t.Lp + DW.gap;
        const a = t.N, rect = horiz ? { x: d[0] > 0 ? a.x : a.x - t.Ld, y: a.y - t.Lp / 2, w: t.Ld, h: t.Lp } : { x: a.x - t.Lp / 2, y: d[1] > 0 ? a.y : a.y - t.Ld, w: t.Lp, h: t.Ld };
        { const p0 = { x: rect.x, y: rect.y }, p1 = { x: rect.x + rect.w, y: rect.y + rect.h }; pts.push(p0, p1); bare.add(p0); bare.add(p1); }
        if (!t.leads) boxes.push(Object.assign({ label: t.label, full: t.full, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, ghost, d, nw: t.nw }, rect));
        else {
          const e = pt(a, DW.lead, 0), lx = horiz ? e.x + d[0] * 10 : e.x, ly = horiz ? e.y + 5.5 : e.y + d[1] * 18 + (d[1] > 0 ? 5.5 : 0), w = U.textW(t.label, DW.font);
          t.lead = { label: t.label, full: t.full, lx, ly, anchor: horiz ? (d[0] > 0 ? 'start' : 'end') : 'middle', dots: [], ghost };
          leads.push(t.lead);
          const q0 = { x: lx - (horiz ? (d[0] > 0 ? 0 : w) : w / 2), y: ly - 14 }, q1 = { x: lx + (horiz ? (d[0] > 0 ? w : 0) : w / 2), y: ly + 5 };
          pts.push(q0, q1); bare.add(q0); bare.add(q1);
        }
      });
      // A wire's slot at its far end: the k-th of the wires into it.
      const slot = o => { const t = tg.find(x => x.T === o.T), k = t.into.indexOf(o); return { t, Q: pt(t.N, 0, (k - (t.nw - 1) / 2) * DW.pitch) }; };
      // Junctions: between the trunks and the far ends, level with the middle of the far ends they feed.
      const jdepth = DW.trunk + DW.fan * 0.5, jpos = new Map(), feeds = new Map();
      segs.forEach(o => { if (o.jfrom && o.T) { if (!feeds.has(o.jfrom)) feeds.set(o.jfrom, []); feeds.get(o.jfrom).push(slot(o).Q); } });
      const jids = [...new Set(segs.filter(o => o.j).map(o => o.j))];
      jids.forEach(id => {
        const qs = feeds.get(id) || [], along = qs.length ? qs.reduce((n, q) => n + (horiz ? q.y : q.x), 0) / qs.length : (horiz ? B.y : B.x);
        const base = pt(ex, jdepth, 0), J = horiz ? { x: base.x + off.dx * K, y: along } : { x: along, y: base.y + off.dy * K };
        jpos.set(id, J); pts.push(J);
        const n = D.h.nodes.find(x => x.id === id);
        juncs.push({ x: J.x, y: J.y, ref: n ? n.ref || 'Splice' : 'Splice' });
      });
      // Trunk wires, per plugged connector, ordered by where they go, so the fan doesn't cross.
      const dest = o => (o.T ? tg.findIndex(t => t.T === o.T) * 1000 + o.tpin : (() => { const qs = feeds.get(o.j) || []; return qs.length ? tg.findIndex(t => qs.some(q => Math.abs((horiz ? q.y - t.N.y : q.x - t.N.x)) < t.Lp / 2 + 1)) * 1000 - 1 : 1e6; })());
      const byEnd = new Map();
      (ghost ? tg.map(t => ({ ghostT: t, src: { x: D.at[0] } })) : segs.filter(o => o.src)).forEach(o => { const x = o.src.x; if (!byEnd.has(x)) byEnd.set(x, []); byEnd.get(x).push(o); });
      const colorOfW = o => (o.w ? M.colorInfo(o.w.color) : null);
      const push = (o, path, Q, t) => {
        const ci = colorOfW(o), base = ci && ci.base ? ci.base : '';
        if (t && t.leads) { const e = pt(Q, DW.lead, 0); path += `L${f1(e.x)} ${f1(e.y)}`; t.lead.dots.push({ x: e.x, y: e.y, color: base }); }
        paths.push({ d: path, color: base, stripe: ci && ci.stripe ? ci.stripe : '', ghost });
      };
      // Every wire runs at right angles with rounded corners, as system cables do (Chris, 2026-11-13: not wide
      // curves). Out of a trunk each wire turns toward its far end at its own depth, the wire on the side it
      // turns toward first, so a trunk's wires step across without crossing; a wire that would cross its own
      // block goes round it (roundBlock).
      byEnd.forEach((list, x) => {
        const gx = x.g, dx = [gx.dx, gx.dy], px = gx.dx ? [0, 1] : [1, 0];
        const bs = sizeOf(x.b), R = { x0: x.b.x * K, y0: x.b.y * K, x1: (x.b.x + bs.W) * K, y1: (x.b.y + bs.H) * K };
        list.sort((p, q) => dest(p) - dest(q) || keyOf(p) - keyOf(q));
        const ws = list.map((o, j) => {
          const o0 = ghost ? 0 : (j - (list.length - 1) / 2) * DW.pitch, S0 = { x: gx.ex + px[0] * o0, y: gx.ey + px[1] * o0 };
          const E = { x: S0.x + dx[0] * DW.trunk, y: S0.y + dx[1] * DW.trunk };
          const tq = o.ghostT ? { t: o.ghostT, Q: o.ghostT.N } : o.T ? slot(o) : { t: null, Q: jpos.get(o.j) };
          return { o, o0, S0, E, t: tq.t, Q: tq.Q, w: (tq.Q.x - E.x) * px[0] + (tq.Q.y - E.y) * px[1] };
        });
        // One way round for the whole trunk, chosen for the middle of where its wires go.
        const Qm = { x: ws.reduce((n, v) => n + v.Q.x, 0) / ws.length, y: ws.reduce((n, v) => n + v.Q.y, 0) / ws.length };
        const rankOf = new Map();
        [ws.filter(v => v.w > 0.5).sort((p, q) => q.o0 - p.o0), ws.filter(v => v.w < -0.5).sort((p, q) => p.o0 - q.o0)].forEach(g => g.forEach((v, k) => rankOf.set(v, k)));
        ws.forEach(v => { v.P = elbow(v.E, dx, v.Q, d, DW.turn + (rankOf.get(v) || 0) * DW.pitch); });
        const round = ws.some(v => crosses(v.P, R));  // one wire round, the trunk all round together
        ws.forEach(v => {
          const { o, o0, S0, E, t, Q, P } = v;
          pts.push(S0, E);
          const rb = round ? roundBlock(S0, E, dx, Q, d, P, R, px, o0, ghost ? 1 : list.length, Qm, true) : null;
          if (rb) { pts.push(...rb.pts); push(o, `M${f1(S0.x)} ${f1(S0.y)}` + rb.d, Q, t); return; }
          pts.push(...P);
          push(o, `M${f1(S0.x)} ${f1(S0.y)}` + roundPts([S0, ...P]), Q, t);
        });
      });
      segs.filter(o => o.jfrom).forEach(o => {
        const J = jpos.get(o.jfrom);
        if (o.T) { const { t, Q } = slot(o), P = elbow(J, d, Q, d, ((Q.x - J.x) * d[0] + (Q.y - J.y) * d[1]) / 2); push(o, `M${f1(J.x)} ${f1(J.y)}` + roundPts(P), Q, t); }
        else { const J2 = jpos.get(o.j); push(o, `M${f1(J.x)} ${f1(J.y)}` + roundPts(elbow(J, d, J2, d, ((J2.x - J.x) * d[0] + (J2.y - J.y) * d[1]) / 2)), J2, null); }
      });
      // The caption: over the far ends (a side exit), or past them (up or down).
      let cap = null;
      if (D.caption) {
        const maxLd = Math.max(0, ...tg.map(t => t.Ld)), top = pt(B, 0, -D.span / 2);
        cap = horiz ? { x: d[0] > 0 ? top.x : top.x - D.capW, y: top.y + 15, text: D.caption } : { x: top.x, y: B.y + d[1] * (maxLd + 22) + (d[1] > 0 ? 4 : 0), text: D.caption };
        const c0 = { x: cap.x, y: cap.y - 14 }, c1 = { x: cap.x + D.capW, y: cap.y + 4 };
        pts.push(c0, c1); bare.add(c0); bare.add(c1);
      }
      const bounds = P => ({ x0: Math.min(...P.map(q => q.x)), y0: Math.min(...P.map(q => q.y)), x1: Math.max(...P.map(q => q.x)), y1: Math.max(...P.map(q => q.y)) });
      const box = bounds(pts);
      // What a mini view draws (Chris, 2026-11-13: empty space under it): no names or caption, and its far ends small.
      const mpts = pts.filter(q => !bare.has(q));
      boxes.forEach(x => { const g = miniBox(x); mpts.push({ x: g.x, y: g.y }, { x: g.x + g.w, y: g.y + g.h }); });
      leads.forEach(l => l.dots.forEach(q => mpts.push({ x: q.x - MINI_DOT, y: q.y - MINI_DOT }, { x: q.x + MINI_DOT, y: q.y + MINI_DOT })));
      out.set(cab.id, { paths, boxes, leads, juncs, cap, box, mbox: bounds(mpts), lane: [ex, { x: ex.x + d[0] * DW.trunk, y: ex.y + d[1] * DW.trunk }] });
    });
    devMemo.set(s.id, { key, out });
    return out;
  }
  // Points from E (leaving along a) to Q (arriving along q) at right angles: out m along a, across, then on
  // to Q; or one corner when a and q are square to each other. E first, Q last.
  function elbow(E, a, Q, q, m) {
    const u = (Q.x - E.x) * a[0] + (Q.y - E.y) * a[1], p = [a[1] ? 1 : 0, a[0] ? 1 : 0], w = (Q.x - E.x) * p[0] + (Q.y - E.y) * p[1];
    if (a[0] * q[0] + a[1] * q[1] === 0) return [E, { x: E.x + a[0] * u, y: E.y + a[1] * u }, Q];
    if (Math.abs(w) < 0.5) return [E, Q];
    const mm = u > 0 ? Math.max(0, Math.min(m, u - 1)) : Math.max(m, 12);
    const A = { x: E.x + a[0] * mm, y: E.y + a[1] * mm }, B = { x: A.x + p[0] * w, y: A.y + p[1] * w };
    return [E, A, B, Q];
  }
  // A path through points (the first is where it already is): straight runs, each corner rounded (RADIUS, less
  // where a run is short). No move.
  function roundPts(P) {
    const f1 = v => v.toFixed(1);
    P = P.filter((p, i, l) => !i || Math.hypot(p.x - l[i - 1].x, p.y - l[i - 1].y) > 0.5);
    let s = '';
    for (let i = 1; i < P.length - 1; i++) {
      const A = P[i - 1], B = P[i], N = P[i + 1], la = Math.hypot(B.x - A.x, B.y - A.y), lb = Math.hypot(N.x - B.x, N.y - B.y), r = Math.min(RADIUS, la / 2, lb / 2);
      s += `L${f1(B.x + (A.x - B.x) / la * r)} ${f1(B.y + (A.y - B.y) / la * r)}Q${f1(B.x)} ${f1(B.y)} ${f1(B.x + (N.x - B.x) / lb * r)} ${f1(B.y + (N.y - B.y) / lb * r)}`;
    }
    return P.length > 1 ? s + `L${f1(P[P.length - 1].x)} ${f1(P[P.length - 1].y)}` : s;
  }
  // A device harness's wire from a plugged connector to its far end (E, leaving along a; Q, arriving along q):
  // null when its curve stays clear of the connector's block R, else a path round the block (Chris, 2026-11-13:
  // a harness plugged into two connectors of one board had its far ends laid out off the first, and the second's
  // wires ran across the board). It leaves along a, turns at the corners of the block grown by how far out E
  // is, the shorter way round, and comes in to Q along q. Wires of one trunk nest: the one nearest the way it
  // turns runs innermost (o0 is its offset along px, n the trunk's wire count). The path starts at the tab (S0),
  // so its first turn rounds too, even when the trunk already reaches the way round (Chris, 2026-11-13: a square
  // corner there). Returns { d, pts }: d from S0, without its move.
  // Whether a path's points (straight runs between them) pass through the block R.
  function crosses(P0, R) {
    const m = 2, inR = (x, y) => x > R.x0 - m && x < R.x1 + m && y > R.y0 - m && y < R.y1 + m;
    for (let i = 1; i < P0.length; i++) for (let k = 1; k < 16; k++) { const t = k / 16; if (inR(P0[i - 1].x + (P0[i].x - P0[i - 1].x) * t, P0[i - 1].y + (P0[i].y - P0[i - 1].y) * t)) return true; }
    return false;
  }
  function roundBlock(S0, E, a, Q, q, P0, R, px, o0, n, Qm, force) {
    if (!force && !crosses(P0, R)) return null;
    const sE = a[1] < 0 ? 0 : a[0] > 0 ? 1 : a[1] > 0 ? 2 : 3;
    const out = sE === 0 ? R.y0 - E.y : sE === 1 ? E.x - R.x1 : sE === 2 ? E.y - R.y1 : R.x0 - E.x;
    const Qa = { x: Q.x - q[0] * 24, y: Q.y - q[1] * 24 };
    const way = pad => {
      const G = { x0: R.x0 - pad, y0: R.y0 - pad, x1: R.x1 + pad, y1: R.y1 + pad };
      const C = [{ x: G.x0, y: G.y0 }, { x: G.x1, y: G.y0 }, { x: G.x1, y: G.y1 }, { x: G.x0, y: G.y1 }];
      const Qt = Qm ? { x: Qm.x - q[0] * 24, y: Qm.y - q[1] * 24 } : Qa;
      const dq = [G.y0 - Qt.y, Qt.x - G.x1, Qt.y - G.y1, G.x0 - Qt.x], sQ = dq.indexOf(Math.max(...dq));
      if (sQ === sE) return null;
      const cw = [], ccw = [];
      for (let i = sE; i !== sQ;) { i = (i + 1) % 4; cw.push(C[i]); }
      for (let i = sE; i !== sQ; i = (i + 3) % 4) ccw.push(C[i]);
      const E1 = { x: E.x + a[0] * Math.max(0, pad - out), y: E.y + a[1] * Math.max(0, pad - out) };
      // Measured from the trunk's middle, so every wire of a trunk picks the same way round.
      const E1c = { x: E1.x - px[0] * o0, y: E1.y - px[1] * o0 };
      const len = l => { const P = [E1c, ...l, Qt]; let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); return s; };
      return { E1, list: len(cw) <= len(ccw) ? cw : ccw };
    };
    const base = Math.max(out, 16), w0 = way(base);
    if (!w0) return null;
    const turn = (w0.list[0].x - E.x) * px[0] + (w0.list[0].y - E.y) * px[1];
    const k = Math.round(turn > 0 ? (n - 1) / 2 - o0 / DW.pitch : (n - 1) / 2 + o0 / DW.pitch);
    const w = way(base + Math.max(0, k) * DW.pitch) || w0;
    // Round the last corner square onto Q's way in: from it, along the side, then in along q.
    const L = w.list[w.list.length - 1], last = elbow(L, q[0] ? [0, Math.sign(Qa.y - L.y) || 1] : [Math.sign(Qa.x - L.x) || 1, 0], Q, q, 0).slice(1);
    const P = [S0, E, w.E1, ...w.list, ...last].filter((p, i, l) => !i || Math.hypot(p.x - l[i - 1].x, p.y - l[i - 1].y) > 0.5);
    return { d: roundPts(P), pts: P };
  }
  // What a system's drawing covers, mm, as a mini view draws it: its blocks and its device harness drawings (no
  // names or captions, far ends small).
  function drawnExtent(s) {
    if (!s || !s.blocks.length) return null;
    let x0 = Math.min(...s.blocks.map(b => b.x)), y0 = Math.min(...s.blocks.map(b => b.y)), x1 = Math.max(...s.blocks.map(b => b.x + sizeOf(b).W)), y1 = Math.max(...s.blocks.map(b => b.y + sizeOf(b).H));
    // The tabs the mini view draws, which can sit past their block's edge.
    s.blocks.forEach(b => (b.conns || []).filter(c => fitted(c) && (c.used || pluggedAt(s, b.id, c.id).length)).forEach(c => { const g = tabGeom(b, c); x0 = Math.min(x0, g.x / K); y0 = Math.min(y0, g.y / K); x1 = Math.max(x1, (g.x + g.w) / K); y1 = Math.max(y1, (g.y + g.h) / K); }));
    devLayout(s).forEach(D => { const B = D.mbox || D.box; x0 = Math.min(x0, B.x0 / K); y0 = Math.min(y0, B.y0 / K); x1 = Math.max(x1, B.x1 / K); y1 = Math.max(y1, B.y1 / K); });
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }
  // Where a placed system's drawing sits inside its block (block frame, mm): under the header, centered.
  function miniFrame(b, ch) {
    const E = drawnExtent(ch);
    if (!E) return null;
    // The header runs across the block's top as drawn, whichever way it's turned; in the block's own frame that
    // is its top (0°), left (90°), bottom (180°), or right (270°) side (Chris, 2026-11-13: a turned block's
    // drawing ran up through its header).
    const r = rotOf(b), Hs = r === 90 || r === 270 ? b.w : b.h, hd = Math.min(46, Hs * K / 2) / K, pad = 2, head = hd + 1.5;
    const m = { l: pad, t: pad, r: pad, b: pad };
    m[r === 90 ? 'l' : r === 180 ? 'b' : r === 270 ? 'r' : 't'] = head;
    const iw = b.w - m.l - m.r, ih = b.h - m.t - m.b;
    if (iw <= 1 || ih <= 1) return null;
    const f = Math.min(iw / E.w, ih / E.h);
    return { E, f, ox: m.l + (iw - E.w * f) / 2, oy: m.t + (ih - E.h * f) / 2 };
  }
  // A far end's box as a mini view draws it: along the side its wires come into, only as long as their spread
  // (centered where they land); and no deeper than that (at most DW.box). A small square, not a bar as long as
  // a name the mini view doesn't print.
  const MINI_DOT = 4;
  function miniBox(x) {
    const d = x.d || [1, 0], span = Math.max(20, (x.nw || 1) * DW.pitch + 14);
    if (d[0]) { const h = Math.min(x.h, span), w = Math.min(x.w, h, DW.box); return { x: d[0] > 0 ? x.x : x.x + x.w - w, y: x.y + (x.h - h) / 2, w, h }; }
    const w = Math.min(x.w, span), h = Math.min(x.h, w, DW.box); return { x: x.x + (x.w - w) / 2, y: d[1] > 0 ? x.y : x.y + x.h - h, w, h };
  }
  // A placed system's block is as tall as its mini view needs at the block's width (Chris, 2026-11-13: take out
  // the empty space under the drawing): the header, the drawing scaled to the width, and a margin. Width and
  // height are as the block shows on screen, so a block turned 90° or 270° fits its stored width.
  function fitMini(b, ch) {
    const E = drawnExtent(ch);
    if (!E) return;
    const r = rotOf(b), turned = r === 90 || r === 270, pad = 2, Ws = turned ? b.h : b.w;
    const Ew = turned ? E.h : E.w, Eh = turned ? E.w : E.h, f = (Ws - 2 * pad) / Ew;
    if (!(f > 0)) return;
    let Hs = 46 / K + 1.5 + Eh * f + pad;
    Hs = +Math.max(30, Hs).toFixed(2);
    if (turned) b.w = Hs; else b.h = Hs;
  }
  // The SVG transform from a placed system's own drawing (canvas units) to the parent's canvas.
  function miniXf(b) {
    const r = rotOf(b), X = b.x * K, Y = b.y * K, m = b.mini;
    const turn = r === 90 ? `translate(${X + b.h * K} ${Y}) rotate(90)` : r === 180 ? `translate(${X + b.w * K} ${Y + b.h * K}) rotate(180)` : r === 270 ? `translate(${X} ${Y + b.w * K}) rotate(270)` : `translate(${X} ${Y})`;
    return `${turn} translate(${(m.ox * K).toFixed(2)} ${(m.oy * K).toFixed(2)}) scale(${m.f.toFixed(5)}) translate(${(-m.E.x * K).toFixed(2)} ${(-m.E.y * K).toFixed(2)})`;
  }
  // A system drawn small, for a mini view: its blocks and used connectors, its cables, and its device harness
  // drawings, nothing to click. Strokes keep their width on screen however small it's drawn.
  function miniSvg(s, depth) {
    let o = '';
    s.blocks.forEach(b => {
      const X = b.x * K, Y = b.y * K, { W, H } = sizeOf(b);
      o += shaped(b) ? shapeSvg(b, picOf(b), 'sys-mshape') : `<rect class="sys-mb ${b.kind}" x="${X}" y="${Y}" width="${W * K}" height="${H * K}" rx="6"/>`;
      if (b.kind === 'system' && b.mini && childOf(b) && depth < 3) o += `<g transform="${miniXf(b)}">${miniSvg(childOf(b), depth + 1)}</g>`;
      else if (b.name) { const fs = Math.max(4, Math.min(W * K * 0.9 / Math.max(1, U.textW(b.name, 1)), H * K * 0.3)); o += `<text class="sys-mt" x="${X + W * K / 2}" y="${Y + H * K / 2}" style="font-size:${fs.toFixed(1)}px">${esc(b.name)}</text>`; }
      (b.conns || []).filter(c => fitted(c) && (c.used || pluggedAt(s, b.id, c.id).length)).forEach(c => { const g = tabGeom(b, c); o += `<rect class="sys-mtab" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}"/>`; });
    });
    layout(s).forEach(({ cab, h, routes }) => { const st = statusOf(cab, h), col = colorOf(cab) || (st.key === 'placeholder' || st.key === 'link' ? 'var(--text-3)' : 'var(--accent)'); routes.forEach(r => { o += `<path class="sys-mc" style="stroke:${col}" d="${r.d}"/>`; }); });
    devLayout(s).forEach(D => {
      D.paths.forEach(p => { o += `<path class="sys-mw${p.ghost ? ' ghost' : ''}"${p.color ? ` style="stroke:${p.color}"` : ''} d="${p.d}"/>`; });
      // Far ends drawn small (Chris, 2026-11-13: long rectangles): a box is as long as its name, which a mini view
      // doesn't print, so it keeps the side its wires come into and is only as deep as it is wide, or less.
      D.boxes.forEach(x => {
        const g = miniBox(x);
        o += `<rect class="sys-mdbox" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="3"/>`;
      });
      // Flying leads end in dots, as in the full drawing (Chris, 2026-11-13: without them the wires read as stray hairlines).
      D.leads.forEach(l => l.dots.forEach(q => { o += `<circle class="sys-mdot" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${MINI_DOT}"${q.color ? ` style="fill:${q.color}"` : ''}/>`; }));
    });
    return o;
  }
  function layoutNow(s, view) {
    const out = new Map();
    if (!s.blocks.length) return out;
    // The parts every route walks round: the blocks (the engine keeps each route its half-width and a
    // little clear of them, as a harness's wires of its connectors).
    const rects = s.blocks.map(x => ({ id: x.id, x0: x.x * K, y0: x.y * K, x1: (x.x + sizeOf(x).W) * K, y1: (x.y + sizeOf(x).H) * K }));
    const list = [], per = [], step = gridStep(rects);
    s.cables.forEach(cab => {
      const h = harnessOf(cab), ends = cableEnds(s, cab, h), at = ends.filter(x => x.g);
      per.push({ cab, h, ends, at });
      if (deviceEnds(h).length) return;
      for (let i = 1; i < at.length; i++) {
        const a = at[0], b = at[i];
        const As = terminals(a.g, a.b, 'A', b.g.ex, step), Bs = terminals(b.g, b.b, 'B', a.g.ex, step), combos = [];
        As.forEach(A => Bs.forEach(B => combos.push({ A, B })));
        list.push({ key: cab.id + '|' + b.n.id, weight: h ? Math.max(1, h.wires.length) : 1, combos, half: HALF, stub: STUB_R, r: RADIUS, shape: CN().record(cab.routes && cab.routes[b.n.id]) });
      }
    });
    const res = CN().routeAll(s.id, rects, list, { fast: !!(view && view.fast), grid: step });
    per.forEach(({ cab, h, ends, at }) => {
      const routes = [], dv = deviceEnds(h).length > 0;
      for (let i = 1; i < at.length && !dv; i++) {
        const R0 = res.routes.get(cab.id + '|' + at[i].n.id), sh = CN().draw(R0);
        routes.push(Object.assign({}, R0, { end: at[i].n.id, d: pathOf(sh.pts), mid: midOfPts(sh.pts), pts: sh.pts }));
      }
      out.set(cab.id, { cab, h, ends, at, routes, dev: deviceEnds(h).map(n => n.name || n.ref) });
    });
    out.step = step;
    return out;
  }
  const midOf = r => r.mid;
  // Cable labels (Chris, 2026-11-12: as the harness editor's wire labels). Each label hangs from a small dot
  // on its cable, with a thin line from the dot to the label. The dot sits cab.labelAt along the cable's
  // first route (or its stub), 0 to 1; the label's left side sits cab.labelOff ({ dx, dy }, mm, to its
  // baseline) from the dot. Unset, both are where the label has always been. Dragging the dot slides it
  // along the cable and the label comes along; dragging the label moves it anywhere and the dot stays.
  // Either drag first fixes the other half. The Cable labels box at the canvas's bottom right hides them
  // (this browser).
  const laneOfPts = pts => { let s0 = 0; return pts.map((q, i) => { if (i) s0 += Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y); return { x: q.x, y: q.y, s: s0 }; }); };
  function laneAt(L, t) {
    const S0 = L[L.length - 1].s * Math.max(0, Math.min(1, t));
    for (let i = 1; i < L.length; i++) if (L[i].s >= S0) { const a = L[i - 1], b = L[i], u = (S0 - a.s) / Math.max(1e-6, b.s - a.s); return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }; }
    return { x: L[0].x, y: L[0].y };
  }
  function laneT(L, p) {
    let best = Infinity, at = 0;
    for (let i = 1; i < L.length; i++) {
      const a = L[i - 1], b = L[i], vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1e-9;
      const u = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)), x = a.x + vx * u, y = a.y + vy * u, d = Math.hypot(p.x - x, p.y - y);
      if (d < best) { best = d; at = a.s + (b.s - a.s) * u; }
    }
    return L[L.length - 1].s ? at / L[L.length - 1].s : 0;
  }
  const labelsOn = () => { try { return localStorage.getItem(NS + 'sysLabels') !== 'off'; } catch (e) { return true; } };
  let labInfo = new Map();
  function svgHtml(s, Lo) {
    labInfo = new Map();
    const sel = S.sel;
    const isSel = (k, a, b2) => sel && (sel.kind === 'multi' ? (k === 'block' ? sel.blocks.includes(a) : k === 'cable' && sel.cables.includes(a))
      : sel.kind === k && (k === 'cable' ? sel.id === a : sel.block === a && (k === 'block' || sel.conn === b2)));
    // The editor's card gradients (app.js FX_DEFS), which these cards and the wires use.
    const g = gridOf(s) * K, P = g * 5, lines = A.gridStyle && A.gridStyle() === 'lines';
    const marks = lines
      ? [1, 2, 3, 4].map(i => `<path class="gl" d="M${i * g} 0V${P}M0 ${i * g}H${P}"/>`).join('') + `<path class="gl major" d="M0 0V${P}M0 0H${P}"/>`
      : [...Array(25)].map((_, i) => `<circle class="${i % 5 || Math.floor(i / 5) % 5 ? 'gd' : 'gd major'}" cx="${(i % 5) * g}" cy="${Math.floor(i / 5) * g}" r="${i ? 0.9 : 1.4}"/>`).join('');
    let html = (g ? `<defs><pattern id="sys-grid" width="${P}" height="${P}" patternUnits="userSpaceOnUse">${marks}</pattern></defs><rect class="bg" x="-200000" y="-200000" width="400000" height="400000" fill="url(#sys-grid)"/>` : '') + '<defs>' +
      '<linearGradient id="lmfx-conn-head" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--cv-conn-head-hi)"/><stop offset="1" style="stop-color:var(--cv-conn-head)"/></linearGradient>' +
      '<linearGradient id="lmfx-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--cv-glass-top)"/><stop offset="0.45" style="stop-color:var(--cv-glass-mid)"/><stop offset="1" style="stop-color:var(--cv-glass-bot)"/></linearGradient>' +
      '<linearGradient id="lmfx-head" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--cv-head-hi)"/><stop offset="1" style="stop-color:var(--cv-head)"/></linearGradient>' +
      '</defs><g class="sys-blocks">';
    s.blocks.forEach(b => {
      const bs = isSel('block', b.id) || (sel && sel.kind === 'conn' && sel.block === b.id);
      const X = b.x * K, Y = b.y * K;
      // The harness editor's connector card (conn.js, with fx): paper card and shadow, a lit header,
      // the darker connector edge, and glass, so blocks stand off the stage as connectors do.
      const W = sizeOf(b).W * K, Hh = sizeOf(b).H * K, r = 8, hd = Math.min(46, Hh / 2);
      if (shaped(b)) {
        // A board drawn as itself (Chris, 2026-11-13): its edge, Fabcheck's picture inside it, and its ref and
        // name on a small label at the top left; with no picture, the name in the middle as on any block.
        const pic = picOf(b), fr = Math.max(14, Math.min(26, Hh / 8)), name = String(b.name || '');
        const lw = U.textW(b.ref, fr) + (pic && name ? 10 + U.textW(name, fr * 0.72) : 0) + 16;
        const fs = Math.max(7, Math.min(44, (W - 20) / Math.max(1, U.textW(name, 1)), Hh * 0.3));
        html += `<g class="cv-conn sys-block board shaped${bs ? ' sel' : ''}" data-block="${b.id}">` + shapeSvg(b, pic, 'sys-shape') +
          `<rect class="sys-lab-bg" x="${X + 6}" y="${Y + 6}" width="${lw.toFixed(1)}" height="${(fr * 1.5).toFixed(1)}" rx="${(fr * 0.4).toFixed(1)}"/>` +
          `<text class="sys-ref" x="${X + 14}" y="${(Y + 6 + fr * 1.08).toFixed(1)}" style="font-size:${fr.toFixed(0)}px">${esc(b.ref)}</text>` +
          (pic && name ? `<text class="sys-hname" x="${(X + 14 + U.textW(b.ref, fr) + 10).toFixed(1)}" y="${(Y + 6 + fr * 1.05).toFixed(1)}" style="font-size:${(fr * 0.72).toFixed(1)}px">${esc(name)}</text>` : '') +
          (!pic && name ? `<text class="sys-center" x="${X + W / 2}" y="${Y + Hh / 2}" style="font-size:${fs.toFixed(1)}px">${esc(name)}</text>` : '');
      } else
      html += `<g class="cv-conn sys-block ${b.kind}${bs ? ' sel' : ''}" data-block="${b.id}">` +
        `<rect class="cv-card" x="${X}" y="${Y}" width="${W}" height="${Hh}" rx="${r}"/>` +
        `<path class="cv-headbg" d="M${X} ${Y + hd}V${Y + r}Q${X} ${Y} ${X + r} ${Y}H${X + W - r}Q${X + W} ${Y} ${X + W} ${Y + r}V${Y + hd}Z"/>` +
        `<line class="sys-headrule" x1="${X}" y1="${Y + hd}" x2="${X + W}" y2="${Y + hd}"/>` +
        `<rect class="cv-glass" x="${X}" y="${Y}" width="${W}" height="${Hh}" rx="${r}"/><rect class="cv-rim" x="${X + 1}" y="${Y + 1}" width="${W - 2}" height="${Hh - 2}" rx="${r - 1}"/>` +
        `<rect class="cv-frame" x="${X}" y="${Y}" width="${W}" height="${Hh}" rx="${r}"/>` +
        (b.kind === 'system' ? `<rect class="sys-nest" x="${X + 5}" y="${Y + 5}" width="${Math.max(0, W - 10)}" height="${Math.max(0, Hh - 10)}" rx="${r - 3}"/>` : '') +
        // The ref alone at the top left, as tall as the two rows it shares with nothing now, and the name
        // large in the middle, upright and as big as the block allows (Chris, 2026-11-12).
        `<text class="sys-ref" x="${X + 10}" y="${Y + Math.min(36, hd - 6)}" style="font-size:${Math.max(14, Math.min(30, hd - 12)).toFixed(0)}px">${esc(b.ref)}</text>` +
        (() => {
          const name = String(b.kind === 'system' && !childOf(b) ? 'Missing system' : b.name || '');
          if (b.kind === 'system' && b.mini && childOf(b)) {
            // The placed system drawn small (Chris, 2026-11-13), and its name beside the ref in the header.
            const fr = Math.max(14, Math.min(30, hd - 12)), x0 = X + 10 + U.textW(b.ref, fr) + 8, room = X + W - 8 - x0;
            const fn = Math.max(5, Math.min(fr * 0.7, room / Math.max(1, U.textW(name, 1))));
            return `<g class="sys-mini" transform="${miniXf(b)}">${miniSvg(childOf(b), 1)}</g>` +
              (room > 10 ? `<text class="sys-hname" x="${x0}" y="${Y + Math.min(36, hd - 6)}" style="font-size:${fn.toFixed(1)}px">${esc(name)}</text>` : '');
          }
          const fs = Math.max(7, Math.min(44, (W - 20) / Math.max(1, U.textW(name, 1)), (Hh - hd) * 0.42));
          return name ? `<text class="sys-center" x="${X + W / 2}" y="${Y + hd + (Hh - hd) / 2}" style="font-size:${fs.toFixed(1)}px">${esc(name)}</text>` : '';
        })();
      b.conns.filter(c => !fitted(c)).concat(b.conns.filter(fitted)).forEach(c => {
        const at = pluggedAt(s, b.id, c.id).length, g = tabGeom(b, c), fit = fitted(c);
        const pend = S.pending && S.pending.block === b.id && S.pending.conn === c.id;
        const cls = ['sys-tab', c.external ? 'ext' : '', c.link ? 'link' : '', !fit ? 'unfitted' : '', pend ? 'pending' : S.pending && fit ? 'can' : '', c.used ? 'used' : 'unused', at ? 'plugged' : '', c.used && !at ? 'open' : '', c.side === 'bottom' ? 'bottom' : '', isSel('conn', b.id, c.id) ? 'sel' : ''].filter(Boolean).join(' ');
        // An external connector has a small arrow out of its exit: it's plugged from the systems placing this one.
        const mark = c.external ? (() => { const ax = g.ex + g.dx * 2, ay = g.ey + g.dy * 2, px = -g.dy, py = g.dx; return `<path class="sys-extmark" d="M${ax + px * 4} ${ay + py * 4}L${ax - px * 4} ${ay - py * 4}L${ax + g.dx * 7} ${ay + g.dy * 7}Z"/>`; })() : '';
        html += `<g class="${cls}" data-conn="${c.id}" data-block="${b.id}"><title>${esc(`${b.ref} ${c.ref}${c.inside ? ' · inside ' + c.inside : ''}${c.external ? ' · external' : ''}${c.fn ? ' · ' + c.fn : ''} · ${c.pins.length} pins${c.side === 'bottom' ? ' · bottom side' : ''}${c.placed === 'hand' && b.source ? ' · placed by hand' : c.placed === 'netlist' ? ' · not in the pick-and-place: placed at its pads in the netlist' : ''}${fit ? ' · click, then click another connector, to run a cable' : ' · not populated'}`)}</title>` +
          `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="3"/><text x="${g.cx}" y="${g.cy + 3.5}">${esc(c.ref)}</text>${mark}</g>`;
      });
      html += '</g>';
    });
    html += '</g><g class="sys-cables">';
    let labels = '', handles = '';
    (Lo || layout(s)).forEach(({ cab, h, ends, at, routes, dev }) => {
      const st = statusOf(cab, h), on = isSel('cable', cab.id);
      // A selected block's cables glow and carry the harness's soft current (as a selected connector's
      // wires do), and the rest fade (Chris, 2026-11-12).
      const linked = !on && !!sel && sel.kind === 'block' && Object.values(cab.ends).some(e => e && e.block === sel.block);
      // Cables alone selected together (a harness used more than once, picked in the menu) stand out as one does.
      const cablesOnly = !!sel && sel.kind === 'multi' && !sel.blocks.length;
      const color = colorOf(cab) || (st.key === 'wired' ? 'var(--accent)' : st.key === 'placeholder' || st.key === 'link' ? 'var(--text-3)' : st.key === 'bought' ? 'var(--text-2)' : 'var(--issue)');
      const wire = (d, extra) => `<path class="sys-hit" d="${d}"/><path class="w-edge" d="${d}"/><path class="w-base" style="stroke:${color}" d="${d}"/>` +
        (st.key === 'placeholder' || st.key === 'link' || extra === 'open' ? '' : `<path class="w-gloss" d="${d}"/>`) + (on ? `<path class="w-pulse" pathLength="1" d="${d}"/>` : linked ? `<path class="w-pulse soft" pathLength="1" d="${d}"/>` : '');
      // While a cable is selected, however it was picked, the others fade (Chris, 2026-11-12).
      const dim = !on && !!sel && (sel.kind === 'cable' || cablesOnly || (sel.kind === 'block' && !linked));
      // The one selected cable, while the others fade, is drawn half again as wide with a glow (Chris).
      const solo = on && !!sel && (sel.kind === 'cable' || cablesOnly);
      html += `<g class="w sys-w st-${st.key}${on ? ' sel' : ''}${solo ? ' solo' : ''}${linked ? ' linked' : ''}${dim ? ' dim' : ''}" data-cable="${cab.id}">`;
      let mid = null, ring = null, lane = routes.length && routes[0].pts ? laneOfPts(routes[0].pts) : null;
      routes.forEach(r => { html += wire(r.d); });
      if (routes.length) mid = midOf(routes[0]);
      // Ends not plugged in yet: a dashed stub ending in a ring, off the one plugged end or the middle.
      const open = ends.length - at.length;
      const D = dev && dev.length ? devLayout(s).get(cab.id) : null;
      if (D) {
        // A harness ending at its own device: drawn as itself (devLayout), its wires in their colors out to
        // its far ends; no route between its connectors (they meet at the device, not in the system). The far
        // ends drag (data-devgrab).
        const tip = esc(`${titleOf(cab, h)} · ${dev.join(', ')} · drag the far ends to move them`);
        html += `<g class="sys-dharn"><title>${tip}</title>` + D.paths.map(p => `<path class="sys-dhit" d="${p.d}"/>`).join('') +
          D.paths.map(p => `<path class="sys-dglow" d="${p.d}"/>`).join('') +
          D.paths.map(p => `<path class="sys-dedge" d="${p.d}"/><path class="sys-dwire${p.ghost ? ' ghost' : ''}"${p.color ? ` style="stroke:${p.color}"` : ''} d="${p.d}"/>` + (p.stripe ? `<path class="sys-dstripe" style="stroke:${p.stripe}" d="${p.d}"/>` : '')).join('') +
          D.juncs.map(j => `<circle class="sys-djunc" cx="${j.x}" cy="${j.y}" r="4.5"><title>${esc(j.ref)}</title></circle>`).join('') +
          D.boxes.map(x => `<g class="sys-dend" data-devgrab="${cab.id}"><title>${esc(x.full)}</title><rect class="sys-dbox${x.ghost ? ' ghost' : ''}" x="${x.x}" y="${x.y}" width="${x.w}" height="${x.h}" rx="3"/><text class="sys-dtext" x="${x.cx}" y="${x.cy}">${esc(x.label)}</text></g>`).join('') +
          D.leads.map(l => `<g class="sys-dend" data-devgrab="${cab.id}"><title>${esc(l.full)}</title>${l.dots.map(q => `<circle class="sys-ddot"${q.color ? ` style="fill:${q.color}"` : ''} cx="${q.x}" cy="${q.y}" r="4.2"/>`).join('')}<text class="sys-dtext lead" x="${l.lx}" y="${l.ly}" style="text-anchor:${l.anchor}">${esc(l.label)}</text></g>`).join('') +
          (D.cap ? `<g class="sys-dend" data-devgrab="${cab.id}"><text class="sys-dcap${on ? ' sel' : ''}" x="${D.cap.x}" y="${D.cap.y}">${esc(D.cap.text)}</text></g>` : '') + '</g>';
        // Its name is the caption over its far ends, not a floating label.
        lane = null; mid = null;
      } else if (at.length === 1) {
        const g = at[0].g, x2 = g.ex + g.dx * STUB_U * 2.2, y2 = g.ey + g.dy * STUB_U * 2.2;
        html += `<g class="sys-open">${wire(`M${g.ex} ${g.ey}L${x2} ${y2}`, 'open')}<circle class="sys-ring" cx="${x2}" cy="${y2}" r="5"/></g>`;
        if (!lane) lane = laneOfPts([{ x: g.ex, y: g.ey }, { x: x2, y: y2 }]);
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
      if (mid && labelsOn()) {
        const raw = `${st.glyph} ${titleOf(cab, h)}${pnOf(h, cab) ? ' · ' + pnOf(h, cab) : ''}`, t = esc(raw), cls = `sys-clabel${on ? ' sel' : ''}${dim ? ' dim' : ''}`, tw0 = U.textW(raw, 11);
        const set = cab.labelAt != null || cab.labelOff != null;
        // Where it has always been, unset: by the route's middle, or along a device stub past its mark.
        const t0 = cab.labelAt != null ? cab.labelAt : routes.length ? 0.5 : 1;
        const dot = lane ? laneAt(lane, t0) : { x: mid.x, y: mid.y };
        let x0, y0, rot = 0, end = false;
        if (cab.labelOff) { x0 = dot.x + cab.labelOff.dx * K; y0 = dot.y + cab.labelOff.dy * K; }
        else if (!set && mid.dx != null && mid.dy) { x0 = mid.x + 3.5; y0 = mid.y + mid.dy * 9; rot = mid.dy > 0 ? 90 : -90; }
        else if (!set && mid.dx != null) { x0 = mid.x + mid.dx * 9; y0 = mid.y + 3.5; end = mid.dx < 0; }
        else { x0 = dot.x + 8; y0 = dot.y - 9; }
        labInfo.set(cab.id, { lane, t: t0, dot, off: { dx: (x0 - dot.x) / K, dy: (y0 - dot.y) / K }, rot });
        const ax = end ? x0 + 4 : x0 - 4, ay = y0 - 4, lead = !rot && Math.hypot(ax - dot.x, ay - dot.y) > 10 ? `<path class="sys-ldot-lead${dim ? ' dim' : ''}" d="M${dot.x} ${dot.y}L${ax} ${ay}"/>` : '';
        const gx = end ? x0 - tw0 - 5 : x0 - 5, body = `<rect class="sys-lgrab" x="${gx}" y="${y0 - 12}" width="${tw0 + 10}" height="16" rx="5"/><text class="${cls}" x="${x0}" y="${y0}"${end ? ' style="text-anchor:end"' : ''}>${t}</text>`;
        labels += `<g class="sys-lab${on ? ' sel' : ''}${S.slide === cab.id ? ' slide' : ''}" data-clabel="${cab.id}"><title>Drag the label anywhere, or its dot along the cable</title>${lead}` +
          (rot ? `<g transform="rotate(${rot} ${x0} ${y0})">${body}</g>` : body) +
          (lane ? `<circle class="sys-ldot-hit" cx="${dot.x}" cy="${dot.y}" r="8" data-cldot="${cab.id}"/><circle class="sys-ldot${dim ? ' dim' : ''}" cx="${dot.x}" cy="${dot.y}" r="3"/>` : '') + '</g>';
      }
      // The selected cable's middle runs drag, as the editor's wires' do (connect.js handles).
      if (on) routes.forEach(r => CN().handles(r).forEach(R => {
        const mx = (R.a.x + R.b.x) / 2, my = (R.a.y + R.b.y) / 2, v = R.axis === 'v';
        handles += `<g class="cv-run ${v ? 'v' : 'h'}" data-run="${cab.id}|${r.end}|${R.j}"><rect class="cv-run-hit" x="${mx - (v ? 8 : 14)}" y="${my - (v ? 14 : 8)}" width="${v ? 16 : 28}" height="${v ? 28 : 16}"/>` +
          `<rect class="cv-run-bar" x="${mx - (v ? 2.5 : 9)}" y="${my - (v ? 9 : 2.5)}" width="${v ? 5 : 18}" height="${v ? 18 : 5}" rx="2.5"/></g>`;
      }));
    });
    return html + '</g><g class="sys-labels">' + labels + '</g><g class="sys-handles">' + handles + '</g><g id="sys-ghost"></g>';
  }
  function bounds(s) {
    if (!s.blocks.length) return { x: -80, y: -80, w: 800, h: 480 };
    const E = drawnExtent(s), x0 = E.x, y0 = E.y, x1 = E.x + E.w, y1 = E.y + E.h;
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
    if (t && t.kind === 'wire') return wirePanelHtml(s, t);
    if (t && t.kind === 'end') return endPanelHtml(s, t);
    if (t && t.kind === 'conn') return connHtml(s, block(s, t.block), conn(block(s, t.block), t.conn));
    if (t && t.kind === 'block') return blockHtml(s, block(s, t.block));
    if (t && t.kind === 'cable') return cableHtml(s, cable(s, t.id));
    if (t && t.kind === 'multi') return multiHtml(s, t);
    const c = checks(s, get);
    return `<div class="rail-head"><div class="eyebrow">System</div><div class="rail-title">${esc(s.title)}</div></div>` +
      fld('Title', inp('title', s.title)) + fld('Client project', inp('project', s.project, ' list="sys-projects"') + `<datalist id="sys-projects">${A.projects().map(p => `<option value="${esc(p)}">`).join('')}</datalist>`) + fld('Rev', inp('rev', s.rev)) +
      `<div class="sys-actions">${btn('add-board', 'Add a board from Signoff EE', '', 'btn-primary')}${btn('add-drawn', 'Draw a board')}${btn('add-device', 'Add a device')}${btn('add-system', 'Place a system')}</div>` +
      placedHtml(s) +
      `<h4 class="sys-h">Cables <span class="count">${s.cables.length}</span></h4>` +
      (s.cables.length ? `<div class="sys-list">${s.cables.map(cab => { const h = harnessOf(cab), st = statusOf(cab, h); return `<button class="sys-row" data-ssel="cable:${cab.id}"><span class="sys-st st-${st.key}" title="${esc(st.text)}">${st.glyph}</span><span>${esc(titleOf(cab, h))}<small>${esc([pnOf(h, cab), endsOf(cab, h).map(n => endName(s, cab.ends[n.id]) || n.ref + ' not plugged').join(' · ')].filter(Boolean).join(' · '))}</small></span></button>`; }).join('')}</div>` : '<p class="hint">Click a connector on a board, then another, to connect them.</p>') +
      `<h4 class="sys-h">Checks <span class="count">${c.length}</span></h4>` + checksHtml(c) +
      `<div class="sys-actions">${btn('delete-system', 'Delete system', '', 'btn-danger')}</div>`;
  }
  // Where this system is placed, and the connectors it shows there.
  function placedHtml(s) {
    const ps = parentsOf(s.id), ex = externals(s);
    return (ps.length ? `<h4 class="sys-h">Placed in <span class="count">${ps.length}</span></h4><div class="sys-list">${ps.map(p => `<button class="sys-row" data-sact="open-system" data-sys="${p.id}"><span class="sys-st">${'\u25a3'}</span><span>${esc(p.title)}<small>${esc(p.blocks.filter(b => b.kind === 'system' && b.system === s.id).map(b => b.ref).join(', '))}</small></span></button>`).join('')}</div>` : '') +
      `<h4 class="sys-h">External connectors <span class="count">${ex.length}</span></h4>` +
      (ex.length ? `<div class="sys-list">${ex.map(e => `<button class="sys-row" data-ssel="conn:${e.bid}:${e.cid}"><span class="sys-st">${'\u25b8'}</span><span>${esc(e.ref)}<small>${esc([e.fn, e.pins.length + ' pins'].filter(Boolean).join(' · '))}</small></span></button>`).join('')}</div>`
        : '<p class="hint">Tick Make external on a connector to show it on this system’s block when it’s placed in another system.</p>');
  }
  // Several selected: a row for each, which opens it, and Delete for them all.
  function multiHtml(s, t) {
    const bs = t.blocks.map(id => block(s, id)).filter(Boolean), cs = t.cables.map(id => cable(s, id)).filter(Boolean);
    const words = [bs.length ? bs.length + (bs.length > 1 ? ' blocks' : ' block') : '', cs.length ? cs.length + (cs.length > 1 ? ' cables' : ' cable') : ''].filter(Boolean).join(', ');
    return `<div class="rail-head"><div class="eyebrow">Selected</div><div class="rail-title">${esc(words)}</div></div>` +
      (bs.length ? `<h4 class="sys-h">Blocks <span class="count">${bs.length}</span></h4><div class="sys-list">${bs.map(b => `<button class="sys-row" data-ssel="block:${b.id}"><span class="sys-st">▭</span><span>${esc(b.ref)} · ${esc(b.name)}</span></button>`).join('')}</div>` : '') +
      (cs.length ? `<h4 class="sys-h">Cables <span class="count">${cs.length}</span></h4><div class="sys-list">${cs.map(cab => { const h = harnessOf(cab), st = statusOf(cab, h); return `<button class="sys-row" data-ssel="cable:${cab.id}"><span class="sys-st st-${st.key}" title="${esc(st.text)}">${st.glyph}</span><span>${esc(titleOf(cab, h))}</span></button>`; }).join('')}</div>` : '') +
      `<p class="hint">Drag any selected block to move them all. Shift-drag a box to add more.</p>` +
      `<div class="sys-actions">${btn('delete-multi', 'Delete ' + words, '', 'btn-danger')}</div>`;
  }
  function checksHtml(c) {
    if (!c.length) return '<p class="hint">No problems found.</p>';
    return `<div class="sys-checks">${c.map((x, i) => `<button class="sys-check ${x.sev}" data-scheck="${i}"><span class="sev">${x.sev === 'error' ? '■' : '▲'}</span>${esc(x.text)}</button>`).join('')}</div>`;
  }
  function addingHtml() {
    if (S.adding === 'system') {
      const s = cur(), list = live().filter(x => x.id !== s.id && !places(x, s.id)).sort((a, b) => String(a.title).localeCompare(String(b.title)));
      return `<div class="rail-head"><div class="eyebrow">Place a system</div><div class="rail-title">In ${esc(s.title)}</div></div>` +
        '<p class="hint">Placed by link: edits to it show here and wherever else it’s placed. Its block’s connectors are its external ones.</p>' +
        (list.length ? `<div class="sys-list">${list.map(x => { const n = externals(x).length; return `<button class="sys-row" data-sact="place-system" data-sys="${x.id}"><span class="sys-st">${'\u25a3'}</span><span>${esc(x.title)}<small>${esc([x.project, n + ' external connector' + (n === 1 ? '' : 's')].filter(Boolean).join(' · '))}</small></span></button>`; }).join('')}</div>` : '<p class="hint">No other system can go here (a system can’t hold one that holds it).</p>') +
        btn('cancel-add', 'Cancel');
    }
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
  function sysBlockHtml(s, b) {
    const ch = childOf(b);
    return `<div class="rail-head"><div class="eyebrow">System ${esc(b.ref)}</div><div class="rail-title">${esc(ch ? ch.title : 'Missing system')}</div></div>` +
      fld('Ref', inp('b.ref', b.ref)) +
      (ch ? `<p class="hint">Placed by link: edits to ${esc(ch.title)} show here and wherever else it’s placed.</p><div class="sys-actions">${btn('open-system', 'Open ' + esc(ch.title), ` data-sys="${ch.id}"`, 'btn-primary')}</div>`
        : '<p class="hint">The system it placed isn’t here any more.</p>') +
      `<div class="field-row">${fld('Width, mm', inp('b.w', b.w, ' type="number" min="5"'))}${fld('Height, mm', inp('b.h', b.h, ' type="number" min="5"'))}</div>` +
      `<h4 class="sys-h">Connectors <span class="count">${b.conns.length} external</span></h4>` +
      (b.conns.length ? `<div class="sys-list">${b.conns.map(c => `<button class="sys-row" data-ssel="conn:${b.id}:${c.id}"><span class="sys-st">${pluggedAt(s, b.id, c.id).length ? '\u25cf' : '\u25cb'}</span><span>${esc(c.ref)}<small>${esc([c.fn, c.pins.length + ' pins'].filter(Boolean).join(' · '))}</small></span></button>`).join('')}</div>`
        : `<p class="hint">None yet: open ${esc(ch ? ch.title : 'it')} and tick Make external on the connectors it shares.</p>`) +
      `<div class="sys-actions">${btn('dup-block', 'Copy this block')}${btn('delete-block', 'Delete', '', 'btn-danger')}</div>`;
  }
  function blockHtml(s, b) {
    if (b.kind === 'system') return sysBlockHtml(s, b);
    const used = b.conns.filter(c => fitted(c) && c.used).length, pop = b.conns.filter(fitted).length;
    return `<div class="rail-head"><div class="eyebrow">${b.kind === 'device' ? 'Device' : 'Board'} ${esc(b.ref)}</div><div class="rail-title">${esc(b.name)}</div></div>` +
      fld('Ref', inp('b.ref', b.ref)) + fld('Name', inp('b.name', b.name)) +
      (b.source ? `<p class="hint">From Signoff EE: ${esc(b.source.name)}${b.source.label ? ' · ' + esc(b.source.label) : ''}. ${esc(String(b.w))} × ${esc(String(b.h))} mm, ${shaped(b) ? `drawn as its outline${b.shape.file ? ' (' + esc(b.shape.file) + ')' : ''}${picOf(b) ? ' with Fabcheck’s picture of its top' : ''}` : 'from its pick-and-place and netlist. Refresh to draw it as its outline, when its package has one'}.</p><div class="sys-actions">${btn('refresh-board', S.busy ? 'Reading…' : 'Refresh from Signoff EE', S.busy ? ' disabled' : '')}${btn('open-ee', 'Open in Signoff EE')}</div>`
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
    const linkTab = b.kind === 'system', ps = parentsOf(s.id);
    const extTick = `<label class="tick sys-used" title="Show it on this system’s block wherever it’s placed in another system"><input type="checkbox" data-sext="${c.id}"${c.external ? ' checked' : ''}${fitted(c) ? '' : ' disabled'}> Make external</label>`;
    return `<div class="rail-head"><div class="eyebrow">${esc(b.ref)} · ${esc(b.name)}</div><div class="rail-title">${esc(c.ref)}</div></div>` +
      (linkTab ? `<p class="hint">Inside ${esc(c.inside)}.</p><div class="sys-actions">${btn('open-system', 'Open ' + esc(b.name), ` data-sys="${b.system}"`)}</div><div class="sys-flags">${extTick}</div>`
        : `<div class="sys-flags"><label class="tick sys-used"><input type="checkbox" data-sfit="${c.id}"${fitted(c) ? ' checked' : ''}> Populated</label>` +
          `<label class="tick sys-used"><input type="checkbox" data-sused="${c.id}"${fitted(c) && c.used ? ' checked' : ''}${fitted(c) ? '' : ' disabled'}> Used</label>${extTick}</div>`) +
      (c.external ? `<p class="hint">External: shown on ${esc(s.title)}’s block ${ps.length ? 'in ' + esc(ps.map(p => p.title).join(', ')) : 'wherever it’s placed (it isn’t placed in another system yet)'}, where a cable plugs into it.</p>` : '') +
      (fitted(c) ? '' : `<p class="hint">Not populated${c.placed === 'netlist' && c.fitted == null ? ': it isn’t in the pick-and-place, so it isn’t fitted in that build variant' : ''}. It’s drawn faint and can’t take a cable.</p>`) +
      fld('Function', inp('c.fn', c.fn, ' placeholder="What it connects to: Fan, Display, 24 VAC in…"')) +
      (b.source || linkTab ? '' : `<div class="field-row">${fld('Ref', inp('c.ref', c.ref))}${fld('Pins', inp('c.pins', c.pins.length, ' type="number" min="1" max="200"'))}</div>`) +
      (!b.source || c.placed === 'hand' ? `<div class="field-row">${fld('X on the block, mm', inp('c.x', c.x, ' type="number" step="0.5"'))}${fld('Y, mm', inp('c.y', c.y, ' type="number" step="0.5"'))}</div>` : '') +
      (c.mpn || c.desc ? `<p class="hint">${esc([c.mfr, c.mpn, c.desc].filter(Boolean).join(' · '))}${c.side === 'bottom' ? ' · bottom side' : ''}${c.placed === 'hand' && b.source ? ' · not in the pick-and-place or the netlist, placed by hand' : c.placed === 'netlist' ? ' · not in the pick-and-place (not fitted in its build variant?), placed at its pads in the netlist' : ''}</p>` : '') +
      `<h4 class="sys-h">Plugged in</h4>` +
      (at.length ? `<div class="sys-list">${at.map(x => { const h = harnessOf(x.cable), n = endsOf(x.cable, h).find(e => e.id === x.node), st = statusOf(x.cable, h); return `<button class="sys-row" data-ssel="cable:${x.cable.id}"><span class="sys-st st-${st.key}" title="${esc(st.text)}">${st.glyph}</span><span>${esc(titleOf(x.cable, h))}<small>${esc(n ? 'its end ' + n.ref : '')}</small></span></button>`; }).join('')}</div>` : '<p class="hint">Nothing yet.</p>') +
      (pick ? pickHtml(s, b, c) : `<div class="sys-actions">${btn('new-harness', 'New harness here', '', 'btn-primary')}${btn('pick-harness', 'Plug in a harness…')}</div>`) +
      (S.pair && S.pair.block !== b.id || S.pair && S.pair.conn !== c.id ? '' : '') +
      fld('Cables leave from', `<select class="input" data-sexit="${c.id}">${[['', 'The nearest board edge (' + exitSide(b, Object.assign({}, c, { exit: '' })) + ')'], ['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']].map(([v, l]) => `<option value="${v}"${(c.exit ? turnSide(c.exit, rotOf(b)) : '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`) +
      pinoutHtml(b, c) +
      (b.source || linkTab ? '' : `<div class="sys-actions">${btn('delete-conn', 'Delete connector', '', 'btn-danger')}</div>`);
  }
  // The pinout: each pin and its net name, from a Signoff EE board's netlist (Chris, 2026-11-11: pin and
  // net name only, for checking connections later). A drawn block's pins take net names by hand.
  function pinoutHtml(b, c) {
    const rows = c.pins.map((p, i) => {
      const net = p.label || p.net || '';
      const cell = b.source || c.link ? (net ? esc(net) : '<span class="sys-none">no net</span>') : `<input class="input sys-pinnet" data-spin="${c.id}|${i}" value="${esc(net)}" placeholder="Net name">`;
      return `<tr><td class="sys-pin">${esc(p.pin)}</td><td class="sys-net">${cell}</td></tr>`;
    }).join('');
    const L = look(b, c).b.source;
    const src = c.link ? `From ${esc(c.inside)}${L ? ', ' + esc(L.name) + '’s netlist' : ''}.` : b.source ? `From ${esc(b.source.name)}’s netlist${b.source.label ? ', ' + esc(b.source.label) : ''}.` : 'Name each pin’s net, as the far end calls it.';
    return `<h4 class="sys-h">Pinout <span class="count">${c.pins.length} pins</span></h4><p class="hint">${src}</p>` +
      `<div class="sys-pinwrap"><table class="sys-pintab"><thead><tr><th>Pin</th><th>Net</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function pickHtml(s, b, c) {
    const list = A.harnesses().filter(h => harnessEnds(h).length);
    const L = look(b, c);
    const score = h => { const n = bestEnd(s, null, h, b, c); return n && n.board && L.b.source && n.board.project === L.b.source.id && n.board.ref === L.c.ref ? 0 : n && M.pinList(n).length === c.pins.length ? 1 : 2; };
    list.sort((x, y) => score(x) - score(y) || String(x.title).localeCompare(String(y.title)));
    return `<h4 class="sys-h">Plug in</h4><div class="sys-list">${list.map(h => { const sc = score(h); return `<button class="sys-row" data-sact="plug" data-harness="${h.id}"><span class="sys-st">${sc === 0 ? '★' : sc === 1 ? '=' : '·'}</span><span>${esc(h.title)}<small>${esc([h.pn, sc === 0 ? 'made from this connector' : sc === 1 ? 'same pin count' : '', h.project].filter(Boolean).join(' · '))}</small></span></button>`; }).join('') || '<p class="hint">No harnesses yet.</p>'}</div>${btn('cancel-pick', 'Cancel')}`;
  }
  // Color: the status color, one of Loom's wire colors, or a custom one with a picker.
  function colorField(cab) {
    const c = cab.color || '', custom = HEX.test(c);
    const opts = `<option value=""${c ? '' : ' selected'}>Its state's color</option>` +
      Object.keys(M.COLORS).map(k => `<option value="${k}"${c === k ? ' selected' : ''}>${esc(M.COLORS[k][0])}</option>`).join('') +
      `<option value="custom"${custom ? ' selected' : ''}>Custom…</option>`;
    return fld('Color', `<div class="sys-color"><span class="swatch" style="background:${colorOf(cab) || 'transparent'}"></span><select class="input" data-scolor="${cab.id}">${opts}</select>` +
      (custom ? `<input type="color" class="sys-color-pick" data-scolorpick="${cab.id}" value="${esc(c)}" title="Pick a color">` : '') + '</div>',
      c ? '' : 'Unset, the cable shows its state: wired, placeholder, in progress, purchased, or generic.');
  }
  function cableHtml(s, cab) {
    const k = kindOf(cab), h = harnessOf(cab), st = statusOf(cab, h);
    const opts = cur => `<option value="">Not plugged</option>` + s.blocks.map(b => b.conns.map(c => `<option value="${b.id}|${c.id}"${cur && cur.block === b.id && cur.conn === c.id ? ' selected' : ''}>${esc(`${b.ref} ${c.ref}${c.fn ? ' · ' + c.fn : ''}`)}</option>`).join('')).join('');
    const kind = fld('What it is', `<select class="input" data-skind="${cab.id}">${Object.keys(KINDS).map(x => `<option value="${x}"${x === k ? ' selected' : ''}>${KINDS[x]}</option>`).join('')}</select>`,
      k === 'link' ? 'A connection with nothing to build or buy yet. Make it a purchased cable or a Loom harness when you know which.' : k === 'harness' ? '' : 'Bought ready-made: its part number goes in the system’s BOM.');
    const endsHtml = endsOf(cab, h).map(n => fld(`${esc(n.ref)}${n.name ? ' · ' + esc(n.name) : ''} plugs into`, `<select class="input" data-send="${n.id}">${opts(cab.ends[n.id])}</select>`)).join('');
    const routes = cab.routes && Object.keys(cab.routes).length ? btn('reset-route', 'Reset route') : '';
    const head = `<div class="rail-head"><div class="eyebrow">${KINDS[k]}</div><div class="rail-title">${esc(titleOf(cab, h))}</div></div>`;
    if (k !== 'harness') {
      return head + kind + fld('Name', inp('cab.name', cab.name || '', k === 'link' ? ' placeholder="USB, 24 VAC, CAN…"' : ' placeholder="USB-C cable, 1 m"')) +
        (k === 'bought' ? `<div class="field-row">${fld('Part number', inp('cab.pn', cab.pn || ''))}${fld('Length, mm', inp('cab.len', cab.lengthMm || '', ' type="number" min="1"'))}</div>` +
          `<div class="field-row">${fld('Maker', inp('cab.mfr', cab.mfr || ''))}${fld('Maker’s part number', inp('cab.mpn', cab.mpn || ''))}</div>` : '') +
        endsHtml + colorField(cab) + `<div class="sys-actions">${routes}${btn('delete-cable', 'Remove from the system', '', 'btn-danger')}</div>`;
    }
    return head + kind +
      `<p class="hint"><span class="sys-st st-${st.key}">${st.glyph}</span> ${esc(st.text)}${h && h.pn ? ' · ' + esc(h.pn) : ''}</p>` +
      (h ? endsHtml : '') + colorField(cab) +
      fld('Length here, mm', inp('cab.len', cab.lengthMm || '', ' type="number" min="1" placeholder="The harness’s own"'), cab.lengthMm ? `A variant at this length: <b>${esc(pnOf(h, cab))}</b>.` : 'Set it to use this harness at another length, as a variant part number.') +
      `<div class="sys-actions">${h ? btn('open-harness', 'Open the harness', '', 'btn-primary') : ''}${routes}${btn('delete-cable', 'Remove from the system', '', 'btn-danger')}</div>`;
  }
  // A cable made another kind (the panel's What it is): its plugged ends carry over in order, and so
  // does each kept route, under its new end. To a Loom harness, a new harness is made from the plugged
  // connectors (as New harness here, with the shared-net wires for two). The old harness stays.
  function rekind(s, cab, to) {
    const from = kindOf(cab);
    if (from === to) return;
    const h = harnessOf(cab), olds = endsOf(cab, h).map(n => n.id), plugged = olds.filter(id => cab.ends[id]);
    let news, made = null;
    if (to === 'harness') {
      const two = plugged.slice(0, 2).map(id => { const b = block(s, cab.ends[id].block); return look(b, conn(b, cab.ends[id].conn)); }).filter(x => x.c);
      if (!two.length) { A.toast('Plug an end into a connector first: the harness is made from it.', 'error'); return; }
      made = A.newHarness(s, two);
      news = made.ends;
    } else news = TWO.map(e => e.id);
    change(x => {
      const c = cable(x, cab.id), ends = {}, routes = {};
      news.forEach(id => { ends[id] = null; });
      plugged.forEach((id, i) => { if (news[i] != null) { ends[news[i]] = c.ends[id]; if (c.routes && c.routes[id]) routes[news[i]] = c.routes[id]; } });
      c.kind = to; c.ends = ends;
      if (Object.keys(routes).length) c.routes = routes; else delete c.routes;
      if (to === 'harness') { c.harness = made.h.id; c.lengthMm = null; } else delete c.harness;
      if (from === 'harness' && to !== 'harness' && !c.name && h) c.name = h.title;
    });
    if (made) A.toast(`Made ${made.h.title}${made.suggested ? `, with ${made.suggested} wires from shared nets` : ''}. Open it to wire it.`);
  }

  // How it works (Chris, 2026-11-12: as the harness editor's card): a ? in the panel's bottom right opens a
  // card of the moves over the panel's bottom. Open until closed, remembered in this browser.
  const helpOpen = () => { try { return localStorage.getItem(NS + 'sysHelp') !== 'closed'; } catch (e) { return true; } };
  function helpHtml() {
    const open = helpOpen();
    return (open ? `<div class="pane-help" role="dialog" aria-label="How it works"><div class="hp-head"><b>How it works</b><button class="hp-close" data-sact="help" title="Close" aria-label="Close">\u00d7</button></div>
        <p><i>●</i> Click a connector, then another, to connect them. Esc cancels.</p>
        <p><i>✥</i> Drag a block to move it; it snaps to the grid. Hold Ctrl to place it anywhere. R turns a selected block 90°, Shift+R back.</p>
        <p><i>⬚</i> Drag on empty canvas to select: left to right picks what's inside, right to left what the box touches. Shift-click adds or removes one. Drag any selected block to move them all.</p>
        <p><i>⌐</i> Cables find their way round the blocks. Drag a straight run sideways to shape it, Shift-drag to break it where you grab it, and double-click to add a bend. Near straight, it snaps straight.</p>
        <p><i>◦</i> Drag a cable's label anywhere, or its dot along the cable. Cable labels, at the bottom right, shows or hides them.</p>
        <p><i>○</i> Drag a cable's end dot onto another connector to plug it there, or off to leave it open. Right-click a cable to walk around blocks or go behind them.</p>
        <p><i>↔</i> Right or middle drag pans, the wheel zooms, and F fits.</p></div>` : '') +
      `<button class="pane-help-btn${open ? ' on' : ''}" data-sact="help" title="How it works" aria-label="How it works" aria-expanded="${open}">?</button>`;
  }

  // ── List: the focus and what it holds, as a table (Chris, 2026-11-12: a start; not fully designed) ──
  // A system: each block, its used or plugged connectors, the cables plugged into each, and a harness
  // cable's wires from that end (pin, signal, color, gauge, far end, and length). A harness: its ends, where
  // they plug in, and its wires. Each item says what it is and its part number beside its name, and a click
  // shows it in the panel on the right (Chris, 2026-11-12: its full info and settings, and Open in Loom).
  const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
  const gaugeMetric = g => (g ? (M.AWG[g] ? `${M.AWG[g]} mm² (${g} AWG)` : `${g} AWG`) : '');
  function swatchHtml(code) {
    const c = M.colorInfo(code);
    if (!c.code) return '<span class="sys-none">—</span>';
    const bg = c.stripe ? `linear-gradient(135deg, ${c.base} 0 40%, ${c.stripe} 40% 60%, ${c.base} 60%)` : c.base;
    return `<span class="sys-wsw" style="background:${bg}"></span>${esc(c.name)}`;
  }
  const focusAttr = (kind, id, path) => ` data-sfocus="${esc(kind + '|' + id + '|' + path)}"`;
  // root › … › the system shown, each a link that focuses it.
  function crumbsHtml(path, tail) {
    const ids = String(path).split('>');
    const parts = ids.map((id, i) => { const x = S.store[id]; return x ? `<button class="sys-crumb"${focusAttr('system', id, ids.slice(0, i + 1).join('>'))}>${esc(x.title)}</button>` : ''; });
    return `<div class="sys-crumbs">${parts.concat(tail ? [`<span>${esc(tail)}</span>`] : []).join('<span class="sep">›</span>')}</div>`;
  }
  function listHead(eyebrow, title, sub, crumbs, actions) {
    return `<div class="page-head lm-head"><div class="page-head-text">${crumbs}<div class="eyebrow">${eyebrow}</div><h1 class="page-title">${esc(title)}</h1>${sub ? `<div class="page-sub">${sub}</div>` : ''}</div>${actions ? `<div class="lm-actions">${actions}</div>` : ''}</div>`;
  }
  // A harness's analysis (wire lengths), kept until it changes: List redraws on every refresh.
  const ANALYSES = new WeakMap();
  const an = h => { const k = h.updated + '|' + h.wires.length, x = ANALYSES.get(h); if (x && x.k === k) return x.a; const a = M.analyze(h); ANALYSES.set(h, { k, a }); return a; };
  // What each item is, and its part number (or "no P/N").
  const NOPN = 'no P/N';
  function blockType(b) {
    if (b.kind === 'system') return 'System · placed by link';
    if (b.source) return `Board · Signoff EE · ${b.source.name}${b.source.label ? ' ' + b.source.label : ''}`;
    return `${b.kind === 'device' ? 'Device' : 'Board'} · generic · ${NOPN}`;
  }
  const connType = c => (c.link ? `External connector · inside ${c.inside}` : `Connector · ${[c.mfr, c.mpn].filter(Boolean).join(' ') || NOPN}`);
  function cableType(cab, h) {
    const k = kindOf(cab);
    if (k === 'harness') return `Loom harness · ${h ? h.title : 'missing'} · ${pnOf(h, cab) || NOPN}`;
    if (k === 'bought') return `Purchased cable · ${cab.pn || NOPN}${cab.mpn ? ' · ' + [cab.mfr, cab.mpn].filter(Boolean).join(' ') : ''}`;
    return `Generic connection · ${NOPN}`;
  }
  const endType = n => `${LM.library ? LM.library.kindName(n) : 'Connector'} · ${n.mpn || NOPN}`;
  // A small › beside a placed system or harness lists just it (the row itself selects).
  const drill = (kind, id, path, word) => `<button class="sys-drill"${focusAttr(kind, id, path)} title="List just this ${word}" aria-label="List just this ${word}">›</button>`;
  const typeHtml = t => `<span class="sys-wtype">${esc(t)}</span>`;
  // The list's rows select as the canvas does (data-ssel), plus a harness's wires and ends.
  const selKey = t => (!t ? '' : t.kind === 'block' ? 'block:' + t.block : t.kind === 'conn' ? `conn:${t.block}:${t.conn}` : t.kind === 'cable' ? 'cable:' + t.id
    : t.kind === 'wire' ? `wire:${t.harness}:${t.wire}:${t.cable || ''}` : t.kind === 'end' ? `end:${t.harness}:${t.node}` : '');
  function parseSel(key) {
    const [k, x, y, z] = key.split(':');
    return k === 'cable' ? { kind: 'cable', id: x } : k === 'block' ? { kind: 'block', block: x } : k === 'conn' ? { kind: 'conn', block: x, conn: y }
      : k === 'wire' ? { kind: 'wire', harness: x, wire: y, cable: z || null } : k === 'end' ? { kind: 'end', harness: x, node: y } : null;
  }
  const rowAttr = (key, cls) => ` class="sys-wr ${cls}${key === selKey(S.sel) ? ' on' : ''}" data-ssel="${esc(key)}"`;
  const HEAD = '<thead><tr><th>Item</th><th>Pin</th><th>Signal</th><th>Color</th><th>Gauge</th><th>Far end</th><th class="num">Length</th></tr></thead>';
  const item = (lvl, html) => `<td class="sys-wi" style="--lvl:${lvl}">${html}</td>`;
  // The system a list shows: the picked system, the one holding a picked harness, or the open system.
  const listSys = f => (f ? (f.kind === 'harness' ? focusSys(f) : f.id) : S.root);
  function listHtml() {
    const f = S.focus;
    if (f && f.kind === 'harness') return harnessListHtml(f);
    const s = S.store[listSys(f)];
    if (!s) return '';
    const path = f ? f.path : S.root;
    let rows = '', nCab = 0, nWire = 0;
    const cableRows = (cab, here, lvl, c) => {
      const h = harnessOf(cab), st = statusOf(cab, h), ends = endsOf(cab, h);
      const far = ends.filter(n => n.id !== here).map(n => endName(s, cab.ends[n.id]) || `${n.ref} not plugged`)
        .concat(deviceEnds(h).map(n => `${n.ref} at its device`));
      const title = `<b class="sys-wname">${esc(titleOf(cab, h))}</b>` + (h ? drill('harness', h.id, path, 'harness') : '');
      nCab++;
      rows += `<tr${rowAttr('cable:' + cab.id, 'cab')}>${item(lvl, `<span class="sys-st st-${st.key}" title="${esc(st.text)}">${st.glyph}</span> ${title} ${typeHtml(cableType(cab, h))}`)}<td></td><td></td><td></td><td></td><td>${esc(far.join(', ') || '—')}</td><td class="num">${cab.lengthMm ? U.fmtLen(cab.lengthMm) : ''}</td></tr>`;
      const n = h && here && M.node(h, here);
      if (!n) return;
      const A0 = an(h);
      h.wires.map(w => ({ w, at: w.from.node === n.id ? w.from : w.to.node === n.id ? w.to : null, to: w.from.node === n.id ? w.to : w.from }))
        .filter(x => x.at).sort((a, b) => natural(a.at.pin, b.at.pin)).forEach(({ w, at, to }) => {
          const pin = c && c.pins.find(p => String(p.pin) === String(at.pin)), net = pin ? pin.label || pin.net || '' : '';
          const tn = M.node(h, to.node), where = tn && cab.ends[tn.id] ? endName(s, cab.ends[tn.id]) : tn && tn.atDevice ? 'at its device' : '';
          nWire++;
          rows += `<tr${rowAttr(`wire:${h.id}:${w.id}:${cab.id}`, 'wire')}>${item(lvl + 1, `<span class="mono">${esc(M.wireName(w))}</span>`)}<td class="mono">${esc(at.pin || '')}</td><td>${esc(w.signal || net)}</td><td>${swatchHtml(w.color)}</td><td>${esc(gaugeMetric(w.gauge)) || '<span class="sys-none">—</span>'}</td>` +
            `<td><span class="mono">${esc(M.endText(h, to))}</span>${where ? ` <span class="pc-muted">· ${esc(where)}</span>` : ''}</td><td class="num">${U.fmtLen(A0.wireLen.get(w.id))}</td></tr>`;
        });
    };
    s.blocks.slice().sort((a, b) => natural(a.ref, b.ref)).forEach(b => {
      const ch = childOf(b);
      const conns = b.conns.filter(c => pluggedAt(s, b.id, c.id).length || (fitted(c) && c.used)).sort((x, y) => natural(x.ref, y.ref));
      const name = ch ? esc(ch.title) + drill('system', ch.id, path + '>' + ch.id, 'system') : esc(b.name || '');
      rows += `<tr${rowAttr('block:' + b.id, 'blk')}>${item(0, `<b>${esc(b.ref)}</b> ${name} ${typeHtml(blockType(b))}`)}<td colspan="6" class="pc-muted">${conns.length} connector${conns.length === 1 ? '' : 's'} used of ${b.conns.length}</td></tr>`;
      conns.forEach(c => {
        const at = pluggedAt(s, b.id, c.id);
        rows += `<tr${rowAttr(`conn:${b.id}:${c.id}`, 'conn')}>${item(1, `<span class="mono">${esc(c.ref)}</span>${c.fn ? ` <span class="pc-muted">${esc(c.fn)}</span>` : ''} ${typeHtml(connType(c))}`)}<td colspan="6" class="pc-muted">${c.pins.length} pins${at.length ? '' : c.external ? ' · external: plugged in from ' + esc(parentsOf(s.id).map(p => p.title).join(', ') || 'the systems placing this one') : ' · nothing plugged in'}</td></tr>`;
        at.forEach(x => cableRows(x.cable, x.node, 2, c));
      });
    });
    const loose = s.cables.filter(cab => !Object.values(cab.ends).some(Boolean));
    if (loose.length) { rows += `<tr class="sys-wr blk">${item(0, '<b>Not plugged in</b>')}<td colspan="6"></td></tr>`; loose.forEach(cab => cableRows(cab, null, 1, null)); }
    return `<div class="page wide sys-wpage">` + listHead('List', s.title, `${s.blocks.length} block${s.blocks.length === 1 ? '' : 's'}<span class="sep">·</span>${nCab} cable end${nCab === 1 ? '' : 's'}<span class="sep">·</span>${nWire} wire${nWire === 1 ? '' : 's'}`, crumbsHtml(path)) +
      `<div class="card table-wrap"><table class="table compact sys-wtable">${HEAD}<tbody>${rows || '<tr><td colspan="7" class="pc-muted">Nothing placed yet.</td></tr>'}</tbody></table></div>` +
      `<p class="f-hint">Click an item to see it in the panel. Each cable is listed at every connector it plugs into, with its wires from that end. Pick a system or harness in the menu, or its name here, to list just it.</p></div>`;
  }
  function harnessListHtml(f) {
    const h = A.harness(f.id), s = S.store[focusSys(f)];
    if (!h) return `<div class="page wide sys-wpage">${listHead('List', 'Missing harness', '', crumbsHtml(f.path))}</div>`;
    const A0 = an(h), cabs = s ? s.cables.filter(c => kindOf(c) === 'harness' && c.harness === h.id) : [];
    const ends = h.nodes.filter(M.isConn).map(n => {
      const where = n.atDevice ? 'Its device' : cabs.map(c => endName(s, c.ends[n.id])).filter(Boolean).join(', ') || 'Not plugged in here';
      return `<tr${rowAttr(`end:${h.id}:${n.id}`, 'end')}>${item(0, `<span class="mono">${esc(n.ref)}</span> ${esc(n.name || '')} ${typeHtml(endType(n))}`)}<td>${M.pinList(n).length} pins</td><td colspan="5">${esc(where)}</td></tr>`;
    }).join('');
    const wires = M.fromTo(h, A0).map(r => `<tr${rowAttr(`wire:${h.id}:${r.wire.id}:`, 'wire')}>${item(0, `<span class="mono">${esc(r.name)}</span>`)}<td class="mono">${esc(r.from)}</td><td class="mono">${esc(r.to)}</td><td>${esc(r.signal)}</td><td>${swatchHtml(r.wire.color)}</td><td>${esc(gaugeMetric(r.gauge)) || '<span class="sys-none">—</span>'}</td><td class="num">${U.fmtLen(r.length)}</td></tr>`).join('');
    return `<div class="page wide sys-wpage">` + listHead('List', h.title, `Loom harness<span class="sep">·</span>${esc(h.pn || NOPN)}<span class="sep">·</span>${h.nodes.filter(M.isConn).length} ends<span class="sep">·</span>${h.wires.length} wire${h.wires.length === 1 ? '' : 's'}`, crumbsHtml(f.path, h.title),
      `<button class="btn btn-primary" data-sact="open-harness-id" data-harness="${esc(h.id)}">Open in Loom</button>`) +
      `<h4 class="sys-h">Ends</h4><div class="card table-wrap"><table class="table compact sys-wtable"><thead><tr><th>End</th><th>Pins</th><th colspan="5">Plugs into, in ${esc(s ? s.title : 'this system')}</th></tr></thead><tbody>${ends || '<tr><td colspan="7" class="pc-muted">No ends.</td></tr>'}</tbody></table></div>` +
      `<h4 class="sys-h">Wires</h4><div class="card table-wrap"><table class="table compact sys-wtable"><thead><tr><th>Wire</th><th>From</th><th>To</th><th>Signal</th><th>Color</th><th>Gauge</th><th class="num">Length</th></tr></thead><tbody>${wires || '<tr><td colspan="7" class="pc-muted">No wires yet.</td></tr>'}</tbody></table></div></div>`;
  }
  // The panel for a harness's wire or end picked in the list: read only here (a system never edits a
  // harness), with Open in Loom to edit it in the harness.
  const prop = (label, value) => `<div class="sys-prop"><span>${label}</span><b>${value || '<span class="sys-none">—</span>'}</b></div>`;
  function wirePanelHtml(s, t) {
    const h = A.harness(t.harness), r = h && M.fromTo(h, an(h)).find(x => x.wire.id === t.wire);
    if (!r) return `<div class="rail-head"><div class="eyebrow">Wire</div><div class="rail-title">Not there any more</div></div>`;
    const w = r.wire, cab = t.cable && cable(s, t.cable);
    const where = e => { const n = M.node(h, e.node); return n && cab && cab.ends[n.id] ? ' · ' + endName(s, cab.ends[n.id]) : n && n.atDevice ? ' · at its device' : ''; };
    return `<div class="rail-head"><div class="eyebrow">Wire · ${esc(h.title)}</div><div class="rail-title">${esc(r.name)}</div></div>` +
      `<div class="sys-props">${prop('Type', 'Wire in a Loom harness')}${prop('Harness', esc(h.title + ' · ' + (pnOf(h, cab) || h.pn || NOPN)))}${prop('From', esc(r.from + where(w.from)))}${prop('To', esc(r.to + where(w.to)))}` +
      `${prop('Signal', esc(r.signal))}${prop('Color', M.colorInfo(w.color).code ? swatchHtml(w.color) : '')}${prop('Gauge', esc(gaugeMetric(w.gauge)))}${prop('Length', U.fmtLen(r.length))}${r.sets ? prop('In', esc(r.sets)) : ''}</div>` +
      `<p class="hint">Its signal, color, gauge, and ends are set in the harness: Open in Loom opens it with this wire selected.</p>`;
  }
  function endPanelHtml(s, t) {
    const h = A.harness(t.harness), n = h && M.node(h, t.node);
    if (!n) return `<div class="rail-head"><div class="eyebrow">End</div><div class="rail-title">Not there any more</div></div>`;
    const cabs = s.cables.filter(c => kindOf(c) === 'harness' && c.harness === h.id), plugs = n.atDevice ? 'Its device' : cabs.map(c => endName(s, c.ends[n.id])).filter(Boolean).join(', ');
    return `<div class="rail-head"><div class="eyebrow">End · ${esc(h.title)}</div><div class="rail-title">${esc(n.ref)} ${esc(n.name || '')}</div></div>` +
      `<div class="sys-props">${prop('Type', esc(LM.library ? LM.library.kindName(n) : 'Connector'))}${prop('Part number', esc(n.mpn || ''))}${prop('Pins', String(M.pinList(n).length))}${prop('Terminal', esc(n.terminal || ''))}${prop('Mates with', esc(n.mate || ''))}${prop('Plugs into', esc(plugs || 'Not plugged in here'))}</div>` +
      `<p class="hint">Set in the harness: Open in Loom opens it with this end selected.</p>`;
  }
  // Open in Loom, under the panel's head while the list shows: a harness's wire, end, or cable opens the
  // harness with it selected; a placed system opens on Detail; anything else shows on Detail, selected.
  function openInLoom() {
    const s = cur(), t = S.sel;
    if (!s || !t) return;
    if (t.kind === 'wire') { A.openHarness(t.harness, { kind: 'wire', ids: [t.wire] }); return; }
    if (t.kind === 'end') { A.openHarness(t.harness, { kind: 'node', ids: [t.node] }); return; }
    if (t.kind === 'cable') { const h = harnessOf(cable(s, t.id)); if (h) { A.openHarness(h.id); return; } }
    if (t.kind === 'block') { const b = block(s, t.block); if (b && childOf(b)) { S.focus = { kind: 'system', id: b.system, path: curPath() + '>' + b.system, open: true }; S.tab = 'detail'; applyTab(); A.refresh(); return; } }
    S.tab = 'detail';
    if (!S.cam) S.cam = bounds(s);
    reveal(s, t.kind === 'conn' ? { kind: 'block', block: t.block } : t);
    A.refresh();
  }
  const openInLoomBtn = () => `<button class="btn btn-primary sys-open-loom" data-sact="open-in-loom" title="A harness, its wire, or its end opens in the harness editor; anything else on the Detail canvas">Open in Loom</button>`;

  // ── Render ──
  function render(page) {
    const s = cur();
    if (!s) return;
    page.classList.add('sys-on');
    if (!page.querySelector('.sys-view')) {
      page.innerHTML = `<div class="sys-view"><div class="sys-canvas-wrap canvas-wrap cv-paper"><svg class="lm-canvas sys-canvas" id="sys-canvas" xmlns="http://www.w3.org/2000/svg"></svg>
        <div class="board-hud glass sys-hud"><button class="icon-btn" data-sact="fit" title="Fit (F)">⤢</button><button class="icon-btn" data-sact="turn-all" title="Turn the system 90° clockwise (Shift-click: counterclockwise)" aria-label="Turn the system 90°">⟳</button><span id="sys-grid-menu"></span></div>
        <div class="hud-br"><label class="seg glass hud-check" title="Show each cable’s name and part number, on a dot you can slide along it"><input type="checkbox" data-slabels id="sys-labels"><span>Cable labels</span></label></div></div>
        <div class="sys-wires" id="sys-wires" hidden></div>
        <div class="sys-side"><aside class="rail sys-panel" id="sys-panel"></aside><div id="sys-help"></div></div></div>`;
      wire(page);
    }
    // List takes the canvas's place beside the panel; the canvas stays (its listeners are wired once).
    const listOn = S.tab === 'list', wp = page.querySelector('#sys-wires'), cw = page.querySelector('.sys-canvas-wrap');
    wp.hidden = !listOn; cw.hidden = listOn;
    if (listOn) { const keep = wp.scrollTop; wp.innerHTML = listHtml(); wp.scrollTop = keep; }
    else {
      const svg = page.querySelector('#sys-canvas');
      if (!S.cam) S.cam = bounds(s);
      svg.setAttribute('viewBox', `${S.cam.x} ${S.cam.y} ${S.cam.w} ${S.cam.h}`);
      redraw(svg);
      const gs = gridOf(s), style = A.gridStyle ? A.gridStyle() : 'dots';
      page.querySelector('#sys-grid-menu').innerHTML = `<label class="seg glass hud-grid" title="Blocks and cable runs snap to the grid as you drag them. Hold Ctrl to place one anywhere.">${A.gridIcon ? A.gridIcon() : ''}<select data-sgrid aria-label="Grid">` +
        `<optgroup label="Spacing">${GRIDS.map(x => `<option value="${x}"${x === gs ? ' selected' : ''}>${x ? 'Grid ' + x + ' mm' : 'Grid off'}</option>`).join('')}</optgroup>` +
        `<optgroup label="Style">${[['dots', 'Dots'], ['lines', 'Lines']].map(([k, t]) => `<option value="${k}">${style === k ? '● ' : '○ '}${t}</option>`).join('')}</optgroup></select></label>`;
      page.querySelector('#sys-labels').checked = labelsOn();
    }
    page.querySelector('#sys-help').innerHTML = listOn ? '' : helpHtml();
    const panel = page.querySelector('#sys-panel'), keep = panel.scrollTop;
    const backBtn = S.sel || S.adding ? `<button class="sys-back" data-sact="back" title="Back to the system">${'‹'} Back</button>` : '';
    // While the list shows, Open in Loom sits right under the panel's head.
    const extra = listOn && S.sel && S.sel.kind !== 'multi' ? `<div class="sys-actions sys-open-row">${openInLoomBtn()}</div>` : '';
    let html = panelHtml(s);
    if (backBtn) html = html.replace('<div class="rail-head">', '<div class="rail-head">' + backBtn);
    if (extra) { const i = html.indexOf('<div class="rail-title">'), j = i < 0 ? -1 : html.indexOf('</div></div>', i); if (j >= 0) html = html.slice(0, j + 12) + extra + html.slice(j + 12); }
    panel.innerHTML = html;
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
  // Blocks snap in mm, cable runs in canvas units (K per mm), both to the system's grid.
  const snap = v => { const g = gridOf(cur()); return g ? Math.round(v / g) * g : Math.round(v * 10) / 10; };
  const snapU = v => { const g = gridOf(cur()) * K; return g ? Math.round(v / g) * g : v; };
  const stepU = () => gridOf(cur()) * K;
  let drag = null, lastLo = null;
  // A mini view's frame is worked out when the system resolves; the placed system's drawing can change after
  // (its harnesses load, Cable labels add caption lanes), and a stale frame spilled the drawing over the block's
  // header (Chris, 2026-11-13). Before each draw, a block whose frame no longer fits is resolved again.
  function freshMinis(s, depth) {
    s.blocks.forEach(b => {
      const ch = b.kind === 'system' ? childOf(b) : null;
      if (!ch) return;
      if (depth < 3) freshMinis(ch, depth + 1);
      const mf = miniFrame(b, ch), m = b.mini, near = (p, q) => Math.abs(p - q) < 1e-6;
      const same = mf && m ? ['f', 'ox', 'oy'].every(k => near(mf[k], m[k])) && ['x', 'y', 'w', 'h'].every(k => near(mf.E[k], m.E[k])) : !mf === !m;
      if (!same) resolveBlock(b, [s.id]);
    });
  }
  function redraw(svg, view) { freshMinis(cur(), 0); lastLo = layout(cur(), view); svg.innerHTML = svgHtml(cur(), lastLo); svg.classList.toggle('wiring', !!S.pending); }
  const tabAt = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.closest && el.closest('#sys-canvas [data-conn]'); };
  const tabRef = el => ({ block: el.dataset.block, conn: el.dataset.conn });
  const sameTab = (a, b) => !!a && !!b && a.block === b.block && a.conn === b.conn;
  // The run of a cable nearest a point: { r (its route), n (route.nearestRun) }.
  // The run of a cable nearest a point (connect.js runAt on each of its routes), or null.
  function runNear(cabId, p) {
    const L = lastLo && lastLo.get(cabId);
    if (!L) return null;
    let best = null;
    L.routes.forEach(r => { const n = CN().runAt(r, p); if (n && (!best || n.d < best.d)) best = n; });
    return best;
  }
  // The ports a level run being dragged can line up with (Chris, 2026-11-13): an end that leaves from the
  // top or bottom of its tab runs a lead-in out past its block's edge, and the level run next to it (the
  // shape's first or last level value) dragged to the tab's height makes that end leave from the tab's
  // side, toward where the route goes. Each: { end, y (the tab's middle), b, c, exit0 (as it was), side }.
  function portLines(d) {
    const R0 = d.run.route, n = d.v0.length, out = [];
    if (d.axis !== 'h') return out;
    d.tabs.forEach(t => {
      const T = t.end === 'A' ? R0.A : R0.B, lead = t.end === 'A' ? R0.A.from : R0.B.to;
      if ((t.end === 'A' ? 1 : n - 2) !== d.k || !isLead(T, lead)) return;
      const g = tabGeom(t.b, t.c), nx = t.end === 'A' ? d.v0[2] : d.v0[n - 3];
      out.push(Object.assign({ y: g.mid, side: nx >= g.cx ? 'right' : 'left' }, t));
    });
    return out;
  }
  const isLead = (T, lead) => !!lead && Math.abs(lead.x - T.x) < 0.5 && Math.abs(lead.y - T.y) > 0.5;
  // The tabs at a dragged route's two ends: { end ('A' or 'B'), b, c, exit0 (its exit as the drag found it) }.
  function endTabs(d) {
    const R0 = d.run.route, L = lastLo && lastLo.get(d.cab.id), out = [];
    if (!L) return out;
    [['A', L.at[0]], ['B', L.at.find(x => x.n.id === R0.end)]].forEach(([end, x]) => {
      const b = x && block(cur(), x.b.id), c = b && conn(b, x.c.id);
      if (c) out.push({ end, b, c, exit0: c.exit });
    });
    return out;
  }
  // A lead-in's drag: the end will leave from its tab's side, so the shape gains a vertical run where the
  // lead was (at the pointer), joined to the route at the lead's far end (its terminal's height). k is that run.
  function leadGrab(R0, end, p) {
    const v0 = R0.v.slice(), T = end === 'A' ? R0.A : R0.B, x = p.x;
    const v = !v0.length ? [x] : end === 'A' ? [x, T.y].concat(v0) : v0.concat([T.y, x]), k = end === 'A' ? 0 : v.length - 1;
    const lines = [k - 2 >= 0 ? v[k - 2] : null, k + 2 < v.length ? v[k + 2] : null].filter(x0 => x0 != null).map(Number);
    return { v0: v, k, axis: 'v', lines };
  }
  // Where the first bend out of a tab leaving from its block's left or right side may come: the side exit's
  // stub, out past the block's edge and onto the search grid (terminals(), onGrid). Nearer, the route fits
  // no terminal and doubles back into a loop (Chris, 2026-11-13).
  function sideClear(b, side) {
    const st = (lastLo && lastLo.step) || 12;
    return side === 'right' ? Math.ceil(((b.x + sizeOf(b).W) * K + STUB_U) / st) * st : Math.floor((b.x * K - STUB_U) / st) * st;
  }
  // A cable's lead-in nearest a point (the line from a tab leaving from its top or bottom out past its
  // block's edge, before the route starts): { route, end, d }, within reach of the line, or null.
  function leadNear(cabId, p) {
    const L = lastLo && lastLo.get(cabId);
    if (!L) return null;
    let best = null;
    L.routes.forEach(r => [['A', r.A, r.A.from], ['B', r.B, r.B.to]].forEach(([end, T, lead]) => {
      if (!isLead(T, lead)) return;
      const y0 = Math.min(T.y, lead.y), y1 = Math.max(T.y, lead.y), dd = Math.hypot(p.x - T.x, p.y - Math.max(y0, Math.min(y1, p.y)));
      if (dd <= r.half + 12 && (!best || dd < best.d)) best = { route: r, end, d: dd };
    }));
    return best;
  }
  // A cable's kept route record for one end (the harness's record: v, a, b, mode), set or cleared.
  function keepRoute(cab, end, rec) {
    const r = Object.assign({}, cab.routes);
    if (rec) r[end] = rec; else delete r[end];
    if (Object.keys(r).length) cab.routes = r; else delete cab.routes;
  }
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
  // A right click on a cable (no drag): the harness editor's route items (connect.js menuHtml), for the
  // route under the pointer (each end of a cable with three or more ends has its own).
  let menuEl = null;
  // Drag-select (Chris, 2026-11-12: as in the harness): left to right picks what's wholly inside the box,
  // right to left what it touches. Blocks by their turned outline, cables by their drawn line.
  function marqueePick(r, touch) {
    const s = cur(), x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
    const inside = p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    // Whether a segment meets the box (Liang-Barsky).
    const meets = (a, b) => {
      let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y;
      for (const [pp, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
        if (Math.abs(pp) < 1e-9) { if (q < 0) return false; continue; }
        const t = q / pp;
        if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
      return true;
    };
    const blocks = s.blocks.filter(b => {
      const { W, H } = sizeOf(b), bx0 = b.x * K, by0 = b.y * K, bx1 = bx0 + W * K, by1 = by0 + H * K;
      return touch ? bx0 <= x1 && bx1 >= x0 && by0 <= y1 && by1 >= y0 : bx0 >= x0 && bx1 <= x1 && by0 >= y0 && by1 <= y1;
    }).map(b => b.id);
    const cables = [];
    (lastLo || new Map()).forEach(({ cab, routes }) => {
      const pts = routes.flatMap(rt => CN().draw(rt).pts);
      if (!pts.length) return;
      const hit = touch ? pts.some((p, i) => inside(p) || (i && meets(pts[i - 1], p))) : pts.every(inside);
      if (hit) cables.push(cab.id);
    });
    return { blocks, cables };
  }
  function drawMarquee(svg, d, p) {
    if (!d.started) { d.started = true; svg.classList.add('marquee'); }
    const touch = p.x < d.p.x, r = { x: Math.min(p.x, d.p.x), y: Math.min(p.y, d.p.y), w: Math.abs(p.x - d.p.x), h: Math.abs(p.y - d.p.y) };
    d.rect = r; d.touch = touch;
    const gh = svg.querySelector('#sys-ghost');
    if (gh) gh.innerHTML = `<rect class="cv-marquee ${touch ? 'touch' : 'inside'}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;
    const pick = marqueePick(r, touch), bs = new Set(pick.blocks), cs = new Set(pick.cables);
    svg.querySelectorAll('.sys-block[data-block]').forEach(el => el.classList.toggle('mq', bs.has(el.dataset.block)));
    svg.querySelectorAll('.sys-w[data-cable]').forEach(el => el.classList.toggle('mq', cs.has(el.dataset.cable)));
  }
  // A right click on a block: turn it (Chris, 2026-11-12).
  function openBlockMenu(e, id) {
    closeMenu();
    S.sel = { kind: 'block', block: id }; A.refresh();
    const m = document.createElement('div');
    m.className = 'menu lm-ctx';
    m.setAttribute('role', 'menu');
    m.innerHTML = '<button data-ctx="rotate-ccw" role="menuitem"><span>Rotate left</span><span class="lm-ctx-k">Shift+R</span></button>' +
      '<button data-ctx="rotate-cw" role="menuitem"><span>Rotate right</span><span class="lm-ctx-k">R</span></button>';
    m.style.position = 'fixed'; m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'; m.style.zIndex = 90;
    m.addEventListener('click', ev => { const b = ev.target.closest('[data-ctx]'); if (!b) return; closeMenu(); act(b.dataset.ctx, null, id); });
    document.body.appendChild(m);
    menuEl = m;
    const off = ev => { if (!m.contains(ev.target)) { closeMenu(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openMenu(e, cabId, p) {
    closeMenu();
    const near = runNear(cabId, p), end = near ? near.route.end : null, cab = cable(cur(), cabId);
    if (!end || !cab) return;
    S.sel = { kind: 'cable', id: cabId }; A.refresh();
    const m = document.createElement('div');
    m.className = 'menu lm-ctx';
    m.setAttribute('role', 'menu');
    m.innerHTML = CN().menuHtml(cab.routes && cab.routes[end]) + '<button data-ctx="delete" role="menuitem"><span>Remove from the system</span><span class="lm-ctx-k">Del</span></button>';
    m.style.position = 'fixed'; m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'; m.style.zIndex = 90;
    m.addEventListener('click', ev => {
      const b = ev.target.closest('[data-ctx]');
      if (!b) return;
      closeMenu();
      const k = b.dataset.ctx;
      if (k === 'delete') { act('delete-cable'); return; }
      change(x => { const c = cable(x, cabId); keepRoute(c, end, CN().apply(c.routes && c.routes[end], k)); });
    });
    document.body.appendChild(m);
    menuEl = m;
    const r = m.getBoundingClientRect();
    if (r.right > innerWidth - 8) m.style.left = Math.max(8, innerWidth - r.width - 8) + 'px';
    if (r.bottom > innerHeight - 8) m.style.top = Math.max(8, innerHeight - r.height - 8) + 'px';
    const off = ev => { if (!m.contains(ev.target)) { closeMenu(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }
  // A click on a connector, as on a pin: start, finish, or cancel a cable.
  function clickTab(ref) {
    if (!S.pending) { S.pending = ref; S.sel = Object.assign({ kind: 'conn' }, ref); S.picking = null; A.refresh(); return; }
    if (sameTab(S.pending, ref)) { cancelWire(); return; }
    const from = S.pending;
    S.pending = null;
    act('new-link', null, [from, ref]);
  }
  function wire(page) {
    const svg = page.querySelector('#sys-canvas');
    svg.addEventListener('contextmenu', e => e.preventDefault());
    // No text drags (Chris, 2026-11-12: dragging a block sometimes pulled a ghost of its text instead):
    // text selected before (a double-click, Ctrl+A) is cleared when a drag starts here, and the browser's
    // own drag of a selection never starts on the canvas.
    svg.addEventListener('dragstart', e => e.preventDefault());
    svg.addEventListener('pointerdown', e => {
      if (e.button > 2) return;
      { const sel0 = getSelection && getSelection(); if (sel0 && !sel0.isCollapsed) sel0.removeAllRanges(); }
      const p = toWorld(svg, e), t = e.target, s = cur();
      const base = { x: e.clientX, y: e.clientY, p, t, moved: false, button: e.button, brk: e.shiftKey };
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* not an active pointer */ }
      if (e.button !== 0) { drag = Object.assign(base, { kind: 'pan', cam: Object.assign({}, S.cam), k: p.k }); return; }
      const dvEl = !S.pending && t.closest('[data-devgrab]');
      if (dvEl) { const c0 = cable(s, dvEl.dataset.devgrab); drag = Object.assign(base, { kind: 'dev', cab: dvEl.dataset.devgrab, a0: Object.assign({ dx: 0, dy: 0 }, c0 && c0.devAt) }); return; }
      const ldEl = !S.pending && t.closest('[data-cldot]'), lbEl = !S.pending && !ldEl && t.closest('[data-clabel]');
      if (ldEl || lbEl) { drag = Object.assign(base, { kind: ldEl ? 'ldot' : 'label', cab: ldEl ? ldEl.dataset.cldot : lbEl.dataset.clabel }); return; }
      const endEl = !S.pending && t.closest('[data-cend]'), run = !S.pending && t.closest('[data-run]'), bl = t.closest('[data-block]'), cb = t.closest('[data-cable]');
      if (endEl) {
        const [cid, node] = endEl.dataset.cend.split('|');
        drag = Object.assign(base, { kind: 'end', cab: cid, node, from: endEl.dataset.from ? JSON.parse(endEl.dataset.from) : null, anchor: { x: +endEl.dataset.x, y: +endEl.dataset.y } });
      } else if (run) {
        const [cid, end, j] = run.dataset.run.split('|'), r = lastLo.get(cid).routes.find(x => x.end === end), R = r && CN().runOf(r, +j);
        if (R) drag = Object.assign(base, { kind: 'run', cab: cable(s, cid), run: R, end });
      } else if (cb && !S.pending && leadNear(cb.dataset.cable, p)) {
        // A lead-in (Chris, 2026-11-13: they couldn't be dragged): dragged sideways, its end leaves from that
        // side of the tab, and the line sits where it's dragged.
        const ld = leadNear(cb.dataset.cable, p);
        drag = Object.assign(base, { kind: 'run', cab: cable(s, cb.dataset.cable), run: { route: ld.route }, lead: ld.end, end: ld.route.end, click: cb.dataset.cable });
      } else if (cb && !S.pending && (() => { const n = runNear(cb.dataset.cable, p); return n && n.d <= n.route.half + 12; })()) {
        // As the editor's runUnder: a cable's line drags the run under it, selected or not; a click
        // without moving still selects it.
        const near = runNear(cb.dataset.cable, p);
        drag = Object.assign(base, { kind: 'run', cab: cable(s, cb.dataset.cable), run: near, end: near.route.end, click: cb.dataset.cable });
      } else if (bl && !S.pending) {
        const b = block(s, bl.dataset.block);
        // A block in a selection of several takes the selection with it: its blocks, and the shapes of
        // its cables (a cable with one end moving keeps its shape, as in the harness).
        const group = S.sel && S.sel.kind === 'multi' && S.sel.blocks.includes(b.id);
        const others = group ? S.sel.blocks.map(id => block(s, id)).filter(x => x && x !== b).map(x => ({ b: x, x: x.x, y: x.y })) : [];
        const shapes = group ? S.sel.cables.map(id => cable(s, id)).filter(c => c && c.routes).map(c => ({ c, routes: JSON.parse(JSON.stringify(c.routes)) })) : [];
        drag = Object.assign(base, { kind: 'block', bx: b.x, by: b.y, b, others, shapes });
      } else if (!bl && !cb && !S.pending) drag = Object.assign(base, { kind: 'marquee', add: e.shiftKey });
      else drag = Object.assign(base, { kind: bl || cb ? 'click' : 'pan', cam: Object.assign({}, S.cam), k: p.k });
    });
    svg.addEventListener('pointermove', e => {
      const d = drag;
      if (!d) { if (S.pending) ghostAt(svg, S.pending, e); return; }
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.moved = true;
      const p = toWorld(svg, e);
      if (d.kind === 'marquee') { drawMarquee(svg, d, p); return; }
      if (d.kind === 'pan') { S.cam.x = d.cam.x - (e.clientX - d.x) * d.k; S.cam.y = d.cam.y - (e.clientY - d.y) * d.k; svg.setAttribute('viewBox', `${S.cam.x} ${S.cam.y} ${S.cam.w} ${S.cam.h}`); return; }
      if (d.kind === 'click') return;
      if (d.kind === 'dev') {
        const cab = cable(cur(), d.cab);
        if (!cab) { drag = null; return; }
        if (!d.snap) { S.past.push(JSON.stringify(cur())); S.future = []; d.snap = true; svg.classList.add('dragging'); }
        const any = e.ctrlKey || e.metaKey, r = v => (any ? Math.round(v * 10) / 10 : snap(v));
        cab.devAt = { dx: r(d.a0.dx + (p.x - d.p.x) / K), dy: r(d.a0.dy + (p.y - d.p.y) / K) };
        if (!cab.devAt.dx && !cab.devAt.dy) delete cab.devAt;
        redraw(svg);
        return;
      }
      if (d.kind === 'ldot' || d.kind === 'label') {
        const cab = cable(cur(), d.cab), L = labInfo.get(d.cab);
        if (!cab || !L) { drag = null; return; }
        if (!d.snap) {
          S.past.push(JSON.stringify(cur())); S.future = []; d.snap = true; S.slide = cab.id; svg.classList.add('dragging');
          // Fix the other half where it is: the dot's place, and the label's offset from it.
          if (cab.labelAt == null) cab.labelAt = Math.round(L.t * 1000) / 1000;
          if (cab.labelOff == null) cab.labelOff = L.rot ? { dx: 2, dy: -2.25 } : { dx: Math.round(L.off.dx * 10) / 10, dy: Math.round(L.off.dy * 10) / 10 };
          d.grab = { x: d.p.x - L.dot.x, y: d.p.y - L.dot.y }; d.o0 = Object.assign({}, cab.labelOff);
        }
        if (d.kind === 'ldot' && L.lane) cab.labelAt = Math.round(laneT(L.lane, { x: p.x - d.grab.x, y: p.y - d.grab.y }) * 1000) / 1000;
        if (d.kind === 'label') cab.labelOff = { dx: Math.round((d.o0.dx + (p.x - d.p.x) / K) * 10) / 10, dy: Math.round((d.o0.dy + (p.y - d.p.y) / K) * 10) / 10 };
        redraw(svg);
        return;
      }
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
        // The editor's dragRun (connect.js): the whole straight run moves sideways by the pointer's
        // travel (an end run from a stub out of its connector), on the grid (Ctrl: anywhere); Shift-drag
        // breaks the run where it's grabbed and drags the piece from there.
        const free = e.ctrlKey || e.metaKey;
        if (!d.snap) {
          const st = d.lead ? leadGrab(d.run.route, d.lead, d.p) : CN().grab(d.run, snapU, d.brk);
          if (!st) { drag = null; return; }
          S.past.push(JSON.stringify(cur())); S.future = []; d.snap = true;
          d.keep = { a: d.run.route.A.side, b: d.run.route.B.side, mode: d.cab.routes && d.cab.routes[d.end] && d.cab.routes[d.end].mode };
          Object.assign(d, st, { p0: toWorld(svg, { clientX: d.x, clientY: d.y }) });
          d.tabs = endTabs(d);
          d.ports = portLines(d);
          d.lines = d.lines.concat(d.ports.map(q => q.y));
          svg.classList.add('dragging');
        }
        // Near straight, it snaps straight (within 5 grid steps, 5 mm; not with Ctrl).
        let v = CN().slide(d, d.p0, p, free || !stepU() ? null : snapU, free ? 0 : stepU() || K);
        // Level with the port of an end that leaves from its tab's top or bottom: that end leaves from the
        // tab's side instead, straight out of the port, and its lead-in goes (Chris, 2026-11-13: the cable
        // climbed out past the block's edge and came back down in a loop).
        d.tabs.forEach(t => { if (t.exit0) t.c.exit = t.exit0; else delete t.c.exit; });
        const q = d.ports.find(o => Math.abs(v[d.k] - o.y) < 0.01);
        let near = null;
        if (q) {
          v = q.end === 'A' ? v.slice(2) : v.slice(0, v.length - 2);
          near = { t: q, i: q.end === 'A' ? 0 : v.length - 1, side: q.side };
        } else if (d.axis === 'v' && (d.k === 0 || d.k === v.length - 1)) {
          // The vertical run next to an end that leaves from its tab's side (or a lead-in, dragged): dragged
          // across the tab, the end leaves from the other side (Chris, 2026-11-13: dragged right, it looped
          // back to the left), and it never comes nearer than the side's stub.
          const t = d.tabs.find(o => o.end === (d.lead || (d.k === 0 ? 'A' : 'B'))), g = t && tabGeom(t.b, t.c);
          if (g && (g.dx || d.lead)) near = { t, i: d.k, side: v[d.k] >= g.cx ? 'right' : 'left' };
        }
        if (near) {
          near.t.c.exit = turnSide(near.side, 360 - rotOf(near.t.b));
          const cl = sideClear(near.t.b, near.side), i = near.i;
          if (near.side === 'right' ? v[i] < cl : v[i] > cl) v[i] = cl;
        }
        keepRoute(d.cab, d.end, Object.assign({ v }, d.keep));
        redraw(svg, { fast: true });
        return;
      }
      if (d.kind === 'block') {
        if (!d.snap) { S.past.push(JSON.stringify(cur())); S.future = []; d.snap = true; svg.classList.add('dragging'); }
        // As a harness part: only the cables whose ends move re-route until it's let go.
        // On the grid; Ctrl places it anywhere, as a harness part.
        const bx = d.bx + (p.x - d.p.x) / K, by = d.by + (p.y - d.p.y) / K, any = e.ctrlKey || e.metaKey;
        d.b.x = any ? Math.round(bx * 10) / 10 : snap(bx); d.b.y = any ? Math.round(by * 10) / 10 : snap(by);
        const ddx = d.b.x - d.bx, ddy = d.b.y - d.by;
        (d.others || []).forEach(o => { o.b.x = Math.round((o.x + ddx) * 10) / 10; o.b.y = Math.round((o.y + ddy) * 10) / 10; });
        (d.shapes || []).forEach(({ c, routes }) => { const r = {}; Object.keys(routes).forEach(k => { const rec = routes[k]; r[k] = rec && Array.isArray(rec.v) ? Object.assign({}, rec, { v: rec.v.map((x, i) => +x + (i % 2 ? ddy : ddx) * K) }) : rec; }); c.routes = r; });
        redraw(svg, { fast: true });
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
      if (d.kind === 'dev') {
        if (d.moved && d.snap) { cur().updated = now(); persist(); A.refresh(); return; }
        if (!d.moved) { if (d.brk) toggleSel('cable', d.cab); else { S.sel = { kind: 'cable', id: d.cab }; S.pair = null; S.picking = null; } A.refresh(); }
        return;
      }
      if (d.kind === 'ldot' || d.kind === 'label') {
        S.slide = null;
        if (d.moved && d.snap) { cur().updated = now(); persist(); A.refresh(); return; }
        if (!d.moved) { if (d.brk) toggleSel('cable', d.cab); else { S.sel = { kind: 'cable', id: d.cab }; S.pair = null; S.picking = null; } A.refresh(); }
        return;
      }
      if (d.kind === 'run' && !d.moved && d.click) { if (d.brk) toggleSel('cable', d.click); else { S.sel = { kind: 'cable', id: d.click }; S.pair = null; S.picking = null; } A.refresh(); return; }
      if (d.kind === 'run' && d.moved && d.snap) {
        // Let go: tidied against the route as it now stands (its sides may have changed in the drag).
        const rec = d.cab.routes && d.cab.routes[d.end], L = lastLo && lastLo.get(d.cab.id), R1 = L && L.routes.find(x => x.end === d.end);
        if (rec && R1) keepRoute(d.cab, d.end, CN().release(R1, rec.v, rec));
        keepTabs(cur());
        cur().updated = now(); persist(); A.refresh(); return;
      }
      if (d.button === 2 && !d.moved) {
        const cb = d.t.closest && d.t.closest('[data-cable]'), bl = !cb && d.t.closest && d.t.closest('[data-block]');
        if (cb) openMenu(e, cb.dataset.cable, toWorld(svg, e));
        else if (bl) openBlockMenu(e, bl.dataset.block);
        return;
      }
      if (d.kind === 'block' && d.moved) { cur().updated = now(); persist(); A.refresh(); return; }
      if (d.kind === 'marquee' && d.moved) {
        const gh = svg.querySelector('#sys-ghost'); if (gh) gh.innerHTML = '';
        svg.classList.remove('marquee');
        const pick = d.rect ? marqueePick(d.rect, d.touch) : { blocks: [], cables: [] };
        const bs = d.add ? [...new Set(selBlocks(S.sel).concat(pick.blocks))] : pick.blocks, cs = d.add ? [...new Set(selCables(S.sel).concat(pick.cables))] : pick.cables;
        S.sel = selOf(bs, cs); S.pair = null; S.picking = null; S.adding = null;
        A.refresh(); return;
      }
      if (d.moved || d.button !== 0) return;
      // A click: as the editor's click(). With Shift, the block or cable under it joins or leaves the
      // selection (on a connector, its block).
      const t = d.t, tab = t.closest('[data-conn]');
      if (d.brk && !S.pending) {
        const cb0 = t.closest('[data-cable]'), bl0 = t.closest('[data-block]');
        if (cb0 || bl0) { if (cb0) toggleSel('cable', cb0.dataset.cable); else toggleSel('block', bl0.dataset.block); A.refresh(); return; }
      }
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
      const sb = !cb && e.target.closest('.sys-block.system'), sysB = sb && block(cur(), sb.dataset.block);
      if (sysB && childOf(sysB) && !S.pending) { A.openSystem(sysB.system); return; }
      if (!cb || S.pending) return;
      const p = toWorld(svg, e), near = runNear(cb.dataset.cable, p);
      if (!near || near.d > near.route.half + 12) return;
      const end = near.route.end, c0 = cable(cur(), cb.dataset.cable), rec = CN().bend(near, snapU, c0.routes && c0.routes[end]);
      if (!rec) return;
      change(s => { keepRoute(cable(s, cb.dataset.cable), end, rec); S.sel = { kind: 'cable', id: cb.dataset.cable }; });
      A.toast('Bend added. Drag its new run to shape the cable.');
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
      if (t.closest('[data-sfocus]')) return;   // a pick (app.js)
      const sl = t.closest('[data-ssel]');
      if (sl) { const v = parseSel(sl.dataset.ssel); if (v) { S.sel = v; S.picking = null; S.adding = null; A.refresh(); } return; }
      const ck = t.closest('[data-scheck]');
      if (ck) { const c = checks(cur(), A.harness)[+ck.dataset.scheck]; if (c && c.sel) { S.sel = c.sel; A.refresh(); } }
    });
    // The blocks a panel's connector field edits: the selected block's (two placements of one system share
    // their tabs' ids), else every block.
    const mine = s => s.blocks.filter(b => !(S.sel && S.sel.block) || b.id === S.sel.block);
    page.addEventListener('change', e => {
      const t = e.target;
      if (t.hasAttribute('data-slabels')) { try { localStorage.setItem(NS + 'sysLabels', t.checked ? 'on' : 'off'); } catch (err) { /* storage blocked */ } A.refresh(); return; }
      if (t.dataset.sext) { const id = t.dataset.sext, on = t.checked; change(s => { mine(s).forEach(b => b.conns.forEach(c => { if (c.id === id) { c.external = on; if (on && !c.link) c.used = true; } })); }); return; }
      if (t.dataset.sfit) { const id = t.dataset.sfit, on = t.checked; change(s => { mine(s).forEach(b => b.conns.forEach(c => { if (c.id === id) { c.fitted = on; if (!on) c.used = false; } })); }); return; }
      if (t.dataset.sexit) { const id = t.dataset.sexit, v = t.value; change(s => { mine(s).forEach(b => b.conns.forEach(c => { if (c.id === id) { if (v) c.exit = turnSide(v, 360 - rotOf(b)); else delete c.exit; } })); s.cables.forEach(cab => { delete cab.routes; }); }); return; }
      if (t.dataset.spin) { const [id, i] = t.dataset.spin.split('|'), v = t.value.trim(); change(s => { mine(s).forEach(b => b.conns.forEach(c => { if (c.id === id && c.pins[+i]) { c.pins[+i].net = v; c.pins[+i].label = v; } })); }); return; }
      if (t.dataset.sused) { const id = t.dataset.sused, on = t.checked; change(s => { mine(s).forEach(b => b.conns.forEach(c => { if (c.id === id) c.used = on; })); }); return; }
      if (t.dataset.send) { const [bid, cid] = t.value ? t.value.split('|') : []; const node = t.dataset.send; change(s => { const cab = cable(s, S.sel.id); cab.ends[node] = bid ? { block: bid, conn: cid } : null; }); return; }
      if (t.hasAttribute('data-sgrid')) {
        if (t.value === 'dots' || t.value === 'lines') { if (A.setGridStyle) A.setGridStyle(t.value); return; }
        const v = +t.value;
        if (GRIDS.includes(v)) change(s => { s.grid = v; });
        return;
      }
      if (t.dataset.scolor) {
        const id = t.dataset.scolor, v = t.value;
        change(s => { const cab = cable(s, id); if (!cab) return; if (!v) delete cab.color; else if (v === 'custom') { if (!HEX.test(cab.color || '')) cab.color = colorOf(cab) || '#3fc1cf'; } else cab.color = v; });
        return;
      }
      if (t.dataset.scolorpick) { const id = t.dataset.scolorpick, v = t.value; if (HEX.test(v)) change(s => { const cab = cable(s, id); if (cab) cab.color = v.toLowerCase(); }); return; }
      if (t.dataset.skind) { rekind(cur(), cable(cur(), t.dataset.skind), t.value); return; }
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
      else if (/^cab\.(name|pn|mfr|mpn)$/.test(f)) cable(s, S.sel.id)[f.slice(4)] = v.trim();
    });
  }
  // Turn a block 90 degrees about its middle (on the grid). Its cables' shapes are forgotten: their ends
  // now leave from other sides, and they route afresh.
  function rotate(s, b, deg) {
    if (!b) return;
    const a = sizeOf(b), cx = b.x + a.W / 2, cy = b.y + a.H / 2;
    b.rot = (rotOf(b) + deg + 360) % 360;
    const n = sizeOf(b);
    b.x = snap(cx - n.W / 2); b.y = snap(cy - n.H / 2);
    s.cables.forEach(cab => { if (Object.values(cab.ends).some(e => e && e.block === b.id)) delete cab.routes; });
  }
  // Turn the whole system 90° (Chris, 2026-11-13: a button by Fit; part of the system, text upright): every block
  // turns as R turns it and its middle swings round the middle of all the blocks, so the drawing turns as one.
  // Cables re-route (their shapes are forgotten, as for one block), and labels and device drawings that were
  // dragged keep their offsets turned with it. One undo.
  function turnAll(s, deg) {
    if (!s.blocks.length) return;
    const x0 = Math.min(...s.blocks.map(b => b.x)), y0 = Math.min(...s.blocks.map(b => b.y));
    const x1 = Math.max(...s.blocks.map(b => b.x + sizeOf(b).W)), y1 = Math.max(...s.blocks.map(b => b.y + sizeOf(b).H));
    const px = (x0 + x1) / 2, py = (y0 + y1) / 2, cw = deg > 0;
    const turn = (dx, dy) => (cw ? { dx: -dy, dy: dx } : { dx: dy, dy: -dx });
    s.blocks.forEach(b => {
      const a = sizeOf(b), t = turn(b.x + a.W / 2 - px, b.y + a.H / 2 - py);
      b.rot = (rotOf(b) + deg + 360) % 360;
      const n = sizeOf(b);
      b.x = snap(px + t.dx - n.W / 2); b.y = snap(py + t.dy - n.H / 2);
    });
    s.cables.forEach(cab => {
      delete cab.routes;
      ['labelOff', 'devAt'].forEach(k => { const o = cab[k]; if (o && (o.dx || o.dy)) cab[k] = turn(o.dx || 0, o.dy || 0); });
    });
  }
  // A clear spot for a new block: right of everything.
  function freeSpot(s) { return s.blocks.length ? { x: Math.max(...s.blocks.map(b => b.x + sizeOf(b).W)) + 40, y: Math.min(...s.blocks.map(b => b.y)) } : { x: 0, y: 0 }; }
  async function act(a, el, arg) {
    const s = cur();
    switch (a) {
      case 'back': back(); break;
      case 'help': try { localStorage.setItem(NS + 'sysHelp', helpOpen() ? 'closed' : 'open'); } catch (e) { /* storage blocked */ } A.refresh(); break;
      case 'rotate-cw': case 'rotate-ccw': {
        const id = arg || (S.sel && S.sel.kind === 'block' && S.sel.block);
        if (id) change(x => rotate(x, block(x, id), a === 'rotate-cw' ? 90 : -90));
        break;
      }
      case 'undo': swap(S.past, S.future); break;
      case 'redo': swap(S.future, S.past); break;
      case 'fit': S.cam = bounds(s); A.refresh(); break;
      case 'turn-all': { const ccw = arg === 'ccw' || !!(window.event && window.event.shiftKey); change(x => turnAll(x, ccw ? -90 : 90)); S.cam = bounds(cur()); A.refresh(); break; }
      case 'add-drawn': case 'add-device': { const b = change(x => addDrawn(x, a === 'add-device' ? 'device' : 'board', freeSpot(x))); S.sel = { kind: 'block', block: b.id }; S.cam = null; A.refresh(); break; }
      case 'add-board':
        S.adding = 'board'; S.boardsErr = ''; A.refresh();
        if (!S.boards) {
          try { S.boards = await LM.boards.listBoards(); }
          catch (e) { S.boardsErr = e.code === 'signin' ? 'Sign in to GitHub in Settings to read Signoff EE’s boards.' : e.message; }
          A.refresh();
        }
        break;
      case 'cancel-add': S.adding = null; A.refresh(); break;
      case 'add-system': S.adding = 'system'; S.sel = null; A.refresh(); break;
      case 'place-system': {
        const ch = S.store[el.dataset.sys];
        if (!ch || ch.id === s.id || places(ch, s.id)) break;
        const b = change(x => addSystem(x, ch, freeSpot(x)));
        S.adding = null; S.sel = { kind: 'block', block: b.id }; S.cam = null; A.refresh();
        A.toast(`Placed ${ch.title} as ${b.ref}${b.conns.length ? `, with ${b.conns.length} external connector${b.conns.length > 1 ? 's' : ''}` : '. Tick Make external on its connectors to plug into it here'}.`);
        break;
      }
      case 'open-system': if (el && el.dataset.sys && S.store[el.dataset.sys]) openSub(el.dataset.sys); break;
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
          let added = 0, kept = false;
          change(x => {
            const b = block(x, b0.id);
            // Where each connector sits on the canvas before, so the block can move to keep them there (a new
            // outline changes the block's frame, Chris, 2026-11-13), and cables keep their shapes when it can.
            const was = new Map(b.conns.map(c => { const g = tabGeom(b, c); return [c.ref.toUpperCase(), { x: g.cx, y: g.mid }]; }));
            b.w = fresh.w; b.h = fresh.h; b.name = b.name || fresh.name; b.source = fresh.source;
            if (fresh.shape) b.shape = fresh.shape; else delete b.shape;
            fresh.conns.forEach(f => {
              const c = b.conns.find(k => k.ref.toUpperCase() === f.ref.toUpperCase());
              if (!c) { b.conns.push(f); added++; return; }
              Object.assign(c, { pins: f.pins, x: f.x, y: f.y, side: f.side, placed: f.placed, mpn: f.mpn, mfr: f.mfr, desc: f.desc });
            });
            const moves = b.conns.filter(c => was.has(c.ref.toUpperCase())).map(c => { const g = tabGeom(b, c), w0 = was.get(c.ref.toUpperCase()); return { dx: w0.x - g.cx, dy: w0.y - g.mid }; });
            const mx = moves.length ? median(moves.map(m => m.dx)) : 0, my = moves.length ? median(moves.map(m => m.dy)) : 0;
            b.x = +(b.x + mx / K).toFixed(2); b.y = +(b.y + my / K).toFixed(2);
            kept = moves.length > 0 && moves.every(m => Math.hypot(m.dx - mx, m.dy - my) < 2);
            if (!kept) x.cables.forEach(cab => { delete cab.routes; });
          });
          A.toast(`${b0.ref} refreshed from ${pkg.source ? pkg.source.label : 'its package'}${added ? `, with ${added} new connector${added > 1 ? 's' : ''}` : ''}${pkg.shape ? ', drawn as its outline' : ''}${kept ? '' : '. Its connectors moved, so cable shapes were reset'}.`);
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
        const b2 = change(x => { const b = block(x, S.sel.block), c = JSON.parse(JSON.stringify(b)); c.id = U.uid('b'); c.ref = nextRef(x.blocks, b.kind === 'device' ? 'D' : b.kind === 'system' ? 'S' : 'A'); c.x = b.x + 20; c.y = b.y + sizeOf(b).H + 20; if (b.kind === 'system') setConns(c, []); else c.conns.forEach(k => { k.id = U.uid('c'); }); x.blocks.push(c); return c; });
        S.sel = { kind: 'block', block: b2.id }; A.refresh(); break;
      }
      case 'delete-block': change(x => { const id = S.sel.block; x.blocks = x.blocks.filter(b => b.id !== id); x.cables.forEach(c => Object.keys(c.ends).forEach(k => { if (c.ends[k] && c.ends[k].block === id) c.ends[k] = null; })); S.sel = null; }); break;
      case 'delete-conn': change(x => { const b = block(x, S.sel.block), id = S.sel.conn; b.conns = b.conns.filter(c => c.id !== id); x.cables.forEach(c => Object.keys(c.ends).forEach(k => { if (c.ends[k] && c.ends[k].conn === id) c.ends[k] = null; })); S.sel = { kind: 'block', block: b.id }; }); break;
      case 'reset-route': change(x => { const cab = cable(x, S.sel.id); Object.keys(cab.routes || {}).forEach(k => { const r = LM.connect.apply(cab.routes[k], 'reset-route'); if (r) cab.routes[k] = r; else delete cab.routes[k]; }); if (cab.routes && !Object.keys(cab.routes).length) delete cab.routes; }); break;
      case 'delete-cable': change(x => { const id = S.sel.id; x.cables = x.cables.filter(c => c.id !== id); S.sel = null; }); break;
      case 'delete-multi': change(x => {
        const bs = new Set(selBlocks(S.sel)), cs = new Set(selCables(S.sel));
        x.blocks = x.blocks.filter(b => !bs.has(b.id));
        x.cables = x.cables.filter(c => !cs.has(c.id));
        x.cables.forEach(c => Object.keys(c.ends).forEach(k => { if (c.ends[k] && bs.has(c.ends[k].block)) c.ends[k] = null; }));
        S.sel = null;
      }); break;
      case 'pick-harness': S.picking = { block: S.sel.block, conn: S.sel.conn }; A.refresh(); break;
      case 'cancel-pick': S.picking = null; A.refresh(); break;
      case 'plug': {
        const h = A.harness(el.dataset.harness), b = block(s, S.sel.block), c = conn(b, S.sel.conn);
        const n = bestEnd(s, null, h, b, c);
        if (!n) break;
        const id = change(x => { const cab = { id: U.uid('k'), kind: 'harness', harness: h.id, ends: {}, lengthMm: null }; harnessEnds(h).forEach(e => { cab.ends[e.id] = null; }); cab.ends[n.id] = { block: b.id, conn: c.id }; const k = conn(block(x, b.id), c.id); k.used = true; x.cables.push(cab); return cab.id; });
        S.picking = null; S.sel = { kind: 'cable', id }; A.refresh();
        A.toast(`${h.title}'s end ${n.ref} plugs into ${b.ref} ${c.ref}. Pick where its other ends go.`);
        break;
      }
      case 'new-harness': {
        const b = block(s, S.sel.block), c = conn(b, S.sel.conn);
        const pb = S.pair && block(s, S.pair.block), pc = pb && conn(pb, S.pair.conn);
        const two = pc && pc !== c ? [{ b: pb, c: pc }, { b, c }] : [{ b, c }];
        const made = A.newHarness(s, two.map(e => look(e.b, e.c)));
        change(x => {
          const cab = { id: U.uid('k'), kind: 'harness', harness: made.h.id, ends: {}, lengthMm: null };
          made.ends.forEach((nodeId, i) => { if (two[i]) { cab.ends[nodeId] = { block: two[i].b.id, conn: two[i].c.id }; conn(block(x, two[i].b.id), two[i].c.id).used = true; } else cab.ends[nodeId] = null; });
          x.cables.push(cab);
          S.sel = { kind: 'cable', id: cab.id };
        });
        S.pair = null;
        A.toast(two.length > 1 ? `Made ${made.h.title} between ${two[0].b.ref} ${two[0].c.ref} and ${b.ref} ${c.ref}${made.suggested ? `, with ${made.suggested} wires from shared nets` : ''}.` : `Made ${made.h.title}, a placeholder plugged into ${b.ref} ${c.ref}. Open it to wire the far end.`);
        break;
      }
      case 'new-link': {
        // A generic connection between two connectors (a click on one, then the other, as wiring two
        // pins); its panel makes it a purchased cable or a Loom harness.
        const [p, q] = arg;
        const id = change(x => {
          const cab = { id: U.uid('k'), kind: 'link', name: '', ends: { a: { block: p.block, conn: p.conn }, b: { block: q.block, conn: q.conn } } };
          [p, q].forEach(e => { conn(block(x, e.block), e.conn).used = true; });
          x.cables.push(cab);
          return cab.id;
        });
        S.sel = { kind: 'cable', id }; S.pair = null; A.refresh();
        A.toast(`Connected ${endName(s, p)} to ${endName(s, q)}. Say in the panel whether it’s a purchased cable or a Loom harness.`);
        break;
      }
      case 'open-in-loom': openInLoom(); break;
      case 'open-harness-id': if (el && A.harness(el.dataset.harness)) A.openHarness(el.dataset.harness); break;
      case 'open-harness': { const cab = cable(s, S.sel.id); A.openHarness(cab.harness); break; }
      case 'open-ee': { const b = block(s, S.sel.block); location.href = `../ee_design_review/index.html?project=${encodeURIComponent(b.source.id)}${DEMO ? '&demo' : ''}`; break; }
      case 'delete-system':
        if (!confirm(`Delete ${s.title}? Its harnesses stay.`)) break;
        s.deleted = true; s.updated = now(); S.cur = null; S.root = null; persist(); A.home(); break;
    }
  }
  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (typing) return;
    if (S.tab === 'list' && !mod && e.key !== 'Escape') return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? swap(S.future, S.past) : swap(S.past, S.future); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); swap(S.future, S.past); return; }
    if (e.key === 'Escape') { if (menuEl) { closeMenu(); return; } if (S.pending) { S.pending = null; A.refresh(); return; } S.sel = null; S.pair = null; S.picking = null; S.adding = null; A.refresh(); return; }
    if (e.key.toLowerCase() === 'f' && !mod) { S.cam = bounds(cur()); A.refresh(); return; }
    // R turns the selected block 90 degrees clockwise, Shift+R back (Chris, 2026-11-12).
    if (e.key.toLowerCase() === 'r' && !mod && S.sel && S.sel.kind === 'block') { e.preventDefault(); act(e.shiftKey ? 'rotate-ccw' : 'rotate-cw'); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) {
      e.preventDefault();
      const sb = block(cur(), S.sel.block) || {};
      act(S.sel.kind === 'multi' ? 'delete-multi' : S.sel.kind === 'block' ? 'delete-block' : S.sel.kind === 'cable' ? 'delete-cable' : sb.source || sb.kind === 'system' ? '' : 'delete-conn');
    }
  }
  // Where a harness end plugs in, across every system (the harness editor's rail shows it).
  function plugsOf(hid, nodeId) {
    const out = [];
    live().forEach(s => s.cables.forEach(c => { if (c.harness !== hid) return; const e = c.ends[nodeId]; const where = endName(s, e); if (where) { const b = block(s, e.block); out.push({ system: s, text: `${b.name} ${conn(b, e.conn).ref} in ${s.title}` }); } }));
    return out;
  }

  // The sidebar's tree (Chris, 2026-11-12): systems placed in no other system at the top; under each, the
  // systems it places, then the harnesses its cables use. A system placed twice shows under both parents
  // (keyed by its path, so each folds on its own), and a harness under every system using it. used: every
  // harness some system uses (the rest stay in the project list).
  function tree() {
    const L = live(), placed = new Set(), used = new Set(), reached = new Set();
    L.forEach(s => s.blocks.forEach(b => { if (childOf(b) && b.system !== s.id) placed.add(b.system); }));
    const node = (s, trail) => {
      reached.add(s.id);
      const kids = [], seen = new Set(), hs = [];
      if (trail.length <= DEPTH) s.blocks.forEach(b => { const c = childOf(b); if (!c || seen.has(c.id) || trail.includes(c.id)) return; seen.add(c.id); kids.push(node(c, trail.concat(c.id))); });
      s.cables.forEach(cab => { if (kindOf(cab) === 'harness' && cab.harness && !hs.includes(cab.harness)) hs.push(cab.harness); });
      hs.forEach(h => used.add(h));
      return { id: s.id, sys: s, path: trail.join('>'), kids, harnesses: hs };
    };
    const roots = L.filter(s => !placed.has(s.id)).map(s => node(s, [s.id]));
    // Systems only reached through a loop still show, at the top.
    L.filter(s => !reached.has(s.id)).forEach(s => roots.push(node(s, [s.id])));
    return { roots, used };
  }

  // ── The demo: the Smart Thermostat's two boards and its wall wiring ──
  const DEMO_V = 5;
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
    // Wired (Chris, 2026-11-12: the demo system had no cables): the wall wires into Main PCBA J1, a
    // generic connection, and the 24-pin, 0.5 mm FFC from Main PCBA J2 to the Display board's J1, bought.
    const disp = s.blocks.find(b => b.source && b.source.id === 'pdemo11');
    const j2 = main && main.conns.find(c => c.ref === 'J2'), d1 = disp && disp.conns.find(c => c.ref === 'J1');
    if (j1) s.cables.push({ id: U.uid('k'), kind: 'link', name: 'Wall wires', ends: { a: { block: wall.id, conn: wall.conns[0].id }, b: { block: main.id, conn: j1.id } } });
    if (j2 && d1) {
      j2.used = true; j2.fn = 'Display'; d1.used = true; d1.fn = 'Main PCBA';
      s.cables.push({ id: U.uid('k'), kind: 'bought', name: '24-pin FFC, 0.5 mm pitch', lengthMm: 100, ends: { a: { block: main.id, conn: j2.id }, b: { block: disp.id, conn: d1.id } } });
    }
    if (stay) persist(); else open(s.id);
    return s;
  }

  // Discard changes (Chris, 2026-11-12, as for a harness): the open system goes back to its last synced
  // copy (store.js sysBase), as one more undo step, so Ctrl+Z brings the changes back.
  function discardTo(base) {
    const s = cur();
    if (!s || !base || base.id !== s.id) return false;
    S.past.push(JSON.stringify(s)); if (S.past.length > 120) S.past.shift(); S.future = [];
    S.store[S.cur] = normalize(base);
    S.sel = null; S.pending = null; S.pair = null; S.picking = null;
    persist(); A.refresh();
    return true;
  }
  // Save file: the system as a .loom.json, which Open a file opens again (openDoc).
  function saveFile() {
    const s = cur();
    if (s) U.download(U.fileSafe(s.title || 'system') + '.loom.json', JSON.stringify(s, null, 2), 'application/json');
  }
  // A saved system opened from a file: a new copy (a new id if this browser has one by that id), opened.
  function openDoc(doc) {
    const s = normalize(JSON.parse(JSON.stringify(doc)));
    if (S.store[s.id]) s.id = U.uid('s');
    delete s.deleted;
    if (!DEMO) delete s.demoVersion;
    s.updated = now();
    S.store[s.id] = s;
    open(s.id);
    return s;
  }
  function init(hooks) {
    A = hooks;
    const c = load();
    if (DEMO && (!S.store.sdemo1 || S.store.sdemo1.demoVersion !== DEMO_V)) setTimeout(() => demo(true).then(() => A.refresh()), 0);
    return c;
  }
  LM.system = { fitted, init, render, leave, open, create, demo, onKey, live, get: id => S.store[id], current: () => S.cur, close: () => { S.cur = null; S.root = null; S.focus = null; persist(); },
    store: () => S.store, persist, flush, busy: () => !!drag || !!S.pending, act, select: t => { S.sel = t; S.pair = null; S.picking = null; A.refresh(); }, pair: t => { S.pair = t; }, checks, summarize, status, statusOf, kindOf, endsOf, plugsOf, normalize, blank, addBoard, addDrawn, mkConn, bestEnd, pnOf, TAB, KINDS,
    layout: (s, view) => layoutNow(s, view), cells: n => { CELLS = n; },
    externals: s => externals(s), resolve: resolveAll, addSystem, places, parentsOf, tree, devLayout, drawnExtent, freshMinis: s => freshMinis(s, 0), turnAll,
    tab: () => S.tab, setTab, setFocus, overviewSel, focused: () => S.focus, root: () => S.root,
    canUndo: () => S.past.length > 0, canRedo: () => S.future.length > 0, discardTo, saveFile, openDoc };
})(window.LM = window.LM || {});
