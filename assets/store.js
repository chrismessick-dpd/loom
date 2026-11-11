// Loom's harnesses on GitHub. One private data repo (`loom_data`) holds the internal harnesses as
// projects/<harness id>.json, and a harness shared with someone outside the team lives in its own
// private repo, review-loom-<slug>, as Signoff EE shares a board (signoff_pl/docs/sharing.md; Signoff PL
// does the sharing when a product is shared). `loom_data/users.json` is the roster: the engine's
// `shared` map says which harness lives where. Every repo syncs with the Signoff engine's GitHubStore
// (assets/vendor/github.js): pull, merge, push one commit with force:false, retry when someone pushed
// first. An FTE (a token that opens loom_data) syncs it and every repo in the shared map; anyone else
// syncs the review-loom-* repos their token can list. Each file is an envelope round the harness,
// shaped like a Signoff review so Signoff PL reads it as any other design:
//
//   { schema: 1, id, meta: { name, number, revision, project, deleted, updatedAt, updatedBy },
//     summary: { v, tool: 'loom', name, number, revision, project, identAt, harness: {…}, … },
//     harness: <the harness, as Loom keeps it> }
//
// `harness` is the truth; `meta` and `summary` are derived from it whenever the file is written.
//
// Merging. A harness is a graph (wires routed through segments, nested sets), so two copies can't be
// merged record by record without breaking it. A copy with no edits since this browser's last sync
// takes the stored one. When both changed, the newer wins and the other is kept as a new harness
// named "(conflict copy)", so nothing is lost.
//
// Signoff PL. A harness joins a PL project the way an EE board does: its `project` (the client
// project) puts it in that PL project's tray, and the PL Part made from it (source 'loom') is the link
// of record and holds its place in the tree. Loom reads PL's data repo (read only) to list PL projects
// and the Parts that link each harness. Name and part number go both ways without either tool writing
// the other's repo: each side stamps `identAt` when they're edited there, and the newer side wins
// (`adoptFromPl` here, `adoptHarnesses` in PL).
(function (LM) {
  'use strict';
  const SG = window.Signoff || {};
  const DEMO = /[?&]demo\b/.test(location.search);
  let NS = 'loom.v1.';   // tests use their own (setNamespace)
  const DEFAULTS = { owner: 'chrismessick-dpd', dataRepo: 'loom_data', prefix: 'review-loom-', plRepo: 'signoff_pl_data' };

  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(NS + k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };

  function token() {
    const clean = t => String(t || '').replace(/[\s​-‍⁠﻿]/g, '');
    try { return clean(sessionStorage.getItem('signoff.token') || localStorage.getItem('signoff.token') || ''); } catch (e) { return ''; }
  }
  // The owner is the one Signoff EE uses; the repos are Loom's (kept under loom.v1.repos to change them).
  function config() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('signoff.v1.settings') || '{}') || {}; } catch (e) { /* storage blocked */ }
    return Object.assign({}, DEFAULTS, { owner: s.owner || DEFAULTS.owner }, read('repos', {}));
  }
  const stable = v => SG.model.stableStringify(v);
  // A short hash of a harness as stored, to tell whether it changed since the last sync.
  const hash = h => fnv(stable(h));
  function fnv(s) {
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return x.toString(36) + ':' + s.length;
  }
  const iso = ms => new Date(ms || 0).toISOString();

  // ── The file ──
  function envelope(h) {
    return {
      schema: 1, id: h.id,
      meta: { name: h.title || 'Untitled harness', number: h.pn || '', revision: h.rev || '', project: h.project || '',
        deleted: !!h.deleted, updatedAt: iso(h.updated), updatedBy: h.updatedBy || '' },
      harness: h,
    };
  }
  function unwrap(doc) {
    const h = doc && doc.harness;
    if (!h || typeof h !== 'object' || h.id !== doc.id) return null;
    try { return LM.model.normalize(h); } catch (e) { return null; }
  }

  const plPartOf = h => {
    const p = h && h.plPart;
    return p && typeof p.project === 'string' && typeof p.node === 'string' && p.project && p.node ? { project: p.project, node: p.node, at: typeof p.at === 'string' ? p.at : '' } : undefined;
  };
  // What Signoff PL reads (its reader keeps only meta and summary). Built from the harness alone.
  function summarize(doc) {
    const h = doc.harness, M = LM.model;
    if (!h) return undefined;
    const A = M.analyze(h), c = M.checks(h, A);
    const wireMm = h.wires.reduce((t, w) => t + (A.wireLen.get(w.id) || 0), 0);
    // The Signoff EE boards its ends came from (From a board), by review id.
    const boards = [...new Set(h.nodes.filter(n => n.board && n.board.project).map(n => String(n.board.project)))];
    return {
      v: 1, tool: 'loom', name: doc.meta.name, number: doc.meta.number, revision: doc.meta.revision, project: doc.meta.project,
      archived: !!h.deleted, identAt: h.identAt || '', at: doc.meta.updatedAt, by: doc.meta.updatedBy,
      // The waiting Signoff PL Part this harness was started from; PL links that Part to it (pl.js claimPlanned).
      plPart: plPartOf(h),
      total: 0, reviewed: 0, pct: 0, checklists: {}, issues: { open: { critical: 0, major: 0, minor: 0 }, fixed: 0, waived: 0 },
      harness: {
        ends: h.nodes.filter(M.isConn).length, splices: h.nodes.filter(n => n.kind === 'splice').length,
        wires: h.wires.length, cables: h.sets.filter(s => s.cable).length, sets: h.sets.length,
        wireMm: Math.round(wireMm), errors: c.filter(x => x.sev === 'error').length, warnings: c.filter(x => x.sev === 'warn').length,
        boards,
      },
    };
  }

  // Both copies changed since this browser's last sync: the newer wins, the other comes back through
  // onConflict to be kept as a copy.
  function makeMerge(isDirty, onConflict) {
    return function (local, remote) {
      if (!local) return remote;
      if (!remote) return local;
      if (!isDirty(local.id)) return remote;
      if (stable(local.harness) === stable(remote.harness)) return remote;
      // By the harness's own clock, not the derived meta, which a file could carry stale.
      const lt = Number(local.harness && local.harness.updated) || 0, rt = Number(remote.harness && remote.harness.updated) || 0;
      const win = lt > rt ? local : remote;
      onConflict(win === local ? remote : local, win);
      return win;
    };
  }

  // ── Signoff PL (read only) ──
  // Every PL project (name, client project), every live PL Part linking a Loom harness, and every
  // Part waiting to be started in Loom (`planned`: source 'loom' with no link yet).
  // The cache holds slimmed documents by blob sha, so it carries the slim shape's version: bump
  // PL_CACHE_V whenever slimPl keeps something new, or unchanged PL files never gain it
  // (2: planned Parts).
  const PL_CACHE_V = 2;
  async function readPl(cfg, tok, fetchImpl) {
    const store = new SG.GitHubStore({ owner: cfg.owner, repo: cfg.plRepo, branch: 'main', dataPath: '', token: tok }, fetchImpl);
    const stored = read('plCache', {});
    const cache = stored && stored.v === PL_CACHE_V && stored.files ? stored.files : {};
    const snap = await store.snapshot();
    const next = {};
    const files = snap.entries.filter(e => e.type === 'blob' && /^projects\/[^/]+\.json$/.test(e.path));
    for (const e of files) {
      let doc = cache[e.path] && cache[e.path].sha === e.sha ? cache[e.path].doc : null;
      if (!doc) { try { doc = slimPl(JSON.parse(await store.blob(e.sha))); } catch (err) { continue; } }
      if (doc) next[e.path] = { sha: e.sha, doc };
    }
    write('plCache', { v: PL_CACHE_V, files: next });
    return Object.assign({ at: new Date().toISOString() }, plIndex(Object.keys(next).map(k => next[k].doc)));
  }
  // The slimmed PL projects as { projects, links: { harness id: [Part] }, planned: [Part] }. Pure, for tests.
  function plIndex(slims) {
    const projects = [], links = {}, planned = [];
    slims.forEach(slim => {
      if (!slim || slim.archived) return;
      const where = { project: slim.id, slug: slim.slug, projectName: slim.name, clientProject: slim.clientProject };
      projects.push({ id: slim.id, slug: slim.slug, name: slim.name, clientProject: slim.clientProject });
      slim.parts.forEach(n => { (links[n.ref] = links[n.ref] || []).push(Object.assign({}, where, n)); });
      (slim.planned || []).forEach(n => planned.push(Object.assign({}, where, n)));
    });
    projects.sort((a, b) => a.name.localeCompare(b.name));
    planned.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.path.join('/').localeCompare(b.path.join('/')) || a.name.localeCompare(b.name));
    return { projects, links, planned };
  }
  // The Parts waiting in Signoff PL that no harness here was started from yet (the From Signoff PL list).
  // A harness started from one names it (h.plPart) until PL links it, and is then in `links`. Pure.
  function waiting(pl, harnesses) {
    const taken = new Set();
    (harnesses || []).forEach(h => { const p = plPartOf(h); if (p && !h.deleted) taken.add(p.project + '/' + p.node); });
    return ((pl && pl.planned) || []).filter(n => !taken.has(n.project + '/' + n.node));
  }
  // A new harness for a waiting PL Part: its name and number, its PL project's client project, and the
  // Part it was started from (summary.plPart), which PL links at its next sync.
  function startFromPl(h, part) {
    h.title = part.name || h.title;
    h.pn = part.number || '';
    h.project = part.clientProject || part.projectName || '';
    h.plPart = { project: part.project, node: part.node, at: new Date().toISOString() };   // `at`: when it was started, PL's tie-break
    return h;
  }
  // Only what Loom needs from a PL project: its name, and its Loom Parts with their place in the tree.
  function slimPl(doc) {
    if (!doc || typeof doc !== 'object' || !doc.meta || !doc.nodes || typeof doc.nodes !== 'object') return null;
    const str = v => (v == null || typeof v === 'object' ? '' : String(v));
    const nodes = doc.nodes, path = id => {
      const out = [], seen = {};
      for (let n = nodes[nodes[id] && nodes[id].parent]; n && !seen[n.id]; n = nodes[n.parent]) { seen[n.id] = 1; if (!n.deleted) out.unshift(str(n.name)); }
      return out;
    };
    const loomParts = Object.keys(nodes).map(k => nodes[k]).filter(n => n && !n.deleted && n.kind !== 'assembly' && n.source === 'loom');
    const parts = loomParts.filter(n => n.ref && n.ref.tool === 'loom' && typeof n.ref.id === 'string')
      .map(n => ({ ref: n.ref.id, node: str(n.id), name: str(n.name), number: str(n.number), identAt: str(n.identAt), path: path(n.id) }));
    const planned = loomParts.filter(n => !n.ref && n.id)
      .map(n => ({ node: str(n.id), name: str(n.name), number: str(n.number), path: path(n.id) }));
    // The client project as PL matches it (app.js clientProjectOf): the PL project's name when unset.
    const clientProject = str(doc.meta.clientProject).trim() || str(doc.meta.name).trim();
    return { id: str(doc.id), slug: str(doc.slug), name: str(doc.meta.name), clientProject, archived: !!doc.meta.archived || !!doc.meta.deleted, parts, planned };
  }

  // A name or part number edited in Signoff PL more recently than in Loom comes over. Returns true when
  // it changed the harness. Pure, for tests.
  function adoptFromPl(h, parts) {
    const newest = (parts || []).filter(p => p.identAt).sort((a, b) => b.identAt.localeCompare(a.identAt))[0];
    if (!newest || newest.identAt <= (h.identAt || '')) return false;
    const changed = (newest.name && newest.name !== h.title) || newest.number !== (h.pn || '');
    if (newest.name) h.title = newest.name;
    h.pn = newest.number;
    h.identAt = newest.identAt;
    return !!changed;
  }

  // ── The drawing, for Signoff PL ──
  // A harness with wires keeps a picture of its wiring diagram next to it, in the repo it lives in, laid
  // out as Fabcheck stores a board's (ee_design_review/docs/fabcheck-link.md, "Board previews"), so PL's
  // reader shows it on the harness's tiles as it shows a board's (signoff_pl config `previews`):
  //   drawing/<id>/preview/index.json  { v, tool: 'loom', id, src, hero: 'diagram', images: [{ key, file, type, w, h }] }
  //   drawing/<id>/preview/diagram.png       on white, for a light page
  //   drawing/<id>/preview/diagram-dark.png  the same drawn for a dark page; PL shows the one for its theme
  //                                          (an image keyed '<key>-dark' is <key>'s dark twin)
  // `src` is a hash of both SVGs. This browser remembers what it put where (`drawings`, by
  // 'owner/repo|id'), so a picture is drawn again only when the diagram changed, or when the harness
  // moved to another repo (shared). With no wires, or deleted, its picture goes. index.json carries no
  // time, so a second browser drawing the same PNG commits nothing (putFiles skips equal files).
  // thumb: { svg(h) → { svg, dark, w, h }, png({ svg, w, h }) → Promise<{ bytes, type, w, h } | null> }, from app.js.
  const DRAWING_DIR = 'drawing/';
  const drawingPaths = id => ({ index: DRAWING_DIR + id + '/preview/index.json', png: DRAWING_DIR + id + '/preview/diagram.png', dark: DRAWING_DIR + id + '/preview/diagram-dark.png' });
  async function storeDrawings(harnesses, homes, thumb, mk, errors) {
    const done = read('drawings', {}), next = {}, byRepo = {};
    const add = (full, f, key, val) => { const r = byRepo[full] = byRepo[full] || { files: [], keys: {} }; r.files.push(...f); r.keys[key] = val; };
    for (const id of Object.keys(harnesses)) {
      const h = harnesses[id], full = homes[id];
      if (!full) continue;
      const key = full + '|' + id, p = drawingPaths(id);
      if (h.deleted || !h.wires.length) {
        if (done[key]) add(full, [p.index, p.png, p.dark].map(path => ({ path, remove: true })), key, null);
        continue;
      }
      try {
        const d = thumb.svg(h), src = fnv(d.svg + d.dark);
        if (done[key] === src) { next[key] = src; continue; }
        const img = await thumb.png({ svg: d.svg, w: d.w, h: d.h }), dk = await thumb.png({ svg: d.dark, w: d.w, h: d.h });
        if (!img || !dk || img.type !== 'image/png' || dk.type !== 'image/png') throw new Error('the picture couldn’t be drawn');
        const index = { v: 1, tool: 'loom', id, src, hero: 'diagram', images: [
          { key: 'diagram', file: 'diagram.png', type: img.type, w: img.w, h: img.h },
          { key: 'diagram-dark', file: 'diagram-dark.png', type: dk.type, w: dk.w, h: dk.h }] };
        add(full, [{ path: p.png, bytes: img.bytes }, { path: p.dark, bytes: dk.bytes }, { path: p.index, text: stable(index) + '\n' }], key, src);
      } catch (e) {
        if (done[key]) next[key] = done[key];
        errors.push({ repo: full, message: (h.title || 'A harness') + ': drawing for Signoff PL not stored (' + e.message + ')' });
      }
    }
    for (const full of Object.keys(byRepo)) {
      const r = byRepo[full];
      try {
        await mk(full).putFiles(r.files, { message: 'Loom: harness drawings for Signoff PL' });
        Object.keys(r.keys).forEach(k => { if (r.keys[k]) next[k] = r.keys[k]; });
      } catch (e) {
        Object.keys(r.keys).forEach(k => { if (done[k]) next[k] = done[k]; });
        errors.push({ repo: full, message: full + ': drawings for Signoff PL not stored (' + e.message + ')' });
      }
    }
    write('drawings', next);
  }

  // ── Sync ──
  // store: { id: harness } (the app's S.store; demo harnesses never sync). Resolves
  // { store, pushed, conflicts: [harness copies], gone: [ids], dropped: [ids], errors, pl, login,
  //   access: 'fte' | 'contractor', homes: { id: 'owner/repo' }, commitUrl }.
  const SGM = () => SG.model;
  const denied = e => e && (e.status === 404 || e.status === 403);
  async function sync(local, opts) {
    opts = opts || {};
    const cfg = config(), tok = opts.token || token(), fetchImpl = opts.fetch;
    if (!tok) { const e = new Error('Not signed in'); e.code = 'signin'; throw e; }
    const tag = SGM().tokenTag(tok);
    let who = read('who', {});
    const mk = (full, extra) => new SG.GitHubStore(Object.assign({ owner: full.split('/')[0], repo: full.split('/')[1], branch: 'main', dataPath: '', token: tok, summarize }, extra || {}), fetchImpl);
    const dataFull = cfg.owner + '/' + cfg.dataRepo;
    const data = mk(dataFull);
    if (who.tag !== tag || !who.login) { const u = await data.user(); who = { tag, login: u.login, access: '' }; write('who', who); }

    // Signoff PL first, so names and part numbers edited there go up in this sync. A token that can't
    // read PL (or no PL repo) just skips it.
    let pl = read('pl', null);
    try { pl = await readPl(cfg, tok, fetchImpl); write('pl', pl); } catch (e) { if (e.status !== 404 && e.status !== 403) console.warn('Loom: Signoff PL not read', e); }
    const adopted = [];
    Object.keys(local).forEach(id => {
      const h = local[id];
      if (h.demoVersion || !pl || !adoptFromPl(h, pl.links[id])) return;
      h.updated = Date.now(); h.updatedBy = who.login; adopted.push(id);
    });

    const synced = read('synced', {});
    const isDirty = id => !synced[id] || synced[id] !== hash(local[id]);
    const conflicts = [];
    const cfgMerge = makeMerge(isDirty, lose => {
      const h = unwrap(JSON.parse(JSON.stringify(lose)));
      if (!h) return;
      // A copy names no Signoff PL Part: only the harness started from it may take the link.
      h.id = LM.util.uid('h'); h.title = h.title + ' (conflict copy)'; h.updated = Date.now(); delete h.plPart;
      conflicts.push(h);
    });
    // Whatever wins, meta is derived again from its harness, so a file never carries stale meta.
    data.cfg.merge = (l, r) => {
      const d = cfgMerge(l, r), h = d && unwrap(JSON.parse(JSON.stringify(d)));
      return h ? envelope(h) : d;
    };
    const before = {}, docs = {};
    Object.keys(local).forEach(id => { if (local[id].demoVersion) return; before[id] = hash(local[id]); docs[id] = envelope(local[id]); });
    const merge = data.cfg.merge;

    // Which repo each harness syncs with: the shared map first, then where it last synced from.
    let roster = read('roster', null) || SGM().emptyRoster();
    const homes = read('homes', {}), caches = read('caches', {});
    const homeOf = id => SGM().sharedRepo(roster, id) || homes[id] || dataFull;
    const subset = full => { const o = {}; Object.keys(docs).forEach(id => { if (homeOf(id).toLowerCase() === full.toLowerCase()) o[id] = docs[id]; }); return o; };
    const merged = {}, gone = [], dropped = [], errors = [];
    let pushed = 0, commitUrl = '', access = '';
    const absorb = (res, full) => {
      Object.keys(res.projects).forEach(id => { merged[id] = res.projects[id]; homes[id] = full; });
      caches[full] = res.cache; pushed += res.pushed; if (res.commitUrl) commitUrl = res.commitUrl;
      (res.gone || []).forEach(id => { delete homes[id]; if (!gone.includes(id)) gone.push(id); });
    };
    const drop = id => { if (!dropped.includes(id)) dropped.push(id); delete homes[id]; };
    const syncOpts = extra => Object.assign({ dropGone: true, keepLocal: isDirty, message: opts.message || 'Loom: sync harnesses', onRetry: opts.onRetry }, extra);

    // 1. The data repo, with the roster: FTEs only.
    try {
      const res = await data.sync(subset(dataFull), roster, caches[dataFull], syncOpts({ roster: true, deleteStrays: true, belongsHere: (id, r) => !SGM().sharedRepo(r, id) }));
      access = 'fte'; roster = res.roster; absorb(res, dataFull);
      res.moved.forEach(id => { homes[id] = SGM().sharedRepo(roster, id); });
    } catch (e) {
      // The owner, or a token that opened the data repo before, has a settings problem, not a share.
      if (!denied(e) || who.login.toLowerCase() === cfg.owner.toLowerCase() || who.access === 'fte') throw e;
      access = 'contractor'; roster = SGM().emptyRoster();
    }
    // 2. The shared repos: from the shared map for an FTE, listed by prefix for anyone else.
    let repos;
    if (access === 'fte') {
      repos = [...new Set(Object.keys(roster.shared || {}).map(id => SGM().sharedRepo(roster, id)).filter(Boolean))];
    } else {
      const names = await new SG.GitHubAccount(tok, fetchImpl).listRepos(cfg.owner, cfg.prefix);
      repos = names.map(n => cfg.owner + '/' + n);
      if (!repos.length) { const e = new Error(dataFull + ' not found, or your token can’t open it.'); e.status = 404; throw e; }
      // A copy whose repo this token can no longer reach is dropped, unless it has unsynced edits.
      Object.keys(docs).forEach(id => { if (!repos.includes(homeOf(id)) && !isDirty(id)) drop(id); });
    }
    for (const full of repos) {
      const mine = access === 'fte' ? id => SGM().sharedRepo(roster, id).toLowerCase() === full.toLowerCase() : undefined;
      try {
        absorb(await mk(full, { merge }).sync(subset(full), null, caches[full], syncOpts({ belongsHere: mine })), full);
      } catch (e) {
        if (denied(e) && access !== 'fte') Object.keys(subset(full)).forEach(id => { if (!isDirty(id)) drop(id); });
        else errors.push({ repo: full, message: denied(e) ? 'No access to ' + full + ' yet. The repo owner needs to invite you.' : full + ': ' + e.message });
      }
    }
    const out = {};
    const nextSynced = {};
    Object.keys(merged).forEach(id => {
      const h = unwrap(merged[id]);
      if (!h) return;
      out[id] = h;
      nextSynced[id] = hash(h);
    });
    // 3. Each harness's drawing as a picture for Signoff PL, in the repo it now lives in. A failure here
    // is reported and never fails the sync.
    if (opts.thumb) await storeDrawings(out, homes, opts.thumb, mk, errors);
    // Caches of repos nothing here uses any more are forgotten.
    const used = new Set([dataFull, ...repos, ...Object.values(homes)]);
    Object.keys(caches).forEach(r => { if (!used.has(r)) delete caches[r]; });
    Object.keys(homes).forEach(id => { if (!out[id]) delete homes[id]; });
    write('caches', caches); write('homes', homes); write('roster', roster);
    write('who', Object.assign(who, { access }));
    write('synced', nextSynced);
    write('lastSync', { at: new Date().toISOString(), commitUrl: commitUrl || '', errors });
    return { store: out, before, pushed, conflicts, gone, dropped, errors, adopted, pl, login: who.login, access, homes: Object.assign({}, homes), commitUrl };
  }

  // Harnesses changed since this browser's last sync (never synced counts).
  function unsynced(store) {
    const synced = read('synced', {});
    return Object.keys(store).filter(id => !store[id].demoVersion && (!synced[id] || synced[id] !== hash(store[id])));
  }
  const wasSynced = id => !!read('synced', {})[id];
  // Forget what the last sync knew about these harnesses, so the next one fetches them again and merges
  // them as edited here. For a harness edited while a sync brought in someone else's change: without
  // this, the next sync would see an unchanged file and push the local edit over that change.
  function forget(ids) {
    const c = read('caches', {}), s = read('synced', {});
    ids.forEach(id => { Object.keys(c).forEach(r => { delete c[r]['projects/' + id + '.json']; }); delete s[id]; });
    write('caches', c); write('synced', s);
  }
  // The repo a harness lives in ('owner/repo'), and whether it is a shared one.
  const homeOf = id => { const r = read('roster', null); return (r && SGM().sharedRepo(r, id)) || read('homes', {})[id] || ''; };
  const isShared = id => { const h = homeOf(id), c = config(); return !!h && h.toLowerCase() !== (c.owner + '/' + c.dataRepo).toLowerCase(); };

  LM.store = {
    DEMO, setNamespace: ns => { NS = ns; }, config, token, signedIn: () => !!token(), envelope, unwrap, summarize, makeMerge, slimPl, plIndex, waiting, startFromPl, adoptFromPl, hash,
    sync, storeDrawings, DRAWING_DIR, unsynced, wasSynced, forget, homeOf, isShared, pl: () => read('pl', null), lastSync: () => read('lastSync', null), login: () => read('who', {}).login || '',
    access: () => read('who', {}).access || '',
  };
})(window.LM = window.LM || {});
