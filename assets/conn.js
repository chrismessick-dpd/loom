// The connection view: a wiring diagram in the style of WireViz. Connectors are tables (a header, a
// type row, one row per pin), each cable or bundle is a box in the middle with one row per wire
// ("P1:3  BU  P2:3"), and every wire is a curve in its own color that runs through its box.
//
// Boxes: a cable group gets its own box; every other wire is bundled with the wires that join the same
// two ends. Splices are small nodes between boxes. Positions dragged by hand (h.place) win; the rest is
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
  // Room at each end of a box's wire rows for the cable sheath's rounded end or a bundle's band.
  const BOX_END = { cable: 16, bundle: 24 };
  // Extra room left of a box's row text when some of its wires twist, for the leader lines from the
  // text to where each wire's twist starts. A bundle that is one twisted set has room already.
  const LEAD = 22;
  // A box's label table sits under its wires (Chris): a bundle's since h.place entries carry v: 2,
  // a cable's (with its note under the table) since v: 3. A position dragged before that kept the
  // table on top, with the first port lower by TABLE_SHIFT (and a cable's by NOTE_H more for its
  // note), so it moves down by that and its wires stay put.
  const TABLE_SHIFT = 40, NOTE_H = 18;
  const tableShift = (b, sz, p) => (b.kind === 'single' ? 0 : b.kind === 'bundle' ? (p.v >= 2 ? 0 : TABLE_SHIFT) : (p.v >= 3 ? 0 : TABLE_SHIFT + (sz.note ? NOTE_H : 0)));
  const f = v => Math.round(v * 10) / 10;
  const tw = (s, size) => U.textW(s, size || G.FS);

  const pinRef = (h, e) => { const n = M.node(h, e.node); return M.label(n) + (e.pin && M.isConn(n) ? ':' + e.pin : ''); };
  const gaugeMetric = g => (g ? (M.AWG[g] ? M.AWG[g] + ' mm² (' + g + ' AWG)' : g + ' AWG') : '');
  const lenText = mm => (mm == null ? 'length not set' : Math.round(mm) + ' mm');

  // The boxes: cables first, then bundles by end pair, in wire order. A wire alone between its two
  // ends gets no box or table (Chris), just its label row over the wire; Properties shows the rest
  // when it's clicked. In the layout (withSingles) it's a 'single' in the box column, which keeps the
  // parts around it apart, holds its label, and drags like a box. A wire with a loose end is in no box
  // either: it curves to its loose end's dot.
  const looseWire = (h, w) => M.isLoose(M.node(h, w.from.node)) || M.isLoose(M.node(h, w.to.node));
  function boxesOf(h, A, withSingles) {
    const out = [], taken = new Set();
    h.groups.filter(g => g.kind === 'cable').forEach(g => {
      const ws = g.wires.map(id => M.wire(h, id)).filter(w => w && !looseWire(h, w));
      if (!ws.length) return;
      ws.forEach(w => taken.add(w.id));
      out.push({ key: 'g:' + g.id, kind: 'cable', group: g, label: g.label, wires: ws });
    });
    const pairs = new Map();
    h.wires.slice().sort((a, b) => a.no - b.no).forEach(w => {
      if (taken.has(w.id) || looseWire(h, w)) return;
      const k = [w.from.node, w.to.node].sort().join('|');
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push(w);
    });
    let i = 0;
    pairs.forEach((ws, k) => {
      if (ws.length > 1) out.push({ key: 'p:' + k, kind: 'bundle', label: 'B' + ++i, wires: ws });
      else if (withSingles) out.push({ key: 's:' + k, kind: 'single', label: '', wires: ws });
    });
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
  function connInfo(n) {
    const fam = LM.library.family(n.family);
    const cells = [fam.short || fam.name, LM.library.hasHousing(fam) ? (n.gender === 'plug' ? 'plug' : 'receptacle') : '', n.pins + (fam.style === 'flying' ? '-lead' : '-pin')].filter(Boolean);
    return cells;
  }
  function pinLabel(h, n, p) {
    const lab = n.pinLabels && n.pinLabels[p];
    if (lab) return lab;
    const w = h.wires.find(x => (x.from.node === n.id && x.from.pin === p) || (x.to.node === n.id && x.to.pin === p));
    return w ? w.signal || '' : '';
  }
  // A small sketch of the connector for its header: the view the drawing prints (the front when it
  // prints both), at most H tall and 64 wide.
  function sketchOf(h, n, H) {
    const v = LM.shapes.face(h, n, LM.shapes.views(n)[0]);
    const k = Math.min(H / v.h, 64 / v.w);
    return { v, k, w: v.w * k, h: v.h * k };
  }
  function sizeConn(h, n) {
    const pins = M.pinList(n);
    const labels = pins.map(p => pinLabel(h, n, p));
    const labW = Math.max(64, ...labels.map(s => tw(s))) + 22;
    const numW = Math.max(26, ...pins.map(p => tw(p))) + 18;
    const info = connInfo(n);
    const infoW = info.reduce((t, s) => t + tw(s) + 20, 0);
    const hasName = !!n.name;
    const sk = sketchOf(h, n, hasName ? 30 : 16);
    const textW = Math.max(tw(n.ref, 13), n.name ? tw(n.name, 11) : 0);
    const headW = textW + 20 + sk.w + 8;
    const w = Math.max(labW + numW, infoW, headW, 150);
    const h0 = G.HEAD + (hasName ? 16 : 0) + G.INFO;
    return { w, h: h0 + pins.length * G.ROW, h0, port0: h0 + G.ROW / 2, labels, info, numW, hasName, sk, textW };
  }
  function boxRows(h, b) {
    return b.wires.map(w => {
      const c = M.colorInfo(w.color);
      const tags = (h.groups.filter(g => g.kind !== 'cable' && g.wires.includes(w.id)).map(g => g.label)).join(' ');
      return { w, from: pinRef(h, w.from), to: pinRef(h, w.to), color: c.code || '—', tags };
    });
  }
  function sizeBox(h, A, b) {
    const rows = boxRows(h, b);
    const gauges = [...new Set(b.wires.map(w => w.gauge || ''))];
    const lens = b.wires.map(w => A.wireLen.get(w.id));
    const known = lens.filter(x => x != null);
    let len = lenText(null);
    if (known.length === lens.length && known.length) {
      const lo = Math.min(...known), hi = Math.max(...known);
      len = lo === hi ? lenText(lo) : Math.round(lo) + '–' + Math.round(hi) + ' mm';
    }
    const info = [b.wires.length + 'x', gauges.length === 1 ? gaugeMetric(gauges[0]) || 'gauge not set' : 'mixed gauge', len];
    const note = b.kind === 'cable' ? [b.group.note, b.group.pn].filter(Boolean).join(' · ') : '';
    const colFrom = Math.max(...rows.map(r => tw(r.from))), colTo = Math.max(...rows.map(r => tw(r.to)));
    const colC = Math.max(...rows.map(r => tw(r.color))), colT = Math.max(0, ...rows.map(r => (r.tags ? tw(r.tags, 10.5) : 0)));
    const rowW = colFrom + colC + colTo + 64 + (colT ? colT + 18 : 0);
    // A wire alone: just its label row over the wire, no table.
    if (b.kind === 'single') {
      const rb = 6 + G.BROW + 6;
      return { w: rowW, h: rb, h0: 6, rowsBot: rb, headY: rb, lead: 0, port0: 6 + G.BROW - 3, rows, info: [], note: '', cols: { from: colFrom, c: colC, to: colTo, t: colT } };
    }
    const infoW = info.reduce((t, s) => t + tw(s) + 20, 0);
    const tg = h.groups.filter(g => g.kind === 'twist' && b.wires.some(w => g.wires.includes(w.id)));
    const oneSet = b.kind === 'bundle' && tg.length === 1 && b.wires.every(w => tg[0].wires.includes(w.id));
    const lead = tg.length && !oneSet ? LEAD : 0;
    const w = Math.max(rowW + lead + 2 * BOX_END[b.kind], infoW, note ? tw(note, 11) + 20 : 0, 180);
    // A cable: label table, note, then the wire rows. A bundle: the wire rows, then the table.
    const table = G.HEAD + G.INFO;
    const h0 = 6;
    // A cable's sheath leaves as much room under its last wire as over its first.
    const rowsBot = h0 + rows.length * G.BROW + (b.kind === 'cable' ? 14 : 6);
    const headY = rowsBot;
    return { w, h: rowsBot + table + (note ? NOTE_H : 0), h0, rowsBot, headY, lead, port0: h0 + G.BROW - 3, rows, info, note, cols: { from: colFrom, c: colC, to: colTo, t: colT } };
  }

  function layout(h, A) {
    A = A || M.analyze(h);
    const boxes = boxesOf(h, A, true);
    const R = ranks(h, boxes);
    const items = [];
    const itemOf = new Map();
    const place = h.place || {};
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
    const SP_W = 64;
    const spliceSize = n => {
      const S = sides.get(n.id), k = Math.max(1, S.l.length, S.r.length);
      return { w: SP_W, h: 10 + k * PITCH, h0: 0, port0: 15, k };
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
        if (i >= 0) return { side: k, i, off: Math.floor((Math.max(1, S.l.length, S.r.length) - S[k].length) / 2) };
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
      if (it.kind === 'splice') { const pt = portOf(e); return it.y + it.sz.port0 + PITCH * (pt ? pt.off + pt.i : 0); }
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
        if (it.kind === 'box') ys = it.b.wires.map(w => [w.from, w.to].map(endY).find(y => y != null)).filter(y => y != null);
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
        const want = it.bary == null ? bottom + G.GAP_Y : it.bary - it.h / 2;
        it.y = isFinite(bottom) ? Math.max(bottom + G.GAP_Y, want) : (it.bary == null ? 0 : want);
        it.y = onPitch(it);
        bottom = it.y + it.h;
        if (it.kind === 'box') {
          // Order the rows by the height of their first placed end.
          const yOf = w => { const y = [w.from, w.to].map(endY).find(v => v != null); return y == null ? Infinity : y; };
          const order = it.sz.rows.slice().sort((a, b) => yOf(a.w) - yOf(b.w) || a.w.no - b.w.no);
          it.sz.rows = order;
          order.forEach((r, i) => boxRowY.set(r.w.id, rowY(it, i)));
        }
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
        i.x = p.x; i.y = p.y + (i.kind === 'box' ? tableShift(i.b, i.sz, p) : 0); i.placed = true;
      }
    });
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
    if (items.some(i => i.placed) || sides.size) boxes.forEach(b => {
      const it = b.item, cx = it.x + it.w / 2;
      const yOf = w => { const e = [w.from, w.to].map(x => ({ e: x, it: itemOf.get(x.node) })).filter(o => o.it).sort((a, c) => Math.abs(a.it.x - cx) - Math.abs(c.it.x - cx))[0]; return e ? endY(e.e) : 0; };
      it.sz.rows.sort((a, c) => yOf(a.w) - yOf(c.w) || a.w.no - c.w.no);
    });
    boxes.forEach(b => b.item.sz.rows.forEach((r, i) => boxRowY.set(r.w.id, rowY(b.item, i))));

    // Twisted wires twist together inside their box: any run of two or more wires of one twist
    // group on neighboring rows of the same box (a pair, three motor wires…). A wire of the group on
    // a row apart from the rest stays straight.
    const twistOf = new Map();
    h.groups.filter(g => g.kind === 'twist').forEach(g => boxes.forEach(b => {
      const rows = b.item.sz.rows, runs = [];
      rows.forEach((r, i) => {
        if (!g.wires.includes(r.w.id) || twistOf.has(r.w.id)) return;
        const last = runs[runs.length - 1];
        if (last && last.end === i - 1) { last.ws.push(r.w); last.end = i; } else runs.push({ ws: [r.w], end: i });
      });
      runs.filter(run => run.ws.length > 1).forEach(run => run.ws.forEach((w, i) => twistOf.set(w.id, { ws: run.ws, i })));
    }));
    // A bundle that is nothing but one twisted set needs no bands: the twist holds it together.
    boxes.forEach(b => {
      const t = twistOf.get(b.wires[0].id);
      b.twistOnly = b.kind === 'bundle' && !!t && t.ws.length === b.wires.length;
    });

    // Anchors: a pin row's edge facing the other end.
    function anchor(e, towardX) {
      const it = itemOf.get(e.node);
      if (!it) return { x: 0, y: 0 };
      if (it.kind === 'loose') return { x: it.x, y: it.y };
      if (it.kind === 'splice') { const pt = portOf(e); if (pt) return { x: pt.side === 'l' ? it.x : it.x + it.w, y: endY(e) }; }
      const right = towardX > it.x + it.w / 2;
      return { x: right ? it.x + it.w : it.x, y: endY(e) };
    }
    // Where a wire meets its box: its box, its ends and the points it enters and leaves by, each on
    // the side facing that end.
    function entry(w) {
      const b = boxes.find(bx => bx.wires.includes(w));
      if (!b) return null;
      const it = b.item, y = boxRowY.get(w.id);
      const [l, r] = leftFirst(w);
      const lit = itemOf.get(l.node), rit = itemOf.get(r.node);
      const lIn = { x: lit.x + lit.w / 2 < it.x ? it.x : it.x + it.w, y };
      const rIn = { x: rit.x + rit.w / 2 > it.x + it.w ? it.x + it.w : it.x, y };
      return { b, it, l, r, lIn, rIn };
    }
    const curve = (p, q) => { const dx = Math.max(30, Math.abs(q.x - p.x) * 0.5); const s = q.x > p.x ? 1 : -1; return `C${f(p.x + s * dx)} ${f(p.y)} ${f(q.x - s * dx)} ${f(q.y)} ${f(q.x)} ${f(q.y)}`; };
    const whichOf = (w, e) => (e === w.from ? 'from' : 'to');
    // A wire's path, plus its two ends (where each meets its pin, port or loose end) for the drag
    // handles. A wire with a loose end curves straight to it.
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
      const { b, it, l, r, lIn, rIn } = e;
      const segs = [];
      const L0 = anchor(l, it.x + it.w / 2), R0 = anchor(r, it.x + it.w / 2);
      segs.push(`M${f(L0.x)} ${f(L0.y)}`, curve(L0, lIn));
      const tw = twist(w, b, lIn, rIn);
      segs.push(tw ? tw.d : `L${f(rIn.x)} ${f(rIn.y)}`, curve(rIn, R0));
      return { d: segs.join(''), over: tw ? tw.over : [], ends: [{ which: whichOf(w, l), at: L0, e: l }, { which: whichOf(w, r), at: R0, e: r }] };
    }
    // A twisted wire's run through its box, drawn as a helix seen from the side: past the box's ends
    // (the sheath's caps or the bundle's bands) every wire of the set swings across the set's rows,
    // a whole number of turns of about TURN × (wires) units, each wire a 1/n turn behind the next.
    // It eases from its own row into the helix and back out, so it leaves on its own row. `over`
    // holds the stretches on the near side of the helix, drawn on top of the others, so the wires
    // alternate over and under where they cross.
    const TURN = 40;
    // The stretch a twisted wire twists along, or null when it runs straight.
    function twistSpan(w, b, lIn, rIn) {
      const t = twistOf.get(w.id);
      if (!t || Math.abs(rIn.x - lIn.x) < 1) return null;
      const dir = rIn.x > lIn.x ? 1 : -1, pad = b.twistOnly ? 8 : BOX_END[b.kind] + 6;
      const xa = lIn.x + dir * pad, xb = rIn.x - dir * pad, run = Math.abs(xb - xa), n = t.ws.length;
      return run < TURN * n * 0.6 ? null : { t, dir, xa, xb, run, n };
    }
    // Where a twisted wire's twist starts on the left, for the leader line from its row's text.
    function twistStart(w) {
      const e = entry(w), s = e && twistSpan(w, e.b, e.lIn, e.rIn);
      return s ? { x: Math.min(s.xa, s.xb), y: e.lIn.y } : null;
    }
    function twist(w, b, lIn, rIn) {
      const s = twistSpan(w, b, lIn, rIn);
      if (!s) return null;
      const { t, dir, xa, xb, run, n } = s;
      const turns = Math.max(1, Math.round(run / (TURN * n)));
      const ys = t.ws.map(x => boxRowY.get(x.id)), lo = Math.min(...ys), hi = Math.max(...ys);
      // The ease (smoothstep, level at both ends) takes about half a turn, so the wire leaves the
      // straight part and joins the helix without a kink.
      const c = (lo + hi) / 2, A = (hi - lo) / 2, y0 = lIn.y, ease = Math.min(TURN * n / 2, run / 4);
      const phase = Math.PI - 2 * Math.PI * t.i / n;
      const steps = Math.max(24, Math.ceil(run / 3));
      const pts = [];
      for (let k = 0; k <= steps; k++) {
        const u = k / steps, th = phase + 2 * Math.PI * turns * u, dx = u * run;
        const e = Math.min(1, dx / ease, (run - dx) / ease), m = e * e * (3 - 2 * e);
        pts.push({ x: xa + dir * dx, y: y0 + (c + A * Math.cos(th) - y0) * m, front: Math.sin(th) > 0 && m > 0.5 });
      }
      let d = `L${f(xa)} ${f(y0)}`;
      pts.forEach(p => { d += `L${f(p.x)} ${f(p.y)}`; });
      const over = [];
      let cur = null;
      pts.forEach((p, k) => {
        if (p.front) { if (!cur) { cur = `M${f(pts[Math.max(0, k - 1)].x)} ${f(pts[Math.max(0, k - 1)].y)}`; } cur += `L${f(p.x)} ${f(p.y)}`; }
        else if (cur) { over.push(cur); cur = null; }
      });
      if (cur) over.push(cur);
      return { d: d + `L${f(rIn.x)} ${f(rIn.y)}`, over };
    }
    const box = { x0: Math.min(0, ...items.map(i => i.x)), y0: Math.min(0, ...items.map(i => i.y)),
      x1: Math.max(200, ...items.map(i => i.x + i.w)), y1: Math.max(120, ...items.map(i => i.y + i.h)) };
    // The wires on each side of a splice, in port order (for drawing and for drops).
    const portsOf = id => { const S = sides.get(id); return S ? { l: S.l.slice(), r: S.r.slice() } : { l: [], r: [] }; };
    return { items, itemOf, boxes, wirePath, twistStart, anchor, endY, portsOf, portOf, box };
  }

  // ── SVG ───────────────────────────────────────────────────────────────────
  // The half twists a twisted wire crosses on top of, drawn after every wire (no hit area).
  function overSvg(w, ds, cls) {
    const c = M.colorInfo(w.color);
    return ds.map(d => `<g class="w w-over${c.base ? '' : ' nocolor'}${cls || ''}"><path class="w-edge" d="${d}"/>` +
      `<path class="w-base" style="stroke:${c.base || '#9a9aa0'}" d="${d}"/>` +
      (c.stripe ? `<path class="w-stripe" style="stroke:${c.stripe}" d="${d}"/>` : '') + '</g>').join('');
  }
  function wireSvg(w, d, cls) {
    const c = M.colorInfo(w.color);
    return `<g class="w${c.base ? '' : ' nocolor'}${cls || ''}" data-wire="${w.id}"><path class="w-hit" d="${d}"/><path class="w-edge" d="${d}"/>` +
      `<path class="w-base" style="stroke:${c.base || '#9a9aa0'}" d="${d}"/>` +
      (c.stripe ? `<path class="w-stripe" style="stroke:${c.stripe}" d="${d}"/>` : '') + '</g>';
  }
  const cellRow = (x, y, w, hh, cells, cls) => {
    const tot = cells.reduce((t, s) => t + tw(s) + 20, 0);
    let o = '', cx = x;
    cells.forEach((s, i) => {
      const cw = i === cells.length - 1 ? x + w - cx : (tw(s) + 20) / tot * w;
      o += `<rect class="cv-cell" x="${f(cx)}" y="${f(y)}" width="${f(cw)}" height="${hh}"/>` +
        `<text class="${cls}" x="${f(cx + cw / 2)}" y="${f(y + hh / 2 + 4)}" text-anchor="middle">${esc(s)}</text>`;
      cx += cw;
    });
    return o;
  };

  // What a selection is about: its wires, the ends they join, and the selected ends themselves.
  // Everything else is dimmed on the canvas. No dimming while a wire is being drawn, so every pin
  // stays easy to pick.
  function focusOf(h, sel, pending) {
    if (!sel || pending) return null;
    const ids = sel.ids, wires = new Set(), nodes = new Set(), picked = new Set();
    if (sel.kind === 'wire') ids.forEach(id => wires.add(id));
    else if (sel.kind === 'node') { ids.forEach(id => { picked.add(id); nodes.add(id); }); h.wires.forEach(w => { if (ids.has(w.from.node) || ids.has(w.to.node)) wires.add(w.id); }); }
    else if (sel.kind === 'group') h.groups.forEach(g => { if (ids.has(g.id)) g.wires.forEach(id => wires.add(id)); });
    else return null;
    h.wires.forEach(w => { if (wires.has(w.id)) { nodes.add(w.from.node); nodes.add(w.to.node); } });
    const pins = new Set();
    h.wires.forEach(w => { if (wires.has(w.id)) [w.from, w.to].forEach(e => pins.add(e.node + '|' + e.pin)); });
    return { wires, nodes, picked, pins };
  }
  const dimIf = c => (c ? ' dim' : '');

  function connSvg(h, it, opts, Lo) {
    const n = it.n, sz = it.sz, x = it.x, y = it.y, w = it.w, F = opts.focus;
    const sel = opts.sel && opts.sel.kind === 'node' && opts.sel.ids.has(n.id);
    const pinDim = p => !!F && F.nodes.has(n.id) && !F.picked.has(n.id) && !F.pins.has(n.id + '|' + p);
    // Pin numbers go on the side the wires leave from.
    const toRight = h.wires.some(wr => { const o = wr.from.node === n.id ? wr.to : wr.to.node === n.id ? wr.from : null; if (!o) return false; const ot = Lo.itemOf.get(o.node); return ot && ot.x > x; });
    const toLeft = h.wires.some(wr => { const o = wr.from.node === n.id ? wr.to : wr.to.node === n.id ? wr.from : null; if (!o) return false; const ot = Lo.itemOf.get(o.node); return ot && ot.x < x; });
    const numRight = toRight || !toLeft;
    let o = `<g class="cv-conn${sel ? ' sel' : ''}${dimIf(F && !F.nodes.has(n.id))}" data-node="${n.id}" data-item="${it.key}">`;
    o += `<rect class="cv-bg" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(it.h)}"/>`;
    const hh = G.HEAD + (sz.hasName ? 16 : 0);
    // The sketch sits left of the ref (and name), and the pair is centered in the header.
    const sk = sz.sk, textW = Math.min(sz.textW, w - 16 - sk.w - 8);
    const sx = x + (w - (sk.w + 8 + textW)) / 2, tx = sx + sk.w + 8 + textW / 2;
    o += `<g class="cv-head" data-head="${n.id}"><rect class="cv-cell cv-headbg" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${hh}"/>` +
      `<g class="cv-sketch" style="stroke-width:${f(0.9 / sk.k)}" transform="translate(${f(sx + sk.v.ox * sk.k)} ${f(y + (hh - sk.h) / 2)}) scale(${f(sk.k * 1000) / 1000})">${sk.v.svg}</g>` +
      `<text class="cv-ref" x="${f(tx)}" y="${f(y + 16)}" text-anchor="middle">${esc(n.ref)}</text>` +
      (sz.hasName ? `<text class="cv-name" x="${f(tx)}" y="${f(y + 32)}" text-anchor="middle">${esc(U.clip(n.name, 11, textW + 4))}</text>` : '') + '</g>';
    o += cellRow(x, y + hh, w, G.INFO, sz.info, 'cv-t');
    const numX = numRight ? x + w - sz.numW : x;
    const labX = numRight ? x : x + sz.numW;
    M.pinList(n).forEach((p, i) => {
      const ry = y + sz.h0 + i * G.ROW;
      const pend = opts.pending && opts.pending.node === n.id && opts.pending.pin === p;
      const used = h.wires.some(wr => (wr.from.node === n.id && wr.from.pin === p) || (wr.to.node === n.id && wr.to.pin === p));
      o += `<g class="cv-pin${pend ? ' pend' : ''}${used ? ' used' : ''}${dimIf(pinDim(p))}" data-node="${n.id}" data-pin="${esc(p)}">` +
        `<rect class="cv-cell cv-pinrow" x="${f(x)}" y="${f(ry)}" width="${f(w)}" height="${G.ROW}"/>` +
        `<line class="cv-rule" x1="${f(numRight ? numX : labX)}" x2="${f(numRight ? numX : labX)}" y1="${f(ry)}" y2="${f(ry + G.ROW)}"/>` +
        `<text class="cv-t" x="${f(labX + (w - sz.numW) / 2)}" y="${f(ry + G.ROW / 2 + 4)}" text-anchor="middle">${esc(sz.labels[i])}</text>` +
        `<text class="cv-t cv-num" x="${f(numX + sz.numW / 2)}" y="${f(ry + G.ROW / 2 + 4)}" text-anchor="middle">${esc(p)}</text></g>`;
    });
    o += `<rect class="cv-frame" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(it.h)}"/>`;
    return o + '</g>';
  }
  // A splice: a box with a port on its edge for each wire, on the side the wire comes in, and lines
  // inside from the ports on each side to the ref in the middle, where they're joined.
  const PORT_R = 4.5;
  // A bigger, invisible circle around each end's dot on the canvas, so it's easy to grab.
  const hitEnd = (x, y, id, which, opts) => (opts.sheet ? '' : `<circle class="cv-hitend" cx="${f(x)}" cy="${f(y)}" r="9" data-end="${id}|${which}" data-wire="${id}"/>`);
  function spliceSvg(it, opts, Lo) {
    const n = it.n, sel = opts.sel && opts.sel.kind === 'node' && opts.sel.ids.has(n.id);
    const x = it.x, y = it.y, w = it.w, cx = x + w / 2, cy = y + it.h / 2, half = Math.max(9, tw(n.ref, 13) / 2) + 5;
    const P = Lo.portsOf(n.id), F = opts.focus;
    let lines = '', ports = '';
    ['l', 'r'].forEach(k => P[k].forEach(wr => {
      const e = wr.from.node === n.id ? wr.from : wr.to, py = Lo.endY(e), px = k === 'l' ? x : x + w;
      const hx = k === 'l' ? cx - half : cx + half, dim = dimIf(F && !F.wires.has(wr.id));
      lines += `<path class="cv-sp-line${dim}" d="M${f(px)} ${f(py)}C${f((px + hx) / 2)} ${f(py)} ${f((px + hx) / 2)} ${f(cy)} ${f(hx)} ${f(cy)}"/>`;
      ports += `<circle class="cv-port${dim}" cx="${f(px)}" cy="${f(py)}" r="${PORT_R}" data-end="${wr.id}|${e === wr.from ? 'from' : 'to'}" data-wire="${wr.id}"/>` +
        hitEnd(px, py, wr.id, e === wr.from ? 'from' : 'to', opts);
    }));
    return `<g class="cv-splice${sel ? ' sel' : ''}${opts.pending ? ' target' : ''}${opts.drop === n.id ? ' drop' : ''}${dimIf(F && !F.nodes.has(n.id))}" data-node="${n.id}" data-item="${it.key}"><rect class="cv-bg" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(it.h)}" rx="6"/>` +
      `<rect class="cv-frame" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(it.h)}" rx="6"/>` + lines +
      `<text class="cv-ref" x="${f(cx)}" y="${f(cy + 4.5)}" text-anchor="middle">${esc(n.ref)}</text>${ports}</g>`;
  }
  // A loose end's dot, which drags like a port.
  const looseSvg = (it, w, which, cls) => `<circle class="cv-port cv-loose${cls}" cx="${f(it.x)}" cy="${f(it.y)}" r="${PORT_R}" data-end="${w.id}|${which}" data-wire="${w.id}"/>`;
  function boxBack(it, opts) {
    const b = it.b, sel = boxSel(it, opts);
    return `<rect class="cv-box${b.kind === 'cable' ? ' cable' : ''}${sel ? ' sel' : ''}${dimIf(boxDim(it, opts))}" x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}"/>` +
      lacing(it, opts, 'back') + sheathFace(it, opts);
  }
  // A cable's sheath is a cylinder. Its cut end on the right is a full ellipse, lighter, drawn under
  // the wires so they come out of it; the jacket (holder) is drawn over them and stops at the
  // ellipse's near rim.
  function sheathGeom(it) {
    const top = it.y + it.sz.h0 + 2, hh = it.sz.rowsBot - it.sz.h0 - 4;
    return { x: it.x, w: it.w, top, bot: top + hh, rx: Math.min(14, hh / 2), ry: hh / 2 };
  }
  function sheathFace(it, opts) {
    if (it.b.kind !== 'cable') return '';
    const g = sheathGeom(it), cls = (boxSel(it, opts) ? ' sel' : '') + dimIf(boxDim(it, opts));
    return `<ellipse class="cv-sheath-face${cls}" cx="${f(g.x + g.w - g.rx)}" cy="${f(g.top + g.ry)}" rx="${f(g.rx)}" ry="${f(g.ry)}"/>`;
  }
  // A bundle of more than two wires (not a cable, not one twisted set) is laced: at each end a tie
  // loops around the wires, a little lens tied off in a knot at the top with two short tails. Its
  // far side runs behind the wires (part 'back', drawn under them) and its near side, knot and
  // tails in front, so it reads as wrapped round them.
  const laced = b => b.kind === 'bundle' && !b.twistOnly && b.wires.length > 2;
  function lacing(it, opts, part) {
    if (!laced(it.b)) return '';
    const cls = (boxSel(it, opts) ? ' sel' : '') + dimIf(boxDim(it, opts));
    const top = it.y + it.sz.h0 + 5, bot = it.y + it.sz.rowsBot - 5, H = bot - top, c = BOX_END.bundle / 2;
    return [it.x + c, it.x + it.w - c].map(kx => {
      const bx = kx - 2;
      if (part === 'back') return `<path class="cv-lace${cls}" d="M${f(kx)} ${f(top)}C${f(kx + 9)} ${f(top + H * 0.25)} ${f(bx + 8)} ${f(bot - H * 0.3)} ${f(bx)} ${f(bot)}"/>`;
      return `<g class="cv-lace${cls}"><path d="M${f(kx)} ${f(top)}C${f(kx - 10)} ${f(top + H * 0.3)} ${f(bx - 9)} ${f(bot - H * 0.25)} ${f(bx)} ${f(bot)}"/>` +
        `<path d="M${f(kx - 1)} ${f(top - 1)}Q${f(kx - 4)} ${f(top - 6)} ${f(kx - 7)} ${f(top - 8)}M${f(kx + 1.5)} ${f(top - 1.5)}Q${f(kx + 5)} ${f(top - 5)} ${f(kx + 9)} ${f(top - 5.5)}"/>` +
        `<circle class="cv-lace-knot" cx="${f(kx)}" cy="${f(top)}" r="2.4"/></g>`;
    }).join('');
  }
  const boxDim = (it, opts) => !!opts.focus && !it.b.wires.some(w => opts.focus.wires.has(w.id));
  // Over the wires, the rows get a picture of what holds them: a cable's sheath, dark and see-through
  // with rounded ends where the wires come out, or a bundle's shrink-tube bands at each end.
  function holder(it, opts) {
    const b = it.b, x = it.x, w = it.w, top = it.y + it.sz.h0, bot = it.y + it.sz.rowsBot;
    const cls = (boxSel(it, opts) ? ' sel' : '') + dimIf(boxDim(it, opts));
    if (b.kind === 'cable') {
      // The jacket: a rounded far end on the left, and on the right it stops at the near half of
      // the cut end's ellipse (sheathFace, under the wires).
      const g = sheathGeom(it), cx = g.x + g.w - g.rx, lx = g.x + g.rx;
      return `<path class="cv-sheath${cls}" d="M${f(lx)} ${f(g.top)}H${f(cx)}A${f(g.rx)} ${f(g.ry)} 0 0 0 ${f(cx)} ${f(g.bot)}H${f(lx)}A${f(g.rx)} ${f(g.ry)} 0 0 1 ${f(lx)} ${f(g.top)}Z"/>`;
    }
    if (b.twistOnly) return '';
    if (laced(b)) return lacing(it, opts, 'front');
    const bw = 13, inset = (BOX_END.bundle - bw) / 2, hh = bot - top - 4;
    return [x + inset, x + w - inset - bw].map(bx =>
      `<g class="cv-band${cls}"><rect x="${f(bx)}" y="${f(top + 3)}" width="${bw}" height="${f(hh - 2)}" rx="3"/>` +
      `<line x1="${f(bx + 3.5)}" x2="${f(bx + 3.5)}" y1="${f(top + 7)}" y2="${f(top + hh - 3)}"/></g>`).join('');
  }
  const boxSel = (it, opts) => { const b = it.b, sel = opts.sel; return !!sel && ((sel.kind === 'group' && b.group && sel.ids.has(b.group.id)) || (sel.kind === 'wire' && b.wires.every(w => sel.ids.has(w.id)))); };
  function boxFront(it, opts, Lo) {
    const b = it.b, sz = it.sz, x = it.x, y = it.y, w = it.w, F = opts.focus, bd = dimIf(boxDim(it, opts));
    const ty0 = y + sz.headY;
    let o = '';
    if (b.kind !== 'single') {
    o += holder(it, opts);
    o += `<g class="cv-boxg${bd}" data-box="${esc(b.key)}"><rect class="cv-bg" x="${f(x)}" y="${f(ty0)}" width="${f(w)}" height="${G.HEAD + G.INFO}"/>` +
      `<rect class="cv-cell cv-headbg" x="${f(x)}" y="${f(ty0)}" width="${f(w)}" height="${G.HEAD}"/>` +
      `<text class="cv-ref" x="${f(x + w / 2)}" y="${f(ty0 + 16)}" text-anchor="middle">${esc(b.label)}</text>`;
    o += cellRow(x, ty0 + G.HEAD, w, G.INFO, sz.info, 'cv-t');
    o += `<rect class="cv-frame${boxSel(it, opts) ? ' sel' : ''}" x="${f(x)}" y="${f(ty0)}" width="${f(w)}" height="${G.HEAD + G.INFO}"/></g>`;
    if (sz.note) o += `<text class="cv-name cv-halo${bd}" x="${f(x + w / 2)}" y="${f(ty0 + G.HEAD + G.INFO + 13)}" text-anchor="middle">${esc(U.clip(sz.note, 11, w - 16))}</text>`;
    }
    const c = sz.cols, inner = c.from + c.c + c.to + 40 + (c.t ? c.t + 18 : 0);
    const x0 = x + (w - inner + sz.lead) / 2;
    sz.rows.forEach((r, i) => {
      // The text sits above the wire, which runs near the bottom of its row (sz.port0). A twisted
      // wire gets a leader from the text's left to where its twist starts, since the twist runs
      // under the other rows' text.
      const top = y + sz.h0 + i * G.BROW, ty = top + 12;
      const ts = Lo && Lo.twistStart(r.w);
      const lead = ts && x0 - 4 > ts.x + 4 ? `<path class="cv-lead" d="M${f(x0 - 4)} ${f(ty - 4)}L${f(ts.x)} ${f(ts.y - 2.6)}"/>` : '';
      o += `<g class="cv-wrow${dimIf(F && !F.wires.has(r.w.id))}" data-wire="${r.w.id}"><rect class="cv-hit" x="${f(x)}" y="${f(top)}" width="${f(w)}" height="${G.BROW}"/>` + lead +
        `<text class="cv-t" x="${f(x0)}" y="${f(ty)}">${esc(r.from)}</text>` +
        `<text class="cv-t" x="${f(x0 + c.from + 20 + c.c / 2)}" y="${f(ty)}" text-anchor="middle">${esc(r.color)}</text>` +
        `<text class="cv-t" x="${f(x0 + c.from + c.c + 40)}" y="${f(ty)}">${esc(r.to)}</text>` +
        (r.tags ? `<text class="cv-tag" x="${f(x0 + inner)}" y="${f(ty)}" text-anchor="end">${esc(r.tags)}</text>` : '') + '</g>';
    });
    return o;
  }

  function render(h, A, opts) {
    opts = opts || {};
    A = A || M.analyze(h);
    const Lo = layout(h, A);
    opts = Object.assign({}, opts, { focus: focusOf(h, opts.sel, opts.pending) });
    let backs = '', wires = '', overs = '', fronts = '', ends = '';
    Lo.items.forEach(it => {
      if (it.kind === 'box') {
        if (it.b.kind !== 'single') backs += boxBack(it, opts);
        fronts += `<g data-item="${esc(it.key)}">${boxFront(it, opts, Lo)}</g>`;
      }
      else if (it.kind === 'conn') ends += connSvg(h, it, opts, Lo);
      else if (it.kind === 'splice') ends += spliceSvg(it, opts, Lo);
    });
    // Every wire end has a dot to drag it by: a splice's ports and loose ends (drawn and printed
    // with them), and a small dot where it meets a pin (canvas only).
    let dots = '';
    h.wires.slice().sort((a, b) => a.no - b.no).forEach(w => {
      const p = Lo.wirePath(w);
      if (!p) return;
      const cls = (opts.sel && opts.sel.kind === 'wire' && opts.sel.ids.has(w.id) ? ' sel' : '') + dimIf(opts.focus && !opts.focus.wires.has(w.id));
      wires += wireSvg(w, p.d, cls);
      overs += overSvg(w, p.over, cls);
      p.ends.forEach(en => {
        const it = Lo.itemOf.get(en.e.node);
        if (!it) return;
        if (it.kind === 'loose') dots += looseSvg(it, w, en.which, dimIf(opts.focus && !opts.focus.wires.has(w.id))) + hitEnd(it.x, it.y, w.id, en.which, opts);
        else if (it.kind === 'conn' && !opts.sheet) dots += `<circle class="cv-end${dimIf(opts.focus && !opts.focus.wires.has(w.id))}" cx="${f(en.at.x)}" cy="${f(en.at.y)}" r="3.4" data-end="${w.id}|${en.which}" data-wire="${w.id}"/>` + hitEnd(en.at.x, en.at.y, w.id, en.which, opts);
      });
    });
    return { svg: backs + wires + overs + fronts + ends + dots, box: Lo.box, layout: Lo };
  }

  LM.conn = { G, layout, render, boxesOf, pinLabel };
})(window.LM = window.LM || {});
