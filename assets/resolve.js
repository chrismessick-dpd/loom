// Resolve a conflict copy in one step (Chris, 2026-11-14: as Signoff EE's Scribe Resolve). A sync that
// finds a harness or system changed both here and elsewhere keeps the newer as itself and the other as a
// new document, "<title> (conflict copy)", which names what it's a copy of (`conflictOf`, store.js
// conflictCopy). Opened, the copy has Resolve… in its toolbar: a sheet that says what using it would
// change in the original (history.js diff, sysDiff) and offers
//   Use this copy     the original becomes the copy's content (keeping its own id, sync base, and Signoff
//                     PL link), and the copy is deleted;
//   Delete this copy  the original stays as it is;
//   Keep both         the copy stays as a document of its own.
// Each is one change by this person, now, and the toast's Undo puts both documents back while neither has
// changed since. A copy deleted that was never synced just goes; a synced one leaves a tombstone, as
// Delete harness does. Copies made before conflictOf existed are matched to their original by title.
(function (LM) {
  'use strict';
  const SUFFIX = / \(conflict copy\)$/;
  const clone = d => JSON.parse(JSON.stringify(d));
  const live = d => !!d && !d.deleted;

  // Whether a document is a conflict copy waiting to be resolved.
  const isCopy = d => live(d) && (!!(d.conflictOf && d.conflictOf.id) || SUFFIX.test(String(d.title || '')));
  // The document a copy was made from, in store (by id; else, for an older copy, the one live document
  // whose title is the copy's without the suffix), or null.
  function originOf(copy, store) {
    if (!isCopy(copy)) return null;
    const id = copy.conflictOf && copy.conflictOf.id;
    if (id && live(store[id]) && id !== copy.id) return store[id];
    const name = String(copy.title || '').replace(SUFFIX, '');
    const hits = Object.keys(store).map(k => store[k]).filter(d => live(d) && d.id !== copy.id && !isCopy(d) && String(d.title || '') === name);
    return hits.length === 1 ? hits[0] : null;
  }
  const plainTitle = copy => String(copy.title || '').replace(SUFFIX, '');

  // The documents an action writes: { changes: { id: document, or null to remove it }, open: id or null }.
  // Pure, for tests. opts: { login, now, synced(id) }: whether a document was ever synced (a synced copy
  // leaves a tombstone).
  function apply(action, copy, orig, opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    const stamp = d => { d.updated = now; if (opts.login) d.updatedBy = opts.login; else delete d.updatedBy; return d; };
    const gone = c => (opts.synced && opts.synced(c.id) ? stamp(Object.assign(clone(c), { deleted: true })) : null);
    const changes = {};
    if (action === 'use') {
      if (!orig) throw new Error('The original isn’t here to replace.');
      const o = clone(copy);
      o.id = orig.id;
      o.title = plainTitle(copy);
      delete o.conflictOf; delete o.syncBase; delete o.plPart;
      if (orig.syncBase) o.syncBase = orig.syncBase;
      if (orig.plPart) o.plPart = clone(orig.plPart);
      // A harness's name and part number go both ways with Signoff PL by identAt: stamped when they change.
      if ('identAt' in orig || 'identAt' in o) {
        if (o.title !== orig.title || (o.pn || '') !== (orig.pn || '')) o.identAt = new Date(now).toISOString();
        else if (orig.identAt) o.identAt = orig.identAt; else delete o.identAt;
      }
      changes[orig.id] = stamp(o);
      changes[copy.id] = gone(copy);
      return { changes, open: orig.id };
    }
    if (action === 'delete') {
      changes[copy.id] = gone(copy);
      return { changes, open: orig ? orig.id : null };
    }
    if (action === 'keep') {
      const k = clone(copy);
      delete k.conflictOf;
      k.title = plainTitle(copy) + ' (kept copy)';
      changes[copy.id] = stamp(k);
      return { changes, open: copy.id };
    }
    throw new Error('Unknown action ' + action);
  }

  // ── The sheet ──
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function when(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  // hooks: { store(kind), put(kind, changes, open), login(), synced(kind, id), toast(msg, tone, action) }.
  let hooks = null;
  function init(h) { hooks = h; }

  function open(kind, copy) {
    if (!hooks || !copy) return;
    const SYS = kind === 'system', WORD = SYS ? 'system' : 'harness';
    const store = hooks.store(kind), orig = originOf(copy, store);
    close();
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap'; wrap.id = 'lm-resolve';
    wrap.innerHTML = '<div class="sheet rs-sheet" role="dialog" aria-modal="true" aria-label="Resolve a conflict copy"></div>';
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    const box = wrap.querySelector('.sheet');
    // Compared as it would be used: under its title without the suffix.
    const d = orig && LM.history ? (SYS ? LM.history.sysDiff : LM.history.diff)(orig, Object.assign({}, copy, { title: plainTitle(copy) })) : null;
    const items = d ? d.items.map(it => `<li><b>${esc(it.change === 'moved on the drawing' ? 'Moves' : it.change === 'added' ? 'Adds' : it.change === 'removed' ? 'Removes' : it.change === 'changed' ? 'Changes' : it.change.charAt(0).toUpperCase() + it.change.slice(1))}</b> ${esc(it.name)}${it.detail ? ` <span class="muted">· ${esc(it.detail)}</span>` : ''}</li>`).join('') : '';
    const at = copy.conflictOf && copy.conflictOf.at;
    const origName = orig ? esc(orig.title) : '';
    const intro = orig
      ? `This ${WORD} was changed both in a browser and on GitHub since that browser last synced it. The newer version kept its place as <b>${origName}</b>, and the other was kept here as a copy${at ? `, ${esc(when(at))}` : ''}${copy.conflictOf ? '' : ' (matched to it by name)'}.`
      : `The ${WORD} this is a copy of isn’t here any more${copy.conflictOf ? ` (${esc(copy.conflictOf.title || '')})` : ''}. Keep the copy as a ${WORD} of its own, or delete it.`;
    const opt = (act, label, text, primary) => `<div class="rs-opt"><button class="btn${primary ? ' btn-primary' : ''}" data-rs="${act}">${label}</button><span>${text}</span></div>`;
    box.innerHTML = `<div class="sheet-head"><h2>Resolve · ${esc(copy.title)}</h2><p>${intro}</p></div>
      ${orig ? `<div class="rs-diff"><h3>Using this copy changes ${origName}:</h3>${items ? `<ul class="hist-items">${items}</ul>` : `<p class="note">Nothing: it’s the same as ${origName}.</p>`}</div>` : ''}
      <div class="rs-opts">
        ${orig ? opt('use', 'Use this copy', `${origName} becomes this copy, and the copy goes.`) : ''}
        ${opt('delete', 'Delete this copy', orig ? `${origName} stays as it is.` : 'It goes from Loom; its versions stay in git.', !!orig)}
        ${opt('keep', 'Keep both', `The copy stays, as a ${WORD} of its own named “${esc(plainTitle(copy))} (kept copy)”.`)}
      </div>
      <div class="sheet-foot"><button class="btn" data-rs="close">Cancel</button></div>`;
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-rs]'); if (!b) return;
      const act = b.getAttribute('data-rs');
      if (act === 'close') { close(); return; }
      run(kind, act, copy, orig);
      close();
    });
    document.addEventListener('keydown', onKey);
  }
  function run(kind, act, copy, orig) {
    const store = hooks.store(kind);
    const plan = apply(act, store[copy.id] || copy, orig ? store[orig.id] || orig : null, { login: hooks.login(), synced: id => hooks.synced(kind, id) });
    // Undo: both documents back, while neither changed since.
    const was = {};
    Object.keys(plan.changes).forEach(id => { was[id] = store[id] ? clone(store[id]) : null; });
    hooks.put(kind, plan.changes, plan.open);
    const after = {};
    Object.keys(plan.changes).forEach(id => { after[id] = plan.changes[id] ? plan.changes[id].updated : null; });
    const msg = act === 'use' ? `${orig.title} is now the copy’s version.` : act === 'delete' ? 'Deleted the conflict copy.' : 'Kept the copy as its own.';
    hooks.toast(msg, null, { label: 'Undo', fn: () => {
      const st = hooks.store(kind);
      const moved = Object.keys(after).some(id => (st[id] ? st[id].updated : null) !== after[id] && !(after[id] === null && !st[id]));
      if (moved) { hooks.toast('Changed since, so it can’t be undone here. History has every version.', 'error'); return; }
      // Each keeps the sync base it has now: a sync since then makes the undo an edit on what it left.
      Object.keys(was).forEach(id => { const w = was[id]; if (!w) return; delete w.syncBase; if (st[id] && st[id].syncBase) w.syncBase = st[id].syncBase; });
      hooks.put(kind, was, copy.id);
    } });
  }
  function onKey(e) { if (e.key === 'Escape' && document.getElementById('lm-resolve')) close(); }
  function close() { const w = document.getElementById('lm-resolve'); if (w) w.remove(); document.removeEventListener('keydown', onKey); }

  LM.resolve = { isCopy, originOf, apply, init, open, close, SUFFIX };
})(window.LM = window.LM || {});
