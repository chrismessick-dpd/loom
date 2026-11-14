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
    // The pick-and-place, for where each connector sits (Loom systems, docs/system.md). The outline is
    // the parts' extent plus a margin: Fabcheck's stored preview has the board's size but not its origin.
    let pnp = null;
    for (const n of names.filter(n => /\.(txt|csv)$/i.test(n) && /pick|place|pnp|centroid|xy/i.test(n))) {
      try { const p = Fab.assembly.parsePnp(await zip.file(n).async('string'), n); if (p.parts.length && (!pnp || p.parts.length > pnp.parts.length)) pnp = p; } catch (e) { /* not a PnP */ }
    }
    const conns = connectors(net, bom);
    const placed = place(conns, net, pnp);
    const shape = await boardShape(zip, names, placed.pts);
    // With the board's real edge, the block is the board itself: its outline's extent, no margin.
    const outline = shape ? { x0: shape.bbox[0], y0: shape.bbox[1], x1: shape.bbox[2], y1: shape.bbox[3], from: 'gerber' } : placed.outline;
    return { connectors: conns, netlist: net.name, bom: bom ? bom.name : null, pnp: pnp ? pnp.name : null, outline, shape, fit: placed.fit };
  }

  // The board's real edge (Chris, 2026-11-13: draw a board as its outline when the package has it): the
  // largest closed loop on an outline-like Gerber layer (Outline, Profile, Edge cuts, Board, GKO, GM1, or
  // Mech1), read with Fabcheck's parser and its outlineLoops. Gerbers and the pick-and-place share the
  // design's origin, so it's used only when nearly every placed part (pts) lies inside it; of those, the
  // smallest wins (a panel or drawing frame would hold them too). { pts (flat x, y in mm, y up), bbox,
  // file }, or null.
  const OUTLINE_NAME = /(outline|profile|edge[._ -]?cuts|board|\.gko$|\.gm1$|\.gml$|mech(anical)?_?1(?!\d))/i;
  async function boardShape(zip, names, pts) {
    const F = window.Fab;
    if (!F || !F.gerber || !F.classify || !pts || pts.length < 3) return null;
    let best = null;
    for (const n of names.filter(n => OUTLINE_NAME.test(n.split('/').pop()) && !/\.(pdf|txt|csv|xlsx?|zip|drl|drr|ipc|356|json|md|htm|html|png|jpe?g|webp)$/i.test(n))) {
      let loops;
      try { loops = F.classify.outlineLoops(F.gerber.parse(await zip.file(n).async('string'), n)).filter(l => l.closed && l.area > 1 && l.pts && l.pts.length >= 6); } catch (e) { continue; }
      if (!loops.length) continue;
      const L = loops.sort((a, b) => b.area - a.area)[0], bb = L.bbox;
      const inside = pts.filter(q => q.x >= bb[0] - 0.5 && q.x <= bb[2] + 0.5 && q.y >= bb[1] - 0.5 && q.y <= bb[3] + 0.5).length / pts.length;
      if (inside < 0.95) continue;
      if (!best || L.area < best.area) best = { pts: L.pts, bbox: bb, area: L.area, file: n };
    }
    if (!best) return null;
    let p = best.pts.map(v => Math.round(v * 1000) / 1000);
    // A drawn outline keeps at most about 600 points (arcs come in fine steps).
    if (p.length > 1200) { const k = Math.ceil(p.length / 1200), q = []; for (let i = 0; i < p.length; i += 2 * k) q.push(p[i], p[i + 1]); p = q; }
    return { pts: p, bbox: best.bbox.map(v => Math.round(v * 1000) / 1000), file: best.file.split('/').pop() };
  }

  // Fabcheck's picture of the board's top, stored with its runs beside the review (fabcheck/<id>/preview/,
  // drawn 4% wider and taller than the board's outline, centered; pcb_dfm app.js boardPreviews). Read once a
  // page; { url, w, h } (pixels), or null with no sign-in or no picture. The demo's are Signoff EE's.
  const pics = new Map(), trees = new Map();
  let reposP = null;
  async function readRepos() {
    const st = settings(), repos = [];
    for (let page = 1; page < 6; page++) {
      const got = await gh(`/user/repos?per_page=100&page=${page}`);
      got.forEach(r => { if (r.owner && r.owner.login.toLowerCase() === st.owner.toLowerCase() && (r.name === st.dataRepo || r.name.startsWith(st.prefix))) repos.push(r.full_name); });
      if (got.length < 100) break;
    }
    return repos;
  }
  function picture(id) {
    if (!id) return Promise.resolve(null);
    if (pics.has(id)) return pics.get(id);
    const p = (async () => {
      let url;
      if (DEMO) url = `../ee_design_review/assets/demo-previews/${encodeURIComponent(id)}-top.webp`;
      else {
        if (!token()) return null;
        if (!reposP) reposP = readRepos();
        const repos = await reposP, re = new RegExp(`(^|/)fabcheck/${id.replace(/[^\w-]/g, '')}/preview/top\\.(webp|png)$`);
        for (const full of repos) {
          if (!trees.has(full)) trees.set(full, gh(`/repos/${full}/git/trees/main?recursive=1`).then(t => t.tree).catch(() => []));
          const e = (await trees.get(full)).find(x => x.type === 'blob' && re.test(x.path));
          if (!e) continue;
          const bytes = await blob(full, e.sha);
          url = URL.createObjectURL(new Blob([bytes], { type: /png$/.test(e.path) ? 'image/png' : 'image/webp' }));
          break;
        }
        if (!url) return null;
      }
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('no picture')); img.src = url; });
      return img.naturalWidth ? { url, w: img.naturalWidth, h: img.naturalHeight } : null;
    })().catch(() => null);
    pics.set(id, p);
    return p;
  }

  // Where each connector sits, in the pick-and-place's mm (y up). The pick-and-place lists only the
  // parts fitted in its build variant, so a connector it leaves out is placed at the middle of its pads
  // in the netlist, which lists every pad (Chris, 2026-11-11: unfitted connectors were lined up along
  // the bottom edge). IPC-356 coordinates are counts in a unit that varies by exporter, so the scale
  // and offset are fitted on the parts both files list (the median offset at each candidate scale;
  // the scale whose parts land closest wins). With no pick-and-place, the netlist alone places them.
  const SCALES = [0.00254, 0.001, 0.0254, 0.01];
  const median = a => { const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  function padCenters(net) {
    const by = new Map();
    net.recs.forEach(r => {
      if (!r.des || r.des === 'VIA' || MOUNT.test(r.pin || '')) return;
      const k = r.des.toUpperCase(), c = by.get(k) || { x: 0, y: 0, n: 0, top: 0, bottom: 0 };
      c.x += r.xr; c.y += r.yr; c.n++;
      if (r.access === 1) c.top++; else if (r.access > 1) c.bottom++;
      by.set(k, c);
    });
    by.forEach(c => { c.x /= c.n; c.y /= c.n; });
    return by;
  }
  function fitScale(pads, pnp) {
    const common = pnp ? pnp.parts.map(q => [q, pads.get(q.des.toUpperCase())]).filter(x => x[1]) : [];
    if (common.length >= 3) {
      let best = null;
      SCALES.forEach(k => {
        const dx = median(common.map(([q, c]) => q.x - c.x * k)), dy = median(common.map(([q, c]) => q.y - c.y * k));
        const err = median(common.map(([q, c]) => Math.hypot(q.x - (c.x * k + dx), q.y - (c.y * k + dy))));
        if (!best || err < best.err) best = { k, dx, dy, err, parts: common.length, from: 'pnp' };
      });
      if (best && best.err < 3) return best;
    }
    // No pick-and-place to fit to: the scale that gives a board of a believable size, else Altium's
    // usual 0.0001 in.
    const xs = [...pads.values()].map(c => c.x), ys = [...pads.values()].map(c => c.y);
    const span = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0;
    const k = SCALES.find(k => span * k >= 5 && span * k <= 1000) || SCALES[0];
    return { k, dx: 0, dy: 0, err: null, parts: 0, from: 'netlist' };
  }
  function place(conns, net, pnp) {
    const pads = padCenters(net), fit = fitScale(pads, pnp);
    const at = new Map(pnp ? pnp.parts.map(q => [q.des.toUpperCase(), q]) : []);
    conns.forEach(c => {
      const q = at.get(c.ref.toUpperCase()), p = pads.get(c.ref.toUpperCase());
      if (q) c.at = { x: q.x, y: q.y, rot: q.rot, side: q.side, from: 'pnp' };
      else if (p) c.at = { x: p.x * fit.k + fit.dx, y: p.y * fit.k + fit.dy, rot: 0, side: p.bottom > p.top ? 'bottom' : 'top', from: 'netlist' };
    });
    // The outline: every part and pad placed, plus a margin (Fabcheck's preview has no origin).
    const xs = [], ys = [];
    if (pnp) pnp.parts.forEach(q => { xs.push(q.x); ys.push(q.y); });
    pads.forEach(c => { xs.push(c.x * fit.k + fit.dx); ys.push(c.y * fit.k + fit.dy); });
    const m = 4;
    const outline = xs.length ? { x0: Math.min(...xs) - m, y0: Math.min(...ys) - m, x1: Math.max(...xs) + m, y1: Math.max(...ys) + m, from: pnp ? 'pnp+netlist' : 'netlist' } : null;
    return { outline, fit, pts: xs.map((x, i) => ({ x, y: ys[i] })) };
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

  LM.boards = { DEMO, token, listBoards, loadBoard, readZip, boardShape, picture, matches, place, padCenters, fitScale, reset: () => { boardsCache = null; pkgCache.clear(); reposP = null; trees.clear(); } };
})(window.LM = window.LM || {});
