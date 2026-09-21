/**
 * The loop that keeps the wall moving.
 *
 * The routing feed arrives faster than anything needs to be redrawn, so what
 * has landed is taken four times a second and pushed through the router as one
 * batch of changes. Nothing here draws: it turns events into rows and hands
 * them to the router, which is what every viewer is already listening to.
 */
(function (root) {
  'use strict';

  const Simulator = root.NocSimulator;

  /**
   * Start the feed and the loop.
   *
   * @param {object} options the wiring, the masthead, the chips and the mode
   * @returns {object} the feed handle and the hooks the browser check uses
   */
  function start(options) {
    const { wired, masthead, chips, live, asn, capture } = options;
    const world = wired.world;
    const pending = [];
    let sampledAt = 0;

    const feed = root.NocFeed.open({
      live, asn, capture,
      onEvent: (event) => pending.push(event),
      onState: (state) => paint(state),
    });

    /** Say where the routing events on the wall are coming from. */
    function paint(state) {
      const words = { live: 'Live BGP feed', recorded: 'Recorded BGP feed', reconnecting: 'Reconnecting',
        connecting: 'Connecting', none: 'No routing feed' };
      masthead.pill.textContent = words[state.mode] || state.mode;
      masthead.pill.dataset.mode = state.mode;
      masthead.pill.title = state.note || '';
    }
    paint(feed.state);

    /** One turn: ingest what arrived, age out what did not, push the rest. */
    function drain() {
      const now = Date.now();
      world.feed.ratePerMinute = feed.state.mode === 'recorded'
        ? feed.state.recordedRatePerMinute : feed.state.ratePerMinute;

      const moved = new Map();
      const batch = pending.splice(0, pending.length);
      for (const event of batch) {
        const alarm = Simulator.ingest(world, event);
        if (alarm) moved.set(alarm.id, alarm);
      }
      const gone = Simulator.expire(world, now);
      const rows = [...moved.values()].map((alarm) => ({ ...alarm }));

      if (batch.length || gone.length || now - sampledAt > 5000) {
        for (const row of Simulator.recompute(world)) rows.push(row);
        for (const site of world.sites.values()) {
          if (site.alarms > 0 || site.state !== 'healthy') rows.push({ ...site });
        }
      }
      /* The newest traffic sample, nudged by the live update rate. */
      if (now - sampledAt > 5000) {
        sampledAt = now;
        for (const row of Simulator.traffic(world, now, 1)) rows.push(row);
      }
      if (rows.length) wired.push(rows);
      if (gone.length) wired.drop(gone);

      /* The chips and the badge, which are page furniture rather than rows. */
      const counts = world.counts || Simulator.measure(world);
      chips.paint(counts);
      const status = Simulator.statusOf(counts.critical);
      masthead.badge.dataset.state = status.state;
      masthead.words.textContent = status.words;
    }

    const timer = setInterval(drain, 250);
    drain();

    return {
      feed,
      drain,
      /** Push one whole RIS Live message in, exactly as the socket would. */
      injectMessage: (message) => { feed.inject(message); drain(); },
      pauseFeed: () => feed.pause(),
      resumeFeed: () => { feed.resume(); },
      stop: () => { clearInterval(timer); feed.close(); },
    };
  }

  root.NocLive = { start };
})(window);
