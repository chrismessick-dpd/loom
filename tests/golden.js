/* Golden routes (2026-11-11): every harness route as the editor lays it out today, on the demo and the
   two routing checks, through a fixed sequence of edits (move a part while dragging, let go, shape a
   run, move again). Chris: the harness's routing is the baseline, so moving it into the shared engine
   (connect.js) must change none of it. LM.golden.run() gives the record; golden-data.js holds its hashes,
   taken before the move. Regenerate only on purpose: open tests/golden.html and save what it prints. */
(function (LM) {
  'use strict';
  // Seeded ids, so the fixtures are the same harness every time (route order breaks ties by key).
  function seeded(fn) {
    const real = Math.random;
    let s = 0x2545f491;
    Math.random = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    try { return fn(); } finally { Math.random = real; }
  }
  const r1 = v => Math.round(v * 10) / 10;
  function hash(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); }
  const term = T => [r1(T.x), r1(T.y), T.out || 0, T.in || 0, T.side || '', T.pins ? 1 : 0, T.stub == null ? '' : r1(T.stub)].join(',');
  function dump(h, view) {
    const M = LM.model, Lo = LM.conn.layout(h, M.analyze(h), view || {}), out = [];
    Lo.boxes.forEach((b, i) => {
      const P = b.item.path, R0 = P && P.route;
      if (!R0) { out.push(i + ':none'); return; }
      const pts = P.pts.map(p => r1(p.x) + ' ' + r1(p.y)).join(';');
      const br = R0.branches ? Array.from(R0.branches.values()).map(x => term(x.A) + '>' + term(x.B) + ':' + x.v.map(r1).join(',')).join('|') : '';
      out.push([i, b.wires.length, term(R0.A), term(R0.B), R0.v.map(r1).join(','), r1(R0.half), r1(R0.stub), r1(R0.r), R0.kept ? 'k' : '', R0.behind ? 'b' : '', hash(pts), hash(br)].join(' '));
    });
    return { routes: out, Lo };
  }
  function run() {
    const M = LM.model, rec = {};
    const one = (name, make, steps) => {
      const h = seeded(make);
      h.id = 'golden-' + name + '-' + Math.random().toString(36).slice(2);
      const got = [];
      got.push(dump(h).routes);
      (steps || []).forEach(st => { st(h); got.push(dump(h, st.view).routes); });
      rec[name] = got;
    };
    const moveNode = (ref, dx, dy, view) => {
      const f = h => {
        const n = h.nodes.find(x => x.ref === ref) || h.nodes.filter(x => x.kind === 'splice')[+ref.slice(1) || 0];
        const L = LM.conn.layout(h, M.analyze(h), {}), it = L.items.find(i => i.key === 'n:' + n.id);
        h.place = h.place || {};
        h.place['n:' + n.id] = { x: it.x + dx, y: it.y + dy, v: 3 };
      };
      f.view = view;
      return f;
    };
    const shapeFirst = h => {
      const L = LM.conn.layout(h, M.analyze(h), {}), b = L.boxes.find(x => x.item.path && x.item.path.route && x.item.path.route.v.length), R0 = b.item.path.route;
      const v = R0.v.slice(); v[0] = v[0] + 40;
      h.routes = Object.assign({}, h.routes, { [b.key]: { v, a: R0.A.side, b: R0.B.side } });
    };
    const behindFirst = h => {
      const L = LM.conn.layout(h, M.analyze(h), {}), b = L.boxes[L.boxes.length - 1];
      h.routes = Object.assign({}, h.routes, { [b.key]: Object.assign({}, h.routes && h.routes[b.key], { mode: 'behind' }) });
    };
    one('demo', () => LM.demo.harness(), [moveNode('S0', 60, 0, { fast: true }), moveNode('S0', 0, 0), shapeFirst, behindFirst]);
    one('fanout', () => LM.fixtures.fanout(), [moveNode('M3', 60, 0, { fast: true }), moveNode('M3', 0, 0), moveNode('M4', -60, 40), shapeFirst, moveNode('J1', 0, 60), behindFirst]);
    one('directions', () => LM.fixtures.directions(), [moveNode('X1', 0, 40, { fast: true }), moveNode('X1', 0, 0), shapeFirst, moveNode('R2', -200, 0), behindFirst]);
    return rec;
  }
  // The first difference between two records, or null.
  function diff(a, b) {
    for (const k of Object.keys(b)) {
      if (!a[k]) return k + ': missing';
      for (let s = 0; s < b[k].length; s++) {
        const x = a[k][s] || [], y = b[k][s];
        for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return `${k} step ${s} route ${i}\n  got:  ${x[i]}\n  want: ${y[i]}`;
      }
    }
    return null;
  }
  // The record as one hash per step (golden-data.js keeps these; a failure names the step, and
  // golden.html on the old code prints the routes to compare).
  function hashes(rec) { return Object.fromEntries(Object.entries(rec).map(([k, s]) => [k, s.map(x => hash(x.join(String.fromCharCode(10))))])); }
  LM.golden = { run, diff, seeded, hashes };
})(window.LM = window.LM || {});
