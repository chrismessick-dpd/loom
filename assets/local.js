// Loom's working copies in IndexedDB (Chris, 2026-11-19: "start Loom's move", after Signoff EE's, ee_design_review
// assets/localstore.js). localStorage holds about 5 MB for the whole site, which every Signoff tool shares, and Loom's
// systems and harnesses alone were 2.8 million characters of it: a full one kept a sync's results from being saved.
//
// The big maps (harnesses, systems, formboards, and `base`, the harnesses as the last sync left them) live in one
// IndexedDB database per namespace, 'loom-local-' + ns, store 'kv', one record per document ('<map>:<id>'). The code
// keeps using maps in memory: get(map) returns the loaded map, set(map, value) keeps it and writes the documents that
// changed (each compared by its JSON with what was last read or written), in one transaction per write.
//
// localStorage under the old keys (ns + 'harnesses', and so on) is an inbox: the first load after the update finds
// everything there, a tab still running older code writes its whole map there, and when the page closes (pagehide,
// flushSync) the documents not yet written here go there at once, since an IndexedDB write may not finish. load()
// takes each document from the inbox when it's new here or its `updated` is later (base: when new here), writes
// them, reads them back, and only then removes the key. Nothing is removed before it's safely here.
//
// Without IndexedDB (blocked, or a private window that refuses it) everything stays in localStorage as before.
(function (LM) {
  'use strict';
  const MAPS = ['harnesses', 'systems', 'formboards', 'base'];
  const lsGet = k => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(true); tx.onabort = tx.onerror = () => rej(tx.error || new Error('IndexedDB write failed')); });
  const stampOf = d => (d && (Number(d.updated) || Date.parse(d.updated) || 0)) || 0;

  function Store(ns) {
    this.ns = ns;
    this.backend = '';
    this.db = null;
    this.maps = {};        // map name -> { id: document }, once loaded or set
    this.last = {};        // map name -> { id: JSON last read or written here }
    this.loaded = false;
    this.chain = Promise.resolve(true);
    MAPS.forEach(m => { this.last[m] = {}; });
  }
  Store.prototype.open = function () {
    if (this.opening) return this.opening;
    this.opening = new Promise(res => {
      let r;
      try { r = indexedDB.open('loom-local-' + this.ns, 1); } catch (e) { this.backend = 'ls'; res(null); return; }
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
      r.onsuccess = () => {
        this.db = r.result; this.backend = 'idb';
        this.db.onversionchange = () => { try { this.db.close(); } catch (e) { /* closed */ } this.db = null; this.opening = null; };
        res(this.db);
      };
      r.onerror = r.onblocked = () => { this.backend = 'ls'; res(null); };
    });
    return this.opening;
  };

  // Everything kept here, with the inbox taken in. Resolves { backend, absorbed (documents from localStorage) }.
  Store.prototype.load = async function () {
    const db = await this.open();
    if (!db) {
      MAPS.forEach(m => { this.maps[m] = lsGet(this.ns + m) || {}; });
      this.loaded = true;
      return { backend: 'ls', absorbed: 0 };
    }
    const s = db.transaction('kv', 'readonly').objectStore('kv');
    const [keys, vals] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
    MAPS.forEach(m => { this.maps[m] = {}; });
    keys.forEach((k, i) => {
      const at = typeof k === 'string' ? k.indexOf(':') : -1, m = at > 0 ? k.slice(0, at) : '';
      if (!this.maps[m]) return;
      this.maps[m][k.slice(at + 1)] = vals[i];
      this.last[m][k.slice(at + 1)] = JSON.stringify(vals[i]);
    });
    this.loaded = true;
    const absorbed = await this.absorb();
    return { backend: 'idb', absorbed };
  };
  // Take what older code or a closing page left in localStorage (see the top), and clear each key once its
  // documents read back here. A key changed by another writer meanwhile is left for the next load.
  Store.prototype.absorb = async function () {
    let n = 0;
    for (const m of MAPS) {
      let raw = null;
      try { raw = localStorage.getItem(this.ns + m); } catch (e) { raw = null; }
      if (!raw) continue;
      let theirs = null;
      try { theirs = JSON.parse(raw); } catch (e) { theirs = null; }
      if (!theirs || typeof theirs !== 'object') continue;
      const mine = this.maps[m], took = [];
      Object.keys(theirs).forEach(id => {
        const d = theirs[id]; if (!d || typeof d !== 'object') return;
        const have = mine[id];
        if (!have || (m !== 'base' && stampOf(d) > stampOf(have))) { mine[id] = d; took.push(id); }
      });
      const ok = await this.write(m);
      if (!ok) continue;
      // Read back what was taken before letting the key go.
      const s = this.db.transaction('kv', 'readonly').objectStore('kv');
      const back = await Promise.all(took.map(id => req(s.get(m + ':' + id))));
      if (!took.every((id, i) => JSON.stringify(back[i]) === JSON.stringify(mine[id]))) continue;
      try { if (localStorage.getItem(this.ns + m) === raw) localStorage.removeItem(this.ns + m); } catch (e) { /* storage blocked */ }
      n += took.length;
    }
    return n;
  };

  // The map as kept (loaded, or last set). Before a load (tests in their own namespace), what localStorage has.
  Store.prototype.get = function (m) {
    if (this.maps[m]) return this.maps[m];
    return lsGet(this.ns + m) || {};
  };
  // Keep a map and write the documents that changed. Resolves true, or false when the write failed.
  Store.prototype.set = function (m, value) {
    this.maps[m] = value || {};
    return this.write(m);
  };
  Store.prototype.write = function (m) {
    const p = this.chain.then(() => this.writeNow(m));
    this.chain = p.then(() => true, () => true);
    return p;
  };
  Store.prototype.changes = function (m) {
    const map = this.maps[m] || {}, last = this.last[m], put = {}, del = [];
    Object.keys(map).forEach(id => { const j = JSON.stringify(map[id]); if (last[id] !== j) put[id] = j; });
    Object.keys(last).forEach(id => { if (!(id in map)) del.push(id); });
    return { put, del };
  };
  Store.prototype.writeNow = async function (m) {
    const db = await this.open();
    if (!db) {
      try { localStorage.setItem(this.ns + m, JSON.stringify(this.maps[m] || {})); return true; } catch (e) { return false; }
    }
    const { put, del } = this.changes(m);
    if (!Object.keys(put).length && !del.length) return true;
    try {
      const tx = db.transaction('kv', 'readwrite'), s = tx.objectStore('kv');
      Object.keys(put).forEach(id => s.put(JSON.parse(put[id]), m + ':' + id));
      del.forEach(id => s.delete(m + ':' + id));
      await done(tx);
    } catch (e) { return false; }
    Object.keys(put).forEach(id => { this.last[m][id] = put[id]; });
    del.forEach(id => { delete this.last[m][id]; });
    this.persist();
    return true;
  };
  // The page is closing: the documents of `m` not yet written here go into localStorage at once (the inbox), as
  // the next load takes them. An IndexedDB write is started too; whichever lands, the next load has the newest.
  Store.prototype.flushSync = function (m) {
    if (this.backend !== 'idb') { try { localStorage.setItem(this.ns + m, JSON.stringify(this.maps[m] || {})); } catch (e) { /* full */ } return; }
    const { put } = this.changes(m), ids = Object.keys(put);
    if (!ids.length) return;
    try {
      const inbox = lsGet(this.ns + m) || {};
      ids.forEach(id => { inbox[id] = JSON.parse(put[id]); });
      localStorage.setItem(this.ns + m, JSON.stringify(inbox));
    } catch (e) { /* full: the IndexedDB write below is all there is */ }
    this.write(m);
  };
  // Ask once for storage the browser won't clear under pressure: unsynced edits live only here.
  Store.prototype.persist = function () {
    if (this.asked) return; this.asked = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* not offered */ }
  };

  const stores = {};
  LM.local = {
    store: ns => stores[ns] || (stores[ns] = new Store(ns)),
    // Tests: forget a namespace's store in this page (its database is left; delete it with indexedDB).
    reset: ns => { delete stores[ns]; },
    Store,
    dbName: ns => 'loom-local-' + ns,
    MAPS
  };
})(window.LM = window.LM || {});
