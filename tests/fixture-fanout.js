/* A made-up harness for checking wire routing (no client data): a feed connector, three splices,
   and six connectors above, beside, and below them, each splice fanning single wires out to several
   of them, as a generator's splices do. LM.fixtures.fanout() returns a new harness. */
(function (LM) {
  'use strict';
  function fanout() {
    const M = LM.model, h = M.blank('Fan-out routing check');
    h.nodes = []; h.segments = []; h.wires = []; h.sets = []; h.place = {};
    const at = (n, x, y) => { h.place['n:' + n.id] = { x, y, v: 3 }; return n; };
    const J1 = at(M.addConnector(h, 0, 0, { family: 'generic-rect', pins: 4, ref: 'J1', name: 'Feed' }), -320, 260);
    const S = [at(M.addNode(h, 'splice', 0, 0), 0, 100), at(M.addNode(h, 'splice', 0, 0), 0, 300), at(M.addNode(h, 'splice', 0, 0), 0, 500)];
    const spots = [[360, -60], [700, 40], [420, 230], [760, 330], [380, 520], [720, 600]];
    const Ms = spots.map(([x, y], i) => at(M.addConnector(h, 0, 0, { family: 'generic-rect', pins: 4, ref: 'M' + (i + 1), name: 'Load ' + (i + 1) }), x, y));
    const colors = ['BK', 'RD', 'WH', 'BU'];
    S.forEach((s, i) => M.addWire(h, { node: J1.id, pin: String(i + 1) }, { node: s.id }, { color: colors[i], signal: 'FEED_' + (i + 1) }));
    const fan = [[[0, 1], [1, 1], [2, 2], [3, 2]], [[1, 2], [3, 1], [4, 1], [5, 2]], [[0, 3], [2, 1], [4, 2], [5, 1], [5, 3]]];
    fan.forEach((list, i) => list.forEach(([m, pin]) => M.addWire(h, { node: S[i].id }, { node: Ms[m].id, pin: String(pin) }, { color: colors[i] })));
    return M.normalize(h);
  }
  // Every direction: loads to the left of a splice and straight above and below it, a connector wired
  // from both its edges, and a bundle whose wires split to two parts at one end (a breakout).
  function directions() {
    const M = LM.model, h = M.blank('Directions routing check');
    h.nodes = []; h.segments = []; h.wires = []; h.sets = []; h.place = {};
    const at = (n, x, y) => { h.place['n:' + n.id] = { x, y, v: 3 }; return n; };
    const con = (ref, x, y, pins) => at(M.addConnector(h, 0, 0, { family: 'generic-rect', pins: pins || 4, ref, name: ref }), x, y);
    const S1 = at(M.addNode(h, 'splice', 0, 0), 300, 300);
    const X1 = con('X1', 620, 280, 6), L1 = con('L1', -120, 300), U1 = con('U1', 260, -20), D1 = con('D1', 270, 580);
    const R1 = con('R1', 1000, 140), R2 = con('R2', 1000, 420);
    const w = (a, ap, b, bp, color) => M.addWire(h, { node: a.id, pin: ap }, { node: b.id, pin: bp }, { color: color || 'BK' });
    w(X1, '1', S1, null, 'RD');
    w(S1, null, L1, '1', 'RD'); w(S1, null, U1, '2', 'RD'); w(S1, null, D1, '3', 'RD');
    const b1 = w(X1, '3', R1, '1', 'WH'), b2 = w(X1, '4', R1, '2', 'GN'), b3 = w(X1, '5', R2, '1', 'BU');
    M.makeSet(h, [b1.id, b2.id, b3.id], { bundle: true });
    return M.normalize(h);
  }
  LM.fixtures = Object.assign(LM.fixtures || {}, { fanout, directions });
})(window.LM = window.LM || {});
