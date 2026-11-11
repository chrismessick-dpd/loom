// Loom systems (docs/system.md): a second kind of document that places boards and devices, marks which
// of their connectors are used and for what, and plugs Loom harnesses into them. A cable is one use of
// a harness: each of the harness's ends plugs into one connector on one block, or is not plugged yet.
// Plugging is kept here, on the placed block, never on the EE board or the harness (Chris, 2026-11-07:
// copies of one board may use different cables). Systems keep their own store and undo; the app hands
// over #page while one is open (LM.app hooks, `init`).
(function (LM) {
  'use strict';
  const U = LM.util, esc = U.esc, M = LM.model;
  const DEMO = /[?&]demo\b/.test(location.search);
  const NS = DEMO ? 'loom.demo.' : 'loom.v1.';
  const TAB = { w: 7, h: 4.5 };          // a connector tab on a block, mm
  const STUB = 14;                       // an unplugged cable end's stub, mm
  const S = { store: {}, cur: null, sel: null, past: [], future: [], cam: null, boards: null, boardsErr: '', busy: '', adding: null, picking: null };
  let A = null;                          // the app's hooks

  // ── Model ──
  const now = () => Date.now();
  function blank(project) {
    return { schema: 1, kind: 'system', id: U.uid('s'), title: 'New system', project: project || '', rev: 'A', blocks: [], cables: [], updated: now() };
  }
  function normalize(s) {
    if (!s || s.kind !== 'system' || !s.id) throw new Error('not a system');
    s.blocks = Array.isArray(s.blocks) ? s.blocks : [];
    s.cables = Array.isArray(s.cables) ? s.cables : [];
    s.blocks.forEach(b => { b.conns = Array.isArray(b.conns) ? b.conns : []; b.conns.forEach(c => { c.pins = Array.isArray(c.pins) ? c.pins : []; }); });
    s.cables.forEach(c => { c.ends = c.ends && typeof c.ends === 'object' ? c.ends : {}; });
    return s;
  }
  function nextRef(list, prefix) {
    let n = 1;
    const used = new Set(list.map(x => x.ref));
    while (used.has(prefix + n)) n++;
    return prefix + n;
  }
  const block = (s, id) => s.blocks.find(b => b.id === id);
  const conn = (b, id) => b && b.conns.find(c => c.id === id);
  const cable = (s, id) => s.cables.find(c => c.id === id);
  const pinsOf = n => (n.pins || []).map(p => p.pin);
  function mkConn(b, ref, count, at) {
    const c = { id: U.uid('c'), ref: ref || nextRef(b.conns, 'J'), pins: Array.from({ length: count || 4 }, (_, i) => ({ pin: String(i + 1), net: '', label: '' })),
      x: 0, y: 0, side: 'top', used: true, fn: '', placed: 'hand', mpn: '', mfr: '', desc: '' };
    if (at) { c.x = at.x; c.y = at.y; } else {
      // Down the block's right edge, one tab apart.
      const k = b.conns.length;
      c.x = b.w; c.y = Math.min(b.h - TAB.h, 4 + k * (TAB.h + 3));
    }
    b.conns.push(c);
    return c;
  }
  function addDrawn(s, kind, at) {
    const dev = kind === 'device';
    const b = { id: U.uid('b'), ref: nextRef(s.blocks, dev ? 'D' : 'A'), kind: dev ? 'device' : 'board', name: dev ? 'Device' : 'Board', source: null,
      x: at ? at.x : 0, y: at ? at.y : 0, w: dev ? 30 : 80, h: dev ? 20 : 60, conns: [] };
    if (dev) mkConn(b, 'J1', 2, { x: 0, y: b.h / 2 - TAB.h / 2 });
    s.blocks.push(b);
    return b;
  }
  // A Signoff EE board from its stored package (boards.js): the outline is the pick-and-place's extent,
  // each connector sits where the PnP puts it (y up there, down here), and connectors the PnP doesn't
  // list (not fitted in that build variant) wait along the bottom edge, placed by hand.
  function addBoard(s, board, pkg, at) {
    const o = pkg.outline || { x0: 0, y0: 0, x1: 80, y1: 60 };
    const b = { id: U.uid('b'), ref: nextRef(s.blocks, 'A'), kind: 'board', name: board.name,
      source: { tool: 'ee', id: board.id, name: board.name, client: board.client || '', label: pkg.source ? pkg.source.label : '' },
      x: at ? at.x : 0, y: at ? at.y : 0, w: +(o.x1 - o.x0).toFixed(2), h: +(o.y1 - o.y0).toFixed(2), conns: [] };
    let loose = 0;
    pkg.connectors.forEach(pc => {
      const c = mkConn(b, pc.ref, 0, { x: 0, y: 0 });
      c.pins = pc.pins.map(p => ({ pin: p.pin, net: p.net || '', label: p.label || '' }));
      c.mpn = pc.mpn || ''; c.mfr = pc.mfr || ''; c.desc = pc.desc || ''; c.used = false;
      if (pc.at) { c.x = +(pc.at.x - o.x0 - TAB.w / 2).toFixed(2); c.y = +(o.y1 - pc.at.y - TAB.h / 2).toFixed(2); c.side = pc.at.side; c.placed = 'pnp'; }
      else { c.x = 2 + (loose++) * (TAB.w + 2); c.y = b.h - TAB.h; c.placed = 'hand'; }
    });
    s.blocks.push(b);
    return b;
  }
  // Every cable end plugged into a connector: [{ cable, node }].
  const pluggedAt = (s, bid, cid) => s.cables.flatMap(c => Object.keys(c.ends).filter(k => { const e = c.ends[k]; return e && e.block === bid && e.conn === cid; }).map(k => ({ cable: c, node: k })));
  const harnessEnds = h => h ? h.nodes.filter(M.isConn) : [];
  // The harness end that best fits a connector: one filled from this board's connector (From a board),
  // then one with as many pins, then any end not plugged yet.
  function bestEnd(s, cab, h, b, c) {
    const free = harnessEnds(h).filter(n => !cab || !cab.ends[n.id]);
    const src = b.source && b.source.id;
    return free.find(n => n.board && src && n.board.project === src && n.board.ref === c.ref)
      || free.find(n => M.pinList(n).length === c.pins.length) || free[0] || null;
  }
  // ○ placeholder (no wires), ● wired with errors, ◉ wired with no errors.
  function status(h) {
    if (!h) return { key: 'missing', glyph: '✕', text: 'Harness missing' };
    if (!h.wires.length) return { key: 'placeholder', glyph: '○', text: 'Placeholder, no wires yet' };
    const e = M.checks(h).filter(x => x.sev === 'error').length;
    return e ? { key: 'progress', glyph: '●', text: `In progress, ${e} error${e > 1 ? 's' : ''}` } : { key: 'wired', glyph: '◉', text: 'Wired, no errors' };
  }
  // A placed cable may override its harness's length (Chris, 2026-11-11): it's then the variant
  // <harness PN>-<length in mm>, the same harness at another length.
  const pnOf = (h, cab) => { const base = (h && h.pn) || ''; return cab.lengthMm ? (base || '(no PN)') + '-' + Math.round(cab.lengthMm) : base; };
  const endName = (s, e) => { const b = e && block(s, e.block), c = b && conn(b, e.conn); return b && c ? `${b.ref} ${c.ref}` : ''; };

  function checks(s, get) {
    const out = [];
    const add = (sev, text, sel) => out.push({ sev, text, sel });
    s.blocks.forEach(b => b.conns.forEach(c => {
      const at = pluggedAt(s, b.id, c.id), where = `${b.ref} ${c.ref}`;
      if (c.used && !at.length) add('warn', `${where}${c.fn ? ' (' + c.fn + ')' : ''} is used, but nothing is plugged into it.`, { kind: 'conn', block: b.id, conn: c.id });
      if (!c.used && at.length) add('warn', `${where} has a cable but isn't marked used.`, { kind: 'conn', block: b.id, conn: c.id });
      if (at.length > 1) add('error', `${where} has ${at.length} cables plugged into it.`, { kind: 'conn', block: b.id, conn: c.id });
    }));
    s.cables.forEach(cab => {
      const h = get(cab.harness), sel = { kind: 'cable', id: cab.id };
      if (!h) { add('error', `Cable ${cab.label || cab.id} names a harness that isn't here.`, sel); return; }
      harnessEnds(h).forEach(n => {
        const e = cab.ends[n.id], b = e && block(s, e.block), c = b && conn(b, e.conn);
        if (!c) { add('warn', `${h.title}: ${n.ref} isn't plugged in.`, sel); return; }
        const where = `${h.title} ${n.ref} → ${b.ref} ${c.ref}`;
        const hp = M.pinList(n);
        if (hp.length !== c.pins.length) add('error', `${where}: the harness end has ${hp.length} pins, the connector ${c.pins.length}.`, sel);
        const bad = [];
        c.pins.forEach(p => { const l = (n.pinLabels || {})[p.pin] || ''; if (l && p.label && l !== p.label) bad.push(`${p.pin} ${l} ≠ ${p.label}`); });
        if (bad.length) add('warn', `${where}: pin labels don't match the board's nets (${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', …' : ''}).`, sel);
        if (n.board && b.source && n.board.project === b.source.id && n.board.source && b.source.label && n.board.source !== b.source.label)
          add('warn', `${where}: the end was filled from ${n.board.source}; this block is ${b.source.label}.`, sel);
      });
    });
    return out;
  }
  // What a reader of the stored file sees (Signoff PL, phase 4).
  function summarize(sys, get) {
    const c = checks(sys, get), qty = {};
    sys.cables.forEach(cab => { const h = get(cab.harness), k = cab.harness + '|' + (cab.lengthMm || ''); qty[k] = qty[k] || { harness: cab.harness, pn: pnOf(h, cab), name: h ? h.title : '', qty: 0 }; qty[k].qty++; });
    return { v: 1, tool: 'loom', kind: 'system', name: sys.title, project: sys.project || '', revision: sys.rev || '', archived: !!sys.deleted,
      blocks: sys.blocks.map(b => ({ ref: b.ref, name: b.name, kind: b.kind, ee: b.source && b.source.id || '', used: b.conns.filter(x => x.used).length })),
      harnesses: Object.values(qty), errors: c.filter(x => x.sev === 'error').length, warnings: c.filter(x => x.sev === 'warn').length };
  }

  // ── Storage ──
  function load() {
    try { S.store = JSON.parse(localStorage.getItem(NS + 'systems') || '{}') || {}; } catch (e) { S.store = {}; }
    Object.keys(S.store).forEach(id => { try { normalize(S.store[id]); } catch (e) { delete S.store[id]; } });
    let c = null;
    try { c = localStorage.getItem(NS + 'currentSystem'); } catch (e) { /* storage blocked */ }
    const want = new URLSearchParams(location.search).get('system');
    S.cur = want && S.store[want] ? want : null;
    return S.cur || (c && S.store[c] && !S.store[c].deleted && !new URLSearchParams(location.search).get('project') ? c : null);
  }
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(NS + 'systems', JSON.stringify(S.store)); localStorage.setItem(NS + 'currentSystem', S.cur || ''); }
      catch (e) { A.toast("Couldn't keep this in the browser: " + e.message, 'error'); }
    }, 200);
  }
  const live = () => Object.values(S.store).filter(s => !s.deleted);
  const cur = () => S.store[S.cur] || null;

  // ── Changes and undo (its own, apart from the harness editor's) ──
  function change(fn) {
    const s = cur();
    if (!s) return null;
    S.past.push(JSON.stringify(s)); if (S.past.length > 120) S.past.shift(); S.future = [];
    const r = fn(s);
    s.updated = now();
    if (A.login()) s.updatedBy = A.login();
    persist(); A.refresh();
    return r;
  }
  function swap(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(cur()));
    S.store[S.cur] = JSON.parse(from.pop());
    if (S.sel && !selValid()) S.sel = null;
    persist(); A.refresh();
  }
  function selValid() {
    const s = cur(), t = S.sel;
    if (!s || !t) return false;
    if (t.kind === 'block') return !!block(s, t.block);
    if (t.kind === 'conn') return !!conn(block(s, t.block), t.conn);
    if (t.kind === 'cable') return !!cable(s, t.id);
    return false;
  }

  function open(id) { S.cur = id; S.sel = null; S.past = []; S.future = []; S.cam = null; S.adding = null; S.picking = null; persist(); }
  function create(project) { const s = blank(project); S.store[s.id] = s; open(s.id); return s; }

  // ── Drawing ──
  // A tab's center, and where a cable leaves it: off the block edge nearest the tab.
  function tabGeom(b, c) {
    const cx = b.x + c.x + TAB.w / 2, cy = b.y + c.y + TAB.h / 2;
    const d = [[c.x, -1, 0], [b.w - c.x - TAB.w, 1, 0], [c.y, 0, -1], [b.h - c.y - TAB.h, 0, 1]].sort((p, q) => p[0] - q[0])[0];
    return { cx, cy, dx: d[1], dy: d[2] };
  }
  function cablePath(s, cab, h) {
    const ends = harnessEnds(h).map(n => ({ n, e: cab.ends[n.id] })).map(x => { const b = x.e && block(s, x.e.block), c = b && conn(b, x.e.conn); return Object.assign(x, { b, c, g: c ? tabGeom(b, c) : null }); });
    const at = ends.filter(x => x.g);
    const out = [];
    if (!at.length) return { paths: out, mid: null, open: ends.length };
    const exit = g => ({ x: g.cx + g.dx * (TAB.w / 2 + 6), y: g.cy + g.dy * (TAB.h / 2 + 6) });
    // Every plugged end runs at right angles to a shared junction (one end: a stub).
    const pts = at.map(x => exit(x.g));
    const jx = pts.reduce((t, p) => t + p.x, 0) / pts.length, jy = pts.reduce((t, p) => t + p.y, 0) / pts.length;
    at.forEach((x, i) => {
      const p = pts[i], g = x.g;
      if (at.length === 1) { out.push({ d: `M${g.cx} ${g.cy}L${p.x + g.dx * STUB} ${p.y + g.dy * STUB}`, open: true, ring: { x: p.x + g.dx * STUB, y: p.y + g.dy * STUB } }); return; }
      const d = g.dx ? `M${g.cx} ${g.cy}L${p.x} ${p.y}L${jx} ${p.y}L${jx} ${jy}` : `M${g.cx} ${g.cy}L${p.x} ${p.y}L${p.x} ${jy}L${jx} ${jy}`;
      out.push({ d });
    });
    const mid = at.length === 1 ? out[0].ring : { x: jx, y: jy };
    // Ends not plugged yet: a dashed stub off the junction, ending in a ring.
    const unplugged = ends.length - at.length;
    if (unplugged && at.length > 1) out.push({ d: `M${jx} ${jy}l0 ${STUB}`, open: true, ring: { x: jx, y: jy + STUB } });
    return { paths: out, mid, open: unplugged };
  }
  function svgHtml(s) {
    const sel = S.sel, get = A.harness;
    const isSel = (k, a, b2) => sel && sel.kind === k && (k === 'cable' ? sel.id === a : sel.block === a && (k === 'block' || sel.conn === b2));
    let html = '<g class="sys-blocks">';
    s.blocks.forEach(b => {
      const bs = isSel('block', b.id) || (sel && sel.kind === 'conn' && sel.block === b.id);
      html += `<g class="sys-block ${b.kind}${bs ? ' sel' : ''}" data-block="${b.id}">` +
        `<rect class="sys-body" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.kind === 'device' ? 3 : 2}"/>` +
        `<text class="sys-ref" x="${b.x + 2.5}" y="${b.y + 5.5}">${esc(b.ref)}</text>` +
        `<text class="sys-name" x="${b.x + 2.5}" y="${b.y + 10}">${esc(b.name)}</text>`;
      b.conns.forEach(c => {
        const at = pluggedAt(s, b.id, c.id).length;
        const cls = ['sys-tab', c.used ? 'used' : 'unused', at ? 'plugged' : '', c.used && !at ? 'open' : '', c.side === 'bottom' ? 'bottom' : '', isSel('conn', b.id, c.id) ? 'sel' : ''].filter(Boolean).join(' ');
        const tx = b.x + c.x, ty = b.y + c.y;
        html += `<g class="${cls}" data-conn="${c.id}" data-block="${b.id}"><title>${esc(`${b.ref} ${c.ref}${c.fn ? ' · ' + c.fn : ''} · ${c.pins.length} pins${c.side === 'bottom' ? ' · bottom side' : ''}${c.placed === 'hand' && b.source ? ' · placed by hand' : ''}`)}</title>` +
          `<rect x="${tx}" y="${ty}" width="${TAB.w}" height="${TAB.h}" rx="0.8"/><text x="${tx + TAB.w / 2}" y="${ty + TAB.h / 2 + 1.1}">${esc(c.ref)}</text></g>`;
      });
      html += '</g>';
    });
    html += '</g><g class="sys-cables">';
    s.cables.forEach(cab => {
      const h = get(cab.harness), st = status(h), g = cablePath(s, cab, h);
      const on = isSel('cable', cab.id);
      html += `<g class="sys-cable st-${st.key}${on ? ' sel' : ''}" data-cable="${cab.id}">`;
      g.paths.forEach(p => { html += `<path class="hit" d="${p.d}"/><path class="line${p.open ? ' open' : ''}" d="${p.d}"/>` + (p.ring ? `<circle class="ring" cx="${p.ring.x}" cy="${p.ring.y}" r="1.4"/>` : ''); });
      if (g.mid) {
        const label = `${st.glyph} ${h ? h.title : 'Missing harness'}${pnOf(h, cab) ? ' · ' + pnOf(h, cab) : ''}`;
        html += `<text class="sys-clabel" x="${g.mid.x + 2}" y="${g.mid.y - 2}">${esc(label)}</text>`;
      }
      html += '</g>';
    });
    return html + '</g>';
  }
  function bounds(s) {
    if (!s.blocks.length) return { x: -20, y: -20, w: 200, h: 120 };
    const x0 = Math.min(...s.blocks.map(b => b.x)), y0 = Math.min(...s.blocks.map(b => b.y));
    const x1 = Math.max(...s.blocks.map(b => b.x + b.w)), y1 = Math.max(...s.blocks.map(b => b.y + b.h));
    const m = 12;
    return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
  }

  // ── The panel ──
  const fld = (label, inner, hint) => `<div class="field"><label>${label}</label>${inner}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const inp = (f, v, attrs) => `<input class="input" data-sf="${f}" value="${esc(v == null ? '' : v)}"${attrs || ''}>`;
  const btn = (act, label, extra, cls) => `<button class="btn${cls ? ' ' + cls : ''}" data-sact="${act}"${extra || ''}>${label}</button>`;
  function panelHtml(s) {
    const t = S.sel, get = A.harness;
    if (S.adding) return addingHtml();
    if (t && t.kind === 'conn') return connHtml(s, block(s, t.block), conn(block(s, t.block), t.conn));
    if (t && t.kind === 'block') return blockHtml(s, block(s, t.block));
    if (t && t.kind === 'cable') return cableHtml(s, cable(s, t.id));
    const c = checks(s, get);
    return `<div class="rail-head"><div class="eyebrow">System</div><div class="rail-title">${esc(s.title)}</div></div>` +
      fld('Title', inp('title', s.title)) + fld('Client project', inp('project', s.project, ' list="sys-projects"') + `<datalist id="sys-projects">${A.projects().map(p => `<option value="${esc(p)}">`).join('')}</datalist>`) + fld('Rev', inp('rev', s.rev)) +
      `<div class="sys-actions">${btn('add-board', 'Add a board from Signoff EE', '', 'btn-primary')}${btn('add-drawn', 'Draw a board')}${btn('add-device', 'Add a device')}</div>` +
      `<h4 class="sys-h">Cables <span class="count">${s.cables.length}</span></h4>` +
      (s.cables.length ? `<div class="sys-list">${s.cables.map(cab => { const h = get(cab.harness), st = status(h); return `<button class="sys-row" data-ssel="cable:${cab.id}"><span class="sys-st st-${st.key}" title="${esc(st.text)}">${st.glyph}</span><span>${esc(h ? h.title : 'Missing harness')}<small>${esc([pnOf(h, cab), harnessEnds(h).map(n => endName(s, cab.ends[n.id]) || n.ref + ' not plugged').join(' · ')].filter(Boolean).join(' · '))}</small></span></button>`; }).join('')}</div>` : '<p class="hint">Click a connector on a board, mark it used, and plug a harness into it.</p>') +
      `<h4 class="sys-h">Checks <span class="count">${c.length}</span></h4>` + checksHtml(c) +
      `<div class="sys-actions">${btn('delete-system', 'Delete system', '', 'btn-danger')}</div>`;
  }
  function checksHtml(c) {
    if (!c.length) return '<p class="hint">No problems found.</p>';
    return `<div class="sys-checks">${c.map((x, i) => `<button class="sys-check ${x.sev}" data-scheck="${i}"><span class="sev">${x.sev === 'error' ? '■' : '▲'}</span>${esc(x.text)}</button>`).join('')}</div>`;
  }
  function addingHtml() {
    const head = `<div class="rail-head"><div class="eyebrow">Add a board</div><div class="rail-title">From Signoff EE</div></div>`;
    if (S.busy) return head + `<p class="hint">${esc(S.busy)}</p>`;
    if (S.boardsErr) return head + `<p class="hint">${esc(S.boardsErr)}</p>` + btn('cancel-add', 'Back');
    if (!S.boards) return head + '<p class="hint">Reading the boards…</p>';
    const groups = new Map();
    S.boards.forEach(b => { const k = b.client || 'No project'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
    return head + '<p class="hint">Its connectors come from the tagged revision’s package (or the latest stored Fabcheck run), placed where its pick-and-place puts them.</p>' +
      [...groups].map(([k, list]) => `<h4 class="sys-h">${esc(k)}</h4><div class="sys-list">${list.map(b => `<button class="sys-row" data-sact="pick-board" data-board="${esc(b.id)}"><span class="sys-st">▭</span><span>${esc(b.name)}</span></button>`).join('')}</div>`).join('') +
      btn('cancel-add', 'Cancel');
  }
  function blockHtml(s, b) {
    const used = b.conns.filter(c => c.used).length;
    return `<div class="rail-head"><div class="eyebrow">${b.kind === 'device' ? 'Device' : 'Board'} ${esc(b.ref)}</div><div class="rail-title">${esc(b.name)}</div></div>` +
      fld('Ref', inp('b.ref', b.ref)) + fld('Name', inp('b.name', b.name)) +
      (b.source ? `<p class="hint">From Signoff EE: ${esc(b.source.name)}${b.source.label ? ' · ' + esc(b.source.label) : ''}. ${esc(String(b.w))} × ${esc(String(b.h))} mm, from its pick-and-place.</p><div class="sys-actions">${btn('open-ee', 'Open in Signoff EE')}</div>`
        : `<div class="field-row">${fld('Width, mm', inp('b.w', b.w, ' type="number" min="5"'))}${fld('Height, mm', inp('b.h', b.h, ' type="number" min="5"'))}</div>`) +
      `<h4 class="sys-h">Connectors <span class="count">${used} used of ${b.conns.length}</span></h4>` +
      `<div class="sys-list">${b.conns.map(c => `<div class="sys-crow"><label class="tick"><input type="checkbox" data-sused="${c.id}"${c.used ? ' checked' : ''}> ${esc(c.ref)}</label><button class="sys-link" data-ssel="conn:${b.id}:${c.id}">${esc(c.fn || c.desc || c.pins.length + ' pins')}</button></div>`).join('')}</div>` +
      `<div class="sys-actions">${btn('add-conn', 'Add a connector')}${btn('dup-block', 'Copy this block')}${btn('delete-block', 'Delete', '', 'btn-danger')}</div>`;
  }
  function connHtml(s, b, c) {
    const at = pluggedAt(s, b.id, c.id), get = A.harness;
    const pins = c.pins.map(p => `<tr><td>${esc(p.pin)}</td><td>${esc(p.label || p.net || '')}</td></tr>`).join('');
    const pick = S.picking && S.picking.block === b.id && S.picking.conn === c.id;
    return `<div class="rail-head"><div class="eyebrow">${esc(b.ref)} · ${esc(b.name)}</div><div class="rail-title">${esc(c.ref)}</div></div>` +
      `<label class="tick sys-used"><input type="checkbox" data-sused="${c.id}"${c.used ? ' checked' : ''}> Used</label>` +
      fld('Function', inp('c.fn', c.fn, ' placeholder="What it connects to: Fan, Display, 24 VAC in…"')) +
      (b.source ? '' : `<div class="field-row">${fld('Ref', inp('c.ref', c.ref))}${fld('Pins', inp('c.pins', c.pins.length, ' type="number" min="1" max="200"'))}</div>`) +
      (c.mpn || c.desc ? `<p class="hint">${esc([c.mfr, c.mpn, c.desc].filter(Boolean).join(' · '))}${c.side === 'bottom' ? ' · bottom side' : ''}${c.placed === 'hand' && b.source ? ' · not in the pick-and-place, placed by hand' : ''}</p>` : '') +
      `<h4 class="sys-h">Plugged in</h4>` +
      (at.length ? `<div class="sys-list">${at.map(x => { const h = get(x.cable.harness), n = h && M.node(h, x.node), st = status(h); return `<button class="sys-row" data-ssel="cable:${x.cable.id}"><span class="sys-st st-${st.key}" title="${esc(st.text)}">${st.glyph}</span><span>${esc(h ? h.title : 'Missing harness')}<small>${esc(n ? 'its end ' + n.ref : '')}</small></span></button>`; }).join('')}</div>` : '<p class="hint">Nothing yet.</p>') +
      (pick ? pickHtml(s, b, c) : `<div class="sys-actions">${btn('new-harness', 'New harness here', '', 'btn-primary')}${btn('pick-harness', 'Plug in a harness…')}</div>`) +
      `<p class="hint">Pick another connector with Shift-click, then New harness here, for a cable between the two (its wires are offered from shared nets).</p>` +
      (S.pair && S.pair.block !== b.id || S.pair && S.pair.conn !== c.id ? '' : '') +
      `<details class="sys-pins"><summary>${c.pins.length} pins</summary><table class="sys-pintab"><tr><th>Pin</th><th>Net</th></tr>${pins}</table></details>` +
      (b.source ? '' : `<div class="sys-actions">${btn('delete-conn', 'Delete connector', '', 'btn-danger')}</div>`);
  }
  function pickHtml(s, b, c) {
    const list = A.harnesses().filter(h => harnessEnds(h).length);
    const score = h => { const n = bestEnd(s, null, h, b, c); return n && n.board && b.source && n.board.project === b.source.id && n.board.ref === c.ref ? 0 : n && M.pinList(n).length === c.pins.length ? 1 : 2; };
    list.sort((x, y) => score(x) - score(y) || String(x.title).localeCompare(String(y.title)));
    return `<h4 class="sys-h">Plug in</h4><div class="sys-list">${list.map(h => { const sc = score(h); return `<button class="sys-row" data-sact="plug" data-harness="${h.id}"><span class="sys-st">${sc === 0 ? '★' : sc === 1 ? '=' : '·'}</span><span>${esc(h.title)}<small>${esc([h.pn, sc === 0 ? 'made from this connector' : sc === 1 ? 'same pin count' : '', h.project].filter(Boolean).join(' · '))}</small></span></button>`; }).join('') || '<p class="hint">No harnesses yet.</p>'}</div>${btn('cancel-pick', 'Cancel')}`;
  }
  function cableHtml(s, cab) {
    const h = A.harness(cab.harness), st = status(h);
    const opts = cur => `<option value="">Not plugged</option>` + s.blocks.map(b => b.conns.map(c => `<option value="${b.id}|${c.id}"${cur && cur.block === b.id && cur.conn === c.id ? ' selected' : ''}>${esc(`${b.ref} ${c.ref}${c.fn ? ' · ' + c.fn : ''}`)}</option>`).join('')).join('');
    return `<div class="rail-head"><div class="eyebrow">Cable</div><div class="rail-title">${esc(h ? h.title : 'Missing harness')}</div></div>` +
      `<p class="hint"><span class="sys-st st-${st.key}">${st.glyph}</span> ${esc(st.text)}${h && h.pn ? ' · ' + esc(h.pn) : ''}</p>` +
      (h ? harnessEnds(h).map(n => fld(`${esc(n.ref)}${n.name ? ' · ' + esc(n.name) : ''} plugs into`, `<select class="input" data-send="${n.id}">${opts(cab.ends[n.id])}</select>`)).join('') : '') +
      fld('Length here, mm', inp('cab.len', cab.lengthMm || '', ' type="number" min="1" placeholder="The harness’s own"'), cab.lengthMm ? `A variant at this length: <b>${esc(pnOf(h, cab))}</b>.` : 'Set it to use this harness at another length, as a variant part number.') +
      `<div class="sys-actions">${h ? btn('open-harness', 'Open the harness', '', 'btn-primary') : ''}${btn('delete-cable', 'Remove from the system', '', 'btn-danger')}</div>`;
  }

  // ── Render ──
  function render(page) {
    const s = cur();
    if (!s) return;
    page.classList.add('sys-on');
    if (!page.querySelector('.sys-view')) {
      page.innerHTML = `<div class="sys-view"><div class="sys-canvas-wrap canvas-wrap cv-paper"><svg class="sys-canvas" id="sys-canvas" xmlns="http://www.w3.org/2000/svg"></svg>
        <div class="board-hud glass sys-hud"><button class="icon-btn" data-sact="undo" title="Undo (Ctrl+Z)">↶</button><button class="icon-btn" data-sact="redo" title="Redo (Ctrl+Shift+Z)">↷</button><button class="icon-btn" data-sact="fit" title="Fit (F)">⤢</button><span class="sys-hint" id="sys-hint"></span></div></div>
        <aside class="rail sys-panel" id="sys-panel"></aside></div>`;
      wire(page);
    }
    const svg = page.querySelector('#sys-canvas');
    if (!S.cam) S.cam = bounds(s);
    svg.setAttribute('viewBox', `${S.cam.x} ${S.cam.y} ${S.cam.w} ${S.cam.h}`);
    svg.innerHTML = svgHtml(s);
    page.querySelector('[data-sact="undo"]').disabled = !S.past.length;
    page.querySelector('[data-sact="redo"]').disabled = !S.future.length;
    page.querySelector('#sys-hint').textContent = S.pair ? `Pair: ${endName(s, S.pair)} and the selected connector` : s.blocks.length ? 'Drag blocks · click a connector · wheel zooms · drag empty space to pan' : 'Add a board from the panel';
    const panel = page.querySelector('#sys-panel'), keep = panel.scrollTop;
    panel.innerHTML = panelHtml(s);
    panel.scrollTop = keep;
  }
  function leave(page) { page.classList.remove('sys-on'); }

  // ── Interaction ──
  function toWorld(svg, e) {
    const r = svg.getBoundingClientRect(), k = Math.max(S.cam.w / r.width, S.cam.h / r.height);
    const ox = S.cam.x + (S.cam.w - r.width * k) / 2, oy = S.cam.y + (S.cam.h - r.height * k) / 2;
    return { x: ox + (e.clientX - r.left) * k, y: oy + (e.clientY - r.top) * k, k };
  }
  const snap = v => Math.round(v);
  let drag = null;
  function wire(page) {
    const svg = page.querySelector('#sys-canvas');
    svg.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const p = toWorld(svg, e), t = e.target;
      const tab = t.closest('[data-conn]'), cb = t.closest('[data-cable]'), bl = t.closest('[data-block]');
      const s = cur();
      if (tab) {
        const sel = { kind: 'conn', block: tab.dataset.block, conn: tab.dataset.conn };
        if (e.shiftKey && S.sel && S.sel.kind === 'conn') { S.pair = { block: S.sel.block, conn: S.sel.conn }; }
        else S.pair = null;
        S.sel = sel; S.picking = null;
        const b = block(s, sel.block), c = conn(b, sel.conn);
        drag = { kind: 'conn', p, x: c.x, y: c.y, moved: false, b, c, editable: !b.source || c.placed === 'hand' };
      } else if (cb) { S.sel = { kind: 'cable', id: cb.dataset.cable }; S.pair = null; drag = null; }
      else if (bl) {
        const b = block(s, bl.dataset.block);
        S.sel = { kind: 'block', block: b.id }; S.pair = null;
        drag = { kind: 'block', p, x: b.x, y: b.y, moved: false, b };
      } else { S.sel = null; S.pair = null; drag = { kind: 'pan', p, cam: Object.assign({}, S.cam), cx: e.clientX, cy: e.clientY, k: p.k }; }
      S.picking = S.picking && S.sel && S.sel.kind === 'conn' && S.picking.conn === S.sel.conn ? S.picking : null;
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* not an active pointer */ }
      A.refresh();
    });
    svg.addEventListener('pointermove', e => {
      if (!drag) return;
      if (drag.kind === 'pan') { S.cam.x = drag.cam.x - (e.clientX - drag.cx) * drag.k; S.cam.y = drag.cam.y - (e.clientY - drag.cy) * drag.k; svg.setAttribute('viewBox', `${S.cam.x} ${S.cam.y} ${S.cam.w} ${S.cam.h}`); return; }
      const p = toWorld(svg, e), dx = p.x - drag.p.x, dy = p.y - drag.p.y;
      if (!drag.moved && Math.hypot(dx, dy) < 0.8) return;
      if (drag.kind === 'conn' && !drag.editable) return;
      if (!drag.moved) { const s = cur(); S.past.push(JSON.stringify(s)); S.future = []; drag.moved = true; }
      // Re-find the live objects (the snapshot above doesn't replace them).
      if (drag.kind === 'block') { drag.b.x = snap(drag.x + dx); drag.b.y = snap(drag.y + dy); }
      else { drag.c.x = Math.max(-TAB.w / 2, Math.min(drag.b.w - TAB.w / 2, snap(drag.x + dx))); drag.c.y = Math.max(-TAB.h / 2, Math.min(drag.b.h - TAB.h / 2, snap(drag.y + dy))); }
      svg.innerHTML = svgHtml(cur());
    });
    const up = () => { if (drag && drag.moved) { const s = cur(); s.updated = now(); persist(); A.refresh(); } drag = null; };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const p = toWorld(svg, e), m = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      S.cam = { x: p.x - (p.x - S.cam.x) * m, y: p.y - (p.y - S.cam.y) * m, w: S.cam.w * m, h: S.cam.h * m };
      svg.setAttribute('viewBox', `${S.cam.x} ${S.cam.y} ${S.cam.w} ${S.cam.h}`);
    }, { passive: false });
    if (page.sysWired) return;
    page.sysWired = true;
    page.addEventListener('click', e => {
      const t = e.target;
      const a = t.closest('[data-sact]');
      if (a && !a.disabled) { act(a.dataset.sact, a); return; }
      const sl = t.closest('[data-ssel]');
      if (sl) { const [k, x, y] = sl.dataset.ssel.split(':'); S.sel = k === 'cable' ? { kind: 'cable', id: x } : { kind: 'conn', block: x, conn: y }; S.picking = null; A.refresh(); return; }
      const ck = t.closest('[data-scheck]');
      if (ck) { const c = checks(cur(), A.harness)[+ck.dataset.scheck]; if (c && c.sel) { S.sel = c.sel; A.refresh(); } }
    });
    page.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.sused) { const id = t.dataset.sused, on = t.checked; change(s => { s.blocks.forEach(b => b.conns.forEach(c => { if (c.id === id) c.used = on; })); }); return; }
      if (t.dataset.send) { const [bid, cid] = t.value ? t.value.split('|') : []; const node = t.dataset.send; change(s => { const cab = cable(s, S.sel.id); cab.ends[node] = bid ? { block: bid, conn: cid } : null; }); return; }
      if (t.dataset.sf) setField(t.dataset.sf, t.value);
    });
  }
  function setField(f, v) {
    change(s => {
      const b = S.sel && S.sel.block && block(s, S.sel.block), c = b && S.sel.conn && conn(b, S.sel.conn);
      if (f === 'title') s.title = v.trim() || 'Untitled system';
      else if (f === 'project') s.project = v.trim();
      else if (f === 'rev') s.rev = v.trim();
      else if (f === 'b.ref' && b) b.ref = v.trim() || b.ref;
      else if (f === 'b.name' && b) b.name = v.trim() || b.name;
      else if (f === 'b.w' && b && +v >= 5) b.w = +v;
      else if (f === 'b.h' && b && +v >= 5) b.h = +v;
      else if (f === 'c.fn' && c) c.fn = v.trim();
      else if (f === 'c.ref' && c) c.ref = v.trim() || c.ref;
      else if (f === 'c.pins' && c && +v >= 1) { const n = Math.min(200, Math.round(+v)); c.pins = Array.from({ length: n }, (_, i) => c.pins[i] || { pin: String(i + 1), net: '', label: '' }); }
      else if (f === 'cab.len') { const cab = cable(s, S.sel.id); cab.lengthMm = +v > 0 ? Math.round(+v) : null; }
    });
  }
  // A clear spot for a new block: right of everything.
  function freeSpot(s) { return s.blocks.length ? { x: Math.max(...s.blocks.map(b => b.x + b.w)) + 40, y: Math.min(...s.blocks.map(b => b.y)) } : { x: 0, y: 0 }; }
  async function act(a, el) {
    const s = cur();
    switch (a) {
      case 'undo': swap(S.past, S.future); break;
      case 'redo': swap(S.future, S.past); break;
      case 'fit': S.cam = bounds(s); A.refresh(); break;
      case 'add-drawn': case 'add-device': { const b = change(x => addDrawn(x, a === 'add-device' ? 'device' : 'board', freeSpot(x))); S.sel = { kind: 'block', block: b.id }; S.cam = null; A.refresh(); break; }
      case 'add-board':
        S.adding = true; S.boardsErr = ''; A.refresh();
        if (!S.boards) {
          try { S.boards = await LM.boards.listBoards(); }
          catch (e) { S.boardsErr = e.code === 'signin' ? 'Sign in to GitHub in Settings to read Signoff EE’s boards.' : e.message; }
          A.refresh();
        }
        break;
      case 'cancel-add': S.adding = null; A.refresh(); break;
      case 'pick-board': {
        const bd = S.boards.find(b => b.id === el.dataset.board);
        S.busy = `Reading ${bd.name}’s package…`; A.refresh();
        try {
          const pkg = await LM.boards.loadBoard(bd);
          const b = change(x => { if (!x.project && bd.client) x.project = bd.client; return addBoard(x, bd, pkg, freeSpot(x)); });
          S.adding = null; S.sel = { kind: 'block', block: b.id }; S.cam = null;
          A.toast(`Added ${b.ref}: ${bd.name}, ${b.conns.length} connectors${pkg.pnp ? '' : ' (no pick-and-place in its package, so they wait along the bottom edge)'}. Tick the ones it uses.`);
        } catch (e) { A.toast(e.message, 'error'); }
        S.busy = ''; A.refresh();
        break;
      }
      case 'add-conn': { const c = change(x => mkConn(block(x, S.sel.block))); S.sel = { kind: 'conn', block: S.sel.block, conn: c.id }; A.refresh(); break; }
      case 'dup-block': {
        const b2 = change(x => { const b = block(x, S.sel.block), c = JSON.parse(JSON.stringify(b)); c.id = U.uid('b'); c.ref = nextRef(x.blocks, b.kind === 'device' ? 'D' : 'A'); c.x = b.x + 20; c.y = b.y + b.h + 20; c.conns.forEach(k => { k.id = U.uid('c'); }); x.blocks.push(c); return c; });
        S.sel = { kind: 'block', block: b2.id }; A.refresh(); break;
      }
      case 'delete-block': change(x => { const id = S.sel.block; x.blocks = x.blocks.filter(b => b.id !== id); x.cables.forEach(c => Object.keys(c.ends).forEach(k => { if (c.ends[k] && c.ends[k].block === id) c.ends[k] = null; })); S.sel = null; }); break;
      case 'delete-conn': change(x => { const b = block(x, S.sel.block), id = S.sel.conn; b.conns = b.conns.filter(c => c.id !== id); x.cables.forEach(c => Object.keys(c.ends).forEach(k => { if (c.ends[k] && c.ends[k].conn === id) c.ends[k] = null; })); S.sel = { kind: 'block', block: b.id }; }); break;
      case 'delete-cable': change(x => { const id = S.sel.id; x.cables = x.cables.filter(c => c.id !== id); S.sel = null; }); break;
      case 'pick-harness': S.picking = { block: S.sel.block, conn: S.sel.conn }; A.refresh(); break;
      case 'cancel-pick': S.picking = null; A.refresh(); break;
      case 'plug': {
        const h = A.harness(el.dataset.harness), b = block(s, S.sel.block), c = conn(b, S.sel.conn);
        const n = bestEnd(s, null, h, b, c);
        if (!n) break;
        const id = change(x => { const cab = { id: U.uid('k'), harness: h.id, ends: {}, lengthMm: null }; harnessEnds(h).forEach(e => { cab.ends[e.id] = null; }); cab.ends[n.id] = { block: b.id, conn: c.id }; const k = conn(block(x, b.id), c.id); k.used = true; x.cables.push(cab); return cab.id; });
        S.picking = null; S.sel = { kind: 'cable', id }; A.refresh();
        A.toast(`${h.title}'s end ${n.ref} plugs into ${b.ref} ${c.ref}. Pick where its other ends go.`);
        break;
      }
      case 'new-harness': {
        const b = block(s, S.sel.block), c = conn(b, S.sel.conn);
        const pb = S.pair && block(s, S.pair.block), pc = pb && conn(pb, S.pair.conn);
        const two = pc && pc !== c ? [{ b: pb, c: pc }, { b, c }] : [{ b, c }];
        const made = A.newHarness(s, two);
        change(x => {
          const cab = { id: U.uid('k'), harness: made.h.id, ends: {}, lengthMm: null };
          made.ends.forEach((nodeId, i) => { if (two[i]) { cab.ends[nodeId] = { block: two[i].b.id, conn: two[i].c.id }; conn(block(x, two[i].b.id), two[i].c.id).used = true; } else cab.ends[nodeId] = null; });
          x.cables.push(cab);
          S.sel = { kind: 'cable', id: cab.id };
        });
        S.pair = null;
        A.toast(two.length > 1 ? `Made ${made.h.title} between ${two[0].b.ref} ${two[0].c.ref} and ${b.ref} ${c.ref}${made.suggested ? `, with ${made.suggested} wires from shared nets` : ''}.` : `Made ${made.h.title}, a placeholder plugged into ${b.ref} ${c.ref}. Open it to wire the far end.`);
        break;
      }
      case 'open-harness': { const cab = cable(s, S.sel.id); A.openHarness(cab.harness); break; }
      case 'open-ee': { const b = block(s, S.sel.block); location.href = `../ee_design_review/index.html?project=${encodeURIComponent(b.source.id)}${DEMO ? '&demo' : ''}`; break; }
      case 'delete-system':
        if (!confirm(`Delete ${s.title}? Its harnesses stay.`)) break;
        s.deleted = true; s.updated = now(); S.cur = null; persist(); A.home(); break;
    }
  }
  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? swap(S.future, S.past) : swap(S.past, S.future); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); swap(S.future, S.past); return; }
    if (e.key === 'Escape') { S.sel = null; S.pair = null; S.picking = null; S.adding = null; A.refresh(); return; }
    if (e.key.toLowerCase() === 'f' && !mod) { S.cam = bounds(cur()); A.refresh(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) {
      e.preventDefault();
      act(S.sel.kind === 'block' ? 'delete-block' : S.sel.kind === 'cable' ? 'delete-cable' : (block(cur(), S.sel.block) || {}).source ? '' : 'delete-conn');
    }
  }
  // Where a harness end plugs in, across every system (the harness editor's rail shows it).
  function plugsOf(hid, nodeId) {
    const out = [];
    live().forEach(s => s.cables.forEach(c => { if (c.harness !== hid) return; const e = c.ends[nodeId]; const where = endName(s, e); if (where) { const b = block(s, e.block); out.push({ system: s, text: `${b.name} ${conn(b, e.conn).ref} in ${s.title}` }); } }));
    return out;
  }

  // ── The demo: the Smart Thermostat's two boards and its wall wiring ──
  async function demo() {
    const s = blank('Smart Thermostat');
    s.id = 'sdemo1'; s.title = 'Smart Thermostat system'; s.demoVersion = 1;
    S.store[s.id] = s;
    try {
      const bs = await LM.boards.listBoards();
      for (const bd of bs) { const pkg = await LM.boards.loadBoard(bd); addBoard(s, bd, pkg, freeSpot(s)); }
    } catch (e) { A.toast("Couldn't read the demo boards: " + e.message, 'error'); }
    const wall = addDrawn(s, 'device', { x: -70, y: 10 });
    wall.name = 'Wall wiring (24 VAC, heat, cool)'; wall.conns[0].ref = 'TB'; wall.conns[0].fn = 'Wall wires';
    open(s.id);
    return s;
  }

  function init(hooks) { A = hooks; return load(); }
  LM.system = { init, render, leave, open, create, demo, onKey, live, get: id => S.store[id], current: () => S.cur, close: () => { S.cur = null; persist(); },
    store: () => S.store, persist, act, select: t => { S.sel = t; S.pair = null; S.picking = null; A.refresh(); }, pair: t => { S.pair = t; }, checks, summarize, status, plugsOf, normalize, blank, addBoard, addDrawn, bestEnd, pnOf, TAB };
})(window.LM = window.LM || {});
