// Canvas timeline: ruler, waveform, beat lane and one track per device.
//
// The canvas stays the size of the viewport (sticky inside a wide scroll area),
// so long songs at high zoom never hit browser canvas size limits.

import { EFFECTS, HOUSE, renderTrack } from "./effects.js";
import { asShown } from "./lightspeed.js";

const HEADER_W = 150;
const RULER_H = 22;
const WAVE_H = 56;
const BEAT_H = 16;
const TRACK_H = 46;
const TOP = RULER_H + WAVE_H + BEAT_H;
const EDGE_PX = 6;
const SNAP_PX = 8;
const MIN_LEN = 0.05;
const WARN = "#d97706";

// One tint per section name unless a colour was picked on the Music tab, shared with that tab so
// a song looks the same in both.
export const SECTION_ALPHA = 0.16;
export const sectionHue = (names, label) => (names.indexOf(label) * 137) % 360;
export const sectionTint = (names, label, color) => color || `hsl(${sectionHue(names, label)} 70% 50%)`;

export class Timeline {
  // app provides: show, devices (by id), pps, time, selected, paletteEffect, snap,
  // peaks, duration(), and callbacks seek(t), select(sel), changed({live}), clipFit(clip, track) (whether
  // a clip suits its light, or null while that's worked out) and trackNote(device) (a short warning or null).
  constructor(app) {
    this.app = app;
    this.scroll = document.getElementById("timeline-scroll");
    this.inner = document.getElementById("timeline-inner");
    this.canvas = document.getElementById("timeline");
    this.overlay = document.getElementById("timeline-overlay");
    this.ctx = this.canvas.getContext("2d");
    this.octx = this.overlay.getContext("2d");
    this.drag = null;
    this.scroll.addEventListener("scroll", () => this.draw());
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", (e) => this.up(e));
    this.scroll.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    new ResizeObserver(() => this.layout()).observe(this.scroll);
  }

  get duration() { return Math.max(this.app.duration(), 1); }
  get scrollX() { return this.scroll.scrollLeft; }
  x(t) { return HEADER_W + t * this.app.pps - this.scrollX; }
  t(x) { return (x - HEADER_W + this.scrollX) / this.app.pps; }
  trackAt(y) {
    const i = Math.floor((y - TOP) / TRACK_H);
    return y >= TOP && i < this.app.show.tracks.length ? i : -1;
  }

  layout() {
    const w = this.scroll.clientWidth;
    const h = TOP + Math.max(this.app.show?.tracks.length || 0, 1) * TRACK_H;
    this.inner.style.width = `${HEADER_W + this.duration * this.app.pps + 40}px`;
    this.inner.style.height = `${h}px`;
    // The stage must be only as wide as the view, or it has no room to stick and scrolls away.
    Object.assign(this.canvas.parentElement.style, { width: `${w}px`, height: `${h}px` });
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.w = w;
    this.h = h;
    this.draw();
  }

  // Zooms keeping the time under anchorX in place: the pointer for the wheel, otherwise the
  // playhead when it's in view, or the middle.
  zoom(factor, anchorX) {
    if (anchorX == null) {
      const px = this.x(this.app.time);
      anchorX = px >= HEADER_W && px <= this.w ? px : HEADER_W + (this.w - HEADER_W) / 2;
    }
    const t = this.t(anchorX);
    this.app.pps = Math.min(Math.max(this.app.pps * factor, 4), 800);
    this.layout();
    this.scroll.scrollLeft = HEADER_W + t * this.app.pps - anchorX;
    this.app.zoomed?.();
  }

  // Keep the playhead visible while playing.
  follow(t) {
    const x = this.x(t);
    if (x > this.w - 40 || x < HEADER_W) this.scroll.scrollLeft = t * this.app.pps - 60;
  }

  // drawing ------------------------------------------------------------------
  draw() {
    if (!this.app.show || !this.w) return;
    const { ctx, w, h } = this;
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    ctx.clearRect(0, 0, w, h);

    // tracks
    this.app.show.tracks.forEach((tr, i) => {
      const y = TOP + i * TRACK_H;
      ctx.fillStyle = col(i % 2 ? "--track-alt" : "--track");
      ctx.fillRect(HEADER_W, y, w - HEADER_W, TRACK_H);
      const dev = this.app.devices[tr.device];
      tr.clips.forEach((clip) => this.drawClip(clip, y, dev, col, this.app.clipFit?.(clip, i)));
    });

    // beats, with the first beat of each bar drawn stronger
    ctx.fillStyle = col("--panel");
    ctx.fillRect(HEADER_W, RULER_H + WAVE_H, w - HEADER_W, BEAT_H);
    const bars = new Set((this.app.show.bars || []).map((b) => Math.round(b * 1000)));
    for (const b of this.app.show.beats) {
      const x = this.x(b);
      if (x < HEADER_W || x > w) continue;
      ctx.strokeStyle = col("--beat");
      ctx.globalAlpha = bars.has(Math.round(b * 1000)) ? 0.7 : 0.35;
      ctx.beginPath(); ctx.moveTo(x + 0.5, RULER_H + WAVE_H); ctx.lineTo(x + 0.5, h); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col("--beat");
      ctx.beginPath();
      ctx.moveTo(x - 4, RULER_H + WAVE_H + 3); ctx.lineTo(x + 4, RULER_H + WAVE_H + 3);
      ctx.lineTo(x, RULER_H + WAVE_H + BEAT_H - 3); ctx.fill();
    }

    this.drawWave(col);
    this.drawSections(col, true);
    this.drawRuler(col);
    this.drawRegion(col);

    // header column
    ctx.fillStyle = col("--panel");
    ctx.fillRect(0, 0, HEADER_W, h);
    ctx.fillStyle = col("--muted");
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("Song", 10, RULER_H + WAVE_H / 2 + 4);
    ctx.fillText("Beats", 10, RULER_H + WAVE_H + 12);
    // A split light's tracks (its own, then its parts) are drawn as one group: a bar down the
    // left, a tint behind them and a heavier line around them, with the parts indented.
    // A group of one track is drawn like any other track.
    const tracks = this.app.show.tracks;
    const lightOf = (k) => {
      const d = this.app.devices[tracks[k]?.device];
      return d?.light?.id || d?.parent || null;
    };
    const sizes = {};
    tracks.forEach((_, k) => { const g = lightOf(k); if (g) sizes[g] = (sizes[g] || 0) + 1; });
    const groupOf = (k) => { const g = lightOf(k); return g && sizes[g] > 1 ? g : null; };
    tracks.forEach((tr, i) => {
      const g = groupOf(i);
      if (!g) return;
      const y = TOP + i * TRACK_H;
      ctx.fillStyle = col("--accent");
      ctx.globalAlpha = 0.07;
      ctx.fillRect(0, y, HEADER_W, TRACK_H);
      ctx.globalAlpha = 0.8;
      ctx.fillRect(0, y + (groupOf(i - 1) === g ? 0 : 4), 4, TRACK_H - (groupOf(i - 1) === g ? 0 : 4) - (groupOf(i + 1) === g ? 0 : 4));
      ctx.globalAlpha = 1;
    });
    tracks.forEach((tr, i) => {
      const y = TOP + i * TRACK_H;
      const dev = this.app.devices[tr.device];
      if (this.app.selected?.track === i && !this.app.selected.clip && !this.app.selected.range) {
        ctx.fillStyle = col("--accent");
        ctx.globalAlpha = 0.18;
        ctx.fillRect(0, y, HEADER_W, TRACK_H);
        ctx.globalAlpha = 1;
      }
      const house = tr.device === HOUSE;
      // A part under its light's own track (or another part) shows just its own name, indented.
      const nested = dev?.parent && groupOf(i - 1) === dev.parent;
      const x = nested ? 26 : 10;
      if (nested) {
        ctx.strokeStyle = col("--muted");
        ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(14.5, y); ctx.lineTo(14.5, y + 16); ctx.lineTo(21, y + 16); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = col(house ? "--accent" : "--text");
      ctx.font = `${nested ? 500 : 600} 13px system-ui, sans-serif`;
      const name = house ? "House" : !dev ? "Missing device" : nested ? dev.partName : dev.name;
      ctx.fillText(clipText(ctx, name, HEADER_W - x - 6), x, y + 20);
      ctx.fillStyle = col("--muted");
      ctx.font = "12px system-ui, sans-serif";
      const sub = house ? "Across all lights"
        : !dev ? tr.device
        : dev.light ? (dev.light.whole === false ? "Not played: parts only" : `All parts · ${dev.segments} segments`)
        : dev.parent ? `Segments ${dev.from}–${dev.to}`
        : `${dev.segments} segments${dev.ip || dev.entity ? "" : " · planned"}`;
      const note = !house && dev && this.app.trackNote?.(dev);
      if (note) ctx.fillStyle = WARN;
      ctx.fillText(clipText(ctx, note ? `⚠ ${note}` : sub, HEADER_W - x - 6), x, y + 36);
    });
    this.drawRange(col);
    ctx.strokeStyle = col("--line");
    ctx.beginPath(); ctx.moveTo(HEADER_W + 0.5, 0); ctx.lineTo(HEADER_W + 0.5, h); ctx.stroke();
    for (let i = 0; i <= this.app.show.tracks.length; i++) {
      const y = TOP + i * TRACK_H + 0.5;
      // A heavier line where a group of a split light's tracks starts or ends.
      const edge = groupOf(i) !== groupOf(i - 1) && (groupOf(i) || groupOf(i - 1));
      ctx.lineWidth = edge ? 2 : 1;
      ctx.strokeStyle = col(edge ? "--muted" : "--line");
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.lineWidth = 1;
    this.drawPlayhead();
  }

  // A clip shows its own animation as its light shows it (stepped on a slow light, see asShown): time
  // runs left to right, segments top to bottom. One that won't work on its light is hatched, and one
  // that only partly works gets a corner; both get a ⚠.
  drawClip(clip, y, dev, col, fit = null) {
    const n = dev ? dev.segments : 10;
    const { ctx, w } = this;
    const x0 = this.x(clip.start), x1 = this.x(clip.end);
    if (x1 < HEADER_W || x0 > w) return;
    const top = y + 4, height = TRACK_H - 8;
    const left = Math.max(x0, HEADER_W), right = Math.min(x1, w);
    const step = 3, segH = height / n;
    const buf = new Uint8Array(n * 3);
    for (let x = left; x < right; x += step) {
      const t = this.t(x + step / 2);
      const rgb = asShown(dev, Math.min(Math.max(t, clip.start), clip.end - 1e-6),
        (tt) => renderTrack([clip], Math.max(tt, clip.start), n, buf));
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = `rgb(${rgb[i * 3]},${rgb[i * 3 + 1]},${rgb[i * 3 + 2]})`;
        ctx.fillRect(x, top + i * segH, Math.min(step, right - x), segH + 0.5);
      }
    }
    const level = fit?.level || "ok";
    if (level === "no") {
      ctx.save();
      ctx.beginPath(); ctx.rect(left, top, right - left, height); ctx.clip();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(left, top, right - left, height);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let hx = left - height - ((left - x0) % 10); hx < right; hx += 10) { ctx.moveTo(hx, top + height); ctx.lineTo(hx + height, top); }
      ctx.stroke();
      ctx.restore();
    }
    if (level !== "ok" && right - left > 10) {
      ctx.fillStyle = level === "no" ? col("--danger") || "#dc2626" : WARN;
      ctx.beginPath(); ctx.moveTo(right - 12, top); ctx.lineTo(right, top); ctx.lineTo(right, top + 12); ctx.fill();
    }
    const selected = this.app.selected?.clip === clip;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? col("--accent") : "rgba(255,255,255,0.6)";
    ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, height - 1);
    ctx.lineWidth = 1;
    if (x1 - x0 > 40) {
      ctx.font = "600 11px system-ui, sans-serif";
      const tx = Math.max(x0, HEADER_W) + 4;
      // Trimmed to its own clip, so a short clip's name doesn't run into the next one.
      const label = clipText(ctx, `${level === "ok" ? "" : "⚠ "}${EFFECTS[clip.effect]?.label || clip.effect}`, x1 - tx - 8);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(tx - 2, top + 2, ctx.measureText(label).width + 6, 15);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, tx + 1, top + 13);
    }
  }

  // The selected stretch of time, across one or more lights.
  drawRange(col) {
    const r = this.app.selected?.range;
    if (!r) return;
    const { ctx, w } = this;
    const x0 = Math.max(this.x(r.start), HEADER_W), x1 = Math.min(this.x(r.end), w);
    if (x1 <= x0) return;
    const y0 = TOP + r.tracks[0] * TRACK_H, y1 = TOP + (r.tracks.at(-1) + 1) * TRACK_H;
    ctx.fillStyle = col("--accent");
    ctx.globalAlpha = 0.22;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col("--accent");
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(this.x(r.start) + 1, y0 + 1, this.x(r.end) - this.x(r.start) - 2, y1 - y0 - 2);
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }

  // The play region: a band on the ruler and edge lines down the timeline.
  drawRegion(col) {
    const r = this.app.region;
    if (!r) return;
    const { ctx, w, h } = this;
    const x0 = this.x(r.start), x1 = this.x(r.end);
    if (x1 < HEADER_W || x0 > w) return;
    ctx.fillStyle = col("--region");
    ctx.globalAlpha = 0.35;
    ctx.fillRect(Math.max(x0, HEADER_W), 0, Math.min(x1, w) - Math.max(x0, HEADER_W), RULER_H);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col("--region");
    ctx.lineWidth = 2;
    for (const x of [x0, x1]) {
      if (x < HEADER_W || x > w) continue;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  drawWave(col) {
    const { ctx, w } = this;
    const mid = RULER_H + WAVE_H / 2;
    ctx.fillStyle = col("--panel");
    ctx.fillRect(HEADER_W, RULER_H, w - HEADER_W, WAVE_H);
    this.drawSections(col);
    const peaks = this.app.peaks;
    if (!peaks) return;
    ctx.fillStyle = col("--wave");
    for (let x = HEADER_W; x < w; x++) {
      const a = Math.floor(this.t(x) * peaks.rate), b = Math.floor(this.t(x + 1) * peaks.rate);
      if (a < 0 || a >= peaks.data.length) continue;
      let m = 0;
      for (let i = a; i <= Math.min(b, peaks.data.length - 1); i++) m = Math.max(m, peaks.data[i]);
      const hh = Math.max(1, m * (WAVE_H / 2 - 3));
      ctx.fillRect(x, mid - hh, 1, hh * 2);
    }
  }

  // The song's sections (from Detect) as tinted bands behind the waveform, one tint per name, and
  // their names over it.
  drawSections(col, labels = false) {
    const { ctx, w } = this;
    const names = [...new Set((this.app.show.sections || []).map((s) => s.label))];
    ctx.font = "11px system-ui, sans-serif";
    for (const s of this.app.show.sections || []) {
      const x0 = Math.max(HEADER_W, this.x(s.start)), x1 = Math.min(w, this.x(s.end));
      if (x1 <= x0) continue;
      if (labels) {
        ctx.fillStyle = col("--text");
        if (x1 - x0 > 40) ctx.fillText(s.label, x0 + 4, RULER_H + 12);
        continue;
      }
      ctx.fillStyle = sectionTint(names, s.label, s.color);
      ctx.globalAlpha = SECTION_ALPHA;
      ctx.fillRect(x0, RULER_H, x1 - x0, WAVE_H);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col("--line");
      ctx.beginPath(); ctx.moveTo(this.x(s.start) + 0.5, RULER_H); ctx.lineTo(this.x(s.start) + 0.5, RULER_H + WAVE_H); ctx.stroke();
    }
  }

  drawRuler(col) {
    const { ctx, w } = this;
    ctx.fillStyle = col("--panel");
    ctx.fillRect(HEADER_W, 0, w - HEADER_W, RULER_H);
    const pps = this.app.pps;
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 70) || 300;
    ctx.fillStyle = col("--muted");
    ctx.strokeStyle = col("--line");
    ctx.font = "11px system-ui, sans-serif";
    for (let t = Math.floor(this.t(HEADER_W) / step) * step; this.x(t) < w; t += step) {
      const x = this.x(t);
      if (x < HEADER_W) continue;
      ctx.beginPath(); ctx.moveTo(x + 0.5, RULER_H - 8); ctx.lineTo(x + 0.5, RULER_H); ctx.stroke();
      ctx.fillText(fmtTime(t, step < 1), x + 3, 12);
    }
  }

  drawPlayhead() {
    const { octx, w, h } = this;
    if (!w) return;
    octx.clearRect(0, 0, w, h);
    const x = this.x(this.app.time);
    if (x < HEADER_W || x > w) return;
    octx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--playhead");
    octx.lineWidth = 2;
    octx.beginPath(); octx.moveTo(x, 0); octx.lineTo(x, h); octx.stroke();
  }

  // interaction ---------------------------------------------------------------
  snapTime(t, e, ignore) {
    if (!this.app.snap || e.shiftKey) return t;
    const limit = SNAP_PX / this.app.pps;
    let best = t, dist = limit;
    const consider = (c) => {
      const d = Math.abs(c - t);
      if (d < dist) { dist = d; best = c; }
    };
    consider(0);
    this.app.show.beats.forEach(consider);
    for (const tr of this.app.show.tracks) {
      for (const c of tr.clips) if (c !== ignore) { consider(c.start); consider(c.end); }
    }
    return best;
  }

  hitClip(x, y) {
    const ti = this.trackAt(y);
    if (ti < 0 || x < HEADER_W) return null;
    const clips = this.app.show.tracks[ti].clips;
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i], x0 = this.x(c.start), x1 = this.x(c.end);
      if (x >= x0 - 2 && x <= x1 + 2) {
        const mode = x - x0 < EDGE_PX ? "start" : x1 - x < EDGE_PX ? "end" : "move";
        return { track: ti, clip: c, mode };
      }
    }
    return null;
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down(e) {
    const [x, y] = this.pos(e);
    if (x < HEADER_W) {
      // Clicking a light's name selects the whole light, for copying its effects.
      const ti = this.trackAt(y);
      if (ti >= 0) this.app.select({ track: ti, clip: null });
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const app = this.app;
    if (y < RULER_H) {
      // Drag along the ruler to set the play region; a click just moves the playhead.
      this.drag = { mode: "region", anchor: Math.max(0, this.snapTime(this.t(x), e)), x0: x, moved: false };
      return;
    }
    if (y < RULER_H + WAVE_H) {
      this.drag = { mode: "seek" };
      app.seek(Math.max(0, this.t(x)));
      return;
    }
    if (y < TOP) {
      const beats = app.show.beats;
      const near = beats.findIndex((b) => Math.abs(this.x(b) - x) < 5);
      if (near >= 0) {
        const [gone] = beats.splice(near, 1);
        if (app.show.bars) app.show.bars = app.show.bars.filter((b) => Math.abs(b - gone) > 0.001);
      }
      else { beats.push(Math.max(0, this.t(x))); beats.sort((a, b) => a - b); }
      app.changed();
      return;
    }
    // Alt-drag selects a stretch of time even over clips, e.g. to cut a piece out of one.
    const hit = e.altKey ? null : this.hitClip(x, y);
    if (hit) {
      app.select({ track: hit.track, clip: hit.clip });
      this.drag = { ...hit, t0: this.t(x), start: hit.clip.start, end: hit.clip.end, moved: false };
      return;
    }
    // Otherwise drag to select a stretch of time, across lights too, then add or delete effects there.
    const ti = this.trackAt(y);
    if (ti < 0) return;
    const t = Math.max(0, this.snapTime(this.t(x), e));
    this.drag = { mode: "range", track: ti, anchor: t, moved: false };
    this.setRange(ti, ti, t, t + MIN_LEN);
  }

  setRange(a, b, start, end) {
    const tracks = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) tracks.push(i);
    this.app.selected = { track: tracks[0], clip: null, range: { tracks, start, end } };
    this.draw();
  }

  move(e) {
    const [x, y] = this.pos(e);
    const d = this.drag;
    if (!d) {
      const hit = this.hitClip(x, y);
      this.canvas.style.cursor = !hit ? (y < RULER_H && x > HEADER_W ? "col-resize"
        : y < RULER_H + WAVE_H && x > HEADER_W ? "text" : "crosshair")
        : hit.mode === "move" && !e.altKey ? "grab" : e.altKey ? "crosshair" : "ew-resize";
      return;
    }
    const t = this.t(x);
    if (d.mode === "seek") { this.app.seek(Math.max(0, t)); return; }
    if (d.mode === "region") {
      if (!d.moved && Math.abs(x - d.x0) < 4) return;
      d.moved = true;
      const s = Math.max(0, this.snapTime(t, e));
      this.app.setRegion(s >= d.anchor ? { start: d.anchor, end: s } : { start: s, end: d.anchor });
      return;
    }
    d.moved = true;
    const c = d.clip;
    if (d.mode === "range") {
      const s = Math.max(0, this.snapTime(t, e));
      const ti = this.trackAt(Math.min(Math.max(y, TOP), this.h - 1));
      const [a, b] = s >= d.anchor ? [d.anchor, Math.max(s, d.anchor + MIN_LEN)] : [s, d.anchor];
      this.setRange(d.track, ti >= 0 ? ti : d.track, a, b);
      return;
    } else if (d.mode === "start") {
      c.start = Math.min(Math.max(0, this.snapTime(t, e, c)), c.end - MIN_LEN);
    } else if (d.mode === "end") {
      c.end = Math.max(this.snapTime(t, e, c), c.start + MIN_LEN);
    } else {
      const len = d.end - d.start;
      let s = Math.max(0, d.start + t - d.t0);
      const sStart = this.snapTime(s, e, c), sEnd = this.snapTime(s + len, e, c);
      if (sStart !== s) s = sStart; else if (sEnd !== s + len) s = sEnd - len;
      c.start = Math.max(0, s);
      c.end = c.start + len;
      const ti = this.trackAt(y);
      // A clip can move to another light, but not between the House lane and the lights.
      const kind = (k) => this.app.show.tracks[k].device === HOUSE;
      if (ti >= 0 && ti !== d.track && kind(ti) === kind(d.track)) {
        const from = this.app.show.tracks[d.track].clips;
        from.splice(from.indexOf(c), 1);
        this.app.show.tracks[ti].clips.push(c);
        d.track = ti;
        this.app.selected.track = ti;
      }
    }
    this.app.changed({ live: true });
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    if (!d || d.mode === "seek") return;
    if (d.mode === "region") {
      if (!d.moved) this.app.seek(Math.max(0, this.t(this.pos(e)[0])));
      return;
    }
    if (d.mode === "range") {
      const r = this.app.selected.range;
      if (!d.moved || (r.end - r.start) * this.app.pps < 4) {
        // A plain click selects up to the next beat, or two seconds.
        const next = this.app.show.beats.find((b) => b > d.anchor + MIN_LEN);
        r.end = next ?? d.anchor + 2;
      }
      this.app.select(this.app.selected);
      return;
    }
    if (d.moved) this.app.changed();
  }

  // Ctrl+wheel (or a trackpad pinch) zooms round the pointer, in proportion to how far the wheel
  // turned so pinches stay smooth; a plain wheel scrolls along the timeline.
  wheel(e) {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.w : 1; // lines, pages, pixels
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const dy = Math.min(Math.max(e.deltaY * unit, -100), 100);
      this.zoom(Math.exp(-dy * 0.004), this.pos(e)[0]);
    } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      this.scroll.scrollLeft += e.deltaY * unit;
    }
  }
}

function clipText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > max) text = text.slice(0, -1);
  return text + "…";
}

export function fmtTime(t, frac = true) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${frac ? s.toFixed(2).padStart(5, "0") : String(Math.floor(s)).padStart(2, "0")}`;
}
