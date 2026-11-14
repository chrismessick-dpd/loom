// The part library (Chris, 2026-11-14): devices a harness ends on (a motor, a sensor, a switch) and the
// connectors on such devices, each with its pinout: pin, net name, lead color, and gauge where known.
// Kept in Loom's data repo as parts/<id>.json and read here, read only, at each sync. Add › Device
// places one as a linked copy: the end carries the part's pins (n.pinNames, n.pinLabels, n.leads) and
// a link (n.part: id, name, stamp), so it draws and syncs without the library, and Refresh from library
// takes a newer version of the part. See docs/parts.md.
//
// A part file:
//   { schema: 1, id, part: { id, kind: 'device' | 'connector', name, maker, mpn, mate, notes,
//     pins: [{ id, label, color, gauge }], source: { … }, updated, updatedBy } }
// kind 'device' has leads (it's placed as flying leads); 'connector' has a connector the harness mates
// to (placed as the mating housing, mate its part number). color is an IEC code ('WH', 'BK/WH').
(function (LM) {
  'use strict';
  const DEMO = /[?&]demo\b/.test(location.search);
  const DIR = 'parts/';
  let NS = DEMO ? 'loom.demo.' : 'loom.v1.';   // tests use their own (setNamespace)
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(NS + k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  const stampOf = p => (Number(p && p.updated) || 0) + '|' + String((p && p.updatedBy) || '');

  // The demo's made-up parts, for an Acme Climate product.
  const DEMO_PARTS = [
    { id: 'pdemo-damper', kind: 'device', name: 'Zone damper actuator, 24 VAC', maker: 'Acme Motion', mpn: 'ZDA-24-3W', mate: '', notes: 'Three-wire floating control, 24 VAC.',
      pins: [{ id: '1', label: 'COM', color: 'BK', gauge: '22' }, { id: '2', label: 'OPEN', color: 'RD', gauge: '22' }, { id: '3', label: 'CLOSE', color: 'WH', gauge: '22' }] },
    { id: 'pdemo-ntc', kind: 'device', name: 'Duct temperature sensor, 10k NTC', maker: 'Acme Sensing', mpn: 'DTS-10K-150', mate: '', notes: '150 mm probe.',
      pins: [{ id: '1', label: 'NTC', color: 'WH', gauge: '26' }, { id: '2', label: 'NTC_RTN', color: 'WH', gauge: '26' }] },
    { id: 'pdemo-fan', kind: 'device', name: 'Blower fan, 24 V DC, PWM', maker: 'Acme Air', mpn: 'BF-92-24P', mate: '', notes: 'Tach is open collector.',
      pins: [{ id: '1', label: 'GND', color: 'BK', gauge: '24' }, { id: '2', label: '+24V', color: 'RD', gauge: '24' }, { id: '3', label: 'TACH', color: 'YE', gauge: '26' }, { id: '4', label: 'PWM', color: 'BU', gauge: '26' }] },
    { id: 'pdemo-humid', kind: 'connector', name: 'Humidity sensor module', maker: 'Acme Sensing', mpn: 'HSM-2', mate: 'PHR-4', notes: 'Module has a JST PH header; the harness takes the housing.',
      pins: [{ id: '1', label: '3V3', color: '', gauge: '' }, { id: '2', label: 'GND', color: '', gauge: '' }, { id: '3', label: 'I2C_SDA', color: '', gauge: '' }, { id: '4', label: 'I2C_SCL', color: '', gauge: '' }] },
  ].map(p => Object.assign(p, { updated: Date.UTC(2026, 10, 14), updatedBy: 'demo' }));

  // Tidy a part as read from a file: missing fields filled, pins as strings.
  function normalize(p) {
    if (!p || typeof p !== 'object' || !p.id) return null;
    const s = v => (v == null ? '' : String(v));
    return {
      id: s(p.id), kind: p.kind === 'connector' ? 'connector' : 'device', name: s(p.name) || 'Unnamed part', maker: s(p.maker), mpn: s(p.mpn), mate: s(p.mate), notes: s(p.notes),
      pins: (Array.isArray(p.pins) ? p.pins : []).map((q, i) => ({ id: s(q && q.id) || String(i + 1), label: s(q && q.label), color: s(q && q.color), gauge: s(q && q.gauge) })),
      source: p.source && typeof p.source === 'object' ? p.source : undefined,
      deleted: !!p.deleted, updated: Number(p.updated) || 0, updatedBy: s(p.updatedBy),
    };
  }

  // ── The library as this browser last read it ──
  // cache: { path: { sha, part } }, kept in localStorage (a part is a few hundred bytes).
  function all() {
    if (DEMO) return DEMO_PARTS.map(normalize);
    const c = read('parts', {});
    return Object.values(c).map(e => normalize(e.part)).filter(p => p && !p.deleted).sort((a, b) => a.name.localeCompare(b.name));
  }
  const get = id => all().find(p => p.id === id) || null;
  const lastRead = () => (DEMO ? { at: '', count: DEMO_PARTS.length } : read('partsRead', null));

  // Read parts/ from the data repo: the tree, then only blobs whose sha changed. Read only. A token that
  // can't open the data repo (a contractor) keeps what it had and says so. Resolves { count, changed }.
  async function syncLib(opts) {
    opts = opts || {};
    const R = LM.store, SG = window.Signoff || {};
    if (DEMO || !R || !(opts.token || R.signedIn())) return null;
    const cfg = R.config(), tok = opts.token || R.token();
    const st = new SG.GitHubStore({ owner: cfg.owner, repo: cfg.dataRepo, branch: 'main', dataPath: '', token: tok }, opts.fetch);
    let snap;
    try { snap = await st.snapshot(); } catch (e) { if (e.status === 404 || e.status === 403) return null; throw e; }
    const entries = (snap.entries || []).filter(e => e.type === 'blob' && e.path.indexOf(DIR) === 0 && /\.json$/.test(e.path) && e.path.slice(DIR.length).indexOf('/') < 0);
    const old = read('parts', {}), next = {};
    let changed = 0;
    for (const e of entries) {
      if (old[e.path] && old[e.path].sha === e.sha) { next[e.path] = old[e.path]; continue; }
      try {
        const doc = JSON.parse(await st.blob(e.sha)), p = normalize(doc && doc.part);
        if (p) { next[e.path] = { sha: e.sha, part: p }; changed++; }
      } catch (err) { console.warn('Loom: part not read', e.path, err); }
    }
    if (Object.keys(old).some(k => !next[k])) changed++;
    write('parts', next);
    write('partsRead', { at: new Date().toISOString(), count: Object.keys(next).length });
    return { count: Object.keys(next).length, changed };
  }

  // ── Placing and refreshing ──
  // A family from a mating housing's part number (the harness side), else a generic rectangular one.
  function housingFamily(mate) {
    const m = String(mate || '').trim();
    if (/^SHR-/i.test(m)) return 'jst-sh';
    if (/^GHR-|\bJST GHR/i.test(m)) return 'jst-gh';
    if (/^PHR-/i.test(m)) return 'jst-ph';
    if (/^XHP-/i.test(m)) return 'jst-xh';
    if (/^51021/.test(m)) return 'molex-picoblade';
    if (/^(43025|43020|43645)/.test(m) || /micro-?fit/i.test(m)) return 'molex-microfit';
    if (/^39-?01-?2/.test(m) || /mini-?fit/i.test(m)) return 'molex-minifit';
    return 'generic-rect';
  }
  // What an end takes from a part: pins, net names, and lead colors and gauges; its name, maker, and part
  // numbers; flying leads for a device, the mating housing for a connector part. Fields set by hand on
  // the end (ref, position, face, notes) are left alone.
  function apply(n, p) {
    const L = LM.library;
    const pins = p.pins.length ? p.pins : [{ id: '1', label: '', color: '', gauge: '' }];
    if (p.kind === 'device') { n.family = 'flying'; n.mate = [p.maker, p.mpn].filter(Boolean).join(' '); n.mpn = ''; }
    else {
      n.family = housingFamily(p.mate);
      n.mpn = p.mate; n.mate = [p.maker, p.mpn].filter(Boolean).join(' ');
    }
    n.pins = pins.length; n.rows = 1;
    n.pinNames = pins.map(q => q.id);
    n.pinLabels = {}; pins.forEach(q => { if (q.label) n.pinLabels[q.id] = q.label; });
    // A device's leads are the harness's wires; a connector part's pin colors are the device's own leads behind its
    // connector, so they don't color the harness.
    const leads = {};
    if (p.kind === 'device') pins.forEach(q => { if (q.color || q.gauge) leads[q.id] = Object.assign({}, q.color ? { color: q.color } : {}, q.gauge ? { gauge: q.gauge } : {}); });
    if (Object.keys(leads).length) n.leads = leads; else delete n.leads;
    n.name = p.name;
    n.atDevice = true;
    n.part = { id: p.id, name: p.name, stamp: stampOf(p) };
    return n;
  }
  // The lead a wire on this end's pin should be, from its part: { color, gauge } or null.
  const leadOf = (n, pin) => (n && n.part && n.leads && pin != null && n.leads[pin]) || null;
  // Whether the library has a newer version of this end's part than the one it was placed from.
  function stale(n) {
    if (!n || !n.part) return null;
    const p = get(n.part.id);
    return p && stampOf(p) !== n.part.stamp ? p : null;
  }
  // What Refresh from library would change on this end, as short phrases.
  function changes(n, p) {
    const out = [], c = apply(JSON.parse(JSON.stringify(n)), p);
    const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
    if (!same(n.pinNames, c.pinNames)) out.push(`pins ${(n.pinNames || []).length} → ${c.pinNames.length}`);
    if (!same(n.pinLabels, c.pinLabels)) out.push('net names');
    if (!same(n.leads, c.leads)) out.push('lead colors or gauges');
    if (n.name !== c.name) out.push('name');
    if (n.family !== c.family) out.push('type');
    if (n.mpn !== c.mpn || n.mate !== c.mate) out.push('part numbers');
    return out;
  }
  // Wires on this end whose color or gauge differ from the part's leads: [{ wire, pin, want }].
  function mismatches(h, n) {
    const out = [];
    if (!n || !n.leads) return out;
    h.wires.forEach(w => [w.from, w.to].forEach(e => {
      if (e.node !== n.id) return;
      const l = n.leads[e.pin];
      if (!l) return;
      const want = {};
      if (l.color && w.color !== l.color) want.color = l.color;
      if (l.gauge && String(w.gauge) !== String(l.gauge)) want.gauge = l.gauge;
      if (Object.keys(want).length) out.push({ wire: w, pin: e.pin, want });
    }));
    return out;
  }

  // An IEC code from a color name ("White", "white/black", "WH"), or '' when it isn't one of Loom's.
  function colorCode(name, COLORS) {
    const byName = {}; Object.entries(COLORS).forEach(([k, v]) => { byName[v[0].toLowerCase()] = k; byName[k.toLowerCase()] = k; });
    byName.grey = 'GY'; byName.purple = 'VT';
    const parts = String(name || '').trim().toLowerCase().split(/\s*[\/-]\s*/).filter(Boolean);
    if (!parts.length || parts.length > 2) return '';
    const codes = parts.map(x => byName[x]);
    return codes.every(Boolean) ? codes.join('/') : '';
  }

  LM.parts = { setNamespace: ns => { NS = ns; }, housingFamily, DIR, DEMO_PARTS, normalize, all, get, lastRead, syncLib, apply, leadOf, stale, changes, mismatches, colorCode, stampOf };
})(window.LM = window.LM || {});
