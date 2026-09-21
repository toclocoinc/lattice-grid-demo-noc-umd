# A network operations centre, on live internet data

A rearrangeable operations wall for a backbone carrier: a global site map, a
core topology, a live alarm list, service health, traffic, link utilisation, an
incident trend, a site-status donut, a customer impact table and a ticker, with
a strip of counters and two clocks across the top.

Every panel is a window you can drag, resize, blow up to fill the wall or
collapse to its title bar, and the arrangement is remembered in your browser.

Built on Lattice Grid loaded by `<script>` tag: no npm install, no bundler, no
build step, no `type="module"`.

| | |
| --- | --- |
| Grid on npm | [@toclocoinc/lattice-grid](https://www.npmjs.com/package/@toclocoinc/lattice-grid) |
| Grid repository | [toclocoinc/latticegrid](https://github.com/toclocoinc/latticegrid) |
| Product site | [latticegrid.dev](https://www.latticegrid.dev) |

## What on this wall is real, and what is not

This is the part worth reading, and it is the reason the page says it on screen
as well as here. A network operations wall is a picture of a network. Most of
the ones in a product demonstration are a picture of nothing at all: a random
walk with red dots on it. This one is part real and part invented, and the
difference is never blurred.

**Live.** Every alarm beginning "BGP" is a routing event that happened. The
page opens a WebSocket to
[RIPE RIS Live](https://ris-live.ripe.net/) and subscribes to BGP updates whose
AS path contains the backbone it follows. A withdrawal raises an alarm; the
same peer announcing the prefix again at the same collector clears it. The
update rate on the top strip is the rate those messages are arriving at. Over
ten minutes on the machine this was built on, that was **80,511 messages, 8,050
a minute**, across **23 collectors**, of which **1,725 were withdrawals**.

**Recorded.** The site list is a real backbone's real facility list: **275
buildings in 32 countries**, with the coordinates PeeringDB publishes for each
one (**272** of them carry coordinates; the three that do not are counted, not
guessed at). Beside it are seven days of real BGP update activity, seven days
of real internet outage detections country by country, and measured round trip
times between ten pairs of RIPE Atlas anchors. All of it is rebuilt nightly by
`tools/build-snapshot.mjs` and committed to `data/snapshot/`.

**Derived.** Site states, service availability, customer impact, the counters
on the top strip and the words on the status badge are arithmetic over those.
Each panel states its own rule in the caption under its title. For example: a
site is marked degraded when the country it is in has an outage detected by
IODA, or when a live alarm has been raised at the collector it sits beside.

**Simulated.** The traffic curve, link utilisation and capacity, the core
topology, the customer list and each site's own availability percentage are
invented by a seeded generator in `src/noc-model.js`. Nothing invented is ever
presented as an event that happened, and the same page always shows the same
invented numbers.

**The operator is invented.** The footprint and the routing events belong to
one real backbone carrier: its facility list is public in PeeringDB and its
routes are public in RIPE RIS. The operational figures drawn around them are
not that carrier's. Naming it would be asserting things about a real company
that are not true, so the carrier is left unnamed and the wall is branded as a
fictional operator. The autonomous system number the feed is subscribed to is
in `tools/carrier.mjs`, because a build tool that cannot say what it fetched is
not reproducible.

## A note on the data, up front

Everything the page reads sends a cross-origin header, so the browser can read
it directly. That is unusual and worth saying: five public services, no key
between them, no proxy in the middle.

| Source | What it gives | Read by |
| --- | --- | --- |
| [PeeringDB](https://www.peeringdb.com/) | The facility list, city, country and coordinates | the nightly build |
| [RIPE RIS Live](https://ris-live.ripe.net/) | Live BGP announcements and withdrawals | the page, as you watch |
| [RIPEstat](https://stat.ripe.net/) | Announced prefixes, neighbours, collector list, update activity | the nightly build |
| [IODA](https://ioda.inetintel.cc.gatech.edu/) | Detected internet outages by country | the nightly build |
| [RIPE Atlas](https://atlas.ripe.net/) | Measured round trip times between anchors | the nightly build |
| [Natural Earth](https://www.naturalearthdata.com/) | The country outlines under the map | the nightly build |

The three that are read nightly rather than per page load are read nightly on
purpose. PeeringDB rate-limits, politely and reasonably. A RIPEstat BGP update
history for one AS over a day is about thirty megabytes. One RIPE Atlas
anchoring mesh measurement answers with every probe that pinged the anchor,
which for a day is about fourteen megabytes; one probe at a time, which is what
a link means here, is about 170KB, and what ends up in `data/` is twenty five
hourly medians per pair.

Credits, in the terms each service asks for, are at the foot of the page and in
`src/noc-sources.js`.

### Offline

Load the page with `?live=0` and the routing feed is the recording in
`data/ris-capture.json` instead of the live socket. The recording is ten real
minutes of RIPE RIS Live: every withdrawal in full, every announcement that
brought a withdrawn prefix back at the same vantage point, one announcement in
fifty of the rest as a sample, and the true announcement count per second so
the rate the page reports is the rate that happened rather than the rate of the
sample. That projection is written into the file's own header.

The swap is one line, because the grid's `MockWebSocket` presents the same
surface a browser `WebSocket` does and the recording is replayed in the same
message shape RIS Live sends:

```js
const socket = live
  ? new WebSocket('wss://ris-live.ripe.net/v1/ws/?client=lattice-noc-demo')
  : new MockWebSocket({ feed: replay(capture), rate });
```

The handler that reads `event.data` is the same code either way, which is the
point: the page has one path to get wrong instead of two. The banner at the top
right says which one is in force.

## How the grid gets onto the page

Eight tags in `index.html`, and that is the whole of the library setup:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/lattice-grid.min.css">

<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/lattice-grid.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/charts.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/chart-markermap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/data-router.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/kpi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/layout.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/mock-socket.min.js"></script>
```

Each file is the package's UMD build and leaves a global behind:

| File | Global | Used here for |
| --- | --- | --- |
| `lattice-grid.min.js` | `LatticeGrid` | every table on the wall |
| `modules/charts.min.js` | `LatticeGrid.createChart` | the traffic area, the stacked trend, the donut, the core topology |
| `modules/chart-markermap.min.js` | registers `markermap` | the site map |
| `modules/data-router.min.js` | `LatticeGridDataRouter` | one stream to ten viewers |
| `modules/kpi.min.js` | `LatticeGridKPI` | the top strip, including its two clocks |
| `modules/layout.min.js` | `LatticeGridLayout` | the windows you can drag |
| `modules/mock-socket.min.js` | `LatticeGridMockSocket` | the offline routing feed |

Every address names the exact release and carries the hash of the file it
expects, so the page can never quietly pick up a different build than the one it
was checked against. The order matters twice: the charts module folds itself
into the core global rather than defining its own, and the marker map registers
a chart type with the charts module.

The country outlines are the exception, and the reason is worth stating. The
grid ships them as `modules/geo-world-110m`, which is published as an ES module
only, with no UMD build beside it. A page that loads its library with
`<script src>` cannot load one. So the nightly build reads the pack out of the
pinned release and writes it to `data/snapshot/shapes.json`, and the page
fetches that one file and hands it to the chart as `shapes`. It is the pack,
unaltered: Natural Earth 1:110m, public domain, from `world-atlas@2.0.2`.

## How the page is put together

```
one snapshot + one routing socket
        |
   createDataRouter({ key: 'kind', rowKey: 'id', overlap: true })
        |
  site     -> the map, and the donut's counts
  alarm    -> the alarm table, the ticker, the incident tiles
  service  -> the service health table
  link     -> the link utilisation table
  customer -> the customer table
  sample   -> the traffic chart
  trend    -> the incident trend chart
  element  -> the core topology
  metric   -> the tiles on the top strip
  chip     -> the severity chips
```

Ten viewers, one router, one row shape per viewer. `overlap: true` because
several partitions feed more than one viewer, and with the default only the
first route on a value receives anything.

Two things narrow the alarm table, and they are the same mechanism. Clicking a
marker on the map selects that site, and `router.link(sitesGrid, alarmsGrid,
{ from: 'id', to: 'siteId' })` narrows the alarms to that site. Choosing a
severity chip selects a row in a small grid of four, and a second `link` with a
predicate narrows the alarms to that severity.

### Where an alarm is placed, and where it is not

A BGP event is observed at a RIS collector, and a collector sits in a city. When
the backbone has a building in that city, the alarm is shown against it, because
that is the place the observation is about. **It is not a claim that anything is
broken in that building**, and the caption under the alarm table says so. The
collector is named in its own column, "Observed at".

### Colours

The map's marker colours and the topology's link colours both come from
conditional formatting rules on the underlying table, through
`grid.formatting`. There is no second place to say "red above eighty five", so
the map, the chart and the table cannot disagree, and the legend under each one
lists the rules that actually fired.

## Running it

Nothing to install.

```bash
node tools/serve.mjs          # serve it locally, on a port the OS picks
node tools/verify.mjs         # load it in a real browser and check it
node tools/verify.mjs --live  # the same, against the live routing feed
node tools/build-snapshot.mjs # rebuild data/snapshot from the five services
node tools/capture-ris.mjs    # record ten more minutes of the routing feed
```

`tools/verify.mjs` needs Node 22 (for its built-in `WebSocket`) and a Chrome or
Chromium on the machine. It asserts the things this demo exists to show: that
the library arrived by script tag; that there are ten windows and each one says
where its numbers come from; that a window can be moved, resized, maximised,
minimised and restored, and that the arrangement survives a reload; that the map
draws a marker for every site the saved copy places; that the topology draws
icon nodes and parallel links; that a routing withdrawal pushed in by hand
reaches the alarm table, the tiles, the ticker **and the colour of a marker on
the map**; and that at 400px wide the page does not scroll sideways.

Every figure it checks is recomputed in Node from the files in
`data/snapshot/`, so what it compares the page against is not the page.

## The files

```
index.html                  eight library tags, and six of the demo's own
styles.css                  the wall around the library's own dark theme
main.js                     read the saved copy, open the feed, draw
src/licence.js              the domain-bound demo licence key
src/noc-sources.js          the four classes of number, the credits, the panels
src/noc-data.js             read data/snapshot
src/noc-model.js            the world, and the rules that move it
src/noc-feed.js             the routing feed, live or recorded, behind one reader
src/dashboard.js            the layout, the ten viewers and the router
tools/carrier.mjs           which backbone, and what it is called here
tools/sources.mjs           every address this project reads
tools/build-snapshot.mjs    rebuild data/snapshot
tools/capture-ris.mjs       record the routing feed
tools/serve.mjs             a static file server
tools/verify.mjs            the browser check
data/snapshot/              the nightly copy, about 180KB in eight files
data/ris-capture.json       ten recorded minutes of RIPE RIS Live
```

## Licence

MIT, for this demo's own code. The data belongs to the services listed above,
under their own terms, which are quoted on the page.
