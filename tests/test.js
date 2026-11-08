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
    eq([s.tool, s.name, s.number, s.project], ['loom', 'Display & Sensor Harness', '2100430-001', 'Smart Thermostat']);
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

  test('sync without access to PL still syncs harnesses', async () => {
    const hub = setup();
    const h = harness('No PL');
    const res = await R.sync({ [h.id]: h }, opts(hub));
    eq(res.pushed, 1);
  });

  test('sync with no data repo fails with 404', async () => {
    clearNs();
    localStorage.setItem(NSP + 'repos', JSON.stringify({ owner: OWNER }));
    const hub = new FakeHub();
    let err = null;
    try { await R.sync({ x: harness('x') }, opts(hub)); } catch (e) { err = e; }
    ok(err && err.status === 404, 'expected a 404, got ' + (err && (err.status || err.message)));
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
