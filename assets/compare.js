// Version tags and the compare view in Loom (Chris, 2026-11-14: "view at version", in Loom first; then one
// engine for the suite's history, with Signoff EE as the reference). The sheet, the tags, and the Version
// comparison bar are the Signoff engine's (vendor/history.js, window.SignoffHistory); this file is what Loom
// tells it: how to draw a stored version, how to put one back, and a key per document ('harness|<id>',
// 'system|<id>').
//
// Tags live on the document (h.tags or s.tags), a map of records (vendor/history.js), so they sync like any
// edit. Tag edits move the document's stamp (so they sync) but stay out of undo, and a version put back
// (undo, redo, Restore) keeps the tags the document has now (carry()).
(function (LM) {
  'use strict';
  const SH = window.SignoffHistory, T = SH.tags, X = SH.compare;
  const key = (kind, id) => kind + '|' + id;
  const kindOf = k => String(k).split('|')[0];

  // A stored file as a document Loom draws; null when it isn't one (no shims for old formats).
  function parse(kind, id, doc) {
    let d = null;
    try {
      if (kind === 'system') d = doc && doc.system && doc.system.id === id ? LM.system.normalize(JSON.parse(JSON.stringify(doc.system))) : null;
      else d = LM.store.unwrap(JSON.parse(JSON.stringify(doc)));
    } catch (e) { d = null; }
    return d && d.id === id ? d : null;
  }

  X.setup({
    render: () => { LM.app.tidy(); LM.app.renderAll(); },
    toast: (t, err) => LM.app.toast(t, err ? 'error' : undefined),
    // Drawn from the version as stored, its placed systems' tabs resolved.
    fresh: (k, d) => (kindOf(k) === 'system' ? LM.system.prepare(d) : LM.model.normalize(d)),
    restore: (k, older) => (kindOf(k) === 'system' ? LM.system.restore(older) : LM.app.restore(older)),
    word: k => kindOf(k),
    note: k => (kindOf(k) === 'system' ? 'Placed systems and harnesses show as they are now.' : ''),
    restoreNote: () => 'Undo takes it back.'
  });

  LM.compare = {
    key, parse, carry: T.carry, tags: T,
    active: X.active, refuse: X.refuse, reset: X.reset, exit: X.exit,
    view: (kind, id) => X.view(key(kind, id)),
    locked: (kind, id) => X.locked(key(kind, id)),
    // Called as the page draws: leaving the harness or system being compared ends the comparison.
    check: (kind, id) => X.check(key(kind, id))
  };
})(window.LM = window.LM || {});
