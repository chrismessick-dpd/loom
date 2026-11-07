// The harness model. A harness is a graph: nodes (connectors, splices and breakouts) joined by
// segments, each with a length and a covering. Wires run from a pin (or a splice) to another, and
// their routes are found through the segments, so splits, merges and several ends on one side are
// all the same thing. Twists, shields and cables are groups of wires; a group covers the segments
// all of its wires share, so a pair untwists where its wires part at a breakout.
(function (LM) {
  'use strict';
  const U = LM.util, L = LM.library;
  const SCHEMA = 1;

  // IEC 60757 codes. A striped wire is "WH/BU" (base/stripe).
  const COLORS = {
    BK: ['Black', '#1d1d1f'], BN: ['Brown', '#7b4a26'], RD: ['Red', '#d8281c'], OG: ['Orange', '#f08a24'],
    YE: ['Yellow', '#f2cd2e'], GN: ['Green', '#2c9a4b'], BU: ['Blue', '#2563c9'], VT: ['Violet', '#8a46b0'],
    GY: ['Gray', '#8e8e93'], WH: ['White', '#f4f4f4'], PK: ['Pink', '#f09ab8'], TQ: ['Turquoise', '#1aa9a3'],
  };
  // AWG to cross-section, mm².
  const AWG = { 10: 5.26, 12: 3.31, 14: 2.08, 16: 1.31, 18: 0.82, 20: 0.52, 22: 0.33, 24: 0.2, 26: 0.13, 28: 0.08, 30: 0.05, 32: 0.03 };
  const GAUGES = Object.keys(AWG).sort((a, b) => a - b);
  const COVERS = { none: 'None', sleeve: 'Braided sleeving', heatshrink: 'Heat shrink', spiral: 'Spiral wrap', tape: 'Harness tape' };
  const GROUP_KINDS = { twist: 'Twisted', shield: 'Shield', cable: 'Cable' };
  const GROUP_PREFIX = { twist: 'TP', shield: 'SH', cable: 'C' };
  const DEFAULT_NOTES = [
    'Build to IPC/WHMA-A-620, Class 2.',
    'Lengths run from connector face to connector face or breakout center. Tolerance ±5 mm up to 300 mm, ±10 mm up to 1000 mm, ±1% over 1000 mm.',
    'Twisted pairs: about 40 twists per meter (one per 25 mm).',
    'Label each connector with its reference designator within 30 mm of the housing.',
  ];

  function colorInfo(code) {
    const [b, s] = String(code || '').toUpperCase().split('/');
    const base = COLORS[b], stripe = s && COLORS[s];
    return { code: base ? b + (stripe ? '/' + s : '') : '', base: base ? base[1] : null, stripe: stripe ? stripe[1] : null,
      name: base ? base[0] + (stripe ? '/' + stripe[0].toLowerCase() : '') : '' };
  }
  const gaugeText = g => (g ? g + ' AWG' + (AWG[g] ? ' (' + AWG[g] + ' mm²)' : '') : '');

  // ── Building ──────────────────────────────────────────────────────────────
  const isConn = n => n && n.kind === 'connector';
  // A loose end: where a wire end dragged off into space waits, drawn as a dot. It has no ref and
  // goes as soon as no wire ends on it (tidyLoose).
  const isLoose = n => !!n && n.kind === 'loose';
  const node = (h, id) => h.nodes.find(n => n.id === id);
  const seg = (h, id) => h.segments.find(s => s.id === id);
  const wire = (h, id) => h.wires.find(w => w.id === id);
  const group = (h, id) => h.groups.find(g => g.id === id);
  const other = (s, id) => (s.a === id ? s.b : s.a);

  function nextRef(h, prefix) {
    let max = 0;
    const re = new RegExp('^' + prefix + '(\\d+)$');
    h.nodes.concat(h.groups).forEach(x => { const m = re.exec(x.ref || x.label || ''); if (m) max = Math.max(max, +m[1]); });
    return prefix + (max + 1);
  }
  function blank(title) {
    const h = {
      schema: SCHEMA, id: U.uid('h'), title: title || 'New harness', pn: '', rev: 'A', drawnBy: '', date: U.today(),
      allowancePct: 5, notes: DEFAULT_NOTES.slice(), defaults: { gauge: '24', color: 'BK' },
      nodes: [], segments: [], wires: [], groups: [], updated: Date.now(),
    };
    const a = addConnector(h, 160, 240, { family: 'jst-ph', pins: 4 });
    const b = addConnector(h, 640, 240, { family: 'jst-ph', pins: 4 });
    connect(h, a.id, b.id, 300);
    return h;
  }
  function addConnector(h, x, y, props) {
    const n = Object.assign({ id: U.uid('n'), kind: 'connector', ref: nextRef(h, 'P'), name: '', family: 'generic-rect', pins: 4, rows: 1,
      gender: 'receptacle', mpn: '', terminal: '', mate: '', pinLabels: {}, x: Math.round(x), y: Math.round(y) }, props || {});
    L.conform(n);
    h.nodes.push(n);
    return n;
  }
  function addNode(h, kind, x, y) {
    const n = { id: U.uid('n'), kind, x: Math.round(x), y: Math.round(y) };
    if (kind === 'splice') n.ref = nextRef(h, 'S');
    h.nodes.push(n);
    return n;
  }
  function connect(h, a, b, length) {
    if (a === b) return null;
    const have = h.segments.find(s => (s.a === a && s.b === b) || (s.a === b && s.b === a));
    if (have) return have;
    const s = { id: U.uid('s'), a, b, length: length == null ? null : Math.round(length), cover: 'none' };
    h.segments.push(s);
    return s;
  }
  // Put a breakout or splice part way along a segment; the two halves share its length and covering.
  function splitSegment(h, segId, kind, t, at) {
    const s = seg(h, segId);
    if (!s) return null;
    t = t == null ? 0.5 : Math.min(0.9, Math.max(0.1, t));
    const A = node(h, s.a), B = node(h, s.b);
    const n = addNode(h, kind || 'breakout', at ? at.x : A.x + (B.x - A.x) * t, at ? at.y : A.y + (B.y - A.y) * t);
    const l1 = s.length == null ? null : Math.round(s.length * t / 5) * 5;
    h.segments.push({ id: U.uid('s'), a: n.id, b: s.b, length: s.length == null ? null : s.length - l1, cover: s.cover });
    s.b = n.id;
    s.length = l1;
    return n;
  }
  // Removing a breakout or splice with two segments heals them into one; otherwise its segments go too.
  // Wires that end on the node go with it.
  function removeNode(h, id) {
    const n = node(h, id);
    if (!n) return;
    const segs = h.segments.filter(s => s.a === id || s.b === id);
    if (!isConn(n) && segs.length === 2) {
      const [s1, s2] = segs;
      const o1 = other(s1, id), o2 = other(s2, id);
      s1.a = o1; s1.b = o2;
      s1.length = s1.length == null || s2.length == null ? null : s1.length + s2.length;
      h.segments = h.segments.filter(s => s !== s2);
    } else {
      h.segments = h.segments.filter(s => !segs.includes(s));
    }
    h.wires = h.wires.filter(w => w.from.node !== id && w.to.node !== id);
    h.nodes = h.nodes.filter(x => x !== n);
    tidyGroups(h);
    tidyLoose(h);
  }
  function tidyLoose(h) {
    const used = new Set(h.wires.flatMap(w => [w.from.node, w.to.node]));
    const gone = new Set(h.nodes.filter(n => isLoose(n) && !used.has(n.id)).map(n => n.id));
    if (!gone.size) return;
    h.nodes = h.nodes.filter(n => !gone.has(n.id));
    h.segments = h.segments.filter(s => !gone.has(s.a) && !gone.has(s.b));
    if (h.place) gone.forEach(id => delete h.place['n:' + id]);
  }
  const setPlace = (h, id, p) => { h.place = h.place || {}; h.place['n:' + id] = { x: Math.round(p.x), y: Math.round(p.y), v: 3 }; };
  // Move one end ('from' or 'to') of a wire: to a pin ({ node, pin }), to a splice ({ node, order:
  // { l: [wire ids], r: [...] } with this wire in place, as the drop saw the ports; or without an
  // order to let the diagram pick a side), or off to a loose end
  // ({ loose: true, x, y }). A splice keeps its ports' order in n.ports. The new end is joined to
  // the wire's other end by a segment when no route exists. Behind the old end, segments that no
  // wire uses and that have no length go, and so does a loose end left with no wires.
  // Returns false when nothing changed (an end can't move onto the wire's other end).
  function moveEnd(h, wireId, which, to) {
    const w = wire(h, wireId);
    if (!w || !to) return false;
    const oth = which === 'from' ? 'to' : 'from', old = w[which], oldN = node(h, old.node);
    if (to.node && to.node === w[oth].node) return false;
    if (to.loose && isLoose(oldN)) { setPlace(h, oldN.id, to); return true; }
    let target;
    if (to.loose) { target = addNode(h, 'loose', to.x, to.y); setPlace(h, target.id, to); }
    else target = node(h, to.node);
    if (!target) return false;
    if (oldN && oldN.ports) ['l', 'r'].forEach(k => { oldN.ports[k] = (oldN.ports[k] || []).filter(id => id !== w.id); });
    w[which] = { node: target.id, pin: isConn(target) ? to.pin || null : null };
    if (target.kind === 'splice' && to.order) target.ports = { l: to.order.l.slice(), r: to.order.r.slice() };
    if (target.id !== old.node) {
      if (!analyze(h).route(w[oth].node, target.id)) connect(h, w[oth].node, target.id, null);
      const used = new Set();
      analyze(h).routes.forEach(r => r && r.segs.forEach(sg => used.add(sg.id)));
      h.segments = h.segments.filter(sg => used.has(sg.id) || sg.length != null || (sg.a !== old.node && sg.b !== old.node));
      tidyLoose(h);
    }
    return true;
  }
  function removeSegment(h, id) { h.segments = h.segments.filter(s => s.id !== id); }
  // A wire needs a path through the harness; ends not yet joined get a direct segment (length unset).
  function addWire(h, from, to, props) {
    if (from.node !== to.node && !analyze(h).route(from.node, to.node)) connect(h, from.node, to.node, null);
    const no = h.wires.reduce((m, w) => Math.max(m, w.no || 0), 0) + 1;
    const w = Object.assign({ id: U.uid('w'), no, from: { node: from.node, pin: from.pin || null }, to: { node: to.node, pin: to.pin || null },
      signal: '', color: h.defaults.color, gauge: h.defaults.gauge }, props || {});
    h.wires.push(w);
    return w;
  }
  function removeWires(h, ids) {
    h.wires = h.wires.filter(w => !ids.includes(w.id));
    tidyGroups(h);
    tidyLoose(h);
  }
  // A wire is in at most one group of each kind.
  function addGroup(h, kind, wireIds) {
    h.groups.forEach(g => { if (g.kind === kind) g.wires = g.wires.filter(id => !wireIds.includes(id)); });
    const g = { id: U.uid('g'), kind, label: nextRef(h, GROUP_PREFIX[kind]), wires: wireIds.slice() };
    h.groups.push(g);
    tidyGroups(h);
    return g;
  }
  function removeGroup(h, id) { h.groups = h.groups.filter(g => g.id !== id); }
  function tidyGroups(h) {
    const ids = new Set(h.wires.map(w => w.id));
    h.groups.forEach(g => { g.wires = g.wires.filter(id => ids.has(id)); });
    h.groups = h.groups.filter(g => g.wires.length >= (g.kind === 'twist' ? 2 : 1));
  }
  // Wire pin n of one connector to pin n of the other, for every pin both have free.
  function wireStraight(h, aId, bId) {
    const a = node(h, aId), b = node(h, bId);
    const used = new Set(h.wires.flatMap(w => [w.from, w.to]).map(e => e.node + '|' + e.pin));
    let made = 0;
    pinList(a).forEach(p => {
      if (pinList(b).includes(p) && !used.has(a.id + '|' + p) && !used.has(b.id + '|' + p)) { addWire(h, { node: a.id, pin: p }, { node: b.id, pin: p }); made++; }
    });
    return made;
  }

  // Pins are 1..n, unless the end came from a board and carries its real pin names (A1, B5…).
  function pinList(n) {
    if (!isConn(n)) return [];
    if (Array.isArray(n.pinNames) && n.pinNames.length) return n.pinNames.map(String);
    const out = [];
    for (let i = 1; i <= (n.pins || 0); i++) out.push(String(i));
    return out;
  }
  const label = n => (!n ? '?' : n.ref || (n.kind === 'breakout' ? 'breakout' : isLoose(n) ? 'loose end' : n.kind));
  const wireName = w => 'W' + w.no;
  function endText(h, e) {
    const n = node(h, e.node);
    return label(n) + (e.pin && isConn(n) ? '.' + e.pin : '');
  }
  // "P1.3", "p1:3" or "S1" → an end, or null.
  function parseEnd(h, text) {
    const m = /^\s*([A-Za-z]+\d+)\s*(?:[.:\-\s]\s*(\w+))?\s*$/.exec(text || '');
    if (!m) return null;
    const n = h.nodes.find(x => (x.ref || '').toUpperCase() === m[1].toUpperCase());
    if (!n) return null;
    if (isConn(n)) return m[2] && pinList(n).includes(m[2]) ? { node: n.id, pin: m[2] } : null;
    return n.kind === 'splice' && !m[2] ? { node: n.id, pin: null } : null;
  }

  // ── Analysis: routes, wires per segment, group spans, lengths ─────────────
  function analyze(h) {
    const byId = new Map(h.nodes.map(n => [n.id, n]));
    const adj = new Map(h.nodes.map(n => [n.id, []]));
    h.segments.forEach(s => { if (adj.has(s.a) && adj.has(s.b)) { adj.get(s.a).push(s); adj.get(s.b).push(s); } });

    // Union-find for loops: a segment joining two nodes already connected closes one.
    const parent = new Map(h.nodes.map(n => [n.id, n.id]));
    const find = x => { while (parent.get(x) !== x) x = parent.get(x); return x; };
    let loop = false;
    h.segments.forEach(s => { if (!adj.has(s.a) || !adj.has(s.b)) return; const ra = find(s.a), rb = find(s.b); if (ra === rb) loop = true; else parent.set(ra, rb); });

    function route(a, b) {
      if (!adj.has(a) || !adj.has(b)) return null;
      if (a === b) return { nodes: [a], segs: [] };
      const prev = new Map([[a, null]]);
      const q = [a];
      while (q.length) {
        const x = q.shift();
        if (x === b) break;
        for (const s of adj.get(x)) { const y = other(s, x); if (!prev.has(y)) { prev.set(y, s); q.push(y); } }
      }
      if (!prev.has(b)) return null;
      const nodes = [b], segs = [];
      for (let x = b; x !== a;) { const s = prev.get(x); segs.unshift(s); x = other(s, x); nodes.unshift(x); }
      return { nodes, segs };
    }
    const routes = new Map(), segWires = new Map(h.segments.map(s => [s.id, []])), wireLen = new Map();
    h.wires.forEach(w => {
      const r = route(w.from.node, w.to.node);
      routes.set(w.id, r);
      if (!r) { wireLen.set(w.id, null); return; }
      r.segs.forEach(s => segWires.get(s.id).push(w));
      wireLen.set(w.id, r.segs.some(s => s.length == null) ? null : r.segs.reduce((t, s) => t + s.length, 0));
    });
    const spans = new Map();
    h.groups.forEach(g => {
      const rs = g.wires.map(id => routes.get(id)).filter(Boolean);
      if (!rs.length || rs.length < g.wires.length) { spans.set(g.id, []); return; }
      spans.set(g.id, rs[0].segs.filter(s => rs.every(r => r.segs.includes(s))));
    });
    const groupsOf = new Map(h.wires.map(w => [w.id, h.groups.filter(g => g.wires.includes(w.id))]));
    return { byId, adj, loop, route, routes, segWires, spans, wireLen, groupsOf };
  }
  const spanLength = segs => (segs.some(s => s.length == null) ? null : segs.reduce((t, s) => t + s.length, 0));

  // ── Checks ────────────────────────────────────────────────────────────────
  const SEV_ORDER = { error: 0, warn: 1, info: 2 };
  function checks(h, A) {
    A = A || analyze(h);
    const out = [];
    const add = (sev, text, ref) => out.push({ sev, text, ref });
    const refs = new Map();
    h.nodes.forEach(n => {
      if (!n.ref) return;
      const k = n.ref.toUpperCase();
      if (refs.has(k)) add('error', `Two items are called ${n.ref}.`, { kind: 'node', id: n.id });
      refs.set(k, n);
    });
    h.nodes.forEach(n => {
      const ref = { kind: 'node', id: n.id };
      if (isLoose(n)) return;
      if (!A.adj.get(n.id).length) add('warn', `${label(n)} isn't joined to the harness yet.`, ref);
      if (n.kind === 'breakout' && A.adj.get(n.id).length === 1) add('info', 'A breakout leads nowhere. Remove it or add a branch.', ref);
      if (n.kind === 'splice') {
        const k = h.wires.filter(w => w.from.node === n.id || w.to.node === n.id).length;
        if (k < 2) add('warn', `${n.ref} joins ${k ? 'only one wire' : 'no wires'}.`, ref);
      }
      if (!isConn(n)) return;
      const used = new Map();
      h.wires.forEach(w => [w.from, w.to].forEach(e => { if (e.node === n.id) used.set(e.pin, (used.get(e.pin) || []).concat(w)); }));
      const pins = pinList(n);
      if (!used.size) add('warn', `${n.ref} has no wires.`, ref);
      else {
        const free = pins.filter(p => !used.has(p));
        if (free.length) add('info', `${n.ref}: pin${free.length > 1 ? 's' : ''} ${free.join(', ')} not used.`, ref);
      }
      used.forEach((ws, p) => {
        if (!pins.includes(p)) add('error', `${n.ref} has no pin ${p}, but ${ws.map(wireName).join(', ')} land${ws.length > 1 ? '' : 's'} on it.`, ref);
        else if (ws.length > 1) add('warn', `${n.ref} pin ${p} has ${ws.length} wires (${ws.map(wireName).join(', ')}).`, ref);
      });
      const f = L.family(n.family);
      if (f.awg) {
        const bad = [...used.values()].flat().filter(w => w.gauge && (+w.gauge < f.awg[0] || +w.gauge > f.awg[1]));
        [...new Set(bad)].forEach(w => add('warn', `${wireName(w)} is ${w.gauge} AWG; ${f.name} terminals typically take ${f.awg[0]}–${f.awg[1]} AWG. Check the terminal's datasheet.`, { kind: 'wire', id: w.id }));
      }
      if (f.rows && n.rows === 2 && n.pins % 2) add('warn', `${n.ref} is dual row with an odd pin count (${n.pins}).`, ref);
    });
    h.wires.forEach(w => {
      const ref = { kind: 'wire', id: w.id };
      if ([w.from, w.to].some(e => isLoose(A.byId.get(e.node)))) add('warn', `${wireName(w)} has a loose end. Drag it onto a pin or a splice.`, ref);
      else if (!A.routes.get(w.id)) add('error', `${wireName(w)} has no path from ${endText(h, w.from)} to ${endText(h, w.to)} through the harness.`, ref);
      if (!w.color) add('warn', `${wireName(w)} has no color.`, ref);
      if (!w.gauge) add('warn', `${wireName(w)} has no gauge.`, ref);
    });
    h.segments.forEach(s => {
      if (s.length == null && !isLoose(A.byId.get(s.a)) && !isLoose(A.byId.get(s.b))) add('warn', `The wires from ${label(A.byId.get(s.a))} to ${label(A.byId.get(s.b))} have no length.`, { kind: 'seg', id: s.id });
    });
    h.groups.forEach(g => {
      if (!(A.spans.get(g.id) || []).length) add('warn', `${g.label}'s wires share no segment, so it covers nothing.`, { kind: 'group', id: g.id });
    });
    return out.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
  }

  // ── Tables: from/to and BOM ───────────────────────────────────────────────
  function fromTo(h, A) {
    A = A || analyze(h);
    return h.wires.slice().sort((a, b) => a.no - b.no).map(w => ({
      wire: w, name: wireName(w), from: endText(h, w.from), to: endText(h, w.to), signal: w.signal || '', color: colorInfo(w.color),
      gauge: w.gauge || '', length: A.wireLen.get(w.id), groups: A.groupsOf.get(w.id).map(g => g.label).join(', '),
    }));
  }
  function bom(h, A) {
    A = A || analyze(h);
    const allow = 1 + (h.allowancePct || 0) / 100;
    const rows = new Map();
    const add = (key, r, qty) => { const have = rows.get(key); if (have) have.qty += qty; else rows.set(key, Object.assign({ qty }, r)); };
    h.nodes.filter(isConn).forEach(n => {
      const f = L.family(n.family);
      const wired = new Set(h.wires.flatMap(w => [w.from, w.to]).filter(e => e.node === n.id).map(e => e.pin)).size;
      if (L.hasHousing(f)) {
        const pn = n.mpn || L.suggestHousing(n);
        add('h|' + f.id + '|' + n.pins + '|' + pn, { desc: `${f.name} housing, ${n.pins} pos${n.rows === 2 && f.style === 'rect' ? ', dual row' : ''}`, pn, unit: 'ea', refs: [n.ref] }, 1);
        if (wired) add('t|' + f.id + '|' + n.terminal, { desc: `${f.name} terminal`, pn: n.terminal || '', unit: 'ea', refs: [] }, wired);
      } else if (f.style === 'ring' || f.style === 'ferrule') {
        add('t|' + f.id + '|' + n.mpn, { desc: f.name, pn: n.mpn || '', unit: 'ea', refs: [n.ref] }, 1);
      }
    });
    const splices = h.nodes.filter(n => n.kind === 'splice');
    if (splices.length) add('splice', { desc: 'Splice, crimped or soldered, with heat shrink', pn: '', unit: 'ea', refs: splices.map(n => n.ref) }, splices.length);
    // Wire runs outside any cable; a cable's conductors are bought as the cable.
    h.wires.forEach(w => {
      const r = A.routes.get(w.id);
      if (!r) return;
      const inCable = new Set(A.groupsOf.get(w.id).filter(g => g.kind === 'cable').flatMap(g => A.spans.get(g.id) || []));
      const len = r.segs.filter(s => !inCable.has(s)).reduce((t, s) => t + (s.length || 0), 0);
      if (!len) return;
      const c = colorInfo(w.color);
      add('w|' + w.gauge + '|' + c.code, { desc: `Wire, ${gaugeText(w.gauge) || 'gauge not set'}, ${c.name || 'color not set'}`, pn: '', unit: 'mm', refs: [] }, len * allow);
    });
    h.groups.filter(g => g.kind !== 'twist').forEach(g => {
      const len = spanLength(A.spans.get(g.id) || []);
      if (!len) return;
      const desc = g.kind === 'cable' ? `Cable, ${g.wires.length} conductor${g.wires.length > 1 ? 's' : ''}${g.note ? ', ' + g.note : ''}` : `Shield braid${g.note ? ', ' + g.note : ''}`;
      add('g|' + g.id, { desc, pn: g.pn || '', unit: 'mm', refs: [g.label] }, len * allow);
    });
    h.segments.filter(s => s.cover && s.cover !== 'none' && s.length).forEach(s => {
      add('c|' + s.cover, { desc: COVERS[s.cover], pn: '', unit: 'mm', refs: [] }, s.length * allow);
    });
    let i = 0;
    return [...rows.values()].map(r => Object.assign(r, { item: ++i }));
  }
  const qtyText = r => (r.unit === 'mm' ? U.fmtMeters(r.qty) : String(Math.round(r.qty)));

  // ── Loading ───────────────────────────────────────────────────────────────
  function normalize(h) {
    if (!h || typeof h !== 'object' || !Array.isArray(h.nodes)) throw new Error("This file isn't a Loom harness.");
    h.schema = h.schema || SCHEMA;
    h.id = h.id || U.uid('h');
    ['segments', 'wires', 'groups'].forEach(k => { if (!Array.isArray(h[k])) h[k] = []; });
    if (!Array.isArray(h.notes)) h.notes = DEFAULT_NOTES.slice();
    h.defaults = Object.assign({ gauge: '24', color: 'BK' }, h.defaults || {});
    if (h.allowancePct == null) h.allowancePct = 5;
    h.wires.forEach((w, i) => { if (!w.no) w.no = i + 1; });
    h.nodes.forEach(n => { if (isConn(n) && (!n.pinLabels || typeof n.pinLabels !== 'object')) n.pinLabels = {}; });
    return h;
  }

  LM.model = {
    SCHEMA, COLORS, AWG, GAUGES, COVERS, GROUP_KINDS, DEFAULT_NOTES, colorInfo, gaugeText,
    isConn, isLoose, node, seg, wire, group, other, nextRef, blank, addConnector, addNode, connect, splitSegment, removeNode, removeSegment, moveEnd,
    addWire, removeWires, addGroup, removeGroup, wireStraight, pinList, label, wireName, endText, parseEnd,
    analyze, spanLength, checks, fromTo, bom, qtyText, normalize,
  };
})(window.LM = window.LM || {});
