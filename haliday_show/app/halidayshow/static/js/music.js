// Music tab: cut, shorten and splice songs, then save the result as a new file.
//
// An edit is a list of pieces of source songs played one after another, overlapping by a short
// crossfade at each join, plus a fade in and out. The source files are never changed: Save renders
// the pieces to a WAV and uploads it like any other song, ready to pick in the editor. Detect finds
// a song's beats and sections and keeps them with the file, for any show that uses it.

import { analyseInWorker, toMono } from "./analysis.js";
import { SECTION_ALPHA, fmtTime, sectionHue, sectionTint } from "./timeline.js";
import { fetchSong, songLoadMessage } from "./songload.js";

const EPS = 1e-6;
const RULER_H = 22;
const BEAT_H = 16; // the beat lane above the waveform, as in the editor
const SEC_H = 20; // the section lane under it, where sections are picked and their edges dragged
const MIN_SECTION = 0.5;
const EDGE_PX = 6;
const BLOCK = 256; // samples per waveform peak

// edit model --------------------------------------------------------------------
// state: { pieces: [{ src, start, end }], crossfade } with times in seconds.

const len = (p) => p.end - p.start;

// The overlap at the join before piece i, never more than half of either piece.
function xfBefore(pieces, i, crossfade) {
  if (i === 0) return 0;
  return Math.max(0, Math.min(crossfade, len(pieces[i - 1]) / 2, len(pieces[i]) / 2));
}

// Where each piece starts in the result, its overlap with the one before, and the result's length.
export function arrange(pieces, crossfade = 0) {
  const out = [];
  let t = 0;
  pieces.forEach((p, i) => {
    const xf = xfBefore(pieces, i, crossfade);
    t -= xf;
    out.push({ at: t, xf });
    t += len(p);
  });
  return { places: out, total: Math.max(0, t) };
}

// Join times in the result (the middle of each crossfade).
export function joins(pieces, crossfade = 0) {
  const { places } = arrange(pieces, crossfade);
  return places.slice(1).map((pl) => pl.at + pl.xf / 2);
}

// Adjacent pieces that continue the same song without a gap become one again.
export function merge(pieces) {
  const out = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.src === p.src && Math.abs(last.end - p.start) < EPS) last.end = p.end;
    else if (len(p) > EPS) out.push({ ...p });
  }
  return out;
}

// The pieces that play between a and b in the result. Each piece owns the time up to the middle
// of its crossfades; a piece wholly inside the range keeps its full length, so pieces that aren't
// touched by an edit keep their joins exactly as they were.
export function slice(pieces, crossfade, a, b) {
  const { places, total } = arrange(pieces, crossfade);
  a = Math.max(0, a);
  b = Math.min(total, b);
  const out = [];
  pieces.forEach((p, i) => {
    const { at, xf } = places[i];
    const own0 = i === 0 ? 0 : at + xf / 2;
    const own1 = i === pieces.length - 1 ? total : places[i + 1].at + places[i + 1].xf / 2;
    const s = Math.max(a, own0), e = Math.min(b, own1);
    if (e - s <= EPS) return;
    out.push({
      src: p.src,
      start: s > own0 + EPS ? p.start + (s - at) : p.start,
      end: e < own1 - EPS ? p.start + (e - at) : p.end,
    });
  });
  return out;
}

export function cut(pieces, crossfade, a, b) {
  const { total } = arrange(pieces, crossfade);
  return merge([...slice(pieces, crossfade, 0, a), ...slice(pieces, crossfade, b, total)]);
}

export function keep(pieces, crossfade, a, b) {
  return merge(slice(pieces, crossfade, a, b));
}

export function insert(pieces, crossfade, t, added) {
  const { total } = arrange(pieces, crossfade);
  return merge([...slice(pieces, crossfade, 0, t), ...added, ...slice(pieces, crossfade, t, total)]);
}

// sections ----------------------------------------------------------------------
// [{start, end, label, energy, color?}], in order. Edits return a new list.

export function sectionAt(sections, t) {
  return sections.findIndex((s, i) => t >= s.start && (t < s.end || i === sections.length - 1));
}

// Splits section i at t into two with the same name and colour.
export function splitSection(sections, i, t) {
  const s = sections[i];
  if (!s || t - s.start < MIN_SECTION || s.end - t < MIN_SECTION) return null;
  return [...sections.slice(0, i), { ...s, end: t }, { ...s, start: t }, ...sections.slice(i + 1)];
}

// Joins section i and the next into one, keeping section i's name and colour.
export function mergeSections(sections, i) {
  if (i < 0 || i + 1 >= sections.length) return null;
  return [...sections.slice(0, i), { ...sections[i], end: sections[i + 1].end }, ...sections.slice(i + 2)];
}

// Removes section i; the one before (or after, for the first) takes over its time.
export function removeSection(sections, i) {
  if (sections.length < 2 || !sections[i]) return null;
  const out = sections.map((s) => ({ ...s }));
  if (i > 0) out[i - 1].end = out[i].end;
  else out[1].start = out[0].start;
  out.splice(i, 1);
  return out;
}

// Moves the edge between section i - 1 and section i to t, keeping both at least MIN_SECTION long.
export function moveEdge(sections, i, t) {
  const a = sections[i - 1], b = sections[i];
  if (!a || !b) return sections;
  const at = Math.min(Math.max(t, a.start + MIN_SECTION), b.end - MIN_SECTION);
  const out = sections.map((s) => ({ ...s }));
  out[i - 1].end = out[i].start = Math.round(at * 1000) / 1000;
  return out;
}

// #rrggbb for a hue at the editor's 70% saturation, 50% lightness, for the colour picker.
export function hueHex(h) {
  const f = (n) => {
    const k = (n + h / 30) % 12, a = 0.35; // saturation × min(lightness, 1 - lightness)
    return Math.round(255 * (0.5 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Where the base song's beats, bars and sections land in the edited result, so they follow cuts
// and splices. Only pieces of the base song (src) carry them; a section cut in two by an edit that
// joins up again becomes one.
export function mapInfo(info, pieces, crossfade, src) {
  const { places, total } = arrange(pieces, crossfade);
  const r3 = (t) => Math.round(t * 1000) / 1000;
  const beats = [], bars = [], parts = [];
  pieces.forEach((p, i) => {
    if (p.src !== src) return;
    const { at, xf } = places[i];
    const own0 = i === 0 ? 0 : at + xf / 2;
    const own1 = i === pieces.length - 1 ? total : places[i + 1].at + places[i + 1].xf / 2;
    const map = (t) => at + (t - p.start);
    const keep = (list, out) => {
      for (const t of list) if (t >= p.start && t <= p.end && map(t) >= own0 - EPS && map(t) < own1 - EPS) out.push(r3(map(t)));
    };
    keep(info.beats, beats);
    keep(info.bars, bars);
    for (const sec of info.sections) {
      const a = Math.max(map(sec.start), own0), b = Math.min(map(sec.end), own1);
      if (b - a > 1e-3) parts.push({ ...sec, start: r3(a), end: r3(b) });
    }
  });
  const sections = [];
  for (const sec of parts) {
    const last = sections[sections.length - 1];
    if (last && last.label === sec.label && last.color === sec.color && last.notes === sec.notes
        && Math.abs(last.end - sec.start) < 2e-3) last.end = sec.end;
    else sections.push(sec);
  }
  return { ...info, beats, bars, sections };
}

// rendering ---------------------------------------------------------------------
// sources: { [src]: Float32Array[] } (one array per channel), all at `rate`.
export function render(pieces, sources, rate, { crossfade = 0, fadeIn = 0, fadeOut = 0 } = {}) {
  const { places, total } = arrange(pieces, crossfade);
  const channels = Math.max(1, ...pieces.map((p) => sources[p.src]?.length || 1));
  const n = Math.round(total * rate);
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  pieces.forEach((p, i) => {
    const src = sources[p.src];
    if (!src) return;
    const from = Math.round(p.start * rate);
    const at = Math.round(places[i].at * rate);
    const count = Math.min(Math.round(len(p) * rate), n - at);
    const xin = Math.round(places[i].xf * rate);
    const xout = i + 1 < pieces.length ? Math.round(places[i + 1].xf * rate) : 0;
    for (let c = 0; c < channels; c++) {
      const s = src[Math.min(c, src.length - 1)], o = out[c];
      for (let k = 0; k < count; k++) {
        // Equal-power curves keep the loudness steady through a crossfade.
        let g = 1;
        if (k < xin) g *= Math.sin(((k + 0.5) / xin) * Math.PI / 2);
        if (k >= count - xout) g *= Math.cos(((k - (count - xout) + 0.5) / xout) * Math.PI / 2);
        o[at + k] += (s[from + k] || 0) * g;
      }
    }
  });
  const fi = Math.min(Math.round(fadeIn * rate), n), fo = Math.min(Math.round(fadeOut * rate), n);
  for (const o of out) {
    for (let k = 0; k < fi; k++) o[k] *= k / fi;
    for (let k = 0; k < fo; k++) o[n - 1 - k] *= k / fo;
  }
  return out;
}

// 16-bit PCM WAV, which every Home Assistant speaker and browser plays.
export function encodeWav(channels, rate) {
  const n = channels[0]?.length || 0, ch = channels.length, bytes = n * ch * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + bytes, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++, o += 2) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return buf;
}

// The name for an edited copy: "song.mp3" -> "song (edit).wav", "song (edit).wav" -> "song (edit 2).wav".
export function editName(path, taken = []) {
  const base = (path.split("/").pop() || "song").replace(/\.[^.]+$/, "").replace(/ \(edit(?: \d+)?\)$/, "");
  const used = new Set(taken.map((p) => p.split("/").pop().toLowerCase()));
  for (let i = 1; ; i++) {
    const name = `${base} (edit${i > 1 ? ` ${i}` : ""}).wav`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

// editor ------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const keyOf = (ref) => `${ref.source}:${ref.path}`;
const nameOf = (ref) => ref.path.split("/").pop();
const query = (ref) => `source=${encodeURIComponent(ref.source)}&path=${encodeURIComponent(ref.path)}`;
const urlOf = (ref) => `api/audio/file?${query(ref)}`;
const infoUrl = (ref) => `api/audio/info?${query(ref)}`;

export class MusicEditor {
  // host provides: api(path, opts), status(msg, error), songs() -> [ref], songsChanged() -> Promise.
  constructor(host) {
    this.host = host;
    this.canvas = $("music-wave");
    this.ctx = this.canvas.getContext("2d");
    this.refs = {}; // src key -> ref
    this.sources = {}; // src key -> Float32Array[]
    this.pieces = [];
    this.history = [];
    this.future = [];
    this.time = 0;
    this.sel = null; // { start, end }
    this.view = { start: 0, span: 0 };
    this.playing = null;
    this.dirty = false;
    this.info = null; // the base song's saved beats and sections
    this.secSel = -1; // the section picked for editing
    this.wire();
    new ResizeObserver(() => this.layout()).observe(this.canvas.parentElement);
  }

  get active() { return !$("view-music").hidden; }
  get crossfade() { return Math.max(0, Number($("music-xf").value) || 0); }
  get total() { return arrange(this.pieces, this.crossfade).total; }

  // songs ---------------------------------------------------------------------
  fillSongLists() {
    const songs = this.host.songs();
    for (const id of ["music-src", "music-insert-src"]) {
      const sel = $(id), cur = sel.value;
      sel.replaceChildren(new Option(id === "music-src" ? "Choose a song…" : "Another song…", ""));
      for (const r of songs) sel.append(new Option(r.path, JSON.stringify(r)));
      sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "";
    }
  }

  async source(ref) {
    const key = keyOf(ref);
    if (this.sources[key]) return key;
    this.host.status(`Loading ${nameOf(ref)}…`);
    const buf = await fetchSong(urlOf(ref));
    this.audio ||= new AudioContext();
    const decoded = await this.audio.decodeAudioData(buf);
    this.sources[key] = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
    this.refs[key] = ref;
    this.host.status("");
    return key;
  }

  async open(ref) {
    if (this.dirty && !confirm("Start again with this song? Your unsaved edits will be lost.")) {
      this.fillSongLists();
      return;
    }
    this.stop();
    try {
      const key = await this.source(ref);
      this.pieces = [{ src: key, start: 0, end: this.sources[key][0].length / this.audio.sampleRate }];
      this.base = ref;
      this.info = null;
      this.history = [];
      this.future = [];
      this.dirty = false;
      this.time = 0;
      this.sel = null;
      $("music-src").value = JSON.stringify(ref);
      $("music-name").value = editName(ref.path, this.host.songs().map((r) => r.path));
      this.changed(true);
      const info = await this.host.api(infoUrl(ref)).catch(() => null);
      if (this.base === ref) { this.info = info; this.secSel = -1; this.updateControls(); this.draw(); }
    } catch (e) {
      this.host.status(songLoadMessage(e), true);
    }
  }

  // Finds the beats, bars and sections of the base song and saves them with the file.
  async detect() {
    if (!this.base) return;
    if (this.dirty) return this.host.status("Save the edit as a new file first; it's detected when saved", true);
    const ref = this.base, channels = this.sources[keyOf(ref)];
    const { samples, rate } = toMono(channels, this.audio.sampleRate);
    this.host.status(`Listening to ${nameOf(ref)}…`);
    $("music-detect").disabled = true;
    try {
      const r = await analyseInWorker(samples, rate);
      const info = { tempo: r.tempo || null, beats: r.beats, bars: r.bars, sections: r.sections };
      await this.host.api(infoUrl(ref), { method: "PUT", json: info });
      if (this.base === ref) { this.info = info; this.secSel = -1; }
      const parts = `${info.sections.length} section${info.sections.length === 1 ? "" : "s"}`;
      this.host.status(info.tempo ? `Found ${info.beats.length} beats at ${info.tempo} BPM, and ${parts}` : `No steady beat found; found ${parts}`);
    } catch (e) {
      this.host.status(`Couldn't analyse the song: ${e.message}`, true);
    }
    this.updateControls();
    this.draw();
  }

  async upload(file) {
    const form = new FormData();
    form.append("file", file);
    this.host.status(`Uploading ${file.name}…`);
    try {
      const ref = await this.host.api("api/audio", { method: "POST", body: form });
      await this.host.songsChanged();
      this.fillSongLists();
      return ref;
    } catch (e) {
      this.host.status(`Upload failed: ${e.message}`, true);
      return null;
    }
  }

  // editing -------------------------------------------------------------------
  edit(pieces, fit = false) {
    this.stop();
    this.history.push(this.pieces);
    this.future = [];
    this.pieces = pieces;
    this.dirty = true;
    this.changed(fit);
  }

  undo(dir = -1) {
    const [from, to] = dir < 0 ? [this.history, this.future] : [this.future, this.history];
    if (!from.length) return;
    this.stop();
    to.push(this.pieces);
    this.pieces = from.pop();
    this.dirty = true;
    this.changed();
  }

  cutSelection() {
    if (!this.sel) return this.host.status("Drag across the waveform to select the part to cut", true);
    const { start, end } = this.sel;
    this.sel = null;
    this.time = start;
    this.edit(cut(this.pieces, this.crossfade, start, end));
  }

  keepSelection() {
    if (!this.sel) return this.host.status("Drag across the waveform to select the part to keep", true);
    const { start, end } = this.sel;
    this.sel = null;
    this.time = 0;
    this.edit(keep(this.pieces, this.crossfade, start, end), true);
  }

  async addSong(atEnd) {
    const v = $("music-insert-src").value;
    if (!v) return this.host.status("Choose the song to add first", true);
    try {
      const key = await this.source(JSON.parse(v));
      const piece = { src: key, start: 0, end: this.sources[key][0].length / this.audio.sampleRate };
      const at = atEnd ? this.total : this.time;
      const xf = this.crossfade;
      this.sel = null;
      this.edit(insert(this.pieces, xf, at, [piece]), true);
      // Select what was added so it can be trimmed straight away.
      const i = this.pieces.findIndex((p) => p.src === key && p.start === 0 && p.end === piece.end);
      const { places } = arrange(this.pieces, xf);
      if (i >= 0) this.sel = { start: places[i].at, end: places[i].at + piece.end };
      this.changed();
    } catch (e) {
      this.host.status(`Couldn't add the song: ${e.message}`, true);
    }
  }

  // section editing -----------------------------------------------------------
  get sections() { return (!this.dirty && this.info?.sections) || null; }

  // The base song's beats, bars and sections where they fall in the result, following any edits.
  get shown() {
    if (!this.info || !this.base) return null;
    if (!this.dirty) return this.info;
    return mapInfo(this.info, this.pieces, this.crossfade, keyOf(this.base));
  }

  // t pulled to the nearest bar or section edge within reach, else the nearest beat; Shift places freely.
  snap(t, e) {
    const info = this.shown;
    if (!info || e?.shiftKey) return t;
    const near = (list, px) => {
      let best = null;
      for (const c of list) if (Math.abs(this.x(c) - this.x(t)) <= px && (best === null || Math.abs(c - t) < Math.abs(best - t))) best = c;
      return best;
    };
    const edges = [0, this.total, ...info.bars, ...info.sections.flatMap((x) => [x.start, x.end])];
    return near(edges, 16) ?? near(info.beats, 6) ?? t;
  }

  // Plays a few seconds either side of where the selection would be cut, without cutting it.
  previewCut() {
    if (!this.sel) return;
    const { start, end } = this.sel, xf = this.crossfade;
    const joined = cut(this.pieces, xf, start, end);
    const around = slice(joined, xf, Math.max(0, start - 3), start + 3);
    if (!around.length) return;
    this.stop();
    const rate = this.audio.sampleRate;
    const channels = render(around, this.sources, rate, { crossfade: xf });
    const buf = this.audio.createBuffer(channels.length, channels[0].length || 1, rate);
    channels.forEach((ch, c) => buf.copyToChannel(ch, c));
    const node = this.audio.createBufferSource();
    node.buffer = buf;
    node.connect(this.audio.destination);
    this.audio.resume();
    node.start();
    this.playing = { node, from: this.time, at: this.audio.currentTime, preview: true };
    node.onended = () => { if (this.playing?.node === node) this.stop(); };
    $("music-play").textContent = "⏸ Stop";
  }

  // Applies a change to the base song's sections and saves it with the song shortly after.
  editSections(sections, select = this.secSel) {
    if (!sections) return;
    this.info = { ...this.info, sections };
    this.secSel = select;
    clearTimeout(this.saveTimer);
    const ref = this.base, info = this.info;
    this.saveTimer = setTimeout(() => {
      this.host.api(infoUrl(ref), { method: "PUT", json: info })
        .catch((e) => this.host.status(`Couldn't save the sections: ${e.message}`, true));
    }, 400);
    this.updateControls();
    this.draw();
  }

  renderSection() {
    const secs = this.sections, s = secs?.[this.secSel];
    $("music-section").hidden = !s;
    if (!s) return;
    const names = [...new Set(secs.map((x) => x.label))];
    $("music-sec-name").value = s.label;
    $("music-sec-notes").value = s.notes || "";
    $("music-sec-colour").value = s.color || hueHex(sectionHue(names, s.label));
    $("music-sec-time").textContent = `${fmtTime(s.start)} to ${fmtTime(s.end)}`;
    $("music-sec-merge").disabled = this.secSel + 1 >= secs.length;
    $("music-sec-delete").disabled = secs.length < 2;
    $("music-sec-colour-hint").textContent = secs.filter((x) => x.label === s.label).length > 1
      ? `Colour changes every "${s.label}"` : "";
  }

  wireSections() {
    $("music-sec-name").addEventListener("change", (e) => {
      const name = e.target.value.trim().slice(0, 40);
      if (!name) { this.renderSection(); return; }
      this.editSections(this.sections.map((x, i) => (i === this.secSel ? { ...x, label: name } : x)));
    });
    $("music-sec-notes").addEventListener("change", (e) => {
      const notes = e.target.value.trim().slice(0, 300);
      this.editSections(this.sections.map((x, i) => {
        if (i !== this.secSel) return x;
        const { notes: _, ...rest } = x;
        return notes ? { ...rest, notes } : rest;
      }));
    });
    $("music-sec-colour").addEventListener("input", (e) => {
      const label = this.sections[this.secSel].label, color = e.target.value;
      this.editSections(this.sections.map((x) => (x.label === label ? { ...x, color } : x)));
    });
    $("music-sec-split").addEventListener("click", () => {
      const secs = this.sections, i = sectionAt(secs, this.time);
      const out = splitSection(secs, i, this.time);
      if (!out) return this.host.status("Move the playhead inside a section, at least half a second from its edges", true);
      this.editSections(out, i + 1);
    });
    $("music-sec-merge").addEventListener("click", () => this.editSections(mergeSections(this.sections, this.secSel)));
    $("music-sec-delete").addEventListener("click", () => {
      const i = this.secSel;
      this.editSections(removeSection(this.sections, i), Math.max(0, i - 1));
    });
    $("music-sec-close").addEventListener("click", () => { this.secSel = -1; this.updateControls(); this.draw(); });
  }

  // Re-render after any change; `fit` also zooms out to the whole result.
  changed(fit = false) {
    const rate = this.audio?.sampleRate || 44100;
    this.rendered = this.pieces.length
      ? render(this.pieces, this.sources, rate, {
        crossfade: this.crossfade,
        fadeIn: Number($("music-fadein").value) || 0,
        fadeOut: Number($("music-fadeout").value) || 0,
      })
      : null;
    this.peaks = this.rendered ? peaks(this.rendered) : null;
    const total = this.total;
    this.time = Math.min(this.time, total);
    if (this.sel) this.sel = { start: Math.min(this.sel.start, total), end: Math.min(this.sel.end, total) };
    if (fit || !this.view.span || this.view.start + this.view.span > total + 1) this.fit();
    this.updateControls();
    this.draw();
  }

  updateControls() {
    const has = this.pieces.length > 0, sel = this.sel;
    for (const id of ["music-play", "music-insert", "music-append", "music-save", "music-zoom-in", "music-zoom-out", "music-fit"]) $(id).disabled = !has;
    for (const id of ["music-cut", "music-keep", "music-play-sel", "music-zoom-sel", "music-preview"]) $(id).disabled = !sel;
    $("music-undo").disabled = !this.history.length;
    $("music-detect").disabled = !this.base || this.dirty;
    const info = this.shown;
    $("music-analysis").textContent = !has ? ""
      : this.dirty && !info ? "Save the edit to find its beats and sections"
        : info ? `${info.tempo ? `${info.tempo} BPM, ` : ""}${info.beats.length} beats, ${info.sections.length} sections${info.sections.length ? `: ${info.sections.map((x) => x.label).join(", ")}` : ""}`
          : "Not detected yet";
    if (this.dirty && info) $("music-analysis").textContent += " (following your edits)";
    $("music-redo").disabled = !this.future.length;
    if (!this.sections || this.secSel >= this.sections.length) this.secSel = -1;
    this.renderSection();
    $("music-sel-start").disabled = $("music-sel-end").disabled = !sel;
    $("music-sel-start").value = sel ? sel.start.toFixed(2) : "";
    $("music-sel-end").value = sel ? sel.end.toFixed(2) : "";
    $("music-sel-len").textContent = sel ? `${(sel.end - sel.start).toFixed(2)} s selected` : "";
    const n = this.pieces.length;
    $("music-info").textContent = has
      ? `${fmtTime(this.total)} long${this.base ? `, from ${nameOf(this.base)}` : ""}${n > 1 ? `, ${n} pieces` : ""}`
      : "";
  }

  // playback ------------------------------------------------------------------
  play(from = this.time, to = this.total) {
    if (!this.rendered) return;
    this.stop();
    const rate = this.audio.sampleRate;
    const buf = this.audio.createBuffer(this.rendered.length, this.rendered[0].length || 1, rate);
    this.rendered.forEach((ch, c) => buf.copyToChannel(ch, c));
    const node = this.audio.createBufferSource();
    node.buffer = buf;
    node.connect(this.audio.destination);
    if (from >= to - 0.01) from = 0;
    node.start(0, from, to - from);
    this.audio.resume();
    this.playing = { node, from, at: this.audio.currentTime };
    node.onended = () => { if (this.playing?.node === node) this.stop(); };
    $("music-play").textContent = "⏸ Stop";
    const tick = () => {
      if (this.playing?.node !== node) return;
      this.time = Math.min(this.playing.from + this.audio.currentTime - this.playing.at, this.total);
      this.follow();
      this.draw();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() {
    if (!this.playing) return;
    const { node } = this.playing;
    this.playing = null;
    try { node.stop(); } catch { /* already ended */ }
    $("music-play").textContent = "▶ Play";
    this.draw();
  }

  // saving --------------------------------------------------------------------
  async save() {
    if (!this.rendered) return;
    let name = $("music-name").value.trim();
    if (!name) return this.host.status("Give the new file a name", true);
    if (!/\.wav$/i.test(name)) name = `${name.replace(/\.[a-z0-9]+$/i, "")}.wav`;
    const existing = this.host.songs().some((r) => r.path.split("/").pop().toLowerCase() === name.toLowerCase());
    if (existing && !confirm(`${name} already exists. Replace it?`)) return;
    this.stop();
    this.host.status(`Saving ${name}…`);
    const blob = new Blob([encodeWav(this.rendered, this.audio.sampleRate)], { type: "audio/wav" });
    const form = new FormData();
    form.append("file", blob, name);
    // Beats and sections that followed the edit carry over, with their names, colours and notes, as
    // long as the result is all from the base song; anything spliced in is detected afresh.
    const baseKey = this.base && keyOf(this.base);
    const carry = this.shown && this.pieces.every((p) => p.src === baseKey) ? this.shown : null;
    try {
      const ref = await this.host.api("api/audio", { method: "POST", body: form });
      // Carry on from the saved file, so Detect and further edits work on it.
      const key = keyOf(ref);
      this.sources[key] = this.rendered;
      this.refs[key] = ref;
      this.pieces = [{ src: key, start: 0, end: this.rendered[0].length / this.audio.sampleRate }];
      this.base = ref;
      this.info = null;
      this.dirty = false;
      $("music-fadein").value = $("music-fadeout").value = 0;
      this.changed();
      await this.host.songsChanged();
      this.fillSongLists();
      $("music-src").value = JSON.stringify(ref);
      $("music-name").value = editName(ref.path, this.host.songs().map((r) => r.path));
      this.host.status(`Saved ${ref.path}. Pick it under Song in the editor.`);
      if (carry) {
        await this.host.api(infoUrl(ref), { method: "PUT", json: carry });
        this.info = carry;
        this.updateControls();
        this.draw();
      } else {
        await this.detect();
      }
    } catch (e) {
      this.host.status(`Couldn't save: ${e.message}`, true);
    }
  }

  // view ----------------------------------------------------------------------
  layout() {
    const wrap = this.canvas.parentElement, dpr = window.devicePixelRatio || 1;
    this.w = wrap.clientWidth;
    this.h = 210;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  fit() { this.view = { start: 0, span: Math.max(this.total, 1) }; this.draw(); }

  zoom(factor, anchorT = this.time) {
    const total = Math.max(this.total, 1);
    const span = Math.min(Math.max(this.view.span * factor, 0.05), total);
    const f = (anchorT - this.view.start) / this.view.span;
    this.view = { start: Math.min(Math.max(anchorT - f * span, 0), total - span), span };
    this.draw();
  }

  zoomTo(a, b) {
    const pad = (b - a) * 0.05;
    const total = Math.max(this.total, 1);
    const span = Math.min(Math.max(b - a + 2 * pad, 0.05), total);
    this.view = { start: Math.min(Math.max(a - pad, 0), total - span), span };
    this.draw();
  }

  follow() {
    const { start, span } = this.view;
    if (this.time > start + span || this.time < start) {
      this.view.start = Math.min(Math.max(this.time - span * 0.1, 0), Math.max(this.total - span, 0));
    }
  }

  x(t) { return ((t - this.view.start) / this.view.span) * this.w; }
  t(x) { return this.view.start + (x / this.w) * this.view.span; }

  draw() {
    if (!this.w) return;
    const { ctx, w, h } = this;
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = col("--track");
    ctx.fillRect(0, RULER_H, w, h - RULER_H);
    if (!this.rendered) {
      ctx.fillStyle = col("--muted");
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Choose a song or upload one to start", 12, RULER_H + 30);
      return;
    }
    const rate = this.audio.sampleRate;

    const laneT = RULER_H + BEAT_H, waveT = laneT + SEC_H, waveB = h; // beats, sections, then the waveform
    const info = this.shown;
    const names = info ? [...new Set(info.sections.map((x) => x.label))] : [];

    // sections: tinted bands behind the waveform, one tint per name
    if (info) {
      ctx.strokeStyle = col("--line");
      for (const sec of info.sections) {
        const x0 = Math.max(0, this.x(sec.start)), x1 = Math.min(w, this.x(sec.end));
        if (x1 <= x0) continue;
        ctx.fillStyle = sectionTint(names, sec.label, sec.color);
        ctx.globalAlpha = SECTION_ALPHA;
        ctx.fillRect(x0, waveT, x1 - x0, waveB - waveT);
        ctx.globalAlpha = 1;
        const xs = Math.round(this.x(sec.start)) + 0.5;
        ctx.beginPath(); ctx.moveTo(xs, waveT); ctx.lineTo(xs, waveB); ctx.stroke();
      }
    }

    // waveform: the loudest sample under each pixel, in the selection colour where selected
    const mid = waveT + (waveB - waveT) / 2, amp = (waveB - waveT) / 2 - 4;
    const sx0 = this.sel ? this.x(this.sel.start) : Infinity, sx1 = this.sel ? this.x(this.sel.end) : -Infinity;
    const wave = col("--wave"), region = col("--region");
    const spp = (this.view.span * rate) / w; // samples per pixel
    for (let px = 0; px < w; px++) {
      const s0 = Math.floor((this.view.start * rate) + px * spp), s1 = Math.max(s0 + 1, Math.floor(s0 + spp));
      let m = 0;
      if (spp >= BLOCK) {
        for (let b = Math.floor(s0 / BLOCK), e = Math.ceil(s1 / BLOCK); b < e && b < this.peaks.length; b++) m = Math.max(m, this.peaks[b]);
      } else {
        for (const ch of this.rendered) for (let s = s0; s < s1 && s < ch.length; s++) m = Math.max(m, Math.abs(ch[s]));
      }
      const hgt = Math.max(1, m * amp);
      ctx.fillStyle = px >= sx0 && px < sx1 ? region : wave;
      ctx.fillRect(px, mid - hgt, 1, hgt * 2);
    }

    // joins between pieces
    ctx.strokeStyle = col("--beat");
    ctx.setLineDash([4, 3]);
    for (const j of joins(this.pieces, this.crossfade)) {
      const x = Math.round(this.x(j)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, waveT); ctx.lineTo(x, waveB); ctx.stroke();
    }
    ctx.setLineDash([]);

    // section lane: each section in its colour with its name, the picked one outlined
    ctx.fillStyle = col("--panel");
    ctx.fillRect(0, laneT, w, SEC_H);
    if (info) {
      ctx.font = "11px system-ui, sans-serif";
      info.sections.forEach((sec, i) => {
        const x0 = Math.max(0, this.x(sec.start)), x1 = Math.min(w, this.x(sec.end));
        if (x1 <= x0) return;
        ctx.fillStyle = sectionTint(names, sec.label, sec.color);
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x0, laneT + 1, x1 - x0, SEC_H - 2);
        ctx.globalAlpha = 1;
        if (i === this.secSel) {
          ctx.strokeStyle = col("--accent");
          ctx.lineWidth = 2;
          ctx.strokeRect(x0 + 1, laneT + 1, x1 - x0 - 2, SEC_H - 2);
          ctx.lineWidth = 1;
        }
        ctx.fillStyle = col("--line");
        ctx.fillRect(Math.round(this.x(sec.start)), laneT, 1, SEC_H);
        ctx.fillStyle = col("--text");
        if (x1 - x0 > 30) {
          ctx.save();
          ctx.beginPath(); ctx.rect(x0, laneT, x1 - x0 - 2, SEC_H); ctx.clip();
          ctx.fillText(sec.label, x0 + 5, laneT + 14);
          ctx.restore();
        }
      });
    }

    // beat lane above the waveform, each beat's line running down through it, bar starts stronger
    ctx.fillStyle = col("--panel");
    ctx.fillRect(0, RULER_H, w, BEAT_H);
    if (info) {
      const bars = new Set(info.bars.map((b) => Math.round(b * 1000)));
      ctx.strokeStyle = ctx.fillStyle = col("--beat");
      for (const b of info.beats) {
        const x = this.x(b);
        if (x < -4 || x > w + 4) continue;
        ctx.globalAlpha = bars.has(Math.round(b * 1000)) ? 0.7 : 0.35;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, waveT); ctx.lineTo(Math.round(x) + 0.5, waveB); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(x - 4, RULER_H + 3); ctx.lineTo(x + 4, RULER_H + 3); ctx.lineTo(x, RULER_H + BEAT_H - 3); ctx.fill();
      }
    }

    // ruler
    ctx.fillStyle = col("--panel");
    ctx.fillRect(0, 0, w, RULER_H);
    ctx.fillStyle = col("--muted");
    ctx.strokeStyle = col("--line");
    ctx.font = "11px system-ui, sans-serif";
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => (s / this.view.span) * w >= 70) || 300;
    for (let t = Math.ceil(this.view.start / step) * step; t <= this.view.start + this.view.span; t += step) {
      const x = Math.round(this.x(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, RULER_H - 5); ctx.lineTo(x, RULER_H); ctx.stroke();
      ctx.fillText(fmtTime(t, step < 1), x + 3, 14);
    }

    // selection on top of everything: dim what's outside it, band the ruler, solid edges with grips
    if (this.sel) {
      ctx.fillStyle = "#000";
      ctx.globalAlpha = 0.4;
      if (sx0 > 0) ctx.fillRect(0, RULER_H, Math.min(sx0, w), h - RULER_H);
      if (sx1 < w) ctx.fillRect(Math.max(sx1, 0), RULER_H, w - Math.max(sx1, 0), h - RULER_H);
      ctx.fillStyle = region;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(sx0, 0, sx1 - sx0, RULER_H);
      ctx.globalAlpha = 1;
      for (const x of [sx0, sx1]) {
        ctx.fillRect(Math.round(x) - 1, 0, 2, h);
        ctx.fillRect(Math.round(x) - 4, 0, 8, 10);
      }
    }

    // playhead
    ctx.fillStyle = col("--playhead");
    ctx.fillRect(Math.round(this.x(this.time)) - 1, 0, 2, h);
    $("music-clock").textContent = `${fmtTime(this.time)} / ${fmtTime(this.total)}`;
  }

  // input ---------------------------------------------------------------------
  inLane(y) { return y >= RULER_H + BEAT_H && y < RULER_H + BEAT_H + SEC_H; }

  // The section edge (index of the section it starts) within reach of x, or -1.
  edgeNear(x) {
    const secs = this.sections || [];
    return secs.findIndex((s, i) => i > 0 && Math.abs(x - this.x(s.start)) < EDGE_PX);
  }

  down(e) {
    if (!this.rendered) return;
    const x = e.offsetX, t = Math.min(Math.max(this.t(x), 0), this.total);
    this.canvas.setPointerCapture(e.pointerId);
    if (this.inLane(e.offsetY) && this.shown) {
      const edge = this.sections ? this.edgeNear(x) : -1;
      if (edge > 0) { this.drag = { section: edge, before: this.sections }; return; }
      // A click selects the section's stretch of song, ready to cut; Shift-click extends it.
      const secs = this.shown.sections, i = sectionAt(secs, t);
      this.drag = null;
      if (i < 0) return;
      const sec = secs[i];
      this.sel = e.shiftKey && this.sel
        ? { start: Math.min(this.sel.start, sec.start), end: Math.max(this.sel.end, sec.end) }
        : { start: sec.start, end: sec.end };
      this.secSel = this.sections ? i : -1;
      this.updateControls();
      this.draw();
      return;
    }
    if (this.sel && Math.abs(x - this.x(this.sel.start)) < EDGE_PX) this.drag = { edge: "start" };
    else if (this.sel && Math.abs(x - this.x(this.sel.end)) < EDGE_PX) this.drag = { edge: "end" };
    else this.drag = { anchor: this.snap(t, e), x, moved: false };
  }

  move(e) {
    const x = e.offsetX, raw = Math.min(Math.max(this.t(x), 0), this.total), d = this.drag;
    const t = d && !d.section ? this.snap(raw, e) : raw;
    if (!d) {
      const lane = this.inLane(e.offsetY) && this.shown;
      const near = lane ? this.sections && this.edgeNear(x) > 0
        : this.sel && [this.sel.start, this.sel.end].some((s) => Math.abs(x - this.x(s)) < EDGE_PX);
      this.canvas.style.cursor = near ? "ew-resize" : lane ? "pointer" : "text";
      return;
    }
    if (d.section) {
      this.info = { ...this.info, sections: moveEdge(d.before, d.section, t) };
      this.renderSection();
      this.draw();
      return;
    }
    if (d.edge) {
      const other = d.edge === "start" ? this.sel.end : this.sel.start;
      this.sel = { start: Math.min(t, other), end: Math.max(t, other) };
      d.edge = t < other ? "start" : "end";
    } else {
      if (!d.moved && Math.abs(x - d.x) < 3) return;
      d.moved = true;
      this.sel = { start: Math.min(t, d.anchor), end: Math.max(t, d.anchor) };
    }
    this.updateControls();
    this.draw();
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    if (d?.section) { this.editSections(this.info.sections); return; }
    if (!d || d.edge || d.moved) return;
    this.sel = null;
    this.time = Math.min(Math.max(this.t(e.offsetX), 0), this.total);
    if (this.playing) this.play(this.time);
    this.updateControls();
    this.draw();
  }

  wheel(e) {
    if (!this.rendered) return;
    e.preventDefault();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = ((e.shiftKey ? e.deltaY : e.deltaX) / this.w) * this.view.span;
      this.view.start = Math.min(Math.max(this.view.start + d, 0), Math.max(this.total - this.view.span, 0));
      this.draw();
    } else {
      this.zoom(e.deltaY > 0 ? 1.25 : 0.8, this.t(e.offsetX));
    }
  }

  setSelEdge(which, value) {
    if (!this.sel) return;
    const v = Math.min(Math.max(Number(value) || 0, 0), this.total);
    const s = { ...this.sel, [which]: v };
    this.sel = { start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) };
    this.updateControls();
    this.draw();
  }

  key(e) {
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); this.save(); return true; }
    if (typing || document.querySelector("dialog[open]")) return false;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); this.undo(e.shiftKey ? 1 : -1); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); this.undo(1); }
    else if (e.key === " ") { e.preventDefault(); this.playing ? this.stop() : this.play(); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.cutSelection(); }
    else if (e.key === "Home") { this.time = 0; this.follow(); this.draw(); }
    else if (e.key === "+" || e.key === "=") this.zoom(0.66);
    else if (e.key === "-") this.zoom(1.5);
    else if (e.key === "Escape") { this.sel = null; this.updateControls(); this.draw(); }
    else return false;
    return true;
  }

  wire() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.down(e));
    c.addEventListener("pointermove", (e) => this.move(e));
    c.addEventListener("pointerup", (e) => this.up(e));
    c.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    $("music-src").addEventListener("change", (e) => { if (e.target.value) this.open(JSON.parse(e.target.value)); });
    $("music-upload").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      const ref = f && await this.upload(f);
      if (ref) this.open(ref);
    });
    $("music-insert-upload").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      const ref = f && await this.upload(f);
      if (ref) $("music-insert-src").value = JSON.stringify(ref);
    });
    $("music-play").addEventListener("click", () => (this.playing ? this.stop() : this.play()));
    $("music-play-sel").addEventListener("click", () => this.sel && this.play(this.sel.start, this.sel.end));
    $("music-preview").addEventListener("click", () => this.previewCut());
    $("music-cut").addEventListener("click", () => this.cutSelection());
    $("music-keep").addEventListener("click", () => this.keepSelection());
    $("music-insert").addEventListener("click", () => this.addSong(false));
    $("music-append").addEventListener("click", () => this.addSong(true));
    $("music-undo").addEventListener("click", () => this.undo(-1));
    $("music-redo").addEventListener("click", () => this.undo(1));
    $("music-zoom-in").addEventListener("click", () => this.zoom(0.66));
    $("music-zoom-out").addEventListener("click", () => this.zoom(1.5));
    $("music-fit").addEventListener("click", () => this.fit());
    $("music-zoom-sel").addEventListener("click", () => this.sel && this.zoomTo(this.sel.start, this.sel.end));
    $("music-sel-start").addEventListener("change", (e) => this.setSelEdge("start", e.target.value));
    $("music-sel-end").addEventListener("change", (e) => this.setSelEdge("end", e.target.value));
    for (const id of ["music-xf", "music-fadein", "music-fadeout"]) {
      $(id).addEventListener("change", () => { this.stop(); if (this.pieces.length) this.dirty = true; this.changed(); });
    }
    $("music-save").addEventListener("click", () => this.save());
    $("music-detect").addEventListener("click", () => this.detect());
    this.wireSections();
    window.addEventListener("beforeunload", (e) => { if (this.dirty) e.preventDefault(); });
  }

  show() {
    this.fillSongLists();
    this.layout();
  }

  hide() { this.stop(); }
}

// Loudest sample in each block of BLOCK samples, across channels.
function peaks(channels) {
  const n = Math.ceil((channels[0]?.length || 0) / BLOCK);
  const out = new Float32Array(n);
  for (const ch of channels) {
    for (let b = 0; b < n; b++) {
      let m = out[b];
      for (let s = b * BLOCK, e = Math.min(s + BLOCK, ch.length); s < e; s++) {
        const v = Math.abs(ch[s]);
        if (v > m) m = v;
      }
      out[b] = m;
    }
  }
  return out;
}
