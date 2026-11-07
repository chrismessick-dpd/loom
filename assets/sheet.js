// The drawing sheet a tech builds from: the harness (formboard, or every wire), a detail cell per
// connector with its face view, the wire list, the BOM, notes and a title block. One self-contained
// SVG on white paper, so the same markup previews, prints, and exports as SVG or PNG.
(function (LM) {
  'use strict';
  const M = LM.model, U = LM.util, S = LM.shapes, L = LM.library, esc = U.esc;
  const W = 1680, MG = 28;
  const f = v => Math.round(v * 10) / 10;
  const SANS = "'Segoe UI', Inter, -apple-system, Arial, sans-serif", MONO = 'Consolas, ui-monospace, monospace';

  const STYLE = `
.lm-sheet text{font-family:${SANS};fill:#1d1d1f}
.lm-sheet .paper{fill:#fff}.lm-sheet .frame{fill:none;stroke:#1d1d1f;stroke-width:1.4}
.lm-sheet .card-bg{fill:#fff;stroke:#1d1d1f;stroke-width:1.1}.lm-sheet .head-hit{fill:#e9f3f4;stroke:#1d1d1f;stroke-width:1.1}
.lm-sheet .cv-bg,.lm-sheet .cv-box{fill:#fff}.lm-sheet .cv-cell{fill:none;stroke:#1d1d1f;stroke-width:1}.lm-sheet .cv-headbg{fill:#f2f2f4}
.lm-sheet .cv-frame{fill:none;stroke:#1d1d1f;stroke-width:1.2}
.lm-sheet .cv-sheath{fill:rgba(29,29,31,.38);stroke:rgba(29,29,31,.85);stroke-width:1.4}.lm-sheet .cv-band rect{fill:#2c2c2e;stroke:rgba(29,29,31,.85)}
.lm-sheet .cv-band line{stroke:rgba(255,255,255,.3);stroke-width:2;stroke-linecap:round}
.lm-sheet .cv-lead{fill:none;stroke:#6e6e73;stroke-width:.9;stroke-linecap:round}
.lm-sheet .cv-wrow text,.lm-sheet .cv-halo{paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}
.lm-sheet .cv-sketch .fv-body,.lm-sheet .cv-sketch .fv-latch,.lm-sheet .cv-sketch .fv-flange,.lm-sheet .cv-sketch .fv-cav,.lm-sheet .cv-sketch .fv-hole,.lm-sheet .cv-sketch .fv-key,.lm-sheet .cv-sketch .fv-collar{stroke-width:inherit}
.lm-sheet .cv-sketch .fv-lead,.lm-sheet .cv-sketch .fv-strip{stroke-width:inherit}.lm-sheet .cv-sketch text{display:none}
.lm-sheet .cell-cap{font-size:10px;font-weight:700;letter-spacing:.08em;fill:#515154}.lm-sheet .cv-rule{stroke:#1d1d1f}
.lm-sheet .cv-t{font-size:12px}.lm-sheet .cv-ref{font-size:13px;font-weight:600}.lm-sheet .cv-name{font-size:11px;fill:#6e6e73}
.lm-sheet .cv-tag{font:600 10.5px ${MONO};fill:#6e6e73}.lm-sheet .cv-num{font-family:${MONO}}.lm-sheet .cv-hit{fill:none}
.lm-sheet .cv-pin:not(.used) .cv-t:not(.cv-num){fill:#a1a1a6}
.lm-sheet .c-ref{font-weight:700;font-size:13px}.lm-sheet .c-fam,.lm-sheet .c-name{font-size:10.5px;fill:#515154}
.lm-sheet .card-rule{stroke:#1d1d1f;stroke-width:.8}.lm-sheet .pin-hit,.lm-sheet .seg-hit,.lm-sheet .w-hit,.lm-sheet .n-hit{display:none}
.lm-sheet .p-num{font:600 10.5px ${MONO}}.lm-sheet .p-sig{font-size:11px}.lm-sheet .p-sig.nc{fill:#a1a1a6}
.lm-sheet .p-to{font-size:10px;fill:#6e6e73}.lm-sheet .p-dot{stroke:#1d1d1f;stroke-width:.6}.lm-sheet .sock{fill:#1d1d1f}
.lm-sheet .tube{fill:none;stroke:#ececf0;stroke-linecap:round}.lm-sheet .tube.solid{stroke:#48484a}
.lm-sheet .tube.empty{stroke:#d1d1d6;stroke-dasharray:4 5}
.lm-sheet .tube.cv-sleeve{stroke:#dcdde2}.lm-sheet .tube.cv-heatshrink{stroke:#c7c7cc}.lm-sheet .tube.solid.cv-heatshrink{stroke:#1d1d1f}
.lm-sheet .tube-tex{fill:none;stroke:#8e8e93;opacity:.55}.lm-sheet .tube-tex.cv-sleeve{stroke-dasharray:1.4 2.6}
.lm-sheet .tube-tex.cv-spiral{stroke-dasharray:2 7}.lm-sheet .tube-tex.cv-tape{stroke-dasharray:14 2}.lm-sheet .tube-tex.cv-heatshrink{display:none}
.lm-sheet .w-edge{fill:none;stroke:#1d1d1f;stroke-width:4.4;stroke-linecap:round;stroke-linejoin:round}
.lm-sheet .w-base,.lm-sheet .w-stripe{fill:none;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.lm-sheet .w-stripe{stroke-dasharray:5 5;stroke-linecap:butt}.lm-sheet .w-over path{stroke-linecap:butt}.lm-sheet .w.unrouted .w-base{stroke-dasharray:4 3}
.lm-sheet .g-cable{fill:none;stroke:#1d1d1f;opacity:.16;stroke-linecap:round}.lm-sheet .g-shield{fill:none;stroke:#1d1d1f;stroke-width:1;stroke-dasharray:3 2}
.lm-sheet .g-twist{fill:none;stroke:#1d1d1f;stroke-width:.9}.lm-sheet .fan{fill:none;stroke:#1d1d1f;stroke-width:.9}
.lm-sheet .splice rect{fill:#1d1d1f}.lm-sheet .splice text{font-size:11px;font-weight:700}.lm-sheet .bk circle{fill:#1d1d1f}
.lm-sheet .len rect{fill:#fff;stroke:#1d1d1f;stroke-width:.9}.lm-sheet .len text{font-size:11px;font-weight:600}.lm-sheet .len.missing rect{stroke:#d70015}
.lm-sheet .g-tag rect{fill:#fff;stroke:#86868b;stroke-width:.8}.lm-sheet .g-tag text{font-size:10.5px;font-weight:600}
.lm-sheet .cv-label,.lm-sheet .count-label{font-size:9.5px;fill:#6e6e73;letter-spacing:.06em}
.lm-sheet .fv-body{fill:#f2f2f4;stroke:#1d1d1f;stroke-width:1.2}.lm-sheet .fv-latch,.lm-sheet .fv-flange{fill:#e3e3e8;stroke:#1d1d1f;stroke-width:1}
.lm-sheet .fv-cav{stroke:#1d1d1f;stroke-width:1}.lm-sheet .fv-cav:not(.on){fill:#fff}.lm-sheet .fv-num{font-family:${MONO};font-weight:600}
.lm-sheet .fv-one{fill:#d70015}.lm-sheet .fv-hole,.lm-sheet .fv-key{fill:#fff;stroke:#1d1d1f}.lm-sheet .fv-jacket{fill:#3a3a3c}
.lm-sheet .fv-lead{fill:none;stroke-width:3;stroke-linecap:round}.lm-sheet .fv-strip{stroke:#b08d57;stroke-width:2.2}
.lm-sheet .fv-num-out{font:600 10px ${MONO}}.lm-sheet .fv-collar{fill:#d8dade;stroke:#1d1d1f}
.lm-sheet .sec-t{font-size:11px;font-weight:700;letter-spacing:.09em;fill:#00727f}
.lm-sheet .cell{fill:none;stroke:#d1d1d6}.lm-sheet .cell-t{font-size:13px;font-weight:700}.lm-sheet .cell-s{font-size:11px;fill:#515154}
.lm-sheet .cell-n{font-size:10px;fill:#86868b;font-style:italic}
.lm-sheet .t-head{fill:#f2f2f4}.lm-sheet .t-h{font-size:9.5px;font-weight:700;letter-spacing:.06em;fill:#515154}
.lm-sheet .t-c{font-size:11px}.lm-sheet .t-m{font-family:${MONO};font-size:10.5px}.lm-sheet .t-rule{stroke:#e5e5ea}
.lm-sheet .t-box{fill:none;stroke:#1d1d1f;stroke-width:1}.lm-sheet .t-sw{stroke:#1d1d1f;stroke-width:.6}
.lm-sheet .note{font-size:11.5px}.lm-sheet .tb-l{font-size:9px;font-weight:700;letter-spacing:.07em;fill:#86868b}
.lm-sheet .tb-v{font-size:13px}.lm-sheet .tb-title{font-size:19px;font-weight:700}.lm-sheet .tb-brand{font-size:10px;fill:#00727f;font-weight:700;letter-spacing:.08em}`;

  // Word-wrap to a width; returns lines.
  function wrap(s, size, w) {
    const out = [];
    let line = '';
    String(s).split(/\s+/).forEach(word => {
      const t = line ? line + ' ' + word : word;
      if (U.textW(t, size) > w && line) { out.push(line); line = word; } else line = t;
    });
    if (line) out.push(line);
    return out;
  }

  // A ruled table; cols: { label, w (share), get(row) → text, mono, swatch(row) → color }.
  function table(x, y, w, cols, rows, empty) {
    const RH = 21, HH = 24, tot = cols.reduce((t, c) => t + c.w, 0);
    let cx = x;
    const xs = cols.map(c => { const at = cx; cx += c.w / tot * w; return at; });
    let o = `<rect class="t-head" x="${x}" y="${y}" width="${w}" height="${HH}"/>`;
    cols.forEach((c, i) => { o += `<text class="t-h" x="${f(xs[i] + 8)}" y="${y + 15.5}">${esc(c.label.toUpperCase())}</text>`; });
    rows.forEach((r, j) => {
      const ry = y + HH + RH * j;
      if (j) o += `<line class="t-rule" x1="${x}" x2="${x + w}" y1="${ry}" y2="${ry}"/>`;
      cols.forEach((c, i) => {
        let tx = xs[i] + 8;
        const cw = c.w / tot * w - 14;
        const sw = c.swatch && c.swatch(r);
        if (sw && sw.base) {
          o += `<rect class="t-sw" x="${f(tx)}" y="${ry + 6}" width="16" height="9" rx="2" style="fill:${sw.base}"/>`;
          if (sw.stripe) o += `<rect x="${f(tx + 6)}" y="${ry + 6.5}" width="4" height="8" style="fill:${sw.stripe}"/>`;
          tx += 22;
        }
        o += `<text class="t-c${c.mono ? ' t-m' : ''}" x="${f(tx)}" y="${ry + 14.5}">${esc(U.clip(c.get(r), 11, cw - (sw && sw.base ? 22 : 0)))}</text>`;
      });
    });
    if (!rows.length) o += `<text class="t-c" x="${x + 8}" y="${y + HH + 14.5}" style="fill:#86868b">${esc(empty || 'None.')}</text>`;
    const hh = HH + RH * Math.max(1, rows.length);
    o += `<rect class="t-box" x="${x}" y="${y}" width="${w}" height="${hh}"/>`;
    return { svg: o, h: hh };
  }

  function detailCell(h, n, x, y, cw, chh) {
    // The views chosen on the connector (Front, Back or Both); Both takes a double-width cell.
    const fam = L.family(n.family), fitH = 118;
    const v = S.fitViews(h, n, x + 15, y + 34, cw - 30, fitH, { max: 1.5, cap: 'cell-cap' });
    let o = `<rect class="cell" x="${x}" y="${y}" width="${cw}" height="${chh}" rx="6"/>`;
    o += `<text class="cell-t" x="${x + 12}" y="${y + 21}">${esc(n.ref)}<tspan class="cell-s" dx="8">${esc(U.clip(n.name, 11, cw - 60))}</tspan></text>`;
    o += v.svg;
    const lines = [
      `${fam.name}, ${n.pins} pos${n.rows === 2 && fam.style === 'rect' ? ', dual row' : ''}${L.hasHousing(fam) ? ', ' + n.gender : ''}`,
      (L.hasHousing(fam) ? 'Housing ' : 'Part ') + (n.mpn || L.suggestHousing(n) || 'not set'),
    ];
    if (L.hasHousing(fam)) lines.push('Terminal ' + (n.terminal || 'not set'));
    if (n.mate) lines.push('Mates with ' + n.mate);
    let ly = y + 34 + fitH + 18;
    o += `<text class="cell-n" x="${x + cw / 2}" y="${ly - 4}" text-anchor="middle">${esc(v.notes.join(' · '))}</text>`;
    ly += 12;
    lines.forEach(t => { o += `<text class="cell-s" x="${x + 12}" y="${ly}">${esc(U.clip(t, 11, cw - 24))}</text>`; ly += 15; });
    return o;
  }

  function sheet(h, opts) {
    opts = opts || {};
    const A = M.analyze(h);
    const r = LM.conn.render(h, A, { sheet: true });
    const inner = W - MG * 2;
    let o = '', y = MG + 26;
    const section = (t, yy) => `<text class="sec-t" x="${MG + 16}" y="${yy}">${esc(t)}</text>`;

    // Harness
    o += section('WIRING DIAGRAM · NOT TO SCALE', y);
    const bw = r.box.x1 - r.box.x0 + 40, bh = r.box.y1 - r.box.y0 + 40;
    const k = Math.min(1.15, (inner - 32) / bw);
    o += `<g transform="translate(${f(MG + 16 + (inner - 32 - bw * k) / 2)} ${y + 10}) scale(${f(k * 1000) / 1000}) translate(${f(-r.box.x0 + 20)} ${f(-r.box.y0 + 20)})">${r.svg}</g>`;
    y += bh * k + 34;

    // Connector details
    const conns = h.nodes.filter(M.isConn).sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));
    if (conns.length) {
      o += section('CONNECTORS', y);
      y += 12;
      const cw = 262, chh = 250, gap = 12, per = Math.floor((inner - 32 + gap) / (cw + gap));
      let col = 0, row = 0;
      conns.forEach(n => {
        const span = S.views(n).length;
        if (col && col + span > per) { col = 0; row++; }
        o += detailCell(h, n, MG + 16 + col * (cw + gap), y + row * (chh + gap), cw * span + gap * (span - 1), chh);
        col += span;
      });
      y += (row + 1) * (chh + gap) + 22;
    }

    // Wire list and BOM side by side
    const ft = M.fromTo(h, A), bom = M.bom(h, A);
    const lw = Math.round((inner - 32) * 0.57), rw = inner - 32 - lw - 20;
    o += section('WIRE LIST', y) + `<text class="sec-t" x="${MG + 16 + lw + 20}" y="${y}">BILL OF MATERIALS</text>`;
    y += 10;
    const t1 = table(MG + 16, y, lw, [
      { label: 'Wire', w: 46, get: r => r.name, mono: true },
      { label: 'From', w: 64, get: r => r.from, mono: true },
      { label: 'To', w: 64, get: r => r.to, mono: true },
      { label: 'Signal', w: 100, get: r => r.signal },
      { label: 'Color', w: 104, get: r => r.color.name || '—', swatch: r => r.color },
      { label: 'Gauge', w: 112, get: r => M.gaugeText(r.gauge) || '—' },
      { label: 'Length', w: 118, get: r => U.fmtLen(r.length) },
      { label: 'Group', w: 60, get: r => r.groups },
    ], ft, 'No wires yet.');
    const t2 = table(MG + 16 + lw + 20, y, rw, [
      { label: 'Item', w: 34, get: r => r.item },
      { label: 'Qty', w: 104, get: r => M.qtyText(r) },
      { label: 'Description', w: 220, get: r => r.desc },
      { label: 'Part number', w: 112, get: r => r.pn || '—', mono: true },
      { label: 'Refs', w: 62, get: r => r.refs.join(', ') },
    ], bom, 'Nothing to buy yet.');
    o += t1.svg + t2.svg;
    y += Math.max(t1.h, t2.h) + 18;
    o += `<text class="cell-n" x="${MG + 16 + lw + 20}" y="${y - 4}">Lengths include a ${h.allowancePct || 0}% allowance.</text>`;
    y += 18;

    // Notes and title block
    const tbW = 560, nw = inner - 32 - tbW - 30;
    o += section('NOTES', y);
    let ny = y + 22;
    (h.notes || []).filter(s => s.trim()).forEach((t, i) => {
      wrap(t, 11.5, nw - 24).forEach((line, j) => {
        o += `<text class="note" x="${MG + 16 + (j ? 22 : 0)}" y="${ny}">${j ? '' : `<tspan font-weight="700">${i + 1}.</tspan>  `}${esc(line)}</text>`;
        ny += 17;
      });
      ny += 4;
    });
    const tx = W - MG - 16 - tbW, ty = y - 8, rowH = 38;
    const cells = [
      [['TITLE', h.title, 'tb-title', tbW]],
      [['PART NUMBER', h.pn || '—', 'tb-v', 220], ['REV', h.rev || '—', 'tb-v', 80], ['DRAWN', h.drawnBy || '—', 'tb-v', 140], ['DATE', h.date || '—', 'tb-v', 120]],
      [['UNITS', 'mm, not to scale', 'tb-v', 220], ['SHEET', '1 of 1', 'tb-v', 80], ['CHECKED', '', 'tb-v', 140], ['APPROVED', '', 'tb-v', 120]],
    ];
    let tb = '', yy = ty;
    cells.forEach((row, i) => {
      const hh = i ? rowH : rowH + 12;
      let xx = tx;
      row.forEach(([l, v, cls, cw]) => {
        tb += `<rect class="t-box" x="${xx}" y="${yy}" width="${cw}" height="${hh}"/><text class="tb-l" x="${xx + 8}" y="${yy + 13}">${l}</text>`;
        tb += `<text class="${cls}" x="${xx + 8}" y="${yy + hh - 9}">${esc(U.clip(v, cls === 'tb-title' ? 19 : 13, cw - 16))}</text>`;
        xx += cw;
      });
      yy += hh;
    });
    tb += `<text class="tb-brand" x="${tx + tbW}" y="${yy + 16}" text-anchor="end">DRAWN WITH LOOM · DOVETAIL</text>`;
    o += tb;
    y = Math.max(ny, yy + 24) + MG;

    const H = Math.ceil(y);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="lm-sheet" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<style>${STYLE}</style><rect class="paper" width="${W}" height="${H}"/>` +
      `<rect class="frame" x="${MG}" y="${MG - 8}" width="${inner}" height="${H - MG * 2 + 8}" rx="2"/>${o}</svg>`;
    return { svg, w: W, h: H };
  }

  LM.sheet = { sheet, W };
})(window.LM = window.LM || {});
