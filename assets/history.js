// A harness's history (Chris, 2026-11-13: as in Signoff EE and PL; ../signoff/docs/history.md). Loom
// stamps the whole harness (updated, updatedBy: the GitHub login), never a wire or connector, so each
// version of its file in git is one change by one person, and diff() says what it did, comparing the
// harness's parts by id. Layout (positions, label spots, set badges, bends and routes) reads as "moved on
// the drawing", apart from the things that change the build: pins, parts, colors, gauges, ends, lengths,
// coverings, sets, and notes. Nothing is stored: the versions come from GitHub when the sheet opens
// (fileHistory, cached by sha while the page is open). Restore puts an older version back as a new edit.
// Systems have the same sheet (2026-11-14, Chris): systems/projects/<id>.json in the data repo, compared
// block by block, connector by connector, and cable by cable (sysDiff).
(function (LM) {
  'use strict';
  const SG = window.Signoff || {};

  // Keys that only move things on the drawing.
  const LAYOUT = new Set(['x', 'y', 'labelAt', 'labelOff', 'anchors', 'badgeAt', 'badgeOff', 'propY', 'faceView', 'route', 'routes',
    'runs', 'bends', 'path', 'shape', 'walk', 'behind', 'place', 'tabAt', 'exits', 'rot', 'turn', 'flip']);
  // Harness fields, by what they're called.
  const FIELDS = [['title', 'title'], ['pn', 'part number'], ['rev', 'rev'], ['project', 'project'], ['drawnBy', 'drawn by'], ['date', 'date'],
    ['allowancePct', 'wire allowance'], ['notes', 'notes'], ['defaults', 'new-wire defaults'], ['deleted', 'deleted']];
  // The harness's own keys that only lay it out, and ones that are bookkeeping.
  const TOP_LAYOUT = new Set(['routes', 'place', 'propY', 'grid', 'view', 'cam']);
  const TOP_LAYOUT_NAME = { routes: 'wire routes', place: 'parts dragged', propY: 'Real proportions heights', grid: 'the grid' };
  const TOP_QUIET = new Set(['id', 'schema', 'updated', 'updatedBy', 'identAt', 'plPart', 'demoVersion', 'syncBase', 'conflictOf', 'tags']);
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  const byId = list => { const m = new Map(); (list || []).forEach(x => { if (x && x.id) m.set(x.id, x); }); return m; };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const list3 = a => a.length < 3 ? a.join(' and ') : a.slice(0, -1).join(', ') + ', and ' + a[a.length - 1];

  function nodeName(n) { return n ? (n.ref || (n.kind === 'loose' ? 'a loose end' : n.kind === 'breakout' ? 'a breakout' : n.kind || 'a part')) : '?'; }
  function endName(h, e) { const n = (h.nodes || []).find(x => x.id === (e && e.node)); return nodeName(n) + (e && e.pin ? '.' + e.pin : ''); }
  function wireName(h, w) { return 'wire ' + (w.no || '?') + ' (' + endName(h, w.from) + ' → ' + endName(h, w.to) + ')'; }
  function segName(h, s) { return 'run ' + nodeName((h.nodes || []).find(n => n.id === s.a)) + '–' + nodeName((h.nodes || []).find(n => n.id === s.b)); }
  function setName(s) { const k = ['twist', 'shield', 'cable', 'bundle'].filter(x => s[x]); return (k[0] || 'set') + (s.label ? ' ' + s.label : ''); }

  // What changed between two versions of one harness: { items: [{ part, name, change, detail }], summary }.
  // a null: the harness is new.
  function diff(a, b) {
    if (!b) return { items: [], summary: '' };
    if (!a) return { items: [{ part: 'harness', name: b.title || 'Harness', change: 'added', detail: '' }],
      summary: 'Made the harness: ' + list3([plural((b.nodes || []).filter(n => n.kind === 'connector').length, 'connector'), plural((b.wires || []).length, 'wire'), plural((b.sets || []).length, 'set')]) };
    const items = [], moved = [];
    FIELDS.forEach(([k, label]) => {
      if (same(a[k], b[k])) return;
      if (k === 'deleted') items.push({ part: 'harness', name: b.title || 'Harness', change: b.deleted ? 'deleted' : 'brought back', detail: '' });
      else items.push({ part: 'harness', name: label, change: 'changed', detail: k === 'notes' ? '' : String(a[k] == null ? '' : typeof a[k] === 'object' ? JSON.stringify(a[k]) : a[k]) + ' → ' + String(b[k] == null ? '' : typeof b[k] === 'object' ? JSON.stringify(b[k]) : b[k]), before: a[k], after: b[k] });
    });
    // The rest of the harness's own keys: layout (routes, dragged spots, the grid) moves the drawing,
    // bookkeeping says nothing, and anything else is named.
    const known = new Set(FIELDS.map(f => f[0]).concat(['nodes', 'wires', 'segments', 'sets', 'callouts']));
    [...new Set(Object.keys(a).concat(Object.keys(b)))].forEach(k => {
      if (known.has(k) || TOP_QUIET.has(k) || same(a[k], b[k])) return;
      if (TOP_LAYOUT.has(k)) moved.push(TOP_LAYOUT_NAME[k] || k);
      else items.push({ part: 'harness', name: k, change: 'changed', detail: '' });
    });
    // Each list of parts, by id: added, removed, or changed (named fields), or only moved (layout).
    function each(key, part, name) {
      const A = byId(a[key]), B = byId(b[key]);
      B.forEach((x, id) => {
        const y = A.get(id);
        if (!y) { items.push({ part, name: name(b, x), change: 'added', detail: '' }); return; }
        const keys = new Set(Object.keys(x).concat(Object.keys(y)));
        const real = [...keys].filter(k => k !== 'id' && !LAYOUT.has(k) && !same(x[k], y[k]));
        const lay = [...keys].some(k => LAYOUT.has(k) && !same(x[k], y[k]));
        if (real.length) {
          const what = real.map(k => k === 'ref' ? 'renamed from ' + y.ref : k === 'from' || k === 'to' ? 'rewired' : k === 'wires' || k === 'sets' ? 'members' : k === 'pinLabels' || k === 'pinNames' ? 'pin names' : k);
          items.push({ part, name: name(b, x), change: 'changed', detail: [...new Set(what)].join(', '), fields: real.map(k => ({ key: k, before: y[k], after: x[k] })) });
        } else if (lay) moved.push(name(b, x));
      });
      A.forEach((y, id) => { if (!B.has(id)) items.push({ part, name: name(a, y), change: 'removed', detail: '' }); });
    }
    each('nodes', 'part', (h, n) => (n.kind === 'connector' ? 'connector ' : n.kind === 'splice' ? 'splice ' : '') + nodeName(n));
    each('wires', 'wire', wireName);
    each('segments', 'run', segName);
    each('sets', 'set', (h, s) => setName(s));
    each('callouts', 'callout', (h, c) => 'callout ' + (c.label || c.ref || c.text || ''));
    if (moved.length) items.push({ part: 'layout', name: moved.length === 1 ? moved[0] : plural(moved.length, 'part'), change: 'moved on the drawing', detail: moved.length > 1 ? list3(moved.slice(0, 6)) + (moved.length > 6 ? ', …' : '') : '' });
    const count = {};
    items.forEach(it => { const k = it.change === 'moved on the drawing' ? 'moved on the drawing' : it.part === 'harness' ? (it.change === 'changed' ? it.name + ' changed' : 'harness ' + it.change) : it.part + ' ' + it.change; count[k] = (count[k] || 0) + 1; });
    const summary = Object.keys(count).map(k => {
      const n = count[k], [part, ...rest] = k.split(' ');
      if (k === 'moved on the drawing' || / changed$/.test(k) && !['part', 'wire', 'run', 'set', 'callout'].includes(part)) return k;
      if (part === 'harness') return k;
      return plural(n, part) + ' ' + rest.join(' ');
    });
    return withTags(a, b, items, summary, 'no change to the harness');
  }

  // Version tags set, renamed, or removed (vendor/history.js) come first in a change's summary and items.
  function withTags(a, b, items, summary, none) {
    const t = window.SignoffHistory ? window.SignoffHistory.tags.phrases(a, b) : [];
    const tagItems = t.map(p => ({ part: 'tag', name: p.what, change: p.verb, detail: '' }));
    const all = t.map(p => p.verb + ' ' + p.what).concat(summary);
    return { items: tagItems.concat(items), summary: all.length ? list3(all) : none };
  }

  // Rows for the history: one per version, newest first, by the document's own stamp. versions: newest
  // first, [{ harness, commit }] (or { doc, commit }); the oldest given is only a base unless
  // opts.complete (the file's first). opts.diff: how to compare (sysDiff for a system).
  function rows(versions, opts) {
    const out = [], v = versions || [], cmp = (opts && opts.diff) || diff;
    for (let i = 0; i < v.length; i++) {
      const older = v[i + 1];
      if (!older && !(opts && opts.complete)) break;
      const h = v[i].harness || v[i].doc, prev = older ? older.harness || older.doc : null;
      if (prev && (h.updated || 0) === (prev.updated || 0) && (h.updatedBy || '') === (prev.updatedBy || '')) continue;   // a write that only changed the summary, or drawn sizes
      const d = cmp(prev, h);
      out.push({ at: new Date(h.updated || 0).toISOString(), by: h.updatedBy || '', commit: v[i].commit || null, before: prev, after: h, items: d.items, summary: d.summary });
    }
    return out;
  }


  // ── Systems ──
  // A block's keys that only move or size it on the drawing (a placed system's size and name follow its
  // drawing, system.js fitMini), a connector's, and a cable's (its route, label, and device-end spots).
  const SYS_BLOCK_LAYOUT = new Set(['x', 'y', 'rot', 'w', 'h']);
  const SYS_CONN_LAYOUT = new Set(['x', 'y', 'ax', 'ay', 'exit', 'side', 'placed']);
  const SYS_CAB_LAYOUT = new Set(['routes', 'labelAt', 'labelOff', 'devAt']);
  const SYS_FIELDS = [['title', 'title'], ['project', 'project'], ['rev', 'rev'], ['deleted', 'deleted']];
  const SYS_NAME = { ref: 'renamed', name: 'name', source: 'source board', shape: 'outline', fitted: 'populated', used: 'used', fn: 'function',
    pins: 'pins', external: 'external', ends: 'replugged', lengthMm: 'length', harness: 'harness', kind: 'kind', color: 'color', mpn: 'part number', system: 'placed system' };
  const blockName = b => [b.ref, b.kind === 'system' ? '' : b.name].filter(Boolean).join(' ') || 'a block';
  const cabName = c => c.name || (c.kind === 'harness' ? 'a harness' : 'a cable');
  // What changed between two versions of one system: { items, summary }, as diff does for a harness.
  function sysDiff(a, b) {
    if (!b) return { items: [], summary: '' };
    if (!a) return { items: [{ part: 'system', name: b.title || 'System', change: 'added', detail: '' }],
      summary: 'Made the system: ' + list3([plural((b.blocks || []).length, 'block'), plural((b.cables || []).length, 'cable')]) };
    const items = [], moved = [];
    SYS_FIELDS.forEach(([k, label]) => {
      if (same(a[k], b[k])) return;
      if (k === 'deleted') items.push({ part: 'system', name: b.title || 'System', change: b.deleted ? 'deleted' : 'brought back', detail: '' });
      else items.push({ part: 'system', name: label, change: 'changed', detail: String(a[k] == null ? '' : a[k]) + ' → ' + String(b[k] == null ? '' : b[k]), before: a[k], after: b[k] });
    });
    const known = new Set(SYS_FIELDS.map(f => f[0]).concat(['blocks', 'cables', 'kind']));
    [...new Set(Object.keys(a).concat(Object.keys(b)))].forEach(k => {
      if (known.has(k) || TOP_QUIET.has(k) || same(a[k], b[k])) return;
      if (k === 'grid' || k === 'cam' || k === 'view') moved.push(k === 'grid' ? 'the grid' : k);
      else items.push({ part: 'system', name: k, change: 'changed', detail: '' });
    });
    const real = (x, y, lay, skip) => [...new Set(Object.keys(x).concat(Object.keys(y)))].filter(k => k !== 'id' && !lay.has(k) && !(skip && skip.has(k)) && !same(x[k], y[k]));
    const anyLay = (x, y, lay) => [...lay].some(k => !same(x[k], y[k]));
    const A = byId(a.blocks), B = byId(b.blocks);
    B.forEach((x, id) => {
      const y = A.get(id);
      if (!y) { items.push({ part: 'block', name: blockName(x), change: 'added', detail: '' }); return; }
      // A placed system's name and tab spots follow the system it places: only its tabs' own settings count.
      const skip = new Set(['conns', 'tabs'].concat(x.kind === 'system' ? ['name'] : []));
      const what = real(x, y, SYS_BLOCK_LAYOUT, skip).map(k => SYS_NAME[k] || k);
      let lay = anyLay(x, y, SYS_BLOCK_LAYOUT);
      // Connectors, by id.
      const CA = byId(y.conns), CB = byId(x.conns);
      CB.forEach((c, cid) => {
        const d = CA.get(cid);
        if (!d) { what.push((c.ref || 'a connector') + ' added'); return; }
        const r = real(c, d, SYS_CONN_LAYOUT);
        if (r.length) what.push((c.ref || 'a connector') + ': ' + [...new Set(r.map(k => SYS_NAME[k] || k))].join(', '));
        else if (anyLay(c, d, SYS_CONN_LAYOUT)) lay = true;
      });
      CA.forEach((d, cid) => { if (!CB.has(cid)) what.push((d.ref || 'a connector') + ' removed'); });
      // A placed system's tabs: their own settings (function, external) count; their spots and exits move.
      const TA = y.tabs || {}, TB = x.tabs || {};
      [...new Set(Object.keys(TA).concat(Object.keys(TB)))].forEach(t => {
        const p = TA[t] || {}, q = TB[t] || {};
        const r = real(q, p, new Set(['x', 'y', 'exit']));
        if (r.length) what.push('tab ' + t.split('/').pop() + ': ' + [...new Set(r.map(k => SYS_NAME[k] || k))].join(', '));
        else if (anyLay(q, p, new Set(['x', 'y', 'exit']))) lay = true;
      });
      if (what.length) items.push({ part: 'block', name: blockName(x), change: 'changed', detail: [...new Set(what)].join('; ') });
      else if (lay) moved.push(blockName(x));
    });
    A.forEach((y, id) => { if (!B.has(id)) items.push({ part: 'block', name: blockName(y), change: 'removed', detail: '' }); });
    const KA = byId(a.cables), KB = byId(b.cables);
    KB.forEach((x, id) => {
      const y = KA.get(id);
      if (!y) { items.push({ part: 'cable', name: cabName(x), change: 'added', detail: '' }); return; }
      const r = real(x, y, SYS_CAB_LAYOUT);
      if (r.length) items.push({ part: 'cable', name: cabName(x), change: 'changed', detail: [...new Set(r.map(k => SYS_NAME[k] || k))].join(', '), fields: r.map(k => ({ key: k, before: y[k], after: x[k] })) });
      else if (anyLay(x, y, SYS_CAB_LAYOUT)) moved.push(cabName(x));
    });
    KA.forEach((y, id) => { if (!KB.has(id)) items.push({ part: 'cable', name: cabName(y), change: 'removed', detail: '' }); });
    if (moved.length) items.push({ part: 'layout', name: moved.length === 1 ? moved[0] : plural(moved.length, 'thing'), change: 'moved on the drawing', detail: moved.length > 1 ? list3(moved.slice(0, 6)) + (moved.length > 6 ? ', …' : '') : '' });
    const count = {};
    items.forEach(it => { const k = it.change === 'moved on the drawing' ? 'moved on the drawing' : it.part === 'system' ? (it.change === 'changed' ? it.name + ' changed' : 'system ' + it.change) : it.part + ' ' + it.change; count[k] = (count[k] || 0) + 1; });
    const summary = Object.keys(count).map(k => {
      const n = count[k], [part, ...rest] = k.split(' ');
      if (k === 'moved on the drawing' || part === 'system' || !['block', 'cable'].includes(part)) return k;
      return plural(n, part) + ' ' + rest.join(' ');
    });
    return withTags(a, b, items, summary, 'no change to the system');
  }

  // ── The sheet ──
  const cache = {};   // per repo, for fileHistory
  const HIST = window.SignoffHistory;   // the shared History sheet, version tags, and comparison (vendor/history.js)
  const esc = s => HIST.fmt.esc(s);

  // The sheet is the Signoff engine's (vendor/history.js); Loom says what a version is and what it did.
  // kind: 'harness' (the default) or 'system'.
  function open(h, kind) {
    if (!h) return;
    const SYS = kind === 'system', WORD = SYS ? 'system' : 'harness', cmp = SYS ? sysDiff : diff;
    const R = LM.store, DEMO = R && R.DEMO;
    // The document as it is now, never the tagged copy the Version comparison bar may be drawing.
    const live = () => (SYS ? LM.system.get(h.id) : LM.app.state.store[h.id]) || h;
    h = live();
    const c = R.config(), full = (!SYS && R.homeOf(h.id)) || (c.owner + '/' + c.dataRepo), tok = R.token();
    const store = DEMO || !tok ? null : new SG.GitHubStore({ owner: full.split('/')[0], repo: full.split('/')[1], branch: 'main', dataPath: '', token: tok });
    cache[full] = cache[full] || {};
    const who = by => by ? '@' + by : 'Someone';
    close();
    const api = HIST.open({
      title: h.title, word: WORD, demo: DEMO, demoNote: `The demo isn’t on GitHub, so it has no history; a synced ${WORD} shows every version.`,
      mount: () => {
        const wrap = document.createElement('div');
        wrap.className = 'sheet-wrap'; wrap.id = 'lm-hist';
        wrap.innerHTML = '<div class="sheet wide" role="dialog" aria-modal="true" aria-label="History"></div>';
        wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
        document.body.appendChild(wrap);
        return wrap.querySelector('.sheet');
      },
      unmount: close,
      store, repo: full, path: (SYS ? 'systems/projects/' : 'projects/') + h.id + '.json', cache: cache[full],
      noStore: `Sign in to GitHub to see this ${WORD}’s history.`, toast: (t, err) => LM.app.toast(t, err ? 'error' : undefined),
      parse: text => LM.compare.parse(SYS ? 'system' : 'harness', h.id, JSON.parse(text)),
      live,
      rows: (versions, complete) => rows(versions, { complete, diff: cmp }),
      // This browser's edit not synced yet: the document here is newer than the newest version.
      unsynced: (d, newest) => newest ? ((d.updated || 0) > (newest.updated || 0) ? rows([{ doc: d, commit: null }, { doc: newest }], { diff: cmp }) : [])
        : rows([{ doc: d, commit: null }], { complete: true, diff: cmp }),
      demoRows: d => rows([{ doc: d }], { complete: true, diff: cmp }),
      intro: list => list.length ? plural(list.length, 'version') + ' by ' + list3([...new Set(list.map(r => who(r.by)))]) + `. Loom keeps the whole ${WORD} as one record, so each version is one change by one person.` : `Who changed the ${WORD}, from its versions on GitHub.`,
      empty: () => 'No versions yet.',
      filters: [['all', 'Every version']],
      person: who,
      counts: list => plural(list.length, 'version'),
      row: r => ({ label: r.summary }),
      change: (r, k) => {
        const items = r.items.map(it => `<li><b>${esc(it.change === 'moved on the drawing' ? 'Moved' : it.change.charAt(0).toUpperCase() + it.change.slice(1))}</b> ${esc(it.name)}${it.detail ? ` <span class="muted">· ${esc(it.detail)}</span>` : ''}</li>`).join('');
        return { title: r.summary.charAt(0).toUpperCase() + r.summary.slice(1), body: items ? `<ul class="hist-items">${items}</ul>` : '',
          acts: !DEMO && r.before && k > 0 ? `<button class="btn btn-sm" data-h="restore" data-r="${k}">Restore the version before this…</button>` : '' };
      },
      act: (name, r, x) => { if (name === 'restore') restore(r, x); },
      tags: true, user: () => R.login(),
      writeTags: map => {
        if ((SYS ? LM.system.current() : LM.app.state.cur) !== h.id) { alert(`Open the ${WORD} to tag its versions.`); return false; }
        return SYS ? LM.system.editTags(map) : LM.app.editTags(map);
      },
      compareKey: LM.compare.key(SYS ? 'system' : 'harness', h.id), compareTitle: h.title
    });
    function restore(r, x) {
      const cur = live();
      if (!cur || cur.id !== h.id || (SYS ? LM.system.current() : LM.app.state.cur) !== h.id) return;
      if (LM.compare.active()) LM.compare.exit(true);   // a restore writes the live document, never the compared copy
      const top = x.rows()[0];
      if ((cur.updated || 0) !== (top && top.after.updated || 0)) { alert(`This ${WORD} changed since the history was read. Close and open History again.`); return; }
      if (!confirm(`Put the ${WORD} back as it was before this change (` + r.summary + ')?\n\nIt’s saved as a new edit by you and syncs like any other. Nothing in GitHub’s history is rewritten, and Undo takes it back.')) return;
      if (SYS) LM.system.restore(r.before); else LM.app.restore(r.before);
      x.close();
    }
    return api;
  }
  function close() { const w = document.getElementById('lm-hist'); if (w) w.remove(); }

  LM.history = { diff, sysDiff, rows, open, close, LAYOUT };
})(window.LM = window.LM || {});
