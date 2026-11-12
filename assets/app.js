// Loom UI: harnesses in the sidebar; Build (the connection diagram, its parts pane and the rail),
// Drawing, Wires (the editable wire list), BOM and Checks tabs. Harnesses live in
// this browser (localStorage) and sync with Loom's private data repo (assets/store.js) when signed in;
// a harness can also be saved as a .loom.json file.
(function (LM) {
  'use strict';
  const M = LM.model, U = LM.util, L = LM.library, C = LM.conn, esc = U.esc;
  const $ = s => document.querySelector(s);
  const DEMO = /[?&]demo\b/.test(location.search);
  const NS = DEMO ? 'loom.demo.' : 'loom.v1.';

  const S = {
    store: {}, cur: null, view: 'build', sel: null, pending: null, cam: null, past: [], future: [],
  };
  const H = () => S.store[S.cur] || null;
  let linked = '';   // a harness ?project= asked for that this browser doesn't have yet

  // ── Theme: shared with the rest of Signoff (same key) ──
  // The light/dark theme is the suite's, under one fixed key in the demo too (Chris, 2026-11-08: the
  // demo tour flipped between light and dark as it moved between tools that kept it apart).
  const SETTINGS_KEY = 'signoff.v1.settings';
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
    system: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><rect x="2" y="3.5" width="6.5" height="5.5" rx="1.2"/><rect x="11.5" y="11" width="6.5" height="5.5" rx="1.2"/><path d="M8.5 6.2h3.5v4.8"/><path d="M5.2 9v4.7H11.5"/></svg>',
    table: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M3 8.5h14M3 12.3h14M10 4v12"/></svg>',
    note: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M3 4.5h14v8.5H9.5L6 16v-3H3z"/><path d="M6.5 8h7M6.5 10.5h4.5"/></svg>',
    pencil: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M10.5 3.5l2 2L6 12H4v-2z"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    sliders: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.6"/><circle cx="6" cy="11.5" r="1.6"/></svg>',
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
    relayout: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="4.5" height="4" rx="1.2"/><rect x="9.5" y="9.5" width="4.5" height="4" rx="1.2"/><path d="M6.5 4.5h2.2c1.5 0 2.3.8 2.3 2.3v2.7"/></svg>',
    grid: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="3.5" r="1.1"/><circle cx="8" cy="3.5" r="1.1"/><circle cx="12.5" cy="3.5" r="1.1"/><circle cx="3.5" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="12.5" cy="8" r="1.1"/><circle cx="3.5" cy="12.5" r="1.1"/><circle cx="8" cy="12.5" r="1.1"/><circle cx="12.5" cy="12.5" r="1.1"/></svg>',
  };

  // ── Storage ──
  function load() {
    try { S.store = JSON.parse(localStorage.getItem(NS + 'harnesses') || '{}') || {}; } catch (e) { S.store = {}; }
    Object.keys(S.store).forEach(id => { try { M.normalize(S.store[id]); } catch (e) { delete S.store[id]; } });
    if (DEMO && (!S.store.hdemo1 || S.store.hdemo1.demoVersion !== LM.demo.VERSION)) S.store.hdemo1 = LM.demo.harness();
    let c = null;
    try { c = localStorage.getItem(NS + 'current'); } catch (e) { /* storage blocked */ }
    // A link from Signoff PL (?project=<harness id>, as for EE and ME) opens that harness.
    const want = new URLSearchParams(location.search).get('project') || new URLSearchParams(location.search).get('harness');
    if (want && S.store[want] && !S.store[want].deleted) c = want;
    else if (want) linked = want;   // not here yet: the first sync may bring it (syncNow)
    S.cur = S.store[c] && !S.store[c].deleted ? c : DEMO ? 'hdemo1' : null;
    // A system (assets/system.js) open last time, or asked for by ?system=, takes the page.
    const sid = LM.system.init(sysHooks);
    if (sid) { LM.system.open(sid); S.cur = null; }
    // The systems' last synced copies (store.js, IndexedDB), for Discard changes: known once read.
    if (!DEMO && LM.store.loadSysBase) LM.store.loadSysBase().then(() => { if (LM.system.current()) renderToolbar(); });
  }
  // What a system (assets/system.js) needs from the harness side. It never edits a harness itself:
  // New harness here comes back through newHarnessFor.
  const sysHooks = {
    toast: (m, t) => toast(m, t), refresh: () => renderAll(), login: () => R && R.login(),
    harness: id => { const h = S.store[id]; return h && !h.deleted ? h : null; },
    harnesses: () => live(),
    projects: () => [...new Set(live().map(h => h.project).concat(LM.system.live().map(s => s.project)).map(p => String(p || '').trim()).filter(Boolean))].sort(),
    openHarness: id => { S.view = 'build'; openHarness(id); },
    // The grid's Dots or Lines (fold.gridStyle), shared with the harness canvas, and its icon.
    gridStyle: () => (fold.gridStyle === 'lines' ? 'lines' : 'dots'),
    setGridStyle: v => { fold.gridStyle = v === 'lines' ? 'lines' : 'dots'; try { localStorage.setItem(FOLD_KEY, JSON.stringify(fold)); } catch (e) { /* storage blocked */ } renderAll(); },
    gridIcon: () => ICON.grid,
    home: () => { LM.system.close(); S.cur = null; persist(); renderAll(); },
    newHarness: (sys, ends) => newHarnessFor(sys, ends),
    openSystem: id => openSystem(id),
  };
  // A harness end from a system block's connector, as From a board makes one (addBoardConnector).
  function boardEnd(h, b, c, x, y) {
    const n = M.addConnector(h, x, y, { family: L.guessFamily(c.mpn, c.desc), pins: c.pins.length, rows: 1 });
    n.pins = c.pins.length; n.rows = 1;
    n.pinNames = c.pins.map(p => p.pin);
    n.pinLabels = {};
    c.pins.forEach(p => { if (p.label) n.pinLabels[p.pin] = p.label; });
    n.name = `${b.name} ${c.ref}`;
    n.mate = [c.mfr, c.mpn].filter(Boolean).join(' ');
    if (b.source) n.board = { project: b.source.id, name: b.source.name, client: b.source.client || '', ref: c.ref, mpn: c.mpn || '', source: b.source.label || '' };
    return n;
  }
  // New harness here: one end from the connector and a generic far end (a placeholder), or, for two
  // connectors, both ends from them with the wires their shared nets suggest. Returns its end ids in
  // the order asked (a placeholder's far end last).
  function newHarnessFor(sys, ends) {
    const [a, b] = ends;
    const h = M.blank(b ? `${a.b.name} ${a.c.ref} to ${b.b.name} ${b.c.ref}` : `${a.b.name} ${a.c.ref}${a.c.fn ? ' ' + a.c.fn : ''} harness`);
    h.drawnBy = ''; h.project = sys.project || '';
    const old = h.nodes.filter(M.isConn).map(n => n.id);
    const made = ends.map((e, i) => boardEnd(h, e.b, e.c, 160 + i * 480, 240));
    let suggested = 0;
    if (b) {
      old.forEach(id => M.removeNode(h, id));
      LM.boards.matches(made[0], made[1], new Set()).forEach(m => { M.addWire(h, { node: made[0].id, pin: m.a }, { node: made[1].id, pin: m.b }, { signal: m.label }); suggested++; });
    } else M.removeNode(h, old[0]);
    S.store[h.id] = h;
    persist();
    return { h, ends: b ? made.map(n => n.id) : [made[0].id, old[1]], suggested };
  }
  function openSystem(id) { S.cur = null; S.sel = null; S.pending = null; LM.system.open(id); persist(); renderAll(); }
  // Harnesses shown: a harness deleted after it was synced stays as a tombstone (h.deleted) until the
  // data repo has it, so another browser's copy can't bring it back.
  const live = () => Object.values(S.store).filter(h => !h.deleted);

  // ── Sync (assets/store.js): Loom's private data repo, and Signoff PL read only ──
  const R = LM.store;
  const remote = { busy: false, error: '', unsynced: 0 };
  const canSync = () => !DEMO && R && R.signedIn();
  async function syncNow(quiet) {
    if (!canSync() || remote.busy) {
      // Signed out, a click on Sync opens the suite's Settings to sign in (signoff/assets/sidefoot.js).
      if (!quiet && !DEMO && !R.signedIn()) { if (window.SignoffFoot) window.SignoffFoot.settings(); else toast('Sign in to GitHub in this browser to sync harnesses.', 'error'); }
      return;
    }
    remote.busy = true; remote.error = '';
    renderSidebar();
    clearTimeout(saveTimer);
    try {
      const curWas = S.cur && S.store[S.cur] ? R.hash(S.store[S.cur]) : '';
      const res = await R.sync(S.store, { thumb: { svg: LM.sheet.diagram, png: drawingPng } });
      // Take what the repo has, except a harness edited while the sync ran: it stays, unsynced. If the
      // sync also brought someone else's change to it, the next sync must merge the two, not push over.
      const forget = [];
      Object.keys(res.store).forEach(id => {
        const mine = S.store[id];
        if (mine && res.before[id] && R.hash(mine) !== res.before[id]) {
          if (R.hash(res.store[id]) !== res.before[id]) forget.push(id);
          return;
        }
        S.store[id] = res.store[id];
      });
      if (forget.length) R.forget(forget);
      // Systems (assets/system.js) sync with the data repo's systems/ folder, after the harnesses.
      try {
        const ss = LM.system.store(), rs = await R.syncSystems(ss, sysHooks.harness);
        if (rs) {
          Object.keys(rs.store).forEach(id => { if (!ss[id] || !rs.before[id] || R.hash(ss[id]) === rs.before[id]) ss[id] = rs.store[id]; });
          rs.gone.forEach(id => { if (ss[id] && R.hash(ss[id]) === rs.before[id]) delete ss[id]; });
          rs.conflicts.forEach(s => { ss[s.id] = s; });
          LM.system.persist();
        }
      } catch (e) { toast("Couldn't sync systems: " + (e.message || e), 'error'); }
      res.gone.forEach(id => { if (S.store[id] && R.hash(S.store[id]) === res.before[id]) delete S.store[id]; });
      res.conflicts.forEach(h => { S.store[h.id] = h; });
      if (S.cur && (!S.store[S.cur] || S.store[S.cur].deleted)) S.cur = null;
      // A link from Signoff PL to a harness this browser didn't have yet opens once the sync brings it.
      if (!S.cur && linked && S.store[linked] && !S.store[linked].deleted) { S.cur = linked; S.view = 'build'; }
      linked = '';
      // Undo survives a sync that didn't change the open harness (Ctrl+S syncs).
      if (!S.cur || !S.store[S.cur] || R.hash(S.store[S.cur]) !== curWas) { S.past = []; S.future = []; S.sel = null; S.pending = null; }
      persist();
      renderAll();
      res.dropped.forEach(id => { if (S.store[id] && R.hash(S.store[id]) === res.before[id]) delete S.store[id]; });
      if (res.conflicts.length) toast(`${res.conflicts.length} harness${res.conflicts.length > 1 ? 'es were' : ' was'} changed here and elsewhere. The newer one won; the other is kept as a "(conflict copy)".`, 'error');
      else if (res.errors.length) toast(res.errors[0].message + (res.errors.length > 1 ? ` (+${res.errors.length - 1} more)` : ''), 'error');
      else if (res.adopted.length) toast(`Name or part number taken from Signoff PL for ${res.adopted.length} harness${res.adopted.length > 1 ? 'es' : ''}.`);
      else if (!quiet) toast(res.pushed ? 'Synced.' : 'Up to date.');
    } catch (e) {
      remote.error = e.status === 404 ? `Can't reach ${R.config().owner}/${R.config().dataRepo}, and no harness is shared with you. Ask for access, or create the repo.`
        : e.status === 401 ? 'GitHub refused the token. Sign in again in Settings.' : (e.message || String(e));
      if (!quiet || e.status !== 404) toast("Couldn't sync: " + remote.error, 'error');
    } finally {
      remote.busy = false;
      renderSidebar();
      if (H() && S.view === 'build') renderRail();
    }
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
    if (R && R.login()) h.updatedBy = R.login();
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
  // The selection: things of one kind ({ kind, ids }: node, wire, set, note, or seg), or of several
  // kinds at once ({ kind: 'mix', ids: Set of 'kind:id', parts: { kind: Set } }), which a marquee
  // or shift-clicks across kinds make (Chris, 2026-11-07). A mix drags and deletes as one;
  // Properties shows what's in it, with the wire set options off (railMulti).
  const KINDS = ['node', 'wire', 'set', 'note', 'seg'];
  // The ids by kind, as arrays, for any selection.
  const selParts = sel => {
    const P = { node: [], wire: [], set: [], note: [], seg: [] };
    if (!sel) return P;
    if (sel.kind === 'mix') KINDS.forEach(k => { P[k] = [...(sel.parts[k] || [])]; });
    else if (P[sel.kind]) P[sel.kind] = [...sel.ids];
    return P;
  };
  // A selection from ids by kind: one kind plain, several a mix, none null.
  function mkSel(P) {
    const parts = {}, kinds = KINDS.filter(k => { const ids = [...(P[k] || [])]; if (ids.length) parts[k] = new Set(ids); return ids.length; });
    if (!kinds.length) return null;
    if (kinds.length === 1) return { kind: kinds[0], ids: parts[kinds[0]] };
    return { kind: 'mix', ids: new Set(kinds.flatMap(k => [...parts[k]].map(id => k + ':' + id))), parts };
  }
  const selHas = (sel, kind, id) => !!sel && (sel.kind === kind ? sel.ids.has(id) : sel.kind === 'mix' && !!sel.parts[kind] && sel.parts[kind].has(id));
  function tidySel() {
    const h = H();
    if (!S.sel || !h) { if (!h) S.sel = null; return; }
    const have = { node: h.nodes, seg: h.segments, wire: h.wires, set: h.sets, note: h.callouts || [] }, P = selParts(S.sel);
    KINDS.forEach(k => { P[k] = P[k].filter(id => (have[k] || []).some(x => x.id === id)); });
    S.sel = mkSel(P);
  }
  const select = (kind, ids) => { S.sel = kind ? { kind, ids: new Set([].concat(ids)) } : null; renderAll(); };
  // The wires a selection is about: its wires, and its sets'.
  function selWireIds(h, sel) {
    const P = selParts(sel);
    return [...new Set(P.wire.concat(P.set.flatMap(id => { const st = M.set(h, id); return st ? M.wiresIn(h, st) : []; })))];
  }
  // Wires regrouped: each set whose wires are all there stands for them (outermost first, so a
  // bundle takes its pairs with it); what's left stays wires.
  function collapseSets(h, ids) {
    const rest = new Set(ids), sets = [];
    const visit = st => {
      const ws = M.wiresIn(h, st);
      if (ws.length && ws.every(id => rest.has(id))) { sets.push(st.id); ws.forEach(id => rest.delete(id)); return; }
      st.sets.map(id => M.set(h, id)).filter(Boolean).forEach(visit);
    };
    M.roots(h).forEach(visit);
    return { wires: [...rest], sets };
  }
  // A selection of wires. Two or more that are exactly whole sets select those sets (one, as
  // before; several show the sets panel); sets and more wires stay a wire selection, so Properties
  // can make one set of them all.
  function wiresSel(h, ids) {
    if (!ids.length) return null;
    const c = ids.length > 1 ? collapseSets(h, ids) : { wires: ids, sets: [] };
    return c.sets.length && !c.wires.length ? { kind: 'set', ids: new Set(c.sets) } : { kind: 'wire', ids: new Set(ids) };
  }
  // Wires added to a selection's parts (a marquee's pick, or a shift-click): the selection's own
  // wires and sets' wires plus these, regrouped (wiresSel) into P.wire and P.set.
  function addWires(h, P, ids) {
    const ws = wiresSel(h, [...new Set(P.wire.concat(P.set.flatMap(id => { const st = M.set(h, id); return st ? M.wiresIn(h, st) : []; }), ids))]);
    P.wire = ws && ws.kind === 'wire' ? [...ws.ids] : []; P.set = ws && ws.kind === 'set' ? [...ws.ids] : [];
    return P;
  }
  // Shift-click: a thing goes into the selection or comes out of it. A set's wires go together,
  // and wires regroup into sets.
  function toggleSel(kind, id) {
    const h = H(), P = selParts(S.sel);
    if (kind === 'wire' || kind === 'set') {
      const st = kind === 'set' ? M.set(h, id) : null, its = st ? M.wiresIn(h, st) : [id];
      const ws = new Set(selWireIds(h, S.sel)), all = its.every(w => ws.has(w));
      its.forEach(w => (all ? ws.delete(w) : ws.add(w)));
      P.wire = []; P.set = [];
      addWires(h, P, [...ws]);
    } else {
      const s = new Set(P[kind]); s.has(id) ? s.delete(id) : s.add(id); P[kind] = [...s];
    }
    S.sel = mkSel(P);
    renderAll();
  }
  function openHarness(id) {
    LM.system.close();
    S.cur = id; S.sel = null; S.pending = null; S.past = []; S.future = []; S.cam = null;
    persist();
    renderAll();
  }

  // ── Render ──
  // A new selection brings a folded parts pane back, so its Properties show (Chris, 2026-11-08); not
  // the node picked by clicking a pin to start a wire, which would move the canvas mid-wire.
  let selWas = '';
  function unfoldForSelection() {
    const k = S.sel ? S.sel.kind + ':' + [...S.sel.ids].join(',') : '';
    if (k && k !== selWas && !S.pending && fold.parts && !narrow()) { fold.parts = false; saveFold(); }
    selWas = k;
  }
  function renderAll() {
    if (LM.system.current()) {
      renderSidebar(); renderToolbar();
      $('#build-view').hidden = true; $('#page').hidden = false;
      LM.system.render($('#page'));
      return;
    }
    LM.system.leave($('#page'));
    const h = H();
    if (h && S.view === 'build') unfoldForSelection();
    renderSidebar();
    renderToolbar();
    const build = h && S.view === 'build';
    $('#build-view').hidden = !build;
    $('#page').hidden = build;
    if (!h) { $('#page').innerHTML = homeHtml(); return; }
    if (build) { applyFold(); renderCanvas(); renderParts(); renderRail(); renderHud(); return; }
    const pages = { drawing: drawingHtml, wires: wiresHtml, bom: bomHtml, checks: checksHtml };
    const keep = $('#main').scrollTop;
    $('#page').innerHTML = (pages[S.view] || drawingHtml)(h);
    $('#main').scrollTop = keep;
  }

  // ── The Dovetail tools switcher (Chris, 2026-11-09) ──
  // Signed in to GitHub, it lists the whole suite, folded to a row of icons as in Signoff EE (the
  // engine's app.js setupToolsFold, copied here); signed out, only the links that work without a
  // sign-in. A link marked data-signed shows only when signed in, and data-internal only for an FTE.
  const TOOLS_FOLD_MS = 10000;
  function renderTools() {
    const tools = document.querySelector('.side-tools');
    if (!tools) return;
    const signed = R.signedIn(), fte = R.access() === 'fte';
    tools.querySelectorAll('[data-signed]').forEach(a => { a.hidden = !signed || (a.hasAttribute('data-internal') && !fte); });
    // Folded to icons signed in or out, as in every tool (Chris, 2026-11-10).
    if (!tools.foldCtl) tools.foldCtl = setupToolsFold(tools);
    tools.foldCtl.enable(true);
  }
  // Folded, the switcher is one row of tool icons; its chevron opens the full list, which folds again
  // 10 s after the pointer and keyboard focus have left it.
  function setupToolsFold(tools) {
    const head = tools.querySelector('.side-head');
    if (!head) return null;
    const label = head.textContent.trim() || 'Dovetail Signoff';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'side-tools-toggle';
    btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>' +
      '<span class="side-label">' + esc(label) + '</span>';
    // Signed out, the head is its plain label again (enable(false)).
    const plain = document.createElement('span');
    plain.className = 'side-label';
    plain.textContent = label;
    plain.hidden = true;
    head.textContent = '';
    head.append(btn, plain);
    let timer = null, on = true;
    const inUse = () => tools.matches(':hover') || !!tools.querySelector(':focus-visible');
    const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const arm = () => { stop(); if (on && !tools.classList.contains('folded') && !inUse()) timer = setTimeout(() => set(true), TOOLS_FOLD_MS); };
    function set(folded) {
      tools.classList.toggle('folded', folded);
      const tip = (folded ? 'Show ' : 'Hide ') + label + ' tools';
      btn.setAttribute('aria-expanded', String(!folded));
      btn.title = tip; btn.setAttribute('aria-label', tip);
      if (folded) stop(); else arm();
    }
    btn.addEventListener('click', () => set(!tools.classList.contains('folded')));
    tools.addEventListener('mouseenter', stop);
    tools.addEventListener('mouseleave', () => setTimeout(arm, 0));
    tools.addEventListener('focusin', () => { if (inUse()) stop(); });
    tools.addEventListener('focusout', () => setTimeout(arm, 0));
    set(true);
    // Signed out again: the short list, open, with no chevron.
    return { enable(yes) { if (yes === on) return; on = yes; btn.hidden = !yes; plain.hidden = yes; set(yes); } };
  }
  function renderSidebar() {
    renderTools();
    // Systems of systems (Chris, 2026-11-12): the systems placed in no other system sit first in their
    // client project's group, each with the systems it places and the harnesses it uses under it
    // (LM.system.tree); a harness no system uses stays in the project list.
    const T = LM.system.tree(), roots = T.roots.slice().sort((a, b) => String(a.sys.title).localeCompare(String(b.sys.title)));
    const list = live().filter(h => !T.used.has(h.id)).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const systems = roots.map(n => Object.assign({ kind: 'tree', project: n.sys.project }, { node: n }));
    // Does this tree node hold what's open (the system or harness), at any depth?
    const holdsOpen = n => n.id === LM.system.current() || n.harnesses.includes(S.cur) || n.kids.some(holdsOpen);
    const treeFold = fold.sysTree || {};
    const treeRow = (n, d) => {
      const has = n.kids.length + n.harnesses.length > 0, open = n.path in treeFold ? !!treeFold[n.path] : holdsOpen(n);
      const tog = has ? `<button class="lm-tog" data-act="toggle-sys" data-path="${esc(n.path)}" aria-expanded="${open}" title="${open ? 'Fold' : 'Show'} what it holds"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '<span class="lm-tog"></span>';
      return `<div class="lm-tree" style="--d:${d}">${tog}${sysRow(n.sys)}</div>` +
        (open && has ? n.kids.map(k => treeRow(k, d + 1)).join('') + n.harnesses.map(id => { const h = S.store[id]; return h && !h.deleted ? `<div class="lm-tree" style="--d:${d + 1}"><span class="lm-tog"></span>${row(h)}</div>` : ''; }).join('') : '');
    };
    const dirty = new Set(canSync() ? R.unsynced(S.store).concat(R.sysUnsynced(LM.system.store())) : []);
    // Grouped by client project, as Signoff EE groups boards (none: "No project", last).
    const groups = new Map();
    systems.concat(list).forEach(h => { const k = String(h.project || '').trim(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(h); });
    const holds = h => (h.kind === 'tree' ? holdsOpen(h.node) : h.id === S.cur);
    const keys = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
    const sysRow = s => {
      const c = LM.system.checks(s, sysHooks.harness);
      const e = c.filter(x => x.sev === 'error').length, w = c.filter(x => x.sev === 'warn').length;
      // One line (Chris, 2026-11-12: a compact list); the counts are in the tooltip.
      return `<button class="proj${s.id === LM.system.current() ? ' active' : ''}" data-open-sys="${s.id}" title="${esc(`${s.title}\nSystem · ${s.blocks.length} block${s.blocks.length === 1 ? '' : 's'} · ${s.cables.length} cable${s.cables.length === 1 ? '' : 's'}`)}">
        <span class="pkg-icon">${ICON.system}</span>
        <span class="proj-body"><span class="proj-name">${esc(s.title)}</span></span>
        <span class="pkg-sev">${e ? `<span class="e">${e}</span>` : ''}${w ? `<span class="w">${w}</span>` : ''}</span>${dirty.has(s.id) ? '<span class="proj-dirty" title="Not synced yet"></span>' : ''}</button>`;
    };
    const row = h => {
      if (h.kind === 'tree') return treeRow(h.node, 0);
      const c = M.checks(h);
      const e = c.filter(x => x.sev === 'error').length, w = c.filter(x => x.sev === 'warn').length;
      const ends = h.nodes.filter(M.isConn).length;
      // The name, and the part number under it when there is one; the counts are in the tooltip.
      return `<button class="proj${h.id === S.cur ? ' active' : ''}" data-open="${h.id}" title="${esc(`${h.title}\n${h.pn ? h.pn + ' · ' : ''}${ends} ends · ${h.wires.length} wires`)}">
        <span class="pkg-icon">${ICON.harness}</span>
        <span class="proj-body"><span class="proj-name">${esc(h.title)}</span>${h.pn ? `<span class="proj-sub">${esc(h.pn)}</span>` : ''}</span>
        <span class="pkg-sev">${e ? `<span class="e">${e}</span>` : ''}${w ? `<span class="w">${w}</span>` : ''}</span>${dirty.has(h.id) ? '<span class="proj-dirty" title="Not synced yet"></span>' : ''}</button>`;
    };
    // Groups fold as Signoff EE's do (Chris, 2026-11-11): a click on a group's heading, kept in this
    // browser (fold.closedGroups, by lowercase name). The group holding the open harness stays open,
    // and folding it closes the harness (home).
    const grouped = keys.length > 1 || !!keys[0], closed = fold.closedGroups || {};
    const gkey = k => k.toLowerCase();
    $('#harness-list').innerHTML = fromPlHtml() + (list.length || systems.length ? (grouped ? keys.map(k => {
      const hold = groups.get(k).some(holds), open = !closed[gkey(k)] || hold;
      return `<div class="side-group"><button class="side-group-head" data-act="toggle-group" data-group="${esc(gkey(k))}"${hold ? ' data-holds-open' : ''} aria-expanded="${open}" title="Client project">` +
        `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
        `<span class="side-group-name">${esc(k || 'No project')}</span><span class="side-group-count">${groups.get(k).length}</span></button>` +
        (open ? groups.get(k).map(row).join('') : '') + `</div>`;
    }).join('') : systems.concat(list).map(row).join(''))
      : '<div class="side-empty">No harnesses yet.</div>');
    // Fold or unfold every group: the button in the Harnesses heading, beside New.
    const foldBtn = $('[data-act="fold-groups"]');
    if (foldBtn) {
      const allClosed = grouped && keys.every(k => closed[gkey(k)]), tip = (allClosed ? 'Expand' : 'Collapse') + ' all projects';
      foldBtn.hidden = !grouped;
      foldBtn.title = tip; foldBtn.setAttribute('aria-label', tip);
      foldBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        (allClosed ? '<path d="M5 6l3-3 3 3M5 10l3 3 3-3"/>' : '<path d="M5 3l3 3 3-3M5 13l3-3 3 3"/>') + '</svg>';
    }
    // The footer's sync pill, as Signoff EE's: a dot, a title, and a sub line; its tooltip carries the
    // build hash (EE keeps that off the sidebar).
    const pill = $('#sync-pill');
    if (!pill) return;
    const last = R && R.lastSync(), login = R && R.login();
    let tone, title, sub, tip, who = false;
    if (DEMO) { tone = 'idle'; title = 'Demo mode'; sub = 'Changes stay in this browser'; tip = 'Demo harnesses never leave this browser.'; }
    else if (!canSync()) { tone = 'idle'; title = 'Local only'; sub = 'Click to sign in'; tip = 'Sign in to GitHub to keep harnesses in Loom’s private repo.'; }
    else if (remote.busy) { tone = 'busy'; title = 'Syncing…'; sub = login ? '@' + login : R.config().owner; who = !!login; tip = ''; }
    else if (remote.error) { tone = 'error'; title = 'Sync failed'; sub = remote.error; tip = remote.error; }
    else if (dirty.size) { tone = 'warn'; title = `${dirty.size} unsynced change${dirty.size === 1 ? '' : 's'}`; sub = login ? '@' + login : 'Click to sync'; who = !!login; tip = 'Changed since the last sync.'; }
    else if (last && last.errors && last.errors.length) { tone = 'warn'; title = 'Synced with problems'; sub = last.errors[0].message; tip = last.errors.map(e => e.message).join('\n'); }
    else {
      const shared = live().filter(h => R.isShared(h.id)).length;
      // Line 1 is the sync state and when; line 2 the GitHub account (Chris, 2026-11-10).
      tone = 'ok'; title = last ? 'Synced ' + ago(last.at) : 'Ready'; sub = login ? '@' + login : 'Click to sync'; who = !!login;
      tip = R.access() === 'contractor' ? `Harnesses shared with you, each in its own private repo` : `Kept in ${R.config().owner}/${R.config().dataRepo}` + (shared ? `; ${shared} shared in ${shared === 1 ? 'its own private repo' : 'their own private repos'}` : '');
    }
    $('#sync-dot').dataset.tone = tone;
    $('#sync-title').textContent = title;
    $('#sync-sub').textContent = sub;
    $('#sync-sub').classList.toggle('sync-who', who);
    pill.title = [tip, canSync() ? 'Click to sync (Ctrl+S)' : '', LM.VERSION ? 'Build ' + LM.VERSION : ''].filter(Boolean).join('\n');
  }
  // The From Signoff PL list: Parts a PL project marks "to be made in Loom" that no harness was started
  // from yet (store.js waiting). Nothing is made until you click one (Chris, 2026-11-08: new things wait
  // in a tray, to be added on purpose in the tool they belong to). Start makes the harness with the
  // Part's name and number, and PL links that Part to it at its next sync (pl.js claimPlanned).
  function plWaiting() { return !DEMO && R && R.pl() ? R.waiting(R.pl(), live()) : []; }
  function fromPlHtml() {
    const list = plWaiting();
    if (!list.length) return '';
    return `<div class="side-group lm-from-pl"><div class="side-group-head lm-group-head" title="Parts Signoff PL is waiting on: start one to draw its harness"><span class="side-group-name">From Signoff PL</span><span class="side-group-count">${list.length}</span></div>` +
      list.map(p => `<button class="proj lm-pl-wait" data-act="pl-start" data-pl="${esc(p.project + '/' + p.node)}" title="Start this harness: Loom makes it with the Part’s name and number, and Signoff PL links it to the Part at its next sync">
        <span class="pkg-icon lm-pl-icon">${ICON.harness}</span>
        <span class="proj-body"><span class="proj-name">${esc(p.name || 'Unnamed Part')}</span><span class="proj-sub">${esc([p.number, p.projectName].filter(Boolean).join(' · '))}</span></span>
        <span class="lm-pl-start">Start</span></button>`).join('') + `</div>`;
  }
  function startFromPl(key) {
    const part = plWaiting().find(p => p.project + '/' + p.node === key);
    if (!part) { toast('That Part isn’t waiting in Signoff PL any more. Sync to refresh the list.', 'error'); return; }
    const n = R.startFromPl(M.blank(), part);
    n.drawnBy = ''; n.identAt = '';
    S.store[n.id] = n; S.view = 'build'; openHarness(n.id);
    toast(`Started ${n.title}. Sync, and Signoff PL links it to its Part at PL’s next sync.`);
  }
  function ago(at) {
    const s = Math.max(0, (Date.now() - Date.parse(at)) / 1000);
    return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(at).toLocaleDateString('en-US');
  }

  // Discard changes (Chris, 2026-11-10): shown when the open harness has changes since the last sync
  // and this browser kept that sync's copy (R.base). Never in the demo (Reset demo does that there).
  // Chris, 2026-11-12: on whatever page is open, whenever it has changes since the last sync. When this
  // browser kept no copy of that sync, the version it saw is read from GitHub (store.js discardCopy).
  const canDiscard = h => canSync() && !!R.unsynced({ [h.id]: h }).length && R.canDiscard('harness', h.id);
  async function discardChanges() {
    const id = S.cur;
    let b = null;
    try { b = await R.discardCopy('harness', id); } catch (e) { toast("Couldn't read the last synced version from GitHub: " + e.message, 'error'); return; }
    if (!b || S.cur !== id) { if (!b) toast("There's no synced version of this harness to go back to.", 'error'); return; }
    snapshot();
    S.store[S.cur] = b;
    S.sel = null; S.pending = null;
    persist();
    renderAll();
    toast('Back to the last sync. Ctrl+Z brings your changes back.');
  }
  // A system's top right (Chris, 2026-11-12: as a harness's): Undo, Redo, Discard changes while it has
  // changes since the last sync and this browser kept that sync's copy (R.hasSysBase), and Save file.
  function sysToolbar() {
    const id = LM.system.current(), s = id && LM.system.get(id), Y = LM.system;
    const discard = s && canSync() && R.sysUnsynced({ [id]: s }).length && R.canDiscard('system', id);
    return `<button class="icon-btn" data-act="sys-undo" title="Undo (Ctrl+Z)" aria-label="Undo"${Y.canUndo() ? '' : ' disabled'}>${ICON.undo}</button>` +
      `<button class="icon-btn" data-act="sys-redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo"${Y.canRedo() ? '' : ' disabled'}>${ICON.redo}</button>` +
      (discard ? `<button class="btn" data-act="sys-discard" title="Put this system back as it was at the last sync (Ctrl+Z brings the changes back)">Discard changes</button>` : '') +
      `<button class="btn btn-primary" data-act="sys-save" title="Download this system as a .loom.json file">${ICON.save}<span class="btn-label">Save file</span></button>`;
  }
  async function discardSystem() {
    const id = LM.system.current();
    let b = null;
    try { b = id && await R.discardCopy('system', id); } catch (e) { toast("Couldn't read the last synced version from GitHub: " + e.message, 'error'); return; }
    if (LM.system.current() !== id) return;
    if (b && LM.system.discardTo(b)) toast('Back to the last sync. Ctrl+Z brings your changes back.');
    else toast("There's no synced version of this system to go back to.", 'error');
  }
  function renderToolbar() {
    const h = H();
    const seg = $('#view-seg');
    if (LM.system.current()) { seg.innerHTML = ''; seg.hidden = true; $('#toolbar-actions').innerHTML = sysToolbar(); return; }
    if (!h) { seg.innerHTML = ''; seg.hidden = true; $('#toolbar-actions').innerHTML = ''; return; }
    seg.hidden = false;
    const c = M.checks(h);
    const e = c.filter(x => x.sev === 'error').length, w = c.filter(x => x.sev === 'warn').length;
    const tabs = [['build', 'Build'], ['drawing', 'Drawing'], ['wires', 'Wires', h.wires.length], ['bom', 'BOM'], ['checks', 'Checks', e + w, e ? 'error' : w ? 'warn' : '']];
    seg.innerHTML = tabs.map(([v, l, n, dot]) => `<button class="${S.view === v ? 'on' : ''}" data-view="${v}">${l}${n ? ` <span class="count">${n}</span>` : ''}${dot ? `<span class="dot ${dot}"></span>` : ''}</button>`).join('');
    $('#toolbar-actions').innerHTML =
      `<button class="icon-btn" data-act="undo" title="Undo (Ctrl+Z)" aria-label="Undo"${S.past.length ? '' : ' disabled'}>${ICON.undo}</button>` +
      `<button class="icon-btn" data-act="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo"${S.future.length ? '' : ' disabled'}>${ICON.redo}</button>` +
      (canDiscard(h) ? `<button class="btn" data-act="discard" title="Put this harness back as it was at the last sync (Ctrl+Z brings the changes back)">Discard changes</button>` : '') +
      `<button class="btn btn-primary" data-act="save" title="Download this harness as a .loom.json file${canSync() ? '' : ' (Ctrl+S)'}">${ICON.save}<span class="btn-label">Save file</span></button>`;
  }

  function homeHtml() {
    return `<div class="page"><div class="drop" id="drop">
      <div class="empty-art">${ICON.upload}</div>
      <h2>Draw a harness a tech can build from</h2>
      <p>Add the ends, click pin to pin to wire them, and group wires into cables. Loom draws the wiring diagram, the connector faces, the wire list, and the BOM.</p>
      <div class="actions"><button class="btn btn-primary" data-act="new">New harness</button><button class="btn" data-act="new-system" title="Place boards and devices, and plug harnesses into their connectors">New system</button><button class="btn" data-act="open">Open a file…</button>
      ${DEMO ? '<button class="btn" data-act="demo">Demo harness</button><button class="btn" data-act="demo-system">Demo system</button>' : '<a class="btn" href="?demo">Try the demo</a>'}<button class="btn" data-act="guide">Take the guide</button></div>
      ${plWaiting().length ? `<div class="lm-home-pl"><b>${plWaiting().length === 1 ? 'A Part in Signoff PL is' : plWaiting().length + ' Parts in Signoff PL are'} waiting for a harness</b><span>They’re under From Signoff PL in the sidebar. Start one to draw it; PL links it to its Part at the next sync.</span></div>` : ''}
      <div class="drop-tiles">
        <div><b>Ends</b>Connector tables with pin labels, face views with pin 1</div>
        <div><b>Wires</b>Colors, gauges, splices, lengths</div>
        <div><b>Cables</b>Cables, twisted pairs, and shields</div>
        <div><b>Drawing</b>Wiring diagram, wire list, BOM, notes, title block</div>
      </div>
      <div class="foot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>${canSync() ? `Harnesses sync with Loom’s private repo, ${esc(R.config().dataRepo)}, and show in Signoff PL by their client project.` : 'Harnesses stay in this browser until you sign in to GitHub in Settings (they then sync with Loom’s private repo) or save a file.'}</div>
    </div></div>`;
  }

  // ── Build: the connection diagram ──
  // Laid out automatically, unless parts were dragged (h.place). Click a pin row, then a pin row on another
  // end (or a splice), to run a wire. Click a box header to select its cable or wires.
  const svgEl = () => $('#canvas');
  let lastBox = null, lastLayout = null;
  // The canvas finish (docs/look-2026-11.md): the diagram drawn with `fx` (cards, wire gloss,
  // contacts), the gradients it uses, an intro the first time a harness is shown, a draw-in for a new
  // wire and a lift for a dragged part. The selection's pulse is phase-locked to the clock (--phase),
  // so a re-render mid-pulse doesn't restart it.
  const FX_DEFS = '<defs>' +
    '<linearGradient id="lmfx-sheath" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--cv-sheath-hi)"/><stop offset="0.45" style="stop-color:var(--cv-sheath-mid)"/><stop offset="1" style="stop-color:var(--cv-sheath-lo)"/></linearGradient>' +
    '<linearGradient id="lmfx-band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--cv-band-lo)"/><stop offset="0.35" style="stop-color:var(--cv-band-hi2)"/><stop offset="1" style="stop-color:var(--cv-band-lo)"/></linearGradient>' +
    // Connector and splice cards: a lit header, and a faint shade down the body (glass, 3D).
    '<linearGradient id="lmfx-conn-head" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--cv-conn-head-hi)"/><stop offset="1" style="stop-color:var(--cv-conn-head)"/></linearGradient>' +
    '<linearGradient id="lmfx-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--cv-glass-top)"/><stop offset="0.45" style="stop-color:var(--cv-glass-mid)"/><stop offset="1" style="stop-color:var(--cv-glass-bot)"/></linearGradient>' +
    '<linearGradient id="lmfx-head" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--cv-head-hi)"/><stop offset="1" style="stop-color:var(--cv-head)"/></linearGradient>' +
    '<radialGradient id="lmfx-metal" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#fffbe8"/><stop offset="0.45" stop-color="#e3c27a"/><stop offset="1" stop-color="#9a7a3a"/></radialGradient>' +
    '<linearGradient id="lmfx-crimp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f7f9"/><stop offset="0.45" stop-color="#cfd2d8"/><stop offset="0.55" stop-color="#9fa3ab"/><stop offset="1" stop-color="#dfe2e6"/></linearGradient>' +
    '<radialGradient id="lmfx-face" cx="0.4" cy="0.35" r="0.75"><stop offset="0" style="stop-color:var(--cv-sheath-face)"/><stop offset="1" style="stop-color:var(--cv-sheath-face-lo)"/></radialGradient>' +
    '</defs>';
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // hp: a harness to draw instead of the real one (a wire-end drag's preview), with extra render
  // options; the real layout stays in lastLayout.
  function renderCanvas(hp, extra) {
    const h = hp || H(), svg = svgEl();
    const intro = !hp && !reduceMotion() && S.introFor !== h.id;
    if (intro) { S.introFor = h.id; clearTimeout(S.introT); S.introT = setTimeout(() => { S.introT = null; if (S.view === 'build' && H()) renderCanvas(); }, 1700); }
    const r = C.render(h, M.analyze(h), Object.assign({ sel: S.sel, pending: S.pending, fx: true, intro: intro || (!hp && !!S.introT), fresh: S.fresh, lift: S.lift, slide: S.slide, prop: !!fold.prop }, extra));
    if (!hp) { lastBox = r.box; lastLayout = r.layout; }
    const wrap = $('#canvas-wrap');
    const w = wrap.clientWidth || 800, hh = wrap.clientHeight || 600;
    if (!S.cam) fit(r.box, w, hh);
    // The grid parts snap to: a dot at every step and a stronger one every fifth, or (Grid › Lines,
    // fold.gridStyle, kept in this browser) a line at every step and a stronger one every fifth.
    const gs = gridOf(h), P = gs * 5;
    const marks = fold.gridStyle === 'lines'
      ? [1, 2, 3, 4].map(i => `<path class="gl" d="M${i * gs} 0V${P}M0 ${i * gs}H${P}"/>`).join('') + `<path class="gl major" d="M0 0V${P}M0 0H${P}"/>`
      : [...Array(25)].map((_, i) => `<circle class="${i % 5 || Math.floor(i / 5) % 5 ? 'gd' : 'gd major'}" cx="${(i % 5) * gs}" cy="${Math.floor(i / 5) * gs}" r="${i ? 0.9 : 1.4}"/>`).join('');
    const grid = gs ? `<defs><pattern id="cv-grid" width="${P}" height="${P}" patternUnits="userSpaceOnUse">${marks}</pattern></defs>` : '';
    svg.classList.toggle('intro', intro);
    svg.classList.toggle('wiring', !!S.pending);
    // Wire labels (the checkbox by the zoom control): canvas only; the sheet always prints them.
    svg.classList.toggle('no-wtext', !!fold.noWireText);
    if ($('#wtext')) $('#wtext').checked = !fold.noWireText;
    if ($('#propview')) $('#propview').checked = !!fold.prop;
    svg.style.setProperty('--phase', -(performance.now() % 1800).toFixed(0) + 'ms');
    svg.innerHTML = FX_DEFS + grid + `<rect class="bg" data-bg="1" x="-20000" y="-20000" width="40000" height="40000" fill="${gs ? 'url(#cv-grid)' : 'transparent'}"/>` +
      `<g id="world">${r.svg}</g><g id="ghost"></g>`;
    setView();
    const tip = $('#tip');
    svg.classList.toggle('placing', !!S.placing);
    if (S.placing) {
      tip.style.display = 'flex';
      tip.innerHTML = S.placing === 'table' ? `<span class="tip-dot"></span><span>Click where the table's top-left corner goes. <span class="tip-k">Esc</span> cancels.</span>`
        : `<span class="tip-dot"></span><span>Click a wire, a set, or a connector to pin a note to it, or drag to draw an area for it. <span class="tip-k">Esc</span> cancels.</span>`;
    } else if (S.pending) {
      tip.style.display = 'flex';
      tip.innerHTML = `<span class="tip-dot"></span><span>Wiring from <b>${esc(M.endText(h, S.pending))}</b>. Click a glowing pin or a splice. <span class="tip-k">Esc</span> cancels.</span>`;
    } else tip.style.display = 'none';
    lightBadgeSet();
  }
  // Hovering a set's badge lights the set's area as hovering the set does (Chris). Kept across
  // redraws, which replace the canvas's elements.
  let badgeHover = null;
  function lightBadgeSet() {
    svgEl().querySelectorAll('.cv-setarea.hover').forEach(el => el.classList.remove('hover'));
    if (badgeHover) svgEl().querySelectorAll('.cv-setarea').forEach(el => { if (el.dataset.set === badgeHover) el.classList.add('hover'); });
  }
  // The camera only moves the viewBox: zoom, pan, and Fit never redraw the diagram.
  function setView() {
    const svg = svgEl(), wrap = $('#canvas-wrap');
    const w = wrap.clientWidth || 800, hh = wrap.clientHeight || 600;
    svg.setAttribute('viewBox', `${S.cam.x} ${S.cam.y} ${w / S.cam.k} ${hh / S.cam.k}`);
    // The zoom, for hit areas that keep a size on screen (styles.css .w-hit).
    svg.style.setProperty('--k', S.cam.k);
    const z = $('#zoom-val');
    if (z) z.textContent = Math.round(S.cam.k * 100) + '%';
  }
  function fitCam(box, w, hh) {
    const wrap = $('#canvas-wrap');
    w = w || wrap.clientWidth || 800; hh = hh || wrap.clientHeight || 600;
    box = box || lastBox || { x0: 0, y0: 0, x1: 800, y1: 500 };
    const pad = 36, top = 60, bot = 56; // room for the HUD above and the zoom control below
    const k = Math.max(0.25, Math.min(1.25, (w - pad * 2) / (box.x1 - box.x0 || 1), (hh - top - bot) / (box.y1 - box.y0 || 1)));
    return { k, x: (box.x0 + box.x1) / 2 - w / k / 2, y: (box.y0 + box.y1) / 2 - (hh + top - bot) / k / 2 };
  }
  function fit(box, w, hh) { S.cam = fitCam(box, w, hh); }
  // Glide the camera to `to`, fast at first and settling softly. Reduce Motion jumps.
  let glideRaf = 0;
  function glide(to) {
    cancelAnimationFrame(glideRaf);
    if (!S.cam || reduceMotion()) { S.cam = to; setView(); return; }
    const from = Object.assign({}, S.cam), t0 = performance.now(), T = 480;
    const ease = t => 1 - Math.pow(1 - t, 4);
    const step = now => {
      const t = Math.min(1, (now - t0) / T), e = ease(t);
      // Zoom in log space, so the speed feels even.
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      S.cam = { k, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      setView();
      if (t < 1) glideRaf = requestAnimationFrame(step);
    };
    glideRaf = requestAnimationFrame(step);
  }
  function fitGlide() { glide(fitCam()); }
  // Zoom by a factor about the middle of the canvas.
  function zoomBy(m) {
    const wrap = $('#canvas-wrap'), w = wrap.clientWidth, hh = wrap.clientHeight;
    const c = { x: S.cam.x + w / S.cam.k / 2, y: S.cam.y + hh / S.cam.k / 2 };
    const k = Math.max(0.2, Math.min(4, m === 0 ? 1 : S.cam.k * m));
    glide({ k, x: c.x - w / k / 2, y: c.y - hh / k / 2 });
  }
  function toWorld(e) {
    const rc = svgEl().getBoundingClientRect();
    return { x: S.cam.x + (e.clientX - rc.left) / S.cam.k, y: S.cam.y + (e.clientY - rc.top) / S.cam.k };
  }
  // Grid step in diagram units; 0 turns the grid and snapping off. Kept with the harness. Every step
  // divides the port pitch (C.G.PITCH, 20), so ports on different parts can share a grid line.
  const GRIDS = [0, 5, 10, 20];
  const gridOf = h => (h && GRIDS.includes(h.grid) ? h.grid : h && h.grid > 20 ? 20 : 10);
  // The two side panels fold away; remembered in this browser.
  const FOLD_KEY = NS + 'fold';
  const fold = (() => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (e) { return {}; } })();
  // The demo always opens in the arranged view, Real proportions off (Chris).
  if (DEMO) fold.prop = false;
  // The harness panel (the rail) starts folded (Chris, 2026-11-08); clicking a harness in the menu
  // opens it. Once folded or opened by hand, that's kept.
  if (fold.rail === undefined) fold.rail = true;
  const FOLD_ICON = side => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="${side === 'left' ? 'M8 3.5v13' : 'M12 3.5v13'}"/></svg>`;
  function applyFold() {
    const bv = $('#build-view');
    bv.classList.toggle('fold-rail', !!fold.rail);
    bv.classList.toggle('fold-parts', !!fold.parts);
  }
  function saveFold() { try { localStorage.setItem(FOLD_KEY, JSON.stringify(fold)); } catch (e) { /* storage blocked */ } }
  function toggleFold(which) {
    fold[which] = !fold[which];
    saveFold();
    applyFold();
    renderHud();
    renderCanvas();
  }
  // The sidebar (the menu: brand, harnesses, tools) hides as in Signoff EE (Chris): its button in
  // the top-right corner, the toolbar's ☰ button or [. Kept in this browser (fold.side). On a phone
  // it's a drawer instead (nav-open), and styles.css keeps the collapse from hiding it there.
  function applySide() {
    const app = $('#app');
    app.classList.toggle('side-collapsed', !!fold.side);
    if (fold.sideW) app.style.setProperty('--side-w', fold.sideW + 'px'); else app.style.removeProperty('--side-w');
  }
  // The menu's right edge drags to widen it (Chris, 2026-11-12), kept in this browser (fold.sideW);
  // a double-click goes back to the usual width. Collapsing still hides it whatever its width.
  const SIDE_MIN = 220, SIDE_MAX = 560;
  function sideResize() {
    const grip = $('#side-resize');
    if (!grip) return;
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const app = $('#app'), x0 = e.clientX, w0 = $('#sidebar').getBoundingClientRect().width;
      app.classList.add('side-sizing');
      grip.setPointerCapture(e.pointerId);
      const move = ev => {
        fold.sideW = Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, w0 + ev.clientX - x0)));
        app.style.setProperty('--side-w', fold.sideW + 'px');
      };
      const up = () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        app.classList.remove('side-sizing');
        saveFold();
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', () => { delete fold.sideW; saveFold(); applySide(); });
  }
  function toggleSidebar() {
    if (narrow()) { $('#app').classList.toggle('nav-open'); return; }
    fold.side = !fold.side;
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(fold)); } catch (e) { /* storage blocked */ }
    applySide();
  }
  function renderHud() {
    // Slid labels count as dragged positions: Auto layout puts them back too.
    // In Real proportions it's the heights dragged there (h.propY) that Auto layout forgets.
    const h = H(), gs = gridOf(h), placed = h && (fold.prop ? h.propY && Object.keys(h.propY).length : (h.place && Object.keys(h.place).length) || (h.routes && Object.keys(h.routes).length) || h.wires.some(w => w.labelAt != null || w.labelOff != null) || h.sets.some(st => st.badgeAt != null || st.badgeOff != null));
    // Glass capsules, one per kind of control (docs/look-2026-11.md): the panel, the view, the grid.
    $('#hud-right').innerHTML = `<div class="seg glass"><button class="hud-fold" data-act="fold-parts" title="${fold.parts ? 'Show' : 'Hide'} the parts pane" aria-label="${fold.parts ? 'Show' : 'Hide'} the parts pane">${FOLD_ICON('right')}</button></div>`;
    $('#hud').innerHTML = `<div class="seg glass"><button class="hud-fold" data-act="fold-rail" title="${fold.rail ? 'Show' : 'Hide'} the harness panel" aria-label="${fold.rail ? 'Show' : 'Hide'} the harness panel">${FOLD_ICON('left')}</button></div>` +
      `<div class="seg glass"><button class="hud-ico" data-act="fit" title="Fit the diagram (F)">${ICON.fit}<span>Fit</span></button>` +
      (placed ? `<button class="hud-ico" data-act="auto-layout" title="Forget the positions you dragged and the wires you shaped, and lay the diagram out again">${ICON.relayout}<span>Auto layout</span></button>` : '') + `</div>` +
      `<label class="seg glass hud-grid" title="Parts snap to the grid as you drag them. Hold Ctrl to place one anywhere.">${ICON.grid}<select data-hud="grid" aria-label="Grid"><optgroup label="Spacing">${GRIDS.map(g => `<option value="${g}"${g === gs ? ' selected' : ''}>${g ? 'Grid ' + g : 'Grid off'}</option>`).join('')}</optgroup>` +
      `<optgroup label="Style">${[['dots', 'Dots'], ['lines', 'Lines']].map(([k, t]) => `<option value="${k}">${(fold.gridStyle === 'lines') === (k === 'lines') ? '● ' : '○ '}${t}</option>`).join('')}</optgroup></select></label>`;
  }

  // Pointer: drag a connector, splice, or box to move it (snapping to the grid; Ctrl places it
  // anywhere); drag with the right or middle button to pan; wheel to zoom; click to pick or wire.
  // A left drag on empty canvas draws a selection box (drawMarquee).
  let gesture = null;
  // Touch: one finger works like the mouse, except that dragging empty canvas pans; two fingers
  // pinch to zoom and pan about their midpoint. touches: the fingers down, by pointer id.
  const touches = new Map();
  let pinch = null;
  const pinchAt = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  function onDown(e) {
    if (e.button > 2) return;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        // A second finger turns whatever the first began into a pinch; a part it was moving stays put.
        const g = gesture;
        gesture = null; S.lift = null;
        svgEl().classList.remove('dragging', 'dragging-end');
        if (g && (g.item || g.note || g.setEnd || g.label) && g.moved) { S.slide = null; H().updated = Date.now(); persist(); renderAll(); }
        else if (g && g.end && g.moved) renderCanvas();
        cancelAnimationFrame(glideRaf);
        const m = pinchAt();
        pinch = Object.assign(m, { cam0: Object.assign({}, S.cam), w: toWorld({ clientX: m.x, clientY: m.y }) });
        svgEl().setPointerCapture(e.pointerId);
        return;
      }
    }
    // Add › Note: a click pins the note to a part, a drag draws an area for it (Chris).
    if (e.button === 0 && S.placing === 'note') {
      gesture = { x: e.clientX, y: e.clientY, moved: false, t: e.target, button: 0, touch: e.pointerType === 'touch', shift: false, cam0: Object.assign({}, S.cam), draw: true };
      svgEl().setPointerCapture(e.pointerId);
      return;
    }
    // Add › Table: a click places one (click(), placeTable).
    if (e.button === 0 && S.placing === 'table') {
      gesture = { x: e.clientX, y: e.clientY, moved: false, t: e.target, button: 0, touch: e.pointerType === 'touch', shift: false, cam0: Object.assign({}, S.cam) };
      svgEl().setPointerCapture(e.pointerId);
      return;
    }
    // A table drags by its body, an inner column rule drags sideways, and its corner resizes it.
    const tblEl = e.button === 0 && !S.pending && !S.placing ? e.target.closest('[data-tblcol], [data-tblcorner], [data-tbl]') : null;
    if (tblEl) {
      const d = tblEl.dataset, col = d.tblcol ? d.tblcol.split('|') : null;
      gesture = { x: e.clientX, y: e.clientY, moved: false, t: e.target, button: 0, touch: e.pointerType === 'touch', shift: e.shiftKey || e.ctrlKey || e.metaKey, cam0: Object.assign({}, S.cam),
        table: col ? { id: col[0], part: 'col', i: +col[1] } : { id: d.tblcorner || d.tbl, part: d.tblcorner ? 'corner' : 'move' } };
      svgEl().setPointerCapture(e.pointerId);
      return;
    }
    // An area note's edge moves it, a corner resizes it, and its dot slides along the edge.
    const areaEl = e.button === 0 && !S.pending && !S.placing && e.target.closest('[data-areaedge], [data-areah], [data-areapin]');
    if (areaEl) {
      const d = areaEl.dataset, k = d.areah ? d.areah.split('|') : null;
      gesture = { x: e.clientX, y: e.clientY, moved: false, t: e.target, button: 0, touch: e.pointerType === 'touch', shift: e.shiftKey || e.ctrlKey || e.metaKey, cam0: Object.assign({}, S.cam),
        area: k ? { id: k[0], part: k[1] } : { id: d.areaedge || d.areapin, part: d.areapin ? 'pin' : 'move' } };
      svgEl().setPointerCapture(e.pointerId);
      return;
    }
    // A wire-end dot (a splice port, a loose end, or where a wire meets a pin) drags that end.
    const endEl = e.button === 0 && !S.pending && e.target.closest('[data-end]');
    // A nested set's end grip drags that end past its parent's or in from it.
    const setEndEl = e.button === 0 && !S.pending && !endEl && e.target.closest('[data-setend]');
    // A note's bubble drags the bubble.
    const noteEl = e.button === 0 && !S.pending && !S.placing && e.target.closest('[data-notebox]');
    // A wire's label slides along its wire; a click on one is a click on what's under it.
    // Its dot slides along the wire (data-ldot, inside the label's group).
    const labelEl = e.button === 0 && !S.pending && !S.placing && !endEl && !setEndEl && e.target.closest('[data-label]');
    const ldot = !!(labelEl && e.target.closest('[data-ldot]'));
    // A set's badge drags anywhere, and its leader's dot along its set (a click still selects it).
    const badgeEl = e.button === 0 && !S.pending && !S.placing && !endEl && !setEndEl && e.target.closest('.cv-badge, [data-bdot]');
    const badge = badgeEl ? { id: badgeEl.dataset.set, dot: !!badgeEl.dataset.bdot } : null;
    const itemEl = e.button === 0 && !endEl && !setEndEl && !badgeEl && e.target.closest('[data-item]');
    const end = endEl ? { wire: endEl.dataset.end.split('|')[0], which: endEl.dataset.end.split('|')[1] } : null;
    const setEnd = setEndEl ? { id: setEndEl.dataset.setend.split('|')[0], side: setEndEl.dataset.setend.split('|')[1] } : null;
    gesture = { x: e.clientX, y: e.clientY, moved: false, t: e.target, button: e.button, touch: e.pointerType === 'touch', shift: e.shiftKey || e.ctrlKey || e.metaKey, shiftKey: e.shiftKey, cam0: Object.assign({}, S.cam), item: itemEl && !noteEl ? itemEl.dataset.item : null, end, setEnd, note: noteEl ? noteEl.dataset.notebox : null, label: labelEl ? labelEl.dataset.label : null, ldot, badge };
    // A left drag that grabs nothing (empty canvas, or a wire's line) draws a selection box
    // (marquee). A finger pans instead.
    const g = gesture;
    // Routes (arranged view; Chris, 2026-11-10): a run's handle, a wire's line, or a set's area drags
    // the straight run of its route under the pointer sideways (dragRun). A click without moving
    // still selects, and Shift-drag from a line still draws a box. A set's area doesn't move its box.
    if (g.item && g.item.startsWith('b:') && !fold.prop) g.item = null;
    // A bundle's split point (data-split: the box key, a |, and 0 or 1 for which end) drags anywhere.
    const splitEl = g.button === 0 && !g.touch && e.target.closest('[data-split]');
    if (splitEl) { const d = splitEl.dataset.split, cut = d.lastIndexOf('|'); g.split = { key: d.slice(0, cut), k: +d.slice(cut + 1) }; g.item = null; }
    g.run = g.split ? null : runUnder(e, g);
    if (g.button === 0 && !g.touch && !S.pending && !S.placing && !g.item && !g.end && !g.setEnd && !g.note && !g.label && !g.badge && !g.run && !g.split) g.marquee = true;
    svgEl().setPointerCapture(e.pointerId);
  }
  // Where a dragged wire end would land: a splice (the side and port slot under the pointer), a
  // connector's pin row, or else a loose end at the pointer, on the grid. Tested against the layout
  // from the start of the drag (lo), so targets hold still while the preview changes. null: the
  // wire's own other end, which an end can't move onto.
  function dropTarget(lo, p, end, free) {
    const h = H(), w = M.wire(h, end.wire);
    if (!w) return null;
    const oth = w[end.which === 'from' ? 'to' : 'from'].node, m = 12;
    for (const it of lo.items) {
      if (it.kind === 'splice') {
        if (p.x < it.x - m || p.x > it.x + it.w + m || p.y < it.y - m || p.y > it.y + it.h + m) continue;
        if (it.n.id === oth) return null;
        // The ports as they stand, without this wire, and it slotted in where the pointer is.
        const side = p.x < it.x + it.w / 2 ? 'l' : 'r', P = lo.portsOf(it.n.id);
        const order = { l: P.l.filter(x => x.id !== w.id).map(x => x.id), r: P.r.filter(x => x.id !== w.id).map(x => x.id) };
        // Its slot: after every port on that side that sits above the pointer (ports can be one or
        // two pitches apart, conn.js spliceSize).
        const portY = x => lo.endY(x.from.node === it.n.id ? x.from : x.to);
        const idx = P[side].filter(x => x.id !== w.id && portY(x) < p.y).length;
        order[side].splice(idx, 0, w.id);
        return { node: it.n.id, side, order };
      }
      if (it.kind === 'conn') {
        if (p.x < it.x || p.x > it.x + it.w || p.y < it.y + it.sz.h0 || p.y > it.y + it.h) continue;
        if (it.n.id === oth) return null;
        const pin = M.pinList(it.n)[Math.floor((p.y - it.y - it.sz.h0) / C.G.ROW)];
        return pin == null ? null : { node: it.n.id, pin };
      }
    }
    const gs = gridOf(h), snap = v => (free || !gs ? Math.round(v) : Math.round(v / gs) * gs);
    return { loose: true, x: snap(p.x), y: snap(p.y) };
  }
  // Draw the harness as it would be with the dragged end dropped here.
  function previewEnd(g, e) {
    g.target = dropTarget(g.lo, toWorld(e), g.end, e.ctrlKey || e.metaKey);
    const hp = JSON.parse(JSON.stringify(H()));
    if (g.target) M.moveEnd(hp, g.end.wire, g.end.which, g.target);
    renderCanvas(hp, { drop: g.target && g.target.side ? g.target.node : null, carry: g.end.wire, dropPin: g.target && g.target.pin != null ? g.target : null });
  }
  function onMove(e) {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (touches.size < 2) return;
      const m = pinchAt(), rc = svgEl().getBoundingClientRect();
      const k = Math.max(0.2, Math.min(4, pinch.cam0.k * m.d / pinch.d));
      S.cam = { k, x: pinch.w.x - (m.x - rc.left) / k, y: pinch.w.y - (m.y - rc.top) / k };
      setView();
      return;
    }
    const g = gesture;
    if (!g) { if (S.pending) drawGhost(e); return; }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < (g.touch ? 8 : 4)) return;
    if (g.end) {
      if (!g.moved) { g.lo = lastLayout; svgEl().classList.add('dragging', 'dragging-end'); }
      g.moved = true;
      if (g.lo) previewEnd(g, e);
      return;
    }
    if (g.draw) { drawArea(g, e); return; }
    if (g.marquee) { drawMarquee(g, e); return; }
    if (g.area) { dragArea(g, e); return; }
    if (g.table) { dragTable(g, e); return; }
    if (g.setEnd) { dragSetEnd(g, e); return; }
    if (g.run) { dragRun(g, e); return; }
    if (g.split) {
      // Snapped to the grid (Ctrl: anywhere), kept as h.routes[key].split0 or split1 (conn.js terminal).
      const h = H();
      if (!g.moved) { snapshot(); svgEl().classList.add('dragging'); }
      g.moved = true;
      const q = toWorld(e), gs = gridOf(h), free = e.ctrlKey || e.metaKey || !gs, snap = v => (free ? Math.round(v) : Math.round(v / gs) * gs);
      h.routes = h.routes || {};
      h.routes[g.split.key] = Object.assign({}, h.routes[g.split.key], { ['split' + g.split.k]: { x: snap(q.x), y: snap(q.y) } });
      renderCanvas(null, { fast: true });
      return;
    }
    if (g.label) { (g.ldot ? slideDot : moveLabel)(g, e); return; }
    if (g.badge) { dragBadge(g, e); return; }
    if (g.note) {
      const c = M.note(H(), g.note);
      if (!c) { gesture = null; return; }
      if (!g.moved) { snapshot(); g.n0 = { dx: +c.dx || 0, dy: +c.dy || 0 }; svgEl().classList.add('dragging'); S.sel = { kind: 'note', ids: new Set([c.id]) }; }
      g.moved = true;
      c.dx = Math.round(g.n0.dx + dx / S.cam.k); c.dy = Math.round(g.n0.dy + dy / S.cam.k);
      renderCanvas();
      return;
    }
    if (!g.moved && g.item) {
      // In Real proportions x comes from lengths, so parts and sets drag only up and down there
      // (h.propY; Chris). A box nobody moved follows its ends.
      const Lo = lastLayout, ok = i => (fold.prop ? i.kind !== 'loose' : i.kind !== 'box'), it = Lo && Lo.items.find(i => i.key === g.item && ok(i));
      if (!it) g.item = null;
      else {
        snapshot(); g.prop = !!fold.prop;
        // A selected part takes the whole selection with it (Chris, 2026-11-07): every selected
        // connector and splice, and the box of every selected set or wire, moves the same way.
        // A box's stored x is its outermost set's left end (conn.js), past any set running out on the left.
        const keys = selectedKeys(Lo), group = keys.has(it.key) ? Lo.items.filter(i => keys.has(i.key) && ok(i)) : [it];
        g.parts = group.map(i => ({ key: i.key, start: { x: i.x + (i.kind === 'box' ? i.sz.lx || 0 : 0), y: i.y }, port0: i.sz.port0 || 0 }));
        S.lift = g.item; svgEl().classList.add('dragging');
      }
    }
    g.moved = true;
    if (g.item) {
      const h = H(), gs = gridOf(h), free = e.ctrlKey || e.metaKey || !gs;
      const snap = v => (free ? Math.round(v) : Math.round(v / gs) * gs);
      // Snap the first port, not the top edge, so the part's ports land on grid lines.
      if (g.prop) {
        h.propY = h.propY || {};
        g.parts.forEach(p => { h.propY[p.key] = snap(p.start.y + dy / S.cam.k + p.port0) - p.port0; });
        renderCanvas();
        return;
      }
      h.place = h.place || {};
      g.parts.forEach(p => { h.place[p.key] = { x: snap(p.start.x + dx / S.cam.k), y: snap(p.start.y + dy / S.cam.k + p.port0) - p.port0, v: 3 }; });
      renderCanvas(null, { fast: true });
      return;
    }
    // The right or middle button pans, and so does a finger (a left drag on empty canvas is a marquee).
    if (g.button === 0 && !g.touch) return;
    svgEl().classList.add('dragging');
    cancelAnimationFrame(glideRaf);
    S.cam.x = g.cam0.x - dx / S.cam.k; S.cam.y = g.cam0.y - dy / S.cam.k;
    setView();
  }
  // The layout items the selection covers: n:<node> for its connectors and splices, and the box of
  // every selected set (its outermost set's) or wire (its set's box, or its stack).
  function selectedKeys(Lo) {
    const P = selParts(S.sel), keys = new Set(P.node.map(id => 'n:' + id)), ws = new Set(P.wire), ss = new Set(P.set);
    Lo.items.forEach(it => {
      if (it.kind !== 'box') return;
      if (it.b.wires.some(w => ws.has(w.id)) || (it.sz.spans || []).some(sp => ss.has(sp.s.id))) keys.add(it.key);
    });
    return keys;
  }
  // Drag a set's end along its box's path (conn.js it.path: its route, or in Real proportions the
  // straight run across the box). The pointer, less where the end was grabbed, is
  // projected onto the path, and how far in from the wire ends that is (at the box's scale sz.k,
  // mm per unit; in Real proportions through sz.prop) sets that end's overhang, measured from what
  // holds it (M.setEnd; the sets inside stay put). Snapped to 5 mm, and onto the end of what holds
  // it within SNAP units, so ending with it is easy to hit. It isn't limited by lengths (Chris), only
  // by the wire ends (the path's ends) and MIN_W from the set's other end. One snapshot,
  // so one undo puts it back. The tip reads the overhang and the total.
  const MIN_W = 12, SNAP = 10;
  function dragSetEnd(g, e) {
    const h = H(), d = g.setEnd;
    if (!g.moved) {
      const st = M.set(h, d.id), p = st && M.parentOf(h, d.id);
      const it = st && lastLayout && lastLayout.items.find(i => i.kind === 'box' && i.path && i.sz.arc && i.sz.arc.has(d.id));
      if (!it) { gesture = null; return; }
      const A = M.analyze(h), a = it.sz.arc.get(d.id), P = it.path, side = d.side === 'r';
      const at = C.pathAt(P, side ? a.u1 : a.u0), q0 = toWorld({ clientX: g.x, clientY: g.y });
      const packs = !!(st.cable || st.shield || st.bundle || st.twist), lo = packs ? 0 : P.aL, hi = packs ? P.S : P.aL + P.Ls;
      snapshot();
      g.moved = true;
      Object.assign(g, { it, P, off: { x: q0.x - at.x, y: q0.y - at.y }, pr: p ? M.reach(h, p) : { l: 0, r: 0 }, pa: p ? it.sz.arc.get(p.id) : null,
        lo: side ? a.u0 + MIN_W : lo, hi: side ? hi : a.u1 - MIN_W,
        PL: p ? M.setLength(h, A, p) : M.setRun(A, st), other: M.ov(st)[side ? 'l' : 'r'], parent: p ? p.label : null });
      S.sel = { kind: 'set', ids: new Set([d.id]) };
      svgEl().classList.add('dragging');
    }
    const q = toWorld(e), side = d.side === 'r', sz = g.it.sz;
    let u = Math.min(g.hi, Math.max(g.lo, C.project(g.P, { x: q.x - g.off.x, y: q.y - g.off.y })));
    let snapped = false;
    if (g.pa) { const pu = side ? g.pa.u1 : g.pa.u0; if (Math.abs(u - pu) < SNAP) { u = pu; snapped = true; } }
    // How far in from its side's wire end the pointer is, in mm.
    const reach = sz.prop ? (side ? sz.prop.L - sz.prop.inv(u) : sz.prop.inv(u)) : (side ? g.P.S - u : u) * sz.k;
    const v = snapped ? 0 : Math.round((g.pr[d.side] - reach) / 5) * 5 || 0;
    const st = M.set(h, d.id);
    M.setEnd(h, d.id, d.side, v);
    renderCanvas();
    const tip = $('#tip'), total = g.PL == null ? null : g.PL + g.other + v;
    tip.style.display = 'block';
    const what = g.parent ? (v > 0 ? `runs ${v} mm past ${esc(g.parent)}` : v < 0 ? `stops ${-v} mm inside ${esc(g.parent)}` : `ends with ${esc(g.parent)}`)
      : (v < 0 ? `stops ${-v} mm short of the wire ends` : v > 0 ? `runs ${v} mm past the wire ends` : 'reaches the wire ends');
    tip.innerHTML = `<b>${esc(st.label)}</b> ${what} on the ${side ? 'right' : 'left'}` + (total != null ? ` · ${U.fmtLen(total)} in all` : '');
  }
  // Routes (arranged view; Chris, 2026-11-10: wires walk around the parts, and their straight runs
  // drag). The run under the pointer at a drag's start: a run's handle (data-run), else the route of
  // the wire whose line it is or of the set whose area it is, its run nearest the pointer, within the
  // route's width. null in Real proportions or on a finger. Shift breaks the run where it's grabbed
  // (dragRun; Chris, 2026-11-11: a Shift-drag from a line drew a box before).
  function runUnder(e, g) {
    const Lo = lastLayout;
    if (!Lo || fold.prop || g.button !== 0 || g.touch || S.pending || S.placing || g.end || g.setEnd || g.note || g.label || g.badge || g.item) return null;
    const p = toWorld(e), handle = e.target.closest('[data-run]');
    // A handle's data-run is the box key (which has a | in it), a |, and the run's index.
    const hr = handle ? handle.dataset.run : '', cut = hr.lastIndexOf('|');
    let key = null;
    if (handle) key = hr.slice(0, cut);
    else if (e.target.classList.contains('w-hit')) key = Lo.boxOfWire(e.target.closest('[data-wire]').dataset.wire);
    else if (e.target.classList.contains('cv-setarea')) key = Lo.boxOfSet(e.target.dataset.set);
    const r = key && Lo.runAt(key, p);
    if (!r) return null;
    if (handle) { const j = +hr.slice(cut + 1), R = LM.route.runs(r.route.A, r.route.B, r.route.v)[j]; return R ? Object.assign(r, { j, k: R.k, axis: R.axis, at: { x: (R.a.x + R.b.x) / 2, y: (R.a.y + R.b.y) / 2 } }) : null; }
    return r.d <= r.route.half + 12 ? r : null;
  }
  // Drag a route's run sideways: a vertical run left and right, a level one up and down, snapped to
  // the grid (Ctrl: anywhere). The route is then kept as shaped (h.routes[box key].v; route.js). An
  // end run belongs to its part, so dragging one first adds a bend in it, a stub out from the part, and
  // drags the rest of the run; Shift-drag puts the bend where it's grabbed (connect.js grab). The first and last vertical runs stay clear of their parts. Let go,
  // a run dragged flush with its neighbor merges into it (route.js tidy). One undo puts it back.
  function dragRun(g, e) {
    const h = H(), CN = LM.connect, gs = gridOf(h), snap = gs ? (x => Math.round(x / gs) * gs) : null;
    if (!g.moved) {
      // The shared engine's grab (connect.js): the whole straight run drags (an end run from a stub out
      // of its part); Shift breaks it where it's grabbed.
      const st = CN.grab(g.run, snap, !!g.shiftKey);
      if (!st) { gesture = null; return; }
      snapshot();
      h.routes = h.routes || {};
      const R0 = g.run.route;
      g.keep = { a: R0.A.side, b: R0.B.side, mode: h.routes[g.run.key] && h.routes[g.run.key].mode };
      h.routes[g.run.key] = Object.assign({ v: st.v0 }, g.keep);
      Object.assign(g, st, { p0: toWorld({ clientX: g.x, clientY: g.y }), A: R0.A, B: R0.B, stub: R0.stub });
      svgEl().classList.add('dragging');
    }
    g.moved = true;
    // Parts don't stop a run (Chris, 2026-11-10): dragged past a connector, the route leaves from its
    // other edge, and over one, it runs behind it (connect.js routeAll). Ctrl places it off the grid,
    // as it does a part.
    const free = e.ctrlKey || e.metaKey || !gs;
    // Near straight, it snaps straight (5 grid steps, or 10-unit steps with the grid off; not with Ctrl).
    h.routes[g.run.key] = Object.assign({ v: CN.slide(g, g.p0, toWorld(e), free ? null : snap, e.ctrlKey || e.metaKey ? 0 : gs || 10) }, g.keep);
    renderCanvas();
  }
  // A finger lifting ends a pinch; the one left down does nothing until it lifts too.
  function endTouch(e) {
    if (!touches.delete(e.pointerId) || !pinch) return false;
    if (!touches.size) pinch = null;
    return true;
  }
  // A wire's label hangs from a dot on its wire (conn.js labelAt; Chris). Dragging the dot slides it
  // along the wire's lane: the pointer, less where the dot was grabbed, projected onto the lane from
  // the drag's start gives w.labelAt, 0 to 1 along it, and the label comes along at the same offset.
  // Dragging the label moves it anywhere, kept as w.labelOff from its dot; its dot stays put. When
  // the drawing moves, both keep their places on the wire. One snapshot each, so one undo puts it back.
  function labelStart(g) {
    const w = M.wire(H(), g.label), L = w && lastLayout && lastLayout.labelAt(w), ln = L && lastLayout.lane(w);
    if (!ln) { gesture = null; return null; }
    snapshot();
    // Freeze what the other half of the drag keeps: the dot's place, and the label's offset from it.
    if (w.labelAt == null) w.labelAt = Math.round(L.t * 1000) / 1000;
    if (w.labelOff == null) w.labelOff = { dx: Math.round(L.x0 - L.dot.x), dy: Math.round(L.ty - L.dot.y) };
    S.slide = w.id;
    svgEl().classList.add('dragging');
    return { w, L, ln, p: toWorld({ clientX: g.x, clientY: g.y }) };
  }
  function slideDot(g, e) {
    if (!g.moved) {
      const o = labelStart(g);
      if (!o) return;
      Object.assign(g, { moved: true, ln: o.ln, off: { x: o.p.x - o.L.dot.x, y: o.p.y - o.L.dot.y } });
    }
    const w = M.wire(H(), g.label), p = toWorld(e);
    w.labelAt = Math.round(C.project(g.ln, { x: p.x - g.off.x, y: p.y - g.off.y }) / (g.ln.S || 1) * 1000) / 1000;
    renderCanvas();
  }
  function moveLabel(g, e) {
    if (!g.moved) {
      const o = labelStart(g);
      if (!o) return;
      Object.assign(g, { moved: true, d0: { x: o.L.dot.x, y: o.L.dot.y }, o0: Object.assign({}, o.w.labelOff) });
    }
    const w = M.wire(H(), g.label), dx = (e.clientX - g.x) / S.cam.k, dy = (e.clientY - g.y) / S.cam.k;
    w.labelOff = { dx: Math.round(g.o0.dx + dx), dy: Math.round(g.o0.dy + dy) };
    renderCanvas();
  }
  // A set's badge (Chris: draggable like the wire labels). Dragging the badge moves it anywhere, kept
  // as s.badgeOff from its leader's dot; dragging the dot slides it along the set's lower edge, kept
  // as s.badgeAt (0 to 1 along its stretch), and the badge comes along. Either drag first freezes the
  // other half, and one undo puts it back.
  function dragBadge(g, e) {
    const h = H(), st = M.set(h, g.badge.id);
    if (!g.moved) {
      const it = st && lastLayout && lastLayout.items.find(i => i.kind === 'box' && i.band && i.sz.spans.some(sp => sp.s.id === st.id));
      const bd = it && C.badgeOf(it, st.id);
      if (!bd) { gesture = null; return; }
      const band = it.band(it.sz.spans.find(sp => sp.s.id === st.id)), p0 = toWorld({ clientX: g.x, clientY: g.y });
      snapshot();
      if (st.badgeAt == null) st.badgeAt = Math.round(bd.t * 1000) / 1000;
      if (st.badgeOff == null) st.badgeOff = { dx: Math.round(bd.x - bd.ax), dy: Math.round(bd.y - bd.ay) };
      // The set's lower edge, with how far along the set each point is, to project the dot onto.
      const edge = { pts: band.pts.map(p => ({ x: p.x + p.nx * p.bot, y: p.y + p.ny * p.bot, s: p.u })) };
      Object.assign(g, { moved: true, band, edge, o0: Object.assign({}, st.badgeOff), off: { x: p0.x - bd.ax, y: p0.y - bd.ay } });
      S.sel = { kind: 'set', ids: new Set([st.id]) };
      svgEl().classList.add('dragging');
    }
    if (g.badge.dot) {
      const p = toWorld(e), u = C.project(g.edge, { x: p.x - g.off.x, y: p.y - g.off.y });
      st.badgeAt = Math.round((u - g.band.u0) / Math.max(1e-6, g.band.u1 - g.band.u0) * 1000) / 1000;
    } else st.badgeOff = { dx: Math.round(g.o0.dx + (e.clientX - g.x) / S.cam.k), dy: Math.round(g.o0.dy + (e.clientY - g.y) / S.cam.k) };
    renderCanvas();
  }
  function onUp(e) {
    if (endTouch(e) || pinch) return;
    const g = gesture;
    gesture = null;
    S.lift = null;
    S.slide = null;
    svgEl().classList.remove('dragging', 'dragging-end');
    if (g && g.label) {
      if (g.moved) { H().updated = Date.now(); persist(); renderAll(); return; }
      // Not a way to pick a wire (Chris took that out): the click goes to what's under the label.
      if (g.button === 0) {
        const svg = svgEl(), under = document.elementsFromPoint(g.x, g.y).find(el => el !== svg && svg.contains(el) && !el.closest('[data-label]'));
        click(under || svg, g.shift, g);
      }
      return;
    }
    if (g && g.draw) {
      if (g.moved && g.rect && g.rect.w >= AREA_MIN && g.rect.h >= AREA_MIN) { placeArea(g.rect); return; }
      if (g.moved) { renderCanvas(); toast('Drag a bigger box, or click a part to pin the note to it.'); return; }
    }
    if (g && g.marquee && g.moved) { finishMarquee(g); return; }
    if (g && g.split && g.moved) { svgEl().classList.remove('dragging'); H().updated = Date.now(); persist(); renderAll(); return; }
    if (g && g.run && g.moved) { const r = H().routes[g.run.key], R1 = lastLayout && lastLayout.runAt(g.run.key, { x: 0, y: 0 }); if (r && R1) H().routes[g.run.key] = LM.connect.release(R1.route, r.v, r); svgEl().classList.remove('dragging'); H().updated = Date.now(); persist(); renderAll(); return; }
    if (g && (g.setEnd || g.note || g.badge || g.area || g.table) && g.moved) { H().updated = Date.now(); persist(); renderAll(); return; }
    if (g && g.end && g.moved) {
      if (g.target && change(h => M.moveEnd(h, g.end.wire, g.end.which, g.target))) S.sel = { kind: 'wire', ids: new Set([g.end.wire]) };
      renderAll();
      return;
    }
    if (g && g.item && g.moved) { H().updated = Date.now(); persist(); renderAll(); return; }
    if (g && !g.moved && g.button === 0) click(g.t, g.shift, g);
    else if (g && !g.moved && g.button === 2 && !g.touch) openCtx(g);
  }
  // Marquee selection (Chris, 2026-11-07): a left drag on empty canvas draws a box. Dragged right
  // to left (green) it selects whatever it touches; left to right (blue) whatever lies wholly
  // inside it, as in CAD. It picks everything: connectors and splices, wires (regrouped into the
  // sets they fill, wiresSel) and notes, as one mixed selection when they're of several kinds. A
  // wire counts by its line in the open: the part of it inside a connector's or splice's card (and
  // a little either side) is left out, so a box across a part needn't take every wire landing on
  // it. Shift adds to the selection. What the box would select lights up as it's drawn (.mq).
  const MQ_MARGIN = 8, MQ_STEP = 6;
  // Everything the box can pick, measured once at the drag's start in world units: nodes by their
  // cards, wires by points along their lines (sampled from the drawn path, which is in world
  // units), notes by their bubbles and areas.
  function marqueeTargets() {
    const Lo = lastLayout, svg = svgEl();
    if (!Lo) return { nodes: [], wires: [], notes: [] };
    const nodes = Lo.items.filter(it => (it.kind === 'conn' || it.kind === 'splice') && it.n).map(it => ({ id: it.n.id, x: it.x, y: it.y, w: it.w, h: it.h }));
    const inCard = p => nodes.some(n => p.x >= n.x - MQ_MARGIN && p.x <= n.x + n.w + MQ_MARGIN && p.y >= n.y - MQ_MARGIN && p.y <= n.y + n.h + MQ_MARGIN);
    const wires = [];
    svg.querySelectorAll('#world g.w[data-wire]').forEach(gw => {
      const path = gw.querySelector('path.w-hit');
      if (!path || !path.getTotalLength) return;
      const L = path.getTotalLength(), pts = [];
      for (let s = 0; s <= L; s += MQ_STEP) { const p = path.getPointAtLength(s); if (!inCard(p)) pts.push({ x: p.x, y: p.y }); }
      if (pts.length) wires.push({ id: gw.dataset.wire, pts });
    });
    const notes = [];
    svg.querySelectorAll('#world .cv-note[data-note]').forEach(gn => {
      const rects = [...gn.querySelectorAll('rect.cv-note-box, rect.cv-area, rect.cv-table-box')].map(r => ({ x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') }));
      if (rects.length) notes.push({ id: gn.dataset.note, rects });
    });
    return { nodes, wires, notes };
  }
  // The ids the box picks, by kind: touch (any overlap) or inside (wholly within).
  function marqueePick(T, r, touch) {
    const x1 = r.x + r.w, y1 = r.y + r.h;
    const rectIn = b => b.x >= r.x && b.y >= r.y && b.x + b.w <= x1 && b.y + b.h <= y1;
    const rectHit = b => b.x < x1 && b.x + b.w > r.x && b.y < y1 && b.y + b.h > r.y;
    const ptIn = p => p.x >= r.x && p.x <= x1 && p.y >= r.y && p.y <= y1;
    return {
      wire: T.wires.filter(w => (touch ? w.pts.some(ptIn) : w.pts.every(ptIn))).map(w => w.id),
      node: T.nodes.filter(n => (touch ? rectHit(n) : rectIn(n))).map(n => n.id),
      note: T.notes.filter(n => (touch ? n.rects.some(rectHit) : n.rects.every(rectIn))).map(n => n.id),
    };
  }
  function drawMarquee(g, e) {
    if (!g.moved) { g.p0 = toWorld({ clientX: g.x, clientY: g.y }); g.targets = marqueeTargets(); svgEl().classList.add('marquee'); }
    g.moved = true;
    const p = toWorld(e), touch = p.x < g.p0.x;
    const r = { x: Math.min(p.x, g.p0.x), y: Math.min(p.y, g.p0.y), w: Math.abs(p.x - g.p0.x), h: Math.abs(p.y - g.p0.y) };
    g.rect = r; g.touch = touch;
    const gh = $('#ghost');
    if (gh) gh.innerHTML = `<rect class="cv-marquee ${touch ? 'touch' : 'inside'}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;
    // Light what it would pick.
    const pick = marqueePick(g.targets, r, touch), svg = svgEl();
    svg.querySelectorAll('#world .mq').forEach(el => el.classList.remove('mq'));
    const light = (sel, attr, ids) => { const s = new Set(ids); if (s.size) svg.querySelectorAll('#world ' + sel).forEach(el => { if (s.has(el.dataset[attr])) el.classList.add('mq'); }); };
    light('g.w[data-wire]', 'wire', pick.wire); light('[data-item][data-node]', 'node', pick.node); light('.cv-note[data-note]', 'note', pick.note);
  }
  function finishMarquee(g) {
    svgEl().classList.remove('marquee');
    const h = H(), pick = g.rect ? marqueePick(g.targets, g.rect, g.touch) : { wire: [], node: [], note: [] };
    const P = g.shift ? selParts(S.sel) : selParts(null);
    P.node = [...new Set(P.node.concat(pick.node))]; P.note = [...new Set(P.note.concat(pick.note))];
    addWires(h, P, pick.wire);
    S.sel = mkSel(P);
    renderAll();
  }
  // Draw an area for a note (Add › Note, then a drag): a dashed box from where the drag began.
  const AREA_MIN = 16;
  function drawArea(g, e) {
    if (!g.moved) g.p0 = toWorld({ clientX: g.x, clientY: g.y });
    g.moved = true;
    const p = toWorld(e), r = { x: Math.min(p.x, g.p0.x), y: Math.min(p.y, g.p0.y), w: Math.abs(p.x - g.p0.x), h: Math.abs(p.y - g.p0.y) };
    g.rect = r;
    const gh = $('#ghost');
    if (gh) gh.innerHTML = `<rect class="cv-area draw" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${Math.min(10, r.w / 2, r.h / 2)}"/>`;
  }
  // The note for a drawn area, kept from the top-left of the connector or splice nearest it so it
  // follows that part between views (conn.js areaRect), its dot three quarters along the top edge
  // and its bubble above that.
  function placeArea(r) {
    const Lo = lastLayout, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let best = null, bd = Infinity;
    (Lo ? Lo.items : []).forEach(it => {
      if (it.kind !== 'conn' && it.kind !== 'splice') return;
      const d = Math.hypot(it.x + it.w / 2 - cx, it.y + it.h / 2 - cy);
      if (d < bd) { bd = d; best = it; }
    });
    const at = { kind: 'area', node: best ? best.n.id : null, x: Math.round(r.x - (best ? best.x : 0)), y: Math.round(r.y - (best ? best.y : 0)),
      w: Math.round(r.w), h: Math.round(r.h), e: Math.round(0.75 * r.w / (2 * (r.w + r.h)) * 1000) / 1000 };
    S.placing = null;
    change(x => { const c = M.addNote(x, at, { dx: 40, dy: -50 }); S.sel = { kind: 'note', ids: new Set([c.id]) }; });
  }
  // Drag an area note: its edge moves the area, a corner resizes it (not below AREA_MIN), and its
  // dot slides round the edge (at.e). One snapshot, so one undo puts it back.
  function dragArea(g, e) {
    const c = M.note(H(), g.area.id), Lo = lastLayout;
    if (!c || !c.at || c.at.kind !== 'area' || !Lo) { gesture = null; return; }
    const a = c.at;
    if (!g.moved) {
      snapshot();
      g.a0 = { x: +a.x || 0, y: +a.y || 0, w: +a.w || AREA_MIN, h: +a.h || AREA_MIN };
      g.r0 = Lo.areaRect(c);
      // Sliding the dot leaves the bubble where it is; only the leader moves.
      const p0 = Lo.noteAt(c);
      g.b0 = p0 && { x: p0.x + (+c.dx || 0), y: p0.y + (+c.dy || 0) };
      S.sel = { kind: 'note', ids: new Set([c.id]) };
      svgEl().classList.add('dragging');
    }
    g.moved = true;
    const dx = (e.clientX - g.x) / S.cam.k, dy = (e.clientY - g.y) / S.cam.k, part = g.area.part;
    if (part === 'pin') {
      a.e = Math.round(C.edgeT(g.r0, toWorld(e)) * 1000) / 1000;
      const p = C.edgeAt(g.r0, a.e);
      if (g.b0) { c.dx = Math.round(g.b0.x - p.x); c.dy = Math.round(g.b0.y - p.y); }
    }
    else if (part === 'move') { a.x = Math.round(g.a0.x + dx); a.y = Math.round(g.a0.y + dy); }
    else {
      let { x, y, w, h } = g.a0;
      if (part.includes('w')) { const nx = Math.min(x + w - AREA_MIN, x + dx); w += x - nx; x = nx; }
      if (part.includes('e')) w = Math.max(AREA_MIN, w + dx);
      if (part.includes('n')) { const ny = Math.min(y + h - AREA_MIN, y + dy); h += y - ny; y = ny; }
      if (part.includes('s')) h = Math.max(AREA_MIN, h + dy);
      Object.assign(a, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    }
    renderCanvas();
  }
  // Add › Table (Chris, 2026-11-11): a 2 × 2 table with its top-left where the click landed (on
  // the grid), kept from the top-left of the nearest connector or splice like an area note.
  function nearestPart(x, y) {
    let best = null, bd = Infinity;
    (lastLayout ? lastLayout.items : []).forEach(it => {
      if (it.kind !== 'conn' && it.kind !== 'splice') return;
      const d = Math.hypot(it.x + it.w / 2 - x, it.y + it.h / 2 - y);
      if (d < bd) { bd = d; best = it; }
    });
    return best;
  }
  function placeTable(g) {
    const p = toWorld({ clientX: g.x, clientY: g.y }), gs = gridOf(H()), snap = v => (gs ? Math.round(v / gs) * gs : Math.round(v));
    const x = snap(p.x), y = snap(p.y), best = nearestPart(x + 100, y + 30);
    const at = { kind: 'table', node: best ? best.n.id : null, x: Math.round(x - (best ? best.x : 0)), y: Math.round(y - (best ? best.y : 0)) };
    S.placing = null;
    change(h => { const c = M.addTable(h, at, 2, 2); S.sel = { kind: 'note', ids: new Set([c.id]) }; });
  }
  // Drag a table: its body moves it (on the grid; Ctrl anywhere), an inner column rule moves that
  // rule between its neighbors, and its corner sets the width (every column keeps its share) and a
  // least height. One snapshot, so one undo puts it back.
  function dragTable(g, e) {
    const c = M.note(H(), g.table.id), Lo = lastLayout;
    if (!c || !c.table || !Lo) { gesture = null; return; }
    const a = c.at, t = c.table;
    if (!g.moved) {
      snapshot();
      g.a0 = { x: +a.x || 0, y: +a.y || 0 };
      g.g0 = Lo.tableGeom(c);
      S.sel = { kind: 'note', ids: new Set([c.id]) };
      svgEl().classList.add('dragging');
    }
    g.moved = true;
    const dx = (e.clientX - g.x) / S.cam.k, dy = (e.clientY - g.y) / S.cam.k, g0 = g.g0, MIN = C.TBL_MIN;
    if (g.table.part === 'move') {
      const gs = gridOf(H()), free = e.ctrlKey || e.metaKey || !gs;
      // The table's corner snaps, wherever its part is.
      const ox = g0.x - g.a0.x, oy = g0.y - g.a0.y, snap = v => (free ? Math.round(v) : Math.round(v / gs) * gs);
      a.x = snap(g0.x + dx) - ox; a.y = snap(g0.y + dy) - oy;
    } else if (g.table.part === 'col') {
      const i = g.table.i, L = g0.cols[i - 1], R = g0.cols[i], left = L.x, right = R.x + R.w;
      const bx = Math.min(right - MIN, Math.max(left + MIN, R.x + dx));
      t.cols = t.cols.slice();
      t.cols[i - 1] = (bx - left) / g0.w;
      t.cols[i] = (right - bx) / g0.w;
    } else {
      t.w = Math.round(Math.max(MIN * t.cols.length, g0.w + dx));
      // Height: only what's dragged past the rows' text counts, so a sideways drag sets none.
      t.minH = 0;
      const textH = Lo.tableGeom(c).h, want = g0.h + dy;
      t.minH = want > textH + 2 ? Math.round(want) : 0;
    }
    renderCanvas();
  }
  // Pin a note where the click landed: on a connector or splice, a set, or a wire.
  function placeNote(t, g) {
    const h = H(), Lo = lastLayout, p = toWorld({ clientX: g.x, clientY: g.y });
    // Everything under the pointer, so a wire inside a set can be picked by its line: a connector
    // or splice first, then a wire's line, then a set.
    const els = document.elementsFromPoint(g.x, g.y), under = sel => els.map(e => e.closest && e.closest(sel)).find(Boolean);
    const hitW = els.find(e => e.classList && e.classList.contains('w-hit'));
    const nodeEl = under('[data-node]'), wireEl = hitW ? hitW.closest('[data-wire]') : t.closest('[data-wire]'), setEl = !wireEl && under('[data-set]');
    let at = null;
    if (nodeEl) { const it = Lo.itemOf.get(nodeEl.dataset.node); if (it) at = { kind: 'node', id: it.n.id, fx: (p.x - it.x) / (it.w || 1), fy: (p.y - it.y) / (it.h || 1) }; }
    else if (wireEl) { const w = M.wire(h, wireEl.dataset.wire); if (w) at = { kind: 'wire', id: w.id, t: Lo.wireT(w, p) }; }
    else if (setEl) { const gm = Lo.setGeom(setEl.dataset.set); if (gm) at = { kind: 'set', id: setEl.dataset.set, fx: (p.x - gm.x) / gm.w, fy: (p.y - gm.y) / gm.h }; }
    else if (wireEl) { const w = M.wire(h, wireEl.dataset.wire); if (w) at = { kind: 'wire', id: w.id, t: Lo.wireT(w, p) }; }
    if (!at) { toast('Click a wire, a set, or a connector to pin the note to.'); return; }
    S.placing = null;
    change(x => { const c = M.addNote(x, at); S.sel = { kind: 'note', ids: new Set([c.id]) }; });
  }
  function click(t, shift, g) {
    const h = H();
    if (S.placing === 'table') { placeTable(g); return; }
    if (S.placing) { placeNote(t, g); return; }
    const noteEl = t.closest('[data-note]');
    if (noteEl) { shift ? toggleSel('note', noteEl.dataset.note) : select('note', noteEl.dataset.note); return; }
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
    // A set's badge or area selects the set; shift-click adds its wires to the selection (or takes
    // them out), so a set and more wires can be bundled. Shift-click on a wire does the same for
    // it, and on a connector or splice adds the part (a mix, with wires).
    const badgeEl = t.closest('[data-set]'), wire = t.closest('[data-wire]');
    if (badgeEl) shift ? toggleSel('set', badgeEl.dataset.set) : select('set', badgeEl.dataset.set);
    else if (wire) shift ? toggleSel('wire', wire.dataset.wire) : select('wire', wire.dataset.wire);
    else if (nodeEl) shift ? toggleSel('node', nodeEl.dataset.node) : select('node', nodeEl.dataset.node);
    // A shift-click that misses keeps what's selected: it was meant to add to it.
    else if (!shift) select(null);
  }
  function finishWire(end) {
    const from = S.pending;
    S.pending = null;
    const w = change(h => M.addWire(h, from, end));
    // The new wire draws itself in from end to end (canvas only; Reduce Motion skips it in CSS).
    if (w && !reduceMotion()) { S.fresh = w.id; clearTimeout(S.freshT); S.freshT = setTimeout(() => { S.fresh = null; }, 900); }
    $('#ghost') && ($('#ghost').innerHTML = '');
    if (w) { S.sel = { kind: 'wire', ids: new Set([w.id]) }; renderAll(); toast(`${M.wireName(w)} added: ${M.endText(H(), w.from)} → ${M.endText(H(), w.to)}`); }
  }
  // The wire being drawn: an elastic curve from the pin to the cursor, in the color new wires get.
  // Over a free pin on another end (or a splice) it snaps onto it.
  function drawGhost(e) {
    if (!lastLayout) return;
    let p = toWorld(e), snapped = false;
    const pin = e.target.closest && e.target.closest('[data-pin]'), nodeEl = e.target.closest && e.target.closest('[data-node]');
    if (pin && !(pin.dataset.node === S.pending.node && pin.dataset.pin === S.pending.pin)) {
      const a2 = lastLayout.anchor({ node: pin.dataset.node, pin: pin.dataset.pin }, lastLayout.anchor(S.pending, p.x).x);
      if (a2.y != null) { p = a2; snapped = true; }
    } else if (nodeEl && !pin) {
      const it = lastLayout.itemOf.get(nodeEl.dataset.node);
      if (it && it.kind === 'splice') { p = { x: it.x + it.w / 2, y: it.y + it.sz.port0 }; snapped = true; }
    }
    const a = lastLayout.anchor(S.pending, p.x);
    if (a.y == null) return;
    const dx = Math.max(40, Math.abs(p.x - a.x) * 0.5), s = p.x >= a.x ? 1 : -1;
    // The curve leaves the pin level, as a wire would, and sags a little under its own weight.
    const sag = Math.min(60, Math.abs(p.x - a.x) * 0.08 + Math.abs(p.y - a.y) * 0.05);
    const d = `M${a.x} ${a.y}C${a.x + s * dx} ${a.y + sag} ${p.x - s * dx} ${p.y + sag} ${p.x} ${p.y}`;
    const c = M.colorInfo((H().defaults && H().defaults.color) || 'BK');
    $('#ghost').innerHTML = `<g class="ghost-w${snapped ? ' snapped' : ''}" style="color:${c.base || 'var(--cv-sel)'}"><path class="ghost-glow" d="${d}"/><path class="ghost-edge" d="${d}"/><path class="ghost-base" d="${d}"/><path class="ghost-flow" d="${d}"/>` +
      `<circle class="ghost-end" cx="${p.x}" cy="${p.y}" r="${snapped ? 5 : 3.5}"/></g>`;
  }
  // Wheel zoom about the cursor: only the viewBox changes.
  function onWheel(e) {
    e.preventDefault();
    cancelAnimationFrame(glideRaf);
    const p = toWorld(e), rc = svgEl().getBoundingClientRect();
    const k = Math.max(0.2, Math.min(4, S.cam.k * Math.exp(-e.deltaY * 0.0015)));
    S.cam = { k, x: p.x - (e.clientX - rc.left) / k, y: p.y - (e.clientY - rc.top) / k };
    setView();
  }
  // A new part lands in a blank area (Chris, 2026-11-08: they often landed on one already placed,
  // since the auto layout doesn't see dragged positions). Where the layout puts it clear of every
  // other part (GAP all round), it stays there; else it's placed (h.place) at the free spot on the
  // pitch nearest that, searched over the diagram and a part's width round it.
  function placeClear(h, id) {
    const Lo = C.layout(h, M.analyze(h)), it = Lo.itemOf.get(id);
    if (!it || !it.w) return;
    const GAP = 30, P = C.G.PITCH, port0 = it.sz.port0 || 0;
    const others = Lo.items.filter(i => i !== it && i.w > 0 && i.h > 0);
    if (!others.length) return;
    const hit = (x, y) => others.some(o => x < o.x + o.w + GAP && o.x < x + it.w + GAP && y < o.y + o.h + GAP && o.y < y + it.h + GAP);
    if (!hit(it.x, it.y)) return;
    const x0 = Math.min(...others.map(o => o.x)) - it.w - 2 * GAP, x1 = Math.max(...others.map(o => o.x + o.w)) + 2 * GAP;
    const y0 = Math.min(...others.map(o => o.y)) - it.h - 2 * GAP, y1 = Math.max(...others.map(o => o.y + o.h)) + 2 * GAP;
    let best = null;
    for (let gy = Math.ceil((y0 + port0) / P) * P; gy - port0 <= y1; gy += P) {
      for (let x = Math.ceil(x0 / P) * P; x <= x1; x += P) {
        const y = gy - port0;
        if (hit(x, y)) continue;
        const d = (x - it.x) ** 2 + (y - it.y) ** 2;
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (best) { h.place = h.place || {}; h.place['n:' + id] = { x: best.x, y: best.y, v: 3 }; }
  }
  function addEnd(kind) {
    change(h => {
      const n = kind === 'connector' ? M.addConnector(h, 0, 0, { family: 'jst-ph', pins: 4 }) : M.addNode(h, kind, 0, 0);
      placeClear(h, n.id);
      S.sel = { kind: 'node', ids: new Set([n.id]) };
    });
    S.cam = null;
    renderCanvas();
    if (kind === 'connector') toast('Added. Click one of its pins, then a pin on another end, to run a wire.');
  }

  // ── Copy and paste parts (Chris, 2026-11-09) ──
  // Right-click a connector or splice for Copy, and empty canvas (or a part) for Paste; Ctrl+C and
  // Ctrl+V do the same. A paste is an exact copy without wires under the next free designator
  // (M.copyPart, M.pastePart). Several selected parts copy together and keep their spacing. The
  // clipboard is this browser's (localStorage), so a part pastes into another harness or tab too.
  // A paste from the menu lands where it was opened, from Ctrl+V under the pointer, else clear of
  // every other part (placeClear).
  const CLIP_KEY = 'loom.clip';
  let clip = null, hoverPt = null, ctxEl = null;
  const isPart = n => !!n && (n.kind === 'connector' || n.kind === 'splice');
  function readClip() {
    let c = null;
    try { c = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); } catch (e) { /* storage blocked */ }
    c = c || clip;
    return c && c.parts && c.parts.length ? c : null;
  }
  function copyParts(ids) {
    const h = H(), Lo = lastLayout, parts = ids.map(id => M.node(h, id)).filter(isPart);
    if (!parts.length) return false;
    const at = n => { const it = Lo && Lo.itemOf.get(n.id); return it ? { x: it.x, y: it.y } : { x: n.x || 0, y: n.y || 0 }; };
    const o = at(parts[0]);
    clip = { v: 1, parts: parts.map(n => { const p = at(n); return { node: M.copyPart(n), dx: Math.round(p.x - o.x), dy: Math.round(p.y - o.y) }; }) };
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch (e) { /* storage blocked: kept for this page */ }
    toast(parts.length === 1 ? `Copied ${parts[0].ref}. Right-click the canvas to paste it.` : `Copied ${parts.length} parts. Right-click the canvas to paste them.`);
    return true;
  }
  function pasteParts(p) {
    const c = readClip();
    if (!c || !H()) return;
    const made = change(h => {
      const ns = c.parts.map(x => M.pastePart(h, x.node));
      if (p && !fold.prop) {
        const Lo = C.layout(h, M.analyze(h)), gs = gridOf(h), snap = v => (gs ? Math.round(v / gs) * gs : Math.round(v));
        h.place = h.place || {};
        ns.forEach((n, i) => {
          const it = Lo.itemOf.get(n.id), port0 = (it && it.sz && it.sz.port0) || 0;
          h.place['n:' + n.id] = { x: snap(p.x + c.parts[i].dx), y: snap(p.y + c.parts[i].dy + port0) - port0, v: 3 };
        });
      } else ns.forEach(n => placeClear(h, n.id));
      S.sel = { kind: 'node', ids: new Set(ns.map(n => n.id)) };
      return ns;
    });
    if (!made) return;
    toast(made.length === 1 ? `Pasted ${made[0].ref}, a copy of ${c.parts[0].node.ref} without its wires.` : `Pasted ${made.map(n => n.ref).join(', ')}, without their wires.`);
  }
  function closeCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
  // The right-click menu: a right press that didn't move (a drag pans). On a part it selects the
  // part (unless it's already in the selection) and offers to copy it, or every part selected.
  function openCtx(g) {
    closeCtx();
    const h = H();
    if (!h || S.view !== 'build' || S.placing) return;
    const nodeEl = g.t.closest && g.t.closest('[data-node]'), n = nodeEl ? M.node(h, nodeEl.dataset.node) : null;
    let ids = [];
    if (isPart(n)) {
      const P = selParts(S.sel);
      if (P.node.includes(n.id)) ids = P.node.filter(id => isPart(M.node(h, id)));
      else { S.sel = { kind: 'node', ids: new Set([n.id]) }; ids = [n.id]; renderAll(); }
    }
    const c = readClip(), at = toWorld({ clientX: g.x, clientY: g.y });
    const what = list => (list.length === 1 ? esc(list[0]) : list.length + ' parts');
    // On a wire or a set (arranged view; Chris, 2026-11-10): how its route treats the parts in its
    // way, walking round them or running straight past behind them, and Reset route once shaped.
    const wEl = !ids.length && !fold.prop && g.t.closest && (g.t.closest('[data-wire]') || g.t.closest('.cv-setarea'));
    const rkey = wEl && lastLayout ? (wEl.dataset.wire ? lastLayout.boxOfWire(wEl.dataset.wire) : lastLayout.boxOfSet(wEl.dataset.set)) : null;
    const routeItems = rkey ? LM.connect.menuHtml(h.routes && h.routes[rkey]) : '';
    const m = document.createElement('div');
    m.className = 'menu lm-ctx';
    m.setAttribute('role', 'menu');
    m.innerHTML = routeItems + (ids.length ? `<button data-ctx="copy" role="menuitem"><span>Copy ${what(ids.map(id => M.node(h, id).ref))}</span><span class="lm-ctx-k">Ctrl+C</span></button>` : '') +
      `<button data-ctx="paste" role="menuitem"${c ? '' : ' disabled'}><span>${c ? 'Paste ' + what(c.parts.map(x => x.node.ref)) + ' here' : 'Paste'}</span><span class="lm-ctx-k">Ctrl+V</span></button>` +
      (ids.length ? `<hr><button data-ctx="delete" role="menuitem"><span>Delete ${what(ids.map(id => M.node(h, id).ref))}</span><span class="lm-ctx-k">Del</span></button>` : '') +
      (!ids.length && !c && !rkey ? `<div class="lm-ctx-hint">Right-click a connector or splice to copy or delete it.</div>` : '');
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-ctx]');
      if (!b || b.disabled) return;
      closeCtx();
      const k = b.dataset.ctx;
      if (k === 'around' || k === 'behind' || k === 'reset-route') change(x => {
        x.routes = x.routes || {};
        const r = LM.connect.apply(x.routes[rkey], k);
        if (r) x.routes[rkey] = r; else delete x.routes[rkey];
      });
      else if (k === 'copy') copyParts(ids);
      // Delete the parts the menu names (Chris, 2026-11-11), as the Delete key does: one undo.
      else if (k === 'delete') change(x => { ids.forEach(id => M.removeNode(x, id)); S.sel = null; });
      else pasteParts(at);
    });
    m.addEventListener('contextmenu', e => e.preventDefault());
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(g.x, innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(g.y, innerHeight - r.height - 8)) + 'px';
    ctxEl = m;
    const first = m.querySelector('button:not([disabled])');
    if (first) first.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', e => { if (ctxEl && !ctxEl.contains(e.target)) closeCtx(); }, true);
  window.addEventListener('blur', closeCtx);
  window.addEventListener('resize', closeCtx);

  // ── Build: the right pane, with a Parts tab and a Properties tab ──
  // Parts holds only what can be added to the drawing; Properties shows the selection, or with nothing
  // selected, the harness's splices, notes, and wire sets to pick from (Chris, 2026-11-12). Any change of
  // selection, clearing it too, shows Properties.
  function renderParts() {
    const sel = S.sel, key = sel ? sel.kind + ':' + [...sel.ids].sort().join(',') : '';
    if (key !== S.paneSelKey) { S.paneSelKey = key; S.paneTab = 'props'; }
    const tab = S.paneTab === 'props' ? 'props' : 'parts';
    const tabs = `<div class="pane-tabs" role="tablist">${[['parts', 'Parts'], ['props', 'Properties']].map(([k, t]) =>
      `<button role="tab" class="pane-tab${k === tab ? ' on' : ''}" aria-selected="${k === tab}" data-act="pane-tab" data-tab="${k}">${t}</button>`).join('')}</div>`;
    const body = tab === 'props'
      ? `<div class="pane-props">${propsHtml() || overviewHtml()}</div>`
      : `<div class="pane-body">${partsHtml()}</div>`;
    // How it works (Chris): a ? button in the pane's bottom-right corner pops this card up over the
    // bottom of the pane, in either tab. Open until closed, remembered in this browser (fold.help).
    const open = fold.help !== false;
    const help = (open ? `<div class="pane-help" role="dialog" aria-label="How it works"><div class="hp-head"><b>How it works</b><button class="hp-close" data-act="help" title="Close" aria-label="Close">${ICON.close}</button></div>
        <p><i>●</i> Click a pin, then a pin on another end or a splice, to run a wire.</p>
        <p><i>⇧</i> Shift-click wires, then tick Twist or Shield, or pick Cable or Bundle, to make them a set. Sets nest: select a set and more wires to bundle them.</p>
        <p><i>◉</i> Click a set's badge, or inside it, to edit it. Drag a set's ends to shorten it or run it past what holds it.</p>
        <p><i>✎</i> Add › Note, then click a wire, set, or connector to pin a note. Drag its bubble; click it to edit.</p>
        <p><i>✥</i> Drag a part to move it; it snaps to the grid. Hold Ctrl to place it anywhere.</p>
        <p><i>⌐</i> Wires find their way round the parts. Drag a straight run of a wire or set sideways to shape it, and double-click one to add a bend.</p>
        <button class="btn hp-guide" data-act="guide">Take the guide: every feature, step by step</button></div>` : '') +
      `<button class="pane-help-btn${open ? ' on' : ''}" data-act="help" title="How it works" aria-label="How it works" aria-expanded="${open}">?</button>`;
    paint($('#parts-pane'), tabs + body + help);
  }
  // Redraw a panel, keeping the focused field and the scroll position.
  function paint(el, html) {
    const focus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.f : null;
    const sc = el.querySelector('.rail-list, .pane-body');
    const scroll = sc ? sc.scrollTop : 0, scKind = sc ? sc.className : '';
    el.innerHTML = html;
    const sc2 = el.querySelector('.rail-list, .pane-body');
    if (sc2 && sc2.className === scKind) sc2.scrollTop = scroll;
    if (focus) { const f2 = el.querySelector(`[data-f="${focus}"]`); if (f2) f2.focus(); }
  }
  // Properties with nothing selected: the splices, notes, and wire sets, each a row that selects it.
  function overviewHtml() {
    const h = H();
    const sel = id => selHas(S.sel, 'node', id);
    const splices = h.nodes.filter(n => n.kind === 'splice');
    let o = '';
    if (splices.length) {
      o += `<div class="side-head"><span class="side-label">Splices</span></div>`;
      o += splices.map(n => `<div class="lay${sel(n.id) ? ' on' : ''}" data-pick="node:${n.id}"><span class="lay-ico">${ICON.splice}</span><span class="nm"><b>${esc(n.ref)}</b></span></div>`).join('');
    }
    const notes = h.callouts || [];
    if (notes.length) {
      o += `<div class="side-head"><span class="side-label">Notes</span><span class="side-count">${notes.length}</span></div>`;
      o += notes.map(c => `<div class="lay${selHas(S.sel, 'note', c.id) ? ' on' : ''}" data-pick="note:${c.id}"><span class="lay-ico">${ICON.note}</span><span class="nm"><b>${esc(c.ref)}</b> ${esc(c.text || 'No text yet')}</span></div>`).join('');
    }
    const roots = M.roots(h);
    if (roots.length) {
      o += `<div class="side-head"><span class="side-label">Wire sets</span><span class="side-count">${h.sets.length}</span></div>`;
      o += roots.map(r => setTree(h, r, new Set(selParts(S.sel).set), false)).join('');
    }
    return o ? `<div class="pane-body">${o}</div>` : `<div class="pane-empty">Select a connector, splice, wire, or box on the canvas to see its properties here.</div>`;
  }
  // Parts: what can be added to the drawing.
  function partsHtml() {
    let o = '';
    o += `<div class="side-head"><span class="side-label">Add</span></div><div class="palette">
      <button data-act="add-conn">${ICON.conn}<span>Connector</span></button>
      <button data-act="from-board" title="A board connector from Signoff EE, with its pins and nets">${ICON.board}<span>From a board</span></button>
      <button data-act="add-splice">${ICON.splice}<span>Splice</span></button>
      <button data-act="add-note" title="A note or part pinned to a wire, set, or connector">${ICON.note}<span>Note</span></button>
      <button data-act="add-table" title="A table of text, placed anywhere on the drawing">${ICON.table}<span>Table</span></button></div>`;
    return o;
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
      o = head(signin ? 'Sign in to GitHub first' : "Couldn't read it", '', !!BM.boards) + `<div class="lm-modal-body"><p>${signin ? 'Loom reads board packages with the GitHub sign-in every Signoff tool in this browser shares. Sign in from Settings (the gear at the bottom of the menu), then try again.' : esc(BM.error)}</p>
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
    // Redrawing the same list (Add on a connector) keeps its scroll, so the next Add is where it was.
    const host = $('#board-modal-body'), key = BM.step + '|' + (BM.board ? BM.board.id : '');
    const was = host.querySelector('.lm-modal-body');
    const top = was && host.dataset.key === key ? was.scrollTop : 0;
    host.innerHTML = o;
    host.dataset.key = key;
    const now = host.querySelector('.lm-modal-body');
    if (now && top) now.scrollTop = top;
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
      // A harness with no client project yet takes its first board's.
      if (!h.project && b.client) h.project = b.client;
      placeClear(h, n.id);
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
  function lenField(h, A, ws, label) {
    const rs = ws.map(w => A.routes.get(w.id));
    if (rs.every(r => r && r.segs.length === 1 && r.segs[0] === rs[0].segs[0])) {
      const s = rs[0].segs[0];
      return fld(label || 'Length (mm)', inp('len.' + s.id, s.length, ' type="number" min="0" step="5" placeholder="Not set"'), s.length != null ? U.fmtLen(s.length) + ', connector face to face.' : 'Connector face to face.');
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
    const lo = M.node(h, String(cur).split('|')[0]);
    if (M.isLoose(lo)) o = opt(cur, 'Loose end', cur) + o;
    return o;
  }

  // The selection's properties, shown in the right pane's Properties tab ('' with nothing selected).
  function propsHtml() {
    const h = H(), A = M.analyze(h), sel = S.sel;
    if (!sel) return '';
    const P = selParts(sel), one = sel.ids.size === 1;
    if (sel.kind === 'node' && one) { const n = M.node(h, [...sel.ids][0]); return M.isConn(n) ? railConnector(h, A, n) : railJunction(h, A, n); }
    if (sel.kind === 'wire') return sel.ids.size > 1 ? railSet(h, A, null, [...sel.ids].map(id => M.wire(h, id))) : railWire(h, A, M.wire(h, [...sel.ids][0]));
    if (sel.kind === 'set' && one) { const st = M.set(h, [...sel.ids][0]); return railSet(h, A, st, M.wiresIn(h, st).map(id => M.wire(h, id))); }
    if (sel.kind === 'set') return railSets(h, A, P.set.map(id => M.set(h, id)).filter(Boolean));
    if (sel.kind === 'note' && one) return railNote(h, M.note(h, [...sel.ids][0]));
    return railMulti(h, A, P);
  }
  // The left rail is the harness. On a phone (narrow, or short when held sideways; styles.css) the
  // right pane is hidden and the rail is a sheet over the canvas showing the selection, else the
  // harness. Like Signoff's detail panel it pops up for a new selection (not while wiring) and
  // goes when the selection clears; the HUD's panel button and its close button toggle it.
  const PHONE = '(max-width: 860px), (max-height: 500px)';
  const narrow = () => window.matchMedia(PHONE).matches;
  function renderRail() {
    const h = H(), sel = S.sel, key = sel ? sel.kind + ':' + [...sel.ids].sort().join(',') : '';
    if (key !== S.sheetKey && !(S.pending && key)) { S.sheetKey = key; S.sheet = !!key; }
    $('#build-view').classList.toggle('sheet-open', !!S.sheet);
    paint($('#rail'), ((narrow() && propsHtml()) || railHarness(h, M.analyze(h))) +
      `<button class="sheet-close" data-act="sheet-close" title="Close" aria-label="Close">${ICON.close}</button>`);
  }
  const railHead = (eyebrow, title, extra) => `<div class="rail-head"><div class="eyebrow">${eyebrow}</div><div class="rail-title">${title}</div>${extra || ''}</div>`;

  function checkRows(h, list) {
    if (!list.length) return '<div class="rf-ok"><span class="dot ok"></span>No problems found.</div>';
    return list.map((c, i) => `<div class="rf" data-check="${i}"><span class="dot ${c.sev}"></span><div class="rf-t">${esc(c.text)}</div></div>`).join('');
  }
  // The client project, as on an EE board: Signoff PL offers the harness to every PL project of that
  // client project (its tray), and the PL Part made from it is the link. Suggestions are the PL
  // projects and the boards' client projects. Under it, where PL has placed it.
  function projectField(h) {
    const pl = !DEMO && R ? R.pl() : null;
    const names = new Set();
    (pl ? pl.projects : []).forEach(p => names.add(p.clientProject || p.name));
    h.nodes.forEach(n => { if (n.board && n.board.client) names.add(n.board.client); });
    const parts = (pl && pl.links[h.id]) || [];
    // Started from a waiting PL Part that PL hasn't linked yet.
    const waitFor = !parts.length && h.plPart && pl ? (pl.planned || []).find(p => p.project === h.plPart.project && p.node === h.plPart.node) : null;
    const placed = parts.length ? `<div class="pl-links">${parts.map(p => `<div class="pl-link"><span class="lay-ico">${ICON.harness}</span><div><b>${esc(p.projectName)}</b><div class="f-hint">${esc(p.path.concat(p.name).join(' › '))}</div></div></div>`).join('')}</div>` : '';
    // A harness shared from Signoff PL lives in its own private repo (signoff_pl/docs/sharing.md).
    const shared = !DEMO && R && R.isShared(h.id) ? `<div class="f-hint">Shared: kept in ${esc(R.homeOf(h.id))}, with the people the product is shared with.</div>` : '';
    // Chris: say what the field does, not how PL matches it.
    const what = 'The client project this harness is for. Once it’s set, the harness shows up in that project in Signoff PL, ready to add to the product.';
    const hint = DEMO ? what
      : !pl ? what + ' Sync to load Signoff PL’s projects.'
      : parts.length ? 'In Signoff PL as a Part of:'
      : waitFor ? `Started from ${waitFor.projectName}’s Part in Signoff PL${waitFor.path.length ? ' (' + waitFor.path.join(' › ') + ')' : ''}. PL links it to that Part at its next sync, once this harness has synced.`
      : h.plPart && pl && !pl.planned ? 'Started from a Part in Signoff PL. PL links it to that Part at its next sync, once this harness has synced.'
      : h.project ?'Waiting in that project in Signoff PL: add it there to place it in the product.' : what;
    return fld('Project', `<input class="input" data-f="h.project" list="lm-projects" value="${esc(h.project || '')}" placeholder="Client project">` +
      `<datalist id="lm-projects">${[...names].sort().map(n => `<option value="${esc(n)}">`).join('')}</datalist>`, hint) + placed + shared;
  }
  function railHarness(h, A) {
    const c = M.checks(h, A);
    const total = h.wires.reduce((t, w) => t + (A.wireLen.get(w.id) || 0), 0);
    return railHead('Harness', esc(h.title), `<div class="chips"><span class="chip">${h.nodes.filter(M.isConn).length} ends</span><span class="chip">${h.wires.length} wires</span><span class="chip">${U.fmtMeters(total)} of wire</span></div>`) +
      `<div class="rail-list"><div class="rail-sec">
      ${fld('Title', inp('h.title', h.title))}
      <div class="row2">${fld('Part number', inp('h.pn', h.pn, ' placeholder="2100430-001"'))}${fld('Rev', inp('h.rev', h.rev))}</div>
      ${projectField(h)}
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
    // Custom is offered once Configure has drawn one; switching away keeps its drawing.
    const famSel = `<select class="input" data-f="n.family">${groups.filter(g => g !== 'Custom' || n.custom).map(g => `<optgroup label="${g}">${L.FAMILIES.filter(f => f.group === g).map(f => opt(f.id, f.style === 'custom' ? 'Custom: ' + L.kindName(Object.assign({}, n, { family: 'custom' })) : f.name, n.family)).join('')}</optgroup>`).join('')}</select>`;
    const pins = L.pinChoices(fam);
    const fromBoard = Array.isArray(n.pinNames) && n.pinNames.length;
    const pinSel = fromBoard ? `<div class="input ro">${n.pinNames.length} from the board</div>`
      : fam.style === 'custom' ? `<button class="input ro cfg-ro" data-act="configure" title="Set in Configure">${n.pins} positions</button>`
      : `<select class="input" data-f="n.pins"${pins.length < 2 ? ' disabled' : ''}>${pins.map(p => opt(p, p + (fam.style === 'flying' ? ' leads' : ' pins'), n.pins)).join('')}</select>`;
    const others = h.nodes.filter(x => M.isConn(x) && x.id !== n.id);
    const wired = h.wires.filter(w => w.from.node === n.id || w.to.node === n.id).length;
    const housing = L.hasHousing(fam);
    const sugg = matchRows(h, n);
    const boardBox = n.board ? `<div class="board-src"><span class="lay-ico">${ICON.board}</span><div><b>${esc(n.board.name)} ${esc(n.board.ref)}</b><div class="f-hint">${esc(n.board.source)}${n.board.mpn ? ' · board part ' + esc(n.board.mpn) : ''}. Pins and labels come from its netlist.</div></div></div>` : '';
    const suggBox = sugg.length ? `<div class="cat-label">Suggested wires</div><div class="rail-sec">${sugg.map(r => `<div class="sugg"><div><b>${r.pairs.length} pin${r.pairs.length > 1 ? 's' : ''} match ${esc(r.other.ref)}</b><div class="f-hint">${esc([...new Set(r.pairs.map(p => p.label))].slice(0, 6).join(', '))}${new Set(r.pairs.map(p => p.label)).size > 6 ? '…' : ''}</div></div><button class="btn" data-act="match-wire" data-a="${n.id}" data-b="${r.other.id}">Wire them</button></div>`).join('')}<p class="f-hint">Same net name on both ends, on pins with no wire yet. Check each against the boards.</p></div>` : '';
    // Where this end plugs in, in any system (assets/system.js).
    const plugs = LM.system.plugsOf(h.id, n.id);
    const plugBox = plugs.length ? `<div class="board-src sys-plugs"><span class="lay-ico">${ICON.system}</span><div>${plugs.map(p => `<div>Plugs into <button class="sys-link" data-open-sys="${p.system.id}">${esc(p.text)}</button></div>`).join('')}</div></div>` : '';
    return railHead('Connector', `<span class="mono-ref">${esc(n.ref)}</span> ${esc(n.name || L.kindName(n))}`, `<button class="btn cfg-open" data-act="configure" title="Name, type, and a custom face drawing">${ICON.sliders}Configure</button>`) +
      `<div class="rail-list">${boardBox}${plugBox}${suggBox}<div class="face-tile" data-act="configure" title="Configure">${LM.shapes.faceSvg(h, n, 330, 150)}<span class="face-note">${esc(LM.shapes.fitViews(h, n, 0, 0, 330, 150).note)}</span></div>
      <div class="rail-sec">
      ${LM.shapes.hasBack(n) ? fld('Views', segBtns('n.faceView', LM.shapes.views(n).length > 1 ? 'both' : LM.shapes.views(n)[0], [['front', 'Front'], ['back', 'Back'], ['both', 'Both']]), 'Front is the mating face, back the wire side. The drawing prints these.') : ''}
      <div class="row2 r-ref">${fld('Ref', inp('n.ref', n.ref))}${fld('Name', inp('n.name', n.name, ' placeholder="Main PCBA J1"'))}</div>
      ${fld('Family', famSel, fam.awg ? `Terminals typically take ${fam.awg[0]}–${fam.awg[1]} AWG.` : '')}
      <div class="row2">${fld(fam.style === 'flying' ? 'Leads' : 'Pins', pinSel)}${fam.rows && fam.rows.length > 1 ? fld('Rows', segBtns('n.rows', n.rows, [[1, '1'], [2, '2']])) : ''}</div>
      ${housing ? fld('Gender', segBtns('n.gender', n.gender, [['receptacle', 'Receptacle'], ['plug', 'Plug']])) : ''}
      ${fld(housing ? 'Housing part number' : 'Part number', inp('n.mpn', n.mpn, ` placeholder="${esc(L.suggestHousing(n) || 'Manufacturer part number')}"`), housing && L.suggestHousing(n) && !n.mpn ? 'Suggested from the series; check the datasheet.' : '')}
      ${housing ? fld('Terminal part number', inp('n.terminal', n.terminal)) : ''}
      ${fld('Mates with', inp('n.mate', n.mate, ' placeholder="Board header or mating part"'))}
      ${fld('In a system', segBtns('n.atDevice', n.atDevice ? '1' : '', [['', 'Plugs in'], ['1', 'Is its device']]), n.atDevice ? 'This end is the device the harness is built onto (a motor, sensor, or flying leads), so a system doesn’t plug it into anything.' : 'A system plugs this end into a block’s connector.')}
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
  // Reset route: forget how the routes of these wires were shaped by hand, so they route themselves
  // again (arranged view). An empty cell when none was shaped.
  function resetRouteBtn(h, ws) {
    const Lo = lastLayout, keys = !fold.prop && Lo && h.routes ? [...new Set(ws.map(w => Lo.boxOfWire(w.id)))].filter(k => k && h.routes[k]) : [];
    return keys.length ? `<button class="btn" data-act="reset-route" data-keys="${esc(keys.join(' '))}" title="Forget how this route was shaped, and let it find its own way">Reset route</button>` : '<span></span>';
  }
  function railWire(h, A, w) {
    const gs = A.setsOf.get(w.id);
    return railHead('Wire', `<span class="mono-ref">${M.wireName(w)}</span> ${esc(w.signal || '')}`, `<div class="chips"><span class="chip">${U.fmtLen(A.wireLen.get(w.id))}</span>${gs.map(g => `<button class="chip g-chip g-${setKind(g)}" data-pick="set:${g.id}" title="${esc(M.setWord(g))}">${esc(g.label)}</button>`).join('')}</div>`) +
      `<div class="rail-list"><div class="rail-sec">
      <div class="row2">${fld('From', `<select class="input" data-f="w.from">${endOptions(h, w.from.node + '|' + (w.from.pin || ''))}</select>`)}${fld('To', `<select class="input" data-f="w.to">${endOptions(h, w.to.node + '|' + (w.to.pin || ''))}</select>`)}</div>
      ${fld('Signal', inp('w.signal', w.signal, ' placeholder="e.g. I2C_SDA"'))}
      ${fld('Color', colorSelects('w.color', w.color))}
      ${fld('Gauge', gaugeSelect('w.gauge', w.gauge))}
      ${lenField(h, A, [w])}
      <div class="cat-label">Sets</div>
      ${gs.length ? wireSetChain(h, w, gs) : ''}
      <p class="f-hint">${gs.length ? 'Click a set to select it. ' : ''}Shift-click other wires to make a set with this one: twisted, shielded, a cable, or a bundle.</p>
      </div><div class="rail-actions">${resetRouteBtn(h, [w])}<button class="btn btn-danger" data-act="delete">${ICON.trash}Delete ${M.wireName(w)}</button></div></div>`;
  }
  // A note: its text, and a part number and quantity when it stands for a part (the BOM lists it).
  // A table's Properties: its row and column counts, and every cell's text in a grid like the table.
  function railTable(h, c) {
    const t = c.table, nR = t.cells.length, nC = t.cols.length;
    const grid = `<div class="tbl-grid" style="--cols:${t.cols.map(fr => `minmax(0, ${Math.max(0.5, fr * nC).toFixed(3)}fr)`).join(' ')}">` +
      t.cells.map((row, r) => row.map((v, k) => `<textarea class="input tbl-cell" rows="2" data-f="tbl.cell.${r}.${k}" aria-label="Row ${r + 1}, column ${k + 1}">${esc(v)}</textarea>`).join('')).join('') + '</div>';
    return railHead('Table', `<span class="mono-ref">${esc(c.ref)}</span> · ${nR} × ${nC}`) +
      `<div class="rail-list"><div class="rail-sec">
      <div class="f-label">Size</div>
      <div class="row2">${fld('Rows', inp('tbl.rows', nR, ' type="number" min="1" max="50" step="1"'))}${fld('Columns', inp('tbl.cols', nC, ' type="number" min="1" max="20" step="1"'))}</div>
      <p class="f-hint">Fewer rows or columns drops the last ones and their text.</p>
      </div><div class="rail-sec">
      <div class="f-label">Cells</div>${grid}
      <p class="f-hint">Text wraps in its column, and each row grows to fit. On the canvas, drag the table to move it, an inner column line to resize those columns, and its bottom-right corner to resize it. Double-click a cell to edit it here.</p>
      </div><div class="rail-actions"><span></span><button class="btn btn-danger" data-act="delete">${ICON.trash}Delete ${esc(c.ref)}</button></div></div>`;
  }
  function railNote(h, c) {
    if (!c) return '';
    if (c.table) return railTable(h, c);
    const a = c.at || {}, area = a.kind === 'area';
    const on = area ? 'an area' : a.kind === 'node' ? M.label(M.node(h, a.id)) : a.kind === 'set' ? (M.set(h, a.id) || {}).label : M.wire(h, a.id) ? M.wireName(M.wire(h, a.id)) : '?';
    return railHead('Note', `<span class="mono-ref">${esc(c.ref)}</span> on ${esc(on || '?')}`) +
      `<div class="rail-list"><div class="rail-sec">
      ${fld('Text', `<textarea class="input" rows="4" data-f="note.text" placeholder="Label with the ref, 25 mm from the housing">${esc(c.text || '')}</textarea>`,
        area ? 'Drag its bubble to move it. Drag the area by its edge, resize it by its corners, and slide its dot along the edge.' : 'Drag its bubble on the canvas to move it.')}
      <div class="row2">${fld('Part number', inp('note.pn', c.pn, ' placeholder="Optional"'))}${fld('Qty', inp('note.qty', c.qty || 1, ' type="number" min="1" step="1"'))}</div>
      <p class="f-hint">With a part number, it's listed in the BOM.</p>
      </div><div class="rail-actions"><span></span><button class="btn btn-danger" data-act="delete">${ICON.trash}Delete ${esc(c.ref)}</button></div></div>`;
  }
  // A set's automatic label: its own when it already is one (TP3), else the next free one.
  const autoLabel = (h, st) => {
    const p = M.setPrefix(st);
    return new RegExp('^' + p + '\\d+$').test(st.label) ? st.label : M.nextRef(Object.assign({}, h, { sets: h.sets.filter(x => x !== st) }), p);
  };
  // A set's chip color: what holds it, else what it is.
  const setKind = st => (st.cable ? 'cable' : st.bundle ? 'bundle' : st.twist ? 'twist' : 'shield');
  // A set and the sets inside it, as an indented tree; each line selects its set. on: the line to
  // mark.
  // edit: the Parts tab's tree, where the selected set's row has an Edit button for its properties.
  function setTree(h, root, on, edit) {
    const isOn = id => (on instanceof Set ? on.has(id) : id === on);
    const line = (st, d) => `<button class="st-row${isOn(st.id) ? ' on' : ''}" data-pick="set:${st.id}" style="--d:${d}">` +
      `<span class="g-chip g-${setKind(st)}">${esc(st.label)}</span><span class="st-name">${esc(M.setWord(st))}${M.setTraits(st) ? ', ' + esc(M.setTraits(st)) : ''}</span>` +
      `<span class="st-n">${M.wiresIn(h, st).length} wires</span>` +
      (edit && isOn(st.id) && on.size === 1 ? `<span class="st-edit" role="button" data-act="edit-set" title="Edit ${esc(st.label)} in Properties">Edit</span>` : '') + `</button>` +
      st.sets.map(id => M.set(h, id)).filter(Boolean).map(c => line(c, d + 1)).join('');
    return `<div class="set-tree">${line(root, 0)}</div>`;
  }
  // A set in words, for a wire's Properties: what it is ("Shielded twisted pair", "Cable, shielded"),
  // then what it holds and, for a cable or shield, its description and part number.
  function setDesc(h, st) {
    const nW = M.wiresIn(h, st).length, nS = st.sets.length;
    let what;
    if (st.cable || st.bundle) what = M.setWord(st) + (M.setTraits(st) ? ', ' + M.setTraits(st) : '');
    else if (st.twist) what = (st.shield ? 'Shielded twisted ' : 'Twisted ') + (nW === 2 ? 'pair' : nW === 3 ? 'triple' : 'set');
    else what = 'Shielded set';
    const holds = `${nW} wire${nW === 1 ? '' : 's'}${nS ? `, ${nS} set${nS === 1 ? '' : 's'} inside` : ''}`;
    const extra = [st.note, st.pn && 'PN ' + st.pn].filter(Boolean).join(' · ');
    return { what, detail: holds + (extra ? ' · ' + extra : '') };
  }
  // The sets a wire sits in, outermost first, as an indented chain ending in the wire itself.
  function wireSetChain(h, w, gs) {
    const rows = gs.map((st, d) => {
      const t = setDesc(h, st);
      return `<button class="st-row st-desc" data-pick="set:${st.id}" style="--d:${d}" title="Select ${esc(st.label)}">` +
        `<span class="g-chip g-${setKind(st)}">${esc(st.label)}</span>` +
        `<span class="st-text"><span class="st-what">${esc(t.what)}</span><span class="st-detail">${esc(t.detail)}</span></span></button>`;
    }).join('');
    const leaf = `<div class="st-row st-leaf on" style="--d:${gs.length}"><span class="chip">${esc(M.wireName(w))}</span>` +
      `<span class="st-name">This wire${w.signal ? ', ' + esc(w.signal) : ''}</span></div>`;
    return `<div class="set-tree">${rows}${leaf}</div>`;
  }
  const FLAG_TEXT = { twist: ['Twist', 'Twisted together'], shield: ['Shield', 'A braided shield around them'], cable: ['Cable', 'Bought as one cable, in a jacket'], bundle: ['Bundle', 'Laced together'] };
  // A set, or several wires that aren't one (st null). Ticking a property on loose wires makes them
  // a set, taking in any set wholly inside the selection, so a bundle can hold a twisted pair.
  // Cable and Bundle exclude each other; unticking the last property dissolves the set.
  // How much a set covers: how far each end runs past what holds it (an outermost set: its wires'
  // ends; a nested one: its parent's ends; negative stops inside), which dragging its ends on the
  // canvas also sets, and the total.
  function coversField(h, A, st, run) {
    const p = M.parentOf(h, st.id), o = M.ov(st), total = M.setLength(h, A, st);
    const base = p ? M.setLength(h, A, p) : run, of = p ? `${esc(p.label)}'s` : "the wires'";
    const sum = `${of} ${base} mm${o.l ? (o.l > 0 ? ' + ' : ' − ') + Math.abs(o.l) + ' left' : ''}${o.r ? (o.r > 0 ? ' + ' : ' − ') + Math.abs(o.r) + ' right' : ''}`;
    return `<div class="row2">${fld(p ? `Past ${esc(p.label)}, left (mm)` : 'From the wire ends, left (mm)', inp('set.over.l', o.l, ' type="number" step="5"'))}${fld('Right (mm)', inp('set.over.r', o.r, ' type="number" step="5"'))}</div>` +
      `<div class="f-hint">${total == null ? (p ? `Set ${esc(p.label)}'s length to see this one's.` : 'Set the wire length to see how much it covers.') : `Covers ${esc(U.fmtLen(total))}: ${sum}.`} ` +
      `${p ? 'Negative stops inside.' : 'Negative stops short of the wire ends.'} Drag its ends on the canvas to set these.</div>`;
  }
  function railSet(h, A, st, ws) {
    const ids = ws.map(w => w.id);
    const why = st ? '' : M.whyNot(h, ids), m = st ? null : M.membersFor(h, ids);
    const nW = st ? st.wires.length : m.wires.length, nS = st ? st.sets.length : m.sets.length;
    const noCable = why ? '' : M.noCable(h, st, m);
    const can = { twist: nW >= 2 && !nS, shield: true, cable: !noCable, bundle: nW + nS >= 2 };
    // Twist and Shield are tick boxes; Cable and Bundle are one choice, either or neither (Chris:
    // make the mutual exclusion plain), drawn as radio buttons: None, Cable, Bundle.
    const ticks = ['twist', 'shield'].map(k => {
      const on = !!(st && st[k]), off = !!why || (!on && !can[k]);
      const tip = k === 'twist' && !can.twist && !why ? 'Only wires twist: a set of two or more wires with no set inside it' : FLAG_TEXT[k][1];
      return `<button class="tick${on ? ' on' : ''}" data-act="set-flag" data-flag="${k}" aria-pressed="${on}" title="${esc(tip)}"${off ? ' disabled' : ''}><span class="tick-box"></span>${FLAG_TEXT[k][0]}</button>`;
    }).join('');
    const held = st ? M.holderOf(st) || 'none' : 'none';
    const holders = [['none', 'None', 'Neither a cable nor a bundle'], ['cable', 'Cable', noCable ? "Can't be a cable: " + noCable : FLAG_TEXT.cable[1]], ['bundle', 'Bundle', FLAG_TEXT.bundle[1]]].map(([k, t, tip]) => {
      const on = held === k, off = !!why || (!on && k !== 'none' && !can[k]) || (!st && k === 'none');
      return `<button class="hold${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-act="set-holder" data-holder="${k}" title="${esc(tip)}"${off ? ' disabled' : ''}><span class="hold-dot"></span>${t}</button>`;
    }).join('');
    const run = st ? M.spanLength(A.spans.get(st.id) || []) : null;
    // The label edits in place (Chris: subtle): it reads as the title until hovered, and clearing it
    // brings back the automatic one (TP3, C1...).
    const auto = st ? autoLabel(h, st) : '';
    const tip = `Rename ${esc(st ? st.label : '')}${st && auto !== st.label ? `. Clear it to go back to ${esc(auto)}` : ''}`;
    const head = st ? `<input class="title-edit" id="lm-title-edit" data-f="set.label" value="${esc(st.label)}" placeholder="${esc(auto)}" size="${Math.max(2, st.label.length)}" spellcheck="false" autocomplete="off" aria-label="Set label" title="${tip}"> ${ws.length} wires<label class="title-pen" for="lm-title-edit" title="${tip}">${ICON.pencil}</label>` : `${ws.length} wires selected`;
    return railHead('Wire set', head, `<div class="chips">${ws.map(w => `<span class="chip">${M.wireName(w)}</span>`).join('')}</div>`) +
      `<div class="rail-list"><div class="rail-sec">
      <div class="tick-row">${ticks}</div>
      <div class="hold-row"><span class="hold-label">Held as</span><div class="hold-seg" role="radiogroup" aria-label="Held as">${holders}</div></div>
      <p class="f-hint">${why ? esc(why) : st ? esc(M.setWord(st)) + (M.setTraits(st) ? ', ' + esc(M.setTraits(st)) : '') + '.' : 'Tick one to make these wires a set.'}${noCable && held !== 'cable' ? " Can't be a cable: " + esc(noCable) : ''}</p>
      ${st && (st.cable || st.shield) ? fld('Description', inp('set.note', st.note, ` placeholder="${st.cable ? '2 x 26 AWG, PVC jacket' : 'Tinned copper braid'}"`)) + fld('Part number', inp('set.pn', st.pn)) : ''}
      ${lenField(h, A, ws, 'Wire length (mm)')}
      ${st ? coversField(h, A, st, run) : ''}
      ${fld('Set color', colorSelects('ws.color', ''))}
      ${st ? `<div class="f-label">Hierarchy</div>${setTree(h, M.setChain(h, st)[0], st.id)}` : ''}
      </div><div class="rail-actions">${resetRouteBtn(h, ws)}${st
        ? `<button class="btn btn-danger" data-act="delete" title="Removes the set. Its wires and any sets inside it stay.">${ICON.trash}Delete ${esc(st.label)}</button>`
        : `<button class="btn btn-danger" data-act="delete">${ICON.trash}Delete ${ws.length} wires</button>`}</div></div>`;
  }

  // Several sets at once (a marquee over whole sets, or shift-clicks). Chris (2026-11-07): options
  // scoped to the selection. Twist, Shield, and Held as apply to each set (a tick is half on when
  // only some have it), Set color to all their wires, and Together makes one bundle or cable of
  // all of them (as selecting their wires and picking it would). One set's label, part number
  // and lengths are edited on its own: click its chip.
  function railSets(h, A, sts) {
    const ids = [...new Set(sts.flatMap(st => M.wiresIn(h, st)))];
    const ticks = ['twist', 'shield'].map(k => {
      const have = sts.filter(st => st[k]).length, on = have === sts.length, part = have > 0 && !on;
      return `<button class="tick${on ? ' on' : part ? ' part' : ''}" data-act="set-flag" data-flag="${k}" aria-pressed="${on ? 'true' : part ? 'mixed' : 'false'}" title="${esc(FLAG_TEXT[k][1])}, each set${part ? ' (some are)' : ''}"><span class="tick-box"></span>${FLAG_TEXT[k][0]}</button>`;
    }).join('');
    const helds = sts.map(st => M.holderOf(st) || 'none'), held = helds.every(x => x === helds[0]) ? helds[0] : null;
    const holders = [['none', 'None', 'Neither a cable nor a bundle'], ['cable', 'Cable', FLAG_TEXT.cable[1]], ['bundle', 'Bundle', FLAG_TEXT.bundle[1]]].map(([k, t, tip]) =>
      `<button class="hold${held === k ? ' on' : ''}" role="radio" aria-checked="${held === k}" data-act="set-holder" data-holder="${k}" title="${esc(tip)}, each set"><span class="hold-dot"></span>${t}</button>`).join('');
    const why = M.whyNot(h, ids), m = why ? null : M.membersFor(h, ids), noCable = why ? '' : M.noCable(h, null, m);
    const together = `<div class="hold-row"><span class="hold-label">Together</span><div class="hold-seg">` +
      `<button class="hold" data-act="set-flag" data-flag="bundle" data-together="1" title="${esc(why || 'One bundle holding all of these sets')}"${why ? ' disabled' : ''}><span class="hold-dot"></span>Bundle</button>` +
      `<button class="hold" data-act="set-flag" data-flag="cable" data-together="1" title="${esc(why || (noCable ? "Can't be a cable: " + noCable : 'One cable holding all of these sets'))}"${why || noCable ? ' disabled' : ''}><span class="hold-dot"></span>Cable</button></div></div>`;
    return railHead('Wire sets', `${sts.length} sets selected`, `<div class="chips">${sts.map(st => `<button class="chip g-chip g-${setKind(st)}" data-pick="set:${st.id}" title="Just ${esc(st.label)}">${esc(st.label)}</button>`).join('')}</div>`) +
      `<div class="rail-list"><div class="rail-sec">
      <div class="f-label">Each set</div>
      <div class="tick-row">${ticks}</div>
      <div class="hold-row"><span class="hold-label">Held as</span><div class="hold-seg" role="radiogroup" aria-label="Held as">${holders}</div></div>
      <p class="f-hint">Applies to each of the ${sts.length} sets. Click a chip above to edit one set's label, part number, and lengths.</p>
      ${together}
      <p class="f-hint">${why ? esc(why) : 'One set holding all of them, with these sets inside it.'}</p>
      ${fld('Set color', colorSelects('ws.color', ''))}
      </div><div class="rail-actions"><span></span><button class="btn btn-danger" data-act="delete" title="Removes the sets. Their wires and any sets inside them stay.">${ICON.trash}Delete ${sts.length} sets</button></div></div>`;
  }
  // Things of several kinds at once (a marquee, or shift-clicks across kinds), or several parts or
  // notes: what's selected, by kind, with a chip each to narrow to it. Dragging any of them on the
  // canvas moves them all, and Delete deletes them all. The wire set options need a selection of
  // only wires or only sets, so where the mix has wires or sets they're shown off.
  function railMulti(h, A, P) {
    const groups = [
      ['Connectors and splices', P.node.map(id => M.node(h, id)).filter(Boolean).map(n => `<button class="chip" data-pick="node:${n.id}" title="Just ${esc(n.ref)}">${esc(n.ref)}</button>`)],
      ['Wires', P.wire.map(id => M.wire(h, id)).filter(Boolean).map(w => `<button class="chip" data-pick="wire:${w.id}" title="Just ${esc(M.wireName(w))}">${esc(M.wireName(w))}</button>`)],
      ['Wire sets', P.set.map(id => M.set(h, id)).filter(Boolean).map(st => `<button class="chip g-chip g-${setKind(st)}" data-pick="set:${st.id}" title="Just ${esc(st.label)}">${esc(st.label)}</button>`)],
      ['Notes', P.note.map(id => M.note(h, id)).filter(Boolean).map(c => `<button class="chip" data-pick="note:${c.id}" title="Just ${esc(c.ref)}">${esc(c.ref)}</button>`)],
    ].filter(g => g[1].length);
    const n = groups.reduce((a, g) => a + g[1].length, 0), wiry = P.wire.length || P.set.length;
    const offTip = 'Select only wires, or only sets, to use this';
    const off = ['twist', 'shield'].map(k => `<button class="tick" disabled title="${offTip}"><span class="tick-box"></span>${FLAG_TEXT[k][0]}</button>`).join('');
    const held = ['None', 'Cable', 'Bundle'].map(t => `<button class="hold" role="radio" aria-checked="false" disabled title="${offTip}"><span class="hold-dot"></span>${t}</button>`).join('');
    return railHead('Selection', `${n} items selected`) +
      `<div class="rail-list"><div class="rail-sec">
      ${groups.map(([t, chips]) => `<div class="f-label">${t}</div><div class="chips">${chips.join('')}</div>`).join('')}
      <p class="f-hint">Drag any of them on the canvas to move them all. Click a chip to work on just that one.</p>
      ${wiry ? `<div class="f-label">Wire set</div>
      <div class="tick-row">${off}</div>
      <div class="hold-row"><span class="hold-label">Held as</span><div class="hold-seg" role="radiogroup" aria-label="Held as">${held}</div></div>
      <p class="f-hint">The wire set options need a selection of only wires, or only sets.</p>` : ''}
      </div><div class="rail-actions"><span></span><button class="btn btn-danger" data-act="delete">${ICON.trash}Delete ${n} items</button></div></div>`;
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
        else {
          // Name and part number also show in Signoff PL, and can be edited there: the newer edit
          // wins, by identAt (assets/store.js, adoptFromPl).
          if ((k === 'title' || k === 'pn') && String(h[k] || '') !== String(v)) h.identAt = new Date().toISOString();
          h[k] = k === 'project' ? String(v).trim() : v;
        }
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
        else if (k === 'atDevice') { if (v === '1') n.atDevice = true; else delete n.atDevice; }
        else n[k] = v;
        if (k === 'family' || k === 'rows') L.conform(n);
        if (Array.isArray(n.pinNames) && n.pinNames.length) n.pins = n.pinNames.length; // board pins stay
      } else if (f.startsWith('s.')) {
        const s = M.seg(h, one()), k = f.slice(2);
        s[k] = k === 'length' ? (v === '' ? null : Math.max(0, Math.round(+v))) : v;
      } else if (f.startsWith('tbl.')) {
        const c = M.note(h, one()), k = f.slice(4);
        if (!c || !c.table) return;
        if (k === 'rows') M.sizeTable(c, v, c.table.cols.length);
        else if (k === 'cols') M.sizeTable(c, c.table.cells.length, v);
        else { const [, r, col] = k.split('.'); if (c.table.cells[r]) c.table.cells[r][col] = v; }
      } else if (f.startsWith('note.')) {
        const c = M.note(h, one()), k = f.slice(5);
        if (!c) return;
        c[k] = k === 'qty' ? Math.max(1, Math.round(+v || 1)) : v;
      } else if (f.startsWith('set.')) {
        const st = M.set(h, one()), k = f.slice(4);
        if (!st) return;
        if (k === 'length') st.length = v === '' ? null : Math.max(0, Math.round(+v));
        else if (k === 'over.l' || k === 'over.r') M.setEnd(h, st.id, k.slice(5), Math.round(+v || 0));
        else if (k === 'label') st.label = v.trim() || autoLabel(h, st);
        else st[k] = v;
      } else if (f.startsWith('w.') || f.startsWith('w:') || f.startsWith('ws.')) {
        let ids, k;
        if (f.startsWith('w:')) { const m = /^w:([^.]+)\.(.+)$/.exec(f); ids = [m[1]]; k = m[2]; }
        else { ids = selWireIds(h, sel); k = f.slice(f.indexOf('.') + 1); }
        ids.map(id => M.wire(h, id)).forEach(w => {
          if (k === 'from' || k === 'to') { const [node, pin] = v.split('|'); M.moveEnd(h, w.id, k, { node, pin: pin || null }); }
          else if (k === 'fromText' || k === 'toText') { const e = M.parseEnd(h, v); if (e) M.moveEnd(h, w.id, k.slice(0, -4), e); else toast(`"${v}" isn't an end in this harness. Use a ref and pin, like P1.3.`, 'error'); }
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
  // Print page (Chris, 2026-11-11: 11 × 17 and landscape). A page that sets @page's size hides the
  // print dialog's Layout, so Loom sets it only when one is picked here: by default the dialog
  // chooses both. Kept in this browser.
  const PAPER = [['', 'Paper: set in the print dialog'], ['a4', 'A4 (210 × 297 mm)', '210mm 297mm'], ['a3', 'A3 (297 × 420 mm)', '297mm 420mm'],
    ['letter', 'Letter (8.5 × 11 in)', '8.5in 11in'], ['tabloid', 'Tabloid (11 × 17 in)', '11in 17in']];
  const ORIENT = [['', 'Orientation: set in the print dialog'], ['portrait', 'Portrait'], ['landscape', 'Landscape']];
  function pageSize() {
    const o = fold.printOrient, p = PAPER.find(x => x[0] && x[0] === fold.printPaper);
    if (!p) return o || null;
    const [a, b] = p[2].split(' ');
    return o === 'landscape' ? `${b} ${a}` : `${a} ${b}`;
  }
  function printPicks() {
    const opt = (list, v) => list.map(([k, t]) => `<option value="${k}"${(v || '') === k ? ' selected' : ''}>${t}</option>`).join('');
    return `<select class="input lm-print-pick" data-print="paper" title="Paper size" aria-label="Paper size">${opt(PAPER, fold.printPaper)}</select>` +
      `<select class="input lm-print-pick" data-print="orient" title="Orientation" aria-label="Orientation">${opt(ORIENT, fold.printOrient)}</select>`;
  }
  function drawingHtml(h) {
    const sh = LM.sheet.sheet(h);
    S.lastSheet = sh;
    return `<div class="page wide">` + pageHead('Drawing', esc(h.title), `${esc(h.pn || 'No part number')}<span class="sep">·</span>Rev ${esc(h.rev || '—')}<span class="sep">·</span>${sh.w} × ${sh.h} px sheet`,
      `<button class="btn" data-act="export-svg">SVG</button><button class="btn" data-act="export-png">PNG</button>${printPicks()}<button class="btn btn-primary" data-act="print" title="Prints the drawing, the connectors, and the wire list, each from a new page">Print or PDF</button>`) +
      `<div class="sheet-card">${sh.svg}</div></div>`;
  }
  // The Wires tab: the wire list, editable.
  function wiresHtml(h) {
    const A = M.analyze(h), rows = M.fromTo(h, A);
    const list = h.nodes.filter(n => M.isConn(n) || n.kind === 'splice').flatMap(n => (M.isConn(n) ? M.pinList(n).map(p => n.ref + '.' + p) : [n.ref]));
    return `<div class="page wide wires-page">` + pageHead('Wires', esc(h.title), `${rows.length} wire${rows.length === 1 ? '' : 's'}<span class="sep">·</span>Type ends as a ref and pin, like P1.3, or a splice, like S1`,
      `<button class="btn" data-act="csv-wires">${ICON.save}CSV</button>`) +
      `<datalist id="ends">${list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <div class="card table-wrap"><table class="table compact wtable"><thead><tr><th>Wire</th><th>From</th><th>To</th><th>Signal</th><th>Color</th><th>Gauge</th><th class="num">Length</th><th>Set</th><th></th></tr></thead><tbody>
      ${rows.map(r => { const w = r.wire; return `<tr data-row="${w.id}"><td class="mono">${r.name}</td>
        <td><input class="cell-in mono" list="ends" data-f="w:${w.id}.fromText" value="${esc(r.from)}"></td>
        <td><input class="cell-in mono" list="ends" data-f="w:${w.id}.toText" value="${esc(r.to)}"></td>
        <td><input class="cell-in" data-f="w:${w.id}.signal" value="${esc(r.signal)}" placeholder="Signal"></td>
        <td>${colorSelects('w:' + w.id + '.color', w.color)}</td>
        <td>${gaugeSelect('w:' + w.id + '.gauge', w.gauge)}</td>
        <td class="num">${U.fmtLen(r.length)}</td><td>${esc(r.sets)}</td>
        <td><button class="icon-btn" data-act="del-wire" data-id="${w.id}" title="Delete ${r.name}">${ICON.trash}</button></td></tr>`; }).join('')}
      <tr class="add-wire"><td class="pc-muted">New</td><td><input class="cell-in mono" list="ends" id="nw-from" placeholder="P1.1"></td><td><input class="cell-in mono" list="ends" id="nw-to" placeholder="P2.1"></td>
        <td><input class="cell-in" id="nw-signal" placeholder="Signal"></td><td colspan="5"><button class="btn" data-act="add-wire">Add wire</button></td></tr>
      </tbody></table></div>
      <div class="card paste-card"><div class="pc-card-title">Paste from a spreadsheet</div>
      <p class="f-hint">One wire per line: from, to, signal, color, gauge (tab or comma separated). For example <code>P1.3, P2.3, I2C_SDA, BU, 28</code>.</p>
      <textarea class="input" id="paste" rows="4" placeholder="P1.3&#9;P2.3&#9;I2C_SDA&#9;BU&#9;28"></textarea>
      <div style="margin-top:10px"><button class="btn" data-act="paste">Add these wires</button></div></div></div>`;
  }
  function bomHtml(h) {
    const rows = M.bom(h);
    return `<div class="page wide">` + pageHead('Bill of materials', esc(h.title), `Wire, cable, and covering lengths include a ${h.allowancePct || 0}% allowance`, `<button class="btn" data-act="csv-bom">${ICON.save}CSV</button>`) +
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
  // The wiring diagram as a PNG for Signoff PL's tiles (store.js storeDrawings): at most 1600 px on its
  // longer side, and never more than twice its drawn size. Resolves null when it can't be drawn.
  function drawingPng(d) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(new Blob([d.svg], { type: 'image/svg+xml' })), img = new Image();
      img.onload = () => {
        const s = Math.min(2, 1600 / Math.max(d.w, d.h)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(d.w * s)); c.height = Math.max(1, Math.round(d.h * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => {
          if (!b) { resolve(null); return; }
          b.arrayBuffer().then(buf => resolve({ bytes: new Uint8Array(buf), type: b.type, w: c.width, h: c.height }), () => resolve(null));
        }, 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
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
    // Three sections, each from a new page (LM.sheet.printDoc), drawn with the sheet's styles.
    div.innerHTML = `<style>${LM.sheet.printStyle}</style>` + LM.sheet.printDoc(H());
    // The paper and orientation picked beside the button (printPicks), if any.
    const page = document.createElement('style'), size = pageSize();
    page.textContent = size ? `@page { size: ${size}; }` : '';
    document.head.appendChild(page);
    document.body.appendChild(div);
    document.body.classList.add('printing');
    setTimeout(() => { window.print(); document.body.classList.remove('printing'); div.remove(); page.remove(); }, 50);
  }
  function openFile(file) {
    file.text().then(t => {
      const doc = JSON.parse(t);
      // A saved system (Save file in a system) opens as a system.
      if (doc && doc.kind === 'system') { const s = LM.system.openDoc(doc); S.cur = null; persist(); renderAll(); toast(`Opened ${s.title}.`); return; }
      const h = M.normalize(doc);
      if (S.store[h.id]) h.id = U.uid('h');
      delete h.deleted;
      if (!DEMO) delete h.demoVersion;   // a saved demo harness opened outside the demo is an ordinary one
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
      case 'home': LM.system.close(); S.cur = null; persist(); renderAll(); break;
      case 'new-system': { const p = h ? h.project : ''; S.cur = null; LM.system.create(p); persist(); renderAll(); toast('Add a board from Signoff EE, or draw one, then click its connectors.'); break; }
      case 'demo-system': LM.system.demo().then(() => { S.cur = null; persist(); renderAll(); }); break;
      // Project groups fold as in Signoff EE: folding the group that holds the open harness goes home.
      case 'toggle-sys': {
        // A system's place in the tree folds on its own, by its path (one placed twice folds apart).
        const t = Object.assign({}, fold.sysTree), k = el.dataset.path;
        t[k] = el.getAttribute('aria-expanded') !== 'true';
        fold.sysTree = t; saveFold(); renderSidebar();
        break;
      }
      case 'toggle-group': {
        const cg = Object.assign({}, fold.closedGroups), k = el.dataset.group;
        if (el.getAttribute('aria-expanded') === 'true') cg[k] = true; else delete cg[k];
        fold.closedGroups = cg; saveFold();
        if (cg[k] && el.hasAttribute('data-holds-open')) { LM.system.close(); S.cur = null; persist(); renderAll(); } else renderSidebar();
        break;
      }
      case 'fold-groups': {
        const ks = [...new Set(live().concat(LM.system.tree().roots.map(n => n.sys)).map(h => String(h.project || '').trim().toLowerCase()))];
        const cg = Object.assign({}, fold.closedGroups), unfold = ks.every(k => cg[k]);
        ks.forEach(k => { if (unfold) delete cg[k]; else cg[k] = true; });
        fold.closedGroups = cg; saveFold();
        if (unfold || !(S.cur || LM.system.current())) renderSidebar(); else { LM.system.close(); S.cur = null; persist(); renderAll(); }
        break;
      }
      case 'theme': { const t = isDark(readTheme()) ? 'light' : 'dark'; writeTheme(t); applyTheme(t); break; }
      case 'new': { const n = M.blank(); n.drawnBy = ''; S.store[n.id] = n; S.view = 'build'; openHarness(n.id); toast('Two ends to start. Click a pin, then a pin on the other end, to run a wire.'); break; }
      case 'demo': S.store.hdemo1 = LM.demo.harness(); openHarness('hdemo1'); break;
      case 'pl-start': startFromPl(el.dataset.pl); break;
      // The banner's Reset demo: the demo's own storage goes back to just the demo harness, so
      // harnesses made while trying it (the suite tour has one built) go too.
      case 'demo-reset': if (!DEMO) break; S.store = { hdemo1: LM.demo.harness() }; openHarness('hdemo1'); toast('The demo is back as it started.'); break;
      case 'open': $('#file-input').click(); break;
      case 'discard': discardChanges(); break;
      case 'save': if (h) U.download(baseName(h) + '.loom.json', JSON.stringify(h, null, 2), 'application/json'); break;
      case 'sync': syncNow(false); break;
      case 'sys-undo': LM.system.act('undo'); break;
      case 'sys-redo': LM.system.act('redo'); break;
      case 'sys-discard': discardSystem(); break;
      case 'sys-save': LM.system.saveFile(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'fit': fitGlide(); break;
      case 'zoom-in': zoomBy(1.25); break;
      case 'zoom-out': zoomBy(0.8); break;
      case 'zoom-reset': zoomBy(0); break;
      case 'fold-rail': if (narrow()) { S.sheet = !S.sheet; $('#build-view').classList.toggle('sheet-open', S.sheet); } else toggleFold('rail'); break;
      case 'sheet-close': S.sheet = false; $('#build-view').classList.remove('sheet-open'); break;
      case 'nav': toggleSidebar(); break;
      case 'fold-parts': toggleFold('parts'); break;
      case 'pane-tab': S.paneTab = el.dataset.tab; renderParts(); break;
      case 'edit-set': S.paneTab = 'props'; renderParts(); break;
      case 'reset-route': { const keys = (el.dataset.keys || '').split(' ').filter(Boolean); change(x => { keys.forEach(k => { if (x.routes) delete x.routes[k]; }); }); break; }
      case 'auto-layout': change(x => { if (fold.prop) delete x.propY; else { x.place = {}; delete x.routes; x.wires.forEach(w => { delete w.labelAt; delete w.labelOff; }); x.sets.forEach(st => { delete st.badgeAt; delete st.badgeOff; }); } }); S.cam = null; renderCanvas(); break;
      case 'add-conn': addEnd('connector'); break;
      case 'add-splice': addEnd('splice'); break;
      case 'add-note': S.placing = 'note'; S.pending = null; S.view = 'build'; renderAll(); break;
      case 'add-table': S.placing = 'table'; S.pending = null; S.view = 'build'; renderAll(); break;
      case 'help': fold.help = fold.help === false; try { localStorage.setItem(FOLD_KEY, JSON.stringify(fold)); } catch (e) { /* storage blocked */ } renderParts(); break;
      case 'from-board': openBoards(); break;
      case 'configure': { const n = S.sel && S.sel.kind === 'node' && M.node(h, [...S.sel.ids][0]); if (n && M.isConn(n)) LM.configure.open({ h: H, nodeId: n.id, apply: fn => change(fn) }); break; }
      case 'guide': if (LM.guide) LM.guide.start(); break;
      case 'bm-close': closeModal(); break;
      case 'bm-back': BM.step = BM.boards ? 'boards' : 'loading'; renderModal(); break;
      case 'bm-retry': if (BM.board && BM.boards) openBoard(BM.board.id); else { BM.boards = null; LM.boards.reset(); openBoards(); } break;
      case 'bm-board': openBoard(el.dataset.id); break;
      case 'bm-add': addBoardConnector(el.dataset.ref); break;
      case 'match-wire': wireMatches(el.dataset.a, el.dataset.b); break;
      case 'delete': deleteSel(); break;
      case 'duplicate': { const c = JSON.parse(JSON.stringify(h)); c.id = U.uid('h'); c.title = h.title + ' (copy)'; c.updated = Date.now(); delete c.identAt; delete c.demoVersion; delete c.plPart; S.store[c.id] = c; openHarness(c.id); break; }
      case 'delete-harness': {
        // Once synced, a harness is kept as a tombstone, so the next sync deletes it everywhere (its file
        // stays in the repo, marked deleted, and its git history keeps every version).
        const kept = !DEMO && R && R.wasSynced(h.id);
        if (!confirm(kept ? `Delete "${h.title}"? The next sync deletes it from Loom's repo too; its history stays in git.` : `Delete "${h.title}" from this browser? Save a file first if you want to keep it.`)) break;
        if (kept) { h.deleted = true; h.updated = Date.now(); if (R.login()) h.updatedBy = R.login(); } else delete S.store[h.id];
        S.cur = null; persist(); renderAll();
        if (kept) syncNow(true);
        break;
      }
      case 'straight': { const to = $('#straight-to').value; const k = change(x => M.wireStraight(x, el.dataset.node, to)); toast(k ? `Added ${k} wire${k > 1 ? 's' : ''}.` : 'No free pin pairs to wire.'); break; }
      case 'set-flag': setFlag(el.dataset.flag, el.getAttribute('aria-pressed') !== 'true', !!el.dataset.together); break;
      case 'set-holder': {
        // One of None, Cable, Bundle: picking one turns the other off (M.setFlag does); None turns
        // off whichever is on. With several sets selected, each set.
        const k = el.dataset.holder, P = selParts(S.sel);
        if (S.sel && S.sel.kind === 'set') {
          const ids = selWireIds(h, S.sel);
          change(x => {
            P.set.forEach(id => { const st = M.set(x, id), cur = st && M.holderOf(st); if (!st) return; if (k === 'none') { if (cur) M.setFlag(x, id, cur, false); } else if (k !== cur) M.setFlag(x, id, k, true); });
            const left = P.set.filter(id => M.set(x, id));
            S.sel = left.length ? { kind: 'set', ids: new Set(left) } : wiresSel(x, ids);
          });
        } else if (k !== 'none') setFlag(k, true);
        break;
      }
      case 'export-svg': U.download(baseName(h) + '.svg', S.lastSheet.svg, 'image/svg+xml'); break;
      case 'export-png': exportPng(S.lastSheet, baseName(h) + '.png'); break;
      case 'print': printSheet(S.lastSheet); break;
      case 'csv-wires': U.download(baseName(h) + '_wires.csv', U.csv([['Wire', 'From', 'To', 'Signal', 'Color', 'Gauge (AWG)', 'Length (mm)', 'Set']].concat(M.fromTo(h).map(r => [r.name, r.from, r.to, r.signal, r.color.code, r.gauge, r.length == null ? '' : r.length, r.sets]))), 'text/csv'); break;
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
  // Tick or untick a property of the selected set (or each of several), or make the selected
  // wires a set (together: one set of the selected sets, from the sets panel).
  function setFlag(flag, on, together) {
    const sel = S.sel;
    if (!sel) return;
    change(h => {
      const ids = selWireIds(h, sel);
      if (sel.kind === 'set' && !together) {
        const left = selParts(sel).set.filter(id => M.setFlag(h, id, flag, on));
        S.sel = left.length ? { kind: 'set', ids: new Set(left) } : wiresSel(h, ids);
      } else if (on) {
        const st = M.makeSet(h, ids, { [flag]: true });
        if (st) S.sel = { kind: 'set', ids: new Set([st.id]) };
        else toast(M.whyNot(h, ids) || (flag === 'cable' && M.noCable(h, null, M.membersFor(h, ids)) && "Can't be a cable: " + M.noCable(h, null, M.membersFor(h, ids))) || "Couldn't make a set of these wires.", 'error');
      }
    });
  }
  function deleteSel() {
    if (!S.sel) return;
    const P = selParts(S.sel);
    change(h => {
      if (P.note.length) h.callouts = (h.callouts || []).filter(c => !P.note.includes(c.id));
      P.set.forEach(id => M.dissolveSet(h, id));
      if (P.wire.length) M.removeWires(h, P.wire);
      P.node.forEach(id => M.removeNode(h, id));
      P.seg.forEach(id => M.removeSegment(h, id));
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
    const app = $('#app');
    if (app.classList.contains('nav-open') && !t.closest('[data-act="nav"]') && (!t.closest('#sidebar') || t.closest('[data-open], [data-open-sys], [data-act="new"], [data-act="new-system"], [data-act="home"], [data-act="open"], [data-act="guide"], a'))) {
      app.classList.remove('nav-open');
      if (!t.closest('#sidebar')) return;
    }
    const a = t.closest('[data-act]');
    if (a && !a.disabled) { onAct(a.dataset.act, a); return; }
    const v = t.closest('[data-view]');
    if (v) { S.view = v.dataset.view; S.pending = null; renderAll(); return; }
    const os = t.closest('[data-open-sys]');
    if (os) { if (os.dataset.openSys !== LM.system.current()) openSystem(os.dataset.openSys); return; }
    const o = t.closest('[data-open]');
    if (o) {
      // A harness clicked in the menu opens its panel when it's folded away.
      const unfold = fold.rail && !narrow();
      if (unfold) { fold.rail = false; saveFold(); }
      if (o.dataset.open !== S.cur) openHarness(o.dataset.open);
      else if (S.view !== 'build') { S.view = 'build'; renderAll(); }
      else if (unfold) { applyFold(); renderHud(); renderCanvas(); }
      return;
    }
    const sf = t.closest('[data-setf]');
    if (sf) { setField(sf.dataset.setf, sf.dataset.v); return; }
    const p = t.closest('[data-pick]');
    if (p) { const [kind, id] = p.dataset.pick.split(':'); select(kind, id); return; }
    const c = t.closest('[data-check]');
    if (c) goToCheck(+c.dataset.check);
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'file-input') { if (el.files[0]) openFile(el.files[0]); el.value = ''; return; }
    if (el.dataset && el.dataset.print) {
      fold[el.dataset.print === 'paper' ? 'printPaper' : 'printOrient'] = el.value || undefined;
      saveFold();
      return;
    }
    if (el.dataset && el.dataset.hud === 'grid') {
      // Dots or Lines: a view of this browser's, which keeps the spacing.
      if (el.value === 'dots' || el.value === 'lines') {
        fold.gridStyle = el.value;
        try { localStorage.setItem(FOLD_KEY, JSON.stringify(fold)); } catch (e) { /* storage blocked */ }
        renderHud(); renderCanvas();
        return;
      }
      change(h => { h.grid = +el.value; });
      return;
    }
    // Kept with the panel folds: a view setting for this browser, not part of the harness.
    // Real proportions: a view of this browser's, like the wire labels. Ticked, the canvas is laid
    // out to scale from the lengths; unticked, it's the arranged (casual) view with its dragged
    // positions, which the proportional view never changes.
    if (el.dataset && el.dataset.hud === 'prop') {
      fold.prop = el.checked;
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(fold)); } catch (e) { /* storage blocked */ }
      S.cam = null;
      renderAll();
      return;
    }
    if (el.dataset && el.dataset.hud === 'wtext') {
      fold.noWireText = !el.checked;
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(fold)); } catch (e) { /* storage blocked */ }
      svgEl().classList.toggle('no-wtext', !el.checked);
      return;
    }
    if (el.dataset && el.dataset.f) setField(el.dataset.f, el.value, el);
  });
  document.addEventListener('keydown', e => {
    if (ctxEl) { if (e.key === 'Escape') { e.preventDefault(); closeCtx(); return; } if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Tab') closeCtx(); }
    if (LM.configure.isOpen()) { LM.configure.onKey(e); return; }
    if (BM.open) { if (e.key === 'Escape') closeModal(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    const mod = e.ctrlKey || e.metaKey;
    // Ctrl+S syncs, as in the other Signoff tools; with no sign-in (or in the demo) it saves a file.
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); onAct(canSync() ? 'sync' : 'save'); return; }
    if (typing && e.key === 'Escape' && document.activeElement.closest('.title-edit')) { const a = document.activeElement; a.value = a.defaultValue; a.blur(); return; }
    if (typing) { if (e.key === 'Enter' && document.activeElement.tagName === 'INPUT') document.activeElement.blur(); return; }
    if (e.key === '[' && !mod) { e.preventDefault(); toggleSidebar(); return; }
    if (LM.system.current()) { LM.system.onKey(e); return; }
    if (!H()) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (S.view !== 'build') return;
    if (mod && e.key.toLowerCase() === 'c') { if (copyParts(selParts(S.sel).node)) e.preventDefault(); return; }
    if (mod && e.key.toLowerCase() === 'v') { if (readClip()) { e.preventDefault(); pasteParts(hoverPt ? toWorld(hoverPt) : null); } return; }
    if (e.key === 'Escape' && $('#app').classList.contains('nav-open')) { $('#app').classList.remove('nav-open'); return; }
    if (e.key === 'Escape' && !S.sel && S.sheet) { S.sheet = false; $('#build-view').classList.remove('sheet-open'); return; }
    if (e.key === 'Escape' && gesture && gesture.marquee) { gesture = null; svgEl().classList.remove('marquee'); renderCanvas(); return; }
    if (e.key === 'Escape') { S.placing ? (S.placing = null) : S.pending ? (S.pending = null, S.sel = null) : (S.sel = null); $('#ghost') && ($('#ghost').innerHTML = ''); renderAll(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
    else if (e.key === 'f' || e.key === 'F') fitGlide();
    else if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-' || e.key === '_') zoomBy(0.8);
    else if (e.key === '0') zoomBy(0);
    else if (e.key === 'c' || e.key === 'C') addEnd('connector');
  });
  const svg = svgEl();
  // No text drags (Chris, 2026-11-12, as on the system canvas): text selected before (a double-click,
  // Ctrl+A) is cleared when a press starts here, and the browser's own drag of a selection never starts.
  svg.addEventListener('dragstart', e => e.preventDefault());
  svg.addEventListener('pointerdown', () => { const s = getSelection && getSelection(); if (s && !s.isCollapsed) s.removeAllRanges(); });
  svg.addEventListener('pointerdown', onDown);
  // Shift-click on the canvas adds to the selection; it mustn't also select the page's text.
  svg.addEventListener('mousedown', e => { if (e.shiftKey || e.ctrlKey || e.metaKey) { e.preventDefault(); const s = getSelection(); if (s && !s.isCollapsed) s.removeAllRanges(); } });
  svg.addEventListener('pointerover', e => {
    const b = e.target.closest && e.target.closest('.cv-badge');
    const id = b ? b.dataset.set : null;
    if (id !== badgeHover) { badgeHover = id; lightBadgeSet(); }
  });
  svg.addEventListener('pointerleave', () => { if (badgeHover) { badgeHover = null; lightBadgeSet(); } });
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') hoverPt = { clientX: e.clientX, clientY: e.clientY }; });
  svg.addEventListener('pointerleave', () => { hoverPt = null; });
  svg.addEventListener('wheel', closeCtx, { passive: true });
  svg.addEventListener('pointerup', onUp);
  // A double-click on a wire's line or a set's area adds a bend to its route there (Chris,
  // 2026-11-10), a jog of no length to drag out; one undo takes it back.
  svg.addEventListener('dblclick', e => {
    const Lo = lastLayout, h = H();
    // A table's cell: select the table and put the cursor in that cell's box in Properties.
    const tbl = Lo && h && e.target.closest && e.target.closest('[data-tbl]');
    if (tbl) {
      const c = M.note(h, tbl.dataset.tbl), g = c && Lo.tableGeom(c), p = toWorld(e);
      if (!g) return;
      const r = Math.max(0, g.rows.findIndex(x => p.y < x.y + x.h)), k = Math.max(0, g.cols.findIndex(x => p.x < x.x + x.w));
      select('note', c.id);
      const el = document.querySelector(`[data-f="tbl.cell.${r}.${k}"]`);
      if (el) { el.focus(); el.select(); }
      return;
    }
    if (!Lo || fold.prop || !h) return;
    const key = e.target.classList.contains('w-hit') ? Lo.boxOfWire(e.target.closest('[data-wire]').dataset.wire) : e.target.classList.contains('cv-setarea') ? Lo.boxOfSet(e.target.dataset.set) : null;
    const r = key && Lo.runAt(key, toWorld(e));
    if (!r || r.d > r.route.half + 12) return;
    const gs = gridOf(h), rec = LM.connect.bend(r, gs ? (v => Math.round(v / gs) * gs) : null, h.routes && h.routes[key]);
    if (!rec) return;
    change(x => { x.routes = x.routes || {}; x.routes[key] = rec; });
    toast('Bend added. Drag its new run to shape the wire.');
  });
  svg.addEventListener('pointercancel', e => { if (endTouch(e) || pinch) return; const g = gesture; gesture = null; S.slide = null; svgEl().classList.remove('dragging', 'dragging-end'); if (g && g.end) renderCanvas(); });
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('contextmenu', e => e.preventDefault()); // the right button pans; a right click opens the menu (openCtx)
  // When the canvas changes size (the sidebar sliding, a panel folding, the window), the picture
  // stays where it is on screen: the camera follows the canvas's left edge, and the viewBox its
  // size, every frame of the slide. Not when it appears from hidden (another view).
  let wrapWas = null;
  if (window.ResizeObserver) new ResizeObserver(() => {
    const r = $('#canvas-wrap').getBoundingClientRect(), was = wrapWas;
    wrapWas = r.width ? { left: r.left } : null;
    if (!was || !r.width || !S.cam || !H() || S.view !== 'build') return;
    S.cam.x += (r.left - was.left) / S.cam.k;
    setView();
  }).observe($('#canvas-wrap'));
  let wasNarrow = narrow();
  window.addEventListener('resize', () => {
    if (!H() || S.view !== 'build') return;
    renderCanvas();
    if (narrow() !== wasNarrow) { wasNarrow = narrow(); renderRail(); }
  });
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
  // another one, it reloads into it once the page is idle (not typing, dragging, wiring, or picking a
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
  // Start with the sidebar as it was left, without playing the slide.
  $('#app').style.transition = 'none';
  applySide(); sideResize();
  void $('#app').offsetWidth;
  $('#app').style.transition = '';
  if (DEMO) {
    const b = $('#demo-banner');
    b.hidden = false; document.body.classList.add('has-banner');
    b.innerHTML = 'Demo: made-up harnesses for Acme Climate. Edits stay in this browser. <button class="btn btn-plain" data-act="demo-reset">Reset demo</button> <a href="./">Leave the demo</a>';
    document.querySelectorAll('[data-demo-href]').forEach(a => { a.href = a.getAttribute('href') + '?demo'; });
  }
  load();
  renderAll();
  // Sync once on opening, so names and part numbers edited in Signoff PL come over (quietly: no toast
  // unless something happened or it failed for a reason other than a missing repo).
  if (canSync()) setTimeout(() => syncNow(true), 400);
  // Signed in or out in another tab (Signoff EE, say): show it, and sync once signed in. A sign-in's
  // refresh replaces the token but not who it is (the engine's tokenTag), so it changes nothing here.
  if (!DEMO) {
    const whoTag = () => { const t = R ? R.token() : ''; return t && window.Signoff && window.Signoff.model ? window.Signoff.model.tokenTag(t) : t ? 'x' : ''; };
    let seenTag = whoTag();
    window.addEventListener('storage', e => {
      if (e.key !== 'signoff.token' && e.key !== 'signoff.login') return;
      const tag = whoTag();
      if (tag === seenTag) return;
      seenTag = tag;
      renderSidebar();
      if (canSync()) syncNow(true);
    });
  }
  // Settings and People & access, shared with the suite (signoff/assets/sidefoot.js); the sync pill stays Loom's.
  if (window.SignoffFoot) window.SignoffFoot.mount({
    settings: '[data-foot-settings]', people: '#people-link',
    theme: readTheme, setTheme: t => { writeTheme(t); applyTheme(t); },
    intro: 'Harnesses sync with Loom’s private repository through the GitHub sign-in every Signoff tool in this browser shares.',
    changed: () => { renderSidebar(); if (canSync()) syncNow(true); }
  });
  // guide: what assets/guide.js needs to set the page up for each of its steps.
  LM.app = { state: S, renderAll, H, demo: DEMO,
    guide: {
      // The demo harness, opened in Build (rebuilt if it was deleted).
      demo() { if (!S.store.hdemo1) S.store.hdemo1 = LM.demo.harness(); if (S.cur !== 'hdemo1') openHarness('hdemo1'); },
      view(v) { if (!H()) return; S.view = v; S.pending = null; S.placing = null; renderAll(); },
      // Select by kind and id (or clear, with no kind), in Build; Properties shows it.
      select(kind, ids) { if (!H()) return; S.view = 'build'; S.pending = null; S.placing = null; select(kind, ids); },
      // Both panels shown off phones, so the guide can point into them.
      // rail false: the harness panel is folded instead (Loom's guide keeps it out of the way; Chris,
      // 2026-11-08), and the diagram refits once the fold has played.
      panels(rail) {
        const want = rail === false;
        if (narrow() || (fold.rail === want && !fold.parts)) return;
        const refit = fold.rail !== want;
        fold.rail = want; fold.parts = false; saveFold();
        if (S.view === 'build') { applyFold(); renderHud(); renderCanvas(); if (refit) setTimeout(() => { if (H() && S.view === 'build') fitGlide(); }, 350); }
      },
      menu() { if (narrow() || !fold.side) return; toggleSidebar(); },
      // The harness panel folded away (Running a wire: it covered P1), then the diagram fits the wider
      // canvas once the fold has played. The next step's build() brings it back.
      rail(open) {
        if (narrow() || !H() || !fold.rail === open) return;
        fold.rail = !open; saveFold();
        if (S.view === 'build') { applyFold(); renderHud(); renderCanvas(); setTimeout(() => { if (H() && S.view === 'build') fitGlide(); }, 350); }
      },
      // The suite tour's first Loom step (signoff/assets/tour.js): the menu and the parts pane fold
      // away and the diagram fits the bigger canvas. A selection brings the parts pane back.
      focus() {
        if (narrow() || !H()) return;
        fold.side = true; fold.parts = true; saveFold(); applySide();
        S.view = 'build'; S.pending = null; S.placing = null; renderAll();
        setTimeout(() => { if (H() && S.view === 'build') fitGlide(); }, 350);
      },
      // The How it works card, which would cover Properties.
      help(open) { if ((fold.help !== false) === open) return; fold.help = open; try { localStorage.setItem(FOLD_KEY, JSON.stringify(fold)); } catch (e) { /* storage blocked */ } if (H() && S.view === 'build') renderParts(); },
      fit() { if (H() && S.view === 'build') fitGlide(); },
      narrow,
    } };
})(window.LM = window.LM || {});
