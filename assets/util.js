// Small shared helpers: escaping, ids, units (metric first, imperial in parentheses), downloads.
(function (LM) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = p => (p || '') + Math.random().toString(36).slice(2, 9);
  const pad2 = n => String(n).padStart(2, '0');

  // "320 mm (12.6 in)"
  function fmtLen(mm) {
    if (mm == null || !isFinite(mm)) return '—';
    const inch = mm / 25.4;
    return Math.round(mm).toLocaleString('en-US') + ' mm (' + inch.toFixed(inch < 10 ? 2 : 1) + ' in)';
  }
  // "1.24 m (4.07 ft)", for wire and sleeving quantities.
  function fmtMeters(mm) {
    if (mm == null || !isFinite(mm)) return '—';
    return (mm / 1000).toFixed(2) + ' m (' + (mm / 304.8).toFixed(2) + ' ft)';
  }
  const today = () => new Date().toISOString().slice(0, 10);

  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const fileSafe = s => String(s || 'harness').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'harness';

  // Rough text width for SVG layout, in px at a given font size (system sans).
  const textW = (s, size) => String(s).length * size * 0.56;
  const clip = (s, size, w) => { s = String(s == null ? '' : s); const n = Math.floor(w / (size * 0.56)); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; };

  LM.util = { esc, uid, pad2, fmtLen, fmtMeters, today, download, csv, fileSafe, textW, clip };
})(window.LM = window.LM || {});
