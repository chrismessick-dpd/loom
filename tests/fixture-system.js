/* A made-up system for checking cable routing at size (no client data): a 6 by 5 grid of drawn boards,
   80 by 60 mm and 40 mm apart, each with four connectors (one on each edge), and 60 generic connections
   between connectors on different boards, chosen by a seeded generator so it's the same every time.
   About the size of a machine's interconnect. LM.fixtures.bigSystem() returns a new system. */
(function (LM) {
  'use strict';
  function bigSystem() {
    const Y = LM.system, s = Y.blank('Routing check');
    s.id = 'sysfix-' + Math.random().toString(36).slice(2);
    s.title = 'Big system routing check';
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) {
      const b = Y.addDrawn(s, 'board', { x: c * 120, y: r * 100 });
      b.w = 80; b.h = 60;
      // One connector on each edge: left, top, right, bottom.
      [[0, 20], [30, 0], [80 - Y.TAB.w, 34], [50, 60 - Y.TAB.h]].forEach(([x, y], i) => Y.mkConn(b, 'J' + (i + 1), 4, { x, y }));
    }
    const all = s.blocks.flatMap(b => b.conns.map(c => ({ block: b.id, conn: c.id })));
    for (let i = 0; i < 60; i++) {
      const a = all[Math.floor(rnd() * all.length)];
      let b = all[Math.floor(rnd() * all.length)];
      while (b.block === a.block) b = all[Math.floor(rnd() * all.length)];
      s.cables.push({ id: 'kfix' + i, kind: 'link', name: 'Link ' + (i + 1), ends: { a, b } });
    }
    return Y.normalize(s);
  }
  LM.fixtures = Object.assign(LM.fixtures || {}, { bigSystem });
})(window.LM = window.LM || {});
