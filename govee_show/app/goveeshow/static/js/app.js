// Editor app: shows, songs, devices, transport and the clip inspector.

import { EFFECTS, FPS, bake, defaultParams, renderTrack, showDuration } from "./effects.js";
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
  bakedKey: null,
  deviceList: [],
  devices: {},
  pps: prefs.get("pps", 60),
  time: 0,
  playing: false,
  selected: null,
  paletteEffect: "solid",
  snap: prefs.get("snap", true),
  peaks: null,
  audioDuration: 0,
  history: [],
  historyIndex: -1,
  clockStart: 0,
  syncTimer: null,
  speakers: [],
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

  select(sel) {
    this.selected = sel;
    renderInspector();
    timeline.draw();
  },

  // live changes redraw only; committed ones also go on the undo history.
  changed({ live = false } = {}) {
    this.dirty = true;
    timeline.layout();
    if (!live) {
      commit();
      renderInspector();
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
  app.selected = null;
  renderInspector();
  timeline.layout();
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
    rows.innerHTML = `<tr><td colspan="7" class="hint">No devices yet. Scan the network or add one by IP.</td></tr>`;
    return;
  }
  for (const d of app.deviceList) {
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
    cell(input("number", "segments", { min: 1, max: 255 }));
    cell(input("checkbox", "reverse"));
    cell(input("checkbox", "gradient"));
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
  app.deviceList.push({ id: found.id, name, ip: found.ip, sku: found.sku || "", segments: 15, reverse: false, gradient: false });
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

// palette and inspector -------------------------------------------------------
function renderPalette() {
  const box = $("palette");
  box.replaceChildren();
  for (const [key, fx] of Object.entries(EFFECTS)) {
    const b = button(fx.label, () => {
      app.paletteEffect = key;
      renderPalette();
    }, key === app.paletteEffect ? "active" : "");
    box.append(b);
  }
}

function renderInspector() {
  const box = $("inspector");
  const sel = app.selected;
  const track = sel && app.show.tracks[sel.track];
  if (!sel || !track || !track.clips.includes(sel.clip)) {
    app.selected = null;
    box.innerHTML = `<p class="hint">Select a clip to edit it. Drag on a track to add the selected effect. Drag clip
      edges to resize, Delete removes, D duplicates, Ctrl+Z undoes. Click the beat lane to add or remove a beat;
      hold Shift to drag without snapping.</p>`;
    return;
  }
  const clip = sel.clip;
  const dev = app.devices[track.device];
  box.replaceChildren();
  const h = document.createElement("h3");
  h.textContent = `${EFFECTS[clip.effect]?.label || clip.effect} on ${dev ? dev.name : "missing device"}`;
  box.append(h);

  const field = (label, el) => {
    const l = document.createElement("label");
    l.append(label, el);
    box.append(l);
    return el;
  };

  const effect = document.createElement("select");
  for (const [key, fx] of Object.entries(EFFECTS)) effect.add(new Option(fx.label, key, false, key === clip.effect));
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
    let el;
    if (p.type === "select") {
      el = document.createElement("select");
      for (const o of p.options) el.add(new Option(o, o, false, o === (clip[p.key] ?? p.default)));
    } else {
      el = document.createElement("input");
      el.type = p.type;
      if (p.type === "number") Object.assign(el, { min: p.min, max: p.max, step: p.step });
      el.value = clip[p.key] ?? p.default;
    }
    const read = () => (p.type === "number" ? Number(el.value) : el.value);
    el.addEventListener("input", () => {
      if (p.type === "number" && !Number.isFinite(read())) return;
      clip[p.key] = read();
      app.changed({ live: true });
    });
    el.addEventListener("change", () => app.changed());
    field(p.label, el);
  }
  box.append(button("Delete clip", deleteSelected, "ghost danger"));
}

function deleteSelected() {
  const sel = app.selected;
  if (!sel) return;
  const clips = app.show.tracks[sel.track].clips;
  clips.splice(clips.indexOf(sel.clip), 1);
  app.selected = null;
  app.changed();
}

function duplicateSelected() {
  const sel = app.selected;
  if (!sel) return;
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

function confirmDiscard() {
  return !app.dirty || confirm("You have unsaved changes. Discard them?");
}

async function openShow(id) {
  await stop();
  if (id) {
    app.show = await api(`api/shows/${encodeURIComponent(id)}`);
    app.show.beats ||= [];
    app.show.tracks ||= [];
  } else {
    app.show = blankShow();
  }
  app.showId = id || null;
  app.dirty = false;
  app.bakedKey = null;
  app.selected = null;
  app.history = [];
  ensureTracks();
  commit();
  prefs.set("lastShow", app.showId);
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
    await api(`api/shows/${app.showId}`, { method: "PUT", json: app.show });
    app.dirty = false;
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
  try {
    status("Saving…");
    await save();
    status("Saved");
  } catch (e) { status(`Save failed: ${e.message}`, true); }
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
const speaker = () => app.show.media_player || "";

async function loadSpeakers() {
  try {
    const body = await api("api/speakers");
    app.speakers = body.speakers;
  } catch { app.speakers = []; }
  renderOutput();
}

function renderOutput() {
  const sel = $("output-select");
  sel.replaceChildren(new Option("Song in this browser", ""));
  const current = speaker();
  for (const s of app.speakers) sel.add(new Option(`Speaker: ${s.name}`, s.entity_id, false, s.entity_id === current));
  if (current && !app.speakers.some((s) => s.entity_id === current)) {
    sel.add(new Option(`Speaker: ${current} (unavailable)`, current, false, true));
  }
  sel.value = current;
  const sp = app.speakers.find((s) => s.entity_id === current);
  $("lights-wrap").hidden = !!current;
  $("offset-label").textContent = current ? "Speaker delay" : "Light offset";
  $("offset-hint").textContent = current
    ? "How late this speaker plays after it reports starting. Raise it if the lights lead the music."
    : "Use this to line the lights up with the audio if they lead or lag.";
  $("offset").value = current ? (sp?.delay_ms ?? 0) : prefs.get("offset", 0);
  $("automation-input").textContent = JSON.stringify({ action: "play", show: app.showId || app.show.name });
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
  try { await api("api/player/sync", { method: "POST", json: { position: currentTime() } }); }
  catch { /* the next sync will retry */ }
}

async function play() {
  if (app.playing) return;
  if (app.time >= app.duration() - 0.01) app.seek(0);
  if (speaker()) {
    if (!app.show.audio) { status("Pick a song to play on a speaker", true); return; }
    try {
      status("Starting the speaker…");
      await save();
      const st = await api("api/player/play", {
        method: "POST", json: { show: app.showId, position: app.time, media_player: speaker() },
      });
      status("");
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
    if (app.time >= app.duration()) {
      app.time = app.duration();
      stop();
    }
    timeline.follow(app.time);
  }
  $("clock").textContent = fmtTime(app.time);
  timeline.drawPlayhead();
  drawPreview();
  requestAnimationFrame(frame);
}

// wiring ----------------------------------------------------------------------
function wire() {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t === tab);
      $("view-editor").hidden = tab.dataset.view !== "editor";
      $("view-devices").hidden = tab.dataset.view !== "devices";
      if (tab.dataset.view === "editor") { layoutPreview(); timeline.layout(); }
    });
  }

  $("show-select").addEventListener("change", async (e) => {
    const v = e.target.value;
    if (!confirmDiscard()) { await refreshShows(); return; }
    if (v === "__new__") await openShow(null);
    else if (v) await openShow(v);
  });
  $("show-name").addEventListener("change", (e) => {
    app.show.name = e.target.value.trim() || "Untitled show";
    app.changed();
  });
  $("btn-save").addEventListener("click", saveClicked);
  $("btn-delete").addEventListener("click", async () => {
    if (!app.showId || !confirm(`Delete "${app.show.name}"? This can't be undone.`)) return;
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
  $("btn-home").addEventListener("click", () => app.seek(0));
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
    app.show.media_player = e.target.value || null;
    app.changed();
    renderOutput();
  });
  $("btn-zoom-in").addEventListener("click", () => { timeline.zoom(1.5); prefs.set("pps", app.pps); });
  $("btn-zoom-out").addEventListener("click", () => { timeline.zoom(1 / 1.5); prefs.set("pps", app.pps); });

  $("btn-scan").addEventListener("click", scan);
  $("plan-model").addEventListener("change", planModelChanged);
  $("plan-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("plan-name").value.trim();
    const base = `planned-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "light"}`;
    let id = base;
    for (let n = 2; app.devices[id]; n++) id = `${base}-${n}`;
    const sku = app.models[skuOf($("plan-model").value)] ? skuOf($("plan-model").value) : "";
    app.deviceList.push({ id, name, ip: "", sku, segments: Number($("plan-segments").value) || 15, reverse: false, gradient: false });
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
  renderPalette();
  try {
    await loadDevices();
    loadSpeakers();
    loadModels();
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
