# The part library

Chris, 2026-11-14: Loom keeps a library of the parts a harness ends on, such as a motor, a sensor, or a switch. Each
part has its pinout, and Add › Device places one on the drawing.

## What a part is

One file per part in Loom's private data repo, `loom_data/parts/<id>.json`:

```json
{ "schema": 1, "id": "…", "part": {
  "id": "…", "kind": "device", "name": "…", "maker": "…", "mpn": "…", "mate": "", "notes": "…",
  "pins": [{ "id": "1", "label": "GND", "color": "BK", "gauge": "24" }],
  "source": { "cablematic": "…" }, "updated": 0, "updatedBy": "…" } }
```

- **kind.** `device` has leads, so it's placed as a Flying leads end. `connector` has a connector on the device
  that the harness mates to, so it's placed as the mating housing: `mate` is that housing's part number, and its
  family is guessed from it (`housingFamily`).
- **pins.** Each pin has its id, its net name (`label`), and its lead's color (an IEC code, as wires use) and gauge
  in AWG, where known. On a connector part, colors and gauges describe the device's own leads behind its connector,
  so they don't color the harness.
- **The stamp** (`updated`, `updatedBy`) tells a placed copy whether the library has moved on.
- **source** says where the part came from, for a sync that keeps it up to date.

The library is read only in Loom, read at each sync (after systems) and kept in this browser's localStorage
(`parts`, by blob sha, so an unchanged part isn't read again). A token that can't open the data repo (a
contractor) keeps what it had. There's no part editor in Loom yet. The Queue project's parts come from the client's
far-end library through the queue-sync-in skill, which writes new and changed parts.

## Placing a device

Add has two new buttons:

- **Flying leads.** Loose leads with no connector, two to start.
- **Device.** Opens the part library: a search over name, maker, part number, and net names, with devices with
  leads first, then devices with a connector. Each row shows the pins, lead colors, and gauges.

Add places a **linked copy** (`LM.parts.apply`). The end takes:

- the part's pins (`n.pinNames`), net names (`n.pinLabels`), and lead colors and gauges (`n.leads`, devices only);
- its name, and its maker and part number (`n.mate`), or for a connector part the housing (`n.mpn`);
- *Is its device* (`n.atDevice`), so a system never plugs it into anything;
- the link, `n.part`: `{ id, name, stamp }`.

The end draws and syncs from the harness file alone, so Signoff PL and a browser without the library still show
it. A wire run to a linked pin takes that lead's color and gauge.

## A linked end's Properties

The connector's Properties shows *From the part library*, with:

- **Refresh from library** when the library has a newer version. It lists what changes (pins, net names, lead
  colors or gauges, name, type, part numbers) and applies it as one undoable change. Ref, position, face, and the
  wires stay.
- **Match wires to leads** when wires on its pins differ from the part's leads (`LM.parts.mismatches`). Linking
  never changes wires on its own.
- **Unlink.** Drops `n.part` and `n.leads` and keeps the pins and names.

## The demo

`?demo` has four made-up Acme Climate parts (`DEMO_PARTS`): a damper actuator, a duct sensor, a blower fan, and
a humidity module with a JST PH header. No real part data goes in this repo.
