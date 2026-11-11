// Loom's guide: a walk through every feature, on the demo harness, for anyone new to Loom. Opened
// from Guide in the menu, the How it works card, or the home page, any time (window.LoomGuide.start).
// It runs on the demo (?demo keeps its own storage), so the user's own harnesses are never touched:
// started outside the demo, it reopens this page with ?demo&guide in the same tab.
//
// A card over the canvas carries each step: what the feature is and what to try. Steps are grouped
// in chapters; Contents jumps to any of them. Entering a step sets the page up for it (setup: the
// view, a selection) and rings what it is about (spot), drawn as its own element and moved every
// frame, since the app redraws its panels with innerHTML. The card can be dragged by its top line.
// On a phone the parts pane is hidden: a step's `phone` text replaces its Try it there.
// State: sessionStorage loom.guide ({ step, x, y, mine }); it belongs to the tab and ends with the guide.
(function (LM) {
  'use strict';
  const KEY = 'loom.guide';
  const DEMO = /[?&]demo\b/.test(location.search);
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const G = () => LM.app.guide;
  const H = () => LM.app.H();
  // Parts of the demo harness by their refs and labels; ids are made fresh each time it's built.
  const node = ref => { const h = H(); return h && h.nodes.find(n => n.ref === ref); };
  const set = label => { const h = H(); return h && h.sets.find(s => s.label === label); };
  const wire = sig => { const h = H(); return h && h.wires.find(w => w.signal === sig); };
  const item = ref => { const n = node(ref); return n ? `[data-item="n:${n.id}"]` : null; };
  // The custom connector the visitor made in the Custom connector steps (the newest one).
  const custom = () => { const h = H(), n = h && h.nodes.filter(x => x.family === 'custom').pop(); return n ? `[data-item="n:${n.id}"]` : null; };
  // In the Configure window: what to do next there, ringed in turn.
  const CFG = '#cfg-modal';
  const box = label => { const s = set(label); return s ? `.cv-setarea[data-set="${s.id}"]` : null; };
  const pick = (kind, id) => G().select(kind, id ? [id] : []);
  const clear = () => G().select(null);
  // The harness panel stays folded through the guide (Chris, 2026-11-08); The harness panel step opens it.
  const build = () => { G().demo(); G().view('build'); G().panels(false); G().help(false); };
  // Where Properties show on this screen: the parts pane, or the rail's sheet on a phone.
  // The rail holds Properties only on a phone; on a wide screen it's the harness panel, which a step
  // about a selection must never ring (Chris: the left panel glowed when a shift-click missed).
  const props = () => (G().narrow() ? ['#rail'] : ['#parts-pane .pane-props']);

  const CHAPTERS = [
    { title: 'Welcome', steps: [
      { title: 'Welcome to Loom',
        text: 'Loom draws cable harnesses. You place the ends, click pin to pin to run wires, and group wires into twisted pairs, shields, cables, and bundles. From that one picture it makes the sheet a tech builds from: the wiring diagram, connector faces, wire list, BOM, and notes.',
        do: 'This guide uses the demo harness, an example for a made-up zone controller, so nothing of yours changes. Each step sets the page up and rings what it’s about. Use {Next} and {Back}, or {Contents} to jump around.',
        setup() { build(); clear(); G().fit(); } },
      { title: 'Your harnesses',
        text: 'The menu lists your harnesses, with their ends, wires, and any check problems. {New} starts one with two ends, and {Open a file} reads a .loom.json. In this demo nothing leaves your browser. Signed in for real, harnesses sync with Loom’s private data repo, so the other engineers on a project see and edit the same harnesses, and Signoff PL lists them by client project. The menu’s foot shows when you last synced.',
        do: 'Drop a .loom.json anywhere on the page to open it. {k:[} hides the menu and shows it again.',
        setup() { build(); clear(); G().menu(); },
        spot: () => ['#harness-list', '.sidebar [data-act="new"]'] },
      { title: 'Four views',
        text: '{Build} is where you draw. {Drawing} is the printable sheet, with the wire list under it. {BOM} is what to buy, and {Checks} is what looks wrong; its count is the errors and warnings.',
        do: 'Undo and redo ({k:Ctrl+Z}, {k:Ctrl+Shift+Z}) and {Save file}, which downloads a .loom.json, are beside the views, at the right. {k:Ctrl+S} saves the file, or syncs when you’re signed in.',
        setup() { build(); clear(); },
        spot: () => ['#view-seg'] },
    ] },
    { title: 'The canvas', steps: [
      { title: 'Moving around',
        text: 'Scroll to zoom about the pointer, and drag with the right or middle button to pan. On a touch screen, one finger pans and two fingers pinch.',
        do: '{k:F} fits the diagram, {k:+} and {k:−} zoom, and {k:0} shows actual size. The zoom control at the bottom does the same.',
        setup() { build(); clear(); G().fit(); },
        spot: () => ['#coords'] },
      { title: 'Moving parts',
        text: 'Drag a connector, a splice, or a run of wires by any part of it. Parts snap to the grid by their first pin, so pins on different parts line up and wires run straight.',
        do: 'Drag P2 down a little, then press {k:Ctrl+Z} to put it back. Hold {k:Ctrl} while dragging to place a part anywhere.',
        setup() { build(); clear(); },
        spot: () => [item('P2')] },
      { title: 'Grid and Auto layout',
        text: 'The {Grid} control sets the snap step (or turns it off) and draws the grid as dots or lines. Once anything has been dragged, {Auto layout} appears beside {Fit}: it forgets every position you dragged and lays the diagram out again.',
        do: 'The panel buttons in the canvas’s top corners fold the harness panel (left) and the parts pane (right) away for more room.',
        setup() { build(); clear(); },
        spot: () => ['#hud'] },
    ] },
    { title: 'Ends and wires', steps: [
      { title: 'Connectors',
        text: 'A connector is a table: its ref and a sketch of it in the header, its family and gender, then a row per pin with the pin’s label, usually the board’s net name. Selected, its Properties hold the family and pin count, the part it mates with, the face views the drawing prints, and every pin’s label.',
        do: 'P1 is selected. In Properties, set {Views} to {Both} and watch the face drawing show the wire side too.',
        setup() { build(); const n = node('P1'); if (n) pick('node', n.id); },
        spot: () => [...props().map(s => s + ' .face-tile'), item('P1')] },
      // No Try it (Chris, 2026-11-08): the custom connector steps add the connector.
      { title: 'Adding parts',
        text: '{Add › Connector} puts a new end on the canvas (or press {k:C}). {Splice} adds a splice, and {Note} pins a note to a part (more on notes later). The {Parts} tab also lists the splices, notes, and wire sets; click one to select it.',
        phone: 'The parts pane needs a wider screen; on a phone, open Loom on a computer to add parts.',
        setup() { build(); clear(); },
        spot: () => ['#parts-pane .palette'] },
      { title: 'A connector from a board',
        text: '{From a board} reads a board’s fab package as Signoff EE stores it, its netlist and BOM. The connector arrives with the board’s pin names and its net names as pin labels. When two ends share net names on free pins, a connector’s Properties suggest the wires to run.',
        do: 'Click {From a board}, pick the Main PCBA, then a connector. In the demo it reads the made-up Smart Thermostat’s boards, the ones Fabcheck’s demo checks. {k:Esc} closes it.',
        phone: '{From a board} is in the parts pane, which needs a wider screen.',
        setup() { build(); clear(); },
        spot: () => ['#board-modal .lm-modal', '#parts-pane [data-act="from-board"]'] },
      { title: 'A custom connector',
        text: 'When no family fits, draw the connector yourself. {Configure}, in a connector’s Properties, sets its ref, name, and type; {Custom} takes its face from a 3D model (STEP, IGES, or STL) or a sketch. Loom keeps only the face drawing, never the model.',
        do: 'Click {Connector}, then {Configure} in its Properties. Pick {Custom}, then the {3D model} tab, then {Load demo model}: an 8-position circular connector.',
        phone: '{Configure} needs a wider screen; on a phone, open Loom on a computer to draw a custom connector.',
        setup() { build(); clear(); },
        spot: () => [`${CFG} [data-cfg="type"][data-v="custom"]:not(.on)`, `${CFG} [data-cfg="tab"][data-v="model"]:not(.on)`, `${CFG} #cfg-drop [data-cfg="demo-model"]`,
          '#parts-pane .cfg-open', '#parts-pane [data-act="add-conn"]'] },
      { title: 'Its face and positions',
        text: 'Drag to turn the model, and click its mating face to look straight at it. {Make face view} draws the face from that side. Then set {Positions} and press {Assign}: each click drops the next position’s mark, snapping to the round cavity under the pointer. {Make part} saves it.',
        do: 'Click the face with the eight holes, then {Make face view}. Set {Positions} to 8, press {Assign}, and click the eight holes in order, then {Make part}.',
        phone: '{Configure} needs a wider screen.',
        at: 'right',
        setup() { build(); },
        spot: () => [`${CFG} [data-cfg="make-face"]`, `${CFG} #cfg-apply:not(:disabled)`, [`${CFG} .row2:has([data-cf="pins"])`, `${CFG} .cfg-assign-btn`],
          `${CFG} #cfg-drop [data-cfg="demo-model"]`, custom(), '#parts-pane .cfg-open'] },
      { title: 'Running a wire',
        text: 'Click a pin, then a pin on another end or a splice: that’s a wire. While you’re wiring, the pins you can land on glow, the wire follows the pointer, and {k:Esc} cancels. New wires take the gauge and color set in the harness panel.',
        do: 'Run a few wires from the board connector you added (or P1’s free pin 6) to your custom connector. Then {k:Shift}-click them and try {Twist}, {Shield}, {Cable}, and {Bundle} in Properties.',
        setup() { build(); clear(); G().fit(); },
        spot: () => [custom(), item('P1')] },
      { title: 'A wire’s properties',
        text: 'Select a wire by clicking its line. Properties show its ends, signal, color (with a stripe), gauge, and length, and chips for the sets it’s in. The canvas, the drawing, and the wire list all follow a change.',
        do: 'The 3V3 wire is selected. Change its color, then press {k:Ctrl+Z}.',
        setup() { build(); const w = wire('3V3'); if (w) pick('wire', w.id); },
        spot: () => props() },
      { title: 'Splices and wire ends',
        text: 'S1 joins the three ground wires. Every wire end has a dot to drag it by: drop it on a splice (in the slot under the pointer), on another pin, or on empty canvas to leave a loose end, which {Checks} flags. Dragging a splice’s port up or down reorders that side.',
        do: 'Drag a dot away from S1 to disconnect the wire from the splice. Drag it back onto the splice to show available connections. Wires on the side of the splice can be dragged around to rearrange their order.',
        setup() { build(); clear(); },
        spot: () => [item('S1')] },
    ] },
    { title: 'Wire sets', steps: [
      { title: 'Twists, shields, cables, and bundles',
        text: '{k:Shift}-click two or more wires, or drag a box over them (right to left, green: everything it touches; left to right, blue: everything inside it), then tick {Twist} or {Shield}, or pick {Cable} or {Bundle} under {Held as}, in Properties: the wires become a wire set. C1 is a two-wire cable, TP2 a twisted pair, and B1 a laced bundle.',
        do: 'C1 is selected. Its {Wire set} panel holds its label, part number, the cable note, and its color. Try ticking {Shield}.',
        setup() { build(); const s = set('C1'); if (s) pick('set', s.id); },
        spot: () => [...props(), box('C1')] },
      { title: 'Sets inside sets',
        text: 'Sets nest. TP1, the shielded I²C pair, runs inside B1. Select a set and more wires, then tick {Bundle}, and the set goes inside the new one. The {Hierarchy} in Properties shows the tree; click a row to select it. {k:Delete} on a set unmakes it and keeps its wires.',
        do: 'TP1 is selected. Click B1 in its {Hierarchy}.',
        setup() { build(); const s = set('TP1'); if (s) pick('set', s.id); },
        spot: () => [...props().map(s => s + ' .set-tree'), ...props()] },
      { title: 'Set lengths',
        text: 'A set needn’t run the wires’ whole length. A selected set has a grip at each end: drag one to shorten the set or run it past what holds it. It snaps to 5 mm, and Properties show each end’s overhang. B1 is laced over 150 mm of the 250 mm run, and TP1 runs past it to both ends.',
        do: 'Drag B1’s right grip to the right, then press {k:Ctrl+Z}.',
        setup() { build(); const s = set('B1'); if (s) pick('set', s.id); },
        spot: () => { const s = set('B1'); return s ? [`[data-setend="${s.id}|r"]`, box('B1')] : []; } },
      { title: 'Badges, labels, and shaping wires',
        text: 'Every set has a badge under it: click it to select the set, drag it anywhere, or slide its dot along the set. Each wire’s label hangs from a dot on its wire: slide the dot along the wire, or drag the label anywhere. Wires and sets find their own way round the parts in straight runs. Drag any straight run sideways to shape one (a selected wire shows a handle on each run), double-click a run to add a bend, and drag a run flush with the next to take a bend out. Where a bundle splits to several parts, drag its diamond to move the split. Right-click a wire to have it walk around parts or go behind them. {Reset route} in Properties puts one wire back, and {Auto layout} puts all of these back.',
        do: 'Drag the B1 badge somewhere else, then press {k:Ctrl+Z}.',
        setup() { build(); clear(); },
        spot: () => { const s = set('B1'); return s ? [`.cv-badge[data-set="${s.id}"]`, '.cv-badge'] : ['.cv-badge']; } },
    ] },
    { title: 'Views and notes', steps: [
      { title: 'Real proportions',
        text: 'Tick {Real proportions} to lay the harness out to scale from its lengths. Parts then move only up and down, and a long run gets a break mark. Untick it to go back to the arranged view, with its dragged positions kept.',
        do: 'Tick it and back. {Wire labels}, beside it, hides the text on the wires; the drawing always prints it.',
        setup() { build(); clear(); },
        spot: () => ['.hud-br'] },
      { title: 'Notes',
        text: '{Add › Note}, then click a wire, a set, or a connector to pin a note there, or drag to draw an area for it: a dashed box around what the note is about. A pinned note follows its part. Drag a bubble to move it, and click it to edit. An area moves by its edge and resizes by its corners, and its dot slides along the edge. A note with a part number and quantity is a BOM line: heat shrink, a label, a clip.',
        do: 'Click {Note}, then click C1’s cable. Click {Note} again and drag a box around P1.',
        phone: '{Note} is in the parts pane, which needs a wider screen. Notes already on a harness can be tapped and edited.',
        setup() { build(); clear(); },
        spot: () => ['#parts-pane [data-act="add-note"]'] },
    ] },
    { title: 'The drawing', steps: [
      { title: 'The harness panel',
        text: 'With nothing selected, the left panel is the harness: its title, part number, rev, drawn by, and date for the title block, the gauge and color new wires get, the allowance added to every BOM length, and numbered notes for the drawing. Its checks are listed under them.',
        do: 'Type a note in {Notes}, one per line. The drawing numbers them.',
        setup() { G().demo(); G().view('build'); G().panels(); G().help(false); clear(); },
        spot: () => ['#rail'] },
      { title: 'Checks',
        text: 'Checks look at the harness as drawn: pins with no wire, two wires on one pin, wires with no path, color, or gauge, loose ends, runs with no length, gauges a terminal won’t take, and sets that run past their wires.',
        do: 'Click a check to see it on the canvas.',
        setup() { G().demo(); G().view('checks'); },
        spot: () => ['.checks-card'] },
      { title: 'The sheet',
        text: '{Drawing} is one sheet for the tech: the wiring diagram, the connector face views, the wire list, the BOM, the notes, and a title block. It always uses the arranged view.',
        do: '{SVG} and {PNG} download it, and {Print or PDF} prints it (choose Save as PDF in the print dialog).',
        setup() { G().demo(); G().view('drawing'); },
        spot: () => ['.sheet-card'] },
      { title: 'The wire list',
        text: '{Wires} is the wire list, and you can edit it: type ends as a ref and pin (P1.3) or a splice (S1), change signals, colors and gauges, and add a wire in the last row. {Paste from a spreadsheet} adds many at once. {CSV} downloads the list.',
        do: 'Change a signal name, then look for it on the {Drawing}.',
        setup() { G().demo(); G().view('wires'); },
        spot: () => ['.wires-page .table-wrap'] },
      { title: 'Bill of materials',
        text: 'The {BOM} lists the connectors with their housings and terminals, the wire by gauge and color, cables, shields, and noted parts. Lengths include the allowance. Where a connector has no housing part number, one is suggested from its series; check it against the datasheet.',
        do: '{CSV} downloads it.',
        setup() { G().demo(); G().view('bom'); },
        spot: () => ['#page .table-wrap'] },
    ] },
    { title: 'Done', steps: [
      // Always the second to last step (Chris, 2026-11-08).
      { title: 'How it works',
        text: 'The {?} in the parts pane’s corner opens a short card with these moves, in either tab, and this guide can be opened again from it.',
        do: 'Click {?} to open or close it.',
        phone: 'The card is in the parts pane, which needs a wider screen.',
        setup() { build(); clear(); G().help(true); },
        spot: () => ['#parts-pane .pane-help-btn'] },
      { title: 'You’re set',
        text: 'Shortcuts: {k:C} adds a connector, {k:F} fits, {k:+} {k:−} {k:0} zoom, {k:Delete} deletes the selection, {k:Esc} cancels, {k:Ctrl+Z} undoes, {k:Ctrl+Shift+Z} redoes, {k:Ctrl+S} saves (or syncs, signed in), and {k:[} hides the menu.',
        do: 'Open this guide again any time from {Guide} in the menu or the {?} card. {Reset demo}, in the banner, puts the demo harness back.',
        setup() { build(); clear(); G().fit(); },
        last: true },
    ] },
  ];
  // A step's text names what's on screen in braces (Chris: "From a board does…" read as a sentence):
  // {From a board} is a button, tab, or field, drawn as a chip, and {k:Esc} a key.
  const marks = t => esc(t).replace(/\{(k:)?([^{}]+)\}/g, (m, k, x) => k ? `<kbd class="lg-key">${x}</kbd>` : `<span class="lg-ui">${x}</span>`);
  const STEPS = CHAPTERS.flatMap((c, ci) => c.steps.map(s => Object.assign({ chapter: ci }, s)));

  function get() { try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return s && s.step >= 0 && s.step < STEPS.length ? s : null; } catch (e) { return null; } }
  function put(s) { try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } }

  // Start: here in the demo; from someone's own harnesses, the demo in this tab (remembering to offer
  // the way back at the end).
  function start(at) {
    const st = { step: at || 0, mine: !DEMO || !!(get() || {}).mine };
    put(st);
    if (!DEMO) { location.href = location.pathname + '?demo&guide'; return; }
    show(true);
  }
  function end() {
    const st = get();
    put(null);
    show();
    if (st && st.mine) location.href = location.pathname;
  }
  function go(i) { const st = get(); if (!st) return; st.step = Math.max(0, Math.min(STEPS.length - 1, i)); st.contents = false; put(st); show(true); }

  // ── The card ──
  function show(enter) {
    const st = get();
    let el = $('#lm-guide');
    document.body.classList.toggle('lm-guide-on', !!st);
    if (!st) { if (el) el.remove(); spotStop(); return; }
    const s = STEPS[st.step];
    if (enter && s.setup) { try { s.setup(); } catch (e) { /* a step's setup is a convenience */ } }
    if (!el) { el = document.createElement('div'); el.id = 'lm-guide'; el.className = 'lm-guide'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Loom guide'); document.body.appendChild(el); }
    const ch = CHAPTERS[s.chapter];
    const head = `<div class="lg-top" data-g="drag"><span>Guide · ${esc(ch.title)}</span><span class="lg-n">${st.step + 1} / ${STEPS.length}</span>` +
      `<button class="lg-x${st.contents ? ' on' : ''}" data-g="contents" title="Contents" aria-label="Contents" aria-expanded="${!!st.contents}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 4h10M3 8h10M3 12h7"/></svg></button>` +
      `<button class="lg-x" data-g="end" title="Close the guide" aria-label="Close the guide"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>`;
    const bar = `<div class="lg-bar">${CHAPTERS.map((c, ci) => `<i class="${ci < s.chapter ? 'done' : ci === s.chapter ? 'on' : ''}" style="flex:${c.steps.length}"></i>`).join('')}</div>`;
    let body;
    if (st.contents) {
      let k = 0;
      body = `<div class="lg-toc">${CHAPTERS.map(c => `<div class="lg-ch">${esc(c.title)}</div>` + c.steps.map(x => { const i = k++; return `<button class="lg-li${i === st.step ? ' on' : ''}" data-g="to" data-i="${i}">${esc(x.title)}</button>`; }).join('')).join('')}</div>`;
    } else {
      body = `<h3>${esc(s.title)}</h3><p>${marks(s.text)}</p>${(s.phone && G().narrow()) || s.do ? `<p class="lg-do"><b>Try it.</b> ${marks(s.phone && G().narrow() ? s.phone : s.do)}</p>` : ''}`;
    }
    const acts = `<div class="lg-act">${st.step > 0 ? '<button class="btn" data-g="back">Back</button>' : ''}<span class="lg-sp"></span>` +
      (s.last ? (st.mine ? '<button class="btn" data-g="end">Back to my harnesses</button><button class="btn btn-primary" data-g="restart">Start over</button>' : '<button class="btn" data-g="restart">Start over</button><button class="btn btn-primary" data-g="end">Finish</button>')
        : `<button class="btn btn-primary" data-g="next">Next</button>`) + '</div>';
    el.innerHTML = head + bar + body + acts;
    place(el, st);
    spotStart();
    if (enter) { const b = el.querySelector('[data-g="next"], [data-g="end"].btn-primary'); if (b) b.focus({ preventScroll: true }); }
  }

  // Where the card sits: where it was dragged to, else the canvas's bottom-left corner (above the
  // view controls), or the page's bottom right on the other views; moved to the other side when it
  // would cover what the step rings. Kept on screen.
  function place(el, st) {
    const W = el.offsetWidth, Hh = el.offsetHeight, m = 12;
    let x, y;
    const s = STEPS[st.step];
    if (st.x != null) { x = st.x; y = st.y; }
    // at: 'right', the window's right edge, halfway down (the Configure steps; Chris: out of the way).
    // Where that would cover the Configure window's stage (a window under about 1950 px), the bottom
    // right corner, which the face drawing, fitted in the middle, leaves clear.
    else if (s && s.at === 'right' && !G().narrow()) {
      x = innerWidth - W - 16; y = (innerHeight - Hh) / 2;
      const sg = document.querySelector('#cfg-modal:not([hidden]) #cfg-stage');
      if (sg && sg.getBoundingClientRect().right > x + 8) y = innerHeight - Hh - 16;
    }
    else {
      const wrap = $('#canvas-wrap'), main = $('#main');
      const r = wrap && wrap.offsetParent && !$('#build-view').hidden ? wrap.getBoundingClientRect() : main.getBoundingClientRect();
      // On a phone the selection's sheet rises from the bottom, so the card sits at the top.
      const spots = G().narrow() ? [{ x: r.left + 12, y: r.top + 8 }] : [{ x: r.left + 16, y: r.bottom - Hh - 64 }, { x: r.right - W - 16, y: r.bottom - Hh - 64 }, { x: r.right - W - 16, y: r.top + 64 }, { x: r.left + 16, y: r.top + 64 }];
      // The corner covering least: never the ring if it can help it, then as few of the canvas's
      // connectors and splices as it can, the newest most of all (Chris: a connector added in the
      // custom connector steps lands at the bottom left, under the card). The first corner wins ties.
      const t = spotRect(), h = H(), last = h && h.nodes.length ? h.nodes[h.nodes.length - 1].id : null;
      const keep = $('#build-view') && !$('#build-view').hidden ? [...document.querySelectorAll('#canvas [data-item^="n:"]')].map(e => {
        const q = e.getBoundingClientRect();
        return { x0: q.left, y0: q.top, x1: q.right, y1: q.bottom, w: e.dataset.item === 'n:' + last ? 4 : 1 };
      }) : [];
      const over = (p, b) => Math.max(0, Math.min(p.x + W, b.x1) - Math.max(p.x, b.x0)) * Math.max(0, Math.min(p.y + Hh, b.y1) - Math.max(p.y, b.y0));
      const cost = p => (t ? 100 * over(p, t) : 0) + keep.reduce((a, b) => a + b.w * over(p, b), 0);
      const p = spots.reduce((a, q) => (cost(q) < cost(a) ? q : a), spots[0]);
      x = p.x; y = p.y;
    }
    x = Math.max(m, Math.min(innerWidth - W - m, x));
    y = Math.max(m, Math.min(innerHeight - Hh - m, y));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }

  // ── The spot ──
  let raf = 0, was = null;
  // What the step rings: the first of its spots that's showing, as { el, r }. A spot that is a list of
  // selectors rings them all as one box (Positions and Assign in the Configure window), and shows
  // when its first one does. While a window is open, only what's in it counts.
  function target() {
    const st = get(), s = st && !st.contents && STEPS[st.step];
    if (!s || !s.spot) return null;
    const modal = document.querySelector('.lm-modal-back:not([hidden]) .lm-modal');
    const shown = q => {
      for (const el of document.querySelectorAll(q)) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && !(modal && !modal.contains(el))) return { el, r };
      }
      return null;
    };
    for (const q of s.spot()) {
      if (!q) continue;
      if (!Array.isArray(q)) { const t = shown(q); if (t) return t; continue; }
      const ts = q.map(shown);
      if (!ts[0]) continue;
      const ok = ts.filter(Boolean);
      const r = { left: Math.min(...ok.map(t => t.r.left)), top: Math.min(...ok.map(t => t.r.top)), right: Math.max(...ok.map(t => t.r.right)), bottom: Math.max(...ok.map(t => t.r.bottom)) };
      r.width = r.right - r.left; r.height = r.bottom - r.top;
      return { el: ts[0].el, r };
    }
    return null;
  }
  // The part of the window an element can be seen in: the window, cut by any scrolling pane it's in.
  function viewOf(el) {
    let top = 0, bottom = innerHeight;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) {
        const q = p.getBoundingClientRect();
        top = Math.max(top, q.top); bottom = Math.min(bottom, q.bottom);
      }
    }
    return { top, bottom };
  }
  function spotRect() { const t = target(); if (!t) return null; const r = t.r; return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; }
  // The card moves again when the canvas gains or loses a part or a window opens or closes (once the
  // canvas has refit), unless it was dragged.
  let layoutKey = '', replace = 0;
  function watchLayout() {
    const key = document.querySelectorAll('#canvas [data-item^="n:"]').length + '|' + !!document.querySelector('.lm-modal-back:not([hidden])');
    if (key === layoutKey) return;
    const first = !layoutKey;
    layoutKey = key;
    if (first) return;
    clearTimeout(replace);
    replace = setTimeout(() => { const st = get(), el = $('#lm-guide'); if (st && el && st.x == null && !st.contents) place(el, st); }, 450);
  }
  function tick() {
    raf = 0;
    if (!get()) { spotStop(); return; }
    watchLayout();
    const t = target(), el = t && t.el;
    let ring = $('#lm-guide-spot');
    if (!el) { if (ring) ring.remove(); was = null; }
    else {
      if (!ring) { ring = document.createElement('div'); ring.id = 'lm-guide-spot'; ring.className = 'lm-guide-spot'; ring.setAttribute('aria-hidden', 'true'); document.body.appendChild(ring); }
      const r = t.r, pad = 5;
      ring.style.left = (r.left - pad) + 'px'; ring.style.top = (r.top - pad) + 'px';
      ring.style.width = (r.width + pad * 2) + 'px'; ring.style.height = (r.height + pad * 2) + 'px';
      // A new target off screen, or scrolled out of its pane (the Hierarchy at the bottom of
      // Properties), comes into view; not on the canvas, which the setup frames.
      if (was !== el) { was = el; const v = viewOf(el); if ((r.top < v.top || r.bottom > v.bottom) && !el.closest('svg')) el.scrollIntoView({ block: r.height > (v.bottom - v.top) * 0.6 ? 'start' : 'center' }); }
    }
    raf = requestAnimationFrame(tick);
  }
  function spotStart() { was = null; if (!raf) raf = requestAnimationFrame(tick); }
  function spotStop() { cancelAnimationFrame(raf); raf = 0; const r = $('#lm-guide-spot'); if (r) r.remove(); }

  // ── Events ──
  document.addEventListener('click', e => {
    const b = e.target.closest('#lm-guide [data-g]');
    if (!b) return;
    const st = get(), g = b.dataset.g;
    if (!st) return;
    if (g === 'next') go(st.step + 1);
    else if (g === 'back') go(st.step - 1);
    else if (g === 'to') go(+b.dataset.i);
    else if (g === 'restart') go(0);
    else if (g === 'end') end();
    else if (g === 'contents') { st.contents = !st.contents; put(st); show(); }
  });
  // Drag the card by its top line; where it's left is kept for the rest of the guide.
  let drag = null;
  document.addEventListener('pointerdown', e => {
    const t = e.target.closest('#lm-guide [data-g="drag"]');
    if (!t || e.target.closest('button') || e.button) return;
    const el = $('#lm-guide'), r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    t.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const st = get(); if (!st) { drag = null; return; }
    st.x = e.clientX - drag.dx; st.y = e.clientY - drag.dy; put(st);
    place($('#lm-guide'), st);
  });
  document.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('resize', () => { const st = get(); if (st) place($('#lm-guide'), st); });

  // ── Start ──
  // Arriving with ?guide (from outside the demo): drop it from the address, so a reload doesn't
  // restart, and carry on where the guide is.
  function init() {
    if (/[?&]guide\b/.test(location.search)) {
      if (!get()) put({ step: 0, mine: false });
      try { history.replaceState(null, '', location.pathname + '?demo' + location.hash); } catch (e) { /* not allowed */ }
    }
    if (!DEMO) { if (get()) put(null); return; }
    if (get()) show(true);
  }
  window.LoomGuide = { start, end, steps: STEPS.length };
  LM.guide = window.LoomGuide;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.LM = window.LM || {});
