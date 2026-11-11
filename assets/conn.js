// The connection view: a wiring diagram in the style of WireViz. Connectors are tables (a header, a
// type row, one row per pin), each top-level wire set is a box in the middle with one row per wire
// ("P1:3  BU  P2:3"), and every wire is a curve in its own color that runs through its box.
//
// Boxes: each outermost set (M.roots) gets a box, drawn with what holds each set inside it (lacing,
// a cable's sheath, a shield's braid, a twist) and a round badge with the outermost set's label.
// Wires in no set run in a plain stack with the others that join the same two ends. Splices are
// small nodes between boxes. Positions dragged by hand (h.place) win; the rest is
// automatic: ends and splices sit in columns
// by how far they are from the busiest connector, boxes sit in the columns between them, and each column
// is ordered to keep wires from crossing. The editor's canvas and the drawing sheet both use it.
(function (LM) {
  'use strict';
  const M = LM.model, U = LM.util, esc = U.esc;
  // PITCH is the spacing of every port (a connector's pin rows, a box's wire rows), so ports on all
  // parts share one ladder and lines up when the parts are dragged onto the same grid line.
  const PITCH = 20;
  const G = { PITCH, ROW: PITCH, HEAD: 24, INFO: 22, BROW: PITCH, GAP_X: 110, GAP_Y: 30, FS: 12 };
  // Sets nest inside a box: each level in is inset by NEST at both ends, and a set with lacing, a
  // sheath or a braid keeps END at its ends for them. BADGE is the room under the wires for the
  // outermost set's badge.
  const NEST = 24, END = 24, BADGE = 30;
  // A nested set running past its parent's end is drawn OUT past it plus its overhang to scale, at
  // most OVER_MAX; no set is drawn narrower than MIN_SET_W.
  const OUT = 6, OVER_MAX = 240, MIN_SET_W = 60;
  // Real proportions (view.prop): the shortest wire run is drawn MIN_RUN units long and the rest to
  // the same scale, but no run longer than MAX_RUN; a longer one gets a break (BREAK_W wide). A run
  // with no length is NOMINAL long. Inside a box, wires fan from their pins to their rows over FAN.
  const MIN_RUN = 170, MAX_RUN = 900, NOMINAL = 220, BREAK_W = 26, FAN = 40;
  // A shield's braid and a cable's sheath reach SET_R above their first wire and below their last,
  // snug round the wires; a cable is as thick as a shield (Chris, 2026-11-07). A set holding sets
  // reaches 3 past them, and a bundle keeps room for its lacing knots (BUNDLE_R).
  // A shield's braid is snug on its wires (Chris): their centers reach the twist's outer rows, and a
  // wire is drawn about 5 wide on the canvas, so 2.5 + 1.5 past their centers.
  const SET_R = 6, BUNDLE_R = 12, SHIELD_R = 4;
  // A cable packs its wires PACK apart, edges touching (Chris, 2026-11-07), so its sheath is as thick
  // as its conductors need: SET_R past its outer wires. They fan in to it from grid spacing and back
  // out over fanLen, and its box keeps LABEL_PAD either side of its wires' labels after the fan-out.
  const PACK = 5, LABEL_PAD = 8;
  // A lead (layout: the curve off a box's side toward its part) ends BREAKOUT short of the part, and
  // is drawn only when it runs at least MIN_LEAD; one bending too tight comes in to MIN_BRK first.
  const BREAKOUT = 40, MIN_LEAD = 30, MIN_BRK = 16;
  const fanLen = sp => Math.max(24, Math.min(90, (sp.i1 - sp.i0) * (PITCH - PACK) * 0.7));
  // The sets that pack their wires: cables, shields, and bundles inside no other (an inner one packs
  // with it).
  const packSpans = sz => (sz.spans || []).filter(sp => rides(sp.s) && !sz.spans.some(o => o !== sp && rides(o.s) && o.depth < sp.depth && o.i0 <= sp.i0 && o.i1 >= sp.i1));
  // The badges: one per set, in a row under the box, left-aligned (Chris).
  const BADGE_H = 22, BADGE_GAP = 8;
  const badgeW = label => Math.max(34, tw(label, 11) + 30);
  const hasEnds = s => !!(s.cable || s.shield || s.bundle);
  // The sets that pack their wires and ride a box's leads: those with ends, and twists (Chris).
  const rides = s => hasEnds(s) || !!s.twist;
  // Wire labels size nothing (Chris): a box gives its rows a nominal run, ROW_W. Where some of its
  // wires twist inside a set that is inset or has ends, a box's labels sit LEAD further right by
  // default, for the leader lines from each label to where its wire's twist starts.
  const ROW_W = 140, LEAD = 22;
  // Positions dragged before a box's label table moved under its wires (and then went) had the
  // first port lower by TABLE_SHIFT: a stack's before h.place v 2, a set's before v 3. They move
  // down by that, so their wires stay put.
  const TABLE_SHIFT = 40;
  const tableShift = (b, p) => (b.kind === 'stack' ? (b.wires.length > 1 && !(p.v >= 2) ? TABLE_SHIFT : 0) : (p.v >= 3 ? 0 : TABLE_SHIFT));
  const f = v => Math.round(v * 10) / 10;
  const tw = (s, size) => U.textW(s, size || G.FS);

  const pinRef = (h, e) => { const n = M.node(h, e.node); return M.label(n) + (e.pin && M.isConn(n) ? ':' + e.pin : ''); };
  const gaugeMetric = g => (g ? (M.AWG[g] ? M.AWG[g] + ' mm² (' + g + ' AWG)' : g + ' AWG') : '');
  const lenText = mm => (mm == null ? 'length not set' : Math.round(mm) + ' mm');

  // The boxes: one per outermost set, then a stack per end pair of the wires in no set, in wire
  // order. A wire alone between its two ends is a stack of one: just its label row over the wire,
  // with no badge (Chris). A wire with a loose end is in no box: it curves to its loose end's dot.
  const looseWire = (h, w) => M.isLoose(M.node(h, w.from.node)) || M.isLoose(M.node(h, w.to.node));
  function boxesOf(h) {
    const out = [], taken = new Set();
    M.roots(h).forEach(st => {
      const ws = M.wiresIn(h, st).map(id => M.wire(h, id)).filter(w => w && !looseWire(h, w));
      if (!ws.length) return;
      ws.forEach(w => taken.add(w.id));
      out.push({ key: 'g:' + st.id, kind: 'set', set: st, label: st.label, wires: ws });
    });
    const pairs = new Map();
    h.wires.slice().sort((a, b) => a.no - b.no).forEach(w => {
      if (taken.has(w.id) || looseWire(h, w)) return;
      const k = [w.from.node, w.to.node].sort().join('|');
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push(w);
    });
    pairs.forEach((ws, k) => out.push({ key: (ws.length > 1 ? 'p:' : 's:') + k, kind: 'stack', label: '', wires: ws }));
    return out;
  }

  // Columns: breadth-first distance from the busiest connector orients each joined pair, then each end
  // goes one column past the furthest end that feeds it.
  function ranks(h, boxes) {
    const nodes = h.nodes.filter(n => M.isConn(n) || n.kind === 'splice' || M.isLoose(n));
    const ids = new Set(nodes.map(n => n.id));
    const adj = new Map(nodes.map(n => [n.id, new Set()]));
    h.wires.forEach(w => {
      if (!ids.has(w.from.node) || !ids.has(w.to.node) || w.from.node === w.to.node) return;
      adj.get(w.from.node).add(w.to.node); adj.get(w.to.node).add(w.from.node);
    });
    const deg = id => h.wires.filter(w => w.from.node === id || w.to.node === id).length;
    const byRef = (a, b) => (M.isConn(b) - M.isConn(a)) || deg(b.id) - deg(a.id) || String(a.ref || '').localeCompare(String(b.ref || ''), 'en', { numeric: true });
    const seeds = nodes.slice().sort(byRef);
    const dist = new Map(), order = new Map();
    seeds.forEach(s => {
      if (dist.has(s.id)) return;
      dist.set(s.id, 0); order.set(s.id, order.size);
      const q = [s.id];
      while (q.length) {
        const x = q.shift();
        const next = [...adj.get(x)].map(id => M.node(h, id)).sort(byRef);
        next.forEach(n => { if (!dist.has(n.id)) { dist.set(n.id, dist.get(x) + 1); order.set(n.id, order.size); q.push(n.id); } });
      }
    });
    // At the same distance a splice comes first: it sits between the ends it joins.
    const sp = id => M.node(h, id).kind === 'splice';
    const before = (a, b) => dist.get(a) < dist.get(b) ||
      (dist.get(a) === dist.get(b) && (sp(a) !== sp(b) ? sp(a) : order.get(a) < order.get(b)));
    const rank = new Map(nodes.map(n => [n.id, 0]));
    const sorted = nodes.map(n => n.id).sort((a, b) => (before(a, b) ? -1 : 1));
    sorted.forEach(v => adj.get(v).forEach(u => { if (before(u, v)) rank.set(v, Math.max(rank.get(v), rank.get(u) + 1)); }));
    return { rank, order, before };
  }

  // Sizes of the tables and boxes.
  // A connector's info row (Chris): two cells, like the pin rows under it. The family and gender
  // ("JST GH receptacle") over the labels, and the count ("8-pins") over the pin numbers.
  function connInfo(n) {
    const fam = LM.library.family(n.family);
    const kind = [LM.library.kindName(n), LM.library.hasHousing(fam) ? (n.gender === 'plug' ? 'plug' : 'receptacle') : ''].filter(Boolean).join(' ');
    const count = n.pins + (fam.style === 'flying' ? '-lead' : '-pin') + (n.pins === 1 ? '' : 's');
    return { kind, count };
  }
  function pinLabel(h, n, p) {
    const lab = n.pinLabels && n.pinLabels[p];
    if (lab) return lab;
    const w = h.wires.find(x => (x.from.node === n.id && x.from.pin === p) || (x.to.node === n.id && x.to.pin === p));
    return w ? w.signal || '' : '';
  }
  // A small sketch of the connector for its header: the view the drawing prints (the front when it
  // prints both), at most H tall and 64 wide. A round face is twice as tall (Chris: at the header's
  // height it was a dot beside the wide rectangular ones), and the header grows to hold it.
  function sketchOf(h, n, H) {
    const v = LM.shapes.face(h, n, LM.shapes.views(n)[0]);
    const st = LM.library.family(n.family).style;
    if (st === 'circular' || (st === 'custom' && v.h > v.w * 0.55)) H *= 2;
    const k = Math.min(H / v.h, 64 / v.w);
    return { v, k, w: v.w * k, h: v.h * k };
  }
  function sizeConn(h, n) {
    const pins = M.pinList(n);
    const labels = pins.map(p => pinLabel(h, n, p));
    const labW = Math.max(64, ...labels.map(s => tw(s))) + 22;
    const info = connInfo(n);
    const numW = Math.max(26, tw(info.count), ...pins.map(p => tw(p))) + 18;
    const infoW = tw(info.kind) + 20 + numW;
    const hasName = !!n.name;
    const sk = sketchOf(h, n, hasName ? 30 : 16);
    const textW = Math.max(tw(n.ref, 13), n.name ? tw(n.name, 11) : 0);
    const headW = textW + 20 + sk.w + 8;
    const w = Math.max(labW + numW, infoW, headW, 150);
    const hh = Math.max(G.HEAD + (hasName ? 16 : 0), Math.ceil(sk.h + 8));
    const h0 = hh + G.INFO;
    return { w, h: h0 + pins.length * G.ROW, h0, hh, port0: h0 + G.ROW / 2, labels, info, numW, hasName, sk, textW };
  }
  // Each wire's row text, by wire id.
  function boxRows(h, b) {
    return new Map(b.wires.map(w => {
      const c = M.colorInfo(w.color);
      return [w.id, { w, from: pinRef(h, w.from), to: pinRef(h, w.to), color: c.code || '—' }];
    }));
  }
  // Every set under a box's set, with its depth (the box's own is 0).
  function setsUnder(h, st, depth, out) {
    out = out || [];
    out.push({ s: st, depth: depth || 0 });
    st.sets.forEach(id => { const c = M.set(h, id); if (c) setsUnder(h, c, (depth || 0) + 1, out); });
    return out;
  }
  function sizeBox(h, A, b) {
    const text = boxRows(h, b), rows = [...text.values()];
    // The labels' columns (from, color, to) are shared by a box's rows, so its labels line up where
    // they haven't been slid; they're only for drawing the labels (inner is a label's width).
    const cols = { from: Math.max(...rows.map(r => tw(r.from))), to: Math.max(...rows.map(r => tw(r.to))), c: Math.max(...rows.map(r => tw(r.color))) };
    let w = ROW_W, lead = 0;
    if (b.kind === 'set') {
      const all = setsUnder(h, b.set);
      const D = Math.max(0, ...all.map(x => x.depth));
      lead = all.some(x => x.s.twist && (x.depth > 0 || hasEnds(x.s))) ? LEAD : 0;
      w = Math.max(ROW_W + 2 * (END + D * NEST), 120);
    }
    const sz = { w, text, lead, cols, inner: cols.from + cols.c + cols.to + 40, rootW: w, lx: 0, k: 1, ext: new Map() };
    if (b.kind === 'set') {
      // Where each set's ends sit, from the box's left. rootW is the wires' run (the frame); k is
      // mm per unit to its scale (2 when the run isn't known). The outermost set at 0 overhang
      // spans the frame and one that stops short moves in by its overhang. A nested set at 0 sits
      // NEST inside its parent's ends; one that runs past (over > 0) is drawn OUT past them plus
      // its overhang, and one that stops inside moves in from the nested spot. Overhangs are
      // drawn at most OVER_MAX. The box grows to hold them all (lx: room added on the left).
      const run = M.setRun(A, b.set);
      sz.k = run ? Math.min(10, Math.max(0.3, run / w)) : 2;
      const ext = (st, p) => {
        const o = M.ov(st), pe = p || { x0: 0, x1: w }, nest = p ? NEST : 0;
        const side = (end, v, dir) => (v > 0 ? end + dir * (OUT + Math.min(v / sz.k, OVER_MAX)) : end - dir * nest + dir * Math.max(v / sz.k, -OVER_MAX));
        // Nothing is drawn past the wire ends (the frame, 0 to w): a set stored as running past them
        // (Checks warns) stops there.
        let x0 = Math.max(0, side(pe.x0, o.l, -1)), x1 = Math.min(w, side(pe.x1, o.r, 1));
        if (x1 - x0 < MIN_SET_W) { const c = Math.min(w - MIN_SET_W / 2, Math.max(MIN_SET_W / 2, (x0 + x1) / 2)); x0 = c - MIN_SET_W / 2; x1 = c + MIN_SET_W / 2; }
        return { x0, x1 };
      };
      const walk = (st, p) => { const e = ext(st, p); sz.ext.set(st.id, e); st.sets.forEach(id => { const c = M.set(h, id); if (c) walk(c, e); }); };
      walk(b.set, null);
      const xs = [...sz.ext.values()], lo = Math.min(0, ...xs.map(e => e.x0)), hi = Math.max(w, ...xs.map(e => e.x1));
      sz.lx = -lo;
      sz.ext.forEach(e => { e.x0 -= lo; e.x1 -= lo; });
      const all = setsUnder(h, b.set), badges = all.reduce((t, x) => t + badgeW(x.s.label) + BADGE_GAP, -BADGE_GAP);
      sz.w = Math.max(hi - lo, sz.lx + badges);
    }
    w = sz.w;
    arrange(h, b, sz, w2 => w2.no);
    // Room for a cable's wires to fan in before it, and after it to fan out and carry their labels
    // at grid spacing (Chris). Left room goes in lx, so the frame (and a placed box's wires) stay put.
    if (b.kind === 'set') {
      let addL = 0, need = 0;
      packSpans(sz).forEach(sp => {
        const e = sz.ext.get(sp.s.id), F = fanLen(sp);
        if (!e) return;
        addL = Math.max(addL, F - e.x0);
        need = Math.max(need, e.x1 + F + 2 * LABEL_PAD + sz.inner);
      });
      if (addL > 0) { sz.lx += addL; sz.ext.forEach(e => { e.x0 += addL; e.x1 += addL; }); sz.w += addL; need += addL; }
      sz.w = Math.max(sz.w, need);
    }
    return sz;
  }
  // Order a box's rows and find each set's rows in it. yOf(wire) is where the wire comes from, so
  // rows follow their ends and wires don't cross. A set's rows stay together (its own wires, a
  // twisted set's as one block, and each child set's), sorted by the mean of their wires' yOf; so
  // every set covers one run of rows, sz.spans: { s, depth, height, R, i0, i1 }, outermost first.
  // R is how far its drawing reaches above its first wire and below its last: more for a set with
  // sets inside it, so nested drawings sit inside each other. Two neighboring sets whose drawings
  // would touch get an empty row (on the pitch) between them. Sets the size's port0 and h.
  function arrange(h, b, sz, yOf) {
    const key = w => { const y = yOf(w); return y == null || !isFinite(y) ? 1e9 : y; };
    const byKey = (a, c) => a.key - c.key || a.no - c.no;
    const mean = xs => xs.reduce((t, x) => t + x, 0) / (xs.length || 1);
    if (b.kind !== 'set') {
      sz.rows = b.wires.map(w => ({ key: key(w), no: w.no, r: sz.text.get(w.id) })).sort(byKey).map(x => x.r);
      sz.spans = []; sz.R0 = 0; sz.port0 = 6 + G.BROW - 3;
      sz.h = 6 + sz.rows.length * G.BROW + 6;
      return;
    }
    const inBox = new Set(b.wires.map(w => w.id));
    function unit(st, depth) {
      const ws = st.wires.filter(id => inBox.has(id)).map(id => { const w = M.wire(h, id); return { kind: 'wire', w, key: key(w), no: w.no }; }).sort(byKey);
      let parts = st.twist && ws.length ? [{ kind: 'block', ws, key: mean(ws.map(x => x.key)), no: ws[0].no }] : ws;
      const kids = st.sets.map(id => M.set(h, id)).filter(Boolean).map(c => unit(c, depth + 1)).filter(u => u.rows.length);
      parts = parts.concat(kids).sort(byKey);
      const height = kids.length ? 1 + Math.max(...kids.map(u => u.height)) : 0;
      const R = Math.max(st.bundle ? BUNDLE_R : st.shield ? SHIELD_R : SET_R, ...kids.map(u => u.R + 3));
      const rows = [], spans = [];
      let prev = null;
      parts.forEach(pt => {
        if (pt.kind === 'set' && prev && prev.kind === 'set' && prev.R + pt.R > PITCH - 3) rows.push({ gap: true });
        const off = rows.length;
        if (pt.kind === 'wire') rows.push(sz.text.get(pt.w.id));
        else if (pt.kind === 'block') pt.ws.forEach(x => rows.push(sz.text.get(x.w.id)));
        else { rows.push(...pt.rows); pt.spans.forEach(sp => spans.push(Object.assign({}, sp, { i0: sp.i0 + off, i1: sp.i1 + off }))); }
        prev = pt;
      });
      const live = rows.filter(r => r.w);
      spans.unshift({ s: st, depth, height, R, i0: 0, i1: rows.length - 1 });
      return { kind: 'set', rows, spans, height, R, key: mean(live.map(r => key(r.w))), no: Math.min(...live.map(r => r.w.no)) };
    }
    const u = unit(b.set, 0), root = u.spans[0];
    // The outermost set has the box to itself; a bundle's lacing keeps BUNDLE_R.
    root.R = Math.max(b.set.bundle ? BUNDLE_R : SET_R, root.R);
    sz.rows = u.rows; sz.spans = u.spans; sz.R0 = root.R;
    // The first wire stays 23 below the box's top (where dragged positions expect it) unless the
    // outermost set reaches higher than that.
    sz.port0 = Math.max(6 + G.BROW - 3, root.R + 4);
    sz.h = sz.port0 + (sz.rows.length - 1) * PITCH + root.R + 6 + BADGE;
  }

  // view.prop: the real-proportions view (Chris). Its x comes from lengths (proportion, below),
  // and positions dragged by hand don't apply; the casual view keeps them.
  function layout(h, A, view) {
    A = A || M.analyze(h);
    const prop = !!(view && view.prop);
    const boxes = boxesOf(h);
    const R = ranks(h, boxes);
    const items = [];
    const itemOf = new Map();
    const place = prop ? {} : h.place || {};
    // Splice ports: one per wire, on the side it comes from (l or r). The order a drag left in
    // n.ports wins; the rest go on the side facing their other end and are sorted later.
    const sides = new Map();
    h.nodes.filter(n => n.kind === 'splice').forEach(n => {
      const at = h.wires.filter(w => w.from.node === n.id || w.to.node === n.id);
      const st = n.ports || {}, seen = new Set(), S = { l: [], r: [], fixed: { l: 0, r: 0 } };
      ['l', 'r'].forEach(k => (st[k] || []).forEach(id => {
        const w = at.find(x => x.id === id);
        if (w && !seen.has(id)) { seen.add(id); S[k].push(w); S.fixed[k]++; }
      }));
      at.filter(w => !seen.has(w.id)).sort((a, b) => a.no - b.no).forEach(w => {
        const o = w.from.node === n.id ? w.to.node : w.from.node;
        const po = place['n:' + o], ps = place['n:' + n.id];
        const left = po && ps ? po.x < ps.x : R.rank.get(o) < R.rank.get(n.id);
        S[left ? 'l' : 'r'].push(w);
      });
      sides.set(n.id, S);
    });
    // A splice's ports (Chris): every port is one pitch from the next, so wires leave parallel into
    // the next block, and both sides are centered on the junction line, where the ref sits and the
    // inside lines meet. A lone wire runs straight in; a side with an even count can't straddle a
    // pitch line, so its port just above the middle sits on the junction (two outputs: the top one
    // runs straight through, the other branches a pitch down). The box wraps its outermost ports
    // with the same margin above and below (Chris). port0 is the junction's offset from the top;
    // `dy(side, i)` is a port's offset from it.
    const SP_W = 64;
    const spliceSize = n => {
      const S = sides.get(n.id), cnt = { l: S.l.length, r: S.r.length };
      const above = k => Math.floor(Math.max(0, cnt[k] - 1) / 2);
      const up = Math.max(...['l', 'r'].map(above)) * PITCH;
      const down = Math.max(...['l', 'r'].map(k => Math.max(0, cnt[k] - 1) - above(k))) * PITCH;
      const dy = (k, i) => (i - above(k)) * PITCH;
      return { w: SP_W, h: up + down + 30, h0: 0, port0: up + 15, dy };
    };
    h.nodes.filter(n => M.isConn(n) || n.kind === 'splice' || M.isLoose(n)).forEach(n => {
      const kind = M.isConn(n) ? 'conn' : n.kind === 'splice' ? 'splice' : 'loose';
      const sz = kind === 'conn' ? sizeConn(h, n) : kind === 'splice' ? spliceSize(n) : { w: 0, h: 0, h0: 0, port0: 0 };
      const it = { kind, n, col: R.rank.get(n.id) * 2, sz };
      items.push(it); itemOf.set(n.id, it);
    });
    // Which wire an end object belongs to, for a splice end's port.
    const endOf = new Map();
    h.wires.forEach(w => { endOf.set(w.from, { w, which: 'from' }); endOf.set(w.to, { w, which: 'to' }); });
    function portOf(e) {
      const S = sides.get(e.node), o = endOf.get(e);
      if (!S || !o) return null;
      for (const k of ['l', 'r']) {
        const i = S[k].indexOf(o.w);
        if (i >= 0) return { side: k, i };
      }
      return null;
    }
    // A wire's left end is the one in the earlier column.
    const leftFirst = w => (R.before(w.from.node, w.to.node) ? [w.from, w.to] : [w.to, w.from]);
    boxes.forEach(b => {
      const col = Math.min(...b.wires.map(w => itemOf.get(leftFirst(w)[0].node).col)) + 1;
      const it = { kind: 'box', b, col, sz: sizeBox(h, A, b) };
      items.push(it); b.item = it;
    });

    // Columns left to right; x from the widest item in each.
    const ncol = Math.max(0, ...items.map(i => i.col)) + 1;
    const cols = Array.from({ length: ncol }, () => []);
    items.forEach(i => cols[i.col].push(i));
    const colW = cols.map(c => Math.max(0, ...c.map(i => i.sz.w)));
    const colX = [];
    let x = 0;
    colW.forEach((w, i) => { colX[i] = x; x += w + (w ? G.GAP_X : 0); });
    items.forEach(i => { i.x = colX[i.col] + (colW[i.col] - i.sz.w) / 2; i.w = i.sz.w; i.h = i.sz.h; });

    // Rows: each column is ordered by where its wires come from in the columns already placed.
    const pinIdx = (n, p) => Math.max(0, M.pinList(n).indexOf(p));
    const endY = e => {
      const it = itemOf.get(e.node);
      if (!it || it.y == null) return null;
      if (it.kind === 'loose') return it.y;
      if (it.kind === 'splice') { const pt = portOf(e); return it.y + it.sz.port0 + (pt ? it.sz.dy(pt.side, pt.i) : 0); }
      return it.y + it.sz.h0 + G.ROW * (pinIdx(it.n, e.pin) + 0.5);
    };
    const rowY = (it, i) => it.y + it.sz.port0 + G.BROW * i;
    // Auto-placed parts sit with their ports on the pitch, like dragged ones on the grid.
    const onPitch = it => Math.round((it.y + it.sz.port0) / PITCH) * PITCH - it.sz.port0;
    const boxRowY = new Map();
    const boxed = new Set(boxes.flatMap(b => b.wires.map(w => w.id)));
    cols.forEach((list, c) => {
      list.forEach(it => {
        let ys = [];
        if (it.kind === 'box') {
          // Order the rows by the height of their first placed end, which sets the box's height.
          arrange(h, it.b, it.sz, w => [w.from, w.to].map(endY).find(v => v != null));
          it.h = it.sz.h;
          ys = it.b.wires.map(w => [w.from, w.to].map(endY).find(y => y != null)).filter(y => y != null);
        }
        else {
          boxes.forEach(b => b.wires.forEach(w => {
            if (w.from.node !== it.n.id && w.to.node !== it.n.id) return;
            const y = boxRowY.get(w.id);
            if (y != null) ys.push(y);
          }));
          // A wire with no box: by where its other end already sits.
          h.wires.forEach(w => {
            if (boxed.has(w.id) || (w.from.node !== it.n.id && w.to.node !== it.n.id)) return;
            const y = endY(w.from.node === it.n.id ? w.to : w.from);
            if (y != null) ys.push(y);
          });
        }
        it.bary = ys.length ? ys.reduce((t, y) => t + y, 0) / ys.length : null;
      });
      if (c === 0) list.sort((a, b) => (R.order.get(a.n.id) || 0) - (R.order.get(b.n.id) || 0));
      else list.sort((a, b) => (a.bary == null) - (b.bary == null) || (a.bary || 0) - (b.bary || 0));
      let bottom = -Infinity;
      list.forEach(it => {
        // A box centers its wire rows (not its whole height, table and all) on the wires feeding
        // it, so wires that leave parallel, a splice's outputs say, run straight into its rows.
        const mid = it.kind === 'box' ? it.sz.port0 + G.BROW * (it.sz.rows.length - 1) / 2 : it.kind === 'splice' ? it.sz.port0 : it.h / 2;
        const want = it.bary == null ? bottom + G.GAP_Y : it.bary - mid;
        it.y = isFinite(bottom) ? Math.max(bottom + G.GAP_Y, want) : (it.bary == null ? 0 : want);
        it.y = onPitch(it);
        bottom = it.y + it.h;
        if (it.kind === 'box') it.sz.rows.forEach((r, i) => { if (r.w) boxRowY.set(r.w.id, rowY(it, i)); });
      });
    });
    // Columns placed without anything to their left start near the top.
    const minY = Math.floor(Math.min(0, ...items.map(i => i.y)) / PITCH) * PITCH;
    items.forEach(i => { i.y -= minY; });
    // Positions dragged by hand (`h.place`, keyed n:<node id> or b:<box key>) win over the auto
    // layout. Then each box's rows are re-sorted by where their wires now come from.
    items.forEach(i => {
      i.key = i.kind === 'box' ? 'b:' + i.b.key : 'n:' + i.n.id;
      const p = place[i.key];
      if (p && isFinite(p.x) && isFinite(p.y)) {
        // A box's stored x is its outermost set's left end, so a set running past it on the left
        // grows the box leftward and leaves the wires where they were.
        i.x = p.x - (i.kind === 'box' ? i.sz.lx || 0 : 0); i.y = p.y + (i.kind === 'box' ? tableShift(i.b, p) : 0); i.placed = true;
      }
    });
    // A stack (wires in no set: just their labels) that nobody dragged follows its ends once one of
    // them was dragged (Chris: the labels on a splice's outputs stayed put when P2 moved, bending
    // the wires). It centers between the parts on its left and right, with its rows centered on
    // their wires and on the pitch. A set's box stays where the layout or a drag put it, so it
    // doesn't slide onto other parts.
    // A set's box stays where it was put while it sits between the parts at its ends; once they're
    // moved so it doesn't (Chris: P4 dragged past TP2's box made its wires loop back), it
    // re-centers between them, keeping its height.
    boxes.forEach(b => {
      const it = b.item;
      if (b.kind !== 'set') return;
      const ends = b.wires.map(w => leftFirst(w).map(e => itemOf.get(e.node)));
      if (ends.some(e => !e[0] || !e[1])) return;
      const lx = Math.max(...ends.map(e => e[0].x + e[0].w)), rx = Math.min(...ends.map(e => e[1].x));
      if (it.x < lx - 1 || it.x + it.w > rx + 1) it.x = Math.round((lx + rx) / 2 - it.w / 2);
    });
    boxes.forEach(b => {
      const it = b.item;
      if (it.placed || b.kind !== 'stack') return;
      const ends = b.wires.flatMap(w => leftFirst(w).map((e, i) => ({ e, i, it: itemOf.get(e.node) }))).filter(o => o.it);
      if (!ends.some(o => o.it.placed)) return;
      const L = ends.filter(o => !o.i), R = ends.filter(o => o.i);
      if (!L.length || !R.length) return;
      const lx = Math.max(...L.map(o => o.it.x + o.it.w)), rx = Math.min(...R.map(o => o.it.x));
      const ys = ends.map(o => endY(o.e)).filter(y => y != null);
      it.x = Math.round((lx + rx) / 2 - it.w / 2);
      if (ys.length) it.y = Math.round((ys.reduce((t, y) => t + y, 0) / ys.length - G.BROW * (it.sz.rows.length - 1) / 2) / PITCH) * PITCH - it.sz.port0;
    });
    if (prop) proportion();
    // Real proportions: x from lengths. One scale s (units per mm) for the whole harness, from the
    // shortest run. In column order, each part sits as far right as its longest incoming run puts
    // it: a connector's left edge, or a splice's (or loose end's) middle, at the right edge (or
    // middle) of the part a wire comes from plus that wire's run, capped at MAX_RUN. A box then
    // spans the gap its wires cross exactly, and maps mm along its wires to x (box.sz.prop): to
    // scale, or, where its run was capped, to scale at both ends with a break between, a third of
    // the way along. Its sets are drawn at their true positions (M.reach).
    function proportion() {
      const len = w => { const v = A.wireLen.get(w.id); return v != null && v > 0 ? v : null; };
      const known = h.wires.map(len).filter(v => v != null);
      const s = known.length ? MIN_RUN / Math.min(...known) : 1;
      const gap = w => (len(w) == null ? NOMINAL : Math.min(len(w) * s, MAX_RUN));
      const inX = new Map(), outX = new Map(), parts = items.filter(i => i.kind !== 'box');
      // Parts nothing feeds from the left line up on their right edges, like the first column.
      const fed = new Set(h.wires.map(w => leftFirst(w)[1].node));
      const start = Math.max(0, ...parts.filter(i => !fed.has(i.n.id)).map(i => i.w));
      parts.sort((a, b) => a.col - b.col || (a.y || 0) - (b.y || 0)).forEach(it => {
        let x = fed.has(it.n.id) ? 0 : start - (it.kind === 'conn' ? 0 : it.w / 2);
        h.wires.forEach(w => {
          const [l, r] = leftFirst(w);
          if (r.node === it.n.id && outX.has(l.node)) x = Math.max(x, outX.get(l.node) + gap(w));
        });
        inX.set(it.n.id, x);
        if (it.kind === 'conn') { it.x = fed.has(it.n.id) ? x : start - it.w; outX.set(it.n.id, it.x + it.w); } else { it.x = x - it.w / 2; outX.set(it.n.id, x); }
      });
      // A box spans from the edge of the parts on its left to the edge of those on its right.
      const edgeR = id => { const i = itemOf.get(id); return i ? i.x + i.w : 0; }, edgeL = id => { const i = itemOf.get(id); return i ? i.x : null; };
      boxes.forEach(b => {
        const it = b.item, sz = it.sz;
        const x0 = Math.max(...b.wires.map(w => edgeR(leftFirst(w)[0].node)));
        const x1 = Math.min(...b.wires.map(w => { const v = edgeL(leftFirst(w)[1].node); return v == null ? x0 + NOMINAL : v; }));
        const W = Math.max(60, x1 - x0);
        const runs = b.kind === 'set' ? [M.setRun(A, b.set)] : b.wires.map(len);
        const L0 = runs.every(v => v != null) ? Math.max(...runs) : null, L = L0 || W / s;
        let map, inv, brk = null;
        // A run a little longer than its gap (a splice's width, say) is drawn squeezed; only one
        // too long to draw (past MAX_RUN) gets a break.
        if (L * s > W + 2 * FAN) {
          // To scale at both ends, a break between them a third of the way along.
          const a1 = (W - BREAK_W) / 3, a2 = W - BREAK_W - a1, mid = L * s - a1 - a2;
          map = mm => { const u = mm * s; return u <= a1 ? u : (L - mm) * s <= a2 ? W - (L - mm) * s : a1 + BREAK_W * (u - a1) / mid; };
          inv = u => (u <= a1 ? u / s : u >= W - a2 ? L - (W - u) / s : (a1 + (u - a1) / BREAK_W * mid) / s);
          brk = { x: a1 + BREAK_W / 2, L };
          sz.textC = (a1 + BREAK_W + W) / 2;
        } else {
          map = mm => mm * W / L; inv = u => u * L / W;
          sz.textC = W / 2;
        }
        it.x = x0; it.w = W; it.fan = FAN; it.brk = brk;
        sz.w = W; sz.rootW = W; sz.lx = 0;
        sz.prop = { L, map, inv };
        // A set that runs past its wire ends (Checks warns) stops at them here.
        if (b.kind === 'set') setsUnder(h, b.set).forEach(({ s: st }) => {
          const r = M.reach(h, st);
          let e0 = map(Math.max(0, r.l)), e1 = map(L - Math.max(0, r.r));
          if (e1 - e0 < 12) { const c = (e0 + e1) / 2; e0 = c - 6; e1 = c + 6; }
          sz.ext.set(st.id, { x0: e0, x1: e1 });
        });
      });
      // Heights dragged in this view (Chris: x comes from lengths, but connectors, splices, and sets
      // move up and down). They're kept in h.propY by item key (n:<node id>, b:<box key>), apart
      // from the arranged view's h.place. A box nobody moved whose end was moved centers its rows
      // on its ends' heights, on the pitch.
      const py = h.propY || {};
      items.forEach(it => { const y = py[it.key]; if (y != null && isFinite(+y)) { it.y = +y; it.pinned = true; } });
      if (parts.some(i => i.pinned)) boxes.forEach(b => {
        const it = b.item, es = b.wires.flatMap(w => [w.from, w.to]);
        if (it.pinned) return;
        if (!es.some(e => { const o = itemOf.get(e.node); return o && o.pinned; })) return;
        const ys = es.map(endY).filter(y => y != null);
        if (ys.length) it.y = Math.round(((Math.min(...ys) + Math.max(...ys)) / 2 - PITCH * (it.sz.rows.length - 1) / 2) / PITCH) * PITCH - it.sz.port0;
      });
      // Boxes now span their real runs, so they can reach into another column's parts: from the
      // top down, anything that would overlap what's already placed moves down below it. Once
      // something was dragged, what it's dragged against goes first and stays put, and anything
      // else that overlaps takes the nearest free height above or below, on the pitch, so a box
      // doesn't drop below everything (Chris).
      const done = [], down = it => Math.ceil((it.y + it.sz.port0) / PITCH) * PITCH - it.sz.port0;
      const hits = (it, y) => done.some(o => it.x < o.x + o.w - 1 && o.x < it.x + it.w - 1 && y < o.y + o.h + 12 && o.y < y + it.h + 12);
      const anyPinned = items.some(i => i.pinned);
      items.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.y - b.y || a.x - b.x).forEach(it => {
        if (anyPinned) {
          if (!it.pinned && hits(it, it.y)) {
            const y0 = it.y;
            for (let k = 1; k < 400; k++) {
              if (!hits(it, y0 + k * PITCH)) { it.y = y0 + k * PITCH; break; }
              if (!hits(it, y0 - k * PITCH)) { it.y = y0 - k * PITCH; break; }
            }
          }
          done.push(it);
          return;
        }
        for (let again = true; again;) {
          again = false;
          for (const o of done) {
            // Touching sideways is fine (a box meets the parts at its ends); overlapping isn't.
            if (it.x < o.x + o.w - 1 && o.x < it.x + it.w - 1 && it.y < o.y + o.h + 12 && o.y < it.y + it.h + 12) {
              it.y = down({ y: o.y + o.h + G.GAP_Y, sz: it.sz });
              again = true;
            }
          }
        }
        done.push(it);
      });
    }
    // Splice ports nobody arranged follow the wires they lead to, so the wires don't cross.
    const yOfWire = (w, id) => {
      if (boxRowY.has(w.id)) return boxRowY.get(w.id);
      const y = endY(w.from.node === id ? w.to : w.from);
      return y == null ? 0 : y;
    };
    sides.forEach((S, id) => ['l', 'r'].forEach(k => {
      const rest = S[k].slice(S.fixed[k]).sort((a, b) => yOfWire(a, id) - yOfWire(b, id) || a.no - b.no);
      S[k] = S[k].slice(0, S.fixed[k]).concat(rest);
    }));
    if (items.some(i => i.placed || i.pinned) || sides.size) boxes.forEach(b => {
      const it = b.item, cx = it.x + it.w / 2;
      const yOf = w => { const e = [w.from, w.to].map(x => ({ e: x, it: itemOf.get(x.node) })).filter(o => o.it).sort((a, c) => Math.abs(a.it.x - cx) - Math.abs(c.it.x - cx))[0]; return e ? endY(e.e) : 0; };
      arrange(h, b, it.sz, yOf);
      it.h = it.sz.h;
    });
    boxes.forEach(b => b.item.sz.rows.forEach((r, i) => { if (r.w) boxRowY.set(r.w.id, rowY(b.item, i)); }));

    // A twisted set's own wires twist together inside their box; arrange keeps them on
    // neighboring rows.
    const twistOf = new Map();
    boxes.forEach(b => b.item.sz.spans.forEach(sp => {
      if (!sp.s.twist) return;
      const ws = b.item.sz.rows.slice(sp.i0, sp.i1 + 1).filter(r => r.w && sp.s.wires.includes(r.w.id)).map(r => r.w);
      if (ws.length > 1) ws.forEach((w, i) => twistOf.set(w.id, { ws, i, sp, it: b.item }));
    }));

    // Anchors: a pin row's edge facing the other end.
    function anchor(e, towardX) {
      const it = itemOf.get(e.node);
      if (!it) return { x: 0, y: 0 };
      if (it.kind === 'loose') return { x: it.x, y: it.y };
      if (it.kind === 'splice') { const pt = portOf(e); if (pt) return { x: pt.side === 'l' ? it.x : it.x + it.w, y: endY(e) }; }
      const right = towardX > it.x + it.w / 2;
      return { x: right ? it.x + it.w : it.x, y: endY(e) };
    }

    // ── Paths and leads ──
    // Each set box has a path: the straight run across the box at its rows' middle (cy) and, in
    // the arranged view, a lead off each side toward the one part its wires run to there (Chris:
    // drag a cable's, shield's, or bundle's ends along the curves, closer to the connectors). u is
    // the distance along the path, and the wires' run maps onto all of it at one scale (sz.k, mm
    // per unit), so a set reaching its wire ends is drawn to the end of each lead, a breakout short
    // of the part, and its wires fan to their pins from wherever it ends. A box whose sets hold no
    // cable, shield, or bundle (a twist alone) has no leads: its path is its frame, as before.
    // Lessons from the first try (branch `sets`, Chris: glitchy once ends crossed or parts moved):
    // - Only packed wires ride a lead; a band at grid spacing folds over itself on a bend.
    // - No fixed breakout the wires must meet: they leave the lead where their set ends, along it.
    // - A lead is two circular arcs, level at both ends, with a straight between when it climbs
    //   further than it runs, so its tightest radius is known; a side whose lead would bend tighter
    //   than its wires need, or whose part isn't out to that side, has no lead.
    // - Sets are placed by where they reach along the path (M.reach), not relative to their
    //   parents, so a nested set's end passes its parent's cleanly.
    function biarc(P0, P1) {
      const dx = P1.x - P0.x, dy = P1.y - P0.y, sg = dy < 0 ? -1 : 1, ady = Math.abs(dy), out = [];
      const push = (x, y, tx, ty) => out.push({ x, y, nx: -ty, ny: tx });
      let r = Infinity;
      if (ady < 0.5) { const n = Math.max(2, Math.ceil(dx / 4)); for (let i = 0; i <= n; i++) push(P0.x + dx * i / n, P0.y + dy * i / n, 1, 0); }
      else {
        let th, L = 0;
        if (ady <= dx) { th = 2 * Math.atan(ady / dx); r = dx / (2 * Math.sin(th)); } else { th = Math.PI / 2; r = dx / 2; L = ady - dx; }
        const n1 = Math.max(4, Math.ceil(r * th / 4));
        for (let i = 0; i <= n1; i++) { const a = th * i / n1; push(P0.x + r * Math.sin(a), P0.y + sg * r * (1 - Math.cos(a)), Math.cos(a), sg * Math.sin(a)); }
        const m = out[out.length - 1];
        if (L > 0) { const n2 = Math.max(1, Math.ceil(L / 4)); for (let i = 1; i <= n2; i++) push(m.x, m.y + sg * L * i / n2, 0, sg); }
        for (let i = n1 - 1; i >= 0; i--) { const a = th * i / n1; push(P1.x - r * Math.sin(a), P1.y - sg * r * (1 - Math.cos(a)), Math.cos(a), sg * Math.sin(a)); }
      }
      let s = 0;
      out.forEach((p, i) => { if (i) s += Math.hypot(p.x - out[i - 1].x, p.y - out[i - 1].y); p.s = s; });
      return { pts: out, S: s, r };
    }
    // The lead off one side of a box (k 0 left, 1 right), or null: from the box's edge at cy to a
    // breakout BREAKOUT (more for a tall spread of pins) short of the part, level with the middle of
    // its pins. need is how far the box's packed wires reach from the path's middle.
    // Leads leaving one part's side the same way (both climbing, say) nest instead of lying on each
    // other: the one going furthest turns first, and each next one's breakout is further out by
    // twice their half-widths and a gap, which puts their turns (halfway along) a band apart.
    const stagger = new Map();
    const rowYs = it => it.sz.rows.map((r, i) => (r.w ? rowY(it, i) : null)).filter(v => v != null);
    const midY = it => { const ys = rowYs(it); return (Math.min(...ys) + Math.max(...ys)) / 2; };
    // How far a box's wires reach from its path's middle on a lead: packed in a set's box, at their
    // rows in a stack.
    const reachOf = it => { const ys = rowYs(it), c = midY(it), o = Math.max(...ys.map(y => Math.abs(y - c))); return it.b.kind === 'set' ? o * PACK / PITCH + it.sz.R0 + 2 : o + 4; };
    [0, 1].forEach(k => {
      const groups = new Map();
      boxes.forEach(b => {
        const es = b.wires.map(w => leftFirst(w)[k]);
        if (new Set(es.map(e => e.node)).size !== 1) return;
        const ys = es.map(endY).filter(y => y != null);
        if (!ys.length) return;
        const dy = midY(b.item) - (Math.min(...ys) + Math.max(...ys)) / 2, g = es[0].node + '|' + Math.sign(Math.round(dy));
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push({ b, d: Math.abs(dy) });
      });
      groups.forEach(list => {
        let x = 0;
        list.sort((a, c) => c.d - a.d).forEach((o, i) => { if (i) x += 2 * (reachOf(list[i - 1].b.item) + reachOf(o.b.item) + 6); stagger.set(o.b.key + '|' + k, x); });
      });
    });
    function leadSide(it, k, cy, need) {
      const es = it.b.wires.map(w => leftFirst(w)[k]);
      if (new Set(es.map(e => e.node)).size !== 1) return null;
      const pit = itemOf.get(es[0].node);
      if (!pit || pit.kind === 'loose') return null;
      const as = es.map(e => anchor(e, k ? -Infinity : Infinity)), ys = as.map(p => p.y);
      const brk = Math.max(BREAKOUT, Math.min(120, (Math.max(...ys) - Math.min(...ys)) * 0.6)) + (stagger.get(it.b.key + '|' + k) || 0);
      const ax = k ? Math.min(...as.map(p => p.x)) : Math.max(...as.map(p => p.x));
      const E = { x: k ? it.x + it.w : it.x, y: cy }, by = (Math.min(...ys) + Math.max(...ys)) / 2;
      // Too tight a turn for its wires: the breakout comes in toward the part (to MIN_BRK) for room.
      for (let b = brk; ; b = Math.max(MIN_BRK, b - 8)) {
        const B = { x: k ? ax - b : ax + b, y: by };
        if ((k ? B.x - E.x : E.x - B.x) >= MIN_LEAD) {
          const L = k ? biarc(E, B) : biarc(B, E);
          if (L.r >= need + 4) return L;
        }
        if (b <= MIN_BRK) return curveLead(it, E, es, pit, by, k, need);
      }
    }
    // Where no two-arc lead fits (the part above or below and not far enough out to the side, or
    // behind the box's edge), the lead is a free curve (Chris, 2026-11-10: anchors and set ends should
    // slide all the way round in the arranged view; only connections and a clean drawing matter
    // there). It leaves the box level and reaches the pins on the side the wires are drawn to (as
    // wirePath's anchor, facing the box), stopping MIN_BRK short of them so the wires still fan in.
    // Pointing the same way at both ends it's an S (a cubic); pointing opposite ways (the part is
    // behind the box's edge) it runs straight to a U-turn of the height between them and back, so it
    // never folds into a hairpin. Too tight for its wires (radius under need + 4), there's no lead.
    function curveLead(it, E, es, pit, by, k, need) {
      const cx = it.x + it.w / 2, bs = es.map(e => anchor(e, cx));
      const near = bs.reduce((m, p) => (Math.abs(p.x - E.x) < Math.abs(m.x - E.x) ? p : m), bs[0]);
      const B = { x: near.x, y: by }, dB = near.x > pit.x + pit.w / 2 ? 1 : -1;
      // In travel order (left to right along the path): from p heading tp to q heading tq.
      const p = k ? E : B, q = k ? B : E, tp = k ? 1 : dB, tq = k ? -dB : 1;
      const raw = [], line = (a, b) => { const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4)); for (let i = 1; i <= n; i++) raw.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }); };
      const cubic = (a, c1, c2, b) => { for (let i = 1; i <= 48; i++) { const t = i / 48, u = 1 - t; raw.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y }); } };
      raw.push({ x: p.x, y: p.y });
      const uTurn = (a, b, t) => { const d = Math.abs(b.y - a.y) * 2 / 3; cubic(a, { x: a.x + t * d, y: a.y }, { x: b.x + t * d, y: b.y }, b); };
      if (tp === tq && (q.x - p.x) * tp < 30) {
        // Pointing the same way with q behind p (a splice port facing away): out past p, a U-turn to
        // halfway, back past q, and a U-turn into it.
        const X1 = tp > 0 ? Math.max(p.x, q.x) : Math.min(p.x, q.x), X2 = tp > 0 ? Math.min(p.x, q.x) : Math.max(p.x, q.x), ym = (p.y + q.y) / 2;
        if (Math.abs(q.y - p.y) < 2) return null;
        line(p, { x: X1, y: p.y }); uTurn({ x: X1, y: p.y }, { x: X1, y: ym }, tp);
        line({ x: X1, y: ym }, { x: X2, y: ym }); uTurn({ x: X2, y: ym }, { x: X2, y: q.y }, -tp);
        line({ x: X2, y: q.y }, q);
      } else if (tp === tq) {
        const d = Math.max(30, Math.abs(q.x - p.x) * 0.5, Math.abs(q.y - p.y) * 0.5);
        cubic(p, { x: p.x + tp * d, y: p.y }, { x: q.x - tq * d, y: q.y }, q);
      } else {
        // The U-turn: a cubic close to a half circle of the height between them, past whichever is further out.
        const X = tp > 0 ? Math.max(p.x, q.x) : Math.min(p.x, q.x), h = Math.abs(q.y - p.y), d = h * 2 / 3;
        if (h < 1) return null;
        line(p, { x: X, y: p.y });
        cubic({ x: X, y: p.y }, { x: X + tp * d, y: p.y }, { x: X + tp * d, y: q.y }, { x: X, y: q.y });
        line({ x: X, y: q.y }, q);
      }
      const pts = raw.filter((pt, i) => !i || Math.hypot(pt.x - raw[i - 1].x, pt.y - raw[i - 1].y) > 0.01);
      if (pts.length < 3) return null;
      let S = 0, rMin = Infinity;
      pts.forEach((pt, i) => {
        if (i) S += Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y);
        pt.s = S;
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], m = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        pt.nx = -(b.y - a.y) / m; pt.ny = (b.x - a.x) / m;
      });
      // The tightest turn: the angle between neighboring steps over their length.
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], o = pts[i], b = pts[i + 1];
        const t1 = Math.atan2(o.y - a.y, o.x - a.x), t2 = Math.atan2(b.y - o.y, b.x - o.x);
        let th = Math.abs(t2 - t1); if (th > Math.PI) th = 2 * Math.PI - th;
        if (th > 1e-4) rMin = Math.min(rMin, ((Math.hypot(o.x - a.x, o.y - a.y) + Math.hypot(b.x - o.x, b.y - o.y)) / 2) / th);
      }
      if (rMin < need + 4 || S < MIN_BRK + 8) return null;
      // Trim MIN_BRK off the pin end, and measure from the lead's start again.
      const kept = k ? pts.filter(pt => pt.s <= S - MIN_BRK) : pts.filter(pt => pt.s >= MIN_BRK);
      const s0 = kept[0].s;
      kept.forEach(pt => { pt.s -= s0; });
      return { pts: kept, S: kept[kept.length - 1].s, r: rMin };
    }
    // Every box's path (it.path) and where each of its sets reaches along it (sz.arc: u0, u1). Sets
    // that pack (cables, shields, bundles, twists) ride the leads; any other stays on the straight
    // part. A stack (wires in no set) gets a path too, and each of its wires a left and a right
    // anchor (w.anchors: mm in from that side's wire end; unset, at the box's edge; sz.warc), handles that slide
    // along the curves like a cable's ends (Chris): the wire rides the path between them and fans to
    // its pins from them. In Real proportions the path is the box, sz.ext (from proportion) says
    // where sets reach, and sz.prop where anchors sit.
    boxes.forEach(b => {
      const it = b.item, sz = it.sz, isSet = b.kind === 'set';
      const ys = sz.rows.map((r, i) => (r.w ? rowY(it, i) : null)).filter(v => v != null);
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const leads = !prop && (!isSet || setsUnder(h, b.set).some(x => rides(x.s)));
      const need = reachOf(it);
      const lL = leads ? leadSide(it, 0, cy, need) : null, lR = leads ? leadSide(it, 1, cy, need) : null;
      const xa = prop || lL ? it.x : it.x + sz.lx, xb = prop || lR ? it.x + it.w : it.x + sz.lx + sz.rootW;
      const aL = lL ? lL.S : 0, Ls = xb - xa, aR = lR ? lR.S : 0, S = aL + Ls + aR;
      const pts = (lL ? lL.pts : []).concat([{ x: xa, y: cy, nx: 0, ny: 1, s: aL }, { x: xb, y: cy, nx: 0, ny: 1, s: aL + Ls }],
        lR ? lR.pts.map(p => Object.assign({}, p, { s: p.s + aL + Ls })) : []);
      it.path = { pts, S, aL, Ls, aR, xa, xb, cy, lL, lR };
      sz.arc = new Map(); sz.warc = new Map();
      const span = (u0, u1, lo, hi) => {
        u0 = Math.min(hi, Math.max(lo, u0)); u1 = Math.max(lo, Math.min(hi, u1));
        if (u1 - u0 < 12) { const c = Math.min(hi - 6, Math.max(lo + 6, (u0 + u1) / 2)); u0 = c - 6; u1 = c + 6; }
        return { u0, u1 };
      };
      if (!isSet) {
        const lens = b.wires.map(w => A.wireLen.get(w.id)).filter(v => v != null && v > 0), run = lens.length ? Math.max(...lens) : null;
        sz.k = run ? Math.min(10, Math.max(0.3, run / S)) : 2;
        b.wires.forEach(w => {
          // Unset, an anchor sits at the box's edge, so the wire curves to its pin as it always did.
          const an = w.anchors || {}, at = (v, side) => (v == null ? (side ? aL + Ls : aL) : prop && sz.prop ? sz.prop.map(side ? sz.prop.L - +v : +v) : side ? S - +v / sz.k : +v / sz.k);
          sz.warc.set(w.id, span(at(an.l, 0), at(an.r, 1), 0, S));
        });
        return;
      }
      if (prop) { sz.ext.forEach((e, id) => sz.arc.set(id, { u0: e.x0, u1: e.x1 })); return; }
      const run = M.setRun(A, b.set);
      sz.k = run ? Math.min(10, Math.max(0.3, run / S)) : 2;
      setsUnder(h, b.set).forEach(({ s: st }) => {
        const r = M.reach(h, st), lo = rides(st) ? 0 : aL, hi = rides(st) ? S : aL + Ls;
        sz.arc.set(st.id, span(r.l / sz.k, S - r.r / sz.k, lo, hi));
      });
    });

    // Packing (Chris: cables, shields, bundles, and twists hold their wires PACK apart, edges touching). Each
    // boxed wire's chain is the sets that pack it, innermost first, each with where it reaches, the
    // middle of its rows (c) and its fan length; the wire eases from its row into each over F before
    // the set's end. packAt gives its height at u for a base height (its row, or the helix).
    // How a packing set packs its rows (Chris: snug): its wires PACK apart, edges touching, and a
    // packing set inside it as wide as its own band (its packed wires plus its R each side), touching
    // its neighbors, all centered on the set. packOff gives each wire's offset from the set's middle;
    // packFn maps a height in row space to its packed offset, piecewise between the wire rows, so a
    // helix swinging between a twist's rows maps too.
    const packOff = new Map();
    function packLayout(it, sp) {
      if (packOff.has(sp)) return packOff.get(sp);
      const kids = it.sz.spans.filter(o => o.depth === sp.depth + 1 && rides(o.s) && o.i0 >= sp.i0 && o.i1 <= sp.i1);
      const items = [];
      for (let i = sp.i0; i <= sp.i1; i++) {
        const k = kids.find(o => o.i0 <= i && o.i1 >= i);
        if (k) {
          if (k.i0 === i) { const L = packLayout(it, k), offs = [...L.values()]; items.push({ L, half: (offs.length ? Math.max(...offs.map(Math.abs)) : 0) + k.R }); }
          continue;
        }
        const r = it.sz.rows[i];
        if (r && r.w) items.push({ w: r.w, half: PACK / 2 });
      }
      const pos = [];
      items.forEach((m, j) => pos.push(j ? pos[j - 1] + items[j - 1].half + m.half : 0));
      const mid = items.length ? (pos[0] - items[0].half + pos[pos.length - 1] + items[items.length - 1].half) / 2 : 0;
      const out = new Map();
      items.forEach((m, j) => { const c = pos[j] - mid; if (m.w) out.set(m.w.id, c); else m.L.forEach((v, id) => out.set(id, c + v)); });
      packOff.set(sp, out);
      return out;
    }
    function packFn(it, sp) {
      const L = packLayout(it, sp), c = (rowY(it, sp.i0) + rowY(it, sp.i1)) / 2;
      const P = [];
      for (let i = sp.i0; i <= sp.i1; i++) { const r = it.sz.rows[i]; if (r && r.w && L.has(r.w.id)) P.push({ y: rowY(it, i) - c, o: L.get(r.w.id) }); }
      const k = PACK / PITCH;
      return y => {
        y -= c;
        if (!P.length) return y * k;
        if (y <= P[0].y) return P[0].o + (y - P[0].y) * k;
        const z = P[P.length - 1];
        if (y >= z.y) return z.o + (y - z.y) * k;
        let i = 1;
        while (P[i].y < y) i++;
        const a = P[i - 1], b = P[i], t = (y - a.y) / (b.y - a.y || 1);
        return a.o + (b.o - a.o) * t;
      };
    }
    const chainOf = new Map();
    boxes.forEach(b => {
      const it = b.item;
      // A stack's wires: their anchors, which pack nothing but say where each leaves the path.
      if (b.kind !== 'set') { it.sz.warc.forEach((a, id) => chainOf.set(id, [{ a, own: true, F: 1 }])); return; }
      it.sz.spans.slice().sort((x, y) => y.depth - x.depth).forEach(sp => {
        const a = it.sz.arc.get(sp.s.id);
        if (!rides(sp.s) || !a) return;
        const k = { sp, a, c: (rowY(it, sp.i0) + rowY(it, sp.i1)) / 2, F: fanLen(sp), f: packFn(it, sp) };
        it.sz.rows.slice(sp.i0, sp.i1 + 1).forEach(r => { if (r.w) { if (!chainOf.has(r.w.id)) chainOf.set(r.w.id, []); chainOf.get(r.w.id).push(k); } });
      });
    });
    const cover = (k, u) => (u < k.a.u0 ? smooth((u - k.a.u0 + k.F) / k.F) : u > k.a.u1 ? smooth((k.a.u1 + k.F - u) / k.F) : 1);
    function packAt(w, u, base) {
      let y = base;
      (chainOf.get(w.id) || []).forEach(k => { const m = k.own ? 0 : cover(k, u); if (m > 0) y += (k.c + k.f(base) - y) * m; });
      return y;
    }
    // A boxed wire's point at u along its box's path: its packed height, as an offset across it.
    const wpt = (w, it, u, base) => { const p = pathAt(it.path, u), o = packAt(w, u, base) - it.path.cy; return { x: p.x + p.nx * o, y: p.y + p.ny * o }; };
    // Where a wire leaves a lead for its pin: the furthest end of the sets that pack it, when that
    // end is out on the lead (null: it fans straight to the box, as before).
    function joins(w, it) {
      const P = it.path, ch = chainOf.get(w.id) || [];
      if (!P || !ch.length) return { l: null, r: null };
      const u0 = Math.min(...ch.map(k => k.a.u0)), u1 = Math.max(...ch.map(k => k.a.u1));
      return { l: P.lL && u0 < P.aL - 0.5 ? u0 : null, r: P.lR && u1 > P.aL + P.Ls + 0.5 ? u1 : null };
    }
    const steps = (a, b, d) => { const n = Math.max(1, Math.ceil(Math.abs(b - a) / d)); return [...Array(n + 1)].map((_, i) => a + (b - a) * i / n); };
    const tanAt = (P, u) => { const p = pathAt(P, u); return { x: p.ny, y: -p.nx }; };

    // Where a wire meets its box: its box, its ends, and the points it enters and leaves by, each on
    // the side facing that end.
    function entry(w) {
      const b = boxes.find(bx => bx.wires.includes(w));
      if (!b) return null;
      const it = b.item, y = boxRowY.get(w.id);
      const [l, r] = leftFirst(w);
      const lit = itemOf.get(l.node), rit = itemOf.get(r.node);
      const fan = it.fan || 0;
      const lIn = { x: lit.x + lit.w / 2 < it.x ? it.x + fan : it.x + it.w - fan, y };
      const rIn = { x: rit.x + rit.w / 2 > it.x + it.w ? it.x + it.w - fan : it.x + fan, y };
      return { b, it, l, r, lIn, rIn };
    }
    // A wire's curve from p to q, leaving p along tp and reaching q along tq (level, toward the other
    // end, when not given): as an SVG command, and as points for its label's lane.
    // A tangent pointing away from the other end (a wire leaving its anchor along the path with its pin
    // behind it) gets a short handle, about half the height between them, so it turns back in a round
    // hook instead of shooting out half the run and folding back (Chris, 2026-11-10: it looked like a
    // dead-end straight). Tangents toward the other end, and the defaults, keep the long handle.
    const ctl = (p, q, tp, tq) => {
      const dx = q.x - p.x, dy = q.y - p.y, s = q.x > p.x ? 1 : -1, a = tp || { x: s, y: 0 }, b = tq || { x: s, y: 0 };
      const far = Math.max(30, Math.abs(dx) * 0.5), back = Math.min(far, Math.max(18, Math.abs(dy) * 0.5));
      const da = a.x * dx + a.y * dy < 0 ? back : far, db = b.x * dx + b.y * dy < 0 ? back : far;
      return [{ x: p.x + a.x * da, y: p.y + a.y * da }, { x: q.x - b.x * db, y: q.y - b.y * db }];
    };
    const curve = (p, q, tp, tq) => { const [a, b] = ctl(p, q, tp, tq); return `C${f(a.x)} ${f(a.y)} ${f(b.x)} ${f(b.y)} ${f(q.x)} ${f(q.y)}`; };
    const curvePts = (p, q, tp, tq) => {
      const [a, b] = ctl(p, q, tp, tq), N = 24;
      return [...Array(N + 1)].map((_, i) => {
        const t = i / N, u = 1 - t, k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
        return { x: k0 * p.x + k1 * a.x + k2 * b.x + k3 * q.x, y: k0 * p.y + k1 * a.y + k2 * b.y + k3 * q.y };
      });
    };
    // A boxed wire's run: out along the left lead from where it joins it, across the box (packed,
    // twisting where its set twists), and out along the right lead. pts carry `front` for the
    // twist's near side; J says where it joins each lead (null: it doesn't).
    function runPts(w, e, twisty) {
      const { it, lIn, rIn } = e, P = it.path, y0 = boxRowY.get(w.id);
      if (!P) return { pts: [{ x: lIn.x, y: lIn.y }, { x: rIn.x, y: rIn.y }], J: { l: null, r: null } };
      // A stack's wire (arranged view) rides its path only between its anchors, wherever they are,
      // straight part included, and leaves it there for its pins (Chris, 2026-11-10: an anchor on the
      // straight did nothing, and the wire ran on past it). Unset, they sit at the box's edges.
      const own = (chainOf.get(w.id) || [])[0];
      // An anchor at the box's edge on a side with no lead leaves as it always did (J null: the curve
      // to its pin picks its own direction).
      if (own && own.own && !prop) return { pts: steps(own.a.u0, own.a.u1, 3).map(u => wpt(w, it, u, y0)),
        J: { l: P.lL || own.a.u0 > P.aL + 0.5 ? own.a.u0 : null, r: P.lR || own.a.u1 < P.aL + P.Ls - 0.5 ? own.a.u1 : null } };
      const J = joins(w, it), out = [];
      // The twist runs by distance along the path, leads included, so it follows the curves.
      const tsp = twisty ? twistSpan(w) : null, hx = tsp && helix(tsp, y0), dir = rIn.x >= lIn.x ? 1 : -1;
      const base = u => (tsp && u >= tsp.ua && u <= tsp.ub ? hx(u - tsp.ua) : { y: y0, front: false });
      const onLead = (a, b) => steps(a, b, 3).forEach(u => { const v = base(u); out.push(Object.assign(wpt(w, it, u, v.y), { front: v.front })); });
      if (J.l != null) onLead(J.l, P.aL);
      const xs = [lIn.x, rIn.x];
      (chainOf.get(w.id) || []).forEach(k => { if (!k.own) [[k.a.u0 - k.F, k.a.u0], [k.a.u1, k.a.u1 + k.F]].forEach(([a, b]) => steps(a, b, 3).forEach(u => xs.push(xOfU(it, u)))); });
      if (tsp) steps(tsp.ua, tsp.ub, 3).forEach(u => xs.push(xOfU(it, u)));
      const lo = Math.min(lIn.x, rIn.x) - 0.01, hi = Math.max(lIn.x, rIn.x) + 0.01;
      [...new Set(xs.filter(x => x >= lo && x <= hi).map(x => Math.round(x * 100) / 100))].sort((a, b) => (a - b) * dir).forEach(x => {
        const u = uOfX(it, x), v = base(u);
        out.push({ x, y: packAt(w, u, v.y), front: v.front });
      });
      if (J.r != null) onLead(P.aL + P.Ls, J.r);
      return { pts: out, J };
    }
    const whichOf = (w, e) => (e === w.from ? 'from' : 'to');
    // A wire's path, plus its two ends (where each meets its pin, port, or loose end) for the drag
    // handles. A wire with a loose end curves straight to it. A boxed wire fans from its pin to
    // where it joins its box's path, arriving along it, and leaves the same way.
    function wirePath(w) {
      const lo = [w.from, w.to].find(e => { const it = itemOf.get(e.node); return it && it.kind === 'loose'; });
      if (lo) {
        const o = lo === w.from ? w.to : w.from, L = itemOf.get(lo.node);
        const p = anchor(o, L.x), q = { x: L.x, y: L.y };
        return { d: `M${f(p.x)} ${f(p.y)}` + curve(p, q), over: [], ends: [{ which: whichOf(w, o), at: p, e: o }, { which: whichOf(w, lo), at: q, e: lo }] };
      }
      const e = entry(w);
      if (!e) {
        const [l, r] = leftFirst(w), li = itemOf.get(l.node), ri = itemOf.get(r.node);
        if (!li || !ri) return '';
        const p = anchor(l, ri.x + ri.w / 2), q = anchor(r, li.x + li.w / 2);
        return { d: `M${f(p.x)} ${f(p.y)}` + curve(p, q), over: [], ends: [{ which: whichOf(w, l), at: p, e: l }, { which: whichOf(w, r), at: q, e: r }] };
      }
      const { it, l, r } = e;
      const L0 = anchor(l, it.x + it.w / 2), R0 = anchor(r, it.x + it.w / 2);
      const run = runPts(w, e, true), pts = run.pts, a = pts[0], z = pts[pts.length - 1];
      const tl = run.J.l != null ? tanAt(it.path, run.J.l) : null, tr = run.J.r != null ? tanAt(it.path, run.J.r) : null;
      return { d: `M${f(L0.x)} ${f(L0.y)}` + curve(L0, a, null, tl) + pts.slice(1).map(q => `L${f(q.x)} ${f(q.y)}`).join('') + curve(z, R0, tr, null), over: overOf(pts),
        ends: [{ which: whichOf(w, l), at: L0, e: l }, { which: whichOf(w, r), at: R0, e: r }] };
    }
    // A twisted wire's run through its box, drawn as a helix seen from the side: past the box's ends
    // (the sheath's caps or the bundle's bands) every wire of the set swings across the set's rows,
    // a whole number of turns of about TURN × (wires) units, each wire a 1/n turn behind the next.
    // It eases from its own row into the helix and back out, so it leaves on its own row. `over`
    // holds the stretches on the near side of the helix, drawn on top of the others, so the wires
    // alternate over and under where they cross. Twists stay on the box's straight part.
    const TURN = 40;
    // The stretch a twisted wire twists along, or null when it runs straight.
    // It runs inside its set's stretch of the box, clear of the set's lacing, sheath, or braid ends.
    function twistSpan(w) {
      const t = twistOf.get(w.id), it = t && t.it, P = it && it.path, a = P && it.sz.arc.get(t.sp.s.id);
      if (!a) return null;
      const pad = hasEnds(t.sp.s) ? END + 6 : 8, fan = it.fan || 0;
      const ua = Math.max(a.u0 + pad, P.lL ? 0 : uOfX(it, it.x + fan + 8)), ub = Math.min(a.u1 - pad, P.lR ? P.S : uOfX(it, it.x + it.w - fan - 8));
      const run = ub - ua, n = t.ws.length;
      return run < TURN * n * 0.6 ? null : { t, ua, ub, run, n };
    }
    // Where a twisted wire's twist starts and ends on its row: the leader from its label runs to the
    // start while the label sits over the twist.
    function twistAt(w, end) {
      const e = entry(w), s = e && twistSpan(w);
      return s ? wpt(w, e.it, end ? s.ub : s.ua, e.lIn.y) : null;
    }
    const twistStart = w => twistAt(w, false), twistEnd = w => twistAt(w, true);
    // The helix a twisted wire follows from its row y0: y dx along its twist (0 to run), and whether
    // that stretch is on the near side.
    function helix(s, y0) {
      const { t, run, n } = s, turns = Math.max(1, Math.round(run / (TURN * n)));
      const ys = t.ws.map(x => boxRowY.get(x.id)), lo = Math.min(...ys), hi = Math.max(...ys);
      // The ease (smoothstep, level at both ends) takes about half a turn, so the wire leaves the
      // straight part and joins the helix without a kink.
      const c = (lo + hi) / 2, A = (hi - lo) / 2, ease = Math.min(TURN * n / 2, run / 4);
      const phase = Math.PI - 2 * Math.PI * t.i / n;
      return dx => {
        const th = phase + 2 * Math.PI * turns * dx / run, e = Math.min(1, dx / ease, (run - dx) / ease), m = e * e * (3 - 2 * e);
        return { y: y0 + (c + A * Math.cos(th) - y0) * m, front: Math.sin(th) > 0 && m > 0.5 };
      };
    }
    // Where a boxed wire is drawn at x (on the helix where it twists), for the leader from a label
    // slid along a twist.
    function wireAt(w, q) {
      const e = entry(w);
      if (!e) return null;
      const s = twistSpan(w), it = e.it, y0 = e.lIn.y;
      if (!it.path) return { x: q.x, y: y0 };
      if (!s) return { x: q.x, y: packAt(w, uOfX(it, q.x), y0) };
      const u = Math.min(s.ub, Math.max(s.ua, uOfX(it, q.x)));
      return wpt(w, it, u, helix(s, y0)(u - s.ua).y);
    }
    // The near-side stretches of a twisted wire's points (front), drawn over the other wires.
    function overOf(pts) {
      const over = [];
      let cur = null;
      pts.forEach((p, k) => {
        if (p.front) { if (!cur) { const q = pts[Math.max(0, k - 1)]; cur = `M${f(q.x)} ${f(q.y)}`; } cur += `L${f(p.x)} ${f(p.y)}`; }
        else if (cur) { over.push(cur); cur = null; }
      });
      if (cur) over.push(cur);
      return over;
    }
    // A set's band along its box's path, from where it reaches on the left (u0) to the right (u1):
    // at each sample, the path's point and normal and the band's edges as offsets across it (its
    // outer wires' packed offsets less and plus its R); at(u) samples it anywhere. x, y, w, h bound
    // it; rx rounds its ends. Every set drawing (sheath, braid, lacing, areas, grips, badge leaders)
    // comes from it, so they all follow the leads.
    const bands = new Map();
    function band(it, sp) {
      if (bands.has(sp.s.id)) return bands.get(sp.s.id);
      const P = it.path, a = it.sz.arc.get(sp.s.id) || { u0: 0, u1: P.S };
      const ws = it.sz.rows.slice(sp.i0, sp.i1 + 1).filter(r => r.w).map(r => r.w);
      const at = u => {
        const p = pathAt(P, u), os = ws.map(w => packAt(w, u, boxRowY.get(w.id)) - P.cy);
        return { u, x: p.x, y: p.y, nx: p.nx, ny: p.ny, top: Math.min(...os) - sp.R, bot: Math.max(...os) + sp.R };
      };
      const pts = steps(a.u0, a.u1, 3).map(at), e0 = pts[0], e1 = pts[pts.length - 1];
      const rx = Math.max(0.5, Math.min(14, (e0.bot - e0.top) / 2, (e1.bot - e1.top) / 2, (a.u1 - a.u0) / 2 - 1));
      const xs = pts.flatMap(p => [p.x + p.nx * p.top, p.x + p.nx * p.bot]), ys = pts.flatMap(p => [p.y + p.ny * p.top, p.y + p.ny * p.bot]);
      const g = { u0: a.u0, u1: a.u1, pts, at, rx, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      bands.set(sp.s.id, g);
      return g;
    }
    boxes.forEach(b => { if (b.item.path) b.item.band = sp => band(b.item, sp); });
    // A loose wire's anchors, where it leaves its box's path for each pin (canvas dots, app.js).
    function anchorsOf(w) {
      const e = entry(w), a = e && e.it.sz.warc && e.it.sz.warc.get(w.id);
      if (!a) return null;
      return [['l', a.u0], ['r', a.u1]].map(([side, u]) => Object.assign(wpt(w, e.it, u, e.lIn.y), { side }));
    }
    // Where a set's end sits (the middle of its band there), for placing parts by it (demo.js).
    function setEndAt(id, side) {
      for (const b of boxes) {
        const sp = b.item.path && b.item.sz.spans.find(x => x.s.id === id);
        if (sp) { const g = band(b.item, sp), p = g.at(side === 'r' ? g.u1 : g.u0), o = (p.top + p.bot) / 2; return { x: p.x + p.nx * o, y: p.y + p.ny * o }; }
      }
      return null;
    }
    const box = { x0: Math.min(0, ...items.map(i => i.x)), y0: Math.min(0, ...items.map(i => i.y)),
      x1: Math.max(200, ...items.map(i => i.x + i.w)), y1: Math.max(120, ...items.map(i => i.y + i.h)) };
    // Leads reach out of their boxes, so the bounds take them in.
    boxes.forEach(b => { const P = b.item.path; if (P) P.pts.forEach(p => { box.x0 = Math.min(box.x0, p.x); box.x1 = Math.max(box.x1, p.x); box.y0 = Math.min(box.y0, p.y - 20); box.y1 = Math.max(box.y1, p.y + 20); }); });
    // The wires on each side of a splice, in port order (for drawing and for drops).
    const portsOf = id => { const S = sides.get(id); return S ? { l: S.l.slice(), r: S.r.slice() } : { l: [], r: [] }; };
    // Wire labels (Chris: they size nothing and slide anywhere along their wires). A boxed wire's
    // lane is the line its label rides: its path from pin to pin, but across its box on its row
    // without a twist's swing, so a label over a twist stays level with its row. Points with arc
    // length s (laneAt, project).
    const lanes = new Map(), labelX = new Map(), offLane = new Map();
    function lane(w) {
      if (lanes.has(w.id)) return lanes.get(w.id);
      const e = entry(w);
      let out = null;
      if (e) {
        const { it, l, r } = e, L0 = anchor(l, it.x + it.w / 2), R0 = anchor(r, it.x + it.w / 2);
        const run = runPts(w, e, false), mid = run.pts;
        const tl = run.J.l != null ? tanAt(it.path, run.J.l) : null, tr = run.J.r != null ? tanAt(it.path, run.J.r) : null;
        const pts = curvePts(L0, mid[0], null, tl).concat(mid.slice(1, -1), curvePts(mid[mid.length - 1], R0, tr, null));
        let s = 0;
        out = { pts: pts.map((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y); return { x: p.x, y: p.y, s }; }), S: 0, it };
        out.S = s;
      }
      lanes.set(w.id, out);
      return out;
    }
    // The outermost packing sets of a box, across x (they may reach past it, out along its leads).
    const outerPacks = it => (it.path ? packSpans(it.sz).map(sp => {
      const a = it.sz.arc.get(sp.s.id);
      return a && { sp, x0: xOfU(it, a.u0), x1: xOfU(it, a.u1), F: fanLen(sp), y0: rowY(it, sp.i0), y1: rowY(it, sp.i1) };
    }).filter(Boolean) : []);
    // Where a box's labels sit until one is slid: in a box with packed sets, past their fan-out where
    // the wires are back at grid spacing (Chris), else before their fan-in. Otherwise centered on its
    // frame (in Real proportions, right of a break), but where rows twist, left to just past where
    // the first twist starts, so the leaders stay short. Each label is its box's label width
    // (sz.inner), so they line up as a table. When a packed set fills the box (out along both leads,
    // say), its labels keep their rows at grid spacing, lifted clear above it, until slid.
    function labelX0(it) {
      if (labelX.has(it)) return labelX.get(it);
      const sz = it.sz, x = it.x, P = outerPacks(it);
      if (P.length) {
        const after = Math.max(...P.map(p => p.x1 + p.F)) + LABEL_PAD, before = Math.min(...P.map(p => p.x0 - p.F)) - LABEL_PAD - sz.inner;
        const x0 = after + sz.inner <= x + it.w - (it.fan || 0) - 4 ? after : before >= x + (it.fan || 0) + 4 ? before : null;
        if (x0 != null) { labelX.set(it, x0); return x0; }
        // Each packed set's rows split round it: those above its middle move up just clear of it,
        // those below move down just clear of it, keeping their spacing (and the badges move down
        // with them, it.labelDrop).
        const shift = new Map();
        let drop = 0;
        P.forEach(p => {
          const c = (p.y0 + p.y1) / 2, half = (p.y1 - p.y0) / 2 * PACK / PITCH + p.sp.R;
          const ys = sz.rows.slice(p.sp.i0, p.sp.i1 + 1).map((r, i) => (r.w ? { w: r.w, y: rowY(it, p.sp.i0 + i) } : null)).filter(Boolean);
          const up = ys.filter(o => o.y <= c + 0.5), dn = ys.filter(o => o.y > c + 0.5);
          const su = up.length ? Math.max(0, Math.max(...up.map(o => o.y)) - (c - half + 2)) : 0;
          const sd = dn.length ? Math.max(0, c + half + 18 - Math.min(...dn.map(o => o.y))) : 0;
          up.forEach(o => shift.set(o.w.id, -su)); dn.forEach(o => shift.set(o.w.id, sd));
          drop = Math.max(drop, sd);
        });
        offLane.set(it, shift);
        it.labelDrop = drop;
      }
      let x0 = x + (sz.textC != null ? sz.textC : (sz.lx || 0) + sz.rootW / 2) - (sz.inner - sz.lead) / 2;
      const starts = sz.rows.map(r => r.w && twistStart(r.w)).filter(Boolean);
      if (starts.length) {
        const near = Math.min(...starts.map(t => t.x)) + LEAD + 8;
        if (x0 > near) x0 = Math.max(near, it.brk ? x + it.brk.x + BREAK_W / 2 + 10 : -Infinity);
      }
      labelX.set(it, x0);
      return x0;
    }
    // A label hangs from a dot on its wire (Chris): the dot sits w.labelAt along the lane (0 to 1;
    // unset, just left of the label's default spot), on the helix where the wire twists in its box,
    // and the label's left side sits w.labelOff ({ dx, dy }, baseline) from the dot, anywhere. Unset,
    // the label is where it always defaulted (lifted clear of a packed set that fills its box), or,
    // once its dot was slid, just right of the dot. null for a wire in no box (one with a loose end).
    const DOT_GAP = 8;
    function labelAt(w) {
      const ln = lane(w);
      if (!ln) return null;
      const it = ln.it, x0d = labelX0(it), ry = boxRowY.get(w.id), lift = offLane.has(it) ? offLane.get(it).get(w.id) || 0 : 0;
      const t = w.labelAt == null ? null : Math.min(1, Math.max(0, +w.labelAt));
      const s = t != null ? t * ln.S : project(ln, { x: x0d - DOT_GAP, y: ry });
      let dot = laneAt(ln, s);
      const ts = twistStart(w), te = ts && twistEnd(w);
      if (ts && dot.x >= it.x && dot.x <= it.x + it.w && dot.x >= Math.min(ts.x, te.x) && dot.x <= Math.max(ts.x, te.x)) dot = wireAt(w, dot) || dot;
      const o = w.labelOff, set = o && isFinite(+o.dx) && isFinite(+o.dy);
      const x0 = set ? dot.x + +o.dx : t == null ? x0d : dot.x + DOT_GAP;
      const ty = set ? dot.y + +o.dy : t == null ? ry + lift - 5 : dot.y - 5;
      return { dot, x0, ty, t: ln.S ? s / ln.S : 0.5, it };
    }
    boxes.forEach(b => labelX0(b.item));
    // Notes: where a note is pinned, and the reverse for pinning one (app.js). A wire's t runs along
    // its box row (or, outside a box, straight between its ends); a set's spot is on its drawn area.
    function wireEnds(w) {
      const e = entry(w);
      if (e) return [e.lIn, e.rIn];
      const [l, r] = leftFirst(w), li = itemOf.get(l.node), ri = itemOf.get(r.node);
      return li && ri ? [anchor(l, ri.x + ri.w / 2), anchor(r, li.x + li.w / 2)] : null;
    }
    function setGeom(id) {
      for (const b of boxes) { const sp = b.item.path && b.item.sz.spans.find(x => x.s.id === id); if (sp) { const g = band(b.item, sp); return { x: g.x, y: g.y, w: g.w, h: g.h }; } }
      return null;
    }
    // An area note's rectangle. at.x, at.y are from the top-left of the connector or splice nearest
    // it when drawn (at.node), so it follows that part between views; with no such part they're
    // world coordinates.
    function areaRect(c) {
      const a = c.at || {}, it = a.node && itemOf.get(a.node);
      return { x: (it ? it.x : 0) + (+a.x || 0), y: (it ? it.y : 0) + (+a.y || 0), w: Math.max(AREA_MIN, +a.w || 0), h: Math.max(AREA_MIN, +a.h || 0) };
    }
    function noteAt(c) {
      const a = c.at || {};
      if (a.kind === 'area') return edgeAt(areaRect(c), a.e);
      if (a.kind === 'node') { const it = itemOf.get(a.id); return it && { x: it.x + (a.fx || 0) * it.w, y: it.y + (a.fy || 0) * it.h }; }
      if (a.kind === 'set') { const g = setGeom(a.id); return g && { x: g.x + (a.fx || 0) * g.w, y: g.y + (a.fy || 0) * g.h }; }
      const w = M.wire(h, a.id), e = w && wireEnds(w), t = a.t == null ? 0.5 : a.t;
      return e && { x: e[0].x + (e[1].x - e[0].x) * t, y: e[0].y + (e[1].y - e[0].y) * t };
    }
    function wireT(w, p) {
      const e = wireEnds(w);
      if (!e || Math.abs(e[1].x - e[0].x) < 1) return 0.5;
      return Math.min(1, Math.max(0, (p.x - e[0].x) / (e[1].x - e[0].x)));
    }
    // The diagram's bounds take in the notes' bubbles.
    (h.callouts || []).forEach(c => {
      const p = noteAt(c); if (!p) return; const s = noteSize(c);
      box.x0 = Math.min(box.x0, p.x + c.dx - s.w / 2); box.x1 = Math.max(box.x1, p.x + c.dx + s.w / 2); box.y0 = Math.min(box.y0, p.y + c.dy - s.h / 2); box.y1 = Math.max(box.y1, p.y + c.dy + s.h / 2);
      if (c.at.kind === 'area') { const r = areaRect(c); box.x0 = Math.min(box.x0, r.x); box.x1 = Math.max(box.x1, r.x + r.w); box.y0 = Math.min(box.y0, r.y); box.y1 = Math.max(box.y1, r.y + r.h); }
    });
    return { items, itemOf, boxes, wirePath, twistStart, twistEnd, wireAt, lane, labelAt, anchor, endY, portsOf, portOf, box, noteAt, wireT, setGeom, setEndAt, anchorsOf, areaRect };
  }

  // A lane (layout's lane: points with arc length s): the point at s along it, and how far along it
  // a point's nearest point is (sliding a label, app.js).
  function laneAt(ln, s) {
    const P = ln.pts;
    s = Math.min(ln.S, Math.max(0, s));
    let i = 1;
    while (i < P.length - 1 && P[i].s < s) i++;
    const a = P[i - 1], b = P[i], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  function project(ln, q) {
    let best = Infinity, out = 0;
    const P = ln.pts;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.min(1, Math.max(0, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2)) : 0;
      const d = (q.x - a.x - dx * t) ** 2 + (q.y - a.y - dy * t) ** 2;
      if (d < best) { best = d; out = a.s + (b.s - a.s) * t; }
    }
    return out;
  }

  // ── SVG ───────────────────────────────────────────────────────────────────
  // The half twists a twisted wire crosses on top of, drawn after every wire (no hit area).
  // On the canvas (fx) a wire also gets a soft shadow under it and a specular highlight down its
  // middle, so it reads as insulation; a selected wire carries a pulse of light (.w-pulse), and a
  // new one draws itself in (`draw`: path lengths of 1 for a dash animation). The sheet gets none.
  function overSvg(w, ds, cls, fx) {
    const c = M.colorInfo(w.color);
    return ds.map(d => `<g class="w w-over${c.base ? '' : ' nocolor'}${cls || ''}"><path class="w-edge" d="${d}"/>` +
      `<path class="w-base" style="stroke:${c.base || '#9a9aa0'}" d="${d}"/>` +
      (c.stripe ? `<path class="w-stripe" style="stroke:${c.stripe}" d="${d}"/>` : '') +
      (fx ? `<path class="w-gloss" d="${d}"/>` : '') + '</g>').join('');
  }
  // A light insulation color (white, yellow, pink, orange, turquoise; relative luminance over 0.3):
  // the pulse on it is a dark bead (.ink), since a light one doesn't show (Chris).
  const isLight = hex => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    const v = parseInt(m[1], 16), ch = k => { const s = ((v >> k) & 255) / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0) > 0.3;
  };
  function wireSvg(w, d, cls, fx, draw, i) {
    const c = M.colorInfo(w.color), ink = isLight(c.base) ? ' ink' : '';
    const pl = draw && c.base ? ' pathLength="1"' : '';
    return `<g class="w${c.base ? '' : ' nocolor'}${cls || ''}" data-wire="${w.id}"${fx ? ` style="color:${c.base || '#9a9aa0'}${i != null ? ';--i:' + i : ''}"` : ''}><path class="w-hit" d="${d}"/>` +
      (fx ? `<path class="w-shade" d="${d}"/>` : '') + `<path class="w-edge"${pl} d="${d}"/>` +
      `<path class="w-base"${pl} style="stroke:${c.base || '#9a9aa0'}" d="${d}"/>` +
      (c.stripe ? `<path class="w-stripe" style="stroke:${c.stripe}" d="${d}"/>` : '') +
      (fx ? `<path class="w-gloss"${pl} d="${d}"/>` + (cls && /\s(sel|carry)\b/.test(cls) ? `<path class="w-pulse${ink}" pathLength="1" d="${d}"/>` : cls && /\ssetsel\b/.test(cls) ? `<path class="w-pulse soft${ink}" pathLength="1" d="${d}"/>` : '') : '') + '</g>';
  }
  // Canvas-only ids, kept apart from anything a sheet or print SVG defines.
  const fxId = (kind, id) => 'lmfx-' + kind + '-' + String(id).replace(/[^\w-]/g, '_');
  // A rounded card for a table on the canvas: a clip for its square cells and a lit backing.
  const cardOpen = (id, x, y, w, hh, r) => `<defs><clipPath id="${id}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(hh)}" rx="${r}"/></clipPath></defs>` +
    `<rect class="cv-card" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(hh)}" rx="${r}"/><g clip-path="url(#${id})">`;

  // What a selection is about: its wires, the ends they join, and the selected ends themselves.
  // Everything else is dimmed on the canvas. No dimming while a wire is being drawn, so every pin
  // stays easy to pick.
  // What's selected, by kind, as sets of ids (app.js: one kind, or a mix of several), plus the
  // wires of the selected sets.
  function pickOf(h, sel) {
    const P = { node: new Set(), wire: new Set(), set: new Set(), note: new Set(), setWires: new Set() };
    if (sel && sel.kind === 'mix') Object.keys(sel.parts).forEach(k => { if (P[k]) sel.parts[k].forEach(id => P[k].add(id)); });
    else if (sel && P[sel.kind]) sel.ids.forEach(id => P[sel.kind].add(id));
    P.set.forEach(id => { const st = M.set(h, id); if (st) M.wiresIn(h, st).forEach(w => P.setWires.add(w)); });
    return P;
  }
  function focusOf(h, sel, pending) {
    if (!sel || pending) return null;
    const P = pickOf(h, sel), wires = new Set([...P.wire, ...P.setWires]), nodes = new Set(P.node), picked = new Set(P.node);
    h.wires.forEach(w => { if (P.node.has(w.from.node) || P.node.has(w.to.node)) wires.add(w.id); });
    if (!wires.size && !nodes.size) return null;
    h.wires.forEach(w => { if (wires.has(w.id)) { nodes.add(w.from.node); nodes.add(w.to.node); } });
    const pins = new Set();
    h.wires.forEach(w => { if (wires.has(w.id)) [w.from, w.to].forEach(e => pins.add(e.node + '|' + e.pin)); });
    return { wires, nodes, picked, pins };
  }
  const dimIf = c => (c ? ' dim' : '');

  function connSvg(h, it, opts, Lo) {
    const n = it.n, sz = it.sz, x = it.x, y = it.y, w = it.w, F = opts.focus;
    const sel = !!opts.pick && opts.pick.node.has(n.id);
    const pinDim = p => !!F && F.nodes.has(n.id) && !F.picked.has(n.id) && !F.pins.has(n.id + '|' + p);
    // Pin numbers go on the side the wires leave from.
    const toRight = h.wires.some(wr => { const o = wr.from.node === n.id ? wr.to : wr.to.node === n.id ? wr.from : null; if (!o) return false; const ot = Lo.itemOf.get(o.node); return ot && ot.x > x; });
    const toLeft = h.wires.some(wr => { const o = wr.from.node === n.id ? wr.to : wr.to.node === n.id ? wr.from : null; if (!o) return false; const ot = Lo.itemOf.get(o.node); return ot && ot.x < x; });
    const numRight = toRight || !toLeft;
    const fx = opts.fx, R = 10;
    let o = `<g class="cv-conn${sel ? ' sel' : ''}${fxCls(it, opts)}${dimIf(F && !F.nodes.has(n.id))}" data-node="${n.id}" data-item="${it.key}"${fxStyle(it, opts)}>`;
    if (fx) o += cardOpen(fxId('c', n.id), x, y, w, it.h, R);
    o += `<rect class="cv-bg" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(it.h)}"/>`;
    const hh = sz.hh;
    // The sketch sits left of the ref (and name), and the pair is centered in the header.
    const sk = sz.sk, textW = Math.min(sz.textW, w - 16 - sk.w - 8);
    const sx = x + (w - (sk.w + 8 + textW)) / 2, tx = sx + sk.w + 8 + textW / 2;
    o += `<g class="cv-head" data-head="${n.id}"><rect class="cv-cell cv-headbg" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${hh}"/>` +
      `<g class="cv-sketch" style="stroke-width:${f(0.9 / sk.k)}" transform="translate(${f(sx + sk.v.ox * sk.k)} ${f(y + (hh - sk.h) / 2)}) scale(${f(sk.k * 1000) / 1000})">${sk.v.svg}</g>` +
      `<text class="cv-ref" x="${f(tx)}" y="${f(y + hh / 2 + (sz.hasName ? -4 : 4))}" text-anchor="middle">${esc(n.ref)}</text>` +
      (sz.hasName ? `<text class="cv-name" x="${f(tx)}" y="${f(y + hh / 2 + 12)}" text-anchor="middle">${esc(U.clip(n.name, 11, textW + 4))}</text>` : '') + '</g>';
    const numX = numRight ? x + w - sz.numW : x;
    const labX = numRight ? x : x + sz.numW;
    // The info row in the same two columns as the pin rows.
    const iy = y + hh, ity = iy + G.INFO / 2 + 4;
    o += `<rect class="cv-cell" x="${f(labX)}" y="${f(iy)}" width="${f(w - sz.numW)}" height="${G.INFO}"/>` +
      `<text class="cv-t" x="${f(labX + (w - sz.numW) / 2)}" y="${f(ity)}" text-anchor="middle">${esc(U.clip(sz.info.kind, G.FS, w - sz.numW - 10))}</text>` +
      `<rect class="cv-cell" x="${f(numX)}" y="${f(iy)}" width="${f(sz.numW)}" height="${G.INFO}"/>` +
      `<text class="cv-t" x="${f(numX + sz.numW / 2)}" y="${f(ity)}" text-anchor="middle">${esc(sz.info.count)}</text>`;
    M.pinList(n).forEach((p, i) => {
      const ry = y + sz.h0 + i * G.ROW;
      const pend = opts.pending && opts.pending.node === n.id && opts.pending.pin === p;
      const used = h.wires.some(wr => (wr.from.node === n.id && wr.from.pin === p) || (wr.to.node === n.id && wr.to.pin === p));
      // While a wire is being drawn, the pins on other ends are its targets (canvas only); free
      // ones glow more.
      const can = fx && opts.pending && opts.pending.node !== n.id;
      // The pin a dragged wire end would land on (canvas only).
      const land = fx && opts.dropPin && opts.dropPin.node === n.id && opts.dropPin.pin === p;
      o += `<g class="cv-pin${pend ? ' pend' : ''}${used ? ' used' : ''}${can ? ' can' : ''}${land ? ' land' : ''}${dimIf(pinDim(p))}" data-node="${n.id}" data-pin="${esc(p)}">` +
        `<rect class="cv-cell cv-pinrow" x="${f(x)}" y="${f(ry)}" width="${f(w)}" height="${G.ROW}"/>` +
        `<line class="cv-rule" x1="${f(numRight ? numX : labX)}" x2="${f(numRight ? numX : labX)}" y1="${f(ry)}" y2="${f(ry + G.ROW)}"/>` +
        `<text class="cv-t" x="${f(labX + (w - sz.numW) / 2)}" y="${f(ry + G.ROW / 2 + 4)}" text-anchor="middle">${esc(sz.labels[i])}</text>` +
        `<text class="cv-t cv-num" x="${f(numX + sz.numW / 2)}" y="${f(ry + G.ROW / 2 + 4)}" text-anchor="middle">${esc(p)}</text></g>`;
    });
    // On the canvas the card is glass: a faint shade down it, and a bright inner rim.
    if (fx) o += `<rect class="cv-glass" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(it.h)}"/></g><rect class="cv-rim" x="${f(x + 1)}" y="${f(y + 1)}" width="${f(w - 2)}" height="${f(it.h - 2)}" rx="${R - 1}"/>`;
    o += `<rect class="cv-frame" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(it.h)}"${fx ? ` rx="${R}"` : ''}/>`;
    return o + '</g>';
  }
  // Canvas-only classes and styles on a part: lifted while dragged, and its place in the intro.
  const fxCls = (it, opts) => (opts.fx && opts.lift === it.key ? ' lift' : '');
  const fxStyle = (it, opts) => (opts.fx && opts.intro ? ` style="--i:${it.order || 0}"` : '');
  // A splice: a box with a port on its edge for each wire, on the side the wire comes in, and lines
  // inside from the ports on each side to the ref in the middle, where they're joined.
  const PORT_R = 4.5;
  // A bigger, invisible circle around each end's dot on the canvas, so it's easy to grab.
  const hitEnd = (x, y, id, which, opts) => (opts.sheet ? '' : `<circle class="cv-hitend" cx="${f(x)}" cy="${f(y)}" r="9" data-end="${id}|${which}" data-wire="${id}"/>`);
  function spliceSvg(it, opts, Lo) {
    const n = it.n, sel = !!opts.pick && opts.pick.node.has(n.id);
    const x = it.x, y = it.y, w = it.w, cx = x + w / 2, cy = y + it.sz.port0, half = Math.max(9, tw(n.ref, 13) / 2) + 5;
    const P = Lo.portsOf(n.id), F = opts.focus;
    let lines = '', ports = '';
    ['l', 'r'].forEach(k => P[k].forEach(wr => {
      const e = wr.from.node === n.id ? wr.from : wr.to, py = Lo.endY(e), px = k === 'l' ? x : x + w;
      const hx = k === 'l' ? cx - half : cx + half, dim = dimIf(F && !F.wires.has(wr.id));
      lines += `<path class="cv-sp-line${dim}" d="M${f(px)} ${f(py)}C${f((px + hx) / 2)} ${f(py)} ${f((px + hx) / 2)} ${f(cy)} ${f(hx)} ${f(cy)}"/>`;
      const rg = ring(opts, wr);
      ports += `<circle class="cv-port${dim}${rg.cls}" cx="${f(px)}" cy="${f(py)}" r="${PORT_R}" data-end="${wr.id}|${e === wr.from ? 'from' : 'to'}" data-wire="${wr.id}"${rg.style}/>` +
        hitEnd(px, py, wr.id, e === wr.from ? 'from' : 'to', opts);
    }));
    // On the canvas the conductors meet in a crimp sleeve under the ref.
    const crimp = opts.fx ? `<rect class="cv-crimp" x="${f(cx - half)}" y="${f(cy - 8)}" width="${f(half * 2)}" height="16" rx="8"/>` : '';
    return `<g class="cv-splice${sel ? ' sel' : ''}${opts.pending ? ' target' : ''}${opts.drop === n.id ? ' drop' : ''}${fxCls(it, opts)}${dimIf(F && !F.nodes.has(n.id))}" data-node="${n.id}" data-item="${it.key}"${fxStyle(it, opts)}><rect class="cv-bg" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(it.h)}" rx="6"/>` +
      (opts.fx ? `<rect class="cv-glass" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(it.h)}" rx="6"/><rect class="cv-rim" x="${f(x + 1)}" y="${f(y + 1)}" width="${f(w - 2)}" height="${f(it.h - 2)}" rx="5"/>` : '') +
      `<rect class="cv-frame" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(it.h)}" rx="6"/>` + lines + crimp +
      `<text class="cv-ref" x="${f(cx)}" y="${f(cy + 4.5)}" text-anchor="middle">${esc(n.ref)}</text>${ports}</g>`;
  }
  // On the canvas (fx) every wire-end dot is a metal contact ringed in its wire's color (--wc).
  const ring = (opts, w, fresh) => (opts.fx ? { cls: ' cv-contact' + (fresh ? ' fresh' : ''), style: ` style="--wc:${M.colorInfo(w.color).base || '#9a9aa0'}"` } : { cls: '', style: '' });
  // A loose end's dot, which drags like a port.
  const looseSvg = (it, w, which, cls, rg) => `<circle class="cv-port cv-loose${cls}${rg ? rg.cls : ''}" cx="${f(it.x)}" cy="${f(it.y)}" r="${PORT_R}" data-end="${w.id}|${which}" data-wire="${w.id}"${rg ? rg.style : ''}/>`;
  // A box's sets, drawn round their rows along its path (layout: it.path, sz.arc and it.band).
  const wireYAt = (it, i) => it.y + it.sz.port0 + PITCH * i;
  // x across a box for u along its path, and back (on the straight part; beyond it, extended).
  const xOfU = (it, u) => (it.path ? it.path.xa + u - it.path.aL : it.x + u);
  const uOfX = (it, x) => (it.path ? it.path.aL + x - it.path.xa : x - it.x);
  const spanX = (it, sp) => { const a = it.sz.arc && it.sz.arc.get(sp.s.id); return a ? { x0: xOfU(it, a.u0), x1: xOfU(it, a.u1) } : { x0: it.x, x1: it.x + it.w }; };
  const smooth = u => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
  // The point and normal at s along a lead's samples, and at u along a box's path.
  function sampleAt(pts, s) {
    s = Math.min(pts[pts.length - 1].s, Math.max(0, s));
    let i = 1;
    while (i < pts.length - 1 && pts[i].s < s) i++;
    const a = pts[i - 1], b = pts[i], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    const nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t, n = Math.hypot(nx, ny) || 1;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: nx / n, ny: ny / n };
  }
  function pathAt(P, u) {
    if (P.lL && u < P.aL) return sampleAt(P.lL.pts, u);
    if (P.lR && u > P.aL + P.Ls) return sampleAt(P.lR.pts, u - P.aL - P.Ls);
    return { x: P.xa + u - P.aL, y: P.cy, nx: 0, ny: 1 };
  }
  // A band sample's top and bottom edges, its angle along the path, and a transform that draws in
  // its frame (x along the path, y across it).
  const ptT = p => ({ x: p.x + p.nx * p.top, y: p.y + p.ny * p.top }), ptB = p => ({ x: p.x + p.nx * p.bot, y: p.y + p.ny * p.bot });
  const xy = p => `${f(p.x)} ${f(p.y)}`;
  const ang = p => Math.atan2(-p.nx, p.ny) * 180 / Math.PI;
  const local = p => `translate(${f(p.x)} ${f(p.y)}) rotate(${f(ang(p))})`;
  // The band less its rounded ends.
  function inner(g) {
    const a = g.u0 + g.rx, b = g.u1 - g.rx;
    return [g.at(a)].concat(g.pts.filter(p => p.u > a && p.u < b), [g.at(b)]);
  }
  // A cylinder's jacket along its band: a rounded far end on the left, and on the right it stops at
  // the near half of its cut end's ellipse.
  function jacket(g) {
    const I = inner(g), z = I[I.length - 1], a = I[0], rx = f(g.rx);
    return I.map((p, i) => (i ? 'L' : 'M') + xy(ptT(p))).join('') + `A${rx} ${f((z.bot - z.top) / 2)} ${f(ang(z))} 0 0 ${xy(ptB(z))}` +
      I.slice(0, -1).reverse().map(p => 'L' + xy(ptB(p))).join('') + `A${rx} ${f((a.bot - a.top) / 2)} ${f(ang(a))} 0 1 ${xy(ptT(a))}Z`;
  }
  // A cylinder's cut end: an ellipse square to the path at the right end of its band.
  const capOf = g => {
    const p = g.at(g.u1 - g.rx), o = (p.top + p.bot) / 2, cx = p.x + p.nx * o, cy = p.y + p.ny * o;
    return `cx="${f(cx)}" cy="${f(cy)}" rx="${f(g.rx)}" ry="${f((p.bot - p.top) / 2)}" transform="rotate(${f(ang(p))} ${f(cx)} ${f(cy)})"`;
  };
  const boxDim = (it, opts) => !!opts.focus && !it.b.wires.some(w => opts.focus.wires.has(w.id));
  // The whole box reads as selected when its outermost set is, or all its wires are.
  const boxSel = (it, opts) => {
    const b = it.b, P = opts.pick;
    return !!P && ((b.set && P.set.has(b.set.id)) || (P.wire.size > 0 && b.wires.every(w => P.wire.has(w.id))));
  };
  const spanSel = (sp, opts) => !!opts.pick && opts.pick.set.has(sp.s.id);
  const spanCls = (it, sp, opts) => (spanSel(sp, opts) || (!sp.depth && boxSel(it, opts)) ? ' sel' : '') + dimIf(boxDim(it, opts));
  // Under the wires: the box's paper, the far side of each lacing tie, and each cable's cut end (a
  // full, lighter ellipse the wires come out of).
  function boxBack(it, opts) {
    let o = `<rect class="cv-box${boxSel(it, opts) && it.b.kind !== 'set' ? ' sel' : ''}${dimIf(boxDim(it, opts))}" x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}"/>` + badgeLeaders(it, opts);
    if (it.band) it.sz.spans.forEach(sp => {
      const cls = spanCls(it, sp, opts), g = it.band(sp);
      if (sp.s.bundle) o += lacing(g, cls, 'back');
      if (sp.s.cable) o += `<ellipse class="cv-sheath-face${cls}" ${capOf(g)}/>`;
    });
    return o;
  }
  // A bundle is laced: near each end of its band, and about every LACE_GAP between as the bundle
  // gets longer (Chris), a tie loops round its wires, square to the path. A tie is a thin ellipse,
  // slanted a little as a wrapped cord sits, so it's round at the bottom (Chris: not pointy); its
  // far half runs behind the wires (part 'back') and its near half in front, so it reads as wrapped
  // round them. At the top it's tied off in a knot: two lobes crossed like a square knot, a wrap
  // across their middle, and two short tails.
  const LACE_GAP = 75, LACE_SLANT = 0.22;
  function tieHalf(top, bot, side) {
    const m = (top + bot) / 2, ry = (bot - top) / 2, rx = Math.min(5, 1.5 + ry * 0.25), N = 14;
    let d = '';
    for (let i = 0; i <= N; i++) {
      const t = -Math.PI / 2 + Math.PI * i / N, y = ry * Math.sin(t), x = side * rx * Math.cos(t) + LACE_SLANT * y;
      d += `${i ? 'L' : 'M'}${f(x)} ${f(m + y)}`;
    }
    return d;
  }
  function laceKnot(top, bot) {
    const x = -LACE_SLANT * (bot - top) / 2, y = top;
    const lobe = (dx, a) => `<ellipse class="cv-lace-knot" cx="${f(x + dx)}" cy="${f(y - 0.8)}" rx="2.7" ry="1.6" transform="rotate(${a} ${f(x + dx)} ${f(y - 0.8)})"/>`;
    return `<path d="M${f(x - 2.6)} ${f(y - 1.6)}C${f(x - 5)} ${f(y - 4.5)} ${f(x - 6.5)} ${f(y - 5)} ${f(x - 8)} ${f(y - 8)}M${f(x + 2.6)} ${f(y - 1.4)}C${f(x + 5)} ${f(y - 3.5)} ${f(x + 7)} ${f(y - 3.8)} ${f(x + 9)} ${f(y - 6)}"/>` +
      lobe(-1.7, -35) + lobe(1.7, 35) + `<path class="cv-lace-wrap" d="M${f(x - 0.7)} ${f(y - 2.6)}L${f(x + 0.7)} ${f(y + 1)}"/>`;
  }
  function lacing(g, cls, part) {
    const c = Math.min(END / 2, (g.u1 - g.u0) / 2), a = g.u0 + c, b = g.u1 - c, n = Math.max(1, Math.round((b - a) / LACE_GAP));
    return [...Array(n + 1)].map((_, i) => a + (b - a) * i / n).map(u => {
      const p = g.at(u), top = p.top + 3, bot = p.bot - 3;
      if (part === 'back') return `<path class="cv-lace${cls}" transform="${local(p)}" d="${tieHalf(top, bot, 1)}"/>`;
      return `<g class="cv-lace${cls}" transform="${local(p)}"><path d="${tieHalf(top, bot, -1)}"/>${laceKnot(top, bot)}</g>`;
    }).join('');
  }
  // Over the wires, outermost set first: a bundle's lacing, a cable's dark sheath, and a shield's
  // braid, a crosshatch the size of a cable's sheath with a thin outline (on top of the sheath when
  // a set is both).
  function holders(it, opts, hatch) {
    let o = '';
    it.sz.spans.forEach(sp => {
      const cls = spanCls(it, sp, opts), g = it.band(sp);
      if (sp.s.bundle) o += lacing(g, cls, 'front');
      if (sp.s.cable) o += `<path class="cv-sheath${cls}" d="${jacket(g)}"/>`;
      if (sp.s.shield) o += `<g class="cv-braid${cls}"><path fill="url(#${hatch})" d="${jacket(g)}"/>` +
        `<ellipse fill="url(#${hatch})" ${capOf(g)}/></g>`;
    });
    return o;
  }
  // Each set's area on the canvas (its band), over the wires and outermost first, so an inner set's
  // is on top: it tints on hover, a click in it selects that set (the innermost one under the
  // pointer), and it drags the box (it's inside the box's data-item). A selected set's area stays
  // tinted. The sheet has none.
  function setAreas(it, opts) {
    if (opts.sheet) return '';
    return it.sz.spans.map(sp => {
      const g = it.band(sp), on = spanSel(sp, opts) || (!sp.depth && boxSel(it, opts));
      const name = M.setWord(sp.s) + ' ' + sp.s.label + (M.setTraits(sp.s) ? ', ' + M.setTraits(sp.s) : '');
      const d = g.pts.map((p, i) => (i ? 'L' : 'M') + xy(ptT(p))).join('') + g.pts.slice().reverse().map(p => 'L' + xy(ptB(p))).join('') + 'Z';
      return `<path class="cv-setarea${on ? ' sel' : ''}${dimIf(boxDim(it, opts))}" d="${d}" data-set="${esc(sp.s.id)}"><title>${esc(name)}</title></path>`;
    }).join('');
  }
  // A note's bubble: its text in lines of up to NOTE_CH characters (at most NOTE_LINES), then its
  // part number; or its ref while it has no text.
  const NOTE_CH = 28, NOTE_LINES = 5;
  function noteLines(c) {
    const out = [];
    String(c.text || '').split('\n').forEach(par => {
      let line = '';
      par.split(/\s+/).filter(Boolean).forEach(word => { const t = line ? line + ' ' + word : word; if (t.length > NOTE_CH && line) { out.push(line); line = word; } else line = t; });
      if (line) out.push(line);
    });
    if (out.length > NOTE_LINES) { out.length = NOTE_LINES; out[NOTE_LINES - 1] += '…'; }
    return out.length ? out : [c.ref];
  }
  function noteSize(c) {
    const lines = noteLines(c), pn = c.pn ? `${c.pn}${c.qty > 1 ? ' × ' + c.qty : ''}` : '';
    return { lines, pn, w: Math.max(64, ...lines.map(l => tw(l, 11.5)), pn ? tw(pn, 10.5) + 18 : 0) + 20, h: lines.length * 15 + (pn ? 14 : 0) + 12 };
  }
  // An area note's rectangle (Chris): a dashed, rounded box drawn on the canvas, with the note's
  // dot on its edge. edgeAt: the point e (0 to 1) of the way round the edge, clockwise from the
  // top-left corner, on the rounded corners as drawn; edgeT: the reverse, for the point on the edge
  // nearest p.
  const AREA_R = 10, AREA_MIN = 16;
  function edgeAt(r, e) {
    let s = (((+e || 0) % 1) + 1) % 1 * 2 * (r.w + r.h), x, y;
    if (s < r.w) { x = r.x + s; y = r.y; }
    else if ((s -= r.w) < r.h) { x = r.x + r.w; y = r.y + s; }
    else if ((s -= r.h) < r.w) { x = r.x + r.w - s; y = r.y + r.h; }
    else { s -= r.w; x = r.x; y = r.y + r.h - s; }
    const rr = Math.min(AREA_R, r.w / 2, r.h / 2), cx = Math.min(Math.max(x, r.x + rr), r.x + r.w - rr), cy = Math.min(Math.max(y, r.y + rr), r.y + r.h - rr);
    if (cx !== x && cy !== y) { const d = Math.hypot(x - cx, y - cy) || 1; x = cx + (x - cx) / d * rr; y = cy + (y - cy) / d * rr; }
    return { x, y };
  }
  function edgeT(r, p) {
    const x = Math.min(Math.max(p.x, r.x), r.x + r.w), y = Math.min(Math.max(p.y, r.y), r.y + r.h);
    const d = [y - r.y, r.x + r.w - x, r.y + r.h - y, x - r.x], side = d.indexOf(Math.min(...d));
    const s = side === 0 ? x - r.x : side === 1 ? r.w + (y - r.y) : side === 2 ? r.w + r.h + (r.x + r.w - x) : 2 * r.w + r.h + (r.y + r.h - y);
    return s / (2 * (r.w + r.h));
  }
  // The area itself; on the canvas its edge drags it (data-areaedge; its inside lets clicks through
  // to the parts in it), and when selected its corners resize it (data-areah).
  function areaSvg(c, Lo, opts, on) {
    const r = Lo.areaRect(c), rr = Math.min(AREA_R, r.w / 2, r.h / 2), id = esc(c.id);
    const rect = cls => `<rect class="${cls}" x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" rx="${f(rr)}"`;
    let o = rect('cv-area') + '/>';
    if (opts.sheet) return o;
    o += rect('cv-area-hit') + ` data-areaedge="${id}"/>`;
    if (on) [['nw', r.x, r.y], ['ne', r.x + r.w, r.y], ['se', r.x + r.w, r.y + r.h], ['sw', r.x, r.y + r.h]]
      .forEach(([k, x, y]) => { o += `<rect class="cv-area-h ${k}" x="${f(x - 4)}" y="${f(y - 4)}" width="8" height="8" rx="1.5" data-areah="${id}|${k}"/>`; });
    return o;
  }
  // A note: a dot where it's pinned, a leader to its bubble, and the bubble (drags by data-notebox).
  // An area note's dot slides along the area's edge (data-areapin).
  function noteSvg(c, Lo, opts) {
    const p = Lo.noteAt(c);
    if (!p) return '';
    const s = noteSize(c), cx = p.x + (+c.dx || 0), cy = p.y + (+c.dy || 0), x = cx - s.w / 2, y = cy - s.h / 2;
    const on = !!opts.pick && opts.pick.note.has(c.id), area = c.at && c.at.kind === 'area';
    let o = `<g class="cv-note${on ? ' sel' : ''}" data-note="${esc(c.id)}"><title>${esc(c.ref)}</title>` + (area ? areaSvg(c, Lo, opts, on) : '') +
      `<path class="cv-note-lead" d="M${f(p.x)} ${f(p.y)}L${f(cx)} ${f(cy)}"/><circle class="cv-note-pin" cx="${f(p.x)}" cy="${f(p.y)}" r="3"/>` +
      (area && !opts.sheet ? `<circle class="cv-note-pinhit" cx="${f(p.x)}" cy="${f(p.y)}" r="8" data-areapin="${esc(c.id)}"/>` : '') +
      `<rect class="cv-note-box" x="${f(x)}" y="${f(y)}" width="${f(s.w)}" height="${f(s.h)}" rx="8" data-notebox="${esc(c.id)}"/>`;
    s.lines.forEach((l, i) => { o += `<text class="cv-note-t" x="${f(x + 10)}" y="${f(y + 18 + i * 15)}">${esc(l)}</text>`; });
    if (s.pn) o += `<text class="cv-note-pn" x="${f(x + 10)}" y="${f(y + 18 + s.lines.length * 15)}">${esc(s.pn)}</text>`;
    return o + '</g>';
  }
  // A break across a box's wires where its run is too long to draw to scale (real proportions):
  // a band of paper between two zigzags, and the run's length over it.
  function breakMark(it) {
    const b = it.brk;
    if (!b) return '';
    const n = it.sz.rows.length, top = wireYAt(it, 0) - Math.max(14, it.sz.R0 + 4), bot = wireYAt(it, n - 1) + Math.max(12, it.sz.R0 + 4), x = it.x + b.x;
    const zz = dx => { let d = `M${f(x + dx)} ${f(top)}`, i = 0; for (let y = top; y < bot; y += 6, i++) d += `L${f(x + dx + (i % 2 ? 3.5 : -3.5))} ${f(Math.min(bot, y + 6))}`; return d; };
    return `<g class="cv-break"><rect x="${f(x - 6)}" y="${f(top)}" width="12" height="${f(bot - top)}"/><path d="${zz(-6)}"/><path d="${zz(6)}"/>` +
      `<text x="${f(x)}" y="${f(top - 5)}" text-anchor="middle">${Math.round(b.L)} mm</text></g>`;
  }
  // A grip at each end of every set (canvas only), square to its path, to drag that end along it
  // (app.js). It shows on hover, and stays while its set is selected.
  function setEnds(it, opts) {
    if (opts.sheet) return '';
    return it.sz.spans.map(sp => {
      const g = it.band(sp), on = spanSel(sp, opts) ? ' on' : '';
      return ['l', 'r'].map(k => {
        const p = g.at(k === 'l' ? g.u0 : g.u1);
        return `<g class="cv-setend${on}" data-setend="${esc(sp.s.id)}|${k}" data-set="${esc(sp.s.id)}"><g transform="${local(p)}"><rect class="cv-setend-hit" x="-6" y="${f(p.top)}" width="12" height="${f(p.bot - p.top)}"/>` +
          `<rect class="cv-setend-grip" x="-2" y="${f((p.top + p.bot) / 2 - 8)}" width="4" height="16" rx="2"/></g></g>`;
      }).join('');
    }).join('');
  }
  // The badges: one per set in the box, in a row under it from the left, outermost first and then
  // down the tree (Chris). Each is a pill with a dot in its set's color (the Properties chip colors)
  // and its label, and a leader runs from it up to the bottom edge of its set, ending in a dot.
  // Clicking a badge selects its set. Leaders are drawn under the wires (badgeLeaders), badges over.
  const setKind = st => (st.cable ? 'cable' : st.bundle ? 'bundle' : st.twist ? 'twist' : 'shield');
  function badgeRow(it) {
    const y = wireYAt(it, it.sz.rows.length - 1) + it.sz.R0 + 8 + (it.labelDrop || 0);
    // The row starts at the outermost set's own left end, so it follows the set when its ends are
    // dragged (Chris: the badges stayed put), but no further out than the box.
    let x = it.sz.spans[0] ? Math.min(it.x + it.w - 40, Math.max(it.x + 4, spanX(it, it.sz.spans[0]).x0)) : it.x + (it.sz.lx || 0);
    return it.sz.spans.map(sp => {
      const w = badgeW(sp.s.label), g = it.band(sp), cx = x + w / 2;
      // The leader meets its set's bottom edge as near straight above the badge as it can, clear of
      // the band's rounded ends, inside the box where the band reaches it.
      const mid = g.pts.filter(p => p.u >= g.u0 + g.rx + 4 && p.u <= g.u1 - g.rx - 4);
      const pool = (mid.length ? mid : g.pts).map(ptB), inBox = pool.filter(q => q.x >= it.x && q.x <= it.x + it.w);
      const a = (inBox.length ? inBox : pool).reduce((m, q) => (Math.abs(q.x - cx) < Math.abs(m.x - cx) ? q : m));
      const pts = mid.length ? mid : g.pts, au = pts[pool.indexOf(a)].u, span = Math.max(1e-6, g.u1 - g.u0);
      // Dragged (Chris): the dot slides along the set's lower edge (s.badgeAt, 0 to 1 along its
      // stretch), and the badge goes anywhere, s.badgeOff from its dot, with a straight leader.
      const st = sp.s, t = st.badgeAt == null ? (au - g.u0) / span : Math.min(1, Math.max(0, +st.badgeAt));
      const d = st.badgeAt == null ? a : ptB(g.at(g.u0 + t * span)), o = st.badgeOff, moved = !!o && isFinite(+o.dx) && isFinite(+o.dy);
      const bx = moved ? d.x + +o.dx : x, by = moved ? d.y + +o.dy : y;
      const out = { sp, x: bx, y: by, w, cx: bx + w / 2, ax: d.x, ay: d.y, t, moved };
      x += w + BADGE_GAP;
      return out;
    });
  }
  const badgeOn = (it, sp, opts) => spanSel(sp, opts) || (!sp.depth && boxSel(it, opts));
  function badgeLeaders(it, opts) {
    if (it.b.kind !== 'set') return '';
    return badgeRow(it).map(bd => `<g class="cv-leader${badgeOn(it, bd.sp, opts) ? ' sel' : ''}${dimIf(boxDim(it, opts))}">` +
      (bd.moved ? `<path d="M${f(Math.min(bd.x + bd.w - BADGE_H / 2, Math.max(bd.x + BADGE_H / 2, bd.ax)))} ${f(bd.ay < bd.y ? bd.y : bd.ay > bd.y + BADGE_H ? bd.y + BADGE_H : bd.y + BADGE_H / 2)}L${f(bd.ax)} ${f(bd.ay)}"/>`
        : `<path d="M${f(bd.cx)} ${f(bd.y)}L${f(bd.cx)} ${f(Math.max(bd.ay, bd.y - 6))}L${f(bd.ax)} ${f(bd.ay)}"/>`) +
      `<circle cx="${f(bd.ax)}" cy="${f(bd.ay)}" r="2.2"/></g>`).join('');
  }
  function badges(it, opts) {
    if (it.b.kind !== 'set') return '';
    return badgeRow(it).map(bd => {
      const st = bd.sp.s, ty = bd.y + BADGE_H / 2;
      return `<g class="cv-badge k-${setKind(st)}${badgeOn(it, bd.sp, opts) ? ' sel' : ''}${dimIf(boxDim(it, opts))}" data-set="${esc(st.id)}">` +
        `<title>${esc(M.setWord(st) + ' ' + st.label + (M.setTraits(st) ? ', ' + M.setTraits(st) : ''))}</title>` +
        `<rect x="${f(bd.x)}" y="${f(bd.y)}" width="${f(bd.w)}" height="${BADGE_H}" rx="${BADGE_H / 2}"/>` +
        `<circle class="cv-badge-dot" cx="${f(bd.x + 12)}" cy="${f(ty)}" r="3.5"/>` +
        `<text x="${f(bd.x + 21)}" y="${f(ty + 3.9)}">${esc(st.label)}</text></g>` +
        // The leader's dot drags along its set (canvas only).
        (opts.sheet ? '' : `<circle class="cv-bdot-hit" cx="${f(bd.ax)}" cy="${f(bd.ay)}" r="7" data-bdot="${esc(st.id)}" data-set="${esc(st.id)}"/>`);
    }).join('');
  }
  function boxFront(it, opts, Lo, hatch) {
    const sz = it.sz, x = it.x, w = it.w;
    let o = (it.b.kind === 'set' ? setAreas(it, opts) + holders(it, opts, hatch) : '') + breakMark(it) + (it.b.kind === 'set' ? setEnds(it, opts) + badges(it, opts) : '');
    // A stack (wires in no set) is dragged by a clear grab over each row's run.
    if (it.b.kind !== 'set' && !opts.sheet) sz.rows.forEach((r, i) => {
      if (r.w) o += `<rect class="cv-grab" x="${f(x)}" y="${f(wireYAt(it, i) - G.BROW + 3)}" width="${f(w)}" height="${G.BROW}"/>`;
    });
    return o;
  }
  // A wire's label: from, color, and to, in its box's columns, its left side at its spot (labelAt),
  // and a small white dot on the wire it hangs from, with a line from the dot to the label's left
  // side (Chris). It sizes nothing. Labels are drawn over everything but the end dots and notes. On
  // the canvas the dot drags along its wire and the label drags anywhere (app.js); a click on the
  // label passes through to what's under it.
  function labelSvg(w, Lo, opts) {
    const L = Lo.labelAt(w);
    if (!L) return '';
    const sz = L.it.sz, c = sz.cols, r = sz.text.get(w.id), x0 = L.x0, ty = L.ty, d = L.dot;
    const ax = x0 - 4, ay = ty - 4, far = Math.hypot(ax - d.x, ay - d.y) > 3.5;
    const lead = far ? `<path class="cv-ldot-lead" d="M${f(d.x)} ${f(d.y)}L${f(ax)} ${f(ay)}"/>` : '';
    const grab = opts.sheet ? '' : `<rect class="cv-lgrab" x="${f(x0 - 5)}" y="${f(ty - 12)}" width="${f(sz.inner + 10)}" height="15" rx="5"/>`;
    const dot = (opts.sheet ? '' : `<circle class="cv-ldot-hit" cx="${f(d.x)}" cy="${f(d.y)}" r="7" data-ldot="${w.id}"/>`) +
      `<circle class="cv-ldot" cx="${f(d.x)}" cy="${f(d.y)}" r="2.6"${opts.sheet ? '' : ` data-ldot="${w.id}"`}/>`;
    const fx = opts.fx ? ' cv-item' : '';
    return `<g class="cv-wrow${fx}${dimIf(opts.focus && !opts.focus.wires.has(w.id))}${opts.slide === w.id ? ' slide' : ''}" data-label="${w.id}"${fxStyle(L.it, opts)}>` + grab + lead +
      `<text class="cv-t" x="${f(x0)}" y="${f(ty)}">${esc(r.from)}</text>` +
      `<text class="cv-t" x="${f(x0 + c.from + 20 + c.c / 2)}" y="${f(ty)}" text-anchor="middle">${esc(r.color)}</text>` +
      `<text class="cv-t" x="${f(x0 + c.from + c.c + 40)}" y="${f(ty)}">${esc(r.to)}</text>` + dot + '</g>';
  }

  function render(h, A, opts) {
    opts = opts || {};
    A = A || M.analyze(h);
    const Lo = layout(h, A, { prop: !!opts.prop });
    opts = Object.assign({}, opts, { pick: pickOf(h, opts.sel), focus: focusOf(h, opts.sel, opts.pending) });
    const fx = !!opts.fx;
    // The intro reveals parts left to right.
    if (fx && opts.intro) Lo.items.slice().sort((a, b) => a.x - b.x || a.y - b.y).forEach((it, i) => { it.order = i; });
    // A shield's braid fills with a crosshatch pattern; the canvas and the sheet each get their own
    // id, since both can be in the page at once.
    const hatch = opts.sheet ? 'lm-braid-sheet' : 'lm-braid-canvas';
    let backs = h.sets.some(st => st.shield) ? `<defs><pattern id="${hatch}" width="7.5" height="7.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      `<path class="cv-braid-line" d="M3.75 0V7.5M0 3.75H7.5"/></pattern></defs>` : '';
    let wires = '', overs = '', fronts = '', ends = '', labels = '';
    Lo.items.forEach(it => {
      if (it.kind === 'box') {
        if (it.b.kind === 'set' || it.b.wires.length > 1) backs += boxBack(it, opts);
        fronts += `<g${fx ? ` class="cv-item${fxCls(it, opts)}"` : ''} data-item="${esc(it.key)}"${fxStyle(it, opts)}>${boxFront(it, opts, Lo, hatch)}</g>`;
      }
      else if (it.kind === 'conn') ends += connSvg(h, it, opts, Lo);
      else if (it.kind === 'splice') ends += spliceSvg(it, opts, Lo);
    });
    // Every wire end has a dot to drag it by: a splice's ports and loose ends (drawn and printed
    // with them), and a small dot where it meets a pin (canvas only). With fx the pin dot is a
    // metal contact ringed in the wire's color (.cv-contact).
    let dots = '';
    h.wires.slice().sort((a, b) => a.no - b.no).forEach((w, i) => {
      const p = Lo.wirePath(w);
      if (!p) return;
      const dim = dimIf(opts.focus && !opts.focus.wires.has(w.id));
      const fresh = fx && (opts.intro || opts.fresh === w.id);
      // `carry`: the wire whose end is being dragged (canvas only), lit like a selection.
      // A selected set's wires carry a softer pulse (setsel).
      const inSet = opts.pick.setWires.has(w.id);
      const cls = (opts.pick.wire.has(w.id) ? ' sel' : '') + (inSet ? ' setsel' : '') + dim + (fresh ? ' fresh' : '') + (fx && opts.carry === w.id ? ' carry' : '');
      wires += wireSvg(w, p.d, cls, fx, fresh, opts.intro ? i : null);
      labels += labelSvg(w, Lo, opts);
      overs += overSvg(w, p.over, cls, fx);
      const rg = ring(opts, w, fresh);
      p.ends.forEach(en => {
        const it = Lo.itemOf.get(en.e.node);
        if (!it) return;
        if (it.kind === 'loose') dots += looseSvg(it, w, en.which, dim, rg) + hitEnd(it.x, it.y, w.id, en.which, opts);
        else if (it.kind === 'conn' && !opts.sheet) dots += `<circle class="cv-end${dim}${rg.cls}" cx="${f(en.at.x)}" cy="${f(en.at.y)}" r="3.4" data-end="${w.id}|${en.which}" data-wire="${w.id}"${rg.style}/>` + hitEnd(en.at.x, en.at.y, w.id, en.which, opts);
      });
    });
    // A loose wire's anchors (canvas only): a small dot at each in its wire's color (Chris), a darker
    // shade with a darker ring on a light wire, and its own color with a light ring on a dark one, so
    // it shows on the wire and on the canvas. It slides along the curve.
    const dotFill = c => (isLight(c) ? `color-mix(in srgb, ${c} 62%, #000)` : c), dotRing = c => (isLight(c) ? `color-mix(in srgb, ${c} 35%, #000)` : '#e6e8ec');
    if (!opts.sheet) h.wires.forEach(w => {
      const an = Lo.anchorsOf(w);
      if (!an) return;
      const dim = dimIf(opts.focus && !opts.focus.wires.has(w.id)), c = M.colorInfo(w.color).base || '#9a9aa0';
      an.forEach(p => { dots += `<g class="cv-anchor${dim}" data-anchor="${w.id}|${p.side}" data-wire="${w.id}"><circle class="cv-anchor-hit" cx="${f(p.x)}" cy="${f(p.y)}" r="8"/><circle class="cv-anchor-dot" cx="${f(p.x)}" cy="${f(p.y)}" r="2.8" style="fill:${dotFill(c)};stroke:${dotRing(c)}"/></g>`; });
    });
    const notes = (h.callouts || []).map(c => noteSvg(c, Lo, opts)).join('');
    return { svg: backs + wires + overs + fronts + ends + labels + dots + notes, box: Lo.box, layout: Lo };
  }

  // A set's badge as drawn (its spot, its dot, and where along the set that is), for dragging it.
  const badgeOf = (it, id) => badgeRow(it).find(b => b.sp.s.id === id) || null;
  LM.conn = { G, layout, render, boxesOf, pinLabel, project, pathAt, badgeOf, edgeAt, edgeT };
})(window.LM = window.LM || {});
