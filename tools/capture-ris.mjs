/**
 * Record a stretch of RIPE RIS Live to a file, so the demo has something real
 * to replay when it cannot reach the internet.
 *
 * The live page and the recorded page read the same shapes and run the same
 * code; the only difference is where the messages come from. What is recorded
 * here is a projection, not the raw firehose, and the projection is written
 * into the file's own header so a reader of the repository can see exactly
 * what was kept and what was counted:
 *
 *   - every withdrawal, in full;
 *   - every announcement that brings back a prefix the same peer withdrew
 *     earlier in the recording, which is how a route coming back at one
 *     vantage point is recognised;
 *   - one announcement in `sample` of the rest, marked as a sample;
 *   - the total number of announcements per second, so the rate the page
 *     draws is the rate that actually happened rather than the rate of the
 *     sample.
 *
 * Usage: node tools/capture-ris.mjs [--seconds 600] [--out data/ris-capture.json]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

/** The backbone whose routes this demo follows. See tools/carrier.mjs. */
const { CARRIER } = await import('./carrier.mjs');

const seconds = Number(flag('seconds', '600'));
const out = resolve(root, flag('out', 'data/ris-capture.json'));
const sample = Number(flag('sample', '50'));
const url = 'wss://ris-live.ripe.net/v1/ws/?client=lattice-noc-demo';

if (typeof WebSocket === 'undefined') {
  throw new Error(`This tool needs Node 22 or newer for its built in WebSocket; you are running ${process.version}.`);
}

const hosts = [];
const hostIndex = new Map();
/** The number a collector is stored under, assigned in the order first seen. */
function indexOf(host) {
  const short = String(host).split('.')[0];
  if (!hostIndex.has(short)) {
    hostIndex.set(short, hosts.length);
    hosts.push(short);
  }
  return hostIndex.get(short);
}

const started = Date.now();
const events = [];
const perSecond = new Array(seconds).fill(0);
const withdrawn = new Set();
let messages = 0;
let announcements = 0;
let withdrawals = 0;
let sampled = 0;
let recoveries = 0;

let socket = null;
let reconnects = 0;
let finished = false;

/** Handle one message off whichever socket is currently open. */
function receive(event) {
  const message = JSON.parse(event.data);
  if (message.type !== 'ris_message') return;
  const update = message.data;
  messages += 1;
  const at = Date.now() - started;
  const second = Math.min(seconds - 1, Math.floor(at / 1000));
  const host = indexOf(update.host);
  const peer = Number(update.peer_asn) || 0;
  const path = Array.isArray(update.path) ? update.path : [];
  const origin = path.length ? Number(String(path[path.length - 1]).split('{')[0]) || 0 : 0;

  for (const prefix of update.withdrawals || []) {
    withdrawals += 1;
    /* Keyed by the vantage point as well as the prefix: a route is withdrawn
       at a collector by a peer, and it is that peer at that collector whose
       next announcement of it is the route coming back. A prefix withdrawn in
       Sao Paulo is not restored by an announcement in Tokyo. */
    withdrawn.add(`${host}|${peer}|${prefix}`);
    events.push([at, host, peer, 'w', prefix, origin]);
  }
  for (const group of update.announcements || []) {
    for (const prefix of group.prefixes || []) {
      announcements += 1;
      perSecond[second] += 1;
      const seen = `${host}|${peer}|${prefix}`;
      if (withdrawn.has(seen)) {
        withdrawn.delete(seen);
        recoveries += 1;
        events.push([at, host, peer, 'r', prefix, origin]);
      } else if (announcements % sample === 0) {
        sampled += 1;
        events.push([at, host, peer, 'a', prefix, origin]);
      }
    }
  }
}

/**
 * Open the feed, and open it again if it drops.
 *
 * RIS Live refuses a connection now and again, and a ten minute recording that
 * gave up on the first refusal would be a recording of nothing. The clock is
 * not restarted: a gap in the recording is a gap that happened.
 */
function connect() {
  if (finished) return;
  socket = new WebSocket(url);
  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: 'ris_subscribe',
      data: { path: String(CARRIER.asn), moreSpecific: true, type: 'UPDATE', socketOptions: { includeRaw: false } },
    }));
    process.stdout.write(`  connected (${reconnects} reconnect(s) so far)\n`);
  };
  socket.onmessage = receive;
  socket.onerror = () => {};
  socket.onclose = () => {
    if (finished) return;
    reconnects += 1;
    setTimeout(connect, Math.min(8000, 500 * reconnects));
  };
}

process.stdout.write(`Subscribed to AS${CARRIER.asn} on every collector. Recording ${seconds}s...\n`);
connect();

await new Promise((done) => setTimeout(done, seconds * 1000));
finished = true;
try { socket.close(); } catch {}

const elapsed = Date.now() - started;
const capture = {
  /* What this file is, in the file. */
  about: 'A recording of RIPE RIS Live BGP updates whose AS path contains the backbone this demo follows. '
    + 'Source: RIPE NCC Routing Information Service (ris-live.ripe.net). Every withdrawal and every recovery '
    + 'in this file is a real routing event that happened at the time it carries.',
  attribution: 'RIPE NCC Routing Information Service (RIS). https://ris.ripe.net/',
  asn: CARRIER.asn,
  recordedAt: new Date(started).toISOString(),
  durationMs: elapsed,
  sample,
  hosts,
  fields: ['msFromStart', 'hostIndex', 'peerAsn', 'kind (w=withdrawal, r=re-announcement of a withdrawn prefix, a=sampled announcement)', 'prefix', 'originAsn'],
  counts: { messages, announcements, withdrawals, recoveries, sampled, events: events.length },
  ratePerMinute: Math.round((messages / (elapsed / 1000)) * 60),
  reconnects,
  announcementsPerSecond: perSecond,
  events,
};

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(capture)}\n`);
process.stdout.write(
  `Wrote ${out}\n  ${messages} messages in ${Math.round(elapsed / 1000)}s (${capture.ratePerMinute}/min)\n`
  + `  ${withdrawals} withdrawals, ${recoveries} recoveries, ${sampled} sampled announcements, `
  + `${events.length} events kept\n  ${hosts.length} collectors seen\n`,
);
process.exit(0);
