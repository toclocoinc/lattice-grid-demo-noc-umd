/**
 * The colour rules, in one place, on the tables that own them.
 *
 * Nothing on this page names a colour twice. The map takes each marker's
 * colour from `grid.formatting.styleFor` on the site table's state column, and
 * the topology takes each link's colour from the same call on the core table's
 * load column, so a chart and its table cannot disagree and the legend under
 * each chart is the list of rules that actually fired.
 */
(function (root) {
  'use strict';

  const { STATES, SEVERITIES } = root.NocSimulator;

  /** Green, amber, red: what a load above this much is worth. */
  const LOAD_BANDS = [
    { at: 85, colour: '#d2453b', label: 'Over 85%' },
    { at: 65, colour: '#d99b1c', label: '65% to 85%' },
    { at: 0, colour: '#2f9e5e', label: 'Under 65%' },
  ];

  /**
   * Put every rule on every table.
   *
   * @param {object} grids the grids, by the name the wiring gives them
   * @returns {void}
   */
  function apply(grids) {
    /* One rule per site state. The map reads these and nothing else. */
    for (const state of STATES) {
      grids.sites.formatting.add('stateLabel', {
        when: { op: 'eq', value: state.label },
        style: { background: state.colour, color: '#ffffff' },
        label: state.label,
      });
    }
    /* The severity chip in the alarm table. */
    for (const severity of SEVERITIES) {
      grids.alarms.formatting.add('severityLabel', {
        when: { op: 'eq', value: severity.label },
        style: { background: severity.colour, color: '#ffffff' },
        label: severity.label,
      });
    }
    /* The state chip beside each service. */
    for (const [value, colour] of [['Operational', '#2f9e5e'], ['Degraded', '#d99b1c'], ['Impaired', '#d2453b']]) {
      grids.services.formatting.add('status', {
        when: { op: 'eq', value },
        style: { background: colour, color: '#ffffff' },
        label: value,
      });
    }
    /* The load on a core link. The topology reads these. */
    for (const band of LOAD_BANDS) {
      grids.core.formatting.add('load', {
        when: band.at ? { op: 'gte', value: band.at } : { op: 'lt', value: 65 },
        style: { background: band.colour },
        label: band.label,
      });
    }
  }

  root.NocFormatting = { apply, LOAD_BANDS };
})(window);
