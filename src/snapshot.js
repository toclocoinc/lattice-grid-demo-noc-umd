/**
 * Read the saved copy.
 *
 * Everything here is a file in `data/`, written by `tools/build-snapshot.mjs`
 * and `tools/capture-ris.mjs` in Node, once a night. None of it is invented in
 * this file: it is read, checked for shape, and handed on.
 */
(function (root) {
  'use strict';

  const FILES = ['meta', 'sites', 'collectors', 'routing', 'churn', 'outages', 'shapes'];

  /**
   * Read the whole saved copy, reporting progress as each file lands.
   *
   * @param {(text: string, fraction: number) => void} [progress] called per file
   * @returns {Promise<object>} the snapshot
   */
  async function read(progress) {
    const snapshot = {};
    for (let at = 0; at < FILES.length; at += 1) {
      const name = FILES[at];
      if (progress) progress(`Reading ${name}.json...`, at / (FILES.length + 1));
      const response = await fetch(`./data/snapshot/${name}.json`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`The saved copy is missing ${name}.json (the server answered ${response.status}).`);
      }
      snapshot[name] = await response.json();
    }
    /* The recording is only needed when the live feed cannot be reached, so a
       failure to read it is not fatal: the page says so instead. */
    if (progress) progress('Reading the recorded feed...', 0.95);
    try {
      const response = await fetch('./data/ris-capture.json', { cache: 'no-store' });
      snapshot.capture = response.ok ? await response.json() : null;
    } catch {
      snapshot.capture = null;
    }
    if (!Array.isArray(snapshot.sites) || !snapshot.sites.length) {
      throw new Error('The saved copy holds no sites.');
    }
    return snapshot;
  }

  root.NocSnapshot = { read };
})(window);
