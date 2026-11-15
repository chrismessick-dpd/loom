// Formboard router cases (docs/formboard.md), shared by tests/test.html and `node tests/fbroute-cases.js`.
// Chris's cube (2026-11-15): blocks 1 and 2 at opposite corners of a 300 mm cube; green channels down the
// front and over the right, a yellow (exclusive) shortcut across the top.
(function (root) {
  const R = root.fbroute;
  const G1 = { id: 'g1', pts: [[0, 0, 0], [120, 0, 0], [120, 0, 300]], w: 20, h: 20, classes: ['green'] };
  const G2 = { id: 'g2', pts: [[120, 0, 150], [250, 0, 150], [250, 0, 300], [300, 0, 300], [300, 300, 300]], w: 20, h: 20, classes: ['green'] };
  const Y1 = { id: 'y1', pts: [[120, 0, 300], [300, 300, 300]], w: 20, h: 20, classes: ['yellow'], exclusive: true };
  const CUBE = [G1, G2, Y1];
  const P1 = [0, 0, 0], P2 = [300, 300, 300];
  const near = (a, b, tol) => Math.abs(a - b) <= (tol || 0.01);
  const cases = [];
  const t = (name, fn) => cases.push({ name, fn });

  t('cube: an untagged cable stays in the green', () => {
    const r = R.route(R.build(CUBE), { id: 'c', ends: [{ key: 'a', p: P1 }, { key: 'b', p: P2 }] }, { roundMm: 1 });
    if (!r.ok) throw new Error('not routed');
    const L = r.legs[0];
    if (!near(L.path, 900)) throw new Error('path ' + L.path);
    if (L.channels.y1) throw new Error('used yellow');
  });
  t('cube: a yellow cable takes the shorter way through the yellow', () => {
    const r = R.route(R.build(CUBE), { id: 'c', classes: ['yellow'], ends: [{ key: 'a', p: P1 }, { key: 'b', p: P2 }] }, { roundMm: 1 });
    const L = r.legs[0], diag = Math.hypot(180, 300);
    if (!near(L.path, 120 + 300 + diag)) throw new Error('path ' + L.path);
    if (!L.channels.y1 || !L.channels.g1) throw new Error('channels ' + JSON.stringify(L.channels));
  });
  t('a channel that isn’t exclusive takes every cable', () => {
    const open = CUBE.map(c => Object.assign({}, c, { exclusive: false }));
    const r = R.route(R.build(open), { id: 'c', ends: [{ key: 'a', p: P1 }, { key: 'b', p: P2 }] }, { roundMm: 1 });
    if (!r.legs[0].channels.y1) throw new Error('should use yellow');
  });
  t('no allowed path: Not routed, with the straight length', () => {
    const r = R.route(R.build([Y1]), { id: 'c', ends: [{ key: 'a', p: P1 }, { key: 'b', p: P2 }] }, {});
    if (r.ok || !r.flags.includes('not-routed')) throw new Error('should not route');
    if (!near(r.legs[0].straight, Math.hypot(300, 300, 300))) throw new Error('straight ' + r.legs[0].straight);
    if (r.length !== null) throw new Error('length should be null');
  });
  t('build length: slack, extra per meter, end allowances, rounded up to 10 mm', () => {
    const L = R.buildLength({ path: 1000, drops: 50, channels: { a: 600, b: 400 }, extraPerM: { a: 100 }, ends: [50, 25] }, { slackPct: 5, roundMm: 10 });
    // 1050 + 52.5 slack + 60 extra + 75 ends = 1237.5 → 1240
    if (!near(L.raw, 1237.5) || L.length !== 1240) throw new Error(JSON.stringify(L));
    const exact = R.buildLength({ path: 1230, drops: 0, channels: {} }, { roundMm: 10 });
    if (exact.length !== 1230) throw new Error('an exact multiple stays ' + exact.length);
  });
  t('end allowances: the formboard’s, and a cable end’s own', () => {
    const r = R.route(R.build(CUBE), { id: 'c', endMm: { b: 100 }, ends: [{ key: 'a', p: P1 }, { key: 'b', p: P2 }] }, { endMm: 40, roundMm: 1 });
    if (!near(r.legs[0].parts.ends, 140)) throw new Error('ends ' + r.legs[0].parts.ends);
  });
  t('channels crossing clear of each other don’t join', () => {
    const a = { id: 'a', pts: [[0, 0, 0], [200, 0, 0]], w: 20, h: 20 }, b = { id: 'b', pts: [[100, -100, 50], [100, 100, 50]], w: 20, h: 20 };
    if (R.build([a, b]).joins.length) throw new Error('joined');
    const touching = R.build([a, Object.assign({}, b, { pts: [[100, -100, 15], [100, 100, 15]] })]);
    if (touching.joins.length !== 1) throw new Error('should join within half of both widths');
  });
  t('crossing in a plane joins in the middle', () => {
    const a = { id: 'a', pts: [[0, 0, 0], [200, 0, 0]], w: 10, h: 10 }, b = { id: 'b', pts: [[100, -100, 0], [100, 100, 0]], w: 10, h: 10 };
    const r = R.route(R.build([a, b]), { id: 'c', ends: [{ key: 'a', p: [0, 0, 0] }, { key: 'b', p: [100, 100, 0] }] }, { roundMm: 1 });
    if (!near(r.legs[0].path, 200)) throw new Error('path ' + r.legs[0].path);
  });
  t('drops count, and a long drop is flagged', () => {
    const a = { id: 'a', pts: [[0, 0, 0], [1000, 0, 0]], w: 10, h: 10 };
    const r = R.route(R.build([a]), { id: 'c', ends: [{ key: 'a', p: [0, 50, 0] }, { key: 'b', p: [1000, 400, 0] }] }, { dropMax: 300, roundMm: 1 });
    if (!near(r.legs[0].drops, 450) || !near(r.legs[0].path, 1000)) throw new Error(JSON.stringify(r.legs[0]));
    if (!r.flags.includes('long-drop')) throw new Error('should flag the 400 mm drop');
  });
  t('a nearest channel that leads nowhere: the next nearest is tried', () => {
    const main = { id: 'm', pts: [[0, 0, 0], [1000, 0, 0]], w: 10, h: 10 }, stub = { id: 's', pts: [[0, 60, 0], [100, 60, 0]], w: 10, h: 10 };
    const r = R.route(R.build([main, stub]), { id: 'c', ends: [{ key: 'a', p: [50, 80, 0] }, { key: 'b', p: [900, 10, 0] }] }, { roundMm: 1 });
    if (!r.ok) throw new Error('should route by the main channel');
    if (!near(r.legs[0].dropA, 80) || r.legs[0].channels.s) throw new Error(JSON.stringify(r.legs[0]));
  });
  t('both ends on one channel run along it', () => {
    const a = { id: 'a', pts: [[0, 0, 0], [1000, 0, 0]], w: 10, h: 10 };
    const r = R.route(R.build([a]), { id: 'c', ends: [{ key: 'a', p: [200, 10, 0] }, { key: 'b', p: [700, 10, 0] }] }, { roundMm: 1 });
    if (!near(r.legs[0].path, 500) || !near(r.legs[0].drops, 20)) throw new Error(JSON.stringify(r.legs[0]));
  });
  t('a via steers the cable through a channel', () => {
    const net = R.build(CUBE.map(c => Object.assign({}, c, { exclusive: false })));
    const r = R.route(net, { id: 'c', vias: ['g2'], ends: [{ key: 'a', p: P1 }, { key: 'b', p: P2 }] }, { roundMm: 1 });
    if (!r.legs[0].channels.g2) throw new Error('should pass g2: ' + JSON.stringify(r.legs[0].channels));
  });
  t('a pinned cable keeps its route', () => {
    const kept = { ok: true, legs: [{ ok: true, pts: [P1, P2], length: 777 }], length: 777, flags: [] };
    const r = R.route(R.build(CUBE), { id: 'c', pinned: true, route: kept, ends: [{ key: 'a', p: P1 }, { key: 'b', p: P2 }] }, {});
    if (r.length !== 777 || !r.pinned) throw new Error(JSON.stringify(r));
  });
  t('three ends: a leg to each, no single length', () => {
    const r = R.route(R.build(CUBE), { id: 'c', ends: [{ key: 'a', p: P1 }, { key: 'b', p: P2 }, { key: 'c', p: [250, 0, 160] }] }, { roundMm: 1 });
    if (r.legs.length !== 2 || r.length !== null || !r.ok) throw new Error(JSON.stringify(r));
  });
  t('fill: each channel’s cables against its section', () => {
    const out = R.routeAll(CUBE, [{ id: 'c1', areaMm2: 40, ends: [{ key: 'a', p: P1 }, { key: 'b', p: P2 }] }, { id: 'c2', areaMm2: 60, classes: ['yellow'], ends: [{ key: 'a', p: P1 }, { key: 'b', p: P2 }] }], {});
    if (out.fill.g1.area !== 100 || !near(out.fill.g1.pct, 25)) throw new Error(JSON.stringify(out.fill.g1));
    if (out.fill.y1.area !== 60) throw new Error(JSON.stringify(out.fill.y1));
  });
  root.fbrouteCases = cases;
  if (typeof module !== 'undefined' && typeof require !== 'undefined' && require.main === module) {
    let bad = 0;
    cases.forEach(c => { try { c.fn(); console.log('ok   ' + c.name); } catch (e) { bad++; console.log('FAIL ' + c.name + ': ' + e.message); } });
    console.log(bad ? bad + ' failed' : 'all ' + cases.length + ' passed');
    process.exitCode = bad ? 1 : 0;
  }
})(typeof window !== 'undefined' ? window.LM : { fbroute: require('../assets/fbroute.js').fbroute });
