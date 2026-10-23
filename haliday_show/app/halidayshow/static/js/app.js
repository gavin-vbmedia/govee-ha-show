// Editor app: shows, songs, devices, transport and the clip inspector.

import { buildContext, checkClips, checkPresets, effectsForAI, placeClips } from "./aiclips.js";
import { analyseInWorker, toMono } from "./analysis.js";
import { STYLES, applyGenerated, generateShow, suggestLooks } from "./autogen.js";
import { clipFit, reachNote, worst } from "./compat.js";
import {
  EFFECTS, FPS, HOUSE, PRESETS, applyHouse, bake, composeLight, defaultParams, matchesPreset, presetParams,
  renderTrack, showDuration,
} from "./effects.js";
import { controllerId, nextFirstLed, nextUniverse, overlapping } from "./controllers.js";
import { partsFrame } from "./devicetest.js";
import { asShown, isSlow } from "./lightspeed.js";
import { LAB_TEMPLATES, flagSweep, modeSweep, startSweep, sweepWindow, windowSweep } from "./labtemplates.js";
import { House, partRgb } from "./house.js";
import { placeOnSample } from "./samplehouse.js";
import { DEMO_LIGHTS, DEMO_SHOW, DEMO_SONG, DEMO_SONG_NAME, canStartDemo, hasDemo, isDemoId, withoutDemo } from "./demo.js";
import { Layout } from "./layout.js";
import { STATUS, modelSummary, newLight, statusOf } from "./models.js";
import { MusicEditor } from "./music.js";
import { PRESET_PALETTES, applyPalette, paletteKeys, seasonalPalette } from "./palettes.js";
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
    try { const v = localStorage.getItem(`halidayshow.${key}`); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`halidayshow.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

function status(msg, error = false) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", error);
  if (!error && msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 4000);
}

// bars and sections come from Detect: bar start times, and [{start, end, label, energy}].
const blankShow = (name = "Untitled show") => ({
  name, audio: null, fps: FPS, duration: 60, beats: [], bars: [], sections: [], tracks: [],
});
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
  myPresets: [], // the user's own effect presets, {name, effect, params}; built-in ones are in effects.js
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
  models: {}, // Govee SKU -> {name, status?, protocol?, segments?, bulbs?, reach?, note?} (models.js)
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
      renderSongSummary();
      scheduleAutoSave();
    }
  },
};

const audio = $("audio");
const timeline = new Timeline(app);
const music = new MusicEditor({ api, status, songs: () => app.songs || [], songsChanged: () => refreshAudio() });
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

// A light split into parts plays as one pseudo-light per part, keyed "light#part", and its own
// track plays across all the parts joined together (see composeLight). Segments outside every part
// stay off. app.devices holds what each track plays on; app.lights holds the physical lights.
const partId = (d, p) => `${d.id}#${p.id}`;
function partDevice(d, p) {
  const segments = p.to - p.from + 1;
  return { ...d, id: partId(d, p), name: `${d.name} · ${p.name}`, partName: p.name, parent: d.id,
    partIndex: d.parts.indexOf(p), from: p.from, to: p.to, segments, parts: undefined,
    bulbs: d.bulbs ? Math.max(1, Math.round(d.bulbs * segments / d.segments)) : null };
}
// What a split light's own track plays on: its parts end to end, as one strip.
function allPartsDevice(d) {
  const segments = d.parts.reduce((n, p) => n + p.to - p.from + 1, 0);
  return { ...d, segments, light: d, bulbs: d.bulbs ? Math.max(1, Math.round(d.bulbs * segments / d.segments)) : null };
}
// The device a track plays on, or null for a missing light or a split light played as parts only.
const playingDev = (tr) => {
  const d = app.devices[tr.device];
  return d && d.light?.whole !== false ? d : null;
};

function indexDevices() {
  app.devices = {};
  app.lights = {};
  for (const d of app.deviceList) {
    app.lights[d.id] = d;
    app.devices[d.id] = d.parts?.length ? allPartsDevice(d) : d;
    for (const p of d.parts || []) app.devices[partId(d, p)] = partDevice(d, p);
  }
  ensureTracks();
  renderDevices();
  layoutPreview();
  timeline.layout();
}

// Every show has the House lane at the top, then a track per light.
function ensureTracks() {
  if (!app.show.tracks.some((t) => t.device === HOUSE)) {
    app.show.tracks.unshift({ device: HOUSE, clips: [] });
    app.selected = null; // track numbers have moved
  }
  const tracks = app.show.tracks, before = tracks.map((t) => t.device).join();
  const has = (id) => tracks.some((t) => t.device === id);
  for (const d of app.deviceList) {
    if (!d.parts?.length) {
      // Back where its parts were, if it had any.
      const at = tracks.findIndex((t) => t.device.startsWith(`${d.id}#`));
      if (!has(d.id)) tracks.splice(at < 0 ? tracks.length : at, 0, { device: d.id, clips: [] });
      continue;
    }
    const own = tracks.findIndex((t) => t.device === d.id);
    if (d.whole === false) {
      // Parts only: the light's own track goes, unless it still has effects on it.
      if (own >= 0 && !tracks[own].clips.length) tracks.splice(own, 1);
    } else if (own < 0) {
      const first = tracks.findIndex((t) => t.device.startsWith(`${d.id}#`));
      tracks.splice(first < 0 ? tracks.length : first, 0, { device: d.id, clips: [] });
    }
    // Part tracks go just under the whole light's track, in order.
    let at = tracks.findIndex((t) => t.device === d.id || app.devices[t.device]?.parent === d.id);
    if (at < 0) at = tracks.length;
    else if (tracks[at].device === d.id) at++;
    for (const p of d.parts) {
      const id = partId(d, p);
      const i = tracks.findIndex((t) => t.device === id);
      if (i >= 0) { at = Math.max(at, i + 1); continue; }
      tracks.splice(at, 0, { device: id, clips: [] });
      at++;
    }
  }
  // Empty tracks for parts that no longer exist.
  app.show.tracks = tracks.filter((t) => !t.device.includes("#") || app.devices[t.device] || t.clips.length);
  // Tracks follow the Devices tab's order: the House lane, then each light with its parts. Tracks for
  // missing lights stay at the end.
  const order = new Map(app.deviceList.map((d, i) => [d.id, i]));
  const rank = (t) => {
    if (t.device === HOUSE) return -1;
    const dev = app.devices[t.device];
    if (!dev) return Infinity;
    if (!dev.parent) return order.get(dev.id) * 1000;
    const light = app.lights[dev.parent];
    return order.get(light.id) * 1000 + 1 + light.parts.findIndex((p) => partId(light, p) === t.device);
  };
  app.show.tracks.sort((a, b) => rank(a) - rank(b) || 0);
  if (app.show.tracks.map((t) => t.device).join() !== before) app.selected = null; // track numbers have moved
}

async function saveDevices() {
  // Parts have to fit the light, so a light made shorter trims them.
  for (const d of app.deviceList) {
    d.parts = (d.parts || []).filter((p) => p.from <= d.segments).map((p) => ({ ...p, to: Math.min(p.to, d.segments) }));
  }
  try {
    app.deviceList = await api("api/devices", { method: "PUT", json: app.deviceList });
    indexDevices();
  } catch (e) { status(`Couldn't save devices: ${e.message}`, true); return; }
  for (const d of app.deviceList) retestLight(d);
}

// Tests running on the Devices tab, by light id. A light that changes while its test is still on
// gets the test again, so new segment counts, parts or Reverse show on the light straight away.
const deviceTests = {}; // id -> {what: "rainbow" | "parts" | a part's id, until, sent}

async function testLight(d, what = "rainbow") {
  const seconds = what === "rainbow" ? 20 : 60;
  const json = { ...d, seconds };
  if (what !== "rainbow") json.rgb = toHex(partsFrame(d, what === "parts" ? undefined : what));
  const sent = JSON.stringify({ ...json, seconds: 0 });
  try {
    await api("api/devices/test", { method: "POST", json });
    deviceTests[d.id] = { what, until: Date.now() + seconds * 1000, sent };
    return true;
  } catch (e) {
    delete deviceTests[d.id];
    status(`Test failed: ${e.message}`, true);
    return false;
  }
}

function retestLight(d) {
  const t = deviceTests[d.id];
  if (!t) return;
  const gone = !["rainbow", "parts"].includes(t.what) && !(d.parts || []).some((p) => p.id === t.what);
  if (t.until < Date.now() || !linked(d) || (d.protocol === "whole" && t.what !== "rainbow") || gone) {
    delete deviceTests[d.id];
    return;
  }
  const json = { ...d, seconds: 0 };
  if (t.what !== "rainbow") json.rgb = toHex(partsFrame(d, t.what === "parts" ? undefined : t.what));
  if (JSON.stringify(json) !== t.sent) testLight(d, t.what);
}

async function stopTest(d) {
  delete deviceTests[d.id];
  try { await api("api/devices/test", { method: "POST", json: { ...d, stop: true } }); } catch { /* it lets go by itself */ }
}

function renderDevices() {
  renderLab();
  const rows = $("device-rows");
  rows.replaceChildren();
  if (!app.deviceList.length) {
    rows.innerHTML = `<tr><td colspan="7" class="hint">No lights yet. Press <b>+ Add a light</b> to add one, or
      <button class="ghost small" data-demo>Try the demo</button> to see it working with lights on a sample house.</td></tr>`;
    rows.querySelector("[data-demo]").addEventListener("click", tryDemo);
  }
  renderDemo();
  for (const d of app.deviceList) {
    d.brightness ??= 100; // saved before per-light brightness existed
    const tr = document.createElement("tr");
    tr.className = "device-line";
    tr.title = `Edit ${d.name}`;
    const cell = (...kids) => { const td = document.createElement("td"); td.append(...kids); tr.append(td); return td; };
    cell(orderControls(d));
    cell(Object.assign(document.createElement("b"), { textContent: d.name }));
    cell(Object.assign(document.createElement("span"), { className: d.ip || isHa(d) ? "" : "hint",
      textContent: isHa(d) ? (d.entity || "Not picked yet") : d.ip || "Planned" }));
    const model = document.createElement("span");
    if (isWled(d)) model.append("WLED");
    else if (d.kind === "twinkly") model.append("Twinkly");
    else if (isHa(d)) model.append(d.protocol === "ha_switch" ? "HA switch" : "HA light");
    else if (d.kind === "ddp") model.append("DDP");
    else if (d.kind === "e131") model.append("E1.31");
    else model.append(d.sku || "–", modelBadge(d.sku));
    const clash = ["ddp", "e131"].includes(d.kind) && overlapping(app.deviceList, d);
    if (clash) model.append(Object.assign(document.createElement("div"), { className: "hint warn", textContent: `Shares LEDs with ${clash.name}` }));
    cell(model);
    const preview = cell(segmentPreview(d));
    preview.className = "device-preview";
    const test = button(linked(d) ? "Test" : "Planned", async () => {
      if (await testLight(d)) status(`Testing ${d.name} for 20 seconds`);
    }, "ghost");
    test.disabled = !linked(d);
    const edit = button("Edit", () => openLightEditor(d), "ghost device-edit");
    cell(test, " ", edit).className = "device-actions";
    tr.addEventListener("click", (e) => {
      if (!e.target.closest("button, input, select, .order")) openLightEditor(d);
    });
    rows.append(tr);
    dropTarget(tr, d);
  }
  if ($("light-dialog").open) renderLightEditor();
}

// A thin bar of the light's segments, each part in its colour, plus a short summary under it.
function segmentPreview(d) {
  const box = document.createElement("span");
  box.className = "seg-preview";
  const map = document.createElement("span");
  map.className = "parts-map mini";
  const parts = d.parts || [];
  const colourOf = (k) => `rgb(${partRgb(k).join()})`;
  // Long lights are drawn in at most 120 cells, so the bar stays readable.
  const n = Math.max(1, d.segments || 1), cells = Math.min(n, 120);
  for (let c = 0; c < cells; c++) {
    const s = Math.floor((c + 0.5) * n / cells) + 1;
    const span = document.createElement("span");
    const k = parts.findIndex((p) => p.from <= s && s <= p.to);
    span.style.background = k >= 0 ? colourOf(k) : parts.length ? "" : "var(--accent)";
    map.append(span);
  }
  const what = isHa(d) ? "one colour" : `${d.segments} segment${d.segments === 1 ? "" : "s"}`;
  const text = Object.assign(document.createElement("span"), { className: "hint",
    textContent: parts.length ? `${what} · ${parts.length} part${parts.length === 1 ? "" : "s"}` : what });
  box.title = parts.length ? parts.map((p) => `${p.name}: ${p.from}–${p.to}`).join("\n") : "";
  box.append(map, text);
  return box;
}

// The settings and parts for one light, built fresh each time the list changes.
function lightFields(d) {
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
    const out = [];
    const cell = (child, label, hint) => out.push({ child, label, hint });
    cell(input("text", "name", { size: 20 }), "Name");
    const ip = document.createElement("input");
    Object.assign(ip, { value: d.ip, placeholder: "Not linked yet", size: 13, title: "The light's IP address. Leave blank for a planned light." });
    ip.addEventListener("change", () => {
      const v = ip.value.trim();
      if (v && !/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) { status("That isn't an IP address", true); ip.value = d.ip; return; }
      d.ip = v;
      saveDevices();
    });
    if (isHa(d)) {
      const pick = document.createElement("select");
      pick.title = "The Home Assistant light or switch this is";
      fillHaPicker(pick, d.entity);
      pick.addEventListener("change", () => {
        d.entity = pick.value;
        d.protocol = pick.value.startsWith("switch.") ? "ha_switch" : "ha_light";
        saveDevices();
      });
      cell(pick, "Light or switch");
    } else cell(ip, "IP address", "Leave blank for a planned light.");
    const wled = isPixels(d) || isHa(d);
    const model = document.createElement("span");
    if (isWled(d)) model.append("WLED");
    else if (d.kind === "twinkly") model.append("Twinkly (experimental)");
    else if (isHa(d)) model.append(d.protocol === "ha_switch" ? "Home Assistant switch" : "Home Assistant light");
    else if (d.kind === "ddp") {
      const first = input("number", "first", { min: 1, max: 100000, className: "seg-num",
        title: "The LED on the controller where this light starts. Lights sharing a controller each start at their own LED." });
      first.value = d.first || 1;
      model.append("Pixel controller · first LED ", first);
    } else if (d.kind === "e131") {
      const universe = input("number", "universe", { min: 1, max: 63999, className: "seg-num",
        title: "The universe this light starts in, as set on the controller" });
      universe.value = d.universe || 1;
      const channel = input("number", "channel", { min: 1, max: 510, className: "seg-num",
        title: "The channel in that universe where this light starts. Each LED takes 3 channels; universes hold 510." });
      channel.value = d.channel || 1;
      model.append("E1.31 · universe ", universe, " channel ", channel);
    } else model.append(d.sku || "–", modelBadge(d.sku));
    if (["ddp", "e131"].includes(d.kind)) {
      const clash = overlapping(app.deviceList, d);
      if (clash) {
        const warn = document.createElement("div");
        warn.className = "hint warn";
        warn.textContent = `Shares LEDs with ${clash.name}`;
        model.append(warn);
      }
    }
    cell(model, "Model");
    const segs = document.createElement("span");
    const find = button("Find", () => findSegments(d), "ghost");
    find.disabled = !d.ip || LONG_PROTOCOLS.includes(d.protocol);
    find.title = d.ip ? "Work out the segment count with a few yes or no questions" : "Link this light first";
    const count = input("number", "segments", { min: 1, max: LONG_PROTOCOLS.includes(d.protocol) ? 1000 : 255 });
    if (isHa(d)) Object.assign(count, { disabled: true, title: "A Home Assistant light is one colour at a time" });
    if (wled) count.title = "How many LEDs the light has. Each one is a segment.";
    segs.append(count);
    if (!wled) segs.append(" ", find);
    cell(segs, "Segments", isHa(d) ? "" : wled ? "How many LEDs it has." : "Press <b>Find</b> to work it out with a few yes or no questions, or use <b>Test</b>.");
    const bulbs = document.createElement("input");
    Object.assign(bulbs, { type: "number", min: 1, max: 2000, value: d.bulbs ?? "", placeholder: `${d.segments * 4}?`,
      title: "How many bulbs the light has, so the House view draws each one. Blank guesses 4 per segment." });
    bulbs.addEventListener("change", () => {
      const v = Math.round(Number(bulbs.value));
      d.bulbs = v >= 1 ? Math.min(v, 2000) : null;
      saveDevices();
    });
    cell(bulbs, "Bulbs", "So the House view draws each one. Blank guesses 4 per segment.");
    cell(input("number", "brightness", { min: 1, max: 100, title: "Caps this light in every show. 100 is full brightness." }),
      "Brightness %", "Caps this light in every show.");
    if (!isHa(d)) cell(input("checkbox", "reverse"), "Reverse", "Tick if Test's white dot runs the wrong way.");
    if (!wled) cell(input("checkbox", "gradient"), "Blend", "Ask the light to blend between segments.");
    if (wled) {
      const how = document.createElement("span");
      how.className = "hint";
      how.textContent = isHa(d) ? "Home Assistant" : d.kind === "e131" ? "E1.31" : d.kind === "twinkly" ? "Twinkly" : "DDP";
      how.title = d.kind === "twinkly" ? "Twinkly's own realtime mode. It isn't official, so this is experimental."
        : isHa(d) ? "Changes go through Home Assistant, so they're slow: a few a second for a light, one a second for a switch"
        : isWled(d) ? "Colours go to the strip over DDP, which WLED listens for with no setup"
        : d.kind === "e131" ? "Colours go straight to the controller's IP over E1.31 (sACN)"
        : "Colours go to the controller over DDP. Turn DDP on in the controller's settings if it has a switch for it.";
      cell(how, "Sent by");
    } else {
      const proto = document.createElement("select");
      for (const [v, label] of Object.entries(PROTOCOLS)) proto.add(new Option(label, v, false, v === (d.protocol || "standard")));
      proto.title = "How colours are sent. If Test only turns the light on, try the next one.";
      proto.addEventListener("change", () => { d.protocol = proto.value; saveDevices(); });
      cell(proto, "Protocol", "How colours are sent. If <b>Test</b> only turns the light on, try the next one.");
    }
    return out;
}

// The Edit light window. Saving swaps in fresh light objects, so it follows the light by id.
const lightEdit = { id: null };

function openLightEditor(d) {
  lightEdit.id = d.id;
  renderLightEditor();
  $("light-dialog").showModal();
}

function renderLightEditor() {
  const d = app.lights[lightEdit.id];
  const dlg = $("light-dialog");
  if (!d) { dlg.close(); return; }
  $("light-title").textContent = d.name;
  const body = $("light-body"), scroll = body.scrollTop;
  const grid = document.createElement("div");
  grid.className = "light-fields";
  for (const f of lightFields(d)) {
    const row = document.createElement("div");
    row.className = "light-field";
    const label = Object.assign(document.createElement("span"), { className: "light-label", textContent: f.label });
    const val = document.createElement("div");
    val.className = "light-value";
    val.append(f.child);
    if (f.hint) val.append(Object.assign(document.createElement("span"), { className: "hint", innerHTML: f.hint }));
    row.append(label, val);
    grid.append(row);
  }
  body.replaceChildren(grid);
  if (!isHa(d)) {
    const parts = partsPanel(d);
    parts.classList.add("light-parts");
    body.append(parts);
  }
  body.scrollTop = scroll;
  const test = $("light-test");
  test.disabled = !linked(d);
  test.textContent = linked(d) ? "Test" : "Planned";
}

// Moves light `d` to position `to` in the list. Every show's tracks follow the list's order.
function moveDevice(d, to) {
  const list = app.deviceList.filter((x) => x !== d);
  to = Math.max(0, Math.min(to, list.length));
  list.splice(to, 0, d);
  if (list.every((x, i) => x === app.deviceList[i])) return;
  app.deviceList = list;
  saveDevices();
}

// A drag handle and up and down buttons. Rows take a drop above or below.
const deviceDrag = { from: null };
function orderControls(d) {
  const box = document.createElement("span");
  box.className = "order";
  const grip = document.createElement("span");
  grip.className = "grip";
  grip.textContent = "⠿";
  grip.title = "Drag to reorder";
  grip.draggable = true;
  grip.addEventListener("dragstart", (e) => {
    deviceDrag.from = d;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", d.id);
    e.dataTransfer.setDragImage(grip.closest("tr"), 10, 10);
  });
  grip.addEventListener("dragend", () => { deviceDrag.from = null; dropMarks(); });
  const i = app.deviceList.indexOf(d);
  const up = button("↑", () => moveDevice(d, i - 1), "ghost small");
  const down = button("↓", () => moveDevice(d, i + 1), "ghost small");
  up.title = "Move up"; down.title = "Move down";
  up.disabled = i === 0;
  down.disabled = i === app.deviceList.length - 1;
  const arrows = document.createElement("span");
  arrows.className = "arrows";
  arrows.append(up, down);
  box.append(grip, arrows);
  return box;
}

const dropMarks = (keep) => {
  for (const r of document.querySelectorAll("#device-rows .drop-above, #device-rows .drop-below")) {
    if (r !== keep) r.classList.remove("drop-above", "drop-below");
  }
};

// Drops onto the device row `tr`: above the light if in its top half, else below.
function dropTarget(tr, d) {
  const rowsOf = () => [tr, null];
  const where = (e) => {
    const [top, bottom] = rowsOf();
    const a = top.getBoundingClientRect().top, b = (bottom || top).getBoundingClientRect().bottom;
    return e.clientY < (a + b) / 2 ? "above" : "below";
  };
  for (const el of rowsOf().filter(Boolean)) {
    el.addEventListener("dragover", (e) => {
      if (!deviceDrag.from) return;
      e.preventDefault();
      const above = where(e) === "above";
      dropMarks(tr);
      tr.classList.toggle("drop-above", above);
      tr.classList.toggle("drop-below", !above);
    });
    el.addEventListener("drop", (e) => {
      const from = deviceDrag.from;
      if (!from) return;
      e.preventDefault();
      dropMarks();
      const list = app.deviceList.filter((x) => x !== from);
      moveDevice(from, list.indexOf(d) + (where(e) === "above" ? 0 : 1));
    });
  }
}

// Runs of segments (1-based, inclusive) that no part covers.
function unusedRuns(d) {
  const used = new Uint8Array(d.segments + 2);
  for (const p of d.parts || []) for (let s = p.from; s <= p.to; s++) used[s] = 1;
  const runs = [];
  for (let s = 1; s <= d.segments; s++) {
    if (used[s]) continue;
    const from = s;
    while (s < d.segments && !used[s + 1]) s++;
    runs.push([from, s]);
  }
  return runs;
}

const runText = (runs) => runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");

// Parts split a light into pieces that each get their own track, like a roof line that runs
// round a corner. Segments outside every part stay off in shows.
function partsPanel(d) {
  const tr = document.createElement("section");
  const td = tr;
  const parts = d.parts || [];
  const add = () => {
    // The first gap after the last part, so parts go on round the light in order.
    const runs = unusedRuns(d), end = Math.max(0, ...parts.map((p) => p.to));
    const run = runs.find(([a]) => a > end) || runs[0];
    if (!run) { status("Every segment is already in a part", true); return; }
    let n = 1;
    while (parts.some((p) => p.id === `p${n}` || p.name === `Part ${n}`)) n++;
    d.parts = [...parts, { id: `p${n}`, name: `Part ${n}`, from: run[0], to: run[1] }].sort((a, b) => a.from - b.from);
    saveDevices();
  };
  const fromWled = isWled(d) && d.ip ? button("Use WLED segments", () => useWledSegments(d), "ghost small") : null;
  if (fromWled) fromWled.title = "Make a part from each segment you've set up in WLED, with its name and LEDs";
  if (!parts.length) {
    const b = button("Split into parts…", add, "ghost small");
    b.title = "Give stretches of this light their own tracks, and leave segments you can't see off";
    td.append(b);
    if (fromWled) td.append(" ", fromWled);
    return tr;
  }
  // One part per line, with a map of the light's segments: each part in its colour, unused ones grey.
  const panel = document.createElement("div");
  panel.className = "parts-panel";
  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = "Parts";
  const map = document.createElement("div");
  map.className = "parts-map";
  map.title = "Where each part sits on the light. Grey segments are unused and stay off.";
  const list = document.createElement("div");
  list.className = "parts-list";
  panel.append(label, map, list);
  td.append(panel);
  const colourOf = (k) => `rgb(${partRgb(k).join()})`;
  for (let s = 1; s <= d.segments; s++) {
    const cell = document.createElement("span");
    const k = parts.findIndex((p) => p.from <= s && s <= p.to);
    if (k >= 0) cell.style.background = colourOf(k);
    map.append(cell);
  }
  parts.forEach((p, k) => {
    const chip = document.createElement("div");
    chip.className = "part-chip";
    const swatch = document.createElement("span");
    swatch.className = "part-swatch";
    swatch.style.background = colourOf(k);
    const name = document.createElement("input");
    Object.assign(name, { value: p.name, size: 10, maxLength: 40, title: "The part's name on the timeline" });
    name.addEventListener("change", () => { p.name = name.value.trim() || p.name; saveDevices(); });
    const num = (key) => {
      const el = document.createElement("input");
      Object.assign(el, { type: "number", min: 1, max: d.segments, value: p[key], className: "seg-num",
        title: key === "from" ? "First segment, counted from the start of the show" : "Last segment" });
      el.addEventListener("change", () => {
        const v = Math.round(Number(el.value));
        const next = { ...p, [key]: v };
        const clash = parts.find((o) => o !== p && o.from <= next.to && next.from <= o.to);
        if (!(v >= 1 && v <= d.segments) || next.from > next.to) {
          status(`Segments run from 1 to ${d.segments}, and a part's first comes before its last`, true);
        } else if (clash) {
          status(`That overlaps ${clash.name}`, true);
        } else {
          p[key] = v;
          d.parts.sort((a, b) => a.from - b.from);
          saveDevices();
          return;
        }
        el.value = p[key];
      });
      return el;
    };
    const del = button("✕", () => {
      d.parts = parts.filter((o) => o !== p);
      saveDevices();
    }, "ghost small");
    del.title = `Remove ${p.name}. Its clips stay in your shows.`;
    const test = button("Test", async () => {
      if (await testLight(d, p.id)) status(`${p.name} is lit for a minute, white at its first segment. Change its segments to move it.`);
    }, "ghost small");
    test.title = "Light just this part on the real light, so you can see where it starts and ends";
    test.disabled = !linked(d) || d.protocol === "whole";
    const count = document.createElement("span");
    count.className = "hint";
    count.textContent = `${p.to - p.from + 1} segments`;
    chip.append(swatch, name, " segments ", num("from"), "–", num("to"), count, test, del);
    list.append(chip);
  });
  const more = button("+ Add part", add, "ghost small");
  more.disabled = !unusedRuns(d).length;
  const asOne = document.createElement("label");
  asOne.className = "part-whole";
  asOne.title = "Give the light its own track too, playing across all its parts as one strip. Turn off if you only use the parts.";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = d.whole !== false;
  box.addEventListener("change", () => { d.whole = box.checked; saveDevices(); });
  asOne.append(box, " Also play as one");
  const unused = unusedRuns(d);
  const note = document.createElement("span");
  note.className = "hint";
  note.textContent = unused.length ? `Unused, off in shows: ${runText(unused)}` : "Every segment is in a part";
  const foot = document.createElement("div");
  foot.className = "parts-foot";
  const testAll = button("Test parts", async () => {
    if (await testLight(d, "parts")) status(`${d.name}'s parts are lit in their colours for a minute, each white at its first segment`);
  }, "ghost small");
  testAll.title = "Light every part in its colour on the real light, with unused segments off";
  testAll.disabled = !linked(d) || d.protocol === "whole";
  const stop = button("Stop", () => stopTest(d), "ghost small");
  stop.title = "Let the light go back to what it was doing";
  stop.disabled = !linked(d);
  foot.append(more, testAll, stop);
  if (fromWled) foot.append(fromWled);
  foot.append(asOne, note);
  panel.append(foot);
  return tr;
}

// Find segments: light one segment at a time and halve the range on each answer. A light with
// fewer segments than the frame has nowhere to show the white one, so "anything lit?" can be
// answered with the light still on its reel.
const finder = { device: null, lo: 1, hi: 128, max: 128, guess: 0, steps: 0, busy: false };

async function probe(segment, d = finder.device) {
  return api("api/devices/probe", { method: "POST", json: { ...d, segment } });
}

// Shown in a window so the questions are in front of you, wherever the light's row is on the page.
function finderView(state, text) {
  const asking = state === "asking";
  $("finder-question").textContent = text;
  $("finder-question").className = state === "error" ? "hint error" : "";
  $("finder-yes").hidden = $("finder-no").hidden = !asking;
  $("finder-yes").disabled = $("finder-no").disabled = state === "busy";
  if (state === "busy") $("finder-yes").hidden = $("finder-no").hidden = false;
  $("finder-cancel").hidden = state === "done" || state === "error";
  $("finder-done").hidden = !(state === "done" || state === "error");
  $("finder-note").hidden = !(asking || state === "busy");
}

async function findSegments(d) {
  if (finder.device) await stopFinder();
  Object.assign(finder, { device: d, lo: 1, hi: 128, steps: 0, busy: false });
  $("finder-title").textContent = `Find segments on ${d.name}`;
  $("finder-progress").textContent = "";
  $("finder-bar").hidden = true;
  finderView("busy", `Connecting to ${d.name}…`);
  if (!$("finder").open) $("finder").showModal();
  try {
    const { max } = await probe(1);
    finder.hi = finder.max = max;
  } catch (e) {
    finder.device = null;
    finderView("error", `Couldn't reach ${d.name}: ${e.message}. Check it's switched on, then try again.`);
    return;
  }
  // Segment 1 always exists, so the first real question is the middle of the range.
  await askFinder();
}

async function askFinder() {
  if (finder.lo >= finder.hi) return finishFinder();
  finder.guess = Math.ceil((finder.lo + finder.hi) / 2);
  finder.steps++;
  const left = Math.ceil(Math.log2(finder.hi - finder.lo + 1));
  $("finder-progress").textContent = `Question ${finder.steps} of about ${finder.steps + left - 1}`;
  $("finder-bar").hidden = false;
  $("finder-bar").firstElementChild.style.width = `${Math.round(100 * (finder.steps - 1) / (finder.steps + left - 1))}%`;
  finderView("busy", "Lighting one segment…");
  try {
    await probe(finder.guess);
    finderView("asking", "One segment is lit white and everything else is off. Can you see any light on it?");
  } catch (e) {
    await stopFinder(false);
    finderView("error", `Find stopped: ${e.message}`);
  }
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
  await stopFinder(false);
  d.segments = finder.lo;
  await saveDevices();
  renderDevices();
  $("finder-progress").textContent = "";
  $("finder-bar").firstElementChild.style.width = "100%";
  finderView("done", stretched
    ? `${d.name} lit every segment asked for, so it may stretch the colours itself. Segments is set to ${finder.lo}: press Test to check.`
    : `${d.name} has ${finder.lo} segments. Segments is set to ${finder.lo}.`);
}

async function stopFinder(close = true) {
  if (close && $("finder").open) $("finder").close();
  if (!finder.device) return;
  const d = finder.device;
  finder.device = null;
  try { await probe(0, d); } catch { /* the light falls back to its own scene within a minute anyway */ }
}

$("light-dialog").addEventListener("click", async (e) => {
  const what = e.target.closest("[data-light]")?.dataset.light;
  const d = app.lights[lightEdit.id];
  if (what === "close" || !d) $("light-dialog").close();
  else if (what === "test") { if (await testLight(d)) status(`Testing ${d.name} for 20 seconds`); }
  else if (what === "remove") {
    if (!confirm(`Remove ${d.name}? Its clips stay in your shows.`)) return;
    $("light-dialog").close();
    app.deviceList = app.deviceList.filter((x) => x.id !== d.id);
    saveDevices();
  }
});
$("finder-yes").addEventListener("click", () => answerFinder(true));
$("finder-no").addEventListener("click", () => answerFinder(false));
$("finder").addEventListener("click", (e) => {
  if (e.target.closest("[data-finder]")) stopFinder();
});
// Escape closes the window; make sure the light is let go too.
$("finder").addEventListener("close", () => { if (finder.device) stopFinder(false); });

// Govee models ------------------------------------------------------------------
async function loadModels() {
  try {
    const { models } = await (await fetch("static/models.json")).json();
    app.models = Object.fromEntries(models.map((m) => [m.sku, m]));
    const list = $("model-list");
    for (const m of models) list.append(new Option(`${m.sku} ${m.name}${m.status ? "" : " (untested)"}`, m.sku));
    list.append(new Option("WLED strip", "WLED"), new Option("Pixel controller (DDP)", "DDP"),
      new Option("Pixel controller (E1.31)", "E1.31"), new Option("Home Assistant light or switch", "HA"),
      new Option("Twinkly (experimental)", "Twinkly"));
    renderDevices();
    timeline.draw(); // lights' notes on the timeline come from the models
  } catch { /* the picker is a convenience; manual entry still works */ }
}

const isWled = (d) => d?.kind === "wled";
const isHa = (d) => d?.kind === "ha";
// Whether a light has somewhere to send to: an IP, or a Home Assistant entity (output.linked).
const linked = (d) => !!(d?.ip || d?.entity);

// Home Assistant's lights and switches, fetched once when first needed (server.py ha_entities).
let haEntities = null;
async function loadHaEntities() {
  if (!haEntities) haEntities = await api("api/ha/entities");
  return haEntities;
}

// The add functions below are used by the Add a light window: each returns what to tell the user,
// or throws with the reason it couldn't be added.
function addHaLight(entity) {
  const found = (haEntities || []).find((e) => e.entity === entity);
  if (!found) throw new Error("Pick a light or switch first");
  if (app.deviceList.some((d) => d.entity === entity)) throw new Error(`${found.name} is already on the list`);
  app.deviceList.push({ id: `ha-${entity}`, kind: "ha", name: found.name, ip: "", entity, sku: "",
    protocol: entity.startsWith("switch.") ? "ha_switch" : "ha_light", segments: 1, bulbs: 1,
    reverse: false, gradient: false, brightness: 100 });
  saveDevices();
  return `Added ${found.name}. ${entity.startsWith("switch.") ? "It turns on when the show is bright there, at most once a second." : "It takes the show's colour a few times a second."}`;
}

async function fillHaPicker(select, current = "") {
  select.replaceChildren(new Option("Loading…", ""));
  try {
    const list = await loadHaEntities();
    select.replaceChildren(new Option(current ? "Not linked" : "Pick a light or switch", ""),
      ...list.map((e) => new Option(`${e.name} (${e.entity})`, e.entity, false, e.entity === current)));
    if (current && !list.some((e) => e.entity === current)) select.add(new Option(`${current} (not found)`, current, false, true));
  } catch (e) {
    select.replaceChildren(new Option(current || "Home Assistant isn't reachable", current));
    status(`Couldn't list Home Assistant's lights: ${e.message}`, true);
  }
}
const isPixels = (d) => ["wled", "ddp", "e131", "twinkly"].includes(d?.kind); // one LED a segment, not a Govee light

// Twinkly (experimental): asks the light for its name and LED count, like WLED.
async function addTwinkly(ip) {
  if (app.deviceList.some((d) => d.ip === ip)) throw new Error(`${ip} is already on the list`);
  {
    const t = await api("api/twinkly/info", { method: "POST", json: { ip } })
      .catch((e) => { throw new Error(`Couldn't reach a Twinkly light there: ${e.message}`); });
    const segments = Math.min(t.leds, t.max);
    app.deviceList.push({ id: `twinkly-${ip}`, kind: "twinkly", name: t.name, ip, sku: "", protocol: "twinkly",
      segments, bulbs: segments, reverse: false, gradient: false, brightness: 100 });
    saveDevices();
    return `Added ${t.name}: ${segments} LEDs. Twinkly support is experimental, so press Test to check it.`;
  }
}

// A pixel controller: no API to ask, so the LED count comes from the form. A second light on the same
// controller starts just after the last one.
function addController(ip, leds, kind = "ddp") {
  const segments = Math.min(Math.max(Math.round(leds) || 50, 1), 1000);
  const n = app.deviceList.filter((d) => d.kind === kind && d.ip === ip).length + 1;
  const name = `Pixels ${ip.split(".").pop()}${n > 1 ? ` (${n})` : ""}`;
  const light = { id: controllerId(app.deviceList, ip, kind), kind, name, ip, sku: "", protocol: kind, segments,
    bulbs: segments, reverse: false, gradient: false, brightness: 100 };
  let where;
  if (kind === "e131") {
    Object.assign(light, nextUniverse(app.deviceList, ip));
    where = `universe ${light.universe}, channel ${light.channel}`;
  } else {
    light.first = nextFirstLed(app.deviceList, ip);
    where = `LED ${light.first}`;
  }
  app.deviceList.push(light);
  saveDevices();
  return `Added ${segments} LEDs on ${ip}, starting at ${where}. Press Test to check them.`;
}
// Protocols that aren't limited to 255 segments a light.
const LONG_PROTOCOLS = ["whole", "segments", "pixels", "ddp", "e131"];

// Asks a WLED light for its name, LED count and segments (server.py wled_info).
async function wledInfo(ip) {
  const info = await api("api/wled/info", { method: "POST", json: { ip } });
  if (info.leds > info.max) status(`${info.name} has ${info.leds} LEDs; shows can drive the first ${info.max}`, true);
  return { ...info, leds: Math.min(info.leds, info.max) };
}

async function addWled(ip) {
  if (app.deviceList.some((d) => d.ip === ip)) throw new Error(`${ip} is already on the list`);
  {
    const w = await wledInfo(ip).catch((e) => { throw new Error(`Couldn't reach a WLED light there: ${e.message}`); });
    app.deviceList.push({ id: `wled-${ip}`, kind: "wled", name: w.name, ip, sku: "", protocol: "ddp",
      segments: w.leds, bulbs: w.leds, reverse: false, gradient: false, brightness: 100, parts: w.parts });
    saveDevices();
    return `Added ${w.name}: ${w.leds} LEDs${w.parts.length ? `, with ${w.parts.length} parts from its WLED segments` : ""}.`;
  }
}

// Replaces a WLED light's parts with its WLED segments. Part ids follow WLED's segment ids, so clips
// on a part stay with it when the segments are fetched again.
async function useWledSegments(d) {
  try {
    const w = await wledInfo(d.ip);
    if (!w.parts.length) { status(`${d.name} has only one segment in WLED, so there's nothing to split`, true); return; }
    if (d.parts?.length && !confirm(`Replace ${d.name}'s parts with its ${w.parts.length} WLED segments? Clips on parts that disappear stay in your shows.`)) return;
    d.segments = w.leds;
    d.parts = w.parts;
    saveDevices();
    status(`${d.name} now has ${w.parts.length} parts: ${w.parts.map((p) => p.name).join(", ")}`);
  } catch (e) { status(`Couldn't read ${d.name}'s segments: ${e.message}`, true); }
}

// Lights accept different forms of the realtime packet. See protocol.py.
const PROTOCOLS = {
  standard: "Realtime",
  razer: "Realtime (Razer)",
  v2: "Realtime v2",
  whole: "Whole light only",
  segments: "App segments (experimental)",
  pixels: "Per bulb (experimental)",
};

const skuOf = (text) => (text || "").trim().split(/\s+/)[0].toUpperCase();

// A small marker saying what we know about the model on real lights (models.js).
function modelBadge(sku) {
  const m = app.models[skuOf(sku)];
  const span = document.createElement("span");
  if (!m) return span;
  const s = STATUS[statusOf(m)];
  span.className = `badge ${s.cls}`;
  span.textContent = s.badge;
  span.title = modelSummary(m);
  return span;
}

function addPlanned() {
  const name = $("plan-name").value.trim();
  if (!name) throw new Error("Give it a name, as it'll appear on the timeline");
  const base = `planned-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "light"}`;
  let id = base;
  for (let n = 2; app.devices[id]; n++) id = `${base}-${n}`;
  const model = app.models[skuOf($("plan-model").value)];
  const segments = Math.max(1, Math.round(Number($("plan-segments").value)) || 15);
  const kind = { WLED: "wled", DDP: "ddp", "E1.31": "e131", HA: "ha", TWINKLY: "twinkly" }[skuOf($("plan-model").value)];
  if (kind === "ha") {
    app.deviceList.push({ id, name, kind, ip: "", entity: "", sku: "", protocol: "ha_light", segments: 1, bulbs: 1,
      reverse: false, gradient: false, brightness: 100 });
  } else if (kind) {
    const where = { ddp: { first: 1 }, e131: { universe: 1, channel: 1 } }[kind] || {};
    app.deviceList.push({ id, name, kind, ip: "", sku: "", protocol: { e131: "e131", twinkly: "twinkly" }[kind] || "ddp", segments,
      bulbs: segments, reverse: false, gradient: false, brightness: 100, ...where });
  } else {
    app.deviceList.push(newLight(model, { id, name, ip: "", sku: model ? model.sku : "", segments }));
  }
  saveDevices();
  return `Added ${name} as a planned light. Build shows with it now; when it arrives, type its IP into its row.`;
}

// The Add a light window: pick what kind of light, then fill in what that kind needs, then done.
const ADD_KINDS = {
  govee: { title: "Govee light", ip: true,
    help: "Switch on <b>LAN Control</b> for the light in the Govee Home app first. Then scan for it, or type its IP." },
  wled: { title: "WLED strip", ip: true,
    help: "Scan for it, or type its IP (it's on the WLED app's <b>Info</b> page). Its name and LEDs are filled in for you, and any segments you've set up in WLED become its <b>parts</b>." },
  ddp: { title: "Pixel controller (DDP)", ip: true, leds: true,
    help: "Falcon Player, ESPixelStick, ESPHome, Tasmota or an ESP32: turn on DDP in the controller's settings if it has a switch for it. Add each string separately; the next one on the same controller starts just after the last." },
  e131: { title: "Pixel controller (E1.31)", ip: true, leds: true,
    help: "Set the controller to take E1.31 (sACN) as <b>unicast</b>. Add each string separately; the next one starts just after the last, and you can change its <b>universe</b> and <b>channel</b> in its row." },
  ha: { title: "Home Assistant light or switch", entity: true,
    help: "Any light, or a switch such as a smart plug for an inflatable. Lights take the show's colour a few times a second; switches turn on when the show is bright, at most once a second. They go back as they were afterwards." },
  twinkly: { title: "Twinkly (experimental)", ip: true,
    help: "Type the light's IP (it's in the Twinkly app under <b>Device settings</b>). Twinkly support hasn't been tried on a real light yet, so press <b>Test</b> once it's added." },
  plan: { title: "Plan a light", plan: true,
    help: "Build shows with it now. Pick the <b>model</b> if you know it: ✓ means it's known to work, ? that it's untested, so Test one before buying more. Segment counts aren't published, so 15 is a guess. When it arrives, scan and choose <b>Link to</b>, or type its IP into its row." },
};
const addFlow = { kind: null };

function addStep(step) {
  const dlg = $("add-dialog");
  for (const sec of dlg.querySelectorAll("[data-step]")) sec.hidden = sec.dataset.step !== step;
  const k = ADD_KINDS[addFlow.kind];
  $("add-title").textContent = step === "kind" ? "Add a light" : k.title;
  $("add-steps").textContent = `Step ${{ kind: 1, details: 2, done: 3 }[step]} of 3`;
  dlg.querySelector('[data-add="back"]').hidden = step !== "details";
  $("add-cancel").hidden = step === "done";
  $("add-go").hidden = step !== "details";
  dlg.querySelector('[data-add="again"]').hidden = step !== "done";
  $("add-finish").hidden = step !== "done";
  $("add-error").hidden = true;
  if (step !== "details") return;
  $("add-help").innerHTML = k.help;
  $("add-scan").hidden = !["govee", "wled"].includes(addFlow.kind);
  $("add-ip-field").hidden = !k.ip;
  $("add-leds-field").hidden = !k.leds;
  $("add-entity-field").hidden = !k.entity;
  $("add-plan-fields").hidden = !k.plan;
  $("add-go").textContent = addFlow.kind === "plan" ? "Add planned light" : "Add";
  $("scan-results").replaceChildren();
  if (k.entity) fillHaPicker($("add-entity"));
  const first = k.plan ? $("plan-model") : k.entity ? $("add-entity") : $("add-ip");
  setTimeout(() => first.focus(), 0);
}

function openAddLight() {
  addFlow.kind = null;
  for (const id of ["add-ip", "plan-name", "plan-model"]) $(id).value = "";
  $("plan-segments").value = 15;
  $("plan-segments").max = 255;
  $("plan-info").replaceChildren();
  addStep("kind");
  $("add-dialog").showModal();
}

async function addLightNow() {
  const k = ADD_KINDS[addFlow.kind], ip = $("add-ip").value.trim();
  const go = $("add-go");
  $("add-error").hidden = true;
  try {
    if (k.ip && !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error("Type the light's IP address, like 192.168.1.50");
    go.disabled = true;
    go.textContent = "Adding…";
    const said = await {
      govee: () => addDevice({ id: ip, ip, sku: "" }),
      wled: () => addWled(ip),
      ddp: () => addController(ip, Number($("add-leds").value), "ddp"),
      e131: () => addController(ip, Number($("add-leds").value), "e131"),
      ha: () => addHaLight($("add-entity").value),
      twinkly: () => addTwinkly(ip),
      plan: () => addPlanned(),
    }[addFlow.kind]();
    $("add-done").textContent = said;
    addStep("done");
  } catch (e) {
    $("add-error").textContent = e.message;
    $("add-error").hidden = false;
  } finally {
    go.disabled = false;
    go.textContent = addFlow.kind === "plan" ? "Add planned light" : "Add";
  }
}

function planModelChanged() {
  const m = app.models[skuOf($("plan-model").value)];
  const info = $("plan-info");
  info.replaceChildren();
  if (skuOf($("plan-model").value) === "HA") {
    info.append(" A Home Assistant light or plug: pick it in its row once it's set up in Home Assistant.");
    return;
  }
  if (["WLED", "DDP", "E1.31", "TWINKLY"].includes(skuOf($("plan-model").value))) {
    $("plan-segments").max = 1000;
    const what = { WLED: "WLED strip", TWINKLY: "Twinkly light (experimental)" }[skuOf($("plan-model").value)] || "pixel controller light";
    info.append(` A ${what}: set Segments to its number of LEDs.`);
    return;
  }
  if (!m) return;
  if (!$("plan-name").value) $("plan-name").value = m.name.replace(/^Govee\s+/, "");
  const light = newLight(m, {});
  $("plan-segments").max = LONG_PROTOCOLS.includes(light.protocol) ? 1000 : 255;
  if (m.segments) $("plan-segments").value = m.segments;
  info.append(modelBadge(m.sku), m.segments
    ? ` Starts on ${PROTOCOLS[light.protocol]} with ${m.segments} segments.`
    : " Segment count unknown: 15 is a guess, check it with Test when it arrives.");
  if (m.note) info.append(` ${m.note}`);
}

function button(label, onclick, cls = "") {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = cls;
  b.addEventListener("click", onclick);
  return b;
}

function addDevice(found) {
  if (app.devices[found.id] || app.deviceList.some((d) => d.ip && d.ip === found.ip)) throw new Error(`${found.ip} is already on the list`);
  const name = `${found.sku || "Govee"} ${found.ip.split(".").pop()}`;
  app.deviceList.push(newLight(app.models[skuOf(found.sku)], { id: found.id, name, ip: found.ip, sku: found.sku || "" }));
  saveDevices();
  return `Added ${name}. Next, set its Segments with Find or Test.`;
}

async function scan() {
  const box = $("scan-results");
  box.textContent = "Scanning…";
  try {
    const found = await api("api/devices/scan", { method: "POST" });
    box.replaceChildren();
    if (!found.length) {
      box.innerHTML = `<p class="hint">No lights answered. Check <b>LAN Control</b> is on in the Govee Home app and
        that they're on the same network as HA-liday Show.</p>`;
      return;
    }
    for (const f of found) {
      const row = document.createElement("div");
      row.className = "scan-row";
      row.append(`${f.sku || "Govee"} at ${f.ip}`, modelBadge(f.sku));
      const known = app.devices[f.id] || app.deviceList.find((d) => d.ip === f.ip);
      if (known) { row.append(` (${known.name})`); box.append(row); continue; }
      row.append(button("Add", () => {
        try { addDevice(f); row.replaceChildren(`${f.sku || "Govee"} at ${f.ip} (added)`); } catch (e) { status(e.message, true); }
      }));
      const planned = app.deviceList.filter((d) => !d.ip && (d.kind || "govee") === "govee");
      if (planned.length) {
        const sel = document.createElement("select");
        for (const p of planned) sel.add(new Option(p.name, p.id));
        row.append(" or ", button("Link to", () => {
          const p = app.lights[sel.value];
          Object.assign(p, { ip: f.ip, sku: f.sku || p.sku });
          saveDevices();
          row.replaceChildren(`${f.sku || "Govee"} at ${f.ip} (${p.name})`);
        }), sel);
      }
      box.append(row);
    }
  } catch (e) { box.textContent = ""; status(`Scan failed: ${e.message}`, true); }
}

// WLED lights announce themselves on the network (server.py wled_scan); each found one can be added.
async function scanWled() {
  const box = $("scan-results");
  box.textContent = "Scanning…";
  try {
    const { found } = await api("api/wled/scan", { method: "POST" });
    box.replaceChildren();
    if (!found.length) {
      box.innerHTML = `<p class="hint">No WLED lights answered. Check they're switched on and on the same network as
        HA-liday Show.</p>`;
      return;
    }
    for (const f of found) {
      const row = document.createElement("div");
      row.className = "scan-row";
      const label = `${f.name} at ${f.ip}, ${f.leds} LEDs`;
      row.append(label);
      const known = app.deviceList.find((d) => d.ip === f.ip);
      if (known) { row.append(` (${known.name})`); box.append(row); continue; }
      row.append(button("Add", async () => {
        try { await addWled(f.ip); row.replaceChildren(`${label} (added)`); } catch (e) { status(e.message, true); }
      }));
      box.append(row);
    }
  } catch (e) { box.textContent = ""; status(`Scan failed: ${e.message}`, true); }
}

// preview -------------------------------------------------------------------
const preview = $("preview");
const pctx = preview.getContext("2d");
const ROW_H = 26, LABEL_W = 140;

function previewTracks() {
  return app.show.tracks.filter(playingDev);
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
    pctx.fillText("Add devices under Setup → Devices to see a preview here.", 4, 17);
    return;
  }
  const pos = housePositions(), composed = {};
  tracks.forEach((tr, row) => {
    const dev = app.devices[tr.device];
    const rgb = previewFrame(tr, dev, pos, composed);
    const n = dev.segments;
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
    if (!dev.parent) return shownFrame(dev, housePositions());
    return shownFrame(app.lights[dev.parent], housePositions()).slice((dev.from - 1) * 3, dev.to * 3);
  },
});
house.hiddenLights = new Set(prefs.get("house.hiddenLights", []));

// The House lane: its clips, and where each light's segments sit for them.
const houseClips = () => app.show.tracks.find((t) => t.device === HOUSE)?.clips || [];
const isHouse = (i) => app.show.tracks[i]?.device === HOUSE;
// House effects go on the House lane and nowhere else; light effects everywhere but.
const fitsTrack = (effect, i) => !!EFFECTS[effect]?.house === isHouse(i);

// Whether clips suit their lights (compat.js). A long show on a Per bulb light takes a while to
// check, so the timeline and effect chooser get theirs in the background (pass `then`), and every
// answer is remembered until the clip or the light changes. Nothing is saved with the show.
const ALLOW_UNFIT = "allowUnfit";
const allowUnfit = () => prefs.get(ALLOW_UNFIT, false);
const fitMemo = new Map(), fitJobs = new Map();
let fitTimer = null;

function fitContext(i) {
  if (!isHouse(i)) return { dev: app.devices[app.show.tracks[i]?.device], opts: {} };
  const pos = housePositionsAll();
  return { dev: null, opts: { house: { lights: houseLights().map((d) => ({ name: d.name, placed: !!pos[d.id] })) } } };
}

function remember(key, fit) {
  if (fitMemo.size > 5000) fitMemo.clear();
  fitMemo.set(key, fit);
  return fit;
}

// The fit of `clip` on `dev`: worked out now, or with `then`, null and then(fit) once it's ready.
function fitFor(clip, dev, opts = {}, then = null) {
  const { start, end, ...rest } = clip;
  const key = JSON.stringify([rest, end - start, dev && [dev.protocol, dev.segments, linked(dev), dev.sku || ""], opts.house]);
  if (fitMemo.has(key)) return fitMemo.get(key);
  if (!then) return remember(key, clipFit(clip, dev, opts));
  const copy = { ...clip };
  const job = fitJobs.get(key) || { run: () => clipFit(copy, dev, opts), then: [] };
  job.then.push(then);
  fitJobs.set(key, job);
  fitTimer ??= setTimeout(runFits, 0);
  return null;
}

function runFits() {
  const until = performance.now() + 12;
  for (const [key, job] of fitJobs) {
    fitJobs.delete(key);
    const fit = remember(key, job.run());
    for (const then of job.then) then(fit);
    if (performance.now() > until) break;
  }
  fitTimer = fitJobs.size ? setTimeout(runFits, 0) : null;
}

const clipFitOn = (clip, i, then = null) => {
  const { dev, opts } = fitContext(i);
  return fitFor(clip, dev, opts, then);
};

// The fit of an effect added to several tracks at once: it won't work only if it won't work on any of
// them, and is limited where it's left off some.
function fitAcross(clip, tracks, then = null) {
  const ts = tracks.filter((t) => fitsTrack(clip.effect, t));
  const fits = ts.map(() => null);
  const combine = () => {
    if (ts.length <= 1) return fits[0] || { level: "ok", reasons: [] };
    const no = ts.filter((_, k) => fits[k].level === "no");
    if (no.length === ts.length) return { level: "no", reasons: [`Won't work on any of these lights. ${fits[0].reasons[0]}`] };
    if (no.length) return { level: "limited", reasons: [`Won't work on ${no.map(trackName).join(", ")}, so it's left off.`] };
    const w = worst(fits);
    return w.level === "ok" ? w : { level: w.level, reasons: [`On ${trackName(ts[fits.indexOf(w)])}: ${w.reasons[0]}`] };
  };
  let left = ts.length;
  ts.forEach((t, k) => {
    const fit = clipFitOn(clip, t, then && ((f) => { fits[k] = f; if (--left === 0) then(combine()); }));
    if (fit) { fits[k] = fit; left--; }
  });
  return left ? null : combine();
}

const unfit = (clip, i) => !allowUnfit() && clipFitOn(clip, i).level === "no";
const fitText = (fit) => `⚠ ${fit.level === "no" ? "Won't work here. " : ""}${fit.reasons.join(" ")}`;

// The physical light a track plays on, and a note if its realtime mode doesn't reach all of it.
function trackNote(dev) {
  const light = dev && (dev.light || app.lights[dev.parent] || dev);
  return light ? reachNote(light, app.models[skuOf(light.sku)]) : null;
}

let fitRedraw = false;
const redrawForFits = () => {
  if (fitRedraw) return;
  fitRedraw = true;
  requestAnimationFrame(() => { fitRedraw = false; timeline.draw(); });
};
// While a clip is resized its new length is still being checked, so it keeps its last mark meanwhile.
const lastFit = new WeakMap();
app.clipFit = (clip, i) => {
  const fit = clipFitOn(clip, i, redrawForFits);
  if (fit) lastFit.set(clip, fit);
  return fit || lastFit.get(clip) || null;
};
app.trackNote = (dev) => trackNote(dev)?.short || null;

function housePositions() {
  return houseClips().length ? housePositionsAll() : {};
}

// Worked out at most every 100 ms: the preview, House panel and every light's frame share it.
const posMemo = { at: -Infinity, value: {} };
function housePositionsAll() {
  const now = performance.now();
  if (now - posMemo.at > 100) {
    house.devices = houseLights();
    const value = house.positions();
    // A part sits on its slice of the light's traced path.
    for (const d of app.deviceList) {
      for (const p of d.parts || []) if (value[d.id]) value[partId(d, p)] = value[d.id].slice(p.from - 1, p.to);
    }
    Object.assign(posMemo, { at: now, value });
  }
  return posMemo.value;
}

// A light's colours at `time`: its own clips, then the House lane's over them.
function lightFrame(tr, dev, time, pos) {
  const rgb = renderTrack(tr.clips, time, dev.segments);
  if (pos[dev.id]) applyHouse(houseClips(), time, pos[dev.id], rgb);
  return rgb;
}

// A whole physical light's colours, as the show plays it.
function physicalFrame(light, time, pos) {
  return composeLight(light, (id) => app.show.tracks.find((t) => t.device === id), time, pos, houseClips());
}

// What a physical light shows now: stepped (and on Whole light only, one colour) as on the real light.
const shownFrame = (light, pos) => asShown(light, app.time, (t) => physicalFrame(light, t, pos));

// What a preview row shows: for a split light and its parts, their share of what the light
// actually plays (so a part's clip shows over the whole light's). `composed` caches per light.
function previewFrame(tr, dev, pos, composed) {
  const light = dev.light || app.lights[dev.parent];
  if (!light) return asShown(dev, app.time, (t) => lightFrame(tr, dev, t, pos));
  const full = composed[light.id] ??= shownFrame(light, pos);
  if (dev.parent) return full.slice((dev.from - 1) * 3, dev.to * 3);
  return joinParts(light, full);
}

// A split light's parts end to end, from a frame of the whole physical light.
function joinParts(light, full) {
  const out = new Uint8Array(light.parts.reduce((n, p) => n + p.to - p.from + 1, 0) * 3);
  let k = 0;
  for (const p of light.parts) {
    out.set(full.subarray((p.from - 1) * 3, p.to * 3), k);
    k += (p.to - p.from + 1) * 3;
  }
  return out;
}

// The reverse: a strip played across a split light's parts, spread back onto the whole light.
function spreadParts(light, rgb) {
  const out = new Uint8Array(light.segments * 3);
  let k = 0;
  for (const p of light.parts) {
    const n = (p.to - p.from + 1) * 3;
    out.set(rgb.subarray(k, k + n), (p.from - 1) * 3);
    k += n;
  }
  return out;
}

function drawHouse() {
  house.devices = houseLights();
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

// The segment number picked on the photo: light that segment on the real light to see where it
// is, and unpin it. Dragging the number along the line pins it (see House.pinBulbs).
function houseSegmentEditor(d) {
  const pick = house.active ? null : house.pinPick;
  if (pick?.id !== d.id) return null;
  const light = app.lights[d.parent || d.id];
  const num = pick.s + (d.from || 1); // counted on the whole light, in show order
  const pinned = house.pins[d.id]?.[pick.s] != null;
  const box = document.createElement("div");
  box.className = "house-stretch row";
  const label = document.createElement("span");
  label.textContent = `Segment ${num}${pinned ? " (pinned)" : ""}`;
  const lightIt = button("Light it", async () => {
    // Find segments lights one segment, counted from the light's own first one.
    const segment = light.reverse ? light.segments + 1 - num : num;
    try {
      await api("api/devices/probe", { method: "POST", json: { ...light, segment } });
      status(`Segment ${num} of ${light.name} is lit white. Drag its number to where it is.`);
    } catch (e) { status(`Couldn't light it: ${e.message}`, true); }
  }, "primary");
  lightIt.title = "Light just this segment on the real light, white, so you can see where it is";
  lightIt.disabled = !linked(light) || light.protocol === "whole";
  const stop = button("Stop", async () => {
    try { await api("api/devices/probe", { method: "POST", json: { ...light, segment: 0 } }); } catch { /* it lets go by itself */ }
  }, "ghost");
  stop.disabled = !linked(light);
  box.append(label, lightIt, stop);
  if (pinned) box.append(button("Unpin", () => { house.unpin(d.id, pick.s); renderHouseLights(); }, "ghost"));
  box.append(button("✕", () => { house.pinPick = null; renderHouseLights(); }, "ghost"));
  return box;
}

// Line, Icicle (how many drops and how far the longest hangs) or Spots (how wide the beams are).
function houseStyleControls(d) {
  const style = house.styles[d.id];
  const sel = document.createElement("select");
  sel.title = "How the light looks on the photo";
  sel.innerHTML = `<option value="line">Line</option><option value="icicle">Icicle</option>
    <option value="spots">Spots</option>`;
  sel.value = style?.style || "line";
  sel.addEventListener("change", () => {
    house.setStyle(d.id, {
      icicle: { style: "icicle", drops: Math.max(d.segments * 3, 10), length: 0.06 },
      spots: { style: "spots", beam: 0.5, aims: [] },
    }[sel.value] || null);
    house.stretch = null;
    renderHouseLights();
  });
  const l0 = document.createElement("label");
  l0.className = "row";
  l0.append("Style ", sel);
  if (!style) return [l0];
  if (style.style === "spots") {
    const beam = document.createElement("input");
    beam.type = "range";
    beam.min = "0.1";
    beam.max = "1.5";
    beam.step = "0.05";
    beam.value = style.beam;
    beam.title = "How wide each spotlight's beam is";
    beam.addEventListener("input", () => { style.beam = Number(beam.value); house.setStyle(d.id, style); });
    const l1 = document.createElement("label");
    l1.className = "row";
    l1.append("Beam ", beam);
    return [l0, l1];
  }
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

function hint(text) {
  const el = document.createElement("span");
  el.className = "hint";
  el.textContent = text;
  return el;
}

// The House tab's sidebar: a card per light. The selected light (or the one being traced) is
// highlighted on the photo and shows its settings; the rest stay one line each.
// A split light's parts are listed under its name.
function withLightHeader(d, card) {
  if (!d.parent || d.partIndex !== 0) return [card];
  const head = document.createElement("div");
  head.className = "house-light-head";
  head.textContent = app.lights[d.parent].name;
  return [head, card];
}

// What gets traced on the House tab: each light, or each part of a split light. A split light
// traced whole before it was split stays whole until its trace is split into parts.
function houseLights() {
  return app.deviceList.flatMap((d) => (d.parts?.length && !house.paths[d.id]?.length
    ? d.parts.map((p) => app.devices[partId(d, p)]) : [d]));
}

function renderHouseLights() {
  $("house-remove").hidden = !house.photo || house.sample;
  $("house-dim").value = house.dim;
  const box = $("house-lights");
  if (!house.photo) {
    box.innerHTML = `<p class="hint">Upload a photo of your house to start.</p>`;
    return;
  }
  const intro = house.sample ? [sampleHouseCard()] : [];
  if (!app.deviceList.length) {
    box.replaceChildren(...intro, Object.assign(document.createElement("p"), { className: "hint",
      innerHTML: "Add your lights under <b>Setup → Devices</b> first." }));
    return;
  }
  const current = house.active || house.selected;
  box.replaceChildren(...intro, ...houseLights().flatMap((d) => {
    const card = document.createElement("div");
    const open = current === d.id;
    card.className = `house-card${open ? " selected" : ""}${d.parent ? " house-part" : ""}`;
    const pts = house.paths[d.id]?.length || 0;
    const head = document.createElement("div");
    head.className = "house-card-head";
    const name = document.createElement("b");
    name.textContent = d.parent ? d.partName : d.name;
    if (d.parent) {
      const sw = document.createElement("span");
      sw.className = "part-swatch";
      sw.style.background = `rgb(${partRgb(d.partIndex).join()})`;
      head.append(sw);
    }
    const state = document.createElement("span");
    state.className = "hint";
    const hidden = house.hiddenLights.has(d.id);
    state.textContent = house.active === d.id ? "Tracing…" : !pts ? "Not traced" : hidden ? "Hidden"
      : { icicle: "Icicle", spots: `${pts} spots` }[house.styles[d.id]?.style] || "Traced";
    // Hiding a light on the photo gets at one traced underneath it. Only the House tab's photo
    // hides it; the House panel and the show are unchanged.
    const eye = button(hidden ? "🙈" : "👁", (e) => {
      e.stopPropagation();
      if (hidden) house.hiddenLights.delete(d.id); else house.hiddenLights.add(d.id);
      prefs.set("house.hiddenLights", [...house.hiddenLights]);
      if (!hidden && house.stretch?.id === d.id) house.stretch = null;
      renderHouseLights();
    }, `ghost small house-eye${hidden ? " off" : ""}`);
    eye.title = hidden ? `Show ${d.name} on the photo` : `Hide ${d.name} on the photo, to get at a light under it`;
    eye.disabled = !pts;
    head.append(name, state, eye);
    card.append(head);
    if (!open) {
      card.title = "Select this light";
      card.addEventListener("click", () => {
        if (house.active) return;
        house.selected = d.id;
        house.stretch = null;
        renderHouseLights();
      });
      return withLightHeader(d, card);
    }
    const actions = document.createElement("div");
    actions.className = "row";
    if (house.active === d.id) {
      actions.append(button("Done", () => { house.active = null; renderHouseLights(); }, "primary"));
    } else {
      actions.append(button(pts ? "Retrace" : "Trace", () => {
        if (pts && !confirm(`Trace ${d.name} again from the start?`)) return;
        delete house.paths[d.id];
        delete house.pins[d.id];
        if (house.styles[d.id]?.aims) house.styles[d.id].aims = [];
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
        delete house.pins[d.id];
        if (house.active === d.id) house.active = null;
        house.stretch = null;
        house.save();
        renderHouseLights();
      }, "ghost"));
    }
    // Traced whole before it was split: one click gives each part its own trace where it already is.
    if (d.parts?.length && pts && house.styles[d.id]?.style !== "spots") {
      const split = button("Split trace into parts", () => {
        house.splitTrace(d);
        house.selected = partId(d, d.parts[0]);
        house.stretch = null;
        renderHouseLights();
      }, "primary");
      split.title = "Give each part its own line, starting where it is now, so you can move the parts on their own";
      actions.append(split);
    }
    card.append(actions, ...houseStyleControls(d));
    const stretch = houseStretchEditor(d) || houseSegmentEditor(d);
    if (stretch) card.append(stretch);
    else if (house.active === d.id && house.styles[d.id]?.style === "spots") {
      card.append(hint("Click where each spotlight sits, starting nearest the plug."));
    } else if (pts && !house.active && house.styles[d.id]?.style === "spots") {
      card.append(hint("Drag a spot's round handle to aim it."));
    } else if (pts > 1 && !house.active) {
      card.append(hint("Click a line on the photo to mark part of it out of view. If the bulbs don't line up "
        + "with the real ones (a photo taken at an angle), drag a segment number along the line to where that "
        + "segment really is."));
      if (house.pins[d.id]) {
        card.append(button("Unpin all", () => { house.unpin(d.id); house.pinPick = null; renderHouseLights(); }, "ghost small"));
      }
    }
    if (d.parent && house.active === d.id) {
      card.append(hint(`Start at the end of ${d.partName} nearest the light's plug.`));
    }
    return withLightHeader(d, card);
  }));
  box.querySelector(".house-card.selected")?.scrollIntoView({ block: "nearest" });
}

// Shown above the lights while the sample house stands in for a photo.
function sampleHouseCard() {
  const card = document.createElement("div");
  card.className = "house-sample";
  card.append(Object.assign(document.createElement("p"), { innerHTML: "This is a <b>sample house</b>, so you "
    + "can try the House view before you take a photo of yours. <b>Upload photo</b> above to use your own." }));
  const todo = houseLights().filter((d) => !house.paths[d.id]?.length);
  if (todo.length) {
    const place = button("Put my lights on it", () => placeLightsOnSample(todo), "primary");
    place.title = "Put each light that isn't traced yet on the roof, porch, windows, tree and so on";
    card.append(place);
  }
  return card;
}

function placeLightsOnSample(lights) {
  const { paths, styles } = placeOnSample(lights, house.paths);
  const n = Object.keys(paths).length;
  Object.assign(house.paths, paths);
  for (const [id, st] of Object.entries(styles)) if (!house.styles[id]) house.styles[id] = st;
  house.save();
  renderHouseLights();
  status(n === lights.length ? `Put ${n} light${n === 1 ? "" : "s"} on the sample house`
    : `Put ${n} of your lights on the sample house; there's no room left for the rest`, n < lights.length);
}

function wireHouse() {
  house.wireSetup($("house-setup"), renderHouseLights);
  $("house-upload").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    // Lines drawn for the sample house won't match a real photo.
    const wasSample = house.sample && Object.keys(house.paths).length;
    await house.upload(file);
    if (wasSample && !house.sample && confirm("Clear the lights you put on the sample house, so you can trace them on your photo?")) {
      house.paths = {};
      house.pins = {};
      house.save();
    }
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
  if (linked(dev) && !EFFECTS[clip.effect]?.experimental) {
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
  const clip = sel?.clip, len = clip && Math.max(clip.end - clip.start, 0.05);
  const t = clip && clip.start + ((performance.now() - clipPreview.started) / 1000) % len;
  if (track?.device === HOUSE) {
    // A House clip on its own: as if one strip ran left to right across the house.
    if (clipPreview.dev) stopLightPreview();
    drawStrip(c, renderTrack([clip], t, 30), 30);
    return;
  }
  const dev = track && app.devices[track.device];
  if (!dev) { if (clipPreview.dev) stopLightPreview(); return; }
  const rgb = asShown(dev, t, (tt) => renderTrack([clip], Math.max(tt, clip.start), dev.segments));
  drawStrip(c, rgb, dev.segments, (dev.brightness ?? 100) / 100);
  const onLight = previewOnLight() && linked(dev) && !EFFECTS[clip.effect]?.experimental && !app.playing && !app.starting;
  if (onLight) sendPreview(dev, rgb);
  else if (clipPreview.dev) stopLightPreview();
}

// A row of segments in their colours, filling the canvas.
function drawStrip(c, rgb, n, cap = 1) {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bw = w / n, gap = bw >= 4 ? 1 : 0, pad = h > 12 ? 2 : 0;
  for (let i = 0; i < n; i++) {
    const [r, g, b] = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]].map((v) => Math.round(v * cap));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(i * bw + gap, pad, Math.max(bw - gap * 2, 0.5), h - pad * 2);
  }
}

// The add-on applies the light's brightness cap, so the clip's own colours are sent. A part
// lights its own slice of the light, with the rest off.
function sendPreview(dev, rgb) {
  if (dev.parent) {
    const light = app.lights[dev.parent], full = new Uint8Array(light.segments * 3);
    full.set(rgb.subarray(0, dev.segments * 3), (dev.from - 1) * 3);
    [dev, rgb] = [light, full];
  } else if (dev.light) {
    [dev, rgb] = [dev.light, spreadParts(dev.light, rgb)];
  }
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
  const dev = app.lights[clipPreview.dev];
  clipPreview.dev = null;
  await clipPreview.pending;
  if (linked(dev)) await api("api/devices/preview", { method: "POST", json: { ...dev, stop: true } }).catch(() => {});
}

// effects and inspector -------------------------------------------------------
// Experimental effects (Govee scenes) only appear once switched on in Settings. `keep` stays listed
// regardless, so a clip that already uses one can still be edited.
const experimentalOn = () => prefs.get("experimental.scenes", false);
const labsOn = () => prefs.get("labs", false);
// house: true for the House lane's effects, false for lights', undefined for both.
const visibleEffects = (keep, house) => Object.entries(EFFECTS).filter(([k, fx]) =>
  (!fx.experimental || experimentalOn() || k === keep) && (house === undefined || !!fx.house === house));

// Previews in the effect chooser: each strip loops its effect for as long as the clip or selection
// (within reason) on the light's own segments.
const pickerPreview = { items: [], started: 0 };
const SHOW_PRESETS_KEY = "halidayshow.showPresets";
const MINE_ONLY_KEY = "halidayshow.myPresetsOnly";

// An effect's presets: the built-in ones, then the user's own (marked mine, shown with a ★).
const presetsFor = (effect) => [...(PRESETS[effect] || []), ...app.myPresets.filter((p) => p.effect === effect)];
const presetLabel = (p) => (p.mine ? `★ ${p.label}` : p.label);

// What a clip becomes with `effect` and, optionally, one of its presets: the effect's defaults, the
// colours and brightness carried over from `from` (the clip being changed), then the preset.
function chosenParams(effect, preset, from = null) {
  const out = defaultParams(effect);
  for (const p of EFFECTS[effect].params) {
    if (from && (p.type === "color" || p.key === "brightness") && from[p.key] !== undefined) out[p.key] = from[p.key];
  }
  return preset ? { ...out, ...presetParams(preset, out) } : out;
}

// The effect chooser, used both to add an effect and to change a clip's. Effects are shown as
// previewing buttons; with "Show presets" ticked each effect becomes a group of its default and its
// presets. groups lists [heading, house] sections (heading null for a single unnamed one).
// onPick(effect, preset) runs with the choice; current/currentPreset are outlined. suggested is
// {heading, looks: [{effect, label, params}]}, shown first, for adding to a part of the song.
// fit(clip, then), when given, says whether a choice suits the light (as fitFor does): ones that won't
// work are greyed out unless "Allow effects that won't work" is ticked, and the current one never is.
function chooseEffect({ title, groups, dev = null, length = 3, from = null, current = null, currentPreset = null,
  suggested = null, fit = null, onPick }) {
  const dlg = document.createElement("dialog");
  dlg.className = "effect-dialog";
  const head = document.createElement("div");
  head.className = "effect-dialog-head";
  const h = document.createElement("h3");
  h.textContent = title;
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  try { toggle.checked = localStorage.getItem(SHOW_PRESETS_KEY) === "1"; } catch { /* not remembered */ }
  const tl = document.createElement("label");
  tl.append(toggle, "Show presets");
  tl.title = "Presets are ready-made settings for an effect, such as a slow or fast marquee";
  const mineOnly = document.createElement("input");
  mineOnly.type = "checkbox";
  try { mineOnly.checked = localStorage.getItem(MINE_ONLY_KEY) === "1"; } catch { /* not remembered */ }
  const ml = document.createElement("label");
  ml.append(mineOnly, "★ My presets only");
  ml.title = "Only show the presets you've saved";
  const allow = document.createElement("input");
  allow.type = "checkbox";
  allow.checked = allowUnfit();
  const al = document.createElement("label");
  al.append(allow, "Allow effects that won't work");
  al.title = "Let you pick effects this light can't show properly, such as a chase on a light that is one colour at a time";
  al.hidden = !fit;
  const close = button("✕", () => dlg.close(), "ghost");
  close.title = "Close (Esc)";
  // Why a greyed-out effect won't work, once it's clicked. In the header, so it shows wherever you've scrolled.
  const note = document.createElement("p");
  note.className = "hint fit-warning effect-dialog-note";
  note.hidden = true;
  head.append(h, tl, ml, al, close, note);
  const body = document.createElement("div");
  body.className = "effect-dialog-body";
  dlg.append(head, body);
  const len = Math.min(Math.max(length, 1), 6);

  const choice = (effect, preset, label, active) => {
    let blocked = null;
    const b = button("", () => {
      if (blocked) { note.textContent = `⚠ ${label} won't work here. ${blocked}`; note.hidden = false; return; }
      dlg.close(); app.paletteEffect = effect; onPick(effect, preset);
    }, active ? "active" : "");
    const strip = document.createElement("canvas");
    strip.className = "fx-strip";
    const span = document.createElement("span");
    span.textContent = label;
    b.append(strip, span);
    const params = chosenParams(effect, preset, from);
    pickerPreview.items.push({ canvas: strip, clip: { effect, start: 0, end: len, ...params }, dev });
    const mark = (r) => {
      if (!r || r.level === "ok") return;
      if (r.level === "no" && !allow.checked && effect !== current) blocked = r.reasons.join(" ");
      b.classList.add(blocked ? "unfit" : "limited");
      b.title = fitText(r);
      span.textContent = `⚠ ${label}`;
    };
    if (fit) mark(fit({ effect, start: 0, end: Math.max(length, 0.05), ...params }, mark));
    return b;
  };
  const render = () => {
    pickerPreview.items = [];
    pickerPreview.started = performance.now();
    body.replaceChildren();
    note.hidden = true;
    ml.hidden = !toggle.checked;
    const onlyMine = toggle.checked && mineOnly.checked;
    if (suggested?.looks.length) {
      const sh = document.createElement("div");
      sh.className = "section-label effect-dialog-section";
      sh.textContent = suggested.heading;
      const row = document.createElement("div");
      row.className = "effect-picker";
      for (const look of suggested.looks) row.append(choice(look.effect, look, look.label, false));
      body.append(sh, row);
    }
    for (const [named, house] of groups) {
      const heading = named || (suggested?.looks.length ? "All effects" : null);
      if (heading) {
        const sh = document.createElement("div");
        sh.className = "section-label effect-dialog-section";
        sh.textContent = heading;
        body.append(sh);
      }
      const effects = visibleEffects(current ?? undefined, house);
      if (!toggle.checked) {
        const row = document.createElement("div");
        row.className = "effect-picker";
        for (const [key, fx] of effects) row.append(choice(key, null, fx.label, key === current));
        body.append(row);
        continue;
      }
      const grid = document.createElement("div");
      grid.className = "preset-groups";
      for (const [key, fx] of effects) {
        const presets = presetsFor(key).filter((p) => !onlyMine || p.mine);
        if (onlyMine && !presets.length) continue;
        const g = document.createElement("fieldset");
        g.className = `preset-group${key === current ? " current" : ""}`;
        const legend = document.createElement("legend");
        legend.textContent = fx.label;
        const row = document.createElement("div");
        row.className = "effect-picker";
        if (!onlyMine) row.append(choice(key, null, "Default", key === current && !currentPreset));
        for (const preset of presets) {
          row.append(choice(key, preset, presetLabel(preset), key === current && preset === currentPreset));
        }
        g.append(legend, row);
        grid.append(g);
      }
      if (!grid.children.length) {
        grid.innerHTML = `<p class="hint">No presets of your own yet. Select a clip and press <b>Save as preset</b>.</p>`;
      }
      body.append(grid);
    }
  };
  allow.addEventListener("change", () => { prefs.set(ALLOW_UNFIT, allow.checked); render(); });
  for (const [box, key] of [[toggle, SHOW_PRESETS_KEY], [mineOnly, MINE_ONLY_KEY]]) {
    box.addEventListener("change", () => {
      try { localStorage.setItem(key, box.checked ? "1" : "0"); } catch { /* not remembered */ }
      render();
    });
  }
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
  dlg.addEventListener("close", () => { pickerPreview.items = []; dlg.remove(); });
  render();
  document.body.append(dlg);
  dlg.showModal();
  body.querySelector(".preset-group.current, .active")?.scrollIntoView({ block: "nearest" });
  return dlg;
}

function drawPickerPreviews() {
  for (const set of [pickerPreview, presetTabPreview]) {
    const items = set.items;
    // offsetParent is null while the strips' panel or tab is hidden.
    if (!items.length || !items[0].canvas.isConnected || !items[0].canvas.offsetParent) continue;
    const secs = (performance.now() - set.started) / 1000;
    for (const { canvas, clip, dev } of items) {
      const n = dev?.segments || 15;
      drawStrip(canvas, asShown(dev, secs % clip.end, (t) => renderTrack([clip], t, n)), n, (dev?.brightness ?? 100) / 100);
    }
  }
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
  h.textContent = `${EFFECTS[clip.effect]?.label || clip.effect} on ${trackName(sel.track)}`;
  box.append(h, clipPreviewRow(clip, dev));
  const fit = clipFitOn(clip, sel.track);
  if (fit.level !== "ok") {
    const warn = document.createElement("p");
    warn.className = "hint fit-warning";
    warn.textContent = fitText(fit);
    box.append(warn);
  }

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
  const fxLabel = EFFECTS[clip.effect]?.label || clip.effect;
  const groups = { clip: group("Clip"), colours: group("Colours"), settings: group("Effect settings"),
    brightness: group("Brightness") };
  let target = groups.clip;
  const field = (label, el) => {
    const l = document.createElement("label");
    l.append(label, el);
    target.append(l);
    return el;
  };

  // The effect (and preset) is changed in the same chooser used to add one.
  const presets = presetsFor(clip.effect);
  // Prefer the user's own preset when one matches as well as a built-in one.
  const currentPreset = [...presets].reverse().find((pr) => matchesPreset(pr, clip)) || null;
  const effect = button(`${fxLabel}${currentPreset ? ` · ${presetLabel(currentPreset)}` : ""} ▾`, () => chooseEffect({
    title: `Change the effect on ${trackName(sel.track)}`,
    groups: [[null, isHouse(sel.track)]],
    dev, length: clip.end - clip.start, from: clip, current: clip.effect, currentPreset,
    fit: (c, then) => clipFitOn(c, sel.track, then),
    onPick: (key, preset) => {
      const params = chosenParams(key, preset, clip);
      if (key === clip.effect) {
        // Same effect: a preset only changes the settings it names, Default resets the rest.
        Object.assign(clip, preset ? presetParams(preset, clip) : params);
      } else {
        for (const k of Object.keys(clip)) if (!["effect", "start", "end"].includes(k)) delete clip[k];
        Object.assign(clip, params, { effect: key });
      }
      app.changed();
    },
  }), "ghost effect-change");
  effect.title = presets.length ? "Change this clip's effect or pick one of its presets" : "Change this clip's effect";
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
  actions.append(button("Save as preset…", () => savePresetFrom(clip), "ghost"));
  actions.append(button("Copy", copySelection, "ghost"));
  if (!isHouse(sel.track)) {
    actions.append(button("Copy to all lights", () => copyClipsTo([clip], sel.track, otherTracks(sel.track)), "ghost"));
  }
  actions.append(button("Delete clip", deleteSelected, "ghost danger"));
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
const trackName = (i) => (isHouse(i) ? "the House lane"
  : app.devices[app.show.tracks[i]?.device]?.name || "missing light");
// The other lights' tracks (never the House lane, whose effects are a different kind).
const otherTracks = (i) => app.show.tracks.map((_, k) => k).filter((k) => k !== i && !isHouse(k) && playingDev(app.show.tracks[k]));
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
  const fits = cb.clips.filter((c) => fitsTrack(c.effect, sel.track));
  if (!fits.length) {
    status(isHouse(sel.track) ? "Only House effects can go on the House lane"
      : "House effects can only go on the House lane", true);
    return;
  }
  const pasted = fits.map((c) => ({ ...clone(c), start: c.start + shift, end: c.end + shift }))
    .filter((c) => !unfit(c, sel.track));
  const left = fits.length - pasted.length;
  if (!pasted.length) { status(`${left === 1 ? "That effect won't" : "Those effects won't"} work on ${trackName(sel.track)}`, true); return; }
  app.show.tracks[sel.track].clips.push(...pasted);
  app.selected = pasted.length === 1 ? { track: sel.track, clip: pasted[0] } : { track: sel.track, clip: null };
  status(`Pasted ${pasted.length} effect${pasted.length > 1 ? "s" : ""} onto ${trackName(sel.track)}`
    + (left ? `, leaving out ${left} that won't work there` : ""));
  app.changed();
}

function copyClipsTo(clips, from, targets, replace = false) {
  if (!targets.length) { status("There are no other lights", true); return; }
  let left = 0;
  for (const t of targets) {
    const fits = clips.filter((c) => !unfit(c, t));
    left += clips.length - fits.length;
    if (replace) app.show.tracks[t].clips = [];
    app.show.tracks[t].clips.push(...fits.map(clone));
  }
  status(`Copied ${clips.length} effect${clips.length > 1 ? "s" : ""} from ${trackName(from)} to `
    + (targets.length === 1 ? trackName(targets[0]) : `${targets.length} lights`)
    + (left ? `, leaving out ${left} where ${left === 1 ? "it" : "they"} won't work` : ""));
  app.changed();
}

function renderTrackInspector(i) {
  const box = $("inspector");
  const clips = app.show.tracks[i].clips;
  box.replaceChildren();
  const h = document.createElement("h3");
  h.textContent = `${isHouse(i) ? "House lane" : trackName(i)}: ${clips.length} effect${clips.length === 1 ? "" : "s"}`;
  box.append(h);
  const reach = !isHouse(i) && trackNote(app.devices[app.show.tracks[i].device]);
  if (reach) {
    const p = document.createElement("p");
    p.className = "hint fit-warning";
    p.textContent = `⚠ ${reach.text}`;
    box.append(p);
  }
  if (isHouse(i)) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = Object.keys(housePositionsAll()).length
      ? "Effects here run across all your lights by where they are on the house photo, on top of each light's own effects. Drag across this lane to add one."
      : "Effects here run across all your lights by where they are on the house photo. Trace your lights under Setup → House first.";
    box.append(p);
  }
  if (!isHouse(i) && otherTracks(i).length && clips.length) {
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
    box.append(button(isHouse(i) ? "Clear the House lane" : "Clear this light", () => {
      app.show.tracks[i].clips = [];
      app.changed();
    }, "ghost danger"));
  }
  // A track that plays on nothing (its light was removed, or it's a parts-only light's own track)
  // can be taken out of the show, with its effects.
  if (!isHouse(i) && !playingDev(app.show.tracks[i])) {
    const dead = app.show.tracks.filter((t) => t.device !== HOUSE && !playingDev(t));
    const remove = (tracks) => {
      const n = tracks.reduce((s, t) => s + t.clips.length, 0);
      if (n && !confirm(`Remove ${tracks.length === 1 ? "this track" : `${tracks.length} tracks`} and ${n} effect${n === 1 ? "" : "s"} from the show?`)) return;
      app.show.tracks = app.show.tracks.filter((t) => !tracks.includes(t));
      app.select(null);
      app.changed();
      layoutPreview();
      timeline.layout();
    };
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = app.devices[app.show.tracks[i].device]
      ? "This light plays its parts only, so this track isn't played."
      : "This light isn't under Setup → Devices any more, so this track isn't played.";
    box.append(p, button("Remove from show", () => remove([app.show.tracks[i]]), "danger"));
    if (dead.length > 1) box.append(button(`Remove all ${dead.length} unplayed tracks`, () => remove(dead), "ghost danger"));
  }
}

// your own effect presets -----------------------------------------------------------
// Saved from a clip, they show in the effect chooser with a ★ and are managed on the Presets tab.
const presetTabPreview = { items: [], started: 0 };
const asPreset = (p) => ({ name: p.name, effect: p.effect, params: p.params, label: p.name, mine: true });

async function loadPresets() {
  try { app.myPresets = (await api("api/presets")).map(asPreset); } catch { app.myPresets = []; }
  renderPresetsTab();
}

let savePresetsTimer = null;
function savePresets() {
  clearTimeout(savePresetsTimer);
  savePresetsTimer = setTimeout(async () => {
    try {
      await api("api/presets", { method: "PUT",
        json: app.myPresets.map(({ name, effect, params }) => ({ name, effect, params })) });
      status("Presets saved");
    } catch (e) { status(`Couldn't save presets: ${e.message}`, true); }
  }, 400);
}

// A name not yet used by another of that effect's presets.
function freePresetName(effect, base, except = null) {
  const taken = new Set(presetsFor(effect).filter((p) => p !== except).map((p) => p.label.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

// Asks for a name (and whether to keep the colours), then saves the clip's settings as a preset.
function savePresetFrom(clip) {
  const fx = EFFECTS[clip.effect];
  const dlg = document.createElement("dialog");
  dlg.className = "effect-dialog save-preset-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const h = document.createElement("h3");
  h.textContent = `Save as a ${fx.label} preset`;
  const name = document.createElement("input");
  name.required = true;
  name.maxLength = 60;
  name.value = freePresetName(clip.effect, `My ${fx.label.toLowerCase()}`);
  const nl = document.createElement("label");
  nl.append("Name", name);
  const colours = document.createElement("input");
  colours.type = "checkbox";
  colours.checked = true;
  const cl = document.createElement("label");
  cl.append(colours, "Include colours");
  cl.title = "Untick to save only the movement and other settings, so the preset keeps whatever colours a clip has";
  const hasColours = fx.params.some((p) => p.type === "color");
  cl.hidden = !hasColours;
  const actions = document.createElement("div");
  actions.className = "insp-actions";
  const save = button("Save preset", () => {}, "primary");
  save.type = "submit";
  const cancel = button("Cancel", () => dlg.close(), "ghost");
  cancel.type = "button";
  actions.append(save, cancel);
  form.append(h, nl, cl, actions);
  dlg.append(form);
  form.addEventListener("submit", () => {
    const label = name.value.trim();
    if (!label) return;
    const params = {};
    for (const p of fx.params) {
      if (p.type === "scene" || (p.type === "color" && !colours.checked)) continue;
      params[p.key] = clip[p.key] ?? p.default;
    }
    const finalName = freePresetName(clip.effect, label);
    app.myPresets.push(asPreset({ name: finalName, effect: clip.effect, params }));
    savePresets();
    renderPresetsTab();
    status(`Saved ★ ${finalName} as a ${fx.label} preset`);
    renderInspector();
  });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  name.select();
}

// The Presets tab: a list of your presets by effect on one side, and an editor for the one picked
// on the other, with a live preview and the same grouped settings as a clip. Changes apply as you
// make them and save a moment later.
let presetEditing = null;
const presetPreviewDev = () => app.devices[prefs.get("presetPreviewLight", "")] || null;
const presetClip = (p) => ({ effect: p.effect, start: 0, end: 4, ...chosenParams(p.effect, p) });
const hasColours = (effect) => EFFECTS[effect].params.some((q) => q.type === "color");
const keepsColours = (p) => EFFECTS[p.effect].params.some((q) => q.type === "color" && q.key in p.params);

// Built-in groups for picking an effect for a preset: lights' effects and the House lane's.
const PRESET_EFFECT_GROUPS = [["Light effects", false], ["House lane effects", true]];

function newPreset() {
  chooseEffect({
    title: "New preset: pick an effect to start from",
    groups: PRESET_EFFECT_GROUPS, dev: presetPreviewDev(), length: 4,
    onPick: (key, preset) => {
      const fx = EFFECTS[key];
      const name = freePresetName(key, preset ? `My ${preset.label.toLowerCase()}` : `My ${fx.label.toLowerCase()}`);
      const params = chosenParams(key, preset);
      const created = asPreset({ name, effect: key, params });
      app.myPresets.push(created);
      presetEditing = created;
      savePresets();
      renderPresetsTab();
    },
  });
}

function renderPresetsTab() {
  const list = $("my-presets"), editor = $("preset-editor");
  if (!list) return;
  presetTabPreview.items = [];
  presetTabPreview.started = performance.now();
  if (!app.myPresets.includes(presetEditing)) presetEditing = app.myPresets[0] || null;
  renderAiPresetIdeas();
  list.replaceChildren();
  if (!app.myPresets.length) {
    list.innerHTML = `<p class="hint">None yet. Press <b>New preset</b>, or select a clip in the editor and press
      <b>Save as preset…</b>.</p>`;
  }
  const dev = presetPreviewDev();
  for (const [key, fx] of Object.entries(EFFECTS)) {
    const mine = app.myPresets.filter((p) => p.effect === key);
    if (!mine.length) continue;
    const g = document.createElement("fieldset");
    g.className = "preset-group";
    const legend = document.createElement("legend");
    legend.textContent = fx.label;
    g.append(legend);
    for (const preset of mine) {
      const item = button("", () => { presetEditing = preset; renderPresetsTab(); },
        `preset-list-item${preset === presetEditing ? " active" : ""}`);
      const strip = document.createElement("canvas");
      strip.className = "fx-strip";
      const name = document.createElement("span");
      name.textContent = preset.name;
      item.append(strip, name);
      presetTabPreview.items.push({ canvas: strip, clip: presetClip(preset), dev, preset });
      g.append(item);
    }
    list.append(g);
  }
  renderPresetEditor(editor, dev);
}

// Keeps the previews in step with a preset while its settings change.
function refreshPresetPreviews(preset) {
  for (const item of presetTabPreview.items) if (item.preset === preset) item.clip = presetClip(preset);
}

function renderPresetEditor(box, dev) {
  box.replaceChildren();
  const preset = presetEditing;
  if (!preset) {
    box.innerHTML = `<p class="hint">Pick a preset to edit it here.</p>`;
    return;
  }
  const fx = EFFECTS[preset.effect];
  const changed = () => { refreshPresetPreviews(preset); savePresets(); };

  const head = document.createElement("div");
  head.className = "preset-editor-head";
  const name = document.createElement("input");
  name.className = "preset-name";
  name.value = preset.name;
  name.maxLength = 60;
  name.title = "The preset's name";
  name.addEventListener("change", () => {
    const v = name.value.trim();
    if (!v) { name.value = preset.name; return; }
    preset.name = preset.label = freePresetName(preset.effect, v, preset);
    savePresets();
    renderPresetsTab();
  });
  const effect = button(`${fx.label} ▾`, () => chooseEffect({
    title: `Change the effect of ${preset.name}`,
    groups: PRESET_EFFECT_GROUPS, dev, length: 4, from: { ...preset.params }, current: preset.effect,
    onPick: (key, start) => {
      const keep = keepsColours(preset);
      const params = chosenParams(key, start, preset.params);
      if (!keep) for (const q of EFFECTS[key].params) if (q.type === "color") delete params[q.key];
      preset.effect = key;
      preset.params = params;
      preset.name = preset.label = freePresetName(key, preset.name, preset);
      savePresets();
      renderPresetsTab();
    },
  }), "ghost effect-change");
  effect.title = "Change the effect, or start again from one of its presets";
  const el = document.createElement("label");
  el.append("Effect", effect);
  head.append(name, el);

  // A large looping preview, on a chosen light's segments.
  const previewRow = document.createElement("div");
  previewRow.className = "preset-preview";
  const strip = document.createElement("canvas");
  strip.className = "fx-strip preset-preview-strip";
  presetTabPreview.items.push({ canvas: strip, clip: presetClip(preset), dev, preset });
  const on = document.createElement("select");
  on.add(new Option("15 segments", ""));
  for (const d of app.deviceList) on.add(new Option(`${d.name} (${d.segments})`, d.id, false, d === dev));
  on.addEventListener("change", () => { prefs.set("presetPreviewLight", on.value); renderPresetsTab(); });
  const ol = document.createElement("label");
  ol.append("Preview on", on);
  previewRow.append(strip, ol);

  const group = (title) => {
    const g = document.createElement("fieldset");
    g.className = "insp-group";
    const legend = document.createElement("legend");
    legend.className = "section-label";
    legend.textContent = title;
    g.append(legend);
    return g;
  };
  const groups = { colours: group("Colours"), settings: group("Effect settings"), brightness: group("Brightness") };

  // Colours are part of the preset only when ticked; otherwise clips keep their own.
  if (hasColours(preset.effect)) {
    const include = document.createElement("input");
    include.type = "checkbox";
    include.checked = keepsColours(preset);
    include.addEventListener("change", () => {
      for (const q of fx.params) {
        if (q.type !== "color") continue;
        if (include.checked) preset.params[q.key] ??= q.default;
        else delete preset.params[q.key];
      }
      changed();
      renderPresetsTab();
    });
    const il = document.createElement("label");
    il.append(include, "Include colours");
    il.title = "Untick to keep whatever colours a clip already has when this preset is picked";
    groups.colours.append(il);
  }
  const colourKeys = [];
  for (const q of fx.params) {
    if (q.type === "scene") continue;
    if (q.type === "color" && !(q.key in preset.params)) continue;
    if (q.type === "color") colourKeys.push(q.key);
    const target = q.type === "color" ? groups.colours : q.type === "range" ? groups.brightness : groups.settings;
    let input;
    if (q.type === "select") {
      input = document.createElement("select");
      for (const o of q.options) input.add(new Option(o, o, false, o === (preset.params[q.key] ?? q.default)));
    } else {
      input = document.createElement("input");
      input.type = q.type;
      if (q.type === "number" || q.type === "range") Object.assign(input, { min: q.min, max: q.max, step: q.step });
      input.value = preset.params[q.key] ?? q.default;
    }
    input.dataset.key = q.key;
    const numeric = q.type === "number" || q.type === "range";
    const shown = document.createElement("span");
    shown.className = "range-value";
    const show = () => { shown.textContent = q.type === "range" ? `${input.value}%` : ""; };
    input.addEventListener("input", () => {
      const v = numeric ? Number(input.value) : input.value;
      if (numeric && !Number.isFinite(v)) return;
      preset.params[q.key] = v;
      show();
      changed();
    });
    if (q.type === "color") input.addEventListener("focus", () => { app.lastColourKey = q.key; });
    show();
    const l = document.createElement("label");
    if (q.type === "range") l.append(input, shown);
    else l.append(q.label, input);
    target.append(l);
  }
  if (colourKeys.length) {
    const setColours = () => {
      for (const k of colourKeys) {
        const input = groups.colours.querySelector(`input[data-key="${k}"]`);
        if (input) input.value = preset.params[k];
      }
      changed();
    };
    groups.colours.append(paletteRow((c) => {
      preset.params[colourKeys.includes(app.lastColourKey) ? app.lastColourKey : colourKeys[0]] = c;
      setColours();
    }, button("Apply palette", () => {
      const tmp = { effect: preset.effect, ...preset.params };
      applyPalette(tmp, currentPalette().colors);
      for (const k of colourKeys) preset.params[k] = tmp[k];
      setColours();
    }, "ghost")));
  }

  const actions = document.createElement("div");
  actions.className = "insp-actions";
  actions.append(
    button("Duplicate", () => {
      const copy = asPreset({ name: freePresetName(preset.effect, `${preset.name} copy`), effect: preset.effect,
        params: { ...preset.params } });
      app.myPresets.splice(app.myPresets.indexOf(preset) + 1, 0, copy);
      presetEditing = copy;
      savePresets();
      renderPresetsTab();
    }, "ghost"),
    button("Delete preset", () => {
      if (!confirm(`Delete the preset ${preset.name}? Clips using its settings keep them.`)) return;
      app.myPresets.splice(app.myPresets.indexOf(preset), 1);
      presetEditing = null;
      savePresets();
      renderPresetsTab();
    }, "ghost danger"),
  );
  box.append(head, previewRow, ...Object.values(groups).filter((g) => g.children.length > 1), actions);
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
    // A card per built-in palette: its colours as one bar, then its name and Copy.
    const card = document.createElement("div");
    card.className = "palette-card";
    const bar = document.createElement("div");
    bar.className = "palette-bar";
    for (const c of p.colors) {
      const el = document.createElement("span");
      el.style.background = c;
      bar.append(el);
    }
    const name = document.createElement("span");
    name.className = "palette-name";
    name.textContent = p.name;
    const copy = button("Copy", () => addMine({ name: uniqueName(`My ${p.name}`), colors: [...p.colors] }), "ghost");
    copy.title = "Copy to your palettes, to change it";
    const foot = document.createElement("div");
    foot.className = "palette-foot";
    foot.append(name, copy);
    card.append(bar, foot);
    return card;
  }));
  if (!app.palettes.length) {
    mine.innerHTML = `<p class="hint">None yet. Press New palette, or copy a built-in one and change it.</p>`;
    return;
  }
  mine.replaceChildren(...app.palettes.map((p, i) => {
    const row = document.createElement("div");
    row.className = "palette-item";
    const name = document.createElement("input");
    name.value = p.name;
    name.maxLength = 60;
    name.setAttribute("aria-label", "Palette name");
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
      el.setAttribute("aria-label", `${p.name}: colour ${k + 1}`);
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
  const lights = tracks.filter((t) => !isHouse(t));
  h.textContent = `Selected ${fmtTime(r.start)} to ${fmtTime(r.end)} on `
    + (tracks.length === 1 ? trackName(tracks[0]) : lights.length === tracks.length ? `${tracks.length} lights`
      : `the House lane and ${lights.length} light${lights.length === 1 ? "" : "s"}`);
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
  // With the House lane in the selection, House effects go there and light effects on the lights.
  const onHouse = tracks.some(isHouse);
  const groups = !onHouse ? [[null, false]] : !lights.length ? [[null, true]]
    : [["For the lights", false], ["For the House lane, across all lights by where they are on the house photo", true]];
  const actions = document.createElement("div");
  actions.className = "add-actions";
  const choose = button("＋ Add effect…", () => chooseEffect({
    title: `Add an effect to ${h.textContent.replace(/^Selected /, "")}`,
    groups, dev: app.devices[app.show.tracks[lights[0] ?? tracks[0]]?.device], length: r.end - r.start,
    current: null, suggested: lights.length ? suggestionsFor(r, lights) : null,
    fit: (c, then) => fitAcross(c, tracks, then),
    onPick: (key, preset) => { app.lastAdd = { key, preset }; addToRange(key, preset); },
  }), "primary");
  actions.append(choose);
  const last = app.lastAdd;
  if (last && tracks.some((t) => fitsTrack(last.key, t))) {
    actions.append(button(`Add ${EFFECTS[last.key].label}${last.preset ? ` · ${last.preset.label}` : ""} again`,
      () => addToRange(last.key, last.preset), "ghost"));
  }
  // Adding is what a selection is for, so it comes first; clearing sits last, away from it.
  const times = document.createElement("div");
  times.className = "group";
  times.append(timeInput("start"), timeInput("end"),
    button("▶ Play this part", () => { app.setRegion(r); app.seek(r.start); play(); }, "ghost"));
  box.append(actions, times, del);
}

// Looks that suit the selected part of the song, in the current palette's colours.
function suggestionsFor(r, lights) {
  if (!app.show.sections?.length && !app.show.tempo) return null;
  const dev = app.devices[app.show.tracks[lights[0]].device];
  const { section, tier, looks } = suggestLooks({ ...app.show, duration: app.duration() }, r.start, r.end,
    dev?.segments || 15, prefs.get("genStyle", "balanced"), isSlow(dev));
  const colors = currentPalette().colors;
  for (const look of looks) {
    const tmp = { effect: look.effect };
    applyPalette(tmp, colors);
    delete tmp.effect;
    Object.assign(look.params, tmp);
  }
  const mood = { low: "quiet", mid: "steady", high: "loud" }[tier];
  return { heading: `Suggested for this ${section ? `part (${section.label}, ${mood})` : "part"} in ${currentPalette().name} colours`, looks };
}

function addToRange(effect, preset = null) {
  const r = app.selected.range;
  const clipFor = () => ({ effect, start: r.start, end: r.end, ...chosenParams(effect, preset) });
  const kind = rangeTracks(r).filter((t) => fitsTrack(effect, t));
  // Left off the lights it won't work on, unless that's allowed.
  const tracks = kind.filter((t) => !unfit(clipFor(), t));
  const left = kind.filter((t) => !tracks.includes(t));
  const label = `${EFFECTS[effect].label}${preset ? ` (${preset.label})` : ""}`;
  if (!tracks.length) { status(`${label} won't work on ${left.map(trackName).join(", ")}`, true); return; }
  const added = tracks.map((t) => {
    const clip = clipFor();
    app.show.tracks[t].clips.push(clip);
    return { track: t, clip };
  });
  // One light: edit the new clip straight away. Several: keep the selection to add more.
  if (added.length === 1) app.selected = added[0];
  status(`Added ${label} to ${added.length === 1 ? trackName(tracks[0]) : `${added.length} lights`}`
    + (left.length ? `, not ${left.map(trackName).join(", ")}, where it won't work` : ""));
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

// demo ------------------------------------------------------------------------
function renderDemo() {
  const on = hasDemo(app.deviceList), can = canStartDemo(app.deviceList);
  $("btn-demo").hidden = on;
  $("btn-demo").disabled = !can;
  $("btn-demo-remove").hidden = !on;
  $("demo-hint").innerHTML = on
    ? `The demo is set up: ${DEMO_LIGHTS.length} planned lights on the sample house, a sample song and <b>${DEMO_SHOW}</b>. `
      + "Remove it when you're ready to add your own lights. The sample song stays in your songs."
    : can
      ? `Adds ${DEMO_LIGHTS.length} planned lights on the sample house, a sample song and a show ready to play, so you `
        + "can try everything before your lights are up. Nothing is sent to real lights."
      : "The demo is for a fresh start, before you add lights of your own.";
}

async function tryDemo() {
  if (!canStartDemo(app.deviceList)) { status("The demo is only for a fresh start, with no lights yet", true); return; }
  if (!(await confirmDiscard())) return;
  showView("editor");
  try {
    status("Setting up the demo…");
    app.deviceList = DEMO_LIGHTS.map((d) => ({ ...d }));
    await saveDevices();
    if (house.sample) {
      const { paths, styles } = placeOnSample(app.deviceList, house.paths);
      Object.assign(house.paths, paths);
      Object.assign(house.styles, styles);
      await api("api/house", { method: "PUT", json: { paths: house.paths, styles: house.styles, pins: house.pins, dim: house.dim } });
    }
    const christmas = allPalettes().find((p) => p.name === "Christmas") || currentPalette();
    await makeShow(DEMO_SHOW, await sampleSong(), christmas.colors);
    status("The demo is ready: press ▶ Play");
  } catch (e) {
    status(`Couldn't set up the demo: ${e.message}`, true);
  }
}

async function sampleSong() {
  const song = await (await fetch(DEMO_SONG)).blob();
  return new File([song], DEMO_SONG_NAME, { type: "audio/mpeg" });
}

// A new show called `name` on the song `file`: uploaded to the songs folder (so speakers can play it),
// listened to, generated in `colors` (or left blank without them) and saved.
async function makeShow(name, file, colors) {
  status(`Adding ${file.name}…`);
  const form = new FormData();
  form.append("file", file);
  const ref = await api("api/audio", { method: "POST", body: form });
  await openShow(null);
  app.show.name = name;
  $("show-name").value = name;
  app.show.audio = ref;
  app.changed();
  await loadAudio(ref);
  if (!songBuffer) throw new Error("the song didn't load");
  if (colors) {
    if (!(await analyseSong())) throw new Error("the song couldn't be listened to");
    await generate({ colors, style: "balanced", house: true });
  }
  await save();
}

async function removeDemo() {
  if (!confirm("Remove the demo's lights and its show? Your own shows and songs are kept.")) return;
  const shows = await api("api/shows");
  for (const s of shows.filter((x) => x.name === DEMO_SHOW)) {
    await api(`api/shows/${encodeURIComponent(s.id)}`, { method: "DELETE" });
  }
  if (app.show.name === DEMO_SHOW) { app.dirty = false; await openShow(null); }
  Object.assign(house, withoutDemo(house));
  await api("api/house", { method: "PUT", json: { paths: house.paths, styles: house.styles, pins: house.pins, dim: house.dim } });
  app.deviceList = app.deviceList.filter((d) => !isDemoId(d.id));
  await saveDevices();
  await refreshShows();
  status("Removed the demo");
}

// your data -------------------------------------------------------------------
async function renderCopies() {
  let copies = [];
  try { copies = await api("api/backup/copies"); } catch { /* shown as none */ }
  const when = (s) => new Date(s * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  $("data-copies").replaceChildren(...copies.map((c) => {
    const get = Object.assign(document.createElement("a"), { className: "button ghost", textContent: "Download",
      href: `api/backup/copies/${encodeURIComponent(c.name)}`, download: c.name });
    const put = button("Put back", () => replaceData(`api/backup/copies/${encodeURIComponent(c.name)}/restore`, null,
      `Put back the copy from ${when(c.made)}? It replaces what you have now, and a copy of that is kept first.`));
    return wizardRow(c.reason === "import" ? "Before an import" : "Before a fresh start",
      `${when(c.made)} · ${Math.max(1, Math.round(c.size / 1024))} KB`, get, put);
  }));
}

// Import, put back or start afresh: the add-on keeps a copy first, then the page reloads with the new data.
async function replaceData(url, body, question) {
  if (!confirm(question)) return;
  clearTimeout(autoSaveTimer);
  await stop();
  try {
    // Save the open show first, so the copy kept beforehand has your latest changes.
    if (app.dirty && worthSaving()) await save();
    status("Working…");
    const r = await api(url, { method: "POST", ...(body ? { body, headers: { "Content-Type": "application/zip" } } : {}) });
    if (url.endsWith("/reset")) {
      // A fresh start in this browser too: its layout, choices and the setup guide's "done".
      for (const k of Object.keys(localStorage)) if (k.startsWith("halidayshow.")) localStorage.removeItem(k);
    } else {
      prefs.set("lastShow", null);
    }
    status(r.restored ? `Imported ${r.restored} files` : "Done");
    app.dirty = false;  // what was open has been replaced, so don't ask about leaving it
    location.reload();
  } catch (e) {
    status(e.message, true);
    renderCopies();
  }
}

function wireData() {
  $("import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) replaceData("api/backup", file, `Import ${file.name}? It replaces your lights, shows, palettes, presets, `
      + "settings and house photo with the ones in the file. A copy of what you have now is kept first, under Your data.");
  });
  $("btn-afresh").addEventListener("click", () => replaceData("api/backup/reset", null, "Start afresh? This removes your "
    + "lights, shows, palettes, presets, settings and house photo, and resets this browser's layout, so HA-liday Show is "
    + "like new and the setup guide opens. Your songs are kept, and so is a copy of everything, under Your data."));
  $("btn-export").addEventListener("click", () => status("Exporting… check your downloads"));
}

// setup guide ----------------------------------------------------------------
// One window that walks a new user from nothing to a show. Each step uses the add-on's own windows
// (Add a light, Find, Add a speaker), so there's one way of doing each thing.
const WZ_STEPS = ["welcome", "lights", "check", "speaker", "house", "show"];
const wz = { step: "welcome", start: "setup", house: "sample", song: "sample", file: null };

function openWizard() {
  Object.assign(wz, { start: canStartDemo(app.deviceList) ? "demo" : "setup", house: "sample", song: "sample", file: null });
  $("wz-show-name").value = "My first show";
  $("wz-song-name").textContent = "An MP3 or other song file from this device.";
  wizardStep("welcome");
  if (!$("wizard").open) $("wizard").showModal();
}

function closeWizard() {
  prefs.set("wizard.done", true);
  if ($("wizard").open) $("wizard").close();
}

function pick(box, attr, value) {
  for (const b of $(box).querySelectorAll(`[data-${attr}]`)) b.classList.toggle("sel", b.dataset[attr] === value);
}

function wizardStep(step) {
  wz.step = step;
  const n = WZ_STEPS.indexOf(step);
  for (const sec of $("wizard").querySelectorAll("[data-wz-step]")) sec.hidden = sec.dataset.wzStep !== step;
  $("wz-dots").replaceChildren(...WZ_STEPS.map((s, i) => Object.assign(document.createElement("span"),
    { className: i <= n ? "on" : "" })));
  $("wz-step").textContent = `Step ${n + 1} of ${WZ_STEPS.length}`;
  $("wz-title").textContent = { welcome: "Welcome to HA-liday Show", lights: "Add your lights", check: "Check each light",
    speaker: "Where should the music play?", house: "Your house", show: "Make your first show" }[step];
  const q = (w) => $("wizard").querySelector(`[data-wz="${w}"]`);
  const back = q("back"), second = q("secondary"), first = q("primary");
  back.hidden = step === "welcome";
  second.hidden = step === "lights" || step === "check";
  $("wz-error").hidden = true;
  if (step === "welcome") {
    $("wz-start").querySelector('[data-start="demo"]').hidden = !canStartDemo(app.deviceList);
    pick("wz-start", "start", wz.start);
    second.textContent = "Skip, I'll look around";
    first.textContent = wz.start === "demo" ? "Start the demo" : "Let's start";
  } else if (step === "lights") {
    renderWizardLights();
    first.textContent = "Next";
  } else if (step === "check") {
    renderWizardCheck();
    first.textContent = "Next";
  } else if (step === "speaker") {
    renderWizardSpeakers();
    second.textContent = "Skip";
    first.textContent = "Next";
  } else if (step === "house") {
    const own = house.photo && !house.sample;
    $("wz-house").hidden = own;
    if (own) wz.house = "photo";
    pick("wz-house", "house", wz.house);
    $("wz-house-note").innerHTML = own ? "Your photo is already up. Trace your lights on it under <b>Setup → House</b>."
      : wz.house === "photo" && !house.sample ? "Photo saved. Trace your lights on it under <b>Setup → House</b> when you're ready." : "";
    second.textContent = "Skip";
    first.textContent = "Next";
  } else if (step === "show") {
    pick("wz-song", "song", wz.song);
    second.textContent = "Start with a blank show";
    first.textContent = "✨ Generate my show";
    first.disabled = !app.deviceList.length;
    first.title = app.deviceList.length ? "" : "Add a light first, so there's something to put effects on";
    return;
  }
  first.disabled = false;
  first.title = "";
}

function wizardRow(title, detail, ...end) {
  const row = document.createElement("div");
  row.className = "wz-row";
  const grow = document.createElement("span");
  grow.className = "grow";
  grow.append(Object.assign(document.createElement("b"), { textContent: title }),
    Object.assign(document.createElement("span"), { textContent: detail }));
  row.append(grow, ...end);
  return row;
}

const lightWhere = (d) => isHa(d) ? (d.entity || "Home Assistant") : d.ip || "Planned, no IP yet";
const lightKind = (d) => isWled(d) ? "WLED" : isHa(d) ? "Home Assistant" : d.kind === "twinkly" ? "Twinkly"
  : d.kind === "ddp" ? "DDP" : d.kind === "e131" ? "E1.31" : d.sku || "Govee";

function renderWizardLights() {
  $("wz-lights").replaceChildren(...app.deviceList.map((d) => wizardRow(d.name, `${lightKind(d)} · ${lightWhere(d)}`)));
  $("wz-add-light").textContent = app.deviceList.length ? "+ Add another light" : "+ Add a light";
}

function renderWizardCheck() {
  const box = $("wz-check");
  if (!app.deviceList.length) {
    box.replaceChildren(wizardRow("No lights yet", "Go back to add one, or carry on and add them later."));
    return;
  }
  box.replaceChildren(...app.deviceList.map((d) => {
    const end = [];
    if (!linked(d)) end.push(Object.assign(document.createElement("span"), { className: "hint", textContent: "Planned: test it when it arrives" }));
    else if (isPixels(d) || isHa(d)) {
      end.push(button("Test", () => testLight(d)));
      end.push(Object.assign(document.createElement("span"), { className: "hint ok", textContent: "✓ Set up" }));
    } else {
      end.push(button("Test", async () => { if (await testLight(d)) status(`Testing ${d.name} for 20 seconds`); }));
      const find = button("Find", () => findSegments(d), "ghost");
      find.disabled = LONG_PROTOCOLS.includes(d.protocol);
      end.push(find);
    }
    return wizardRow(d.name, isHa(d) ? "One colour at a time" : `${d.segments} segments`, ...end);
  }));
}

function renderWizardSpeakers() {
  const off = app.haAvailable === false;
  $("wz-speaker-help").innerHTML = off
    ? "Home Assistant isn't reachable from HA-liday Show, so songs play in this browser for now. You can add a speaker later under <b>Setup → Speakers</b>."
    : "Add the speaker the music should play on, and the lights follow it. Or skip this and play songs in this browser while you design.";
  $("wz-add-speaker").hidden = off;
  $("wz-speakers").replaceChildren(...(off ? [] : app.speakers.map((s) => wizardRow(s.name, s.entity_id,
    Object.assign(document.createElement("span"), { className: "hint ok", textContent: "✓ Added" })))));
}

async function wizardNext() {
  const step = wz.step;
  if (step === "welcome") {
    if (wz.start === "demo") { closeWizard(); await tryDemo(); return; }
    wizardStep("lights");
  } else if (step === "lights") wizardStep("check");
  else if (step === "check") wizardStep("speaker");
  else if (step === "speaker") {
    // The first speaker added plays shows started from automations, until one is picked in Setup → Speakers.
    if (app.speakers.length && !app.defaultSpeaker) {
      try {
        await api("api/speakers/show", { method: "PUT", json: { entity_id: app.speakers[0].entity_id } });
        await loadSpeakers();
      } catch { /* it can be picked under Setup → Speakers */ }
    }
    wizardStep("house");
  } else if (step === "house") {
    if (wz.house === "sample" && house.sample) {
      const todo = houseLights().filter((d) => !house.paths[d.id]?.length);
      if (todo.length) placeLightsOnSample(todo);
    }
    wizardStep("show");
  } else if (step === "show") await wizardMakeShow(true);
}

async function wizardMakeShow(generated) {
  const name = $("wz-show-name").value.trim() || "My first show";
  const file = wz.song === "file" ? wz.file : await sampleSong();
  if (!file) { $("wz-error").textContent = "Choose a song first, or use the sample song."; $("wz-error").hidden = false; return; }
  closeWizard();
  showView("editor");
  try {
    await makeShow(name, file, generated ? (seasonalPalette() || allPalettes().find((p) => p.name === "Christmas")).colors : null);
    status(generated ? `${name} is ready: press ▶ Play` : `${name} is ready for your effects`);
  } catch (e) {
    status(`Couldn't make the show: ${e.message}`, true);
  }
}

function wireWizard() {
  const dlg = $("wizard");
  $("btn-wizard").addEventListener("click", openWizard);
  dlg.addEventListener("cancel", () => prefs.set("wizard.done", true));
  dlg.addEventListener("click", (e) => {
    const what = e.target.closest("[data-wz]")?.dataset.wz;
    if (what === "close") closeWizard();
    else if (what === "back") wizardStep(WZ_STEPS[WZ_STEPS.indexOf(wz.step) - 1]);
    else if (what === "primary") wizardNext();
    else if (what === "secondary") {
      if (wz.step === "welcome") closeWizard();
      else if (wz.step === "show") wizardMakeShow(false);
      else wizardStep(WZ_STEPS[WZ_STEPS.indexOf(wz.step) + 1]);
    }
    const start = e.target.closest("[data-start]")?.dataset.start;
    if (start) { wz.start = start; wizardStep("welcome"); }
    const where = e.target.closest("[data-house]")?.dataset.house;
    if (where === "sample") { wz.house = "sample"; pick("wz-house", "house", "sample"); }
    const song = e.target.closest("[data-song]")?.dataset.song;
    if (song === "sample") { wz.song = "sample"; pick("wz-song", "song", "sample"); }
  });
  $("wz-photo").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    await house.upload(file);
    wz.house = "photo";
    renderHouseLights();
    wizardStep("house");
  });
  $("wz-song-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    wz.file = file;
    wz.song = "file";
    $("wz-song-name").textContent = file.name;
    if ($("wz-show-name").value === "My first show") $("wz-show-name").value = file.name.replace(/\.[^.]+$/, "");
    pick("wz-song", "song", "file");
  });
  $("wz-add-light").addEventListener("click", openAddLight);
  $("add-dialog").addEventListener("close", () => { if (dlg.open) renderWizardLights(); });
  $("wz-add-speaker").addEventListener("click", openAddSpeaker);
  $("speaker-dialog").addEventListener("close", () => { if (dlg.open) renderWizardSpeakers(); });
  $("finder").addEventListener("close", () => { if (dlg.open && wz.step === "check") renderWizardCheck(); });
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
    app.show.bars ||= [];
    app.show.sections ||= [];
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
  reportUnfit();
}

// Once a show is open, says how many of its clips won't work on their lights (worked out in the
// background). They stay in the show and play as they always did; the timeline marks them.
function reportUnfit() {
  const show = app.show, clips = [];
  show.tracks.forEach((tr, i) => tr.clips.forEach((c) => clips.push([c, i])));
  let left = clips.length, count = 0;
  const done = (fit) => {
    if (fit.level === "no") count++;
    if (--left || !count || show !== app.show) return;
    status(`⚠ ${count} clip${count === 1 ? " won't" : "s won't"} work on ${count === 1 ? "its light" : "their lights"}. `
      + "They're hatched on the timeline: select one to see why.", true);
  };
  for (const [c, i] of clips) {
    const fit = clipFitOn(c, i, done);
    if (fit) done(fit);
  }
}

async function save() {
  if (!app.showId) {
    const { id } = await api("api/shows", { method: "POST", json: { name: app.show.name } });
    app.showId = id;
    prefs.set("lastShow", id);
  }
  const pos = housePositions();
  const key = JSON.stringify([app.deviceList.map((d) => [d.id, d.segments, d.parts]), pos]);
  if (app.dirty || app.bakedKey === null) {
    app.show.duration = app.duration();
    const edits = app.edits;
    await api(`api/shows/${app.showId}`, { method: "PUT", json: app.show });
    if (app.edits === edits) app.dirty = false;
    app.bakedKey = null;  // saving the show clears the server's bake
  }
  if (app.bakedKey !== key) {
    const blob = bake(app.show, app.devices, FPS, pos);
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
  app.songs = list;
  const sel = $("audio-select");
  sel.replaceChildren(new Option("No song (lights only)", ""));
  const current = app.show?.audio;
  for (const a of list) {
    const label = `${a.source === "media" ? "Media" : "Uploaded"}: ${a.path}`;
    const value = JSON.stringify(a);
    sel.add(new Option(label, value, false, !!current && current.source === a.source && current.path === a.path));
  }
}

let audioCtx;
let songBuffer = null; // the decoded song, for Detect
async function loadAudio(ref) {
  app.peaks = null;
  songBuffer = null;
  app.audioDuration = 0;
  await refreshAudio();
  if (!ref) {
    audio.removeAttribute("src");
    audio.load();
    timeline.layout();
    renderSongSummary();
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
    songBuffer = decoded;
    app.audioDuration = decoded.duration;
    status("");
  } catch (e) {
    status(`Couldn't load the song: ${e.message}`, true);
  }
  timeline.layout();
  renderSongSummary();
}

const songLabel = (ref) => ref.path.split("/").pop().replace(/\.[^.]+$/, "");

// The Song panel's one line: the song's name, then its length, tempo and sections when known.
function renderSongSummary() {
  const ref = app.show?.audio;
  $("song-title").textContent = ref ? songLabel(ref) : "No song";
  const n = app.show?.sections?.length || 0;
  const meta = ref
    ? [app.audioDuration ? fmtTime(app.audioDuration, false) : "",
      app.show.tempo ? `${Math.round(app.show.tempo)} BPM` : "",
      n ? `${n} section${n === 1 ? "" : "s"}` : ""]
    : ["Lights only", `${Math.round(app.show?.duration || 60)} s`];
  $("song-meta").textContent = meta.filter(Boolean).join(" · ");
  $("song-title").title = ref ? `${ref.source === "media" ? "Media" : "Uploaded"}: ${ref.path}` : "";
}

// Choose a song: a row per song (the hidden select stays the source of truth), applied on Use.
let songPick = "";
function renderSongList() {
  const box = $("song-list");
  box.replaceChildren(...[...$("audio-select").options].map((o) => {
    const ref = o.value ? JSON.parse(o.value) : null;
    const row = document.createElement("label");
    row.className = `song-row${o.value === songPick ? " picked" : ""}`;
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "song-pick";
    radio.checked = o.value === songPick;
    radio.addEventListener("change", () => { songPick = o.value; renderSongList(); });
    const text = document.createElement("span");
    const name = document.createElement("b");
    name.textContent = ref ? songLabel(ref) : "No song, lights only";
    const where = document.createElement("span");
    where.className = "hint";
    where.textContent = ref ? `${ref.source === "media" ? "Media" : "Uploaded"}: ${ref.path}` : "Set how long the show runs";
    text.append(name, where);
    row.append(radio, text);
    return row;
  }));
  $("duration-wrap").hidden = songPick !== "";
}

function openSongDialog() {
  songPick = $("audio-select").value;
  renderSongList();
  $("song-dialog").returnValue = ""; // Escape keeps the last value, so a cancel must not look like Use
  $("song-dialog").showModal();
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
    ? "Home Assistant isn't reachable from HA-liday Show, so speakers can't be listed or tested right now." : "";
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
    delay.setAttribute("aria-label", `Delay for ${s.name}, in milliseconds`);
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
    rows.innerHTML = `<tr><td colspan="5" class="hint">None yet. Press <b>+ Add a speaker</b> to add one.</td></tr>`;
  }
  renderSpeakerCandidates();
}

// The Add a speaker window. Speakers added while it's open stay in its list with their tick, so you can see it worked.
const addedHere = new Set();

function renderSpeakerCandidates() {
  const q = $("speaker-filter").value.trim().toLowerCase();
  const all = (app.speakerCandidates || []).filter((c) => !c.added || addedHere.has(c.entity_id));
  $("speaker-filter").hidden = all.length < 8;
  const shown = all.filter((c) => !q || `${c.name} ${c.entity_id}`.toLowerCase().includes(q));
  const list = $("candidate-rows");
  list.replaceChildren(...shown.map((c) => {
    const row = document.createElement("div");
    row.className = "speaker-row";
    const who = document.createElement("span");
    who.className = "speaker-who";
    who.append(Object.assign(document.createElement("b"), { textContent: c.name }),
      Object.assign(document.createElement("span"), { textContent: c.state ? `${c.entity_id} · ${c.state}` : c.entity_id }));
    const actions = document.createElement("span");
    actions.className = "speaker-actions";
    const t = speakerTests[c.entity_id];
    if (c.added) {
      actions.append(Object.assign(document.createElement("span"), { className: "hint ok", textContent: t?.text || "✓ Added" }));
    } else if (c.can_play) {
      const b = button(t?.busy ? "Testing…" : t && !t.ok ? "Try again" : "Test and add", () => testSpeaker(c.entity_id, true),
        t && !t.ok ? "" : "primary");
      b.disabled = !!t?.busy;
      b.title = "Plays a short chime on it";
      actions.append(b);
      if (t) actions.append(Object.assign(document.createElement("span"), { className: `hint${t.busy ? "" : " error"}`, textContent: t.text }));
    } else {
      actions.append(Object.assign(document.createElement("span"), { className: "hint", textContent: "Can't be sent a song to play" }));
    }
    row.append(who, actions);
    return row;
  }));
  if (!shown.length) {
    list.innerHTML = `<p class="hint">${app.haAvailable === false ? "Home Assistant isn't reachable, so speakers can't be listed right now."
      : q ? "No speakers match that." : "No other media players in Home Assistant."}</p>`;
  }
}

function openAddSpeaker() {
  addedHere.clear();
  $("speaker-filter").value = "";
  for (const c of app.speakerCandidates || []) if (!c.added) delete speakerTests[c.entity_id];
  renderSpeakerCandidates();
  $("speaker-dialog").showModal();
  loadSpeakers();
}

async function testSpeaker(entity, adding = false) {
  speakerTests[entity] = { busy: true, text: "Playing a chime…" };
  renderSpeakers();
  try {
    const r = await api("api/speakers/test", { method: "POST", json: { entity_id: entity } });
    speakerTests[entity] = r.ok
      ? { ok: true, text: `✓ ${adding ? "Added" : "Works"}. It took ${r.start_s} s to start.` }
      : { ok: false, text: `✗ ${r.error}` };
    if (r.ok && adding) addedHere.add(entity);
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
    sel.add(new Option(`${current} (not added under Setup → Speakers)`, current));
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
const lightsOn = () => $("lights").checked && app.show.tracks.some((t) => linked(playingDev(t)));
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

// What Detect found in a song is also kept with the song file (on the Music tab or here), so any
// show using that song can start from it.
const songInfoUrl = (a) => `api/audio/info?source=${encodeURIComponent(a.source)}&path=${encodeURIComponent(a.path)}`;
async function songInfo(ref) {
  try { return ref ? await api(songInfoUrl(ref)) : null; } catch { return null; }
}

function applySongInfo(info) {
  Object.assign(app.show, {
    beats: [...info.beats], bars: [...info.bars], sections: info.sections.map((s) => ({ ...s })), tempo: info.tempo || null,
  });
  if (info.tempo) $("bpm").value = info.tempo;
}

// After picking a song: take its saved beats and sections, asking first if the show has its own.
async function importSongInfo({ quiet = true } = {}) {
  const ref = app.show.audio;
  const info = await songInfo(ref);
  if (ref !== app.show.audio) return;
  if (!info) {
    if (!quiet) status("No beats saved for this song yet. Use Detect here or on the Music tab", true);
    return;
  }
  const has = app.show.beats.length || app.show.sections?.length;
  if (has && !confirm("Replace this show's beat markers and sections with the ones saved for this song?")) return;
  applySongInfo(info);
  app.changed();
  status(`Using the song's ${info.beats.length} beats and ${info.sections.length} sections`);
}

// Finds the beats, bars and sections in the song, in a worker so the editor stays responsive.
async function detectBeats() {
  if (!songBuffer) { status("Choose a song first", true); return; }
  if ((app.show.beats.length || app.show.sections?.length)
      && !confirm("Replace the beat markers and sections with ones found in the song?")) return;
  const r = await analyseSong();
  if (!r) return;
  app.changed();
  const parts = `${r.sections.length} section${r.sections.length === 1 ? "" : "s"}`;
  status(r.tempo ? `Found ${r.beats.length} beats at ${r.tempo} BPM, and ${parts}` : `No steady beat found; found ${parts}`);
}

// Analyses the loaded song and puts its beats, bars, sections and tempo on the show (without
// committing the change). Returns the result, or null if it failed or the song changed meanwhile.
async function analyseSong() {
  const song = songBuffer;
  const channels = Array.from({ length: song.numberOfChannels }, (_, c) => song.getChannelData(c));
  const { samples, rate } = toMono(channels, song.sampleRate);
  status("Listening to the song…");
  $("btn-detect").disabled = true;
  let r;
  try {
    r = await analyseInWorker(samples, rate);
  } catch (e) {
    status(`Couldn't analyse the song: ${e.message}`, true);
    return null;
  } finally {
    $("btn-detect").disabled = false;
  }
  if (song !== songBuffer) return null;
  const info = { tempo: r.tempo || null, beats: r.beats, bars: r.bars, sections: r.sections };
  applySongInfo(info);
  if (app.show.audio) api(songInfoUrl(app.show.audio), { method: "PUT", json: info }).catch(() => {});
  return r;
}

// Generate: a first draft of the whole show from the song, a palette and a style.
let generateSeed = 0;
function generateDialog() {
  const dlg = document.createElement("dialog");
  dlg.className = "effect-dialog save-preset-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const h = document.createElement("h3");
  h.textContent = "Generate a show";
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Fills every light with effects that follow the song's beats and sections: soft looks in quiet "
    + "parts, fast ones on the beat when it gets loud, and the same looks each time a chorus comes back. It replaces "
    + "the lights' effects; Ctrl+Z brings them back. Generate again for a different take.";
  const palette = document.createElement("select");
  const preferred = seasonalPalette() || currentPalette();
  for (const p of allPalettes()) {
    const label = p === seasonalPalette() ? `${p.name} (in season)` : p.name;
    palette.add(new Option(label, p.name, false, p.name === preferred.name));
  }
  const pl = document.createElement("label");
  pl.append("Colours", palette);
  const style = document.createElement("select");
  for (const [key, st] of Object.entries(STYLES)) style.add(new Option(st.label, key, false, key === prefs.get("genStyle", "balanced")));
  const sl = document.createElement("label");
  sl.append("Style", style);
  // Made by the rules (instant, the same looks every time) or by the AI, which also reads your section notes.
  const maker = document.createElement("select");
  maker.add(new Option("Rules (instant)", "rules"));
  maker.add(new Option("AI (follows your section notes)", "ai"));
  maker.value = aiVia && prefs.get("genMaker", "rules") === "ai" ? "ai" : "rules";
  const ml = document.createElement("label");
  ml.append("Made by", maker);
  ml.hidden = !aiVia;
  const noted = (app.show.sections || []).filter((x) => x.notes).length;
  const notesHint = document.createElement("p");
  notesHint.className = "hint";
  notesHint.textContent = noted ? `${noted} section${noted === 1 ? " has" : "s have"} notes from the Music tab; the AI follows them.`
    : "Add notes to the song's sections on the Music tab to tell the AI what happens in each part.";
  const showNotes = () => { notesHint.hidden = maker.value !== "ai"; };
  maker.addEventListener("change", showNotes);
  showNotes();
  const house = document.createElement("input");
  house.type = "checkbox";
  house.checked = true;
  const hl = document.createElement("label");
  hl.append(house, "Sweep across the house as the music lifts");
  hl.hidden = !Object.keys(housePositionsAll()).length;
  const actions = document.createElement("div");
  actions.className = "insp-actions";
  const go = button("Generate", () => {}, "primary");
  go.type = "submit";
  const cancel = button("Cancel", () => dlg.close(), "ghost");
  cancel.type = "button";
  actions.append(go, cancel);
  form.append(h, hint, ml, notesHint, pl, sl, hl, actions);
  dlg.append(form);
  form.addEventListener("submit", () => {
    prefs.set("genStyle", style.value);
    if (!ml.hidden) prefs.set("genMaker", maker.value);
    const chosen = allPalettes().find((p) => p.name === palette.value) || currentPalette();
    const opts = { colors: chosen.colors, style: style.value, house: !hl.hidden && house.checked };
    if (maker.value === "ai") generateWithAI({ ...opts, paletteName: chosen.name });
    else generate(opts);
  });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

async function generate({ colors, style, house }) {
  // A split light gets effects on its parts; its own track (all the parts at once) is left for you.
  const lights = app.show.tracks.filter((tr) => tr.device !== HOUSE && playingDev(tr) && !playingDev(tr).light)
    .map((tr) => {
      const dev = app.devices[tr.device];
      return { id: tr.device, segments: dev.segments, slow: isSlow(dev), fits: (c) => fitFor(c, dev).level !== "no" };
    });
  if (!lights.length) { status("Add your lights under Setup → Devices first", true); return; }
  // Listen to the song first if that hasn't been done yet.
  if (songBuffer && !app.show.beats.length && !app.show.sections?.length && !(await analyseSong())) return;
  const show = app.show;
  const result = generateShow({ ...show, duration: app.duration() }, lights, colors, { style, house, seed: ++generateSeed });
  applyGenerated(show, result);
  app.select(null);
  app.changed();
  status(`Generated effects for ${lights.length} light${lights.length === 1 ? "" : "s"}. Ctrl+Z to undo`);
}

// Generate with the AI: the whole show from the song, its sections and their notes, in one request.
async function generateWithAI({ colors, paletteName, style, house }) {
  if (songBuffer && !app.show.beats.length && !app.show.sections?.length && !(await analyseSong())) return;
  const feel = { calm: "calm and gentle, with slow movement", balanced: "balanced, building with the music",
    lively: "lively, with lots of movement on the beat" }[style] || "balanced";
  const request = `Make a complete light show for the whole song on every light. Use the "${paletteName}" colours `
    + `(${colors.join(", ")}). Keep it ${feel}: quiet sections soft, loud sections bright and on the beat, and the `
    + "same looks each time a section comes back. Change looks on bar lines. Follow each section's notes."
    + (house ? " Add sweeps across the house as the music lifts into louder sections." : "");
  await describe(request, null, { replaceAll: true, what: "the show" });
}

// Presets from a description in words: the AI suggests a few, shown with live previews on the Presets
// tab until you keep the ones you like.
let aiPresetIdeas = [];

async function describePresets(e) {
  e.preventDefault();
  const request = $("ai-preset-request").value.trim();
  if (!request) { $("ai-preset-request").focus(); return; }
  const context = { effects: effectsForAI(), palettes: allPalettes().map((p) => ({ name: p.name, colors: p.colors })) };
  const done = aiWorking($("btn-ai-preset"), $("ai-preset-request"), $("ai-preset-hint"), "presets");
  let reply;
  try {
    reply = await api("api/ai/presets", { method: "POST", json: { request, context } });
  } catch (err) {
    done(err.message, true);
    return;
  }
  const { presets, skipped } = checkPresets(reply);
  aiPresetIdeas = presets;
  const extra = skipped.length ? ` (left out ${skipped.length}: ${[...new Set(skipped)].slice(0, 2).join("; ")})` : "";
  const message = `${reply.summary || `Made ${presets.length} presets`}${extra}`;
  done(presets.length ? `✓ ${message} Keep the ones you like.` : message, !presets.length);
  renderPresetsTab();
}

function renderAiPresetIdeas() {
  const box = $("ai-preset-ideas");
  box.replaceChildren();
  const dev = presetPreviewDev();
  for (const idea of aiPresetIdeas) {
    const card = document.createElement("div");
    card.className = "ai-preset-idea";
    const strip = document.createElement("canvas");
    strip.className = "fx-strip";
    const name = document.createElement("span");
    name.className = "ai-preset-idea-name";
    name.textContent = idea.name;
    const fx = document.createElement("span");
    fx.className = "hint";
    fx.textContent = EFFECTS[idea.effect].label;
    const actions = document.createElement("div");
    actions.className = "insp-actions";
    const drop = () => { aiPresetIdeas = aiPresetIdeas.filter((x) => x !== idea); };
    actions.append(
      button("Keep", () => {
        const kept = asPreset({ ...idea, name: freePresetName(idea.effect, idea.name) });
        app.myPresets.push(kept);
        presetEditing = kept;
        drop();
        savePresets();
        renderPresetsTab();
        status(`Kept ★ ${kept.name} as a ${EFFECTS[idea.effect].label} preset`);
      }, "primary"),
      button("Dismiss", () => { drop(); renderPresetsTab(); }, "ghost"),
    );
    card.append(strip, name, fx, actions);
    presetTabPreview.items.push({ canvas: strip, clip: presetClip(idea), dev });
    box.append(card);
  }
}

// Describe it: effects from a request in words, made by the AI the add-on is set up with.
let aiVia = null; // how AI requests go ("claude" or "ha"), or null when no AI is set up

async function loadAiStatus() {
  let st = { via: null };
  try { st = await api("api/ai"); } catch { /* older add-on or offline */ }
  aiVia = st.via;
  const text = st.via === "claude" ? `Using Claude (${st.model}) with the API key from the app's Configuration tab.`
    : st.via === "ha" ? `Using Home Assistant's AI Task${st.entity ? ` (${st.entity})` : ""}.`
      : "Not set up yet: add a Claude API key on the app's Configuration tab, or set up an AI integration with an AI Task entity in Home Assistant.";
  $("ai-status").textContent = text;
  $("ai-hint").textContent = st.via ? "" : "Set up an AI under Setup → Settings to use this.";
  $("ai-hint").hidden = !!st.via;
  $("ai-preset-hint").textContent = st.via ? "" : $("ai-hint").textContent;
  $("ai-preset-hint").hidden = !!st.via;
}

// The lights as the AI knows them: unique names, with the House lane when the house photo is traced.
function aiLights() {
  const seen = new Set(), traced = Object.keys(housePositionsAll()).length > 0;
  const lights = [];
  app.show.tracks.forEach((tr, i) => {
    if (tr.device === HOUSE) {
      if (traced) lights.push({ name: "House", trackIndex: i, segments: 0, house: true });
      return;
    }
    const dev = playingDev(tr);
    if (!dev) return;
    let name = dev.name || tr.device;
    for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${dev.name || tr.device} (${k})`;
    seen.add(name.toLowerCase());
    lights.push({ name, trackIndex: i, segments: dev.segments, ...(isSlow(dev) ? { slow: true } : {}) });
  });
  return lights;
}

async function describeIt(e) {
  e.preventDefault();
  const request = $("ai-request").value.trim();
  if (!request) { $("ai-request").focus(); return; }
  const sel = app.selected;
  await describe(request, (lights) => {
    const names = (ts) => lights.filter((l) => ts.includes(l.trackIndex)).map((l) => l.name);
    return sel?.range ? { start: sel.range.start, end: sel.range.end, lights: names(rangeTracks(sel.range)) }
      : sel?.clip ? { start: sel.clip.start, end: sel.clip.end, lights: names([sel.track]) } : null;
  });
}

// Sends a request to the AI with the show's context and puts the clips it makes on the show.
// selectionFor(lights) gives the selection to send; replaceAll clears the lights first, as Generate does.
async function describe(request, selectionFor, { replaceAll = false, what = "your effects" } = {}) {
  const lights = aiLights();
  if (!lights.some((l) => !l.house)) { status("Add your lights under Setup → Devices first", true); return; }
  const selection = selectionFor ? selectionFor(lights) : null;
  const show = app.show, duration = app.duration();
  const context = buildContext({ show, lights, duration, selection, palettes: allPalettes() });
  const done = aiWorking(undefined, undefined, undefined, what);
  status(`Asking the AI to make ${what}…`);
  let reply;
  try {
    reply = await api("api/ai/clips", { method: "POST", json: { request, context } });
  } catch (err) {
    done(err.message, true);
    status(err.message, true);
    return;
  }
  if (show !== app.show) { done(""); return; } // another show was opened meanwhile
  const checked = checkClips(reply, lights, duration), skipped = checked.skipped;
  // The AI can't see what each light can show, so clips that won't work on theirs are left out.
  const placed = checked.placed.filter(({ trackIndex, clip }) => {
    if (clipFitOn(clip, trackIndex).level !== "no") return true;
    skipped.push(`${EFFECTS[clip.effect].label} won't work on ${trackName(trackIndex)}`);
    return false;
  });
  if (placed.length) {
    if (replaceAll) for (const l of lights) show.tracks[l.trackIndex].clips = [];
    placeClips(show, placed);
    app.select(null);
    app.changed();
  }
  const extra = skipped.length ? ` (left out ${skipped.length}: ${[...new Set(skipped)].slice(0, 2).join("; ")})` : "";
  const message = `${reply.summary || `Added ${placed.length} effects`}${extra}`;
  done(placed.length ? `✓ ${message}` : message, !placed.length);
  status(message, !placed.length);
}

// Shows that the AI is working (a spinner and a running count of seconds in the panel) until the
// returned function is called with the outcome to leave there.
function aiWorking(btn = $("btn-ai"), input = $("ai-request"), hint = $("ai-hint"), what = "your effects") {
  const label = btn.innerHTML;
  btn.disabled = input.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Working…`;
  hint.hidden = false;
  hint.classList.remove("error");
  const started = performance.now();
  const tick = () => {
    const secs = Math.round((performance.now() - started) / 1000);
    hint.textContent = `Asking the AI to make ${what}… ${secs} s (usually 10 to 60 seconds)`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  return (message, error = false) => {
    clearInterval(timer);
    btn.disabled = input.disabled = false;
    btn.innerHTML = label;
    hint.textContent = message;
    hint.classList.toggle("error", error);
  };
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
  drawPickerPreviews();
  requestAnimationFrame(frame);
}

// wiring ----------------------------------------------------------------------
// Library and Setup each hold several pages; each remembers the page last open in it.
const SECTIONS = { library: ["palettes", "presets"], setup: ["devices", "speakers", "house", "settings", "labs"] };
const sectionPage = { library: "palettes", setup: "devices" };

// Opens a tab (editor, music, library, setup) or a page in Library or Setup (devices, palettes…).
function showView(view) {
  if (view === "labs" && !labsOn()) view = "settings";
  const section = Object.keys(SECTIONS).find((k) => SECTIONS[k].includes(view));
  if (section) sectionPage[section] = view;
  const page = SECTIONS[view] ? sectionPage[view] : view;
  const top = section || view;
  for (const t of document.querySelectorAll(".tab")) {
    t.classList.toggle("active", t.dataset.view === top);
    if (t.dataset.view === top) t.scrollIntoView({ block: "nearest", inline: "nearest" }); // on a phone the tab row scrolls
  }
  for (const t of document.querySelectorAll(".subtab")) t.classList.toggle("active", t.dataset.view === page);
  for (const k of Object.keys(SECTIONS)) $(`section-${k}`).hidden = k !== top;
  for (const v of ["editor", "music", ...Object.values(SECTIONS).flat()]) $(`view-${v}`).hidden = v !== page;
  if (page === "music") refreshAudio().catch(() => {}).then(() => music.show()); else music.hide();
  if (page === "speakers") loadSpeakers();
  if (page === "house") renderHouseLights();
  if (page === "settings") renderCopies();
  if (page === "editor") { layoutPreview(); timeline.layout(); }
}

function wire() {
  // Windows live at the top of the page, so they can open over any tab (the setup guide opens
  // Add a light and Add a speaker from the editor).
  for (const d of document.querySelectorAll(".view dialog")) document.body.append(d);
  for (const tab of document.querySelectorAll(".tab, .subtab")) tab.addEventListener("click", () => showView(tab.dataset.view));

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
    $("show-dialog").close();
    await openShow(null);
  });
  $("btn-show-settings").addEventListener("click", () => {
    $("btn-delete").disabled = !app.showId;
    $("show-dialog").showModal();
  });
  $("btn-song").addEventListener("click", () => refreshAudio().catch(() => {}).then(openSongDialog));
  $("song-dialog").addEventListener("close", () => {
    const sel = $("audio-select");
    if ($("song-dialog").returnValue !== "use" || songPick === sel.value) return;
    sel.value = songPick;
    sel.dispatchEvent(new Event("change"));
  });
  $("btn-song-music").addEventListener("click", () => { $("song-dialog").close(""); showView("music"); });

  $("audio-select").addEventListener("change", async (e) => {
    app.show.audio = e.target.value ? JSON.parse(e.target.value) : null;
    app.changed();
    await stop();
    await loadAudio(app.show.audio);
    await importSongInfo();
  });
  $("audio-upload").addEventListener("change", (e) => {
    if (!e.target.files[0]) return;
    $("song-dialog").close("");
    upload(e.target.files[0]);
  });
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
  $("btn-detect").addEventListener("click", detectBeats);
  $("btn-song-beats").addEventListener("click", () => importSongInfo({ quiet: false }));
  $("btn-generate").addEventListener("click", generateDialog);
  $("ai-form").addEventListener("submit", describeIt);
  $("ai-preset-form").addEventListener("submit", describePresets);
  $("btn-clear-beats").addEventListener("click", () => {
    if ((app.show.beats.length || app.show.sections?.length) && confirm("Remove all beat markers and sections?")) {
      Object.assign(app.show, { beats: [], bars: [], sections: [] });
      app.changed();
    }
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

  $("btn-scan").addEventListener("click", () => (addFlow.kind === "wled" ? scanWled() : scan()));
  $("btn-add-light").addEventListener("click", openAddLight);
  $("btn-add-speaker").addEventListener("click", openAddSpeaker);
  $("btn-demo").addEventListener("click", tryDemo);
  $("btn-demo-remove").addEventListener("click", removeDemo);
  $("speaker-filter").addEventListener("input", renderSpeakerCandidates);
  $("speaker-dialog").addEventListener("click", (e) => {
    if (e.target.closest('[data-speaker="close"]')) $("speaker-dialog").close();
  });
  for (const b of $("add-dialog").querySelectorAll("[data-kind]")) {
    b.addEventListener("click", () => { addFlow.kind = b.dataset.kind; addStep("details"); });
  }
  $("add-dialog").addEventListener("click", (e) => {
    const what = e.target.closest("[data-add]")?.dataset.add;
    if (what === "close") $("add-dialog").close();
    else if (what === "back") addStep("kind");
    else if (what === "again") openAddLight();
    else if (what === "go") addLightNow();
  });
  $("add-dialog").addEventListener("input", () => { $("add-error").hidden = true; });
  $("add-dialog").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input") && !$("add-go").hidden) { e.preventDefault(); addLightNow(); }
  });
  $("btn-new-preset").addEventListener("click", newPreset);
  $("btn-new-palette").addEventListener("click", () => {
    app.palettes.push({ name: uniqueName("My palette"), colors: ["#ff0000", "#00ff00", "#0000ff"] });
    savePalettes();
    renderPalettes();
  });
  $("plan-model").addEventListener("change", planModelChanged);


  document.addEventListener("keydown", (e) => {
    if (music.active) { music.key(e); return; }
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveClicked(); return; }
    // The effect chooser handles its own keys (Escape closes it).
    if (typing || $("view-editor").hidden || document.querySelector("dialog[open]")) return;
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

// Setup → Labs → Packet lab: send a hand-made message to one light and show what comes back.
const LAB_HELP = {
  json: "A whole LAN message, sent as it is.",
  razer: "The command byte and its data in hex; the BB header, length and checksum are added. Set Length field to override it.",
  ptreal: "One app command per line, in hex; each is padded to 20 bytes and given its checksum.",
};

function renderLab() {
  const lights = $("lab-light"), keep = lights.value;
  // The lab speaks Govee's LAN protocol, so it only offers Govee lights.
  lights.replaceChildren(...app.deviceList.filter((d) => d.ip && (d.kind || "govee") === "govee").map((d) => new Option(`${d.name} (${d.ip})`, d.ip)));
  if (keep) lights.value = keep;
  for (const id of ["btn-lab-send", "btn-lab-sweep", "btn-lab-start-sweep", "btn-lab-flag-sweep", "btn-lab-mode-sweep", "btn-lab-speed"]) {
    $(id).disabled = !lights.options.length;
  }
}

function fillLab() {
  const t = LAB_TEMPLATES[$("lab-template").value];
  const hex = $("lab-colour").value;
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  $("lab-kind").value = t.kind;
  $("lab-text").value = t.text(Math.max(1, Math.min(255, Number($("lab-n").value) || 1)), rgb);
  $("lab-length").value = t.length ?? "";
  $("lab-repeat").value = t.repeat ?? 1;
  $("lab-interval").value = t.interval ?? 100;
  $("lab-on").checked = !!t.realtimeOn;
  $("lab-help").textContent = LAB_HELP[t.kind];
}

async function labSpeed() {
  const json = { ip: $("lab-light").value, bulbs: Number($("lab-n").value) || 300,
    small: $("lab-speed-size").value === "small", per_second: Number($("lab-speed-rate").value) };
  try {
    await api("api/lab/speed", { method: "POST", json });
  } catch (e) { status(`Not sent: ${e.message}`, true); return; }
  labWatch(true);
}

async function labSend(sweep = null) {
  const json = sweep ? { ip: $("lab-light").value, steps: sweep } : {
    ip: $("lab-light").value, kind: $("lab-kind").value, text: $("lab-text").value,
    length: $("lab-length").value, repeat: Number($("lab-repeat").value),
    interval_ms: Number($("lab-interval").value), realtime_on: $("lab-on").checked,
  };
  try {
    await api("api/lab/send", { method: "POST", json });
  } catch (e) { status(`Not sent: ${e.message}`, true); return; }
  const legend = $("lab-legend");
  legend.hidden = !sweep;
  if (sweep) legend.replaceChildren(...sweep.map((s) => Object.assign(document.createElement("li"), { textContent: s.label })));
  labWatch(!!sweep);
}

function labWatch(steps) {
  const poll = async () => {
    let s;
    try { s = await api("api/lab"); } catch { return; }
    $("lab-now").hidden = !(steps && s.steps > 1);
    $("lab-now").textContent = s.running ? `Now ${s.step} of ${s.steps}: ${s.label}` : "Finished";
    const log = $("lab-log");
    log.hidden = false;
    log.textContent = [`${s.running ? "Sending" : "Done"}: ${s.sent} sent to ${s.ip}`,
      ...s.log.map((e) => `${e.t.toFixed(2).padStart(7)}s ${{ sent: "→", received: "←", step: "▶" }[e.dir]} ${e.text}`)].join("\n");
    if (s.running) setTimeout(poll, 500);
  };
  poll();
}

function wireLab() {
  for (const [k, t] of Object.entries(LAB_TEMPLATES)) $("lab-template").add(new Option(t.label, k));
  for (const id of ["lab-template", "lab-n", "lab-colour"]) $(id).addEventListener("change", fillLab);
  $("lab-kind").addEventListener("change", () => { $("lab-help").textContent = LAB_HELP[$("lab-kind").value]; });
  $("lab-light").addEventListener("change", () => {
    const d = app.deviceList.find((x) => x.ip === $("lab-light").value);
    if (d) { $("lab-n").value = d.segments; fillLab(); }
  });
  $("btn-lab-send").addEventListener("click", () => labSend());
  $("btn-lab-speed").addEventListener("click", labSpeed);
  for (const [id, sweep] of [["btn-lab-sweep", windowSweep], ["btn-lab-start-sweep", startSweep],
    ["btn-lab-flag-sweep", flagSweep], ["btn-lab-mode-sweep", modeSweep]]) {
    $(id).addEventListener("click", () => {
      const d = app.deviceList.find((x) => x.ip === $("lab-light").value);
      const w = sweepWindow(app.models[skuOf(d?.sku)], Number($("lab-n").value));
      status(`Sweeping the first ${w} bulbs`);
      labSend(sweep(w));
    });
  }
  $("btn-lab-stop").addEventListener("click", () => api("api/lab/stop", { method: "POST", json: {} }).catch(() => {}));
  fillLab();
}

// Setup → Labs → Listen for Govee traffic: record what the lights say to each other, e.g. during Scene Stage.
async function listenForTraffic() {
  try {
    await api("api/diagnostics/listen", { method: "POST", json: { seconds: 60 } });
  } catch (e) { status(`Couldn't listen: ${e.message}`, true); return; }
  $("btn-listen").disabled = true;
  const poll = async () => {
    let s;
    try { s = await api("api/diagnostics/listen"); } catch { setTimeout(poll, 2000); return; }
    $("listen-status").textContent = s.running
      ? `Listening… ${s.left} seconds left, ${s.count} messages so far.`
      : s.count
        ? `Heard ${s.count} messages. Download the recording and attach it to a GitHub issue.`
        : "Heard nothing. The lights may talk to each other directly, out of Home Assistant's hearing.";
    const rows = $("listen-summary").querySelector("tbody");
    rows.replaceChildren(...s.summary.map((r) => {
      const tr = document.createElement("tr");
      for (const v of [r.from, r.to, r.cmd, r.count]) {
        const td = document.createElement("td");
        td.textContent = v;
        tr.append(td);
      }
      return tr;
    }));
    $("listen-summary").hidden = !s.summary.length;
    $("listen-download").hidden = s.running || !s.count;
    if (s.running) setTimeout(poll, 2000); else $("btn-listen").disabled = false;
  };
  poll();
}

async function init() {
  wire();
  $("btn-listen").addEventListener("click", listenForTraffic);
  wireLab();
  wireHouse();
  wireWizard();
  wireData();
  const layout = new Layout(() => { layoutPreview(); timeline.layout(); });
  $("btn-reset-layout").addEventListener("click", () => layout.reset());
  $("exp-labs").checked = labsOn();
  $("tab-labs").hidden = !labsOn();
  $("exp-labs").addEventListener("change", (e) => {
    prefs.set("labs", e.target.checked);
    $("tab-labs").hidden = !e.target.checked;
    if (!e.target.checked && sectionPage.setup === "labs") sectionPage.setup = "settings";
  });
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
    loadPresets();
    loadAiStatus();
    house.load().then(renderHouseLights);
    const shows = await api("api/shows");
    const last = prefs.get("lastShow", null);
    const id = shows.some((s) => s.id === last) ? last : shows[0]?.id;
    await openShow(id || null);
    // A fresh install opens the setup guide, once.
    if (!app.deviceList.length && !shows.length && !prefs.get("wizard.done", false)) openWizard();
  } catch (e) {
    status(`Couldn't reach HA-liday Show: ${e.message}`, true);
  }
  requestAnimationFrame(frame);
}

init();
