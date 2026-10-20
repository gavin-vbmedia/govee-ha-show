// Editor app: shows, songs, devices, transport and the clip inspector.

import { EFFECTS, FPS, bake, defaultParams, newClip, renderTrack, showDuration } from "./effects.js";
import { House } from "./house.js";
import { Layout } from "./layout.js";
import { PRESET_PALETTES, applyPalette, paletteKeys } from "./palettes.js";
import { Timeline, fmtTime } from "./timeline.js";

const $ = (id) => document.getElementById(id);

// Relative URLs keep working behind Home Assistant ingress.
async function api(path, { method = "GET", json, body, headers = {} } = {}) {
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { method, body, headers });
  if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
  return res.headers.get("Content-Type")?.includes("json") ? res.json() : res.text();
}

const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`goveeshow.${key}`); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`goveeshow.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

function status(msg, error = false) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", error);
  if (!error && msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 4000);
}

const blankShow = (name = "Untitled show") => ({ name, audio: null, fps: FPS, duration: 60, beats: [], tracks: [] });
const audioUrl = (a) => `api/audio/file?source=${encodeURIComponent(a.source)}&path=${encodeURIComponent(a.path)}`;

const app = {
  show: blankShow(),
  showId: null,
  dirty: false,
  edits: 0, // counts changes, so a save only marks the show clean if nothing changed meanwhile
  bakedKey: null,
  deviceList: [],
  devices: {},
  pps: prefs.get("pps", 60),
  time: 0,
  playing: false,
  // {track, clip}; clip is null when a whole light is selected, and range is set
  // ({tracks, start, end}) when a stretch of time is selected on one or more lights.
  selected: null,
  clipboard: null, // {clips, track, whole}
  region: null, // {start, end}: the part of the show Play plays (and loops), while designing
  loop: prefs.get("loop", false),
  paletteEffect: "solid",
  palettes: [], // the user's own colour palettes; presets are in palettes.js
  colourPalette: prefs.get("colourPalette", PRESET_PALETTES[0].name),
  lastColourKey: null, // colour field a palette swatch fills
  snap: prefs.get("snap", true),
  peaks: null,
  audioDuration: 0,
  history: [],
  historyIndex: -1,
  clockStart: 0,
  syncTimer: null,
  speakers: [], // added on the Speakers tab; the only ones the editor offers
  speakerCandidates: [], // all of Home Assistant's media players
  haAvailable: null,
  defaultSpeaker: null, // where automations play a show that has no speaker of its own
  models: {}, // Govee SKU -> {name, realtime, segments?}
  remote: false, // playing on a Home Assistant speaker; the add-on keeps time

  duration() {
    return Math.max(this.audioDuration || this.show.duration || 0, showDuration({ tracks: this.show.tracks }));
  },

  seek(t) {
    if (this.playing && this.remote) {
      status("Stop the speaker to move the playhead");
      return;
    }
    this.time = Math.min(Math.max(t, 0), this.duration());
    if (hasAudio()) audio.currentTime = this.time;
    else this.clockStart = performance.now() - this.time * 1000;
    if (this.playing) syncLights();
  },

  setRegion(r) {
    this.region = r && r.end - r.start >= 0.05 ? { start: Math.max(0, r.start), end: r.end } : null;
    renderRegion();
    timeline.draw();
  },

  select(sel) {
    this.selected = sel;
    renderInspector();
    timeline.draw();
  },

  // live changes redraw only; committed ones also go on the undo history.
  changed({ live = false } = {}) {
    this.dirty = true;
    this.edits++;
    timeline.layout();
    if (!live) {
      commit();
      renderInspector();
      scheduleAutoSave();
    }
  },
};

const audio = $("audio");
const timeline = new Timeline(app);
const hasAudio = () => !!app.show.audio && audio.src !== "";

// history -----------------------------------------------------------------
function commit() {
  app.history.splice(app.historyIndex + 1);
  app.history.push(JSON.stringify(app.show));
  if (app.history.length > 100) app.history.shift();
  app.historyIndex = app.history.length - 1;
}

function restore(step) {
  const i = app.historyIndex + step;
  if (i < 0 || i >= app.history.length) return;
  app.historyIndex = i;
  app.show = JSON.parse(app.history[i]);
  app.dirty = true;
  app.edits++;
  app.selected = null;
  renderInspector();
  timeline.layout();
  scheduleAutoSave();
}

// devices -------------------------------------------------------------------
async function loadDevices() {
  app.deviceList = await api("api/devices");
  indexDevices();
}

function indexDevices() {
  app.devices = Object.fromEntries(app.deviceList.map((d) => [d.id, d]));
  ensureTracks();
  renderDevices();
  layoutPreview();
  timeline.layout();
}

function ensureTracks() {
  for (const d of app.deviceList) {
    if (!app.show.tracks.some((t) => t.device === d.id)) app.show.tracks.push({ device: d.id, clips: [] });
  }
}

async function saveDevices() {
  try {
    app.deviceList = await api("api/devices", { method: "PUT", json: app.deviceList });
    indexDevices();
  } catch (e) { status(`Couldn't save devices: ${e.message}`, true); }
}

function renderDevices() {
  const rows = $("device-rows");
  rows.replaceChildren();
  if (!app.deviceList.length) {
    rows.innerHTML = `<tr><td colspan="10" class="hint">No devices yet. Scan the network or add one by IP.</td></tr>`;
    return;
  }
  for (const d of app.deviceList) {
    d.brightness ??= 100; // saved before per-light brightness existed
    const tr = document.createElement("tr");
    const input = (type, key, attrs = {}) => {
      const el = document.createElement("input");
      el.type = type;
      Object.assign(el, attrs);
      if (type === "checkbox") el.checked = d[key]; else el.value = d[key];
      el.addEventListener("change", () => {
        d[key] = type === "checkbox" ? el.checked : type === "number" ? Number(el.value) : el.value;
        saveDevices();
      });
      return el;
    };
    const cell = (child) => { const td = document.createElement("td"); td.append(child); tr.append(td); };
    cell(input("text", "name", { size: 14 }));
    const ip = document.createElement("input");
    Object.assign(ip, { value: d.ip, placeholder: "Not linked yet", size: 13, title: "The light's IP address. Leave blank for a planned light." });
    ip.addEventListener("change", () => {
      const v = ip.value.trim();
      if (v && !/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) { status("That isn't an IP address", true); ip.value = d.ip; return; }
      d.ip = v;
      saveDevices();
    });
    cell(ip);
    const model = document.createElement("span");
    model.append(d.sku || "–", realtimeBadge(d.sku));
    cell(model);
    const segs = document.createElement("span");
    const find = button("Find", () => findSegments(d), "ghost");
    find.disabled = !d.ip || d.protocol === "whole";
    find.title = d.ip ? "Work out the segment count with a few yes or no questions" : "Link this light first";
    segs.append(input("number", "segments", { min: 1, max: 255 }), " ", find);
    cell(segs);
    const bulbs = document.createElement("input");
    Object.assign(bulbs, { type: "number", min: 1, max: 2000, value: d.bulbs ?? "", placeholder: `${d.segments * 4}?`,
      title: "How many bulbs the light has, so the House view draws each one. Blank guesses 4 per segment." });
    bulbs.addEventListener("change", () => {
      const v = Math.round(Number(bulbs.value));
      d.bulbs = v >= 1 ? Math.min(v, 2000) : null;
      saveDevices();
    });
    cell(bulbs);
    cell(input("number", "brightness", { min: 1, max: 100, title: "Caps this light in every show. 100 is full brightness." }));
    cell(input("checkbox", "reverse"));
    cell(input("checkbox", "gradient"));
    const proto = document.createElement("select");
    for (const [v, label] of Object.entries(PROTOCOLS)) proto.add(new Option(label, v, false, v === (d.protocol || "standard")));
    proto.title = "How colours are sent. If Test only turns the light on, try the next one.";
    proto.addEventListener("change", () => { d.protocol = proto.value; saveDevices(); });
    cell(proto);
    const actions = document.createElement("td");
    const test = button(d.ip ? "Test" : "Planned", async () => {
      try {
        await api("api/devices/test", { method: "POST", json: { ...d, seconds: 20 } });
        status(`Testing ${d.name} for 20 seconds`);
      } catch (e) { status(`Test failed: ${e.message}`, true); }
    });
    const remove = button("Remove", () => {
      if (!confirm(`Remove ${d.name}? Its clips stay in your shows.`)) return;
      app.deviceList = app.deviceList.filter((x) => x !== d);
      saveDevices();
    }, "ghost danger");
    test.disabled = !d.ip;
    actions.append(test, " ", remove);
    tr.append(actions);
    rows.append(tr);
  }
}

// Find segments: light one segment at a time and halve the range on each answer. A light with
// fewer segments than the frame has nowhere to show the white one, so "anything lit?" can be
// answered with the light still on its reel.
const finder = { device: null, lo: 1, hi: 128, max: 128, guess: 0, steps: 0, busy: false };

async function probe(segment) {
  return api("api/devices/probe", { method: "POST", json: { ...finder.device, segment } });
}

async function findSegments(d) {
  if (finder.device) await stopFinder();
  Object.assign(finder, { device: d, lo: 1, hi: 128, steps: 0, busy: false });
  try {
    const { max } = await probe(1);
    finder.hi = finder.max = max;
  } catch (e) { status(`Couldn't reach ${d.name}: ${e.message}`, true); finder.device = null; return; }
  $("finder").hidden = false;
  $("finder-title").textContent = `Finding segments on ${d.name}`;
  // Segment 1 always exists, so the first real question is the middle of the range.
  await askFinder();
}

async function askFinder() {
  if (finder.lo >= finder.hi) return finishFinder();
  finder.guess = Math.ceil((finder.lo + finder.hi) / 2);
  finder.steps++;
  const left = Math.ceil(Math.log2(finder.hi - finder.lo + 1));
  $("finder-question").textContent = "One segment is lit white and everything else is off. Can you see any light on it?";
  $("finder-progress").textContent = `Question ${finder.steps}, about ${left} to go. Between ${finder.lo} and ${finder.hi} segments.`;
  try { await probe(finder.guess); } catch (e) { status(`Find segments failed: ${e.message}`, true); stopFinder(); }
}

async function answerFinder(lit) {
  if (!finder.device || finder.busy) return;
  finder.busy = true;
  if (lit) finder.lo = finder.guess; else finder.hi = finder.guess - 1;
  await askFinder();
  finder.busy = false;
}

async function finishFinder() {
  const d = finder.device;
  const stretched = finder.lo === finder.max;
  await stopFinder();
  d.segments = finder.lo;
  await saveDevices();
  renderDevices();
  status(stretched
    ? `${d.name} lit every segment asked for, so it may stretch the colours itself. Set to ${finder.lo}; use Test to check.`
    : `${d.name} has ${finder.lo} segments`, stretched);
}

async function stopFinder() {
  $("finder").hidden = true;
  if (!finder.device) return;
  try { await probe(0); } catch { /* the light falls back to its own scene within a minute anyway */ }
  finder.device = null;
}

$("finder-yes").addEventListener("click", () => answerFinder(true));
$("finder-no").addEventListener("click", () => answerFinder(false));
$("finder-cancel").addEventListener("click", () => stopFinder());

// Govee models ------------------------------------------------------------------
async function loadModels() {
  try {
    const { models } = await (await fetch("static/models.json")).json();
    app.models = Object.fromEntries(models.map((m) => [m.sku, m]));
    const list = $("model-list");
    for (const m of models) list.append(new Option(`${m.sku} ${m.name}${m.realtime ? "" : " (unverified)"}`, m.sku));
    renderDevices();
  } catch { /* the picker is a convenience; manual entry still works */ }
}

// Lights accept different forms of the realtime packet. See protocol.py.
const PROTOCOLS = {
  standard: "Realtime",
  razer: "Realtime (Razer)",
  v2: "Realtime v2",
  whole: "Whole light only",
};

const skuOf = (text) => (text || "").trim().split(/\s+/)[0].toUpperCase();

// A small marker saying whether Govee lists the model as realtime-capable.
function realtimeBadge(sku) {
  const m = app.models[skuOf(sku)];
  const span = document.createElement("span");
  if (!m) return span;
  span.className = `badge ${m.realtime ? "ok" : "warn"}`;
  span.textContent = m.realtime ? "✓ realtime" : "⚠ unverified";
  span.title = m.realtime
    ? `${m.name}: Govee lists this model as supporting realtime segment control.`
    : `${m.name}: not on Govee's realtime list. Some unlisted models still work, but test it before relying on it.`;
  return span;
}

function planModelChanged() {
  const m = app.models[skuOf($("plan-model").value)];
  const info = $("plan-info");
  info.replaceChildren();
  if (!m) return;
  if (!$("plan-name").value) $("plan-name").value = m.name.replace(/^Govee\s+/, "");
  if (m.segments) $("plan-segments").value = m.segments;
  info.append(realtimeBadge(m.sku), m.segments
    ? ` ${m.segments} segments (known)`
    : " Segment count unknown: 15 is a guess, check it with Test when it arrives.");
}

function button(label, onclick, cls = "") {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = cls;
  b.addEventListener("click", onclick);
  return b;
}

function addDevice(found) {
  if (app.devices[found.id] || app.deviceList.some((d) => d.ip && d.ip === found.ip)) return;
  const name = `${found.sku || "Govee"} ${found.ip.split(".").pop()}`;
  app.deviceList.push({ id: found.id, name, ip: found.ip, sku: found.sku || "", segments: 15, reverse: false, gradient: false, protocol: "standard", brightness: 100 });
  saveDevices();
}

async function scan() {
  const box = $("scan-results");
  box.textContent = "Scanning…";
  try {
    const found = await api("api/devices/scan", { method: "POST" });
    box.replaceChildren();
    if (!found.length) {
      box.innerHTML = `<p class="hint">No devices answered. Check LAN Control is on in the Govee app and that
        the devices are on the same network as Home Assistant.</p>`;
      return;
    }
    for (const f of found) {
      const row = document.createElement("div");
      row.className = "scan-row";
      row.append(`${f.sku || "Govee"} at ${f.ip}`, realtimeBadge(f.sku));
      const known = app.devices[f.id] || app.deviceList.find((d) => d.ip === f.ip);
      if (known) { row.append(` (${known.name})`); box.append(row); continue; }
      row.append(button("Add", () => { addDevice(f); row.replaceChildren(`${f.sku || "Govee"} at ${f.ip} (added)`); }));
      const planned = app.deviceList.filter((d) => !d.ip);
      if (planned.length) {
        const sel = document.createElement("select");
        for (const p of planned) sel.add(new Option(p.name, p.id));
        row.append(" or ", button("Link to", () => {
          const p = app.devices[sel.value];
          Object.assign(p, { ip: f.ip, sku: f.sku || p.sku });
          saveDevices();
          row.replaceChildren(`${f.sku || "Govee"} at ${f.ip} (${p.name})`);
        }), sel);
      }
      box.append(row);
    }
  } catch (e) { box.textContent = ""; status(`Scan failed: ${e.message}`, true); }
}

// preview -------------------------------------------------------------------
const preview = $("preview");
const pctx = preview.getContext("2d");
const ROW_H = 26, LABEL_W = 140;

function previewTracks() {
  return app.show.tracks.filter((t) => app.devices[t.device]);
}

function layoutPreview() {
  const rows = Math.max(previewTracks().length, 1);
  const dpr = window.devicePixelRatio || 1;
  const w = preview.clientWidth || 600, h = rows * ROW_H;
  preview.style.height = `${h}px`;
  preview.width = Math.round(w * dpr);
  preview.height = Math.round(h * dpr);
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawPreview() {
  const w = preview.clientWidth;
  pctx.clearRect(0, 0, w, preview.height);
  const tracks = previewTracks();
  pctx.font = "12px system-ui, sans-serif";
  if (!tracks.length) {
    pctx.fillStyle = "#888";
    pctx.fillText("Add devices on the Devices tab to see a preview here.", 4, 17);
    return;
  }
  tracks.forEach((tr, row) => {
    const dev = app.devices[tr.device];
    const n = dev.segments;
    const rgb = renderTrack(tr.clips, app.time, n);
    const cap = (dev.brightness ?? 100) / 100;
    if (cap < 1) for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(rgb[i] * cap);
    const y = row * ROW_H;
    pctx.fillStyle = "#aaa";
    pctx.fillText(dev.name, 4, y + 17, LABEL_W - 10);
    const bw = (w - LABEL_W) / n;
    for (let i = 0; i < n; i++) {
      pctx.fillStyle = `rgb(${rgb[i * 3]},${rgb[i * 3 + 1]},${rgb[i * 3 + 2]})`;
      pctx.fillRect(LABEL_W + i * bw + 1, y + 3, Math.max(bw - 2, 1), ROW_H - 6);
    }
  });
}

new ResizeObserver(layoutPreview).observe(preview);

// house view ------------------------------------------------------------------
const house = new House({
  api, status,
  frameFor(dev) {
    const tr = app.show.tracks.find((t) => t.device === dev.id);
    return tr ? renderTrack(tr.clips, app.time, dev.segments) : new Uint8Array(dev.segments * 3);
  },
});

function drawHouse() {
  house.devices = app.deviceList;
  const panel = $("house");
  if (panel.closest(".panel").offsetParent) house.drawPanel(panel, $("house-hint"));
  if (!$("view-house").hidden) house.drawSetup($("house-setup"));
}

// The stretch picked on the photo, if it's on light `d`: in view, or out of view with how many
// bulbs it holds.
function houseStretchEditor(d) {
  const st = house.active ? null : house.pickedStretch();
  if (st?.id !== d.id) return null;
  const hidden = st.hidden != null;
  const box = document.createElement("div");
  box.className = "house-stretch row";
  const label = document.createElement("span");
  label.textContent = `Stretch from point ${st.i} to ${st.i + 1}:`;
  const pick = (text, on, title, fn) => {
    const b = button(text, fn, on ? "primary" : "");
    b.title = title;
    return b;
  };
  box.append(label,
    pick("In view", !hidden, "Bulbs on this stretch can be seen from the photo", () => {
      house.setHidden(null); renderHouseLights();
    }),
    pick("Out of view", hidden, "This stretch runs where the photo can't see, such as round the back of the house, or is an extension lead", () => {
      house.setHidden(hidden ? st.hidden : 0); renderHouseLights();
    }));
  if (hidden) {
    const n = document.createElement("input");
    n.type = "number";
    n.min = "0";
    n.max = "2000";
    n.value = st.hidden;
    n.title = "0 for an extension lead";
    n.addEventListener("change", () => { house.setHidden(Number(n.value)); renderHouseLights(); });
    const l = document.createElement("label");
    l.append("Bulbs on it ", n);
    box.append(l);
  }
  box.append(button("✕", () => { house.stretch = null; renderHouseLights(); }, "ghost"));
  return box;
}

// Line or Icicle, and for icicles how many drops and how far the longest hangs.
function houseStyleControls(d) {
  const style = house.styles[d.id];
  const sel = document.createElement("select");
  sel.title = "How the light looks on the photo";
  sel.innerHTML = `<option value="line">Line</option><option value="icicle">Icicle</option>`;
  sel.value = style?.style || "line";
  sel.addEventListener("change", () => {
    house.setStyle(d.id, sel.value === "icicle"
      ? { style: "icicle", drops: Math.max(d.segments * 3, 10), length: 0.06 } : null);
    renderHouseLights();
  });
  const l0 = document.createElement("label");
  l0.className = "row";
  l0.append("Style ", sel);
  if (!style) return [l0];
  const drops = document.createElement("input");
  drops.type = "number";
  drops.min = "1";
  drops.max = "2000";
  drops.value = style.drops;
  drops.title = "How many drops hang from the light";
  drops.addEventListener("change", () => {
    house.setStyle(d.id, { ...style, drops: Math.min(Math.max(Math.round(Number(drops.value)) || 1, 1), 2000) });
    renderHouseLights();
  });
  const length = document.createElement("input");
  length.type = "range";
  length.min = "0.01";
  length.max = "0.3";
  length.step = "0.005";
  length.value = style.length;
  length.title = "How far the longest drop hangs on the photo";
  length.addEventListener("input", () => { style.length = Number(length.value); house.setStyle(d.id, style); });
  const l1 = document.createElement("label");
  l1.className = "row";
  l1.append("Drops ", drops);
  const l2 = document.createElement("label");
  l2.className = "row";
  l2.append("Length ", length);
  return [l0, l1, l2];
}

// The House tab's sidebar: a card per light. The selected light (or the one being traced) is
// highlighted on the photo and shows its settings; the rest stay one line each.
function renderHouseLights() {
  $("house-remove").hidden = !house.photo;
  $("house-dim").value = house.dim;
  const box = $("house-lights");
  if (!house.photo) {
    box.innerHTML = `<p class="hint">Upload a photo of your house to start.</p>`;
    return;
  }
  if (!app.deviceList.length) {
    box.innerHTML = `<p class="hint">Add your lights on the Devices tab first.</p>`;
    return;
  }
  const current = house.active || house.selected;
  box.replaceChildren(...app.deviceList.map((d) => {
    const card = document.createElement("div");
    const open = current === d.id;
    card.className = `house-card${open ? " selected" : ""}`;
    const pts = house.paths[d.id]?.length || 0;
    const head = document.createElement("div");
    head.className = "house-card-head";
    const name = document.createElement("b");
    name.textContent = d.name;
    const state = document.createElement("span");
    state.className = "hint";
    state.textContent = house.active === d.id ? "Tracing…"
      : !pts ? "Not traced" : house.styles[d.id]?.style === "icicle" ? "Icicle" : "Traced";
    head.append(name, state);
    card.append(head);
    if (!open) {
      card.title = "Select this light";
      card.addEventListener("click", () => {
        if (house.active) return;
        house.selected = d.id;
        house.stretch = null;
        renderHouseLights();
      });
      return card;
    }
    const actions = document.createElement("div");
    actions.className = "row";
    if (house.active === d.id) {
      actions.append(button("Done", () => { house.active = null; renderHouseLights(); }, "primary"));
    } else {
      actions.append(button(pts ? "Retrace" : "Trace", () => {
        if (pts && !confirm(`Trace ${d.name} again from the start?`)) return;
        delete house.paths[d.id];
        house.active = house.selected = d.id;
        house.stretch = null;
        house.save();
        renderHouseLights();
      }, pts ? "" : "primary"));
    }
    if (pts) {
      actions.append(button("Clear", () => {
        if (!confirm(`Remove ${d.name} from the photo?`)) return;
        delete house.paths[d.id];
        if (house.active === d.id) house.active = null;
        house.stretch = null;
        house.save();
        renderHouseLights();
      }, "ghost"));
    }
    card.append(actions, ...houseStyleControls(d));
    const stretch = houseStretchEditor(d);
    if (stretch) card.append(stretch);
    else if (pts > 1 && !house.active) {
      const tip = document.createElement("span");
      tip.className = "hint";
      tip.textContent = "Click a line on the photo to mark part of it out of view.";
      card.append(tip);
    }
    return card;
  }));
  box.querySelector(".house-card.selected")?.scrollIntoView({ block: "nearest" });
}

function wireHouse() {
  house.wireSetup($("house-setup"), renderHouseLights);
  $("house-upload").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) await house.upload(file);
    renderHouseLights();
  });
  $("house-remove").addEventListener("click", async () => {
    if (!confirm("Remove the house photo? Your traced lights are kept for the next photo.")) return;
    await house.removePhoto();
    renderHouseLights();
  });
  $("house-dim").addEventListener("input", (e) => { house.dim = Number(e.target.value); house.save(); });
  document.addEventListener("keydown", (e) => {
    if ($("view-house").hidden || e.target.closest("input, select, textarea")) return;
    if (!house.active) {
      if (e.key === "Escape" && (house.stretch || house.selected)) {
        if (house.stretch) house.stretch = null;
        else house.selected = null;
        renderHouseLights();
      }
      return;
    }
    if (e.key === "Enter" || e.key === "Escape") { house.active = null; renderHouseLights(); }
    if (e.key === "Backspace") {
      e.preventDefault();
      house.paths[house.active]?.pop();
      house.save();
      renderHouseLights();
    }
  });
}

// clip preview ----------------------------------------------------------------
// The selected clip loops on its own in the Selection panel, so a change can be seen without playing
// the show. With "Show on the light" ticked it also loops on the real light while the show is stopped.
const clipPreview = { canvas: null, clip: null, started: 0, dev: null, sent: 0, pending: null, failedAt: -Infinity };
const PREVIEW_SEND_MS = 66; // about 15 frames a second to the light
const previewOnLight = () => prefs.get("previewOnLight", true);
const toHex = (rgb) => Array.from(rgb, (b) => b.toString(16).padStart(2, "0")).join("");

function clipPreviewRow(clip, dev) {
  const row = document.createElement("div");
  row.className = "clip-preview";
  const canvas = document.createElement("canvas");
  canvas.title = "This clip on its own, looping";
  if (clipPreview.clip !== clip) Object.assign(clipPreview, { clip, started: performance.now() });
  clipPreview.canvas = canvas;
  row.append(canvas);
  if (dev?.ip && !EFFECTS[clip.effect]?.experimental) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = previewOnLight();
    box.addEventListener("change", () => {
      prefs.set("previewOnLight", box.checked);
      if (!box.checked) stopLightPreview();
    });
    const l = document.createElement("label");
    l.title = "Loop this clip on the light while the show is stopped";
    l.append(box, " Show on the light");
    row.append(l);
  }
  return row;
}

function drawClipPreview() {
  const c = clipPreview.canvas, sel = app.selected;
  // offsetParent is null while the Selection panel is hidden: no preview, on screen or on the light.
  const track = sel?.clip && c?.isConnected && c.offsetParent && app.show.tracks[sel.track];
  const dev = track && app.devices[track.device];
  if (!dev) { if (clipPreview.dev) stopLightPreview(); return; }
  const clip = sel.clip, len = Math.max(clip.end - clip.start, 0.05);
  const t = clip.start + ((performance.now() - clipPreview.started) / 1000) % len;
  const rgb = renderTrack([clip], t, dev.segments);
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const cap = (dev.brightness ?? 100) / 100, n = dev.segments, bw = w / n;
  for (let i = 0; i < n; i++) {
    const [r, g, b] = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]].map((v) => Math.round(v * cap));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(i * bw + 1, 2, Math.max(bw - 2, 1), h - 4);
  }
  const onLight = previewOnLight() && dev.ip && !EFFECTS[clip.effect]?.experimental && !app.playing && !app.starting;
  if (onLight) sendPreview(dev, rgb);
  else if (clipPreview.dev) stopLightPreview();
}

// The add-on applies the light's brightness cap, so the clip's own colours are sent.
function sendPreview(dev, rgb) {
  const now = performance.now();
  if (clipPreview.pending || now - clipPreview.sent < PREVIEW_SEND_MS || now - clipPreview.failedAt < 5000) return;
  if (clipPreview.dev && clipPreview.dev !== dev.id) { stopLightPreview(); return; }
  clipPreview.sent = now;
  clipPreview.dev = dev.id;
  clipPreview.pending = api("api/devices/preview", { method: "POST", json: { ...dev, rgb: toHex(rgb) } })
    .catch((e) => {
      clipPreview.failedAt = performance.now();
      status(`Couldn't show the clip on ${dev.name}: ${e.message}`, true);
    })
    .finally(() => { clipPreview.pending = null; });
}

// Lets the light go back to what it was doing. Resolves once any frame still on its way has landed.
async function stopLightPreview() {
  const dev = app.devices[clipPreview.dev];
  clipPreview.dev = null;
  await clipPreview.pending;
  if (dev?.ip) await api("api/devices/preview", { method: "POST", json: { ...dev, stop: true } }).catch(() => {});
}

// effects and inspector -------------------------------------------------------
// Experimental effects (Govee scenes) only appear once switched on in Settings. `keep` stays listed
// regardless, so a clip that already uses one can still be edited.
const experimentalOn = () => prefs.get("experimental.scenes", false);
const visibleEffects = (keep) => Object.entries(EFFECTS).filter(([k, fx]) => !fx.experimental || experimentalOn() || k === keep);

// One button per effect; the last one used is outlined so a run of the same effect is quick to add.
function effectPicker(onPick) {
  const box = document.createElement("div");
  box.className = "effect-picker";
  for (const [key, fx] of visibleEffects()) {
    box.append(button(fx.label, () => {
      app.paletteEffect = key;
      onPick(key);
    }, key === app.paletteEffect ? "active" : ""));
  }
  return box;
}

function renderInspector() {
  const box = $("inspector");
  const sel = app.selected;
  const track = sel && app.show.tracks[sel.track];
  if (track && sel.range) { renderRangeInspector(sel.range); return; }
  if (track && !sel.clip) { renderTrackInspector(sel.track); return; }
  if (!sel || !track || !track.clips.includes(sel.clip)) {
    app.selected = null;
    box.innerHTML = `<p class="hint">Drag across a light (or several) to select a stretch of time, then pick an
      effect to add it there, or press Delete to clear it (hold Alt to start a selection on top of a clip). Click a clip to edit it: drag it to move, drag its
      edges to resize, D duplicates, Ctrl+C / Ctrl+V copy and paste, Ctrl+Z undoes. Click a light's name to copy or
      recolour all its effects. Drag along the time ruler to set a play region, and tick Loop to repeat it. Click the beat lane to add or
      remove a beat; hold Shift to drag without snapping.</p>`;
    return;
  }
  const clip = sel.clip;
  const dev = app.devices[track.device];
  box.replaceChildren();
  const h = document.createElement("h3");
  h.textContent = `${EFFECTS[clip.effect]?.label || clip.effect} on ${dev ? dev.name : "missing device"}`;
  box.append(h, clipPreviewRow(clip, dev));

  // Settings are grouped so a clip with many of them stays readable.
  const group = (title) => {
    const g = document.createElement("fieldset");
    g.className = "insp-group";
    const legend = document.createElement("legend");
    legend.className = "section-label";
    legend.textContent = title;
    g.append(legend);
    return g;
  };
  const groups = { clip: group("Clip"), colours: group("Colours"), settings: group("Effect settings"),
    brightness: group("Brightness") };
  let target = groups.clip;
  const field = (label, el) => {
    const l = document.createElement("label");
    l.append(label, el);
    target.append(l);
    return el;
  };

  const effect = document.createElement("select");
  for (const [key, fx] of visibleEffects(clip.effect)) effect.add(new Option(fx.label, key, false, key === clip.effect));
  effect.addEventListener("change", () => {
    const defaults = defaultParams(effect.value);
    for (const k of Object.keys(clip)) if (!["effect", "start", "end"].includes(k) && !(k in defaults)) delete clip[k];
    for (const [k, v] of Object.entries(defaults)) if (!(k in clip)) clip[k] = v;
    clip.effect = effect.value;
    app.changed();
  });
  field("Effect", effect);

  const timeInput = (key) => {
    const el = document.createElement("input");
    el.type = "number";
    el.step = "0.01";
    el.min = "0";
    el.value = clip[key].toFixed(2);
    el.addEventListener("change", () => {
      const v = Number(el.value);
      if (!Number.isFinite(v)) return;
      if (key === "start") clip.start = Math.min(Math.max(0, v), clip.end - 0.05);
      else clip.end = Math.max(v, clip.start + 0.05);
      app.changed();
    });
    return el;
  };
  field("Start", timeInput("start"));
  field("End", timeInput("end"));

  for (const p of EFFECTS[clip.effect].params) {
    target = p.type === "color" ? groups.colours : p.type === "range" ? groups.brightness : groups.settings;
    if (p.type === "scene") { field(p.label, scenePicker(clip, dev)); continue; }
    let el;
    if (p.type === "select") {
      el = document.createElement("select");
      for (const o of p.options) el.add(new Option(o, o, false, o === (clip[p.key] ?? p.default)));
    } else {
      el = document.createElement("input");
      el.type = p.type;
      if (p.type === "number" || p.type === "range") Object.assign(el, { min: p.min, max: p.max, step: p.step });
      el.value = clip[p.key] ?? p.default;
    }
    const numeric = p.type === "number" || p.type === "range";
    const read = () => (numeric ? Number(el.value) : el.value);
    el.addEventListener("input", () => {
      if (numeric && !Number.isFinite(read())) return;
      clip[p.key] = read();
      app.changed({ live: true });
    });
    el.addEventListener("change", () => app.changed());
    if (p.type === "color") el.addEventListener("focus", () => { app.lastColourKey = p.key; });
    if (p.type === "range") {
      const shown = document.createElement("span");
      shown.className = "range-value";
      const show = () => { shown.textContent = `${el.value}%`; };
      el.addEventListener("input", show);
      show();
      const wrap = document.createElement("span");
      wrap.append(el, shown);
      field("", wrap);
      continue;
    }
    field(p.label, el);
  }
  const colourKeys = EFFECTS[clip.effect].params.filter((p) => p.type === "color").map((p) => p.key);
  if (colourKeys.length) {
    groups.colours.append(paletteRow((c) => {
      const key = colourKeys.includes(app.lastColourKey) ? app.lastColourKey : colourKeys[0];
      clip[key] = c;
      app.lastColourKey = key;
      app.changed();
    }, button("Apply palette", () => {
      applyPalette(clip, currentPalette().colors);
      app.changed();
    }, "ghost")));
  }
  // Only groups with something in them (a legend alone) are shown.
  box.append(...Object.values(groups).filter((g) => g.children.length > 1));
  const actions = document.createElement("div");
  actions.className = "insp-actions";
  actions.append(button("Copy", copySelection, "ghost"),
    button("Copy to all lights", () => copyClipsTo([clip], sel.track, otherTracks(sel.track)), "ghost"),
    button("Delete clip", deleteSelected, "ghost danger"));
  box.append(actions);
}

// Experimental Govee scenes: the list comes from Govee's scene library for the light's model.
const sceneLists = {};
function scenePicker(clip, dev) {
  const sel = document.createElement("select");
  const sku = dev?.sku;
  if (!sku) {
    sel.add(new Option("Scan for this light to learn its model"));
    sel.disabled = true;
    return sel;
  }
  sel.add(new Option(clip.scene || "Loading scenes…", ""));
  (sceneLists[sku] ||= api(`api/scenes?sku=${encodeURIComponent(sku)}`)).then((list) => {
    sel.replaceChildren(new Option(list.length ? "Pick a scene" : `No scenes listed for ${sku}`, ""));
    const groups = {};
    list.forEach((s, i) => {
      const g = groups[s.category] ||= sel.appendChild(Object.assign(document.createElement("optgroup"), { label: s.category || "Scenes" }));
      g.append(new Option(s.name, i, false, s.code === clip.code && s.name === clip.scene));
    });
    sel.addEventListener("change", () => {
      const s = list[Number(sel.value)];
      if (!s) return;
      Object.assign(clip, { scene: s.name, code: s.code, param: s.param });
      app.changed();
    });
  }).catch((e) => {
    delete sceneLists[sku];
    sel.replaceChildren(new Option(`Couldn't load scenes: ${e.message}`));
    sel.disabled = true;
  });
  return sel;
}

// copy and paste ----------------------------------------------------------------
const trackName = (i) => app.devices[app.show.tracks[i]?.device]?.name || "missing light";
const otherTracks = (i) => app.show.tracks.map((_, k) => k).filter((k) => k !== i);
const clone = (clip) => JSON.parse(JSON.stringify(clip));

function copySelection() {
  const sel = app.selected;
  if (!sel || sel.range) { status("Select a clip or a light to copy", true); return; }
  const clips = sel.clip ? [sel.clip] : app.show.tracks[sel.track].clips;
  if (!clips.length) { status("Nothing to copy on this light", true); return; }
  app.clipboard = { clips: clips.map(clone), track: sel.track, whole: !sel.clip };
  status(`Copied ${clips.length} effect${clips.length > 1 ? "s" : ""}`);
  renderInspector();
}

// Onto another light, effects keep their times so the lights match.
// Onto the same light, they go to the playhead.
function paste() {
  const cb = app.clipboard, sel = app.selected;
  if (!cb) { status("Copy a clip or a light first", true); return; }
  if (!sel) { status("Select the light to paste onto", true); return; }
  let shift = 0;
  if (sel.track === cb.track && !cb.whole) shift = app.time - Math.min(...cb.clips.map((c) => c.start));
  const pasted = cb.clips.map((c) => ({ ...clone(c), start: c.start + shift, end: c.end + shift }));
  app.show.tracks[sel.track].clips.push(...pasted);
  app.selected = pasted.length === 1 ? { track: sel.track, clip: pasted[0] } : { track: sel.track, clip: null };
  status(`Pasted ${pasted.length} effect${pasted.length > 1 ? "s" : ""} onto ${trackName(sel.track)}`);
  app.changed();
}

function copyClipsTo(clips, from, targets, replace = false) {
  if (!targets.length) { status("There are no other lights", true); return; }
  for (const t of targets) {
    if (replace) app.show.tracks[t].clips = [];
    app.show.tracks[t].clips.push(...clips.map(clone));
  }
  status(`Copied ${clips.length} effect${clips.length > 1 ? "s" : ""} from ${trackName(from)} to `
    + (targets.length === 1 ? trackName(targets[0]) : `${targets.length} lights`));
  app.changed();
}

function renderTrackInspector(i) {
  const box = $("inspector");
  const clips = app.show.tracks[i].clips;
  box.replaceChildren();
  const h = document.createElement("h3");
  h.textContent = `${trackName(i)}: ${clips.length} effect${clips.length === 1 ? "" : "s"}`;
  box.append(h);
  if (app.show.tracks.length > 1 && clips.length) {
    const target = document.createElement("select");
    target.add(new Option("All other lights", "all"));
    for (const k of otherTracks(i)) target.add(new Option(trackName(k), k));
    const replace = document.createElement("input");
    replace.type = "checkbox";
    const label = document.createElement("label");
    label.append(replace, " Replace their effects");
    box.append("Copy all effects to ", target, label, button("Copy", () => {
      const targets = target.value === "all" ? otherTracks(i) : [Number(target.value)];
      copyClipsTo(clips, i, targets, replace.checked);
    }, "primary"));
  }
  if (clips.length) {
    box.append(paletteRow(null,
      button("Recolour this light", () => recolour([i]), "ghost"),
      button("Recolour all lights", () => recolour(app.show.tracks.map((_, k) => k)), "ghost")));
  }
  box.append(button("Copy (Ctrl+C)", copySelection, "ghost"));
  const p = button("Paste here (Ctrl+V)", paste, "ghost");
  p.disabled = !app.clipboard;
  box.append(p);
  if (clips.length) {
    box.append(button("Clear this light", () => {
      app.show.tracks[i].clips = [];
      app.changed();
    }, "ghost danger"));
  }
}

// colour palettes ---------------------------------------------------------------
const allPalettes = () => [...PRESET_PALETTES, ...app.palettes];
const currentPalette = () => allPalettes().find((p) => p.name === app.colourPalette) || PRESET_PALETTES[0];

function swatch(color, onclick) {
  const el = document.createElement(onclick ? "button" : "span");
  el.className = "swatch";
  el.style.background = color;
  el.title = color;
  if (onclick) el.addEventListener("click", () => onclick(color));
  return el;
}

// Palette picker for the inspector. Clicking a swatch calls onSwatch with its colour.
function paletteRow(onSwatch, ...actions) {
  const row = document.createElement("div");
  row.className = "palette-row";
  const sel = document.createElement("select");
  const groups = [["Presets", PRESET_PALETTES], ["Your palettes", app.palettes]];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const p of list) g.append(new Option(p.name, p.name, false, p.name === currentPalette().name));
    sel.append(g);
  }
  const swatches = document.createElement("span");
  swatches.className = "swatches";
  const fill = () => swatches.replaceChildren(...currentPalette().colors.map((c) => swatch(c, onSwatch)));
  sel.addEventListener("change", () => {
    app.colourPalette = sel.value;
    prefs.set("colourPalette", sel.value);
    fill();
  });
  fill();
  const label = document.createElement("label");
  label.append("Palette", sel);
  row.append(label, swatches, ...actions);
  if (onSwatch) row.title = "Click a colour to use it in the colour field you last picked";
  return row;
}

// Each light steps through the palette clip by clip, in time order, so lights stay matched.
function recolour(tracks) {
  const colors = currentPalette().colors;
  let n = 0;
  for (const t of tracks) {
    const clips = [...app.show.tracks[t].clips].sort((a, b) => a.start - b.start);
    let k = 0;
    for (const c of clips) if (applyPalette(c, colors, k)) { k++; n++; }
  }
  if (!n) { status("No effects with colours to recolour", true); return; }
  status(`Recoloured ${n} effect${n > 1 ? "s" : ""} with ${currentPalette().name}`);
  app.changed();
}

async function loadPalettes() {
  try { app.palettes = await api("api/palettes"); } catch { app.palettes = []; }
  renderPalettes();
  renderInspector();
}

let savePalettesTimer = null;
function savePalettes() {
  clearTimeout(savePalettesTimer);
  savePalettesTimer = setTimeout(async () => {
    try {
      await api("api/palettes", { method: "PUT", json: app.palettes });
      status("Palettes saved");
      renderInspector();
    } catch (e) { status(`Couldn't save palettes: ${e.message}`, true); }
  }, 300);
}

function uniqueName(base) {
  const names = new Set(allPalettes().map((p) => p.name));
  let name = base;
  for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
  return name;
}

function renderPalettes() {
  const mine = $("my-palettes"), presets = $("preset-palettes");
  const addMine = (p) => {
    app.palettes.push(p);
    savePalettes();
    renderPalettes();
  };
  presets.replaceChildren(...PRESET_PALETTES.map((p) => {
    const row = document.createElement("div");
    row.className = "palette-item";
    const name = document.createElement("span");
    name.className = "palette-name";
    name.textContent = p.name;
    const sw = document.createElement("span");
    sw.className = "swatches";
    sw.append(...p.colors.map((c) => swatch(c)));
    row.append(name, sw, button("Copy to my palettes", () =>
      addMine({ name: uniqueName(`My ${p.name}`), colors: [...p.colors] }), "ghost"));
    return row;
  }));
  if (!app.palettes.length) {
    mine.innerHTML = `<p class="hint">None yet. Press New palette, or copy a preset and change it.</p>`;
    return;
  }
  mine.replaceChildren(...app.palettes.map((p, i) => {
    const row = document.createElement("div");
    row.className = "palette-item";
    const name = document.createElement("input");
    name.value = p.name;
    name.maxLength = 60;
    name.addEventListener("change", () => {
      const v = name.value.trim();
      if (!v || allPalettes().some((q) => q !== p && q.name === v)) {
        status("Give each palette its own name", true);
        name.value = p.name;
        return;
      }
      if (app.colourPalette === p.name) app.colourPalette = v;
      p.name = v;
      savePalettes();
    });
    const sw = document.createElement("span");
    sw.className = "swatches";
    p.colors.forEach((c, k) => {
      const el = document.createElement("input");
      el.type = "color";
      el.value = c;
      el.addEventListener("change", () => { p.colors[k] = el.value; savePalettes(); });
      sw.append(el);
    });
    const add = button("+", () => { p.colors.push(p.colors.at(-1)); savePalettes(); renderPalettes(); }, "ghost");
    add.title = "Add a colour";
    add.disabled = p.colors.length >= 12;
    const remove = button("−", () => { p.colors.pop(); savePalettes(); renderPalettes(); }, "ghost");
    remove.title = "Remove the last colour";
    remove.disabled = p.colors.length <= 1;
    const del = button("Delete", () => {
      app.palettes.splice(i, 1);
      savePalettes();
      renderPalettes();
    }, "ghost danger");
    row.append(name, sw, add, remove, del);
    return row;
  }));
}

// selected stretch of time ---------------------------------------------------------
const rangeTracks = (r) => r.tracks.filter((t) => app.show.tracks[t]);

function renderRangeInspector(r) {
  const box = $("inspector");
  box.replaceChildren();
  const tracks = rangeTracks(r);
  const h = document.createElement("h3");
  h.textContent = `Selected ${fmtTime(r.start)} to ${fmtTime(r.end)} on `
    + (tracks.length === 1 ? trackName(tracks[0]) : `${tracks.length} lights`);
  box.append(h);
  const timeInput = (key) => {
    const el = document.createElement("input");
    el.type = "number";
    el.step = "0.01";
    el.min = "0";
    el.value = r[key].toFixed(2);
    el.addEventListener("change", () => {
      const v = Number(el.value);
      if (!Number.isFinite(v)) return;
      if (key === "start") r.start = Math.min(Math.max(0, v), r.end - 0.05);
      else r.end = Math.max(v, r.start + 0.05);
      app.select(app.selected);
    });
    const l = document.createElement("label");
    l.append(key === "start" ? "Start" : "End", el);
    return l;
  };
  const overlaps = tracks.some((t) => app.show.tracks[t].clips.some((c) => c.start < r.end && c.end > r.start));
  const del = button("Delete effects here", deleteRange, "ghost danger");
  del.disabled = !overlaps;
  box.append(timeInput("start"), timeInput("end"), del,
    button("▶ Play this part", () => { app.setRegion(r); app.seek(r.start); play(); }, "ghost"));
  const add = document.createElement("p");
  add.className = "hint";
  add.textContent = "Pick an effect to add it here:";
  box.append(add, effectPicker(addToRange));
}

function addToRange(effect) {
  const r = app.selected.range, tracks = rangeTracks(r);
  const added = tracks.map((t) => {
    const clip = newClip(effect, r.start, r.end);
    app.show.tracks[t].clips.push(clip);
    return { track: t, clip };
  });
  // One light: edit the new clip straight away. Several: keep the selection to add more.
  if (added.length === 1) app.selected = added[0];
  status(`Added ${EFFECTS[effect].label} to ${added.length === 1 ? trackName(tracks[0]) : `${added.length} lights`}`);
  app.changed();
}

// Clears the selected stretch: clips inside it go, clips crossing its edges are trimmed.
function deleteRange() {
  const r = app.selected.range;
  let n = 0;
  for (const t of rangeTracks(r)) {
    const kept = [];
    for (const c of app.show.tracks[t].clips) {
      if (c.end <= r.start || c.start >= r.end) { kept.push(c); continue; }
      n++;
      if (c.start < r.start) kept.push({ ...c, end: r.start });
      if (c.end > r.end) kept.push({ ...c, start: r.end });
    }
    app.show.tracks[t].clips = kept;
  }
  if (!n) { status("No effects in the selection"); return; }
  status(`Cleared ${n} effect${n > 1 ? "s" : ""} from the selection`);
  app.changed();
}

function deleteSelected() {
  const sel = app.selected;
  if (sel?.range) { deleteRange(); return; }
  if (!sel?.clip) return;
  const clips = app.show.tracks[sel.track].clips;
  clips.splice(clips.indexOf(sel.clip), 1);
  app.selected = null;
  app.changed();
}

function duplicateSelected() {
  const sel = app.selected;
  if (!sel?.clip) return;
  const len = sel.clip.end - sel.clip.start;
  const copy = { ...sel.clip, start: sel.clip.end, end: sel.clip.end + len };
  app.show.tracks[sel.track].clips.push(copy);
  app.selected = { track: sel.track, clip: copy };
  app.changed();
}

// shows -----------------------------------------------------------------------
async function refreshShows() {
  const shows = await api("api/shows");
  const sel = $("show-select");
  sel.replaceChildren();
  if (!app.showId) sel.add(new Option("Unsaved show", "", false, true));
  for (const s of shows) sel.add(new Option(s.name, s.id, false, s.id === app.showId));
  sel.add(new Option("＋ New show", "__new__"));
}

async function confirmDiscard() {
  if (!app.dirty) return true;
  if (autoSaveOn() && worthSaving()) {
    try { await autoSave(); return true; } catch { /* fall through to asking */ }
  }
  return confirm("You have unsaved changes. Discard them?");
}

// auto save -------------------------------------------------------------------
// Saves (and bakes) a couple of seconds after the last change. A brand-new show is only
// created once it has an effect in it, so trying things out doesn't litter the show list.
const AUTOSAVE_MS = 2000;
let autoSaveTimer = null, saving = null;
const autoSaveOn = () => $("autosave").checked;
const worthSaving = () => !!app.showId || app.show.tracks.some((t) => t.clips.length);

function renderSaveState(text) {
  $("save-state").textContent = text ?? (app.dirty ? (autoSaveOn() && worthSaving() ? "Unsaved changes…" : "Unsaved changes") : app.showId ? "All changes saved" : "");
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  renderSaveState();
  if (!autoSaveOn() || !app.dirty || !worthSaving()) return;
  autoSaveTimer = setTimeout(() => {
    // Saving re-bakes the show, so wait until playback stops.
    if (app.playing) { scheduleAutoSave(); return; }
    autoSave().catch((e) => status(`Auto save failed: ${e.message}`, true));
  }, AUTOSAVE_MS);
}

async function autoSave() {
  clearTimeout(autoSaveTimer);
  if (saving) await saving;
  if (!app.dirty) return;
  renderSaveState("Saving…");
  saving = save().finally(() => { saving = null; });
  try { await saving; } finally {
    renderSaveState();
    if (app.dirty) scheduleAutoSave(); // edited while saving
  }
}

async function openShow(id) {
  await stop();
  clearTimeout(autoSaveTimer);
  if (id) {
    app.show = await api(`api/shows/${encodeURIComponent(id)}`);
    app.show.beats ||= [];
    app.show.tracks ||= [];
  } else {
    app.show = blankShow();
  }
  app.showId = id || null;
  app.region = null;
  renderRegion();
  app.dirty = false;
  app.bakedKey = null;
  app.selected = null;
  app.history = [];
  ensureTracks();
  commit();
  prefs.set("lastShow", app.showId);
  renderSaveState();
  $("show-name").value = app.show.name;
  $("duration").value = Math.round(app.show.duration || 60);
  renderOutput();
  renderInspector();
  await loadAudio(app.show.audio);
  app.seek(0);
  await refreshShows();
  layoutPreview();
  timeline.layout();
}

async function save() {
  if (!app.showId) {
    const { id } = await api("api/shows", { method: "POST", json: { name: app.show.name } });
    app.showId = id;
    prefs.set("lastShow", id);
  }
  const key = JSON.stringify(app.deviceList.map((d) => [d.id, d.segments]));
  if (app.dirty || app.bakedKey === null) {
    app.show.duration = app.duration();
    const edits = app.edits;
    await api(`api/shows/${app.showId}`, { method: "PUT", json: app.show });
    if (app.edits === edits) app.dirty = false;
    app.bakedKey = null;  // saving the show clears the server's bake
  }
  if (app.bakedKey !== key) {
    const blob = bake(app.show, app.devices);
    await api(`api/shows/${app.showId}/baked`, {
      method: "PUT", body: blob, headers: { "Content-Type": "application/octet-stream" },
    });
    app.bakedKey = key;
  }
  await refreshShows();
  renderOutput();
}

async function saveClicked() {
  clearTimeout(autoSaveTimer);
  try {
    status("Saving…");
    if (saving) await saving;
    await save();
    status("Saved");
  } catch (e) { status(`Save failed: ${e.message}`, true); }
  renderSaveState();
}

// audio -----------------------------------------------------------------------
async function refreshAudio() {
  const list = await api("api/audio");
  const sel = $("audio-select");
  sel.replaceChildren(new Option("No song (lights only)", ""));
  const current = app.show.audio;
  for (const a of list) {
    const label = `${a.source === "media" ? "Media" : "Uploaded"}: ${a.path}`;
    const value = JSON.stringify(a);
    sel.add(new Option(label, value, false, !!current && current.source === a.source && current.path === a.path));
  }
}

let audioCtx;
async function loadAudio(ref) {
  app.peaks = null;
  app.audioDuration = 0;
  $("duration-wrap").hidden = !!ref;
  await refreshAudio();
  if (!ref) {
    audio.removeAttribute("src");
    audio.load();
    timeline.layout();
    return;
  }
  const url = audioUrl(ref);
  audio.src = url;
  status("Loading song…");
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    audioCtx ||= new AudioContext();
    const decoded = await audioCtx.decodeAudioData(buf);
    app.peaks = computePeaks(decoded);
    app.audioDuration = decoded.duration;
    status("");
  } catch (e) {
    status(`Couldn't load the song: ${e.message}`, true);
  }
  timeline.layout();
}

function computePeaks(buffer, rate = 100) {
  const size = Math.max(1, Math.floor(buffer.sampleRate / rate));
  const n = Math.ceil(buffer.length / size);
  const data = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let m = data[i];
      for (let j = i * size, end = Math.min(j + size, ch.length); j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > m) m = v;
      }
      data[i] = m;
    }
  }
  let max = 0;
  for (const v of data) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < n; i++) data[i] /= max;
  return { rate, data };
}

async function upload(file) {
  const form = new FormData();
  form.append("file", file);
  status(`Uploading ${file.name}…`);
  try {
    const ref = await api("api/audio", { method: "POST", body: form });
    app.show.audio = ref;
    app.changed();
    await loadAudio(ref);
    status("Uploaded");
  } catch (e) { status(`Upload failed: ${e.message}`, true); }
}

// speakers --------------------------------------------------------------------
// Two speakers: the one the editor plays on while you design (kept per browser), and the show
// speaker that automations play the show on (the show's own, or the default in Settings).
const speaker = () => prefs.get("editorSpeaker", "");
const speakerName = (id) => app.speakers.find((s) => s.entity_id === id)?.name || id;

async function loadSpeakers() {
  try {
    const body = await api("api/speakers");
    app.speakers = body.speakers;
    app.speakerCandidates = body.candidates || [];
    app.haAvailable = body.available;
    app.defaultSpeaker = body.show_speaker || null;
  } catch { app.speakers = []; app.speakerCandidates = []; }
  renderOutput();
  renderSpeakers();
}

// The Speakers tab: the speakers the editor offers, and HA's other media players to test and add.
const speakerTests = {}; // entity -> {busy, ok, text}

function renderSpeakers() {
  $("speakers-ha").textContent = app.haAvailable === false
    ? "Home Assistant isn't reachable from the add-on, so speakers can't be listed or tested right now." : "";
  const cells = (tr, ...items) => {
    for (const it of items) {
      const td = document.createElement("td");
      td.append(it);
      tr.append(td);
    }
    return tr;
  };
  const result = (entity) => {
    const t = speakerTests[entity];
    const span = document.createElement("span");
    span.className = `hint${t && !t.busy && !t.ok ? " error" : ""}`;
    span.textContent = t ? ` ${t.text}` : "";
    return span;
  };
  const testButton = (entity, label, cls = "") => {
    const b = button(speakerTests[entity]?.busy ? "Testing…" : label, () => testSpeaker(entity), cls);
    b.disabled = !!speakerTests[entity]?.busy;
    b.title = "Plays a short chime on it";
    return b;
  };
  const rows = $("speaker-rows");
  rows.replaceChildren(...app.speakers.map((s) => {
    const delay = document.createElement("input");
    Object.assign(delay, { type: "number", step: 10, value: s.delay_ms ?? 0 });
    delay.addEventListener("change", async () => {
      try {
        await api("api/speakers/delay", { method: "PUT", json: { entity_id: s.entity_id, delay_ms: Number(delay.value) || 0 } });
        s.delay_ms = Number(delay.value) || 0;
        renderOutput();
      } catch (err) { status(`Couldn't save the delay: ${err.message}`, true); }
    });
    const actions = document.createElement("span");
    actions.className = "group";
    actions.append(testButton(s.entity_id, "Test again", "ghost"), button("Remove", () => removeSpeaker(s.entity_id), "ghost danger"),
      result(s.entity_id));
    return cells(document.createElement("tr"), s.name, s.entity_id, s.state, delay, actions);
  }));
  if (!app.speakers.length) {
    rows.innerHTML = `<tr><td colspan="5" class="hint">None yet. Test a media player below to add it.</td></tr>`;
  }
  const others = (app.speakerCandidates || []).filter((c) => !c.added);
  const cand = $("candidate-rows");
  cand.replaceChildren(...others.map((c) => {
    const actions = document.createElement("span");
    actions.className = "group";
    if (c.can_play) actions.append(testButton(c.entity_id, "Test and add", "primary"), result(c.entity_id));
    else actions.append(Object.assign(document.createElement("span"), { className: "hint", textContent: "Can't be sent a song to play" }));
    return cells(document.createElement("tr"), c.name, c.entity_id, c.state, actions);
  }));
  if (!others.length) {
    cand.innerHTML = `<tr><td colspan="4" class="hint">${app.haAvailable === false ? "Home Assistant isn't reachable."
      : "No other media players in Home Assistant."}</td></tr>`;
  }
}

async function testSpeaker(entity) {
  speakerTests[entity] = { busy: true, text: "Playing a chime…" };
  renderSpeakers();
  try {
    const r = await api("api/speakers/test", { method: "POST", json: { entity_id: entity } });
    speakerTests[entity] = r.ok
      ? { ok: true, text: `✓ Works. It took ${r.start_s} s to start.` }
      : { ok: false, text: `✗ ${r.error}` };
  } catch (e) {
    speakerTests[entity] = { ok: false, text: `✗ ${e.message}` };
  }
  await loadSpeakers();
}

async function removeSpeaker(entity) {
  try { await api("api/speakers/remove", { method: "POST", json: { entity_id: entity } }); } catch (e) {
    status(`Couldn't remove it: ${e.message}`, true);
  }
  delete speakerTests[entity];
  await loadSpeakers();
}

// Fills a speaker <select>; a saved choice that HA no longer lists stays, marked unavailable.
function speakerOptions(sel, first, current, label = (s) => s.name) {
  sel.replaceChildren(new Option(first, ""));
  for (const s of app.speakers) sel.add(new Option(label(s), s.entity_id));
  if (current && !app.speakers.some((s) => s.entity_id === current)) {
    sel.add(new Option(`${current} (not added on the Speakers tab)`, current));
  }
  sel.value = current || "";
}

function renderOutput() {
  const current = speaker();
  speakerOptions($("output-select"), "Song in this browser", current, (s) => `Speaker: ${s.name}`);
  speakerOptions($("show-speaker"), app.defaultSpeaker ? `Default (${speakerName(app.defaultSpeaker)})`
    : "Default (lights only)", app.show.media_player);
  speakerOptions($("default-speaker"), "None (lights only)", app.defaultSpeaker);
  const sp = app.speakers.find((s) => s.entity_id === current);
  $("lights-wrap").hidden = !!current;
  $("offset-label").textContent = current ? "Speaker delay" : "Light offset";
  $("offset-hint").textContent = current
    ? "How late this speaker plays after it reports starting. Raise it if the lights lead the music."
    : "Use this to line the lights up with the audio if they lead or lag.";
  $("offset").value = current ? (sp?.delay_ms ?? 0) : prefs.get("offset", 0);
  $("automation-input").textContent = JSON.stringify({ action: "play", show: app.showId || app.show.name });
  $("automation-show").textContent = `"${app.show.name}"`;
}

async function offsetChanged(e) {
  const v = Number(e.target.value) || 0;
  if (!speaker()) { prefs.set("offset", v); return; }
  try {
    await api("api/speakers/delay", { method: "PUT", json: { entity_id: speaker(), delay_ms: v } });
    const sp = app.speakers.find((s) => s.entity_id === speaker());
    if (sp) sp.delay_ms = v;
  } catch (err) { status(`Couldn't save the delay: ${err.message}`, true); }
}

// transport -------------------------------------------------------------------
const lightsOn = () => $("lights").checked && app.show.tracks.some((t) => app.devices[t.device]?.ip);
const offset = () => (Number($("offset").value) || 0) / 1000;

function currentTime() {
  return hasAudio() && !app.remote ? audio.currentTime : (performance.now() - app.clockStart) / 1000;
}

// While a speaker plays, follow the add-on's clock.
async function followRemote() {
  try {
    const st = await api("api/player");
    if (!app.playing || !app.remote) return;
    if (!st.playing) { stop(); return; }
    app.clockStart = performance.now() - st.position * 1000;
  } catch { /* try again next tick */ }
}

async function syncLights() {
  if (app.remote) { followRemote(); return; }
  if (!app.playing || !lightsOn()) return;
  // The position is a little old by the time it arrives, so add half the last round trip.
  const sent = performance.now();
  try {
    await api("api/player/sync", { method: "POST", json: { position: currentTime() + (app.syncLatency || 0) } });
    const half = (performance.now() - sent) / 2000;
    app.syncLatency = app.syncLatency == null ? half : app.syncLatency * 0.8 + half * 0.2;
  } catch { /* the next sync will retry */ }
}

// Browser playback plays the region (when set) instead of the whole show.
const playEnd = () => (app.region && !app.remote ? Math.min(app.region.end, app.duration()) : app.duration());

function renderRegion() {
  const r = app.region;
  $("region-wrap").hidden = !r;
  if (r) $("region-label").textContent = `Region ${fmtTime(r.start)} to ${fmtTime(r.end)}`;
}

async function play() {
  if (app.playing || app.starting) return;
  app.starting = true;
  try {
    await stopLightPreview();
    await startPlaying();
  } finally {
    app.starting = false;
  }
}

async function startPlaying() {
  const r = app.region;
  if (r && !speaker() && (app.time < r.start || app.time >= r.end - 0.01)) app.seek(r.start);
  else if (app.time >= app.duration() - 0.01) app.seek(0);
  if (speaker()) {
    if (!app.show.audio) { status("Pick a song to play on a speaker", true); return; }
    try {
      status("Starting the speaker…");
      await save();
      const st = await api("api/player/play", {
        method: "POST", json: { show: app.showId, position: app.time, media_player: speaker() },
      });
      status(r || app.loop ? "Play region and Loop only work with the song in this browser" : "");
      app.clockStart = performance.now() - st.position * 1000;
    } catch (e) { status(`Couldn't play: ${e.message}`, true); return; }
    app.remote = true;
    app.playing = true;
    $("btn-play").textContent = "⏸ Stop";
    app.syncTimer = setInterval(syncLights, 500);
    return;
  }
  if (lightsOn()) {
    try {
      status("Preparing lights…");
      await save();
      await api("api/player/play", {
        method: "POST", json: { show: app.showId, position: app.time, offset: offset() },
      });
      status("");
    } catch (e) {
      status(`Lights unavailable: ${e.message}`, true);
    }
  }
  if (hasAudio()) {
    audio.currentTime = app.time;
    try { await audio.play(); } catch (e) { status(`Can't play audio: ${e.message}`, true); return; }
  } else {
    app.clockStart = performance.now() - app.time * 1000;
  }
  app.playing = true;
  $("btn-play").textContent = "⏸ Pause";
  syncLights();
  app.syncTimer = setInterval(syncLights, 1000);
}

async function stop() {
  const wasPlaying = app.playing;
  app.playing = false;
  app.remote = false;
  clearInterval(app.syncTimer);
  audio.pause();
  $("btn-play").textContent = "▶ Play";
  if (wasPlaying) {
    try { await api("api/player/stop", { method: "POST" }); } catch { /* nothing to stop */ }
  }
}

function tapBeat() {
  app.show.beats.push(app.time);
  app.show.beats.sort((a, b) => a - b);
  app.changed();
}

function fillBeats() {
  const bpm = Number($("bpm").value);
  if (!(bpm >= 20 && bpm <= 300)) { status("Enter a BPM between 20 and 300", true); return; }
  const start = app.time, step = 60 / bpm, end = app.duration();
  const beats = app.show.beats.filter((b) => b < start - 0.001);
  for (let t = start; t <= end; t += step) beats.push(Math.round(t * 1000) / 1000);
  app.show.beats = beats;
  app.changed();
}

function frame() {
  if (app.playing) {
    app.time = currentTime();
    const end = playEnd();
    if (app.time >= end) {
      if (app.loop && !app.remote) {
        app.seek(app.region ? app.region.start : 0);
        // The add-on's player stops at the end of the show, so start it again for the next lap.
        if (!app.region && lightsOn()) {
          api("api/player/play", { method: "POST", json: { show: app.showId, position: 0, offset: offset() } })
            .catch(() => {});
        }
      } else {
        app.time = end;
        stop();
      }
    }
    timeline.follow(app.time);
  }
  $("clock").textContent = fmtTime(app.time);
  timeline.drawPlayhead();
  drawPreview();
  drawHouse();
  drawClipPreview();
  requestAnimationFrame(frame);
}

// wiring ----------------------------------------------------------------------
function wire() {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t === tab);
      $("view-editor").hidden = tab.dataset.view !== "editor";
      $("view-devices").hidden = tab.dataset.view !== "devices";
      $("view-palettes").hidden = tab.dataset.view !== "palettes";
      $("view-house").hidden = tab.dataset.view !== "house";
      $("view-speakers").hidden = tab.dataset.view !== "speakers";
      if (tab.dataset.view === "speakers") loadSpeakers();
      if (tab.dataset.view === "house") renderHouseLights();
      $("view-settings").hidden = tab.dataset.view !== "settings";
      if (tab.dataset.view === "editor") { layoutPreview(); timeline.layout(); }
    });
  }

  $("show-select").addEventListener("change", async (e) => {
    const v = e.target.value;
    if (!(await confirmDiscard())) { await refreshShows(); return; }
    if (v === "__new__") await openShow(null);
    else if (v) await openShow(v);
  });
  $("show-name").addEventListener("change", (e) => {
    app.show.name = e.target.value.trim() || "Untitled show";
    app.changed();
  });
  $("btn-save").addEventListener("click", saveClicked);
  $("autosave").checked = prefs.get("autosave", true);
  $("autosave").addEventListener("change", (e) => { prefs.set("autosave", e.target.checked); scheduleAutoSave(); });
  $("btn-delete").addEventListener("click", async () => {
    if (!app.showId || !confirm(`Delete "${app.show.name}"? This can't be undone.`)) return;
    clearTimeout(autoSaveTimer);
    await api(`api/shows/${app.showId}`, { method: "DELETE" });
    app.dirty = false;
    await openShow(null);
  });

  $("audio-select").addEventListener("change", async (e) => {
    app.show.audio = e.target.value ? JSON.parse(e.target.value) : null;
    app.changed();
    await stop();
    await loadAudio(app.show.audio);
  });
  $("audio-upload").addEventListener("change", (e) => e.target.files[0] && upload(e.target.files[0]));
  $("duration").addEventListener("change", (e) => {
    app.show.duration = Math.max(1, Number(e.target.value) || 60);
    app.changed();
  });
  audio.addEventListener("ended", stop);

  $("btn-play").addEventListener("click", () => (app.playing ? stop() : play()));
  $("btn-home").addEventListener("click", () => app.seek(app.region ? app.region.start : 0));
  $("loop").checked = app.loop;
  $("loop").addEventListener("change", (e) => { app.loop = e.target.checked; prefs.set("loop", app.loop); });
  $("btn-clear-region").addEventListener("click", () => app.setRegion(null));
  $("btn-tap").addEventListener("click", tapBeat);
  $("btn-fill-beats").addEventListener("click", fillBeats);
  $("btn-clear-beats").addEventListener("click", () => {
    if (app.show.beats.length && confirm("Remove all beat markers?")) { app.show.beats = []; app.changed(); }
  });
  $("snap").checked = app.snap;
  $("snap").addEventListener("change", (e) => { app.snap = e.target.checked; prefs.set("snap", app.snap); });
  $("lights").checked = prefs.get("lights", true);
  $("lights").addEventListener("change", (e) => {
    prefs.set("lights", e.target.checked);
    if (!e.target.checked && app.playing) api("api/player/stop", { method: "POST" }).catch(() => {});
  });
  $("offset").addEventListener("change", offsetChanged);
  $("output-select").addEventListener("change", async (e) => {
    await stop();
    prefs.set("editorSpeaker", e.target.value);
    renderOutput();
  });
  $("show-speaker").addEventListener("change", (e) => {
    app.show.media_player = e.target.value || null;
    app.changed();
    renderOutput();
  });
  $("default-speaker").addEventListener("change", async (e) => {
    try {
      const body = await api("api/speakers/show", { method: "PUT", json: { entity_id: e.target.value || null } });
      app.defaultSpeaker = body.show_speaker;
    } catch (err) { status(`Couldn't save the default speaker: ${err.message}`, true); }
    renderOutput();
  });
  app.zoomed = () => prefs.set("pps", app.pps);
  $("btn-zoom-in").addEventListener("click", () => timeline.zoom(1.5));
  $("btn-zoom-out").addEventListener("click", () => timeline.zoom(1 / 1.5));

  $("btn-scan").addEventListener("click", scan);
  $("btn-new-palette").addEventListener("click", () => {
    app.palettes.push({ name: uniqueName("My palette"), colors: ["#ff0000", "#00ff00", "#0000ff"] });
    savePalettes();
    renderPalettes();
  });
  $("plan-model").addEventListener("change", planModelChanged);
  $("plan-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("plan-name").value.trim();
    const base = `planned-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "light"}`;
    let id = base;
    for (let n = 2; app.devices[id]; n++) id = `${base}-${n}`;
    const sku = app.models[skuOf($("plan-model").value)] ? skuOf($("plan-model").value) : "";
    app.deviceList.push({ id, name, ip: "", sku, segments: Number($("plan-segments").value) || 15, reverse: false, gradient: false, protocol: "standard", brightness: 100 });
    $("plan-name").value = "";
    $("plan-model").value = "";
    $("plan-info").replaceChildren();
    saveDevices();
  });
  $("add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const ip = $("add-ip").value.trim();
    addDevice({ id: ip, ip, sku: "" });
    $("add-ip").value = "";
  });

  document.addEventListener("keydown", (e) => {
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveClicked(); return; }
    if (typing || $("view-editor").hidden) return;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); restore(e.shiftKey ? 1 : -1); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); restore(1); }
    else if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); copySelection(); }
    else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); paste(); }
    else if (e.key === " ") { e.preventDefault(); app.playing ? stop() : play(); }
    else if (e.key === "b" || e.key === "B") tapBeat();
    else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    else if (e.key === "d" || e.key === "D") duplicateSelected();
    else if (e.key === "Home") app.seek(0);
    else if (e.key === "+" || e.key === "=") timeline.zoom(1.5);
    else if (e.key === "-") timeline.zoom(1 / 1.5);
    else if (e.key === "Escape") app.select(null);
  });
  window.addEventListener("beforeunload", (e) => { if (app.dirty) e.preventDefault(); });
}

async function init() {
  wire();
  wireHouse();
  const layout = new Layout(() => { layoutPreview(); timeline.layout(); });
  $("btn-reset-layout").addEventListener("click", () => layout.reset());
  $("exp-scenes").checked = experimentalOn();
  $("exp-scenes").addEventListener("change", (e) => {
    prefs.set("experimental.scenes", e.target.checked);
    if (!e.target.checked && EFFECTS[app.paletteEffect]?.experimental) app.paletteEffect = "solid";
    renderInspector();
  });
  try {
    await loadDevices();
    loadSpeakers();
    loadModels();
    loadPalettes();
    house.load().then(renderHouseLights);
    const shows = await api("api/shows");
    const last = prefs.get("lastShow", null);
    const id = shows.some((s) => s.id === last) ? last : shows[0]?.id;
    await openShow(id || null);
  } catch (e) {
    status(`Couldn't reach the add-on: ${e.message}`, true);
  }
  requestAnimationFrame(frame);
}

init();
