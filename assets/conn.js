// The connection view: a wiring diagram in the style of WireViz. Connectors are tables (a header, a
// type row, one row per pin), and every wire is a line in its own color with a label
// ("P1:3  BU  P2:3") hanging from it.
//
// Boxes: each outermost set (M.roots) is a box, and the wires in no set make a stack with the others
// that join the same two ends. A box is the group of wires that travel together: its rows, its sets
// (lacing, a cable's sheath, a shield's braid, a twist, and a badge for each), and its path. In the
// arranged view the path is a route (route.js) from one end's pins to the other's, around the parts,
// and the box itself isn't drawn; in Real proportions it's the box, to scale. Splices are small
// nodes between boxes. Positions dragged by hand (h.place) win; the rest is
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
  // A shield's braid and a cable's sheath reach SHIELD_R and CABLE_R above their first wire and
  // below their last, snug round the wires (Chris, 2026-11-13: a cable as thin as it can be, growing
  // only with its wires). A set holding a shield, cable, or bundle reaches NEST_GAP past it; a twist
  // inside has nothing drawn round it, so it adds nothing. A bundle keeps room for its lacing knots
  // (BUNDLE_R). SET_R is the least a box's outermost set keeps for its layout (sz.R0: routes, badges).
  // A shield's braid is snug on its wires (Chris): their centers reach the twist's outer rows, and a
  // wire is drawn about 5 wide on the canvas, so 2.5 + 1.5 past their centers.
  const SET_R = 6, BUNDLE_R = 12, SHIELD_R = 4, CABLE_R = 4, NEST_GAP = 3;
  // A cable packs its wires PACK apart, edges touching (Chris, 2026-11-07), so its sheath is as thick
  // as its conductors need: SET_R past its outer wires. They fan in to it from grid spacing and back
  // out over fanLen, and its box keeps LABEL_PAD either side of its wires' labels after the fan-out.
  const PACK = 5, LABEL_PAD = 8;
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
  // apart: on a route (the arranged view), the loose wires between two parts share one only while
  // their pins sit next to each other at both ends (Chris, 2026-11-10: S1's wires to P2 pins 2 and 6
  // made one route as wide as four rows, with big corners and long S-bends); each run of neighbors is
  // its own group, keyed by the pair and, when the pair has more than one, its first wire.
  function boxesOf(h, apart) {
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
    // Keyed by the pair alone, so a shaped route (h.routes) stays when a second wire joins a lone one.
    pairs.forEach((ws, k) => {
      const groups = apart ? neighbors(h, k.split('|'), ws) : [ws];
      groups.forEach((g, i) => out.push({ key: 'p:' + k + (groups.length > 1 && i ? '~' + g[0].id : ''), kind: 'stack', label: '', wires: g }));
    });
    return out;
  }

  // Runs of wires whose pins are neighbors at both ends: ordered by their pins on the first part, a
  // wire joins the run before it when its pins are one away from that wire's at both ends (a splice's
  // ports always are; they're ordered to suit).
  function neighbors(h, nodes, ws) {
    const at = (w, id) => { const e = w.from.node === id ? w.from : w.to, n = M.node(h, id); return M.isConn(n) ? M.pinList(n).indexOf(e.pin) : null; };
    const list = ws.slice().sort((a, b) => (at(a, nodes[0]) ?? a.no) - (at(b, nodes[0]) ?? b.no) || (at(a, nodes[1]) ?? a.no) - (at(b, nodes[1]) ?? b.no));
    const runs = [];
    list.forEach(w => {
      const run = runs[runs.length - 1], last = run && run[run.length - 1];
      const step = id => { const p = at(last, id), q = at(w, id); return p == null || q == null ? true : Math.abs(p - q) === 1; };
      if (run && step(nodes[0]) && step(nodes[1])) run.push(w); else runs.push([w]);
    });
    // The first run keeps the pair's own key; list them in wire order otherwise.
    return runs.sort((a, b) => Math.min(...a.map(w => w.no)) - Math.min(...b.map(w => w.no)));
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
      const R = Math.max(st.bundle ? BUNDLE_R : st.shield ? SHIELD_R : st.cable ? CABLE_R : SET_R, ...kids.filter(u => hasEnds(u.spans[0].s)).map(u => u.R + NEST_GAP));
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
    // The outermost set has the box to itself; a bundle's lacing keeps BUNDLE_R. Its drawing keeps
    // its own R (a cable's sheath snug on its wires); the layout keeps at least SET_R.
    if (b.set.bundle) root.R = Math.max(BUNDLE_R, root.R);
    sz.rows = u.rows; sz.spans = u.spans; sz.R0 = Math.max(SET_R, root.R);
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
    const boxes = boxesOf(h, !prop);
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

    // ── Paths ──
    // Every box has a path its wires ride, u being the distance along it, and its sets reach along
    // it (sz.arc: u0, u1, from M.reach at sz.k mm per unit). A wire rides at its row's offset from
    // the path's middle (cy), packed where its sets pack it (packAt), and wpt turns that into a point.
    // - Arranged view (Chris, 2026-11-10: wires walk around the parts, and their straight runs drag):
    //   the path is a route (route.js) from the pins at one end to the pins at the other, in straight
    //   runs at right angles with rounded corners, around every connector and splice. A side whose
    //   wires go to more than one part ends at the box's edge (a breakout), and its wires curve on to
    //   their pins from there. The box itself is no longer drawn.
    // - Real proportions: the path is the box, straight across at cy, to scale (sz.prop).
    const rowYs = it => it.sz.rows.map((r, i) => (r.w ? rowY(it, i) : null)).filter(v => v != null);
    const midY = it => { const ys = rowYs(it); return (Math.min(...ys) + Math.max(...ys)) / 2; };
    // How far a box's drawing reaches from its path's middle: its rows, and a set's sheath, braid,
    // or lacing past them.
    const reachOf = it => { const ys = rowYs(it), c = midY(it); return Math.max(...ys.map(y => Math.abs(y - c))) + (it.b.kind === 'set' ? it.sz.R0 : 3); };
    const RT = LM.route, routes = new Map();
    // A wire end's pin point on a given edge of its connector ('l' or 'r'); a splice's port, a loose
    // end, or no side given: as anchor() places it.
    function pinAt(e, side) {
      const it = itemOf.get(e.node);
      if (it && it.kind === 'conn' && side) return { x: side === 'r' ? it.x + it.w : it.x, y: endY(e) };
      return anchor(e, side === 'r' ? Infinity : -Infinity);
    }
    // A box's end on side k (0 left, 1 right): its wires' pins when they all go to one part, on the
    // given edge of a connector (a splice's ports have their own side), level with the middle of the
    // pins; else a breakout. dir is the way out of the part (or toward the parts at a breakout).
    function terminal(b, k, side, towardX) {
      const it = b.item, es = b.wires.map(w => leftFirst(w)[k]), pit = itemOf.get(es[0].node);
      if (new Set(es.map(e => e.node)).size === 1 && pit && pit.kind !== 'loose') {
        const as = es.map(e => pinAt(e, pit.kind === 'conn' ? side : null)), ys = as.map(p => p.y), right = as[0].x > pit.x + pit.w / 2;
        return { x: as[0].x, y: (Math.min(...ys) + Math.max(...ys)) / 2, dir: right ? 1 : -1, pins: true, node: es[0].node, side: right ? 'r' : 'l', conn: pit.kind === 'conn', spread: (Math.max(...ys) - Math.min(...ys)) / 2 };
      }
      // A breakout: BREAK short of the nearest of those parts' pins, on the side facing the rest of
      // the route, level with the middle of the pins (Chris's harnesses: a bundle splitting to two
      // loads). dir is set so the route leaves it (A) or arrives (B) heading toward the parts.
      const as = es.map(e => anchor(e, towardX)), ys = as.map(p => p.y), xs = as.map(p => p.x);
      const at = h.routes && h.routes[b.key] && h.routes[b.key]['split' + k];
      // Dragged (Chris, 2026-11-10: the split point should move), it stays where it was put.
      if (at && isFinite(+at.x) && isFinite(+at.y)) {
        const head = towardX < +at.x ? 1 : -1;
        return { x: +at.x, y: +at.y, dir: head, pins: false, placed: true };
      }
      const fromLeft = towardX < xs.reduce((t, x) => t + x, 0) / xs.length;
      const x = fromLeft ? Math.min(...xs) - BREAK : Math.max(...xs) + BREAK, head = fromLeft ? 1 : -1;
      return { x, y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2 / 10) * 10, dir: head, pins: false };
    }
    const BREAK = 60, EASE = 60;
    // Which edges of each connector its routed wires use (connSvg puts the pin numbers there).
    const pinSides = new Map();
    // Routes for every box: each box is a Connection for the shared engine (connect.js routeAll, which
    // has the rules: either edge, shapes kept, Go behind, stability). Here, its end pairs: a connector
    // end may leave from either edge, the edge facing the other end first; a breakout ends where its
    // wires split.
    function routeAll() {
      const rects = items.filter(i => i.kind === 'conn' || i.kind === 'splice').map(i => ({ id: i.n.id, x0: i.x, y0: i.y, x1: i.x + i.w, y1: i.y + i.h }));
      const all = [];
      boxes.forEach(b => {
        const it = b.item, cx = it.x + it.w / 2, shape = (h.routes && h.routes[b.key]) || null;
        const far = k => { const es = b.wires.map(w => leftFirst(w)[k]), o = itemOf.get(es[0].node); return new Set(es.map(e => e.node)).size === 1 && o ? o.x + o.w / 2 : cx; };
        const mk = (sa, sb) => {
          const tA = terminal(b, 0, sa, far(1)), tB = terminal(b, 1, sb, far(0));
          // A breakout too close to the other end for two corners goes level with it, so the trunk
          // runs straight and its wires fan out from there (a bundle splitting just past X1 zigzagged).
          const room = (tB.x - tA.x) * (tA.pins ? tA.dir : -tA.dir), need = 2 * (reachOf(it) + 20) + 40;
          if (room < need) { if (!tB.pins && !tB.placed && tA.pins) tB.y = tA.y; else if (!tA.pins && !tA.placed && tB.pins) tA.y = tB.y; }
          return {
            A: { x: tA.x, y: tA.y, out: tA.pins ? tA.dir : -tA.dir, pins: tA.pins, node: tA.node, side: tA.side, conn: tA.conn, spread: tA.spread || 0, stub: tA.pins ? undefined : Math.round(reachOf(it) + 10) },
            B: { x: tB.x, y: tB.y, in: tB.pins ? -tB.dir : tB.dir, pins: tB.pins, node: tB.node, side: tB.side, conn: tB.conn, spread: tB.spread || 0, stub: tB.pins ? undefined : Math.round(reachOf(it) + 10) },
          };
        };
        // As wide as its rows, or as its pins where they're spread wider (the wires keep their pins'
        // spacing), so its corners are round enough for the outer wire.
        const c0 = mk(null, null), half = Math.max(reachOf(it), Math.max(c0.A.spread, c0.B.spread) + (b.kind === 'set' ? it.sz.R0 : 3)), stub = Math.round(half + 20);
        // The edges to try: both for a connector, the edge facing the other end first.
        const facing = k => { const o = itemOf.get(b.wires.map(w => leftFirst(w)[k])[0].node), t = far(1 - k); return o && t > o.x + o.w / 2 ? 'r' : 'l'; };
        const opts = k => { const t = mk(null, null)[k ? 'B' : 'A']; return t.conn ? [facing(k), facing(k) === 'r' ? 'l' : 'r'] : [null]; };
        const combos = [];
        opts(0).forEach(sa => opts(1).forEach(sb => combos.push(mk(sa, sb))));
        all.push({ key: b.key, weight: b.wires.length, combos, half, stub, r: half + 10, shape });
      });
      // The shared engine (connect.js) lays them; a connector end's edge is where its pin numbers go.
      const res = LM.connect.routeAll(h.id, rects, all, {
        fast: !!(view && view.fast),
        onRoute: (A0, B0) => [A0, B0].forEach(T => { if (T.pins && T.conn) { if (!pinSides.has(T.node)) pinSides.set(T.node, new Set()); pinSides.get(T.node).add(T.side); } }),
      });
      res.routes.forEach((R0, k) => routes.set(k, R0));
      const G = res.G;
      routing = { G, rects };
    }
    let routing = null;
    if (!prop) routeAll();
    boxes.forEach(b => {
      const it = b.item, sz = it.sz, isSet = b.kind === 'set', cy = midY(it);
      if (!prop) {
        const R0 = routes.get(b.key), sh = RT.shape(R0.A, R0.B, R0.v, R0.r, R0.half + 4);
        it.path = { pts: sh.pts, S: sh.S, aL: 0, Ls: sh.S, aR: 0, cy, routed: true, route: R0, xa: R0.A.x, xb: R0.B.x };
        it.path.ease = easeSpan(it.path);
      } else {
        const xa = it.x, xb = it.x + it.w;
        it.path = { pts: [{ x: xa, y: cy, nx: 0, ny: 1, s: 0 }, { x: xb, y: cy, nx: 0, ny: 1, s: xb - xa }], S: xb - xa, aL: 0, Ls: xb - xa, aR: 0, xa, xb, cy };
      }
      const S = it.path.S;
      sz.arc = new Map();
      const span = (u0, u1, lo, hi) => {
        u0 = Math.min(hi, Math.max(lo, u0)); u1 = Math.max(lo, Math.min(hi, u1));
        if (u1 - u0 < 12) { const c = Math.min(hi - 6, Math.max(lo + 6, (u0 + u1) / 2)); u0 = c - 6; u1 = c + 6; }
        return { u0, u1 };
      };
      if (!isSet) {
        const lens = b.wires.map(w => A.wireLen.get(w.id)).filter(v => v != null && v > 0), run = lens.length ? Math.max(...lens) : null;
        sz.k = run ? Math.min(10, Math.max(0.3, run / S)) : 2;
        return;
      }
      if (prop) { sz.ext.forEach((e, id) => sz.arc.set(id, { u0: e.x0, u1: e.x1 })); return; }
      const run = M.setRun(A, b.set);
      sz.k = run ? Math.min(10, Math.max(0.3, run / S)) : 2;
      setsUnder(h, b.set).forEach(({ s: st }) => {
        const r = M.reach(h, st);
        sz.arc.set(st.id, span(r.l / sz.k, S - r.r / sz.k, 0, S));
      });
    });
    // A breakout's branches (Chris, 2026-11-10): each wire runs on from where it leaves the trunk to
    // its own pin as a route of its own, at right angles round the parts like the rest, keeping clear
    // of the routes laid so far; a connector's pin from either edge, the cheaper. R0.branches holds
    // each wire's, by wire id: { A, B, v, r } from the pin side (A) or the trunk side (B).
    function routeBranches() {
      if (!routing) return;
      const { G, rects } = routing, m = 3 + 8, blocks = rects.map(r => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m }));
      boxes.forEach(b => {
        const it = b.item, P = it.path, R0 = P && P.route;
        if (!R0 || (R0.A.pins && R0.B.pins)) return;
        R0.branches = new Map();
        // For branches that must share a narrow gap: the wire going furthest from the trunk turns
        // first, so none crosses another (rank, by side).
        const rank = [0, 1].map(k => { const T = k ? R0.B : R0.A; return b.wires.slice().sort((p, q) => Math.abs(endY(leftFirst(q)[k]) - T.y) - Math.abs(endY(leftFirst(p)[k]) - T.y)).map(w => w.id); });
        b.wires.forEach(w => {
          [0, 1].forEach(k => {
            const T = k ? R0.B : R0.A;
            if (T.pins) return;
            const e = leftFirst(w)[k], u = k ? P.S : 0, at = wpt(w, it, u, baseAt(w, it, u)), pit = itemOf.get(e.node);
            if (!pit) return;
            // The trunk's end: leaving it the way the trunk runs there.
            const dirT = k ? R0.B.in : -R0.A.out;
            const sides = pit.kind === 'conn' ? ['l', 'r'] : [null];
            let best = null;
            // Close to its pins, the split fans straight out to them (below); further, each branch routes.
            const close = Math.abs(anchor(e, at.x).x - at.x) < 120;
            if (!close) sides.forEach(sd => {
              const q = pinAt(e, sd), right = q.x > pit.x + pit.w / 2, out = right ? 1 : -1;
              // Route from the pin (A) to the trunk (B), or from the trunk (A) to the pin (B).
              const pinT = { x: q.x, y: q.y, node: e.node, pins: true, side: right ? 'r' : 'l' };
              const A2 = k ? { x: at.x, y: at.y, out: dirT, stub: 12 } : Object.assign({ out }, pinT);
              const B2 = k ? Object.assign({ in: -out }, pinT) : { x: at.x, y: at.y, in: -dirT, stub: 12 };
              const v = RT.auto(G, A2, B2, blocks, 23, 26);
              if (v && RT.fits(A2, B2, v, 23) && (!best || v.cost < best.v.cost - 0.5)) best = { A: A2, B: B2, v };
            });
            // No room to keep clear of the others (a split close to its parts): one vertical run halfway
            // across the gap, sharing it.
            if (!best) sides.slice(0, 1).forEach(sd => {
              const q = pinAt(e, sd), right = q.x > pit.x + pit.w / 2, out = right ? 1 : -1, pinT = { x: q.x, y: q.y, node: e.node, pins: true, side: right ? 'r' : 'l' };
              const A2 = k ? { x: at.x, y: at.y, out: dirT, stub: 0 } : Object.assign({ out, stub: 0 }, pinT), B2 = k ? Object.assign({ in: -out, stub: 0 }, pinT) : { x: at.x, y: at.y, in: -dirT, stub: 0 };
              const n = rank[k].length, i = rank[k].indexOf(w.id), f = (k ? i + 1 : n - i) / (n + 1);
              const v = Math.abs(A2.y - B2.y) < 0.5 ? [] : [Math.round(A2.x + (B2.x - A2.x) * f)];
              if (RT.fits(A2, B2, v, 0)) best = { A: A2, B: B2, v };
            });
            if (!best) return;
            RT.occupy(G, best.A, best.B, best.v, 6);
            if (pit.kind === 'conn') { if (!pinSides.has(e.node)) pinSides.set(e.node, new Set()); pinSides.get(e.node).add((k ? best.B : best.A).side); }
            R0.branches.set(w.id, { A: best.A, B: best.B, v: best.v, r: 13, k });
          });
        });
      });
    }
    // Where a routed wire sits across its path (Chris, 2026-11-10: a pair whose pins are two rows
    // apart kinked where it was squeezed to its rows at a corner). It keeps its pins' spacing from the
    // A end; where the B end's pins are spaced or ordered otherwise, it changes over once, along the
    // route's longest straight run (P.ease). At a breakout it rides at its row.
    // The stretch that change-over takes: the middle of the longest straight run, up to EASE long.
    function easeSpan(P) {
      // Straight stretches: consecutive samples in line, level or vertical, joined while unbroken.
      const runs = [];
      for (let i = 1; i < P.pts.length; i++) {
        const a = P.pts[i - 1], b = P.pts[i], d = Math.abs(a.y - b.y) < 0.01 ? 'h' : Math.abs(a.x - b.x) < 0.01 ? 'v' : null;
        if (!d) continue;
        const last = runs[runs.length - 1];
        if (last && last.d === d && Math.abs(last.u1 - a.s) < 0.01) last.u1 = b.s; else runs.push({ d, u0: a.s, u1: b.s });
      }
      const best = runs.reduce((m, r) => (!m || r.u1 - r.u0 > m.u1 - m.u0 ? r : m), null);
      const L = best ? best.u1 - best.u0 : P.S, c = best ? (best.u0 + best.u1) / 2 : P.S / 2, F = Math.max(12, Math.min(EASE, L * 0.8));
      return { u0: c - F / 2, u1: c + F / 2 };
    }
    const endOff = new Map();
    function offsets(w, it) {
      if (endOff.has(w.id)) return endOff.get(w.id);
      const P = it.path, R0 = P.route, r = boxRowY.get(w.id) - P.cy, [l, rr] = leftFirst(w);
      const at = (e, u, T) => { const p = pathAt(P, u), q = pinAt(e, T.side); return (q.x - p.x) * p.nx + (q.y - p.y) * p.ny; };
      const pa = R0.A.pins ? at(l, 0, R0.A) : null, pb = R0.B.pins ? at(rr, P.S, R0.B) : null;
      const a = pa != null ? pa : pb != null ? pb : r, b = pb != null ? pb : a;
      const o = { r, a, b };
      endOff.set(w.id, o);
      return o;
    }
    // A routed wire's height in its box's row space at u (before packing).
    function baseAt(w, it, u) {
      const o = offsets(w, it), P = it.path, e = P.ease;
      const y = Math.abs(o.b - o.a) < 0.01 ? o.a : o.a + (o.b - o.a) * smooth((u - e.u0) / Math.max(1, e.u1 - e.u0));
      return P.cy + y;
    }
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
          // A twist packs as its wires do (nothing is drawn round it); a shield, cable, or bundle as
          // wide as its band.
          if (k.i0 === i) { const L = packLayout(it, k), offs = [...L.values()]; items.push({ L, half: (offs.length ? Math.max(...offs.map(Math.abs)) : 0) + (hasEnds(k.s) ? k.R : PACK / 2) }); }
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
      if (b.kind !== 'set') return;
      it.sz.spans.slice().sort((x, y) => y.depth - x.depth).forEach(sp => {
        const a = it.sz.arc.get(sp.s.id);
        if (!rides(sp.s) || !a) return;
        // o: each wire's packed offset from the set's middle (its own slot, from its row).
        const k = { sp, a, it, c: (rowY(it, sp.i0) + rowY(it, sp.i1)) / 2, F: fanLen(sp), f: packFn(it, sp), o: new Map() };
        it.sz.rows.slice(sp.i0, sp.i1 + 1).forEach((r, j) => { if (r.w) { k.o.set(r.w.id, k.f(rowY(it, sp.i0 + j))); if (!chainOf.has(r.w.id)) chainOf.set(r.w.id, []); chainOf.get(r.w.id).push(k); } });
      });
    });
    const cover = (k, u) => (u < k.a.u0 ? smooth((u - k.a.u0 + k.F) / k.F) : u > k.a.u1 ? smooth((k.a.u1 + k.F - u) / k.F) : 1);
    // Inside a set a wire sits in its own slot (k.o), plus how far a twist's helix swings it off its
    // plain height, scaled as its rows are packed. Its slot never follows its pins' spacing, which on a
    // route eases from one end's to the other's (Chris, 2026-11-13: a cable on spread pins was fat
    // in one stretch and thin in the rest).
    function packAt(w, u, base) {
      let y = base;
      (chainOf.get(w.id) || []).forEach(k => {
        const m = cover(k, u);
        if (m > 0) y += (k.c + k.o.get(w.id) + (base - rowBase(w, k.it, u)) * PACK / PITCH - y) * m;
      });
      return y;
    }
    // A boxed wire's point at u along its box's path: its packed height, as an offset across it.
    const wpt = (w, it, u, base) => { const p = pathAt(it.path, u), o = packAt(w, u, base) - it.path.cy; return { x: p.x + p.nx * o, y: p.y + p.ny * o }; };
    // A boxed wire's height in row space at u before packing: its row, or on a route, eased to its pins.
    const rowBase = (w, it, u) => (it.path && it.path.routed ? baseAt(w, it, u) : boxRowY.get(w.id));
    routeBranches();
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
      if (!P) return { pts: [{ x: lIn.x, y: lIn.y }, { x: rIn.x, y: rIn.y }] };
      // The twist runs by distance along the path, so on a route it follows the corners.
      const tsp = twisty ? twistSpan(w) : null, hx = tsp && helix(tsp, y0);
      // On a route the helix swings about the wire's own height there (its pins' spacing).
      const tw = u => (tsp && u >= tsp.ua && u <= tsp.ub ? (P.routed ? helix(tsp, baseAt(w, it, u)) : hx)(u - tsp.ua) : null);
      // On a route the wire rides all of it, from pin to pin (or breakout to breakout).
      if (P.routed) return { pts: steps(0, P.S, 3).map(u => { const v = tw(u); return Object.assign(wpt(w, it, u, v ? v.y : baseAt(w, it, u)), { front: !!(v && v.front) }); }) };
      // Real proportions: across the box, straight, packed where its sets pack it.
      const out = [], dir = rIn.x >= lIn.x ? 1 : -1, xs = [lIn.x, rIn.x];
      (chainOf.get(w.id) || []).forEach(k => [[k.a.u0 - k.F, k.a.u0], [k.a.u1, k.a.u1 + k.F]].forEach(([a, b]) => steps(a, b, 3).forEach(u => xs.push(xOfU(it, u)))));
      if (tsp) steps(tsp.ua, tsp.ub, 3).forEach(u => xs.push(xOfU(it, u)));
      const lo = Math.min(lIn.x, rIn.x) - 0.01, hi = Math.max(lIn.x, rIn.x) + 0.01;
      [...new Set(xs.filter(x => x >= lo && x <= hi).map(x => Math.round(x * 100) / 100))].sort((a, b) => (a - b) * dir).forEach(x => {
        const u = uOfX(it, x), v = tw(u) || { y: y0, front: false };
        out.push({ x, y: packAt(w, u, v.y), front: v.front });
      });
      return { pts: out };
    }
    // A routed wire's two ends past its path: at a part's pins it starts on the path itself; at a
    // breakout it curves on from the path's end to its pin, leaving along the path.
    // At a breakout the wire runs on along its branch (routeBranches) to its pin, as points: head
    // (pin to trunk) or tail (trunk to pin); a curve where it has none.
    function routedEnds(w, e, pts) {
      const { it, l, r } = e, P = it.path, R0 = P.route, a = pts[0], z = pts[pts.length - 1];
      const br = R0.branches && R0.branches.get(w.id), bp = br && RT.shape(br.A, br.B, br.v, br.r).pts.map(p => ({ x: p.x, y: p.y }));
      const head = R0.A.pins ? null : br && br.k === 0 && bp ? bp.slice(0, -1) : curvePts(anchor(l, a.x), a, null, tanAt(P, 0)).slice(0, -1);
      const tail = R0.B.pins ? null : br && br.k === 1 && bp ? bp.slice(1) : curvePts(z, anchor(r, z.x), tanAt(P, P.S), null).slice(1);
      return { L0: head ? head[0] : a, Z: tail ? tail[tail.length - 1] : z, head, tail };
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
      const { it, l, r } = e, run = runPts(w, e, true), pts = run.pts, a = pts[0], z = pts[pts.length - 1];
      const line = pts.slice(1).map(q => `L${f(q.x)} ${f(q.y)}`).join('');
      if (it.path && it.path.routed) {
        const E = routedEnds(w, e, pts), all = (E.head || []).concat(pts, E.tail || []);
        return { d: `M${f(all[0].x)} ${f(all[0].y)}` + all.slice(1).map(q => `L${f(q.x)} ${f(q.y)}`).join(''), over: overOf(pts),
          ends: [{ which: whichOf(w, l), at: E.L0, e: l }, { which: whichOf(w, r), at: E.Z, e: r }] };
      }
      const L0 = anchor(l, it.x + it.w / 2), R0 = anchor(r, it.x + it.w / 2);
      return { d: `M${f(L0.x)} ${f(L0.y)}` + curve(L0, a) + line + curve(z, R0), over: overOf(pts),
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
      // On a route, a little clear of its ends.
      const F = P.routed ? 10 : 0;
      const ua = Math.max(a.u0 + pad, P.routed ? F : uOfX(it, it.x + fan + 8)), ub = Math.min(a.u1 - pad, P.routed ? P.S - F : uOfX(it, it.x + it.w - fan - 8));
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
      if (it.path.routed) {
        const u0 = project(it.path, q);
        if (!s) return wpt(w, it, u0, baseAt(w, it, u0));
        const u = Math.min(s.ub, Math.max(s.ua, u0));
        return wpt(w, it, u, helix(s, baseAt(w, it, u))(u - s.ua).y);
      }
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
        const p = pathAt(P, u), os = ws.map(w => packAt(w, u, rowBase(w, it, u)) - P.cy);
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
    // The runs of each routed box you can drag (canvas handles and app.js): its middle runs, with
    // where each is drawn. And the one nearest p on a box's route, for a drag that starts on a wire
    // or a set's area.
    function routeRuns(key) {
      const b = boxes.find(x => x.key === key), P = b && b.item.path;
      if (!P || !P.routed) return [];
      const R0 = P.route;
      return RT.runs(R0.A, R0.B, R0.v).filter(r => r.k >= 0 && Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y) > 0.5);
    }
    function runAt(key, p) {
      const b = boxes.find(x => x.key === key), P = b && b.item.path;
      if (!P || !P.routed) return null;
      const R0 = P.route, n = RT.nearestRun(R0.A, R0.B, R0.v, p);
      return n && { key, route: R0, j: n.j, k: n.k, axis: n.axis, d: n.d, at: n.at };
    }
    const boxOfWire = id => { const b = boxes.find(x => x.wires.some(w => w.id === id)); return b ? b.key : null; };
    const boxOfSet = id => { const b = boxes.find(x => x.item.sz.spans.some(sp => sp.s.id === id)); return b ? b.key : null; };
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
        const { it, l, r } = e, mid = runPts(w, e, false).pts;
        let pts;
        if (it.path && it.path.routed) {
          const E = routedEnds(w, e, mid);
          pts = (E.head || []).concat(mid, E.tail || []);
        } else {
          const L0 = anchor(l, it.x + it.w / 2), R0 = anchor(r, it.x + it.w / 2);
          pts = curvePts(L0, mid[0]).concat(mid.slice(1, -1), curvePts(mid[mid.length - 1], R0));
        }
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
    // On a route, a box's labels default to one spot along it for all its wires, so they stack as a
    // table: on its longest level stretch, clear of the ends (where wires ease to their pins) and of
    // packed sets and their fans; at the stretch's left end when the label fits along it, else its
    // middle.
    const labelU = new Map();
    function routedLabelU(it) {
      if (labelU.has(it)) return labelU.get(it);
      const P = it.path, F = Math.min(it.path.route.stub + 6, P.S / 3);
      // Not where its wires change spacing (P.ease), nor on packed sets and their fans.
      // Any set that packs or twists its wires counts, not just the outermost (TP1 runs on past B1).
      const bad = (it.sz.spans || []).filter(sp => rides(sp.s)).map(sp => { const a = it.sz.arc.get(sp.s.id); return a && [a.u0 - fanLen(sp), a.u1 + fanLen(sp)]; }).filter(Boolean).concat([[P.ease.u0 - 4, P.ease.u1 + 4]]);
      let pieces = [];
      for (let i = 1; i < P.pts.length; i++) {
        const a = P.pts[i - 1], b = P.pts[i];
        if (Math.abs(a.y - b.y) > 0.01 || Math.abs(a.x - b.x) < 0.01) continue;
        const last = pieces[pieces.length - 1];
        if (last && Math.abs(last[1] - a.s) < 0.01) last[1] = b.s; else pieces.push([a.s, b.s]);
      }
      // For the clear-spot search, the whole level stretches but the last few units at each end (a
      // label's clearance from the parts is checked as such); for the fallback, clear of the ends.
      const cut = (list, e) => list.map(([a, b]) => [Math.max(a, e), Math.min(b, P.S - e)]).filter(([a, b]) => b - a > 4);
      const drop = list => { let out = list; bad.forEach(([a, b]) => { out = out.flatMap(([p, q]) => (b <= p || a >= q ? [[p, q]] : [[p, Math.max(p, a)], [Math.min(q, b), q]]).filter(([x, y]) => y - x > 4)); }); return out; };
      const wide = drop(cut(pieces, 6));
      pieces = cut(pieces, F);
      const level = pieces.slice();
      bad.forEach(([a, b]) => { pieces = pieces.flatMap(([p, q]) => (b <= p || a >= q ? [[p, q]] : [[p, Math.max(p, a)], [Math.min(q, b), q]]).filter(([x, y]) => y - x > 4)); });
      // With no clear stretch (a cable or twist the length of the route), the labels stack under the
      // wires on the longest level stretch instead, each with a leader up to its wire (`under`).
      let u = P.S / 2, under = false;
      const pick = list => {
        const [a, b] = list.reduce((m, p) => (p[1] - p[0] > m[1] - m[0] ? p : m));
        const left = pathAt(P, a).x <= pathAt(P, b).x ? a : b;
        return b - a >= it.sz.inner + 30 ? left + (left === a ? 10 : -10) : (a + b) / 2;
      };
      // Clear of the parts (Chris, 2026-11-10: a short wire's label ran into the part at its end): try
      // spots along each stretch, longest first, from its left end in, and take the first where no
      // wire's label (its box's label width, over its wire) overlaps a connector or splice.
      const cards = items.filter(i => i.kind === 'conn' || i.kind === 'splice');
      const live = it.sz.rows.filter(r => r.w).map(r => r.w);
      // A label sits right of its dot ('r'), else left of it ('l'), or for a lone wire beside a
      // vertical run ('v'), whichever is clear first.
      const inner = it.sz.inner;
      const rectOf = (d, mode) => (mode === 'l' ? [d.x - DOT_GAP - inner - 4, d.y - 17, d.x - DOT_GAP + 4, d.y + 3]
        : mode === 'v' ? [d.x + DOT_GAP - 4, d.y - 8, d.x + DOT_GAP + inner + 4, d.y + 12] : [d.x + DOT_GAP - 4, d.y - 17, d.x + DOT_GAP + inner + 4, d.y + 3]);
      const clearAt = (u0, mode) => live.every(w => {
        const [x0, y0, x1, y1] = rectOf(wpt(w, it, u0, baseAt(w, it, u0)), mode);
        return !cards.some(c => x0 < c.x + c.w && c.x < x1 && y0 < c.y + c.h && c.y < y1);
      });
      const clearIn = (list, modes) => {
        for (const [a, b] of list.slice().sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))) {
          const leftFirst = pathAt(P, a).x <= pathAt(P, b).x, n = Math.max(1, Math.floor((b - a) / 8));
          for (let i = 0; i <= n; i++) {
            const t = Math.min(b, Math.max(a, leftFirst ? a + 10 + i * 8 : b - 10 - i * 8));
            for (const mode of modes) if (clearAt(t, mode)) return { u: t, mode };
          }
        }
        return null;
      };
      // The route's vertical stretches, for a lone wire's label.
      const upright = [];
      for (let i = 1; i < P.pts.length; i++) {
        const a = P.pts[i - 1], b = P.pts[i];
        if (Math.abs(a.x - b.x) > 0.01 || Math.abs(a.y - b.y) < 0.01) continue;
        const last = upright[upright.length - 1];
        if (last && Math.abs(last[1] - a.s) < 0.01) last[1] = b.s; else upright.push([a.s, b.s]);
      }
      const ups = upright.map(([a, b]) => [Math.max(a, F), Math.min(b, P.S - F)]).filter(([a, b]) => b - a > 20);
      const clear = (wide.length ? clearIn(wide, ['r', 'l']) : null) || (live.length === 1 && ups.length ? clearIn(ups, ['v']) : null);
      if (clear) { labelU.set(it, { u: clear.u, under: false, mode: clear.mode }); return labelU.get(it); }
      else if (pieces.length) u = pick(pieces);
      else if (level.length) { u = pick(level); under = true; }
      else under = bad.some(([a, b]) => u > a && u < b);
      labelU.set(it, { u, under });
      return labelU.get(it);
    }
    function labelAt(w) {
      const ln = lane(w);
      if (!ln) return null;
      const it = ln.it;
      if (it.path && it.path.routed) {
        const t = w.labelAt == null ? null : Math.min(1, Math.max(0, +w.labelAt));
        let dot, at = null;
        if (t != null) dot = laneAt(ln, t * ln.S);
        else {
          const L = routedLabelU(it), u = L.u, ts = twistSpan(w);
          dot = ts && u >= ts.ua && u <= ts.ub ? wpt(w, it, u, helix(ts, baseAt(w, it, u))(u - ts.ua).y) : wpt(w, it, u, baseAt(w, it, u));
          if (L.under) {
            // Under the box's wires there, a row each, in row order.
            const live = it.sz.rows.filter(r => r.w).map(r => r.w), low = Math.max(...live.map(x => wpt(x, it, u, baseAt(x, it, u)).y)) + it.sz.R0 + 8;
            at = { x0: dot.x + DOT_GAP, ty: low + 12 + (it.b.kind === 'set' ? BADGE_H + 6 : 0) + live.indexOf(w) * 15 };
          }
        }
        const s = project(ln, dot), o = w.labelOff, set = o && isFinite(+o.dx) && isFinite(+o.dy);
        const mode = t == null && !set && !at ? routedLabelU(it).mode : null;
        const x0 = set ? dot.x + +o.dx : at ? at.x0 : mode === 'l' ? dot.x - DOT_GAP - it.sz.inner : dot.x + DOT_GAP;
        const ty = set ? dot.y + +o.dy : at ? at.ty : mode === 'v' ? dot.y + 4 : dot.y - 5;
        return { dot, x0, ty, t: ln.S ? s / ln.S : 0.5, it, left: mode === 'l' };
      }
      const x0d = labelX0(it), ry = boxRowY.get(w.id), lift = offLane.has(it) ? offLane.get(it).get(w.id) || 0 : 0;
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
    boxes.forEach(b => { if (!b.item.path || !b.item.path.routed) labelX0(b.item); });
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
    // A table as drawn: its frame, each column's x and width, and each row's y, height, and lines.
    function tableGeom(c) {
      const t = c.table, a = c.at || {}, it = a.node && itemOf.get(a.node);
      if (!t) return null;
      const x = (it ? it.x : 0) + (+a.x || 0), y = (it ? it.y : 0) + (+a.y || 0), w = Math.max(TBL_MIN * t.cols.length, +t.w || 0);
      let cx = x;
      const cols = t.cols.map(fr => { const c0 = { x: cx, w: w * fr }; cx += c0.w; return c0; });
      const rows = t.cells.map(row => {
        const lines = cols.map((col, k) => wrapCell(row[k], col.w - 2 * TBL_PX));
        return { lines, h: Math.max(1, ...lines.map(l => l.length)) * TBL_LH + 2 * TBL_PY };
      });
      // The corner's least height: what's over the rows' text, shared evenly.
      const textH = rows.reduce((s, r) => s + r.h, 0), extra = Math.max(0, (+t.minH || 0) - textH) / (rows.length || 1);
      let ry = y;
      rows.forEach(r => { r.h += extra; r.y = ry; ry += r.h; });
      return { x, y, w, h: ry - y, cols, rows };
    }
    function noteAt(c) {
      const a = c.at || {};
      if (a.kind === 'table') { const g = tableGeom(c); return g && { x: g.x, y: g.y }; }
      if (a.kind === 'area') return edgeAt(areaRect(c), a.e);
      if (a.kind === 'node') { const it = itemOf.get(a.id); return it && { x: it.x + (a.fx || 0) * it.w, y: it.y + (a.fy || 0) * it.h }; }
      if (a.kind === 'set') { const g = setGeom(a.id); return g && { x: g.x + (a.fx || 0) * g.w, y: g.y + (a.fy || 0) * g.h }; }
      const w = M.wire(h, a.id), t = a.t == null ? 0.5 : a.t, ln = w && lane(w);
      if (ln) return laneAt(ln, t * ln.S);
      const e = w && wireEnds(w);
      return e && { x: e[0].x + (e[1].x - e[0].x) * t, y: e[0].y + (e[1].y - e[0].y) * t };
    }
    // A note on a wire keeps t, how far along the wire's line it's pinned (0 to 1).
    function wireT(w, p) {
      const ln = lane(w);
      if (ln && ln.S) return Math.min(1, Math.max(0, project(ln, p) / ln.S));
      const e = wireEnds(w);
      if (!e || Math.abs(e[1].x - e[0].x) < 1) return 0.5;
      return Math.min(1, Math.max(0, (p.x - e[0].x) / (e[1].x - e[0].x)));
    }
    // The diagram's bounds take in the notes' bubbles.
    (h.callouts || []).forEach(c => {
      if (c.table) { const g = tableGeom(c); if (g) { box.x0 = Math.min(box.x0, g.x); box.x1 = Math.max(box.x1, g.x + g.w); box.y0 = Math.min(box.y0, g.y); box.y1 = Math.max(box.y1, g.y + g.h); } return; }
      const p = noteAt(c); if (!p) return; const s = noteSize(c);
      box.x0 = Math.min(box.x0, p.x + c.dx - s.w / 2); box.x1 = Math.max(box.x1, p.x + c.dx + s.w / 2); box.y0 = Math.min(box.y0, p.y + c.dy - s.h / 2); box.y1 = Math.max(box.y1, p.y + c.dy + s.h / 2);
      if (c.at.kind === 'area') { const r = areaRect(c); box.x0 = Math.min(box.x0, r.x); box.x1 = Math.max(box.x1, r.x + r.w); box.y0 = Math.min(box.y0, r.y); box.y1 = Math.max(box.y1, r.y + r.h); }
    });
    return { items, itemOf, boxes, wirePath, twistStart, twistEnd, wireAt, lane, labelAt, anchor, endY, portsOf, portOf, box, noteAt, wireT, setGeom, setEndAt, areaRect, tableGeom, routeRuns, runAt, boxOfWire, boxOfSet, pinSides: id => pinSides.get(id) || null };
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
      (fx ? `<path class="w-gloss"${pl} d="${d}"/>` + (cls && /\s(sel|carry)\b/.test(cls) ? `<path class="w-pulse${ink}" pathLength="1" d="${d}"/>` : cls && /\s(setsel|nodesel)\b/.test(cls) ? `<path class="w-pulse soft${ink}" pathLength="1" d="${d}"/>` : '') : '') + '</g>';
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
    // On a route, the edges its routed wires actually use (conn.js routeAll picks them).
    const used = Lo.pinSides && Lo.pinSides(n.id);
    const numRight = used && used.size ? used.has('r') : toRight || !toLeft;
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
  // The point and normal at s along a route's samples, and at u along a box's path.
  function sampleAt(pts, s) {
    s = Math.min(pts[pts.length - 1].s, Math.max(0, s));
    let i = 1;
    while (i < pts.length - 1 && pts[i].s < s) i++;
    const a = pts[i - 1], b = pts[i], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    const nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t, n = Math.hypot(nx, ny) || 1;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: nx / n, ny: ny / n };
  }
  function pathAt(P, u) {
    if (P.routed) return sampleAt(P.pts, u);
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
    // A route draws no box: its wires and sets are the drawing (Chris, 2026-11-10).
    let o = (it.path && it.path.routed ? '' : `<rect class="cv-box${boxSel(it, opts) && it.b.kind !== 'set' ? ' sel' : ''}${dimIf(boxDim(it, opts))}" x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}"/>`) + badgeLeaders(it, opts);
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
  // Tables (Chris, 2026-11-11): cell text wraps to its column, a word wider than the column breaks
  // where it must, and a row is as tall as its most wrapped cell.
  const TBL_FS = 11, TBL_LH = 14, TBL_PX = 6, TBL_PY = 4, TBL_MIN = 24;
  // Measured in the sheet's font (the canvas's is near it), with a little to spare for either;
  // U.textW's estimate where there's no canvas.
  let tblCtx;
  const TBL_FONT = `${TBL_FS}px 'Segoe UI', Inter, -apple-system, Arial, sans-serif`;
  function cellW(s) {
    if (tblCtx === undefined) { try { tblCtx = document.createElement('canvas').getContext('2d'); tblCtx.font = TBL_FONT; } catch (e) { tblCtx = null; } }
    return tblCtx ? tblCtx.measureText(s).width * 1.06 : tw(s, TBL_FS) * 1.15;
  }
  function wrapCell(text, width) {
    const out = [], fits = s => cellW(s) <= width;
    String(text || '').split('\n').forEach(par => {
      let line = '';
      par.split(/\s+/).filter(Boolean).forEach(word => {
        const t = line ? line + ' ' + word : word;
        if (fits(t)) { line = t; return; }
        if (line) out.push(line);
        line = '';
        // A word wider than the column: as many characters per line as fit.
        let rest = word;
        while (rest && !fits(rest)) {
          let n = 1;
          while (n < rest.length && fits(rest.slice(0, n + 1))) n++;
          out.push(rest.slice(0, n)); rest = rest.slice(n);
        }
        line = rest;
      });
      out.push(line);
    });
    while (out.length > 1 && out[out.length - 1] === '') out.pop();
    return out.length ? out : [''];
  }
  // A table: its frame and rules, its text, and on the canvas a grab area over it (data-tbl, so it
  // drags and selects), a strip on each inner column rule to drag it (data-tblcol), and when
  // selected a corner handle to resize it (data-tblcorner).
  function tableSvg(c, Lo, opts) {
    const g = Lo.tableGeom(c);
    if (!g) return '';
    const on = !!opts.pick && opts.pick.note.has(c.id), id = esc(c.id);
    let o = `<g class="cv-note cv-table${on ? ' sel' : ''}" data-note="${id}"><title>${esc(c.ref)}</title>` +
      `<rect class="cv-table-box" x="${f(g.x)}" y="${f(g.y)}" width="${f(g.w)}" height="${f(g.h)}"/>`;
    if (!opts.sheet) o += `<rect class="cv-table-grab" x="${f(g.x)}" y="${f(g.y)}" width="${f(g.w)}" height="${f(g.h)}" data-tbl="${id}"/>`;
    let rules = '';
    g.rows.slice(1).forEach(r => { rules += `M${f(g.x)} ${f(r.y)}H${f(g.x + g.w)}`; });
    g.cols.slice(1).forEach(k => { rules += `M${f(k.x)} ${f(g.y)}V${f(g.y + g.h)}`; });
    if (rules) o += `<path class="cv-table-rule" d="${rules}"/>`;
    g.rows.forEach(r => r.lines.forEach((lines, k) => lines.forEach((l, i) => {
      if (l) o += `<text class="cv-table-t" x="${f(g.cols[k].x + TBL_PX)}" y="${f(r.y + TBL_PY + 10.5 + i * TBL_LH)}">${esc(l)}</text>`;
    })));
    if (!opts.sheet) {
      g.cols.slice(1).forEach((k, i) => { o += `<rect class="cv-table-col" x="${f(k.x - 4)}" y="${f(g.y)}" width="8" height="${f(g.h)}" data-tblcol="${id}|${i + 1}"/>`; });
      if (on) o += `<rect class="cv-table-h" x="${f(g.x + g.w - 4)}" y="${f(g.y + g.h - 4)}" width="8" height="8" rx="1.5" data-tblcorner="${id}"/>`;
    }
    return o + '</g>';
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
    if (c.table) return tableSvg(c, Lo, opts);
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
  // On a route there's no box to sit under: the row starts under the outermost set's band, at its
  // first level stretch past its rounded end, and each leader meets its set's lower edge on a level
  // stretch as near straight above its badge as it can.
  const lowEdge = p => (p.ny >= 0 ? ptB(p) : ptT(p));
  function badgeRowRouted(it) {
    const sps = it.sz.spans, g0 = sps.length && it.band(sps[0]);
    if (!g0) return [];
    const level = g => g.pts.filter(p => Math.abs(p.ny) > 0.99 && p.u >= g.u0 + g.rx + 4 && p.u <= g.u1 - g.rx - 4);
    const L0 = level(g0), start = L0.length ? lowEdge(L0[0]) : lowEdge(g0.at((g0.u0 + g0.u1) / 2));
    const near = L0.filter(p => Math.abs(p.y - L0[0].y) < 0.5).map(lowEdge);
    let x = start.x;
    const y = Math.max(start.y, ...near.map(q => q.y)) + 10;
    return sps.map(sp => {
      const w = badgeW(sp.s.label), g = it.band(sp), cx = x + w / 2, pool = level(g).length ? level(g) : g.pts;
      const a = pool.reduce((m, p) => (Math.abs(lowEdge(p).x - cx) + Math.abs(lowEdge(p).y - y) * 0.2 < Math.abs(lowEdge(m).x - cx) + Math.abs(lowEdge(m).y - y) * 0.2 ? p : m));
      const span = Math.max(1e-6, g.u1 - g.u0), st = sp.s, t = st.badgeAt == null ? (a.u - g.u0) / span : Math.min(1, Math.max(0, +st.badgeAt));
      const d = st.badgeAt == null ? lowEdge(a) : lowEdge(g.at(g.u0 + t * span)), o = st.badgeOff, moved = !!o && isFinite(+o.dx) && isFinite(+o.dy);
      const bx = moved ? d.x + +o.dx : x, by = moved ? d.y + +o.dy : y;
      const out = { sp, x: bx, y: by, w, cx: bx + w / 2, ax: d.x, ay: d.y, t, moved };
      x += w + BADGE_GAP;
      return out;
    });
  }
  function badgeRow(it) {
    if (it.path && it.path.routed) return badgeRowRouted(it);
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
    if (it.b.kind !== 'set' && !opts.sheet && !(it.path && it.path.routed)) sz.rows.forEach((r, i) => {
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
    const ax = L.left ? x0 + sz.inner + 4 : x0 - 4, ay = ty - 4, far = Math.hypot(ax - d.x, ay - d.y) > 3.5;
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
    const Lo = layout(h, A, { prop: !!opts.prop, fast: !!opts.fast });
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
      // A selected set's wires carry a softer pulse (setsel), and so do the wires of a selected
      // connector or splice (nodesel; Chris, 2026-11-11).
      const inSet = opts.pick.setWires.has(w.id);
      const onNode = fx && (opts.pick.node.has(w.from.node) || opts.pick.node.has(w.to.node));
      const cls = (opts.pick.wire.has(w.id) ? ' sel' : '') + (inSet ? ' setsel' : '') + (onNode ? ' nodesel' : '') + dim + (fresh ? ' fresh' : '') + (fx && opts.carry === w.id ? ' carry' : '');
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
    // Each selected route's middle runs get a handle (canvas only): a small bar at the run's middle,
    // along it, to drag the run sideways (app.js). A wire's or set's line drags the run under the
    // pointer too; the handles show which runs move.
    // They sit under the sets' grips and badges, so a set's end still drags where a run's middle meets it.
    let runs = '';
    if (!opts.sheet && !opts.prop) Lo.boxes.forEach(b => {
      const it = b.item;
      if (!it.path || !it.path.routed || !(boxSel(it, opts) || b.wires.some(w => opts.pick.wire.has(w.id)) || it.sz.spans.some(sp => spanSel(sp, opts)))) return;
      Lo.routeRuns(b.key).forEach(r => {
        const mx = (r.a.x + r.b.x) / 2, my = (r.a.y + r.b.y) / 2, L = Math.min(18, Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y) / 2), hv = r.axis === 'h';
        runs += `<g class="cv-run ${r.axis}" data-run="${esc(b.key)}|${r.j}"><rect class="cv-run-hit" x="${f(mx - (hv ? L + 4 : 8))}" y="${f(my - (hv ? 8 : L + 4))}" width="${f(hv ? 2 * L + 8 : 16)}" height="${f(hv ? 16 : 2 * L + 8)}" rx="6"/>` +
          `<rect class="cv-run-bar" x="${f(mx - (hv ? L : 2.5))}" y="${f(my - (hv ? 2.5 : L))}" width="${f(hv ? 2 * L : 5)}" height="${f(hv ? 5 : 2 * L)}" rx="2.5"/></g>`;
      });
      // Where a bundle splits to several parts: a diamond to drag the split point anywhere.
      const R0 = it.path.route;
      [[R0.A, 0], [R0.B, 1]].forEach(([T, k]) => {
        if (T.pins) return;
        dots += `<g class="cv-split" data-split="${esc(b.key)}|${k}"><title>Drag to move where the wires split</title><circle class="cv-split-hit" cx="${f(T.x)}" cy="${f(T.y)}" r="11"/>` +
          `<rect class="cv-split-dot" x="${f(T.x - 5)}" y="${f(T.y - 5)}" width="10" height="10" rx="2" transform="rotate(45 ${f(T.x)} ${f(T.y)})"/></g>`;
      });
    });
    const notes = (h.callouts || []).map(c => noteSvg(c, Lo, opts)).join('');
    return { svg: backs + wires + overs + runs + fronts + ends + labels + dots + notes, box: Lo.box, layout: Lo };
  }

  // A set's badge as drawn (its spot, its dot, and where along the set that is), for dragging it.
  const badgeOf = (it, id) => badgeRow(it).find(b => b.sp.s.id === id) || null;
  LM.conn = { G, layout, render, boxesOf, pinLabel, project, pathAt, badgeOf, edgeAt, edgeT, wrapCell, TBL_MIN };
})(window.LM = window.LM || {});
