// Connections (Chris, 2026-11-11): one engine routes every Connection in Loom. A Connection is anything
// that joins two blocks: on a harness, a wire (or the group of wires one route carries) between
// connectors and splices; in a system, a cable between connectors on boards and devices, whether it is a
// Loom harness, a purchased cable, or a generic connection. Both route, shape, and drag the same way, and
// the harness's routing (docs/routing.md) is the baseline: this is its code, moved out of conn.js
// unchanged (tests/golden.js checks the harness still routes exactly as it did).
//
// A caller hands over its parts (rectangles a route walks round) and its connections, each with:
//   key      what its stored shape is kept under (h.routes[key], or a system cable's routes[key])
//   weight   how big it is; bigger ones route first (a harness: its wire count)
//   combos   the end pairs it may take, [{ A, B }]: route.js terminals, level at both ends. A terminal
//            with a choice of sides (a connector's two edges) says conn: true and its side ('l' or 'r');
//            node names the part it leaves, whose rectangle its end runs may cross.
//   half     how far its drawing reaches either side of its line; stub, how far it runs out level
//            before its first corner; r, its corner radius
//   shape    the stored record, { v, a, b, mode } (route.js v; the sides it was shaped on; mode
//            'behind' routes straight past parts), or null
// and gets back each connection's route, { key, A, B, v, half, stub, r, kept, behind }.
//
// The editing is shared too (grab, slide, release, bend, menu below): a drag on a straight run moves it
// sideways on the grid, an end run first gets a bend clear of its part, a double-click adds a bend, a
// run dragged flush with its neighbor merges, and the right-click menu has Walk around parts, Go behind
// parts, and Reset route.
(function (LM) {
  'use strict';
  const RT = () => LM.route;
  // Routes found for each document (a harness or a system), by connection key, so a layout that changes
  // nothing finds none again.
  const routeCache = new Map();

  // Every connection's route, biggest first, each keeping clear of those before it.
  // - A connection may have several end pairs (a connector end may leave from either edge; Chris,
  //   2026-11-10: P3 jumped its pins to the far edge because P2's middle was a little to its right):
  //   each is tried and the cheaper route wins, the first given (the edges facing each other) on a tie.
  // - A route shaped by hand (shape: v, and the edges it was shaped on, a and b) keeps its runs. Its
  //   edges follow its first and last vertical runs: dragged past a connector, it leaves from the other
  //   edge. A run inside a part's span fits neither, and the route runs behind the part (Chris: drags
  //   aren't stopped by parts).
  // - mode 'behind' (the right-click menu) routes straight past parts, behind them.
  // - A route found before is kept while its ends haven't moved, it doesn't now run through a part,
  //   and it doesn't lie along a route that changed before it in this pass (Chris: lines he hadn't
  //   touched kept changing). opts.fast (a part being dragged) re-routes only connections whose ends
  //   moved.
  // opts: { fast, grid (the search grid's step, 10), margin (room round everything, 300), onRoute(A, B)
  // (called for each route in order, as it's laid) }. Returns { routes (Map by key), G, rects }.
  function routeAll(docKey, rects, list, opts) {
    const o0 = opts || {}, RTm = RT();
    const all = list.map(c => {
      const shape = c.shape || null, combos = c.combos, stub = c.stub;
      let kept = null, ends = combos[0];
      if (shape && Array.isArray(shape.v) && shape.v.every(x => isFinite(+x))) {
        kept = shape.v.map(Number);
        const want = combos.find(x => (!x.A.conn || x.A.side === shape.a) && (!x.B.conn || x.B.side === shape.b)) || combos[0];
        ends = [want].concat(combos.filter(x => x !== want)).find(x => RTm.fits(x.A, x.B, kept, stub)) || want;
      }
      return { key: c.key, weight: c.weight, A: ends.A, B: ends.B, combos, half: c.half, stub, r: c.r, kept, behind: !!(shape && shape.mode === 'behind') };
    });
    const sig = o => JSON.stringify(o.combos.map(c => [c.A.x, c.A.y, c.A.out, c.B.x, c.B.y, c.B.in]).flat().concat(o.half, o.behind ? 1 : 0).map(v => Math.round(v * 10) / 10));
    const whole = JSON.stringify([rects.map(r => [r.x0, r.y0, r.x1, r.y1].map(Math.round)), all.map(o => o.key + sig(o) + (o.kept ? o.kept.join(',') + o.A.side + o.B.side : ''))]);
    const cache = routeCache.get(docKey) || { whole: '', v: new Map(), sig: new Map() };
    const same = cache.whole === whole;
    const xs = rects.flatMap(r => [r.x0, r.x1]).concat(all.flatMap(o => o.combos.flatMap(c => [c.A.x, c.B.x]))), ys = rects.flatMap(r => [r.y0, r.y1]).concat(all.flatMap(o => [o.A.y, o.B.y]));
    const M0 = o0.margin == null ? 300 : o0.margin;
    const G = RTm.grid({ x0: Math.min(0, ...xs) - M0, y0: Math.min(0, ...ys) - M0, x1: Math.max(0, ...xs) + M0, y1: Math.max(0, ...ys) + M0 }, o0.grid || 10);
    // One order whatever is shaped, so shaping one route moves as few others as it can.
    all.sort((p, q) => q.weight - p.weight || (p.key < q.key ? -1 : 1));
    const strict = (p, q, r) => (Math.abs(p.y - q.y) < 0.01
      ? p.y > r.y0 && p.y < r.y1 && Math.max(p.x, q.x) > r.x0 && Math.min(p.x, q.x) < r.x1
      : p.x > r.x0 && p.x < r.x1 && Math.max(p.y, q.y) > r.y0 && Math.min(p.y, q.y) < r.y1);
    const crosses = (A0, B0, v, half) => RTm.runs(A0, B0, v).some(r => rects.some(rc => {
      if (r.k < 0 && (rc.id === A0.node || rc.id === B0.node)) return false;
      const m = half + 2;
      return strict(r.a, r.b, { x0: rc.x0 - m, y0: rc.y0 - m, x1: rc.x1 + m, y1: rc.y1 + m });
    }));
    const along = (r, s, d) => {
      if (r.axis !== s.axis) return false;
      const lv = r.axis === 'h', gap = Math.abs(lv ? r.a.y - s.a.y : r.a.x - s.a.x);
      const lo = lv ? Math.max(Math.min(r.a.x, r.b.x), Math.min(s.a.x, s.b.x)) : Math.max(Math.min(r.a.y, r.b.y), Math.min(s.a.y, s.b.y));
      const hi = lv ? Math.min(Math.max(r.a.x, r.b.x), Math.max(s.a.x, s.b.x)) : Math.min(Math.max(r.a.y, r.b.y), Math.max(s.a.y, s.b.y));
      return gap < d && hi - lo > 1;
    };
    const changed = [];
    const nearChanged = (A0, B0, v, half) => { const mine = RTm.runs(A0, B0, v); return changed.some(c => c.runs.some(s => mine.some(r => along(r, s, half + c.half + 1)))); };
    const routes = new Map();
    all.forEach(o => {
      const prev = cache.v.get(o.key);
      let v = o.kept, A0 = o.A, B0 = o.B;
      if (!v) {
        const same1 = prev && cache.sig.get(o.key) === sig(o);
        // A route that was shaped by hand isn't one found here: undone or reset, it routes afresh (it
        // kept its shape until something moved, before 2026-11-11).
        const pc = prev && !prev.kept && o.combos.find(c => c.A.side === prev.a && c.B.side === prev.b);
        if (pc && (same || (same1 && (o0.fast || (!crosses(pc.A, pc.B, prev.v, o.half) && !nearChanged(pc.A, pc.B, prev.v, o.half)))))) { v = prev.v; A0 = pc.A; B0 = pc.B; }
        else {
          const m = o.half + 8, blocks = o.behind ? [] : rects.map(r => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m }));
          let best = null;
          o.combos.forEach(c => {
            let cv = RTm.auto(G, c.A, c.B, blocks, o.stub, 2 * o.r);
            if (!cv || !RTm.fits(c.A, c.B, cv, o.stub)) cv = null;
            if (cv && (!best || cv.cost < best.v.cost - 0.5)) best = { v: cv, c };
          });
          if (best) { v = best.v; A0 = best.c.A; B0 = best.c.B; }
          else v = RTm.fits(A0, B0, [], o.stub) ? [] : [A0.x + A0.out * o.stub];
        }
      }
      if (!prev || prev.v.join(',') !== v.join(',') || prev.a !== A0.side || prev.b !== B0.side) changed.push({ half: o.half, runs: RTm.runs(A0, B0, v) });
      RTm.occupy(G, A0, B0, v, o.half + 6);
      if (o0.onRoute) o0.onRoute(A0, B0);
      routes.set(o.key, { key: o.key, A: A0, B: B0, v, half: o.half, stub: o.stub, r: o.r, kept: !!o.kept, behind: o.behind });
    });
    const next = { whole, v: new Map(), sig: new Map() };
    all.forEach(o => { const R0 = routes.get(o.key); next.v.set(o.key, { v: R0.v, a: R0.A.side, b: R0.B.side, kept: R0.kept }); next.sig.set(o.key, sig(o)); });
    routeCache.set(docKey, next);
    return { routes, G, rects };
  }

  // A route's drawing: route.js shape, from A.from (a lead-in before the terminal, such as a system
  // connector's exit inside its board) to B.to.
  function draw(R0) { return RT().shape(R0.A, R0.B, R0.v, R0.r, R0.half + 4); }
  const pathD = pts => 'M' + pts.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('L');

  // ── Shaping ──
  // The run of a route nearest p: route.js nearestRun with its route, { route, j, k, axis, d, at }.
  function runAt(R0, p) { const n = RT().nearestRun(R0.A, R0.B, R0.v, p); return n ? Object.assign({ route: R0 }, n) : null; }
  // The run of a route under a run handle (run index j).
  function runOf(R0, j) { const R = RT().runs(R0.A, R0.B, R0.v)[j]; return R ? { route: R0, j, k: R.k, axis: R.axis, at: { x: (R.a.x + R.b.x) / 2, y: (R.a.y + R.b.y) / 2 }, d: 0 } : null; }
  // The middle runs a selected route shows handles on, with their run index j.
  function handles(R0) { return RT().runs(R0.A, R0.B, R0.v).filter(r => r.k >= 0 && Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y) > 0.5); }
  // A drag's start on run (from runAt or runOf): the shape it drags and which of its values (k) moves,
  // on which axis. snap rounds a value to the grid. null: nothing to drag there.
  // Chris, 2026-11-11: a drag moves the whole straight run under the pointer; Ctrl-drag (brk) breaks it
  // where it's grabbed and drags the piece from there.
  // - A middle run moves as it is; broken, it gets a bend at the grab and the piece past it drags.
  // - An end run belongs to its part, so it bends a stub out from the part (the route's stub, or its
  //   terminal's own when that's longer, as a system connector's inside its board) and everything past
  //   that drags; broken, it bends at the grab instead (at least a stub out).
  // - A straight route (no middle runs) lifts everything between its two stubs; broken, the piece from
  //   the grab to the far end's stub. Either way a vertical run stays either side of the level one.
  function grab(run, snap, brk) {
    const R0 = run.route, RTm = RT();
    let v = R0.v.slice(), k = run.k;
    const sn = x => (snap ? snap(x) : x);
    if (k >= 0) {
      if (!brk) return { v0: v, k, axis: k % 2 ? 'h' : 'v' };
      const at = run.axis === 'h' ? { x: sn(run.at.x), y: run.at.y } : { x: run.at.x, y: sn(run.at.y) };
      const nb = RTm.addBend(R0.A, R0.B, v, run.j, at);
      if (!nb) return null;
      return { v0: nb.v, k: nb.k, axis: nb.k % 2 ? 'h' : 'v' };
    }
    const stA = Math.max(R0.stub, R0.A.stub || 0), stB = Math.max(R0.stub, R0.B.stub || 0);
    const xa = R0.A.x + R0.A.out * stA, xb = R0.B.x - R0.B.in * stB;
    const at = Object.assign({}, run.at);
    if (run.j === 0) at.x = R0.A.out > 0 ? Math.max(at.x, xa) : Math.min(at.x, xa);
    else at.x = R0.B.in > 0 ? Math.min(at.x, xb) : Math.max(at.x, xb);
    if (!v.length) {
      // (Before 2026-11-11 the harness added a bend here, which left a straight wire's shape with an
      // even count of values: drawn wrong, and never fitting its ends.)
      if (!brk) v = [xa, R0.A.y, xb];
      else { const x = sn(at.x); v = Math.abs(xb - at.x) >= Math.abs(at.x - xa) ? [x, R0.A.y, xb] : [xa, R0.A.y, x]; }
      k = 1;
    } else {
      const nb = RTm.addBend(R0.A, R0.B, v, run.j, brk ? { x: sn(at.x), y: at.y } : { x: run.j === 0 ? xa : xb, y: at.y });
      if (!nb) return null;
      v = nb.v; k = nb.k;
    }
    return { v0: v, k, axis: k % 2 ? 'h' : 'v' };
  }
  // The shape while dragging: the grabbed value moved by the pointer's travel (p0 to p), snapped.
  function slide(st, p0, p, snap) {
    const v = st.v0.slice();
    const val = st.v0[st.k] + (st.axis === 'v' ? p.x - p0.x : p.y - p0.y);
    v[st.k] = snap ? snap(val) : val;
    return v;
  }
  // Let go: a run dragged flush with its neighbor merges into it (route.js tidy). The record to keep,
  // with the sides the route was shaped on and its mode.
  function release(R0, v, rec) { return Object.assign({}, rec, { v: RT().tidy(R0.A, R0.B, v), a: R0.A.side, b: R0.B.side }); }
  // A double-click on a run: a bend where it was clicked (an end run's, at least a stub out from its
  // part), on the grid, as the record to keep (null: none there).
  function bend(run, snap, rec) {
    const R0 = run.route, at = Object.assign({}, run.at), st = Math.max(R0.stub, (run.j === 0 ? R0.A.stub : R0.B.stub) || 0);
    if (run.j === 0) at.x = R0.A.out > 0 ? Math.max(at.x, R0.A.x + st) : Math.min(at.x, R0.A.x - st);
    if (run.k < 0 && run.j > 0) at.x = R0.B.in > 0 ? Math.min(at.x, R0.B.x - st) : Math.max(at.x, R0.B.x + st);
    if (snap) { at.x = snap(at.x); at.y = snap(at.y); }
    const nb = RT().addBend(R0.A, R0.B, R0.v, run.j, at);
    return nb ? Object.assign({}, rec, { v: nb.v, a: R0.A.side, b: R0.B.side }) : null;
  }
  // The right-click menu's route items for a stored record (Chris, 2026-11-10): how the route treats the
  // parts in its way, walking round them or running straight past behind them, and Reset route once
  // shaped. Buttons with data-ctx around, behind, and reset-route, then a rule.
  function menuHtml(rec) {
    const behind = !!(rec && rec.mode === 'behind');
    return `<button data-ctx="around" role="menuitemradio" aria-checked="${!behind}"><span>${behind ? '' : '✓ '}Walk around parts</span></button>` +
      `<button data-ctx="behind" role="menuitemradio" aria-checked="${behind}"><span>${behind ? '✓ ' : ''}Go behind parts</span></button>` +
      (rec && (rec.v || rec.split0 || rec.split1) ? `<button data-ctx="reset-route" role="menuitem"><span>Reset route</span></button>` : '') + '<hr>';
  }
  // A menu item (around, behind, or reset-route) applied to a record: the new record, or null when
  // nothing is left to keep.
  function apply(rec, k) {
    const r = Object.assign({}, rec);
    if (k === 'behind') r.mode = 'behind';
    else if (k === 'around') delete r.mode;
    else if (k === 'reset-route') { delete r.v; delete r.a; delete r.b; delete r.split0; delete r.split1; }
    return r.v || r.mode || r.split0 || r.split1 ? r : null;
  }
  // A stored record as given (a bare v, from before records, becomes { v }).
  const record = x => (Array.isArray(x) ? { v: x } : x && typeof x === 'object' ? x : null);

  LM.connect = { routeAll, draw, pathD, runAt, runOf, handles, grab, slide, release, bend, menuHtml, apply, record };
})(window.LM = window.LM || {});
