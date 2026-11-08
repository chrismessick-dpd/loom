// Connector face views drawn from a family's parameters: housing, cavities numbered in the series'
// order, wired cavities filled with their wire's color, a latch or key, and a pin-1 mark. Each view
// is labeled with the side it shows. A view sketched from a STEP file would replace these later.
(function (LM) {
  'use strict';
  const M = LM.model, L = LM.library, esc = LM.util.esc;
  const f = v => Math.round(v * 10) / 10;

  // Text on a filled cavity: dark on light wire colors.
  function ink(hex) {
    if (!hex) return null;
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1d1d1f' : '#ffffff';
  }
  function pinColors(h, n) {
    const m = new Map();
    h.wires.forEach(w => [w.from, w.to].forEach(e => { if (e.node === n.id && !m.has(e.pin)) m.set(e.pin, M.colorInfo(w.color)); }));
    return m;
  }
  function cavity(x, y, s, round, p, col) {
    const fill = col && col.base;
    let o = round
      ? `<circle class="fv-cav${fill ? ' on' : ''}" cx="${f(x)}" cy="${f(y)}" r="${f(s / 2)}"${fill ? ` style="fill:${fill}"` : ''}/>`
      : `<rect class="fv-cav${fill ? ' on' : ''}" x="${f(x - s / 2)}" y="${f(y - s / 2)}" width="${f(s)}" height="${f(s)}" rx="${f(s * 0.18)}"${fill ? ` style="fill:${fill}"` : ''}/>`;
    if (col && col.stripe) o += `<rect x="${f(x - s * 0.12)}" y="${f(y - s / 2 + 1)}" width="${f(s * 0.24)}" height="${f(s - 2)}" style="fill:${col.stripe}" opacity="0.9"/>`;
    o += `<text class="fv-num" x="${f(x)}" y="${f(y + s * 0.14 + 1.5)}" text-anchor="middle" font-size="${f(Math.min(10, s * 0.42))}"${fill ? ` style="fill:${ink(fill)}"` : ''}>${esc(p)}</text>`;
    return o;
  }
  // A triangle outside the housing pointing at pin 1's row (dir -1: on the left, 1: on the right).
  const pin1 = (x, y, dir) => `<path class="fv-one" d="M${f(x)} ${f(y)}l${dir * 7} -4.5v9z"/>`;

  // back: the wire side, the mirror of the mating face.
  function rect(n, cols, back) {
    const fam = L.family(n.family), rows = n.rows || 1, cnt = n.pins;
    const across = Math.ceil(cnt / rows);
    const P = Math.max(20, Math.min(30, 14 + fam.pitch * 4)), m = 12;
    const w = across * P + m * 2, hh = rows * P + m * 2, top = 14;
    let o = `<rect class="fv-body" x="0" y="${top}" width="${w}" height="${hh}" rx="7"/>`;
    o += `<rect class="fv-latch" x="${f(w / 2 - P * 0.8)}" y="${top - 8}" width="${f(P * 1.6)}" height="10" rx="3"/>`;
    const plug = n.gender === 'plug';
    // A plug's face is the mirror of its mate's, and the wire side is the mirror of the face.
    const flip = plug !== !!back;
    for (let k = 1; k <= cnt; k++) {
      let row, col;
      if (fam.numbering === 'zigzag' && rows === 2) { col = Math.floor((k - 1) / 2); row = (k - 1) % 2; }
      else { row = Math.floor((k - 1) / across); col = (k - 1) % across; }
      if (flip) col = across - 1 - col;
      o += cavity(m + P * (col + 0.5), top + m + P * (row + 0.5), P * 0.62, plug && !back, String(k), cols.get(String(k)));
    }
    o += pin1(flip ? w + 3 : -3, top + m + P * 0.5, flip ? 1 : -1);
    return { svg: o, w: w + 12, h: hh + top + 2, ox: flip ? 0 : 12 };
  }
  function dsub(n, cols, back) {
    const cnt = n.pins, t = Math.ceil(cnt / 2), P = 22, m = 16;
    const w = t * P + m * 2, hh = 2 * P + m * 1.6, top = 6, sl = 10;
    let o = `<rect class="fv-flange" x="-26" y="${top - 6}" width="${w + 52}" height="${f(hh + 12)}" rx="6"/>`;
    o += `<circle class="fv-hole" cx="-13" cy="${f(top + hh / 2)}" r="5"/><circle class="fv-hole" cx="${w + 13}" cy="${f(top + hh / 2)}" r="5"/>`;
    o += `<path class="fv-body" d="M0 ${top}H${w}L${w - sl} ${f(top + hh)}H${sl}Z" stroke-linejoin="round"/>`;
    // A socket's face mirrors the pin side, and the wire side mirrors the face.
    const mirror = (n.gender !== 'plug') !== !!back;
    for (let k = 1; k <= cnt; k++) {
      const top1 = k <= t, i = top1 ? k - 1 : k - 1 - t;
      let x = m + P * (i + 0.5) + (top1 ? 0 : P / 2);
      if (mirror) x = w - x;
      o += cavity(x, top + m * 0.8 + P * (top1 ? 0.5 : 1.5), 15, true, String(k), cols.get(String(k)));
    }
    const x1 = mirror ? w - (m + P * 0.5) : m + P * 0.5;
    o += `<text class="fv-num-out" x="${f(x1)}" y="${top - 10}" text-anchor="middle">1</text>`;
    return { svg: o, w: w + 52, h: hh + 12, ox: 26 };
  }
  function circular(n, cols, back) {
    const cnt = n.pins, R = 34 + Math.max(0, cnt - 4) * 3.5, cx = R + 10, cy = R + 10;
    const center = cnt >= 5, ring = center ? cnt - 1 : cnt;
    let o = `<circle class="fv-flange" cx="${cx}" cy="${cy}" r="${R + 8}"/><circle class="fv-body" cx="${cx}" cy="${cy}" r="${R}"/>`;
    o += `<rect class="fv-key" x="${cx - 5}" y="${cy - R - 2}" width="10" height="12" rx="2"/>`;
    const dir = (n.gender === 'plug' ? 1 : -1) * (back ? -1 : 1), rr = R * 0.62, s = Math.max(11, Math.min(16, 70 / ring + 4));
    for (let k = 1; k <= ring; k++) {
      const a = (-90 + dir * (k - 0.5) * 360 / ring) * Math.PI / 180;
      o += cavity(cx + rr * Math.cos(a), cy + rr * Math.sin(a), s, true, String(k), cols.get(String(k)));
    }
    if (center) o += cavity(cx, cy, s, true, String(cnt), cols.get(String(cnt)));
    return { svg: o, w: cx * 2, h: cy * 2, ox: 0 };
  }
  function flying(n, cols) {
    const cnt = n.pins, gap = 18, w = 150, hh = Math.max(40, cnt * gap + 10);
    let o = `<rect class="fv-jacket" x="0" y="${f(hh / 2 - 9)}" width="26" height="18" rx="5"/>`;
    for (let k = 1; k <= cnt; k++) {
      const y = 5 + gap * (k - 0.5) + (hh - 10 - cnt * gap) / 2, c = cols.get(String(k));
      const stroke = c && c.base ? c.base : '#9a9aa0';
      o += `<path class="fv-lead" style="stroke:${stroke}" d="M26 ${f(hh / 2)}C70 ${f(hh / 2)} 60 ${f(y)} 112 ${f(y)}"/>`;
      o += `<path class="fv-strip" d="M112 ${f(y)}H134"/>`;
      o += `<text class="fv-num-out" x="${w - 6}" y="${f(y + 3.5)}" text-anchor="end">${k}</text>`;
    }
    return { svg: o, w, h: hh, ox: 0 };
  }
  function ring(n, cols) {
    const c = cols.get('1'), stroke = c && c.base ? c.base : '#9a9aa0';
    const o = `<path class="fv-lead" style="stroke:${stroke}" d="M0 30H40"/><rect class="fv-body" x="38" y="22" width="34" height="16" rx="4"/>` +
      `<path class="fv-body" d="M72 25H90A14 14 0 1 1 90 35H72Z"/><circle class="fv-hole" cx="102" cy="30" r="6"/>`;
    return { svg: o, w: 124, h: 60, ox: 0 };
  }
  function ferrule(n, cols) {
    const c = cols.get('1'), stroke = c && c.base ? c.base : '#9a9aa0';
    const o = `<path class="fv-lead" style="stroke:${stroke}" d="M0 30H34"/><path class="fv-collar" d="M32 20h22l6 4v12l-6 4H32z"/>` +
      `<rect class="fv-body" x="60" y="25" width="56" height="10" rx="2"/>`;
    return { svg: o, w: 124, h: 60, ox: 0 };
  }

  // A custom connector (Configure): the outline sketched, or a 3D model's face edges, with a mark at
  // each assigned position, all in mm (n.custom). Drawn as it was configured: the mating face, as
  // seen. The back mirrors it left to right; gender doesn't flip a drawing made by hand.
  function customParts(n) {
    const c = n.custom || {}, src = c.src === 'model' ? 'model' : 'sketch', part = c[src] || {};
    const pins = part.pins || [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    if (src === 'model' && part.d) { grow(0, 0); grow(part.w * part.k, part.h * part.k); }
    else (part.shapes || []).forEach(s => { if (s.t === 'line') { grow(s.x, s.y); grow(s.x2, s.y2); } else { grow(s.x, s.y); grow(s.x + s.w, s.y + s.h); } });
    const r = markSize(c, pins) / 2;
    pins.forEach(p => { if (p) { grow(p[0] - r, p[1] - r); grow(p[0] + r, p[1] + r); } });
    if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 10; y1 = 6; }
    return { c, src, part, pins, r, x0, y0, x1, y1 };
  }
  // A mark's diameter in mm: as set, else most of the closest spacing between marks.
  function markSize(c, pins) {
    if (c.mark > 0) return c.mark;
    const ps = (pins || []).filter(Boolean);
    let best = Infinity;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) best = Math.min(best, Math.hypot(ps[i][0] - ps[j][0], ps[i][1] - ps[j][1]));
    return isFinite(best) ? Math.max(0.4, Math.min(4, best * 0.7)) : 1.5;
  }
  // Sketch shapes and model edges in px, through X(x) and Y(y); cls picks the stroke look.
  function customSvg(P, X, Y, s) {
    let o = '';
    if (P.src === 'model' && P.part.d) {
      const k = P.part.k;
      const d = P.part.d.replace(/([ML])(-?[\d.]+) (-?[\d.]+)/g, (m, c, x, y) => c + f(X(+x * k)) + ' ' + f(Y(+y * k)));
      o += `<path class="fv-edge" d="${d}"/>`;
      (P.part.c || []).forEach(c => { o += `<circle class="fv-edge" cx="${f(X(c[0] * k))}" cy="${f(Y(c[1] * k))}" r="${f(c[2] * k * s)}"/>`; });
    } else (P.part.shapes || []).forEach(sh => {
      const cls = sh.t === 'line' ? 'fv-edge' : sh.fill === false ? 'fv-outline' : 'fv-body';
      if (sh.t === 'line') o += `<line class="${cls}" x1="${f(X(sh.x))}" y1="${f(Y(sh.y))}" x2="${f(X(sh.x2))}" y2="${f(Y(sh.y2))}"/>`;
      else if (sh.t === 'ellipse') o += `<ellipse class="${cls}" cx="${f(X(sh.x + sh.w / 2))}" cy="${f(Y(sh.y + sh.h / 2))}" rx="${f(sh.w * s / 2)}" ry="${f(sh.h * s / 2)}"/>`;
      else {
        const xa = Math.min(X(sh.x), X(sh.x + sh.w));
        o += `<rect class="${cls}" x="${f(xa)}" y="${f(Y(sh.y))}" width="${f(sh.w * s)}" height="${f(sh.h * s)}" rx="${f(Math.min(sh.r || 0, sh.w / 2, sh.h / 2) * s)}"/>`;
      }
    });
    return o;
  }
  function custom(n, cols, back) {
    const P = customParts(n), names = LM.model.pinList(n);
    const W = P.x1 - P.x0, Hm = P.y1 - P.y0, s = 150 / Math.max(W, Hm, 1e-6), m = 6;
    const X = back ? x => m + (P.x1 - x) * s : x => m + (x - P.x0) * s, Y = y => m + (y - P.y0) * s;
    let o = customSvg(P, X, Y, s);
    P.pins.forEach((p, i) => { if (p && names[i] != null) o += cavity(X(p[0]), Y(p[1]), P.r * 2 * s, true, names[i], cols.get(names[i])); });
    return { svg: o, w: W * s + m * 2, h: Hm * s + m * 2, ox: 0 };
  }

  const VIEW_NOTE = { rect: 'Mating face, latch up', dsub: 'Mating face', circular: 'Mating face, key up', flying: 'Lead ends', ring: 'Side view', ferrule: 'Side view', custom: 'Mating face, as configured' };
  const BACK_NOTE = { rect: 'Wire side, latch up', dsub: 'Wire side', circular: 'Wire side, key up', custom: 'Wire side, mirrored' };

  // Housings have a wire side worth drawing; leads, rings and ferrules are side views only.
  const hasBack = n => !!BACK_NOTE[L.family(n.family).style];
  // Which views a connector shows (n.faceView: 'front', the default, 'back' or 'both'), on the
  // sheet and in the inspector.
  function views(n) {
    if (!hasBack(n)) return ['front'];
    return n.faceView === 'back' ? ['back'] : n.faceView === 'both' ? ['front', 'back'] : ['front'];
  }

  // A face view as an SVG fragment drawn from (0, 0), with its size and the side it shows.
  function face(h, n, view) {
    const fam = L.family(n.family), cols = pinColors(h, n);
    const fn = { rect, dsub, circular, flying, ring, ferrule, custom }[fam.style] || rect;
    const back = view === 'back' && hasBack(n);
    const v = fn(n, cols, back);
    return Object.assign(v, { view: back ? 'back' : 'front', note: (back ? BACK_NOTE : VIEW_NOTE)[fam.style] || 'Mating face' });
  }
  // The connector's chosen views fitted side by side into W × H from (x, y). With two views, each
  // gets a caption ("Front", "Back") above it; cap is the caption's class.
  function fitViews(h, n, x, y, W, H, opts) {
    opts = opts || {};
    const vs = views(n).map(v => face(h, n, v)), two = vs.length > 1;
    const gap = two ? 18 : 0, capH = two ? 16 : 0, cw = (W - gap) / vs.length, ch = H - capH;
    const k = Math.min(opts.max || 1.6, ...vs.map(v => Math.min(cw / v.w, ch / v.h)));
    let o = '';
    vs.forEach((v, i) => {
      const cx = x + i * (cw + gap);
      const tx = cx + (cw - v.w * k) / 2 + v.ox * k, ty = y + capH + (ch - v.h * k) / 2;
      if (two) o += `<text class="${opts.cap || 'fv-cap'}" x="${f(cx + cw / 2)}" y="${f(y + 10)}" text-anchor="middle">${v.view === 'back' ? 'Back' : 'Front'}</text>`;
      o += `<g transform="translate(${f(tx)} ${f(ty)}) scale(${f(k * 1000) / 1000})">${v.svg}</g>`;
    });
    const note = two ? 'Front and wire side' : vs[0].note;
    return { svg: o, note, notes: vs.map(v => v.note) };
  }
  // A standalone SVG of the chosen views, fitted to a box (for the inspector).
  function faceSvg(h, n, W, H) {
    const pad = 18, r = fitViews(h, n, pad, pad - 6, W - pad * 2, H - pad * 2 + 6);
    return `<svg class="lm-face" viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${r.svg}</svg>`;
  }

  LM.shapes = { face, faceSvg, fitViews, views, hasBack, VIEW_NOTE, BACK_NOTE, customParts, customSvg, markSize, pinColors, cavity };
})(window.LM = window.LM || {});
