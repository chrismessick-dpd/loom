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
  const f = v => Math.round(v * 10) / 10;
  const tw = (s, size) => U.textW(s, size || G.FS);

  const pinRef = (h, e) => { const n = M.node(h, e.node); return M.label(n) + (e.pin && M.isConn(n) ? ':' + e.pin : ''); };
  const gaugeMetric = g => (g ? (M.AWG[g] ? M.AWG[g] + ' mm² (' + g + ' AWG)' : g + ' AWG') : '');
  const lenText = mm => (mm == null ? 'length not set' : Math.round(mm) + ' mm');

  // The boxes: cables first, then bundles by end pair, in wire order.
  function boxesOf(h, A) {
    const out = [], taken = new Set();
    h.groups.filter(g => g.kind === 'cable').forEach(g => {
      const ws = g.wires.map(id => M.wire(h, id)).filter(Boolean);
      if (!ws.length) return;
      ws.forEach(w => taken.add(w.id));
      out.push({ key: 'g:' + g.id, kind: 'cable', group: g, label: g.label, wires: ws });
    });
    const pairs = new Map();
    h.wires.slice().sort((a, b) => a.no - b.no).forEach(w => {
      if (taken.has(w.id)) return;
      const k = [w.from.node, w.to.node].sort().join('|');
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push(w);
    });
    let i = 0;
    pairs.forEach((ws, k) => out.push({ key: 'p:' + k, kind: 'bundle', label: 'B' + ++i, wires: ws }));
    return out;
  }

  // Columns: breadth-first distance from the busiest connector orients each joined pair, then each end
  // goes one column past the furthest end that feeds it.
  function ranks(h, boxes) {
    const nodes = h.nodes.filter(n => M.isConn(n) || n.kind === 'splice');
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
  function sizeConn(h, n) {
    const pins = M.pinList(n);
    const labels = pins.map(p => pinLabel(h, n, p));
    const labW = Math.max(64, ...labels.map(s => tw(s))) + 22;
    const numW = Math.max(26, ...pins.map(p => tw(p))) + 18;
    const info = connInfo(n);
    const infoW = info.reduce((t, s) => t + tw(s) + 20, 0);
    const headW = Math.max(tw(n.ref, 13) + 20, n.name ? tw(n.name, 11) + 20 : 0);
    const w = Math.max(labW + numW, infoW, headW, 150);
    const hasName = !!n.name;
    const h0 = G.HEAD + (hasName ? 16 : 0) + G.INFO;
    return { w, h: h0 + pins.length * G.ROW, h0, port0: h0 + G.ROW / 2, labels, info, numW, hasName };
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
    const infoW = info.reduce((t, s) => t + tw(s) + 20, 0);
    const w = Math.max(rowW, infoW, note ? tw(note, 11) + 20 : 0, 180);
    const h0 = G.HEAD + G.INFO + (note ? 18 : 0);
    return { w, h: h0 + rows.length * G.BROW + 6, h0, port0: h0 + G.BROW - 3, rows, info, note, cols: { from: colFrom, c: colC, to: colTo, t: colT } };
  }

  function layout(h, A) {
    A = A || M.analyze(h);
    const boxes = boxesOf(h, A);
    const R = ranks(h, boxes);
    const items = [];
    const itemOf = new Map();
    h.nodes.filter(n => M.isConn(n) || n.kind === 'splice').forEach(n => {
      const sz = M.isConn(n) ? sizeConn(h, n) : { w: 46, h: 30, h0: 0, port0: 15 };
      const it = { kind: M.isConn(n) ? 'conn' : 'splice', n, col: R.rank.get(n.id) * 2, sz };
      items.push(it); itemOf.set(n.id, it);
    });
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
      if (it.kind === 'splice') return it.y + it.h / 2;
      return it.y + it.sz.h0 + G.ROW * (pinIdx(it.n, e.pin) + 0.5);
    };
    const rowY = (it, i) => it.y + it.sz.port0 + G.BROW * i;
    // Auto-placed parts sit with their ports on the pitch, like dragged ones on the grid.
    const onPitch = it => Math.round((it.y + it.sz.port0) / PITCH) * PITCH - it.sz.port0;
    const boxRowY = new Map();
    cols.forEach((list, c) => {
      list.forEach(it => {
        let ys = [];
        if (it.kind === 'box') ys = it.b.wires.map(w => [w.from, w.to].map(endY).find(y => y != null)).filter(y => y != null);
        else boxes.forEach(b => b.wires.forEach(w => {
          if (w.from.node !== it.n.id && w.to.node !== it.n.id) return;
          const y = boxRowY.get(w.id);
          if (y != null) ys.push(y);
        }));
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
    const place = h.place || {};
    items.forEach(i => {
      i.key = i.kind === 'box' ? 'b:' + i.b.key : 'n:' + i.n.id;
      const p = place[i.key];
      if (p && isFinite(p.x) && isFinite(p.y)) { i.x = p.x; i.y = p.y; i.placed = true; }
    });
    if (items.some(i => i.placed)) boxes.forEach(b => {
      const it = b.item, cx = it.x + it.w / 2;
      const yOf = w => { const e = [w.from, w.to].map(x => ({ e: x, it: itemOf.get(x.node) })).filter(o => o.it).sort((a, c) => Math.abs(a.it.x - cx) - Math.abs(c.it.x - cx))[0]; return e ? endY(e.e) : 0; };
      it.sz.rows.sort((a, c) => yOf(a.w) - yOf(c.w) || a.w.no - c.w.no);
    });
    boxes.forEach(b => b.item.sz.rows.forEach((r, i) => boxRowY.set(r.w.id, rowY(b.item, i))));

    // Anchors: a pin row's edge facing the other end.
    function anchor(e, towardX) {
      const it = itemOf.get(e.node);
      if (!it) return { x: 0, y: 0 };
      const right = towardX > it.x + it.w / 2;
      return { x: right ? it.x + it.w : it.x, y: endY(e) };
    }
    function wirePath(w) {
      const b = boxes.find(bx => bx.wires.includes(w));
      if (!b) return '';
      const it = b.item, y = boxRowY.get(w.id);
      const [l, r] = leftFirst(w);
      const segs = [];
      const curve = (p, q) => { const dx = Math.max(30, Math.abs(q.x - p.x) * 0.5); const s = q.x > p.x ? 1 : -1; return `C${f(p.x + s * dx)} ${f(p.y)} ${f(q.x - s * dx)} ${f(q.y)} ${f(q.x)} ${f(q.y)}`; };
      const lit = itemOf.get(l.node), rit = itemOf.get(r.node);
      const L0 = anchor(l, it.x + it.w / 2), R0 = anchor(r, it.x + it.w / 2);
      // Enter on the side facing each end.
      const lIn = { x: lit.x + lit.w / 2 < it.x ? it.x : it.x + it.w, y };
      const rIn = { x: rit.x + rit.w / 2 > it.x + it.w ? it.x + it.w : it.x, y };
      segs.push(`M${f(L0.x)} ${f(L0.y)}`, curve(L0, lIn), `L${f(rIn.x)} ${f(rIn.y)}`, curve(rIn, R0));
      return segs.join('');
    }
    const box = { x0: Math.min(0, ...items.map(i => i.x)), y0: Math.min(0, ...items.map(i => i.y)),
      x1: Math.max(200, ...items.map(i => i.x + i.w)), y1: Math.max(120, ...items.map(i => i.y + i.h)) };
    return { items, itemOf, boxes, wirePath, anchor, endY, box };
  }

  // ── SVG ───────────────────────────────────────────────────────────────────
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
    o += `<g class="cv-head" data-head="${n.id}"><rect class="cv-cell cv-headbg" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${hh}"/>` +
      `<text class="cv-ref" x="${f(x + w / 2)}" y="${f(y + 16)}" text-anchor="middle">${esc(n.ref)}</text>` +
      (sz.hasName ? `<text class="cv-name" x="${f(x + w / 2)}" y="${f(y + 32)}" text-anchor="middle">${esc(U.clip(n.name, 11, w - 16))}</text>` : '') + '</g>';
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
  function spliceSvg(it, opts) {
    const n = it.n, sel = opts.sel && opts.sel.kind === 'node' && opts.sel.ids.has(n.id);
    return `<g class="cv-splice${sel ? ' sel' : ''}${opts.pending ? ' target' : ''}${dimIf(opts.focus && !opts.focus.nodes.has(n.id))}" data-node="${n.id}" data-item="${it.key}"><rect class="cv-bg" x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}" rx="4"/>` +
      `<rect class="cv-frame" x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}" rx="4"/>` +
      `<text class="cv-ref" x="${f(it.x + it.w / 2)}" y="${f(it.y + it.h / 2 + 4.5)}" text-anchor="middle">${esc(n.ref)}</text></g>`;
  }
  function boxBack(it, opts) {
    const b = it.b;
    const sel = opts.sel && ((opts.sel.kind === 'group' && b.group && opts.sel.ids.has(b.group.id)) ||
      (opts.sel.kind === 'wire' && b.wires.every(w => opts.sel.ids.has(w.id))));
    return `<rect class="cv-box${b.kind === 'cable' ? ' cable' : ''}${sel ? ' sel' : ''}${dimIf(boxDim(it, opts))}" x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}"/>`;
  }
  const boxDim = (it, opts) => !!opts.focus && !it.b.wires.some(w => opts.focus.wires.has(w.id));
  function boxFront(it, opts) {
    const b = it.b, sz = it.sz, x = it.x, y = it.y, w = it.w, F = opts.focus, bd = dimIf(boxDim(it, opts));
    let o = `<g class="cv-boxg${bd}" data-box="${esc(b.key)}"><rect class="cv-cell cv-headbg" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${G.HEAD}"/>` +
      `<text class="cv-ref" x="${f(x + w / 2)}" y="${f(y + 16)}" text-anchor="middle">${esc(b.label)}</text>`;
    o += cellRow(x, y + G.HEAD, w, G.INFO, sz.info, 'cv-t');
    o += '</g>';
    if (sz.note) o += `<text class="cv-name${bd}" x="${f(x + w / 2)}" y="${f(y + G.HEAD + G.INFO + 13)}" text-anchor="middle">${esc(U.clip(sz.note, 11, w - 16))}</text>`;
    const c = sz.cols, inner = c.from + c.c + c.to + 40 + (c.t ? c.t + 18 : 0);
    const x0 = x + (w - inner) / 2;
    sz.rows.forEach((r, i) => {
      // The text sits above the wire, which runs near the bottom of its row (sz.port0).
      const top = y + sz.h0 + i * G.BROW, ty = top + 12;
      o += `<g class="cv-wrow${dimIf(F && !F.wires.has(r.w.id))}" data-wire="${r.w.id}"><rect class="cv-hit" x="${f(x)}" y="${f(top)}" width="${f(w)}" height="${G.BROW}"/>` +
        `<text class="cv-t" x="${f(x0)}" y="${f(ty)}">${esc(r.from)}</text>` +
        `<text class="cv-t" x="${f(x0 + c.from + 20 + c.c / 2)}" y="${f(ty)}" text-anchor="middle">${esc(r.color)}</text>` +
        `<text class="cv-t" x="${f(x0 + c.from + c.c + 40)}" y="${f(ty)}">${esc(r.to)}</text>` +
        (r.tags ? `<text class="cv-tag" x="${f(x0 + inner)}" y="${f(ty)}" text-anchor="end">${esc(r.tags)}</text>` : '') + '</g>';
    });
    o += `<rect class="cv-frame${b.kind === 'cable' ? '' : ' dashed'}${bd}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(it.h)}"/>`;
    return o;
  }

  function render(h, A, opts) {
    opts = opts || {};
    A = A || M.analyze(h);
    const Lo = layout(h, A);
    opts = Object.assign({}, opts, { focus: focusOf(h, opts.sel, opts.pending) });
    let backs = '', wires = '', fronts = '', ends = '';
    Lo.items.forEach(it => {
      if (it.kind === 'box') { backs += boxBack(it, opts); fronts += `<g data-item="${esc(it.key)}">${boxFront(it, opts)}</g>`; }
      else if (it.kind === 'conn') ends += connSvg(h, it, opts, Lo);
      else ends += spliceSvg(it, opts);
    });
    h.wires.slice().sort((a, b) => a.no - b.no).forEach(w => {
      const d = Lo.wirePath(w);
      if (d) wires += wireSvg(w, d, (opts.sel && opts.sel.kind === 'wire' && opts.sel.ids.has(w.id) ? ' sel' : '') + dimIf(opts.focus && !opts.focus.wires.has(w.id)));
    });
    return { svg: backs + wires + fronts + ends, box: Lo.box, layout: Lo };
  }

  LM.conn = { G, layout, render, boxesOf, pinLabel };
})(window.LM = window.LM || {});
