// Loom's animated sidebar mark: the twisted pair spins about its own axis, then rests.
// Tuned in the hub's logo lab (signoff/lab/logo-motion.html, Loom tab), which loads this file.
// The Loom icon is two strands that cross once (Loom's sidebar SVG, 20 by 20:
// "M2.5 6.5h3.5c3 0 3 7 6 7h5.5" and its mirror). That icon crosses at x = 9, left of center, so
// here the twist is moved one unit right to cross at x = 10, with leads of 4.5 on each side.
// Each strand is a curve wound about the axis y = 10 at radius 3.5. A strand's angle about the
// axis is 0 on the left lead (y = 6.5) and half a turn on the right lead (y = 13.5). Across the
// twist the angle is read back from the icon's cubic, so the resting frame is the icon, centered. Spinning adds the same angle to every
// point: y = 10 - 3.5 cos(a + spin), depth = sin(a + spin). The other strand is half a turn behind,
// so after every half turn the mark is the icon again.
//
// Depth: each strand is split where it passes the axis plane. The back pieces are drawn first,
// a little fainter and thinner, and the front pieces cut a gap through them (an SVG mask, so it
// works on any background). The fading and thinning ease out as a spin ends. The gap stays at rest
// (o.restGap), so the resting mark reads as one strand passing over the other; without it the
// resting mark is the flat icon, where the strands seem to meet.
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var AXIS = 10, R = 3.5, X0 = 2.5, X1 = 17.5, TW0 = 7, TW1 = 13, TWM = (TW0 + TW1) / 2;
  var uid = 0;

  // The strand's angle along x: [x, angle] pairs. Leads are straight; the twist samples the icon's
  // cubic, centered: (7,6.5) (10,6.5) (10,13.5) (13,13.5).
  var PROFILE = (function () {
    var p = [[X0, 0]], N = 64;
    for (var i = 0; i <= N; i++) {
      var t = i / N, m = 1 - t;
      var x = m * m * m * TW0 + 3 * m * m * t * TWM + 3 * m * t * t * TWM + t * t * t * TW1;
      var y = m * m * m * 6.5 + 3 * m * m * t * 6.5 + 3 * m * t * t * 13.5 + t * t * t * 13.5;
      p.push([x, Math.acos(Math.max(-1, Math.min(1, (AXIS - y) / R)))]);
    }
    p.push([X1, Math.PI]);
    return p;
  })();

  function ease(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function f(v) { return Math.round(v * 1000) / 1000; }
  // [r, g, b] from #rgb, #rrggbb or rgb()/rgba(); null if transparent or unreadable.
  function rgb(c) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c || '');
    if (m) {
      var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
      return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); });
    }
    m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    var v = m[1].split(/[\s,\/]+/).map(Number);
    return v.length > 3 && v[3] === 0 ? null : v.slice(0, 3);
  }
  function mix(a, b, k) {
    return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * k); }).join(',') + ')';
  }

  // Path data for the front and back pieces of both strands at one spin angle.
  function pieces(spin) {
    var front = '', back = '';
    [0, Math.PI].forEach(function (off) {
      var prev = null, run = '';
      function flush(isFront) { if (run) { if (isFront) front += run; else back += run; } run = ''; }
      PROFILE.forEach(function (q) {
        var a = q[1] + off + spin, pt = [q[0], AXIS - R * Math.cos(a), Math.sin(a)];
        if (prev && (prev[2] >= 0) !== (pt[2] >= 0)) {
          // Split where it passes the axis plane, so each piece is wholly in front or behind.
          var k = prev[2] / (prev[2] - pt[2]);
          var mx = prev[0] + (pt[0] - prev[0]) * k, my = prev[1] + (pt[1] - prev[1]) * k;
          run += 'L' + f(mx) + ' ' + f(my);
          flush(prev[2] >= 0);
          run = 'M' + f(mx) + ' ' + f(my);
        }
        run += (run ? 'L' : 'M') + f(pt[0]) + ' ' + f(pt[1]);
        prev = pt;
      });
      flush(prev[2] >= 0);
    });
    return { front: front, back: back };
  }

  var DEFAULTS = { fill: '#fff', size: 0.72, weight: 1.7, turnTime: 2.4, turns: 1, rest: 3, restGap: true, top: 0, bottom: 0, firstRest: null };
  // top, bottom: how far the strands' color moves toward the background at the top and bottom of
  // the drawing: a vertical gradient that softens the white and shades each strand as it rises
  // and falls.

  function create(host, opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in opts || {}) o[k] = opts[k];
    var id = 'loom-spin-' + (++uid);
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var svg = el('svg', { 'aria-hidden': 'true' });
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible';
    var defs = el('defs', {}, svg);
    var grad = el('linearGradient', { id: id + '-g', gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0,
      y1: AXIS - R - 1.5, y2: AXIS + R + 1.5 }, defs);
    var stopTop = el('stop', { offset: 0 }, grad), stopBot = el('stop', { offset: 1 }, grad);
    // The background the gradient shades toward: the host's own (the tile), else Loom's teal.
    var bg = rgb(getComputedStyle(host).backgroundColor) || [0, 73, 82];
    var mask = el('mask', { id: id, maskUnits: 'userSpaceOnUse' }, defs);
    var maskBg = el('rect', { fill: '#fff' }, mask);
    var halo = el('path', { fill: 'none', stroke: '#000', 'stroke-linecap': 'butt', 'stroke-linejoin': 'round' }, mask);
    var backG = el('g', { mask: 'url(#' + id + ')' }, svg);
    var back = el('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, backG);
    var front = el('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    host.appendChild(svg);

    // Fit: the strands, with their round ends, span o.size of the host's width.
    function fit() {
      var w = host.clientWidth || 1, h = host.clientHeight || 1;
      var u = (X1 - X0 + o.weight) / (o.size * w);
      var vw = w * u, vh = h * u, vx = 10 - vw / 2, vy = AXIS - vh / 2;
      svg.setAttribute('viewBox', [vx, vy, vw, vh].map(f).join(' '));
      ['x', 'y', 'width', 'height'].forEach(function (a, i) { maskBg.setAttribute(a, f([vx, vy, vw, vh][i])); });
    }

    // State: rest (the icon) → spin (o.turns turns, eased) → rest … With no rest it spins on
    // steadily.
    var phase = 'rest', t0 = now(), restFor = o.firstRest != null ? o.firstRest : o.rest;
    var spin = 0, cue = 0, paused = false, pauseAt = 0, raf = 0, dirty = true, base = 0;

    function now() { return performance.now() / 1000; }
    function step(t) {
      if (o.rest <= 0) {
        // Continuous: one turn per o.turnTime, depth cue fully on.
        if (phase !== 'steady') { phase = 'steady'; base = spin; t0 = t; }
        spin = base + 2 * Math.PI * (t - t0) / o.turnTime; cue = 1; dirty = true;
        return;
      }
      if (phase === 'steady') { phase = 'spin'; base = spin; t0 = t; }   // rest turned back on: finish to the icon
      if (phase === 'rest') {
        if (t - t0 >= restFor) { phase = 'spin'; base = 0; t0 = t; }
      } else {
        // From a steady spin, land on the next half turn; otherwise turn o.turns turns.
        var target = base ? Math.ceil(base / Math.PI + 0.25) * Math.PI - base : 2 * Math.PI * o.turns;
        var dur = Math.max(0.2, o.turnTime * target / (2 * Math.PI));
        var u = Math.min(1, (t - t0) / dur);
        spin = base + target * ease(u);
        // The depth cue fades in and out over the first and last fifth of the spin.
        cue = Math.min(1, u / 0.2, (1 - u) / 0.2);
        dirty = true;
        if (u >= 1) { spin = 0; base = 0; cue = 0; phase = 'rest'; t0 = t; restFor = o.rest; }
      }
    }

    function render() {
      var p = pieces(spin);
      var sw = o.weight, gap = o.restGap ? 1 : cue;
      front.setAttribute('d', p.front);
      back.setAttribute('d', p.back);
      halo.setAttribute('d', p.front);
      var c = rgb(o.fill) || [255, 255, 255];
      stopTop.setAttribute('stop-color', mix(c, bg, o.top));
      stopBot.setAttribute('stop-color', mix(c, bg, o.bottom));
      front.setAttribute('stroke', 'url(#' + id + '-g)'); back.setAttribute('stroke', 'url(#' + id + '-g)');
      front.setAttribute('stroke-width', f(sw));
      back.setAttribute('stroke-width', f(sw * (1 - 0.18 * cue)));
      halo.setAttribute('stroke-width', f(gap > 0 ? sw + 2 * 0.55 * sw * gap : 0));
      backG.setAttribute('opacity', f(1 - 0.38 * cue));
      dirty = false;
    }

    function frame() {
      raf = requestAnimationFrame(frame);
      if (paused) return;
      step(now());
      if (dirty) render();
    }
    fit(); render();
    var ro = window.ResizeObserver ? new ResizeObserver(function () { fit(); }) : null;
    if (ro) ro.observe(host);
    raf = requestAnimationFrame(frame);

    return {
      el: svg,
      set: function (s) { for (var k in s) o[k] = s[k]; fit(); dirty = true; if (paused) render(); },
      pause: function (p) {
        if (p && !paused) pauseAt = now();
        if (!p && paused) t0 += now() - pauseAt;   // pick up where it stopped
        paused = p;
      },
      spinNow: function () { if (phase === 'rest') restFor = 0; },
      state: function () { return { phase: phase, spin: spin, cue: cue }; },
      stop: function () { cancelAnimationFrame(raf); if (ro) ro.disconnect(); svg.remove(); }
    };
  }

  // Loom's fixed settings (Chris, 2026-11-06, from the lab).
  var TOOL = { size: 0.75, weight: 2, turns: 0.5, turnTime: 8, rest: 24, restGap: true, top: 0.15, bottom: 0 };

  // Swaps the sidebar's static mark for the animated one. With reduced motion it is drawn once
  // and stays still.
  function autostart() {
    var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    [].forEach.call(document.querySelectorAll('.brand-mark'), function (host) {
      var old = host.querySelector('svg');
      if (!old || host.getAttribute('data-animated')) return;
      host.setAttribute('data-animated', '1');
      var opts = {}, k;
      for (k in TOOL) opts[k] = TOOL[k];
      var m = create(host, opts);
      if (still) m.pause(true);
      old.remove();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autostart);
  else autostart();

  window.LoomSpin = { create: create, pieces: pieces, settings: TOOL };
})();
