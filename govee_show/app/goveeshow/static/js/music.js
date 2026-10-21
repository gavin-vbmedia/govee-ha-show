// Music tab: cut, shorten and splice songs, then save the result as a new file.
//
// An edit is a list of pieces of source songs played one after another, overlapping by a short
// crossfade at each join, plus a fade in and out. The source files are never changed: Save renders
// the pieces to a WAV and uploads it like any other song, ready to pick in the editor. Detect finds
// a song's beats and sections and keeps them with the file, for any show that uses it.

import { analyseInWorker, toMono } from "./analysis.js";
import { SECTION_ALPHA, fmtTime, sectionTint } from "./timeline.js";

const EPS = 1e-6;
const RULER_H = 22;
const BEAT_H = 16; // the beat lane above the waveform, as in the editor
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
    const buf = await (await fetch(urlOf(ref))).arrayBuffer();
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
      if (this.base === ref) { this.info = info; this.updateControls(); this.draw(); }
    } catch (e) {
      this.host.status(`Couldn't load the song: ${e.message}`, true);
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
      if (this.base === ref) this.info = info;
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
    for (const id of ["music-cut", "music-keep", "music-play-sel", "music-zoom-sel"]) $(id).disabled = !sel;
    $("music-undo").disabled = !this.history.length;
    $("music-detect").disabled = !this.base || this.dirty;
    const info = !this.dirty && this.info;
    $("music-analysis").textContent = !has ? ""
      : this.dirty ? "Save the edit to find its beats and sections"
        : info ? `${info.tempo ? `${info.tempo} BPM, ` : ""}${info.beats.length} beats, ${info.sections.length} sections${info.sections.length ? `: ${info.sections.map((x) => x.label).join(", ")}` : ""}`
          : "Not detected yet";
    $("music-redo").disabled = !this.future.length;
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
      await this.detect();
    } catch (e) {
      this.host.status(`Couldn't save: ${e.message}`, true);
    }
  }

  // view ----------------------------------------------------------------------
  layout() {
    const wrap = this.canvas.parentElement, dpr = window.devicePixelRatio || 1;
    this.w = wrap.clientWidth;
    this.h = 190;
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

    const waveT = RULER_H + BEAT_H, waveB = h; // the waveform sits under the beat lane
    const info = !this.dirty && this.info;
    const names = info ? [...new Set(info.sections.map((x) => x.label))] : [];

    // sections: tinted bands behind the waveform, one tint per name
    if (info) {
      ctx.strokeStyle = col("--line");
      for (const sec of info.sections) {
        const x0 = Math.max(0, this.x(sec.start)), x1 = Math.min(w, this.x(sec.end));
        if (x1 <= x0) continue;
        ctx.fillStyle = sectionTint(names, sec.label);
        ctx.globalAlpha = SECTION_ALPHA;
        ctx.fillRect(x0, waveT, x1 - x0, waveB - waveT);
        ctx.globalAlpha = 1;
        const xs = Math.round(this.x(sec.start)) + 0.5;
        ctx.beginPath(); ctx.moveTo(xs, waveT); ctx.lineTo(xs, waveB); ctx.stroke();
      }
    }

    // selection
    if (this.sel) {
      ctx.fillStyle = col("--region");
      ctx.globalAlpha = 0.25;
      const x0 = this.x(this.sel.start), x1 = this.x(this.sel.end);
      ctx.fillRect(x0, waveT, x1 - x0, waveB - waveT);
      ctx.globalAlpha = 1;
      ctx.fillRect(x0 - 1, waveT, 2, waveB - waveT);
      ctx.fillRect(x1 - 1, waveT, 2, waveB - waveT);
    }

    // waveform: the loudest sample under each pixel
    const mid = waveT + (waveB - waveT) / 2, amp = (waveB - waveT) / 2 - 4;
    ctx.fillStyle = col("--wave");
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

    // section names over the waveform
    if (info) {
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillStyle = col("--text");
      for (const sec of info.sections) {
        const x0 = Math.max(0, this.x(sec.start)), x1 = Math.min(w, this.x(sec.end));
        if (x1 - x0 > 40) ctx.fillText(sec.label, x0 + 4, waveT + 12);
      }
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

    // playhead
    ctx.fillStyle = col("--playhead");
    ctx.fillRect(Math.round(this.x(this.time)) - 1, 0, 2, h);
    $("music-clock").textContent = `${fmtTime(this.time)} / ${fmtTime(this.total)}`;
  }

  // input ---------------------------------------------------------------------
  down(e) {
    if (!this.rendered) return;
    const x = e.offsetX, t = Math.min(Math.max(this.t(x), 0), this.total);
    this.canvas.setPointerCapture(e.pointerId);
    if (this.sel && Math.abs(x - this.x(this.sel.start)) < EDGE_PX) this.drag = { edge: "start" };
    else if (this.sel && Math.abs(x - this.x(this.sel.end)) < EDGE_PX) this.drag = { edge: "end" };
    else this.drag = { anchor: t, x, moved: false };
  }

  move(e) {
    const x = e.offsetX, t = Math.min(Math.max(this.t(x), 0), this.total), d = this.drag;
    if (!d) {
      const near = this.sel && [this.sel.start, this.sel.end].some((s) => Math.abs(x - this.x(s)) < EDGE_PX);
      this.canvas.style.cursor = near ? "ew-resize" : "text";
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
