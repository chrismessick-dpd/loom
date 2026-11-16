# Status statistics for systems

2026-11-15, Chris: a status section at the top of a system, with counts and a pie, to see what's left. What it
answers:
- which used connectors have nothing plugged in;
- which cables are still generic;
- which harnesses are wired but have no lengths;
- which harnesses are complete.

The statuses double as filter tags, so a question like "which boards still have only generic cables" is one click.
This is the concept of "defined, then complete", not any outside tool's states.

Chris's choices (2026-11-15) are the recommended answers below: the ladder, lengths on every leg, the whole system
rolled up, and boards taking their worst status.

## The ladder

Every *spot* gets one status, from least to most finished. A spot is a used connector with nothing in it, or a
system cable.

| Status | Glyph | What it means |
| --- | --- | --- |
| Open | ○ | A used, populated connector with no cable plugged in, here or from a system placing this one. |
| Generic | ─ | A generic connection: something joins these connectors, nothing more is said. |
| Placeholder | ◌ | A Loom harness with no wires yet, a missing harness, or a purchased cable without a part number or length. |
| Needs fixing | ✕ | A harness with wires and check errors. |
| Wired | ◉ | Wires drawn, no check errors, but some wire's length unknown. This is "defined". |
| Complete | ✔ | Wired, no check errors, and every wire's length known. A purchased cable is complete with a part number and a length. |

What counts as length (Chris, every leg):
- A harness is complete when `M.analyze` knows every wire's length, which means no segment on its path is unset.
- Formboard's Apply lengths writes those segments, so a routed formboard completes harnesses.
- A per-system length (`cab.lengthMm`, the `<PN>-<mm>` variant) also counts when the harness is one run between two
  ends.

The worst-first order, used for roll-ups: Open, Generic, Placeholder, Needs fixing, Wired, Complete.

`statusOf` stays as it is for the drawing (glyphs, colors, Purchased). A new `stateOf(cab, h)` gives the ladder key
beside it, and `openSpots(s)` lists the Open connectors.

## Counting (Chris, the whole system)

- The counts cover the system drawn and everything placed in it, through `flatten` or the tree.
- Each cable is counted once, by its system and id, even where a placed system appears twice. This is a to-do
  list, not a BOM.
- An Open connector is counted once, by system, block, and connector.
- An external connector counts as Open only where it's used and nothing plugs into it from any placing system.

## The section at the top

- **Where:** in the toolbar row beside the breadcrumb (the empty space today), on the System, List, and Formboard
  tabs.
- **The strip:** a small donut (about 28 px) and the counts as chips, such as "○ 12 Open · ─ 30 Generic · ◌ 21
  Placeholder · ◉ 8 Wired · ✔ 5 Complete". Chips with no count are left out.
- **The panel:** a click on the strip opens a larger pie with a legend (count and percent per status) and a line on
  how the ladder works.
- **From the legend:** a click on a status includes it in the filter. Shift-click excludes it.
- **Colorblind (Chris):** slices never differ by hue alone. Each has its glyph in the legend and on the slice when
  it's big enough, and the less finished statuses use the suite's hatch and dot patterns. Complete is solid accent,
  Generic and Placeholder are grays, and Needs fixing uses `--issue` with `--issue-hatch`.

## Statuses as tags

- **In the filter:** the menu gets a Status section above Tags, one row per status with Include and Exclude, the
  same as tags.
- **Cables:** a cable matches by its own status.
- **Boards (Chris, the worst wins):**
  - A block's status is the least finished of its plugged cables and its Open connectors.
  - A small pill (glyph and word) shows it on the block's label in the drawing and in its List row.
  - Filtering by a status lights every block with at least one cable or connector in it.
  - So "Include Generic" lights the boards that still have generic cables.
  - A placed system lights when something inside it matches, as the filter does now.
- **List:** cable rows keep their Status column, with the ladder's words. Block and connector rows get the rolled-up
  status.

## Build steps

1. `stateOf`, `openSpots`, and the roll-up (`systemStats(rootId)` giving counts, the spots behind each, and each
   block's worst), with tests on made-up systems: each status, nesting, a system placed twice, and external
   connectors.
2. The strip and the pie panel in the toolbar, drawn from `systemStats`, with legend clicks setting the filter.
3. Status in the filter (`f.states`) and in `filterMatch` and `filterFlat`, then board pills on the drawing and in
   List.
4. A read-only check on real data: the counts, and spot-checks of a few boards from each status.

## Open questions

- Should a purchased cable without a length be Placeholder, or Complete once it has a part number? Plan: Placeholder.
- Should Open include connectors marked used but not populated? Plan: no, only populated ones.
- Should Formboard's routed lengths count before Apply lengths writes them? Plan: no, only stored lengths.

## Built (2026-11-15)

Steps 1 to 3 are built, in `assets/system.js` unless noted.

- **The model:** `STATES`, `stateOf(cab, h)`, `isOpen`, `blockCables`, and `systemStats(rootId)`. It returns
  `counts`, `total`, `spots`, `blockState(s, b)` (the worst), `statesIn(s, b)` (all the states at a block), and
  `stateOf`. `statsNow()` keeps it for one redraw.
- **The strip:** `#sys-stats` in `index.html`, beside the breadcrumb, drawn by `statsStrip()` from `app.js` and
  Formboard. It shows a 24 px donut, a chip per status, and the percent complete. Its panel has a 150 px patterned
  donut and the legend, whose rows include a status in the filter (Shift-click excludes, a second click clears).
- **The filter:** a Status section (`f.states`) above Tags. A block lights on an included status any of its spots
  has, or anything inside a placed system has.
- **Board pills:** at a block's bottom right (its name sits top left), sized with the block.
- **List:** cable rows show the ladder's status, block rows the rolled-up status, and connector rows Open.
- **Tests:** *status statistics*, which covers Open through two levels, the worst, a system placed twice, and the
  filter.

Step 4 (a read-only check on real data) is next.
