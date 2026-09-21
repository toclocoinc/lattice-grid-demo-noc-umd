/**
 * The masthead, the honesty banner, the status badge and the credits.
 *
 * A network operations wall is a picture of a network, and most of the ones in
 * a product demonstration are a picture of nothing at all. This one is part
 * real and part invented, and the difference is the most important thing on
 * the page, so it is stated at the top in four classes and again in the
 * caption under every panel.
 */
(function (root) {
  'use strict';

  /** The four classes, and the words the page shows for each. */
  const CLASSES = [
    ['live', 'Live', 'Every alarm beginning "BGP" is a routing event that happened, read from RIPE RIS '
      + 'Live as you watch. The rate beside it is the rate those events are arriving at.'],
    ['recorded', 'Recorded', 'The sites and their coordinates are one real backbone’s public facility '
      + 'list, with seven days of real routing update activity and a real record of detected internet outages.'],
    ['derived', 'Derived', 'Site states, service availability and every counter on the top strip are '
      + 'arithmetic over those, by the rule written under each panel.'],
    ['simulated', 'Simulated', 'The traffic curve, the core topology and each site’s own availability '
      + 'figure are invented by a seeded generator. The operator is invented too: the carrier whose '
      + 'footprint and routes these are is not named here, because the numbers around them are not its numbers.'],
  ];

  /** What each panel draws and out of what. The layout reads this. */
  const PANELS = [
    { id: 'header', title: 'Network status', provenance: 'derived',
      caption: 'Counts over the rows on this page. Availability and element counts are simulated; the '
        + 'incident counts are real routing events.' },
    { id: 'map', title: 'Site availability', provenance: 'derived',
      caption: 'Sites and coordinates are real. Availability starts simulated, then falls for a real outage '
        + 'detected in that country and for each live alarm observed beside it. The marker colour is that '
        + 'one figure, through the site table’s own rules. Click a marker to narrow the alarms.' },
    { id: 'alarms', title: 'Active alarms and incidents', provenance: 'live',
      caption: 'Real routing events, newest first, shown at the site nearest the collector that observed '
        + 'each one. That is where it was seen, not a fault in that building. The newest 150, over the last '
        + 'ten minutes. Severity, impact and status are derived.' },
    { id: 'services', title: 'Service health', provenance: 'derived',
      caption: 'A fictional service catalogue. Availability is 100 less the live alarms, weighted by '
        + 'severity and by how hard each service feels routing churn; the sparkline is the real seven-day '
        + 'routing update activity read the same way.' },
    { id: 'traffic', title: 'Network traffic', provenance: 'simulated',
      caption: 'A simulated daily shape, scaled by the number of real sites and perturbed by the real rate '
        + 'of routing updates.' },
    { id: 'topology', title: 'Core topology', provenance: 'derived',
      caption: 'A fictional core in four real cities. Each link is coloured by a simulated load, through '
        + 'the same conditional formatting rules the core table uses.' },
  ];

  /** The services this page reads, and the credit each one asks for. */
  const CREDITS = [
    ['PeeringDB', 'https://www.peeringdb.com/', 'Facility list, city, country and coordinates for every '
      + 'site on the map. Re-used with attribution under the PeeringDB acceptable use policy.'],
    ['RIPE NCC Routing Information Service', 'https://ris.ripe.net/', 'Every BGP announcement and '
      + 'withdrawal on this page, live or recorded. Published by the RIPE NCC for public use.'],
    ['RIPEstat', 'https://stat.ripe.net/', 'Announced prefixes, observed neighbours, the collector list '
      + 'and seven days of update activity. Published by the RIPE NCC for public use.'],
    ['IODA, Georgia Institute of Technology', 'https://ioda.inetintel.cc.gatech.edu/', 'Detected internet '
      + 'outages by country. Copyright Georgia Tech Research Corporation. Used with attribution.'],
    ['Natural Earth', 'https://www.naturalearthdata.com/', 'The country outlines under the map, at 1:110m. '
      + 'Public domain.'],
  ];

  /** Make an element with a class and optional text. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * Draw the masthead and the banner, and return the handles the page moves.
   *
   * @param {HTMLElement} host where to draw
   * @param {object} snapshot the saved copy, for the figures in the subtitle
   * @returns {object} the elements the live loop updates
   */
  function draw(host, snapshot) {
    const head = el('header', 'head');
    const titles = el('div', 'head-titles');
    titles.append(
      el('h1', null, `${snapshot.meta.brand} network operations`),
      el('p', 'head-sub', `${snapshot.sites.length} sites in ${snapshot.meta.counts.countries} countries, `
        + `${snapshot.routing.prefixesV4} announced prefixes, ${snapshot.routing.neighbours} observed neighbours`),
    );
    const badge = el('div', 'status-badge');
    const words = el('span', 'status-words', root.NocSimulator.STATUS.words.good);
    badge.append(el('span', 'status-dot'), words);
    const controls = el('div', 'head-controls');
    const pill = el('span', 'pill', 'Connecting');
    controls.append(pill);
    head.append(titles, badge, controls);

    const banner = el('section', 'banner');
    banner.append(el('h2', 'banner-title', 'What on this wall is real'));
    const list = el('ul', 'banner-list');
    for (const [id, label, text] of CLASSES) {
      const item = el('li', `banner-item prov-${id}`);
      item.append(el('span', 'prov-tag', label), el('span', 'prov-text', text));
      list.append(item);
    }
    banner.append(list);
    host.append(head, banner);
    return { head, controls, badge, words, pill };
  }

  /**
   * Draw the credits at the foot of the page.
   *
   * @param {HTMLElement} host where to draw
   * @returns {void}
   */
  function credits(host) {
    const footer = el('footer', 'credits');
    footer.append(el('h2', 'credits-title', 'Sources'));
    const list = el('ul', 'credit-list');
    for (const [name, href, note] of CREDITS) {
      const item = el('li');
      const link = el('a', 'credit-link', name);
      link.href = href;
      link.rel = 'noopener';
      item.append(link, el('span', 'credit-note', ` ${note}`));
      list.append(item);
    }
    footer.append(list);
    host.append(footer);
  }

  root.NocBanner = { draw, credits, el, PANELS, CLASSES, CREDITS };
})(window);
