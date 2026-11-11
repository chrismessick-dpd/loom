// Board connectors from Signoff EE. A board's fab package is the one Fabcheck stored with its review:
// the latest tagged revision's package, or, when no revision is tagged, the latest stored run's. The
// package's IPC-356 netlist gives each connector's pins and nets, and its BOM gives the part. Both are
// read with Fabcheck's own parsers (assets/vendor, from pcb_dfm). Reading uses the GitHub token Signoff
// keeps in this browser (`signoff.token`); nothing is written anywhere. In demo mode the boards are
// Fabcheck's made-up Smart Thermostat packages, read from this site.
(function (LM) {
  'use strict';
  const DEMO = /[?&]demo\b/.test(location.search);
  const EE = { owner: 'chrismessick-dpd', dataRepo: 'ee_design_review_data', prefix: 'review-ee-' };
  const DEMO_BOARDS = [
    { id: 'pdemo7', name: 'Main PCBA', client: 'Smart Thermostat', file: '../pcb_dfm/demo/thermostat-main-pcba.zip', source: 'Fabcheck demo package, rev B' },
    { id: 'pdemo11', name: 'Display & Sensor Board', client: 'Smart Thermostat', file: '../pcb_dfm/demo/thermostat-display-board.zip', source: 'Fabcheck demo package, rev A' },
  ];

  // ── GitHub (read only) ──
  function token() {
    const clean = t => String(t || '').replace(/[\s​-‍⁠﻿]/g, '');
    try { return clean(sessionStorage.getItem('signoff.token') || localStorage.getItem('signoff.token') || ''); } catch (e) { return ''; }
  }
  function settings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('signoff.v1.settings') || '{}') || {}; } catch (e) { /* storage blocked */ }
    return { owner: s.owner || EE.owner, dataRepo: s.dataRepo || EE.dataRepo, prefix: s.prefix || EE.prefix };
  }
  // A token from Sign in with GitHub (the engine's auth.js) is refreshed when due, and once more on a 401.
  async function gh(path) {
    const A = window.SignoffAuth, mine = A && A.owns(token());
    const get = tok => fetch('https://api.github.com' + path, { headers: { Authorization: 'token ' + tok, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    let tok = mine ? (await A.token()) || token() : token();
    let r = await get(tok);
    if (r.status === 401 && mine) { const t2 = await A.refresh(tok); if (t2) r = await get(t2); }
    if (!r.ok) { const e = new Error(`GitHub said ${r.status} for ${path.split('?')[0]}`); e.status = r.status; throw e; }
    return r.json();
  }
  function b64Bytes(b64) {
    const s = atob(String(b64).replace(/\s+/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const blob = (full, sha) => gh(`/repos/${full}/git/blobs/${sha}`).then(b => b64Bytes(b.content));
  const json = bytes => JSON.parse(new TextDecoder().decode(bytes));
  async function sha256(bytes) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...d].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  // Every EE board this token can read: the data repo and the shared review repos.
  let boardsCache = null;
  async function listBoards() {
    if (DEMO) return DEMO_BOARDS.map(b => Object.assign({}, b));
    if (!token()) { const e = new Error('Not signed in'); e.code = 'signin'; throw e; }
    if (boardsCache) return boardsCache;
    const st = settings();
    const repos = [];
    for (let page = 1; page < 6; page++) {
      const got = await gh(`/user/repos?per_page=100&page=${page}`);
      got.forEach(r => { if (r.owner && r.owner.login.toLowerCase() === st.owner.toLowerCase() && (r.name === st.dataRepo || r.name.startsWith(st.prefix))) repos.push(r.full_name); });
      if (got.length < 100) break;
    }
    const out = new Map();
    for (const full of repos) {
      let tree;
      try { tree = (await gh(`/repos/${full}/git/trees/main?recursive=1`)).tree; } catch (e) { continue; }
      const files = tree.filter(e => e.type === 'blob' && /(^|\/)projects\/[^/]+\.json$/.test(e.path));
      for (const f of files) {
        let doc;
        try { doc = json(await blob(full, f.sha)); } catch (e) { continue; }
        const p = doc && (doc.project || doc);
        if (!p || !p.meta) continue;
        const id = String(p.id || f.path.replace(/^.*\/|\.json$/g, ''));
        // A review in a shared repo wins over a stray copy in the data repo.
        if (out.has(id) && !full.endsWith('/' + st.dataRepo)) out.delete(id);
        if (out.has(id)) continue;
        out.set(id, { id, name: String(p.meta.name || id), client: String(p.meta.project || ''), repo: full, tree, revisions: p.revisions || {} });
      }
    }
    boardsCache = [...out.values()].sort((a, b) => a.client.localeCompare(b.client) || a.name.localeCompare(b.name));
    return boardsCache;
  }

  // The package to read: the latest tagged revision (as Signoff EE picks it), else the latest stored run.
  async function pickPackage(b) {
    const revs = Object.keys(b.revisions).map(k => Object.assign({ id: k }, b.revisions[k]))
      .filter(r => r && typeof r === 'object' && !r.deleted && r.source && r.source.zip && r.source.zip.path)
      .sort((x, y) => String(x.source.at || x.createdAt || '').localeCompare(String(y.source.at || y.createdAt || '')) || String(x.createdAt || '').localeCompare(String(y.createdAt || '')));
    const live = revs.filter(r => r.status !== 'withdrawn');
    const rev = live[live.length - 1] || revs[revs.length - 1];
    if (rev) return { path: rev.source.zip.path, sha256: rev.source.zip.sha256, label: `Revision ${rev.label}${rev.status ? ' · ' + rev.status : ''}`, released: true };
    const runFiles = b.tree.filter(e => e.type === 'blob' && new RegExp(`(^|/)fabcheck/${b.id}/runs/[^/]+\\.json$`).test(e.path));
    const runs = [];
    for (const f of runFiles) {
      try { const r = json(await blob(b.repo, f.sha)).run; if (r && r.package && r.package.zip && r.package.zip.path) runs.push(r); } catch (e) { /* skip */ }
    }
    runs.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
    const r = runs[0];
    if (!r) return null;
    const when = /^\d{4}-\d\d-\d\d/.test(String(r.at)) ? String(r.at).slice(0, 10) : '';
    return { path: r.package.zip.path, sha256: r.package.zip.sha256, label: `Latest stored Fabcheck run${when ? ', ' + when : ''} (no revision tagged)`, released: false };
  }

  // ── Reading a package ──
  const pkgCache = new Map();
  async function loadBoard(b) {
    if (pkgCache.has(b.id)) return pkgCache.get(b.id);
    let bytes, source;
    if (DEMO) {
      const r = await fetch(b.file);
      if (!r.ok) throw new Error(`Couldn't read ${b.file} (${r.status})`);
      bytes = new Uint8Array(await r.arrayBuffer());
      source = { label: b.source, released: true };
    } else {
      source = await pickPackage(b);
      if (!source) { const e = new Error(`${b.name} has no fab package stored yet. Send a Fabcheck run to Signoff first.`); e.code = 'nopkg'; throw e; }
      const p = source.path.replace(/^\/+/, '');
      const e = b.tree.find(x => x.type === 'blob' && x.path === p);
      if (!e) throw new Error(`${p} isn't in ${b.repo}.`);
      bytes = await blob(b.repo, e.sha);
      if (source.sha256 && (await sha256(bytes)) !== String(source.sha256).toLowerCase()) throw new Error(`${p} doesn't match its recorded SHA-256, so it wasn't used.`);
    }
    const got = Object.assign({ source }, await readZip(bytes));
    pkgCache.set(b.id, got);
    return got;
  }

  async function readZip(bytes) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip failed to load from the CDN.');
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
    // The netlist: an IPC-356 file (Fabcheck's package puts it in Fabrication/Netlist; raw Altium
    // output calls it a testpoint report).
    let net = null;
    for (const n of names.filter(n => /\.(ipc|356|ipc356)$/i.test(n) || /ipc-?356/i.test(n))) {
      const t = await zip.file(n).async('string');
      const p = Fab.ipc356.parse(t);
      if (p.recs.length && (!net || p.recs.length > net.recs.length)) net = Object.assign({ name: n }, p);
    }
    if (!net) throw new Error("The package has no IPC-356 netlist, so its connectors' pins and nets aren't known.");
    let bom = null;
    for (const n of names.filter(n => /\.(xlsx|xls|csv)$/i.test(n) && /bom|bill/i.test(n))) {
      const data = await zip.file(n).async('uint8array');
      const file = { name: n.split('/').pop(), bytes: data, text: () => new TextDecoder().decode(data) };
      try { bom = Fab.assembly.parseBom(file); } catch (e) { bom = null; }
      if (bom) break;
    }
    return { connectors: connectors(net, bom), netlist: net.name, bom: bom ? bom.name : null };
  }

  // ── Connectors ──
  const REF = /^(J|P|CN|CON|X|XS|XP|XJ)\d+[A-Z]?$/i;
  const DESC = /\b(conn|connector|header|receptacle|socket|terminal block|term blk|plug|jack)\b/i;
  const MOUNT = /^(MH|MP|SH|S|EP|M|H|PAD)\d*$/i;           // mounting, shield, and exposed pads
  const UNNAMED = /^(Net[A-Za-z]*\d*_\w+|Net-\(.*\)|N\$\d+|N\d{4,}|\$\$\$\d+|)$/;
  const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });

  function connectors(net, bom) {
    const part = new Map();
    if (bom) bom.lines.forEach(l => l.des.forEach(d => part.set(d.toUpperCase(), l)));
    const by = new Map();
    net.recs.forEach(r => {
      if (!r.des || !r.pin) return;
      if (!by.has(r.des)) by.set(r.des, new Map());
      const pins = by.get(r.des);
      if (!pins.has(r.pin) || (!pins.get(r.pin) && r.net)) pins.set(r.pin, r.net);
    });
    const out = [];
    by.forEach((pins, des) => {
      const line = part.get(des.toUpperCase());
      const desc = line ? line.description || line.name || line.value || '' : '';
      if (!REF.test(des) && !DESC.test(desc)) return;
      if (/^TP/i.test(des)) return;
      const names = [...pins.keys()].sort(natural);
      const kept = names.filter(p => !MOUNT.test(p));
      if (!kept.length) return;
      out.push({
        ref: des, desc, mpn: line ? line.mpn : '', mfr: line ? line.mfr : '', dnp: !!(line && line.dnp),
        pins: kept.map(p => ({ pin: p, net: pins.get(p) || '', label: UNNAMED.test(pins.get(p) || '') ? '' : pins.get(p) })),
        dropped: names.filter(p => MOUNT.test(p)),
      });
    });
    return out.sort((a, b) => natural(a.ref, b.ref));
  }

  // Pairs of pins on two ends that carry the same named net, for wires Loom can suggest. A net on
  // several pins of both (GND) pairs in pin order. `used` skips pins that already have a wire.
  function matches(a, b, used) {
    const lab = (n, p) => (n.pinLabels || {})[p] || '';
    const free = (n, p) => !used.has(n.id + '|' + p);
    const group = n => {
      const m = new Map();
      LM.model.pinList(n).forEach(p => { const l = lab(n, p); if (l && free(n, p)) m.set(l, (m.get(l) || []).concat(p)); });
      return m;
    };
    const ga = group(a), gb = group(b), out = [];
    ga.forEach((pa, l) => { const pb = gb.get(l) || []; for (let i = 0; i < Math.min(pa.length, pb.length); i++) out.push({ label: l, a: pa[i], b: pb[i] }); });
    return out;
  }

  LM.boards = { DEMO, token, listBoards, loadBoard, readZip, matches, reset: () => { boardsCache = null; pkgCache.clear(); } };
})(window.LM = window.LM || {});
