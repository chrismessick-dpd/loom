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
// merged record by record without breaking it: it's whole-document and three-way, as Signoff EE's Scribe
// merge (Chris, 2026-11-14, after a stale tab wrote false conflict copies of three systems). Every edit
// stamps the document (updated, updatedBy), and each copy here carries the stamp of the version it was
// last synced from (`syncBase`, on the document itself, so a stale tab keeps its own and never borrows
// a newer tab's; never uploaded). Edited here means its stamp moved off that base, never that its bytes
// differ (the system drawing writes derived block sizes as it draws). Then: not edited here → GitHub's
// is taken and nothing is written; GitHub's still the base → ours; both moved on → the newer wins and the
// other is kept as a new document named "(conflict copy)" with `conflictOf`, so nothing is lost and
// Resolve (assets/resolve.js) can settle it in one step.
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
  // The sync bookkeeping a document carries here and never uploads: the stamp of the version it was last
  // synced from (`syncBase`).
  const BASE = 'syncBase';
  const bare = d => { if (!d || typeof d !== 'object' || !(BASE in d)) return d; const c = Object.assign({}, d); delete c[BASE]; return c; };
  // A document's stamp: who changed it last and when. Every edit sets it (app.js and system.js change(),
  // drags, Restore); nothing drawn or derived does.
  const stampKey = d => (Number(d && d.updated) || 0) + '|' + String((d && d.updatedBy) || '');
  // A short hash of a harness as stored, to tell whether it changed since the last sync.
  const hash = h => fnv(stable(bare(h)));
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
      harness: bare(h),
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

  // The three-way merge of two envelopes of one document (body: the harness or system in it), against
  // the stamp this copy was last synced from (opts.base: '' when unknown). Untouched here → GitHub's;
  // untouched there → ours; changed on both → the newer wins and the other comes back through onConflict
  // to be kept as a copy. Copies equal apart from bookkeeping, or with one stamp (one version, drawn
  // differently), take GitHub's. Pure, for tests.
  function threeWay(local, remote, opts, body, onConflict) {
    if (!local) return remote;
    if (!remote) return local;
    const L = body(local), Rm = body(remote);
    if (!L) return remote;
    if (!Rm) return local;
    if (stable(bare(L)) === stable(bare(Rm))) return remote;
    const lk = stampKey(L), rk = stampKey(Rm), base = opts && opts.base;
    if (lk === rk) return remote;
    if (base && lk === base) return remote;
    if (base && rk === base) return local;
    // By the document's own clock, not the derived meta, which a file could carry stale.
    const win = (Number(L.updated) || 0) > (Number(Rm.updated) || 0) ? local : remote;
    onConflict(win === local ? remote : local, win);
    return win;
  }
  // The harness merge GitHubStore calls: merge(local, remote, mergeOpts(id)).
  function makeMerge(onConflict) {
    return (local, remote, opts) => threeWay(local, remote, opts, d => d && d.harness, onConflict);
  }
  // A losing copy kept as its own document: a new id, "(conflict copy)", and what it's a copy of
  // (`conflictOf`: id, title, and when), which Resolve reads. It names no Signoff PL Part (only the
  // document started from it may take the link) and was never synced.
  function conflictCopy(lose, win, prefix, fallback) {
    const c = JSON.parse(JSON.stringify(bare(lose)));
    c.id = LM.util.uid(prefix); c.title = (c.title || fallback) + ' (conflict copy)'; c.updated = Date.now();
    c.conflictOf = { id: win.id, title: win.title || fallback, at: new Date().toISOString() };
    delete c.plPart; delete c[BASE];
    return c;
  }

  // ── What this browser last synced ──
  // The blob cache (which file versions the last sync saw) is shared by every tab, but each copy is only
  // as new as its own base: a tab left open while another synced holds older copies, and trusting the
  // cache would keep them ("unchanged") and later push an edit made on one over the newer file. So a
  // copy whose base isn't the version the cache recorded (`stamps`, written with the cache) has its cache
  // entry dropped, and the sync reads that file again and merges it three-way. No record yet (a sync
  // from before 2026-11-14): the cache is trusted, as before.
  const stampsOf = docs => { const o = {}; Object.keys(docs).forEach(id => { o[id] = stampKey(docs[id]); }); return o; };
  function trustCache(cache, stamps, local, kind, pathOf, perRepo) {
    if (!stamps || !cache) return;
    Object.keys(local).forEach(id => {
      const d = local[id];
      if (!d || d.demoVersion || !stamps[id] || baseOf(kind, d) === stamps[id]) return;
      if (perRepo) Object.keys(cache).forEach(r => { if (cache[r]) delete cache[r][pathOf(id)]; });
      else delete cache[pathOf(id)];
    });
  }
  // The base stamp of a local copy: its own syncBase, or '' (never synced here, or kept before syncBase
  // existed, 2026-11-14). Only a copy's own base is a base: the kept copies of the last sync (`base`,
  // IndexedDB) are shared by every tab, so one tab's newer copy would make another tab's older copy look
  // edited on top of it, and push it over the newer file.
  function baseOf(kind, d) {
    return d && typeof d[BASE] === 'string' && d[BASE] ? d[BASE] : '';
  }
  // The stamp of the kept copy of what the last sync left (harnesses: localStorage `base`, read once while
  // it doesn't change; systems: IndexedDB, read at start).
  let keptMemo = { raw: null, map: {} };
  function keptStamp(kind, id) {
    if (kind === 'system') return sysStamps[id] || '';
    if (kind === 'formboard') return '';
    let raw = null;
    try { raw = localStorage.getItem(NS + 'base'); } catch (e) { raw = null; }
    if (raw !== keptMemo.raw) {
      const map = {};
      try { const all = JSON.parse(raw || '{}') || {}; Object.keys(all).forEach(k => { map[k] = stampKey(all[k]); }); } catch (e) { /* none */ }
      keptMemo = { raw, map };
    }
    return keptMemo.map[id] || '';
  }
  // Whether this browser has edits to a document that its last sync didn't take (never synced counts).
  // With a base: its stamp moved off it. Without one (a copy from before syncBase): unedited when its stamp
  // is the kept copy's, or its bytes are what the last sync recorded, or it was stamped before that sync
  // finished (Signoff EE's `since`); else edited, with no base, so the merge makes a copy, never an overwrite.
  function edited(kind, d) {
    if (!d) return false;
    const b = baseOf(kind, d);
    if (b) return stampKey(d) !== b;
    const kept = keptStamp(kind, d.id);
    if (kept && kept === stampKey(d)) return false;
    const pre = kind === 'system' ? 'sys' : kind === 'formboard' ? 'fb' : '';
    const synced = read(pre ? pre + 'Synced' : 'synced', {})[d.id];
    if (!synced) return true;
    if (synced === hash(d)) return false;
    const last = read(pre ? pre + 'LastSync' : 'lastSync', null), at = last && Date.parse(last.at);
    return !(at > 0 && (Number(d.updated) || 0) < at);
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
  const DRAW_MAX = 15;
  async function storeDrawings(harnesses, homes, thumb, mk, errors) {
    const done = read('drawings', {}), next = {}, byRepo = {};
    const add = (full, f, key, val) => { const r = byRepo[full] = byRepo[full] || { files: [], keys: {} }; r.files.push(...f); r.keys[key] = val; };
    // At most DRAW_MAX new drawings a sync (Chris, 2026-11-12: 68 new harnesses at once, about 200 uploads,
    // hit GitHub's limit on creating content quickly, and every sync retried them all): the rest go up at the
    // next syncs, as nothing records them yet.
    let fresh = 0;
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
        if (++fresh > DRAW_MAX) { if (done[key]) next[key] = done[key]; continue; }
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
    // Systems sync right after harnesses, so until a systems sync records its own time, the last harness
    // sync's (a little earlier, so it errs toward a copy) bounds their "stamped before the last sync".
    if (!read('sysLastSync', null) && read('lastSync', null)) write('sysLastSync', { at: read('lastSync', null).at });
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

    // Read once, as the sync starts: what's edited here and the base each copy was synced from (an edit
    // made while the sync runs is the app's to keep, app.js syncNow).
    const before = {}, beforeStamp = {}, docs = {}, isEdited = {}, bases = {};
    Object.keys(local).forEach(id => {
      const h = local[id];
      if (h.demoVersion) return;
      before[id] = hash(h); beforeStamp[id] = stampKey(h); isEdited[id] = edited('harness', h); bases[id] = baseOf('harness', h);
      docs[id] = envelope(JSON.parse(JSON.stringify(h)));
    });
    const isDirty = id => !!isEdited[id];
    const conflicts = [];
    const cfgMerge = makeMerge((lose, win) => {
      const l = unwrap(JSON.parse(JSON.stringify(lose))), w = unwrap(JSON.parse(JSON.stringify(win)));
      if (l && w) conflicts.push(conflictCopy(l, w, 'h', 'Untitled harness'));
    });
    // Whatever wins, meta is derived again from its harness, so a file never carries stale meta.
    data.cfg.merge = (l, r, o) => {
      const d = cfgMerge(l, r, o), h = d && unwrap(JSON.parse(JSON.stringify(d)));
      return h ? envelope(h) : d;
    };
    const merge = data.cfg.merge;

    // Which repo each harness syncs with: the shared map first, then where it last synced from.
    let roster = read('roster', null) || SGM().emptyRoster();
    const homes = read('homes', {}), caches = read('caches', {});
    trustCache(caches, read('stamps', null), local, 'harness', id => 'projects/' + id + '.json', true);
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
    // edited: a copy with no edits here takes GitHub's file as it is and never writes it (the engine's
    // guard). mergeOpts: the base for the three-way merge.
    const syncOpts = extra => Object.assign({ dropGone: true, keepLocal: isDirty, edited: isDirty, mergeOpts: id => ({ base: bases[id] || '' }),
      message: opts.message || 'Loom: sync harnesses', onRetry: opts.onRetry }, extra);

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
      delete h[BASE];
      h[BASE] = stampKey(h);   // what this copy now derives from
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
    write('stamps', stampsOf(out));
    // Each harness as the repo has it now, for Discard changes (base).
    write('base', out);
    write('lastSync', { at: new Date().toISOString(), commitUrl: commitUrl || '', errors });
    return { store: out, before, beforeStamp, pushed, conflicts, gone, dropped, errors, adopted, pl, login: who.login, access, homes: Object.assign({}, homes), commitUrl };
  }

  // ── Systems (assets/system.js, docs/system.md) ──
  // Kept in the data repo under systems/ (the engine's layout under a data path: systems/projects/<id>.json),
  // apart from projects/, which Signoff PL reads as harnesses. FTEs only for now: a token that can't
  // open the data repo skips them. Whole-system, three-way merge with a "(conflict copy)", as for harnesses.
  function sysEnvelope(s) {
    return { schema: 1, id: s.id,
      meta: { name: s.title || 'Untitled system', number: '', revision: s.rev || '', project: s.project || '', deleted: !!s.deleted, updatedAt: iso(s.updated), updatedBy: s.updatedBy || '' },
      system: bare(s) };
  }
  async function syncSystems(local, getHarness, opts) {
    opts = opts || {};
    const cfg = config(), tok = opts.token || token();
    if (!tok) return null;
    const Sy = LM.system;
    await sysStampsReady();
    const docs = {}, before = {}, beforeStamp = {}, isEdited = {}, bases = {};
    Object.keys(local).forEach(id => {
      const s = local[id];
      if (s.demoVersion) return;
      before[id] = hash(s); beforeStamp[id] = stampKey(s); isEdited[id] = edited('system', s); bases[id] = baseOf('system', s);
      docs[id] = sysEnvelope(JSON.parse(JSON.stringify(s)));
    });
    const isDirty = id => !!isEdited[id];
    const conflicts = [];
    const store = new SG.GitHubStore({ owner: cfg.owner, repo: cfg.dataRepo, branch: 'main', dataPath: 'systems', token: tok,
      summarize: doc => doc.system ? Sy.summarize(doc.system, getHarness) : undefined }, opts.fetch);
    store.cfg.merge = (l, r, o) => {
      const d = threeWay(l, r, o, x => x && x.system, (lose, win) => conflicts.push(conflictCopy(lose.system, win.system, 's', 'System')));
      return d && d.system ? sysEnvelope(d.system) : d;
    };
    let res;
    try {
      const sysCache = read('sysCache', null);
      if (sysCache) trustCache(sysCache, read('sysStampsAt', null), local, 'system', id => 'systems/projects/' + id + '.json', false);
      res = await store.sync(docs, null, sysCache, { dropGone: true, keepLocal: isDirty, edited: isDirty,
        mergeOpts: id => ({ base: bases[id] || '' }), message: opts.message || 'Loom: sync systems' });
    } catch (e) { if (denied(e)) return null; throw e; }
    const out = {}, next = {};
    Object.keys(res.projects).forEach(id => {
      const s = res.projects[id] && res.projects[id].system;
      if (!s || s.id !== id) return;
      try { const n = Sy.normalize(JSON.parse(JSON.stringify(s))); delete n[BASE]; n[BASE] = stampKey(n); out[id] = n; next[id] = hash(n); } catch (e) { /* not a system */ }
    });
    write('sysCache', res.cache); write('sysSynced', next); write('sysStampsAt', stampsOf(out)); write('sysLastSync', { at: new Date().toISOString() });
    await keepSysBase(out);
    return { store: out, before, beforeStamp, conflicts, gone: res.gone || [], pushed: res.pushed };
  }
  // Each system as the last sync left it, for Discard changes (Chris, 2026-11-12). Kept in IndexedDB
  // (one record per storage namespace), not localStorage: a big system is about half a megabyte, and a
  // second copy there would crowd out the systems themselves (writes that don't fit are dropped). known
  // holds each kept copy's hash, read at start (loadSysBase), so the toolbar can ask without waiting.
  const SYS_DB = 'loom-sysbase';
  let sysKnown = {}, sysStamps = {}, sysLoaded = null;
  function sysDb() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('no IndexedDB')); return; }
      const r = indexedDB.open(SYS_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('base');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function sysDbDo(mode, fn) {
    const db = await sysDb();
    return new Promise((res, rej) => {
      const t = db.transaction('base', mode), req = fn(t.objectStore('base'));
      t.oncomplete = () => { db.close(); res(req && req.result); };
      t.onerror = () => { db.close(); rej(t.error); };
    });
  }
  async function keepSysBase(out) {
    try { await sysDbDo('readwrite', st => st.put(out, NS)); sysKnown = {}; sysStamps = {}; Object.keys(out).forEach(id => { sysKnown[id] = hash(out[id]); sysStamps[id] = stampKey(out[id]); }); }
    catch (e) { sysKnown = {}; sysStamps = {}; }
  }
  // The kept copies' hashes, and their stamps: the base of a system kept before syncBase existed.
  function loadSysBase() {
    sysLoaded = (async () => {
      try { const all = (await sysDbDo('readonly', st => st.get(NS))) || {}; sysKnown = {}; sysStamps = {}; Object.keys(all).forEach(id => { sysKnown[id] = hash(all[id]); sysStamps[id] = stampKey(all[id]); }); }
      catch (e) { sysKnown = {}; sysStamps = {}; }
    })();
    return sysLoaded;
  }
  const sysStampsReady = () => sysLoaded || loadSysBase();
  // Whether a system's last synced copy is kept here (and is the one that sync recorded).
  const hasSysBase = id => !!sysKnown[id] && sysKnown[id] === read('sysSynced', {})[id];
  // That copy, or null.
  async function sysBase(id) {
    if (!hasSysBase(id)) return null;
    try { const all = (await sysDbDo('readonly', st => st.get(NS))) || {}; const b = all[id]; return b && hash(b) === read('sysSynced', {})[id] ? JSON.parse(JSON.stringify(b)) : null; }
    catch (e) { return null; }
  }
  // The exact file the last sync saw, read from GitHub (Chris, 2026-11-12: Discard changes on whatever page
  // is open, even when this browser kept no copy, as after a sync on an older version): the sync cache
  // holds each file's blob sha as of that sync, so this is that version, even if the repo has a newer one.
  function syncedEntry(kind, id) {
    const c = config();
    if (kind === 'system') { const e = read('sysCache', {})['systems/projects/' + id + '.json']; return e && e.sha ? { full: c.owner + '/' + c.dataRepo, sha: e.sha } : null; }
    const full = homeOf(id) || (c.owner + '/' + c.dataRepo), e = (read('caches', {})[full] || {})['projects/' + id + '.json'];
    return e && e.sha ? { full, sha: e.sha } : null;
  }
  async function syncedFromRepo(kind, id, opts) {
    opts = opts || {};
    const e = syncedEntry(kind, id), tok = opts.token || token();
    if (!e || !tok) return null;
    const st = new SG.GitHubStore({ owner: e.full.split('/')[0], repo: e.full.split('/')[1], branch: 'main', dataPath: '', token: tok }, opts.fetch);
    const doc = JSON.parse(new TextDecoder().decode(await st.blobBytes(e.sha)));
    if (kind === 'system') { const s = doc && doc.system; return s && s.id === id ? LM.system.normalize(s) : null; }
    const h = unwrap(doc);
    return h && h.id === id ? h : null;
  }
  // Discard changes: whether there's a last synced version to go back to (kept here, or on GitHub), and
  // that version (null when there's none, or GitHub can't be reached).
  const canDiscard = (kind, id) => (kind === 'system' ? hasSysBase(id) : !!base(id)) || !!syncedEntry(kind, id);
  async function discardCopy(kind, id, opts) {
    const kept = kind === 'system' ? await sysBase(id) : base(id);
    return kept || syncedFromRepo(kind, id, opts);
  }
  // Systems with edits here the last sync didn't take (never synced counts): by stamp, not bytes, as the
  // drawing writes derived block sizes as it draws (edited).
  const sysUnsynced = store => Object.keys(store).filter(id => !store[id].demoVersion && edited('system', store[id]));

  // ── Formboards (docs/formboard.md, Chris, 2026-11-15) ──
  // Each formboard is formboards/projects/<id>.json in the data repo (the engine's layout under a data path,
  // as systems use systems/; never projects/, which Signoff PL reads as harnesses), merged three-way by its
  // stamp as systems are. Its reference (a STEP's mesh, a picture, or a DXF) goes up once, before the
  // document that names it, as formboards/refs/<its hash>.<ext>, split over 4 MB; the reference records the
  // file, its parts, and its SHA-256, and another browser reads it back checked (readFormboardRef).
  const FB_DIR = 'formboards/';
  function fbEnvelope(f) {
    return { schema: 1, id: f.id,
      meta: { name: f.title || 'Formboard', number: '', revision: '', project: '', system: f.system || '', deleted: !!f.deleted, updatedAt: iso(f.updated), updatedBy: f.updatedBy || '' },
      formboard: bare(f) };
  }
  const fbSummary = f => ({ v: 1, tool: 'loom', kind: 'formboard', system: f.system || '', reference: f.reference ? f.reference.kind : '',
    channels: (f.channels || []).length, placed: Object.keys(f.blocks || {}).length,
    routed: Object.values(f.cables || {}).filter(c => c && c.route && c.route.ok).length });
  const REF_EXT = { step: '.plm.gz', dxf: '.dxf' };
  const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
  // The references edited formboards name that aren't up yet: their bytes (getRef(ref) → Uint8Array |
  // null, from formboard.js's IndexedDB), one commit for all. Each one's record goes onto the formboard
  // before it's pushed. A failure fails the formboard sync, so a document never names a missing file.
  async function putRefs(store, local, ids, getRef) {
    const files = [], recs = [];
    for (const id of ids) {
      const r = local[id] && local[id].reference;
      if (!r || !r.sha || r.file || !(r.kind in REF_EXT || r.kind === 'image')) continue;
      const bytes = await getRef(r);
      if (!bytes) throw new Error((local[id].title || 'A formboard') + ': its reference isn’t in this browser to upload. Import it again.');
      const ext = REF_EXT[r.kind] || (/jpe?g$/i.test(r.name || '') ? '.jpg' : /webp$/i.test(r.name || '') ? '.webp' : '.png');
      const path = FB_DIR + 'refs/' + r.sha + ext, parts = SG.GitHubStore.splitParts(path, bytes);
      (parts || [{ path, bytes }]).forEach(f => files.push(f));
      recs.push({ r, rec: { file: path, parts: parts ? parts.map(x => x.path) : null, sha256: await sha256(bytes), bytes: bytes.length } });
    }
    if (!files.length) return 0;
    await store.putFiles(files, { message: 'Loom: formboard references' });
    recs.forEach(x => Object.assign(x.r, x.rec));
    return recs.length;
  }
  async function syncFormboards(local, opts) {
    opts = opts || {};
    const cfg = config(), tok = opts.token || token();
    if (!tok) return null;
    const docs = {}, beforeStamp = {}, isEdited = {}, bases = {};
    Object.keys(local).forEach(id => { const f = local[id]; if (f.demo) return; beforeStamp[id] = stampKey(f); isEdited[id] = edited('formboard', f); bases[id] = baseOf('formboard', f); });
    const isDirty = id => !!isEdited[id];
    const conflicts = [];
    const store = new SG.GitHubStore({ owner: cfg.owner, repo: cfg.dataRepo, branch: 'main', dataPath: 'formboards', token: tok,
      summarize: doc => (doc.formboard ? fbSummary(doc.formboard) : undefined) }, opts.fetch);
    store.cfg.merge = (l, r, o) => {
      const d = threeWay(l, r, o, x => x && x.formboard, (lose, win) => conflicts.push(conflictCopy(lose.formboard, win.formboard, 'f', 'Formboard')));
      return d && d.formboard ? fbEnvelope(d.formboard) : d;
    };
    let res, refs = 0;
    try {
      refs = await putRefs(store, local, Object.keys(beforeStamp).filter(isDirty), opts.getRef || (() => null));
      Object.keys(beforeStamp).forEach(id => { docs[id] = fbEnvelope(JSON.parse(JSON.stringify(local[id]))); });
      const cache = read('fbCache', null);
      if (cache) trustCache(cache, read('fbStampsAt', null), local, 'formboard', id => FB_DIR + 'projects/' + id + '.json', false);
      res = await store.sync(docs, null, cache, { dropGone: true, keepLocal: isDirty, edited: isDirty,
        mergeOpts: id => ({ base: bases[id] || '' }), message: opts.message || 'Loom: sync formboards' });
    } catch (e) { if (denied(e)) return null; throw e; }
    const out = {}, next = {};
    Object.keys(res.projects).forEach(id => {
      const f = res.projects[id] && res.projects[id].formboard;
      if (!f || f.id !== id) return;
      const n = JSON.parse(JSON.stringify(f)); delete n[BASE]; n[BASE] = stampKey(n); out[id] = n; next[id] = hash(n);
    });
    write('fbCache', res.cache); write('fbSynced', next); write('fbStampsAt', stampsOf(out)); write('fbLastSync', { at: new Date().toISOString() });
    return { store: out, beforeStamp, conflicts, gone: res.gone || [], pushed: res.pushed, refs };
  }
  // A reference another browser uploaded: its bytes, joined from its parts and checked against its SHA-256.
  async function readFormboardRef(ref, opts) {
    opts = opts || {};
    const cfg = config(), tok = opts.token || token();
    if (!tok || !ref || !ref.file || !ref.sha256) return null;
    const store = new SG.GitHubStore({ owner: cfg.owner, repo: cfg.dataRepo, branch: 'main', dataPath: 'formboards', token: tok }, opts.fetch);
    return store.readVerified(ref.parts && ref.parts.length ? ref.parts : ref.file, ref.sha256);
  }
  const fbUnsynced = store => Object.keys(store).filter(id => !store[id].demo && edited('formboard', store[id]));
  function forgetFormboards(ids) {
    const c = read('fbCache', {});
    ids.forEach(id => { delete c[FB_DIR + 'projects/' + id + '.json']; });
    write('fbCache', c);
  }
  // As forget, for systems edited while a sync brought someone else's change to them.
  function forgetSystems(ids) {
    const c = read('sysCache', {});
    ids.forEach(id => { delete c['systems/projects/' + id + '.json']; });
    write('sysCache', c);
  }

  // Harnesses changed since this browser's last sync (never synced counts).
  function unsynced(store) {
    return Object.keys(store).filter(id => !store[id].demoVersion && edited('harness', store[id]));
  }
  const wasSynced = id => !!read('synced', {})[id];
  // Forget what the last sync knew about these harnesses, so the next one fetches them again and merges
  // them as edited here. For a harness edited while a sync brought in someone else's change: without
  // this, the next sync would see an unchanged file and push the local edit over that change.
  function forget(ids) {
    const c = read('caches', {}), s = read('synced', {}), b = read('base', {});
    ids.forEach(id => { Object.keys(c).forEach(r => { delete c[r]['projects/' + id + '.json']; }); delete s[id]; delete b[id]; });
    write('caches', c); write('synced', s); write('base', b);
  }
  // A harness as the last sync left it (Chris, 2026-11-10: Discard changes), or null when this browser
  // has no copy that matches what that sync recorded.
  function base(id) {
    const b = read('base', {})[id], s = read('synced', {})[id];
    return b && s && hash(b) === s ? JSON.parse(JSON.stringify(b)) : null;
  }
  // The repo a harness lives in ('owner/repo'), and whether it is a shared one.
  const homeOf = id => { const r = read('roster', null); return (r && SGM().sharedRepo(r, id)) || read('homes', {})[id] || ''; };
  const isShared = id => { const h = homeOf(id), c = config(); return !!h && h.toLowerCase() !== (c.owner + '/' + c.dataRepo).toLowerCase(); };

  LM.store = {
    DEMO, setNamespace: ns => { NS = ns; }, config, token, signedIn: () => !!token(), envelope, unwrap, summarize, makeMerge, slimPl, plIndex, waiting, startFromPl, adoptFromPl, hash,
    sync, syncSystems, sysUnsynced, forgetSystems, syncFormboards, readFormboardRef, fbUnsynced, forgetFormboards, fbEnvelope, stampKey, edited, baseOf, threeWay, conflictCopy, bare, BASE, sysBase, hasSysBase, loadSysBase, canDiscard, discardCopy, storeDrawings, DRAWING_DIR, unsynced, wasSynced, forget, base, homeOf, isShared, pl: () => read('pl', null), lastSync: () => read('lastSync', null), login: () => read('who', {}).login || '',
    access: () => read('who', {}).access || '',
  };
})(window.LM = window.LM || {});
