// Editor layout: which dock (top, left, middle, right or bottom) each panel sits in, or hidden.
// Saved per browser, so a laptop and a phone can each have their own arrangement.

export const DOCKS = { top: "Top", left: "Left", middle: "Middle", right: "Right", bottom: "Bottom" };
export const HIDDEN = "hidden";
// The timeline is where a show is edited, so it can move but not hide.
const ALWAYS_SHOWN = new Set(["timeline"]);
const placesFor = (panel) => (ALWAYS_SHOWN.has(panel) ? DOCKS : { ...DOCKS, [HIDDEN]: "Hidden" });
export const PANELS = {
  show: "Show", song: "Song", playback: "Playback", beats: "Beats", ai: "Describe it",
  preview: "Preview", house: "House", timeline: "Timeline", inspector: "Selection",
};
// Frames arrange the five docks on the page, as CSS grid areas over three columns (left, middle,
// right) and three rows (top, middle, bottom).
export const FRAMES = {
  classic: { label: "Classic", hint: "Top and bottom run full width, the sides sit beside the middle",
    areas: ["top top top", "left middle right", "bottom bottom bottom"] },
  columns: { label: "Side columns", hint: "Left and right run full height, top and bottom sit over and under the middle",
    areas: ["left top right", "left middle right", "left bottom right"] },
  right: { label: "Right column", hint: "Right runs full height, top and bottom span the rest",
    areas: ["top top right", "left middle right", "bottom bottom right"] },
};
export const DEFAULT_FRAME = "classic";
export const DEFAULT_LAYOUT = {
  show: "top", song: "top", playback: "top", beats: "top", ai: "top",
  preview: "top", house: "top", timeline: "middle", inspector: "bottom",
};
const KEY = "goveeshow.layout";

// Saved as { place: {panel: dock}, order: [panels], frame }; panels sit in their dock in `order`.
// Older versions saved only the place map, which still loads with the default order.
export function loadLayout() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* private mode or bad data */ }
  const placed = saved.place || saved;
  const place = { ...DEFAULT_LAYOUT };
  for (const [k, v] of Object.entries(placed)) if (k in PANELS && v in placesFor(k)) place[k] = v;
  const order = (Array.isArray(saved.order) ? saved.order : []).filter((k, i, a) => k in PANELS && a.indexOf(k) === i);
  for (const k of Object.keys(PANELS)) if (!order.includes(k)) order.push(k);
  const frame = saved.frame in FRAMES ? saved.frame : DEFAULT_FRAME;
  return { place, order, frame };
}

const gridAreas = (frame) => FRAMES[frame].areas.map((r) => `"${r}"`).join(" ");

// A small picture of a frame: one cell per dock, laid out the way the frame places them.
// cell(dock, el) fills in or wires up each cell.
export function frameMap(frame, cell) {
  const map = document.createElement("div");
  map.className = "frame-map";
  map.style.gridTemplateAreas = gridAreas(frame);
  for (const dock of Object.keys(DOCKS)) {
    const el = document.createElement(cell ? "button" : "div");
    el.className = "frame-cell";
    el.style.gridArea = dock;
    cell?.(dock, el);
    map.append(el);
  }
  return map;
}

function saveLayout(layout) {
  try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch { /* not saved, still applied */ }
}

export class Layout {
  // onChange runs after panels move, so the timeline and preview can resize.
  constructor(onChange) {
    this.onChange = onChange;
    this.layout = loadLayout();
    this.menu = null;
    this.docks = Object.fromEntries([...document.querySelectorAll(".dock[data-dock]")].map((d) => [d.dataset.dock, d]));
    this.marker = document.createElement("div");
    this.marker.className = "drop-marker";
    for (const panel of document.querySelectorAll(".panel[data-panel]")) {
      const btn = document.createElement("button");
      btn.className = "panel-move ghost";
      btn.textContent = "⋯";
      btn.title = "Move this panel";
      btn.addEventListener("click", (e) => { e.stopPropagation(); this.openMenu(panel.dataset.panel, btn); });
      const head = panel.querySelector(".panel-head");
      head.append(btn);
      this.makeDraggable(panel, head);
    }
    for (const [name, dock] of Object.entries(this.docks)) this.makeDropZone(name, dock);
    document.addEventListener("click", () => this.closeMenu());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.closeMenu(); });
    this.apply();
  }

  // Puts `panel` in `dock`, just before `before` (another panel) or at the end of the dock.
  move(panel, dock, before = null) {
    const { place, order } = this.layout;
    place[panel] = dock;
    order.splice(order.indexOf(panel), 1);
    order.splice(before && before !== panel ? order.indexOf(before) : order.length, 0, panel);
    saveLayout(this.layout);
    this.apply();
  }

  // Swaps with the panel before (-1) or after (+1) it in the same dock.
  step(panel, by) {
    const dock = this.layout.place[panel];
    const same = this.layout.order.filter((k) => this.layout.place[k] === dock);
    const i = same.indexOf(panel) + by;
    if (i < 0 || i >= same.length) return;
    this.move(panel, dock, by < 0 ? same[i] : same[i + 1] || null);
  }

  setFrame(frame) {
    if (!(frame in FRAMES)) return;
    this.layout.frame = frame;
    saveLayout(this.layout);
    this.apply();
  }

  reset() {
    this.layout = { place: { ...DEFAULT_LAYOUT }, order: Object.keys(PANELS), frame: DEFAULT_FRAME };
    saveLayout(this.layout);
    this.apply();
  }

  apply() {
    const { place, order, frame } = this.layout;
    const view = this.docks.top?.closest(".view");
    if (view) {
      view.style.setProperty("--frame-areas", gridAreas(frame));
      view.dataset.frame = frame;
    }
    for (const key of order) {
      const el = document.querySelector(`.panel[data-panel="${key}"]`);
      if (!el) continue;
      el.hidden = place[key] === HIDDEN;
      if (!el.hidden) this.docks[place[key]].append(el);
    }
    for (const d of Object.values(this.docks)) d.classList.toggle("empty", !d.querySelector(".panel:not([hidden])"));
    this.renderSettings();
    this.onChange?.();
  }

  // Drag a panel by its title bar. While dragging, empty docks open up so they can be dropped into.
  makeDraggable(panel, head) {
    head.draggable = true;
    head.title = "Drag to move this panel";
    head.addEventListener("dragstart", (e) => {
      if (e.target.closest("button, input, select")) { e.preventDefault(); return; }
      this.dragging = panel.dataset.panel;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", this.dragging);
      e.dataTransfer.setDragImage(panel, 20, 12);
      // Changing the page inside dragstart cancels the drag in some browsers, so wait a tick.
      setTimeout(() => { document.body.classList.add("dragging-panel"); panel.classList.add("drag-source"); });
    });
    head.addEventListener("dragend", () => {
      this.dragging = null;
      this.marker.remove();
      document.body.classList.remove("dragging-panel");
      panel.classList.remove("drag-source");
    });
  }

  makeDropZone(name, dock) {
    dock.addEventListener("dragover", (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const before = this.panelAt(dock, e.clientX, e.clientY);
      dock.insertBefore(this.marker, before ? before : null);
    });
    dock.addEventListener("drop", (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      const next = this.marker.nextElementSibling?.closest(".panel");
      const panel = this.dragging;
      this.marker.remove();
      this.move(panel, name, next?.dataset.panel || null);
    });
  }

  // The panel the pointer is in front of, or null for the end of the dock. Top and bottom wrap in
  // rows, the others are columns.
  panelAt(dock, x, y) {
    const rows = !["left", "middle", "right"].includes(dock.dataset.dock);
    for (const el of dock.querySelectorAll(":scope > .panel:not([hidden]):not(.drag-source)")) {
      const r = el.getBoundingClientRect();
      if (rows ? y < r.top || (y < r.bottom && x < r.left + r.width / 2) : y < r.top + r.height / 2) return el;
    }
    return null;
  }

  openMenu(panel, anchor) {
    this.closeMenu();
    const menu = document.createElement("div");
    menu.className = "panel-menu";
    menu.addEventListener("click", (e) => e.stopPropagation());
    const title = document.createElement("div");
    title.className = "section-label";
    title.textContent = `Move ${PANELS[panel]} to`;
    menu.append(title);
    // The docks as a picture of the page, so it's clear where each one is.
    const here = this.layout.place[panel];
    menu.append(frameMap(this.layout.frame, (dock, b) => {
      b.className += dock === here ? " active" : "";
      const others = this.layout.order.filter((k) => k !== panel && this.layout.place[k] === dock).map((k) => PANELS[k]);
      b.textContent = DOCKS[dock];
      b.title = others.length ? `${DOCKS[dock]}: with ${others.join(", ")}` : `${DOCKS[dock]}: empty`;
      b.addEventListener("click", () => { this.closeMenu(); this.move(panel, dock); });
    }));
    if (HIDDEN in placesFor(panel)) {
      const b = document.createElement("button");
      b.className = here === HIDDEN ? "active" : "ghost";
      b.textContent = "Hidden";
      b.title = "Tuck this panel away; bring it back from Settings or by moving it";
      b.addEventListener("click", () => { this.closeMenu(); this.move(panel, HIDDEN); });
      menu.append(b);
    }
    if (this.layout.place[panel] !== HIDDEN) {
      const order = document.createElement("div");
      order.className = "panel-menu-order";
      for (const [label, by] of [["Earlier", -1], ["Later", 1]]) {
        const b = document.createElement("button");
        b.className = "ghost";
        b.textContent = label;
        b.title = by < 0 ? "Move before the panel ahead of it" : "Move after the panel behind it";
        b.addEventListener("click", () => { this.closeMenu(); this.step(panel, by); });
        order.append(b);
      }
      menu.append(order);
    }
    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = "Page layout";
    menu.append(label, this.framePicker(() => this.closeMenu()));
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + window.scrollY + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + window.scrollX}px`;
    this.menu = menu;
  }

  closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  // A button per frame, each showing its picture; picked runs after a frame is chosen.
  framePicker(picked) {
    const row = document.createElement("div");
    row.className = "frame-picker";
    for (const [key, f] of Object.entries(FRAMES)) {
      const b = document.createElement("button");
      b.className = `frame-choice ${key === this.layout.frame ? "active" : "ghost"}`;
      b.title = f.hint;
      const name = document.createElement("span");
      name.textContent = f.label;
      b.append(frameMap(key), name);
      b.addEventListener("click", () => { picked?.(); this.setFrame(key); });
      row.append(b);
    }
    return row;
  }

  // The Layout section on the Settings tab.
  renderSettings() {
    document.getElementById("layout-frames")?.replaceChildren(this.framePicker());
    const box = document.getElementById("layout-rows");
    if (!box) return;
    box.replaceChildren(...Object.entries(PANELS).map(([key, label]) => {
      const l = document.createElement("label");
      const sel = document.createElement("select");
      for (const [dock, dl] of Object.entries(placesFor(key))) sel.add(new Option(dl, dock, false, dock === this.layout.place[key]));
      sel.addEventListener("change", () => this.move(key, sel.value));
      const name = document.createElement("span");
      name.textContent = label;
      l.append(name, sel);
      return l;
    }));
  }
}
