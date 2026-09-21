/**
 * The world the wall draws, and the rules that move it.
 *
 * One array of records goes into the data router and every viewer reads its
 * own slice out. Each record carries a `kind`, which is what the router
 * partitions on, and an `id`, which is its identity.
 *
 * Three kinds of value live here and they are never mixed:
 *
 *   real       copied out of the saved measurements, or handed in by the
 *              routing feed: site names, coordinates, network counts, outage
 *              detections, and every alarm.
 *   derived    arithmetic over those, by a rule written here and repeated in
 *              the caption under the panel that shows it.
 *   simulated  a seeded generator: each site's own availability figure, the
 *              traffic curve and the core topology.
 *
 * Every simulated figure comes out of `seeded()`, so the same page always
 * shows the same invented numbers, and nothing invented is ever presented as
 * an event that happened.
 */
(function (root) {
  'use strict';

  /** The seven services the operator sells. Invented, with invented weights. */
  const SERVICES = [
    { id: 'internet', name: 'Internet transit', weight: 1.0 },
    { id: 'mpls', name: 'MPLS VPN', weight: 0.8 },
    { id: 'mobile', name: 'Mobile backhaul', weight: 0.7 },
    { id: 'voice', name: 'Voice and VoIP', weight: 0.5 },
    { id: 'video', name: 'Video transport', weight: 0.6 },
    { id: 'enterprise', name: 'Enterprise ethernet', weight: 0.9 },
    { id: 'cloud', name: 'Cloud connect', weight: 1.1 },
  ];

  /** The four states a site can be in, and the colour each one takes. */
  const STATES = [
    { id: 'healthy', label: 'Operational', colour: '#2f9e5e' },
    { id: 'degraded', label: 'Partial', colour: '#d99b1c' },
    { id: 'critical', label: 'Offline', colour: '#d2453b' },
    { id: 'maintenance', label: 'Maintenance', colour: '#5c7a99' },
  ];

  /** The three severities an alarm can carry, worst first. */
  const SEVERITIES = [
    { id: 'critical', label: 'Critical', colour: '#d2453b' },
    { id: 'major', label: 'Major', colour: '#d99b1c' },
    { id: 'minor', label: 'Minor', colour: '#3d7fb8' },
  ];

  /**
   * Where the words on the status tile change.
   *
   * One place, read twice: the KPI tile takes these as its threshold cut
   * points and colours itself from them, and the badge beside it takes the
   * same numbers and says what they mean.
   */
  const STATUS = {
    warnAt: 1,
    criticalAt: 4,
    words: { good: 'All systems operational', warn: 'Degraded', critical: 'Major incident' },
  };

  /** How long an alarm stays on the wall, how many it holds, and how long a
      repeat of one prefix is folded into the alarm already there. */
  const ALARM_WINDOW_MS = 10 * 60 * 1000;
  const ALARM_CAP = 150;
  const COALESCE_MS = 10 * 1000;

  /**
   * A small deterministic generator, seeded from a string.
   *
   * @param {string} text the seed
   * @returns {() => number} a function returning the next value in 0..1
   */
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

  const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  /**
   * Decide a site's state, from one number.
   *
   * There is one availability figure per site and the state is read off it, so
   * the map's colour and the table's percentage can never disagree: the marker
   * takes its colour from this column's own formatting rules.
   *
   * The figure starts simulated, drawn skewed towards healthy, and is then
   * reduced by two real things: a detected outage in the site's country, by
   * how large the detection is, and each live routing alarm observed at the
   * collector beside it. Maintenance wins over all of it, because a site in a
   * planned window is not a site with a fault.
   *
   * @param {object} site the site row, changed in place
   * @returns {object} the same row
   */
  function stateOf(site) {
    const outage = site.outageScore > 0
      ? clamp(0.35 + Math.log10(Math.max(10, site.outageScore)) * 0.28, 0, 1.5) : 0;
    site.availability = round(clamp(site.baseAvailability - outage - site.alarms * 0.15, 95, 100), 3);
    site.state = site.maintenance ? 'maintenance'
      : (site.availability < 99.5 ? 'critical' : (site.availability < 99.9 ? 'degraded' : 'healthy'));
    site.stateLabel = STATES.find((s) => s.id === site.state).label;
    return site;
  }

  /**
   * Turn the saved copy into the records every viewer reads.
   *
   * @param {object} snapshot what `NocSnapshot.read` returned
   * @returns {object} the world: its rows, its indexes and its counters
   */
  function build(snapshot) {
    const world = {
      snapshot,
      rows: [],
      sites: new Map(),
      collectors: new Map(),
      services: new Map(),
      alarms: new Map(),
      flaps: new Map(),
      feed: { messages: 0, ratePerMinute: 0 },
    };

    /* The outage picture, by country, from IODA. Real. */
    const outages = new Map();
    for (const row of (snapshot.outages.latest || {}).countries || []) outages.set(row.code, row);

    for (const site of snapshot.sites) {
      const random = seeded(`site:${site.id}`);
      /* Simulated: most sites fine, a few not, one or two badly not. */
      const band = random();
      const spread = random();
      const baseAvailability = round(band < 0.85 ? 99.9 + spread * 0.099
        : (band < 0.97 ? 99.5 + spread * 0.39 : 98.6 + spread * 0.89), 3);
      const detected = outages.get(site.country);
      const row = stateOf({
        kind: 'site',
        id: site.id,
        name: site.name,
        city: site.city,
        country: site.country,
        lat: site.lat,
        lon: site.lon,
        networks: site.networks,
        /* Simulated, but scaled by a real number: how many networks are in the
           building. A busier building carries more of our equipment. */
        elements: 6 + Math.round(site.networks / 8) + Math.round(random() * 4),
        maintenance: random() < 0.03,
        outageScore: detected ? detected.score : 0,
        baseAvailability,
        availability: baseAvailability,
        alarms: 0,
      });
      world.rows.push(row);
      world.sites.set(row.id, row);
    }

    /*
     * A routing event is observed at a RIS collector, and a collector sits in
     * a city. Where the backbone has a building in that city the event is
     * shown against it, because that is the place the observation is about.
     * It is not a claim that anything is broken in that building.
     */
    const byCity = new Map();
    for (const site of world.sites.values()) {
      const key = site.city.toLowerCase();
      if (!byCity.has(key)) byCity.set(key, site);
    }
    for (const collector of snapshot.collectors) {
      const site = byCity.get(collector.city.toLowerCase()) || null;
      world.collectors.set(collector.id, {
        id: collector.id,
        city: collector.city,
        siteId: site ? site.id : null,
        siteName: site ? site.name : collector.city,
        where: `${collector.city} (${collector.id.toUpperCase()})`,
      });
    }

    /* Services: invented, graded by the real alarm count, with a sparkline
       read off the real seven days of routing update activity. */
    const buckets = snapshot.churn.buckets;
    const worst = Math.max(...buckets.map((b) => b.announcements), 1);
    for (const service of SERVICES) {
      const row = {
        kind: 'service',
        id: service.id,
        name: service.name,
        weight: service.weight,
        availability: 100,
        status: 'Operational',
        /* The built-in `line` cell renderer reads a plain array of numbers. */
        spark: buckets.map((b) => round(100 - (b.announcements / worst) * service.weight * 0.9, 3)),
      };
      world.rows.push(row);
      world.services.set(row.id, row);
    }

    for (const row of coreLinks(world)) world.rows.push(row);
    for (const row of traffic(world, Date.now(), 288)) world.rows.push(row);
    /* The chips are rows, so choosing one is a selection the router filters
       on, exactly as a click on the map is. */
    for (const chip of [{ id: 'all', label: 'All' }, ...SEVERITIES]) {
      world.rows.push({ kind: 'chip', id: `chip-${chip.id}`, label: chip.label, count: 0 });
    }
    for (const row of metrics(world)) world.rows.push(row);
    return world;
  }

  /**
   * The core, as a graph. Invented equipment, placed in the four cities the
   * backbone has the most networks in, so the names on it are real places.
   *
   * @param {object} world the world so far
   * @returns {object[]} one row per link
   */
  function coreLinks(world) {
    const cities = [];
    for (const site of world.sites.values()) {
      if (!cities.some((c) => c.city === site.city)) cities.push({ city: site.city, networks: site.networks });
    }
    cities.sort((a, b) => b.networks - a.networks);
    const cores = cities.slice(0, 4).map((c) => ({ id: `core-${c.city.toLowerCase().replace(/\W+/g, '-')}`, city: c.city }));
    const rows = [];
    const add = (from, to, id) => {
      const random = seeded(`element:${id}`);
      /* Simulated: how loaded the link is, as a percentage. */
      rows.push({ kind: 'element', id, from, to, load: round(30 + random() * 65, 1) });
    };
    cores.forEach((core, index) => {
      /* Two circuits on every core pair, drawn side by side: a backbone with
         one of anything is not a backbone. */
      add('internet', core.id, `internet-${core.id}-a`);
      add('internet', core.id, `internet-${core.id}-b`);
      const next = cores[(index + 1) % cores.length];
      if (next.id !== core.id) {
        add(core.id, next.id, `${core.id}-${next.id}-a`);
        add(core.id, next.id, `${core.id}-${next.id}-b`);
      }
      add(core.id, `edge-${index + 1}`, `${core.id}-edge`);
    });
    add('cloud-a', cores[0].id, 'cloud-a-core');
    add('cloud-b', (cores[1] || cores[0]).id, 'cloud-b-core');
    world.nodes = [
      { id: 'internet', label: 'Internet', icon: 'globe', x: 0.5, y: 0.08 },
      { id: 'cloud-a', label: 'Cloud A', icon: 'cloud', x: 0.06, y: 0.32 },
      { id: 'cloud-b', label: 'Cloud B', icon: 'cloud', x: 0.94, y: 0.32 },
      ...cores.map((core, index) => ({ id: core.id, label: `${core.city} core`, icon: 'router',
        x: 0.14 + index * 0.24, y: 0.56 })),
      ...cores.map((core, index) => ({ id: `edge-${index + 1}`, label: `Region ${index + 1}`, icon: 'edge',
        x: 0.14 + index * 0.24, y: 0.94 })),
    ];
    return rows;
  }

  /**
   * A day of traffic at five minute steps, inbound and outbound.
   *
   * The shape is invented: a working day curve with a night trough. What
   * scales it is real, the number of sites the backbone has, and the newest
   * point is nudged by the rate of real routing updates arriving now, which is
   * why the right hand edge of the chart moves while you watch it.
   *
   * @param {object} world the world
   * @param {number} until the newest sample's time
   * @param {number} steps how many five minute steps to produce
   * @returns {object[]} two rows per step
   */
  function traffic(world, until, steps) {
    const step = 5 * 60 * 1000;
    const churn = clamp(world.feed.ratePerMinute / 9000, 0, 1.4);
    const scale = world.sites.size * 0.042;
    const rows = [];
    for (let back = steps - 1; back >= 0; back -= 1) {
      const at = until - back * step;
      const bucket = Math.floor(at / step);
      const random = seeded(`traffic:${bucket}`);
      const date = new Date(at);
      const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
      const shape = 0.55 + 0.45 * Math.sin(((hour - 10) / 24) * 2 * Math.PI);
      rows.push({ kind: 'sample', id: `t${bucket}-in`, at, direction: 'Inbound',
        gbps: round(scale * (shape * 10 + random() * 1.2) * (1 + churn * 0.08), 2) });
      rows.push({ kind: 'sample', id: `t${bucket}-out`, at, direction: 'Outbound',
        gbps: round(scale * (shape * 8.4 + random() * 1.1) * (1 + churn * 0.07), 2) });
    }
    return rows;
  }

  /**
   * Count everything the tiles and the badge read, in one pass.
   *
   * @param {object} world the world
   * @returns {object} the counts
   */
  function measure(world) {
    let sum = 0;
    let online = 0;
    let elements = 0;
    for (const site of world.sites.values()) {
      sum += site.availability;
      elements += site.elements;
      if (site.state === 'healthy') online += 1;
    }
    const by = { critical: 0, major: 0, minor: 0 };
    for (const alarm of world.alarms.values()) by[alarm.severity] += 1;
    let degraded = 0;
    for (const service of world.services.values()) if (service.availability < 99.5) degraded += 1;
    return {
      availability: round(sum / Math.max(1, world.sites.size), 3),
      incidents: by.critical + by.major + by.minor,
      critical: by.critical,
      major: by.major,
      minor: by.minor,
      servicesDegraded: degraded,
      sitesOnline: online,
      elements,
      updates: world.feed.ratePerMinute,
    };
  }

  /** One row per measurement the header strip shows. */
  function metrics(world) {
    const counts = measure(world);
    return [
      ['availability', counts.availability], ['incidents', counts.incidents], ['critical', counts.critical],
      ['servicesDegraded', counts.servicesDegraded], ['sitesOnline', counts.sitesOnline],
      ['elements', counts.elements], ['updates', counts.updates],
    ].map(([id, value]) => ({ kind: 'metric', id: `metric-${id}`, value }));
  }

  /** The words beside the status tile, from the number the tile grades. */
  function statusOf(critical) {
    if (critical >= STATUS.criticalAt) return { state: 'critical', words: STATUS.words.critical };
    if (critical >= STATUS.warnAt) return { state: 'warn', words: STATUS.words.warn };
    return { state: 'good', words: STATUS.words.good };
  }

  /**
   * Take one routing event and return the alarm it moved, or null.
   *
   * A withdrawal raises an alarm; the same peer announcing the prefix again at
   * the same collector clears it. A repeat inside ten seconds raises the count
   * on the alarm already there rather than a second alarm, and a prefix that
   * keeps flapping is escalated to critical, which is the only judgement this
   * page makes about a real event.
   *
   * The event carries two times. `at` is when it happened and is what the
   * table shows; `arrived` is when the page saw it and is what coalescing and
   * ageing use, because a recording replayed an hour later is arriving now.
   *
   * @param {object} world the world
   * @param {object} event `{ at, arrived, collector, peerAsn, kind, prefix }`
   * @returns {object|null} the alarm row, or null
   */
  function ingest(world, event) {
    world.feed.messages += 1;
    const key = `${event.collector}|${event.peerAsn}|${event.prefix}`;
    const arrived = event.arrived || event.at;
    const existing = world.alarms.get(key);

    if (event.kind === 'r') {
      if (!existing) return null;
      existing.status = 'Cleared';
      existing.severity = 'minor';
      existing.severityLabel = 'Minor';
      existing.at = event.at;
      existing.lastAt = arrived;
      existing.description = `Prefix ${event.prefix} announced again by AS${event.peerAsn}`;
      existing.impact = 'Route restored';
      touch(world, existing.siteId, -1);
      return existing;
    }
    if (event.kind !== 'w') return null;

    if (existing && arrived - existing.lastAt < COALESCE_MS && existing.status === 'Active') {
      existing.count += 1;
      existing.at = event.at;
      existing.lastAt = arrived;
      return existing;
    }
    const flaps = (world.flaps.get(key) || 0) + 1;
    world.flaps.set(key, flaps);
    const collector = world.collectors.get(event.collector);
    const alarm = existing || {
      kind: 'alarm',
      id: key,
      sourceShort: 'BGP',
      source: 'BGP (RIS Live)',
      prefix: event.prefix,
      siteId: collector ? collector.siteId : null,
      site: collector ? collector.siteName : 'Unknown',
      vantage: collector ? collector.where : String(event.collector).toUpperCase(),
      count: 0,
    };
    const wasActive = alarm.status === 'Active';
    alarm.at = event.at;
    alarm.lastAt = arrived;
    alarm.count += 1;
    alarm.severity = flaps >= 3 ? 'critical' : 'major';
    alarm.severityLabel = flaps >= 3 ? 'Critical' : 'Major';
    alarm.status = 'Active';
    alarm.description = `Prefix ${event.prefix} withdrawn by AS${event.peerAsn}`;
    alarm.impact = flaps >= 3 ? `Flapping, ${flaps} withdrawals` : 'Route no longer seen at this collector';
    world.alarms.set(key, alarm);
    if (!wasActive) touch(world, alarm.siteId, 1);
    return alarm;
  }

  /** Move a site's alarm count and re-decide its state. */
  function touch(world, siteId, by) {
    const site = siteId && world.sites.get(siteId);
    if (site) stateOf(Object.assign(site, { alarms: Math.max(0, site.alarms + by) }));
  }

  /**
   * Drop the alarms that have aged out, and trim the list to its cap.
   *
   * @param {object} world the world
   * @param {number} now the current time in milliseconds
   * @returns {string[]} the ids that went
   */
  function expire(world, now) {
    const gone = [];
    const drop = (alarm) => {
      world.alarms.delete(alarm.id);
      if (alarm.status === 'Active') touch(world, alarm.siteId, -1);
      gone.push(alarm.id);
    };
    for (const alarm of [...world.alarms.values()]) {
      const age = now - alarm.lastAt;
      if (age > ALARM_WINDOW_MS || (alarm.status === 'Cleared' && age > 60 * 1000)) drop(alarm);
    }
    const over = world.alarms.size - ALARM_CAP;
    if (over > 0) {
      for (const alarm of [...world.alarms.values()].sort((a, b) => a.lastAt - b.lastAt).slice(0, over)) drop(alarm);
    }
    return gone;
  }

  /**
   * Recompute everything that hangs off the alarms and return the rows that
   * moved, so the router pushes only those.
   *
   * Services lose points for the alarms live on the wall, weighted by how hard
   * each service feels routing churn and again by severity, because a prefix
   * that keeps flapping is worth twenty five that went away once.
   *
   * @param {object} world the world
   * @returns {object[]} the changed rows
   */
  function recompute(world) {
    const counts = measure(world);
    const changed = [];
    for (const service of world.services.values()) {
      const hit = service.weight * (counts.critical * 0.05 + counts.major * 0.002 + counts.minor * 0.0005);
      const availability = round(clamp(100 - hit, 98, 100), 3);
      if (availability !== service.availability) {
        service.availability = availability;
        service.status = availability >= 99.5 ? 'Operational' : (availability >= 99 ? 'Degraded' : 'Impaired');
        changed.push({ ...service });
      }
    }
    changed.push({ kind: 'chip', id: 'chip-all', label: 'All', count: counts.incidents });
    for (const severity of SEVERITIES) {
      changed.push({ kind: 'chip', id: `chip-${severity.id}`, label: severity.label, count: counts[severity.id] });
    }
    for (const row of metrics(world)) changed.push(row);
    world.counts = counts;
    return changed;
  }

  root.NocSimulator = {
    SERVICES, STATES, SEVERITIES, STATUS, ALARM_CAP, ALARM_WINDOW_MS,
    build, ingest, expire, recompute, measure, statusOf, traffic, seeded,
  };
})(window);
