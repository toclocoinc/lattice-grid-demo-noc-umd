/**
 * The entry point: read the saved copy, draw the wall, open the feed.
 *
 * This is the script-tag edition. The grid and its modules arrived as classic
 * `<script src>` tags from jsDelivr, ahead of this file, and left globals
 * behind: `LatticeGrid` (the core, which the charts module and the marker map
 * extend), `LatticeGridDataRouter`, `LatticeGridKPI`, `LatticeGridLayout` and
 * `LatticeGridMockSocket`. This file picks the factories off those globals and
 * hands them to `src/wiring.js`, which never touches a global itself.
 *
 * One query parameter, for looking at the page rather than for using it:
 * `?live=0` leaves the live routing feed alone and replays the recording.
 */
(function (root) {
  'use strict';

  const TITLE = 'A network operations centre, on live internet data';
  const host = document.querySelector('#app');

  /** Draw the waiting state, and return a function that updates its message. */
  function showProgress(first) {
    host.textContent = '';
    const panel = document.createElement('div');
    panel.className = 'loading';
    const message = document.createElement('p');
    message.className = 'loading-message';
    message.textContent = first;
    const bar = document.createElement('div');
    bar.className = 'loading-bar';
    const fill = document.createElement('div');
    fill.className = 'loading-fill';
    bar.append(fill);
    const title = document.createElement('h1');
    title.textContent = TITLE;
    panel.append(title, message, bar);
    host.append(panel);
    return (text, fraction) => {
      message.textContent = text;
      fill.style.width = `${Math.round((fraction || 0) * 100)}%`;
    };
  }

  /** Say what went wrong, in words a reader can act on. */
  function showError(error) {
    host.textContent = '';
    const panel = document.createElement('div');
    panel.className = 'loading';
    const title = document.createElement('h1');
    title.textContent = 'The operations wall could not be drawn';
    const message = document.createElement('p');
    message.className = 'loading-message';
    message.textContent = String((error && error.message) || error);
    panel.append(title, message);
    host.append(panel);
    console.error('[noc demo]', error);
  }

  /**
   * The grid's factories, read off the globals the script tags left behind.
   *
   * Checked by name rather than assumed, so a script tag that did not load, or
   * loaded in the wrong order, is reported as the sentence it is rather than
   * as "undefined is not a function" somewhere inside the wiring.
   *
   * @returns {object} the factories and `setLicence`
   */
  function libraryFromGlobals() {
    const missing = [];
    const need = (object, name, what) => {
      const value = object && object[name];
      if (typeof value !== 'function') missing.push(what);
      return value;
    };
    const library = {
      createGrid: need(root.LatticeGrid, 'createGrid', 'lattice-grid.min.js (LatticeGrid.createGrid)'),
      setLicence: need(root.LatticeGrid, 'setLicence', 'lattice-grid.min.js (LatticeGrid.setLicence)'),
      /* The charts module extends the core global rather than defining its
         own, so it has to be loaded after the core; this is where that shows. */
      createChart: need(root.LatticeGrid, 'createChart', 'modules/charts.min.js (LatticeGrid.createChart)'),
      createDataRouter: need(root.LatticeGridDataRouter, 'createDataRouter',
        'modules/data-router.min.js (LatticeGridDataRouter.createDataRouter)'),
      createKPI: need(root.LatticeGridKPI, 'createKPI', 'modules/kpi.min.js (LatticeGridKPI.createKPI)'),
      createLayout: need(root.LatticeGridLayout, 'createLayout',
        'modules/layout.min.js (LatticeGridLayout.createLayout)'),
    };
    if (typeof ((root.LatticeGridMockSocket || {}).MockWebSocket) !== 'function') {
      missing.push('modules/mock-socket.min.js (LatticeGridMockSocket.MockWebSocket)');
    }
    if (missing.length) {
      throw new Error(`The grid did not load from the CDN. Missing: ${missing.join('; ')}. `
        + 'Check that the script tags in index.html are reachable and in order, with the core first.');
    }
    return library;
  }

  async function start() {
    const started = performance.now();
    try {
      const library = libraryFromGlobals();
      /* Applied before anything is drawn, because a grid that already exists
         keeps whatever licence was in force when it was built. */
      library.setLicence(DEMO_LICENCE);

      const live = new URLSearchParams(root.location.search).get('live') !== '0';
      const update = showProgress('Reading the saved copy...');
      const snapshot = await root.NocSnapshot.read(update);
      update('Drawing the wall...', 1);
      const read = performance.now();

      host.textContent = '';
      host.classList.add('wall');
      const masthead = root.NocBanner.draw(host, snapshot);
      const mounted = root.NocLayout.mount({
        createLayout: library.createLayout, host, controls: masthead.controls,
      });
      const wired = root.NocWiring.wire({
        createGrid: library.createGrid,
        createChart: library.createChart,
        createKPI: library.createKPI,
        createDataRouter: library.createDataRouter,
        snapshot,
        panel: mounted.panel,
      });
      const chips = root.NocChips.draw(wired.alarmsGrid.element.parentElement, wired.chipsGrid);
      const running = root.NocLive.start({
        wired, masthead, chips, live, asn: snapshot.meta.asn, capture: snapshot.capture,
      });
      root.NocBanner.credits(host);

      const finished = performance.now();
      root.__nocDemo = Object.assign({}, wired, mounted, running, {
        snapshot, live, ready: true,
        counts: () => root.NocSimulator.measure(wired.world),
        timings: {
          sites: snapshot.sites.length,
          rows: wired.world.rows.length,
          capturedEvents: snapshot.capture ? snapshot.capture.events.length : 0,
          readMs: Math.round(read - started),
          buildMs: Math.round(finished - read),
        },
      });
      console.log('[noc demo] ready', root.__nocDemo.timings);
    } catch (error) {
      root.__nocDemo = { ready: false, error: String((error && error.message) || error) };
      showError(error);
    }
  }

  start();
})(window);
