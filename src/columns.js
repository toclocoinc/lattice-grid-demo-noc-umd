/**
 * What each table holds, what each tile measures, and the glyphs the topology
 * draws its devices with.
 *
 * Every column declares its width, so no heading is ever cut short by whatever
 * width its window happens to be, and every column carrying a number names its
 * unit in the heading rather than leaving a reader to guess.
 */
(function (root) {
  'use strict';

  const { STATUS } = root.NocSimulator;

  /** The four glyphs the core topology uses, registered on the core table. */
  const ICONS = {
    globe: {
      viewBox: '0 0 24 24',
      paths: [
        'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
        'M3 12h18',
        'M12 3c2.5 2.5 3.8 5.6 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3z',
      ],
      paint: 'stroke',
    },
    cloud: { viewBox: '0 0 24 24', paths: ['M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18z'], paint: 'stroke' },
    router: { viewBox: '0 0 24 24', paths: ['M3 13h18v6H3z', 'M6 16h.01', 'M9 16h.01', 'M12 4v6', 'M8 7l4-3 4 3'], paint: 'stroke' },
    edge: { viewBox: '0 0 24 24', paths: ['M4 5h16v5H4z', 'M4 14h16v5H4z', 'M7 7.5h.01', 'M7 16.5h.01'], paint: 'stroke' },
  };

  const number = (decimals) => ({ type: 'number', decimals });

  const COLUMNS = {
    /* The map's own table. It is never drawn: the map is its viewer. */
    sites: [
      { id: 'name', field: 'name', title: 'Site', layout: { width: 220 } },
      { id: 'city', field: 'city', title: 'City', layout: { width: 120 } },
      { id: 'country', field: 'country', title: 'Country', layout: { width: 80 } },
      { id: 'lat', field: 'lat', title: 'Latitude', type: 'number', format: number(3), layout: { width: 90 } },
      { id: 'lon', field: 'lon', title: 'Longitude', type: 'number', format: number(3), layout: { width: 90 } },
      { id: 'stateLabel', field: 'stateLabel', title: 'State', layout: { width: 110 } },
      { id: 'availability', field: 'availability', title: 'Availability, %', type: 'number', format: number(3), layout: { width: 120 } },
      { id: 'elements', field: 'elements', title: 'Network elements', type: 'number', layout: { width: 130 } },
      { id: 'networks', field: 'networks', title: 'Networks present', type: 'number', layout: { width: 130 } },
      { id: 'alarms', field: 'alarms', title: 'Live alarms', type: 'number', layout: { width: 100 } },
    ],
    alarms: [
      { id: 'at', field: 'at', title: 'Raised, UTC', type: 'datetime', layout: { width: 96 },
        format: { type: 'date', pattern: 'HH:mm:ss', timeZone: 'UTC' } },
      { id: 'severityLabel', field: 'severityLabel', title: 'Severity', layout: { width: 92 }, cell: { render: 'pill' } },
      { id: 'sourceShort', field: 'sourceShort', title: 'Source', layout: { width: 64 } },
      { id: 'site', field: 'site', title: 'Site', layout: { width: 150 } },
      { id: 'vantage', field: 'vantage', title: 'Observed at', layout: { width: 134 } },
      { id: 'description', field: 'description', title: 'What happened', layout: { width: 262 } },
      { id: 'impact', field: 'impact', title: 'Impact', layout: { width: 200 } },
      { id: 'status', field: 'status', title: 'Status', layout: { width: 76 } },
    ],
    services: [
      { id: 'name', field: 'name', title: 'Service', layout: { width: 148 } },
      { id: 'status', field: 'status', title: 'State', layout: { width: 102 }, cell: { render: 'pill' } },
      { id: 'availability', field: 'availability', title: 'Availability, %', type: 'number', format: number(3), layout: { width: 112 } },
      { id: 'spark', field: 'spark', title: 'Last 7 days, %', layout: { width: 96 }, cell: { render: 'line' } },
    ],
    /* The traffic chart's own table, and the core topology's. */
    traffic: [
      { id: 'at', field: 'at', title: 'Time, UTC', type: 'datetime', layout: { width: 120 } },
      { id: 'direction', field: 'direction', title: 'Direction', layout: { width: 100 } },
      { id: 'gbps', field: 'gbps', title: 'Gbit/s', type: 'number', format: number(2), layout: { width: 90 } },
    ],
    core: [
      { id: 'from', field: 'from', title: 'From', layout: { width: 160 } },
      { id: 'to', field: 'to', title: 'To', layout: { width: 160 } },
      { id: 'load', field: 'load', title: 'Load, %', type: 'number', format: number(1), layout: { width: 90 } },
    ],
    chips: [
      { id: 'label', field: 'label', title: 'Severity', layout: { width: 100 } },
      { id: 'count', field: 'count', title: 'Alarms', type: 'number', layout: { width: 80 } },
    ],
  };

  /**
   * The tiles on the top strip: one per measurement, plus the clock.
   *
   * Each one sums the value of the single metric row it names, which is how a
   * KPI panel reads a figure that arrives through a router. The status tile
   * takes its cut points from the same constant the badge beside it reads.
   *
   * @param {object} world the world, for the figures that name a total
   * @returns {object[]} the tile specs
   */
  function tiles(world) {
    const of = (id, label, extra) => Object.assign({
      id, label, aggregation: 'sum', field: 'value',
      filter: (row) => row.id === `metric-${id}`,
      format: number(0),
    }, extra || {});
    return [
      of('availability', 'Availability, %', { format: number(3), baseline: 99.8,
        thresholds: { warn: 99.8, critical: 99.5, direction: 'higherIsBetter' } }),
      of('critical', 'Critical alarms', {
        thresholds: { warn: STATUS.warnAt, critical: STATUS.criticalAt, direction: 'lowerIsBetter' } }),
      of('incidents', 'Active incidents', { thresholds: { warn: 10, critical: 40, direction: 'lowerIsBetter' } }),
      of('servicesDegraded', 'Degraded services, of 7', {
        thresholds: { warn: 1, critical: 3, direction: 'lowerIsBetter' } }),
      of('sitesOnline', `Sites operational, of ${world.sites.size}`, { baseline: Math.round(world.sites.size * 0.9) }),
      of('elements', 'Network elements', { format: { type: 'number', notation: 'compact', decimals: 1 } }),
      of('updates', 'BGP updates per minute', { format: { type: 'number', notation: 'compact', decimals: 1 } }),
      { kind: 'clock', label: 'UTC', timeZone: 'UTC', locale: 'en-GB' },
    ];
  }

  root.NocColumns = { COLUMNS, ICONS, tiles };
})(window);
