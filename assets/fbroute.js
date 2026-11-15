// Formboard routing (docs/formboard.md). Pure: no page, no store. Channels are polylines with one
// section (w across, h tall); where two touch, a junction joins them. Each cable routes from its first
// end to each other end by the shortest path through the channels it may use (Dijkstra), plus a straight
// drop from each end to the nearest allowed channel. A cable may use a channel when the channel isn't
// exclusive, or when they share a class (Chris, 2026-11-15). No allowed path: Not routed, its straight
// length shown.
//
//   build(channels)                      → the network (reuse it for every cable)
//   route(net, cable, settings)          → { ok, legs, length, parts, flags }
//   routeAll(channels, cables, settings) → { net, results: { <cable id>: route }, fill: { <channel id>: … } }
//   buildLength(parts, settings)         → the build length, rounded up
//
// Units are mm; points are [x, y, z]. A channel: { id, pts, w, h, classes, exclusive, extraPerM }. A cable:
// { id, classes, ends: [{ key, p }], vias: [channel id], pinned, route (kept when pinned), endMm: { key: mm },
// areaMm2 }. Settings: { dropMax, endMm, slackPct, roundMm }.
(function (LM) {
  'use strict';

  const DEF = { dropMax: 300, endMm: 0, slackPct: 0, roundMm: 10 };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const dist = (a, b) => len(sub(a, b));
  const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
  const pt = p => [+p[0] || 0, +p[1] || 0, +p[2] || 0];

  // The nearest point to p on segment a–b: { t, q, d }.
  function onSeg(p, a, b) {
    const ab = sub(b, a), l2 = dot(ab, ab), t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0, q = lerp(a, b, t);
    return { t, q, d: dist(p, q) };
  }
  // The nearest points between segments p1–q1 and p2–q2: { s, t, d } (Ericson, Real-Time Collision Detection 5.1.9).
  function segSeg(p1, q1, p2, q2) {
    const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2), a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
    let s, t;
    if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
    else if (a <= 1e-12) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
    else {
      const c = dot(d1, r);
      if (e <= 1e-12) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else {
        const b = dot(d1, d2), den = a * e - b * b;
        s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
        else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
      }
    }
    return { s, t, d: dist(lerp(p1, q1, s), lerp(p2, q2, t)) };
  }

  function clean(c) {
    const pts = (Array.isArray(c.pts) ? c.pts : []).map(pt).filter((p, i, a) => !i || dist(p, a[i - 1]) > 1e-6);
    return { id: String(c.id), pts, w: Math.max(0, +c.w || 0), h: Math.max(0, +c.h || 0), classes: (c.classes || []).map(String), exclusive: !!c.exclusive, extraPerM: Math.max(0, +c.extraPerM || 0) };
  }

  // The network: nodes (points), edges along channels (each with its channel), and junction edges between
  // two channels (ch: [a, b]). Junctions are derived from the drawing every time, never stored (Chris,
  // 2026-11-15): two channels join where their sections touch, i.e. their centerlines come within half of
  // both widths; crossing clear of each other (one bridging over the other), they stay apart.
  function build(channels) {
    const chans = (channels || []).map(clean).filter(c => c.pts.length >= 2), byId = {};
    chans.forEach(c => { byId[c.id] = c; });
    const segs = [];
    chans.forEach(c => { for (let i = 0; i + 1 < c.pts.length; i++) segs.push({ ch: c, a: c.pts[i], b: c.pts[i + 1], cuts: [0, 1] }); });
    const joins = [];
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i], B = segs[j];
      if (A.ch === B.ch) continue;
      const r = segSeg(A.a, A.b, B.a, B.b);
      if (r.d > (A.ch.w + B.ch.w) / 2 + 1e-6) continue;
      A.cuts.push(r.s); B.cuts.push(r.t);
      joins.push({ A, s: r.s, B, t: r.t, d: r.d });
    }
    // Nodes shared by position within a channel (a polyline's corners) and between channels at a junction.
    const nodes = [], edges = [], key = new Map();
    const node = (ch, p) => {
      const k = ch.id + '|' + p.map(v => v.toFixed(4)).join(',');
      if (!key.has(k)) { key.set(k, nodes.length); nodes.push({ p, ch: ch.id, out: [] }); }
      return key.get(k);
    };
    const link = (u, v, l, ch, junction) => { const e = { u, v, len: l, ch, junction: !!junction }; edges.push(e); nodes[u].out.push(e); nodes[v].out.push(e); };
    segs.forEach(sg => {
      const ts = Array.from(new Set(sg.cuts.map(t => Math.round(t * 1e9) / 1e9))).sort((x, y) => x - y);
      sg.ids = ts.map(t => node(sg.ch, lerp(sg.a, sg.b, t)));
      sg.ts = ts;
      for (let k = 0; k + 1 < ts.length; k++) if (sg.ids[k] !== sg.ids[k + 1]) link(sg.ids[k], sg.ids[k + 1], dist(nodes[sg.ids[k]].p, nodes[sg.ids[k + 1]].p), sg.ch.id);
    });
    const at = (sg, t) => sg.ids[sg.ts.indexOf(Math.round(t * 1e9) / 1e9)];
    joins.forEach(j => {
      const u = at(j.A, j.s), v = at(j.B, j.t);
      if (u != null && v != null) link(u, v, j.d, [j.A.ch.id, j.B.ch.id], true);
    });
    return { channels: chans, byId, nodes, edges, joins: joins.map(j => ({ a: j.A.ch.id, b: j.B.ch.id, p: lerp(j.A.a, j.A.b, j.s), d: j.d })) };
  }

  const allows = (c, cab) => !c.exclusive || c.classes.some(k => cab.classes.includes(k));
  function edgeOk(net, e, cab) {
    const ok = id => net.byId[id] && allows(net.byId[id], cab);
    return e.junction ? ok(e.ch[0]) && ok(e.ch[1]) : ok(e.ch);
  }

  // A small binary heap of [cost, state].
  function Heap() { this.a = []; }
  Heap.prototype.push = function (c, s) {
    const a = this.a; a.push([c, s]);
    let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; const t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
  };
  Heap.prototype.pop = function () {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; const t = a[m]; a[m] = a[i]; a[i] = t; i = m; }
    }
    return top;
  };

  // Where an end joins the network: a straight drop to the nearest point of an allowed channel (every edge
  // that close, so an end at a corner or junction may leave by any of them). A longer drop could cut
  // across the model, so it's never weighed against the channels. Over dropMax, it's flagged.
  const TIE = 0.5;
  function entries(net, p, cab, dropMax) {
    const all = [];
    net.edges.forEach(e => {
      if (e.junction || !edgeOk(net, e, cab)) return;
      const r = onSeg(p, net.nodes[e.u].p, net.nodes[e.v].p);
      all.push({ e, t: r.t, q: r.q, d: r.d });
    });
    if (!all.length) return { list: [], long: false };
    const dmin = Math.min(...all.map(x => x.d));
    return { list: all.filter(x => x.d <= dmin + TIE), long: dmin > dropMax };
  }

  // One leg, from point A to point B, through the vias in order. States are (node, vias passed); running
  // along an edge of the next via's channel passes it (touching it at a junction doesn't).
  function leg(net, cab, A, B, vias, dropMax) {
    const ea = entries(net, A, cab, dropMax), eb = entries(net, B, cab, dropMax);
    if (!ea.list.length || !eb.list.length) return null;
    const V = vias.length, N = net.nodes.length, cost = new Float64Array(N * (V + 1)).fill(Infinity), prev = new Int32Array(N * (V + 1)).fill(-1), prevE = new Array(N * (V + 1));
    const pass = (e, k) => (!e.junction && k < V && e.ch === vias[k] ? k + 1 : k);
    const h = new Heap(), seed = {};
    ea.list.forEach(x => {
      [[x.e.u, x.t], [x.e.v, 1 - x.t]].forEach(([n, f]) => {
        const k = x.e.len * f > 1e-6 ? pass(x.e, 0) : 0, s = k * N + n, c = x.d + x.e.len * f;
        if (c < cost[s]) { cost[s] = c; prev[s] = -1; seed[s] = x; h.push(c, s); }
      });
    });
    while (h.a.length) {
      const [c, s] = h.pop();
      if (c > cost[s]) continue;
      const n = s % N, k = (s - n) / N;
      net.nodes[n].out.forEach(e => {
        if (!edgeOk(net, e, cab)) return;
        const m = e.u === n ? e.v : e.u, k2 = pass(e, k), s2 = k2 * N + m, c2 = c + e.len;
        if (c2 < cost[s2]) { cost[s2] = c2; prev[s2] = s; prevE[s2] = e; delete seed[s2]; h.push(c2, s2); }
      });
    }
    // The best way off the network to B: from either end of an exit edge, along it to the drop.
    let best = null;
    eb.list.forEach(x => {
      [[x.e.u, x.t], [x.e.v, 1 - x.t]].forEach(([n, f]) => {
        // Arriving with every via passed, or with the last one still to pass along this exit edge.
        [V, x.e.len * f > 1e-6 && pass(x.e, V - 1) === V ? V - 1 : -1].forEach(k => {
          if (k < 0) return;
          const s = k * N + n, c = cost[s] + x.e.len * f + x.d;
          if (c < (best ? best.c : Infinity)) best = { c, s, x };
        });
      });
    });
    // Both ends on one edge, with no vias: straight along it.
    if (!V) ea.list.forEach(a => eb.list.forEach(b => {
      if (a.e !== b.e) return;
      const c = a.d + Math.abs(a.t - b.t) * a.e.len + b.d;
      if (c < (best ? best.c : Infinity)) best = { c, direct: [a, b] };
    }));
    if (!best || !isFinite(best.c)) return null;
    const pts = [A], chans = {}, addLen = (id, l) => { if (!Array.isArray(id)) chans[id] = (chans[id] || 0) + l; };
    let entry, exit;
    if (best.direct) {
      [entry, exit] = best.direct;
      pts.push(entry.q, exit.q);
      addLen(entry.e.ch, Math.abs(entry.t - exit.t) * entry.e.len);
    } else {
      exit = best.x;
      const chain = [];
      let s = best.s;
      while (prev[s] >= 0) { chain.push({ s, e: prevE[s] }); s = prev[s]; }
      entry = seed[s];
      const first = s % N;
      pts.push(entry.q);
      addLen(entry.e.ch, dist(entry.q, net.nodes[first].p));
      pts.push(net.nodes[first].p);
      chain.reverse().forEach(x => { pts.push(net.nodes[x.s % N].p); addLen(x.e.ch, x.e.len); });
      const lastN = best.s % N;
      addLen(exit.e.ch, dist(net.nodes[lastN].p, exit.q));
      pts.push(exit.q);
    }
    pts.push(B);
    const tidy = pts.filter((p, i) => !i || dist(p, pts[i - 1]) > 1e-6);
    const drops = entry.d + exit.d, total = best.c;
    return { pts: tidy, path: total - drops, drops, dropA: entry.d, dropB: exit.d, channels: chans, longDrop: ea.long || eb.long || entry.d > dropMax || exit.d > dropMax };
  }

  // The build length: (drop + path + drop) × (1 + slack %) + each channel's extra × the length run in it +
  // each end's allowance, rounded up to the next roundMm (Chris, 2026-11-15).
  function buildLength(parts, settings) {
    const st = Object.assign({}, DEF, settings || {});
    const geo = parts.path + parts.drops, slack = geo * (+st.slackPct || 0) / 100;
    const extra = Object.keys(parts.channels || {}).reduce((s, id) => s + (parts.extraPerM && parts.extraPerM[id] || 0) * parts.channels[id] / 1000, 0);
    const ends = (parts.ends || []).reduce((s, v) => s + (+v || 0), 0);
    const raw = geo + slack + extra + ends, step = +st.roundMm || 1;
    return { geo, slack, extra, ends, raw, length: Math.ceil(raw / step - 1e-9) * step };
  }

  function cleanCable(c) {
    return { id: String(c.id), classes: (c.classes || []).map(String), vias: (c.vias || []).map(String), pinned: !!c.pinned, route: c.route || null,
      endMm: c.endMm || {}, areaMm2: +c.areaMm2 || 0, ends: (c.ends || []).filter(e => e && e.p).map(e => ({ key: String(e.key), p: pt(e.p) })) };
  }

  // A cable from its first end to each other one (a star; a branching tree comes later). A two-ended cable
  // has one length; with more ends, each leg has its own and the cable's is null.
  function route(net, cable, settings) {
    const st = Object.assign({}, DEF, settings || {}), cab = cleanCable(cable), flags = [];
    if (cab.ends.length < 2) return { ok: false, legs: [], length: null, flags: ['open'] };
    if (cab.pinned && cab.route) return Object.assign({}, cab.route, { pinned: true });
    const ex = {};
    net.channels.forEach(c => { ex[c.id] = c.extraPerM; });
    const endAllow = k => (cab.endMm[k] != null ? +cab.endMm[k] : +st.endMm) || 0;
    const A = cab.ends[0], legs = cab.ends.slice(1).map(B => {
      const r = leg(net, cab, A.p, B.p, cab.vias.filter(id => net.byId[id]), +st.dropMax);
      if (!r) {
        const straight = dist(A.p, B.p);
        return { from: A.key, to: B.key, ok: false, pts: [A.p, B.p], straight, length: null };
      }
      const L = buildLength({ path: r.path, drops: r.drops, channels: r.channels, extraPerM: ex, ends: [endAllow(A.key), endAllow(B.key)] }, st);
      if (r.longDrop) flags.push('long-drop');
      return { from: A.key, to: B.key, ok: true, pts: r.pts, path: r.path, drops: r.drops, dropA: r.dropA, dropB: r.dropB, channels: r.channels, longDrop: r.longDrop, parts: L, length: L.length };
    });
    const ok = legs.every(l => l.ok);
    if (!ok) flags.push('not-routed');
    return { ok, legs, length: legs.length === 1 && ok ? legs[0].length : null, flags: Array.from(new Set(flags)) };
  }

  // Every cable, and how full each channel is: the cables' areas through it against its section (shown, not
  // enforced; Chris: later).
  function routeAll(channels, cables, settings) {
    const net = build(channels), results = {}, fill = {};
    net.channels.forEach(c => { fill[c.id] = { area: 0, cables: [], section: c.w * c.h, pct: 0 }; });
    (cables || []).forEach(c => {
      const r = route(net, c, settings);
      results[c.id] = r;
      const used = new Set();
      (r.legs || []).forEach(l => Object.keys(l.channels || {}).forEach(id => used.add(id)));
      used.forEach(id => { if (fill[id]) { fill[id].area += +c.areaMm2 || 0; fill[id].cables.push(String(c.id)); } });
    });
    Object.values(fill).forEach(f => { f.pct = f.section ? Math.round(f.area / f.section * 1000) / 10 : 0; });
    return { net, results, fill };
  }

  LM.fbroute = { build, route, routeAll, buildLength, allows, onSeg, segSeg, DEF };
})(typeof window !== 'undefined' ? (window.LM = window.LM || {}) : module.exports);
