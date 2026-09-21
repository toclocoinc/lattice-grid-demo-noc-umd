/**
 * Build the saved copy the dashboard opens on.
 *
 * Five public services are read here, in Node, once a night, and reduced to a
 * handful of small files in `data/snapshot/`. The page reads those files and
 * then, if it can reach the internet, opens a live BGP feed on top of them.
 *
 * What is saved, and where each piece comes from:
 *
 *   sites.json       the backbone's facility list, from PeeringDB: name, city,
 *                    country, coordinates, and how many networks are present.
 *                    Real, and the only geography on the page.
 *   collectors.json  the RIPE RIS collectors and the city each one sits in,
 *                    from RIPEstat. Real. A BGP alarm is placed at the
 *                    collector that saw it, which is where it was observed.
 *   routing.json     the backbone's announced prefixes, neighbours and RIS
 *                    visibility, from RIPEstat. Real.
 *   churn.json       BGP update activity over the last seven days in six hour
 *                    buckets, from RIPEstat. Real.
 *   outages.json     detected internet outages by country, day by day for a
 *                    week and for the last day, from IODA. Real.
 *   latency.json     round trip times between RIPE Atlas anchors, one series
 *                    per pair, hourly medians over the last day. Real. The
 *                    full result set for one pair is about 170KB for a day, so
 *                    it is reduced here rather than in the browser.
 *   shapes.json      country outlines, taken from the pinned grid release's
 *                    own geometry pack so the page fetches one file instead of
 *                    a module. Natural Earth, public domain.
 *
 * Nothing in this file invents a number. Everything the dashboard shows that
 * is not in these files is derived or simulated in the page, and the page
 * says which.
 *
 * Usage: node tools/build-snapshot.mjs [--skip-atlas] [--out data/snapshot]
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARRIER } from './carrier.mjs';
import { CDN_BASE, GRID_VERSION, SOURCES, getJson, wait } from './sources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const out = resolve(root, flag('out', 'data/snapshot'));
const say = (line) => process.stdout.write(`${line}\n`);

/** Write one file of the saved copy, and report its size. */
async function save(name, value) {
  const text = `${JSON.stringify(value)}\n`;
  await writeFile(join(out, name), text);
  say(`  ${name.padEnd(18)} ${(text.length / 1024).toFixed(1)} KB`);
  return text.length;
}

await mkdir(out, { recursive: true });
const startedAt = new Date().toISOString();

/* ===================================================================== */
/* 1. The footprint: PeeringDB.                                           */
/* ===================================================================== */

say(`Reading the facility list for AS${CARRIER.asn} from PeeringDB...`);
const netfac = await getJson(`${SOURCES.peeringdb.api}netfac?net_id=${CARRIER.netId}&depth=0`);
const facilityIds = netfac.data.map((row) => row.fac_id);
say(`  ${facilityIds.length} facilities listed`);

/* Sixty at a time, rather than one request per facility. */
const facilities = [];
for (let at = 0; at < facilityIds.length; at += 60) {
  const batch = facilityIds.slice(at, at + 60);
  const page = await getJson(`${SOURCES.peeringdb.api}fac?id__in=${batch.join(',')}`);
  facilities.push(...page.data);
  if (at + 60 < facilityIds.length) await wait(1200);
}
say(`  ${facilities.length} facilities read`);

const sites = facilities
  .map((fac) => ({
    id: `F${fac.id}`,
    name: String(fac.name || '').trim(),
    city: String(fac.city || '').trim(),
    country: String(fac.country || '').trim(),
    continent: String(fac.region_continent || '').trim(),
    lat: typeof fac.latitude === 'number' ? fac.latitude : null,
    lon: typeof fac.longitude === 'number' ? fac.longitude : null,
    /* How many networks and exchanges are present in the building. Real, and
       the only thing the page scales a site's size by. */
    networks: Number(fac.net_count) || 0,
    exchanges: Number(fac.ix_count) || 0,
  }))
  .filter((site) => site.name)
  .sort((a, b) => b.networks - a.networks || a.name.localeCompare(b.name));

const placed = sites.filter((s) => s.lat !== null && s.lon !== null).length;
say(`  ${placed} of ${sites.length} carry coordinates`);

/* ===================================================================== */
/* 2. Where a routing event is seen: the RIS collectors.                  */
/* ===================================================================== */

say('Reading the RIS collector list from RIPEstat...');
const rrcInfo = await getJson(`${SOURCES.ripestat.api}rrc-info/data.json`);
const collectors = rrcInfo.data.rrcs
  .filter((rrc) => !rrc.deactivated_on)
  .map((rrc) => {
    const where = String(rrc.geographical_location || '').split(',');
    return {
      id: String(rrc.name || '').toLowerCase(),
      city: where[0].trim(),
      country: (where[1] || '').trim(),
      at: String(rrc.topological_location || '').trim(),
      multihop: !!rrc.multihop,
      peers: Array.isArray(rrc.peers) ? rrc.peers.length : 0,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
say(`  ${collectors.length} active collectors`);

/* ===================================================================== */
/* 3. The backbone's routing table, today: RIPEstat.                      */
/* ===================================================================== */

say('Reading routing status and update activity from RIPEstat...');
const status = (await getJson(`${SOURCES.ripestat.api}routing-status/data.json?resource=AS${CARRIER.asn}`)).data;
const routing = {
  queriedAt: status.query_time,
  prefixesV4: status.announced_space?.v4?.prefixes ?? null,
  prefixesV6: status.announced_space?.v6?.prefixes ?? null,
  addresses: status.announced_space?.v4?.ips ?? null,
  neighbours: status.observed_neighbours ?? null,
  visibilityV4: status.visibility?.v4 ?? null,
  visibilityV6: status.visibility?.v6 ?? null,
  firstSeen: status.first_seen?.time ?? null,
};
say(`  ${routing.prefixesV4} IPv4 prefixes, ${routing.neighbours} neighbours, `
  + `seen by ${routing.visibilityV4?.ris_peers_seeing} of ${routing.visibilityV4?.total_ris_peers} RIS peers`);

await wait(600);
const activity = (await getJson(`${SOURCES.ripestat.api}bgp-update-activity/data.json?resource=AS${CARRIER.asn}`)).data;
const churn = {
  from: activity.query_starttime,
  to: activity.query_endtime,
  bucketSeconds: activity.sampling_period,
  buckets: (activity.updates || []).map((u) => ({ at: u.starttime, announcements: u.announcements || 0 })),
};
say(`  ${churn.buckets.length} buckets of ${churn.bucketSeconds / 3600} hours`);

/* ===================================================================== */
/* 4. Detected outages: IODA.                                             */
/* ===================================================================== */

say('Reading detected outages from IODA...');
const day = 24 * 60 * 60;
const nowSeconds = Math.floor(Date.now() / 1000);
/** Midnight UTC at the start of the day `back` days ago. */
const midnight = (back) => Math.floor((nowSeconds - back * day) / day) * day;

const outageDays = [];
for (let back = 6; back >= 0; back -= 1) {
  const from = midnight(back);
  const until = Math.min(from + day, nowSeconds);
  const page = await getJson(
    `${SOURCES.ioda.api}outages/summary?from=${from}&until=${until}&entityType=country`,
  );
  const rows = (page.data || []).map((row) => ({
    code: row.entity?.code || '',
    name: row.entity?.name || '',
    score: Math.round(row.scores?.overall || 0),
    events: Number(row.event_cnt) || 0,
  }));
  outageDays.push({ date: new Date(from * 1000).toISOString().slice(0, 10), from, until, countries: rows });
  say(`  ${outageDays[outageDays.length - 1].date}: ${rows.length} countries with detected outages`);
  await wait(800);
}
const outages = {
  copyright: rrcInfoCopyright(),
  days: outageDays,
  /* The most recent full day is what the map reads for a country's state. */
  latest: outageDays[outageDays.length - 1],
};
/** IODA states its copyright in the body of every answer; carry it through. */
function rrcInfoCopyright() {
  return 'This data is Copyright Georgia Tech Research Corporation. Used with attribution.';
}

/* ===================================================================== */
/* 5. Real round trip times: RIPE Atlas anchors.                          */
/* ===================================================================== */

let latency = { pairs: [], note: 'not collected' };
if (has('skip-atlas')) {
  say('Skipping RIPE Atlas (--skip-atlas).');
} else {
  say('Reading anchor round trip times from RIPE Atlas...');
  /*
   * An anchoring mesh measurement answers with every probe that pinged that
   * anchor, which is tens of megabytes for a day. One probe at a time is one
   * pair of machines, which is what a "link" means here, and that is about
   * 170KB for a day. The measurement record does not list its probes, so the
   * pair is found from the measurement's latest results and the probe with
   * the longest round trip is taken: the furthest away, which is the one
   * worth drawing.
   */
  const wanted = 10;
  const pairs = [];
  const seenCountries = new Set();
  let page = `${SOURCES.atlas.api}measurements/?type=ping&is_public=true&tags=anchoring,mesh`
    + '&status=2&af=4&page_size=50&format=json';
  let scanned = 0;

  while (pairs.length < wanted && page && scanned < 6) {
    const list = await getJson(page);
    scanned += 1;
    for (const measurement of list.results || []) {
      if (pairs.length >= wanted) break;
      const anchor = String(measurement.target || '');
      const anchorCountry = anchor.slice(0, 2).toUpperCase();
      /* One pair per anchor country, so ten pairs are ten places. */
      if (!/^[a-z]{2}-/.test(anchor) || seenCountries.has(anchorCountry)) continue;

      const latest = await getJson(`${SOURCES.atlas.api}measurements/${measurement.id}/latest/?format=json`)
        .catch(() => []);
      const reporting = (Array.isArray(latest) ? latest : [])
        .filter((r) => typeof r.avg === 'number' && r.avg > 0)
        .sort((a, b) => a.avg - b.avg);
      if (reporting.length < 20) { await wait(500); continue; }
      /* The ninetieth percentile rather than the maximum: the longest path
         that is still a working one, not a probe having a bad minute. */
      const chosen = reporting[Math.floor(reporting.length * 0.9)];
      await wait(500);

      const stop = Math.floor(Date.now() / 1000);
      const start = stop - day;
      const results = await getJson(
        `${SOURCES.atlas.api}measurements/${measurement.id}/results/`
        + `?start=${start}&stop=${stop}&probe_ids=${chosen.prb_id}&format=json`,
      ).catch(() => []);
      const points = (results || []).filter((r) => typeof r.avg === 'number' && r.avg > 0);
      if (points.length < 24) { await wait(500); continue; }

      /* One median per hour, so the series is two dozen numbers, not hundreds. */
      const byHour = new Map();
      for (const point of points) {
        const hour = Math.floor(point.timestamp / 3600) * 3600;
        if (!byHour.has(hour)) byHour.set(hour, []);
        byHour.get(hour).push(point.avg);
      }
      const series = [...byHour.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([hour, values]) => {
          const sorted = values.slice().sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
          return { at: hour, ms: Math.round(median * 100) / 100 };
        });

      const probe = await getJson(`${SOURCES.atlas.api}probes/${chosen.prb_id}/?format=json`).catch(() => null);
      seenCountries.add(anchorCountry);
      pairs.push({
        id: `A${measurement.id}-${chosen.prb_id}`,
        anchor,
        anchorCountry,
        probeId: chosen.prb_id,
        probeCountry: String(probe?.country_code || '').toUpperCase(),
        measurementId: measurement.id,
        samples: points.length,
        medianMs: series.length
          ? Math.round((series.map((s) => s.ms).sort((a, b) => a - b)[Math.floor(series.length / 2)]) * 100) / 100
          : null,
        series,
      });
      say(`  ${probe?.country_code || '??'} to ${anchorCountry} (${anchor}): `
        + `${points.length} readings reduced to ${series.length} hourly medians`);
      await wait(800);
    }
    page = list.next && pairs.length < wanted ? list.next : null;
  }
  latency = {
    pairs,
    note: 'One RIPE Atlas anchoring mesh ping measurement per pair, one probe each, hourly medians of the '
      + 'measured round trip time over the last day.',
  };
}

/* ===================================================================== */
/* 6. Country outlines, from the pinned release's own geometry pack.      */
/* ===================================================================== */

say(`Reading the country outlines from the pinned ${GRID_VERSION} release...`);
const packUrl = `${CDN_BASE}modules/geo-world-110m.esm.min.js`;
const packSource = await fetch(packUrl).then((r) => {
  if (!r.ok) throw new Error(`${packUrl} answered ${r.status}`);
  return r.text();
});
const temporary = join(out, '.geo-pack.mjs');
await writeFile(temporary, packSource);
const { pack } = await import(`file://${temporary}`);
await rm(temporary, { force: true });
say(`  ${pack.title}: ${pack.licence?.name}`);

/* ===================================================================== */
/* 7. What was built.                                                     */
/* ===================================================================== */

const capturePath = join(root, 'data', 'ris-capture.json');
let capture = null;
try {
  const held = JSON.parse(await readFile(capturePath, 'utf8'));
  capture = {
    recordedAt: held.recordedAt,
    durationMs: held.durationMs,
    counts: held.counts,
    ratePerMinute: held.ratePerMinute,
  };
} catch {
  say('  (no recorded feed at data/ris-capture.json yet; run tools/capture-ris.mjs)');
}

const meta = {
  builtAt: startedAt,
  finishedAt: new Date().toISOString(),
  gridVersion: GRID_VERSION,
  brand: CARRIER.brand,
  asn: CARRIER.asn,
  counts: {
    sites: sites.length,
    sitesPlaced: placed,
    countries: new Set(sites.map((s) => s.country)).size,
    collectors: collectors.length,
    outageDays: outageDays.length,
    latencyPairs: latency.pairs.length,
    churnBuckets: churn.buckets.length,
  },
  capture,
  sources: SOURCES,
  shapes: { title: pack.title, projection: pack.projection, source: pack.source, licence: pack.licence },
};

say('\nWriting the saved copy:');
await save('meta.json', meta);
await save('sites.json', sites);
await save('collectors.json', collectors);
await save('routing.json', routing);
await save('churn.json', churn);
await save('outages.json', outages);
await save('latency.json', latency);
await save('shapes.json', pack);

say('\nDone.');
