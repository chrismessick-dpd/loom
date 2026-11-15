// Tags on system cables (Chris, 2026-11-15): Formboard's classes, kept on the cable in the system, so the
// system drawing shows them and Formboard routes by them. A tag is a name (cab.tags, an array of strings).
// A Formboard channel's class lets in cables carrying a tag of the same name, matched without case.
// The + offers every tag used in Loom: on any system's cables and every formboard's classes. A tag's color is
// a formboard class's of that name, else a fixed palette color from its name. Badges always carry the name,
// so color is never the only cue (Chris is colorblind).
//
// The editor (editorHtml) works anywhere: its element names a scope ('sys:<cable id>' or 'fb:<cable path>'),
// and the page that drew it registers what a change to that scope does (handle). Events are delegated here.
(function (LM) {
  'use strict';
  const U = LM.util, esc = U.esc;
  const PALETTE = ['#2e9e5b', '#d4a514', '#2f6fd1', '#9a4fd1', '#d1662f', '#1aa3a3', '#8a8f98'];
  const key = n => String(n || '').trim().toLowerCase();
  const clean = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  // A list of tags made tidy: trimmed, no blanks, no repeats (the first spelling kept).
  function tidy(list) {
    const seen = new Set(), out = [];
    (Array.isArray(list) ? list : []).forEach(n => { const c = clean(n), k = key(c); if (c && !seen.has(k)) { seen.add(k); out.push(c); } });
    return out;
  }
  const has = (list, name) => (list || []).some(n => key(n) === key(name));

  // Every tag in Loom, by first spelling, sorted.
  function all() {
    const seen = new Map();
    const add = n => { const c = clean(n); if (c && !seen.has(key(c))) seen.set(key(c), c); };
    const sys = LM.system && LM.system.store ? LM.system.store() : {};
    Object.values(sys || {}).forEach(s => { if (s && !s.deleted) (s.cables || []).forEach(c => (c.tags || []).forEach(add)); });
    const fbs = LM.formboard && LM.formboard.store ? LM.formboard.store() : {};
    Object.values(fbs || {}).forEach(f => { if (f && !f.deleted) (f.classes || []).forEach(c => add(c.name)); });
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }
  function color(name) {
    const k = key(name);
    const fb = LM.formboard && LM.formboard.current ? LM.formboard.current() : null;
    const pick = f => f && (f.classes || []).find(c => key(c.name) === k);
    let c = pick(fb);
    if (!c && LM.formboard && LM.formboard.store) Object.values(LM.formboard.store() || {}).some(f => !f.deleted && (c = pick(f)));
    if (c && c.color) return c.color;
    let h = 0;
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  // ── The editor: badges with a × each, and a + that opens a box with every tag in Loom offered ──
  function editorHtml(scope, list, opts) {
    opts = opts || {};
    const tags = tidy(list);
    return `<div class="tag-ed" data-tagscope="${esc(scope)}">` +
      tags.map(n => `<span class="tag-badge" style="--tag:${esc(color(n))}"><span class="tag-dot"></span>${esc(n)}` +
        (opts.readOnly ? '' : `<button type="button" class="tag-x" data-tagdel="${esc(n)}" title="Remove the tag ${esc(n)}" aria-label="Remove the tag ${esc(n)}">×</button>`) + '</span>').join('') +
      (opts.readOnly ? '' : `<button type="button" class="tag-add" data-tagadd title="Add a tag" aria-label="Add a tag">+</button>`) +
      (!tags.length && opts.empty ? `<span class="hint tag-none">${esc(opts.empty)}</span>` : '') + '</div>';
  }
  const handlers = {};
  function handle(prefix, fn) { handlers[prefix] = fn; }
  function current(ed) { return [...ed.querySelectorAll('.tag-badge')].map(b => b.childNodes[1] ? b.childNodes[1].textContent : b.textContent.replace(/×$/, '')); }
  function send(ed, tags) {
    const scope = ed.dataset.tagscope, i = scope.indexOf(':'), fn = handlers[scope.slice(0, i)];
    if (fn) fn(scope.slice(i + 1), tidy(tags));
  }
  function openBox(ed) {
    if (ed.querySelector('.tag-in')) { ed.querySelector('.tag-in').focus(); return; }
    const now = current(ed), offer = all().filter(n => !has(now, n));
    const id = 'tag-list-' + Math.random().toString(36).slice(2, 8);
    const box = document.createElement('span');
    box.className = 'tag-box';
    box.innerHTML = `<input class="input tag-in" list="${id}" placeholder="Tag name" aria-label="New tag" maxlength="40"><datalist id="${id}">${offer.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
    const plus = ed.querySelector('.tag-add');
    ed.insertBefore(box, plus);
    plus.hidden = true;
    const inp = box.querySelector('input');
    let done = false;
    const finish = take => {
      if (done) return;
      done = true;
      const v = clean(inp.value);
      if (take && v && !has(now, v)) { send(ed, now.concat([v])); return; }
      box.remove(); plus.hidden = false;
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); plus.focus(); }
    });
    // A pick from the list adds at once.
    inp.addEventListener('input', () => { if (offer.some(n => n === inp.value)) finish(true); });
    inp.addEventListener('blur', () => setTimeout(() => finish(true), 0));
    inp.focus();
  }
  document.addEventListener('click', e => {
    const t = e.target;
    if (!t || !t.closest) return;
    const del = t.closest('[data-tagdel]'), add = t.closest('[data-tagadd]');
    if (!del && !add) return;
    const ed = t.closest('.tag-ed');
    if (!ed) return;
    e.preventDefault(); e.stopPropagation();
    if (add) { openBox(ed); return; }
    send(ed, current(ed).filter(n => key(n) !== key(del.dataset.tagdel)));
  }, true);

  // ── On the drawing: small pills in a row, from (x, y) on the text's baseline, in SVG units ──
  const PILL = { fs: 10, h: 14, pad: 5, gap: 4 };
  function pillsW(list) { return tidy(list).reduce((w, n) => w + U.textW(n, PILL.fs) + PILL.pad * 2 + 8 + PILL.gap, 0); }
  function pillsSvg(list, x, y, cls) {
    let out = '', at = x;
    tidy(list).forEach(n => {
      const w = U.textW(n, PILL.fs) + PILL.pad * 2 + 8, c = esc(color(n));
      out += `<g class="tag-pill${cls ? ' ' + cls : ''}"><rect x="${at}" y="${y - PILL.h + 3}" width="${w}" height="${PILL.h}" rx="${PILL.h / 2}" style="stroke:${c}"/>` +
        `<circle cx="${at + PILL.pad + 2}" cy="${y - PILL.h / 2 + 3}" r="2.6" style="fill:${c}"/><text x="${at + PILL.pad + 7}" y="${y}">${esc(n)}</text></g>`;
      at += w + PILL.gap;
    });
    return out;
  }

  LM.tags = { tidy, has, key, all, color, editorHtml, handle, pillsSvg, pillsW };
})(window.LM = window.LM || {});
