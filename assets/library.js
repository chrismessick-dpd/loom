// Connector families. Each is parametric (style, pitch, rows, pin counts), so a face view can be drawn
// without a STEP file. Housing part numbers are only suggested where the series names them by pin count;
// wire ranges are typical for the series' crimp terminals. Both are hints: the datasheet wins.
(function (LM) {
  'use strict';
  const p2 = LM.util.pad2;

  const FAMILIES = [
    { id: 'generic-rect', group: 'Generic', name: 'Rectangular', style: 'rect', pitch: 2.54, rows: [1, 2], pins: [1, 40], numbering: 'zigzag' },
    { id: 'generic-circ', group: 'Generic', name: 'Circular', style: 'circular', pins: [2, 19] },
    { id: 'flying', group: 'Generic', name: 'Flying leads', style: 'flying', pins: [1, 24] },
    { id: 'ring', group: 'Generic', name: 'Ring terminal', style: 'ring', pins: [1, 1] },
    { id: 'ferrule', group: 'Generic', name: 'Ferrule', style: 'ferrule', pins: [1, 1] },

    { id: 'jst-sh', group: 'Wire to board', maker: 'JST', name: 'JST SH', style: 'rect', pitch: 1.0, rows: [1], pins: [2, 20], awg: [28, 32], housing: n => 'SHR-' + p2(n) + 'V-S' },
    { id: 'jst-gh', group: 'Wire to board', maker: 'JST', name: 'JST GH', style: 'rect', pitch: 1.25, rows: [1], pins: [2, 15], awg: [26, 30], housing: n => 'GHR-' + p2(n) + 'V-S' },
    { id: 'jst-ph', group: 'Wire to board', maker: 'JST', name: 'JST PH', style: 'rect', pitch: 2.0, rows: [1], pins: [2, 16], awg: [24, 32], housing: n => 'PHR-' + n },
    { id: 'jst-xh', group: 'Wire to board', maker: 'JST', name: 'JST XH', style: 'rect', pitch: 2.5, rows: [1], pins: [2, 20], awg: [22, 30], housing: n => 'XHP-' + n },
    { id: 'molex-picoblade', group: 'Wire to board', maker: 'Molex', name: 'Molex PicoBlade', style: 'rect', pitch: 1.25, rows: [1], pins: [2, 15], awg: [26, 32], housing: n => '51021-' + p2(n) + '00' },
    { id: 'molex-microfit', group: 'Wire to board', maker: 'Molex', name: 'Molex Micro-Fit 3.0', style: 'rect', pitch: 3.0, rows: [1, 2], pins: [2, 24], awg: [20, 30], numbering: 'rows',
      housing: (n, r) => (r === 2 ? '43025-' + p2(n) + '00' : n <= 12 ? '43645-' + p2(n) + '00' : '') },
    { id: 'molex-minifit', group: 'Wire to board', maker: 'Molex', name: 'Molex Mini-Fit Jr.', style: 'rect', pitch: 4.2, rows: [1, 2], pins: [2, 24], awg: [16, 28], numbering: 'rows',
      housing: (n, r) => (r === 2 ? '39-01-2' + p2(n) + '0' : '') },
    { id: 'te-mta100', group: 'Wire to board', maker: 'TE', name: 'TE MTA-100 (IDC)', style: 'rect', pitch: 2.54, rows: [1], pins: [2, 15], awg: [22, 28] },
    { id: 'crimp-100', group: 'Wire to board', name: '2.54 mm (0.1 in) crimp housing', style: 'rect', pitch: 2.54, rows: [1, 2], pins: [1, 40], awg: [22, 28], numbering: 'zigzag' },

    { id: 'dsub', group: 'Wire to wire', name: 'D-sub', style: 'dsub', pitch: 2.77, rows: [2], pinsList: [9, 15, 25, 37], awg: [22, 28] },
    { id: 'm8', group: 'Wire to wire', name: 'M8 circular', style: 'circular', pinsList: [3, 4, 8], awg: [22, 26] },
    { id: 'm12', group: 'Wire to wire', name: 'M12 circular', style: 'circular', pinsList: [4, 5, 8, 12], awg: [18, 26] },

    // Drawn in Configure from a 3D model's face or a sketch, with a mark per position (n.custom).
    { id: 'custom', group: 'Custom', name: 'Custom', style: 'custom', pins: [1, 200] },
  ];
  const byId = new Map(FAMILIES.map(f => [f.id, f]));
  const family = id => byId.get(id) || byId.get('generic-rect');

  // The pin counts a family offers, for the inspector's picker.
  function pinChoices(f) {
    if (f.pinsList) return f.pinsList.slice();
    const out = [];
    for (let n = f.pins[0]; n <= f.pins[1]; n++) out.push(n);
    return out;
  }
  function suggestHousing(node) {
    const f = family(node.family);
    return f.housing ? f.housing(node.pins, node.rows || 1) : '';
  }
  // Fit a connector's pins and rows to its family (after a family change).
  function conform(node) {
    const f = family(node.family);
    if (f.style === 'custom') return node; // its positions are set in Configure
    const choices = pinChoices(f);
    if (!choices.includes(node.pins)) node.pins = choices.reduce((b, n) => (Math.abs(n - node.pins) < Math.abs(b - node.pins) ? n : b), choices[0]);
    const rows = f.rows || [1];
    if (!rows.includes(node.rows)) node.rows = rows[0];
    if (f.style === 'dsub') node.rows = 2;
    return node;
  }
  // The harness-side family that mates with a board connector, guessed from its part number or
  // description. Only a guess: the rail lets you change it.
  function guessFamily(mpn, desc) {
    const m = String(mpn || ''), d = String(desc || '');
    if (/^(S|B|SM|BM)\d{1,2}B-GH/i.test(m)) return 'jst-gh';
    if (/^(SM|BM)\d{1,2}B-SRSS/i.test(m)) return 'jst-sh';
    if (/^(S|B)\d{1,2}B-PH/i.test(m)) return 'jst-ph';
    if (/^(S|B)\d{1,2}B-XH/i.test(m)) return 'jst-xh';
    if (/^(5304[78]|53398|53261)/.test(m)) return 'molex-picoblade';
    if (/^(4365[01]|43045|43650)/.test(m)) return 'molex-microfit';
    if (/^(39-?28|39-?30|5566)/.test(m)) return 'molex-minifit';
    if (/terminal block|term blk/i.test(d)) return 'flying';
    if (/d-?sub/i.test(d)) return 'dsub';
    return 'generic-rect';
  }
  const wireToWire = f => f.style === 'dsub' || f.style === 'circular';
  const hasHousing = f => ['rect', 'dsub', 'circular', 'custom'].includes(f.style);
  // What the connector is, in words: the family's name, or a custom one's description.
  const kindName = n => { const f = family(n.family); return f.style === 'custom' ? (n.custom && n.custom.kind) || 'Custom connector' : f.short || f.name; };

  LM.library = { FAMILIES, family, pinChoices, suggestHousing, conform, wireToWire, hasHousing, guessFamily, kindName };
})(window.LM = window.LM || {});
