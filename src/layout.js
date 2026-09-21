/**
 * The six windows, and where the arrangement is kept.
 *
 * Every panel is a window of the grid's layout module: drag it, resize it,
 * blow it up to fill the wall, collapse it to its title bar. The arrangement
 * is saved in this browser and restored on the next visit, and there is a
 * button to lock the wall and one to put it back the way it shipped.
 *
 * A wall is a desktop thing. Under 900px the six windows stack one above the
 * other, which the module has no breakpoint of its own for: the page asks for
 * a different arrangement at that width and hands it to `setLayout`.
 */
(function (root) {
  'use strict';

  const { el, PANELS } = root.NocBanner;
  const STORE = 'lattice-noc-layout-v1';

  /** The wall, on twelve columns and six rows. */
  const WIDE = [
    { id: 'header', xPos: 1, yPos: 1, xSize: 12, ySize: 1, movable: false, resizable: false },
    { id: 'map', xPos: 1, yPos: 2, xSize: 7, ySize: 3 },
    { id: 'alarms', xPos: 8, yPos: 2, xSize: 5, ySize: 3 },
    { id: 'topology', xPos: 1, yPos: 5, xSize: 4, ySize: 2 },
    { id: 'services', xPos: 5, yPos: 5, xSize: 4, ySize: 2 },
    { id: 'traffic', xPos: 9, yPos: 5, xSize: 4, ySize: 2 },
  ];

  /** The same six, one above the other, for a narrow screen. */
  function stacked() {
    let row = 1;
    return WIDE.map((window) => {
      const height = window.id === 'header' ? 4 : 2;
      const placed = { id: window.id, xPos: 1, yPos: row, xSize: 12, ySize: height };
      row += height;
      return placed;
    });
  }

  const narrow = () => window.innerWidth < 900;
  const arrangement = () => (narrow() ? stacked() : WIDE);

  /**
   * Mount the layout, fill each window with its caption, and wire the two
   * buttons in the masthead.
   *
   * @param {object} options the factory, where to draw, and the masthead
   * @returns {object} the layout, `panel(id)`, and what the check reads
   */
  function mount(options) {
    const { createLayout, host, controls } = options;
    const dash = el('div', 'dash');
    host.append(dash);

    const layout = createLayout(dash, {
      columns: 12,
      rows: 6,
      gap: 10,
      padding: 6,
      overflowX: 'static',
      overflowY: 'scroll',
      rowHeight: '156px',
      /* Nothing floats: a wall the operator arranged stays arranged. */
      compact: 'none',
      movable: true,
      resizable: true,
      maximisable: true,
      minimisable: true,
      closable: false,
      windows: arrangement().map((placement) => Object.assign(
        { title: PANELS.find((p) => p.id === placement.id).title }, placement,
      )),
    });

    /** The element a viewer is drawn into, under that panel's caption. */
    function panel(id) {
      const spec = PANELS.find((p) => p.id === id);
      const payload = layout.payload(id);
      payload.classList.add('panel');
      payload.dataset.provenance = spec.provenance;
      const body = el('div', 'panel-body');
      payload.append(el('p', 'panel-caption', spec.caption), body);
      return body;
    }

    let timer = null;
    const save = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          window.localStorage.setItem(STORE, JSON.stringify({ wide: !narrow(), layout: layout.getLayout() }));
        } catch { /* a browser with storage turned off simply does not remember. */ }
      }, 250);
    };
    layout.on('layout:changed', save);

    /** Put back whatever was saved, when it was saved at this width. */
    function restore() {
      try {
        const held = JSON.parse(window.localStorage.getItem(STORE) || 'null');
        if (held && held.layout && held.wide === !narrow()) {
          layout.setLayout(held.layout);
          return true;
        }
      } catch { /* nothing saved, or nothing readable. */ }
      return false;
    }
    const restored = restore();

    let editing = true;
    const lock = el('button', 'control', 'Lock layout');
    lock.type = 'button';
    const reset = el('button', 'control', 'Reset layout');
    reset.type = 'button';
    controls.append(lock, reset);

    const setEditing = (next) => {
      editing = next;
      layout.setInteractive(next);
      lock.textContent = next ? 'Lock layout' : 'Edit layout';
      lock.setAttribute('aria-pressed', String(next));
    };
    lock.addEventListener('click', () => setEditing(!editing));
    setEditing(true);

    reset.addEventListener('click', () => {
      try { window.localStorage.removeItem(STORE); } catch {}
      for (const id of layout.minimised()) layout.restore(id);
      layout.setLayout({ columns: 12, rows: 6, windows: arrangement() });
      layout.refresh();
    });

    /* Re-stack when the window crosses the breakpoint. */
    let wasNarrow = narrow();
    window.addEventListener('resize', () => {
      if (narrow() === wasNarrow) return;
      wasNarrow = narrow();
      layout.setLayout({ columns: 12, rows: 6, windows: arrangement() });
      layout.refresh();
    });

    return { layout, panel, save, restore, restored, setEditing, stacked: narrow, WIDE };
  }

  root.NocLayout = { mount, WIDE, stacked };
})(window);
