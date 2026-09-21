/**
 * The whole wall, wired.
 *
 * This is the file to read. One snapshot and one socket go in; six panels come
 * out, and nothing in between is bespoke. The grid's data router does the
 * work: it partitions one stream by what each record is, hands each partition
 * to its own viewer, and makes a selection in one viewer narrow another.
 *
 *   one snapshot + one routing socket
 *           |
 *      createDataRouter({ key: 'kind', rowKey: 'id', overlap: true })
 *           |
 *   site    -> the site table, whose viewer is the map
 *   alarm   -> the alarm table
 *   service -> the service health table
 *   sample  -> the traffic table, whose viewer is the area chart
 *   element -> the core table, whose viewer is the network chart
 *   metric  -> the tiles on the top strip
 *   chip    -> the four severity chips
 *
 * Three of those tables are never drawn. A chart in this library is a viewer
 * of a grid, so the grid is the model and the chart is the view, and the
 * router does not need to know which is which.
 */
(function (root) {
  'use strict';

  const { COLUMNS, ICONS, tiles } = root.NocColumns;
  const Simulator = root.NocSimulator;

  /** The settings every table on this wall shares. */
  const base = (title, extra) => Object.assign({
    rowKey: 'id', theme: 'dark', density: 'compact', stripedRows: false,
    columnMenu: false, statusBar: false, find: false, selection: 'none', title,
  }, extra);

  /** A container for a table the page never shows. The chart is its viewer. */
  const offstage = () => {
    const node = document.createElement('div');
    node.className = 'offstage';
    document.body.append(node);
    return node;
  };

  /**
   * Build every viewer, wire the router, and load the world into it.
   *
   * @param {object} options the factories, the saved copy and the panels
   * @returns {object} every piece, for the page and for the browser check
   */
  function wire(options) {
    const { createGrid, createChart, createKPI, createDataRouter, snapshot, panel } = options;
    const world = Simulator.build(snapshot);

    /* ---- the tables ---- */
    const sitesGrid = createGrid(offstage(), base('Sites', {
      columns: COLUMNS.sites,
      selection: { mode: 'multiple', checkbox: false, ranges: false, fillHandle: false },
    }));
    const alarmsGrid = createGrid(panel('alarms'), base('Active alarms and incidents', { columns: COLUMNS.alarms }));
    const servicesGrid = createGrid(panel('services'), base('Service health', { columns: COLUMNS.services }));
    const trafficGrid = createGrid(offstage(), base('Traffic samples', { columns: COLUMNS.traffic }));
    const coreGrid = createGrid(offstage(), base('Core links', { columns: COLUMNS.core, icons: ICONS }));
    const chipsGrid = createGrid(offstage(), base('Severity', {
      columns: COLUMNS.chips,
      selection: { mode: 'single', ranges: false, fillHandle: false },
    }));
    root.NocFormatting.apply({ sites: sitesGrid, alarms: alarmsGrid, services: servicesGrid, core: coreGrid });
    alarmsGrid.sort.set([{ col: 'at', dir: 'desc' }]);
    trafficGrid.sort.set([{ col: 'at', dir: 'asc' }]);

    /* ---- the charts, each a viewer of one of those tables ---- */
    const mapChart = createChart({
      grid: sitesGrid, container: panel('map'), type: 'markermap',
      lon: 'lon', lat: 'lat', label: 'name', value: 'stateLabel', shapes: snapshot.shapes,
      /* Two hundred and seventy five labels would be a wall of type; the
         tooltip carries the name, the state and the coordinates. */
      labels: false, selection: true, legend: true, tooltip: true,
    });
    const topologyChart = createChart({
      grid: coreGrid, container: panel('topology'), type: 'network',
      source: 'from', target: 'to', y: 'load', nodes: world.nodes, icon: 'router',
      legend: true, tooltip: true,
    });
    const trafficChart = createChart({
      grid: trafficGrid, container: panel('traffic'), type: 'area',
      x: 'at', y: 'gbps', series: 'direction',
      /* A day of five minute samples: the reader wants the hour, not the date. */
      axis: { y: 'Gbit/s', x: { title: 'Time, UTC', format: 'HH:mm' } },
      legend: true, tooltip: true,
    });
    const kpi = createKPI(panel('header'), {
      rowKey: 'id', rows: [], columns: 8, locale: 'en-GB', tiles: tiles(world),
    });

    /* ---- one router over one stream ---- */
    /*
     * `overlap: true` because two partitions feed more than one viewer, and
     * with the default a record stops at the first route it matches.
     */
    const router = createDataRouter({ key: 'kind', rowKey: 'id', overlap: true });
    router.attach(sitesGrid, 'site', { label: 'Sites' });
    router.attach(alarmsGrid, 'alarm', { label: 'Alarms' });
    router.attach(servicesGrid, 'service', { label: 'Services' });
    router.attach(trafficGrid, 'sample', { label: 'Traffic' });
    router.attach(coreGrid, 'element', { label: 'Core links' });
    router.attach(chipsGrid, 'chip', { label: 'Severity chips' });
    router.subscribe('metric', kpi, { label: 'Tiles' });

    /*
     * The two filters on this page are the same mechanism. Clicking a marker
     * selects that site, and the first link narrows the alarms to it; choosing
     * a severity chip selects a row in the four-row chip table, and the second
     * narrows the alarms to that severity. No page code filters anything.
     */
    router.link(sitesGrid, alarmsGrid, { from: 'id', to: 'siteId' });
    router.link(chipsGrid, alarmsGrid, (chosen) => {
      const wanted = new Set(chosen.map((row) => row.label));
      return wanted.size ? (row) => wanted.has(row.severityLabel) : () => true;
    });

    router.load(world.rows);

    return {
      world, router, kpi, mapChart, topologyChart, trafficChart,
      sitesGrid, alarmsGrid, servicesGrid, trafficGrid, coreGrid, chipsGrid,
      /** Push a batch of changed rows through the router. */
      push: (rows) => router.apply(rows.map((row) => ({ op: 'upsert', row }))),
      /** Take a batch of alarms off it. */
      drop: (ids) => router.apply(ids.map((id) => ({ op: 'delete', row: { kind: 'alarm', id } }))),
      destroy: () => router.destroy(),
    };
  }

  root.NocWiring = { wire, base };
})(window);
