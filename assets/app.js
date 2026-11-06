// Loom UI: harnesses in the sidebar; Build (the connection diagram, its parts pane and the rail),
// Drawing (with the editable wire list folded under the sheet), BOM and Checks tabs. Harnesses live in this browser (localStorage) until saved as a
// .loom.json file.
(function (LM) {
  'use strict';
  const M = LM.model, U = LM.util, L = LM.library, C = LM.conn, esc = U.esc;
  const $ = s => document.querySelector(s);
  const DEMO = /[?&]demo\b/.test(location.search);
  const NS = DEMO ? 'loom.demo.' : 'loom.v1.';

  const S = {
    store: {}, cur: null, view: 'build', sel: null, pending: null, cam: null, past: [], future: [],
    wiresOpen: (() => { try { return localStorage.getItem(NS + 'wiresOpen') === '1'; } catch (e) { return false; } })(),
  };
  const H = () => S.store[S.cur] || null;

  // ── Theme: shared with the rest of Signoff (same key) ──
  const SETTINGS_KEY = (DEMO ? 'signoff.demo.' : 'signoff.v1.') + 'settings';
  const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function readTheme() { try { return (JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}).theme || 'auto'; } catch (e) { return 'auto'; } }
  function writeTheme(t) { try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; s.theme = t; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage blocked */ } }
  const isDark = t => t === 'dark' || (t !== 'light' && !!(darkQuery && darkQuery.matches));
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    const b = $('#theme-btn');
    if (b) { b.innerHTML = isDark(t) ? ICON.sun : ICON.moon; b.title = isDark(t) ? 'Light mode' : 'Dark mode'; }
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => applyTheme(readTheme()));

  const ICON = {
    sun: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3"/></svg>',
    moon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M16 12.3A6.5 6.5 0 0 1 7.7 4a6.5 6.5 0 1 0 8.3 8.3z"/></svg>',
    harness: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 6.5h3.5c3 0 3 7 6 7h5.5M2.5 13.5h3.5c3 0 3-7 6-7h5.5"/></svg>',
    undo: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 5 4 8.5 7.5 12"/><path d="M4 8.5h7.5a4.5 4.5 0 0 1 0 9H9"/></svg>',
    redo: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 5 16 8.5 12.5 12"/><path d="M16 8.5H8.5a4.5 4.5 0 0 0 0 9H11"/></svg>',
    save: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h5c4 0 4 8 8 8h5M3 16h5c4 0 4-8 8-8h5"/><circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="3" cy="16" r="1.4" fill="currentColor"/><circle cx="21" cy="8" r="1.4" fill="currentColor"/><circle cx="21" cy="16" r="1.4" fill="currentColor"/></svg>',
    conn: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="5" width="11" height="10" rx="2"/><path d="M14 8h3M14 12h3"/><circle cx="6.5" cy="8.5" r="0.9" fill="currentColor"/><circle cx="10.5" cy="8.5" r="0.9" fill="currentColor"/><circle cx="6.5" cy="11.5" r="0.9" fill="currentColor"/><circle cx="10.5" cy="11.5" r="0.9" fill="currentColor"/></svg>',
    splice: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 6h5l3 4M2.5 14h5l3-4h7"/><rect x="8.5" y="7.5" width="5" height="5" rx="1.4" fill="currentColor" stroke="none"/></svg>',
    breakout: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 10H10l6-5M10 10l6 5"/><circle cx="10" cy="10" r="2.2" fill="currentColor"/></svg>',
    trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 9h6.6l.7-9"/></svg>',
    board: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2.5" y="4" width="15" height="12" rx="2"/><rect x="5.5" y="7" width="5" height="4" rx="0.8"/><path d="M13 7.5h2M13 10h2M13 12.5h2"/></svg>',
    fit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>',
  };

  // ── Storage ──
  function load() {
    try { S.store = JSON.parse(localStorage.getItem(NS + 'harnesses') || '{}') || {}; } catch (e) { S.store = {}; }
    Object.keys(S.store).forEach(id => { try { M.normalize(S.store[id]); } catch (e) { delete S.store[id]; } });
    if (DEMO && (!S.store.hdemo1 || S.store.hdemo1.demoVersion !== LM.demo.VERSION)) S.store.hdemo1 = LM.demo.harness();
    let c = null;
    try { c = localStorage.getItem(NS + 'current'); } catch (e) { /* storage blocked */ }
    S.cur = S.store[c] ? c : DEMO ? 'hdemo1' : null;
  }
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(NS + 'harnesses', JSON.stringify(S.store));
        localStorage.setItem(NS + 'current', S.cur || '');
      } catch (e) { toast("Couldn't keep this in the browser: " + e.message, 'error'); }
    }, 200);
  }

  // ── Changes and undo ──
  function snapshot() { S.past.push(JSON.stringify(H())); if (S.past.length > 120) S.past.shift(); S.future = []; }
  function change(fn) {
    const h = H();
    if (!h) return null;
    snapshot();
    const r = fn(h);
    h.updated = Date.now();
    tidySel();
    persist();
    renderAll();
    return r;
  }
  function swapHistory(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(H()));
    S.store[S.cur] = JSON.parse(from.pop());
    S.pending = null;
    tidySel();
    persist();
    renderAll();
  }
  const undo = () => swapHistory(S.past, S.future);
  const redo = () => swapHistory(S.future, S.past);
  function tidySel() {
    const h = H();
    if (!S.sel || !h) { if (!h) S.sel = null; return; }
    const have = { node: h.nodes, seg: h.segments, wire: h.wires, group: h.groups }[S.sel.kind] || [];
    const ids = new Set([...S.sel.ids].filter(id => have.some(x => x.id === id)));
    S.sel = ids.size ? { kind: S.sel.kind, ids } : null;
  }
  const select = (kind, ids) => { S.sel = kind ? { kind, ids: new Set([].concat(ids)) } : null; renderAll(); };
  function openHarness(id) {
    S.cur = id; S.sel = null; S.pending = null; S.past = []; S.future = []; S.cam = null;
    persist();
    renderAll();
  }

  // ── Render ──
  function renderAll() {
    const h = H();
    renderSidebar();
    renderToolbar();
    const build = h && S.view === 'build';
    $('#build-view').hidden = !build;
    $('#page').hidden = build;
    if (!h) { $('#page').innerHTML = homeHtml(); return; }
    if (build) { applyFold(); renderCanvas(); renderParts(); renderRail(); renderHud(); return; }
    if (S.view === 'wires') { S.view = 'drawing'; S.wiresOpen = true; }
    const pages = { drawing: drawingHtml, bom: bomHtml, checks: checksHtml };
    const keep = $('#main').scrollTop;
    $('#page').innerHTML = (pages[S.view] || drawingHtml)(h);
    $('#main').scrollTop = keep;
  }

  function renderSidebar() {
    const list = Object.values(S.store).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    $('#harness-list').innerHTML = list.length ? list.map(h => {
      const c = M.checks(h);
      const e = c.filter(x => x.sev === 'error').length, w = c.filter(x => x.sev === 'warn').length;
      const ends = h.nodes.filter(M.isConn).length;
      return `<button class="proj${h.id === S.cur ? ' active' : ''}" data-open="${h.id}">
        <span class="pkg-icon">${ICON.harness}</span>
        <span class="proj-body"><span class="proj-name">${esc(h.title)}</span><span class="proj-sub">${esc(h.pn ? h.pn + ' · ' : '')}${ends} ends · ${h.wires.length} wires</span></span>
        <span class="pkg-sev">${e ? `<span class="e">${e}</span>` : ''}${w ? `<span class="w">${w}</span>` : ''}</span></button>`;
    }).join('') : '<div class="side-empty">No harnesses yet.</div>';
  }

  function renderToolbar() {
    const h = H();
    const seg = $('#view-seg');
    if (!h) { seg.innerHTML = ''; seg.hidden = true; $('#toolbar-actions').innerHTML = ''; return; }
    seg.hidden = false;
    const c = M.checks(h);
    const e = c.filter(x => x.sev === 'error').length, w = c.filter(x => x.sev === 'warn').length;
    const tabs = [['build', 'Build'], ['drawing', 'Drawing'], ['bom', 'BOM'], ['checks', 'Checks', e + w, e ? 'error' : w ? 'warn' : '']];
    seg.innerHTML = tabs.map(([v, l, n, dot]) => `<button class="${S.view === v ? 'on' : ''}" data-view="${v}">${l}${n ? ` <span class="count">${n}</span>` : ''}${dot ? `<span class="dot ${dot}"></span>` : ''}</button>`).join('');
    $('#toolbar-actions').innerHTML =
      `<button class="icon-btn" data-act="undo" title="Undo (Ctrl+Z)" aria-label="Undo"${S.past.length ? '' : ' disabled'}>${ICON.undo}</button>` +
      `<button class="icon-btn" data-act="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo"${S.future.length ? '' : ' disabled'}>${ICON.redo}</button>` +
      `<button class="btn btn-primary" data-act="save" title="Download this harness as a .loom.json file (Ctrl+S)">${ICON.save}<span class="btn-label">Save file</span></button>`;
  }

  function homeHtml() {
    return `<div class="page"><div class="drop" id="drop">
      <div class="empty-art">${ICON.upload}</div>
      <h2>Draw a harness a tech can build from</h2>
      <p>Add the ends, click pin to pin to wire them, and group wires into cables. Loom draws the wiring diagram, the connector faces, the wire list and the BOM.</p>
      <div class="actions"><button class="btn btn-primary" data-act="new">New harness</button><button class="btn" data-act="open">Open a file…</button>
      ${DEMO ? '<button class="btn" data-act="demo">Demo harness</button>' : '<a class="btn" href="?demo">Try the demo</a>'}</div>
      <div class="drop-tiles">
        <div><b>Ends</b>Connector tables with pin labels, face views with pin 1</div>
        <div><b>Wires</b>Colors, gauges, splices, lengths</div>
        <div><b>Cables</b>Cables, twisted pairs and shields</div>
        <div><b>Drawing</b>Wiring diagram, wire list, BOM, notes, title block</div>
      </div>
      <div class="foot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Harnesses stay in this browser until you save a file. Nothing is uploaded.</div>
    </div></div>`;
  }

  // ── Build: the connection diagram ──
  // Laid out automatically, unless parts were dragged (h.place). Click a pin row, then a pin row on another
  // end (or a splice), to run a wire. Click a box header to select its cable or wires.
  const svgEl = () => $('#canvas');
  let lastBox = null, lastLayout = null;
  function renderCanvas() {
    const h = H(), svg = svgEl();
    const r = C.render(h, M.analyze(h), { sel: S.sel, pending: S.pending });
    lastBox = r.box; lastLayout = r.layout;
    const wrap = $('#canvas-wrap');
    const w = wrap.clientWidth || 800, hh = wrap.clientHeight || 600;
    if (!S.cam) fit(r.box, w, hh);
    svg.setAttribute('viewBox', `${S.cam.x} ${S.cam.y} ${w / S.cam.k} ${hh / S.cam.k}`);
    // The grid parts snap to: a dot at every step and a stronger one every fifth.
    const gs = gridOf(h);
    const grid = gs ? `<defs><pattern id="cv-grid" width="${gs * 5}" height="${gs * 5}" patternUnits="userSpaceOnUse">` +
      [...Array(25)].map((_, i) => `<circle class="${i % 5 || Math.floor(i / 5) % 5 ? 'gd' : 'gd major'}" cx="${(i % 5) * gs}" cy="${Math.floor(i / 5) * gs}" r="${i ? 0.9 : 1.4}"/>`).join('') +
      `</pattern></defs>` : '';
    svg.innerHTML = grid + `<rect class="bg" data-bg="1" x="-20000" y="-20000" width="40000" height="40000" fill="${gs ? 'url(#cv-grid)' : 'transparent'}"/>` +
      `<g id="world">${r.svg}</g><g id="ghost"></g>`;
    $('#coords').textContent = Math.round(S.cam.k * 100) + '%';
    const tip = $('#tip');
    if (S.pending) {
      tip.style.display = 'block';
      tip.innerHTML = `Wiring from <b>${esc(M.endText(h, S.pending))}</b>. Click a pin on another end, or a splice. <span class="tip-k">Esc</span> cancels.`;
    } else tip.style.display = 'none';
  }
  function fit(box, w, hh) {
    const wrap = $('#canvas-wrap');
    w = w || wrap.clientWidth || 800; hh = hh || wrap.clientHeight || 600;
    box = box || lastBox || { x0: 0, y0: 0, x1: 800, y1: 500 };
    const pad = 32, top = 56; // room for the HUD above
    const k = Math.max(0.25, Math.min(1.25, (w - pad * 2) / (box.x1 - box.x0 || 1), (hh - pad - top) / (box.y1 - box.y0 || 1)));
    S.cam = { k, x: (box.x0 + box.x1) / 2 - w / k / 2, y: (box.y0 + box.y1) / 2 - (hh + top - pad) / k / 2 };
  }
  function toWorld(e) {
    const rc = svgEl().getBoundingClientRect();
    return { x: S.cam.x + (e.clientX - rc.left) / S.cam.k, y: S.cam.y + (e.clientY - rc.top) / S.cam.k };
  }
  // Grid step in diagram units; 0 turns the grid and snapping off. Kept with the harness.
  const GRIDS = [0, 5, 10, 20, 40];
  const gridOf = h => (h && GRIDS.includes(h.grid) ? h.grid : 10);
  // The two side panels fold away; remembered in this browser.
  const FOLD_KEY = NS + 'fold';
  const fold = (() => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (e) { return {}; } })();
  const FOLD_ICON = side => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="${side === 'left' ? 'M8 3.5v13' : 'M12 3.5v13'}"/></svg>`;
  function applyFold() {
    const bv = $('#build-view');
    bv.classList.toggle('fold-rail', !!fold.rail);
    bv.classList.toggle('fold-parts', !!fold.parts);
  }
  function toggleFold(which) {
    fold[which] = !fold[which];
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(fold)); } catch (e) { /* storage blocked */ }
    applyFold();
    renderHud();
    renderCanvas();
  }
  function renderHud() {
    const h = H(), gs = gridOf(h), placed = h && h.place && Object.keys(h.place).length;
    $('#hud-right').innerHTML = `<div class="seg"><button class="hud-fold" data-act="fold-parts" title="${fold.parts ? 'Show' : 'Hide'} the parts pane">${FOLD_ICON('right')}</button></div>`;
    $('#hud').innerHTML = `<div class="seg"><button class="hud-fold" data-act="fold-rail" title="${fold.rail ? 'Show' : 'Hide'} the harness panel">${FOLD_ICON('left')}</button></div>` +
      `<div class="seg"><button data-act="fit" title="Fit the diagram (F)">Fit</button></div>` +
      `<label class="seg hud-grid" title="Parts snap to the grid as you drag them. Hold Ctrl to place one anywhere.">Grid <select data-hud="grid">${GRIDS.map(g => `<option value="${g}"${g === gs ? ' selected' : ''}>${g ? g : 'Off'}</option>`).join('')}</select></label>` +
      (placed ? `<div class="seg"><button data-act="auto-layout" title="Forget the positions you dragged and lay the diagram out again">Auto layout</button></div>` : '');
  }

  // Pointer: drag a connector, splice or box to move it (snapping to the grid; Ctrl places it
  // anywhere); drag with the right or middle button to pan; wheel to zoom; click to pick or wire.
  // A left drag on empty canvas does nothing.
  let gesture = null;
  function onDown(e) {
    if (e.button > 2) return;
    const itemEl = e.button === 0 && e.target.closest('[data-item]');
    gesture = { x: e.clientX, y: e.clientY, moved: false, t: e.target, button: e.button, shift: e.shiftKey || e.ctrlKey || e.metaKey, cam0: Object.assign({}, S.cam), item: itemEl ? itemEl.dataset.item : null };
    svgEl().setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    const g = gesture;
    if (!g) { if (S.pending) drawGhost(e); return; }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    if (!g.moved && g.item) {
      const it = lastLayout && lastLayout.items.find(i => i.key === g.item);
      if (!it) g.item = null;
      else { snapshot(); g.start = { x: it.x, y: it.y }; svgEl().classList.add('dragging'); }
    }
    g.moved = true;
    if (g.item) {
      const h = H(), gs = gridOf(h), free = e.ctrlKey || e.metaKey || !gs;
      const snap = v => (free ? Math.round(v) : Math.round(v / gs) * gs);
      h.place = h.place || {};
      h.place[g.item] = { x: snap(g.start.x + dx / S.cam.k), y: snap(g.start.y + dy / S.cam.k) };
      renderCanvas();
      return;
    }
    if (g.button === 0) return; // a left drag on empty canvas does nothing; the right or middle button pans
    svgEl().classList.add('dragging');
    S.cam.x = g.cam0.x - dx / S.cam.k; S.cam.y = g.cam0.y - dy / S.cam.k;
    svgEl().setAttribute('viewBox', `${S.cam.x} ${S.cam.y} ${svgEl().clientWidth / S.cam.k} ${svgEl().clientHeight / S.cam.k}`);
  }
  function onUp() {
    const g = gesture;
    gesture = null;
    svgEl().classList.remove('dragging');
    if (g && g.item && g.moved) { H().updated = Date.now(); persist(); renderAll(); return; }
    if (g && !g.moved && g.button === 0) click(g.t, g.shift);
  }
  function click(t, shift) {
    const h = H();
    const pin = t.closest('[data-pin]');
    const nodeEl = t.closest('[data-node]');
    if (pin) {
      const end = { node: pin.dataset.node, pin: pin.dataset.pin };
      if (!S.pending) { S.pending = end; S.sel = { kind: 'node', ids: new Set([end.node]) }; renderAll(); return; }
      if (S.pending.node === end.node && S.pending.pin === end.pin) { S.pending = null; renderAll(); return; }
      finishWire(end);
      return;
    }
    if (S.pending && nodeEl) {
      const n = M.node(h, nodeEl.dataset.node);
      if (n && n.kind === 'splice') { finishWire({ node: n.id, pin: null }); return; }
    }
    if (S.pending) { S.pending = null; renderAll(); return; }
    const wire = t.closest('[data-wire]'), boxEl = t.closest('[data-box]');
    if (wire) {
      const id = wire.dataset.wire;
      if (shift && S.sel && S.sel.kind === 'wire') { const ids = new Set(S.sel.ids); ids.has(id) ? ids.delete(id) : ids.add(id); S.sel = ids.size ? { kind: 'wire', ids } : null; renderAll(); }
      else select('wire', id);
    } else if (boxEl) pickBox(boxEl.dataset.box);
    else if (nodeEl) select('node', nodeEl.dataset.node);
    else select(null);
  }
  // A cable's box selects the cable; a bundle's box selects its wires.
  function pickBox(key) {
    const b = C.boxesOf(H(), M.analyze(H())).find(x => x.key === key);
    if (!b) return;
    if (b.group) select('group', b.group.id);
    else select('wire', b.wires.map(w => w.id));
  }
  function finishWire(end) {
    const from = S.pending;
    S.pending = null;
    const w = change(h => M.addWire(h, from, end));
    if (w) { S.sel = { kind: 'wire', ids: new Set([w.id]) }; renderAll(); toast(`${M.wireName(w)} added: ${M.endText(H(), w.from)} → ${M.endText(H(), w.to)}`); }
  }
  function drawGhost(e) {
    if (!lastLayout) return;
    const p = toWorld(e), a = lastLayout.anchor(S.pending, p.x);
    if (a.y == null) return;
    $('#ghost').innerHTML = `<path class="ghost" d="M${a.x} ${a.y}L${p.x} ${p.y}"/>`;
  }
  function onWheel(e) {
    e.preventDefault();
    const p = toWorld(e), rc = svgEl().getBoundingClientRect();
    const k = Math.max(0.2, Math.min(4, S.cam.k * Math.exp(-e.deltaY * 0.0015)));
    S.cam = { k, x: p.x - (e.clientX - rc.left) / k, y: p.y - (e.clientY - rc.top) / k };
    renderCanvas();
  }
  function addEnd(kind) {
    change(h => {
      const n = kind === 'connector' ? M.addConnector(h, 0, 0, { family: 'jst-ph', pins: 4 }) : M.addNode(h, kind, 0, 0);
      S.sel = { kind: 'node', ids: new Set([n.id]) };
    });
    S.cam = null;
    renderCanvas();
    if (kind === 'connector') toast('Added. Click one of its pins, then a pin on another end, to run a wire.');
  }

  // ── Build: parts pane ──
  function renderParts() {
    const h = H(), A = M.analyze(h);
    const sel = id => S.sel && S.sel.kind === 'node' && S.sel.ids.has(id);
    const conns = h.nodes.filter(M.isConn).sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));
    const splices = h.nodes.filter(n => n.kind === 'splice');
    let o = `<div class="side-head"><span class="side-label">Ends</span><span class="side-count">${conns.length}</span></div>`;
    o += conns.map(n => `<div class="lay${sel(n.id) ? ' on' : ''}" data-pick="node:${n.id}"><span class="lay-ico">${ICON.conn}</span><span class="nm"><b>${esc(n.ref)}</b> ${esc(n.name || L.family(n.family).name)}</span><span class="lay-n">${n.pins}</span></div>`).join('');
    if (splices.length) {
      o += `<div class="side-head"><span class="side-label">Splices</span></div>`;
      o += splices.map(n => `<div class="lay${sel(n.id) ? ' on' : ''}" data-pick="node:${n.id}"><span class="lay-ico">${ICON.splice}</span><span class="nm"><b>${esc(n.ref)}</b></span></div>`).join('');
    }
    const boxes = C.boxesOf(h, A);
    if (boxes.length) {
      o += `<div class="side-head"><span class="side-label">Cables and bundles</span></div>`;
      o += boxes.map(b => {
        const on = S.sel && ((b.group && S.sel.kind === 'group' && S.sel.ids.has(b.group.id)) || (!b.group && S.sel.kind === 'wire' && b.wires.every(w => S.sel.ids.has(w.id))));
        return `<div class="lay${on ? ' on' : ''}" data-box="${esc(b.key)}"><span class="g-chip g-${b.group ? 'cable' : 'bundle'}">${esc(b.label)}</span><span class="nm">${b.wires.length} wire${b.wires.length > 1 ? 's' : ''} · ${esc(M.endText(h, { node: b.wires[0].from.node }))}–${esc(M.endText(h, { node: b.wires[0].to.node }))}</span></div>`;
      }).join('');
    }
    const tw = h.groups.filter(g => g.kind !== 'cable');
    if (tw.length) {
      o += `<div class="side-head"><span class="side-label">Twists and shields</span></div>`;
      o += tw.map(g => `<div class="lay${S.sel && S.sel.kind === 'group' && S.sel.ids.has(g.id) ? ' on' : ''}" data-pick="group:${g.id}"><span class="g-chip g-${g.kind}">${esc(g.label)}</span><span class="nm">${g.wires.map(id => M.wireName(M.wire(h, id))).join(', ')}</span></div>`).join('');
    }
    o += `<div class="side-head"><span class="side-label">Add</span></div><div class="palette">
      <button data-act="add-conn">${ICON.conn}<span>Connector</span></button>
      <button data-act="from-board" title="A board connector from Signoff EE, with its pins and nets">${ICON.board}<span>From a board</span></button>
      <button data-act="add-splice">${ICON.splice}<span>Splice</span></button></div>`;
    o += `<div class="howto"><b>How it works</b>
      <p><i>●</i> Click a pin, then a pin on another end or a splice, to run a wire.</p>
      <p><i>⇧</i> Shift-click wires, then make them a cable, twisted pair or shield.</p>
      <p><i>▭</i> Click a box header to edit its cable or bundle, including length.</p>
      <p><i>✥</i> Drag a part to move it; it snaps to the grid. Hold Ctrl to place it anywhere.</p></div>`;
    $('#parts-pane').innerHTML = o;
  }

  // ── From a board: a connector from Signoff EE's stored fab package ──
  const BM = { open: false, step: 'boards', boards: null, board: null, pkg: null, error: null, code: null, busy: '' };
  function openBoards() {
    Object.assign(BM, { open: true, step: BM.boards ? 'boards' : 'loading', error: null, code: null, busy: 'Finding boards in Signoff EE…' });
    renderModal();
    if (BM.boards) return;
    LM.boards.listBoards().then(list => { BM.boards = list; BM.step = 'boards'; }, e => { BM.error = e.message; BM.code = e.code || null; BM.step = 'error'; })
      .then(renderModal);
  }
  function openBoard(id) {
    const b = BM.boards.find(x => x.id === id);
    if (!b) return;
    Object.assign(BM, { board: b, pkg: null, step: 'loading', busy: `Reading the fab package for ${b.name}…`, error: null, code: null });
    renderModal();
    LM.boards.loadBoard(b).then(p => { BM.pkg = p; BM.step = 'pick'; }, e => { BM.error = e.message; BM.code = e.code || null; BM.step = 'error'; })
      .then(renderModal);
  }
  function closeModal() { BM.open = false; renderModal(); }
  function renderModal() {
    const back = $('#board-modal');
    back.hidden = !BM.open;
    if (!BM.open) return;
    const h = H();
    const head = (title, sub, canBack) => `<div class="lm-modal-head">${canBack ? `<button class="icon-btn" data-act="bm-back" title="All boards" aria-label="All boards"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg></button>` : ''}<div><div class="eyebrow">From a board</div><div class="rail-title">${title}</div>${sub ? `<div class="f-hint">${sub}</div>` : ''}</div><button class="icon-btn" data-act="bm-close" title="Close (Esc)" aria-label="Close"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>`;
    let o;
    if (BM.step === 'loading') o = head('Signoff EE boards') + `<div class="lm-modal-body"><div class="bm-busy"><span class="spinner"></span>${esc(BM.busy)}</div></div>`;
    else if (BM.step === 'error') {
      const signin = BM.code === 'signin';
      o = head(signin ? 'Sign in to Signoff first' : "Couldn't read it", '', !!BM.boards) + `<div class="lm-modal-body"><p>${signin ? 'Loom reads board packages with the GitHub access Signoff EE keeps in this browser. Open Signoff EE, connect GitHub in Settings, then come back.' : esc(BM.error)}</p>
        <div class="inline gap">${signin ? '<a class="btn btn-primary" href="../ee_design_review/index.html">Open Signoff EE</a>' : ''}<button class="btn" data-act="bm-retry">Try again</button></div></div>`;
    } else if (BM.step === 'boards') {
      const groups = new Map();
      BM.boards.forEach(b => { const k = b.client || 'No client project'; groups.set(k, (groups.get(k) || []).concat(b)); });
      o = head('Pick a board', LM.boards.DEMO ? 'Demo: Fabcheck’s made-up Smart Thermostat packages.' : 'Its latest tagged revision is read, or the latest stored Fabcheck run when none is tagged.') +
        `<div class="lm-modal-body">${BM.boards.length ? [...groups].map(([k, list]) => `<div class="cat-label">${esc(k)}</div>` + list.map(b => `<button class="bm-row" data-act="bm-board" data-id="${esc(b.id)}"><span class="lay-ico">${ICON.board}</span><span class="nm"><b>${esc(b.name)}</b>${b.repo ? `<small>${esc(b.repo.split('/')[1])}</small>` : ''}</span><span class="chev">›</span></button>`).join('')).join('') : '<p class="f-hint">No Signoff EE boards are readable with this browser’s GitHub access.</p>'}</div>`;
    } else {
      const b = BM.board, p = BM.pkg;
      const added = new Map(h.nodes.filter(n => n.board && n.board.project === b.id).map(n => [n.board.ref, n.ref]));
      o = head(esc(b.name), `${esc(p.source.label)} · ${p.connectors.length} connector${p.connectors.length === 1 ? '' : 's'} in the netlist${p.bom ? '' : ' · no BOM found'}`, true) +
        `<div class="lm-modal-body">${p.connectors.map(c => {
          const named = c.pins.filter(x => x.label);
          const have = added.get(c.ref);
          return `<div class="bm-conn"><div class="bm-c-head"><span class="mono-ref">${esc(c.ref)}</span><span class="bm-desc">${esc(c.desc || 'No BOM line')}${c.mpn ? ` · <span class="mono">${esc(c.mpn)}</span>` : ''}${c.dnp ? ' · not fitted' : ''}</span>
            ${have ? `<span class="chip">Added as ${esc(have)}</span>` : `<button class="btn btn-primary" data-act="bm-add" data-ref="${esc(c.ref)}">Add</button>`}</div>
            <div class="bm-pins">${c.pins.map(x => `<span class="bm-pin${x.label ? '' : ' unnamed'}" title="${esc(x.net || 'no net')}"><b>${esc(x.pin)}</b>${esc(x.label || '—')}</span>`).join('')}</div>
            <div class="f-hint">${c.pins.length} pin${c.pins.length === 1 ? '' : 's'}, ${named.length} with named nets${c.dropped.length ? ` · mounting or shield pads left out: ${esc(c.dropped.join(', '))}` : ''}</div></div>`;
        }).join('') || '<p class="f-hint">No connectors found in this netlist.</p>'}</div>`;
    }
    $('#board-modal-body').innerHTML = o;
  }
  function addBoardConnector(ref) {
    const b = BM.board, p = BM.pkg, c = p && p.connectors.find(x => x.ref === ref);
    if (!c) return;
    const n = change(h => {
      const fam = L.guessFamily(c.mpn, c.desc);
      const n = M.addConnector(h, 0, 0, { family: fam, pins: c.pins.length, rows: 1 });
      n.pins = c.pins.length; n.rows = 1;
      n.pinNames = c.pins.map(x => x.pin);
      n.pinLabels = {};
      c.pins.forEach(x => { if (x.label) n.pinLabels[x.pin] = x.label; });
      n.name = `${b.name} ${c.ref}`;
      n.mate = [c.mfr, c.mpn].filter(Boolean).join(' ');
      n.board = { project: b.id, name: b.name, client: b.client || '', ref: c.ref, mpn: c.mpn || '', source: p.source.label };
      S.sel = { kind: 'node', ids: new Set([n.id]) };
      return n;
    });
    S.cam = null;
    renderAll();
    renderModal();
    if (n) toast(`Added ${n.ref}: ${b.name} ${c.ref}, ${c.pins.length} pins.`);
  }
  // Suggested wires: pins on two ends with the same named net.
  function usedPins(h) { return new Set(h.wires.flatMap(w => [w.from, w.to]).map(e => e.node + '|' + e.pin)); }
  function matchRows(h, n) {
    const used = usedPins(h);
    return h.nodes.filter(x => M.isConn(x) && x.id !== n.id).map(x => ({ other: x, pairs: LM.boards.matches(n, x, used) })).filter(r => r.pairs.length);
  }
  function wireMatches(aId, bId) {
    let made = 0;
    change(h => {
      const a = M.node(h, aId), b = M.node(h, bId);
      LM.boards.matches(a, b, usedPins(h)).forEach(m => { M.addWire(h, { node: a.id, pin: m.a }, { node: b.id, pin: m.b }, { signal: m.label }); made++; });
    });
    toast(made ? `Added ${made} wire${made > 1 ? 's' : ''} by matching nets. Check them against the boards before building.` : 'No free pins with matching nets.');
  }

  // ── Build: rail (inspector) ──
  const fld = (label, inner, hint) => `<div class="field"><label>${label}</label>${inner}${hint ? `<div class="f-hint">${hint}</div>` : ''}</div>`;
  const inp = (f, v, attrs) => `<input class="input" data-f="${f}" value="${esc(v == null ? '' : v)}"${attrs || ''}>`;
  const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
  const segBtns = (f, cur, choices) => `<div class="seg full">${choices.map(([v, l]) => `<button data-setf="${f}" data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  function colorSelects(f, code) {
    const [b, s] = String(code || '').split('/');
    const base = `<select class="input" data-f="${f}.base">${opt('', '—', b)}${Object.entries(M.COLORS).map(([k, v]) => opt(k, v[0], b)).join('')}</select>`;
    const stripe = `<select class="input" data-f="${f}.stripe">${opt('', 'No stripe', s || '')}${Object.entries(M.COLORS).map(([k, v]) => opt(k, v[0] + ' stripe', s)).join('')}</select>`;
    const c = M.colorInfo(code);
    return `<div class="color-row"><span class="swatch" style="background:${c.base || 'transparent'}">${c.stripe ? `<i style="background:${c.stripe}"></i>` : ''}</span>${base}${stripe}</div>`;
  }
  // Length for a set of wires: editable when they all run along one segment, else the routed total.
  function lenField(h, A, ws) {
    const rs = ws.map(w => A.routes.get(w.id));
    if (rs.every(r => r && r.segs.length === 1 && r.segs[0] === rs[0].segs[0])) {
      const s = rs[0].segs[0];
      return fld('Length (mm)', inp('len.' + s.id, s.length, ' type="number" min="0" step="5" placeholder="Not set"'), s.length != null ? U.fmtLen(s.length) + ', connector face to face.' : 'Connector face to face.');
    }
    const lens = ws.map(w => A.wireLen.get(w.id));
    return fld('Length', `<div class="f-hint">${lens.every(x => x != null) ? [...new Set(lens)].map(U.fmtLen).join(', ') : 'Not set on every part of the route.'} Set it on each box the wire runs through.</div>`);
  }
  const gaugeSelect = (f, g) => `<select class="input" data-f="${f}">${opt('', '—', g)}${M.GAUGES.map(x => opt(x, M.gaugeText(x), g)).join('')}</select>`;
  function endOptions(h, cur) {
    let o = '';
    h.nodes.filter(M.isConn).forEach(n => { o += `<optgroup label="${esc(n.ref + ' ' + (n.name || ''))}">${M.pinList(n).map(p => opt(n.id + '|' + p, n.ref + '.' + p, cur)).join('')}</optgroup>`; });
    const sp = h.nodes.filter(n => n.kind === 'splice');
    if (sp.length) o += `<optgroup label="Splices">${sp.map(n => opt(n.id + '|', n.ref, cur)).join('')}</optgroup>`;
    return o;
  }

  function renderRail() {
    const h = H(), A = M.analyze(h);
    const sel = S.sel;
    let o;
    if (!sel) o = railHarness(h, A);
    else if (sel.kind === 'node') { const n = M.node(h, [...sel.ids][0]); o = M.isConn(n) ? railConnector(h, A, n) : railJunction(h, A, n); }
    else if (sel.kind === 'wire') o = sel.ids.size > 1 ? railWires(h, A, [...sel.ids].map(id => M.wire(h, id))) : railWire(h, A, M.wire(h, [...sel.ids][0]));
    else if (sel.kind === 'group') o = railGroup(h, A, M.group(h, [...sel.ids][0]));
    const rail = $('#rail');
    const focus = document.activeElement && rail.contains(document.activeElement) ? document.activeElement.dataset.f : null;
    const scroll = rail.querySelector('.rail-list') ? rail.querySelector('.rail-list').scrollTop : 0;
    rail.innerHTML = o;
    if (rail.querySelector('.rail-list')) rail.querySelector('.rail-list').scrollTop = scroll;
    if (focus) { const el = rail.querySelector(`[data-f="${focus}"]`); if (el) el.focus(); }
  }
  const railHead = (eyebrow, title, extra) => `<div class="rail-head"><div class="eyebrow">${eyebrow}</div><div class="rail-title">${title}</div>${extra || ''}</div>`;

  function checkRows(h, list) {
    if (!list.length) return '<div class="rf-ok"><span class="dot ok"></span>No problems found.</div>';
    return list.map((c, i) => `<div class="rf" data-check="${i}"><span class="dot ${c.sev}"></span><div class="rf-t">${esc(c.text)}</div></div>`).join('');
  }
  function railHarness(h, A) {
    const c = M.checks(h, A);
    const total = h.wires.reduce((t, w) => t + (A.wireLen.get(w.id) || 0), 0);
    return railHead('Harness', esc(h.title), `<div class="chips"><span class="chip">${h.nodes.filter(M.isConn).length} ends</span><span class="chip">${h.wires.length} wires</span><span class="chip">${U.fmtMeters(total)} of wire</span></div>`) +
      `<div class="rail-list"><div class="rail-sec">
      ${fld('Title', inp('h.title', h.title))}
      <div class="row2">${fld('Part number', inp('h.pn', h.pn, ' placeholder="2100430-001"'))}${fld('Rev', inp('h.rev', h.rev))}</div>
      <div class="row2">${fld('Drawn by', inp('h.drawnBy', h.drawnBy))}${fld('Date', inp('h.date', h.date, ' type="date"'))}</div>
      <div class="row2">${fld('New wires', gaugeSelect('h.defaults.gauge', h.defaults.gauge))}${fld('&nbsp;', `<select class="input" data-f="h.defaults.color">${Object.entries(M.COLORS).map(([k, v]) => opt(k, v[0], h.defaults.color)).join('')}</select>`)}</div>
      ${fld('Wire allowance', inp('h.allowancePct', h.allowancePct, ' type="number" min="0" max="50" step="1"'), 'Percent added to every BOM length.')}
      ${fld('Notes', `<textarea class="input" rows="6" data-f="h.notes">${esc((h.notes || []).join('\n'))}</textarea>`, 'One note per line; the drawing numbers them.')}
      </div><div class="cat-label">Checks</div>${checkRows(h, c)}
      <div class="rail-actions"><button class="btn" data-act="duplicate">Duplicate</button><button class="btn btn-danger" data-act="delete-harness">${ICON.trash}Delete harness</button></div></div>`;
  }
  function railConnector(h, A, n) {
    const fam = L.family(n.family);
    const groups = [...new Set(L.FAMILIES.map(f => f.group))];
    const famSel = `<select class="input" data-f="n.family">${groups.map(g => `<optgroup label="${g}">${L.FAMILIES.filter(f => f.group === g).map(f => opt(f.id, f.name, n.family)).join('')}</optgroup>`).join('')}</select>`;
    const pins = L.pinChoices(fam);
    const fromBoard = Array.isArray(n.pinNames) && n.pinNames.length;
    const pinSel = fromBoard ? `<div class="input ro">${n.pinNames.length} from the board</div>`
      : `<select class="input" data-f="n.pins"${pins.length < 2 ? ' disabled' : ''}>${pins.map(p => opt(p, p + (fam.style === 'flying' ? ' leads' : ' pins'), n.pins)).join('')}</select>`;
    const others = h.nodes.filter(x => M.isConn(x) && x.id !== n.id);
    const wired = h.wires.filter(w => w.from.node === n.id || w.to.node === n.id).length;
    const housing = L.hasHousing(fam);
    const sugg = matchRows(h, n);
    const boardBox = n.board ? `<div class="board-src"><span class="lay-ico">${ICON.board}</span><div><b>${esc(n.board.name)} ${esc(n.board.ref)}</b><div class="f-hint">${esc(n.board.source)}${n.board.mpn ? ' · board part ' + esc(n.board.mpn) : ''}. Pins and labels come from its netlist.</div></div></div>` : '';
    const suggBox = sugg.length ? `<div class="cat-label">Suggested wires</div><div class="rail-sec">${sugg.map(r => `<div class="sugg"><div><b>${r.pairs.length} pin${r.pairs.length > 1 ? 's' : ''} match ${esc(r.other.ref)}</b><div class="f-hint">${esc([...new Set(r.pairs.map(p => p.label))].slice(0, 6).join(', '))}${new Set(r.pairs.map(p => p.label)).size > 6 ? '…' : ''}</div></div><button class="btn" data-act="match-wire" data-a="${n.id}" data-b="${r.other.id}">Wire them</button></div>`).join('')}<p class="f-hint">Same net name on both ends, on pins with no wire yet. Check each against the boards.</p></div>` : '';
    return railHead('Connector', `<span class="mono-ref">${esc(n.ref)}</span> ${esc(n.name || fam.name)}`) +
      `<div class="rail-list">${boardBox}${suggBox}<div class="face-tile">${LM.shapes.faceSvg(h, n, 330, 150)}<span class="face-note">${esc(LM.shapes.face(h, n).note)}</span></div>
      <div class="rail-sec">
      <div class="row2 r-ref">${fld('Ref', inp('n.ref', n.ref))}${fld('Name', inp('n.name', n.name, ' placeholder="Main PCBA J6"'))}</div>
      ${fld('Family', famSel, fam.awg ? `Terminals typically take ${fam.awg[0]}–${fam.awg[1]} AWG.` : '')}
      <div class="row2">${fld(fam.style === 'flying' ? 'Leads' : 'Pins', pinSel)}${fam.rows && fam.rows.length > 1 ? fld('Rows', segBtns('n.rows', n.rows, [[1, '1'], [2, '2']])) : ''}</div>
      ${housing ? fld('Gender', segBtns('n.gender', n.gender, [['receptacle', 'Receptacle'], ['plug', 'Plug']])) : ''}
      ${fld(housing ? 'Housing part number' : 'Part number', inp('n.mpn', n.mpn, ` placeholder="${esc(L.suggestHousing(n) || 'Manufacturer part number')}"`), housing && L.suggestHousing(n) && !n.mpn ? 'Suggested from the series; check the datasheet.' : '')}
      ${housing ? fld('Terminal part number', inp('n.terminal', n.terminal)) : ''}
      ${fld('Mates with', inp('n.mate', n.mate, ' placeholder="Board header or mating part"'))}
      ${others.length ? fld('Wire straight through', `<div class="inline"><select class="input" id="straight-to">${others.map(x => opt(x.id, x.ref + ' ' + (x.name || ''), '')).join('')}</select><button class="btn" data-act="straight" data-node="${n.id}">Wire 1:1</button></div>`, 'Runs pin n to pin n for every pin both have free.') : ''}
      </div><div class="cat-label">Pin labels</div><div class="rail-sec pin-labels">
      ${M.pinList(n).map(p => `<label class="pl-row"><span class="pl-num">${esc(p)}</span>${inp('n.pin.' + p, (n.pinLabels || {})[p] || '', ` placeholder="${esc(C.pinLabel(h, Object.assign({}, n, { pinLabels: {} }), p) || 'Label')}"`)}</label>`).join('')}
      <p class="f-hint">Usually the board's net name. Empty labels show the wire's signal.</p>
      </div><div class="rail-actions"><span class="pc-muted">${wired} wire${wired === 1 ? '' : 's'}</span><button class="btn btn-danger" data-act="delete">${ICON.trash}Delete ${esc(n.ref)}</button></div></div>`;
  }
  function wireRows(h, A, ws) {
    return ws.map(w => { const c = M.colorInfo(w.color); return `<div class="rf wire-rf" data-pick="wire:${w.id}"><span class="swatch sm" style="background:${c.base || 'transparent'}">${c.stripe ? `<i style="background:${c.stripe}"></i>` : ''}</span><div class="rf-t"><span class="mono-ref">${M.wireName(w)}</span> ${esc(M.endText(h, w.from))} → ${esc(M.endText(h, w.to))}</div><div class="rf-d">${esc(w.signal || 'No signal name')} · ${esc(w.gauge ? w.gauge + ' AWG' : 'no gauge')}</div></div>`; }).join('');
  }
  function railJunction(h, A, n) {
    const segs = A.adj.get(n.id) || [];
    const ws = h.wires.filter(w => w.from.node === n.id || w.to.node === n.id);
    const isSplice = n.kind === 'splice';
    return railHead(isSplice ? 'Splice' : 'Breakout', isSplice ? `<span class="mono-ref">${esc(n.ref)}</span>` : `${segs.length} branches`) +
      `<div class="rail-list"><div class="rail-sec">
      ${isSplice ? fld('Ref', inp('n.ref', n.ref)) + `<p class="f-hint">Wires end here and are joined. Start a wire at a pin, then click the splice to end it here.</p>` : `<p class="f-hint">A point where the bundle splits or merges.</p>`}
      ${segs.map(s => { const o2 = A.byId.get(M.other(s, n.id)); return `<div class="rf"><span class="dot info"></span><div class="rf-t">To ${esc(M.label(o2))}</div><div class="rf-d">${U.fmtLen(s.length)} · ${(A.segWires.get(s.id) || []).length} wires</div></div>`; }).join('')}
      </div>${ws.length ? `<div class="cat-label">Wires joined</div>${wireRows(h, A, ws)}` : ''}
      <div class="rail-actions"><span></span><button class="btn btn-danger" data-act="delete">${ICON.trash}Delete ${isSplice ? esc(n.ref) : 'breakout'}</button></div></div>`;
  }
  function railWire(h, A, w) {
    const gs = A.groupsOf.get(w.id);
    return railHead('Wire', `<span class="mono-ref">${M.wireName(w)}</span> ${esc(w.signal || '')}`, `<div class="chips"><span class="chip">${U.fmtLen(A.wireLen.get(w.id))}</span>${gs.map(g => `<button class="chip g-chip g-${g.kind}" data-pick="group:${g.id}">${esc(g.label)}</button>`).join('')}</div>`) +
      `<div class="rail-list"><div class="rail-sec">
      <div class="row2">${fld('From', `<select class="input" data-f="w.from">${endOptions(h, w.from.node + '|' + (w.from.pin || ''))}</select>`)}${fld('To', `<select class="input" data-f="w.to">${endOptions(h, w.to.node + '|' + (w.to.pin || ''))}</select>`)}</div>
      ${fld('Signal', inp('w.signal', w.signal, ' placeholder="e.g. I2C_SDA"'))}
      ${fld('Color', colorSelects('w.color', w.color))}
      ${fld('Gauge', gaugeSelect('w.gauge', w.gauge))}
      ${lenField(h, A, [w])}
      <div class="cat-label">Group with others</div>
      <p class="f-hint">Shift-click other wires, then make them a cable, twisted pair or shield.</p>
      </div><div class="rail-actions"><span></span><button class="btn btn-danger" data-act="delete">${ICON.trash}Delete ${M.wireName(w)}</button></div></div>`;
  }
  function railWires(h, A, ws) {
    return railHead('Wires', `${ws.length} wires selected`, `<div class="chips">${ws.map(w => `<span class="chip">${M.wireName(w)}</span>`).join('')}</div>`) +
      `<div class="rail-list"><div class="rail-sec">
      <div class="group-btns">
        <button class="btn" data-act="group" data-kind="twist"><span class="g-chip g-twist">TP</span>Twist</button>
        <button class="btn" data-act="group" data-kind="shield"><span class="g-chip g-shield">SH</span>Shield</button>
        <button class="btn" data-act="group" data-kind="cable"><span class="g-chip g-cable">C</span>Cable</button>
      </div>
      <p class="f-hint">A cable gets its own box on the diagram. Twisted pairs and shields are tagged on their rows.</p>
      ${lenField(h, A, ws)}
      ${fld('Set color', colorSelects('ws.color', ''))}
      ${fld('Set gauge', gaugeSelect('ws.gauge', ''))}
      </div><div class="cat-label">Selected</div>${wireRows(h, A, ws)}
      <div class="rail-actions"><span></span><button class="btn btn-danger" data-act="delete">${ICON.trash}Delete ${ws.length} wires</button></div></div>`;
  }
  function railGroup(h, A, g) {
    const span = A.spans.get(g.id) || [];
    const ws = g.wires.map(id => M.wire(h, id)).filter(Boolean);
    return railHead(M.GROUP_KINDS[g.kind], `<span class="g-chip g-${g.kind}">${esc(g.label)}</span>`, `<div class="chips"><span class="chip">Covers ${U.fmtLen(M.spanLength(span))}</span><span class="chip">${span.length} segment${span.length === 1 ? '' : 's'}</span></div>`) +
      `<div class="rail-list"><div class="rail-sec">
      ${fld('Label', inp('g.label', g.label))}
      ${fld('Kind', segBtns('g.kind', g.kind, Object.entries(M.GROUP_KINDS)))}
      ${g.kind !== 'twist' ? fld('Description', inp('g.note', g.note, ` placeholder="${g.kind === 'cable' ? '26 AWG, PVC jacket' : 'Tinned copper braid'}"`)) + fld('Part number', inp('g.pn', g.pn)) : ''}
      ${ws.length ? lenField(h, A, ws) : ''}
      </div><div class="cat-label">Wires</div>${wireRows(h, A, ws)}
      <div class="rail-actions"><span></span><button class="btn btn-danger" data-act="delete">${ICON.trash}Ungroup</button></div></div>`;
  }

  // Field edits from the rail (and the wire table, which uses w:<id>.<field>).
  function setField(f, v, el) {
    const sel = S.sel;
    change(h => {
      const one = () => [...sel.ids][0];
      if (f.startsWith('h.')) {
        const k = f.slice(2);
        if (k === 'notes') h.notes = v.split('\n').map(s => s.trim()).filter(Boolean);
        else if (k === 'allowancePct') h.allowancePct = Math.max(0, +v || 0);
        else if (k.startsWith('defaults.')) h.defaults[k.slice(9)] = v;
        else h[k] = v;
      } else if (f.startsWith('len.')) {
        const s = M.seg(h, f.slice(4));
        if (s) s.length = v === '' ? null : Math.max(0, Math.round(+v));
      } else if (f.startsWith('n.pin.')) {
        const n = M.node(h, one()), p = f.slice(6);
        n.pinLabels = n.pinLabels || {};
        if (v.trim()) n.pinLabels[p] = v.trim(); else delete n.pinLabels[p];
      } else if (f.startsWith('n.')) {
        const n = M.node(h, one()), k = f.slice(2);
        if (k === 'pins' || k === 'rows') n[k] = +v;
        else n[k] = v;
        if (k === 'family' || k === 'rows') L.conform(n);
        if (Array.isArray(n.pinNames) && n.pinNames.length) n.pins = n.pinNames.length; // board pins stay
      } else if (f.startsWith('s.')) {
        const s = M.seg(h, one()), k = f.slice(2);
        s[k] = k === 'length' ? (v === '' ? null : Math.max(0, Math.round(+v))) : v;
      } else if (f.startsWith('g.')) {
        const g = M.group(h, one()), k = f.slice(2);
        g[k] = v;
      } else if (f.startsWith('w.') || f.startsWith('w:') || f.startsWith('ws.')) {
        let ids, k;
        if (f.startsWith('w:')) { const m = /^w:([^.]+)\.(.+)$/.exec(f); ids = [m[1]]; k = m[2]; }
        else { ids = [...sel.ids]; k = f.slice(f.indexOf('.') + 1); }
        ids.map(id => M.wire(h, id)).forEach(w => {
          if (k === 'from' || k === 'to') { const [node, pin] = v.split('|'); w[k] = { node, pin: pin || null }; }
          else if (k === 'fromText' || k === 'toText') { const e = M.parseEnd(h, v); if (e) w[k.slice(0, -4)] = e; else toast(`"${v}" isn't an end in this harness. Use a ref and pin, like P1.3.`, 'error'); }
          else if (k === 'color.base' || k === 'color.stripe') {
            const row = el && el.closest('.color-row');
            const base = row ? row.querySelector('[data-f$="color.base"]').value : '', stripe = row ? row.querySelector('[data-f$="color.stripe"]').value : '';
            w.color = base ? base + (stripe && stripe !== base ? '/' + stripe : '') : '';
          } else w[k] = v;
        });
      }
    });
  }

  // ── Pages ──
  function pageHead(eyebrow, title, sub, actions) {
    return `<div class="page-head lm-head"><div class="page-head-text"><div class="eyebrow">${eyebrow}</div><h1 class="page-title">${title}</h1>${sub ? `<div class="page-sub">${sub}</div>` : ''}</div>${actions ? `<div class="lm-actions">${actions}</div>` : ''}</div>`;
  }
  function drawingHtml(h) {
    const sh = LM.sheet.sheet(h);
    S.lastSheet = sh;
    return `<div class="page wide">` + pageHead('Drawing', esc(h.title), `${esc(h.pn || 'No part number')}<span class="sep">·</span>Rev ${esc(h.rev || '—')}<span class="sep">·</span>${sh.w} × ${sh.h} px sheet`,
      `<button class="btn" data-act="export-svg">SVG</button><button class="btn" data-act="export-png">PNG</button><button class="btn btn-primary" data-act="print">Print or PDF</button>`) +
      `<div class="sheet-card">${sh.svg}</div>${wiresFold(h)}</div>`;
  }
  // The wire list, editable, folded under the drawing. Whether it's open is remembered per browser.
  function wiresFold(h) {
    const A = M.analyze(h), rows = M.fromTo(h, A);
    const list = h.nodes.filter(n => M.isConn(n) || n.kind === 'splice').flatMap(n => (M.isConn(n) ? M.pinList(n).map(p => n.ref + '.' + p) : [n.ref]));
    return `<details class="wires-fold" id="wires-fold"${S.wiresOpen ? ' open' : ''}><summary><span class="wf-chev"></span><span class="wf-title">Wires</span><span class="count">${rows.length}</span>` +
      `<span class="wf-hint">Edit the wire list. Type ends as a ref and pin, like P1.3, or a splice, like S1.</span></summary>
      <div class="wf-body"><div class="wf-acts"><button class="btn" data-act="csv-wires">${ICON.save}CSV</button></div>
      <datalist id="ends">${list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <div class="card table-wrap"><table class="table compact wtable"><thead><tr><th>Wire</th><th>From</th><th>To</th><th>Signal</th><th>Color</th><th>Gauge</th><th class="num">Length</th><th>Group</th><th></th></tr></thead><tbody>
      ${rows.map(r => { const w = r.wire; return `<tr data-row="${w.id}"><td class="mono">${r.name}</td>
        <td><input class="cell-in mono" list="ends" data-f="w:${w.id}.fromText" value="${esc(r.from)}"></td>
        <td><input class="cell-in mono" list="ends" data-f="w:${w.id}.toText" value="${esc(r.to)}"></td>
        <td><input class="cell-in" data-f="w:${w.id}.signal" value="${esc(r.signal)}" placeholder="Signal"></td>
        <td>${colorSelects('w:' + w.id + '.color', w.color)}</td>
        <td>${gaugeSelect('w:' + w.id + '.gauge', w.gauge)}</td>
        <td class="num">${U.fmtLen(r.length)}</td><td>${esc(r.groups)}</td>
        <td><button class="icon-btn" data-act="del-wire" data-id="${w.id}" title="Delete ${r.name}">${ICON.trash}</button></td></tr>`; }).join('')}
      <tr class="add-wire"><td class="pc-muted">New</td><td><input class="cell-in mono" list="ends" id="nw-from" placeholder="P1.1"></td><td><input class="cell-in mono" list="ends" id="nw-to" placeholder="P2.1"></td>
        <td><input class="cell-in" id="nw-signal" placeholder="Signal"></td><td colspan="5"><button class="btn" data-act="add-wire">Add wire</button></td></tr>
      </tbody></table></div>
      <div class="card paste-card"><div class="pc-card-title">Paste from a spreadsheet</div>
      <p class="f-hint">One wire per line: from, to, signal, color, gauge (tab or comma separated). For example <code>P1.3, P2.3, I2C_SDA, BU, 28</code>.</p>
      <textarea class="input" id="paste" rows="4" placeholder="P1.3&#9;P2.3&#9;I2C_SDA&#9;BU&#9;28"></textarea>
      <div style="margin-top:10px"><button class="btn" data-act="paste">Add these wires</button></div></div></div></details>`;
  }
  function bomHtml(h) {
    const rows = M.bom(h);
    return `<div class="page wide">` + pageHead('Bill of materials', esc(h.title), `Wire, cable and covering lengths include a ${h.allowancePct || 0}% allowance`, `<button class="btn" data-act="csv-bom">${ICON.save}CSV</button>`) +
      `<div class="card table-wrap"><table class="table compact"><thead><tr><th class="num">Item</th><th class="num">Qty</th><th>Description</th><th>Part number</th><th>Refs</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="num">${r.item}</td><td class="num">${esc(M.qtyText(r))}</td><td>${esc(r.desc)}</td><td class="mono">${esc(r.pn || '—')}</td><td>${esc(r.refs.join(', '))}</td></tr>`).join('') || '<tr><td colspan="5" class="pc-muted">Nothing to buy yet.</td></tr>'}
      </tbody></table></div><p class="f-hint" style="margin-top:12px">Where a connector has no housing part number, the BOM suggests one from the series; check it against the datasheet. Terminals depend on wire gauge and plating, so enter them on each connector.</p></div>`;
  }
  function checksHtml(h) {
    const c = M.checks(h);
    const by = sev => c.filter(x => x.sev === sev);
    const block = (sev, label) => { const l = by(sev); return l.length ? `<div class="cat-label">${label} · ${l.length}</div>` + l.map(x => `<div class="rf" data-check="${c.indexOf(x)}"><span class="dot ${sev}"></span><div class="rf-t">${esc(x.text)}</div></div>`).join('') : ''; };
    return `<div class="page">` + pageHead('Checks', esc(h.title), 'Sanity checks on the harness as drawn. Select one to see it on the canvas.') +
      `<div class="card checks-card">${c.length ? block('error', 'Errors') + block('warn', 'Warnings') + block('info', 'Info') : '<div class="rf-ok"><span class="dot ok"></span>No problems found.</div>'}</div></div>`;
  }

  // ── Exports ──
  const baseName = h => U.fileSafe((h.pn ? h.pn + '_' : '') + h.title);
  function exportPng(sh, name) {
    const url = URL.createObjectURL(new Blob([sh.svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = sh.w * 2; c.height = sh.h * 2;
      const g = c.getContext('2d');
      g.scale(2, 2);
      g.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob(b => U.download(name, b), 'image/png');
    };
    img.onerror = () => toast("Couldn't render the PNG.", 'error');
    img.src = url;
  }
  function printSheet(sh) {
    const div = document.createElement('div');
    div.className = 'print-sheet';
    div.innerHTML = sh.svg;
    document.body.appendChild(div);
    document.body.classList.add('printing');
    setTimeout(() => { window.print(); document.body.classList.remove('printing'); div.remove(); }, 50);
  }
  function openFile(file) {
    file.text().then(t => {
      const h = M.normalize(JSON.parse(t));
      if (S.store[h.id]) h.id = U.uid('h');
      h.updated = Date.now();
      S.store[h.id] = h;
      openHarness(h.id);
      toast(`Opened ${h.title}.`);
    }).catch(e => toast("Couldn't open " + file.name + ': ' + e.message, 'error'));
  }
  function pasteWires(text) {
    let made = 0, bad = [];
    change(h => {
      text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(line => {
        const c = line.split(line.includes('\t') ? '\t' : ',').map(s => s.trim());
        const a = M.parseEnd(h, c[0]), b = M.parseEnd(h, c[1]);
        if (!a || !b) { bad.push(line); return; }
        const color = (c[3] || '').toUpperCase();
        M.addWire(h, a, b, { signal: c[2] || '', color: M.colorInfo(color).code || h.defaults.color, gauge: M.AWG[c[4]] ? c[4] : h.defaults.gauge });
        made++;
      });
    });
    toast(`Added ${made} wire${made === 1 ? '' : 's'}.` + (bad.length ? ` ${bad.length} line${bad.length > 1 ? 's' : ''} skipped: ends not found.` : ''), bad.length ? 'error' : null);
  }

  // ── Events ──
  function onAct(act, el) {
    const h = H();
    switch (act) {
      case 'home': S.cur = null; persist(); renderAll(); break;
      case 'theme': { const t = isDark(readTheme()) ? 'light' : 'dark'; writeTheme(t); applyTheme(t); break; }
      case 'new': { const n = M.blank(); n.drawnBy = ''; S.store[n.id] = n; S.view = 'build'; openHarness(n.id); toast('Two ends to start. Click a pin, then a pin on the other end, to run a wire.'); break; }
      case 'demo': S.store.hdemo1 = LM.demo.harness(); openHarness('hdemo1'); break;
      case 'open': $('#file-input').click(); break;
      case 'save': if (h) U.download(baseName(h) + '.loom.json', JSON.stringify(h, null, 2), 'application/json'); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'fit': fit(); renderCanvas(); break;
      case 'fold-rail': toggleFold('rail'); break;
      case 'fold-parts': toggleFold('parts'); break;
      case 'auto-layout': change(x => { x.place = {}; }); S.cam = null; renderCanvas(); break;
      case 'add-conn': addEnd('connector'); break;
      case 'add-splice': addEnd('splice'); break;
      case 'from-board': openBoards(); break;
      case 'bm-close': closeModal(); break;
      case 'bm-back': BM.step = BM.boards ? 'boards' : 'loading'; renderModal(); break;
      case 'bm-retry': if (BM.board && BM.boards) openBoard(BM.board.id); else { BM.boards = null; LM.boards.reset(); openBoards(); } break;
      case 'bm-board': openBoard(el.dataset.id); break;
      case 'bm-add': addBoardConnector(el.dataset.ref); break;
      case 'match-wire': wireMatches(el.dataset.a, el.dataset.b); break;
      case 'delete': deleteSel(); break;
      case 'duplicate': { const c = JSON.parse(JSON.stringify(h)); c.id = U.uid('h'); c.title = h.title + ' (copy)'; c.updated = Date.now(); S.store[c.id] = c; openHarness(c.id); break; }
      case 'delete-harness':
        if (confirm(`Delete "${h.title}" from this browser? Save a file first if you want to keep it.`)) { delete S.store[h.id]; S.cur = null; persist(); renderAll(); }
        break;
      case 'straight': { const to = $('#straight-to').value; const k = change(x => M.wireStraight(x, el.dataset.node, to)); toast(k ? `Added ${k} wire${k > 1 ? 's' : ''}.` : 'No free pin pairs to wire.'); break; }
      case 'group': change(x => { const g = M.addGroup(x, el.dataset.kind, [...S.sel.ids]); S.sel = { kind: 'group', ids: new Set([g.id]) }; }); break;
      case 'export-svg': U.download(baseName(h) + '.svg', S.lastSheet.svg, 'image/svg+xml'); break;
      case 'export-png': exportPng(S.lastSheet, baseName(h) + '.png'); break;
      case 'print': printSheet(S.lastSheet); break;
      case 'csv-wires': U.download(baseName(h) + '_wires.csv', U.csv([['Wire', 'From', 'To', 'Signal', 'Color', 'Gauge (AWG)', 'Length (mm)', 'Group']].concat(M.fromTo(h).map(r => [r.name, r.from, r.to, r.signal, r.color.code, r.gauge, r.length == null ? '' : r.length, r.groups]))), 'text/csv'); break;
      case 'csv-bom': U.download(baseName(h) + '_bom.csv', U.csv([['Item', 'Qty', 'Unit', 'Description', 'Part number', 'Refs']].concat(M.bom(h).map(r => [r.item, r.unit === 'mm' ? (r.qty / 1000).toFixed(2) : r.qty, r.unit === 'mm' ? 'm' : 'ea', r.desc, r.pn, r.refs.join(' ')]))), 'text/csv'); break;
      case 'del-wire': change(x => M.removeWires(x, [el.dataset.id])); break;
      case 'add-wire': {
        const a = M.parseEnd(h, $('#nw-from').value), b = M.parseEnd(h, $('#nw-to').value), sig = $('#nw-signal').value;
        if (!a || !b) { toast('Type both ends as a ref and pin, like P1.3, or a splice, like S1.', 'error'); break; }
        change(x => M.addWire(x, a, b, { signal: sig }));
        break;
      }
      case 'paste': pasteWires($('#paste').value); break;
    }
  }
  function deleteSel() {
    if (!S.sel) return;
    const ids = [...S.sel.ids], kind = S.sel.kind;
    change(h => {
      if (kind === 'node') ids.forEach(id => M.removeNode(h, id));
      if (kind === 'seg') ids.forEach(id => M.removeSegment(h, id));
      if (kind === 'wire') M.removeWires(h, ids);
      if (kind === 'group') ids.forEach(id => M.removeGroup(h, id));
      S.sel = null;
    });
  }
  function goToCheck(i) {
    const c = M.checks(H())[i];
    S.view = 'build';
    if (c && c.ref && c.ref.kind === 'seg') {
      const A = M.analyze(H()), ws = (A.segWires.get(c.ref.id) || []).map(w => w.id);
      S.sel = ws.length ? { kind: 'wire', ids: new Set(ws) } : null;
    } else if (c && c.ref) S.sel = { kind: c.ref.kind, ids: new Set([c.ref.id]) };
    renderAll();
  }

  document.addEventListener('click', e => {
    const t = e.target;
    const a = t.closest('[data-act]');
    if (a && !a.disabled) { onAct(a.dataset.act, a); return; }
    const v = t.closest('[data-view]');
    if (v) { S.view = v.dataset.view; S.pending = null; renderAll(); return; }
    const o = t.closest('[data-open]');
    if (o) { if (o.dataset.open !== S.cur) openHarness(o.dataset.open); else if (S.view !== 'build') { S.view = 'build'; renderAll(); } return; }
    const sf = t.closest('[data-setf]');
    if (sf) { setField(sf.dataset.setf, sf.dataset.v); return; }
    const p = t.closest('[data-pick]');
    if (p) { const [kind, id] = p.dataset.pick.split(':'); select(kind, id); return; }
    const bx = t.closest('#parts-pane [data-box]');
    if (bx) { pickBox(bx.dataset.box); return; }
    const c = t.closest('[data-check]');
    if (c) goToCheck(+c.dataset.check);
  });
  // `toggle` doesn't bubble, so listen while capturing.
  document.addEventListener('toggle', e => {
    if (e.target.id !== 'wires-fold') return;
    S.wiresOpen = e.target.open;
    try { localStorage.setItem(NS + 'wiresOpen', S.wiresOpen ? '1' : '0'); } catch (err) { /* storage blocked */ }
  }, true);
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'file-input') { if (el.files[0]) openFile(el.files[0]); el.value = ''; return; }
    if (el.dataset && el.dataset.hud === 'grid') { change(h => { h.grid = +el.value; }); return; }
    if (el.dataset && el.dataset.f) setField(el.dataset.f, el.value, el);
  });
  document.addEventListener('keydown', e => {
    if (BM.open) { if (e.key === 'Escape') closeModal(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); onAct('save'); return; }
    if (typing) { if (e.key === 'Enter' && document.activeElement.tagName === 'INPUT') document.activeElement.blur(); return; }
    if (!H()) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (S.view !== 'build') return;
    if (e.key === 'Escape') { S.pending ? (S.pending = null) : (S.sel = null); $('#ghost') && ($('#ghost').innerHTML = ''); renderAll(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
    else if (e.key === 'f' || e.key === 'F') { fit(); renderCanvas(); }
    else if (e.key === 'c' || e.key === 'C') addEnd('connector');
  });
  const svg = svgEl();
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', () => { gesture = null; });
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('contextmenu', e => e.preventDefault()); // the right button pans
  window.addEventListener('resize', () => { if (H() && S.view === 'build') renderCanvas(); });
  // Drop a .loom.json anywhere to open it.
  window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) { e.preventDefault(); openFile(f); } });

  function toast(msg, tone) {
    const t = document.createElement('div');
    t.className = 'toast' + (tone === 'error' ? ' lm-toast-error' : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), tone === 'error' ? 7000 : 3200);
  }

  // ── Tool updates (as in Signoff EE and Partcheck) ──
  // A page left open keeps running the version it loaded. Now and then (5 s after opening, every 5
  // minutes, when the tab comes back into view) it asks this site which version it serves. If that's
  // another one, it reloads into it once the page is idle (not typing, dragging, wiring or picking a
  // board), after writing any pending save. The new page says "Tool updated". A version it already
  // reloaded for is never tried twice. Asset URLs carry ?v= stamps (tools/stamp_version.py), and the
  // browser's copies are refreshed before the reload too.
  const UPDATE_KEY = 'signoff.toolUpdate.' + location.pathname;   // sessionStorage: { tried, from }
  let updateWaiting = '', updateBusy = false;
  function updateMemo(v) {
    try {
      if (v === undefined) return JSON.parse(sessionStorage.getItem(UPDATE_KEY) || '{}') || {};
      sessionStorage.setItem(UPDATE_KEY, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function pageIdle() {
    const a = document.activeElement;
    const typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
    return !typing && !document.hidden && !gesture && !S.pending && !BM.open;
  }
  async function reloadWhenIdle() {
    if (!updateWaiting) return;
    if (!pageIdle()) { setTimeout(reloadWhenIdle, 30000); return; }
    if (updateMemo({ tried: updateWaiting, from: LM.VERSION }) === null) { updateWaiting = ''; return; }
    clearTimeout(saveTimer);
    try { localStorage.setItem(NS + 'harnesses', JSON.stringify(S.store)); localStorage.setItem(NS + 'current', S.cur || ''); } catch (e) { /* storage blocked */ }
    const own = u => { try { return new URL(u, location.href).origin === location.origin; } catch (e) { return false; } };
    const urls = [location.href.split('#')[0]]
      .concat([...document.scripts].map(s => s.src), [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href))
      .filter(u => u && own(u));
    await Promise.all(urls.map(u => fetch(u, { cache: 'reload' }).catch(() => null)));
    location.reload();
  }
  function checkForUpdate() {
    const have = LM.VERSION;
    if (!have || have === 'proto' || updateBusy || updateWaiting || !window.fetch) return;
    updateBusy = true;
    fetch('assets/version.js?nc=' + Date.now(), { cache: 'no-store' })
      .then(r => (r.ok ? r.text() : ''))
      .then(text => {
        updateBusy = false;
        const m = /VERSION\s*=\s*["']([0-9a-f]+)["']/.exec(text || '');
        if (!m || m[1] === have || (updateMemo() || {}).tried === m[1]) return;
        updateWaiting = m[1];
        reloadWhenIdle();
      }, () => { updateBusy = false; });
  }
  {
    const memo = updateMemo() || {};
    if (memo.from && memo.from !== LM.VERSION) { updateMemo({ tried: memo.tried }); setTimeout(() => toast('Tool updated'), 300); }
    setTimeout(checkForUpdate, 5000);
    setInterval(checkForUpdate, 5 * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  }

  // ── Start ──
  applyTheme(readTheme());
  if (DEMO) {
    const b = $('#demo-banner');
    b.hidden = false; document.body.classList.add('has-banner');
    b.innerHTML = 'Demo: a harness for the made-up Smart Thermostat for Acme Climate. Edits stay in this browser. <button class="btn btn-plain" data-act="demo">Reset demo</button> <a href="./">Leave the demo</a>';
    document.querySelectorAll('[data-demo-href]').forEach(a => { a.href = a.getAttribute('href') + '?demo'; });
  }
  $('#version').textContent = LM.VERSION ? 'Build ' + LM.VERSION : '';
  load();
  renderAll();
  LM.app = { state: S, renderAll, H };
})(window.LM = window.LM || {});
