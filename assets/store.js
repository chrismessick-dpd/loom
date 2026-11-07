// Loom's harnesses on GitHub. One private data repo (`loom_data`) holds every harness as
// projects/<harness id>.json, synced with the Signoff engine's GitHubStore (assets/vendor/github.js):
// pull, merge, push one commit with force:false, retry when someone pushed first. Each file is an
// envelope round the harness, shaped like a Signoff review so Signoff PL reads it as any other design:
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
  const DEFAULTS = { owner: 'chrismessick-dpd', dataRepo: 'loom_data', plRepo: 'signoff_pl_data' };

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
  function hash(h) {
    const s = stable(h);
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
      const lt = local.meta.updatedAt || '', rt = remote.meta.updatedAt || '';
      const win = lt > rt ? local : remote;
      onConflict(win === local ? remote : local, win);
      return win;
    };
  }

  // ── Signoff PL (read only) ──
  // Every PL project (name, client project) and every live PL Part linking a Loom harness.
  async function readPl(cfg, tok, fetchImpl) {
    const store = new SG.GitHubStore({ owner: cfg.owner, repo: cfg.plRepo, branch: 'main', dataPath: '', token: tok }, fetchImpl);
    const cache = read('plCache', {});
    const snap = await store.snapshot();
    const next = {}, projects = [], links = {};
    const files = snap.entries.filter(e => e.type === 'blob' && /^projects\/[^/]+\.json$/.test(e.path));
    for (const e of files) {
      let doc = cache[e.path] && cache[e.path].sha === e.sha ? cache[e.path].doc : null;
      if (!doc) { try { doc = JSON.parse(await store.blob(e.sha)); } catch (err) { continue; } }
      const slim = slimPl(doc);
      if (!slim) continue;
      next[e.path] = { sha: e.sha, doc: slim };
      if (slim.archived) continue;
      projects.push({ id: slim.id, slug: slim.slug, name: slim.name, clientProject: slim.clientProject });
      slim.parts.forEach(n => { (links[n.ref] = links[n.ref] || []).push(Object.assign({ project: slim.id, slug: slim.slug, projectName: slim.name }, n)); });
    }
    write('plCache', next);
    projects.sort((a, b) => a.name.localeCompare(b.name));
    return { at: new Date().toISOString(), projects, links };
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
    const parts = Object.keys(nodes).map(k => nodes[k]).filter(n => n && !n.deleted && n.source === 'loom' && n.ref && n.ref.tool === 'loom' && typeof n.ref.id === 'string')
      .map(n => ({ ref: n.ref.id, node: str(n.id), name: str(n.name), number: str(n.number), identAt: str(n.identAt), path: path(n.id) }));
    return { id: str(doc.id), slug: str(doc.slug), name: str(doc.meta.name), clientProject: str(doc.meta.clientProject), archived: !!doc.meta.archived, parts };
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

  // ── Sync ──
  // store: { id: harness } (the app's S.store; demo harnesses never sync). Resolves
  // { store, pushed, conflicts: [harness copies], gone: [ids], pl, login, commitUrl }.
  async function sync(local, opts) {
    opts = opts || {};
    const cfg = config(), tok = opts.token || token(), fetchImpl = opts.fetch;
    if (!tok) { const e = new Error('Not signed in'); e.code = 'signin'; throw e; }
    const tag = SG.model.tokenTag(tok);
    let who = read('who', {});
    const data = new SG.GitHubStore({ owner: cfg.owner, repo: cfg.dataRepo, branch: 'main', dataPath: '', token: tok, summarize }, fetchImpl);
    if (who.tag !== tag || !who.login) { const u = await data.user(); who = { tag, login: u.login }; write('who', who); }

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
      h.id = LM.util.uid('h'); h.title = h.title + ' (conflict copy)'; h.updated = Date.now();
      conflicts.push(h);
    });
    // Whatever wins, meta is derived again from its harness, so a file never carries stale meta.
    data.cfg.merge = (l, r) => {
      const d = cfgMerge(l, r), h = d && unwrap(JSON.parse(JSON.stringify(d)));
      return h ? envelope(h) : d;
    };
    const before = {}, docs = {};
    Object.keys(local).forEach(id => { if (local[id].demoVersion) return; before[id] = hash(local[id]); docs[id] = envelope(local[id]); });
    const res = await data.sync(docs, null, read('cache', {}), {
      dropGone: true, keepLocal: isDirty,
      message: opts.message || 'Loom: sync harnesses',
      onRetry: opts.onRetry,
    });
    const out = {};
    const nextSynced = {};
    Object.keys(res.projects).forEach(id => {
      const h = unwrap(res.projects[id]);
      if (!h) return;
      out[id] = h;
      nextSynced[id] = hash(h);
    });
    write('cache', res.cache);
    write('synced', nextSynced);
    write('lastSync', { at: new Date().toISOString(), commitUrl: res.commitUrl || '' });
    return { store: out, before, pushed: res.pushed, conflicts, gone: res.gone || [], adopted, pl, login: who.login, commitUrl: res.commitUrl };
  }

  // Harnesses changed since this browser's last sync (never synced counts).
  function unsynced(store) {
    const synced = read('synced', {});
    return Object.keys(store).filter(id => !store[id].demoVersion && (!synced[id] || synced[id] !== hash(store[id])));
  }
  const wasSynced = id => !!read('synced', {})[id];

  LM.store = {
    DEMO, setNamespace: ns => { NS = ns; }, config, token, signedIn: () => !!token(), envelope, unwrap, summarize, makeMerge, slimPl, adoptFromPl, hash,
    sync, unsynced, wasSynced, pl: () => read('pl', null), lastSync: () => read('lastSync', null), login: () => read('who', {}).login || '',
  };
})(window.LM = window.LM || {});
