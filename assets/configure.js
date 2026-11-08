// Configure a connector (Chris, 2026-11-07): its ref, name and type in one window, opened from the
// Configure button in Properties. A type is one of the families, or Custom: a face drawn from a 3D
// model (STEP, IGES or STL; turn it, or click a face to look straight at it, then make the face view)
// or sketched with basic shapes, with a mark dropped on each position (Assign) before the part can be
// made. Custom data is n.custom, all in mm (shapes.js customParts reads it):
//   { kind, mark, src: 'sketch' | 'model',
//     sketch: { shapes: [{ id, t: 'rect' | 'round' | 'ellipse' | 'line', x, y, w, h, r, fill } | { id, t: 'line', x, y, x2, y2 }], pins },
//     model: { name, d, w, h, k, view: { look, right, up }, pins } }
// pins[i] is [x, y] for M.pinList(n)[i], or null while it has no mark. Only the face drawing is kept;
// the model itself stays in memory for this session (to try other views), never in the harness.
// The window edits a draft; Make part (or Apply) writes it as one change, so one undo reverts it.
(function (LM) {
  'use strict';
  const M = LM.model, L = LM.library, U = LM.util, Sh = LM.shapes, esc = U.esc;
  const $ = s => document.querySelector(s);
  const r2 = v => Math.round(v * 100) / 100;
  const THREE_JS = { src: 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js', sri: 'sha384-RRHfJ6w1mTlKUBMYT/hvnRiOzEB/vyRV3DrQOseb6oYfvaZSfdd0byS4bHps0k2R' };
  const TOOLS = [['select', 'Select', 'V'], ['rect', 'Rectangle', 'R'], ['round', 'Rounded rectangle', 'U'], ['ellipse', 'Circle or ellipse', 'C'], ['line', 'Line', 'L']];
  const GRIDS = [0.1, 0.25, 0.5, 1, 1.27, 2.54];
  const MAX_POS = 200;
  const ICO = {
    select: '<path d="M4 2.5l8 5.2-3.6.7 2.1 4-1.6.8-2.1-4L4 11.6z"/>',
    rect: '<rect x="2.5" y="4" width="11" height="8" rx="0.5"/>',
    round: '<rect x="2.5" y="4" width="11" height="8" rx="3"/>',
    ellipse: '<circle cx="8" cy="8" r="5"/>',
    line: '<path d="M3 12.5 13 3.5"/>',
    trash: '<path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5"/>',
    fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
    left: '<path d="M6 3.5 2.8 6.7 6 9.9"/><path d="M3 6.7h6.5a3.5 3.5 0 0 1 0 7H7"/>',
    right: '<path d="M10 3.5l3.2 3.2L10 9.9"/><path d="M13 6.7H6.5a3.5 3.5 0 0 0 0 7H9"/>',
    cube: '<path d="M8 1.8 13.6 5v6L8 14.2 2.4 11V5z"/><path d="M2.4 5 8 8.2 13.6 5M8 8.2v6"/>',
    pen: '<path d="M10.5 3.5l2 2L6 12H4v-2z"/>',
    pin: '<circle cx="8" cy="7" r="3.2"/><path d="M8 10.2V14"/>',
  };
  const ico = (k, cls) => `<svg class="${cls || 'ico'}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICO[k]}</svg>`;

  let D = null, api = null, mesh = null, V3 = null, undoStack = [];
  const meshes = new Map(); // node id → { mesh, name }: the model read this session

  // ── Draft ──
  const clone = o => JSON.parse(JSON.stringify(o));
  const isCustom = () => D.family === 'custom';
  const count = () => (D.board ? D.board.length : D.pins);
  function names() { if (D.board) return D.board; const o = []; for (let i = 1; i <= D.pins; i++) o.push(String(i)); return o; }
  const part = () => (D.tab === 'model' ? D.custom.model : D.custom.sketch);
  function fitPins(arr) { const n = count(); arr = (arr || []).slice(0, n); while (arr.length < n) arr.push(null); return arr; }
  function syncPins() { D.custom.sketch.pins = fitPins(D.custom.sketch.pins); if (D.custom.model) D.custom.model.pins = fitPins(D.custom.model.pins); }
  const placed = p => (p ? p.pins.filter(Boolean).length : 0);
  function pushUndo() { undoStack.push(JSON.stringify(D.custom)); if (undoStack.length > 80) undoStack.shift(); }
  function undo() { if (!undoStack.length) return; D.custom = JSON.parse(undoStack.pop()); D.sel = null; D.assign = -1; refresh(); }
  // The node as the draft would make it, for previews (its id, so wire colors show).
  function draftNode() {
    const n = M.node(api.h(), D.id);
    const c = clone(D.custom);
    c.src = D.tab;
    return Object.assign({}, n, { ref: D.ref, name: D.name, family: D.family, pins: count(), rows: D.rows, gender: D.gender, custom: c });
  }

  function open(opts) {
    api = opts;
    const n = M.node(api.h(), opts.nodeId);
    if (!n) return;
    const c = clone(n.custom || {});
    c.sketch = c.sketch || { shapes: [], pins: [] };
    c.model = c.model && c.model.d ? c.model : null;
    D = {
      id: n.id, ref: n.ref || '', name: n.name || '', family: n.family, pins: n.pins || 1, rows: n.rows || 1, gender: n.gender || 'receptacle',
      board: Array.isArray(n.pinNames) && n.pinNames.length ? n.pinNames.map(String) : null,
      custom: c, tab: c.src === 'model' && c.model ? 'model' : 'sketch', tool: 'select', sel: null, assign: -1,
      cam: { sketch: null, model: null }, grid: 0.5, trace: true, mode3d: false, busy: '', err: '', note: '',
    };
    const m = meshes.get(n.id);
    mesh = m ? m.mesh : null;
    D.fileName = m ? m.name : (c.model && c.model.name) || '';
    D.mode3d = !!mesh && !c.model;
    if (D.mode3d) V3q(null);
    undoStack = [];
    syncPins();
    $('#cfg-modal').hidden = false;
    render();
    setTimeout(() => { const el = $('#cfg-modal [data-cf="name"]'); if (el && !matchMedia('(pointer: coarse)').matches) el.focus(); }, 30);
  }
  function close() {
    if (!D) return;
    D = null;
    $('#cfg-modal').hidden = true;
    $('#cfg-body').innerHTML = '';
    if (V3) V3.el = null;
  }
  function why() {
    if (!D.ref.trim()) return 'Give it a ref.';
    if (!isCustom()) return '';
    const p = part(), n = count();
    if (D.tab === 'model' && !p) return 'Make a face view from a model first.';
    if (D.tab === 'sketch' && !p.shapes.length) return 'Sketch the connector first.';
    const left = n - placed(p);
    if (left) return `Mark ${left === n ? 'all ' + n : left + ' more'} position${left === 1 ? '' : 's'}: press Assign, then click each one in order.`;
    return '';
  }
  function apply() {
    if (why()) return;
    const d = D;
    api.apply(h => {
      const n = M.node(h, d.id);
      if (!n) return;
      n.ref = d.ref.trim();
      n.name = d.name.trim();
      n.family = d.family;
      n.gender = d.gender;
      if (d.family === 'custom') {
        const c = clone(d.custom);
        c.src = d.tab;
        c.kind = (c.kind || '').trim();
        if (!c.model) delete c.model;
        n.custom = c;
        n.pins = count();
      } else {
        n.pins = d.pins;
        n.rows = d.rows;
        L.conform(n);
      }
      if (d.board) n.pins = d.board.length; // board pins stay
    });
    close();
  }

  // ── The window ──
  function render() {
    if (!D) return;
    const n = M.node(api.h(), D.id);
    const head = `<div class="lm-modal-head"><div><div class="eyebrow">Configure connector</div><div class="rail-title"><span class="mono-ref">${esc(D.ref || n.ref)}</span> ${esc(D.name || L.kindName(draftNode()))}</div></div><button class="icon-btn" data-cfg="close" title="Close (Esc)" aria-label="Close"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>`;
    $('#cfg-body').innerHTML = head + `<div class="cfg-main${isCustom() ? ' is-custom' : ''}"><div class="cfg-form">${formHtml()}</div><div class="cfg-right">${isCustom() ? stageHtml() : previewHtml()}</div></div>` +
      `<div class="cfg-foot"><span class="f-hint" id="cfg-why"></span><button class="btn" data-cfg="close">Cancel</button><button class="btn btn-primary" data-cfg="apply" id="cfg-apply">${isCustom() ? 'Make part' : 'Apply'}</button></div>`;
    mountStage();
    refresh();
  }
  // What changes with edits, without rebuilding the window (inputs keep focus).
  function refresh() {
    if (!D) return;
    const w = why(), ap = $('#cfg-apply');
    if (ap) ap.disabled = !!w;
    const wy = $('#cfg-why');
    if (wy) wy.textContent = D.err || w || (isCustom() ? 'Ready. Make part replaces the connector’s drawing everywhere.' : '');
    if (wy) wy.classList.toggle('err', !!D.err);
    const t = $('#cfg-body .rail-title');
    if (t) t.innerHTML = `<span class="mono-ref">${esc(D.ref)}</span> ${esc(D.name || L.kindName(draftNode()))}`;
    const pv = $('#cfg-preview');
    if (pv) pv.innerHTML = Sh.faceSvg(api.h(), draftNode(), 520, 260);
    // Swapped only when they change: a field committed on blur re-renders, and a swap under the
    // pointer would eat the click that blurred it (typing 8 in Positions, then clicking Assign).
    const as = $('#cfg-assign'), ah = assignHtml();
    if (as && as.dataset.html !== ah) { as.outerHTML = ah; $('#cfg-assign').dataset.html = ah; }
    const tl = $('#cfg-tools'), th = toolsHtml();
    if (tl && tl.dataset.html !== th) { tl.innerHTML = th; tl.dataset.html = th; }
    draw2d();
  }

  const fld = (label, inner, hint) => `<div class="field"><label>${label}</label>${inner}${hint ? `<div class="f-hint">${hint}</div>` : ''}</div>`;
  const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
  const seg = (k, cur, choices) => `<div class="seg full">${choices.map(([v, l]) => `<button data-cfg="seg" data-k="${k}" data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  // A small face of a family, for its type tile.
  function tileFace(fam) {
    const sample = { 'generic-rect': 4, 'generic-circ': 4, flying: 3, ring: 1, ferrule: 1 }[fam.id] || L.pinChoices(fam)[0];
    const tmp = { id: '_tile', kind: 'connector', family: fam.id, pins: sample, rows: 1, gender: 'receptacle' };
    const v = Sh.face({ wires: [] }, tmp, 'front');
    return `<svg class="lm-face" viewBox="${-v.ox - 4} -4 ${v.w + 8} ${v.h + 8}" preserveAspectRatio="xMidYMid meet">${v.svg}</svg>`;
  }
  function formHtml() {
    const generic = L.FAMILIES.filter(f => f.group === 'Generic'), series = L.FAMILIES.filter(f => f.group !== 'Generic' && f.group !== 'Custom');
    const fam = L.family(D.family), isSeries = series.includes(fam);
    const tiles = generic.map(f => `<button class="cfg-type${D.family === f.id ? ' on' : ''}" data-cfg="type" data-v="${f.id}">${tileFace(f)}<span>${esc(f.name)}</span></button>`).join('') +
      `<button class="cfg-type cfg-type-custom${isCustom() ? ' on' : ''}" data-cfg="type" data-v="custom"><span class="cfg-cust-ico">${ico('cube')}${ico('pen')}</span><span>Custom</span></button>`;
    const groups = [...new Set(series.map(f => f.group))];
    const seriesSel = `<select class="input" data-cf="series"><option value="">${isSeries ? 'Generic or custom' : 'Or a connector series…'}</option>${groups.map(g => `<optgroup label="${esc(g)}">${series.filter(f => f.group === g).map(f => opt(f.id, f.name, isSeries ? D.family : '')).join('')}</optgroup>`).join('')}</select>`;
    let o = `<div class="row2">${fld('Ref', `<input class="input" data-cf="ref" value="${esc(D.ref)}" spellcheck="false">`)}${fld('Name', `<input class="input" data-cf="name" value="${esc(D.name)}" placeholder="Main PCBA J6">`)}</div>`;
    o += fld('Type', `<div class="cfg-types">${tiles}</div>${seriesSel}`);
    const housing = L.hasHousing(fam);
    if (!isCustom()) {
      const pins = L.pinChoices(fam);
      const pinSel = D.board ? `<div class="input ro">${D.board.length} from the board</div>`
        : `<select class="input" data-cf="pins"${pins.length < 2 ? ' disabled' : ''}>${pins.map(p => opt(p, p + (fam.style === 'flying' ? ' leads' : ' pins'), D.pins)).join('')}</select>`;
      o += `<div class="row2">${fld(fam.style === 'flying' ? 'Leads' : 'Pins', pinSel)}${fam.rows && fam.rows.length > 1 ? fld('Rows', seg('rows', D.rows, [[1, '1'], [2, '2']])) : ''}</div>`;
      if (housing) o += fld('Gender', seg('gender', D.gender, [['receptacle', 'Receptacle'], ['plug', 'Plug']]));
      return o;
    }
    o += fld('Description', `<input class="input" data-cf="kind" value="${esc(D.custom.kind || '')}" placeholder="LEMO 1B plug">`, 'Shown on the diagram, the drawing and the BOM in place of a family name.');
    o += `<div class="row2">${fld('Positions', D.board ? `<div class="input ro">${D.board.length} from the board</div>` : `<input class="input" type="number" min="1" max="${MAX_POS}" step="1" data-cf="pins" value="${D.pins}">`)}${fld('Gender', seg('gender', D.gender, [['receptacle', 'Rcpt'], ['plug', 'Plug']]))}</div>`;
    o += assignHtml();
    return o;
  }
  // The Assign button, mark size and one chip per position (click one to place it again).
  function assignHtml() {
    if (!isCustom()) return '<div id="cfg-assign"></div>';
    const p = part(), nm = names(), n = nm.length, k = placed(p), on = D.assign >= 0, ok = !!p && (D.tab === 'sketch' || !D.mode3d);
    const auto = r2(Sh.markSize({}, p ? p.pins : []));
    const mark = D.custom.mark || 0;
    const chips = nm.map((name, i) => `<button class="cfg-chip${p && p.pins[i] ? ' set' : ''}${D.assign === i ? ' next' : ''}" data-cfg="pin" data-i="${i}" title="${p && p.pins[i] ? 'Place ' + esc(name) + ' again' : 'Place ' + esc(name)}"${ok ? '' : ' disabled'}>${esc(name)}</button>`).join('');
    return `<div id="cfg-assign" class="cfg-assign"><div class="cat-label">Positions</div>
      <button class="btn cfg-assign-btn${on ? ' on' : ''}${k === n ? ' done' : ''}" data-cfg="assign"${ok ? '' : ' disabled'}>${ico('pin')}<span>${on ? 'Click position ' + esc(nm[D.assign]) : 'Assign'}</span><b>${k}/${n}</b></button>
      <div class="f-hint">${ok ? (on ? 'Click on the drawing to drop each mark, in order. Esc stops.' : k === n ? 'Every position has a mark. Drag a mark to move it; right-click removes it.' : 'Press Assign, then click each position on the drawing in pin order.') : 'Make a face view first.'}</div>
      <div class="cfg-chips">${chips}</div>
      ${k ? '<button class="linkish" data-cfg="clear-marks">Clear all marks</button>' : ''}
      <div class="field cfg-mark-size"><label>Mark size <span class="pc-muted">${mark ? mark.toFixed(1) + ' mm' : 'auto, ' + auto.toFixed(1) + ' mm'}</span></label><input type="range" min="0" max="6" step="0.1" value="${mark}" data-cf="mark" aria-label="Mark size"></div></div>`;
  }
  function previewHtml() {
    return `<div class="cfg-preview-wrap"><div class="face-tile cfg-preview" id="cfg-preview"></div><p class="f-hint">This is the face the diagram and the drawing show. Choose Custom to draw a connector the families don’t cover, from a 3D model or a sketch.</p></div>`;
  }
  function stageHtml() {
    const tabs = `<div class="seg cfg-tabs"><button data-cfg="tab" data-v="model" class="${D.tab === 'model' ? 'on' : ''}">${ico('cube')}3D model</button><button data-cfg="tab" data-v="sketch" class="${D.tab === 'sketch' ? 'on' : ''}">${ico('pen')}Sketch</button></div>`;
    return `<div class="cfg-stage-head">${tabs}<div class="cfg-tools" id="cfg-tools"></div></div>
      <div class="cfg-stage" id="cfg-stage" tabindex="-1"></div>
      <input type="file" id="cfg-file" accept=".step,.stp,.iges,.igs,.stl" hidden>`;
  }
  function toolsHtml() {
    if (!isCustom()) return '';
    const gridSel = `<label class="cfg-grid" title="Snap grid (hold Alt to place freely)">Grid <select class="input" data-cf="grid">${GRIDS.map(g => opt(g, g + ' mm', D.grid)).join('')}</select></label>`;
    const fit = `<button class="icon-btn" data-cfg="fit" title="Fit (F)" aria-label="Fit">${ico('fit')}</button>`;
    if (D.tab === 'sketch') {
      const s = selShape();
      let o = `<div class="seg">${TOOLS.map(([k, l, key]) => `<button data-cfg="tool" data-v="${k}" class="${D.tool === k ? 'on' : ''}" title="${l} (${key})" aria-label="${l}">${ico(k)}</button>`).join('')}</div>`;
      if (s) {
        o += `<span class="cfg-sel">`;
        if (s.t === 'line') o += ['x', 'y', 'x2', 'y2'].map(k => `<label>${k.toUpperCase()}<input class="input" type="number" step="0.1" data-cf="shape.${k}" value="${r2(s[k])}"></label>`).join('');
        else {
          o += ['x', 'y', 'w', 'h'].map(k => `<label>${k.toUpperCase()}<input class="input" type="number" step="0.1"${k === 'w' || k === 'h' ? ' min="0.1"' : ''} data-cf="shape.${k}" value="${r2(s[k])}"></label>`).join('');
          if (s.t === 'round') o += `<label>R<input class="input" type="number" min="0" step="0.1" data-cf="shape.r" value="${r2(s.r || 0)}"></label>`;
          o += `<label class="cfg-check"><input type="checkbox" data-cf="shape.fill"${s.fill === false ? '' : ' checked'}>Fill</label>`;
        }
        o += `<button class="icon-btn" data-cfg="del-shape" title="Delete (Del)" aria-label="Delete shape">${ico('trash')}</button></span>`;
      }
      o += `<span class="cfg-spacer"></span>`;
      if (D.custom.model) o += `<label class="cfg-check" title="Show the model's face view under the sketch"><input type="checkbox" data-cf="trace"${D.trace ? ' checked' : ''}>Trace model</label>`;
      return o + gridSel + fit;
    }
    // The model tab.
    if (D.busy) return '';
    if (D.mode3d && mesh) {
      const views = Object.entries(LM.step.VIEWS).map(([k, v]) => `<button data-cfg="view3d" data-v="${k}" title="${esc(v.label)}">${esc(k)}</button>`).join('');
      return `<div class="seg cfg-views">${views}</div><button class="icon-btn" data-cfg="spin" data-v="-1" title="Turn left 90°" aria-label="Turn left">${ico('left')}</button><button class="icon-btn" data-cfg="spin" data-v="1" title="Turn right 90°" aria-label="Turn right">${ico('right')}</button>` +
        `<span class="cfg-spacer"></span>${D.custom.model ? '<button class="btn" data-cfg="face-back">Cancel</button>' : ''}<button class="btn btn-primary" data-cfg="make-face">Make face view</button>`;
    }
    if (D.custom.model) {
      const rot = `<span class="cfg-rot" title="Turn the face about the axis you're looking down ([ and ] turn 1°, with Shift 15°)"><button class="icon-btn" data-cfg="rot" data-v="-90" title="Turn left 90°" aria-label="Turn left 90°">${ico('left')}</button><button class="icon-btn" data-cfg="rot" data-v="90" title="Turn right 90°" aria-label="Turn right 90°">${ico('right')}</button><input class="input" type="number" step="1" data-cf="rot" value="${r2(D.custom.model.rot || 0)}" aria-label="Rotation in degrees">°</span>` +
        `<button class="btn${D.pointUp ? ' on' : ''}" data-cfg="point-up" title="Click a feature, like the key, to turn it to 12 o'clock">Point up</button>`;
      return `<span class="cfg-file" title="${esc(D.custom.model.name || '')}">${ico('cube')}${esc(D.custom.model.name || 'Model')}</span>` +
        (mesh ? '<button class="btn" data-cfg="change-view">Change view</button>' : '') + `<button class="btn" data-cfg="import">${mesh ? 'Another model…' : 'Import again…'}</button>${rot}<span class="cfg-spacer"></span>${gridSel}${fit}`;
    }
    return mesh ? '' : '<span class="cfg-spacer"></span><button class="btn" data-cfg="import">Import a model…</button>';
  }

  // ── The stage ──
  function mountStage() {
    const st = $('#cfg-stage');
    if (!st) return;
    if (D.tab === 'model' && D.busy) { st.innerHTML = `<div class="cfg-empty"><span class="spinner"></span>${esc(D.busy)}</div>`; return; }
    if (D.tab === 'model' && D.mode3d && mesh) { st.innerHTML = '<div class="cfg-3d" id="cfg-3d"></div><svg class="cfg-ring" id="cfg-ring3"></svg><div class="cfg-tip glass" id="cfg-tip">Drag to turn · click a face to look straight at it · drag the dot on the ring to turn it in place</div>'; mount3d($('#cfg-3d')); return; }
    if (D.tab === 'model' && !D.custom.model) {
      st.innerHTML = `<div class="cfg-empty cfg-drop" id="cfg-drop">${ico('cube', 'big')}<b>Drop a STEP, IGES or STL file here</b><span>or</span><button class="btn btn-primary" data-cfg="import">Import a model…</button>
        <p class="f-hint">Turn it, or click a face to look straight at it, then make the face view. Loom keeps that drawing; the model itself stays in this tab only. Vendors’ sites and 3D ContentCentral usually have connector models.</p></div>`;
      return;
    }
    st.innerHTML = `<svg id="cfg-svg" class="cfg-svg${D.tab === 'sketch' ? ' sketching' : ''}" xmlns="http://www.w3.org/2000/svg"></svg>`;
    if (!D.cam[D.tab]) fitView();
    draw2d();
  }
  // Every coordinate on the 2D stage is in mm; the camera is a center and px per mm.
  function bounds() {
    const p = part();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    if (D.tab === 'model' && p) { grow(0, 0); grow(p.w * p.k, p.h * p.k); }
    if (D.tab === 'sketch') {
      p.shapes.forEach(s => { if (s.t === 'line') { grow(s.x, s.y); grow(s.x2, s.y2); } else { grow(s.x, s.y); grow(s.x + s.w, s.y + s.h); } });
      if (D.trace && D.custom.model) { const m = D.custom.model; grow(0, 0); grow(m.w * m.k, m.h * m.k); }
    }
    (p ? p.pins : []).forEach(q => q && grow(q[0], q[1]));
    if (!isFinite(x0)) return { x0: -2, y0: -2, x1: 22, y1: 14 };
    return { x0, y0, x1, y1 };
  }
  function stageSize() { const st = $('#cfg-stage'); return st ? { W: st.clientWidth || 600, H: st.clientHeight || 400 } : { W: 600, H: 400 }; }
  function fitView() {
    const b = bounds(), { W, H } = stageSize();
    const w = Math.max(b.x1 - b.x0, 2), h = Math.max(b.y1 - b.y0, 2);
    D.cam[D.tab] = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, z: Math.min((W - 80) / w, (H - 80) / h, 400) };
  }
  function selShape() { return D.tab === 'sketch' && D.sel ? D.custom.sketch.shapes.find(s => s.id === D.sel) || null : null; }
  function draw2d() {
    const svg = $('#cfg-svg');
    if (!svg || !D) return;
    const cam = D.cam[D.tab];
    if (!cam) return;
    const { W, H } = stageSize(), z = cam.z, vx = cam.cx - W / 2 / z, vy = cam.cy - H / 2 / z;
    svg.setAttribute('viewBox', `${vx} ${vy} ${W / z} ${H / z}`);
    // The grid: the snap step, or a multiple of it big enough to see.
    let g = D.grid;
    while (g * z < 7) g *= g === D.grid && D.grid === 1.27 ? 2 : 5;
    const G = g * 5;
    let o = `<defs><pattern id="cfg-g1" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><path d="M${g} 0V${g}H0" fill="none" class="cfg-gl"/></pattern>` +
      `<pattern id="cfg-g5" width="${G}" height="${G}" patternUnits="userSpaceOnUse"><rect width="${G}" height="${G}" fill="url(#cfg-g1)"/><path d="M${G} 0V${G}H0" fill="none" class="cfg-gl5"/></pattern></defs>`;
    o += `<rect x="${vx}" y="${vy}" width="${W / z}" height="${H / z}" fill="url(#cfg-g5)" data-bg="1"/>`;
    o += `<path class="cfg-axis" d="M${vx} 0H${vx + W / z}M0 ${vy}V${vy + H / z}"/>`;
    const p = part(), h = api.h(), n = draftNode();
    const id = { x: v => v, y: v => v };
    if (D.tab === 'model' && p) o += `<g class="cfg-model">${Sh.customSvg({ src: 'model', part: p }, id.x, id.y, 1)}</g>`;
    if (D.tab === 'sketch') {
      if (D.trace && D.custom.model) o += `<g class="cfg-trace">${Sh.customSvg({ src: 'model', part: D.custom.model }, id.x, id.y, 1)}</g>`;
      p.shapes.forEach(s => { o += shapeSvg(s); });
      const s = selShape();
      if (s) o += handles(s, z);
    }
    // Marks, in their wire's color.
    const cols = Sh.pinColors(h, n), nm = names(), r = Sh.markSize(D.custom, p ? p.pins : []) / 2;
    (p ? p.pins : []).forEach((q, i) => {
      if (!q) return;
      const c = cols.get(nm[i]), fill = c && c.base;
      o += `<g class="cfg-mark${fill ? ' on' : ''}${D.assign === i ? ' redo' : ''}" data-mark="${i}"><circle cx="${q[0]}" cy="${q[1]}" r="${r}"${fill ? ` style="fill:${fill}"` : ''}/>` +
        `<text x="${q[0]}" y="${q[1]}" font-size="${r2(r * (nm[i].length > 2 ? 0.75 : 1))}" dy="0.36em" text-anchor="middle"${fill ? ` style="fill:${ink(fill)}"` : ''}>${esc(nm[i])}</text></g>`;
    });
    if (D.tab === 'model' && p && !D.pointUp) {
      // The ring for turning the face, round the connector's axis.
      const [ux, uy] = rotCenter(), big = (p.c || []).concat(p.f || []).filter(c => c[2] * 2 >= Math.max(p.w, p.h) * 0.3).sort((a, b) => b[2] - a[2])[0];
      const rr = big ? big[2] * p.k * 1.1 : Math.hypot(p.w, p.h) / 2 * p.k * 1.04;
      o += `<g class="cfg-ring2">${ringSvg(ux * p.k, uy * p.k, rr, p.rot || 0, 7 / z, ring && ring.kind === '2d')}</g>`;
    }
    o += '<g id="cfg-ghost"></g>';
    svg.innerHTML = o;
    svg.classList.toggle('assigning', D.assign >= 0);
    svg.classList.toggle('drawing', D.tab === 'sketch' && D.tool !== 'select');
    svg.classList.toggle('pointing', !!D.pointUp);
  }
  function ink(hex) {
    const v = parseInt(String(hex).slice(1), 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1d1d1f' : '#ffffff';
  }
  function shapeSvg(s) {
    const on = s.id === D.sel ? ' sel' : '', cls = s.t === 'line' ? 'fv-edge' : s.fill === false ? 'fv-outline' : 'fv-body';
    const a = `class="cfg-shape ${cls}${on}" data-shape="${s.id}" vector-effect="non-scaling-stroke"`;
    if (s.t === 'line') return `<line class="cfg-hitline" data-shape="${s.id}" x1="${s.x}" y1="${s.y}" x2="${s.x2}" y2="${s.y2}"/><line ${a} x1="${s.x}" y1="${s.y}" x2="${s.x2}" y2="${s.y2}"/>`;
    if (s.t === 'ellipse') return `<ellipse ${a} cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${s.w / 2}" ry="${s.h / 2}"/>`;
    return `<rect ${a} x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${Math.min(s.r || 0, s.w / 2, s.h / 2)}"/>`;
  }
  // Resize handles: eight round a box, one at each end of a line.
  function handlePts(s) {
    if (s.t === 'line') return [['p1', s.x, s.y], ['p2', s.x2, s.y2]];
    const { x, y, w, h } = s;
    return [['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y], ['e', x + w, y + h / 2], ['se', x + w, y + h], ['s', x + w / 2, y + h], ['sw', x, y + h], ['w', x, y + h / 2]];
  }
  function handles(s, z) {
    const k = 4.5 / z;
    let o = s.t === 'line' ? '' : `<rect class="cfg-selbox" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" vector-effect="non-scaling-stroke"/>`;
    handlePts(s).forEach(([hd, x, y]) => { o += `<rect class="cfg-handle" data-handle="${hd}" x="${x - k}" y="${y - k}" width="${k * 2}" height="${k * 2}" vector-effect="non-scaling-stroke" style="cursor:${hd === 'p1' || hd === 'p2' ? 'move' : hd + '-resize'}"/>`; });
    return o;
  }

  // ── 2D pointer ──
  let drag = null;
  function pt(e) {
    const svg = $('#cfg-svg'), m = svg.getScreenCTM().inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  }
  const snapV = (v, e) => (e && e.altKey ? r2(v) : r2(Math.round(v / D.grid) * D.grid));
  const snapP = (p, e) => ({ x: snapV(p.x, e), y: snapV(p.y, e) });
  // Where a mark can sit: the center of the smallest closed loop of the model's face (a contact
  // cavity) or sketched circle or box under the pointer, else the grid. Alt places freely.
  let loopCache = null;
  function features() {
    const p = part();
    if (D.tab === 'model') {
      if (!p) return [];
      if (loopCache && loopCache.d === p.d && loopCache.c === p.c && loopCache.f === p.f) return loopCache.list;
      const list = [], big = Math.max(p.w, p.h) * 0.3;
      (p.c || []).concat(p.f || []).forEach(c => { if (c[2] * 2 <= big) list.push({ x: c[0] * p.k, y: c[1] * p.k, rx: c[2] * p.k, ry: c[2] * p.k, round: true }); });
      p.d.split('M').filter(Boolean).forEach(s => {
        const pts = s.split('L').map(q => q.trim().split(' ').map(Number));
        if (pts.length < 4) return;
        const a = pts[0], b = pts[pts.length - 1];
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > Math.max(w, h) * 0.05 || Math.max(w, h) > big) return;
        list.push({ x: (Math.max(...xs) + Math.min(...xs)) / 2 * p.k, y: (Math.max(...ys) + Math.min(...ys)) / 2 * p.k, rx: w / 2 * p.k, ry: h / 2 * p.k });
      });
      loopCache = { d: p.d, c: p.c, f: p.f, list };
      return list;
    }
    return p.shapes.filter(s => s.t !== 'line').map(s => ({ x: s.x + s.w / 2, y: s.y + s.h / 2, rx: s.w / 2, ry: s.h / 2 }));
  }
  function snapMark(p, e) {
    if (e && e.altKey) return { x: r2(p.x), y: r2(p.y) };
    let best = null;
    // Round ones (fitted circles) first; other closed loops only where no circle is under the pointer.
    const inside = c => Math.hypot((p.x - c.x) / (c.rx * 1.15), (p.y - c.y) / (c.ry * 1.15)) <= 1;
    const fs = features(), round = fs.filter(c => c.round && inside(c));
    (round.length ? round : fs.filter(c => !c.round && inside(c))).forEach(c => { if (!best || c.rx * c.ry < best.rx * best.ry) best = c; });
    // Sketched boxes much bigger than a mark are housings, not cavities.
    if (best && D.tab === 'sketch' && Math.max(best.rx, best.ry) * 2 > Sh.markSize(D.custom, part().pins) * 4) best = null;
    return best ? { x: r2(best.x), y: r2(best.y) } : snapP(p, e);
  }
  function down2d(e) {
    const svg = $('#cfg-svg');
    if (!svg || !svg.contains(e.target)) return;
    const p = pt(e), t = e.target;
    $('#cfg-stage').focus({ preventScroll: true });
    if (e.button === 1 || e.button === 2 && !t.closest('[data-mark]') || (e.button === 0 && e.shiftKey && t.dataset.bg)) { startPan(e); return; }
    if (e.button === 2) return;
    const mk = t.closest('[data-mark]');
    if (mk && D.assign < 0) { const i = +mk.dataset.mark, q = part().pins[i]; pushUndo(); drag = { kind: 'mark', i, dx: p.x - q[0], dy: p.y - q[1], moved: false }; capture(e); return; }
    if (D.pointUp) { pointUp(p); return; }
    if (D.assign >= 0) { placeMark(snapMark(p, e)); return; }
    if (D.tab === 'sketch') {
      const sk = D.custom.sketch, hd = t.closest('[data-handle]');
      if (hd && selShape()) { pushUndo(); drag = { kind: 'resize', hd: hd.dataset.handle, orig: clone(selShape()) }; capture(e); return; }
      if (D.tool !== 'select') {
        pushUndo();
        const q = snapP(p, e), s = { id: U.uid('k'), t: D.tool, x: q.x, y: q.y, w: 0, h: 0 };
        if (D.tool === 'line') Object.assign(s, { x2: q.x, y2: q.y });
        if (D.tool === 'round') s.r = 0;
        sk.shapes.push(s);
        D.sel = s.id;
        drag = { kind: 'draw', s, p0: q, moved: false };
        capture(e);
        return;
      }
      const sh = t.closest('[data-shape]');
      if (sh) {
        D.sel = sh.dataset.shape;
        pushUndo();
        drag = { kind: 'move', orig: clone(selShape()), p0: p, moved: false };
        capture(e);
        refresh();
        return;
      }
      if (D.sel) { D.sel = null; refresh(); }
    }
    startPan(e);
  }
  function startPan(e) { const cam = D.cam[D.tab]; drag = { kind: 'pan', x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy }; capture(e); $('#cfg-svg').classList.add('panning'); }
  function capture(e) { try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ } e.preventDefault(); }
  function move2d(e) {
    const svg = $('#cfg-svg');
    if (!svg) return;
    if (!drag) { ghost(e); return; }
    const p = pt(e);
    if (drag.kind === 'pan') { const cam = D.cam[D.tab]; cam.cx = drag.cx - (e.clientX - drag.x) / cam.z; cam.cy = drag.cy - (e.clientY - drag.y) / cam.z; draw2d(); return; }
    drag.moved = true;
    if (drag.kind === 'mark') { const q = snapMark({ x: p.x - drag.dx, y: p.y - drag.dy }, e); part().pins[drag.i] = [q.x, q.y]; draw2d(); return; }
    const s = selShape();
    if (!s) return;
    if (drag.kind === 'draw') {
      const q = snapP(p, e);
      if (s.t === 'line') { s.x2 = q.x; s.y2 = q.y; if (e.shiftKey) { if (Math.abs(q.x - s.x) > Math.abs(q.y - s.y)) s.y2 = s.y; else s.x2 = s.x; } }
      else {
        let w = q.x - drag.p0.x, h = q.y - drag.p0.y;
        if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        s.x = Math.min(drag.p0.x, drag.p0.x + w); s.y = Math.min(drag.p0.y, drag.p0.y + h); s.w = Math.abs(w); s.h = Math.abs(h);
        if (s.t === 'round') s.r = r2(Math.min(s.w, s.h) * 0.2);
      }
    } else if (drag.kind === 'move') {
      const o = drag.orig, dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
      const nx = snapV(o.x + dx, e), ny = snapV(o.y + dy, e);
      s.x = nx; s.y = ny;
      if (s.t === 'line') { s.x2 = r2(o.x2 + nx - o.x); s.y2 = r2(o.y2 + ny - o.y); }
    } else if (drag.kind === 'resize') resize(s, drag.orig, drag.hd, snapP(p, e), e.shiftKey);
    draw2d();
    const tl = $('#cfg-tools'); // the selected shape's X, Y, W, H follow the drag
    if (tl && !tl.contains(document.activeElement)) { const th = toolsHtml(); if (tl.dataset.html !== th) { tl.innerHTML = th; tl.dataset.html = th; } }
  }
  function resize(s, o, hd, q, keep) {
    if (hd === 'p1') { s.x = q.x; s.y = q.y; return; }
    if (hd === 'p2') { s.x2 = q.x; s.y2 = q.y; return; }
    let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
    if (hd.includes('w')) x0 = q.x;
    if (hd.includes('e')) x1 = q.x;
    if (hd.includes('n')) y0 = q.y;
    if (hd.includes('s')) y1 = q.y;
    if (keep && hd.length === 2 && o.w && o.h) {
      const k = Math.max(Math.abs(x1 - x0) / o.w, Math.abs(y1 - y0) / o.h);
      if (hd.includes('w')) x0 = x1 - o.w * k; else x1 = x0 + o.w * k;
      if (hd.includes('n')) y0 = y1 - o.h * k; else y1 = y0 + o.h * k;
    }
    s.x = r2(Math.min(x0, x1)); s.y = r2(Math.min(y0, y1)); s.w = r2(Math.max(0.1, Math.abs(x1 - x0))); s.h = r2(Math.max(0.1, Math.abs(y1 - y0)));
  }
  function up2d() {
    if (!drag) return;
    const d = drag;
    drag = null;
    const svg = $('#cfg-svg');
    if (svg) svg.classList.remove('panning');
    if (d.kind === 'draw') {
      const s = d.s;
      // A click without dragging places a shape of a typical size there.
      const tiny = s.t === 'line' ? Math.hypot(s.x2 - s.x, s.y2 - s.y) < D.grid : s.w < D.grid && s.h < D.grid;
      if (tiny) {
        const dw = { rect: [8, 5], round: [8, 5], ellipse: [5, 5], line: [8, 0] }[s.t];
        if (s.t === 'line') { s.x2 = r2(s.x + dw[0]); s.y2 = s.y; } else { s.x = r2(s.x - dw[0] / 2); s.y = r2(s.y - dw[1] / 2); s.w = dw[0]; s.h = dw[1]; if (s.t === 'round') s.r = 1; }
      }
      D.tool = 'select';
    }
    if ((d.kind === 'move' || d.kind === 'mark') && !d.moved) undoStack.pop();
    refresh();
  }
  function wheel2d(e) {
    const cam = D.cam[D.tab];
    if (!cam || !$('#cfg-svg')) return;
    e.preventDefault();
    const p = pt(e), k = Math.exp(-e.deltaY * 0.0015), z = Math.max(0.5, Math.min(2000, cam.z * k));
    cam.cx = p.x - (p.x - cam.cx) * cam.z / z;
    cam.cy = p.y - (p.y - cam.cy) * cam.z / z;
    cam.z = z;
    draw2d();
  }
  // The next mark under the pointer while assigning.
  function ghost(e) {
    const g = $('#cfg-ghost');
    if (!g) return;
    if (D.pointUp && e) {
      const p = pt(e), c = rotCenter(), cx = c[0] * part().k, cy = c[1] * part().k;
      g.innerHTML = `<line class="cfg-upline" x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" vector-effect="non-scaling-stroke"/><circle class="cfg-upc" cx="${cx}" cy="${cy}" r="${4 / D.cam.model.z}"/>`;
      return;
    }
    if (D.assign < 0 || !e) { g.innerHTML = ''; return; }
    const q = snapMark(pt(e), e), r = Sh.markSize(D.custom, part() ? part().pins : []) / 2, nm = names()[D.assign];
    g.innerHTML = `<circle class="cfg-ghost" cx="${q.x}" cy="${q.y}" r="${r}" vector-effect="non-scaling-stroke"/><text class="cfg-ghost-t" x="${q.x}" y="${q.y}" dy="0.36em" text-anchor="middle" font-size="${r2(r * (nm.length > 2 ? 0.75 : 1))}">${esc(nm)}</text>`;
  }
  function placeMark(q) {
    const p = part();
    pushUndo();
    p.pins[D.assign] = [q.x, q.y];
    const nxt = p.pins.findIndex(v => !v);
    D.assign = nxt;
    refresh();
  }
  function startAssign(i) {
    const p = part();
    if (!p) return;
    if (i != null) { D.assign = D.assign === i ? -1 : i; refresh(); return; }
    if (D.assign >= 0) { D.assign = -1; refresh(); return; }
    D.pointUp = false;
    let nxt = p.pins.findIndex(v => !v);
    if (nxt < 0) {
      if (!confirm(`Place all ${count()} marks again? The ones there now are cleared.`)) return;
      pushUndo();
      p.pins = p.pins.map(() => null);
      nxt = 0;
    }
    D.assign = nxt;
    if (D.tab === 'sketch') D.tool = 'select';
    refresh();
  }

  // ── Turning the face view ──
  // Turning about the axis we look down is exact on the drawing itself, so it works without the
  // model in memory: points, circles and marks turn about the center (the connector's axis when a
  // big circle shows it), the frame is fitted again, and the stored view turns to match.
  function rotCenter() {
    const p = part(), big = (p.c || []).concat(p.f || []).filter(c => c[2] * 2 >= Math.max(p.w, p.h) * 0.3).sort((a, b) => b[2] - a[2])[0];
    return big ? [big[0], big[1]] : [p.w / 2, p.h / 2];
  }
  function rotate(deg, silent) {
    const p = part();
    if (!p || D.tab !== 'model' || !deg) return;
    if (!silent) pushUndo();
    const th = deg * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th), [cx, cy] = rotCenter();
    const turn = (x, y) => [cx + (x - cx) * cs - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * cs];
    const pts = [];
    p.d.replace(/[ML](-?[\d.]+) (-?[\d.]+)/g, (m, x, y) => { pts.push(turn(+x, +y)); return m; });
    const circ = (p.c || []).map(c => { const [x, y] = turn(c[0], c[1]); return [x, y, c[2]]; });
    const feat = (p.f || []).map(c => { const [x, y] = turn(c[0], c[1]); return [x, y, c[2]]; });
    const pins = p.pins.map(q => (q ? turn(q[0] / p.k, q[1] / p.k) : null));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x, y, r) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
    pts.forEach(q => grow(q[0], q[1], 0));
    circ.forEach(c => grow(c[0], c[1], c[2]));
    const r1 = v => Math.round(v * 10) / 10;
    let i = 0;
    p.d = p.d.replace(/([ML])(-?[\d.]+) (-?[\d.]+)/g, (m, c) => { const q = pts[i++]; return c + r1(q[0] - x0) + ' ' + r1(q[1] - y0); });
    p.c = circ.map(c => [r1(c[0] - x0), r1(c[1] - y0), c[2]]);
    p.f = feat.map(c => [r1(c[0] - x0), r1(c[1] - y0), c[2]]);
    p.pins = pins.map(q => (q ? [r2((q[0] - x0) * p.k), r2((q[1] - y0) * p.k)] : null));
    p.w = r1(x1 - x0); p.h = r1(y1 - y0);
    // The drawing stays put on screen.
    const cam = D.cam.model;
    if (cam) { cam.cx -= x0 * p.k; cam.cy -= y0 * p.k; }
    if (p.view) {
      const r = p.view.right, u = p.view.up, cl = v => Math.round(v * 1e6) / 1e6;
      p.view = { look: p.view.look, right: r.map((v, j) => cl(cs * v + sn * u[j])), up: u.map((v, j) => cl(cs * v - sn * r[j])) };
    }
    p.rot = r2((((p.rot || 0) + deg) % 360 + 540) % 360 - 180);
    loopCache = null;
    refresh();
    const ri = $('#cfg-tools [data-cf="rot"]');
    if (ri && document.activeElement !== ri) ri.value = p.rot;
  }
  // Turn so the clicked point is straight above the center.
  function pointUp(q) {
    const p = part(), [cx, cy] = rotCenter();
    const a = Math.atan2(q.y / p.k - cy, q.x / p.k - cx) * 180 / Math.PI;
    D.pointUp = false;
    rotate(r2(-90 - a));
  }

  // ── 3D ──
  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = THREE_JS.src; s.integrity = THREE_JS.sri; s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.THREE);
      s.onerror = () => reject(new Error("Couldn't load the 3D viewer (offline, or blocked?)."));
      document.head.appendChild(s);
    });
  }
  async function importFile(file) {
    if (!file) return;
    if (!LM.step.kindOf(file.name)) { D.err = 'Loom reads STEP (.step, .stp), IGES (.iges, .igs) and STL files.'; refresh(); return; }
    D.err = '';
    D.busy = LM.step.kindOf(file.name) === 'stl' ? 'Reading the model…' : 'Reading the model (the STEP reader loads the first time)…';
    D.tab = 'model';
    render();
    try {
      const [m] = await Promise.all([LM.step.load(file), loadThree()]);
      if (!D) return;
      mesh = m;
      meshes.set(D.id, { mesh: m, name: file.name });
      D.fileName = file.name;
      D.busy = '';
      D.mode3d = true;
      V3q(null);
      render();
    } catch (err) {
      if (!D) return;
      D.busy = '';
      D.err = String(err.message || err);
      render();
    }
  }
  // The 3D view: three.js, orthographic, turned as a trackball (drag), with the camera's turn as one
  // quaternion (V3.q) so any face can be looked at straight on.
  function V3q(q) {
    const T = window.THREE;
    if (!T) return;
    if (!V3) V3 = { q: new T.Quaternion(), zoom: 1 };
    if (q) V3.q.copy(q);
    else {
      // The model's saved view, else an isometric look.
      const v = D.custom.model && D.custom.model.view;
      V3.q.copy(v ? quatOf(v.look, v.up) : quatOf([-1, 1, -1], [0, 0, 1]));
      V3.zoom = 1;
      V3.faced = !!v;
      V3.roll = 0;
      V3.faceLook = v ? v.look : null;
    }
  }
  function quatOf(look, up) {
    const T = window.THREE;
    const back = new T.Vector3(...look).negate().normalize();
    let u = new T.Vector3(...up);
    u.sub(back.clone().multiplyScalar(u.dot(back)));
    if (u.lengthSq() < 1e-6) u = Math.abs(back.z) < 0.9 ? new T.Vector3(0, 0, 1) : new T.Vector3(0, 1, 0), u.sub(back.clone().multiplyScalar(u.dot(back)));
    u.normalize();
    const right = new T.Vector3().crossVectors(u, back).normalize();
    return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right, u, back));
  }
  function mount3d(el) {
    const T = window.THREE;
    if (!T || !mesh) return;
    if (!V3 || !V3.renderer) {
      const keep = V3;
      V3 = Object.assign(keep || { q: new T.Quaternion(), zoom: 1 }, {
        renderer: new T.WebGLRenderer({ antialias: true, alpha: true }),
        scene: new T.Scene(),
        cam: new T.OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6),
        ray: new T.Raycaster(),
      });
      V3.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      V3.scene.add(new T.HemisphereLight(0xffffff, 0x404650, 0.55));
      const key = new T.DirectionalLight(0xffffff, 0.55);
      key.position.set(0.4, 0.8, 1);
      V3.cam.add(key);
      V3.scene.add(V3.cam);
      const cv = V3.renderer.domElement;
      cv.addEventListener('pointerdown', down3d);
      cv.addEventListener('pointermove', move3d);
      cv.addEventListener('pointerup', up3d);
      cv.addEventListener('wheel', e => { e.preventDefault(); V3.zoom = Math.max(0.2, Math.min(60, V3.zoom * Math.exp(-e.deltaY * 0.0015))); draw3d(); }, { passive: false });
    }
    if (V3.mesh !== mesh) build3d();
    V3.el = el;
    el.appendChild(V3.renderer.domElement);
    size3d();
  }
  function build3d() {
    const T = window.THREE;
    if (V3.group) { V3.scene.remove(V3.group); V3.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const nt = mesh.idx.length / 3, pos = new Float32Array(nt * 9), nrm = new Float32Array(nt * 9);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const v = mesh.idx[t * 3 + k], o = t * 9 + k * 3;
      pos[o] = mesh.pos[v * 3]; pos[o + 1] = mesh.pos[v * 3 + 1]; pos[o + 2] = mesh.pos[v * 3 + 2];
      nrm[o] = mesh.nrm[t * 3]; nrm[o + 1] = mesh.nrm[t * 3 + 1]; nrm[o + 2] = mesh.nrm[t * 3 + 2];
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(nrm, 3));
    const body = new T.Mesh(g, new T.MeshStandardMaterial({ color: 0xaeb3bb, metalness: 0.05, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: T.DoubleSide }));
    const ep = [];
    for (let e = 0; e < mesh.edges; e++) if (mesh.model[e]) { const a = mesh.ea[e] * 3, b = mesh.eb[e] * 3; ep.push(mesh.wpos[a], mesh.wpos[a + 1], mesh.wpos[a + 2], mesh.wpos[b], mesh.wpos[b + 1], mesh.wpos[b + 2]); }
    const eg = new T.BufferGeometry();
    eg.setAttribute('position', new T.BufferAttribute(new Float32Array(ep), 3));
    const lines = new T.LineSegments(eg, new T.LineBasicMaterial({ color: 0x1d1f23 }));
    // The face under the pointer, lit in the accent color.
    const hg = new T.BufferGeometry();
    hg.setAttribute('position', new T.BufferAttribute(new Float32Array(0), 3));
    const hi = new T.Mesh(hg, new T.MeshBasicMaterial({ color: 0x2bb3c0, transparent: true, opacity: 0.45, depthTest: false, side: T.DoubleSide }));
    V3.group = new T.Group();
    V3.group.add(body, lines, hi);
    V3.body = body; V3.hi = hi; V3.hiFace = null;
    V3.scene.add(V3.group);
    V3.mesh = mesh;
    V3.center = new T.Vector3((mesh.lo[0] + mesh.hi[0]) / 2, (mesh.lo[1] + mesh.hi[1]) / 2, (mesh.lo[2] + mesh.hi[2]) / 2);
  }
  function size3d() {
    if (!V3 || !V3.el) return;
    const w = V3.el.clientWidth || 600, h = V3.el.clientHeight || 400;
    V3.renderer.setSize(w, h, false);
    V3.renderer.domElement.style.width = '100%';
    V3.renderer.domElement.style.height = '100%';
    V3.aspect = w / h;
    draw3d();
  }
  function draw3d() {
    if (!V3 || !V3.el || !V3.renderer) return;
    const T = window.THREE, cam = V3.cam, half = mesh.diag * 0.62 / V3.zoom;
    cam.left = -half * V3.aspect; cam.right = half * V3.aspect; cam.top = half; cam.bottom = -half;
    cam.quaternion.copy(V3.q);
    cam.position.copy(V3.center).add(new T.Vector3(0, 0, 1).applyQuaternion(V3.q).multiplyScalar(mesh.diag * 3));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    V3.renderer.render(V3.scene, cam);
    ring3d();
  }
  // The ring round the model while we look straight at a face: its dot turns the model about the
  // axis into the screen (the view's center, which the camera looks at).
  function ring3d() {
    const svg = $('#cfg-ring3');
    if (!svg) return;
    if (!V3.faced) { svg.innerHTML = ''; return; }
    const W = V3.el.clientWidth || 600, H = V3.el.clientHeight || 400;
    if (V3.ringFor !== V3.faceLook) { V3.ringR = faceRadius(V3.faceLook); V3.ringFor = V3.faceLook; }
    const half = mesh.diag * 0.62 / V3.zoom;
    const r = Math.max(40, Math.min(Math.min(W, H) / 2 - 18, (V3.ringR || mesh.diag / 2) / half * H / 2 * 1.12));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = ringSvg(W / 2, H / 2, r, V3.roll || 0, 7, ring && ring.kind === '3d');
  }
  // How far the model reaches from the view's center, across the screen, looking along look: the
  // ring sits just outside it.
  function faceRadius(look) {
    if (!look || !mesh) return 0;
    const [lx, ly, lz] = look, c = V3.center, w = mesh.wpos;
    let m = 0;
    for (let i = 0; i < w.length; i += 3) {
      const x = w[i] - c.x, y = w[i + 1] - c.y, z = w[i + 2] - c.z, t = x * lx + y * ly + z * lz;
      m = Math.max(m, (x - t * lx) ** 2 + (y - t * ly) ** 2 + (z - t * lz) ** 2);
    }
    return Math.sqrt(m);
  }
  function ringSvg(cx, cy, r, deg, dotR, live) {
    const a = (deg - 90) * Math.PI / 180, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    const lab = live ? `<text class="cfg-ring-t" x="${x}" y="${y - dotR * 1.9}" text-anchor="middle" font-size="${dotR * 1.7}">${r2(((deg % 360) + 540) % 360 - 180)}°</text>` : '';
    return `<circle class="cfg-ring-c" cx="${cx}" cy="${cy}" r="${r}" vector-effect="non-scaling-stroke"/>` +
      `<line class="cfg-ring-tick" x1="${cx}" y1="${cy - r - dotR * 0.6}" x2="${cx}" y2="${cy - r + dotR * 0.6}" vector-effect="non-scaling-stroke"/>` +
      `<circle class="cfg-ring-dot${live ? ' live' : ''}" data-ring="1" cx="${x}" cy="${y}" r="${dotR}" vector-effect="non-scaling-stroke"><title>Drag to turn about the axis into the screen (Shift: 15° steps, Alt: free)</title></circle>${lab}`;
  }
  // Dragging the ring's dot: the turn is the pointer's angle about the center since the grab,
  // in 1° steps (Shift 15°, Alt free). One undo reverts a turn of the face view.
  let ring = null;
  function ringStart(e) {
    e.preventDefault();
    e.stopPropagation();
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    let c;
    if (D.tab === 'model' && D.mode3d && V3 && V3.el) {
      const r = V3.el.getBoundingClientRect();
      c = [r.left + r.width / 2, r.top + r.height / 2];
      if (V3.goal) { V3.q.copy(V3.goal); V3.goal = null; }
      ring = { kind: '3d', q0: V3.q.clone(), roll0: V3.roll || 0 };
    } else {
      const p = part(), m = $('#cfg-svg').getScreenCTM(), [ux, uy] = rotCenter();
      c = [m.a * ux * p.k + m.e, m.d * uy * p.k + m.f];
      pushUndo();
      ring = { kind: '2d', snap: clone(p), cam: Object.assign({}, D.cam.model) };
    }
    ring.cx = c[0]; ring.cy = c[1];
    ring.last = Math.atan2(e.clientY - c[1], e.clientX - c[0]);
    ring.sum = 0;
    ring.deg = 0;
  }
  function ringMove(e) {
    const a = Math.atan2(e.clientY - ring.cy, e.clientX - ring.cx);
    let da = a - ring.last;
    da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
    ring.last = a;
    ring.sum += da;
    const raw = ring.sum * 180 / Math.PI, step = e.altKey ? 0.1 : e.shiftKey ? 15 : 1;
    const deg = Math.round(raw / step) * step;
    if (deg === ring.deg) return;
    ring.deg = deg;
    if (ring.kind === '3d') {
      const T = window.THREE;
      V3.q.copy(ring.q0.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), deg * Math.PI / 180)));
      V3.roll = ring.roll0 + deg;
      draw3d();
    } else {
      D.custom.model = clone(ring.snap);
      D.cam.model = Object.assign({}, ring.cam);
      if (deg) rotate(deg, true); else { loopCache = null; refresh(); }
    }
  }
  function ringEnd() {
    const r = ring;
    ring = null;
    if (!r) return;
    if (r.kind === '2d' && !r.deg) undoStack.pop();
    if (r.kind === '3d') draw3d(); else draw2d();
  }
  let d3 = null;
  function down3d(e) { if (V3.goal) { V3.q.copy(V3.goal); V3.goal = null; } d3 = { x: e.clientX, y: e.clientY, q: V3.q.clone(), roll: V3.roll, moved: false }; try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ } }
  function move3d(e) {
    if (!d3) { hover3d(e); return; }
    const dx = e.clientX - d3.x, dy = e.clientY - d3.y;
    if (!d3.moved && Math.hypot(dx, dy) < 4) return;
    d3.moved = true;
    const T = window.THREE;
    if (e.shiftKey) {
      // Shift: roll about the axis we look down, by the pointer's turn about the view's center.
      const r = V3.renderer.domElement.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const a = Math.atan2(e.clientY - cy, e.clientX - cx) - Math.atan2(d3.y - cy, d3.x - cx);
      V3.q.copy(d3.q.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), a)));
      V3.roll = (d3.roll || 0) + a * 180 / Math.PI;
      draw3d();
      return;
    }
    V3.faced = false; // turned freely: no longer looking straight at a face
    const q = d3.q.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -dx * 0.01)).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -dy * 0.01));
    V3.q.copy(q);
    draw3d();
  }
  function up3d(e) {
    const d = d3;
    d3 = null;
    if (d && !d.moved) snapToFace(e);
  }
  function hit3d(e) {
    const T = window.THREE, r = V3.renderer.domElement.getBoundingClientRect();
    V3.ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), V3.cam);
    const hits = V3.ray.intersectObject(V3.body, false);
    return hits.length ? hits[0].faceIndex : -1;
  }
  // The triangles of the b-rep face a triangle belongs to (just itself in an STL).
  function faceTris(t) {
    const f = mesh.face[t];
    if (f < 0) return [t];
    const out = [];
    for (let i = 0; i < mesh.face.length; i++) if (mesh.face[i] === f) out.push(i);
    return out;
  }
  function hover3d(e) {
    const t = hit3d(e), f = t < 0 ? null : mesh.face[t] >= 0 ? 'f' + mesh.face[t] : 't' + t;
    if (f === V3.hiFace) return;
    V3.hiFace = f;
    const tris = t < 0 ? [] : faceTris(t), a = new Float32Array(tris.length * 9);
    tris.forEach((tt, j) => { for (let k = 0; k < 3; k++) { const v = mesh.idx[tt * 3 + k]; a[j * 9 + k * 3] = mesh.pos[v * 3]; a[j * 9 + k * 3 + 1] = mesh.pos[v * 3 + 1]; a[j * 9 + k * 3 + 2] = mesh.pos[v * 3 + 2]; } });
    V3.hi.geometry.setAttribute('position', new window.THREE.BufferAttribute(a, 3));
    V3.hi.geometry.computeBoundingSphere();
    V3.renderer.domElement.style.cursor = t < 0 ? 'grab' : 'pointer';
    draw3d();
  }
  // Look straight at the clicked face: along its normal (area-weighted over a planar b-rep face),
  // with up the world axis nearest the current up, laid into the face's plane.
  function snapToFace(e) {
    const T = window.THREE, t = hit3d(e);
    if (t < 0) return;
    const tris = faceTris(t), nsum = new T.Vector3();
    let area = 0;
    tris.forEach(tt => {
      const a = mesh.idx[tt * 3] * 3, b = mesh.idx[tt * 3 + 1] * 3, c = mesh.idx[tt * 3 + 2] * 3, P = mesh.pos;
      const u = new T.Vector3(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]), v = new T.Vector3(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]);
      const ar = u.cross(v).length() / 2;
      area += ar;
      nsum.add(new T.Vector3(mesh.nrm[tt * 3], mesh.nrm[tt * 3 + 1], mesh.nrm[tt * 3 + 2]).multiplyScalar(ar));
    });
    let n = nsum.length() > area * 0.5 ? nsum.normalize() : new T.Vector3(mesh.nrm[t * 3], mesh.nrm[t * 3 + 1], mesh.nrm[t * 3 + 2]);
    // Face the camera: a normal pointing away means the inside of a shell was hit.
    const toCam = new T.Vector3(0, 0, 1).applyQuaternion(V3.q);
    if (n.dot(toCam) < 0) n = n.negate();
    n = new T.Vector3(...snapLook(n.toArray()));
    const curUp = new T.Vector3(0, 1, 0).applyQuaternion(V3.q);
    let best = null, bd = -2;
    [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].forEach(a => {
      const v = new T.Vector3(...a);
      v.sub(n.clone().multiplyScalar(v.dot(n)));
      if (v.length() < 0.3) return;
      v.normalize();
      const d = v.dot(curUp);
      if (d > bd) { bd = d; best = v; }
    });
    V3.faced = true;
    V3.roll = 0;
    V3.faceLook = n.clone().negate().toArray();
    fitFace();
    glide(quatOf(V3.faceLook, (best || curUp).toArray()));
  }
  // Turn the camera to q1. V3.goal holds where it's going, so a face view made mid-glide (or with
  // the tab in the background, where frames don't run) uses the view asked for.
  function glide(q1) {
    const q0 = V3.q.clone(), t0 = performance.now(), ms = matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden ? 0 : 320;
    const goal = V3.goal = q1.clone();
    if (!ms) { V3.q.copy(goal); V3.goal = null; draw3d(); return; }
    const step = now => {
      if (!V3 || !V3.el || V3.goal !== goal) return;
      const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      V3.q.copy(q0).slerp(goal, e);
      draw3d();
      if (k < 1) requestAnimationFrame(step); else V3.goal = null;
    };
    requestAnimationFrame(step);
  }
  function view3d(key) { const v = LM.step.VIEWS[key]; if (v) { V3.faced = true; V3.roll = 0; V3.faceLook = v.look; fitFace(); glide(quatOf(v.look, v.up)); } }
  // A direction within SNAP_DEG of one of the model's axes (a planar face's normal, or a world
  // axis) becomes exactly that axis. A view a hair off axis doubles every rim in the face view,
  // since a hole's front and back rims no longer coincide, and a trackball turn or a curved face's
  // mean normal is never exact.
  const SNAP_DEG = 3;
  function snapLook(look) {
    if (!mesh) return look;
    let best = null, bd = Math.cos(SNAP_DEG * Math.PI / 180);
    LM.step.axes(mesh).forEach(a => {
      const d = look[0] * a[0] + look[1] * a[1] + look[2] * a[2];
      if (Math.abs(d) > bd) { bd = Math.abs(d); best = d < 0 ? a.map(v => -v) : a; }
    });
    return best || look;
  }
  // Looking straight at a face, zoom so it (and its ring) fill most of the view.
  function fitFace() {
    if (!mesh || !V3.center) return;
    V3.ringR = faceRadius(V3.faceLook);
    V3.ringFor = V3.faceLook;
    V3.zoom = V3.ringR ? Math.max(1, Math.min(40, mesh.diag * 0.62 / (V3.ringR * 1.45))) : 1;
  }
  // dir 1 turns the model clockwise on screen. The camera turns the other way about its own axis,
  // which is +θ in three.js (its z points at the viewer, so +θ turns the picture clockwise).
  function spin(dir) { const T = window.THREE; V3.roll = (V3.roll || 0) + dir * 90; glide((V3.goal || V3.q).clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), dir * Math.PI / 2))); }
  function makeFace() {
    if (V3.goal) { V3.q.copy(V3.goal); V3.goal = null; }
    const T = window.THREE, clean = v => v.toArray().map(x => (Math.abs(x) < 1e-6 ? 0 : Math.round(x * 1e6) / 1e6));
    // Nearly along one of the model's axes: exactly along it, and the 3D view follows.
    const look0 = new T.Vector3(0, 0, -1).applyQuaternion(V3.q), snapped = snapLook(look0.toArray());
    if (new T.Vector3(...snapped).distanceTo(look0) > 1e-9) {
      V3.q.copy(quatOf(snapped, new T.Vector3(0, 1, 0).applyQuaternion(V3.q).toArray()));
      V3.faced = true; V3.roll = 0; V3.faceLook = snapped;
    }
    const look = clean(new T.Vector3(0, 0, -1).applyQuaternion(V3.q)), right = clean(new T.Vector3(1, 0, 0).applyQuaternion(V3.q)), up = clean(new T.Vector3(0, 1, 0).applyQuaternion(V3.q));
    const sk = LM.step.sketch(mesh, { look, right, up });
    if (!sk.d) { D.err = 'No edges show from this side. Turn the model and try again.'; refresh(); return; }
    const old = D.custom.model;
    const same = old && old.view && JSON.stringify(old.view) === JSON.stringify({ look, right, up }) && old.name === D.fileName;
    pushUndo();
    D.custom.model = { name: D.fileName, d: sk.d, c: sk.c, f: sk.f, w: sk.w, h: sk.h, k: sk.mm / 1000, view: { look, right, up }, rot: 0, pins: same ? old.pins : [] };
    syncPins();
    D.mode3d = false;
    D.err = '';
    D.cam.model = null;
    D.assign = placed(D.custom.model) < count() ? D.custom.model.pins.findIndex(v => !v) : -1;
    render();
  }

  // ── Events ──
  function onClick(e) {
    const b = e.target.closest('[data-cfg]');
    if (!b || b.disabled || !D) return;
    const v = b.dataset.v;
    switch (b.dataset.cfg) {
      case 'close': close(); break;
      case 'apply': apply(); break;
      case 'type':
        if (D.family === v) return;
        D.family = v;
        if (v !== 'custom') {
          const tmp = { family: v, pins: D.pins, rows: D.rows };
          L.conform(tmp);
          D.pins = tmp.pins; D.rows = tmp.rows;
        }
        D.assign = -1;
        render();
        break;
      case 'seg': D[b.dataset.k] = b.dataset.k === 'rows' ? +v : v; b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); refresh(); break;
      case 'tab': if (D.tab !== v) { D.tab = v; D.sel = null; D.assign = -1; D.err = ''; render(); } break;
      case 'tool': D.tool = v; D.assign = -1; refresh(); break;
      case 'del-shape': delShape(); break;
      case 'fit': fitView(); draw2d(); break;
      case 'assign': startAssign(); break;
      case 'pin': startAssign(+b.dataset.i); break;
      case 'clear-marks': if (confirm('Clear every mark?')) { pushUndo(); part().pins = part().pins.map(() => null); D.assign = -1; refresh(); } break;
      case 'import': $('#cfg-file').click(); break;
      case 'view3d': view3d(v); break;
      case 'spin': spin(+v); break;
      case 'make-face': makeFace(); break;
      case 'change-view': D.mode3d = true; D.assign = -1; V3q(null); render(); if (V3.faced) { fitFace(); draw3d(); } break;
      case 'face-back': D.mode3d = false; render(); break;
      case 'rot': rotate(+v); break;
      case 'point-up': D.pointUp = !D.pointUp; D.assign = -1; refresh(); break;
    }
  }
  function delShape() {
    const s = selShape();
    if (!s) return;
    pushUndo();
    D.custom.sketch.shapes = D.custom.sketch.shapes.filter(x => x !== s);
    D.sel = null;
    refresh();
  }
  // The position count, as it's typed (a whole number in range) and again when committed.
  function setPositions(el, commit) {
    const raw = +el.value;
    if (!commit && !(Number.isInteger(raw) && raw >= 1 && raw <= MAX_POS)) return;
    const v = Math.max(1, Math.min(MAX_POS, Math.round(raw || 1)));
    if (commit && String(v) !== el.value) el.value = v;
    if (v === D.pins) return;
    if (D.undoField !== el) { pushUndo(); D.undoField = el; }
    D.pins = v;
    syncPins();
    if (D.assign >= count()) D.assign = -1;
    refresh();
  }
  function onInput(e) {
    const el = e.target, k = el.dataset && el.dataset.cf;
    if (!k || !D) return;
    if (k === 'pins' && el.type === 'number') { setPositions(el, false); return; }
    if (k === 'ref' || k === 'name') { D[k] = el.value; refresh(); return; }
    if (k === 'kind') { D.custom.kind = el.value; refresh(); return; }
    if (k === 'mark') { D.custom.mark = +el.value || 0; const lab = el.closest('.field').querySelector('label .pc-muted'); if (lab) lab.textContent = D.custom.mark ? D.custom.mark.toFixed(1) + ' mm' : 'auto, ' + r2(Sh.markSize({}, part() ? part().pins : [])).toFixed(1) + ' mm'; draw2d(); const pv = $('#cfg-preview'); if (pv) pv.innerHTML = Sh.faceSvg(api.h(), draftNode(), 520, 260); return; }
    if (k.startsWith('shape.') && e.type === 'input' && el.type !== 'checkbox') {
      const s = selShape(), f = k.slice(6);
      if (!s || el.value === '' || !isFinite(+el.value)) return;
      if (D.undoField !== el) { pushUndo(); D.undoField = el; }
      s[f] = (f === 'w' || f === 'h') ? Math.max(0.1, +el.value) : f === 'r' ? Math.max(0, +el.value) : +el.value;
      draw2d();
      const ap = $('#cfg-apply'); if (ap) ap.disabled = !!why();
    }
  }
  function onChange(e) {
    const el = e.target, k = el.dataset && el.dataset.cf;
    if (el.id === 'cfg-file') { importFile(el.files[0]); el.value = ''; return; }
    if (!k || !D) return;
    if (k === 'series') { if (el.value) { D.family = el.value; const tmp = { family: el.value, pins: D.pins, rows: D.rows }; L.conform(tmp); D.pins = tmp.pins; D.rows = tmp.rows; D.assign = -1; render(); } return; }
    if (k === 'pins') { setPositions(el, true); return; }
    if (k === 'grid') { D.grid = +el.value; draw2d(); return; }
    if (k === 'rot') { const p = part(); if (p && isFinite(+el.value)) rotate(r2(+el.value - (p.rot || 0))); return; }
    if (k === 'trace') { D.trace = el.checked; draw2d(); return; }
    if (k === 'shape.fill') { const s = selShape(); if (s) { pushUndo(); s.fill = el.checked ? undefined : false; if (s.fill === undefined) delete s.fill; draw2d(); } }
  }
  function onKey(e) {
    if (!D) return false;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typing) { document.activeElement.blur(); return true; }
      if (drag) return true;
      if (D.pointUp) { D.pointUp = false; refresh(); ghost(null); return true; }
      if (D.assign >= 0) { D.assign = -1; refresh(); return true; }
      if (D.tab === 'sketch' && D.tool !== 'select') { D.tool = 'select'; refresh(); return true; }
      if (D.sel) { D.sel = null; refresh(); return true; }
      close();
      return true;
    }
    // Enter in Ref, Name or Description makes the part; in a number field it only commits it.
    if (typing) { if (e.key === 'Enter') { const k = e.target.dataset.cf; if (k === 'ref' || k === 'name' || k === 'kind') { e.preventDefault(); apply(); } else if (k) { e.preventDefault(); e.target.blur(); } } return true; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return true; }
    if (mod) return true;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selShape()) { e.preventDefault(); delShape(); return true; }
    if (!isCustom()) return true;
    const key = e.key.toLowerCase();
    if (key === 'f') { fitView(); draw2d(); return true; }
    if (key === 'a') { startAssign(); return true; }
    if ((e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}') && D.tab === 'model' && !D.mode3d && part()) { rotate((e.key === '[' || e.key === '{' ? -1 : 1) * (e.shiftKey ? 15 : 1)); return true; }
    if (D.tab === 'sketch') { const t = TOOLS.find(x => x[2].toLowerCase() === key); if (t) { D.tool = t[0]; D.assign = -1; refresh(); } }
    return true;
  }

  function wire() {
    const back = $('#cfg-modal');
    back.addEventListener('click', e => { if (e.target === back) return; onClick(e); });
    back.addEventListener('input', onInput);
    back.addEventListener('change', onChange);
    back.addEventListener('pointerdown', e => { if (e.target.closest('[data-ring]')) { ringStart(e); return; } if (e.target.closest('#cfg-svg')) down2d(e); });
    back.addEventListener('pointermove', e => { if (ring) { ringMove(e); return; } if (drag || e.target.closest('#cfg-svg')) move2d(e); });
    back.addEventListener('pointerup', e => { if (ring) { ringEnd(); return; } up2d(e); });
    back.addEventListener('pointercancel', e => { if (ring) { ringEnd(); return; } up2d(e); });
    back.addEventListener('contextmenu', e => {
      if (!e.target.closest('#cfg-svg')) return;
      e.preventDefault();
      const mk = e.target.closest('[data-mark]');
      if (mk && D) { pushUndo(); part().pins[+mk.dataset.mark] = null; refresh(); }
    });
    back.addEventListener('wheel', e => { if (e.target.closest('#cfg-svg')) wheel2d(e); }, { passive: false });
    // A model dropped on the window goes to the model tab, not the page's harness opener.
    back.addEventListener('dragover', e => { if (!D || !isCustom()) return; e.preventDefault(); e.stopPropagation(); const z = $('#cfg-drop'); if (z) z.classList.add('over'); });
    back.addEventListener('dragleave', () => { const z = $('#cfg-drop'); if (z) z.classList.remove('over'); });
    back.addEventListener('drop', e => { if (!D) return; e.preventDefault(); e.stopPropagation(); if (!isCustom()) return; const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) importFile(f); });
    new ResizeObserver(() => { if (!D) return; if (V3 && V3.el && V3.el.isConnected) size3d(); else draw2d(); }).observe(back);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  LM.configure = { open, close, isOpen: () => !!D, onKey };
})(window.LM = window.LM || {});
