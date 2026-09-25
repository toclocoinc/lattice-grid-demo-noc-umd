# A network operations centre

A rearrangeable operations wall for a backbone carrier: a map of sites by
SLA, the core topology, active alarms, service health, KPI tiles, traffic
and utilisation charts, an incident trend, a site-status breakdown, the
sites most affected right now, and a ticker of the latest events. Every
window is a viewer of one arriving feed, so narrowing one moves the rest
with it, and every window can be dragged, resized, maximised or collapsed.

**[See it running](https://toclocoinc.github.io/lattice-grid-demo-noc-umd/)**

| | |
| --- | --- |
| Grid on npm | [@toclocoinc/lattice-grid](https://www.npmjs.com/package/@toclocoinc/lattice-grid) |
| Grid repository | [toclocoinc/latticegrid](https://github.com/toclocoinc/latticegrid) |
| Product site | [latticegrid.dev](https://www.latticegrid.dev) |

## What it shows

**A map of sites by SLA.** Every site plotted on a world map, coloured by
whether its measured availability is within SLA, at risk, or has breached
it.

**Core topology.** The backbone drawn as a diagram: routers, clouds, the
internet edge and regional sites as device glyphs, joined by circuits
coloured by how loaded each one is.

**Active alarms.** A live list of the alarms currently open, by severity,
country and description.

**Service health.** The seven services the carrier offers, each graded by
its own availability, with alarms raised automatically by the alarms module
when a service holds below its SLA threshold.

**KPI tiles.** Mean availability, active incidents, services not
operational, site count, circuits over 80% load and sites carrying an
active alarm, each one a live figure bound to the same feed as the grids
below it.

**Traffic over 24 hours**, in and out, as a line chart; **the five busiest
links** by load, as a bar chart; **a per-minute incident trend**, stacked by
severity; **sites by status**, as a donut with its own legend; and **the
five sites currently carrying the most active alarms**.

**The alarm ticker** across the bottom, newest first, combining feed alarms
and service alarms in one line each.

Every one of those is a separate viewer of the same data router: one feed
in, many panels reading it, nothing counted twice.

## How it loads

`data.js` runs in one of three modes, chosen when the page creates it:

- **`snapshot` (the default here).** No network. The recorded feed is
  replayed through the grid's own mock socket, with no live connection
  required. Each replayed alarm is stamped with the moment it is replayed,
  not the moment it was originally recorded, so the wall fills as you watch
  it rather than landing everything on the two minutes the recording
  covers; the original recorded time travels alongside as
  `recordedTimestamp` for anyone who wants it.
- **`live`.** The page opens a WebSocket straight to
  [RIPE RIS Live](https://ris-live.ripe.net/) for real routing updates, and
  reads [IODA](https://ioda.inetintel.cc.gatech.edu/) and
  [PeeringDB](https://www.peeringdb.com/) from the browser for outage
  detections and the site footprint. If any of those cannot be reached, the
  page falls back to the recorded copy for that part and says so.
- **`simulated`.** No network and no recording either: a footprint and a
  stream of routing events are invented on the spot, so the wall moves with
  nothing behind it at all.

## Run it locally

Any static file server will do, for example:

```
npx serve .
```

or Python's built-in server:

```
python3 -m http.server
```

Open the page it prints. No licence key is needed on localhost; a key is
only required once the page is published on a real address, which is why
one appears in `index.html` for this demo's own published address.

## Licence

The code in this repository is available under the MIT licence. See
[LICENSE](LICENSE).

Lattice Grid itself is a separate commercial product with its own terms. It
is free to use on localhost, with no key and no watermark, so a copy of
this repository runs unrestricted on your own machine. This demo carries a
key for its own published address only, which is why you will find one in
the source. Keys for your own sites come from
[latticegrid.dev](https://www.latticegrid.dev).

This demo is built on Lattice Grid 1.71.1.
