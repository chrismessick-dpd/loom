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
