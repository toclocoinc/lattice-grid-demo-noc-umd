/**
 * The routing feed, live or recorded, behind one reader.
 *
 * Live, this is a browser `WebSocket` to RIPE RIS Live. Offline, it is the
 * grid's own `MockWebSocket` replaying a recording of that same feed. The two
 * are interchangeable on purpose: both frame their messages the same way, so
 * the handler below is the same code either way and the page has one path to
 * get wrong instead of two.
 *
 *     const socket = live
 *       ? new WebSocket(RIS_LIVE)
 *       : new MockWebSocket({ feed: replay(capture), rate });
 *
 * The live feed is loud: following one large backbone across every RIPE
 * collector is several thousand messages a minute, almost all of them
 * announcements that say nothing has gone wrong. The page keeps the rate as a
 * figure and throws those away; it keeps every withdrawal, and every
 * announcement that brings a withdrawn prefix back.
 */
(function (root) {
  'use strict';

  const RIS_LIVE = 'wss://ris-live.ripe.net/v1/ws/?client=lattice-noc-demo';

  /**
   * Turn a recording into the generator `MockWebSocket` wants.
   *
   * Each yielded value is shaped exactly like a live RIS Live message, so the
   * handler cannot tell them apart. The recording loops.
   *
   * @param {object} capture the recording from `data/ris-capture.json`
   * @returns {Generator<object>} an endless stream of RIS Live messages
   */
  function* replay(capture) {
    const hosts = capture.hosts || [];
    const events = capture.events || [];
    const recordedAt = Date.parse(capture.recordedAt) || Date.now();
    let at = 0;
    while (events.length) {
      const [offset, hostIndex, peerAsn, kind, prefix, originAsn] = events[at];
      at = (at + 1) % events.length;
      yield {
        type: 'ris_message',
        data: {
          timestamp: (recordedAt + offset) / 1000,
          host: `${hosts[hostIndex] || 'rrc00'}.ripe.net`,
          peer_asn: String(peerAsn),
          type: 'UPDATE',
          path: originAsn ? [peerAsn, originAsn] : [peerAsn],
          announcements: kind === 'w' ? [] : [{ next_hop: '', prefixes: [prefix] }],
          withdrawals: kind === 'w' ? [prefix] : [],
          /* Not a RIS Live field: it says this message came out of the
             recording, so nothing downstream has to guess. */
          recorded: true,
        },
      };
    }
  }

  /**
   * Open the feed.
   *
   * @param {object} options
   * @param {boolean} options.live whether to try the live feed
   * @param {number} options.asn the backbone to follow
   * @param {object} options.capture the recording, for the offline path
   * @param {(event: object) => void} options.onEvent called per routing event
   * @param {(state: object) => void} options.onState called when the mode changes
   * @returns {object} a handle with `state`, `inject`, `pause`, `resume`, `close`
   */
  function open(options) {
    const { asn, capture, onEvent, onState } = options;
    const MockWebSocket = (root.LatticeGridMockSocket || {}).MockWebSocket;
    const state = {
      mode: 'connecting', messages: 0, withdrawals: 0, ratePerMinute: 0, reconnects: 0,
      recordedRatePerMinute: capture ? capture.ratePerMinute : 0, note: '', paused: false,
    };
    let socket = null;
    let closed = false;
    let paused = false;
    let attempts = 0;

    /** The one handler. Live messages and replayed messages both land here. */
    function handle(raw) {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (!message || message.type !== 'ris_message' || !message.data || paused) return;
      const update = message.data;
      state.messages += 1;
      /*
       * Two clocks, deliberately. `at` is when the event happened, which for a
       * replayed recording is hours ago and is what the table shows, because
       * that is the truth about it. `arrived` is now, which is what ageing and
       * coalescing use, because an alarm that arrived this second is on the
       * wall this second whatever its timestamp says.
       */
      const at = Math.round((Number(update.timestamp) || Date.now() / 1000) * 1000);
      const arrived = Date.now();
      const collector = String(update.host || '').split('.')[0];
      const peerAsn = Number(update.peer_asn) || 0;
      const common = { at, arrived, collector, peerAsn, recorded: !!update.recorded };

      for (const prefix of update.withdrawals || []) {
        state.withdrawals += 1;
        onEvent({ ...common, kind: 'w', prefix });
      }
      for (const group of update.announcements || []) {
        for (const prefix of group.prefixes || []) onEvent({ ...common, kind: 'r', prefix });
      }
    }

    /** Start the recorded feed: used when live is off, or cannot be reached. */
    function goOffline(why) {
      if (closed) return;
      if (!MockWebSocket || !capture || !(capture.events || []).length) {
        state.mode = 'none';
        state.note = 'No live feed and no recording, so the alarm table stays empty.';
        if (onState) onState(state);
        return;
      }
      /* Replayed at the average spacing of the recording, so ten recorded
         minutes take ten minutes to play. */
      const rate = Math.max(8, Math.round(capture.durationMs / capture.events.length));
      socket = new MockWebSocket({ feed: replay(capture), rate, jitter: Math.round(rate / 3), seed: 7,
        url: 'mock://ris-live-recording' });
      socket.onmessage = (event) => handle(event.data);
      state.mode = 'recorded';
      state.note = why;
      state.replayRateMs = rate;
      if (onState) onState(state);
    }

    /** Start the live feed, with a backoff and a fall back to the recording. */
    function goLive() {
      if (closed) return;
      attempts += 1;
      let opened = false;
      try {
        socket = new WebSocket(RIS_LIVE);
      } catch {
        goOffline('The live routing feed could not be opened, so this is the recording.');
        return;
      }
      socket.onopen = () => {
        opened = true;
        attempts = 0;
        socket.send(JSON.stringify({ type: 'ris_subscribe',
          data: { path: String(asn), moreSpecific: true, type: 'UPDATE', socketOptions: { includeRaw: false } } }));
        state.mode = 'live';
        state.note = '';
        if (onState) onState(state);
      };
      socket.onmessage = (event) => handle(event.data);
      socket.onerror = () => {};
      socket.onclose = () => {
        if (closed) return;
        if (!opened && attempts >= 2) {
          goOffline('The live routing feed could not be reached, so this is the recording.');
          return;
        }
        state.reconnects += 1;
        state.mode = 'reconnecting';
        if (onState) onState(state);
        setTimeout(goLive, Math.min(10000, 800 * attempts));
      };
    }

    if (options.live) goLive();
    else goOffline('Opened with the live feed turned off, so this is the recording.');

    /* The rate, measured over the last few seconds rather than since the page
       opened, so it reads as a rate and not as an average of the whole visit. */
    let lastMessages = 0;
    let lastAt = Date.now();
    const ticker = setInterval(() => {
      const now = Date.now();
      const seconds = (now - lastAt) / 1000;
      if (seconds <= 0) return;
      state.ratePerMinute = Math.round(((state.messages - lastMessages) / seconds) * 60);
      lastMessages = state.messages;
      lastAt = now;
    }, 5000);

    return {
      state,
      /** Hand one message straight to the reader, exactly as the socket would. */
      inject(message) {
        const held = paused;
        paused = false;
        handle(typeof message === 'string' ? message : JSON.stringify(message));
        paused = held;
      },
      /** Hold the feed, so what is on screen stops moving. */
      pause() {
        paused = true;
        state.paused = true;
        try { if (socket && socket.pause) socket.pause(); } catch {}
      },
      /** Let it run again. */
      resume() {
        paused = false;
        state.paused = false;
        try { if (socket && socket.resume) socket.resume(); } catch {}
      },
      close() {
        closed = true;
        clearInterval(ticker);
        try { if (socket) socket.close(); } catch {}
      },
    };
  }

  root.NocFeed = { open, replay, RIS_LIVE };
})(window);
