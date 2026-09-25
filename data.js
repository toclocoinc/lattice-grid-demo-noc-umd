/**
 * The wall's data layer: every connection, and all the shaping, in one file.
 *
 * Load it after the grid core and `modules/data-router` (and, for the offline
 * modes, `modules/mock-socket`), then, in this order:
 *
 *     const data = NocData.create({ mode: 'live' });   // 'snapshot' | 'simulated'
 *     data.router.attach(myAlarmGrid, 'alarm');        // attach BEFORE start()
 *     data.on('status', (status) => { ... });
 *     data.start();
 *
 * **Attach before you start.** A route attached after rows have been loaded
 * receives nothing until the next delta for its partition, because those rows
 * were counted `unrouted` when they arrived. Nothing here draws or owns a grid.
 *
 * Every row reaches a viewer through the router, and every rollup is the
 * router's own. The members used, by their row in the 1.69.0 reference under
 * `#ref-module-data-router`:
 *
 *   createDataRouter({ key: 'kind', rowKey: 'id', overlap, batch, coalesce, metricsInterval })
 *     `overlap` because one value feeds several viewers; `batch` + `coalesce`
 *     (v3) fold a feed arriving thousands of messages a minute into one apply
 *     every 250 ms; `metricsInterval` is the only clock this file runs on.
 *   addSource(feed) -> handle.load / handle.push / handle.apply
 *     v9 fan-in: one handle per feed, so `metrics().sources` reports each rate.
 *   subscribe(value, handler, { filter, rollup })
 *     v5 with the v3 rollup: the severity counts and the per-country counts
 *     are the ROUTER's aggregation, read back as summary rows and re-entered
 *     as `chip` and `metric` rows. Nothing here counts alarms by hand.
 *   alert(value, condition, handler, { debounce })
 *     v5: fires once when the criticals cross the incident line, re-arms after.
 *   metrics() / on('metrics')
 *     v10: the status line's figures, and the turn of the wall -- ageing
 *     alarms, re-stating sites, pushing derived rows -- rides that cadence.
 *   flushStream() (v3, a deterministic point when stopping), destroy().
 *
 * No `seq`/`dedupe`, deliberately: with a seq gate on, the removals that
 * `removeSource()` and a source re-`load()` generate carry no seq of their own
 * and are dropped by that gate, so a feed's rows stay on the wall after the
 * feed has gone (measured against 1.69.0, raised as a finding). Nothing here
 * needs replay de-duplication, so the gate stays off.
 */
(function (root) {
  "use strict";

  /** The backbone the wall follows: a real AS, and its PeeringDB network. */
  const CARRIER = { asn: 3257, netId: 14 };
  const PEERINGDB = "https://www.peeringdb.com/api/";
  const IODA = "https://api.ioda.inetintel.cc.gatech.edu/v2/";
  const RIS_LIVE = "wss://ris-live.ripe.net/v1/ws/?client=lattice-noc-demo";
  const MODES = ["live", "snapshot", "simulated"];
  /** How long an alarm stays up, how many are held, the coalescing window. */
  const ALARM_WINDOW_MS = 10 * 60 * 1000,
    CLEARED_MS = 60 * 1000,
    ALARM_CAP = 150,
    COALESCE_MS = 10 * 1000;
  const INCIDENT_AT = 4,
    SAMPLE_MS = 5 * 60 * 1000;

  /** Where each RIS collector sits. Static public facts, so no round trip. */
  const COLLECTORS = new Map(
    (
      "rrc00:Amsterdam:NL,rrc01:London:GB,rrc03:Amsterdam:NL,rrc04:Geneva:CH,rrc05:Vienna:AT," +
      "rrc06:Tokyo:JP,rrc07:Stockholm:SE,rrc10:Milan:IT,rrc11:New York:US,rrc12:Frankfurt:DE,rrc13:Moscow:RU," +
      "rrc14:Palo Alto:US,rrc15:Sao Paulo:BR,rrc16:Miami:US,rrc18:Barcelona:ES,rrc19:Johannesburg:ZA,rrc20:Zurich:CH," +
      "rrc21:Paris:FR,rrc22:Bucharest:RO,rrc23:Singapore:SG,rrc24:Montevideo:UY,rrc26:Dubai:AE"
    )
      .split(",")
      .map((text) => {
        const [id, city, country] = text.split(":");
        return [id, { id, city, country }];
      }),
  );

  /** The seven services the invented operator sells, and their weights. */
  const SERVICES = [
    ["internet", "Internet transit", 1],
    ["mpls", "MPLS VPN", 0.8],
    ["mobile", "Mobile backhaul", 0.7],
    ["voice", "Voice and VoIP", 0.5],
    ["video", "Video transport", 0.6],
    ["enterprise", "Enterprise ethernet", 0.9],
    ["cloud", "Cloud connect", 1.1],
  ];
  /** The three severities an alarm can carry, worst first. */
  const SEVERITIES = [
    ["critical", "Critical"],
    ["major", "Major"],
    ["minor", "Minor"],
  ];
  /** The cities `simulated` invents a footprint in, so it touches no network. */
  const CITIES = [
    ["Frankfurt", "DE", 50.11, 8.68],
    ["London", "GB", 51.51, -0.13],
    ["Amsterdam", "NL", 52.37, 4.9],
    ["Paris", "FR", 48.86, 2.35],
    ["New York", "US", 40.71, -74.01],
    ["Ashburn", "US", 39.04, -77.49],
    ["Singapore", "SG", 1.29, 103.85],
    ["Tokyo", "JP", 35.68, 139.69],
    ["Sydney", "AU", -33.87, 151.21],
    ["Sao Paulo", "BR", -23.55, -46.63],
    ["Johannesburg", "ZA", -26.2, 28.05],
    ["Toronto", "CA", 43.65, -79.38],
  ];

  /** What one row of each kind carries. Handed to the page as `data.kinds`. */
  const KINDS = {
    site:
      "id, name, city, country, lat, lon, networks, status, availability, alarms. One building: real (PeeringDB " +
      "live, recorded offline, invented when simulated); status and availability are derived from its alarms.",
    alarm:
      "id (bgp:peer:prefix or outage:ioda:cc), class (bgp|outage), source, prefix, peerAsn, collector, vantage, " +
      "siteId, site, country, severity, severityLabel, status, cleared, since, at, count, description, impact.",
    service:
      "id, name, weight, availability, status. An invented service, graded by the alarms live on the wall.",
    sample:
      "id, at, direction (Inbound|Outbound), gbps. One five-minute traffic sample; invented, scaled by sites.",
    element:
      "id, from, to, load. One core circuit; from/to are node names, so a network chart needs no node list.",
    chip: "id (chip-all|chip-critical|chip-major|chip-minor), label, count. The router's severity rollup, as rows.",
    metric:
      "id (metric-*), label, value, group (wall|country). One figure for a tile: the feed rate, the counts.",
  };

  /** A deterministic generator, seeded from a string, so a run repeats. */
  function seeded(text) {
    let hash = 2166136261;
    for (let at = 0; at < text.length; at += 1) {
      hash ^= text.charCodeAt(at);
      hash = Math.imul(hash, 16777619);
    }
    let state = hash >>> 0;
    return function next() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  const round = (value, places) =>
    Math.round(value * 10 ** places) / 10 ** places;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  /** Read JSON, and say what answered when it did not work. */
  async function json(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.json();
  }

  /** Read a site's status off its one availability figure. */
  function stateOf(site) {
    site.availability = round(
      clamp(site.baseAvailability - site.alarms * 0.15, 95, 100),
      3,
    );
    site.status = site.maintenance
      ? "Maintenance"
      : site.availability < 99.5
        ? "Offline"
        : site.availability < 99.9
          ? "Degraded"
          : "Operational";
    return site;
  }

  /** A PeeringDB facility, or a recorded one, as a `site` row. */
  function siteRow(fac) {
    const id = /^[FS]/.test(String(fac.id)) ? String(fac.id) : `F${fac.id}`;
    const lat = typeof fac.lat === "number" ? fac.lat : fac.latitude;
    const lon = typeof fac.lon === "number" ? fac.lon : fac.longitude;
    const random = seeded(`site:${id}`);
    /* Invented, drawn skewed towards healthy: most buildings are fine. */
    const band = random(),
      spread = random();
    const baseAvailability = round(
      band < 0.85
        ? 99.9 + spread * 0.099
        : band < 0.97
          ? 99.5 + spread * 0.39
          : 98.6 + spread * 0.89,
      3,
    );
    return stateOf({
      kind: "site",
      id,
      name: String(fac.name || "").trim(),
      city: String(fac.city || "").trim(),
      country: String(fac.country || "").trim(),
      lat: typeof lat === "number" ? lat : null,
      lon: typeof lon === "number" ? lon : null,
      networks: Number(fac.networks || fac.net_count) || 0,
      maintenance: random() < 0.03,
      baseAvailability,
      availability: baseAvailability,
      alarms: 0,
    });
  }

  /** The seven services, before any alarm has graded them. */
  const serviceRows = () =>
    SERVICES.map(([id, name, weight]) => ({
      kind: "service",
      id,
      name,
      weight,
      availability: 100,
      status: "Operational",
    }));

  /** The invented core: two circuits between the four busiest cities. */
  function elementRows(sites) {
    const busiest = [];
    for (const site of sites) {
      const found = busiest.find((entry) => entry.city === site.city);
      if (found) found.networks += site.networks;
      else busiest.push({ city: site.city, networks: site.networks });
    }
    busiest.sort((a, b) => b.networks - a.networks);
    const cores = busiest.slice(0, 4).map((entry) => `${entry.city} core`);
    const rows = [];
    const link = (from, to, circuit) =>
      rows.push({
        kind: "element",
        id: `${from}|${to}|${circuit}`,
        from,
        to,
        load: round(30 + seeded(`element:${from}:${to}:${circuit}`)() * 65, 1),
      });
    cores.forEach((core, at) => {
      link("Internet", core, "a");
      link("Internet", core, "b");
      const next = cores[(at + 1) % cores.length];
      if (next !== core) {
        link(core, next, "a");
        link(core, next, "b");
      }
      link(core, `Region ${at + 1}`, "a");
    });
    if (cores.length) {
      link("Cloud A", cores[0], "a");
      link("Cloud B", cores[1] || cores[0], "a");
    }
    return rows;
  }

  /** Five-minute traffic samples: an invented curve, scaled by real sites. */
  function sampleRows(sites, until, steps) {
    const scale = Math.max(1, sites) * 0.042;
    const rows = [];
    for (let back = steps - 1; back >= 0; back -= 1) {
      const at = until - back * SAMPLE_MS,
        bucket = Math.floor(at / SAMPLE_MS),
        random = seeded(`traffic:${bucket}`);
      const when = new Date(at),
        hour = when.getUTCHours() + when.getUTCMinutes() / 60;
      const shape = 0.55 + 0.45 * Math.sin(((hour - 10) / 24) * 2 * Math.PI);
      rows.push({
        kind: "sample",
        id: `t${bucket}-in`,
        at,
        direction: "Inbound",
        gbps: round(scale * (shape * 10 + random() * 1.2), 2),
      });
      rows.push({
        kind: "sample",
        id: `t${bucket}-out`,
        at,
        direction: "Outbound",
        gbps: round(scale * (shape * 8.4 + random() * 1.1), 2),
      });
    }
    return rows;
  }

  /** IODA's per-country detections as `alarm` rows of the outage class. */
  function outageAlarms(detections, at) {
    return detections
      .map((row) => {
        const entity = row.entity || row;
        return {
          code: entity.code || "",
          name: entity.name || entity.code || "",
          score: Math.round(
            row.score != null ? row.score : (row.scores || {}).overall || 0,
          ),
          events: Number(row.events != null ? row.events : row.event_cnt) || 1,
        };
      })
      .filter((row) => row.code && row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((row) => ({
        kind: "alarm",
        id: `outage:ioda:${row.code}`,
        class: "outage",
        source: "IODA",
        prefix: "",
        peerAsn: null,
        collector: "",
        vantage: row.name,
        siteId: null,
        site: row.name,
        country: row.code,
        severity: row.score >= 20000 ? "critical" : "major",
        severityLabel: row.score >= 20000 ? "Critical" : "Major",
        status: "Active",
        cleared: false,
        since: at,
        at,
        count: row.events,
        score: row.score,
        description: `Internet outage detected in ${row.name} (IODA score ${row.score})`,
        impact: "Reachability reduced for this country",
      }));
  }

  /** Turn a recording into the generator `MockWebSocket` wants. It loops.
   *
   * Each replayed event is stamped with the moment it is replayed, not the
   * moment it was recorded: the recording is ten minutes long and loops, so
   * keeping the original times would pin every alarm to the same two minutes
   * for as long as the page runs. The original time travels alongside as
   * `recordedTimestamp` for anyone who wants it. */
  function* replay(capture) {
    const hosts = capture.hosts || [],
      events = capture.events || [];
    const recordedAt = Date.parse(capture.recordedAt) || Date.now();
    let at = 0;
    while (events.length) {
      const [offset, hostIndex, peerAsn, kind, prefix, originAsn] = events[at];
      at = (at + 1) % events.length;
      yield {
        type: "ris_message",
        data: {
          timestamp: Date.now() / 1000,
          recordedTimestamp: (recordedAt + offset) / 1000,
          type: "UPDATE",
          host: `${hosts[hostIndex] || "rrc00"}.ripe.net`,
          peer_asn: String(peerAsn),
          path: originAsn ? [peerAsn, originAsn] : [peerAsn],
          withdrawals: kind === "w" ? [prefix] : [],
          announcements:
            kind === "w" ? [] : [{ next_hop: "", prefixes: [prefix] }],
          recorded: true,
        },
      };
    }
  }

  /**
   * Build the router, the sources and the shaping for one mode.
   *
   * @param {object} [options] `{ mode: 'live'|'snapshot'|'simulated', rate: events a second offline, base: where data/ is }`
   * @returns {object} `{ router, kinds, start, stop, destroy, on }`
   */
  function create(options) {
    const settings = options || {};
    const mode = settings.mode || "snapshot";
    if (MODES.indexOf(mode) < 0)
      throw new Error(
        `[noc-data] mode must be one of ${MODES.join(", ")}, not "${mode}".`,
      );
    const base = settings.base || "./";
    const rate = Number(settings.rate) > 0 ? Number(settings.rate) : 12;
    const createDataRouter = (root.LatticeGridDataRouter || {})
      .createDataRouter;
    if (typeof createDataRouter !== "function") {
      throw new Error(
        "[noc-data] load modules/data-router.min.js before this file.",
      );
    }
    const router = createDataRouter({
      key: "kind",
      rowKey: "id",
      overlap: true,
      batch: { intervalMs: 250 },
      coalesce: true,
      metricsInterval: 1000,
    });
    /* One handle per feed, so `metrics().sources` reports each one's rate. */
    const feeds = {
      sites: router.addSource("sites"),
      world: router.addSource("world"),
      bgp: router.addSource("bgp"),
      outages: router.addSource("ioda"),
      derived: router.addSource("derived"),
    };
    const listeners = [],
      chance = seeded("noc-simulated"),
      severity = new Map(),
      country = new Map();
    const state = {
      state: "idle",
      note: "",
      messages: 0,
      withdrawals: 0,
      ratePerMinute: 0,
      lastMessages: 0,
      lastAt: Date.now(),
      sites: [],
      services: [],
      byId: new Map(),
      byCity: new Map(),
      alarms: new Map(),
      flaps: new Map(),
      dirty: new Set(),
      sampledAt: 0,
      started: false,
      stopped: false,
      attempts: 0,
      socket: null,
      timer: null,
      retry: null,
      unwatch: null,
      capture: null,
    };

    /** Tell the page where the data comes from, and how much of it there is. */
    function emit(extra) {
      let alarms = 0;
      for (const count of severity.values()) alarms += count;
      const event = Object.assign(
        {
          mode,
          state: state.state,
          note: state.note,
          messages: state.messages,
          withdrawals: state.withdrawals,
          ratePerMinute: state.ratePerMinute,
          alarms,
          sites: state.sites.length,
          at: Date.now(),
        },
        extra || {},
      );
      for (const handler of listeners.slice()) {
        try {
          handler(event);
        } catch (error) {
          console.error("[noc-data] a status listener threw", error);
        }
      }
      return event;
    }
    /** Move the connection state, and say so in the same breath. */
    const say = (next, note, extra) => {
      state.state = next;
      state.note = note || "";
      return emit(extra);
    };

    /* The two rollups are the router's, not this file's: it only keeps the
       latest summary row per group so it can re-enter them as chips/tiles. */
    const collect = (map, field) => (change) => {
      for (const row of (change.add || []).concat(change.update || []))
        map.set(row[field], row.count);
      for (const row of change.remove || [])
        map.delete(typeof row === "object" ? row[field] : row);
    };
    router.subscribe("alarm", collect(severity, "severityLabel"), {
      filter: (row) => !row.cleared,
      rollup: {
        groupBy: "severityLabel",
        aggregate: { count: { op: "count" } },
      },
    });
    router.subscribe("alarm", collect(country, "country"), {
      filter: (row) => !row.cleared && !!row.country,
      rollup: { groupBy: "country", aggregate: { count: { op: "count" } } },
    });
    const criticals = (rows) =>
      rows.filter((row) => row.severity === "critical" && !row.cleared).length;
    router.alert(
      "alarm",
      (rows) => criticals(rows) >= INCIDENT_AT,
      (signal, rows) =>
        emit({ alert: "major-incident", criticals: criticals(rows) }),
      { debounce: 1000 },
    );

    /** Move a site's alarm count, and mark it for the next turn. */
    function touch(siteId, by) {
      const site = siteId && state.byId.get(siteId);
      if (!site) return;
      site.alarms = Math.max(0, site.alarms + by);
      state.dirty.add(site.id);
    }

    /**
     * One routing event -- live, replayed or invented -- as the alarm it moved.
     * A withdrawal raises an alarm keyed by peer and prefix; the same peer
     * announcing it again clears it; a repeat inside ten seconds raises the
     * count on the alarm already there; a prefix that keeps flapping is
     * escalated to critical, the only judgement made here.
     *
     * @param {object} event `{ kind: 'w'|'r', at, peer, prefix, where }`
     */
    function raise(event) {
      const id = `bgp:${event.peer}:${event.prefix}`,
        held = state.alarms.get(id),
        seen = Date.now();
      if (event.kind === "r") {
        if (!held || held.cleared) return;
        Object.assign(held, {
          cleared: true,
          status: "Cleared",
          severity: "minor",
          severityLabel: "Minor",
          at: event.at,
          seen,
          impact: "Route restored",
          description: `Prefix ${event.prefix} announced again by AS${event.peer}`,
        });
        touch(held.siteId, -1);
        feeds.bgp.push({ op: "upsert", row: Object.assign({}, held) });
        return;
      }
      state.withdrawals += 1;
      if (held && !held.cleared && seen - held.seen < COALESCE_MS) {
        Object.assign(held, { count: held.count + 1, at: event.at, seen });
        feeds.bgp.push({ op: "upsert", row: Object.assign({}, held) });
        return;
      }
      const flaps = (state.flaps.get(id) || 0) + 1;
      state.flaps.set(id, flaps);
      const where = event.where || {},
        site = state.byCity.get(String(where.city || "").toLowerCase()) || null;
      const alarm = held || {
        kind: "alarm",
        id,
        class: "bgp",
        source: "BGP (RIS Live)",
        prefix: event.prefix,
        peerAsn: event.peer,
        collector: where.id || "",
        vantage: where.city || "Unknown",
        siteId: site ? site.id : null,
        site: site ? site.name : where.city || "Unknown",
        country: site ? site.country : where.country || "",
        since: event.at,
        count: 0,
      };
      const wasLive = !!held && !held.cleared;
      Object.assign(alarm, {
        at: event.at,
        seen,
        cleared: false,
        status: "Active",
        count: alarm.count + 1,
        severity: flaps >= 3 ? "critical" : "major",
        severityLabel: flaps >= 3 ? "Critical" : "Major",
        description: `Prefix ${event.prefix} withdrawn by AS${event.peer}`,
        impact:
          flaps >= 3
            ? `Flapping: ${flaps} withdrawals`
            : "Route no longer seen at this collector",
      });
      state.alarms.set(id, alarm);
      if (!wasLive) touch(alarm.siteId, 1);
      feeds.bgp.push({ op: "upsert", row: Object.assign({}, alarm) });
    }

    /** One RIS Live message, live or replayed, as routing events. */
    function onMessage(raw) {
      let message = raw;
      if (typeof raw === "string") {
        try {
          message = JSON.parse(raw);
        } catch {
          return;
        }
      }
      if (!message || message.type !== "ris_message" || !message.data) return;
      const update = message.data;
      state.messages += 1;
      const at = Math.round(
        (Number(update.timestamp) || Date.now() / 1000) * 1000,
      );
      const where =
        COLLECTORS.get(String(update.host || "").split(".")[0]) || null;
      const peer = Number(update.peer_asn) || 0;
      for (const prefix of update.withdrawals || [])
        raise({ kind: "w", at, peer, prefix, where });
      for (const group of update.announcements || []) {
        for (const prefix of group.prefixes || [])
          raise({ kind: "r", at, peer, prefix, where });
      }
    }

    /** Invent one routing event, so the wall moves with no network at all. */
    function invent() {
      state.messages += 1;
      const open = [];
      for (const alarm of state.alarms.values())
        if (!alarm.cleared) open.push(alarm);
      if (open.length && chance() < 0.35) {
        const alarm = open[Math.floor(chance() * open.length)];
        raise({
          kind: "r",
          at: Date.now(),
          peer: alarm.peerAsn,
          prefix: alarm.prefix,
          where: null,
        });
        return;
      }
      const site =
        state.sites[Math.floor(chance() * state.sites.length)] || null;
      raise({
        kind: "w",
        at: Date.now(),
        peer: 3000 + Math.floor(chance() * 60000),
        prefix: `${10 + Math.floor(chance() * 180)}.${Math.floor(chance() * 255)}.${Math.floor(chance() * 255)}.0/24`,
        where: site
          ? { id: "sim", city: site.city, country: site.country }
          : null,
      });
    }

    /** Take the aged-out alarms off the wall, and hold the list to its cap. */
    function expire(now) {
      const gone = [],
        rest = [];
      for (const alarm of state.alarms.values()) {
        const age = now - alarm.seen;
        if (age > ALARM_WINDOW_MS || (alarm.cleared && age > CLEARED_MS))
          gone.push(alarm);
        else rest.push(alarm);
      }
      if (rest.length > ALARM_CAP) {
        rest.sort((a, b) => a.seen - b.seen);
        for (const alarm of rest.slice(0, rest.length - ALARM_CAP))
          gone.push(alarm);
      }
      if (!gone.length) return;
      for (const alarm of gone) {
        state.alarms.delete(alarm.id);
        if (!alarm.cleared) touch(alarm.siteId, -1);
      }
      feeds.bgp.apply(
        gone.map((alarm) => ({
          op: "delete",
          row: { kind: "alarm", id: alarm.id },
        })),
      );
    }

    /** Re-state the sites whose alarm count moved since the last turn. */
    function refreshSites() {
      if (!state.dirty.size) return;
      const rows = [];
      for (const id of state.dirty) {
        const site = state.byId.get(id);
        if (site) rows.push(Object.assign({}, stateOf(site)));
      }
      state.dirty.clear();
      feeds.sites.apply(rows.map((row) => ({ op: "upsert", row })));
    }

    /** The chips and the tiles: the router's rollups, turned back into rows. */
    function derived(metrics) {
      let alarms = 0,
        availability = 0,
        online = 0;
      for (const count of severity.values()) alarms += count;
      for (const site of state.sites) {
        availability += site.availability;
        if (site.status === "Operational") online += 1;
      }
      const rows = [
        { kind: "chip", id: "chip-all", label: "All", count: alarms },
      ];
      for (const [id, label] of SEVERITIES)
        rows.push({
          kind: "chip",
          id: `chip-${id}`,
          label,
          count: severity.get(label) || 0,
        });
      const tile = (id, label, value) =>
        rows.push({
          kind: "metric",
          id: `metric-${id}`,
          label,
          value,
          group: "wall",
        });
      tile("rate", "Feed messages per minute", state.ratePerMinute);
      tile("withdrawals", "Withdrawals seen", state.withdrawals);
      tile("alarms", "Active alarms", alarms);
      tile("critical", "Critical alarms", severity.get("Critical") || 0);
      tile("sites-online", "Sites operational", online);
      tile(
        "availability",
        "Mean availability",
        round(availability / Math.max(1, state.sites.length), 3),
      );
      tile(
        "rows",
        "Rows in the router",
        metrics
          ? metrics.routes.reduce((sum, route) => sum + route.rows, 0)
          : 0,
      );
      /* The busiest eight countries, straight off the router's country rollup. */
      for (const [code, count] of [...country.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)) {
        rows.push({
          kind: "metric",
          id: `metric-country-${code}`,
          label: code,
          value: count,
          group: "country",
        });
      }
      const graded = [
        severity.get("Critical") || 0,
        severity.get("Major") || 0,
        severity.get("Minor") || 0,
      ];
      for (const service of state.services) {
        const now = round(
          clamp(
            100 -
              service.weight *
                (graded[0] * 0.05 + graded[1] * 0.002 + graded[2] * 0.0005),
            98,
            100,
          ),
          3,
        );
        if (now === service.availability) continue;
        service.availability = now;
        service.status =
          now >= 99.5 ? "Operational" : now >= 99 ? "Degraded" : "Impaired";
        rows.push(Object.assign({}, service));
      }
      return rows;
    }

    /** One turn of the wall, riding the router's own metrics cadence. */
    function turn(metrics) {
      const now = Date.now(),
        seconds = Math.max(0.001, (now - state.lastAt) / 1000);
      state.ratePerMinute = Math.round(
        ((state.messages - state.lastMessages) / seconds) * 60,
      );
      state.lastMessages = state.messages;
      state.lastAt = now;
      expire(now);
      refreshSites();
      feeds.derived.apply(
        derived(metrics).map((row) => ({ op: "upsert", row })),
      );
      if (state.sampledAt && now - state.sampledAt > SAMPLE_MS) {
        state.sampledAt = now;
        feeds.world.apply(
          sampleRows(state.sites.length, now, 1).map((row) => ({
            op: "upsert",
            row,
          })),
        );
      }
      emit(
        metrics
          ? {
              routes: metrics.routes,
              sources: metrics.sources,
              dropped: metrics.dropped,
              unrouted: metrics.unrouted,
              lag: metrics.lag,
            }
          : null,
      );
    }

    /** The footprint: PeeringDB when live, the recorded copy when it is not. */
    async function loadSites() {
      if (mode === "simulated") {
        return CITIES.map((city, at) =>
          siteRow({
            id: `S${at + 1}`,
            name: `${city[0]} ${"ABCD".charAt(at % 4)}`,
            city: city[0],
            country: city[1],
            lat: city[2],
            lon: city[3],
            networks: 40 + at * 9,
          }),
        );
      }
      if (mode === "live") {
        try {
          const ids = (
            (await json(`${PEERINGDB}netfac?net_id=${CARRIER.netId}&depth=0`))
              .data || []
          )
            .map((row) => row.fac_id)
            .filter(Boolean);
          const facilities = [];
          for (let at = 0; at < ids.length; at += 100) {
            facilities.push(
              ...((
                await json(
                  `${PEERINGDB}fac?id__in=${ids.slice(at, at + 100).join(",")}`,
                )
              ).data || []),
            );
          }
          if (!facilities.length)
            throw new Error("PeeringDB listed no facilities");
          return facilities.map(siteRow);
        } catch (error) {
          say(
            "degraded",
            `PeeringDB could not be read from this page (${error.message}), so the footprint ` +
              "below is the recorded copy.",
          );
        }
      }
      return (await json(`${base}data/snapshot/sites.json`)).map(siteRow);
    }

    /** IODA's detections, live or recorded, as alarms of the outage class. */
    async function loadOutages() {
      if (mode === "simulated") return;
      const day = 24 * 60 * 60,
        from = Math.floor((Date.now() / 1000 - day) / day) * day;
      if (mode === "live") {
        try {
          const live = (
            await json(
              `${IODA}outages/summary?from=${from}&until=${from + day}&entityType=country`,
            )
          ).data;
          if (live && live.length) {
            feeds.outages.load(outageAlarms(live, from * 1000));
            return;
          }
          emit({
            note: "IODA reported no detections, so the recorded ones are shown instead.",
          });
        } catch (error) {
          emit({
            note: `IODA could not be read from this page (${error.message}), so the recorded detections are shown.`,
          });
        }
      }
      try {
        const saved = await json(`${base}data/snapshot/outages.json`);
        feeds.outages.load(
          outageAlarms(
            (saved.latest || {}).countries || [],
            ((saved.latest || {}).from || 0) * 1000,
          ),
        );
      } catch (error) {
        emit({
          note: `The outage detections could not be read (${error.message}), so none are shown.`,
        });
      }
    }

    /** Replay the recording through the grid's own MockWebSocket. */
    async function goRecorded(why) {
      const MockWebSocket = (root.LatticeGridMockSocket || {}).MockWebSocket;
      if (typeof MockWebSocket !== "function") {
        say(
          "error",
          `${why} But modules/mock-socket.min.js is not loaded, so there is no routing feed at all.`,
        );
        return;
      }
      if (!state.capture) {
        try {
          state.capture = await json(`${base}data/ris-capture.json`);
        } catch (error) {
          say(
            "error",
            `${why} But the recording could not be read (${error.message}).`,
          );
          return;
        }
      }
      if (state.stopped) return;
      state.socket = new MockWebSocket({
        feed: replay(state.capture),
        rate: Math.max(4, Math.round(1000 / rate)),
        jitter: 0,
        seed: 7,
        url: "mock://ris-live-recording",
      });
      state.socket.onmessage = (event) => onMessage(event.data);
      say("replaying", why);
    }

    /** Open the real socket, with a backoff and a fall back to the recording. */
    function goLive() {
      let opened = false;
      say("connecting", `Opening the RIS Live feed for AS${CARRIER.asn}.`);
      try {
        state.socket = new root.WebSocket(RIS_LIVE);
      } catch (error) {
        goRecorded(
          `The live routing feed could not be opened (${error.message}), so this is the recording.`,
        );
        return;
      }
      const socket = state.socket;
      socket.onopen = () => {
        opened = true;
        state.attempts = 0;
        socket.send(
          JSON.stringify({
            type: "ris_subscribe",
            data: {
              path: String(CARRIER.asn),
              moreSpecific: true,
              type: "UPDATE",
              socketOptions: { includeRaw: false },
            },
          }),
        );
        say(
          "connected",
          `Live BGP updates for AS${CARRIER.asn}, from the RIPE NCC's RIS.`,
        );
      };
      socket.onmessage = (event) => onMessage(event.data);
      socket.onerror = () => {};
      socket.onclose = () => {
        if (state.stopped) return;
        state.attempts += 1;
        if (!opened && state.attempts >= 2) {
          goRecorded(
            "The live routing feed could not be reached from this page, so this is the recording.",
          );
          return;
        }
        say(
          "reconnecting",
          `The live feed closed; reconnecting (attempt ${state.attempts}).`,
        );
        state.retry = setTimeout(goLive, Math.min(10000, 800 * state.attempts));
      };
    }

    /** Load the world and open the feed. Attach every viewer before this. */
    async function start() {
      if (state.started) return;
      state.started = true;
      state.stopped = false;
      say("loading", "Reading the footprint and building the world.");
      state.sites = await loadSites();
      state.byId = new Map(state.sites.map((site) => [site.id, site]));
      state.byCity = new Map();
      for (const site of state.sites)
        if (!state.byCity.has(site.city.toLowerCase()))
          state.byCity.set(site.city.toLowerCase(), site);
      feeds.sites.load(state.sites.map((site) => Object.assign({}, site)));
      state.services = serviceRows();
      state.sampledAt = Date.now();
      feeds.world.load(
        state.services
          .map((row) => Object.assign({}, row))
          .concat(
            elementRows(state.sites),
            sampleRows(state.sites.length, state.sampledAt, 288),
          ),
      );
      state.unwatch = router.on("metrics", turn);
      if (mode === "simulated") {
        state.timer = setInterval(
          invent,
          Math.max(20, Math.round(1000 / rate)),
        );
        say(
          "simulating",
          `Inventing ${rate} routing events a second. Nothing in this mode is real.`,
        );
      } else if (mode === "live") {
        goLive();
      } else {
        await goRecorded(
          "Opened in snapshot mode, so this is the recorded feed, replayed.",
        );
      }
      loadOutages();
      turn(router.metrics());
    }

    /** Close the feed and stop the turns. What is already routed stays. */
    function stop() {
      state.stopped = true;
      state.started = false;
      if (state.unwatch) {
        state.unwatch();
        state.unwatch = null;
      }
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
      if (state.retry) {
        clearTimeout(state.retry);
        state.retry = null;
      }
      if (state.socket) {
        try {
          state.socket.close();
        } catch {
          /* already gone */
        }
        state.socket = null;
      }
      router.flushStream();
      say("stopped", "The routing feed is closed.");
    }

    /**
     * Listen to the status line: `{ mode, state, note, messages, ratePerMinute, alarms, sites, routes, sources }`.
     *
     * @param {string} name only `status`
     * @param {Function} handler the listener
     * @returns {Function} the function that stops listening
     */
    function on(name, handler) {
      if (name !== "status" || typeof handler !== "function") return () => {};
      listeners.push(handler);
      return () => {
        const at = listeners.indexOf(handler);
        if (at >= 0) listeners.splice(at, 1);
      };
    }

    /** Stop, then let the router go. It detaches; the page owns its grids. */
    const destroy = () => {
      stop();
      listeners.length = 0;
      router.destroy();
    };

    return { router, kinds: KINDS, start, stop, destroy, on };
  }

  root.NocData = { create, kinds: KINDS, modes: MODES };
})(window);
