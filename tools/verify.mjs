/**
 * Load the wall in a real browser and check that it works.
 *
 * It depends on jsDelivr, because that is where the page gets the grid from:
 * this edition has no local copy of the library at all, and a check that
 * loaded one would not be checking the page. It does not depend on the
 * internet beyond that: it runs the page with `?live=0`, so the routing feed
 * is the recording in `data/`, and every figure it asserts is recomputed here,
 * in Node, from the saved files rather than read back off the screen.
 *
 * Beyond "it drew something", it asserts the things this demo exists to show:
 *
 *   - the library arrived by classic script tag: there is no `type="module"`
 *     script on the page, every library tag points at the pinned release on
 *     the CDN with an integrity hash, and each one left what it documents;
 *   - ten panels, each one a window of the layout module, and each one
 *     declaring where its numbers come from;
 *   - the windows can be moved, resized, maximised, minimised and restored,
 *     and the arrangement survives a reload;
 *   - the map draws a marker for every site the saved copy places, coloured
 *     by the site's own conditional formatting rules;
 *   - the topology draws icon nodes and parallel links;
 *   - a routing withdrawal pushed in by hand reaches the alarm table, the
 *     tiles, the ticker and the colour of a marker on the map, through the
 *     one router;
 *   - the severity chips and a click on a marker both narrow the alarm table;
 *   - nothing says "NaN", nothing uses an em dash, and the grid logged no
 *     developer diagnostics;
 *   - at 400px wide the page does not scroll sideways and the panels stack.
 *
 * Exits non-zero when any of that fails, so it can gate a deployment.
 *
 * Usage: node tools/verify.mjs [--shots <dir>] [--live]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const shotIndex = args.indexOf('--shots');
const shotDir = shotIndex >= 0 ? resolve(args[shotIndex + 1]) : null;
/* The page is checked on the recording by default: a check that needed the
   live internet would fail for reasons that are not the page's. */
const useLive = args.includes('--live');

/** The release every library tag must name, and what each file leaves. */
const GRID_VERSION = '1.66.0';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@${GRID_VERSION}/`;
const LIBRARY_TAGS = [
  { file: 'lattice-grid.min.js', global: 'LatticeGrid', member: 'createGrid' },
  { file: 'modules/charts.min.js', global: 'LatticeGrid', member: 'createChart' },
  /* The marker map leaves no global of its own: it registers a chart type with
     the charts module, so what it left behind is a `markermap` that draws. */
  { file: 'modules/chart-markermap.min.js', global: null, member: null },
  { file: 'modules/data-router.min.js', global: 'LatticeGridDataRouter', member: 'createDataRouter' },
  { file: 'modules/kpi.min.js', global: 'LatticeGridKPI', member: 'createKPI' },
  { file: 'modules/layout.min.js', global: 'LatticeGridLayout', member: 'createLayout' },
  { file: 'modules/mock-socket.min.js', global: 'LatticeGridMockSocket', member: 'MockWebSocket' },
];

/** The ten panels, by id, in the order the page declares them. */
const PANEL_IDS = ['header', 'map', 'alarms', 'topology', 'services', 'traffic', 'links', 'trend', 'sites', 'customers'];
/** The only four words a panel may use to say where its numbers came from. */
const PROVENANCE = ['live', 'recorded', 'derived', 'simulated'];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

/** The first browser on this machine that actually exists. */
async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  throw new Error(`No browser found. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}\nSet CHROME_PATH to point at one.`);
}

/** This check needs Node's built-in WebSocket, which arrived in Node 22. */
function requireModernNode() {
  if (typeof WebSocket === 'undefined') {
    throw new Error(
      `This check needs Node 22 or newer. You are running ${process.version}, which has no built in WebSocket.`,
    );
  }
}

/** A free TCP port, asked of the operating system. */
function freePort() {
  return new Promise((ok, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

const failures = [];
const notes = [];

/** Record a check and its outcome. */
function check(ok, description, detail) {
  if (ok) {
    notes.push(`  ok   ${description}${detail ? ` (${detail})` : ''}`);
  } else {
    failures.push(`${description}${detail ? ` (${detail})` : ''}`);
    notes.push(`  FAIL ${description}${detail ? ` (${detail})` : ''}`);
  }
}

let browser;
let browserPid = null;
let profile;
let server;

try {
  requireModernNode();
  const chromePath = await findChrome();
  const started = await startServer(0);
  server = started.server;
  const origin = `http://127.0.0.1:${started.port}`;
  console.log(`Browser: ${chromePath}`);
  console.log(`Serving: ${origin}`);
  console.log(`Feed:    ${useLive ? 'live' : 'the recording in data/ris-capture.json'}`);

  profile = await mkdtemp(join(tmpdir(), 'noc-umd-demo-verify-'));
  const port = await freePort();
  browser = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  browserPid = browser.pid;
  browser.stderr.on('data', () => {});

  let wsUrl;
  for (let i = 0; i < 150 && !wsUrl; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) wsUrl = (await response.json()).webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('the browser never opened its debugging port');

  const socket = new WebSocket(wsUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = () => fail(new Error('could not attach to the browser'));
  });

  let nextId = 0;
  const pending = new Map();
  let consoleErrors = [];
  let pageErrors = [];
  /* Everything the page said, at any level. A `[lattice]` diagnostic is a
     warn, not an error, so a check that only watched errors never saw one. */
  let diagnostics = [];

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const { resolve: ok, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else ok(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (message.params.type === 'error') consoleErrors.push(text);
      if (/\[lattice\]/.test(text)) diagnostics.push(text);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      pageErrors.push(details.exception?.description || details.text);
    }
    if (message.method === 'Log.entryAdded') {
      const text = message.params.entry.text || '';
      if (message.params.entry.level === 'error') consoleErrors.push(text);
      if (/\[lattice\]/.test(text)) diagnostics.push(text);
    }
  };

  const send = (method, params = {}, sessionId) =>
    new Promise((ok, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: ok, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    }
    return result.result.value;
  };

  const waitFor = async (expression, timeout, what) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      let value;
      try {
        value = await evaluate(expression);
      } catch {}
      if (value) return value;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  const query = useLive ? '' : '?live=0';

  /**
   * Open the page with a clean error log and wait for it to report in.
   *
   * It waits on the page's own state rather than on a clock: the wall is
   * ready when it says it is ready and its alarm table has painted, not after
   * some number of seconds.
   */
  const open = async (url, label) => {
    consoleErrors = [];
    pageErrors = [];
    diagnostics = [];
    console.log(`\n--- ${label} ---\n${url}`);
    await call('Page.navigate', { url });
    await waitFor('!!(window.__nocDemo)', 120000, `${label} to load`);
    const state = await evaluate('({ ready: window.__nocDemo.ready, error: window.__nocDemo.error || null })');
    if (!state.ready) throw new Error(`${label} reported a failure: ${state.error}`);
    await waitFor('window.__nocDemo.sitesGrid && window.__nocDemo.sitesGrid.rows.count() > 0', 60000,
      `${label} site rows`);
  };

  /** Save a screenshot, when a directory was asked for. */
  const shoot = async (name) => {
    if (!shotDir) return;
    await mkdir(shotDir, { recursive: true });
    const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const file = join(shotDir, `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(`  shot ${file}`);
  };

  /** Complain about anything the page logged. */
  const noErrors = (label) => {
    check(consoleErrors.length === 0, `${label}: no console errors`, consoleErrors.slice(0, 3).join(' | '));
    check(pageErrors.length === 0, `${label}: no page errors`, pageErrors.slice(0, 3).join(' | '));
    check(diagnostics.length === 0, `${label}: the grid logged no [lattice] diagnostics`,
      diagnostics.slice(0, 4).join(' | '));
  };

  /* =================================================================== */
  /* The saved copy, recomputed here so the page's figures are checked    */
  /* against something other than the page.                              */
  /* =================================================================== */

  const read = async (name) => JSON.parse(await readFile(join(root, 'data', 'snapshot', name), 'utf8'));
  const meta = await read('meta.json');
  const sites = await read('sites.json');
  const collectors = await read('collectors.json');
  const routing = await read('routing.json');
  const outages = await read('outages.json');
  const latency = await read('latency.json');
  const churn = await read('churn.json');
  const capture = JSON.parse(await readFile(join(root, 'data', 'ris-capture.json'), 'utf8'));

  const placed = sites.filter((s) => typeof s.lat === 'number' && typeof s.lon === 'number');
  const countries = new Set(sites.map((s) => s.country)).size;
  const trendDays = outages.days.length;

  console.log(`  snapshot: built ${meta.builtAt}; ${sites.length} sites (${placed.length} placed) in ${countries} `
    + `countries, ${collectors.length} collectors, ${latency.pairs.length} measured link pairs, `
    + `${trendDays} days of outage detections, ${churn.buckets.length} update-activity buckets`);
  console.log(`  recording: ${capture.counts.messages} messages over ${Math.round(capture.durationMs / 1000)}s `
    + `(${capture.ratePerMinute}/min), ${capture.counts.withdrawals} withdrawals, `
    + `${capture.counts.recoveries} recoveries, ${capture.events.length} events kept`);

  /* =================================================================== */
  /* 1. The wall.                                                         */
  /* =================================================================== */

  await open(`${origin}/index.html${query}`, 'the wall');

  /* ---- how the library arrived ---- */

  const delivery = await evaluate(`(() => {
    const scripts = [...document.querySelectorAll('script')];
    return {
      moduleScripts: scripts.filter((s) => s.type === 'module').length,
      importmaps: scripts.filter((s) => s.type === 'importmap').length,
      librarySrcs: scripts.map((s) => s.getAttribute('src') || '').filter((src) => /cdn\\.jsdelivr\\.net/.test(src)),
      withIntegrity: scripts.filter((s) => /cdn\\.jsdelivr\\.net/.test(s.src) && s.integrity).length,
      stylesheetSrc: (document.querySelector('link[rel=stylesheet][href*="cdn.jsdelivr.net"]') || {}).href || null,
      stylesheetIntegrity: (document.querySelector('link[rel=stylesheet][href*="cdn.jsdelivr.net"]') || {}).integrity || null,
      members: {
        createGrid: typeof (window.LatticeGrid || {}).createGrid,
        setLicence: typeof (window.LatticeGrid || {}).setLicence,
        createChart: typeof (window.LatticeGrid || {}).createChart,
        createDataRouter: typeof (window.LatticeGridDataRouter || {}).createDataRouter,
        createKPI: typeof (window.LatticeGridKPI || {}).createKPI,
        createLayout: typeof (window.LatticeGridLayout || {}).createLayout,
        MockWebSocket: typeof (window.LatticeGridMockSocket || {}).MockWebSocket,
      },
    };
  })()`);
  console.log(`  library tags: ${delivery.librarySrcs.length} from the CDN, ${delivery.withIntegrity} with an `
    + `integrity hash; module scripts on the page: ${delivery.moduleScripts}`);
  check(delivery.moduleScripts === 0, 'delivery: no type="module" script on the page', `${delivery.moduleScripts}`);
  check(delivery.importmaps === 0, 'delivery: no import map on the page', `${delivery.importmaps}`);
  check(
    delivery.librarySrcs.length === LIBRARY_TAGS.length,
    `delivery: ${LIBRARY_TAGS.length} library script tags point at the CDN`,
    `${delivery.librarySrcs.length}`,
  );
  for (const tag of LIBRARY_TAGS) {
    const wanted = `${CDN_BASE}${tag.file}`;
    check(delivery.librarySrcs.includes(wanted),
      `delivery: ${tag.file} is loaded from the pinned ${GRID_VERSION} release`, wanted);
    if (tag.member) {
      check(delivery.members[tag.member] === 'function',
        `delivery: ${tag.file} left ${tag.global}.${tag.member} behind`, delivery.members[tag.member]);
    }
  }
  check(delivery.withIntegrity === LIBRARY_TAGS.length, 'delivery: every library tag carries an integrity hash',
    `${delivery.withIntegrity} of ${LIBRARY_TAGS.length}`);
  check(
    delivery.stylesheetSrc === `${CDN_BASE}lattice-grid.min.css`,
    `delivery: the stylesheet is loaded from the pinned ${GRID_VERSION} release`,
    delivery.stylesheetSrc,
  );
  check(!!delivery.stylesheetIntegrity, 'delivery: the stylesheet carries an integrity hash');

  /* ---- what was loaded ---- */

  const loaded = await evaluate(`(() => {
    const d = window.__nocDemo;
    return {
      sites: d.sitesGrid.rows.count(),
      alarms: d.alarmsGrid.rows.count(),
      services: d.servicesGrid.rows.count(),
      links: d.linksGrid.rows.count(),
      customers: d.customersGrid.rows.count(),
      traffic: d.trafficGrid.rows.count(),
      trend: d.trendGrid.rows.count(),
      topology: d.topologyGrid.rows.count(),
      states: d.statusGrid.rows.count(),
      chips: d.chipsGrid.rows.count(),
      tiles: d.kpi.tiles().length,
      routes: d.router.metrics().routes.map((r) => ({ label: r.label, rows: r.rows })),
      watermark: d.sitesGrid.licence.watermark(),
      feed: { mode: d.feed.state.mode, note: d.feed.state.note },
      live: d.live,
    };
  })()`);
  console.log(`  rows: ${loaded.sites} sites, ${loaded.services} services, ${loaded.links} links, `
    + `${loaded.customers} customers, ${loaded.traffic} traffic samples, ${loaded.trend} trend rows, `
    + `${loaded.topology} core links, ${loaded.alarms} alarms`);
  console.log(`  routes: ${JSON.stringify(loaded.routes)}`);
  console.log(`  feed: ${loaded.feed.mode}${loaded.feed.note ? ` (${loaded.feed.note})` : ''}`);

  check(loaded.sites === sites.length, 'every saved site reached the map’s grid',
    `${loaded.sites} of ${sites.length}`);
  check(loaded.services === 7, 'the service catalogue holds seven services', `${loaded.services}`);
  check(loaded.links === latency.pairs.length, 'one link per measured anchor pair',
    `${loaded.links} of ${latency.pairs.length}`);
  check(loaded.traffic === 576, 'a day of traffic at five minute steps, inbound and outbound',
    `${loaded.traffic}`);
  check(loaded.trend === trendDays * 3, 'the trend holds three severities for each saved day',
    `${loaded.trend} for ${trendDays} days`);
  check(loaded.states === 4, 'the donut has a slice per state', `${loaded.states}`);
  check(loaded.topology > 8, 'the core topology holds links', `${loaded.topology}`);
  check(loaded.routes.length >= 10, 'the router is driving ten viewers off the one stream',
    `${loaded.routes.length}`);
  check(loaded.watermark === false, 'no watermark on localhost');
  check(loaded.feed.mode === (useLive ? 'live' : 'recorded'),
    `the feed is ${useLive ? 'live' : 'the recording'}`, loaded.feed.mode);
  check(loaded.tiles === 10, 'the top strip carries ten tiles, two of them clocks', `${loaded.tiles}`);

  /* ---- the masthead says what the saved copy says ---- */

  const masthead = await evaluate(`(() => ({
    title: (document.querySelector('.head h1') || {}).textContent || '',
    sub: (document.querySelector('.head-sub') || {}).textContent || '',
    badge: (document.querySelector('.status-words') || {}).textContent || '',
    pill: (document.querySelector('.head-controls .pill') || {}).textContent || '',
  }))()`);
  console.log(`  masthead: "${masthead.title}" / "${masthead.sub}"`);
  check(masthead.sub.includes(String(sites.length)), 'the masthead states the real number of sites', masthead.sub);
  check(masthead.sub.includes(String(routing.prefixesV4)),
    'and the real number of announced prefixes', masthead.sub);
  check(masthead.sub.includes(String(routing.neighbours)), 'and the real number of observed neighbours', masthead.sub);

  /* ---- the honesty banner ---- */

  const banner = await evaluate(`(() => ({
    tags: [...document.querySelectorAll('.banner-item .prov-tag')].map((e) => e.textContent.trim()),
    texts: [...document.querySelectorAll('.banner-item .prov-text')].map((e) => e.textContent.trim()),
  }))()`);
  console.log(`  banner classes: ${banner.tags.join(', ')}`);
  check(banner.tags.length === 4, 'the banner names all four classes of number', banner.tags.join(', '));
  for (const word of ['Live', 'Recorded', 'Derived', 'Simulated']) {
    check(banner.tags.includes(word), `the banner names "${word}"`, banner.tags.join(', '));
  }
  check(banner.texts.every((t) => t.length > 40), 'and says what each one means', `${banner.texts.length} lines`);
  const simulated = banner.texts[3] || '';
  check(/not named here/i.test(simulated), 'the banner says the real carrier is not named', simulated.slice(0, 120));

  /* =================================================================== */
  /* 2. The layout: ten windows, and they move.                           */
  /* =================================================================== */

  const windows = await evaluate(`(() => {
    const d = window.__nocDemo;
    const ids = d.layout.windows();
    return {
      ids,
      specs: ids.map((id) => d.layout.window(id)),
      payloads: ids.map((id) => {
        const body = d.layout.payload(id);
        return {
          id,
          provenance: body.dataset.provenance || null,
          caption: (body.querySelector('.panel-caption') || {}).textContent || '',
          height: Math.round(body.getBoundingClientRect().height),
          width: Math.round(body.getBoundingClientRect().width),
          children: body.querySelectorAll('.panel-body > *').length,
        };
      }),
      titles: [...document.querySelectorAll('.lat-layout__window-title, .lat-window__title, [class*="window-title"]')]
        .map((e) => e.textContent.trim()),
    };
  })()`);
  console.log(`  windows: ${windows.ids.join(', ')}`);
  check(windows.ids.length === PANEL_IDS.length, 'the layout holds one window per panel',
    `${windows.ids.length}: ${windows.ids.join(', ')}`);
  for (const id of PANEL_IDS) {
    check(windows.ids.includes(id), `the layout holds the "${id}" window`, windows.ids.join(', '));
  }
  for (const payload of windows.payloads) {
    check(PROVENANCE.includes(payload.provenance),
      `the "${payload.id}" panel declares where its numbers come from`, String(payload.provenance));
    check(payload.caption.length > 30, `the "${payload.id}" panel says so in words under its title`,
      payload.caption.slice(0, 60));
    check(payload.height > 60 && payload.width > 60, `the "${payload.id}" panel has a size`,
      `${payload.width}x${payload.height}`);
    check(payload.children > 0, `the "${payload.id}" panel has something in it`, `${payload.children}`);
  }
  const masthead2 = windows.specs.find((s) => s.id === 'header');
  check(masthead2 && masthead2.movable === false, 'the top strip is the one window that does not wander',
    JSON.stringify(masthead2 && { movable: masthead2.movable, resizable: masthead2.resizable }));

  await shoot('01-wall-1440');

  /* ---- moving one ---- */

  const moved = await evaluate(`(async () => {
    const d = window.__nocDemo;
    const before = d.layout.window('customers');
    const ok = await d.layout.move('customers', { xPos: 1, yPos: 9, xSize: 6, ySize: 2 });
    await new Promise((r) => setTimeout(r, 400));
    const after = d.layout.window('customers');
    const grid = d.customersGrid;
    return {
      ok: !!ok,
      before: { x: before.xPos, y: before.yPos, w: before.xSize },
      after: { x: after.xPos, y: after.yPos, w: after.xSize },
      snapshot: d.layout.getLayout().windows.find((w) => w.id === 'customers'),
      rowsStillThere: grid.rows.count(),
      paintedStillThere: d.layout.payload('customers').querySelectorAll('.lat-row[data-index]').length,
      bodyWidth: Math.round(d.layout.payload('customers').getBoundingClientRect().width),
    };
  })()`);
  console.log(`  moving the customers window: ${JSON.stringify(moved.before)} -> ${JSON.stringify(moved.after)}`);
  check(moved.ok, 'a window can be moved through the layout module');
  check(moved.after.x === 1 && moved.after.y === 9 && moved.after.w === 6,
    'and it lands where it was sent', JSON.stringify(moved.after));
  check(moved.snapshot && moved.snapshot.xPos === 1 && moved.snapshot.yPos === 9,
    'and the arrangement the module reports back says so', JSON.stringify(moved.snapshot));
  check(moved.rowsStillThere > 0 && moved.paintedStillThere > 0,
    'and the grid inside it survived the move with its rows painted',
    `${moved.rowsStillThere} rows, ${moved.paintedStillThere} painted`);

  /* ---- resizing one, and the payload following ---- */

  const resized = await evaluate(`(async () => {
    const d = window.__nocDemo;
    const body = d.layout.payload('links');
    const before = Math.round(body.getBoundingClientRect().width);
    let announced = null;
    const listener = (event) => { if (event.id === 'links') announced = event; };
    d.layout.on('window:resized', listener);
    await d.layout.move('links', { xPos: 1, yPos: 7, xSize: 8, ySize: 2 });
    await new Promise((r) => setTimeout(r, 600));
    const after = Math.round(body.getBoundingClientRect().width);
    d.layout.off('window:resized', listener);
    return { before, after, announced, grid: d.linksGrid.rows.count() };
  })()`);
  console.log(`  resizing the links window: ${resized.before}px -> ${resized.after}px; `
    + `window:resized reported ${JSON.stringify(resized.announced)}`);
  check(resized.after > resized.before + 40, 'resizing a window widens its payload',
    `${resized.before} -> ${resized.after}`);
  check(!!resized.announced && Math.round(resized.announced.width) > 0,
    'and the module announces the new content box', JSON.stringify(resized.announced));

  /* ---- maximise, minimise, restore ---- */

  const modes = await evaluate(`(async () => {
    const d = window.__nocDemo;
    const arrangement = JSON.stringify(d.layout.getLayout());
    d.layout.maximise('map');
    await new Promise((r) => setTimeout(r, 500));
    const big = {
      id: d.layout.maximised(),
      width: Math.round(d.layout.payload('map').getBoundingClientRect().width),
      others: d.layout.windows().filter((id) => id !== 'map')
        .filter((id) => d.layout.payload(id).getBoundingClientRect().height > 1).length,
    };
    d.layout.restore('map');
    await new Promise((r) => setTimeout(r, 500));
    const small = {
      id: d.layout.maximised(),
      width: Math.round(d.layout.payload('map').getBoundingClientRect().width),
    };
    d.layout.minimise('trend');
    await new Promise((r) => setTimeout(r, 400));
    const collapsed = {
      ids: d.layout.minimised(),
      height: Math.round(d.layout.payload('trend').getBoundingClientRect().height),
    };
    d.layout.restore('trend');
    await new Promise((r) => setTimeout(r, 400));
    const back = {
      ids: d.layout.minimised(),
      height: Math.round(d.layout.payload('trend').getBoundingClientRect().height),
      arrangement: JSON.stringify(d.layout.getLayout()),
    };
    return { arrangement, big, small, collapsed, back, charts: d.mapChart.data().series.length };
  })()`);
  console.log(`  maximise: ${modes.big.id} at ${modes.big.width}px with ${modes.big.others} other windows visible; `
    + `restored to ${modes.small.width}px`);
  console.log(`  minimise: ${JSON.stringify(modes.collapsed)} -> ${JSON.stringify(modes.back.ids)}`);
  check(modes.big.id === 'map', 'a window can be blown up to fill the wall', String(modes.big.id));
  check(modes.big.width > modes.small.width + 100, 'and it is wider while it is',
    `${modes.big.width} against ${modes.small.width}`);
  check(modes.big.others === 0, 'and the rest of the wall gets out of the way', `${modes.big.others} still drawn`);
  check(modes.small.id === null, 'restoring puts it back', String(modes.small.id));
  check(modes.collapsed.ids.includes('trend'), 'a window can be collapsed to its title bar',
    modes.collapsed.ids.join(', '));
  check(modes.collapsed.height < 40, 'and its body goes away while it is', `${modes.collapsed.height}px`);
  check(modes.back.ids.length === 0 && modes.back.height > 40, 'and comes back',
    `${modes.back.ids.length} collapsed, ${modes.back.height}px`);
  check(modes.back.arrangement === modes.arrangement,
    'and neither mode changed the arrangement underneath');

  /* ---- the arrangement survives a reload ---- */

  const savedBefore = await evaluate(`(() => {
    const d = window.__nocDemo;
    d.saveLayout();
    return JSON.stringify(d.layout.getLayout().windows.find((w) => w.id === 'customers'));
  })()`);
  await sleep(600);
  await open(`${origin}/index.html${query}`, 'the wall, reopened');
  const savedAfter = await evaluate(`(() => {
    const d = window.__nocDemo;
    return {
      customers: JSON.stringify(d.layout.getLayout().windows.find((w) => w.id === 'customers')),
      restored: d.restored,
    };
  })()`);
  console.log(`  the saved arrangement: ${savedBefore} -> ${savedAfter.customers} (restored: ${savedAfter.restored})`);
  check(savedAfter.restored === true, 'the wall reopens on the arrangement it was left in');
  check(savedAfter.customers === savedBefore, 'and it is the same arrangement, window for window',
    `${savedAfter.customers} against ${savedBefore}`);

  /* And "Reset layout" puts it back to the one the page ships with. */
  const reset = await evaluate(`(async () => {
    document.querySelector('.head-controls .control:last-child').click();
    await new Promise((r) => setTimeout(r, 500));
    const d = window.__nocDemo;
    return JSON.stringify(d.layout.getLayout().windows.find((w) => w.id === 'customers'));
  })()`);
  console.log(`  after Reset layout: ${reset}`);
  check(reset !== savedBefore, 'Reset layout puts the wall back to the arrangement it ships with', reset);
  check(JSON.parse(reset).xPos === 10, 'which is the one the page declares', reset);

  /* ---- locking ---- */

  const locking = await evaluate(`(async () => {
    const button = document.querySelector('.head-controls .control');
    const d = window.__nocDemo;
    const before = d.layout.getInteractive();
    button.click();
    await new Promise((r) => setTimeout(r, 300));
    const locked = d.layout.getInteractive();
    const refused = await d.layout.move('customers', { xPos: 1, yPos: 9, xSize: 3, ySize: 2 });
    await new Promise((r) => setTimeout(r, 300));
    const where = d.layout.window('customers');
    button.click();
    await new Promise((r) => setTimeout(r, 300));
    return { before, locked, label: button.textContent, refused: !!refused, xPos: where.xPos,
      unlocked: d.layout.getInteractive() };
  })()`);
  console.log(`  locking: ${JSON.stringify(locking)}`);
  check(locking.locked && locking.locked.movable === false, 'the wall can be locked against rearranging',
    JSON.stringify(locking.locked));
  check(locking.unlocked && locking.unlocked.movable === true, 'and unlocked again',
    JSON.stringify(locking.unlocked));

  /* =================================================================== */
  /* 3. The map.                                                          */
  /* =================================================================== */

  const map = await evaluate(`(() => {
    const d = window.__nocDemo;
    const data = d.mapChart.data();
    const element = d.mapChart.element;
    const dots = [...element.querySelectorAll('[class*="markermap-dot"]')];
    const fills = {};
    for (const dot of dots) {
      const fill = dot.getAttribute('fill') || '';
      fills[fill] = (fills[fill] || 0) + 1;
    }
    return {
      keys: Object.keys(data),
      unplaced: data.unplaced,
      dots: dots.length,
      fills,
      shapes: element.querySelectorAll('path[class*="region"], path[class*="shape"], path[class*="geo"]').length,
      legend: [...element.querySelectorAll('[class*="legend"] text, [class*="legend-label"]')]
        .map((e) => e.textContent.trim()).filter(Boolean),
      empty: !!data.empty,
    };
  })()`);
  console.log(`  map: ${map.dots} markers, ${map.unplaced} unplaced, outlines ${map.shapes}`);
  console.log(`  marker colours: ${JSON.stringify(map.fills)}`);
  console.log(`  map legend: ${map.legend.join(' | ')}`);
  check(map.dots === placed.length, 'the map draws a marker for every site the saved copy places',
    `${map.dots} markers for ${placed.length} placed sites`);
  check(map.unplaced === sites.length - placed.length,
    'and counts the sites whose coordinates the saved copy does not hold',
    `${map.unplaced}, expected ${sites.length - placed.length}`);
  check(map.shapes > 100, 'the country outlines are drawn underneath', `${map.shapes} shapes`);
  check(map.empty === false, 'the map is not showing its empty state');
  const stateColours = ['#2f9e5e', '#d99b1c', '#d2453b', '#5c7a99'];
  const usedColours = Object.keys(map.fills).filter((f) => stateColours.includes(f.toLowerCase()));
  check(usedColours.length >= 2, 'the markers take their colours from the site rules rather than one flat colour',
    Object.keys(map.fills).join(', '));
  check(map.legend.length > 0, 'and the legend lists the rules that fired', map.legend.join(', '));

  /* ---- clicking a marker narrows the alarm table ---- */

  const linked = await evaluate(`(async () => {
    const d = window.__nocDemo;
    /* A site the recording will raise alarms against: the one the collectors
       are placed at. Chosen from the page's own mapping rather than written
       down here twice. */
    const withAlarms = [];
    d.alarmsGrid.rows.forEach((r) => { if (r && r.data && r.data.siteId) withAlarms.push(r.data.siteId); });
    const siteId = withAlarms[0] || d.sitesGrid.rows.data()[0].id;
    const before = d.alarmsGrid.rows.count();
    d.sitesGrid.selection.set([siteId]);
    d.router.flush();
    await new Promise((r) => setTimeout(r, 500));
    const after = d.alarmsGrid.rows.count();
    const sitesShown = new Set();
    d.alarmsGrid.rows.forEach((r) => { if (r && r.data) sitesShown.add(r.data.siteId); });
    d.sitesGrid.selection.set([]);
    d.router.flush();
    await new Promise((r) => setTimeout(r, 500));
    return { siteId, before, after, shown: [...sitesShown], restored: d.alarmsGrid.rows.count() };
  })()`);
  console.log(`  selecting site ${linked.siteId}: ${linked.before} alarms -> ${linked.after} -> ${linked.restored}`);
  check(linked.after <= linked.before, 'selecting a site narrows the alarm table',
    `${linked.before} -> ${linked.after}`);
  check(linked.shown.length <= 1, 'to that site alone', linked.shown.join(', '));
  check(linked.restored === linked.before, 'and clearing the selection gives the whole table back',
    `${linked.restored} against ${linked.before}`);

  /* =================================================================== */
  /* 4. The topology.                                                     */
  /* =================================================================== */

  const topology = await evaluate(`(() => {
    const d = window.__nocDemo;
    const element = d.topologyChart.element;
    const links = [...element.querySelectorAll('[class*="network-link"], line[class*="link"], path[class*="link"]')];
    const strokes = {};
    for (const link of links) {
      const stroke = link.getAttribute('stroke') || '';
      strokes[stroke] = (strokes[stroke] || 0) + 1;
    }
    return {
      nodes: element.querySelectorAll('[class*="network-node"], g[class*="node"]').length,
      icons: element.querySelectorAll('[class*="node"] path, [class*="node-icon"] path').length,
      labels: [...element.querySelectorAll('[class*="node-label"], text')].map((t) => t.textContent.trim())
        .filter(Boolean),
      links: links.length,
      strokes,
      rows: d.topologyGrid.rows.count(),
      redundant: d.topologyGrid.rows.data().filter((r) => r.redundant).length,
    };
  })()`);
  console.log(`  topology: ${topology.nodes} nodes, ${topology.links} links, `
    + `${topology.redundant} of ${topology.rows} rows are a second circuit on a pair`);
  console.log(`  link colours: ${JSON.stringify(topology.strokes)}`);
  check(topology.links >= topology.rows, 'the topology draws a line for every core link row',
    `${topology.links} lines for ${topology.rows} rows`);
  check(topology.redundant > 0, 'some pairs carry a second circuit, drawn beside the first',
    `${topology.redundant}`);
  check(Object.keys(topology.strokes).length > 1,
    'the links take more than one colour, from the load rules on the table',
    Object.keys(topology.strokes).join(', '));
  check(topology.labels.some((t) => /core/i.test(t)), 'the nodes are labelled', topology.labels.slice(0, 6).join(', '));
  check(topology.icons > 0, 'and drawn with a glyph rather than a bare disc', `${topology.icons} paths`);

  /* =================================================================== */
  /* 5. A routing withdrawal reaches everything.                          */
  /* =================================================================== */

  /*
   * The heart of it. One RIS Live message is pushed into the page through the
   * same reader the socket feeds, and four separate things have to move: the
   * alarm table, the tiles, the ticker, and the colour of a marker on the map.
   */
  /*
   * The feed is held first, so the only thing moving while this is measured is
   * the message pushed in below. A wall that is still taking events would make
   * every "before" and "after" a race.
   */
  await evaluate('window.__nocDemo.pauseFeed(); window.__nocDemo.drain();');
  await sleep(600);

  const collectorWithSite = await evaluate(`(() => {
    const d = window.__nocDemo;
    /* A collector sitting beside a site that is quiet at this moment, so the
       one injected withdrawal is the whole of the change. */
    for (const [id, collector] of d.world.collectors) {
      if (!collector.siteId) continue;
      const site = d.world.sites.get(collector.siteId);
      if (site && site.state === 'healthy' && site.alarms === 0) {
        return { id, siteId: collector.siteId, city: collector.city, site: collector.siteName };
      }
    }
    return null;
  })()`);
  console.log(`  the collector the injected event is attributed to: ${JSON.stringify(collectorWithSite)}`);
  check(!!collectorWithSite,
    'a RIS collector sits beside a site that is operational and quiet, to inject against',
    JSON.stringify(collectorWithSite));

  const injected = await evaluate(`(async () => {
    const d = window.__nocDemo;
    const collector = ${JSON.stringify(collectorWithSite)};
    const prefix = '203.0.113.0/24';
    const fillsOf = () => {
      const out = {};
      for (const dot of d.mapChart.element.querySelectorAll('[class*="markermap-dot"]')) {
        const fill = (dot.getAttribute('fill') || '').toLowerCase();
        out[fill] = (out[fill] || 0) + 1;
      }
      return out;
    };
    const before = {
      alarms: d.alarmsGrid.rows.count(),
      incidents: d.kpi.tile('incidents').value,
      state: d.sitesGrid.rows.value(collector.siteId, 'stateLabel'),
      siteAlarms: d.sitesGrid.rows.value(collector.siteId, 'alarms'),
      availability: d.sitesGrid.rows.value(collector.siteId, 'availability'),
      fills: fillsOf(),
      ticker: (document.querySelector('.ticker-line') || {}).textContent || '',
    };
    /* Exactly the shape RIS Live sends, so the page cannot tell it apart. */
    d.injectMessage({
      type: 'ris_message',
      data: {
        timestamp: Date.now() / 1000,
        host: collector.id + '.ripe.net',
        peer_asn: '64500',
        type: 'UPDATE',
        path: [64500, 64501],
        announcements: [],
        withdrawals: [prefix],
      },
    });
    await new Promise((r) => setTimeout(r, 900));
    const after = {
      alarms: d.alarmsGrid.rows.count(),
      incidents: d.kpi.tile('incidents').value,
      state: d.sitesGrid.rows.value(collector.siteId, 'stateLabel'),
      siteAlarms: d.sitesGrid.rows.value(collector.siteId, 'alarms'),
      availability: d.sitesGrid.rows.value(collector.siteId, 'availability'),
      fills: fillsOf(),
      ticker: (document.querySelector('.ticker-line') || {}).textContent || '',
      row: (() => {
        let found = null;
        d.alarmsGrid.rows.forEach((r) => { if (r && r.data && r.data.prefix === prefix) found = r.data; });
        return found;
      })(),
      painted: [...d.alarmsGrid.element.querySelectorAll('.lat-body-viewport [role="gridcell"]')]
        .map((c) => c.textContent).filter((t) => t.includes(prefix)).length,
    };
    return { prefix, before, after };
  })()`);
  console.log(`  injected a withdrawal of ${injected.prefix}:`);
  console.log(`    alarms ${injected.before.alarms} -> ${injected.after.alarms}, `
    + `incidents tile ${injected.before.incidents} -> ${injected.after.incidents}`);
  console.log(`    the site's state ${injected.before.state} -> ${injected.after.state}, `
    + `availability ${injected.before.availability} -> ${injected.after.availability}, `
    + `its live alarm count ${injected.before.siteAlarms} -> ${injected.after.siteAlarms}`);
  console.log(`    marker colours ${JSON.stringify(injected.before.fills)} -> ${JSON.stringify(injected.after.fills)}`);

  check(injected.after.alarms === injected.before.alarms + 1,
    'an injected withdrawal adds one row to the alarm table',
    `${injected.before.alarms} -> ${injected.after.alarms}`);
  check(!!injected.after.row && injected.after.row.description.includes(injected.prefix),
    'and the row names the prefix that was withdrawn',
    injected.after.row && injected.after.row.description);
  check(!!injected.after.row && injected.after.row.sourceShort === 'BGP',
    'and says it came from the routing feed', injected.after.row && injected.after.row.source);
  check(!!injected.after.row && injected.after.row.severityLabel === 'Major',
    'and is raised as a major alarm', injected.after.row && injected.after.row.severityLabel);
  check(injected.after.painted > 0, 'and the table actually painted it',
    `${injected.after.painted} cells carrying the prefix`);
  check(injected.after.incidents === injected.before.incidents + 1,
    'the active incidents tile counts it',
    `${injected.before.incidents} -> ${injected.after.incidents}`);
  check(injected.after.siteAlarms === injected.before.siteAlarms + 1,
    'the site it was observed at counts it',
    `${injected.before.siteAlarms} -> ${injected.after.siteAlarms}`);
  check(injected.after.availability < injected.before.availability,
    'and its availability falls by the rule the panel states',
    `${injected.before.availability} -> ${injected.after.availability}`);
  check(injected.after.ticker.includes(injected.prefix), 'and the ticker says so',
    injected.after.ticker.slice(0, 120));
  /* The map: one more marker in the degraded colour, one fewer in the healthy
     one. This is the assertion that the router carried the change all the way
     to a drawn pixel. */
  const healthy = '#2f9e5e';
  const degraded = '#d99b1c';
  const wasHealthy = injected.before.fills[healthy] || 0;
  const nowHealthy = injected.after.fills[healthy] || 0;
  const wasDegraded = injected.before.fills[degraded] || 0;
  const nowDegraded = injected.after.fills[degraded] || 0;
  check(injected.before.state === 'Operational' && injected.after.state === 'Partial',
    'the site it was observed at goes from operational to partial',
    `${injected.before.state} -> ${injected.after.state}`);
  check(nowDegraded === wasDegraded + 1 && nowHealthy === wasHealthy - 1,
    'and its marker on the map changes colour, so the router carried it to a drawn pixel',
    `green ${wasHealthy} -> ${nowHealthy}, amber ${wasDegraded} -> ${nowDegraded}`);

  await evaluate('window.__nocDemo.resumeFeed();');

  await shoot('02-wall-after-injection');

  /* ---- the severity chips narrow the table too ---- */

  const chips = await evaluate(`(async () => {
    const d = window.__nocDemo;
    const buttons = [...document.querySelectorAll('.chip')];
    const before = d.alarmsGrid.rows.count();
    const major = buttons.find((b) => b.dataset.chip === 'major');
    major.click();
    d.router.flush();
    await new Promise((r) => setTimeout(r, 500));
    const shown = new Set();
    d.alarmsGrid.rows.forEach((r) => { if (r && r.data) shown.add(r.data.severityLabel); });
    const filtered = d.alarmsGrid.rows.count();
    buttons.find((b) => b.dataset.chip === 'all').click();
    d.router.flush();
    await new Promise((r) => setTimeout(r, 500));
    return {
      labels: buttons.map((b) => b.textContent.trim()),
      before, filtered, shown: [...shown], restored: d.alarmsGrid.rows.count(),
    };
  })()`);
  console.log(`  chips: ${chips.labels.join(' | ')}; all ${chips.before} -> major ${chips.filtered} -> `
    + `${chips.restored}`);
  check(chips.labels.length === 4, 'there is a chip for each severity and one for all of them',
    chips.labels.join(', '));
  check(chips.labels.every((l) => /\d/.test(l)), 'and each one carries its count', chips.labels.join(', '));
  check(chips.filtered <= chips.before, 'choosing a severity narrows the table',
    `${chips.before} -> ${chips.filtered}`);
  check(chips.shown.length <= 1 && (chips.shown[0] === 'Major' || chips.filtered === 0),
    'to that severity alone', chips.shown.join(', '));
  check(chips.restored === chips.before, 'and "All" gives the whole table back',
    `${chips.restored} against ${chips.before}`);

  /* =================================================================== */
  /* 6. The other panels say what the saved copy says.                    */
  /* =================================================================== */

  const panels = await evaluate(`(() => {
    const d = window.__nocDemo;
    const traffic = d.trafficChart.data();
    const trend = d.trendChart.data();
    const donut = d.statusChart.data();
    return {
      services: d.servicesGrid.rows.data().map((r) => ({ name: r.name, availability: r.availability,
        spark: Array.isArray(r.spark) ? r.spark.length : 0 })),
      serviceSparks: d.servicesGrid.element.querySelectorAll('.lat-body-viewport svg, .lat-body-viewport canvas').length,
      links: d.linksGrid.rows.data().map((r) => ({ id: r.id, name: r.name, rtt: r.rtt,
        series: (r.rttSeries || []).length, utilisation: r.utilisation })),
      linkBars: d.linksGrid.element.querySelectorAll('.lat-body-viewport [style*="linear-gradient"]').length,
      traffic: { kind: traffic.kind, series: (traffic.series || []).map((s) => ({ key: String(s.key),
        points: s.points.length })) },
      trend: { kind: trend.kind, series: (trend.series || []).map((s) => ({ key: String(s.key),
        points: s.points.length })), stacked: !!trend.stacked },
      donut: { slices: (donut.series || []).map((s) => (s.points || []).map((p) => ({ x: String(p.x), y: p.y }))) },
      donutTotal: (document.querySelector('.donut-total') || {}).textContent || '',
      customers: d.customersGrid.rows.data().map((r) => ({ name: r.name, sites: r.sites, impact: r.impact })),
      tiles: d.kpi.tiles().map((t) => ({ id: t.id, label: t.label, value: t.value, status: String(t.status),
        formatted: t.formatted })),
      clocks: [...document.querySelectorAll('.kpi-strip .lat-kpi__tile')]
        .map((e) => e.textContent).filter((t) => /UTC|Local/.test(t)),
    };
  })()`);

  console.log(`  services: ${panels.services.map((s) => `${s.name} ${s.availability}%`).join(', ')}`);
  check(panels.services.length === 7, 'seven services', `${panels.services.length}`);
  check(panels.services.every((s) => s.spark === churn.buckets.length),
    'each one carries a point per saved update-activity bucket',
    panels.services.map((s) => s.spark).join(', ') + `; expected ${churn.buckets.length}`);
  check(panels.serviceSparks > 0, 'and the table draws them', `${panels.serviceSparks} drawn cells`);

  console.log(`  links: ${panels.links.map((l) => `${l.name} ${l.utilisation}% ${l.rtt}ms`).join(', ')}`);
  check(panels.links.length === latency.pairs.length, 'one link per measured pair', `${panels.links.length}`);
  for (const link of panels.links) {
    const saved = latency.pairs.find((p) => p.id === link.id);
    check(!!saved && link.rtt === saved.medianMs,
      `the ${link.name} link shows the round trip time the saved copy measured`,
      `${link.rtt}, expected ${saved && saved.medianMs}`);
    check(!!saved && link.series === saved.series.length,
      'and an hourly point for each hour it was measured over',
      `${link.series}, expected ${saved && saved.series.length}`);
  }
  check(panels.linkBars > 0, 'the utilisation column draws a bar behind each figure', `${panels.linkBars}`);

  console.log(`  traffic: ${panels.traffic.kind} axis, ${JSON.stringify(panels.traffic.series)}`);
  check(panels.traffic.series.length === 2, 'the traffic chart draws inbound and outbound',
    panels.traffic.series.map((s) => s.key).join(', '));
  check(panels.traffic.series.every((s) => s.points > 200), 'each over a day of five minute samples',
    panels.traffic.series.map((s) => s.points).join(', '));

  console.log(`  trend: ${JSON.stringify(panels.trend.series)}`);
  check(panels.trend.series.length === 3, 'the trend chart stacks three severities',
    panels.trend.series.map((s) => s.key).join(', '));
  check(panels.trend.series.every((s) => s.points === trendDays),
    'each over the saved days', panels.trend.series.map((s) => s.points).join(', ') + `; expected ${trendDays}`);

  const donutSlices = (panels.donut.slices[0] || []);
  const donutTotal = donutSlices.reduce((sum, slice) => sum + (slice.y || 0), 0);
  console.log(`  donut: ${donutSlices.map((s) => `${s.x} ${s.y}`).join(', ')} = ${donutTotal}`);
  check(donutSlices.length === 4, 'the donut has four slices', `${donutSlices.length}`);
  check(donutTotal === sites.length, 'and they add up to every site',
    `${donutTotal}, expected ${sites.length}`);
  check(panels.donutTotal.includes(String(sites.length)), 'with the total stated beside it', panels.donutTotal);

  check(panels.customers.length === 8, 'eight customers', `${panels.customers.length}`);
  check(panels.customers.every((c) => c.sites > 0), 'each attached to real sites',
    panels.customers.map((c) => c.sites).join(', '));

  const tileIds = panels.tiles.map((t) => t.id);
  console.log(`  tiles: ${panels.tiles.map((t) => `${t.label} ${t.formatted}`).join(' | ')}`);
  check(panels.tiles.length === 10, 'ten tiles on the strip', `${panels.tiles.length}`);
  check(panels.clocks.length === 2, 'two of them are clocks, one UTC and one local',
    panels.clocks.map((c) => c.slice(0, 28)).join(' | '));
  const availabilityTile = panels.tiles.find((t) => t.id === 'availability');
  check(!!availabilityTile && availabilityTile.value > 90 && availabilityTile.value <= 100,
    'the availability tile reads as a percentage', String(availabilityTile && availabilityTile.value));
  const updatesTile = panels.tiles.find((t) => t.id === 'updates');
  check(!!updatesTile && updatesTile.value > 0,
    'the routing update rate tile is reading the feed', String(updatesTile && updatesTile.value));

  /* The status badge and the status tile are graded from the same numbers. */
  const badge = await evaluate(`(() => {
    const d = window.__nocDemo;
    return {
      words: (document.querySelector('.status-words') || {}).textContent || '',
      state: (document.querySelector('.status-badge') || {}).dataset.state || '',
      tile: String(d.kpi.tile('status').status),
      critical: d.counts().critical,
    };
  })()`);
  console.log(`  status: "${badge.words}" (${badge.state}); the tile grades itself ${badge.tile} on `
    + `${badge.critical} critical alarms`);
  check(['All systems operational', 'Degraded', 'Major incident'].includes(badge.words),
    'the badge says one of the three things it can say', badge.words);
  check(badge.state === badge.tile,
    'and the badge and the tile grade the same number the same way',
    `badge ${badge.state}, tile ${badge.tile}`);

  /* =================================================================== */
  /* 7. The house rules.                                                  */
  /* =================================================================== */

  const furniture = await evaluate(`(() => ({
    rails: document.querySelectorAll('.lat-panel-dock').length,
    menus: document.querySelectorAll('.lat-header-menu').length,
    filters: document.querySelectorAll('.lat-header-filter').length,
    ranges: document.querySelectorAll('.lat-cell--range').length,
    fillHandles: document.querySelectorAll('.lat-fill-handle').length,
    reorderTips: [...document.querySelectorAll('[title]')]
      .filter((e) => /to reorder/i.test(e.getAttribute('title') || '')).length,
    movable: document.querySelectorAll('[role="columnheader"][data-movable="true"]').length,
  }))()`);
  console.log(`  furniture: ${JSON.stringify(furniture)}`);
  check(furniture.rails === 0, 'no grid shows the right-hand tool rail', `${furniture.rails}`);
  check(furniture.menus === 0, 'no heading carries a column menu', `${furniture.menus}`);
  check(furniture.filters === 0, 'no heading carries a filter funnel', `${furniture.filters}`);
  check(furniture.reorderTips === 0, 'no heading offers to be dragged to reorder', `${furniture.reorderTips}`);
  check(furniture.movable === 0, 'and none is marked as draggable', `${furniture.movable}`);

  const clicking = await evaluate(`(async () => {
    const d = window.__nocDemo;
    const cell = d.alarmsGrid.element.querySelector('.lat-body-viewport [role="gridcell"]');
    if (cell) {
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    await new Promise((r) => setTimeout(r, 400));
    return {
      ranges: d.alarmsGrid.selection.ranges().length,
      rangeCells: document.querySelectorAll('.lat-cell--range').length,
      fillHandles: document.querySelectorAll('.lat-fill-handle').length,
    };
  })()`);
  console.log(`  after a click on an alarm cell: ${JSON.stringify(clicking)}`);
  check(clicking.ranges === 0, 'clicking a cell starts no cell range', `${clicking.ranges}`);
  check(clicking.rangeCells === 0, 'no cell is drawn as selected', `${clicking.rangeCells}`);
  check(clicking.fillHandles === 0, 'there is no fill handle to grab', `${clicking.fillHandles}`);

  /* Declared widths: every column the page declares names one. */
  const widths = await evaluate(`(() => {
    const d = window.__nocDemo;
    const named = ['alarmsGrid', 'servicesGrid', 'linksGrid', 'customersGrid'];
    const out = {};
    for (const name of named) {
      out[name] = d[name].columns.visible().map((c) => ({ id: c.id, width: (c.layout || {}).width || null }));
    }
    return out;
  })()`);
  for (const [name, columns] of Object.entries(widths)) {
    const undeclared = columns.filter((c) => !c.width).map((c) => c.id);
    check(undeclared.length === 0, `every column on the ${name.replace('Grid', '')} table declares a width`,
      undeclared.join(', '));
  }

  /* Units live in the headings, so a number never has to be guessed at. */
  const headings = await evaluate(`(() => {
    const d = window.__nocDemo;
    return {
      links: d.linksGrid.columns.visible().map((c) => c.title),
      services: d.servicesGrid.columns.visible().map((c) => c.title),
      sites: d.sitesGrid.columns.visible().map((c) => c.title),
      alarms: d.alarmsGrid.columns.visible().map((c) => c.title),
      tiles: d.kpi.tiles().map((t) => t.label),
      trafficAxis: [...d.trafficChart.element.querySelectorAll('text[class*="axis-title"]')]
        .map((t) => t.textContent),
    };
  })()`);
  console.log(`  link headings: ${headings.links.join(' | ')}`);
  check(headings.links.some((t) => /Utilisation, %/.test(t)), 'the utilisation column names its unit',
    headings.links.join(', '));
  check(headings.links.some((t) => /Gbit\/s/.test(t)), 'the capacity column names its unit', headings.links.join(', '));
  check(headings.links.some((t) => /ms/.test(t)), 'the round trip columns name their unit', headings.links.join(', '));
  check(headings.services.some((t) => /Availability, %/.test(t)), 'the availability column names its unit',
    headings.services.join(', '));
  check(headings.alarms.some((t) => /UTC/.test(t)), 'the alarm time column names its time zone',
    headings.alarms.join(', '));
  check(headings.tiles.some((t) => /Availability, %/.test(t)), 'the availability tile names its unit',
    headings.tiles.join(' | '));
  check(headings.tiles.some((t) => /per minute/.test(t)), 'the update rate tile names its unit',
    headings.tiles.join(' | '));
  check(headings.trafficAxis.some((t) => /Gbit\/s/.test(t)), 'the traffic chart labels its value axis',
    headings.trafficAxis.join(' | '));

  /* Nothing reads NaN, and nothing uses an em dash. */
  const text = await evaluate(`(() => {
    const nan = [];
    const dashes = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      const value = node.nodeValue || '';
      if (/\\bNaN\\b/.test(value)) nan.push(value.trim().slice(0, 60));
      if (value.includes('—')) dashes.push(value.trim().slice(0, 70));
    }
    return { nan: nan.slice(0, 5), dashes: dashes.slice(0, 5) };
  })()`);
  check(text.nan.length === 0, 'nothing on the wall reads "NaN"', text.nan.join(' | '));
  check(text.dashes.length === 0, 'no visible text on the wall uses an em dash', text.dashes.join(' | '));

  /* The credits name every service the page reads. */
  const credits = await evaluate(`(() => [...document.querySelectorAll('.credit-list li')]
    .map((e) => e.textContent.trim()))()`);
  console.log(`  credits: ${credits.length} lines`);
  for (const name of ['PeeringDB', 'Routing Information Service', 'RIPEstat', 'IODA', 'RIPE Atlas', 'Natural Earth']) {
    check(credits.some((c) => c.includes(name)), `the credits name ${name}`, `${credits.length} lines`);
  }

  noErrors('the wall');

  /* =================================================================== */
  /* 8. On a phone.                                                       */
  /* =================================================================== */

  await call('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: true });
  await open(`${origin}/index.html${query}`, 'the wall, 400px wide');

  const narrow = await evaluate(`(() => {
    const de = document.documentElement;
    const d = window.__nocDemo;
    const widest = [];
    const clipped = (e) => getComputedStyle(e).overflowX !== 'visible';
    const walk = (e) => {
      for (const child of e.children) {
        const box = child.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        if (box.right > de.clientWidth + 1) {
          widest.push(String(child.className || child.tagName).slice(0, 44) + ' @' + Math.round(box.right));
        }
        if (!clipped(child)) walk(child);
      }
    };
    walk(document.body);
    const boxes = d.layout.windows().map((id) => {
      const box = d.layout.payload(id).getBoundingClientRect();
      return { id, left: Math.round(box.left), width: Math.round(box.width), top: Math.round(box.top) };
    });
    return {
      clientWidth: de.clientWidth,
      scrollWidth: de.scrollWidth,
      stacked: d.stacked(),
      boxes,
      columns: new Set(boxes.map((b) => b.left)).size,
      alarmRows: d.alarmsGrid.element.querySelectorAll('.lat-row[data-index]').length,
      markers: d.mapChart.element.querySelectorAll('[class*="markermap-dot"]').length,
      tiles: document.querySelectorAll('.kpi-strip .lat-kpi__tile').length,
      sticking: widest.slice(0, 5),
    };
  })()`);
  console.log(`  at 400px: scrollWidth ${narrow.scrollWidth} vs clientWidth ${narrow.clientWidth}; `
    + `${narrow.columns} column(s) of windows; ${narrow.alarmRows} alarm rows, ${narrow.markers} markers, `
    + `${narrow.tiles} tiles`);
  if (narrow.sticking.length) console.log(`  sticking out: ${narrow.sticking.join(', ')}`);
  check(narrow.scrollWidth <= narrow.clientWidth, 'at 400px: the page does not scroll sideways',
    `scrollWidth ${narrow.scrollWidth} > clientWidth ${narrow.clientWidth}; ${narrow.sticking.join(', ')}`);
  check(narrow.stacked === true, 'at 400px: the page knows it is narrow');
  check(narrow.columns === 1, 'at 400px: the windows are in one column',
    `${narrow.columns} distinct left edges`);
  check(narrow.alarmRows > 0, 'at 400px: the alarm table still paints rows', `${narrow.alarmRows}`);
  check(narrow.markers === placed.length, 'at 400px: the map still draws every placed site', `${narrow.markers}`);
  check(narrow.tiles > 0, 'at 400px: the tiles are still drawn', `${narrow.tiles}`);
  await shoot('03-wall-400');

  noErrors('at 400px');

  /* =================================================================== */
  /* 9. On a laptop.                                                      */
  /* =================================================================== */

  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await open(`${origin}/index.html${query}`, 'the wall, 1280px wide');
  const laptop = await evaluate(`(() => {
    const de = document.documentElement;
    const d = window.__nocDemo;
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      columns: new Set(d.layout.windows().map((id) =>
        Math.round(d.layout.payload(id).getBoundingClientRect().left))).size,
      markers: d.mapChart.element.querySelectorAll('[class*="markermap-dot"]').length,
    };
  })()`);
  console.log(`  at 1280px: ${laptop.columns} distinct window columns, ${laptop.markers} markers`);
  check(laptop.scrollWidth <= laptop.clientWidth, 'at 1280px: the page does not scroll sideways',
    `${laptop.scrollWidth} > ${laptop.clientWidth}`);
  check(laptop.columns > 1, 'at 1280px: the wall is still a wall rather than a column',
    `${laptop.columns}`);
  check(laptop.markers === placed.length, 'at 1280px: the map still draws every placed site', `${laptop.markers}`);
  await shoot('04-wall-1280');
  noErrors('at 1280px');

  socket.close();
} catch (error) {
  failures.push(String((error && error.stack) || error));
} finally {
  if (browserPid) {
    try { process.kill(-browserPid, 'SIGKILL'); } catch {}
    try { process.kill(browserPid, 'SIGKILL'); } catch {}
  }
  if (server) server.close();
  await sleep(400);
  if (profile) await rm(profile, { recursive: true, force: true });
}

console.log('\nChecks:');
for (const note of notes) console.log(note);

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nAll ${notes.length} checks passed.`);
process.exit(0);
