// The demo harness: part of the made-up Smart Thermostat for "Acme Climate" that every Signoff tool's
// ?demo tells. It joins the Main PCBA to the Display & Sensor Board (with a ground splice) and the remote
// sensor, and carries 24 VAC from the Main PCBA to the wall plate. Pin labels are the boards' net names.
(function (LM) {
  'use strict';
  const M = LM.model;
  const VERSION = 11; // bump when the demo changes, so stored copies rebuild

  function harness() {
    const h = M.blank('Display & Sensor Harness');
    h.nodes = []; h.segments = []; h.wires = []; h.sets = [];
    Object.assign(h, { id: 'hdemo1', demoVersion: VERSION, pn: '2100430-001', rev: 'A', drawnBy: 'Dovetail', date: '2026-11-06' });
    const c = (ref, p, labels) => { const n = M.addConnector(h, 0, 0, p); n.ref = ref; labels.forEach((l, i) => { if (l) n.pinLabels[String(i + 1)] = l; }); return n; };
    const p1 = c('P1', { name: 'Main PCBA J6', family: 'jst-gh', pins: 8, mate: 'SM08B-GHS-TB' }, ['3V3', 'GND', 'I2C_SDA', 'I2C_SCL', 'TOUCH_INT', '', 'NTC', 'NTC_RTN']);
    const p4 = c('P4', { name: 'Main PCBA J2, 24 VAC in', family: 'molex-microfit', pins: 2, rows: 1 }, ['24VAC_R', '24VAC_C']);
    const p2 = c('P2', { name: 'Display & Sensor Board J1', family: 'jst-gh', pins: 6, mate: 'SM06B-GHS-TB' }, ['3V3', 'GND', 'I2C_SDA', 'I2C_SCL', 'TOUCH_INT', 'GND']);
    const p3 = c('P3', { name: 'Remote temperature sensor', family: 'jst-ph', pins: 2 }, ['NTC', 'NTC_RTN']);
    const p5 = c('P5', { name: 'Wall plate terminals R and C', family: 'flying', pins: 2 }, ['R', 'C']);
    const s1 = M.addNode(h, 'splice', 0, 0);
    // Lengths, face to face (mm).
    [[p1, p2, 250], [p1, s1, 190], [s1, p2, 60], [p1, p3, 500], [p4, p5, 260]].forEach(([a, b, len]) => M.connect(h, a.id, b.id, len));

    const w = (a, ap, b, bp, signal, color, gauge) => M.addWire(h, { node: a.id, pin: ap }, { node: b.id, pin: bp }, { signal, color, gauge });
    const v33 = w(p1, '1', p2, '1', '3V3', 'RD', '28');
    w(p1, '2', s1, null, 'GND', 'BK', '28');
    w(s1, null, p2, '2', 'GND', 'BK', '28');
    w(s1, null, p2, '6', 'GND', 'BK', '28');
    const sda = w(p1, '3', p2, '3', 'I2C_SDA', 'BU', '28');
    const scl = w(p1, '4', p2, '4', 'I2C_SCL', 'YE', '28');
    const tint = w(p1, '5', p2, '5', 'TOUCH_INT', 'GN', '28');
    const ntc = w(p1, '7', p3, '1', 'NTC', 'WH', '26');
    const rtn = w(p1, '8', p3, '2', 'NTC_RTN', 'BN', '26');
    const r = w(p4, '1', p5, '1', '24VAC_R', 'RD', '22');
    const cm = w(p4, '2', p5, '2', '24VAC_C', 'BU', '22');
    // The I2C pair is twisted and shielded, and laced into a bundle with 3V3 and TOUCH_INT.
    // The bundle is laced over 150 mm of the 250 mm run, 15 mm in from the left end and 85 mm
    // from the right, and the pair runs past it to both ends: 250 mm in all, connector to
    // connector.
    const pair = M.makeSet(h, [sda.id, scl.id], { twist: true, shield: true });
    const bundle = M.makeSet(h, [v33.id, sda.id, scl.id, tint.id], { bundle: true, over: { l: -15, r: -85 } });
    pair.over = { l: 15, r: 85 };
    M.makeSet(h, [ntc.id, rtn.id], { cable: true, note: '2 x 26 AWG, PVC jacket' });
    M.makeSet(h, [r.id, cm.id], { twist: true });

    // Placed by hand (Chris): P2's left side at P3's right side, S1's middle at TP1's right end,
    // and the S1 → P2 labels' left side a fifth of the way from S1's right side to P2's left, their
    // rows level with S1's output ports so the wires leave S1 parallel.
    // Taken from the auto layout and snapped to the 10 grid, so they follow it.
    const lay = () => LM.conn.layout(h, M.analyze(h));
    const up = v => Math.ceil(v / 10) * 10, near = v => Math.round(v / 10) * 10;
    let lo = lay();
    const at = n => lo.items.find(i => i.n && i.n.id === n.id);
    h.place = { ['n:' + p2.id]: { x: up(at(p3).x + at(p3).w), y: at(p2).y, v: 3 } };
    lo = lay();
    const box = lo.items.find(i => i.kind === 'box' && i.b.set && i.b.set.id === bundle.id);
    h.place['n:' + s1.id] = { x: near(box.x + box.sz.ext.get(pair.id).x1 - at(s1).w / 2), y: at(s1).y, v: 3 };
    lo = lay();
    const key = 'b:p:' + [s1.id, p2.id].sort().join('|'), labels = lo.items.find(i => i.key === key);
    const s1R = at(s1).x + at(s1).w;
    const first = labels.sz.rows.find(r => r.w).w, port = lo.endY(first.from.node === s1.id ? first.from : first.to);
    h.place[key] = { x: near(s1R + (at(p2).x - s1R) / 5), y: port - labels.sz.port0, v: 3 };
    return h;
  }
  LM.demo = { harness, VERSION };
})(window.LM = window.LM || {});
