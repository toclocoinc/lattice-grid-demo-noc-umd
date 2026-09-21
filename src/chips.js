/**
 * The four severity chips above the alarm table.
 *
 * They are buttons, but they filter nothing themselves: each one selects a row
 * in a four-row table the page never shows, and the router's link from that
 * table to the alarm table does the narrowing. That is the same mechanism a
 * click on the map uses, which is the point of having it.
 */
(function (root) {
  'use strict';

  const { el } = root.NocBanner;
  const { SEVERITIES } = root.NocSimulator;

  /**
   * Draw the chips into a host, above a grid.
   *
   * @param {HTMLElement} host where to draw
   * @param {object} grid the four-row chip table the chips select in
   * @returns {object} a `paint(counts)` the live loop calls
   */
  function draw(host, grid) {
    const bar = el('div', 'chip-bar');
    host.prepend(bar);
    const buttons = new Map();
    for (const chip of [{ id: 'all', label: 'All' }, ...SEVERITIES]) {
      const button = el('button', 'chip', `${chip.label} 0`);
      button.type = 'button';
      button.dataset.chip = chip.id;
      button.setAttribute('aria-pressed', String(chip.id === 'all'));
      button.addEventListener('click', () => {
        grid.selection.set(chip.id === 'all' ? [] : [`chip-${chip.id}`]);
        for (const [id, other] of buttons) other.setAttribute('aria-pressed', String(id === chip.id));
      });
      buttons.set(chip.id, button);
      bar.append(button);
    }
    return {
      paint(counts) {
        buttons.get('all').textContent = `All ${counts.incidents}`;
        for (const severity of SEVERITIES) {
          buttons.get(severity.id).textContent = `${severity.label} ${counts[severity.id]}`;
        }
      },
    };
  }

  root.NocChips = { draw };
})(window);
