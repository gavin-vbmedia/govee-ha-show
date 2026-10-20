// Editor layout: which dock around the timeline (top, left, right or bottom) each panel sits in.
// Saved per browser, so a laptop and a phone can each have their own arrangement.

export const DOCKS = { top: "Top", left: "Left", right: "Right", bottom: "Bottom" };
export const PANELS = {
  show: "Show", song: "Song", playback: "Playback", beats: "Beats", zoom: "Zoom",
  preview: "Preview", inspector: "Selection",
};
export const DEFAULT_LAYOUT = {
  show: "top", song: "top", playback: "top", beats: "top", zoom: "top",
  preview: "top", inspector: "bottom",
};
const KEY = "goveeshow.layout";

export function loadLayout() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* private mode or bad data */ }
  const layout = { ...DEFAULT_LAYOUT };
  for (const [k, v] of Object.entries(saved)) if (k in PANELS && v in DOCKS) layout[k] = v;
  return layout;
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
    for (const panel of document.querySelectorAll(".panel[data-panel]")) {
      const btn = document.createElement("button");
      btn.className = "panel-move ghost";
      btn.textContent = "⋯";
      btn.title = "Move this panel";
      btn.addEventListener("click", (e) => { e.stopPropagation(); this.openMenu(panel.dataset.panel, btn); });
      panel.querySelector(".panel-head").append(btn);
    }
    document.addEventListener("click", () => this.closeMenu());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.closeMenu(); });
    this.apply();
  }

  move(panel, dock) {
    this.layout[panel] = dock;
    saveLayout(this.layout);
    this.apply();
  }

  reset() {
    this.layout = { ...DEFAULT_LAYOUT };
    saveLayout(this.layout);
    this.apply();
  }

  apply() {
    const docks = Object.fromEntries([...document.querySelectorAll(".dock[data-dock]")].map((d) => [d.dataset.dock, d]));
    for (const key of Object.keys(PANELS)) {
      const el = document.querySelector(`.panel[data-panel="${key}"]`);
      if (el) docks[this.layout[key]].append(el);
    }
    for (const d of Object.values(docks)) d.hidden = !d.querySelector(".panel");
    this.renderSettings();
    this.onChange?.();
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
    for (const [dock, label] of Object.entries(DOCKS)) {
      const b = document.createElement("button");
      b.className = dock === this.layout[panel] ? "active" : "ghost";
      b.textContent = label;
      b.addEventListener("click", () => { this.closeMenu(); this.move(panel, dock); });
      menu.append(b);
    }
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

  // The Layout section on the Settings tab.
  renderSettings() {
    const box = document.getElementById("layout-rows");
    if (!box) return;
    box.replaceChildren(...Object.entries(PANELS).map(([key, label]) => {
      const l = document.createElement("label");
      const sel = document.createElement("select");
      for (const [dock, dl] of Object.entries(DOCKS)) sel.add(new Option(dl, dock, false, dock === this.layout[key]));
      sel.addEventListener("change", () => this.move(key, sel.value));
      const name = document.createElement("span");
      name.textContent = label;
      l.append(name, sel);
      return l;
    }));
  }
}
