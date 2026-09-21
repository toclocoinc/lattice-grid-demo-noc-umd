/**
 * Every address this project reads, in one place, with what it is for.
 *
 * Nothing here needs a key. Each service was checked from a browser at the
 * address this demo is published on before it was used, because a service that
 * answers `curl` and refuses a page is no use to a page.
 */

/** The pinned grid release. The page's script tags name the same one. */
export const GRID_VERSION = '1.66.0';
export const CDN_BASE = `https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@${GRID_VERSION}/`;

export const SOURCES = {
  peeringdb: {
    name: 'PeeringDB',
    home: 'https://www.peeringdb.com/',
    api: 'https://www.peeringdb.com/api/',
    licence: 'PeeringDB data is made available for re-use with attribution. https://www.peeringdb.com/aup',
    attribution: 'Facility locations from PeeringDB.',
  },
  risLive: {
    name: 'RIPE RIS Live',
    home: 'https://ris-live.ripe.net/',
    api: 'wss://ris-live.ripe.net/v1/ws/?client=lattice-noc-demo',
    licence: 'RIPE NCC Routing Information Service data, published for public use. https://ris.ripe.net/docs/',
    attribution: 'Live BGP updates from the RIPE NCC Routing Information Service.',
  },
  ripestat: {
    name: 'RIPEstat',
    home: 'https://stat.ripe.net/',
    api: 'https://stat.ripe.net/data/',
    licence: 'RIPEstat data is published by the RIPE NCC for public use. https://stat.ripe.net/docs/',
    attribution: 'Routing statistics from RIPEstat, RIPE NCC.',
  },
  ioda: {
    name: 'IODA',
    home: 'https://ioda.inetintel.cc.gatech.edu/',
    api: 'https://api.ioda.inetintel.cc.gatech.edu/v2/',
    licence: 'Copyright Georgia Tech Research Corporation. Used with attribution.',
    attribution: 'Internet outage detection from IODA, Georgia Institute of Technology.',
  },
  atlas: {
    name: 'RIPE Atlas',
    home: 'https://atlas.ripe.net/',
    api: 'https://atlas.ripe.net/api/v2/',
    licence: 'RIPE Atlas measurement results are published under the RIPE NCC terms. https://atlas.ripe.net/legal/terms-conditions/',
    attribution: 'Round trip times measured by RIPE Atlas anchors, RIPE NCC.',
  },
  naturalEarth: {
    name: 'Natural Earth 1:110m',
    home: 'https://www.naturalearthdata.com/',
    api: `${CDN_BASE}modules/geo-world-110m.esm.min.js`,
    licence: 'Public domain.',
    attribution: 'Country outlines from Natural Earth.',
  },
};

/** A polite user agent, so the services we read can see who is asking. */
export const USER_AGENT = 'lattice-grid-demo-noc/1.0 (+https://github.com/toclocoinc/lattice-grid-demo-noc-umd)';

/**
 * Fetch JSON, with a clear message when it fails.
 *
 * @param {string} url the address
 * @param {object} [options] extra fetch options
 * @returns {Promise<any>} the parsed body
 */
export async function getJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...(options.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/** Wait, so a run of requests to one service is not a burst. */
export const wait = (ms) => new Promise((done) => setTimeout(done, ms));
