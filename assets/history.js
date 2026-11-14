// A harness's history (Chris, 2026-11-13: as in Signoff EE and PL; ../signoff/docs/history.md). Loom
// stamps the whole harness (updated, updatedBy: the GitHub login), never a wire or connector, so each
// version of its file in git is one change by one person, and diff() says what it did, comparing the
// harness's parts by id. Layout (positions, label spots, set badges, bends and routes) reads as "moved on
// the drawing", apart from the things that change the build: pins, parts, colors, gauges, ends, lengths,
// coverings, sets, and notes. Nothing is stored: the versions come from GitHub when the sheet opens
// (fileHistory, cached by sha while the page is open). Restore puts an older version back as a new edit.
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
  const TOP_QUIET = new Set(['id', 'schema', 'updated', 'updatedBy', 'identAt', 'plPart', 'demoVersion']);
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
    return { items, summary: summary.length ? list3(summary) : 'no change to the harness' };
  }

  // Rows for the history: one per version, newest first, by the harness's own stamp. versions: newest
  // first, [{ harness, commit }]; the oldest given is only a base unless opts.complete (the file's first).
  function rows(versions, opts) {
    const out = [], v = versions || [];
    for (let i = 0; i < v.length; i++) {
      const older = v[i + 1];
      if (!older && !(opts && opts.complete)) break;
      const h = v[i].harness, prev = older ? older.harness : null;
      if (prev && (h.updated || 0) === (prev.updated || 0) && (h.updatedBy || '') === (prev.updatedBy || '')) continue;   // a write that only changed the summary
      const d = diff(prev, h);
      out.push({ at: new Date(h.updated || 0).toISOString(), by: h.updatedBy || '', commit: v[i].commit || null, before: prev, after: h, items: d.items, summary: d.summary });
    }
    return out;
  }

  // ── The sheet ──
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cache = {};   // per repo, for fileHistory
  function rel(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!(s >= 0)) return '';
    if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  const clock = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  function day(iso) {
    const d = new Date(iso), t = new Date();
    if (isNaN(d)) return '';
    if (d.toDateString() === t.toDateString()) return 'Today';
    if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  const initials = name => { const w = String(name || '?').replace(/^@/, '').split(/[\s._-]+/).filter(Boolean); return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : (w[0] || '').charAt(1))).toUpperCase(); };

  function open(h) {
    if (!h) return;
    const R = LM.store, M = SG.model, DEMO = R && R.DEMO;
    const st = { rows: [], versions: [], page: 0, more: !DEMO, loading: false, error: '', gap: 2 * 3600e3, open: {}, sel: null };
    close();
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap'; wrap.id = 'lm-hist';
    wrap.innerHTML = '<div class="sheet wide hist-sheet" role="dialog" aria-modal="true" aria-label="History"></div>';
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    const box = wrap.querySelector('.sheet');
    const who = r => r.by ? '@' + r.by : 'Someone';
    function pane() {
      const s = st.sel;
      if (!s) return '<p class="note">Pick a block or a change to see what it did.</p>';
      const list = s.row != null ? [st.rows[s.row]] : ((M.historyBlocks(st.rows, st.gap).find(b => b.by + '|' + b.end === s.block)) || { rows: [] }).rows;
      return list.map(r => {
        const k = st.rows.indexOf(r);
        const where = r.commit ? `synced in <a href="https://github.com/${esc(st.full)}/commit/${esc(r.commit.sha)}" target="_blank" rel="noopener"><code>${esc(r.commit.sha.slice(0, 7))}</code></a>` : r.commit === null ? 'not synced yet' : '';
        const items = r.items.map(it => `<li><b>${esc(it.change === 'moved on the drawing' ? 'Moved' : it.change.charAt(0).toUpperCase() + it.change.slice(1))}</b> ${esc(it.name)}${it.detail ? ` <span class="muted">· ${esc(it.detail)}</span>` : ''}</li>`).join('');
        const canRestore = !DEMO && r.before && k > 0;
        return `<div class="hist-chg"><h3>${esc(r.summary.charAt(0).toUpperCase() + r.summary.slice(1))}</h3>
          <p class="hist-meta">${esc(who(r) + ' · ' + clock(r.at) + ', ' + rel(r.at))}${where ? ' · ' + where : ''}</p>
          ${items ? `<ul class="hist-items">${items}</ul>` : ''}
          ${canRestore ? `<div class="hist-acts"><button class="btn btn-sm" data-h="restore" data-r="${k}">Restore the version before this…</button></div>` : ''}</div>`;
      }).join('');
    }
    function draw() {
      const blocks = M.historyBlocks(st.rows, st.gap);
      let html = '', last = '';
      blocks.forEach(b => {
        const d = day(b.end);
        if (d !== last) { html += `<li class="hist-day">${esc(d)}</li>`; last = d; }
        const key = b.by + '|' + b.end, isOpen = !!st.open[key];
        const span = clock(b.start) !== clock(b.end) ? clock(b.start) + '–' + clock(b.end) : clock(b.end);
        const unsynced = b.rows.every(r => r.commit === null);
        html += `<li class="hist-blk${isOpen ? ' open' : ''}${st.sel && st.sel.block === key ? ' sel' : ''}"><span class="hist-node" aria-hidden="true">${esc(initials(b.by))}</span>
          <button class="hist-head" data-h="block" data-k="${esc(key)}" aria-expanded="${isOpen}"><span class="hist-who">${esc(b.by ? '@' + b.by : 'Someone')}</span>${unsynced ? '<span class="hist-tag">Not synced yet</span>' : ''}
          <span class="hist-when">${esc(span + ' · ' + rel(b.end))}</span><span class="hist-counts">${esc(plural(b.rows.length, 'version'))}</span></button>
          ${isOpen ? `<ul class="hist-rows">${b.rows.map(r => { const k = st.rows.indexOf(r); return `<li><button class="hist-row${st.sel && st.sel.row === k ? ' sel' : ''}" data-h="row" data-r="${k}"><span class="hist-what">${esc(r.summary)}</span><time>${esc(clock(r.at))}</time></button></li>`; }).join('')}</ul>` : ''}</li>`;
      });
      const foot = st.loading ? '<p class="note">Reading the harness’s history from GitHub…</p>' : st.error ? `<p class="note">${esc(st.error)}</p>`
        : st.more ? '<button class="btn" data-h="older">Load older</button>'
        : st.rows.length ? `<p class="note">${DEMO ? 'The demo isn’t on GitHub, so it has no history; a synced harness shows every version.' : 'That’s the whole history.'}</p>` : '';
      box.innerHTML = `<div class="sheet-head"><h2>History · ${esc(h.title)}</h2><p>${esc(st.rows.length ? plural(st.rows.length, 'version') + ' by ' + list3([...new Set(st.rows.map(who))]) + '. Loom keeps the whole harness as one record, so each version is one change by one person.' : 'Who changed the harness, from its versions on GitHub.')}</p></div>
        <div class="hist-bar"><label class="hist-gap">Fold runs within <select data-h="gap">${[[30, '30 min'], [120, '2 h'], [1440, '1 day'], [0, 'Never']].map(([m, t]) => `<option value="${m * 6e4}"${st.gap === m * 6e4 ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div>
        <div class="hist-grid"><div class="hist-col"><ol class="hist-tl">${html || (st.loading ? '' : '<li class="note">No versions yet.</li>')}</ol>${foot}</div><div class="hist-col hist-pane">${pane()}</div></div>
        <div class="sheet-foot"><button class="btn" data-h="close">Close</button></div>`;
    }
    function load() {
      if (DEMO) { st.rows = rows([{ harness: h }], { complete: true }); st.rows.forEach(r => { r.commit = undefined; }); st.more = false; draw(); return; }
      const c = R.config(), full = R.homeOf(h.id) || (c.owner + '/' + c.dataRepo), tok = R.token();
      st.full = full;
      if (!tok) { st.more = false; st.error = 'Sign in to GitHub to see this harness’s history.'; draw(); return; }
      const store = new SG.GitHubStore({ owner: full.split('/')[0], repo: full.split('/')[1], branch: 'main', dataPath: '', token: tok });
      st.loading = true; st.error = ''; draw();
      cache[full] = cache[full] || {};
      store.fileHistory('projects/' + h.id + '.json', { page: st.page + 1, perPage: 15, cache: cache[full] }).then(got => {
        st.page++;
        got.versions.forEach(v => {
          let doc = null; try { doc = v.text ? JSON.parse(v.text) : null; } catch (e) { /* not a harness file */ }
          const hh = doc && R.unwrap(doc);
          if (hh && hh.id === h.id) st.versions.push({ harness: hh, commit: v.commit });
        });
        st.more = got.more;
        // This browser's edit not synced yet: the harness here is newer than the newest version.
        const newest = st.versions[0], mine = newest && (h.updated || 0) > (newest.harness.updated || 0)
          ? rows([{ harness: h, commit: null }, newest]) : !newest ? rows([{ harness: h, commit: null }], { complete: true }) : [];
        st.rows = mine.concat(rows(st.versions, { complete: !got.more }));
        st.loading = false; draw();
      }, err => { st.loading = false; st.error = 'Couldn’t read the history from GitHub: ' + (err.message || 'unknown error'); draw(); });
    }
    function restore(r) {
      const cur = LM.app.H();
      if (!cur || cur.id !== h.id) return;
      if ((cur.updated || 0) !== (st.rows[0] && st.rows[0].after.updated || 0)) { alert('This harness changed since the history was read. Close and open History again.'); return; }
      if (!confirm('Put the harness back as it was before this change (' + r.summary + ')?\n\nIt’s saved as a new edit by you and syncs like any other. Nothing in GitHub’s history is rewritten, and Undo takes it back.')) return;
      LM.app.restore(r.before);
      close();
    }
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-h]'); if (!b) return;
      const act = b.getAttribute('data-h');
      if (act === 'close') close();
      else if (act === 'block') { const k = b.getAttribute('data-k'); st.open[k] = !st.open[k]; st.sel = { block: k }; draw(); }
      else if (act === 'row') { st.sel = { row: +b.getAttribute('data-r') }; draw(); }
      else if (act === 'older') load();
      else if (act === 'restore') restore(st.rows[+b.getAttribute('data-r')]);
    });
    box.addEventListener('change', e => { if (e.target.getAttribute('data-h') === 'gap') { st.gap = +e.target.value; st.open = {}; st.sel = null; draw(); } });
    document.addEventListener('keydown', onKey);
    load();
  }
  function onKey(e) { if (e.key === 'Escape' && document.getElementById('lm-hist')) close(); }
  function close() { const w = document.getElementById('lm-hist'); if (w) w.remove(); document.removeEventListener('keydown', onKey); }

  LM.history = { diff, rows, open, close, LAYOUT };
})(window.LM = window.LM || {});
