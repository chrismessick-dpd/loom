// The harness model. A harness is a graph: nodes (connectors, splices and breakouts) joined by
// segments, each with a length and a covering. Wires run from a pin (or a splice) to another, and
// their routes are found through the segments, so splits, merges and several ends on one side are
// all the same thing. Wires are grouped into sets, which nest (see *Sets* below); a set covers the
// segments all of its wires share, so a pair untwists where its wires part at a breakout.
(function (LM) {
  'use strict';
  const U = LM.util, L = LM.library;
  const SCHEMA = 2;

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
  const set = (h, id) => h.sets.find(s => s.id === id);
  const other = (s, id) => (s.a === id ? s.b : s.a);

  function nextRef(h, prefix) {
    let max = 0;
    const re = new RegExp('^' + prefix + '(\\d+)$');
    h.nodes.concat(h.sets || []).forEach(x => { const m = re.exec(x.ref || x.label || ''); if (m) max = Math.max(max, +m[1]); });
    return prefix + (max + 1);
  }
  function blank(title) {
    const h = {
      schema: SCHEMA, id: U.uid('h'), title: title || 'New harness', pn: '', rev: 'A', drawnBy: '', date: U.today(),
      allowancePct: 5, notes: DEFAULT_NOTES.slice(), defaults: { gauge: '24', color: 'BK' },
      nodes: [], segments: [], wires: [], sets: [], updated: Date.now(),
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
    tidySets(h);
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
    tidySets(h);
    tidyLoose(h);
  }

  // ── Sets ──────────────────────────────────────────────────────────────────
  // A set is a group of wires with properties: twisted, shielded, and held as a cable or a bundle
  // (one or the other). Sets nest: a set's members are wires (s.wires) and other sets (s.sets), so a
  // bundle can hold a twisted, shielded pair and two single wires. Every wire is in at most one set
  // directly and every set in at most one parent, so the sets form a forest; h.sets is flat and the
  // tree is in the member lists. A set with no property means nothing and dissolves (its members
  // move up to its parent), and one whose only member is another set merges into it.
  // Lengths (mm). Every set's ends are measured from what holds it: s.over.l and s.over.r say how
  // far each end runs past it (Chris; negative stops inside). An outermost set is measured from
  // its wires' ends (the run they share), so a cable whose jacket is stripped back 20 mm at the
  // left has over.l −20; a nested set from its parent's ends, so a twisted, shielded pair can run
  // on past its bundle. A set covers what holds it plus both overhangs, and no end may run past
  // the wire ends (reach). s.length is only an old value kept when the run isn't known yet.
  const FLAGS = ['twist', 'shield', 'cable', 'bundle'];
  const holderOf = s => (s.cable ? 'cable' : s.bundle ? 'bundle' : null);
  const hasFlag = s => FLAGS.some(k => s[k]);
  // Its word and its label's prefix, from the outermost thing it is.
  const setWord = s => (s.cable ? 'Cable' : s.bundle ? 'Wire bundle' : 'Wire set');
  const setPrefix = s => (s.cable ? 'C' : s.bundle ? 'B' : s.twist ? 'TP' : 'SH');
  // "twisted, shielded": the properties a set's word doesn't already say.
  const setTraits = s => [s.twist && 'twisted', s.shield && 'shielded'].filter(Boolean).join(', ');
  const parentOf = (h, id) => h.sets.find(p => p.sets.includes(id)) || null;
  const setOfWire = (h, wid) => h.sets.find(p => p.wires.includes(wid)) || null;
  const roots = h => h.sets.filter(s => !parentOf(h, s.id));
  // Every wire under a set, its own first, then each child set's.
  function wiresIn(h, s) {
    const out = s.wires.slice();
    s.sets.forEach(id => { const c = set(h, id); if (c) out.push(...wiresIn(h, c)); });
    return out;
  }
  // The sets a wire (or a set) sits in, outermost first.
  function chainOf(h, wid) {
    const out = [];
    for (let s = setOfWire(h, wid); s; s = parentOf(h, s.id)) out.unshift(s);
    return out;
  }
  function setChain(h, s) {
    const out = [];
    for (let x = s; x; x = parentOf(h, x.id)) out.unshift(x);
    return out;
  }
  const sameIds = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  // The set whose wires are exactly these, or null.
  const matchSet = (h, ids) => h.sets.find(s => sameIds(wiresIn(h, s), ids)) || null;
  // A set the selection only partly covers while also reaching outside it, which a new set can't
  // cross: { set, inside, outside } (wire ids of that set), or null.
  function crossing(h, ids) {
    const want = new Set(ids);
    for (const s of h.sets) {
      const ws = wiresIn(h, s), inside = ws.filter(id => want.has(id));
      if (inside.length && inside.length < ws.length && ids.some(id => !ws.includes(id))) return { set: s, inside, outside: ws.filter(id => !want.has(id)) };
    }
    return null;
  }
  // What a new set over these wires would hold: each wire lifted to the biggest set wholly inside
  // the selection. { wires, sets, parent } (parent: the smallest set around them all, or null).
  function membersFor(h, ids) {
    const want = new Set(ids), wires = [], sets = [];
    let parent;
    ids.forEach(wid => {
      let m = { wire: wid }, p = setOfWire(h, wid);
      while (p && wiresIn(h, p).every(id => want.has(id))) { m = { set: p.id }; p = parentOf(h, p.id); }
      if (m.wire) wires.push(m.wire); else if (!sets.includes(m.set)) sets.push(m.set);
      if (parent === undefined) parent = p;
    });
    return { wires, sets, parent: parent || null };
  }
  // Why these wires can't become a set of their own, or '' when they can (or already are one).
  function whyNot(h, ids) {
    if (!ids.length) return 'Select some wires first.';
    const x = crossing(h, ids);
    if (x) return `${x.set.label} also holds ${x.outside.map(id => wireName(wire(h, id))).join(', ')}. Select all of ${x.set.label}'s wires, or none of them.`;
    if (matchSet(h, ids)) return '';
    const m = membersFor(h, ids);
    if (m.parent && m.parent.twist) return `These wires are part of the twisted set ${m.parent.label}, which can't hold a set inside it.`;
    return '';
  }
  // Make a set over these wires with the given properties, or add the properties to the set that
  // already holds exactly them. Returns the set, or null when it can't be made (whyNot says why).
  function makeSet(h, ids, props) {
    ids = [...new Set(ids)].filter(id => wire(h, id));
    if (!ids.length || whyNot(h, ids)) return null;
    props = props || {};
    let s = matchSet(h, ids);
    if (!s) {
      const m = membersFor(h, ids);
      s = { id: props.id || U.uid('g'), label: '', wires: m.wires, sets: m.sets, twist: false, shield: false, cable: false, bundle: false, length: null, over: { l: 0, r: 0 }, note: '', pn: '' };
      if (m.parent) {
        m.parent.wires = m.parent.wires.filter(id => !m.wires.includes(id));
        m.parent.sets = m.parent.sets.filter(id => !m.sets.includes(id)).concat(s.id);
      } else h.sets.forEach(x => { x.wires = x.wires.filter(id => !m.wires.includes(id)); });
      h.sets.push(s);
      // Sets taken into the new one keep their overhangs: the new set starts as long as what held
      // them (the wire ends, or their old parent), so they stay where they were.
    }
    const before = s.label ? setPrefix(s) : null;
    Object.keys(props).forEach(k => { if (k !== 'id' && (k !== 'label' || props.label)) s[k] = props[k]; });
    if (props.cable) s.bundle = false;
    if (props.bundle) s.cable = false;
    relabel(h, s, before);
    tidySets(h);
    return set(h, s.id) || null;
  }
  // A label made from the set's prefix follows it when the prefix changes (TP1 → B2); one typed
  // by hand stays.
  function relabel(h, s, before) {
    if (!hasFlag(s)) return;
    const p = setPrefix(s);
    if (!s.label || (before && before !== p && new RegExp('^' + before + '\\d+$').test(s.label))) { s.label = ''; s.label = nextRef(h, p); }
  }
  // Tick or untick a property. Cable and bundle exclude each other. Unticking the last one
  // dissolves the set; returns the set, or null once it's gone.
  function setFlag(h, id, key, on) {
    const s = set(h, id);
    if (!s || !FLAGS.includes(key)) return null;
    const before = setPrefix(s);
    s[key] = !!on;
    if (on && key === 'cable') s.bundle = false;
    if (on && key === 'bundle') s.cable = false;
    relabel(h, s, before);
    tidySets(h);
    return set(h, id) || null;
  }
  // Remove a set; its wires and sets move up to its parent. Wires are never deleted here. Its child
  // sets stay where they were: their overhangs add its own.
  const ov = s => ({ l: (s.over && +s.over.l) || 0, r: (s.over && +s.over.r) || 0 });
  function dissolveSet(h, id) {
    const s = set(h, id);
    if (!s) return;
    const p = parentOf(h, id), kids = s.sets.map(x => set(h, x)).filter(Boolean), so = ov(s);
    kids.forEach(c => { const co = ov(c); c.over = { l: co.l + so.l, r: co.r + so.r }; if (!p && s.length != null) c.length = Math.max(0, s.length + co.l + co.r); });
    if (p) { p.sets = p.sets.filter(x => x !== id).concat(s.sets); p.wires = p.wires.concat(s.wires); }
    h.sets = h.sets.filter(x => x !== s);
  }
  // Keep the forest sound: wires that exist, in one set each; sets in one parent each, no loops;
  // a twist needs two wires of its own and no sets; a bundle needs two members; sets with no
  // property dissolve; a set whose only member is a set merges into it (keeping a cable and a
  // shield; a bundle or a twist around one member means nothing).
  function tidySets(h) {
    if (!Array.isArray(h.sets)) h.sets = [];
    const live = new Set(h.wires.map(w => w.id)), ids = new Set(h.sets.map(s => s.id));
    const seenW = new Set(), seenS = new Set();
    h.sets.forEach(s => {
      s.wires = (s.wires || []).filter(id => live.has(id) && !seenW.has(id) && seenW.add(id));
      s.sets = (s.sets || []).filter(id => ids.has(id) && id !== s.id && !seenS.has(id) && seenS.add(id));
    });
    // A loop (a set inside itself) is cut where it closes.
    h.sets.forEach(s => {
      const seen = new Set([s.id]);
      for (let p = parentOf(h, s.id); p; p = parentOf(h, p.id)) {
        if (seen.has(p.id)) { p.sets = p.sets.filter(x => x !== s.id); break; }
        seen.add(p.id);
      }
    });
    for (let again = true; again;) {
      again = false;
      for (const s of h.sets) {
        if (s.twist && (s.wires.length < 2 || s.sets.length)) s.twist = false;
        if (s.bundle && s.wires.length + s.sets.length < 2) s.bundle = false;
        if (!wiresIn(h, s).length || !hasFlag(s)) { dissolveSet(h, s.id); again = true; break; }
        if (!s.wires.length && s.sets.length === 1) {
          const c = set(h, s.sets[0]);
          if (s.cable) { c.cable = true; c.bundle = false; c.note = c.note || s.note; c.pn = c.pn || s.pn; c.label = s.label; }
          if (s.shield) c.shield = true;
          dissolveSet(h, s.id); again = true; break;
        }
      }
    }
  }
  // The length a set covers (null: unknown). Outermost: its own, else the run its wires share.
  // Nested: its parent's plus its overhangs.
  function setLength(h, A, s) {
    const p = parentOf(h, s.id), o = ov(s);
    const base = p ? setLength(h, A, p) : spanLength(A.spans.get(s.id) || []);
    if (base == null) return p ? null : s.length != null ? s.length : null;
    return Math.max(0, base + o.l + o.r);
  }
  // Move one end of a set (side 'l' or 'r') to an overhang of v mm. The sets inside it stay where
  // they are: their overhangs on that side change by the opposite amount.
  function setEnd(h, id, side, v) {
    const s = set(h, id);
    if (!s) return;
    const d = v - ov(s)[side];
    s.over = Object.assign(ov(s), { [side]: v });
    s.sets.forEach(cid => { const c = set(h, cid); if (c) c.over = Object.assign(ov(c), { [side]: ov(c)[side] - d }); });
  }
  // How far each of a set's ends sits in from its wires' ends (negative: past them, which can't be).
  function reach(h, s) {
    const p = parentOf(h, s.id), o = ov(s), pr = p ? reach(h, p) : { l: 0, r: 0 };
    return { l: pr.l - o.l, r: pr.r - o.r };
  }
  // The run a set's wires share, which it can't cover more than.
  const setRun = (A, s) => spanLength(A.spans.get(s.id) || []);
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
    // A set runs along the segments all of its wires share.
    const spans = new Map();
    h.sets.forEach(st => {
      const ids = wiresIn(h, st), rs = ids.map(id => routes.get(id)).filter(Boolean);
      if (!rs.length || rs.length < ids.length) { spans.set(st.id, []); return; }
      spans.set(st.id, rs[0].segs.filter(s => rs.every(r => r.segs.includes(s))));
    });
    // The sets each wire is in, outermost first.
    const setsOf = new Map(h.wires.map(w => [w.id, chainOf(h, w.id)]));
    return { byId, adj, loop, route, routes, segWires, spans, wireLen, setsOf };
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
    h.sets.forEach(s => {
      const ref = { kind: 'set', id: s.id }, span = A.spans.get(s.id) || [], run = spanLength(span);
      if (!span.length) add('warn', `${s.label}'s wires share no segment, so it covers nothing.`, ref);
      else {
        const r = reach(h, s);
        ['l', 'r'].forEach(k => { if (r[k] < 0) add('warn', `${s.label} runs ${-r[k]} mm past its wires' ends on the ${k === 'l' ? 'left' : 'right'}.`, ref); });
      }
    });
    return out.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
  }

  // ── Tables: from/to and BOM ───────────────────────────────────────────────
  function fromTo(h, A) {
    A = A || analyze(h);
    return h.wires.slice().sort((a, b) => a.no - b.no).map(w => ({
      wire: w, name: wireName(w), from: endText(h, w.from), to: endText(h, w.to), signal: w.signal || '', color: colorInfo(w.color),
      gauge: w.gauge || '', length: A.wireLen.get(w.id), sets: A.setsOf.get(w.id).map(s => s.label).join(' › '),
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
    // Loose wire for the length outside any cable; a cable's conductors (and a shield inside it)
    // are bought as the cable. A cable set shorter than its run leaves the rest as loose wire.
    h.wires.forEach(w => {
      const r = A.routes.get(w.id);
      if (!r) return;
      const total = r.segs.reduce((t, s) => t + (s.length || 0), 0);
      const inCable = Math.max(0, ...A.setsOf.get(w.id).filter(s => s.cable).map(s => setLength(h, A, s) || 0));
      const len = Math.max(0, total - inCable);
      if (!len) return;
      const c = colorInfo(w.color);
      add('w|' + w.gauge + '|' + c.code, { desc: `Wire, ${gaugeText(w.gauge) || 'gauge not set'}, ${c.name || 'color not set'}`, pn: '', unit: 'mm', refs: [] }, len * allow);
    });
    h.sets.forEach(s => {
      const inCable = setChain(h, s).some(x => x.cable);
      if (!s.cable && !(s.shield && !inCable)) return;
      const len = setLength(h, A, s);
      if (!len) return;
      const n = wiresIn(h, s).length;
      const desc = s.cable ? `${s.shield ? 'Shielded cable' : 'Cable'}, ${n} conductor${n > 1 ? 's' : ''}${s.note ? ', ' + s.note : ''}` : `Shield braid${s.note ? ', ' + s.note : ''}`;
      add('g|' + s.id, { desc, pn: s.pn || '', unit: 'mm', refs: [s.label] }, len * allow);
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
    ['segments', 'wires'].forEach(k => { if (!Array.isArray(h[k])) h[k] = []; });
    if (!Array.isArray(h.sets)) h.sets = [];
    if (!Array.isArray(h.notes)) h.notes = DEFAULT_NOTES.slice();
    h.defaults = Object.assign({ gauge: '24', color: 'BK' }, h.defaults || {});
    if (h.allowancePct == null) h.allowancePct = 5;
    h.wires.forEach((w, i) => { if (!w.no) w.no = i + 1; });
    h.nodes.forEach(n => { if (isConn(n) && (!n.pinLabels || typeof n.pinLabels !== 'object')) n.pinLabels = {}; });
    if (Array.isArray(h.groups)) fromGroups(h);
    h.sets.forEach(s => {
      FLAGS.forEach(k => { s[k] = !!s[k]; });
      ['wires', 'sets'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
      ['label', 'note', 'pn'].forEach(k => { s[k] = s[k] || ''; });
      if (s.length == null || !isFinite(s.length)) s.length = null;
      s.over = ov(s);
    });
    tidySets(h);
    // Before overhangs, a set's length was its own s.length (Covers). It becomes an overhang on
    // the right past what holds it (the wire ends, or its parent), outermost first so each
    // parent's length is final. Where the length of what holds it isn't known yet, it stays.
    const old = h.sets.filter(s => s.length != null);
    if (old.length) {
      const A = analyze(h);
      old.sort((a, b) => setChain(h, a).length - setChain(h, b).length).forEach(s => {
        const p = parentOf(h, s.id), base = p ? setLength(h, A, p) : spanLength(A.spans.get(s.id) || []);
        if (base == null) return;
        s.over = { l: ov(s).l, r: ov(s).r + s.length - base };
        s.length = null;
      });
    }
    h.schema = SCHEMA;
    return h;
  }
  // Schema 1 had flat groups (twist, shield, cable), a wire in at most one of each kind. Biggest
  // first, each becomes a set: groups over the same wires merge, a group inside another nests, and
  // one that crosses a bigger one's edge is dropped. Ids carry over, so a cable's dragged position
  // (h.place b:g:<id>) still applies.
  function fromGroups(h) {
    const rank = { cable: 0, shield: 1, twist: 2 };
    h.groups.slice().sort((a, b) => (b.wires || []).length - (a.wires || []).length || rank[a.kind] - rank[b.kind]).forEach(g => {
      if (!(g.kind in rank)) return;
      makeSet(h, g.wires || [], { id: g.id, label: g.label, [g.kind]: true, note: g.note || '', pn: g.pn || '' });
    });
    delete h.groups;
  }

  LM.model = {
    SCHEMA, COLORS, AWG, GAUGES, COVERS, FLAGS, DEFAULT_NOTES, colorInfo, gaugeText,
    isConn, isLoose, node, seg, wire, set, other, nextRef, blank, addConnector, addNode, connect, splitSegment, removeNode, removeSegment, moveEnd,
    addWire, removeWires, wireStraight,
    holderOf, setWord, setPrefix, setTraits, parentOf, setOfWire, roots, wiresIn, chainOf, setChain, matchSet, crossing, membersFor, whyNot,
    makeSet, setFlag, dissolveSet, tidySets, setLength, setRun, ov, reach, setEnd, setRun, ov, pinList, label, wireName, endText, parseEnd,
    analyze, spanLength, checks, fromTo, bom, qtyText, normalize,
  };
})(window.LM = window.LM || {});
