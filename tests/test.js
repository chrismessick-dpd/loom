/* Loom tests: the harness file (envelope and summary), the merge, name and part number from Signoff
   PL, and sync against a fake GitHub (fake-hub.js, copied from Signoff PL). */
(function () {
  'use strict';
  const R = LM.store, M = LM.model, SG = window.Signoff;
  const out = document.getElementById('out');
  const results = [];
  const NSP = 'loom.test.';
  function clearNs() { Object.keys(localStorage).filter(k => k.indexOf(NSP) === 0).forEach(k => localStorage.removeItem(k)); }
  R.setNamespace(NSP);

  function eq(a, b, msg) {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) throw new Error((msg || 'not equal') + '\n  got:  ' + sa + '\n  want: ' + sb);
  }
  function ok(v, msg) { if (!v) throw new Error(msg || 'expected true'); }
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  function harness(title, extra) {
    const h = M.blank(title);
    Object.assign(h, extra || {});
    return M.normalize(h);
  }
  const stable = v => SG.model.stableStringify(v);

  // ── Wire routes (route.js) ──
  const RT = LM.route;
  const A = { x: 0, y: 0, out: 1 }, B = { x: 300, y: 100, in: 1 };
  test('route: v sets the middle runs, and the end runs belong to the terminals', () => {
    eq(RT.corners(A, B, [150]), [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 100 }, { x: 300, y: 100 }]);
    eq(RT.runs(A, B, [100, 50, 200]).map(r => [r.axis, r.k]), [['h', -1], ['v', 0], ['h', 1], ['v', 2], ['h', -1]]);
    ok(RT.fits(A, B, [150], 20), 'a Z fits');
    ok(!RT.fits(A, B, [10], 20), 'a vertical run inside the stub does not');
    ok(!RT.fits(A, B, [150, 40], 20), 'an even count does not');
    ok(RT.fits(A, { x: 300, y: 0, in: 1 }, [], 20), 'level terminals may be joined straight');
  });
  test('route: a run dragged flush with its neighbor merges, and a bend can be added back', () => {
    eq(RT.tidy(A, B, [100, 50, 100]), [100], 'a level run of no length goes');
    eq(RT.tidy(A, B, [100, 0, 200]), [200], 'a vertical run of no length goes with the level run before it');
    eq(RT.tidy(A, { x: 300, y: 0, in: 1 }, [150]), [], 'a vertical run between level terminals goes');
    const b = RT.addBend(A, B, [150], 2, { x: 220, y: 100 });
    eq(b, { v: [150, 100, 220], k: 1 }, 'a bend in the last run');
    eq(RT.tidy(A, B, b.v), [150], 'an unmoved bend tidies away');
    eq(RT.addBend(A, B, [150], 0, { x: 60, y: 0 }), { v: [60, 0, 150], k: 1 }, 'a bend in the first run');
    eq(RT.addBend(A, B, [150], 1, { x: 150, y: 40 }), { v: [150, 40, 150], k: 2 }, 'a bend in a vertical run');
  });
  test('route: shape rounds the corners and keeps the ends exact', () => {
    const s = RT.shape(A, B, [150], 20), p0 = s.pts[0], z = s.pts[s.pts.length - 1];
    eq([p0.x, p0.y, z.x, z.y], [0, 0, 300, 100]);
    ok(Math.abs(s.S - (300 + 100 - 4 * 20 + Math.PI * 20)) < 0.5, 'length is the runs less the corners plus two quarter circles: ' + s.S);
    ok(s.pts.every(p => Math.abs(Math.hypot(p.nx, p.ny) - 1) < 1e-6), 'unit normals');
    eq([p0.nx, p0.ny], [-0, 1], 'the normal is on the left of travel (down the screen going right)');
  });
  test('route: auto goes round a part in the way and keeps clear of a route laid before it', () => {
    const G = RT.grid({ x0: -100, y0: -200, x1: 400, y1: 300 }, 10);
    const T = { x: 300, y: 0, in: 1 }, wall = { x0: 130, y0: -60, x1: 170, y1: 60 };
    const v = RT.auto(G, A, T, [wall], 20);
    ok(v && v.length >= 3, 'it bends round the wall: ' + JSON.stringify(v));
    const hit = RT.runs(A, T, v).some(r => Math.max(r.a.x, r.b.x) >= wall.x0 && Math.min(r.a.x, r.b.x) <= wall.x1 && Math.max(r.a.y, r.b.y) >= wall.y0 && Math.min(r.a.y, r.b.y) <= wall.y1);
    ok(!hit, 'no run enters the wall');
    RT.occupy(G, A, T, [], 12);   // a trunk about 24 wide along y = 0
    const A2 = { x: 0, y: 10, out: 1 }, T2 = { x: 300, y: 10, in: 1 }, v2 = RT.auto(G, A2, T2, [], 20);
    ok(v2 && v2.length >= 3, 'a second route between the same ends moves off the first: ' + JSON.stringify(v2));
  });

  // ── Routes in the diagram (conn.js) ──
  const inside = (p, q, r) => {
    // Whether the segment p–q passes through the inside of rectangle r (its edges don't count).
    const x0 = r.x + 1, y0 = r.y + 1, x1 = r.x + r.w - 1, y1 = r.y + r.h - 1;
    if (Math.abs(p.y - q.y) < 0.01) return p.y > y0 && p.y < y1 && Math.max(p.x, q.x) > x0 && Math.min(p.x, q.x) < x1;
    return p.x > x0 && p.x < x1 && Math.max(p.y, q.y) > y0 && Math.min(p.y, q.y) < y1;
  };
  test('routes: every wire starts and ends at its pins, and no route runs through a part', () => {
    [LM.demo.harness(), LM.fixtures.fanout(), LM.fixtures.directions()].forEach(h => {
      const Lo = LM.conn.layout(h, M.analyze(h), {});
      h.wires.forEach(w => {
        const p = Lo.wirePath(w), m = /^M([-\d.]+) ([-\d.]+)/.exec(p.d), a = p.ends[0].at;
        ok(m && Math.abs(+m[1] - a.x) < 0.2 && Math.abs(+m[2] - a.y) < 0.2, h.title + ': ' + M.wireName(w) + ' starts at its pin');
      });
      const parts = Lo.items.filter(i => i.kind === 'conn' || i.kind === 'splice');
      Lo.boxes.forEach(b => {
        const P = b.item.path;
        ok(P && P.routed, b.key + ' is routed');
        LM.route.runs(P.route.A, P.route.B, P.route.v).forEach(r => parts.forEach(it => {
          ok(!inside(r.a, r.b, it), h.title + ': ' + b.key + ' runs through ' + (it.n.ref || it.n.id));
        }));
      });
    });
  });
  test('routes: no wire kinks (turns tighter than radius 6) on the demo or the routing checks', () => {
    [LM.demo.harness(), LM.fixtures.fanout(), LM.fixtures.directions()].forEach(h => {
      const Lo = LM.conn.layout(h, M.analyze(h), {});
      h.wires.forEach(w => {
        const ln = Lo.lane(w);
        if (!ln) return;
        // Even samples 2 apart along the wire, then the turn over each 8.
        const P = [];
        for (let s = 0; s <= ln.S; s += 2) { let i = 1; while (i < ln.pts.length - 1 && ln.pts[i].s < s) i++; const a = ln.pts[i - 1], b = ln.pts[i], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0; P.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
        for (let i = 2; i < P.length - 2; i++) {
          const a = P[i - 2], o = P[i], c = P[i + 2];
          let t = Math.atan2(c.y - o.y, c.x - o.x) - Math.atan2(o.y - a.y, o.x - a.x);
          while (t > Math.PI) t -= 2 * Math.PI;
          while (t < -Math.PI) t += 2 * Math.PI;
          ok(4 / Math.max(1e-6, Math.abs(t)) >= 6, h.title + ': ' + M.wireName(w) + ' kinks near ' + Math.round(o.x) + ', ' + Math.round(o.y));
        }
      });
    });
  });
  test('routes: a wide route dragged into small steps bends no tighter than its wires can follow', () => {
    // Chris's demo, B1 dragged down 30, up 10, and down 50 within about 100 (2026-11-10).
    const h = LM.demo.harness(), b1 = h.sets.find(s => s.label === 'B1'), key = 'g:' + b1.id;
    const R0 = LM.conn.layout(h, M.analyze(h), {}).boxes.find(x => x.key === key).item.path.route, x1 = R0.A.x + 380;
    h.routes = { [key]: { v: [x1, R0.A.y + 30, x1 + 70, R0.A.y + 20, x1 + 100, R0.B.y + 10, R0.B.x - R0.stub - 10], a: R0.A.side, b: R0.B.side } };
    [h, LM.demo.harness(), LM.fixtures.fanout(), LM.fixtures.directions()].forEach(x => {
      const Lo = LM.conn.layout(x, M.analyze(x), {});
      Lo.boxes.forEach(b => {
        const P = b.item.path, half = P.route.half, pts = P.pts;
        // The turn over each 8 units of the path, as a radius.
        const E = [];
        for (let s = 0; s <= P.S; s += 4) { let i = 1; while (i < pts.length - 1 && pts[i].s < s) i++; const a = pts[i - 1], c = pts[i], t = c.s > a.s ? (s - a.s) / (c.s - a.s) : 0; E.push({ x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t }); }
        for (let i = 2; i < E.length - 2; i++) {
          const a = E[i - 2], o = E[i], c = E[i + 2];
          let t = Math.atan2(c.y - o.y, c.x - o.x) - Math.atan2(o.y - a.y, o.x - a.x);
          while (t > Math.PI) t -= 2 * Math.PI;
          while (t < -Math.PI) t += 2 * Math.PI;
          ok(8 / Math.max(1e-6, Math.abs(t)) >= half, x.title + ': ' + b.key + ' bends tighter than its half-width ' + half + ' near ' + Math.round(o.x) + ', ' + Math.round(o.y));
        }
      });
    });
  });
  test('routes: the harness routes exactly as before the shared engine (golden.js)', () => {
    const got = LM.golden.hashes(LM.golden.run()), want = LM.goldenData;
    Object.keys(want).forEach(k => want[k].forEach((x, i) => eq(got[k] && got[k][i], x, `${k}, step ${i}: routes differ (open tests/golden.html here and on the old code to compare)`)));
  });
  test('routes: a shaped route is kept when its parts move, and Real proportions draws boxes', () => {
    const h = LM.fixtures.fanout(), Lo = LM.conn.layout(h, M.analyze(h), {}), b = Lo.boxes[0], R0 = b.item.path.route;
    const v = R0.v.length ? R0.v.map((x, k) => (k % 2 ? x + 20 : x)) : [R0.A.x + R0.A.out * (R0.stub + 30)];
    h.routes = { [b.key]: { v } };
    const node = h.nodes.find(n => n.id === R0.B.node) || h.nodes.find(n => n.id === R0.A.node);
    h.place['n:' + node.id].y += 20;
    const L2 = LM.conn.layout(h, M.analyze(h), {}), P2 = L2.boxes.find(x => x.key === b.key).item.path;
    eq(P2.route.v, v, 'the middle runs stay where they were shaped');
    ok(P2.route.kept, 'and it says so');
    // A second wire joining a lone one between the same two parts keeps the pair's shape.
    const lone = L2.boxes.find(x => x.kind === 'stack' && x.wires.length === 1 && x.item.path.route.A.pins && x.item.path.route.B.pins);
    if (lone) {
      const R1 = lone.item.path.route, w0 = lone.wires[0], v1 = [R1.A.x + R1.A.out * (R1.stub + 60)];
      h.routes[lone.key] = { v: v1 };
      const a = w0.from, bEnd = w0.to, na = M.node(h, a.node), nb = M.node(h, bEnd.node);
      // On the pins next to the first wire's (a wire to pins further off gets a route of its own).
      const used = (n, p) => h.wires.some(x => (x.from.node === n.id && x.from.pin === p) || (x.to.node === n.id && x.to.pin === p));
      const next = (n, pin) => { const L = M.pinList(n), i = L.indexOf(pin); return [L[i + 1], L[i - 1]].find(p => p != null && !used(n, p)); };
      M.addWire(h, { node: a.node, pin: M.isConn(na) ? next(na, a.pin) : null }, { node: bEnd.node, pin: M.isConn(nb) ? next(nb, bEnd.pin) : null });
      const L4 = LM.conn.layout(h, M.analyze(h), {}), now = L4.boxes.find(x => x.wires.some(y => y.id === w0.id));
      eq(now.key, lone.key, 'the pair keeps its key');
      eq(now.wires.length, 2);
      ok(now.item.path.route.kept, 'and its shape');
    }
    const L3 = LM.conn.layout(h, M.analyze(h), { prop: true });
    ok(L3.boxes.every(x => !x.item.path.routed), 'Real proportions keeps its straight boxes');
  });

  // ── The file ──
  test('envelope and unwrap round-trip a harness', () => {
    const h = harness('Sensor harness', { pn: 'DT-2100', rev: 'B', project: 'Smart Thermostat', updated: Date.parse('2026-11-07T10:00:00Z'), updatedBy: 'alice' });
    const doc = R.envelope(h);
    eq(doc.id, h.id);
    eq(doc.meta, { name: 'Sensor harness', number: 'DT-2100', revision: 'B', project: 'Smart Thermostat', deleted: false, updatedAt: '2026-11-07T10:00:00.000Z', updatedBy: 'alice' });
    const back = R.unwrap(JSON.parse(stable(doc)));
    eq(stable(back), stable(h), 'harness survives the file');
    eq(R.unwrap({ id: 'other', harness: h }), null, 'a file whose harness has another id is refused');
  });

  test('the summary describes the harness for Signoff PL', () => {
    const h = LM.demo.harness();
    const doc = R.envelope(h);
    const s = R.summarize(doc);
    eq([s.tool, s.name, s.number, s.project], ['loom', 'Display & Sensor Harness', '2200430-001', 'Zone Controller']);
    eq([s.total, s.reviewed, s.pct], [0, 0, 0], 'a harness has no checks to review');
    eq(s.harness.wires, h.wires.length);
    eq(s.harness.ends, h.nodes.filter(M.isConn).length);
    ok(s.harness.wireMm > 0, 'wire length summed');
  });

  // ── Merge ──
  test('merge: a copy with no edits since the last sync takes the stored one', () => {
    const a = harness('A'), b = JSON.parse(JSON.stringify(a));
    b.title = 'A, edited elsewhere'; b.updated = a.updated + 1000;
    const lost = [];
    const merge = R.makeMerge(() => false, l => lost.push(l));
    eq(merge(R.envelope(a), R.envelope(b)).harness.title, 'A, edited elsewhere');
    eq(lost.length, 0);
  });
  test('merge: both edited, the newer wins and the other is kept', () => {
    const a = harness('A'), b = JSON.parse(JSON.stringify(a));
    a.title = 'Mine'; a.updated = Date.parse('2026-11-07T10:00:00Z');
    b.title = 'Theirs'; b.updated = Date.parse('2026-11-07T11:00:00Z');
    const lost = [];
    const merge = R.makeMerge(() => true, l => lost.push(l));
    eq(merge(R.envelope(a), R.envelope(b)).harness.title, 'Theirs');
    eq(lost.map(d => d.harness.title), ['Mine']);
  });
  test('merge: both "edited" to the same harness is no conflict', () => {
    const a = harness('A');
    const lost = [];
    const merge = R.makeMerge(() => true, l => lost.push(l));
    merge(R.envelope(a), JSON.parse(stable(R.envelope(a))));
    eq(lost.length, 0);
  });

  // ── Name and part number from Signoff PL ──
  test('adoptFromPl: a newer PL edit comes over; an older one does not', () => {
    const h = harness('Old name', { pn: 'P-1', identAt: '2026-11-07T10:00:00.000Z' });
    ok(!R.adoptFromPl(h, [{ name: 'PL name', number: 'P-2', identAt: '2026-11-07T09:00:00.000Z' }]), 'older ignored');
    eq([h.title, h.pn], ['Old name', 'P-1']);
    ok(!R.adoptFromPl(h, [{ name: 'PL name', number: 'P-2', identAt: '' }]), 'unstamped ignored');
    ok(R.adoptFromPl(h, [{ name: 'PL name', number: 'P-2', identAt: '2026-11-07T11:00:00.000Z' }, { name: 'Older PL', number: 'P-3', identAt: '2026-11-07T10:30:00.000Z' }]));
    eq([h.title, h.pn, h.identAt], ['PL name', 'P-2', '2026-11-07T11:00:00.000Z']);
    ok(!R.adoptFromPl(h, [{ name: 'PL name', number: 'P-2', identAt: '2026-11-07T11:00:00.000Z' }]), 'the same stamp twice does nothing');
  });
  test('slimPl keeps a PL project\'s live Loom Parts with their place in the tree', () => {
    const doc = { id: 'pl1', slug: 'x', meta: { name: 'Acme Gizmo', clientProject: 'Gizmo' }, nodes: {
      top: { id: 'top', parent: '', kind: 'assembly', name: 'Gizmo' },
      cab: { id: 'cab', parent: 'top', kind: 'assembly', name: 'Harnesses' },
      n1: { id: 'n1', parent: 'cab', kind: 'part', name: 'Main harness', number: 'H-1', source: 'loom', ref: { tool: 'loom', id: 'h1' }, identAt: 'T' },
      n2: { id: 'n2', parent: 'cab', kind: 'part', name: 'Gone', source: 'loom', ref: { tool: 'loom', id: 'h2' }, deleted: true },
      n3: { id: 'n3', parent: 'top', kind: 'part', name: 'Board', source: 'ee', ref: { tool: 'ee', id: 'p1' } } } };
    const s = R.slimPl(doc);
    eq([s.name, s.clientProject], ['Acme Gizmo', 'Gizmo']);
    eq(s.parts, [{ ref: 'h1', node: 'n1', name: 'Main harness', number: 'H-1', identAt: 'T', path: ['Gizmo', 'Harnesses'] }]);
  });

  // ── From Signoff PL: Parts waiting to be started in Loom ──
  const waitDoc = () => ({ id: 'pl1', slug: 'x', meta: { name: 'Acme Gizmo', clientProject: '' }, nodes: {
    top: { id: 'top', parent: '', kind: 'assembly', name: 'Gizmo' },
    w1: { id: 'w1', parent: 'top', kind: 'part', name: 'Pump harness', number: 'H-3', source: 'loom', ref: null },
    w2: { id: 'w2', parent: 'top', kind: 'part', name: 'Gone', source: 'loom', ref: null, deleted: true },
    w3: { id: 'w3', parent: 'top', kind: 'part', name: 'Bought', source: 'purchased', ref: null },
    w4: { id: 'w4', parent: 'top', kind: 'part', name: 'New board', source: 'ee', ref: null } } });
  test('slimPl lists the live Parts waiting for Loom, with the client project PL matches by', () => {
    const s = R.slimPl(waitDoc());
    eq(s.planned, [{ node: 'w1', name: 'Pump harness', number: 'H-3', path: ['Gizmo'] }]);
    eq(s.clientProject, 'Acme Gizmo', 'no client project: the PL project\'s name, as PL\'s tray matches');
  });
  test('waiting and startFromPl: Start makes a harness that names its Part, and the Part leaves the list', () => {
    const pl = R.plIndex([R.slimPl(waitDoc())]);
    eq(pl.planned.map(p => [p.project, p.node, p.projectName, p.clientProject]), [['pl1', 'w1', 'Acme Gizmo', 'Acme Gizmo']]);
    eq(R.waiting(pl, []).length, 1);
    const h = R.startFromPl(harness('Untitled'), pl.planned[0]);
    eq([h.title, h.pn, h.project, h.plPart.project, h.plPart.node], ['Pump harness', 'H-3', 'Acme Gizmo', 'pl1', 'w1']);
    ok(/^\d{4}-\d\d-\d\dT/.test(h.plPart.at), 'stamped with when it was started, for PL’s tie-break');
    eq(R.waiting(pl, [h]), [], 'started: off the list');
    eq(R.waiting(pl, [Object.assign({}, h, { deleted: true })]).length, 1, 'its harness deleted: back on the list');
    const doc = JSON.parse(stable(R.envelope(h)));
    const kept = R.unwrap(doc).plPart;
    eq([kept.project, kept.node], ['pl1', 'w1'], 'the harness keeps it through the file');
    eq(R.summarize(doc).plPart, { project: 'pl1', node: 'w1', at: h.plPart.at }, 'the summary names the Part, for PL to link');
    eq(R.summarize(R.envelope(harness('Plain'))).plPart, undefined, 'a harness not started from PL names none');
  });

  // ── Sync against a fake GitHub ──
  const OWNER = 'acme-test';
  function setup() {
    clearNs();
    localStorage.setItem(NSP + 'repos', JSON.stringify({ owner: OWNER }));
    const hub = new FakeHub();
    hub.makeRepo(OWNER + '/loom_data', { 'README.md': '# data' }, ['alice', 'bob']);
    return hub;
  }
  const opts = hub => ({ token: 'tok-alice', fetch: hub.fetchFor('tok-alice') });
  const file = (hub, id) => JSON.parse(hub.files(OWNER + '/loom_data')['projects/' + id + '.json']);

  test('sync pushes local harnesses as Signoff-shaped files', async () => {
    const hub = setup();
    const h = harness('First', { project: 'Gizmo' });
    const res = await R.sync({ [h.id]: h }, opts(hub));
    eq(res.pushed, 1);
    const f = file(hub, h.id);
    eq([f.id, f.meta.name, f.meta.project, f.summary.tool, f.summary.project], [h.id, 'First', 'Gizmo', 'loom', 'Gizmo']);
    eq(hub.files(OWNER + '/loom_data')['projects/' + h.id + '.json'], stable(f), 'written with stableStringify, as Signoff writes');
    eq(res.login, 'alice');
    eq(R.unsynced(res.store), [], 'nothing left unsynced');
    const again = await R.sync(res.store, opts(hub));
    eq(again.pushed, 0, 'a second sync has nothing to push');
  });

  test('sync: an untouched copy takes another browser\'s edit', async () => {
    const hub = setup();
    const h = harness('Shared');
    let res = await R.sync({ [h.id]: h }, opts(hub));
    const f = file(hub, h.id);
    f.harness.title = 'Renamed by bob'; f.harness.updated += 5000; f.meta.name = 'Renamed by bob';
    hub.push(OWNER + '/loom_data', Object.assign(hub.files(OWNER + '/loom_data'), { ['projects/' + h.id + '.json']: stable(f) }));
    res = await R.sync(res.store, opts(hub));
    eq(res.store[h.id].title, 'Renamed by bob');
    eq(res.conflicts.length, 0);
  });

  test('sync: edits on both sides keep both (newer wins, the other as a conflict copy)', async () => {
    const hub = setup();
    const h = harness('Both');
    let res = await R.sync({ [h.id]: h }, opts(hub));
    const f = file(hub, h.id);
    f.harness.title = 'Theirs'; f.harness.updated = Date.now() + 60000;
    hub.push(OWNER + '/loom_data', Object.assign(hub.files(OWNER + '/loom_data'), { ['projects/' + h.id + '.json']: stable(f) }));
    const mine = res.store[h.id];
    mine.title = 'Mine'; mine.updated = Date.now();
    res = await R.sync(res.store, opts(hub));
    eq(res.store[h.id].title, 'Theirs');
    eq(res.conflicts.map(c => c.title), ['Mine (conflict copy)']);
    // The copy goes up with the next sync.
    const copy = res.conflicts[0];
    res = await R.sync(Object.assign({}, res.store, { [copy.id]: copy }), opts(hub));
    eq(res.pushed, 1);
    eq(file(hub, copy.id).meta.name, 'Mine (conflict copy)');
  });

  test('sync: forget() makes an edit made during a sync merge with the change that sync brought', async () => {
    const hub = setup();
    const h = harness('Racing');
    let res = await R.sync({ [h.id]: h }, opts(hub));
    // Bob changes it; this browser's sync brings his change while the harness is being edited here.
    const f = file(hub, h.id);
    f.harness.title = 'Bob'; f.harness.updated = Date.now() - 60000;
    hub.push(OWNER + '/loom_data', Object.assign(hub.files(OWNER + '/loom_data'), { ['projects/' + h.id + '.json']: stable(f) }));
    const mine = JSON.parse(JSON.stringify(res.store[h.id]));
    res = await R.sync(res.store, opts(hub));
    eq(res.store[h.id].title, 'Bob');
    mine.title = 'Mine, edited during that sync'; mine.updated = Date.now();
    R.forget([h.id]);   // what the app does when it keeps such an edit
    res = await R.sync(Object.assign({}, res.store, { [h.id]: mine }), opts(hub));
    eq(res.store[h.id].title, 'Mine, edited during that sync');
    eq(res.conflicts.map(c => c.title), ['Bob (conflict copy)'], 'Bob’s change is kept, not pushed over');
  });

  test('base() is the harness as the last sync left it, for Discard changes', async () => {
    const hub = setup();
    const h = harness('Kept');
    eq(R.base(h.id), null, 'never synced: nothing to go back to');
    const res = await R.sync({ [h.id]: h }, opts(hub));
    const edited = res.store[h.id];
    edited.title = 'Edited here'; edited.updated = Date.now();
    eq(R.unsynced({ [h.id]: edited }), [h.id]);
    const b = R.base(h.id);
    eq(b.title, 'Kept');
    eq(R.unsynced({ [h.id]: b }), [], 'the copy counts as synced');
    R.forget([h.id]);
    eq(R.base(h.id), null, 'forget() drops it too');
  });

  test('sync: a deleted harness goes up as a tombstone', async () => {
    const hub = setup();
    const h = harness('Doomed');
    let res = await R.sync({ [h.id]: h }, opts(hub));
    res.store[h.id].deleted = true; res.store[h.id].updated = Date.now();
    res = await R.sync(res.store, opts(hub));
    const f = file(hub, h.id);
    eq([f.meta.deleted, f.summary.archived], [true, true]);
  });

  test('sync: a file deleted on GitHub drops an untouched local copy', async () => {
    const hub = setup();
    const h = harness('Removed upstream');
    let res = await R.sync({ [h.id]: h }, opts(hub));
    const files = hub.files(OWNER + '/loom_data');
    delete files['projects/' + h.id + '.json'];
    hub.push(OWNER + '/loom_data', files);
    res = await R.sync(res.store, opts(hub));
    eq(res.gone, [h.id]);
    ok(!res.store[h.id]);
  });

  test('sync reads Signoff PL: projects, Loom Parts, and a newer name from PL', async () => {
    const hub = setup();
    const h = harness('Loom name', { pn: 'H-1', identAt: '2026-11-07T10:00:00.000Z', project: 'Gizmo' });
    const pl = { schema: 1, id: 'pl9', slug: 'gizmo', meta: { name: 'Acme Gizmo', clientProject: 'Gizmo' }, nodes: {
      a: { id: 'a', parent: '', kind: 'assembly', name: 'Gizmo' },
      n: { id: 'n', parent: 'a', kind: 'part', name: 'Name from PL', number: 'H-1A', source: 'loom', ref: { tool: 'loom', id: h.id }, identAt: '2026-11-07T12:00:00.000Z' } } };
    hub.makeRepo(OWNER + '/signoff_pl_data', { ['projects/pl9.json']: stable(pl) }, ['alice']);
    const res = await R.sync({ [h.id]: h }, opts(hub));
    eq(res.adopted, [h.id]);
    eq([res.store[h.id].title, res.store[h.id].pn], ['Name from PL', 'H-1A']);
    eq(file(hub, h.id).summary.identAt, '2026-11-07T12:00:00.000Z', 'the adopted stamp goes up, so PL sees no newer edit');
    eq(res.pl.projects, [{ id: 'pl9', slug: 'gizmo', name: 'Acme Gizmo', clientProject: 'Gizmo' }]);
    eq(res.pl.links[h.id][0].path, ['Gizmo']);
  });

  test('sync reads waiting Parts from PL, even past a cache from before they were kept', async () => {
    const hub = setup();
    hub.makeRepo(OWNER + '/signoff_pl_data', { ['projects/pl1.json']: stable(waitDoc()) }, ['alice']);
    let res = await R.sync({}, opts(hub));
    eq(res.pl.planned.map(p => p.node), ['w1']);
    // A browser that cached PL before planned Parts were kept: the slim doc by sha, with no version.
    const key = NSP + 'plCache', cached = JSON.parse(localStorage.getItem(key));
    eq(cached.v, 2, 'the cache carries its shape version');
    const old = {};
    Object.keys(cached.files).forEach(p => { const d = Object.assign({}, cached.files[p].doc); delete d.planned; old[p] = { sha: cached.files[p].sha, doc: d }; });
    localStorage.setItem(key, JSON.stringify(old));
    res = await R.sync(res.store, opts(hub));
    eq(res.pl.planned.map(p => p.node), ['w1'], 'an old cache is read again, not trusted');
  });

  test('sync: a conflict copy of a harness started from PL names no PL Part', async () => {
    const hub = setup();
    const h = harness('Started', { plPart: { project: 'pl1', node: 'w1', at: '2026-11-08T10:00:00.000Z' } });
    let res = await R.sync({ [h.id]: h }, opts(hub));
    const f = file(hub, h.id);
    f.harness.title = 'Theirs'; f.harness.updated = Date.now() + 60000;
    hub.push(OWNER + '/loom_data', Object.assign(hub.files(OWNER + '/loom_data'), { ['projects/' + h.id + '.json']: stable(f) }));
    const mine = res.store[h.id];
    mine.title = 'Mine'; mine.updated = Date.now();
    res = await R.sync(res.store, opts(hub));
    eq(res.store[h.id].plPart.node, 'w1', 'the winner keeps the link');
    eq(res.conflicts.map(c => [c.title, c.plPart]), [['Mine (conflict copy)', undefined]], 'the copy drops it');
  });

  test('sync without access to PL still syncs harnesses', async () => {
    const hub = setup();
    const h = harness('No PL');
    const res = await R.sync({ [h.id]: h }, opts(hub));
    eq(res.pushed, 1);
  });

  // ── Shared harnesses (signoff_pl/docs/sharing.md): review-loom-<slug> repos and the shared map ──
  function shareOnHub(hub, id, name) {
    // What Signoff PL's share does: the file moves into its own repo, and loom_data's roster records it.
    const full = OWNER + '/review-loom-' + name;
    const files = hub.files(OWNER + '/loom_data'), text = files['projects/' + id + '.json'];
    hub.makeRepo(full, { 'README.md': '#', ['projects/' + id + '.json']: text }, ['alice', 'cat']);
    delete files['projects/' + id + '.json'];
    const roster = SG.model.mergeRosters(SG.model.emptyRoster(), JSON.parse(files['users.json'] || 'null'));
    roster.shared[id] = { id, repo: full, name, updatedAt: '2026-11-07T12:00:00.000Z', updatedBy: 'alice' };
    roster.users.cat = { login: 'cat', name: 'Cat', role: 'contractor', projects: [id], updatedAt: '2026-11-07T12:00:00.000Z', updatedBy: 'alice' };
    files['users.json'] = stable(roster);
    hub.push(OWNER + '/loom_data', files);
    return full;
  }
  test('sync: a harness shared into its own repo syncs there, and is never pushed back to loom_data', async () => {
    const hub = setup();
    const h = harness('Shared one', { project: 'Gizmo' }), k = harness('Kept inside');
    let res = await R.sync({ [h.id]: h, [k.id]: k }, opts(hub));
    const full = shareOnHub(hub, h.id, 'shared-one');
    res = await R.sync(res.store, opts(hub));
    eq(res.access, 'fte');
    eq([res.homes[h.id], res.homes[k.id]], [full, OWNER + '/loom_data'], 'each harness knows its repo');
    ok(!hub.files(OWNER + '/loom_data')['projects/' + h.id + '.json'], 'the data repo does not get the shared harness back');
    ok(R.isShared(h.id) && !R.isShared(k.id), 'the store says which are shared');
    // An edit here goes to the shared repo.
    res.store[h.id].title = 'Edited by alice'; res.store[h.id].updated = Date.now();
    res = await R.sync(res.store, opts(hub));
    eq(JSON.parse(hub.files(full)['projects/' + h.id + '.json']).meta.name, 'Edited by alice');
    ok(!hub.files(OWNER + '/loom_data')['projects/' + h.id + '.json'], '…and still not to loom_data');
    // A file planted in the shared repo under another id is ignored.
    const planted = hub.files(full); planted['projects/' + k.id + '.json'] = planted['projects/' + h.id + '.json'].replace(h.id, k.id);
    hub.push(full, planted);
    res = await R.sync(res.store, opts(hub));
    eq(res.store[k.id].title, 'Kept inside', 'a shared repo only counts for the harness the shared map puts there');
  });

  // The drawing for Signoff PL: a stub renderer (app.js draws the real PNG on a canvas).
  function stubThumb() {
    const t = { drawn: 0 };
    t.svg = h => { const s = h.wires.map(w => w.id + w.color).join(','); return { svg: '<svg>' + s + '</svg>', dark: '<svg dark>' + s + '</svg>', w: 400, h: 100 }; };
    t.png = d => { t.drawn++; return Promise.resolve({ bytes: new TextEncoder().encode('PNG ' + d.svg), type: 'image/png', w: 800, h: 200 }); };
    return t;
  }
  test('sync stores a harness drawing for Signoff PL in the repo the harness lives in', async () => {
    const hub = setup(), thumb = stubThumb();
    const h = harness('Drawn'), bare = harness('No wires yet');
    M.addWire(h, { node: h.nodes[0].id, pin: '1' }, { node: h.nodes[1].id, pin: '1' });
    const o = Object.assign(opts(hub), { thumb });
    let res = await R.sync({ [h.id]: h, [bare.id]: bare }, o);
    const D = OWNER + '/loom_data', dir = 'drawing/' + h.id + '/preview/';
    let files = hub.files(D);
    ok(files[dir + 'diagram.png'] && files[dir + 'diagram-dark.png'], 'the picture is stored, light and dark');
    const text = v => (typeof v === 'string' ? v : new TextDecoder().decode(v));
    const index = JSON.parse(text(files[dir + 'index.json']));
    eq(stable([index.tool, index.id, index.hero, index.images]), stable(['loom', h.id, 'diagram', [{ key: 'diagram', file: 'diagram.png', type: 'image/png', w: 800, h: 200 }, { key: 'diagram-dark', file: 'diagram-dark.png', type: 'image/png', w: 800, h: 200 }]]));
    ok(!files['drawing/' + bare.id + '/preview/index.json'], 'a harness with no wires has no drawing');
    eq([thumb.drawn, res.errors.length], [2, 0], 'drawn twice: light and dark');
    // Unchanged: not drawn again, nothing pushed.
    res = await R.sync(res.store, o);
    eq([thumb.drawn, res.pushed], [2, 0]);
    // A changed diagram is drawn again.
    res.store[h.id].wires[0].color = 'RD'; res.store[h.id].updated = Date.now();
    res = await R.sync(res.store, o);
    eq(thumb.drawn, 4);
    // Shared into its own repo: the drawing goes there too (PL only reads it next to the harness).
    const full = shareOnHub(hub, h.id, 'drawn');
    res = await R.sync(res.store, o);
    ok(hub.files(full)[dir + 'index.json'], 'drawn into the shared repo');
    // No wires left: its drawing goes.
    res.store[h.id].wires = []; res.store[h.id].updated = Date.now();
    res = await R.sync(res.store, o);
    ok(!hub.files(full)[dir + 'index.json'] && !hub.files(full)[dir + 'diagram.png'] && !hub.files(full)[dir + 'diagram-dark.png'], 'removed with the last wire');
  });

  test('sync: a drawing that can’t be stored is reported and never fails the sync', async () => {
    const hub = setup(), thumb = stubThumb();
    thumb.png = () => Promise.resolve(null);
    const h = harness('Undrawable');
    M.addWire(h, { node: h.nodes[0].id, pin: '1' }, { node: h.nodes[1].id, pin: '1' });
    const res = await R.sync({ [h.id]: h }, Object.assign(opts(hub), { thumb }));
    eq(res.pushed, 1, 'the harness still went up');
    eq(res.errors.length, 1);
    ok(/drawing for Signoff PL/.test(res.errors[0].message), res.errors[0].message);
  });

  test('sync: a contractor gets only the harnesses shared with them, and their edits reach the FTE', async () => {
    const hub = setup();
    const h = harness('For the client', { project: 'Gizmo' }), k = harness('Internal');
    let res = await R.sync({ [h.id]: h, [k.id]: k }, opts(hub));
    const full = shareOnHub(hub, h.id, 'for-the-client');
    // Cat's browser: nothing yet, no access to loom_data.
    clearNs();
    localStorage.setItem(NSP + 'repos', JSON.stringify({ owner: OWNER }));
    const cat = { token: 'tok-cat', fetch: hub.fetchFor('tok-cat') };
    let cres = await R.sync({}, cat);
    eq(cres.access, 'contractor');
    eq(Object.keys(cres.store), [h.id], 'only the shared harness');
    eq(cres.errors, []);
    cres.store[h.id].title = 'Cat was here'; cres.store[h.id].updated = Date.now() + 1000;
    cres = await R.sync(cres.store, cat);
    eq(cres.pushed, 1);
    // Alice's browser again.
    clearNs();
    localStorage.setItem(NSP + 'repos', JSON.stringify({ owner: OWNER }));
    res = await R.sync({}, opts(hub));
    eq([res.store[h.id].title, res.store[k.id].title], ['Cat was here', 'Internal'], 'the FTE sees both, with the contractor’s edit');
    // Cat loses access: her untouched copy goes at her next sync.
    hub.repos[full].collaborators = ['alice'];
    clearNs();
    localStorage.setItem(NSP + 'repos', JSON.stringify({ owner: OWNER }));
    cres = await R.sync(cres.store, cat).catch(e => e);
    ok(cres.status === 404, 'with no harness shared any more a contractor gets the 404, as with no data repo');
  });

  test('sync with no data repo fails with 404', async () => {
    clearNs();
    localStorage.setItem(NSP + 'repos', JSON.stringify({ owner: OWNER }));
    const hub = new FakeHub();
    let err = null;
    try { await R.sync({ x: harness('x') }, opts(hub)); } catch (e) { err = e; }
    ok(err && err.status === 404, 'expected a 404, got ' + (err && (err.status || err.message)));
  });

  // ── Copy and paste parts ──
  test('a pasted part is an exact copy without wires, under the next designator of its prefix', () => {
    const h = harness('Copy test');
    const [a, b] = h.nodes;
    a.ref = 'J6'; a.name = 'Main board'; a.pinLabels = { 1: 'VCC', 2: 'GND' }; a.faceView = 'both';
    M.addWire(h, { node: a.id, pin: '1' }, { node: b.id, pin: '1' });
    const sp = M.addNode(h, 'splice', 0, 0);
    sp.ports = { l: [h.wires[0].id], r: [] };
    const wires = h.wires.length, segs = h.segments.length;
    const c = M.copyPart(a), n = M.pastePart(h, c);
    ok(n.id && n.id !== a.id, 'a new id');
    eq(n.ref, 'J7');
    const strip = x => { const o = JSON.parse(JSON.stringify(x)); delete o.id; delete o.ref; return o; };
    eq(strip(n), strip(a), 'everything else is the same');
    eq([h.wires.length, h.segments.length], [wires, segs], 'no wires or segments added');
    ok(!h.wires.some(w => w.from.node === n.id || w.to.node === n.id), 'nothing wired to the copy');
    eq(M.pastePart(h, c).ref, 'J8', 'pasting again takes the next one');
    const s2 = M.pastePart(h, M.copyPart(sp));
    eq(s2.ref, 'S2'); ok(!s2.ports, "a splice's port order names wires and goes");
    eq(M.copyPart(h.wires[0]), null);
  });

  // ── Wire sets ──
  // Deleting a set never deletes what's inside it (Chris): a bundle holding a cable and a second
  // bundle leaves the cable and that bundle, with their wires and their own sets.
  test('deleting a set keeps the sets inside it', () => {
    const h = LM.demo.harness(), L = l => h.sets.find(s => s.label === l);
    const loose = h.wires.filter(w => !h.sets.some(s => s.wires.includes(w.id))).map(w => w.id);
    const b2 = M.makeSet(h, M.wiresIn(h, L('TP2')).concat(loose.slice(0, 2)), { bundle: true });
    const top = M.makeSet(h, M.wiresIn(h, L('C1')).concat(M.wiresIn(h, b2)), { bundle: true });
    ok(b2 && top, 'made the bundles');
    eq(top.sets.map(id => M.set(h, id).label).sort(), ['B2', 'C1'], 'the cable and the bundle sit inside the new bundle');
    const before = h.sets.filter(s => s !== top).map(s => [s.label, M.wiresIn(h, s).slice().sort()]);
    M.dissolveSet(h, top.id);
    M.tidySets(h);
    ok(!M.set(h, top.id), 'the bundle is gone');
    eq(h.sets.map(s => [s.label, M.wiresIn(h, s).slice().sort()]), before, 'every other set stays, with the same wires');
    ok(!M.parentOf(h, L('C1').id) && !M.parentOf(h, b2.id), 'the cable and the inner bundle are now outermost');
    eq(M.set(h, b2.id).sets.map(id => M.set(h, id).label), ['TP2'], 'the inner bundle keeps its own set');
    ok(L('C1').cable && M.set(h, b2.id).bundle, 'they keep what they are');
  });

  // Tables (Chris, 2026-11-11): counts change without losing the text that stays, the columns'
  // shares still sum to 1, and a row grows to its most wrapped cell.
  test('table: rows and columns change, keeping text and column shares', () => {
    const h = LM.demo.harness(), c = M.addTable(h, { kind: 'table', node: null, x: 0, y: 0 });
    eq([c.table.cells.length, c.table.cols.length, c.ref], [2, 2, 'T1'], 'a new table is 2 by 2');
    c.table.cells[1][1] = 'kept'; c.table.cols = [0.25, 0.75];
    M.sizeTable(c, 3, 3);
    eq(c.table.cells.map(r => r.length), [3, 3, 3], 'three rows of three');
    eq(c.table.cells[1][1], 'kept', 'text stays');
    ok(Math.abs(c.table.cols.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'shares sum to 1');
    ok(c.table.cols[1] > c.table.cols[0], 'the old columns keep their proportions');
    M.sizeTable(c, 1, 1);
    eq(c.table.cells, [['']], 'shrinking drops the last rows and columns');
    eq(c.table.cols, [1], 'one column has it all');
    M.tidyNotes(h);
    ok(M.note(h, c.id), 'a table stays through tidyNotes');
  });
  test('table: text wraps in its column, a long word breaks, and rows grow to fit', () => {
    const C = LM.conn;
    ok(C.wrapCell('a b c d e f g h i j k l m n o p', 40).length > 1, 'words wrap');
    const long = C.wrapCell('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 60);
    ok(long.length > 1 && long.join('') === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'a long word breaks without losing characters');
    eq(C.wrapCell('one' + String.fromCharCode(10) + 'two', 200), ['one', 'two'], 'line breaks stay');
    const h = LM.demo.harness(), c = M.addTable(h, { kind: 'table', node: null, x: 0, y: 0 });
    const g0 = C.layout(h, M.analyze(h)).tableGeom(c);
    c.table.cells[0][1] = 'a much longer piece of text that has to wrap over several lines';
    const g1 = C.layout(h, M.analyze(h)).tableGeom(c);
    ok(g1.rows[0].h > g0.rows[0].h && g1.rows[1].h === g0.rows[1].h, 'only the wrapped row grows');
    c.table.minH = g1.h + 40;
    const g2 = C.layout(h, M.analyze(h)).tableGeom(c);
    ok(Math.abs(g2.h - (g1.h + 40)) < 1e-6, 'a least height from the corner shares out over the rows');
  });

  // ── Systems (assets/system.js, docs/system.md) ──
  function sysFixture() {
    const Y = LM.system, s = Y.blank('Gizmo');
    const a = Y.addDrawn(s, 'board', { x: 0, y: 0 }), d = Y.addDrawn(s, 'device', { x: 120, y: 0 });
    a.conns.length = 0;
    const c = { id: 'c1', ref: 'J1', pins: [{ pin: '1', net: 'VIN', label: 'VIN' }, { pin: '2', net: 'GND', label: 'GND' }], x: 80, y: 4, side: 'top', used: true, fn: 'Fan', placed: 'hand' };
    a.conns.push(c);
    const h = harness('Fan cable', { pn: '2200100-001' });
    return { Y, s, a, d, c, h, get: id => (id === h.id ? h : null) };
  }
  // ── Connections: one engine for harness wires and system cables (connect.js) ──
  test('connect: a straight route lifts from the grab to the far corner, and a drag keeps an odd shape', () => {
    const CN = LM.connect, R0 = { A: { x: 0, y: 0, out: 1 }, B: { x: 400, y: 0, in: 1 }, v: [], stub: 23, half: 3, r: 13 };
    const st = CN.grab(CN.runAt(R0, { x: 300, y: 0 }), null);
    eq(st.v0.length % 2, 1, 'a shape has an odd count of values');
    eq(st.axis, 'h', 'the lifted piece is level, and drags up and down');
    const v = CN.slide(st, { x: 300, y: 0 }, { x: 300, y: 60 }, null);
    ok(RT.fits(R0.A, R0.B, v, 23), 'the dragged shape fits its ends: ' + v);
    eq(CN.release(R0, v, { mode: 'behind' }).mode, 'behind', 'let go, the record keeps its mode');
  });
  test('connect: the route menu walks around, goes behind, and resets, as in the harness editor', () => {
    const CN = LM.connect;
    ok(/Go behind parts/.test(CN.menuHtml(null)) && !/Reset route/.test(CN.menuHtml(null)), 'nothing shaped: no Reset route');
    ok(/Reset route/.test(CN.menuHtml({ v: [10] })), 'shaped: Reset route');
    eq(CN.apply({ v: [10], a: 'r', b: 'l' }, 'behind'), { v: [10], a: 'r', b: 'l', mode: 'behind' });
    eq(CN.apply({ mode: 'behind' }, 'around'), null, 'nothing left to keep');
    eq(CN.apply({ v: [10], a: 'r', b: 'l', mode: 'behind' }, 'reset-route'), { mode: 'behind' });
    eq(CN.record([10, 20, 30]), { v: [10, 20, 30] }, 'a bare v becomes a record');
  });
  test('system: every cable routes from its connector, round the boards, and fits its ends (made-up 30-board system)', () => {
    const s = LM.fixtures.bigSystem(), L = LM.system.layout(s);
    let n = 0;
    L.forEach(({ cab, routes, at }) => routes.forEach(r => {
      n++;
      ok(RT.fits(r.A, r.B, r.v, r.stub), `${cab.name} fits its ends`);
      const p0 = LM.route.shape(r.A, r.B, r.v, r.r).pts[0], g = at[0].g;
      ok(Math.hypot(p0.x - g.ex, p0.y - g.ey) < 0.5, `${cab.name} starts at its connector`);
    }));
    eq(n, 60, 'one route per cable');
  });
  test('system: a shaped cable keeps its runs, and Go behind runs straight past the boards', () => {
    const s = LM.fixtures.bigSystem(), Y = LM.system, CN = LM.connect;
    const L = Y.layout(s), cab = s.cables.find(c => L.get(c.id).routes[0].v.length >= 3), r = L.get(cab.id).routes[0];
    const st = CN.grab(CN.runOf(r, CN.handles(r)[0].j), null), v = CN.slide(st, { x: 0, y: 0 }, { x: 36, y: 36 }, null);
    cab.routes = { b: CN.release(r, v, null) };
    const r2 = Y.layout(s).get(cab.id).routes[0];
    ok(r2.kept, 'kept as shaped');
    eq(r2.v, cab.routes.b.v.map(Number), 'its runs stay where they were dragged');
    cab.routes = { b: { mode: 'behind' } };
    ok(Y.layout(s).get(cab.id).routes[0].behind, 'behind');
  });
  test('system: connections are Loom harnesses, purchased cables, or generic, with ends A and B', () => {
    const Y = LM.system, s = Y.normalize(Object.assign(Y.blank('Gizmo'), { cables: [{ id: 'k1', ends: {} }, { id: 'k2', kind: 'bought', name: 'USB-C, 1 m', pn: 'CBL-1', ends: {} }, { id: 'k3', harness: 'h1', ends: {}, routes: { x: [5] } }] }));
    eq(s.cables.map(c => Y.kindOf(c)), ['link', 'bought', 'harness'], 'no kind and no harness: generic');
    eq(Object.keys(s.cables[0].ends), ['a', 'b'], 'a generic connection has ends A and B');
    eq(s.cables[2].routes.x, { v: [5] }, 'a bare kept v is read as a record');
    eq(Y.statusOf(s.cables[1]).key, 'bought');
    ok(Y.checks(s, () => null).some(x => /USB-C, 1 m: End A isn't plugged in/.test(x.text)), 'open ends are flagged for any kind');
    eq(Y.summarize(s, () => null).cables, [{ name: 'USB-C, 1 m', pn: 'CBL-1', mfr: '', mpn: '', qty: 1 }], 'purchased cables go in the summary');
  });
  test('system: checks flag used connectors with nothing plugged in, open ends, and pin counts', () => {
    const { Y, s, a, c, h, get } = sysFixture();
    const t = Y.checks(s, get).map(x => x.text);
    ok(t.some(x => /A1 J1 \(Fan\) is used, but nothing is plugged into it/.test(x)), 'a used connector with no cable');
    const ends = h.nodes.filter(M.isConn);
    s.cables.push({ id: 'k1', harness: h.id, ends: { [ends[0].id]: { block: a.id, conn: c.id }, [ends[1].id]: null }, lengthMm: null });
    const t2 = Y.checks(s, get);
    ok(!t2.some(x => /A1 J1.*nothing is plugged/.test(x.text)), 'plugged now');
    ok(t2.some(x => x.sev === 'warn' && new RegExp(ends[1].ref + " isn't plugged in").test(x.text)), 'the other end is open');
    eq(t2.some(x => x.sev === 'error' && /pins, the connector 2/.test(x.text)), M.pinList(ends[0]).length !== 2, 'pin counts compared');
    s.cables.push({ id: 'k2', harness: h.id, ends: { [ends[0].id]: { block: a.id, conn: c.id } }, lengthMm: 750 });
    ok(Y.checks(s, get).some(x => x.sev === 'error' && /2 cables plugged into it/.test(x.text)), 'two cables on one connector');
  });
  test('system: a length override is a variant part number, and the summary counts harnesses', () => {
    const { Y, s, h, get } = sysFixture();
    s.cables.push({ id: 'k1', harness: h.id, ends: {}, lengthMm: null }, { id: 'k2', harness: h.id, ends: {}, lengthMm: null }, { id: 'k3', harness: h.id, ends: {}, lengthMm: 750.4 });
    eq(Y.pnOf(h, s.cables[2]), '2200100-001-750');
    const q = Y.summarize(s, get).harnesses.map(x => [x.pn, x.qty]).sort();
    eq(q, [['2200100-001', 2], ['2200100-001-750', 1]]);
    eq(Y.summarize(s, get).kind, 'system');
  });
  test('system: the best end is the one made from that board connector', () => {
    const { Y, s, a, c, h } = sysFixture();
    a.source = { tool: 'ee', id: 'pb1', name: 'Board' };
    const ends = h.nodes.filter(M.isConn);
    ends[1].board = { project: 'pb1', ref: 'J1' };
    eq(Y.bestEnd(s, null, h, a, c).id, ends[1].id);
  });
  test('system sync: systems go under systems/, never projects/, and come back', async () => {
    const hub = setup();
    const { Y, s, h, get } = sysFixture();
    const res = await R.syncSystems({ [s.id]: s }, get, opts(hub));
    const files = hub.files(OWNER + '/loom_data');
    const path = 'systems/projects/' + s.id + '.json';
    ok(files[path], 'stored under systems/');
    ok(!Object.keys(files).some(p => p.indexOf('projects/') === 0), 'nothing in projects/, which Signoff PL reads as harnesses');
    eq(JSON.parse(files[path]).summary.kind, 'system');
    eq(res.store[s.id].title, s.title);
    eq(R.sysUnsynced(res.store), [], 'nothing left unsynced');
    const again = await R.syncSystems(res.store, get, opts(hub));
    eq(again.pushed, 0, 'a second sync has nothing to push');
  });

  test('boards: a connector missing from the pick-and-place is placed at its pads in the netlist', () => {
    // Netlist counts in 0.0001 in; the pick-and-place in mm, offset by (2, 3) mm. J9 isn't fitted.
    const k = 0.00254, rec = (des, pin, x, y) => ({ des, pin, net: 'N' + des + pin, xr: Math.round((x - 2) / k), yr: Math.round((y - 3) / k), access: 0 });
    const net = { recs: [rec('R1', '1', 10, 10), rec('R1', '2', 12, 10), rec('U1', '1', 40, 30), rec('C1', '1', 60, 50), rec('J1', '1', 90, 20), rec('J1', '2', 90, 22), rec('J9', '1', 5, 40), rec('J9', '2', 5, 44), rec('J9', 'MH1', 50, 50)] };
    const pnp = { parts: [{ des: 'R1', x: 11, y: 10, rot: 0, side: 'top' }, { des: 'U1', x: 40, y: 30, rot: 0, side: 'top' }, { des: 'C1', x: 60, y: 50, rot: 0, side: 'top' }, { des: 'J1', x: 90, y: 21, rot: 90, side: 'top' }] };
    const conns = [{ ref: 'J1', pins: [] }, { ref: 'J9', pins: [] }];
    const res = LM.boards.place(conns, net, pnp);
    eq(res.fit.k, k, 'the scale fitted on the parts both files list');
    eq(conns[0].at.from, 'pnp');
    eq(conns[1].at.from, 'netlist');
    ok(Math.abs(conns[1].at.x - 5) < 0.01 && Math.abs(conns[1].at.y - 42) < 0.01, 'J9 at the middle of its pads, mounting pads left out: ' + JSON.stringify(conns[1].at));
    ok(res.outline.x0 <= 5 - 4 + 0.01, 'the outline takes in the netlist-only connector');
  });

  test('system: an unpopulated connector is skipped by the used checks, and a cable on one is an error', () => {
    const { Y, s, a, c, h, get } = sysFixture();
    c.placed = 'netlist';
    ok(!Y.fitted(c), 'a connector only the netlist placed starts unpopulated');
    ok(!Y.checks(s, get).some(x => /A1 J1/.test(x.text)), 'nothing to say about it while it has no cable');
    c.fitted = true;
    ok(Y.fitted(c) && Y.checks(s, get).some(x => /A1 J1 \(Fan\) is used/.test(x.text)), 'populated by hand, it counts again');
    c.fitted = false;
    const ends = h.nodes.filter(M.isConn);
    s.cables.push({ id: 'k1', harness: h.id, ends: { [ends[0].id]: { block: a.id, conn: c.id } }, lengthMm: null });
    ok(Y.checks(s, get).some(x => x.sev === 'error' && /isn't populated, but a cable is plugged into it/.test(x.text)));
  });

  (async () => {
    let failed = 0;
    for (const t of tests) {
      try { await t.fn(); results.push(`<div class="pass">✓ ${t.name}</div>`); }
      catch (e) { failed++; results.push(`<div class="fail">✗ ${t.name}\n  ${String(e && e.stack || e).replace(/</g, '&lt;')}</div>`); }
    }
    clearNs();
    out.innerHTML = `<p><b>${tests.length - failed} of ${tests.length} passed</b></p>` + results.join('');
    document.title = failed ? 'FAIL' : 'PASS';
  })().catch(e => { document.title = 'ERROR'; out.textContent = String(e && e.stack || e); });
})();
