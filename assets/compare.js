// Version tags and the compare view (Chris, 2026-11-14: "view at version", in Loom first, the rest of
// Signoff later). In History, a synced version can be tagged with a note on what it was; a tagged version
// has Compare, which opens the Version comparison bar over the page (where the demo's bar sits). Its two
// tabs, Current and the tag, switch the main window between the live document and that version, keeping
// the view (the tab, the camera, and the selection where it still exists). The tagged version is read-only:
// nothing written while it shows reaches the store, undo, or the sync. Restore this version puts it back as
// a new edit, as History's Restore does.
//
// Tags live on the document itself (h.tags or s.tags), so they sync like any edit and everyone with the
// harness or system sees them: [{ id, commit, stamp, note, at, by, made }]. commit is the git commit that
// holds the version (to fetch it); stamp is the version's own "updated|updatedBy" (R.stampKey), which is how
// History matches a tag to its row, since a write that only changed the summary keeps the stamp. Tag edits
// move the document's stamp (so they sync) but stay out of undo, and a version put back (undo, redo,
// Restore) keeps the tags the document has now (carry()).
(function (LM) {
  'use strict';
  const SG = window.Signoff || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const SHA = /^[0-9a-f]{7,40}$/;

  // ── Tags on a document ──
  function tagsOf(d) {
    const t = d && Array.isArray(d.tags) ? d.tags : [];
    return t.filter(x => x && typeof x === 'object' && typeof x.commit === 'string' && SHA.test(x.commit) && typeof x.stamp === 'string')
      .map(x => ({ id: String(x.id || ''), commit: x.commit, stamp: x.stamp, note: String(x.note || ''), at: String(x.at || ''), by: String(x.by || ''), made: String(x.made || '') }));
  }
  // A version put back keeps the tags the document has now: tags name versions, not edits.
  function carry(doc, cur) {
    if (!doc) return doc;
    const t = cur && Array.isArray(cur.tags) && cur.tags.length ? JSON.parse(JSON.stringify(cur.tags)) : null;
    if (t) doc.tags = t; else delete doc.tags;
    return doc;
  }
  // The tag on one version (by its stamp), if any.
  const tagAt = (d, stamp) => tagsOf(d).find(t => t.stamp === stamp) || null;
  // The new list with one tag set (note given) or removed (note null).
  function withTag(list, v, note, by) {
    const rest = list.filter(t => t.stamp !== v.stamp);
    if (note == null) return rest;
    const was = list.find(t => t.stamp === v.stamp);
    return rest.concat([{ id: was ? was.id : LM.util.uid('t'), commit: v.commit, stamp: v.stamp, note: String(note).slice(0, 200), at: v.at, by: by || '', made: new Date().toISOString() }])
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }
  // What a change did to the tags, for History: [{ verb: 'tagged a version', what: '“EVT build”' }].
  function tagPhrases(a, b) {
    if (!a || !b) return [];
    const A = new Map(tagsOf(a).map(t => [t.stamp, t])), B = new Map(tagsOf(b).map(t => [t.stamp, t])), out = [];
    B.forEach((t, k) => {
      const o = A.get(k);
      if (!o) out.push({ verb: 'tagged a version', what: '“' + t.note + '”' });
      else if (o.note !== t.note) out.push({ verb: 'renamed a tag', what: '“' + o.note + '” to “' + t.note + '”' });
    });
    A.forEach((t, k) => { if (!B.has(k)) out.push({ verb: 'removed the tag', what: '“' + t.note + '”' }); });
    return out;
  }

  // ── A version from GitHub ──
  // The file at one commit: the contents API inlines files up to 1 MB; a larger one comes as its blob.
  async function fetchVersion(kind, id, commit) {
    const R = LM.store, c = R.config(), tok = R.token();
    if (!tok) throw new Error('Sign in to GitHub to open a tagged version.');
    const full = (kind === 'harness' && R.homeOf(id)) || (c.owner + '/' + c.dataRepo);
    const store = new SG.GitHubStore({ owner: full.split('/')[0], repo: full.split('/')[1], branch: 'main', dataPath: '', token: tok });
    const path = (kind === 'system' ? 'systems/projects/' : 'projects/') + id + '.json';
    const f = await store.api('/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(commit));
    const text = f && f.content && f.encoding === 'base64' ? SG.github.b64Decode(f.content) : await store.blob(f.sha);
    return parse(kind, id, JSON.parse(text));
  }
  // A stored file as a document Loom draws; null when it isn't one (no shims for old formats).
  function parse(kind, id, doc) {
    let d = null;
    try {
      if (kind === 'system') d = doc && doc.system && doc.system.id === id ? LM.system.prepare(JSON.parse(JSON.stringify(doc.system))) : null;
      else d = LM.store.unwrap(JSON.parse(JSON.stringify(doc)));
    } catch (e) { d = null; }
    return d && d.id === id ? d : null;
  }

  // ── The compare view ──
  // C: { kind, id, title, tag, pristine (JSON of the version), doc (the copy drawn), side: 'current' | 'tag' }.
  let C = null;
  const active = () => !!C;
  // The document to draw for this one, while its tag shows; null otherwise.
  const view = (kind, id) => (C && C.side === 'tag' && C.kind === kind && C.id === id ? C.doc : null);
  const locked = (kind, id) => !!view(kind, id);
  let refusedAt = 0;
  function refuse() {
    if (Date.now() - refusedAt > 1500) LM.app.toast('This is the tagged version, so it’s read-only. Switch to Current to edit, or Restore this version.');
    refusedAt = Date.now();
  }
  // Anything drawn or dragged into the copy is dropped: it goes back to the version as stored.
  function reset() { if (C) C.doc = fresh(); }
  function fresh() { const d = JSON.parse(C.pristine); return C.kind === 'system' ? LM.system.prepare(d) : LM.model.normalize(d); }

  async function start(kind, doc, tag) {
    let v;
    try { v = await fetchVersion(kind, doc.id, tag.commit); }
    catch (e) { LM.app.toast('Couldn’t read that version from GitHub: ' + (e.message || e), 'error'); return false; }
    if (!v) { LM.app.toast('That version can’t be drawn by this Loom (its format is older).', 'error'); return false; }
    C = { kind, id: doc.id, title: doc.title || '', tag, pristine: JSON.stringify(v), doc: null, side: 'tag' };
    reset();
    drawBar();
    LM.app.tidy();
    LM.app.renderAll();
    return true;
  }
  function side(to) {
    if (!C || C.side === to) return;
    C.side = to; reset();
    drawBar(); LM.app.tidy(); LM.app.renderAll();
  }
  function exit(quiet) {
    if (!C) return;
    C = null;
    drawBar();
    if (!quiet) { LM.app.tidy(); LM.app.renderAll(); }
  }
  // Called as the page draws: leaving the harness or system being compared ends the comparison.
  function check(kind, id) { if (C && (C.kind !== kind || C.id !== id)) exit(true); }
  function restore() {
    if (!C) return;
    const word = C.kind === 'system' ? 'system' : 'harness', older = JSON.parse(C.pristine), note = C.tag.note;
    if (!confirm(`Put the ${word} back as it was at “${note}”?\n\nIt’s saved as a new edit by you and syncs like any other. Nothing in GitHub’s history is rewritten, its tags stay, and Undo takes it back.`)) return;
    C.side = 'current';   // restore reads the live document
    const done = C.kind === 'system' ? LM.system.restore(older) : LM.app.restore(older);
    if (done === false) { LM.app.toast('Couldn’t restore it: open the ' + word + ' and try again.', 'error'); return; }
    exit();
  }

  function drawBar() {
    const bar = document.getElementById('compare-bar');
    if (!bar) return;
    document.body.classList.toggle('has-compare', !!C);
    document.body.classList.toggle('lm-peek', !!C && C.side === 'tag');
    bar.hidden = !C;
    if (!C) { bar.innerHTML = ''; return; }
    const tagSide = C.side === 'tag', SYS = C.kind === 'system';
    const note = tagSide ? 'Viewing the tagged version · read-only' + (SYS ? '. Placed systems and harnesses show as they are now.' : '') : 'Viewing the current version';
    const when = C.tag.at ? new Date(C.tag.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    bar.className = 'compare-bar' + (tagSide ? ' on-tag' : '');
    bar.innerHTML = `<span class="cmp-title"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5V3.2c0-.4.3-.7.7-.7h5.3l5 5-6 6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="5.6" cy="5.6" r="1.1" fill="currentColor"/></svg>Version comparison</span>
      <span class="cmp-what">${esc(C.title)}</span>
      <span class="cmp-tabs" role="tablist" aria-label="Show">
        <button role="tab" data-cmp="current" aria-selected="${!tagSide}">Current</button>
        <button role="tab" data-cmp="tag" aria-selected="${tagSide}" title="${esc(C.tag.note + (when ? ' · ' + when : ''))}"><span class="cmp-tag">${esc(C.tag.note || 'Tagged version')}</span>${when ? `<span class="cmp-date">${esc(when)}</span>` : ''}</button>
      </span>
      <span class="cmp-note" title="${esc(note)}">${esc(note)}</span>
      <span class="cmp-acts">${tagSide ? '<button class="cmp-btn" data-cmp="restore">Restore this version…</button>' : ''}<button class="cmp-btn cmp-x" data-cmp="exit" title="End the comparison" aria-label="End the comparison">Done</button></span>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#compare-bar [data-cmp]');
    if (!b) return;
    const a = b.getAttribute('data-cmp');
    if (a === 'current' || a === 'tag') side(a);
    else if (a === 'restore') restore();
    else if (a === 'exit') exit();
  });
  LM.compare = { tagsOf, carry, tagAt, withTag, tagPhrases, fetchVersion, parse, active, view, locked, refuse, reset, start, side, exit, check,
    state: () => C };
})(window.LM = window.LM || {});
